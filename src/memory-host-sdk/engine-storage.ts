/**
 * Core-facing facade for memory backend storage config resolution. Keep this
 * path stable while the shared SDK package owns provider status semantics.
 */
export {
  MEMORY_SOURCE_CHANNEL_CONTEXT,
  MEMORY_SOURCE_MEMORY,
  MEMORY_SOURCE_SESSIONS,
  MEMORY_INDEX_CHUNKS_TABLE,
  MEMORY_INDEX_META_TABLE,
  MEMORY_INDEX_SOURCES_TABLE,
  MEMORY_SOURCES,
  resolveMemoryBackendConfig,
  type MemorySource,
  type MemoryProviderStatus,
} from "../../packages/memory-host-sdk/src/engine-storage.js";
