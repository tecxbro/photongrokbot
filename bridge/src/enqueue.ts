import { ensureDataDir, enqueueOutbound } from "./storage.ts";
import { OutboundTextError } from "./outbound-text.ts";
import { OutboundPollError } from "./outbound-poll.ts";
import { OutboundAppError } from "./outbound-app.ts";
import { OutboundEffectError, prepareOutboundEffect } from "./outbound-effect.ts";
import type { EnqueueOutboundInput, OutboundItem } from "./types.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

function argsAll(name: string): string[] {
  const out: string[] = [];
  const flag = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1] !== undefined) {
      out.push(process.argv[i + 1]!);
    }
  }
  return out;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const USAGE =
  "usage:\n" +
  "  bun run enqueue -- --space-id <spaceId> --text <text> [--attachment <path>] [--effect <name>]\n" +
  "  bun run enqueue -- --space-id <spaceId> [--text <caption>] --attachment <p1> --attachment <p2> [--attachment <p3> ...]\n" +
  "  bun run enqueue -- --space-id <spaceId> --reply-to <messageId> --text <text>\n" +
  "  bun run enqueue -- --space-id <spaceId> --react <emoji> --target <messageId>\n" +
  "  bun run enqueue -- --space-id <spaceId> --poll-title <question> --option <a> --option <b> [...]\n" +
  "  bun run enqueue -- --space-id <spaceId> --voice <audioPath> [--duration <seconds>]\n" +
  "  bun run enqueue -- --space-id <spaceId> --app-url <url> [--live]\n" +
  "  bun run enqueue -- --space-id <spaceId> --app-update <messageId> --app-url <url> [--live]\n" +
  "  bun run enqueue -- --space-id <spaceId> --typing start|stop\n" +
  "note: --effect applies to --text / single --attachment only (not --reply-to) for v1.\n" +
  "note: effect names: slam,loud,gentle,invisible,confetti,fireworks,balloons,heart,lasers,celebration,sparkles,spotlight,echo\n" +
  "note: two or more --attachment flags enqueue ONE attachment_group (Spectrum group → iMessage sendMultipart).\n" +
  "note: poll follow-up acknowledgments use --text, not --reply-to <pollMessageId>";

const spaceId = arg("space-id") ?? process.argv[2];
const text = arg("text") ?? "";
const attachmentPaths = argsAll("attachment");
const attachmentPath = attachmentPaths[0];
const replyTo = arg("reply-to");
const reactEmoji = arg("react");
const target = arg("target");
const typingState = arg("typing");
const pollTitle = arg("poll-title");
const pollOptions = argsAll("option");
const voicePath = arg("voice");
const durationRaw = arg("duration");
const appUrl = arg("app-url");
const appUpdate = arg("app-update");
const liveFlag = hasFlag("live");
const effectRaw = arg("effect");

if (!spaceId || spaceId.startsWith("--")) {
  console.error(USAGE);
  process.exit(1);
}

