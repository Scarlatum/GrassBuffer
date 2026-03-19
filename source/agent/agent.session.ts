import { sleep } from "gramio";
import { Tools } from "../tools/tools.ts";
import { ChatChoice, ChatMessage, proxyRequest } from "../utils/common.ts";
import { Agent } from "./agent.ts";
import { MessageContainer } from "../shared.d.ts";
import { Kaya } from "../kaya.ts";
import { HistoryCompressor } from "./agent.compression.ts";
import { InferencePayload, Toolbelt } from "../tools/toolbelt.ts";

export class AgenticSession {

  static ESTIMATE_TPR = 3000;
  static TPM_LIMIT = parseInt(Deno.env.get("TPM") || "6000")
  static stepCooldown = parseInt(Deno.env.get("STEP_COOLDOWN") || "2000");
  private tools: Tools;
  private currentTPM = 0;
  private cooldown = Promise.withResolvers();
  private inferencePayload: InferencePayload;

  private readonly messages = Array<ChatMessage>(HistoryCompressor.COMPRESSION_RANGE + 1);

  private soul = Kaya.soul;
  private warn = Toolbelt.TOOLS_INSTRUCTIONS;
  private info = "";

  constructor(
    private ctx: Agent,
    private username: string,
    private createCompletion: (payload: object, key?: string) => Promise<Record<string, object> | Error> = proxyRequest
  ) {

    this.tools = new Tools(ctx);

    this.inferencePayload = Object();

    setInterval(() => {
      this.cooldown.resolve(0);
      this.currentTPM = 0;
      this.cooldown = Promise.withResolvers();
    }, 85_000);

  }

  public set history(messages: Array<MessageContainer>) {

    if ( messages.length === 0 ) return;

    const len = this.messages.length;

    this.messages[0];
    
    let ptr = 0;

    for ( let i = 1; i < len; i++ ) {

      const x = messages[ptr++];

      this.messages[ len - i ] = {
        role: Kaya.getRole(x.from),
        content: x.data
      };

    }

  }

  public appendMessage(x: ChatMessage) {

    for ( let i = 1; i < this.messages.length; i++ ) {

      const next = this.messages[i + 1];

      if ( next ) this.messages[i] = next;
      
    }

    this.messages[this.messages.length - 1] = x;

  }

  private async getRelevantSummaries(
    uid: string,
    query: string
  ): Promise<string> {

    const results = await this.ctx.embedder.search(uid, query);

    if (results.length === 0) return "";

    const frags = results
      .map(r =>`[${new Date(r.from).toLocaleDateString()}]: ${r.content}`)
      .join("\n");

    return "\n\nРелевантные фрагменты из предыдущих разговоров:\n" + frags;
    
  }

  private async updateSystemPrompt() {

    const last = this.messages.at(-1);

    if ( !last?.content ) return;

    const summary = await this.getRelevantSummaries(this.username, last.content);

    if ( summary ) this.info += summary;

    this.messages[0] = {
      role: "system",
      content: this.soul
        + "\n\n" + this.info
        + "\n\n" + this.warn
        + "\n\n" + `Дата: ${ new Date().toLocaleDateString() }`
    }

  }

  private pruneMessages(keepToolMessages = 3) {

    let toolCount = 0;

    for (let i = this.messages.length - 1; i > 0; i--) {

      const x = this.messages[i];

      if (( x.role === "tool" || x.tool_calls ) && ++toolCount > keepToolMessages ) {
        x.content = "[ Данные удалены во имя экономии контекста ]";
      }

      if ( "reasoning" in x && (this.messages.length - i > 1) ) {
        delete (x as Record<string, unknown>)["reasoning"];
      }

    }

  }

  public async ask(query: string) {

    this.messages[this.messages.length - 1] = { 
      role: Kaya.getRole(this.username), 
      content: query,
    };

    await this.updateSystemPrompt();

    this.inferencePayload = this.tools.belt.apply({
      model: Agent.MODEL!,
      messages: this.messages,
    });

    return await this.step();

  }

  private async step(counter = { val: 0 }): Promise<string | Error> {

    this.pruneMessages();

    const cooldown = AgenticSession.stepCooldown * counter.val;

    if ( cooldown ) this.ctx.aggregator.notify(`Следующий вызов инструмента через ${ cooldown / 1000 } сек.`, this.username);

    await sleep(cooldown);

    const inferenceResult = await this.inference();

    if ( inferenceResult instanceof Error ) {
      return await this.onInferenceError(inferenceResult);
    }

    switch (true) {
      case inferenceResult.finish_reason === "error":
        return Error(inferenceResult.message?.content || "Unknown error at inference");
      case !inferenceResult.message || typeof inferenceResult.message !== "object":
        return Error("Schema Error");
    }

    this.ctx.logger.log(inferenceResult.message, "agentic step result");

    const toolpass = this.checkTooling(inferenceResult);

    const result = toolpass
      ? await toolpass(inferenceResult.message, counter)
      : String(inferenceResult.message.content);

    return result;

  }

