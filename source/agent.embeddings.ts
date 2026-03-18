import { SummaryChunk } from "./agent.compression.ts";
import { summaryChunkSchema } from "./schemas/agent.schemas.ts";
import { Agent } from "./agent.ts";
import { openRouterEmbeddingRequest, proxyRequest } from "./utils/common.ts";

type EmbeddingResult = {
  content: string;
  from: number;
  to: number;
  score: number;
};

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1000;

export class EmbeddingsManager {

  private model: string = "nvidia/llama-nemotron-embed-vl-1b-v2:free";
  private dimensions: number = 384;

  constructor(private ctx: Agent) {}

  private async embeddingRequest(body: object): Promise<Record<string, object> | Error> {

    if ( Agent.OPENROUTER ) {

      const res = await openRouterEmbeddingRequest(body, Agent.OPENROUTER);

      if (!(res instanceof Error)) return res;

      this.ctx.logger.log({ error: res }, "OpenRouter embedding failed, falling back to proxy");

    }

    return proxyRequest(body);

  }

  private async embed(text: string): Promise<number[] | null> {
    try {
      const res = await this.embeddingRequest({
        model: this.model,
        input: text,
      });

      if (res instanceof Error) {
        this.ctx.logger.log({ error: res, model: this.model }, "Embedding request failed");
        return null;
      }

      const data = res.data as Array<{ embedding: number[] }>;
      return data?.[0]?.embedding ?? null;
    } catch (e) {
      this.ctx.logger.log({ error: e, text: text.slice(0, 100) }, "Embedding generation error");
      return null;
    }
  }

  private validateSummaryChunk(raw: unknown): SummaryChunk | null {
    const result = summaryChunkSchema.safeParse(raw);
    if (!result.success) {
      this.ctx.logger.log({ error: result.error, raw }, "Invalid summary chunk schema");
      return null;
    }
    return result.data;
  }

  async indexSummary(
    uid: string,
    summary: SummaryChunk & Partial<{ id: { table: string, id: string } }>,
  ): Promise<void> {

    const validated = this.validateSummaryChunk(summary);

    if (!validated) return;

    const embedding = await this.embed(validated.content);

    if (!embedding) {
      this.ctx.logger.log({ uid, from: validated.from, to: validated.to }, "Failed to generate embedding");
      return;
    }

    try {

      // OLD BROKEN QUERY
      // UPDATE summary SET embedding = $embedding
      // WHERE from = $from AND to = $to
      // AND ->has_summary->user CONTAINS ${uid};

      await this.ctx.adapter.db.query(/*surql*/`
        BEGIN TRANSACTION;

        UPDATE summary:${ summary.id!.id } SET embedding = $embedding;

        COMMIT TRANSACTION;
      `, {
        embedding,
      });
    } catch (e) {

      this.ctx.logger.log({ error: e, uid, from: validated.from }, "Failed to save embedding to DB. Save them as file");

      if ( Array.isArray(embedding) && typeof embedding[0] === "number" ) {

        const view = new Float16Array(embedding);
  
        Deno.writeFile(`./embeddings.f16.${ uid }.bin`, new Uint8Array(view.buffer))

      }

    }
  }

  async indexate(
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

    this.ctx.logger.log({ uid, processed, total: summaries.length }, "Batch indexing complete");

    return processed;

  }

  async search(uid: string, query: string, limit: number = 5, threshold: number = 0.47) {

    const embedding = await this.embed(query);

    if (!embedding) {
      this.ctx.logger.log({ uid, query: query.slice(0, 50) }, "Search: failed to embed query");
      return [];
    }

    try {
      const [ result ] = await this.ctx.adapter.db.query<Array<EmbeddingResult[]>>(/*surql*/`
        BEGIN TRANSACTION;

        LET $x = SELECT VALUE ->has_summary->summary FROM ONLY user:${ uid };
        LET $y = SELECT
          content,
          from,
          to,
          vector::similarity::cosine(embedding, $query_vec) AS score
        FROM $x WHERE embedding != NONE
        ORDER BY score NUMERIC DESC LIMIT ($limit * 2);

        LET $scr = SELECT VALUE score FROM $y;
        LET $mid = math::sum($scr) / array::len($scr);

        RETURN SELECT * FROM $y WHERE score >= $mid;

        COMMIT TRANSACTION;
      `, {
        query_vec: embedding,
        limit
      });

      return (result || []) as EmbeddingResult[];

    } catch (e) {
      this.ctx.logger.log({ error: e, uid }, "Search query failed");
      return [];
    }
  }

  async reindexAll(uid: string): Promise<number> {
    try {

      const summaries = await this.ctx.adapter.db.query(/*surql*/`
        SELECT * FROM (
          SELECT VALUE ->has_summary->summary from only user:${ uid }
        )
      `);

      if (!Array.isArray(summaries) || !summaries[0]) return 0;

      const records = summaries[0] as SummaryChunk[];

      await this.indexate(uid, records);

      return records.length;

    } catch (e) {
      this.ctx.logger.log({ error: e, uid }, "Reindex failed");
      return 0;
    }
  }

}
