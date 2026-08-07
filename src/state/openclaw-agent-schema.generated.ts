/**
 * This file was generated from the SQLite schema source.
 * Please do not edit it manually.
 */

export const OPENCLAW_AGENT_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS schema_meta (
  meta_key TEXT NOT NULL PRIMARY KEY,
  role TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  agent_id TEXT,
  app_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_entries (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  blob BLOB,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_agent_cache_expiry
  ON cache_entries(scope, expires_at, key)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_cache_updated
  ON cache_entries(scope, updated_at DESC, key);

CREATE TABLE IF NOT EXISTS auth_profile_store (
  store_key TEXT NOT NULL PRIMARY KEY,
  store_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_profile_state (
  state_key TEXT NOT NULL PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_index_sources (
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (path, source)
);

CREATE TABLE IF NOT EXISTS memory_index_chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_embedding_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dims INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, model, provider_key, hash)
);

CREATE TABLE IF NOT EXISTS memory_index_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL
);

INSERT OR IGNORE INTO memory_index_state (id, revision) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS memory_index_sources_revision_after_insert
AFTER INSERT ON memory_index_sources
BEGIN
  UPDATE memory_index_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS memory_index_sources_revision_after_update
AFTER UPDATE ON memory_index_sources
BEGIN
  UPDATE memory_index_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS memory_index_sources_revision_after_delete
AFTER DELETE ON memory_index_sources
BEGIN
  UPDATE memory_index_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS memory_index_chunks_revision_after_insert
AFTER INSERT ON memory_index_chunks
BEGIN
  UPDATE memory_index_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS memory_index_chunks_revision_after_update
AFTER UPDATE ON memory_index_chunks
BEGIN
  UPDATE memory_index_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS memory_index_chunks_revision_after_delete
AFTER DELETE ON memory_index_chunks
BEGIN
  UPDATE memory_index_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE INDEX IF NOT EXISTS idx_memory_embedding_cache_updated_at
  ON memory_embedding_cache(updated_at);

CREATE INDEX IF NOT EXISTS idx_memory_index_sources_source
  ON memory_index_sources(source);

CREATE INDEX IF NOT EXISTS idx_memory_index_chunks_path_source
  ON memory_index_chunks(path, source);

CREATE INDEX IF NOT EXISTS idx_memory_index_chunks_path
  ON memory_index_chunks(path);

CREATE INDEX IF NOT EXISTS idx_memory_index_chunks_source
  ON memory_index_chunks(source);

CREATE TABLE IF NOT EXISTS memory_channel_atoms (
  id TEXT NOT NULL PRIMARY KEY,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_channel_atoms_source_message
  ON memory_channel_atoms (
    provider,
    account_id,
    conversation_id,
    thread_key,
    message_id
  );

CREATE INDEX IF NOT EXISTS idx_memory_channel_atoms_conversation
  ON memory_channel_atoms (provider, conversation_id, received_at);

CREATE TABLE IF NOT EXISTS memory_channel_atom_sync_state (
  atom_id TEXT NOT NULL,
  index_identity_hash TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  chunk_path TEXT NOT NULL,
  chunk_hash TEXT NOT NULL,
  PRIMARY KEY (atom_id, index_identity_hash),
  FOREIGN KEY (atom_id) REFERENCES memory_channel_atoms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_channel_atom_sync_identity
  ON memory_channel_atom_sync_state (index_identity_hash, indexed_at);\n`;
