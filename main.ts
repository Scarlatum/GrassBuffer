import { GrassBot } from "./source/intergrations/telegram.ts";
import { Agent } from "./source/agent.ts";

declare const globalThis: { agent: Agent };

const token = Deno.env.get("TOKEN");
if (!token) throw Error("ENV ERROR");

Deno.addSignalListener("SIGINT", () => {

  console.log("3s before shutdown");
  setTimeout(() => {
    Deno.exit();
  }, 3000);

});

const bot = new GrassBot(token);

globalThis.agent = new Agent([ bot ]);
