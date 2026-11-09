// Byte pair encoding engine for level 1 of LLM Explained.
// Plain ES module, no dependencies; runs in the browser and in Node.
//
// The method (Sennrich, Haddow and Birch, 2015), as the player runs it:
//   1. Split every word into characters plus an end-of-word marker "_".
//   2. Count every neighbouring pair inside each word. Pairs never cross a space.
//   3. Merge the most frequent pair everywhere and add it to the vocabulary.
//   4. Repeat from step 2.
//
// Tie rule (explicit, never left to data-structure order):
//   highest count wins; on a tie, the pair whose first occurrence comes earliest wins,
//   reading lines in file order and each word left to right, on the current segmentation.
//
// The tokenizer is the ORDERED merge list. Encoding replays the merges in order;
// grabbing the longest vocabulary piece gives different, wrong splits (e.g. "thin").

export const END = "_";

/** Split text into words: lowercase, "." and "?" become words of their own. */
export function splitWords(text) {
  return text.toLowerCase().replace(/([.?])/g, " $1 ").split(/\s+/).filter(Boolean);
}

/**
 * Prepare a corpus for training. Distinct words are kept in order of first occurrence,
 * each with its count and current symbols, so pair "first occurrence" is well defined.
 */
export function createState(text) {
  const order = [];
  const byWord = new Map();
  let lines = 0;
  for (const line of text.split("\n")) {
    const ws = splitWords(line);
    if (!ws.length) continue;
    lines++;
    for (const w of ws) {
      let entry = byWord.get(w);
      if (!entry) {
        entry = { word: w, count: 0, symbols: [...w, END] };
        byWord.set(w, entry);
        order.push(entry);
      }
      entry.count++;
    }
  }
  const alphabet = [...new Set(order.flatMap((e) => e.symbols))].sort();
  return { words: order, alphabet, merges: [], lines };
}

/**
 * Count every neighbouring pair inside each word, weighted by word count.
 * Returns pairs in order of first occurrence: [{ a, b, count, first }].
 */
export function countPairs(state) {
  const pairs = new Map();
  let position = 0;
  for (const e of state.words) {
    const s = e.symbols;
    for (let i = 0; i + 1 < s.length; i++) {
      const key = s[i] + "\u0000" + s[i + 1];
      let p = pairs.get(key);
      if (!p) {
        p = { a: s[i], b: s[i + 1], count: 0, first: position };
        pairs.set(key, p);
      }
      p.count += e.count;
      position++;
    }
  }
  return [...pairs.values()];
}

/** Rank pairs by the tie rule: count descending, then earliest first occurrence. */
export function rankPairs(pairs) {
  return [...pairs].sort((x, y) => y.count - x.count || x.first - y.first);
}

/** Merge one pair everywhere in the corpus, left to right within each word. */
function mergeSymbols(symbols, a, b) {
  const out = [];
  for (let i = 0; i < symbols.length; i++) {
    if (i + 1 < symbols.length && symbols[i] === a && symbols[i + 1] === b) {
      out.push(a + b);
      i++;
    } else {
      out.push(symbols[i]);
    }
  }
  return out;
}

/**
 * Do one merge step. Returns the merge made, with the pairs it was tied with,
 * or null when no pair occurs at least twice.
 */
export function step(state) {
  const ranked = rankPairs(countPairs(state));
  if (!ranked.length || ranked[0].count < 2) return null;
  const best = ranked[0];
  const merge = {
    a: best.a,
    b: best.b,
    count: best.count,
    tiedWith: ranked.slice(1).filter((p) => p.count === best.count).map((p) => [p.a, p.b]),
  };
  for (const e of state.words) e.symbols = mergeSymbols(e.symbols, best.a, best.b);
  state.merges.push(merge);
  return merge;
}

/** Total tokens in the corpus at the current segmentation. */
export function totalTokens(state) {
  return state.words.reduce((n, e) => n + e.symbols.length * e.count, 0);
}

/** Train for up to `numMerges` merges. Returns the tokenizer. */
export function train(text, numMerges) {
  const state = createState(text);
  while (state.merges.length < numMerges && step(state)) {}
  return tokenizerFrom(state);
}

