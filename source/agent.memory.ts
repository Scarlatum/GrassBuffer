import { AgenticSession } from "./agent.session.ts";
import { Agent } from "./agent.ts";
import { MessageContainer } from "./shared.d.ts";

type NameTag = string;

export type UserMemoryDescriptor = {
  about: string,
  username: string,
  session: AgenticSession,
  interactions: {
    lastTimestamp: number,
    messageCount: number
  }
}

export class Memory {

  public users = new Map<NameTag, UserMemoryDescriptor>();

  constructor(private ctx: Agent) {};

  public async initUser(username: string) {

    const [ count, [ query ] ] = await Promise.all([
      this.ctx.adapter.getMessageCount(username),
      this.ctx.adapter.getUserDescription(username),
    ]);

    const user: UserMemoryDescriptor = {
      about: query.result,
      interactions: { lastTimestamp: Date.now(), messageCount: count },
      session: new AgenticSession(this.ctx, username),
      username: username,
    }

    this.users.set(username, user);

    return user;
    
  }

  public async invokeUser(username: string, history: Array<MessageContainer> = []) {

    let user = this.users.get(username);

    if ( !user ) {

      user = await this.initUser(username);

      user.session.history = history

    }

    return user;

  }

}