// Tests the JavaScript BPE engine against the Python reference (corpus/bpe_reference.json).
// Run: node --test app/engine/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createState, step, totalTokens, countPairs, train, vocabulary, encodeWord, encodeText, tokenizerFrom,
  encodeWordMarked, encodeTextMarked, UNKNOWN, BOUNDARY, idList, encodeIds, decodeIds,
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
  assert.deepEqual(tied, [19, 33, 34, 39, 41, 42, 43, 45, 46, 47, 49, 51, 52, 53, 54]);
});

test("the course tokenizer: 55 merges, 80-piece vocabulary, 9 unused pieces", () => {
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

test("rain becomes one token only at merge 181", () => {
  assert.deepEqual(encodeWord("rain", train(corpus, 180)).tokens, ["ra", "in_"]);
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
  assert.deepEqual(r.words[3].tokens, ["hi", "d", "ing_"]);
});

test("first board: h + e is the most frequent pair, 393 times", () => {
  const top = countPairs(createState(corpus)).sort((x, y) => y.count - x.count)[0];
  assert.deepEqual([top.a, top.b, top.count], ["h", "e", 393]);
});

test("tokenizer is plain data: survives JSON round trip", () => {
  const tok = tokenizerFrom((() => { const s = createState(corpus); for (let i = 0; i < K; i++) step(s); return s; })());
  const copy = JSON.parse(JSON.stringify(tok));
  assert.deepEqual(encodeWord("raining", copy).tokens, ["r", "a", "in", "ing_"]);
});

test("live terrace: 'the rain is here .' after each of the first five merges", () => {
  const counts = [];
  for (let k = 0; k <= 5; k++) {
    const tok = train(corpus, k);
    counts.push("the rain is here .".split(" ").reduce((n, w) => n + encodeWord(w, tok).tokens.length, 0));
  }
  assert.deepEqual(counts, [19, 17, 16, 15, 14, 13]);
  assert.equal("the rain is here .".split(" ").reduce((n, w) => n + encodeWord(w, train(corpus, 55)).tokens.length, 0), 9);
});

test("unknown characters fail only themselves; the rest of the word is tokenized as usual", () => {
  const tok = train(corpus, K);
  const zebra = encodeWordMarked("zebra", tok);
  assert.deepEqual(zebra.unknown, ["z"]);
  assert.equal(zebra.tokens[0], UNKNOWN + "z");
  assert.ok(zebra.tokens.slice(1).every((t) => !t.startsWith(UNKNOWN)), "only the z is unknown");
  // a known word is unchanged by the marked encoder
  for (const w of ["raining", "thin", "has", "elephant"]) assert.deepEqual(encodeWordMarked(w, tok).tokens, encodeWord(w, tok).tokens, w);
  // merges never cross an unknown character
  const goat = encodeWordMarked("goat,", tok);
  assert.deepEqual(goat.unknown, [","]);
  assert.ok(goat.tokens.includes(UNKNOWN + ","));
  const r = encodeTextMarked("Hello, World!", tok);
  assert.deepEqual(r.unknown.sort(), ["!", ","].sort());
});

test("level 2: IDs follow the vocabulary order, with the boundary as ID 80", () => {
  const tok = train(corpus, K);
  const list = idList(tok);
  assert.equal(list.length, 81);
  assert.equal(list[80], BOUNDARY);
  assert.deepEqual([list[0], list[2], list[25], list[28], list[29], list[30], list[79]], [".", "_", "he", "he_", "the_", "._", "cow_"]);
});

test("level 2: spec examples encode to the IDs in the spec", () => {
  const tok = train(corpus, K);
  assert.deepEqual(encodeIds("when it is sunny the bird is singing .", tok).ids,
    [80, 44, 35, 33, 19, 61, 15, 45, 29, 4, 11, 18, 50, 33, 19, 27, 9, 48, 30, 80]);
  assert.deepEqual(encodeIds("dawa plays the drum .", tok).ids, [80, 74, 70, 26, 29, 58, 49, 2, 30, 80]);
  assert.equal(decodeIds([29, 66, 42, 6, 46, 30], tok), "the cat hides .");
});

test("level 2: every corpus line round-trips exactly; the boundary appears only at the ends", () => {
  const tok = train(corpus, K);
  for (const file of ["corpus_train.txt", "corpus_heldout.txt", "corpus_finetune.txt"]) {
    for (const line of readFileSync(new URL(file, root), "utf8").split("\n").filter(Boolean)) {
      const { ids } = encodeIds(line, tok);
      assert.equal(decodeIds(ids, tok), line, line);
      assert.ok(ids[0] === 80 && ids.at(-1) === 80 && !ids.slice(1, -1).includes(80), line);
      assert.ok(ids.length - 1 <= 32, `${line}: ${ids.length - 1} inputs exceed the 32-token context`);
    }
  }
});

test("level 2: typed text comes back in village form; unknown characters have no IDs", () => {
  const tok = train(corpus, K);
  assert.equal(decodeIds(encodeIds("The cat hides.", tok).ids, tok), "the cat hides .");
  assert.deepEqual(encodeIds("the zebra hides", tok), { ids: null, tokens: null, unknown: ["z"] });
});
