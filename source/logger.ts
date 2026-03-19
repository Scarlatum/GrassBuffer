import chalk from "chalk";
import { BASE_PATH } from "./utils/paths.ts";

const enum Modes {
  "DEFAULT",
  "INFO"
}

export class SimpleLogger {

  static readonly mode = Deno.env.get("LOGGER_MODE") || "DEFAULT";

  constructor(private pool: Array<object> = []) {
    Deno.addSignalListener("SIGINT", () => this.flush());
  }

  private flush() {
    Deno.writeTextFileSync(`${BASE_PATH}/logs/log.${ Date.now() }.json`, JSON.stringify(this.pool));
    this.pool = [];
  }

  public log<T extends object>(obj: T, desc: string = "nothing", mode = Modes.INFO) {

    this.pool.push({
      time: new Date().toUTCString(),
      desc,
      value: obj,
    });

    console.log(`${ 
      chalk.dim(new Date().toISOString()) 
    } ${ 
      chalk.green("INFO") 
    } ${ 
      chalk.dim("simplelogger::out") 
    }: ${ 
      this.pool.at(-1)
    }`)

    if ( this.pool.length > 100 ) this.flush();

  }

}
