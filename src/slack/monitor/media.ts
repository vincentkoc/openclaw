import type { WebClient as SlackWebClient } from "@slack/web-api";

import type { FetchLike } from "../../media/fetch.js";
import { fetchRemoteMedia } from "../../media/fetch.js";
import { saveMediaBuffer } from "../../media/store.js";
import type { SlackFile } from "../types.js";

export type SlackResolvedMedia = {
  path: string;
  contentType?: string;
  placeholder: string;
};

export function resolveSlackFilePlaceholder(files?: SlackFile[]): string | undefined {
  if (!files || files.length === 0) return undefined;
  const named = files.find((file) => file?.name?.trim());
  if (named?.name) return `[Slack file: ${named.name}]`;
  return "[Slack file]";
}

export async function resolveSlackMediaList(params: {
  files?: SlackFile[];
  token: string;
  maxBytes: number;
}): Promise<SlackResolvedMedia[]> {
  const files = params.files ?? [];
  const resolved: SlackResolvedMedia[] = [];
  for (const file of files) {
    if (file.size && file.size > params.maxBytes) continue;
    const url = file.url_private_download ?? file.url_private;
    if (!url) continue;
    try {
      const fetchImpl: FetchLike = (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${params.token}`);
        return fetch(input, { ...init, headers });
      };
      const fetched = await fetchRemoteMedia({
        url,
        fetchImpl,
        filePathHint: file.name,
      });
      if (fetched.buffer.byteLength > params.maxBytes) continue;
      const saved = await saveMediaBuffer(
        fetched.buffer,
        fetched.contentType ?? file.mimetype,
        "inbound",
        params.maxBytes,
      );
      const label = fetched.fileName ?? file.name;
      resolved.push({
        path: saved.path,
        contentType: saved.contentType,
        placeholder: label ? `[Slack file: ${label}]` : "[Slack file]",
      });
    } catch {
      // Ignore download failures and fall through to the next file.
    }
  }
  return resolved;
}

export type SlackThreadStarter = {
  text?: string;
  userId?: string;
  ts?: string;
  files?: SlackFile[];
};

const THREAD_STARTER_CACHE = new Map<string, SlackThreadStarter>();

export async function resolveSlackThreadStarter(params: {
  channelId: string;
  threadTs: string;
  client: SlackWebClient;
}): Promise<SlackThreadStarter | null> {
  const cacheKey = `${params.channelId}:${params.threadTs}`;
  const cached = THREAD_STARTER_CACHE.get(cacheKey);
  if (cached) return cached;
  try {
    const response = (await params.client.conversations.replies({
      channel: params.channelId,
      ts: params.threadTs,
      limit: 1,
      inclusive: true,
    })) as {
      messages?: Array<{ text?: string; user?: string; ts?: string; files?: SlackFile[] }>;
    };
    const message = response?.messages?.[0];
    const text = (message?.text ?? "").trim();
    const hasFiles = Boolean(message?.files && message.files.length > 0);
    if (!message || (!text && !hasFiles)) return null;
    const starter: SlackThreadStarter = {
      text: text || undefined,
      userId: message.user,
      ts: message.ts,
      files: message.files,
    };
    THREAD_STARTER_CACHE.set(cacheKey, starter);
    return starter;
  } catch {
    return null;
  }
}
