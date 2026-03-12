import { Agent } from "../agent.ts";
import { Kaya } from "../kaya.ts";
import { FileSystemTools } from "./categories/fs.tools.ts";
import { JournalTools } from "./categories/journal.tool.ts";
import { ScheduleTools } from "./categories/schedule.tools.ts";
import { UserTools } from "./categories/user.tools.ts";
import { Toolbelt } from "./toolbelt.ts";
import { Runner } from "../playground/runner.ts";
import z from "zod";

const shared = z.object({
  info: z.string(),
  from: z.enum(["writeFile", "readFiles", "runPlayground"]),
});

export const readFilesResultSchema = shared.extend({
  data: z.array(z.string())
});

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
    
    if ( Tools.counter === 0 ) Deno.mkdirSync(`./journal/${ Tools.journalSession }`);

    const path = `./journal/${ Tools.journalSession }/${ String(Tools.counter++).padStart(3,"0") }.md`;

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
      tags: payload.tags.join(","),
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
        path: normalizedPath,
        args: []
      }
    } satisfies ToolResultContainer);

  }

  private async runPlayground(payload: unknown): Promise<string | ToolResultContainer> {

    let json: unknown;

    try {

      json = JSON.parse(String(payload));

    } catch(e) {

      return (e as Error).message;

    }

    const meta = await shared.safeParseAsync(json);

    if ( meta.error ) return meta.error.message;

    const container = {
      from: "runPlayground",
      info: "Результат исполенения файла или файлов"
    } satisfies z.infer<typeof shared>;

    const fn = async (path: string, args: string[] = []) => {
      const run = await this.runner.run(path, args);

      return run.timedOut
        ? `Таймаут (60 сек).\n stdout: ${ run.stdout }\n stderr: ${ run.stderr }`
        : `Код завершения: ${ run.exitCode }; \nstdout: ${ run.stdout }; \nstderr: ${ run.stderr }`
        ;
    }

    let result: null | ToolResultContainer = null

    switch ( meta.data.from ) {
      case "writeFile": {

        const { data, error } = await shared.extend({
          data: z.object({
            path: z.string(),
            args: z.array(z.string())
          })
        }).safeParseAsync(json);

        if ( error ) return error.message;

        result = Object.assign(container, {
          data: await fn(data.data.path, data.data.args)
        })

      }; break;
      case "readFiles": {

        const schema = await readFilesResultSchema.safeParseAsync(json);

        if ( schema.error ) return schema.error.message;

        const results = Array<string>();

        for ( const path of schema.data.data ) {
          results.push(`Инпут файла ${ await fn(path) }`)
        }

        result = Object.assign(container, {
          data: results
        })

      }; break
      default: result = Object.assign(container, {
        data: null
      });
    }

    return JSON.stringify(result);

  }

  private async readFiles(payload: { paths: Array<string> }): Promise<string> {

		const data = Array<string>();

		for ( const path of payload.paths ) {
			
			this.agent.logger.log({ value: path }, "Кая пытается прочитать файл");

			try {
				data.push(`${ path }: ${ await Deno.readTextFile(path) }`);
			} catch(e) {

				this.agent.logger.log({ error: e }, "Ошибка чтения файла");

        if ( payload.paths.length === 1 ) return JSON.stringify({
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
