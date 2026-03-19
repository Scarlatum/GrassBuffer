import { GrassBot } from "./source/intergrations/telegram.ts";
import { InternalSocket } from "./source/intergrations/websocket.ts";
import { Agent } from "./source/agent/agent.ts";

declare const globalThis: { agent: Agent };

const token = Deno.env.get("TOKEN");

if (!token) throw Error("ENV ERROR");

const bot = new GrassBot(token);
const soc = new InternalSocket();

globalThis.agent = new Agent([ bot, soc ]);

Deno.addSignalListener("SIGINT", async () => {

  console.log("3s before shutdown");

  await bot.bot.stop();

  setTimeout(() => {
    Deno.exit();
  }, 3000);

});