import { CategoryTools } from "./base.ts";
import type { AnyFunction } from "~/shared.d.ts";

export class ScheduleTools extends CategoryTools {
  public override readonly about = "Инструменты для отложенных действий (сообщений или напоминаний)";

  constructor(reminder: AnyFunction) {
    super([
      {
        name: "message",
        desc: "Отложить сообщение на некоторое время",
        params: [
          { type: "number", require: true, argument: "timeout" },
          { type: "string", require: true, argument: "message" },
        ],
        mappedFunction: reminder,
      },
    ]);
  }
}