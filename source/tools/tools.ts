import { Agent } from "../agent.ts";
import { Kaya } from "../kaya.ts";
import { FileSystemTools } from "./categories/fs.tools.ts";
import { JournalTools } from "./categories/journal.tool.ts";
import { ScheduleTools } from "./categories/schedule.tools.ts";
import { UserTools } from "./categories/user.tools.ts";
import { Toolbelt } from "./toolbelt.ts";
import { Runner } from "../runner.ts";
import { BASE_PATH } from "../utils/paths.ts";
import z from "zod";

const shared = z.object({
  info: z.string(),
  from: z.enum(["writeFile", "readFiles", "runPlayground"]),
});

const outSchemas = {
  writeFile: shared.extend({
    data: z.object({
      path: z.string(),
      args: z.array(z.string())
    })
  }),
  readFiles: shared.extend({
    data: z.array(z.string())
  })
} as const;

type ToolResultContainer = z.infer<typeof shared> & { data: unknown };

export class Tools {

  static journalSession = `${ Date.now() }_${ Math.random().toString(32).substring(2) }`
  static counter = 0;

  public belt
  private runner = new Runner();

  constructor(private agent: Agent) {

    this.belt = new Toolbelt([
      new JournalTools(
        this.create.bind(this), 
        this.find.bind(this),
        this.update.bind(this),
      ),
      new FileSystemTools(
        this.readFiles.bind(this),
        this.writeFile.bind(this),
        this.runPlayground.bind(this)
      ),
      new ScheduleTools(
        this.messageReminder.bind(this)
      ),
      new UserTools(
        this.updateUserDescription.bind(this)
      ),
    ]);

  }

  private async updateUserDescription(payload: { content: string }) {
    await this.agent.adapter.updateUserHistory(Agent.OWTAG, payload.content);
  }

  private async create(payload: { text: string, description: string, tags: string[] }) {
    
    if ( Tools.counter === 0 ) Deno.mkdirSync(`${BASE_PATH}/journal/${ Tools.journalSession }`);

    const path = `${BASE_PATH}/journal/${ Tools.journalSession }/${ String(Tools.counter++).padStart(3,"0") }.md`;

    await Deno.writeTextFile(path, payload.text);
    await this.agent.adapter.db.query(`

      BEGIN TRANSACTION;

      CREATE journal CONTENT {
        path: $path,
        description: $description,
        tags: $tags
      };

      COMMIT TRANSACTION;

    `, {
      path,
      description: payload.description,
      tags: payload.tags?.join(",") || "",
    });

    return `jounrnal on path ${ path } was updated`

  }

  private async messageReminder(payload: { timeout: number, message: string }) {

    this.agent.logger.log(payload, "Schedule a message");

    const date  = Date.now();
    const key   = date + payload.timeout;

    await Kaya.kv.enqueue(payload.message, { delay: payload.timeout });

    return `Готово! Сообщение будет вызвано в ${ new Date(key) }`

  }

  private async find(payload: { targets: Array<string> }) {

    const query = payload.targets.length === 1 && payload.targets[0] === "*" 
      ? `return select description,path from journal`
      : `return select description,path from journal where ${JSON.stringify(payload.targets)}.map(|$x| $x in tags)[? $this]`

    this.agent.logger.log({ query }, `findJournalData query`);

    const result = await this.agent.adapter.db.query(`
      BEGIN TRANSACTION;
      ${ query };
      COMMIT TRANSACTION;
    `).then(x => x[0]);

    this.agent.logger.log({ result }, `findJournalData result`);

    return result || [];

  }

  private async update(payload: { path: string, text: string, tags?: string[] }) {

    try {
      await Deno.stat(payload.path);
    } catch {
      return `Файл ${ payload.path } не найден`;
    }

    await Deno.writeTextFile(payload.path, "\n\n" + payload.text, { append: true });

    if ( payload.tags ) {
      await this.agent.adapter.db.query(`
        BEGIN TRANSACTION;
        UPDATE journal SET tags = $tags WHERE path = $path;
        COMMIT TRANSACTION;
      `, {
        path: payload.path,
        tags: payload.tags.join(","),
      });
    }

    return `Journal on path ${ payload.path } was appended`;

  }

  private async writeFile(payload: { path: string, content: string }): Promise<string | ToolResultContainer> {

    if (!payload?.path) {
      return "Ошибка: не указан путь к файлу. Пример: writeFile с аргументом path='utils/helper.ts'";
    }
    if (!payload?.content) {
      return "Ошибка: не указано содержимое файла. Пример: writeFile с аргументом content='console.log(1)'";
    }
    
    const normalizedPath = payload.path.replace(/^[\\/]/, "");
    const fullPath = `./playgrounds/${normalizedPath}`;
    
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(fullPath, payload.content);

    return JSON.stringify({
      info: "Файл записан",
      from: "writeFile",
      data: {
        path: fullPath,
        args: []
      }
    } satisfies ToolResultContainer);

  }

  private async runPlayground(payload: unknown): Promise<string | ToolResultContainer> {

    const pack = (data: string) => JSON.stringify({
      from: "runPlayground",
      info: "Результат исполенения файла или файлов",
      data,
    } satisfies ToolResultContainer)

    { // ? Process payload when it already structured as valid object that come someelse that pipeline

      if ( payload && typeof payload === "object" && "path" in payload ) {

        const sch = await z.object({
          path: z.string(),
          args: z.array(z.string()).optional()
        }).safeParseAsync(payload);

        if ( sch.error ) return sch.error.message;

        return pack(Runner.fmt(await this.runner.run(sch.data.path, sch.data.args)))

      }

      else if ( typeof payload !== "string" ) return "Broken payload";

    }

    const json = JSON.parse(String(payload)); 
    const meta = await shared.safeParseAsync(json);

    if ( meta.error ) return meta.error.message;

    { // ? Process payload from different entrypoints

      switch ( meta.data.from ) {
        case "writeFile": {

          const { data, error } = await outSchemas.writeFile.safeParseAsync(json);

          if ( error ) return error.message;

					// console.log("Parsed schema of writeFile: ", data.data);

          return pack(Runner.fmt(await this.runner.run(data.data.path, data.data.args)));

        };
        case "readFiles": {

          const schema = await outSchemas.readFiles.safeParseAsync(json);

          if ( schema.error ) return schema.error.message;

          const results = Array<string>();

          for ( const path of schema.data.data ) {
            results.push(`Инпут файла ${
              Runner.fmt(await this.runner.run(path))
            }`)
          }

          return pack(results.join("\n"));

        };
        default:
          return pack("undefined")
      }


    }

  }

  private async readFiles(payload: { data: Array<string> }): Promise<string> {

		const data = Array<string>();

		for ( const path of payload.data ) {
			
			this.agent.logger.log({ value: path }, "Кая пытается прочитать файл");

			try {
				data.push(`${ path }: ${ await Deno.readTextFile(path) }`);
			} catch(e) {

				this.agent.logger.log({ error: e }, "Ошибка чтения файла");

        if ( payload.data.length === 1 ) return JSON.stringify({
          info: `Ошибка чтения файла ${ path }. Ошибка: ${ (e as Error).message }`,
          from: "readFiles",
          data: null,
        })

			}

		}

    return JSON.stringify({
      info: "Файлы прочитаны",
      from: "readFiles",
      data: data,
    } satisfies ToolResultContainer);

  }

}
