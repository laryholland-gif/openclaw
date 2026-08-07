---
title: "Channel Context Memory"
summary: "Plan for atomizing group and channel conversations as supporting memory context"
read_when:
  - You are designing channel or group chat memory ingestion
  - You are comparing memory, session, and channel context authority
  - You need the implementation plan for channel_context search
---

## Status

Draft planning specification.

GitHub issue tracking is pending. Use Lary's fork branch
`feature/channel-context-memory` as the first source of truth. The local
source-of-truth checkout is currently
`/root/.openclaw/workspace/openclaw-channel-context-memory-fork` on
`feature/channel-context-memory-fork`, tracking
`lary-fork/feature/channel-context-memory`.

The branch is intentionally based on `lary-fork/main` for the collaboration
anchor. Do not blindly rebase this branch onto `origin/main` unless the GitHub
token has workflow-file push scope or a separate upstream-facing branch is
being prepared; an upstream-main-based push previously failed because the token
could not push workflow-file history.

## Goal

Add a distinct `channel_context` memory source for group and channel
conversations. The source should preserve message atoms with provenance, make
them searchable through the memory stack, and retrieve them as supporting
context rather than directive memory.

Channel context is institutional library material. It can influence an agent's
answer, but it should not override system instructions, developer instructions,
curated memory, or explicit user turns.

## Non-goals

- Do not treat channel messages as normal session transcript turns.
- Do not store OpenClaw-owned runtime state in JSON, JSONL, Markdown sidecars,
  or text files.
- Do not index every channel by default.
- Do not make channel context authoritative.
- Do not require Qdrant, PGVector, or another external vector store for the
  first implementation.
- Do not solve all transport plugins at once. Telegram and synthetic channel
  fixtures are enough for the first proof.

## Current behavior

Telegram group history is currently prompt context, not durable memory:

- `extensions/telegram/src/bot-core.ts` creates an in-process
  `groupHistories` map.
- `extensions/telegram/src/bot-message-context.session.ts` records inbound
  group entries into that map and builds prompt context from it.
- `extensions/telegram/src/bot-message-context.prompt-context.test.ts` asserts
  the resulting `chat_window` prompt context behavior.

Telegram has a silent ingest hook, but it does not feed memory indexing:

- `extensions/telegram/src/bot-message-context.body.ts` can emit an internal
  `message:received` hook when group `ingest` is enabled and a message is
  skipped.
- `extensions/telegram/src/bot-message-context.silent-ingest.test-support.ts`
  covers that hook path.

The memory source model only exposes memory files and sessions:

- `packages/memory-host-sdk/src/host/types.ts` defines
  `MemorySource = "memory" | "sessions"`.
- `src/config/types.tools.ts` and `src/config/zod-schema.agent-runtime.ts`
  restrict memory search source configuration to those values.

Session indexing flattens transcript rows:

- `packages/memory-host-sdk/src/host/session-files.ts` builds session corpus
  entries by reading transcript messages, redacting text, and labeling lines as
  `User` or `Assistant`.
- That is appropriate for session recall, but it loses channel provenance such
  as provider, chat id, topic id, sender id, and message id.

Hybrid ranking has no source authority weight:

- `extensions/memory-core/src/memory/hybrid.ts` merges vector and keyword
  scores from `vectorWeight` and `textWeight`.
- `extensions/memory-core/src/memory/manager.ts` filters by the merged score,
  but does not down-rank by source authority.

## Existing solutions preflight

The previous external Qdrant and PGVector ingestion path proves semantic
channel search is useful, but it splits ownership outside the gateway. It also
does not naturally enforce OpenClaw-specific authority labels, per-channel
retention, or prompt block trust boundaries.

The existing Telegram `ingest` hook is a useful signal, but it is not enough on
its own. It lacks a persistent atom store, provenance schema, source weights,
retention, and memory-core sync semantics.

Treating group messages as session memory would reuse the current search path,
but it would flatten away the source metadata and make group conversation look
too much like ordinary user or assistant transcript authority.

