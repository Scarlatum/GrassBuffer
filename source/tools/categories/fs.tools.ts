import { CategoryTools } from "./base.ts";
import type { AnyFunction } from "~/shared.d.ts";

export class FileSystemTools extends CategoryTools {
  public override readonly about = "Всё что нужно для работы с файловой системой";

  constructor(
    pickFileFunction: AnyFunction,
    writeFileFunction: AnyFunction
  ) {
    super([
      {
        name: "readFiles",
        desc: "Прочитать содержимое файлов",
        params: [
          {
            type: "array",
            require: true,
            argument: "paths",
            subtype: { type: "string" },
          },
        ],
        mappedFunction: pickFileFunction,
      },
      {
        name: "writeFile",
        desc: "Записать TypeScript файл в папку playgrounds",
        params: [
          {
            type: "string",
            require: true,
            argument: "path",
            desc: "Относительный путь внутри playgrounds, напр. 'utils/helper.ts'",
          },
          {
            type: "string",
            require: true,
            argument: "content",
            desc: "Содержимое файла",
          },
        ],
        mappedFunction: writeFileFunction,
      },
      {
        name: "dir",
        desc: "Содержимое папок journal, logs и playgrounds",
        params: [],
        mappedFunction: async function () {
          const list: string[] = [];

          const processDir = async (path: string) => {
            for await (const entry of Deno.readDir(path)) {
              const x = path + "/" + entry.name;

              if (entry.isFile) list.push(x);
              else await processDir(x);
            }
          };

          await processDir("./journal");
          await processDir("./logs");
          await processDir("./playgrounds");

          return list;
        },
      },
    ]);
  }
}