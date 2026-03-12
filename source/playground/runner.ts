export class Runner {

  private static decoder = new TextDecoder();
  private isRunning = false;
  private readonly TIMEOUT_MS = 60000;

  async run(relativePath: string | undefined, args: string[] = []) {

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

    this.isRunning = true;

    const playgroundPath = `${ Deno.cwd() }/playgrounds`.replace(/\\/g, "/");

    const command = new Deno.Command("deno", {
      args: [
        "run",
        `--allow-read=${ playgroundPath }`,
        `--allow-write=${ playgroundPath }`,
        '--allow-net',
        `./playgrounds/${ relativePath.replace(/^[\\/]/, "") }`,
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