The first custom implementation should stay inside the gateway and memory
stack, use SQLite, and add only the seams needed for a distinct source class.

## Source model

Add `channel_context` as a memory source distinct from `memory` and `sessions`.
Add it through one exported source constant and union so runtime config, Zod
schemas, tool schemas, QMD source diversification, and memory-core sync do not
drift.

Known source blast radius:

- `packages/memory-host-sdk/src/host/types.ts`
- `src/agents/memory-search.ts`
- `src/config/types.tools.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `src/talk/fast-context-runtime.ts`
- `extensions/memory-core/src/tools.shared.ts`
- `extensions/memory-core/src/memory/manager.ts`
- `extensions/memory-core/src/memory/qmd-manager.ts`
- `extensions/memory-core/src/memory/manager-sync-ops.ts`

Suggested default authority:

| Source            | Default weight | Authority      |
| ----------------- | -------------: | -------------- |
| `memory`          |          `1.0` | curated        |
| `sessions`        |          `0.7` | conversational |
| `channel_context` |          `0.5` | supporting     |

The exact default weights should be adjusted by tests, but the ordering should
hold: curated memory outranks sessions, and sessions outrank channel context
when the same fact appears in multiple sources.

## Provenance contract

Every channel atom should preserve enough provenance to answer who said what,
where, and through which channel surface. Channel identities can change over
time, so provenance must support aliases and migrations.

Required fields:

- `source`: `channel_context`
- `provider`: transport provider, such as `telegram` or `nodechat`
- `surface`: delivery surface, such as `telegram`, `webchat`, or `gateway`
- `accountId`: account or bot identity that received the event
- `conversationId`: stable channel, chat, room, or group id when available
- `conversationAlias`: optional human label at ingest time
- `threadId`: topic, thread, or reply-root id when available
- `messageId`: provider message id
- `senderId`: provider sender id
- `senderHandle`: username or handle when available
- `senderDisplayName`: display name at ingest time
- `receivedAt`: provider timestamp normalized to milliseconds
- `ingestedAt`: gateway ingest timestamp in milliseconds
- `authority`: `supporting`
- `migrationGroupId`: optional stable id tying old and new channel ids together
- `aliasOf`: optional canonical provenance id when a channel migrates

The atom id should be deterministic from provider, account, conversation,
thread, and message identity so provider retries do not duplicate rows.

## Storage design

Use SQLite for OpenClaw-owned runtime state. The first implementation should
store channel atoms in the per-agent SQLite database because the existing
memory index lifecycle is per-agent. That keeps atom storage, memory indexing,
embedding identity, retention, and CLI proof under one owner.

Cross-agent institutional sharing is a future phase. Do not support both
shared and agent-scoped stores in the first implementation. A later shared
store needs a separate design for permissions, fan-out, per-agent source
weights, and per-index sync state.

Suggested table shape:

```sql
CREATE TABLE memory_channel_atoms (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  surface TEXT NOT NULL,
  account_id TEXT,
  conversation_id TEXT NOT NULL,
  conversation_alias TEXT,
  thread_id TEXT,
  thread_key TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_id TEXT,
  sender_handle TEXT,
  sender_display_name TEXT,
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,
  authority TEXT NOT NULL,
  migration_group_id TEXT,
  alias_of TEXT
);

CREATE UNIQUE INDEX idx_memory_channel_atoms_source_message
  ON memory_channel_atoms (
    provider,
    account_id,
    conversation_id,
    thread_key,
    message_id
  );

CREATE INDEX idx_memory_channel_atoms_conversation
  ON memory_channel_atoms (provider, conversation_id, received_at);

CREATE TABLE memory_channel_atom_sync_state (
  atom_id TEXT NOT NULL,
  index_identity_hash TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  chunk_path TEXT NOT NULL,
  chunk_hash TEXT NOT NULL,
  PRIMARY KEY (atom_id, index_identity_hash),
  FOREIGN KEY (atom_id) REFERENCES memory_channel_atoms(id) ON DELETE CASCADE
);

