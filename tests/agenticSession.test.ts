// deno-lint-ignore-file require-await

import { assertEquals } from "@std/assert";
import { AgenticSession } from "../source/agent.session.ts";
import { makeLogger, makeMessages, makeTools, mockCompletion } from "./helpers.ts";

AgenticSession.stepCooldown = 0;

// --- Tests ---

Deno.test("step: возвращает текст при finish_reason=stop", async () => {
  const session = new AgenticSession(
    makeTools(),
    makeMessages(),
    makeLogger(),
    mockCompletion({ content: "Привет!", finish_reason: "stop" }),
  );

  const result = await session.step();

  assertEquals(result, "Привет!");
});

Deno.test("step: возвращает Error при finish_reason=error", async () => {
  const session = new AgenticSession(
    makeTools(),
    makeMessages(),
    makeLogger(),
    mockCompletion({ content: "что-то сломалось", finish_reason: "error" }),
  );

  const result = await session.step();
  
  assertEquals(result instanceof Error, true);
  assertEquals((result as Error).message, "что-то сломалось");

});

Deno.test("step: вызывает tool и возвращает финальный текст", async () => {

  let callCount = 0;

  const completion = async (_payload: object): Promise<Record<string, object>> => {
    callCount++;
    if (callCount === 1) {
      return {
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_call_id: "",
            tool_calls: [{ id: "call_1", function: { name: "pipeline", arguments: JSON.stringify({ functions: ["someFunc"], payload: {} }) } }],
          },
        }],
      };
    }
    return {
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "готово", tool_call_id: "", tool_calls: undefined },
      }],
    };
  };

  const session = new AgenticSession(
    makeTools(),
    makeMessages(),
    makeLogger(),
    completion,
  );

  const result = await session.step();

  assertEquals(result, "готово");
  assertEquals(callCount, 2);
});

Deno.test("step: бросает ошибку при превышении лимита рекурсии", async () => {

  // Каждый раз возвращает tool_calls — бесконечная рекурсия
  const completion = async (_payload: object): Promise<Record<string, object>> => ({
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_call_id: "",
        tool_calls: [{ id: "call_x", function: { name: "pipeline", arguments: JSON.stringify({ functions: ["f"], payload: {} }) } }],
      },
    }],
  });

  const session = new AgenticSession(
    makeTools(),
    makeMessages(),
    makeLogger(),
    completion,
  );

  try {
    await session.step();
    throw new Error("Должно было бросить исключение");
  } catch (e) {
    assertEquals((e as Error).message, "RECURSIVE TOOLING");
  }
});

Deno.test("step: обрабатывает inline tool (Qwen-стиль)", async () => {

  let callCount = 0;

  const completion = async (_payload: object): Promise<Record<string, object>> => {
    callCount++;
    if (callCount === 1) {
      return {
        choices: [{
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: '```json\n{ "name": "pipeline", "arguments": { "functions": ["f"], "payload": {} } }\n```',
            tool_call_id: "",
          },
        }],
      };
    }
    return {
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "inline ок", tool_call_id: "" },
      }],
    };
  };

  const session = new AgenticSession(
    makeTools(),
    makeMessages(),
    makeLogger(),
    completion,
  );

  const result = await session.step();

  assertEquals(result, "inline ок");
  assertEquals(callCount, 2);
});