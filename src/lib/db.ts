import Database from "better-sqlite3";
import path from "path";
import logger from "./logger";

const db = new Database(path.join(__dirname, "../../data.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS alerts (
    channelId TEXT NOT NULL,
    guildId TEXT NOT NULL,
    robloxChannel TEXT NOT NULL,
    customContent TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    
    PRIMARY KEY (channelId, robloxChannel)
);

CREATE TABLE IF NOT EXISTS knownVersions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    robloxChannel TEXT NOT NULL,
    released BOOLEAN NOT NULL DEFAULT 0,
    detectedAt INTEGER NOT NULL,
    UNIQUE(hash, robloxChannel)
);

CREATE TABLE IF NOT EXISTS channelState (
    robloxChannel TEXT PRIMARY KEY,
    currentVersion TEXT NOT NULL,
    previousVersion TEXT,
    version TEXT
);

CREATE TABLE IF NOT EXISTS executorStatusChannels (
    guildId TEXT NOT NULL,
    categoryId TEXT NOT NULL,
    executorName TEXT NOT NULL,
    displayName TEXT NOT NULL,
    voiceChannelId TEXT,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    updatedAt INTEGER,

    PRIMARY KEY (guildId, executorName)
);

CREATE TABLE IF NOT EXISTS executorAlerts (
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    executorName TEXT NOT NULL,
    displayName TEXT NOT NULL,
    customContent TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT 1,

    PRIMARY KEY (guildId, channelId, executorName)
);

CREATE TABLE IF NOT EXISTS executorLastState (
    title TEXT PRIMARY KEY,
    version TEXT,
    status TEXT,
    lastAlertedVersion TEXT,
    updatedAt INTEGER
);

CREATE TABLE IF NOT EXISTS executorChatStatusChannels (
    guildId TEXT NOT NULL,
    categoryId TEXT NOT NULL,
    executorName TEXT NOT NULL,
    displayName TEXT NOT NULL,
    channelId TEXT,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    updatedAt INTEGER,

    PRIMARY KEY (guildId, executorName)
);

CREATE TABLE IF NOT EXISTS executorEmbedStatusChannels (
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    messageId TEXT,
    executorName TEXT NOT NULL,
    displayName TEXT NOT NULL,
    customContent TEXT NOT NULL DEFAULT '',
    intervalMs INTEGER NOT NULL DEFAULT 60000,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    updatedAt INTEGER,

    PRIMARY KEY (guildId, channelId, executorName)
);

CREATE TABLE IF NOT EXISTS botVoiceChannels (
    guildId TEXT PRIMARY KEY,
    categoryId TEXT,
    voiceChannelId TEXT,
    mode TEXT NOT NULL DEFAULT 'custom',
    displayName TEXT NOT NULL DEFAULT 'Bot Online',
    robloxChannel TEXT NOT NULL DEFAULT 'LIVE',
    enabled BOOLEAN NOT NULL DEFAULT 1,
    omitPrefix BOOLEAN NOT NULL DEFAULT 0,
    updatedAt INTEGER
);

CREATE TABLE IF NOT EXISTS botChatChannels (
    guildId TEXT PRIMARY KEY,
    categoryId TEXT,
    channelId TEXT,
    mode TEXT NOT NULL DEFAULT 'roblox-version',
    displayName TEXT NOT NULL DEFAULT 'Bot Online',
    robloxChannel TEXT NOT NULL DEFAULT 'LIVE',
    enabled BOOLEAN NOT NULL DEFAULT 1,
    omitPrefix BOOLEAN NOT NULL DEFAULT 0,
    updatedAt INTEGER
);

CREATE TABLE IF NOT EXISTS memberJoinAlerts (
    guildId TEXT PRIMARY KEY,
    channelId TEXT NOT NULL,
    customMessage TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS botStatus (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    activityText TEXT NOT NULL,
    streamUrl TEXT NOT NULL,
    customStatus TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT 1
);

-- Rotating bot presence: one row per status message. The bot shows each
-- message for its own intervalMs, then cycles to the next one.
CREATE TABLE IF NOT EXISTS botStatusMessages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activityText TEXT NOT NULL,
    streamUrl TEXT NOT NULL,
    customStatus TEXT NOT NULL DEFAULT '',
    intervalMs INTEGER NOT NULL DEFAULT 60000,
    enabled BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS protectedRooms (
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    actionType TEXT NOT NULL DEFAULT 'ban',
    timeoutDuration INTEGER DEFAULT 3600,
    noticeMessageId TEXT,
    actionCount INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    PRIMARY KEY (guildId, channelId)
);

CREATE TABLE IF NOT EXISTS messageLog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channelId TEXT NOT NULL,
    userId TEXT NOT NULL,
    messageId TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    UNIQUE(messageId)
);


