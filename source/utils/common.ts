import { format, bold, join } from "gramio";
import { Agent } from "../agent.ts";

export type KayaSegment = { bold: boolean; text: string };

/** Опционально: подстановка вызова LLM для тестов. Если не передана — используется реальный client. */
export type CreateCompletion = (messages: unknown[]) => Promise<ChatChoice>;

export function tempDegradation(norm: number) {
  return Math.random() > (1.0 - Math.pow(Math.abs(Math.cos(Math.PI * norm)), 4));
}

/** Разбивает текст на сегменты по маркеру **жирный** (одиночный * в тексте заменяется на **). Чистая функция для тестов. */
export function parseKayaBoldSegments(message: string): KayaSegment[] {
  const out: KayaSegment[] = [];
  let form = false;
  let strBuffer = "";

  const s = message.replaceAll("*", "**");

  for (let i = 0; i < s.length; i++) {
    const old: boolean = form;

    if (s[i] === "*" && s[i + 1] === "*") {
      i++;
      form = !form;
      if (old !== form && strBuffer.length > 0) {
        out.push({ bold: old, text: strBuffer });
        strBuffer = "";
      }
      continue;
    }
    if (s[i] === "*" && s[i - 1] === "*") continue;

    if (old !== form && strBuffer.length > 0) {
      out.push({ bold: old, text: strBuffer });
      strBuffer = "";
    }
    strBuffer += s[i];
  }

  if (strBuffer.length > 0) {
    out.push({ bold: form, text: strBuffer });
  }

  return out;
}

/** Форматирует ответ Каи для Telegram: **текст** → жирный. */
export function formatKayaMessage(message: string) {
  const segments = parseKayaBoldSegments(message);
  const res = segments.map((seg) =>
    [seg.bold ? bold : format, seg.text] as const
  );
  return format`${join(res, (x) => x[0]`${x[1]}`, "")}`;
}

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });

/** Форматирует timestamp (ms) в относительное время на русском для подписи к сообщению. */
export function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return rtf.format(-diffSec, "second");
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  if (diffHour < 24) return rtf.format(-diffHour, "hour");
  return rtf.format(-diffDay, "day");
}

export async function proxyRequest(body: object) {

  const res = await fetch(Agent.PROXY!, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "text/plain" }
  })

  if ( res.status !== 200 ) return Error("Inference proxy error", {
    cause: await res.text()
  });

  let data: object;

  try { data = res.json() } catch(e) {
    return e as Error;
  }

  return data as Record<string, object>

}

export type ChatMessage = {
  role: "user" | "assistant" | "tool", 
  content: string | null,
  reasoning_content?: string, 
  tool_calls?: Array<{ 
    id: string, 
    function?: { 
      name: string, 
      arguments: string 
    } 
  }> 
}

export type ChatChoice = {
  message: ChatMessage;
  finish_reason: string;
};