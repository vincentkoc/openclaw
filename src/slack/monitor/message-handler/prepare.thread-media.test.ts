import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../media.js", async () => {
  const actual = await vi.importActual<typeof import("../media.js")>("../media.js");
  return {
    ...actual,
    resolveSlackMediaList: vi.fn(),
    resolveSlackThreadStarter: vi.fn(),
  };
});

import type { App } from "@slack/bolt";

import type { ClawdbotConfig } from "../../../config/config.js";
import type { RuntimeEnv } from "../../../runtime.js";
import type { ResolvedSlackAccount } from "../../accounts.js";
import type { SlackMessageEvent } from "../../types.js";
import { createSlackMonitorContext } from "../context.js";
import { resolveSlackMediaList, resolveSlackThreadStarter } from "../media.js";
import { prepareSlackMessage } from "./prepare.js";

const account: ResolvedSlackAccount = {
  accountId: "default",
  enabled: true,
  botTokenSource: "config",
  appTokenSource: "config",
  config: {},
} as ResolvedSlackAccount;

const createContext = () => {
  const slackCtx = createSlackMonitorContext({
    cfg: {
      agents: { defaults: { model: "anthropic/claude-opus-4-5", workspace: "/tmp/clawd" } },
      channels: { slack: { enabled: true } },
    } as ClawdbotConfig,
    accountId: "default",
    botToken: "token",
    app: { client: {} } as App,
    runtime: {} as RuntimeEnv,
    botUserId: "B1",
    teamId: "T1",
    apiAppId: "A1",
    historyLimit: 0,
    sessionScope: "per-sender",
    mainKey: "main",
    dmEnabled: true,
    dmPolicy: "open",
    allowFrom: [],
    groupDmEnabled: true,
    groupDmChannels: [],
    defaultRequireMention: true,
    groupPolicy: "open",
    useAccessGroups: false,
    reactionMode: "off",
    reactionAllowlist: [],
    replyToMode: "off",
    threadHistoryScope: "thread",
    threadInheritParent: false,
    slashCommand: {
      enabled: false,
      name: "clawd",
      sessionPrefix: "slack:slash",
      ephemeral: true,
    },
    textLimit: 4000,
    ackReactionScope: "off",
    mediaMaxBytes: 1024,
    removeAckAfterReply: false,
  });
  slackCtx.resolveChannelName = async () => ({ name: "general", type: "channel" });
  slackCtx.resolveUserName = async () => ({ name: "Alice" });
  return slackCtx;
};

const mediaMock = vi.mocked(resolveSlackMediaList);
const starterMock = vi.mocked(resolveSlackThreadStarter);

beforeEach(() => {
  mediaMock.mockReset();
  starterMock.mockReset();
  mediaMock.mockResolvedValue([]);
  starterMock.mockResolvedValue(null);
});

describe("prepareSlackMessage thread media", () => {
  it("hydrates root files for thread replies without attachments", async () => {
    const ctx = createContext();
    starterMock.mockResolvedValueOnce({
      text: "",
      userId: "U2",
      ts: "171234.000",
      files: [{ name: "root.pdf" }],
    });
    mediaMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        path: "/tmp/root.pdf",
        contentType: "application/pdf",
        placeholder: "[Slack file: root.pdf]",
      },
    ]);

    const message: SlackMessageEvent = {
      type: "message",
      channel: "C1",
      channel_type: "channel",
      text: "",
      user: "U1",
      ts: "171234.111",
      thread_ts: "171234.000",
    } as SlackMessageEvent;

    const prepared = await prepareSlackMessage({
      ctx,
      account,
      message,
      opts: { source: "message", wasMentioned: true },
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.ctxPayload.RawBody).toBe("[Slack file: root.pdf]");
    expect(prepared?.ctxPayload.MediaPath).toBe("/tmp/root.pdf");
    expect(prepared?.ctxPayload.MediaPaths).toEqual(["/tmp/root.pdf"]);
  });

  it("emits MediaPaths for multiple attachments", async () => {
    const ctx = createContext();
    mediaMock.mockResolvedValueOnce([
      {
        path: "/tmp/a.png",
        contentType: "image/png",
        placeholder: "[Slack file: a.png]",
      },
      {
        path: "/tmp/b.pdf",
        contentType: "application/pdf",
        placeholder: "[Slack file: b.pdf]",
      },
    ]);

    const message: SlackMessageEvent = {
      type: "message",
      channel: "C1",
      channel_type: "channel",
      text: "hi",
      user: "U1",
      ts: "171234.111",
      files: [{ name: "a.png" }, { name: "b.pdf" }],
    } as SlackMessageEvent;

    const prepared = await prepareSlackMessage({
      ctx,
      account,
      message,
      opts: { source: "message", wasMentioned: true },
    });

    expect(prepared?.ctxPayload.MediaPath).toBe("/tmp/a.png");
    expect(prepared?.ctxPayload.MediaPaths).toEqual(["/tmp/a.png", "/tmp/b.pdf"]);
    expect(prepared?.ctxPayload.MediaTypes).toEqual(["image/png", "application/pdf"]);
    expect(prepared?.ctxPayload.MediaUrls).toEqual(["/tmp/a.png", "/tmp/b.pdf"]);
  });

  it("keeps file-only messages when downloads fail", async () => {
    const ctx = createContext();
    mediaMock.mockResolvedValueOnce([]);

    const message: SlackMessageEvent = {
      type: "message",
      channel: "C1",
      channel_type: "channel",
      text: "",
      user: "U1",
      ts: "171234.111",
      files: [{ name: "doc.txt" }],
    } as SlackMessageEvent;

    const prepared = await prepareSlackMessage({
      ctx,
      account,
      message,
      opts: { source: "message", wasMentioned: true },
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.ctxPayload.RawBody).toBe("[Slack file: doc.txt]");
    expect(prepared?.ctxPayload.MediaPath).toBeUndefined();
  });
});
