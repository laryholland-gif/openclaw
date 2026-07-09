// Per-agent SQLite storage for channel-context memory atoms.
//
// Channel atoms are supporting memory: they keep message provenance separate
// from curated memory and session transcripts so retrieval can rank them with
// a lower authority. This module owns deterministic identity, upsert, and
// basic lookup boundaries over the agent database.
import type { Insertable, Selectable } from "kysely";
import { sha256Hex } from "../infra/crypto-digest.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import type { DB as OpenClawAgentKyselyDatabase } from "./openclaw-agent-db.generated.js";
import type { OpenClawAgentDatabase } from "./openclaw-agent-db.js";

type ChannelAtomTable = OpenClawAgentKyselyDatabase["memory_channel_atoms"];
type ChannelAtomRow = Selectable<ChannelAtomTable>;
type ChannelAtomInsert = Insertable<ChannelAtomTable>;

type ChannelAtomDatabase = Pick<
  OpenClawAgentKyselyDatabase,
  "memory_channel_atoms" | "memory_channel_atom_sync_state"
>;

const NULL_THREAD_SENTINEL = "__none__";
const DEFAULT_AUTHORITY = "supporting";

function getChannelAtomKysely(db: OpenClawAgentDatabase["db"]) {
  return getNodeSqliteKysely<ChannelAtomDatabase>(db);
}

function normalizeThreadKey(threadId: string | null | undefined): string {
  const key = threadId ?? NULL_THREAD_SENTINEL;
  if (key.length === 0) {
    throw new Error("channel atom thread_key cannot be empty");
  }
  return key;
}

/** Build a deterministic atom id from the channel message identity. */
export function buildChannelAtomId(params: {
  provider: string;
  accountId?: string | null;
  conversationId: string;
  threadId?: string | null;
  messageId: string;
}): string {
  const canonical = {
    provider: params.provider,
    accountId: params.accountId ?? "",
    conversationId: params.conversationId,
    threadKey: normalizeThreadKey(params.threadId),
    messageId: params.messageId,
  };
  return `channel-atom:${sha256Hex(JSON.stringify(canonical))}`;
}

/** Input shape for storing one channel atom. */
export type ChannelAtomInput = {
  provider: string;
  surface: string;
  accountId?: string | null;
  conversationId: string;
  conversationAlias?: string | null;
  threadId?: string | null;
  messageId: string;
  senderId?: string | null;
  senderHandle?: string | null;
  senderDisplayName?: string | null;
  body: string;
  receivedAt: number;
  ingestedAt?: number;
  authority?: string;
  migrationGroupId?: string | null;
  aliasOf?: string | null;
};

function channelAtomInputToRow(input: ChannelAtomInput): ChannelAtomInsert {
  const now = Date.now();
  return {
    id: buildChannelAtomId(input),
    provider: input.provider,
    surface: input.surface,
    account_id: input.accountId ?? null,
    conversation_id: input.conversationId,
    conversation_alias: input.conversationAlias ?? null,
    thread_id: input.threadId ?? null,
    thread_key: normalizeThreadKey(input.threadId),
    message_id: input.messageId,
    sender_id: input.senderId ?? null,
    sender_handle: input.senderHandle ?? null,
    sender_display_name: input.senderDisplayName ?? null,
    body: input.body,
    received_at: input.receivedAt,
    ingested_at: input.ingestedAt ?? now,
    authority: input.authority ?? DEFAULT_AUTHORITY,
    migration_group_id: input.migrationGroupId ?? null,
    alias_of: input.aliasOf ?? null,
  };
}

/** Upsert a channel atom into the per-agent store and return its id. */
export function upsertChannelAtom(
  database: OpenClawAgentDatabase,
  input: ChannelAtomInput,
): string {
  const row = channelAtomInputToRow(input);
  const db = getChannelAtomKysely(database.db);
  executeSqliteQuerySync(
    database.db,
    db
      .insertInto("memory_channel_atoms")
      .values(row)
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          surface: row.surface,
          account_id: row.account_id,
          conversation_id: row.conversation_id,
          conversation_alias: row.conversation_alias,
          thread_id: row.thread_id,
          thread_key: row.thread_key,
          message_id: row.message_id,
          sender_id: row.sender_id,
          sender_handle: row.sender_handle,
          sender_display_name: row.sender_display_name,
          body: row.body,
          received_at: row.received_at,
          ingested_at: row.ingested_at,
          authority: row.authority,
          migration_group_id: row.migration_group_id,
          alias_of: row.alias_of,
          // Do not overwrite id or provider.
        }),
      ),
  );
  return row.id;
}

/** Read one channel atom by its deterministic id. */
export function getChannelAtomById(
  database: OpenClawAgentDatabase,
  id: string,
): ChannelAtomRow | undefined {
  const db = getChannelAtomKysely(database.db);
  return executeSqliteQueryTakeFirstSync(
    database.db,
    db.selectFrom("memory_channel_atoms").selectAll().where("id", "=", id),
  );
}

/** List channel atoms for one conversation, newest first. */
export function listChannelAtomsByConversation(
  database: OpenClawAgentDatabase,
  provider: string,
  conversationId: string,
  options: { limit?: number } = {},
): ChannelAtomRow[] {
  const db = getChannelAtomKysely(database.db);
  let query = db
    .selectFrom("memory_channel_atoms")
    .selectAll()
    .where("provider", "=", provider)
    .where("conversation_id", "=", conversationId)
    .orderBy("received_at", "desc");
  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }
  return executeSqliteQuerySync(database.db, query).rows;
}

/** Delete a channel atom by id. Sync state rows cascade via foreign key. */
export function deleteChannelAtomById(database: OpenClawAgentDatabase, id: string): void {
  const db = getChannelAtomKysely(database.db);
  executeSqliteQuerySync(database.db, db.deleteFrom("memory_channel_atoms").where("id", "=", id));
}
