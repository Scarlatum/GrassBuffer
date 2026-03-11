import { ToolSet } from "../toolbelt.ts";
import type { DeriveDescription, AnyFunction } from "~/shared.d.ts";
export abstract class CategoryTools {
  public set: ToolSet;
  public abstract readonly about: string;

  protected constructor(
    descriptors: Array<DeriveDescription<{
      name: string;
      desc?: string;
      params: Array<any>;
      mappedFunction: AnyFunction | null;
    }>>,
    pipeline: boolean = true
  ) {
    this.set = new ToolSet(descriptors, pipeline);
  }
}