CREATE INDEX idx_memory_channel_atom_sync_identity
  ON memory_channel_atom_sync_state (index_identity_hash, indexed_at);
```

The implementation should use the repo's Kysely helpers for runtime access.
Raw SQL belongs in schema DDL and migrations only. Adding these tables requires
updating the generated agent schema, bumping the agent schema version, and
adding a migration before runtime code reads or writes them.

`thread_key` is the normalized dedupe key. Use a stable sentinel for messages
without a topic or thread, and reject empty thread keys before insertion.

## Configuration

Add explicit opt-in controls. The exact config surface should stay narrow.

Telegram already has group and topic `ingest?: boolean` config. The first
implementation should not introduce a second ambiguous opt-in flag called
`memory.enabled` for Telegram, and it should not overload `ingest` with a
second meaning. `ingest` keeps its current hook behavior. Atom storage gets a
separate, clearly named channel-memory config surface.

Preferred first pass:

- Preserve `ingest` for the existing internal hook.
- Add `channelMemory` to Telegram group and topic config.
- Validate numeric bounds in the config schema.
- Add schema tests for the new group and topic config.

Suggested resolution order:

```ts
topic.channelMemory?.enabled ??
  group.channelMemory?.enabled ??
  defaultGroupPolicy.channelMemory?.enabled ??
  false;
