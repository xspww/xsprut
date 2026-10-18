import { Collection } from "discord.js";
import type { Command } from "../commands";

declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
  }
}
