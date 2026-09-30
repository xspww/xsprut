import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { client } from "../lib/client";
import logger from "../lib/logger";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("📖 แสดงคำสั่งและวิธีใช้งานบอท (แบ่งตามหมวดหมู่)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

interface HelpGroup {
  emoji: string;
  name: string;
  entries: string[];
}

const HELP_GROUPS: HelpGroup[] = [
  {
    emoji: "🎮",
    name: "Roblox Updates",
    entries: [
      "/robloxalert add",
      "/robloxalert remove",
      "/robloxalert list",
      "/ver",
    ],
  },
  {
    emoji: "🚀",
    name: "Executor Tracking",
    entries: [
      "/ex track add",
      "/ex track edit",
      "/ex track remove",
      "/ex track list",
      "/ex track refresh",
      "/ex voice add",
      "/ex voice remove",
      "/ex voice list",
      "/ex voice refresh",
      "/ex chat add",
      "/ex chat remove",
      "/ex chat list",
      "/ex chat refresh",
    ],
  },
  {
    emoji: "🛡️",
    name: "ความปลอดภัย",
    entries: [
      "/protectroom setup",
      "/protectroom remove",
      "/protectroom view",
      "/whitelist add",
      "/whitelist remove",
      "/whitelist list",
      "/verify setup",
      "/verify remove",
    ],
  },
  {
    emoji: "⚙️",
    name: "อื่นๆ",
    entries: [
      "/status add",
      "/status remove",
      "/status list",
      "/status refresh",
      "/joinalert add",
      "/joinalert remove",
      "/joinalert list",
      "/cleanup run",
      "/cleanup preview",
      "/config",
      "/test",
      "/help",
    ],
  },
];

/**
 * Flattens a command's SlashCommandBuilder JSON into an array of full command paths with descriptions.
 * Handles top-level commands, subcommand groups, and subcommands.
 */
function flattenCommand(commandData: any): { path: string; description: string }[] {
  const baseName = commandData.name;
  const baseDesc = commandData.description ?? "No description available.";
  const results: { path: string; description: string }[] = [];

  // If there are no sub-options, just return the base command.
  if (!commandData.options || commandData.options.length === 0) {
    results.push({ path: `/${baseName}`, description: baseDesc });
    return results;
  }

  // Iterate over options. They can be subcommand groups or subcommands.
  for (const opt of commandData.options) {
    if (opt.type === 1) { // Subcommand
      const subPath = `/${baseName} ${opt.name}`;
      results.push({ path: subPath, description: opt.description ?? "No description" });
    } else if (opt.type === 2) { // SubcommandGroup
      const groupName = opt.name;
      if (opt.options) {
        for (const sub of opt.options) {
          if (sub.type === 1) {
            const subPath = `/${baseName} ${groupName} ${sub.name}`;
            results.push({ path: subPath, description: sub.description ?? "No description" });
          }
        }
      }
    }
  }

  // If no subcommands were added (e.g., command has options of other types), fall back to base.
  if (results.length === 0) {
    results.push({ path: `/${baseName}`, description: baseDesc });
  }
  return results;
}

/** Builds a map of full command path -> description from the live command registry. */
function buildDescriptionMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const cmd of client.commands.values()) {
    const json = typeof (cmd.data as any).toJSON === "function" ? (cmd.data as any).toJSON() : (cmd.data as any);
    if (!json || !json.name) continue;
    for (const entry of flattenCommand(json)) {
      map.set(entry.path, entry.description);
    }
  }
  return map;
}

/** Chunks lines into embed fields of at most 1000 chars (EMBED_FIELD_VALUE_LIMIT is 1024). */
function chunkLines(name: string, lines: string[]): { name: string; value: string }[] {
  const fields: { name: string; value: string }[] = [];
  let chunk = "";
  let index = 1;

  for (const line of lines) {
    if ((chunk + "\n" + line).length > 1000) {
      fields.push({ name: index === 1 ? name : `${name} (ต่อ)`, value: chunk });
      index++;
      chunk = line;
    } else {
      chunk = chunk ? `${chunk}\n${line}` : line;
    }
  }

  if (chunk) {
    fields.push({ name: index === 1 ? name : `${name} (ต่อ)`, value: chunk });
  }
  return fields;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    const descMap = buildDescriptionMap();

    const fields: { name: string; value: string }[] = [];
    const coveredPaths = new Set<string>();

    for (const group of HELP_GROUPS) {
      const lines: string[] = [];
      for (const path of group.entries) {
        coveredPaths.add(path);
        const desc = descMap.get(path) ?? "—";
        lines.push(`\`${path}\` — ${desc}`);
      }
      fields.push(...chunkLines(`${group.emoji} ${group.name}`, lines));
    }

    // Future-proofing: any registered command not curated above shows up in "อื่นๆ".
    const uncategorized = Array.from(descMap.keys())
      .filter((path) => !coveredPaths.has(path))
      .sort((a, b) => a.localeCompare(b));
    if (uncategorized.length > 0) {
      fields.push(
        ...chunkLines(
          "➕ เพิ่มเติม",
          uncategorized.map((path) => `\`${path}\` — ${descMap.get(path)}`),
        ),
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("Diff Team — คำสั่งและวิธีใช้งาน")
      .setDescription("กดคำสั่งแล้วเลือกตัวเลือกตามตัวอย่างได้เลย (ตัวเลือกที่ต้องกรอกจะบังคับให้ใส่เอง)\nคำสั่งทั้งหมดต้องมีสิทธิ์ **Administrator**")
      .addFields(fields)
      .setColor(0x3b82f6)
      .setFooter({ text: "Diff Team" });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    logger.error("Error executing help command:", error);
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: "❌ เกิดข้อผิดพลาดในการโหลดคำสั่งช่วยเหลือ",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
