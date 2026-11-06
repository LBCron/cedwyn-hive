import test from "node:test";
import assert from "node:assert/strict";
import { claimLease, readLease, releaseLease } from "../src/lease-core.js";

function storage() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); }
  };
}

test("first claimant gets a lease and a second agent is refused", async () => {
  const db = storage();
  const first = await claimLease(db, "Tab", 1_000, 60_000);
  const second = await claimLease(db, "Pally", 2_000, 60_000);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.lease.agent, "Tab");
});

test("same agent renews without changing original claim time", async () => {
  const db = storage();
  await claimLease(db, "Tab", 1_000, 60_000);
  const renewed = await claimLease(db, "Tab", 10_000, 120_000);
  assert.equal(renewed.ok, true);
  assert.equal(renewed.lease.claimed_at, new Date(1_000).toISOString());
  assert.equal(renewed.lease.expires_at, new Date(130_000).toISOString());
});

test("expired lease can be claimed by another agent", async () => {
  const db = storage();
  await claimLease(db, "Tab", 1_000, 60_000);
  const next = await claimLease(db, "Pally", 61_001, 60_000);
  assert.equal(next.ok, true);
  assert.equal(next.lease.agent, "Pally");
});

test("only the current holder can release a live lease", async () => {
  const db = storage();
  await claimLease(db, "Tab", 1_000, 60_000);
  assert.equal((await releaseLease(db, "Pally", 2_000)).ok, false);
  assert.equal((await releaseLease(db, "Tab", 2_000)).released, true);
  assert.equal(await readLease(db, 3_000), null);
});

test("lease expiry is bounded and agent text is sanitised", async () => {
  const db = storage();
  const result = await claimLease(db, " <Tab>\\n", 1_000, 99 * 60 * 60 * 1000);
  assert.equal(result.lease.agent, "Tab");
  assert.equal(Date.parse(result.lease.expires_at) - 1_000, 2 * 60 * 60 * 1000);
});
