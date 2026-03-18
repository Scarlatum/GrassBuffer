import { Agent } from "../agent.ts";
import { Integration, MessageHandler, MessageRequestHandler } from "../interfaces/integration.ts";

export class Aggregator implements Integration {

  constructor(private ctx: Agent, private integrations: Array<Integration>) {

  }

  public setMessageHandler(handler: MessageRequestHandler) {
    this.integrations.forEach(x => x.setMessageHandler(handler));
  }

  public async notify(text: string, username: string) {

    const x = await Promise.all(this.integrations.map(x => x.notify(text, username)))

    const cbs = Array<MessageHandler>();

    for ( const res of x ) {
      if ( res instanceof Error === false ) {
        cbs.push(res);
      }
    }

    return {
      update: (text: string) => {
        return Promise.resolve(cbs.map(x => x.update(text)).every(x => x))
      },
      delete: () => {
        cbs.forEach(x => x.delete());
      }
    }

  }

  public start(): void {
    this.integrations.forEach(x => x.start());

  }

}