CREATE TABLE IF NOT EXISTS verificationConfig (
    guildId TEXT PRIMARY KEY,
    channelId TEXT NOT NULL,
    verifiedRoleId TEXT NOT NULL,
    unverifiedRoleId TEXT,
    embedTitle TEXT NOT NULL DEFAULT 'Verify yourself',
    embedDescription TEXT NOT NULL DEFAULT 'Click the button below and solve the short captcha to unlock the server.',
    successMessage TEXT NOT NULL DEFAULT 'You''re verified. Welcome to {server}!',
    enabled BOOLEAN NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS allowedBots (
    guildId TEXT NOT NULL,
    botId TEXT NOT NULL,
    addedBy TEXT NOT NULL,
    addedAt INTEGER NOT NULL,
    PRIMARY KEY (guildId, botId)
);

CREATE INDEX IF NOT EXISTS idx_knownVersions_robloxChannel
ON knownVersions (robloxChannel);

CREATE INDEX IF NOT EXISTS idx_messageLog_userId_timestamp
ON messageLog (userId, timestamp);
`);

// Migration for channelState
const prevVersionExists = db
  .prepare(
    `SELECT 1 FROM pragma_table_info('channelState') WHERE name = 'previousVersion'`,
  )
  .get();

if (!prevVersionExists) {
  db.exec(`ALTER TABLE channelState ADD COLUMN previousVersion TEXT;`);
  logger.info("Updated channelState table");
}

// Migration for channelState: store the numeric Roblox version (e.g.
// "0.737.0.7371584") next to the clientVersionUpload hash so readers don't
// have to re-fetch it. Nullable — older rows and WEAO-fallback hashes may
// not have one.
const channelVersionExists = db
  .prepare(
    `SELECT 1 FROM pragma_table_info('channelState') WHERE name = 'version'`,
  )
  .get();

if (!channelVersionExists) {
  db.exec(`ALTER TABLE channelState ADD COLUMN version TEXT;`);
  logger.info("Added version column to channelState");
}

// Migration for executorLastState: add lastAlertedVersion if missing
const lastAlertedExists = db
  .prepare(
    `SELECT 1 FROM pragma_table_info('executorLastState') WHERE name = 'lastAlertedVersion'`,
  )
  .get();

if (!lastAlertedExists) {
  try {
    db.exec(`ALTER TABLE executorLastState ADD COLUMN lastAlertedVersion TEXT;`);
  } catch {}
}

const execAlertsCustomContentExists = db
  .prepare(`SELECT 1 FROM pragma_table_info('executorAlerts') WHERE name = 'customContent'`)
  .get();

if (!execAlertsCustomContentExists) {
  try {
    db.exec(`ALTER TABLE executorAlerts ADD COLUMN customContent TEXT NOT NULL DEFAULT ''`);
    logger.info('Added customContent column to executorAlerts');
  } catch (e) {
    logger.error('Failed to add customContent column to executorAlerts', e);
  }
}

// Migration for botStatus: add customStatus column if missing
const botStatusCustomStatusExists = db
  .prepare(`SELECT 1 FROM pragma_table_info('botStatus') WHERE name = 'customStatus'`)
  .get();

if (!botStatusCustomStatusExists) {
  try {
    db.exec(`ALTER TABLE botStatus ADD COLUMN customStatus TEXT NOT NULL DEFAULT ''`);
    logger.info('Added customStatus column to botStatus');
  } catch (e) {
    logger.error('Failed to add customStatus column to botStatus', e);
  }
}

// Migration: move the legacy single botStatus row into the rotating
// botStatusMessages list so existing /status configs keep working after the
// switch to multi-message rotation. The legacy row is deleted afterwards so a
// later reset + restart cannot re-import it.
try {
  const legacyStatus = db
    .prepare(`SELECT 1 FROM botStatus WHERE id = 1 AND enabled = 1`)
    .get();
  const rotationCount = db
    .prepare(`SELECT COUNT(*) AS c FROM botStatusMessages`)
    .get() as { c: number };

  if (legacyStatus && rotationCount.c === 0) {
    db.exec(`
      INSERT INTO botStatusMessages (activityText, streamUrl, customStatus, intervalMs, enabled)
      SELECT activityText, streamUrl, customStatus, 60000, enabled
      FROM botStatus
      WHERE id = 1 AND enabled = 1;

      DELETE FROM botStatus WHERE id = 1;
    `);
    logger.info("Migrated legacy bot status into the rotating status list");
  }
} catch (e) {
  logger.error("Failed to migrate legacy botStatus into botStatusMessages:", e);
}

// Migration for executorChatStatusChannels: add categoryId if missing / update table schema
const chatStatusCategoryIdExists = db
  .prepare(
    `SELECT 1 FROM pragma_table_info('executorChatStatusChannels') WHERE name = 'categoryId'`,
  )
  .get();

if (!chatStatusCategoryIdExists) {
  try {
    db.exec(`
      DROP TABLE IF EXISTS executorChatStatusChannels;
      CREATE TABLE IF NOT EXISTS executorChatStatusChannels (
          guildId TEXT NOT NULL,
          categoryId TEXT NOT NULL,
          executorName TEXT NOT NULL,
          displayName TEXT NOT NULL,
          channelId TEXT,
          enabled BOOLEAN NOT NULL DEFAULT 1,
          updatedAt INTEGER,
          PRIMARY KEY (guildId, executorName)
      );
    `);
    logger.info("Updated executorChatStatusChannels table schema with categoryId column");
  } catch (e) {
    logger.error("Failed to migrate executorChatStatusChannels:", e);
  }
}

// Migration for botVoiceChannels: ensure categoryId is nullable and add omitPrefix column if missing
const botVoicePragmaRows = db.prepare(`PRAGMA table_info('botVoiceChannels')`).all() as any[];
const botVoiceCategoryInfo = botVoicePragmaRows.find(r => r && r.name === 'categoryId');
const botVoiceOmitInfo = botVoicePragmaRows.find(r => r && r.name === 'omitPrefix');

// If categoryId column is missing, create the table (fresh schema)
if (!botVoiceCategoryInfo) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS botVoiceChannels (
          guildId TEXT PRIMARY KEY,
          categoryId TEXT,
          voiceChannelId TEXT,
          mode TEXT NOT NULL DEFAULT 'custom',
          displayName TEXT NOT NULL DEFAULT 'Bot Online',
          robloxChannel TEXT NOT NULL DEFAULT 'LIVE',
          enabled BOOLEAN NOT NULL DEFAULT 1,
          omitPrefix BOOLEAN NOT NULL DEFAULT 0,
          updatedAt INTEGER
      );
    `);
    logger.info("Created botVoiceChannels table with nullable categoryId and omitPrefix");
  } catch (e) {
    logger.error("Failed to create botVoiceChannels:", e);
  }
} else if (botVoiceCategoryInfo.notnull === 1 || !botVoiceOmitInfo) {
  // Column exists but categoryId is NOT NULL, or omitPrefix is missing — recreate table to make categoryId nullable and add omitPrefix
  try {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(`DROP TABLE IF EXISTS botVoiceChannels_new;`);
    db.exec(`
      CREATE TABLE botVoiceChannels_new (
          guildId TEXT PRIMARY KEY,
          categoryId TEXT,
          voiceChannelId TEXT,
          mode TEXT NOT NULL DEFAULT 'custom',
          displayName TEXT NOT NULL DEFAULT 'Bot Online',
          robloxChannel TEXT NOT NULL DEFAULT 'LIVE',
          enabled BOOLEAN NOT NULL DEFAULT 1,
          omitPrefix BOOLEAN NOT NULL DEFAULT 0,
          updatedAt INTEGER
      );
    `);

    // Copy data over; if omitPrefix didn't exist, default to 0
    if (!botVoiceOmitInfo) {
      db.exec(`
        INSERT INTO botVoiceChannels_new (guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, enabled, omitPrefix, updatedAt)
        SELECT guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, enabled, 0, updatedAt FROM botVoiceChannels;
        DROP TABLE botVoiceChannels;
        ALTER TABLE botVoiceChannels_new RENAME TO botVoiceChannels;
      `);
    } else {
      db.exec(`
        INSERT INTO botVoiceChannels_new (guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, enabled, omitPrefix, updatedAt)
        SELECT guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, enabled, COALESCE(omitPrefix, 0), updatedAt FROM botVoiceChannels;
        DROP TABLE botVoiceChannels;
        ALTER TABLE botVoiceChannels_new RENAME TO botVoiceChannels;
      `);
    }

    db.exec("PRAGMA foreign_keys = ON;");
    logger.info("Migrated botVoiceChannels table to allow nullable categoryId and added omitPrefix column");
  } catch (e) {
    logger.error("Failed to migrate botVoiceChannels:", e);
  }
}