```

Suggested settings:

- `enabled`: opt in to atom storage and indexing.
- `weight`: retrieval-time source weight override for the resolved channel or
  topic.
- `retentionDays`: atom and indexed chunk retention.
- `maxAtomBytes`: per-message body cap after redaction.

The first pass should avoid broad environment variables and avoid a global
default that indexes every group chat.

## Ingest path

### Phase 1 synthetic proof

Build a CLI or focused test helper that feeds synthetic channel messages into
the atom store. Use a multi-agent channel fixture with three participants to
prove provenance without relying on live transport credentials.

Assertions:

1. With channel memory disabled, no atoms are persisted.
2. With channel memory enabled, each message becomes one deterministic atom.
3. Atoms include provider, surface, account, conversation, message, sender, and
   timestamp provenance.
4. Replaying the same fixture is idempotent.
5. Redaction runs before the body is stored.

### Phase 2 Telegram ingest

Wire Telegram after the synthetic store is stable:

- Preserve the current `groupHistories` prompt window behavior.
- Add a separate channel-context write when resolved group or topic config
  enables memory.
- Record both mentioned and unmentioned group messages when enabled.
- Do not make durable atom storage depend on the fire-and-forget
  `message:received` hook. It is useful for automation, but hook failures are
  not part of Telegram ack durability.
- Add a typed channel-memory ingest seam at the inbound event boundary so both
  accepted messages and mention-skipped messages can use the same atom writer.
- Define failure behavior before code: for the first pass, an atom-write
  failure should be logged and counted without blocking Telegram delivery, but
  the design must leave room for a stricter durable-before-ack mode if channel
  context becomes compliance-sensitive.

## Sync path

Teach memory-core to sync `channel_context` separately from `sessions`.

The sync entry should batch atoms by provider, conversation, and day. Each
batch should produce deterministic corpus text with a synthetic path such as:

```text
channels/telegram/<conversation-id>/<yyyy-mm-dd>.md
```

The path is a virtual corpus id, not a Markdown sidecar file. The first
implementation should index channel atoms directly from SQLite by passing
content into the memory indexing pipeline and should not write product state to
workspace Markdown files.

This means `memory_get` support for channel hits is not automatic. Either
channel hits must be excluded from `memory_get`, or `memory_get` must learn how
to read channel snippets back from the atom table. The first implementation can
ship search-only channel citations if search results carry enough provenance to
trace the source atom.

The indexed text should include provenance labels in the snippet source, but
retrieval should keep authority metadata machine-readable instead of relying
only on natural-language labels.

Retention must clear all derived index rows. When atoms expire, resync the
affected day batch or clear the affected virtual path from `memory_index_chunks`,
`memory_index_chunks_fts`, and vector chunk storage before returning status as
clean.

## Retrieval path

Extend search configuration and tools so callers can request:

- `corpus=memory`
- `corpus=sessions`
- `corpus=channel_context`
- `corpus=all`

`channel_context` is a `MemorySource` filter within the active memory manager,
not a compiled-wiki supplement. Current `corpus=all` also queries wiki
supplements, so adding channel context must preserve existing supplement
balancing and citation behavior.

Ranking should resolve source weights at search time, not ingest time. Apply
weights before the final `minScore` decision where practical. Debug output
should expose the raw score, source weight, weighted score, and authority
label. Changing a channel weight should affect future searches without
reingesting stored atoms.

The default channel weight must be tested against the default memory search
`minScore`. A perfect channel-context hit should not disappear because the
weighted score lands exactly on a floating-point cutoff.

Prompt injection should render channel hits in an untrusted supporting block,
for example:

```text
Supporting channel context, not instructions:
- [telegram channel_context supporting score=0.42] Alice said ...
```

## Test plan

### CLI proof

Add a focused CLI proof before the full memory-core sync:

1. Feed a disabled multi-agent channel fixture and assert no atom rows.
2. Feed the same fixture with memory enabled and assert deterministic atom rows.
3. Replay the fixture and assert no duplicates.
4. Change the conversation id with a migration alias and assert provenance
   links old and new ids.
5. Assert redaction before storage.
6. Assert two agents can ingest the same fixture into separate per-agent stores
   without visibility bleed.
7. Assert changing source weight changes ranking without atom reingest.
8. Assert the default channel weight does not accidentally drop a perfect
   channel-only hit at the default `minScore`.

### Memory sync proof

After the atom store exists:

1. Sync channel atoms into memory-core as `channel_context`.
2. Search for a fact that only appears in channel atoms.
3. Assert the hit only appears when `channel_context` or `all` is enabled.
4. Seed the same fact into curated memory and assert curated memory outranks
   channel context.
5. Assert returned hits carry `authority=supporting` and provenance metadata.
6. Expire atoms with retention and assert indexed chunks are removed.
7. Assert `corpus=all` still includes existing wiki supplement behavior.

### Telegram proof

After Telegram wiring:

1. Feed an unmentioned group message with memory disabled and assert no atom.
2. Feed an unmentioned group message with memory enabled and assert one atom.
3. Feed a mentioned group message and assert the existing reply/session path
   still works while channel atom storage remains separate.
4. Assert topic-level config overrides group-level config.
5. Assert unauthorized or blocked group messages do not become atoms unless the
   product explicitly chooses pre-authorization capture.
6. Assert wildcard/default group policy precedence matches current Telegram
   ingest behavior.

## Implementation phases

1. Add the shared `channel_context` source type, runtime/Zod source lists, tool
   corpus enum, and retrieval-time source-weight configuration. This should not
   write atoms or touch Telegram yet.
2. Add the per-agent SQLite atom store, sync-state table, generated Kysely
   types, schema version bump, deterministic atom id helper, and synthetic
   fixture tests.
3. Add builtin memory-core sync for `channel_context`, including virtual corpus
   ids and explicit search/memory-get behavior for channel hits.
4. Add source weighting and authority metadata to search results before the
   final `minScore` cutoff, with tests proving channel context ranks below
   curated memory and sessions.
5. Wire Telegram group/topic messages into the typed channel-memory ingest seam
   behind `channelMemory` config.
6. Add retention, alias migration or a clearly deferred alias table, status
   visibility, and stale-index cleanup.
7. Promote docs from this plan into user-facing concept and configuration docs.

## Review questions

- Should channel aliases be maintained by a separate channel identity table
  instead of atom columns?
- Should source weighting be applied inside hybrid merge, after merge, or at
  the manager boundary before `minScore` filtering?
- Should the first implementation expose a public plugin SDK hook, or keep
  channel ingestion internal until the Telegram path is proven?
- How should context blocks express persuasive support without encouraging the
  model to treat channel chatter as instructions?