/** The tokenizer: the starting symbols plus the ordered merge list. */
export function tokenizerFrom(state) {
  return {
    alphabet: [...state.alphabet],
    merges: state.merges.map((m) => [m.a, m.b]),
  };
}

/** The vocabulary: starting symbols, then one new piece per merge, in merge order. */
export function vocabulary(tokenizer) {
  return [...tokenizer.alphabet, ...tokenizer.merges.map(([a, b]) => a + b)];
}

/**
 * Encode one word by replaying the merges in order.
 * Characters the tokenizer never saw make the word fail; they are named, never dropped.
 */
export function encodeWord(word, tokenizer) {
  const known = new Set(tokenizer.alphabet.filter((s) => s !== END)); // "_" is the marker, not typeable text
  const unknown = [...new Set([...word].filter((ch) => !known.has(ch)))];
  if (unknown.length) return { tokens: null, unknown };
  let symbols = [...word, END];
  for (const [a, b] of tokenizer.merges) symbols = mergeSymbols(symbols, a, b);
  return { tokens: symbols, unknown: [] };
}

/** Encode a typed sentence: one result per word, plus every unknown character found. */
export function encodeText(text, tokenizer) {
  const words = splitWords(text).map((w) => ({ word: w, ...encodeWord(w, tokenizer) }));
  const unknown = [...new Set(words.flatMap((w) => w.unknown))];
  return { words, unknown };
}

/** Marker for a character the tokenizer has no piece for. It never matches a merge. */
export const UNKNOWN = "\u0000";

/**
 * Encode one word, marking characters the tokenizer never saw instead of failing the whole word.
 * Each unknown character becomes one UNKNOWN + char token; the merges still apply to everything around it,
 * so the readable parts of the word are tokenized exactly as usual.
 */
export function encodeWordMarked(word, tokenizer) {
  const known = new Set(tokenizer.alphabet.filter((s) => s !== END));
  const unknown = [];
  let symbols = [...word].map((ch) => (known.has(ch) ? ch : (unknown.push(ch), UNKNOWN + ch)));
  symbols.push(END);
  for (const [a, b] of tokenizer.merges) symbols = mergeSymbols(symbols, a, b);
  return { tokens: symbols, unknown: [...new Set(unknown)] };
}

/** Encode a typed sentence with unknown characters marked, one result per word. */
export function encodeTextMarked(text, tokenizer) {
  const words = splitWords(text).map((w) => ({ word: w, ...encodeWordMarked(w, tokenizer) }));
  return { words, unknown: [...new Set(words.flatMap((w) => w.unknown))] };
}

// ---------- level 2: token IDs ----------
// A token's ID is its position in the vocabulary: the starting symbols in sorted order, then one piece
// per merge in merge order, then the special token. The list only grows at the end, so an ID never changes.

/** The one special token: the line boundary, placed before and after every line (as GPT-2 uses <|endoftext|>). */
export const BOUNDARY = "<|line|>";

/** Every ID's token, in order: the vocabulary, then the boundary as the last ID. */
export function idList(tokenizer) {
  return [...vocabulary(tokenizer), BOUNDARY];
}

/**
 * Encode text to IDs: village form, tokenize each word, look each token up, boundary on both sides.
 * Text with a character the tokenizer has no piece for has no IDs at all: { ids: null, unknown }.
 */
export function encodeIds(text, tokenizer) {
  const list = idList(tokenizer);
  const id = new Map(list.map((t, i) => [t, i]));
  const words = splitWords(text);
  const tokens = [];
  const unknown = new Set();
  for (const w of words) {
    const r = encodeWord(w, tokenizer);
    if (!r.tokens) { r.unknown.forEach((c) => unknown.add(c)); continue; }
    tokens.push(...r.tokens);
  }
  if (unknown.size) return { ids: null, tokens: null, unknown: [...unknown] };
  const b = list.length - 1;
  return { ids: [b, ...tokens.map((t) => id.get(t)), b], tokens: [BOUNDARY, ...tokens, BOUNDARY], unknown: [] };
}

/** Decode IDs to text: drop boundaries, look each ID up, join, every end-of-word marker becomes a space. */
export function decodeIds(ids, tokenizer) {
  const list = idList(tokenizer);
  return ids.filter((i) => list[i] !== BOUNDARY).map((i) => list[i]).join("").split(END).join(" ").trim();
}
