import { DatabaseAdapter } from "./database.ts";
import { SummaryChunk } from "./agent.compression.ts";
import { SimpleLogger } from "./logger.ts";
import { summaryChunkSchema } from "./schemas/agent.schemas.ts";

type EmbeddingResult = {
  id: string;
  content: string;
  from: number;
  to: number;
  score: number;
};

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1000;

export class EmbeddingsManager {

  private model: string;
  private dimensions: number;
  public logger = new SimpleLogger();

  constructor(
    private adapter: DatabaseAdapter,
    private proxyRequest: (payload: object) => Promise<Record<string, object> | Error>,
    options?: { model?: string; dimensions?: number }
  ) {
    this.model = options?.model ?? "sentence-transformers/all-MiniLM-L6-v2";
    this.dimensions = options?.dimensions ?? 384;
  }

  // ─── Генерация embedding для одного текста ───

  private async embed(text: string): Promise<number[] | null> {
    try {
      const res = await this.proxyRequest({
        model: this.model,
        input: text,
      });

      if (res instanceof Error) {
        this.logger.log({ error: res, model: this.model }, "Embedding request failed");
        return null;
      }

      const data = res.data as Array<{ embedding: number[] }>;
      return data?.[0]?.embedding ?? null;
    } catch (e) {
      this.logger.log({ error: e, text: text.slice(0, 100) }, "Embedding generation error");
      return null;
    }
  }

  // ─── Валидация summary через Zod ───

  private validateSummaryChunk(raw: unknown): SummaryChunk | null {
    const result = summaryChunkSchema.safeParse(raw);
    if (!result.success) {
      this.logger.log({ error: result.error, raw }, "Invalid summary chunk schema");
      return null;
    }
    return result.data;
  }

  // ─── Векторизация и сохранение summary ───

  async indexSummary(
    uid: string,
    summary: SummaryChunk,
  ): Promise<void> {
    const validated = this.validateSummaryChunk(summary);
    if (!validated) return;

    const embedding = await this.embed(validated.content);
    if (!embedding) {
      this.logger.log({ uid, from: validated.from, to: validated.to }, "Failed to generate embedding");
      return;
    }

    try {
      await this.adapter.db.query(/*surql*/`
        UPDATE summary SET embedding = $embedding
        WHERE from = $from AND to = $to
        AND ->has_summary->user CONTAINS ${uid};
      `, {
        embedding,
        from: validated.from,
        to: validated.to,
      });
    } catch (e) {
      this.logger.log({ error: e, uid, from: validated.from }, "Failed to save embedding to DB");
    }
  }

  // ─── Пакетная индексация ───

  async indexSummaries(
    uid: string,
    summaries: SummaryChunk[],
  ): Promise<void> {
    await Promise.all(
      summaries.map(s => this.indexSummary(uid, s))
    );
  }

  // ─── Пакетная индексация с задержкой (для фоновых задач) ───

  async indexSummariesBatch(
    uid: string,
    summaries: SummaryChunk[],
  ): Promise<number> {
    const batches: SummaryChunk[][] = [];
    
    for (let i = 0; i < summaries.length; i += BATCH_SIZE) {
      batches.push(summaries.slice(i, i + BATCH_SIZE));
    }

    let processed = 0;

    for (const batch of batches) {
      await Promise.all(
        batch.map(s => this.indexSummary(uid, s))
      );
      processed += batch.length;
      
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    this.logger.log({ uid, processed, total: summaries.length }, "Batch indexing complete");
    return processed;
  }

  // ─── Поиск релевантных summaries ───

  async search(
    uid: string,
    query: string,
    limit: number = 5,
    threshold: number = 0.6,
  ): Promise<EmbeddingResult[]> {
    const embedding = await this.embed(query);
    if (!embedding) {
      this.logger.log({ uid, query: query.slice(0, 50) }, "Search: failed to embed query");
      return [];
    }

    try {
      const results = await this.adapter.db.query(/*surql*/`
        SELECT
          meta::id(id) AS id,
          content,
          from,
          to,
          vector::similarity::cosine(embedding, $query_vec) AS score
        FROM summary
        WHERE embedding != NONE
        AND ->has_summary->user CONTAINS ${uid}
        AND vector::similarity::cosine(embedding, $query_vec) >= $threshold
        ORDER BY score DESC
        LIMIT $limit;
      `, {
        query_vec: embedding,
        threshold,
        limit,
      });

      if (!Array.isArray(results) || !results[0]) return [];
      return results[0] as EmbeddingResult[];
    } catch (e) {
      this.logger.log({ error: e, uid }, "Search query failed");
      return [];
    }
  }

  // ─── Гибридный поиск: эмбеддинги + recency ───

  async searchHybrid(
    uid: string,
    query: string,
    options?: {
      limit?: number;
      recencyWeight?: number;
      maxAgeMs?: number;
    },
  ): Promise<EmbeddingResult[]> {
    const {
      limit = 5,
      recencyWeight = 0.3,
      maxAgeMs = 7 * 24 * 60 * 60 * 1000,
    } = options ?? {};

    const embedding = await this.embed(query);
    if (!embedding) {
      this.logger.log({ uid, query: query.slice(0, 50) }, "Hybrid search: failed to embed query");
      return [];
    }

    const now = Date.now();

    try {
      const results = await this.adapter.db.query(/*surql*/`
        LET $base_scores = (
          SELECT
            meta::id(id) AS id,
            content,
            from,
            to,
            vector::similarity::cosine(embedding, $query_vec) AS semantic_score
          FROM summary
          WHERE embedding != NONE
          AND ->has_summary->user CONTAINS ${uid}
        );

        SELECT
          id,
          content,
          from,
          to,
          (semantic_score * (1 - $recency_weight))
            + ($recency_weight * (1.0 - math::clamp(($now - to) / $max_age, 0.0, 1.0)))
            AS score
        FROM $base_scores
        ORDER BY score DESC
        LIMIT $limit;
      `, {
        query_vec: embedding,
        recencyWeight,
        maxAge: maxAgeMs,
        now,
        limit,
      });

      if (!Array.isArray(results) || !results[0]) return [];
      return results[0] as EmbeddingResult[];
    } catch (e) {
      this.logger.log({ error: e, uid }, "Hybrid search query failed");
      return [];
    }
  }

  // ─── Переиндексация (если сменилась модель/размерность) ───

  async reindexAll(uid: string): Promise<number> {
    try {
      const summaries = await this.adapter.db.query(/*surql*/`
        SELECT * FROM summary
        WHERE ->has_summary->user CONTAINS ${uid}
        AND (embedding = NONE OR vector::dimension(embedding) != $dim)
      `, { dim: this.dimensions });

      if (!Array.isArray(summaries) || !summaries[0]) return 0;

      const records = summaries[0] as SummaryChunk[];
      await this.indexSummariesBatch(uid, records);
      return records.length;
    } catch (e) {
      this.logger.log({ error: e, uid }, "Reindex failed");
      return 0;
    }
  }
}
