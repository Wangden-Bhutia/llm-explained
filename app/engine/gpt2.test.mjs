// Tests our GPT-2 tokenizer against OpenAI's own test cases and a larger published case set.
// Run: node --test app/engine/gpt2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadGpt2, gpt2Encode, gpt2Tokens } from "./gpt2.js";

const tablePath = new URL("data/gpt2_r50k_base.tiktoken", import.meta.url);
const table = readFileSync(tablePath, "utf8");
const gpt2 = loadGpt2(table);

test("the merge table is GPT-2's, byte for byte (OpenAI's published hash)", () => {
  const hash = createHash("sha256").update(readFileSync(tablePath)).digest("hex");
  assert.equal(hash, "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930");
  assert.equal(gpt2.ranks.size + 1, 50257); // + the end-of-text token
});

// From OpenAI's tiktoken tests (tests/test_encoding.py): test_simple, test_simple_repeated, test_encode_empty.
test("OpenAI's own GPT-2 test cases", () => {
  assert.deepEqual(gpt2Encode("hello world", gpt2), [31373, 995]);
  assert.deepEqual(gpt2Encode("", gpt2), []);
  const zeros = [[15], [405], [830], [2388], [20483], [10535], [24598], [8269], [10535, 830], [8269, 405],
    [8269, 830], [8269, 2388], [8269, 20483], [8269, 10535], [8269, 24598], [25645], [8269, 10535, 830]];
  zeros.forEach((ids, i) => assert.deepEqual(gpt2Encode("0".repeat(i + 1), gpt2), ids, `${i + 1} zeros`));
});

// The r50k_base cases published with the gpt-tokenizer package (MIT), as plain data.
test("published GPT-2 case set: every case matches", () => {
  const cases = JSON.parse(readFileSync(new URL("data/gpt2_cases_gpt_tokenizer.json", import.meta.url), "utf8"));
  assert.ok(cases.length > 0);
  for (const c of cases) assert.deepEqual(gpt2Encode(c.text, gpt2), c.ids, JSON.stringify(c.text).slice(0, 80));
});

test("what level 1 shows: leading spaces, whole words, bytes", () => {
  const t = (s) => gpt2Tokens(s, gpt2).map((x) => x.text ?? `<${x.hex}>`);
  assert.deepEqual(t("the goat is hiding ."), ["the", " goat", " is", " hiding", " ."]);
  assert.equal(gpt2Tokens("raining", gpt2).length, 1);
  assert.equal(gpt2Tokens("zebra", gpt2).length, 2);
  const emoji = gpt2Tokens("🦓", gpt2);
  assert.ok(emoji.some((x) => x.text === null), "an emoji splits into byte pieces");
  assert.equal(emoji.map((x) => x.hex).join(" "), "F0 9F A6 93");
});
