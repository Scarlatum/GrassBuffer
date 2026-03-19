// deno-lint-ignore-file require-await
import chalk from "chalk";
import { Integration, MessageHandler, MessageRequestHandler } from "../interfaces/integration.ts";

import { Agent } from "../agent/agent.ts";

export class InternalSocket extends Integration {

  private clients = new Map<string, WebSocket>();

  private handler: MessageRequestHandler | null = null;

  override start(): void {
    
    Deno.serve({ port: 8020, hostname: "0.0.0.0", onListen(localAddr) {
      
      console.log(`\n${ 
        chalk.dim(new Date().toISOString()) 
      } ${ 
        chalk.green("INFO") 
      } ${ 
        chalk.dim("simplelogger::out") 
      }: ${ 
        chalk.underline(`ws://${ localAddr.hostname }:${ localAddr.port }`)
      }`)

    }, }, async req => {

      const { response, socket } = Deno.upgradeWebSocket(req);

      socket.addEventListener("open", () => {

				this.notify("Соединение установленно", Agent.OWTAG);

        this.clients.set(Agent.OWTAG, socket);

        this.notify("Что-то начинает шевелиться из-под саркофага...", Agent.OWTAG)

      });

      socket.addEventListener("message", async event => {

        if ( typeof event.data === "string" ) {

          socket.send(chalk.dim("•••"));
          
          const res = await this.handler?.(event.data, Agent.OWTAG, true);

          if ( res ) {
            res.split("\n").forEach(x => socket.send(x))
          };

          socket.send(" ");

        }
      });

      socket.addEventListener("close", async () => {

        await this.notify("Шум из под саркофага сходит на нет, что-то уходит в глубокий сон...", Agent.OWTAG);

        this.clients.delete(Agent.OWTAG);

      })

      return response;

    });

    

  }

  override async notify(text: string, uid: string): Promise<Error | MessageHandler> {

    const socket = this.clients.get(uid);

    if ( !socket ) return Error("Not implemented");

    socket.send(chalk.gray(text));

    return {
      update: async (text: string) => {

        socket.send(chalk.gray(text));

        return true;

      },
      delete: () => {

      }
    }

  }

  override setMessageHandler(handler: MessageRequestHandler): void {
    this.handler = handler;
  }

}
