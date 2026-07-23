import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "grammy/types";
import { extractCustomEmojiIdList, extractCustomEmojiIds } from "./extract.js";

test("extractCustomEmojiIdList finds ids in mixed text", () => {
  const ids = extractCustomEmojiIdList("вот 5870982283724328568, ещё 5870723666563566827 и всё");
  assert.deepEqual(ids, ["5870982283724328568", "5870723666563566827"]);
});

test("extractCustomEmojiIdList handles newline/comma separators", () => {
  const ids = extractCustomEmojiIdList("5870982283724328568\n5870723666563566827,5870528606328852614");
  assert.equal(ids.length, 3);
});

test("extractCustomEmojiIdList rejects too-short and too-long digit runs", () => {
  assert.deepEqual(extractCustomEmojiIdList("12345678901234"), []); // 14 digits
  assert.deepEqual(extractCustomEmojiIdList("123456789012345678901"), []); // 21 digits
});

test("extractCustomEmojiIdList dedupes and handles empty input", () => {
  assert.deepEqual(extractCustomEmojiIdList("587098228372432856 587098228372432856"), ["587098228372432856"]);
  assert.deepEqual(extractCustomEmojiIdList(undefined), []);
  assert.deepEqual(extractCustomEmojiIdList("никаких айди тут"), []);
});

function fakeMessage(partial: Partial<Message>): Message {
  return { message_id: 1, date: 0, chat: { id: 1, type: "private", first_name: "x" }, ...partial } as Message;
}

test("extractCustomEmojiIds merges entities and caption_entities, dedupes", () => {
  const msg = fakeMessage({
    text: "ab",
    entities: [
      { type: "custom_emoji", offset: 0, length: 1, custom_emoji_id: "111111111111111111" },
      { type: "custom_emoji", offset: 1, length: 1, custom_emoji_id: "222222222222222222" },
    ],
    caption_entities: [
      { type: "custom_emoji", offset: 0, length: 1, custom_emoji_id: "111111111111111111" },
    ],
  });
  assert.deepEqual(extractCustomEmojiIds(msg), ["111111111111111111", "222222222222222222"]);
});

test("extractCustomEmojiIds ignores non-custom-emoji entities", () => {
  const msg = fakeMessage({
    text: "hello",
    entities: [{ type: "bold", offset: 0, length: 5 }],
  });
  assert.deepEqual(extractCustomEmojiIds(msg), []);
});
