import { test } from "node:test";
import assert from "node:assert/strict";
import { addToCollect, setCollectStatusMsg, takeCollect, clearCollect, COLLECT_CAP } from "./pendingInput.js";

test("addToCollect accumulates and dedupes across calls", () => {
  const uid = 9001;
  clearCollect(uid);
  const r1 = addToCollect(uid, 1, ["a", "b"]);
  assert.deepEqual([r1.total, r1.added, r1.capped], [2, 2, false]);
  const r2 = addToCollect(uid, 1, ["b", "c"]);
  assert.deepEqual([r2.total, r2.added], [3, 1]);
  assert.deepEqual(takeCollect(uid), ["a", "b", "c"]);
});

test("addToCollect caps at COLLECT_CAP", () => {
  const uid = 9002;
  clearCollect(uid);
  const ids = Array.from({ length: COLLECT_CAP + 5 }, (_, i) => `id${i}`);
  const r = addToCollect(uid, 1, ids);
  assert.equal(r.total, COLLECT_CAP);
  assert.equal(r.capped, true);
});

test("takeCollect consumes and returns null afterwards", () => {
  const uid = 9003;
  clearCollect(uid);
  addToCollect(uid, 1, ["x"]);
  assert.deepEqual(takeCollect(uid), ["x"]);
  assert.equal(takeCollect(uid), null);
});

test("status message id tracked and returned on next add", () => {
  const uid = 9004;
  clearCollect(uid);
  const r1 = addToCollect(uid, 1, ["a"]);
  assert.equal(r1.prevStatusMsgId, null);
  setCollectStatusMsg(uid, 42);
  const r2 = addToCollect(uid, 1, ["b"]);
  assert.equal(r2.prevStatusMsgId, 42);
  clearCollect(uid);
});
