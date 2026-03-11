import { z } from "zod"

import { ChatMessage } from "../utils/common.ts";
import { AnyFunction, DeriveDescription } from "../shared.d.ts";
import { Agent } from "../agent.ts";
import { ToolError } from "../locales/keys.ts";

interface ITool {
  type: "function",
  function: {
    name: string,
    description?: string,
    parameters: {
      type: "object",
      properties: Record<string, object>,
      required?: Array<string>,
    }
  }
}

interface ToolDescriptor {
  desc?: string,
  params: Array<DeriveDescription<{
    argument: string,
    type: string,
    require: boolean,
    subtype?: DeriveDescription<{ type: string }>
  }>>
  mappedFunction: AnyFunction | null
}

export type ToolCategories = Array<{
  set: ToolSet,
  about: string
}>

export class ToolSet {

  public functionMapping = new Map<string, AnyFunction>();
  public tools: ITool[] = []
  
  constructor(public descriptors: Record<string, ToolDescriptor>, pipeline: boolean = true) {

    if ( pipeline ) this.tools.push({
      type: "function",
      function: {
        name: "pipeline",
        description: "Вызвать функции по очереди. По сути это цепочка f(g(payload))",
        parameters: {
          type: "object",
          properties: {
            payload: { type: "object", description: "Данные для первой функции в цепочке" },
            functions: { type: "array", items: { type: "string" } },
          }
        }
      }
    });

    for ( const [ name, x ] of Object.entries(descriptors) ) {

      const tool = Toolbelt.createTool({ ...x, name });

      if ( pipeline ) {

        const key = tool.function.name = `pipeline::${ tool.function.name }`;

        if ( x.mappedFunction ) this.functionMapping.set(key, x.mappedFunction);

      }

      this.tools.push(tool);

    }

  }
}

export class Toolbelt<const C extends ToolCategories> {

  static readonly TOOLS_INSTRUCTIONS = `
    Использование интрументов:
    1. ВАЖНО! Удостоверься что вызываешь pipeline если ранее был вызван getTools.
    2. Не вызывай одни и тебе же фукнции несколько раз внутри одного pipeline.
  `;

  private readonly toolMap = new Map<string, { set: ToolSet, about: string }>()
  private readonly routerTool: ToolSet;

  public currentSet: ToolSet;
  public readonly categorySchema;

  constructor(public categories: C) {

    const keys = Array<string>();
    const desc = Array<string>();

    for ( const x of categories ) {

      const name = x.constructor.name;

      keys.push(name);
      desc.push(`${ name }: ${ x.about }`);

      this.toolMap.set(name, x);

    }

    this.categorySchema = z.object({
      category: z.enum(keys)
    });

    this.currentSet = this.routerTool = new ToolSet({
      getTools: { 
				desc: "Получить набор инструментов для текущей задачи", 
				mappedFunction: null, 
				params: [{ 
          argument: "category", 
          require: true, 
          type: "string", 
          desc: `Может быть одним из списка:\n${ desc.join("\n") }` 
        }] 
			}
    }, false);

  }

  get isDefault() {
    return this.currentSet === this.routerTool;
  }

  static createTool({ params, desc, name }: { params: ToolDescriptor['params'], desc?: string, name: string }): ITool {

    const properties: Record<string, { type: string, description?: string }> = {};

    for ( const x of params ) {

      properties[x.argument] = { type: x.type, description: x.desc }

      if ( !x.desc ) delete properties[x.argument]['description']

    }

    const tool = {
      type: "function",
      function: {
        name, parameters: {
          type: "object",
          required: params.filter(x => x.require).map(x => x.argument),
          properties, 
        }
      }
    } as ITool;

    if ( desc ) tool.function['description'] = desc;

    return tool;

  }

  private get( payload: { category: string; } ) {
    return this.currentSet = this.toolMap.get(payload.category)!.set
  }

  private async seq(params: { functions: Array<string>, payload: unknown }) {

    if ( !params.functions.includes("getTools")  ) {
      if ( !params.functions.every(x => this.currentSet.functionMapping.has(x)) ) {
        const msg = Agent.LOCALE[ToolError.FUNCTION_NOT_IN_SET];
        return msg.replace("{functions}", params.functions.join(", "))
          + `\nТекущий toolSet: ${ this.currentSet.functionMapping.keys().toArray() }`;
      }
    }

    let result;

    for ( const tag of [ ...new Set(params.functions) ] ) {

      if ( tag === "getTools" ) {

        const payload = this.categorySchema.safeParse(params.payload);

        if ( payload.error ) return payload.error.message;

        this.get(payload.data);

        const msg = Agent.LOCALE[ToolError.CATEGORY_SWITCH];
        return msg.replace("{category}", payload.data.category);

      }

      const x = this.currentSet.functionMapping.get(tag);

      if ( !x ) continue;

      result = await x(result ?? params.payload);

    }

    return result;

  }

  public setDefault() {
    return this.currentSet = this.routerTool;
  }

  public apply<T extends { model: string, messages: ChatMessage[] }>(params: T) {

    const [ sys ] = params.messages;

    sys.content += "\n" + Toolbelt.TOOLS_INSTRUCTIONS;

    return {
      temperature: this.isDefault ? 0.8 : 0.0,
      tools: this.currentSet.tools,
      ...params,
    }

  }

  // deno-lint-ignore no-explicit-any
  public async route(tool: string, id: string, payload: any) {

    const container = {
      role: "tool" as const,
      'tool_call_id': id,
      content: ""
    }

    switch ( tool ) {
      case "getTools": 
        container.content = JSON.stringify( this.get(payload) );
        break;
      case "pipeline":
        container.content = JSON.stringify( await this.seq(payload));
        break;
      default: try {

        const x = this.currentSet.functionMapping.get(tool);

        if ( !x ) throw Error(Agent.LOCALE[ToolError.FUNCTION_NOT_FOUND]);

        container.content = JSON.stringify( await x(payload));

      } catch(e) {
        const msg = Agent.LOCALE[ToolError.UNKNOWN_ERROR];
        container.content = msg.replace("{message}", e instanceof Error ? e.message : 'неизвестная ошибка');
      }
    }

    return container;

  }

} 
