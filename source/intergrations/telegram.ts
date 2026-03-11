import { Bot, sleep } from "gramio";
import { formatKayaMessage } from "../utils/utils.ts";
import type { MessageRequestHandler } from "../interfaces/integration.ts";
import { Integration } from "../interfaces/integration.ts";

/** Нормализует id чата в ключ без знака (для group/supergroup id отрицательный). */
function normalizeID(chatId: number): string {
  return `chat${ Math.abs(chatId) }`; 
}

export class GrassBot extends Integration {

  private lastMessage = 0;
  public readonly bot: Bot;
  private messageHandler: MessageRequestHandler | null = null;

  constructor(token: string) {
    super();
    this.bot = new Bot(token);
  }

  setMessageHandler(handler: MessageRequestHandler): void {
    this.messageHandler = handler;
  }

  start(): void {

    this.bot.onStart(() => { console.log("ᚨᛖᚴ ᚦᛖᚦ ᚠᛖᛖ")})

    this.bot.on("message", async (ctx) => {

      console.log(ctx);

      if ( !this.messageHandler ) throw new Error("GrassBot: setMessageHandler is null")

      this.lastMessage = ctx.id;

      await sleep(500);

      if ( this.lastMessage !== ctx.id || !ctx.from.username ) return;

      const typeImmitation = async () => {
        ctx.sendChatAction("typing"); await sleep(500);
      }

      ctx.sendChatAction("find_location");

      switch (ctx.chat.type) {
        case "private": {

          const res = await this.messageHandler(ctx.text!, ctx.from!.username!, true);

          if ( !res ) break;

          await typeImmitation();

          return ctx.send(formatKayaMessage(res));

        }
        case "group": case "supergroup": {

          const res = await this.messageHandler(ctx.text!, normalizeID(ctx.chat.id), false);

          if ( !res ) break

          await typeImmitation();

          return ctx.reply(formatKayaMessage(res), {
            reply_parameters: { message_id: ctx.id }
          });

        }
      }

    })

    this.bot.start();

  }
}
