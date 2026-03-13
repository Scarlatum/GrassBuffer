import { Kaya } from "./kaya.ts"

import ruLocale from "./locales/ru.json" with { type: "json" };

import { ChatMessage, proxyRequest, openRouterEmbeddingRequest } from "./utils/common.ts";
import { SimpleLogger } from "./logger.ts";
import { DatabaseAdapter } from "./database.ts";
import { Integration } from "./interfaces/integration.ts";
import { Memory } from "./memory.ts";
import { GrassBot } from "./intergrations/telegram.ts";
import { MessageContainer } from "./shared.d.ts";
import { AgenticSession } from "./agent.session.ts";
import { HistoryCompressor } from "./agent.compression.ts";
import { EmbeddingsManager } from "./agent.embeddings.ts";

export class Agent extends Kaya {

  static readonly LOCALE = ruLocale;
  static readonly MODEL = Deno.env.get("MODEL")!;
  static readonly PROXY = Deno.env.get("PROXY")!;
  static readonly OPENROUTER = Deno.env.get("OPENROUTER");
  static readonly OWNER = Deno.env.get("OWNER")!;
  static readonly OWTAG = Deno.env.get("OWNER_TAG")!;

  public logger = new SimpleLogger();
  public adapter = new DatabaseAdapter();
  public compressor = new HistoryCompressor(this.adapter);
  public memory = new Memory();
  public embedder = new EmbeddingsManager(
    this.adapter,
    this.embeddingRequest.bind(this),
    { model: "text-embedding-3-small" }
  );

  constructor(public integration: Integration) {

    if ( !Agent.MODEL || !Agent.PROXY || !Agent.OWNER || !Agent.OWTAG ) throw Error();

    super();

    integration.setMessageHandler(async (text, contextKey, force): Promise<string | undefined> => {

      const his = await this.adapter.getUserHistory(contextKey);

      const intervention = force || await this.needIntervention(his);
      const directAsk = text.toLowerCase().includes("кая,");

      if ( force || directAsk || intervention ) {
        return await this.message(text, contextKey, his);
      }
  
      else return void this.adapter.db.queryRaw(/*surql*/`
        BEGIN TRANSACTION;

        LET $x = CREATE ONLY message CONTENT {
          data: $data,
          from: $from,
          date: $date
        };

        RELATE user:${ contextKey }<-chat<-$x;

        COMMIT TRANSACTION;
      `, {
        data: text.replaceAll("\'", "\""),
        from: contextKey,
        date: Date.now()
      });

    });

    Kaya.kv.listenQueue(async (message: unknown) => {

      if ( typeof message !== "string" ) return;

      (this.integration as GrassBot).bot.api.sendMessage({
        chat_id: parseInt(Agent.OWNER!),
        text: message
      })

      const history = await this.adapter.getUserHistory(Agent.OWTAG!);

      this.message(message, "Kaya", history);

    });

    this.adapter.onReady.then(() => this.integration.start());

  }

  private async embeddingRequest(body: object): Promise<Record<string, object> | Error> {
    if (Agent.OPENROUTER) {
      const res = await openRouterEmbeddingRequest(body);
      if (!(res instanceof Error)) return res;
      this.logger.log({ error: res }, "OpenRouter embedding failed, falling back to proxy");
    }
    return proxyRequest(body);
  }

  static inlineTool(text: string | null) {

    if ( !text ) return false;

    return text.includes("<tool_call>") || text.includes("```json") 

  }

  private async sessionTools(uid: string) {

    if ( this.memory.user.has(uid) ) {

      return this.memory.user.get(uid)!.tools;

    }

    const user = await this.memory.initUser(uid, this);

    return user.tools;

  }

  private async getRelevantSummaries(
    uid: string,
    query: string
  ): Promise<string> {
    const results = await this.embedder.searchHybrid(uid, query, { limit: 3 });
    if (results.length === 0) return "";

    return "\n\nРелевантные фрагменты из предыдущих разговоров:\n"
      + results.map(r =>
          `[${new Date(r.from).toLocaleDateString()}]: ${r.content}`
        ).join("\n");
  }

  /** Запрос к LLM. Опционально createCompletion — для тестов (подмена вызова API). */
  public async ask(text: string, from: string, history: Array<MessageContainer> = []): Promise<string | Error> {

    const sys = { role: "system", content: Kaya.soul };

    const tools = await this.sessionTools(from);
    const summary = await this.getRelevantSummaries(from, text);

    if ( summary ) sys.content += summary;

    const clean = text.includes("##CLN##");

    const his = clean ? [] : history.map((x) => ({
      content: x.data,
      role: Kaya.getRole(x.from),
    }));

    if ( clean ) text.replace("##CLN##", "");

    const messages = [
      sys,
      ...his,
      { role: Kaya.getRole(from), content: `${text}`, name: from },
    ] as Array<ChatMessage>;

    const session = new AgenticSession(tools, messages, this.logger);
    const res = await session.step();

    this.logger.log({ value: messages }, "messages");

    tools.belt.setDefault();

    return res;

  }

  public async message(message: string, from: string, history: Array<MessageContainer>) {

    const user = this.memory.user.get(from) || await this.memory.initUser(from, this);

    const response = await this.ask(message, from, history);

    if ( response instanceof Error ) return response.message;

    this.adapter.saveMessages(
      message.replaceAll(`'`, `"`),
      response.replaceAll(`'`, `"`),
      from,
      from
    );

    if ( ++user.interactions.messageCount % HistoryCompressor.COMPRESSION_RANGE === 0 ) {
      this.compressor.compress(from, history).then(x => 
        this.embedder.indexSummariesBatch(from, x)
      );
    }

    return response;

  }

}