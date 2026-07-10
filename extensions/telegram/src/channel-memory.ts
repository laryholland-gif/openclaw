// Telegram channel-memory capture stays opt-in so high-volume chats do not
// silently become durable memory sources.
import type {
  TelegramChannelMemoryConfig,
  TelegramDirectConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "openclaw/plugin-sdk/config-contracts";
import { buildSenderName } from "./bot/body-helpers.js";
import { buildTelegramGroupPeerId } from "./bot/helpers.js";
import type { TelegramContext } from "./bot/types.js";

export function isTelegramChannelMemoryEnabled(params: {
  config?: TelegramChannelMemoryConfig;
  chatId: string | number;
  resolvedThreadId?: number;
}): boolean {
  if (params.config?.enabled !== true) {
    return false;
  }
  const allow = params.config.allow?.map((entry) => entry.trim()).filter(Boolean);
  if (!allow || allow.length === 0) {
    return true;
  }
  const peerId = buildTelegramGroupPeerId(params.chatId, params.resolvedThreadId);
  const candidates = new Set([
    String(params.chatId),
    peerId,
    `telegram:${String(params.chatId)}`,
    `telegram:${peerId}`,
  ]);
  return allow.some((entry) => candidates.has(entry));
}

export function resolveTelegramConversationAlias(
  chat: TelegramContext["message"]["chat"],
): string | undefined {
  if ("title" in chat && typeof chat.title === "string" && chat.title.trim()) {
    return chat.title;
  }
  if ("username" in chat && typeof chat.username === "string" && chat.username.trim()) {
    return `@${chat.username}`;
  }
  if ("first_name" in chat && typeof chat.first_name === "string" && chat.first_name.trim()) {
    const lastName =
      "last_name" in chat && typeof chat.last_name === "string" ? chat.last_name : "";
    return [chat.first_name, lastName].filter(Boolean).join(" ");
  }
  return undefined;
}

export function resolveTelegramChannelMemoryConfig(params: {
  accountConfig?: TelegramChannelMemoryConfig;
  groupConfig?: TelegramGroupConfig | TelegramDirectConfig;
  topicConfig?: TelegramTopicConfig;
}): TelegramChannelMemoryConfig | undefined {
  return (
    params.topicConfig?.channelMemory ?? params.groupConfig?.channelMemory ?? params.accountConfig
  );
}

export function buildTelegramChannelAtomInput(params: {
  accountId: string;
  body: string;
  chatId: string | number;
  msg: TelegramContext["message"];
  resolvedThreadId?: number;
}) {
  return {
    provider: "telegram",
    surface: "telegram",
    accountId: params.accountId,
    conversationId: String(params.chatId),
    conversationAlias: resolveTelegramConversationAlias(params.msg.chat),
    threadId: params.resolvedThreadId == null ? null : String(params.resolvedThreadId),
    messageId: String(params.msg.message_id),
    senderId: params.msg.from?.id == null ? null : String(params.msg.from.id),
    senderHandle: params.msg.from?.username ?? null,
    senderDisplayName: buildSenderName(params.msg) ?? null,
    body: params.body,
    receivedAt: params.msg.date ? params.msg.date * 1000 : Date.now(),
  };
}
