import { UnwrapPromise } from "./shared.d.ts";
import { BASE_PATH } from "./utils/paths.ts";

export class Runner {

  private static decoder = new TextDecoder();
  private isRunning = false;
  private readonly TIMEOUT_MS = 60000;

  static fmt(result: UnwrapPromise<ReturnType<InstanceType<typeof Runner>['run']>>) {
    return result.timedOut
      ? `Таймаут (60 сек).\n stdout: ${ result.stdout }\n stderr: ${ result.stderr }`
      : `Код завершения: ${ result.exitCode }; \nstdout: ${ result.stdout }; \nstderr: ${ result.stderr }`
      ;
  }

  async run(relativePath: string | undefined, args: string[] = []) {

		console.log("runner args: ", args);

    const container = {
      stdout: "",
      stderr: "Процесс уже запущен",
      exitCode: -1,
      timedOut: false
    };

    if (this.isRunning) return container;

    if (!relativePath) {
      container.stderr = "Ошибка: путь к файлу не передан"; 
      return container;
    }

    const index   = relativePath.indexOf("playgrounds");
    const fromCWD = index >= 0 && index <= 3;

    console.log(relativePath, fromCWD);

    this.isRunning = true;

    const playgroundPath = `${BASE_PATH}/personal/playgrounds`.replace(/\\/g, "/");

    const command = new Deno.Command("deno", {
      args: [
        "run",
        `--allow-read=${ playgroundPath }`,
        `--allow-write=${ playgroundPath }`,
        '--allow-net',
        `${ fromCWD ? "./" : "./personal/playgrounds/" }${ relativePath.replace(/^[\\/]/, "") }`,
        ...args
      ],
      stdout: "piped",
      stderr: "piped",
    });

    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
    }, this.TIMEOUT_MS);

    const { code, stdout, stderr } = await command.output();

    clearTimeout(timeoutId);

    this.isRunning = false;

    container.stdout   = Runner.decoder.decode(stdout);
    container.stderr   = Runner.decoder.decode(stderr);
    container.exitCode = code;
    container.timedOut = timedOut;

    return container;

  } 
}