// Migration for protectedRooms: add actionType and timeoutDuration columns if missing
const protectedRoomsPragmaRows = db.prepare(`PRAGMA table_info('protectedRooms')`).all() as any[];
const actionTypeExists = protectedRoomsPragmaRows.find(r => r && r.name === 'actionType');
const timeoutDurationExists = protectedRoomsPragmaRows.find(r => r && r.name === 'timeoutDuration');

if (!actionTypeExists || !timeoutDurationExists) {
  try {
    if (!actionTypeExists) {
      db.exec(`ALTER TABLE protectedRooms ADD COLUMN actionType TEXT NOT NULL DEFAULT 'ban';`);
    }
    if (!timeoutDurationExists) {
      db.exec(`ALTER TABLE protectedRooms ADD COLUMN timeoutDuration INTEGER DEFAULT 3600;`);
    }
    logger.info("Updated protectedRooms table with actionType and timeoutDuration columns");
  } catch (e) {
    logger.error("Failed to migrate protectedRooms:", e);
  }
}

// Migration for protectedRooms: add noticeMessageId and actionCount columns if missing
const noticeMessageIdExists = db
  .prepare(`SELECT 1 FROM pragma_table_info('protectedRooms') WHERE name = 'noticeMessageId'`)
  .get();

const actionCountExists = db
  .prepare(`SELECT 1 FROM pragma_table_info('protectedRooms') WHERE name = 'actionCount'`)
  .get();

