// Tests the JavaScript BPE engine against the Python reference (corpus/bpe_reference.json).
// Run: node --test app/engine/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createState, step, totalTokens, countPairs, train, vocabulary, encodeWord, encodeText, tokenizerFrom,
} from "./bpe.js";

const root = new URL("../../corpus/", import.meta.url);
const corpus = readFileSync(new URL("corpus_train.txt", root), "utf8");
const ref = JSON.parse(readFileSync(new URL("bpe_reference.json", root), "utf8"));
const K = ref.courseMerges; // 55

test("starting symbols and token total match the reference", () => {
  const s = createState(corpus);
  assert.equal(s.lines, ref.corpusLines);
  assert.deepEqual(s.alphabet, ref.baseSymbols);
  assert.equal(s.alphabet.length, 25);
  assert.equal(totalTokens(s), ref.totalTokensAfter[0]);
});

test("every merge matches the reference, merge by merge, to the end", () => {
  const s = createState(corpus);
  for (let k = 0; k < ref.merges.length; k++) {
    const m = step(s);
    const r = ref.merges[k];
    assert.ok(m, `engine stopped early at merge ${k + 1}`);
    assert.deepEqual([m.a, m.b, m.count], [r.a, r.b, r.count], `merge ${k + 1}`);
    assert.deepEqual(m.tiedWith, r.tiedWith, `tied pairs at merge ${k + 1}`);
    assert.equal(totalTokens(s), ref.totalTokensAfter[k + 1], `total tokens after merge ${k + 1}`);
  }
  assert.equal(step(s), null, "engine must stop where the reference stops");
});

test("tie rule decides the same merges the reference does", () => {
  const s = createState(corpus);
  const tied = [];
  for (let k = 1; k <= K; k++) if (step(s).tiedWith.length) tied.push(k);
  assert.deepEqual(tied, [9, 16, 22, 26, 31, 32, 37, 39, 42, 43, 44, 47, 48, 49, 50, 51, 52, 53, 55]);
});

test("the course tokenizer: 55 merges, 80-piece vocabulary, 8 unused pieces", () => {
  const tok = train(corpus, K);
  const vocab = vocabulary(tok);
  assert.equal(vocab.length, 80);
  const inUse = new Set();
  for (const line of corpus.split("\n")) for (const w of line.split(" ").filter(Boolean))
    for (const t of encodeWord(w, tok).tokens) inUse.add(t);
  assert.deepEqual(vocab.filter((v) => !inUse.has(v)).sort(), ref.unusedAt55);
});

test("spec examples split as the reference says", () => {
  const tok = train(corpus, K);
  for (const [word, tokens] of Object.entries(ref.examplesAt55))
    assert.deepEqual(encodeWord(word, tok).tokens, tokens, word);
});

test("success check: merge order matters (thin, has)", () => {
  const tok = train(corpus, K);
  assert.deepEqual(encodeWord("thin", tok).tokens, ["t", "h", "in_"]);
  assert.deepEqual(encodeWord("has", tok).tokens, ["h", "a", "s_"]);
});

test("rain becomes one token only at merge 137", () => {
  assert.deepEqual(encodeWord("rain", train(corpus, 136)).tokens, ["ra", "in_"]);
  assert.deepEqual(encodeWord("rain", train(corpus, ref.rainBecomesOneTokenAt)).tokens, ["rain_"]);
});

test("typed input: elephant costs 8, zebra fails on z, unknowns are named", () => {
  const tok = train(corpus, K);
  assert.equal(encodeWord("elephant", tok).tokens.length, 8);
  assert.deepEqual(encodeWord("zebra", tok), { tokens: null, unknown: ["z"] });
  const r = encodeText("The Goat, is HIDING.", tok);
  assert.deepEqual(r.words.map((w) => w.word), ["the", "goat,", "is", "hiding", "."]);
  assert.deepEqual(r.unknown, [","]);
  assert.deepEqual(encodeText("the_goat", tok).unknown, ["_"]);
  assert.deepEqual(r.words[3].tokens, ["hid", "ing_"]);
});

test("first board: h + e is the most frequent pair, 325 times", () => {
  const top = countPairs(createState(corpus)).sort((x, y) => y.count - x.count)[0];
  assert.deepEqual([top.a, top.b, top.count], ["h", "e", 325]);
});

test("tokenizer is plain data: survives JSON round trip", () => {
  const tok = tokenizerFrom((() => { const s = createState(corpus); for (let i = 0; i < K; i++) step(s); return s; })());
  const copy = JSON.parse(JSON.stringify(tok));
  assert.deepEqual(encodeWord("raining", copy).tokens, ["ra", "in", "ing_"]);
});
