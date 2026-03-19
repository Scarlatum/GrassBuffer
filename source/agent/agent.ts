import { Kaya } from "../kaya.ts"

import ruLocale from "../locales/ru.json" with { type: "json" };

import { MessageContainer } from "../shared.d.ts";

import { SimpleLogger } from "../logger.ts";
import { DatabaseAdapter } from "../database.ts";

import { Integration } from "../interfaces/integration.ts";
import { Aggregator } from "../intergrations/aggregator.ts";

import { Memory, UserMemoryDescriptor } from "./agent.memory.ts";
import { HistoryCompressor } from "./agent.compression.ts";
import { EmbeddingsManager } from "./agent.embeddings.ts";

type SessionPayload = {
  message : string;
  history : Array<MessageContainer>;
  user    : UserMemoryDescriptor
};

export class Agent extends Kaya {

  static readonly LOCALE = ruLocale;
  static readonly MODEL = Deno.env.get("MODEL")!;
  static readonly PROXY = Deno.env.get("PROXY")!;
  static readonly OPENROUTER = Deno.env.get("OPENROUTER")!;
  static readonly OWNER = Deno.env.get("OWNER")!;
  static readonly OWTAG = Deno.env.get("OWNER_TAG")!;

  public logger = new SimpleLogger();
  public adapter = new DatabaseAdapter();
  public compressor = new HistoryCompressor(this);
  public embedder = new EmbeddingsManager(this);
  public memory = new Memory(this);
  public aggregator: Aggregator;

  constructor(integrations: Array<Integration>) {

    if ( !Agent.MODEL || !Agent.PROXY || !Agent.OWNER || !Agent.OWTAG || !Agent.OPENROUTER ) throw Error();

    super();

    this.aggregator = new Aggregator(this, integrations);

    const handler = async (message: string, contextKey: string, force: boolean) => {

      const noty = this.aggregator.notify("Собирает информацию", contextKey);

      const history = (message.includes("##CLN##") && (message = message.replace("##CLN##", "")))
        ? []
        : await this.adapter.getUserHistory(contextKey)
        ;

      noty.then(x => x.update("Думает о вмешательстве"));

      const intervention = force || await this.needIntervention(history);
      const directAsk = message.toLowerCase().includes("кая,");

      const user = await this.memory.invokeUser(contextKey, history);

      noty.then(x => x.update("Думает над ответом"));

      if ( force || directAsk || intervention ) {

        const res = await this.message({ history, message, user });

        noty.then(x => x.delete());

        return res;

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
        data: message.replaceAll("\'", "\""),
        from: contextKey,
        date: Date.now()
      });

    }

    for ( const x of integrations ) x.setMessageHandler(handler);

    this.adapter.onReady.then(() => { 
      this.aggregator.start();
    });

  }

  public async message({ history, message, user }: SessionPayload) {

    const response = await user.session.ask(message);

    if ( response instanceof Error ) return response.message;

    this.adapter.saveMessages(
      message.replaceAll(`'`, `"`),
      response.replaceAll(`'`, `"`),
      user.username,
    );

    if ( (user.interactions.messageCount += 2) % HistoryCompressor.COMPRESSION_RANGE === 0 ) {

      this.logger.log({ value: history, cnt: user.interactions.messageCount  }, "Chat compression");

      this.compressor.compress(user.username, history).then(x => 
        this.embedder.indexate(user.username, x)
      );

    }

    return response;

  }

}