  private async inference(): Promise<ChatChoice | Error> {

    this.inferencePayload.tools = this.tools.belt.currentSet.tools;

    if ( this.currentTPM >= AgenticSession.TPM_LIMIT ) {

      const noty = this.ctx.aggregator.notify(`Аппарат перегрет ♨️`, this.username);

      await this.cooldown.promise

      noty.then(x => x.update(`Аппарат стабилен 🧪`))

    }

    const res = await this.createCompletion(this.inferencePayload);

    if (res instanceof Error) return res;

    if ( res?.usage && "total_tokens" in res.usage && typeof res.usage.total_tokens === "number" ) {
      this.currentTPM += res.usage.total_tokens
    } else {
      this.currentTPM += AgenticSession.ESTIMATE_TPR;
    }

    const [choice] = res.choices as Array<ChatChoice>;

    if ("logprobs" in choice) delete choice.logprobs;

    this.appendMessage(choice.message);

    return choice;

  }

  private checkTooling(choice: ChatChoice) {

    const toolLen = choice.message.tool_calls?.length || 0;

    switch (true) {
      case choice.finish_reason === "tool_calls" || toolLen > 0:
        return this.toolPass.bind(this);
      case choice.message.content?.includes("<tool_call>"):
      case choice.message.content?.includes("```json"):
        return this.inlineToolPass.bind(this);
    }

  }

  private async toolPass(x: ChatChoice["message"], counter = { val: 0 }): Promise<string | Error> {

    if (counter.val++ >= 12) throw Error("RECURSIVE TOOLING");

    if (!x.tool_calls) return String(x.content);

    for (const tool of x.tool_calls) {

      if (!tool["function"]) continue;

      this.ctx.aggregator.notify(
        `Кая Использует инструмент ${ tool.function.name };\nАргументы вызова: ${ tool.function.arguments }`, 
        this.username
      );

      const mess = await this.tools.belt.route(
        tool.function.name,
        tool.id,
        JSON.parse(tool.function.arguments),
      );


      this.ctx.logger.log({ value: mess }, `toolbelt router result for: ${tool.function.name}`);

      this.appendMessage(mess);

    }

    return await this.step(counter);

  }

  private async onInferenceError(err: Error) {

    this.appendMessage({
      role: "tool",
      'tool_call_id': "custom",
      content: `Inference Error: ${ err.message }; cause: ${ err.cause };`,
    });

    const aboutError = await this.inference();

    if ( aboutError instanceof Error ) {

      this.ctx.logger.log({ 
        error: aboutError,
        messages: this.messages,
      }, "FATAL PANIC!");

      this.ctx.aggregator.notify(`FATAL PANIC ON TOOL PASS:\n${ aboutError }\n\n`, this.username);

      throw aboutError;

    }

    return String(aboutError.message.content?.trim());

  }

  private async inlineToolPass(x: ChatChoice["message"], counter = { val: 0 }): Promise<string> {

    if (counter.val++ >= 12) throw Error("RECURSIVE TOOLING");

    if (!x.content) return String();

    const beg = x.content.indexOf("{");
    const end = x.content.lastIndexOf("}");

    if (beg === -1 || end === -1 || end <= beg) {
      return "Ошибка: не найден валидный JSON в ответе модели";
    }

    let json: { name?: string; arguments?: unknown };
    
    try {
      json = JSON.parse(x.content.substring(beg, end + 1));
    } catch (e) {
      this.ctx.logger.log({ content: x.content, error: e }, "Failed to parse inline tool JSON");
      return `Ошибка парсинга JSON: ${(e as Error).message}. Содержимое: ${x.content.substring(beg, end + 1)}`;
    }

    if (!json?.name) {
      return "Ошибка: в JSON нет поля 'name' с названием инструмента";
    }

    const toolId = `call_${Math.random().toString(32).substring(-2)}`;

    this.ctx.logger.log(json, "parseTextTool parsed json");

    const mess = await this.tools.belt.route(
      json.name,
      toolId,
      json.arguments ?? {},
    );

    this.ctx.logger.log({ value: mess }, `toolbelt router result for: ${json.name}`);

    this.appendMessage(mess);

    const inferenceResult = await this.inference();

    return inferenceResult instanceof Error
      ? await this.onInferenceError(inferenceResult)
      : String(inferenceResult.message.content?.trim())
      ;

  }

}
