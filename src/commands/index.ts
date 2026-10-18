import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type Command = {
  data: {
    name: string;
    toJSON?: () => unknown;
  };
  cooldownMs?: number;
  execute: (...args: any[]) => any;
  autocomplete?: (...args: any[]) => any;
};

// Helper modules that live next to commands but are NOT slash commands.
const NON_COMMAND_FILES = new Set(["index.ts", "index.js", "protectroomEdit.ts", "protectroomEdit.js"]);

export async function loadCommands(): Promise<Record<string, Command>> {
  const commandsPath = __dirname;
  const commands: Record<string, Command> = {};

  for (const file of fs.readdirSync(commandsPath)) {
    if (
      (!file.endsWith(".ts") && !file.endsWith(".js")) ||
      NON_COMMAND_FILES.has(file)
    ) {
      continue;
    }

    const imported = await import(pathToFileURL(path.join(commandsPath, file)).href);
    const command = imported.default ?? imported;

    commands[command.data.name] = command;
  }

  return commands;
}
