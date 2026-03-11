import { Agent } from "../agent.ts";
import { Kaya } from "../kaya.ts";
import { FileSystemTools } from "./categories/fs.tools.ts";
import { JournalTools } from "./categories/journal.tool.ts";
import { ScheduleTools } from "./categories/schedule.tools.ts";
import { UserTools } from "./categories/user.tools.ts";
import { Toolbelt } from "./toolbelt.ts";

export class Tools {

  static journalSession = `${ Date.now() }_${ Math.random().toString(32).substring(2) }`
  static counter = 0;

  public belt

  constructor(private agent: Agent) {

    this.belt = new Toolbelt([
      new JournalTools(
        this.create.bind(this), 
        this.find.bind(this),
        this.update.bind(this),
      ),
      new FileSystemTools(
        this.pickFile.bind(this),
        this.writeFile.bind(this)
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

  private async writeFile(payload: { path: string, content: string }) {
    const normalizedPath = payload.path.replace(/^[\\/]/, "");
    const fullPath = `./playgrounds/${normalizedPath}`;
    
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });
    
    await Deno.writeTextFile(fullPath, payload.content);
    return `Файл записан: ${fullPath}`;
  }

  private async pickFile(payload: { paths: Array<string> }) {

		const data = Array<string>();

		for ( const path of payload.paths ) {
			
			this.agent.logger.log({ value: path }, "Кая пытается прочитать файл");

			try {
				data.push(`${ path }: ${ await Deno.readTextFile(path) }`);
			} catch(e) {

				this.agent.logger.log({ error: e }, "Ошибка чтения файла");

        if ( payload.paths.length === 1 ) return `
          Ошибка чтения файла ${ path }. Ошибка: ${ (e as Error).message } 
        `

			}

		}

		return "Содержимое файлов:\n" + data.join("\n");

  }

}
