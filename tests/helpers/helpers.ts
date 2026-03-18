// deno-lint-ignore-file no-explicit-any require-await

import { ChatChoice, ChatMessage } from "~/utils/common.ts";
import { Toolbelt, ToolSet } from "../../source/tools/toolbelt.ts";

export function makeLogger() {
  return { log: () => {} } as any;
}

export function makeTools() {
  return {
    belt: {
      apply: (x: any) => x,
      setDefault: () => {},
      route: async (_tool: string, id: string, _args: any) => ({
        role: "tool" as const,
        tool_call_id: id,
        content: JSON.stringify({ ok: true }),
      }),
    },
  } as any;
}

export function makeMessages(): ChatMessage[] {
  return [{ role: "system", content: "you are kaya" }];
}

export function mockCompletion(choice: Partial<ChatChoice["message"]> & { finish_reason?: string }) {
  return async (_payload: object) => ({
    choices: [{
      finish_reason: choice.finish_reason ?? "stop",
      message: {
        role: choice.role ?? "assistant",
        content: choice.content ?? null,
        tool_calls: choice.tool_calls,
        tool_call_id: "",
      },
    }],
  });
}

export function makeCategory(name: string, fns: Record<string, (x: any) => any>) {
  const descriptors = Object.entries(fns).reduce((acc, [fnName, fn]) => {
    acc[fnName] = {
      mappedFunction: fn,
      params: [{ argument: "input", type: "string", require: true }],
    };
    return acc;
  }, {} as Record<string, any>);

  const set = new ToolSet(descriptors);

  return {
    constructor: { name },
    about: `Test category ${name}`,
    set,
  } as any;
}

export function makeToolbelt() {
  const double = (x: { input: number }) => x.input * 2;
  const stringify = (x: number) => String(x);

  const cat = makeCategory("TestTools", { double, stringify });

  return { belt: new Toolbelt([cat]), double, stringify };
}

export function makeMockAdapter() {
  return {
    db: {
      query: async () => [undefined],
      queryRaw: async () => [undefined],
    },
  } as any;
}

export function makeMockProxyRequest(response: ChatChoice["message"] | Error) {
  return async (_payload: object) => {
    if (response instanceof Error) {
      throw response;
    }
    return {
      choices: [{
        finish_reason: "stop",
        message: response,
      }],
    };
  };
}