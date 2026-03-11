// tools/categories/fs.tools.ts
import { CategoryTools } from "./base.ts";
import type { AnyFunction } from "../../shared.ts";

export class FileSystemTools extends CategoryTools {
  public override readonly about = "Всё что нужно для работы с файловой системой";

  constructor(pickFileFunction: AnyFunction) {
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
        name: "dir",
        desc: "Содержимое папок journal и logs",
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

          return list;
        },
      },
    ]);
  }
}