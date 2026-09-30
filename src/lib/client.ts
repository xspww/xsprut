import { Client, Collection, GatewayIntentBits, Options } from "discord.js";
import config from "./config";

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  // Required for the public `?ver` text command (message content). This is a
  // privileged intent — it must also be enabled in the Discord Developer
  // Portal (Bot > Privileged Gateway Intents > Message Content).
  GatewayIntentBits.MessageContent,
];

if (config.ENABLE_GUILD_MEMBERS_INTENT) {
  intents.push(GatewayIntentBits.GuildMembers);
}

export const client = new Client({
  intents,
  // RAM: this discord.js version only sweeps archived threads by default, so
  // every user / presence / reaction / voice state / message we ever fetch
  // stays cached forever and the heap grows slowly over time. Sweep those
  // caches every 10 minutes (10-minute lifetime). guildMembers is deliberately
  // NOT swept: the protect-room handler relies on `message.member` being
  // cached, and sweeping it would silently skip protections.
  sweepers: {
    ...Options.DefaultSweeperSettings,
    // Lifetime sweep for messages: keep recently-fetched messages (the embed
    // scheduler re-uses them), drop anything older than 10 minutes.
    messages: { interval: 600, lifetime: 600 },
    invites: { interval: 600, lifetime: 600 },
    // Everything else is re-fetchable from the API on demand — sweep hard
    // (filter is a factory returning the sweep predicate, per this discord.js
    // version's GlobalSweepFilter type).
    applicationCommands: { interval: 600, filter: () => () => true },
    bans: { interval: 600, filter: () => () => true },
    emojis: { interval: 600, filter: () => () => true },
    entitlements: { interval: 600, filter: () => () => true },
    presences: { interval: 600, filter: () => () => true },
    reactions: { interval: 600, filter: () => () => true },
    stageInstances: { interval: 600, filter: () => () => true },
    stickers: { interval: 600, filter: () => () => true },
    threadMembers: { interval: 600, filter: () => () => true },
    users: { interval: 600, filter: () => () => true },
    // NOTE: voiceStates is deliberately NOT swept. Voice states are
    // event-driven — there is no REST endpoint to re-fetch them from — and
    // `voiceChannel.members` is computed from `guild.voiceStates.cache`.
    // Sweeping them would empty `channel.members` for everyone currently in
    // the channel.
  },
});

client.commands = new Collection();

// Removed custom console overrides; use logger utility for formatted output.
