import { Agent } from "./agent/agent.ts";
import { MessageContainer } from "./shared.d.ts";
import { ChatChoice, proxyRequest } from "./utils/common.ts";
import { BASE_PATH } from "./utils/paths.ts";

const kv = await Deno.openKv(`${BASE_PATH}/kv/events`);

export class Kaya {

  static soul = Deno.readTextFileSync(`${BASE_PATH}/source/data/soul.txt`);
  static kv = kv;

  static getRole(name: string) {
    return name === "Кая" ? "assistant" : "user"
  }

	public async thinkAboutUser(history: Array<MessageContainer>) {

		const ans = await proxyRequest({
      model: Agent.MODEL,
      temperature: 0.85,
      messages: [ 
        { role: "system", content: Kaya.soul },
        ...history.map((x) => ({
          role    : "user",
          content : `${ x.from }: ${ x.data }`,
        })),
        {
          role: "assistant",
          content: "Я должна сделать заметку на счёт собеседника!",
        }, 
      ],
    });

		if ( ans instanceof Error ) return ans;

		const [ x ] = ans.choices as ChatChoice[];

		return String(x.message.content);

	}

  // TODO: Сделать адекватное решение
  public async needIntervention(_history: Array<MessageContainer>): Promise<boolean> {

    return await Promise.resolve(true);

  }

}
