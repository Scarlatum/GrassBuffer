import { sleep } from "gramio";

import { Kaya } from "./kaya.ts"

import { Tools } from "./tools/tools.ts";
import { ChatChoice, ChatMessage, proxyRequest } from "./utils/common.ts";
import { SimpleLogger } from "./logger.ts";
import { DatabaseAdapter } from "./database.ts";
import { Integration } from "./interfaces/integration.ts";
import { Memory } from "./memory.ts";
import { GrassBot } from "./intergrations/telegram.ts";
import { MessageContainer } from "./shared.d.ts";
import { AgenticSession } from "./agent.session.ts";
import { HistoryCompressor } from "./agent.compression.ts";

export class Agent extends Kaya {

  static readonly MODEL = Deno.env.get("MODEL")!;
  static readonly PROXY = Deno.env.get("PROXY")!;
  static readonly OWNER = Deno.env.get("OWNER")!;
  static readonly OWTAG = Deno.env.get("OWNER_TAG")!;

  public logger = new SimpleLogger();
  public adapter = new DatabaseAdapter();
  public compressor = new HistoryCompressor(this.adapter);
  public memory = new Memory();

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

  private async inference(
    messages: Array<ChatChoice['message']>,
    tools: Tools,
  ): Promise<ChatChoice> {

    const payload = tools.belt.apply({
      model: Agent.MODEL!,
      messages: messages
    })

    const res = await proxyRequest(payload);

    if ( res instanceof Error ) {

      this.logger.log(res, "tool proxy error");

      return {
        finish_reason: "stop",
        message: {
          role: "tool",
          content: `Inference Error: ${ res.message }; cause: ${ res.cause };`
        }
      }

    };

    const [ choice ] = res.choices as Array<ChatChoice>;

    if ( "logprobs" in choice ) delete choice.logprobs;

    messages.push(choice.message);

    return choice;

  }

  private checkTooling<T extends ChatChoice>(choice: T) {

    const toolLen = choice.message.tool_calls?.length || 0;

    switch ( true ) {
      case choice.finish_reason === "tool_calls" || toolLen > 0: 
        return this.toolPass.bind(this);
      case Agent.inlineTool(choice.message.content):
        return this.inlineToolPass.bind(this);
    }
    
  }

  private async agenticStep(messages: Array<ChatMessage>, tools: Tools, step = { val: 0 }) {

    await sleep(2000);

    const ts = performance.now();

    const choice = await this.inference(messages, tools);

    switch ( true ) {
      case choice.finish_reason === "error":
        return Error(choice.message?.content || "Unknown error at inference");
      case !choice.message || typeof choice.message !== "object":
        return Error("Schema Error");
    }

    this.logger.log(choice.message, "agentic step result");

    const toolpass = this.checkTooling(choice);

    const result = toolpass
      ? await toolpass(choice.message, messages, tools, step)
      : String(choice.message.content);
      ;

    this.logger.log({ duration: performance.now() - ts, steps: step.val }, "agentic eval time");
    
    return result;

  }

  private async inlineToolPass<T extends ChatChoice['message']>(x: T, messages: Array<ChatMessage>, tools: Tools, step = { val: 0 }){

    if ( step.val++ >= 4 ) throw Error("RECURSIVE TOOLING");

    if ( !x.content ) return String();

    const beg = x.content.indexOf("{")
    const end = x.content.lastIndexOf("}");

    const json = JSON.parse(x.content.substring(beg,end + 1));
    const tool = `call_${ Math.random().toString(32).substring(-2) }`;

    this.logger.log(json, "parseTextTool parsed json");

    const mess = await tools.belt.route(
      name, 
      tool, 
      json.arguments
    );

    this.logger.log({ value: mess }, `toolbelt router reesult for: ${ name }`);

    messages.push(mess);
      
    const { message } = await this.inference(messages, tools);

    return String(message.content?.trim())

  }

  private async toolPass<T extends ChatChoice['message']>(x: T, messages: Array<ChatMessage>, tools: Tools, step = { val: 0 }): Promise<string | Error>  {

    if ( step.val++ >= 4 ) throw Error("RECURSIVE TOOLING");

    if ( !x.tool_calls ) return String(x.content);

    for ( const tool of x.tool_calls ) {

      if ( !tool['function'] ) continue;

      const mess = await tools.belt.route(
        tool.function.name, 
        tool.id, 
        JSON.parse(tool.function.arguments)
      );

      this.logger.log({ value: mess }, `toolbelt router reesult for: ${ tool.function.name }`);
      
      messages.push(mess);

    }

    return await this.agenticStep(messages, tools);
    
  }

  /** Запрос к LLM. Опционально createCompletion — для тестов (подмена вызова API). */
  public async ask(text: string, from: string, history: Array<MessageContainer> = []): Promise<string | Error> {

    const sys = { role: "system", content: Kaya.soul };

    const tools     = await this.sessionTools(from);
    const summaries = await this.adapter.getUserSummaries(from);

    if ( summaries.length > 0 ) {
      sys.content += "\n\nКраткое содержание предыдущих разговоров:\n" 
        + summaries
          .map(s => `[${ new Date(s.from).toLocaleDateString() }]: ${ s.content }`)
          .join("\n");
    }

    const messages = [
      sys,
      ...history.map((x) => ({
        content: x.data,
        role: Kaya.getRole(x.from),
      })),
      { role: Kaya.getRole(from), content: `${text}`, name: from },
    ] as Array<ChatMessage>;

    const session = new AgenticSession(tools, messages, this.logger);
    const res = await session.step();

    this.logger.log({ value: messages }, "messages");

    tools.belt.setDefault();

    return res;

  }

  public async message(message: string, from: string, history: Array<MessageContainer>) {

    let user = this.memory.user.get(from);

    if ( !user ) { 

      user ??= await this.memory.initUser(from, this);

    }

    const response = await this.ask(message, from, history);

    if ( response instanceof Error ) return response.message;

    this.adapter.saveMessages(
      message.replaceAll(`'`, `"`),
      response.replaceAll(`'`, `"`),
      from,
      from
    );

    if ( user && ++user.interactions.messageCount % HistoryCompressor.COMPRESSION_RANGE === 0 ) {
      this.compressor.compress(from, history); // не await — не блокируем ответ
    }

    return response;

  }

}