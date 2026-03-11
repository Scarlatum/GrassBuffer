import { Agent } from "./agent.ts";
import { Tools } from "./tools/tools.ts";

type NameTag = string;

type UserMemoryDescriptor = {
  about: string,
  tools: Tools,
  interactions: {
    lastTimestamp: number
  }
}

export class Memory {

  public user = new Map<NameTag, UserMemoryDescriptor>();

  public initUser(uid: string, about: string, ctx: Agent) {

    const user = {
      about,
      interactions: { lastTimestamp: Date.now() },
      tools: new Tools(ctx)
    }

    this.user.set(uid, user);

    return user;
    
  }

}