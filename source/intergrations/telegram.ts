import { Bot, code } from "gramio";
import { formatKayaMessage } from "../utils/common.ts";
import type { MessageRequestHandler } from "../interfaces/integration.ts";
import { Integration } from "../interfaces/integration.ts";
import { Kaya } from "../kaya.ts";

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

    this.bot.onStart(() => { 

      this.notify("Что-то начинает шевелиться из-под саркофага...", "Scarlatum")

    });

    this.bot.on("message", async (ctx) => {

			let username = ctx.from.username || crypto.randomUUID().replaceAll("-","");

			if ( ctx.text?.includes("##ANONYMOUS##") ) username = crypto.randomUUID().replaceAll("-","");

      if ( username ) {

        const kvID = await Kaya.kv.get<number>(["usernameUID", username ]);

        if ( !kvID.value || kvID.value !== ctx.from.id ) {
          await Kaya.kv.set(["usernameUID", username ], ctx.from.id);
        }

      }

      if ( !ctx.text || !username ) return void 0;

      ctx.sendChatAction("typing");

      switch (ctx.chat.type) {
        case "private": {

          const res = await this.messageHandler!(ctx.text, username, true);

          if ( !res ) break;

          ctx.sendChatAction("typing");

          return ctx.send(formatKayaMessage(res));

        }
        case "group": case "supergroup": {

          const res = await this.messageHandler!(ctx.text, normalizeID(ctx.chat.id), false);

          if ( !res ) break

          ctx.sendChatAction("typing");

          return ctx.reply(formatKayaMessage(res), {
            reply_parameters: { message_id: ctx.id }
          });

        }
      }

    })

    this.bot.start();

  }

  async notify(text: string, username: string) {

    const uid = await Kaya.kv.get<number>(["usernameUID", username ]);

    if ( !uid.value ) return Error("Unknown username");

    const mess = await this.bot.api.sendMessage({
      chat_id: uid.value,
      text: code`${ text }`,
      disable_notification: true,
    });

    return {
      update: async (text: string) => {
        return Boolean(await this.bot.api.editMessageText({
          text: code`${ text }`,
          message_id: mess.message_id,
          chat_id: mess.chat.id
        }));
      },
      delete: () => {
        this.bot.api.deleteMessage({
          message_id: mess.message_id,
          chat_id: mess.chat.id,
        })
      }
    }

  }

}
