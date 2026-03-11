type NameTag = string;

type UserMemoryDescriptor = {
  about: string,
  interactions: {
    lastTimestamp: number
  }
}

export class Memory {

  public user = new Map<NameTag, UserMemoryDescriptor>();

}