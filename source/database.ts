import { Surreal } from "surrealdb"
import { MessageContainer } from "./shared.d.ts";
import { sleep } from "gramio";

export class DatabaseAdapter {

  public db = new Surreal();
  public onReady: Promise<Surreal>;

  private readonly credentials: { username: string; password: string };

  constructor() {

    const { promise, resolve } = Promise.withResolvers<Surreal>()

    this.onReady = promise;

    const username = Deno.env.get("SURREAL_USER")!;
    const password = Deno.env.get("SURREAL_PASS")!;

    this.credentials = { username, password };

    const process = new Deno.Command("surreal", {
      args: [
        "start",
        "-b",
        "0.0.0.0:8050",
        "--log",
        "debug",
        "surrealkv://db",
      ],
    }).spawn();

    Deno.addSignalListener("SIGINT", () => {
      process.kill();
    });

    this.connect().then(x => resolve(x));

  }

  private async connect() {
   
    await this.db.ready;
    await sleep(3000);
    await this.db.connect('ws://localhost:8050', { versionCheck: false, reconnect: true });
    await this.db.signin({
      username: this.credentials.username,
      password: this.credentials.password,
    });

    await this.db.use({
      database: "default",
      namespace: "default"
    })

    return this.db;

  }

  public async getUserDescription(uid: string) {
    return await this.db.queryRaw<string[]>(/*surql*/`
      BEGIN TRANSACTION;
      if none != select * from only user:${ uid } {
        return select value description from only user:${ uid };
      };
      COMMIT TRANSACTION;
    `);
  }

  public async updateUserHistory(uid: string, desc: string) {
    await this.db.queryRaw(/*surql*/`
      BEGIN TRANSACTION;
  
      if none != select * from only user:${ uid } {
        update user:${ uid } set description = '${ desc }';
      };
  
      COMMIT TRANSACTION;
    `);
  }

  public async checkUser(uid: string) {
    await this.db.queryRaw(/*surql*/`
      BEGIN TRANSACTION;
  
      if none = select * from only user:${ uid } {
        create user:${ uid };
      };
  
      COMMIT TRANSACTION;
    `);
  }

  /** 
   * @param contextKey — id контекста (username или chat_n123 для группы с id -123), 
   * @param fromUser — кто написал (для группы — username, иначе = contextKey) 
   * */
  public saveMessages(x: string, y: string, contextKey: string, fromUser?: string) {
    const from = fromUser ?? contextKey;
    this.db.queryRaw(/*surql*/`
      BEGIN TRANSACTION;

      LET $x = CREATE ONLY message CONTENT {
        data: '${ x }',
        from: '${ from }',
        date: ${ Date.now() }
      };

      LET $y = CREATE ONLY message CONTENT {
        data: '${ y }',
        from: 'Кая',
        date: ${ Date.now() + 1 }
      };

      RELATE user:${ contextKey }<-chat<-$x;
      RELATE user:${ contextKey }<-chat<-$y;

      COMMIT TRANSACTION;
    `);
  }

  public async saveMessage(data: string, date: number, key: string) {
    await this.db.queryRaw(/*surql*/`
      BEGIN TRANSACTION;

      LET $x = CREATE ONLY message CONTENT {
        data: '${ data }',
        from: 'Кая',
        date: ${ date }
      };

      RELATE user:${ key }<-chat<-$x;

      COMMIT TRANSACTION;
    `);
  }

  public async getUserHistory(uid: string) {
  
    await this.checkUser(uid);

    const [ history ] = await this.db.query<Array<MessageContainer>[]>(/*surql*/`
      BEGIN TRANSACTION;

      LET $qua = 12;

      LET $arr = array::flatten(select value <-chat<-message from only user:${ uid });
      LET $beg = math::max([ array::len($arr) - $qua, 0 ]);

      RETURN select * from $arr order by date asc limit $qua start $beg;

      COMMIT TRANSACTION;
    `);

    return history;

  }

}
