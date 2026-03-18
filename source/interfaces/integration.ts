/**
 * Обработчик входящего сообщения: текст, ключ контекста, опционально отправитель.
 * Интеграция вызывает этот callback и отправляет возвращённый ответ в канал.
 */
export type MessageRequestHandler = (
  text: string,
  contextKey: string,
  force: boolean
) => Promise<string | void>;

export type MessageHandler = {
  update: (text: string) => Promise<boolean>
  delete: () => void
}

/**
 * Абстрактный интерфейс интеграции (бот, другой канал и т.д.).
 * Kaya подписывается на хуки через setMessageHandler, затем вызывается start().
 */
export abstract class Integration {

  /** Подписка на входящие сообщения: интеграция будет вызывать этот handler и отправлять ответ. */
  abstract setMessageHandler(handler: MessageRequestHandler): void;

  /** Запуск интеграции после того, как Kaya подписался на хуки. */
  abstract start(): void;

  abstract notify(text: string, uid: string): Promise<Error | MessageHandler>;

}
