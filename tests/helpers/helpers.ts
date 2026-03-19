// deno-lint-ignore-file no-explicit-any require-await

import { Toolbelt, ToolSet } from "../../source/tools/toolbelt.ts";

export function makeCategory(name: string, fns: Record<string, (x: any) => any>) {

  return {
    constructor: { name },
    about: `Test category ${name}`,
    set: new ToolSet(Object.entries(fns).reduce((acc, [fnName, fn]) => {

      acc[fnName] = {
        mappedFunction: fn,
        params: [{ argument: "input", type: "string", require: true }],
      };

      return acc;

    }, {} as Record<string, any>)),
  } as any;

}

export function makeToolbelt() {
  
  const double = (x: { input: number }) => x.input * 2;
  const stringify = (x: number) => String(x);

  const cat = makeCategory("TestTools", { double, stringify });

  return { belt: new Toolbelt([cat]), double, stringify };

}

export function makeMockAdapter() {
  return {
    db: {
      query: async () => [undefined],
      queryRaw: async () => [undefined],
    },
  } as any;
}