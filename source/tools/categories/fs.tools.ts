import { CategoryTools } from "./base.ts";
import type { AnyFunction } from "~/shared.d.ts";

export class FileSystemTools extends CategoryTools {
  public override readonly about = "Всё что нужно для работы с файловой системой";

  constructor(
    pickFileFunction: AnyFunction,
    writeFileFunction: AnyFunction,
    runPlaygroundFunction: AnyFunction
  ) {
    super({
      readFiles: {
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
      writeFile: {
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
      runPlayground: {
        desc: "Запустить TypeScript файл из playgrounds (таймаут 1 мин, один процесс)",
        params: [
          {
            type: "string",
            require: true,
            argument: "path",
            desc: "Относительный путь, напр. 'script.ts'",
          },
          {
            type: "array",
            require: false,
            argument: "args",
            subtype: { type: "string" },
            desc: "Аргументы командной строки",
          },
        ],
        mappedFunction: runPlaygroundFunction,
      },
      dir: {
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
    });
  }
}