export const BASE_PATH = Deno.env.get("BASE_PATH") 
  ?? (Deno.execPath().toLowerCase().includes("deno")
    ? "."
    : Deno.execPath().replace(/[/\\][^/\\]*$/, "")
  );
