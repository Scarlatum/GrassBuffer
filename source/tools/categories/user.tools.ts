import { CategoryTools } from "./base.ts";
import type { AnyFunction } from "~/shared.d.ts";

export class UserTools extends CategoryTools {
  public override readonly about =
    "Инструменты связанные с личной информацией собеседников";

  constructor(update: AnyFunction) {
    super([
      {
        name: "updateUserDescription",
        desc: "Если считаешь что нужно обновить описание собеседника по каким-то причинам",
        params: [
          {
            argument: "content",
            require: true,
            type: "string",
            desc: "Твоё описание собеседника, чтобы не забыть его",
          },
        ],
        mappedFunction: update,
      },
    ]);
  }
}