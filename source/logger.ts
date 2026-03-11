export class SimpleLogger {

  constructor(private pool: Array<object> = []) {
    Deno.addSignalListener("SIGINT", () => this.flush());
  }

  private flush() {
    Deno.writeTextFileSync(`logs/log.${ Date.now() }.json`, JSON.stringify(this.pool));
    this.pool = [];
  }

  public log<T extends object>(obj: T, desc: string = "nothing") {

    this.pool.push({
      time: new Date().toUTCString(),
      desc,
      value: obj,
    });

		console.log(this.pool.at(-1));

    if ( this.pool.length > 100 ) this.flush();

  }

}
