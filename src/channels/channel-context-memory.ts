// Records channel-context memory atoms through the owning per-agent SQLite store.
import { upsertChannelAtom, type ChannelAtomInput } from "../state/channel-atoms.store.js";
import { openOpenClawAgentDatabase } from "../state/openclaw-agent-db.js";

export type RecordChannelAtomParams = ChannelAtomInput & {
  agentId: string;
  env?: NodeJS.ProcessEnv;
};

export function recordChannelAtom(params: RecordChannelAtomParams): string {
  const { agentId, env, ...input } = params;
  const database = openOpenClawAgentDatabase({ agentId, env });
  return upsertChannelAtom(database, input);
}
