import { Agent } from "./agent.ts";
import { DatabaseAdapter } from "./database.ts";
import { MessageContainer } from "./shared.d.ts";
import { ChatChoice, proxyRequest as defaultProxyRequest } from "./utils/common.ts";

type SummaryChunk = {
  from: number;
  to: number;
  content: string;
};

export class HistoryCompressor {

  static COMPRESSION_RANGE = 20;

  constructor(
    private adapter: DatabaseAdapter,
    private proxyRequest: typeof defaultProxyRequest = defaultProxyRequest
  ) {}

  private async segmentHistory(history: Array<MessageContainer>): Promise<number[]> {

    const formatted = history
      .map((x, i) => `[${ i }] ${ x.from }: ${ x.data }`)
      .join("\n");

    const ans = await this.proxyRequest({
      model: Agent.MODEL,
      temperature: 0.0,
      messages: [
        {
          role: "system",
          content: "Ты анализируешь историю диалога и возвращаешь ТОЛЬКО JSON массив индексов, где тема меняется. Например: [0, 12, 27]. Никакого другого текста.",
        },
        { role: "user", content: formatted },
      ],
    });

    if ( ans instanceof Error ) return [];

    const [ x ] = ans.choices as ChatChoice[];

    try {
      return JSON.parse(x.message.content ?? "[]");
    } catch {
      return [];
    }

  }

  private async summarizeChunk(chunk: Array<MessageContainer>): Promise<SummaryChunk> {

    const formatted = chunk
      .map(x => `${ x.from }: ${ x.data }`)
      .join("\n");

    const ans = await this.proxyRequest({
      model: Agent.MODEL,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: "Сожми этот фрагмент диалога в краткое описание — о чём говорили, к чему пришли. 2-4 предложения.",
        },
        { role: "user", content: formatted },
      ],
    });

    const content = ans instanceof Error
      ? ""
      : String((ans.choices as ChatChoice[])[0].message.content);

    return {
      from: chunk.at(0)!.date,
      to: chunk.at(-1)!.date,
      content,
    };

  }

  public async compress(uid: string, history: Array<MessageContainer>): Promise<SummaryChunk[]> {

    const indices = await this.segmentHistory(history);

    if ( indices.length === 0 ) return [];

    const chunks = indices.map((start, i) => {
      const end = indices[i + 1] ?? history.length;
      return history.slice(start, end);
    });

    const summaries = await Promise.all(chunks.map(c => this.summarizeChunk(c)));

    await Promise.all(summaries.map(s => this.saveSummary(uid, s)));

    return summaries;

  }

  private async saveSummary(uid: string, summary: SummaryChunk) {
    await this.adapter.db.query(`
      BEGIN TRANSACTION;

      LET $s = CREATE ONLY summary CONTENT {
        from: $from,
        to: $to,
        content: $content
      };

      RELATE user:${ uid }->has_summary->$s;

      COMMIT TRANSACTION;
    `, {
      from: summary.from,
      to: summary.to,
      content: summary.content,
    });
  }

}