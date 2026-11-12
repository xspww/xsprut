import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from "discord.js";

/**
 * Slash-command definition for `/ex`.
 *
 * Every subcommand is built by its own function. A single chained builder for
 * all of them ran past 500 lines, which made the option order — the part
 * Discord rejects when a required option follows an optional one — impossible
 * to check by eye.
 */

// ─── Choice sets ───────────────────────────────────────────────────────────
// Returned as fresh arrays so each builder call gets its own copy.

function displayChoices(long: boolean) {
  return long
    ? [
        { name: "🔊 Voice Channel — Rename channel by status", value: "voice" },
        { name: "💬 Text Channel — Rename channel by status", value: "chat" },
        { name: "📊 Embed Status — Post a status embed that auto-updates", value: "embed" },
        { name: "📢 Alert Message — Send a message when the executor updates", value: "alert" },
      ]
    : [
        { name: "🔊 Voice Channel", value: "voice" },
        { name: "💬 Text Channel", value: "chat" },
        { name: "📊 Embed Status", value: "embed" },
        { name: "📢 Alert Message", value: "alert" },
      ];
}

function modeChoices() {
  return [
    { name: "✏️ Custom — Set a custom channel name", value: "custom" },
    { name: "🎮 Roblox Version — Show the Roblox version", value: "roblox-version" },
  ];
}

function robloxChannelChoices() {
  return [
    { name: "🟢 LIVE", value: "LIVE" },
    { name: "🟡 ZBeta", value: "ZBeta" },
  ];
}

// ─── /ex track ─────────────────────────────────────────────────────────────

function trackAddSub(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName("add")
    .setDescription("➕ Add an Executor tracker")
    .addStringOption((o) =>
      o
        .setName("display")
        .setDescription("🎨 How to show this tracker")
        .setRequired(true)
        .addChoices(displayChoices(true)),
    )
    .addStringOption((o) =>
      o
        .setName("executor")
        .setDescription("🔍 Executor name (start typing to search)")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("📨 Target channel — required for Embed Status / Alert Message")
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText),
    )
    .addStringOption((o) =>
      o
        .setName("content")
        .setDescription("💬 Custom message for the post — Embed Status / Alert only (optional)")
        .setRequired(false),
    )
    .addChannelOption((o) =>
      o
        .setName("category")
        .setDescription("📁 Category for a new sub-channel — required for Voice/Text mode")
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildCategory),
    )
    .addStringOption((o) =>
      o
        .setName("interval")
        .setDescription("⏱️ Embed update frequency, e.g. 30s, 1m, 5m (10s–1h)")
        .setRequired(false),
    );
}

function trackRemoveSub(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName("remove")
    .setDescription("🗑️ Remove an Executor tracker")
    .addStringOption((o) =>
      o
        .setName("display")
        .setDescription("🎨 Tracker type to remove")
        .setRequired(true)
        .addChoices(displayChoices(false)),
    )
    .addStringOption((o) =>
      o
        .setName("executor")
        .setDescription("🔍 Executor name (start typing to search)")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("📨 Channel the tracker was set up in (Embed Status / Alert Message)")
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText),
    );
}

function trackEditSub(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName("edit")
    .setDescription("✏️ Change the message or update frequency of an Embed Status / Alert")
    .addStringOption((o) =>
      o
        .setName("executor")
        .setDescription("🔍 Executor name (start typing to search)")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName("content")
        .setDescription("💬 New custom message for the post (optional)")
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("interval")
        .setDescription("⏱️ New embed update frequency, e.g. 30s, 1m, 5m (10s–1h)")
        .setRequired(false),
    );
}

function trackGroup(): SlashCommandSubcommandGroupBuilder {
  return new SlashCommandSubcommandGroupBuilder()
    .setName("track")
    .setDescription("📡 Executor status and update tracking system")
    .addSubcommand(trackAddSub())
    .addSubcommand(trackRemoveSub())
    .addSubcommand(trackEditSub())
    .addSubcommand(
      new SlashCommandSubcommandBuilder()
        .setName("list")
        .setDescription("📋 View all configured Executors (grouped by format)"),
    )
    .addSubcommand(
      new SlashCommandSubcommandBuilder()
        .setName("refresh")
        .setDescription("🔄 Force-update all statuses and embeds immediately"),
    );
}

// ─── /ex voice and /ex chat ────────────────────────────────────────────────
// Both groups configure a channel the bot renames, so they share their
// options and only differ in wording and channel type.

function botChannelAddSub(params: {
  description: string;
  channelDescription: string;
  channelType: ChannelType.GuildText | ChannelType.GuildVoice;
}): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName("add")
    .setDescription(params.description)
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("🎨 How the channel name is built")
        .setRequired(true)
        .addChoices(modeChoices()),
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription(params.channelDescription)
        .setRequired(false)
        .addChannelTypes(params.channelType),
    )
    .addChannelOption((o) =>
      o
        .setName("category")
        .setDescription("📁 Or a category where a new channel is created")
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildCategory),
    )
    .addStringOption((o) =>
      o
        .setName("display_name")
        .setDescription("✏️ Channel name to use (Custom mode only)")
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("roblox_channel")
        .setDescription("📡 Roblox channel to follow (Roblox Version mode only)")
        .setRequired(false)
        .addChoices(robloxChannelChoices()),
    );
}

function botVoiceGroup(): SlashCommandSubcommandGroupBuilder {
  return new SlashCommandSubcommandGroupBuilder()
    .setName("voice")
    .setDescription("🔊 Voice channel the bot stays in 24/7 with status display")
    .addSubcommand(
      botChannelAddSub({
        description: "➕ Set up a voice channel for the bot to stay in",
        channelDescription: "🔊 Existing voice channel to use",
        channelType: ChannelType.GuildVoice,
      }),
    )
    .addSubcommand(
      new SlashCommandSubcommandBuilder()
        .setName("remove")
        .setDescription("🗑️ Remove the bot voice channel"),
    )
    .addSubcommand(
      new SlashCommandSubcommandBuilder()
        .setName("list")
        .setDescription("📋 View the current bot voice channel settings"),
    )
    .addSubcommand(
      new SlashCommandSubcommandBuilder()
        .setName("refresh")
        .setDescription("🔄 Force-update the bot voice channel immediately"),
    );
}

function botChatGroup(): SlashCommandSubcommandGroupBuilder {
  return new SlashCommandSubcommandGroupBuilder()
    .setName("chat")
    .setDescription("💬 Chat channel renamed automatically by Roblox version")
    .addSubcommand(
      botChannelAddSub({
        description: "➕ Set up a chat channel renamed by Roblox version",
        channelDescription: "💬 Existing text channel to use",
        channelType: ChannelType.GuildText,
      }),
    )
    .addSubcommand(
      new SlashCommandSubcommandBuilder()
        .setName("remove")
        .setDescription("🗑️ Remove the bot chat channel"),
    )
    .addSubcommand(
      new SlashCommandSubcommandBuilder()
        .setName("list")
        .setDescription("📋 View the current bot chat channel settings"),
    )
    .addSubcommand(
      new SlashCommandSubcommandBuilder()
        .setName("refresh")
        .setDescription("🔄 Force-update the bot chat channel name immediately"),
    );
}

export const data = new SlashCommandBuilder()
  .setName("ex")
  .setDescription("🎛️ Manage the Executor tracking and status system")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommandGroup(trackGroup())
  .addSubcommandGroup(botVoiceGroup())
  .addSubcommandGroup(botChatGroup());
