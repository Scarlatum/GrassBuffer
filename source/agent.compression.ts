import { sleep } from "gramio";
import { Agent } from "./agent.ts";
import { MessageContainer } from "./shared.d.ts";
import { ChatChoice, proxyRequest as defaultProxyRequest } from "./utils/common.ts";
import { omitTextReasoning } from "./utils/formating.ts";

export type SummaryChunk = {
  from: number;
  to: number;
  content: string;
};

export class HistoryCompressor {

  static COMPRESSION_RANGE = 10;

  constructor(
    private ctx: Agent,
    private proxyRequest: typeof defaultProxyRequest = defaultProxyRequest
  ) {}

  // TODO: Нужно будет проверять rate limit если сообщений много, или они слишком большие
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

    let content = omitTextReasoning(x.message.content!)

    const arrbeg = content.indexOf("[");
    const arrend = content.indexOf("]");

    content = content.slice(arrbeg, arrend + 1);

    try {
      return JSON.parse(content ?? "[]");
    } catch {
      return [];
    }

  }

  private async summarizeChunk(chunk: Array<MessageContainer>): Promise<SummaryChunk | Error> {

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
      : omitTextReasoning(String((ans.choices as ChatChoice[])[0].message.content))
        .replaceAll("\n", "")
      ;

    const first = chunk.at(0);
    const last  = chunk.at(-1);

    if ( !first || !last ) return Error("Крайние чанки не определенны");

    return {
      from: first.date,
      to: last.date,
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

    const summaries = Array<SummaryChunk>();

    for ( const x of chunks.map(c => this.summarizeChunk(c)) ) {

      const res = await x;

      if ( res instanceof Error ) continue;

      await this.saveSummary(uid, res);

      await sleep(10_000);

      summaries.push(res);

    }

    return summaries;

  }

  private async saveSummary(uid: string, summary: SummaryChunk) {
    await this.ctx.adapter.db.query(`
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