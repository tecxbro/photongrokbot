import { copyFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  hasSetupConfettiBeenSent,
  markSetupConfettiSent,
  SETUP_CONFETTI_MARKER_PATH,
} from "./setup-confetti.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const backup = `${SETUP_CONFETTI_MARKER_PATH}.test-bak`;
const hadMarker = existsSync(SETUP_CONFETTI_MARKER_PATH);
if (hadMarker) {
  await copyFile(SETUP_CONFETTI_MARKER_PATH, backup);
  await unlink(SETUP_CONFETTI_MARKER_PATH);
}

try {
  assert(
    (await hasSetupConfettiBeenSent()) === false,
    "fresh marker should be false",
  );

  await markSetupConfettiSent("2026-09-23T12:00:00.000Z");
  assert(
    (await hasSetupConfettiBeenSent()) === true,
    "after mark should be true",
  );

  // idempotent — second mark must not throw / flip false
  await markSetupConfettiSent("2026-09-23T13:00:00.000Z");
  assert(
    (await hasSetupConfettiBeenSent()) === true,
    "still true after second mark",
  );

  console.log("ALL_SETUP_CONFETTI_TESTS_PASSED");
} finally {
  if (existsSync(SETUP_CONFETTI_MARKER_PATH)) {
    await unlink(SETUP_CONFETTI_MARKER_PATH);
  }
  if (hadMarker && existsSync(backup)) {
    await copyFile(backup, SETUP_CONFETTI_MARKER_PATH);
    await unlink(backup);
  } else if (existsSync(backup)) {
    await unlink(backup);
  }
}
