import { test, expect } from "bun:test";
import { ActivityDriver } from "./activity.ts";

test("W04 typing remains through progress and stops when active work ends", async () => {
  const calls: string[] = [];
  let time = 0;
  const driver = new ActivityDriver({
    start: async d => { calls.push(`start:${d.spaceId}`); },
    stop: async d => { calls.push(`stop:${d.spaceId}`); },
  }, () => time, 100, 10);
  const destination = { spaceId: "test-space", lineId: "test-line" };
  await driver.sync([destination]);
  time = 11;
  await driver.sync([destination]); // progress acceptance leaves active claim present
  expect(calls).toEqual(["start:test-space", "start:test-space"]);
  await driver.sync([]); // final/waiting/failed/expired claim removes active work
  expect(calls.at(-1)).toBe("stop:test-space");
});

test("W04 typing expires once and cannot renew itself forever", async () => {
  let time = 0;
  const calls: string[] = [];
  const driver = new ActivityDriver({
    start: async () => { calls.push("start"); },
    stop: async () => { calls.push("stop"); },
  }, () => time, 100, 10);
  const destination = { spaceId: "test-space", lineId: "test-line" };
  await driver.sync([destination]);
  time = 101;
  await driver.sync([destination]);
  time = 202;
  await driver.sync([destination]);
  expect(calls).toEqual(["start", "stop"]);
});
