// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@std/assert";
import { Toolbelt } from "../source/tools/toolbelt.ts";
import { makeToolbelt } from "./helpers.ts";

// --- createTool ---

Deno.test("createTool: создаёт корректную структуру инструмента", () => {

  const tool = Toolbelt.createTool({
    name: "myTool",
    desc: "описание",
    params: [
      { argument: "foo", type: "string", require: true, desc: "foo param" },
      { argument: "bar", type: "number", require: false },
    ],
  });

  assertEquals(tool.type, "function");
  assertEquals(tool.function.name, "myTool");
  assertEquals(tool.function.description, "описание");
  assertEquals(tool.function.parameters.required, ["foo"]);
  assertEquals(tool.function.parameters.properties["foo"], { type: "string", description: "foo param" });
  // bar без desc — description не должно быть
  assertEquals("description" in tool.function.parameters.properties["bar"], false);
});

// --- isDefault / setDefault ---

Deno.test("isDefault: true при инициализации", () => {
  const { belt } = makeToolbelt();
  assertEquals(belt.isDefault, true);
});

Deno.test("setDefault: возвращает к routerTool", async () => {
  const { belt } = makeToolbelt();

  await belt.route("getTools", "id_1", { category: "TestTools" });
  assertEquals(belt.isDefault, false);

  belt.setDefault();
  assertEquals(belt.isDefault, true);
});

// --- route: getTools ---

Deno.test("route: getTools переключает currentSet", async () => {
  const { belt } = makeToolbelt();

  assertEquals(belt.isDefault, true);
  await belt.route("getTools", "id_1", { category: "TestTools" });
  assertEquals(belt.isDefault, false);
});

// --- route: pipeline ---

Deno.test("route: pipeline вызывает функцию и возвращает результат", async () => {
  const { belt } = makeToolbelt();

  await belt.route("getTools", "id_1", { category: "TestTools" });

  const result = await belt.route("pipeline", "id_2", {
    functions: ["pipeline::double"],
    payload: { input: 5 },
  });

  assertEquals(JSON.parse(result.content), 10);
});

Deno.test("route: pipeline цепочка передаёт результат следующей функции", async () => {
  const { belt } = makeToolbelt();

  await belt.route("getTools", "id_1", { category: "TestTools" });

  const result = await belt.route("pipeline", "id_2", {
    functions: ["pipeline::double", "pipeline::stringify"],
    payload: { input: 7 },
  });

  assertEquals(JSON.parse(result.content), "14");
});

Deno.test("route: pipeline дедуплицирует функции", async () => {
  const { belt } = makeToolbelt();
  let callCount = 0;

  // Патчим маппинг чтобы считать вызовы
  await belt.route("getTools", "id_1", { category: "TestTools" });
  const original = belt.currentSet.functionMapping.get("pipeline::double")!;
  belt.currentSet.functionMapping.set("pipeline::double", (x: any) => {
    callCount++;
    return original(x);
  });

  await belt.route("pipeline", "id_2", {
    functions: ["pipeline::double", "pipeline::double"],
    payload: { input: 3 },
  });

  assertEquals(callCount, 1);
});

Deno.test("route: pipeline прерывается при getTools внутри", async () => {
  const { belt } = makeToolbelt();

  // Не переключаем категорию — pipeline сам переключит через getTools
  const result = await belt.route("pipeline", "id_1", {
    functions: ["getTools"],
    payload: { category: "TestTools" },
  });

  const content = JSON.parse(result.content) as string;
  assertEquals(content.includes("Pipeline interupted"), true);
  assertEquals(belt.isDefault, false);
});

Deno.test("route: pipeline возвращает ошибку если функции не в текущем toolset", async () => {
  const { belt } = makeToolbelt();

  // currentSet = routerTool, функции там нет
  const result = await belt.route("pipeline", "id_1", {
    functions: ["pipeline::double"],
    payload: { input: 1 },
  });

  const content = JSON.parse(result.content) as string;
  assertEquals(content.includes("Run getTools"), true);
});

// --- route: default (прямой вызов функции) ---

Deno.test("route: прямой вызов функции из currentSet", async () => {
  const { belt } = makeToolbelt();

  await belt.route("getTools", "id_1", { category: "TestTools" });

  const result = await belt.route("pipeline::double", "id_2", { input: 6 });

  assertEquals(JSON.parse(result.content), 12);
});

Deno.test("route: несуществующая функция возвращает сообщение об ошибке", async () => {
  const { belt } = makeToolbelt();

  const result = await belt.route("nonExistent", "id_1", {});

  assertEquals(result.content.includes("Error"), true);
  
});

// --- apply ---

Deno.test("apply: добавляет TOOLS_INSTRUCTIONS к системному сообщению", () => {
  const { belt } = makeToolbelt();

  const messages = [{ role: "system" as const, content: "base prompt" }];
  const result = belt.apply({ model: "test-model", messages });

  assertEquals(result.messages[0].content!.includes("Использование"), true);
  
});

Deno.test("apply: temperature 0.8 когда isDefault, 0.0 после getTools", async () => {
  const { belt } = makeToolbelt();

  const messages = () => [{ role: "system" as const, content: "p" }];

  assertEquals(belt.apply({ model: "m", messages: messages() }).temperature, 0.8);

  await belt.route("getTools", "id_1", { category: "TestTools" });
  assertEquals(belt.apply({ model: "m", messages: messages() }).temperature, 0.0);
});