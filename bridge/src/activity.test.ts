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

test("O09 uncertain typing start disables refresh but retains final cleanup", async () => {
  let time = 0;
  let remoteTyping = false;
  const calls: string[] = [];
  const driver = new ActivityDriver({
    start: async () => { calls.push("start"); remoteTyping = true; throw new Error("response lost"); },
    stop: async () => { calls.push("stop"); remoteTyping = false; },
  }, () => time, 100, 10);
  const destination = { spaceId: "test-space", lineId: "test-line" };
  await driver.sync([destination]);
  time = 20;
  await driver.sync([destination]);
  expect(calls).toEqual(["start"]);
  await driver.stop();
  await driver.stop();
  expect(remoteTyping).toBe(false);
  expect(calls).toEqual(["start", "stop"]);
});

test("O09 uncertain typing start still receives bounded lifetime cleanup", async () => {
  let time = 0;
  const calls: string[] = [];
  const driver = new ActivityDriver({
    start: async () => { calls.push("start"); throw new Error("uncertain"); },
    stop: async () => { calls.push("stop"); },
  }, () => time, 100, 10);
  const destination = { spaceId: "test-space", lineId: "test-line" };
  await driver.sync([destination]);
  time = 101;
  await driver.sync([destination]);
  await driver.stop();
  expect(calls).toEqual(["start", "stop"]);
});

test("W04 timed-out typing start keeps one cleanup attempt at shutdown", async () => {
  const calls: string[] = [];
  const driver = new ActivityDriver({
    start: async () => { calls.push("start"); await new Promise<void>(() => {}); },
    stop: async () => { calls.push("stop"); },
  });
  await driver.sync([{ spaceId: "test-space", lineId: "test-line" }]);
  await driver.stop();
  expect(calls).toEqual(["start", "stop"]);
}, 7000);
