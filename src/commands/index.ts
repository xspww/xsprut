import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Command = {
  data: {
    name: string;
  };
  execute: (...args: any[]) => any;
  autocomplete?: (...args: any[]) => any;
};

export async function loadCommands(): Promise<Record<string, Command>> {
  const commandsPath = __dirname;
  const commands: Record<string, Command> = {};

  for (const file of fs.readdirSync(commandsPath)) {
    if (
      (!file.endsWith(".ts") && !file.endsWith(".js")) ||
      file === "index.ts" ||
      file === "index.js"
    ) {
      continue;
    }

    const imported = await import(pathToFileURL(path.join(commandsPath, file)).href);
    const command = imported.default ?? imported;

    commands[command.data.name] = command;
  }

  return commands;
}