if (!noticeMessageIdExists || !actionCountExists) {
  try {
    if (!noticeMessageIdExists) {
      db.exec(`ALTER TABLE protectedRooms ADD COLUMN noticeMessageId TEXT;`);
    }
    if (!actionCountExists) {
      db.exec(`ALTER TABLE protectedRooms ADD COLUMN actionCount INTEGER NOT NULL DEFAULT 0;`);
    }
    logger.info("Updated protectedRooms table with noticeMessageId and actionCount columns");
  } catch (e) {
    logger.error("Failed to migrate protectedRooms (noticeMessageId/actionCount):", e);
  }
}

// Migration for executorEmbedStatusChannels: add intervalMs column if missing
const embedIntervalExists = db
  .prepare(`SELECT 1 FROM pragma_table_info('executorEmbedStatusChannels') WHERE name = 'intervalMs'`)
  .get();

if (!embedIntervalExists) {
  try {
    db.exec(`ALTER TABLE executorEmbedStatusChannels ADD COLUMN intervalMs INTEGER NOT NULL DEFAULT 60000;`);
    logger.info("Added intervalMs column to executorEmbedStatusChannels");
  } catch (e) {
    logger.error("Failed to migrate executorEmbedStatusChannels (intervalMs):", e);
  }
}

// Music system removed — drop the leftover musicPanels table if present.
try {
  db.exec(`DROP TABLE IF EXISTS musicPanels;`);
} catch (e) {
  logger.error("Failed to drop musicPanels table:", e);
}

// Lockdown feature removed — drop the leftover lockdowns table if present.
try {
  db.exec(`DROP TABLE IF EXISTS lockdowns;`);
} catch (e) {
  logger.error("Failed to drop lockdowns table:", e);
}

// ─── Prepared-statement cache ──────────────────────────────────────────────
// Hot paths (every message, every monitoring tick) call db.prepare() with the
// same SQL over and over. better-sqlite3 does not memoize prepare() itself, so
// we cache Statement objects by SQL — Statements are immutable and safe to
// reuse, and this removes the native allocation/parse cost per call.
const statementCache = new Map<string, import("better-sqlite3").Statement>();
const originalPrepare = db.prepare.bind(db);
(db as any).prepare = (sql: string) => {
  let stmt = statementCache.get(sql);
  if (!stmt) {
    stmt = originalPrepare(sql);
    statementCache.set(sql, stmt);
  }
  return stmt;
};

export default db;


