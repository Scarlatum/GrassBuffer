// deno-lint-ignore-file no-explicit-any require-await
import { assertEquals, assertExists } from "@std/assert";
import { makeMockAdapter } from "./helpers/helpers.ts";
import { HistoryCompressor } from "../source/agent/agent.compression.ts";

const mockProxyRequest = async (payload: any) => {
  const lastMessage = payload.messages.at(-1)?.content ?? "";

  if (lastMessage.includes("[0]") || lastMessage.includes("[")) {
    return {
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "[0, 5, 12]" },
      }],
    };
  }

  return {
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content: "Обсудили погоду и договорились погулять." },
    }],
  };
};

Deno.test("HistoryCompressor: COMPRESSION_RANGE по умолчанию 20", () => {
  assertEquals(HistoryCompressor.COMPRESSION_RANGE, 20);
});

Deno.test("HistoryCompressor: создаётся с адаптером", () => {
  const adapter = makeMockAdapter();
  const compressor = new HistoryCompressor(adapter);
  assertExists(compressor);
});

Deno.test("compress: возвращает пустой массив при пустой истории", async () => {
  const adapter = makeMockAdapter();
  const compressor = new HistoryCompressor(adapter, mockProxyRequest);
  
  const result = await compressor.compress("test_user", []);
  
  assertEquals(result, []);
});

Deno.test("compress: сегментирует историю и создаёт summaries", async () => {
  const adapter = makeMockAdapter();
  const compressor = new HistoryCompressor(adapter, mockProxyRequest);

  const history = Array.from({ length: 15 }, (_, i) => ({
    from: `user${i}`,
    data: `Message ${i}`,
    date: Date.now() + i * 1000,
  })) as any;

  const result = await compressor.compress("test_user", history);

  assertEquals(result.length > 0, true);
  for (const summary of result) {
    assertExists(summary.from);
    assertExists(summary.to);
    assertExists(summary.content);
  }
});
