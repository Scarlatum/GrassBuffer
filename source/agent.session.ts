import { sleep } from "gramio";
import { Tools } from "./tools/tools.ts";
import { ChatChoice, ChatMessage, proxyRequest } from "./utils/common.ts";
import { SimpleLogger } from "./logger.ts";
import { Agent } from "./agent.ts";

export class AgenticSession {

  static stepCooldown = parseInt(Deno.env.get("STEP_COOLDOWN") || "2000");

  constructor(
    private tools: Tools,
    private messages: ChatMessage[],
    private logger: SimpleLogger,
    private createCompletion: (payload: object) => Promise<Record<string, object> | Error> = proxyRequest
  ) {}

  public async step(counter = { val: 0 }): Promise<string | Error> {

    await sleep(AgenticSession.stepCooldown);

    const ts = performance.now();
    const choice = await this.inference();

    switch (true) {
      case choice.finish_reason === "error":
        return Error(choice.message?.content || "Unknown error at inference");
      case !choice.message || typeof choice.message !== "object":
        return Error("Schema Error");
    }

    this.logger.log(choice.message, "agentic step result");

    const toolpass = this.checkTooling(choice);

    const result = toolpass
      ? await toolpass(choice.message, counter)
      : String(choice.message.content);

    this.logger.log({ duration: performance.now() - ts, steps: counter.val }, "agentic eval time");

    return result;

  }

  private async inference(): Promise<ChatChoice> {

    const payload = this.tools.belt.apply({
      model: Agent.MODEL!,
      messages: this.messages,
    });

    const res = await this.createCompletion(payload);

    if (res instanceof Error) {
      this.logger.log(res, "tool proxy error");
      return {
        finish_reason: "stop",
        message: {
          role: "tool",
          content: `Inference Error: ${res.message}; cause: ${res.cause};`,
        },
      };
    }

    const [choice] = res.choices as Array<ChatChoice>;

    if ("logprobs" in choice) delete choice.logprobs;

    this.messages.push(choice.message);

    return choice;

  }

  private checkTooling(choice: ChatChoice) {
    const toolLen = choice.message.tool_calls?.length || 0;

    switch (true) {
      case choice.finish_reason === "tool_calls" || toolLen > 0:
        return this.toolPass.bind(this);
      case Agent.inlineTool(choice.message.content):
        return this.inlineToolPass.bind(this);
    }
  }

  private async toolPass(x: ChatChoice["message"], counter = { val: 0 }): Promise<string | Error> {

    if (counter.val++ >= 4) throw Error("RECURSIVE TOOLING");

    if (!x.tool_calls) return String(x.content);

    for (const tool of x.tool_calls) {

      if (!tool["function"]) continue;

      const mess = await this.tools.belt.route(
        tool.function.name,
        tool.id,
        JSON.parse(tool.function.arguments),
      );

      this.logger.log({ value: mess }, `toolbelt router result for: ${tool.function.name}`);

      this.messages.push(mess);

    }

    return await this.step(counter);

  }

  private async inlineToolPass(x: ChatChoice["message"], counter = { val: 0 }): Promise<string> {

    if (counter.val++ >= 4) throw Error("RECURSIVE TOOLING");

    if (!x.content) return String();

    const beg = x.content.indexOf("{");
    const end = x.content.lastIndexOf("}");

    const json = JSON.parse(x.content.substring(beg, end + 1));
    const toolId = `call_${Math.random().toString(32).substring(-2)}`;

    this.logger.log(json, "parseTextTool parsed json");

    const mess = await this.tools.belt.route(
      json.name,        // ← в оригинале был баг: передавался `name` вместо имени инструмента
      toolId,
      json.arguments,
    );

    this.logger.log({ value: mess }, `toolbelt router result for: ${json.name}`);

    this.messages.push(mess);

    const { message } = await this.inference();

    return String(message.content?.trim());

  }

}