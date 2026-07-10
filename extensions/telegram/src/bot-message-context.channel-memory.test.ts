// Telegram tests cover channel-context memory capture.
import { describe, expect, it, vi } from "vitest";
import { buildTelegramMessageContextForTest } from "./bot-message-context.test-harness.js";

describe("Telegram channel memory", () => {
  it("does not record channel atoms unless channelMemory is enabled", async () => {
    const recordChannelAtom = vi.fn(() => "atom-id");

    await buildTelegramMessageContextForTest({
      message: {
        message_id: 10,
        text: "quiet by default",
        chat: { id: 123, type: "private", first_name: "Pat" },
        from: { id: 123, first_name: "Pat" },
      },
      recordChannelAtom,
    });

    expect(recordChannelAtom).not.toHaveBeenCalled();
  });

  it("records accepted inbound messages as channel atoms when enabled", async () => {
    const recordChannelAtom = vi.fn(() => "atom-id");

    await buildTelegramMessageContextForTest({
      message: {
        message_id: 11,
        date: 1_700_000_123,
        text: "remember this channel note",
        chat: { id: 123, type: "private", first_name: "Pat", username: "pat_user" },
        from: { id: 123, first_name: "Pat", username: "pat_user" },
      },
      recordChannelAtom,
      channelMemoryConfig: { enabled: true },
    });

    expect(recordChannelAtom).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        provider: "telegram",
        surface: "telegram",
        accountId: "default",
        conversationId: "123",
        conversationAlias: "@pat_user",
        threadId: null,
        messageId: "11",
        senderId: "123",
        senderHandle: "pat_user",
        senderDisplayName: "Pat",
        body: "remember this channel note",
        receivedAt: 1_700_000_123_000,
      }),
    );
  });

  it("honors channelMemory allowlists for forum topics", async () => {
    const recordChannelAtom = vi.fn(() => "atom-id");

    await buildTelegramMessageContextForTest({
      message: {
        message_id: 12,
        date: 1_700_000_124,
        text: "topic note",
        message_thread_id: 99,
        is_topic_message: true,
        chat: {
          id: -1001234567890,
          type: "supergroup",
          title: "Ops Room",
          is_forum: true,
        },
        from: { id: 456, first_name: "Ada" },
      },
      botApi: {
        getChat: vi.fn(async () => ({ id: -1001234567890, type: "supergroup", is_forum: true })),
      },
      recordChannelAtom,
      channelMemoryConfig: {
        enabled: true,
        allow: ["-1001234567890:topic:99"],
      },
    });

    expect(recordChannelAtom).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "-1001234567890",
        conversationAlias: "Ops Room",
        threadId: "99",
        messageId: "12",
        body: "topic note",
      }),
    );
  });

  it("skips enabled channelMemory when the chat is not allowed", async () => {
    const recordChannelAtom = vi.fn(() => "atom-id");

    await buildTelegramMessageContextForTest({
      message: {
        message_id: 13,
        text: "blocked channel note",
        chat: { id: 123, type: "private", first_name: "Pat" },
        from: { id: 123, first_name: "Pat" },
      },
      recordChannelAtom,
      channelMemoryConfig: { enabled: true, allow: ["999"] },
    });

    expect(recordChannelAtom).not.toHaveBeenCalled();
  });
});
