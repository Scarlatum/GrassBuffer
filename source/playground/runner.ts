export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export class PlaygroundRunner {
  private isRunning = false;
  private readonly TIMEOUT_MS = 60000;

  async run(relativePath: string, args: string[] = []): Promise<RunResult> {
    if (this.isRunning) {
      return {
        stdout: "",
        stderr: "Процесс уже запущен",
        exitCode: -1,
        timedOut: false
      };
    }

    const normalizedPath = relativePath.replace(/^[\\/]/, "");
    const fullPath = `./playgrounds/${normalizedPath}`;

    this.isRunning = true;

    const cwd = Deno.cwd();
    const playgroundsPath = `${cwd}/playgrounds`.replace(/\\/g, "/");

    const cmd = [
      "deno", "run",
      `--allow-read=${playgroundsPath}`,
      `--allow-write=${playgroundsPath}`,
      fullPath,
      ...args
    ];

    const command = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
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

    return {
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
      exitCode: code,
      timedOut,
    };
  }
}
