// Channel atom SQLite store tests cover deterministic identity, upsert
// idempotence, conversation lookup, and cascade delete into sync state.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import {
  buildChannelAtomId,
  deleteChannelAtomById,
  getChannelAtomById,
  listChannelAtomsByConversation,
  upsertChannelAtom,
  type ChannelAtomInput,
} from "./channel-atoms.store.js";
import type { DB as OpenClawAgentKyselyDatabase } from "./openclaw-agent-db.generated.js";
import {
  closeOpenClawAgentDatabasesForTest,
  openOpenClawAgentDatabase,
  type OpenClawAgentDatabase,
} from "./openclaw-agent-db.js";

function createAtomInput(overrides: Partial<ChannelAtomInput> = {}): ChannelAtomInput {
  return {
    provider: "telegram",
    surface: "telegram",
    accountId: "bot-1",
    conversationId: "chat-1",
    threadId: "topic-1",
    messageId: "msg-1",
    senderId: "user-1",
    senderHandle: "alice",
    senderDisplayName: "Alice",
    body: "hello channel",
    receivedAt: 1_000,
    ingestedAt: 1_001,
    ...overrides,
  };
}

describe("channel atom store", () => {
  let tempStateDir: string;
  let database: OpenClawAgentDatabase;

  beforeEach(() => {
    tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-atoms-"));
    database = openOpenClawAgentDatabase({
      agentId: "channel-agent",
      env: { OPENCLAW_STATE_DIR: tempStateDir },
    });
  });

  afterEach(() => {
    closeOpenClawAgentDatabasesForTest();
    fs.rmSync(tempStateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("upserts and retrieves a channel atom", () => {
    const input = createAtomInput();
    const id = upsertChannelAtom(database, input);

    expect(id).toBe(buildChannelAtomId(input));
    const row = getChannelAtomById(database, id);
    expect(row).toMatchObject({
      id,
      provider: "telegram",
      surface: "telegram",
      account_id: "bot-1",
      conversation_id: "chat-1",
      thread_id: "topic-1",
      thread_key: "topic-1",
      message_id: "msg-1",
      sender_id: "user-1",
      sender_handle: "alice",
      sender_display_name: "Alice",
      body: "hello channel",
      received_at: 1_000,
      ingested_at: 1_001,
      authority: "supporting",
    });
  });

  it("uses a stable sentinel for messages without a thread", () => {
    const input = createAtomInput({ threadId: undefined, messageId: "msg-no-thread" });
    const id = upsertChannelAtom(database, input);

    const row = getChannelAtomById(database, id);
    expect(row?.thread_id).toBeNull();
    expect(row?.thread_key).toBe("__none__");
  });

  it("rejects an empty thread id", () => {
    expect(() => upsertChannelAtom(database, createAtomInput({ threadId: "" }))).toThrow(
      /thread_key cannot be empty/,
    );
  });

  it("is idempotent across replays", () => {
    const input = createAtomInput();
    upsertChannelAtom(database, input);
    upsertChannelAtom(database, { ...input, body: "updated body" });

    const rows = listChannelAtomsByConversation(database, "telegram", "chat-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("updated body");
  });

  it("lists atoms for a conversation newest first", () => {
    upsertChannelAtom(database, createAtomInput({ messageId: "msg-a", receivedAt: 2_000 }));
    upsertChannelAtom(database, createAtomInput({ messageId: "msg-b", receivedAt: 3_000 }));
    upsertChannelAtom(
      database,
      createAtomInput({ conversationId: "chat-2", messageId: "msg-c", receivedAt: 4_000 }),
    );

    const rows = listChannelAtomsByConversation(database, "telegram", "chat-1");
    expect(rows.map((row) => row.message_id)).toEqual(["msg-b", "msg-a"]);
  });

  it("limits conversation lists", () => {
    upsertChannelAtom(database, createAtomInput({ messageId: "msg-a", receivedAt: 2_000 }));
    upsertChannelAtom(database, createAtomInput({ messageId: "msg-b", receivedAt: 3_000 }));

    expect(
      listChannelAtomsByConversation(database, "telegram", "chat-1", { limit: 1 }),
    ).toHaveLength(1);
  });

  it("cascades deletes to sync state rows", () => {
    const input = createAtomInput();
    const id = upsertChannelAtom(database, input);

    const db = getNodeSqliteKysely<
      Pick<OpenClawAgentKyselyDatabase, "memory_channel_atom_sync_state">
    >(database.db);
    executeSqliteQuerySync(
      database.db,
      db.insertInto("memory_channel_atom_sync_state").values({
        atom_id: id,
        index_identity_hash: "index-1",
        indexed_at: 1_000,
        chunk_path: "channels/telegram/chat-1/1970-01-01.md",
        chunk_hash: "hash-1",
      }),
    );

    expect(
      executeSqliteQuerySync(
        database.db,
        db
          .selectFrom("memory_channel_atom_sync_state")
          .select(({ fn }) => fn.countAll().as("count")),
      ).rows[0]?.count,
    ).toBe(1);

    deleteChannelAtomById(database, id);

    expect(getChannelAtomById(database, id)).toBeUndefined();
    expect(
      executeSqliteQuerySync(
        database.db,
        db
          .selectFrom("memory_channel_atom_sync_state")
          .select(({ fn }) => fn.countAll().as("count")),
      ).rows[0]?.count,
    ).toBe(0);
  });

  it("migrates an existing v1 agent database to v2 with channel atom tables", () => {
    closeOpenClawAgentDatabasesForTest();
    const databasePath = path.join(
      tempStateDir,
      "agents",
      "legacy-agent",
      "agent",
      "openclaw-agent.sqlite",
    );
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const sqlite = requireNodeSqlite();
    const legacyDb = new sqlite.DatabaseSync(databasePath);
    legacyDb.exec("PRAGMA user_version = 1;");
    legacyDb.close();

    const legacyDatabase = openOpenClawAgentDatabase({
      agentId: "legacy-agent",
      env: { OPENCLAW_STATE_DIR: tempStateDir },
    });

    const userVersion = legacyDatabase.db.prepare("PRAGMA user_version").get() as
      | { user_version?: number }
      | undefined;
    expect(userVersion?.user_version).toBe(2);

    const atomRow = getChannelAtomById(legacyDatabase, "no-such-id");
    expect(atomRow).toBeUndefined();
  });
});
