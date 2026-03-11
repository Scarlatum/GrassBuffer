import { CategoryTools } from "./base.ts";
import type { AnyFunction } from "~/shared.d.ts";

export class JournalTools extends CategoryTools {
  public override readonly about = "Создание заметок и их поиск по тегам";

  constructor( create: AnyFunction, find: AnyFunction, update: AnyFunction ) {
    super( [
      {
        name: "create",
        desc: "Если считаешь нужным, можешь создать заметку чтобы что-то не забыть. Постарайся сделать её достаточно объёмной (~2-4 абзаца)",
        params: [
          { type: "string", require: true, argument: "text" },
          { type: "string", require: true, argument: "description" },
          {
            type: "array",
            require: true,
            argument: "tags",
            subtype: { type: "string" },
          },
        ],
        mappedFunction: create,
      },
      {
        name: "update",
        desc: "Дополнить существующую заметку новым текстом. Используй path из результата find. Не перезаписывает — добавляет в конец",
        params: [
          { type: "string", require: true, argument: "path", desc: "Путь к файлу заметки" },
          { type: "string", require: true, argument: "text", desc: "Текст который будет добавлен в конец заметки" },
          {
            type: "array",
            require: false,
            argument: "tags",
            desc: "Обновить теги заметки если нужно",
            subtype: { type: "string" },
          },
        ],
        mappedFunction: update,
      },
      {
        name: "find",
        desc: "Поиск по журналам. Результат потом можешь прочитать с помощью readFiles через getTools с fs",
        params: [
          {
            type: "array",
            require: true,
            argument: "targets",
            subtype: { type: "string", desc: "Set * for any" },
          },
        ],
        mappedFunction: find,
      },
    ] );
  }
}