let effectName: string | undefined;
if (effectRaw !== undefined || hasFlag("effect")) {
  if (effectRaw === undefined) {
    console.error("error: --effect requires a name (e.g. confetti, slam)\n" + USAGE);
    process.exit(1);
  }
  try {
    effectName = prepareOutboundEffect(effectRaw);
  } catch (err) {
    if (err instanceof OutboundEffectError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}

let input: EnqueueOutboundInput;

if (effectName) {
  const incompatible =
    typingState !== undefined ||
    hasFlag("typing") ||
    reactEmoji !== undefined ||
    hasFlag("react") ||
    pollTitle !== undefined ||
    hasFlag("poll-title") ||
    voicePath !== undefined ||
    hasFlag("voice") ||
    appUrl !== undefined ||
    hasFlag("app-url") ||
    appUpdate !== undefined ||
    hasFlag("app-update") ||
    attachmentPaths.length >= 2;
  if (incompatible) {
    console.error(
      "error: --effect only applies to --text (and single --attachment); not reply/react/poll/voice/app/group\n" +
        USAGE,
    );
    process.exit(1);
  }
}

if (typingState !== undefined || hasFlag("typing")) {
  if (typingState !== "start" && typingState !== "stop") {
    console.error("error: --typing requires start or stop\n" + USAGE);
    process.exit(1);
  }
  input = { kind: "typing", spaceId, state: typingState };
} else if (appUpdate !== undefined || hasFlag("app-update")) {
  if (!appUpdate) {
    console.error("error: --app-update requires a messageId\n" + USAGE);
    process.exit(1);
  }
  if (!appUrl) {
    console.error("error: --app-update requires --app-url <url>\n" + USAGE);
    process.exit(1);
  }
  input = {
    kind: "app_update",
    spaceId,
    targetMessageId: appUpdate,
    url: appUrl,
    live: liveFlag,
  };
} else if (appUrl !== undefined || hasFlag("app-url")) {
  if (!appUrl) {
    console.error("error: --app-url requires a URL\n" + USAGE);
    process.exit(1);
  }
  input = {
    kind: "app",
    spaceId,
    url: appUrl,
    live: liveFlag,
  };
} else if (voicePath !== undefined || hasFlag("voice")) {
  if (!voicePath) {
    console.error("error: --voice requires an audio file path\n" + USAGE);
    process.exit(1);
  }
  let durationSeconds: number | undefined;
  if (durationRaw !== undefined) {
    durationSeconds = Number(durationRaw);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      console.error("error: --duration must be a non-negative number\n" + USAGE);
      process.exit(1);
    }
  }
  input = {
    kind: "voice",
    spaceId,
    audioPath: voicePath,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  };
} else if (pollTitle !== undefined || hasFlag("poll-title")) {
  if (!pollTitle) {
    console.error("error: --poll-title requires a question\n" + USAGE);
    process.exit(1);
  }
  if (pollOptions.length < 2) {
    console.error(
      "error: --poll-title requires at least two --option values\n" + USAGE,
    );
    process.exit(1);
  }
  input = {
    kind: "poll",
    spaceId,
    title: pollTitle,
    options: pollOptions,
  };
} else if (reactEmoji !== undefined || hasFlag("react")) {
  if (!reactEmoji) {
    console.error("error: --react requires an emoji\n" + USAGE);
    process.exit(1);
  }
  if (!target) {
    console.error("error: --react requires --target <messageId>\n" + USAGE);
    process.exit(1);
  }
  input = {
    kind: "react",
    spaceId,
    targetMessageId: target,
    emoji: reactEmoji,
  };
} else if (replyTo !== undefined || hasFlag("reply-to")) {
  if (!replyTo) {
    console.error("error: --reply-to requires a messageId\n" + USAGE);
    process.exit(1);
  }
  if (!text) {
    console.error("error: --reply-to requires --text\n" + USAGE);
    process.exit(1);
  }
  if (effectName) {
    console.error(
      "error: --effect is not supported with --reply-to in v1 (use --text --effect)\n" +
        USAGE,
    );
    process.exit(1);
  }
  input = {
    kind: "reply",
    spaceId,
    targetMessageId: replyTo,
    text,
  };
} else {
  if (!text && attachmentPaths.length === 0) {
    console.error(USAGE);
    process.exit(1);
  }
  if (attachmentPaths.length >= 2) {
    // Wait for all files, then one grouped send — do not enqueue N separate attachments.
    input = {
      kind: "attachment_group",
      spaceId,
      attachmentPaths,
      ...(text ? { text } : {}),
    };
  } else {
    input = {
      kind: "text",
      spaceId,
      text: text || (attachmentPath ? `[attachment] ${attachmentPath}` : ""),
      ...(attachmentPath ? { attachmentPath } : {}),
      ...(effectName ? { effect: effectName } : {}),
    };
  }
}

function summarize(item: OutboundItem): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: item.id,
    spaceId: item.spaceId,
    kind: item.kind ?? "text",
    status: item.status,
  };
  if (item.kind === "react") {
    base.emoji = item.emoji;
    base.targetMessageId = item.targetMessageId;
  } else if (item.kind === "reply") {
    base.text = item.text;
    base.targetMessageId = item.targetMessageId;
  } else if (item.kind === "poll") {
    base.title = item.title;
    base.options = item.options;
  } else if (item.kind === "voice") {
    base.audioPath = item.audioPath;
    if (item.durationSeconds !== undefined) base.durationSeconds = item.durationSeconds;
  } else if (item.kind === "typing") {
    base.state = item.state;
  } else if (item.kind === "attachment_group") {
    base.attachmentPaths = item.attachmentPaths;
    base.count = item.attachmentPaths.length;
  } else if (item.kind === "app") {
    base.url = item.url;
    base.live = item.live ?? false;
  } else if (item.kind === "app_update") {
    base.url = item.url;
    base.live = item.live ?? false;
    base.targetMessageId = item.targetMessageId;
  } else {
    base.text = item.text;
    if (item.attachmentPath) base.attachmentPath = item.attachmentPath;
    if (item.effect) base.effect = item.effect;
  }
  return base;
}

await ensureDataDir();
try {
  const items = await enqueueOutbound(input);
  process.stdout.write(
    `${JSON.stringify(
      {
        count: items.length,
        items: items.map(summarize),
      },
      null,
      2,
    )}\n`,
  );
} catch (err) {
  if (
    err instanceof OutboundTextError ||
    err instanceof OutboundPollError ||
    err instanceof OutboundAppError ||
    err instanceof OutboundEffectError
  ) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
}
