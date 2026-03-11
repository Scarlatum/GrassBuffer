import { Agent } from "./agent.ts";
import { Tools } from "./tools/tools.ts";

type NameTag = string;

type UserMemoryDescriptor = {
  about: string,
  tools: Tools,
  interactions: {
    lastTimestamp: number,
    messageCount: number
  }
}

export class Memory {

  public user = new Map<NameTag, UserMemoryDescriptor>();

  public async initUser(uid: string, ctx: Agent) {

    const [ count, [ query ] ] = await Promise.all([
      ctx.adapter.getMessageCount(uid),
      ctx.adapter.getUserDescription(uid),
    ]);

    const user: UserMemoryDescriptor = {
      about: query.result,
      interactions: { lastTimestamp: Date.now(), messageCount: count },
      tools: new Tools(ctx)
    }

    this.user.set(uid, user);

    return user;
    
  }

}