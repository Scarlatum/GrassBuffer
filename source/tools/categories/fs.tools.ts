import { CategoryTools } from "./base.ts";
import type { AnyFunction } from "~/shared.d.ts";

export class FileSystemTools extends CategoryTools {

  static allowedDirs = [ "journal", "logs", "playgrounds" ];

  public override readonly about = "Всё что нужно для работы с файловой системой";

  constructor(
    read: AnyFunction,
    write: AnyFunction,
    exec: AnyFunction
  ) {
    super({
      readFiles: {
        desc: "Прочитать содержимое файлов",
        params: [
          {
            type: "array",
            require: true,
            argument: "data",
            subtype: { type: "string" },
          }
        ],
        mappedFunction: read,
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
        mappedFunction: write,
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
        mappedFunction: exec,
      },
      dir: {
        desc: "Содержимое папок journal, logs и playgrounds",
        params: [
          {
            type: "string",
            require: true,
            argument: "includes",
            desc: "Фильтрация по папкам",
            enum: FileSystemTools.allowedDirs,
          },
        ],
        mappedFunction: async function (params: { includes: string }) {

          const paths: string[] = [];

          const processDir = async (path: string) => {

            for await (const entry of Deno.readDir(path)) {

              const x = path + "/" + entry.name;

              if (entry.isFile && x.includes(params.includes)) paths.push(x);

              else await processDir(x);

            }
          };

          const [ dir ] = FileSystemTools
            .allowedDirs
            .filter(x => x.includes(params.includes));

          if ( dir ) { 
            try {

              const stat = await Deno.stat(dir);

              if ( stat.isFile ) return dir;

              else if ( stat.isDirectory ) return processDir(dir);

            } catch(e) { return (e as Error).message };
          }

          else await Promise.all(FileSystemTools.allowedDirs.map(x => processDir(`./${ x }`)))

          return paths;
          
        },
      },
    });
  }
}