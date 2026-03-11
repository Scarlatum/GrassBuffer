// deno-lint-ignore-file no-explicit-any require-await

import { ChatChoice, ChatMessage } from "~/utils/common.ts";

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