// GPT-2's real tokenizer, written for this course. Plain ES module, no dependencies.
//
// It is the same loop the player runs in level 1, at full scale:
//   1. Split text into pieces by GPT-2's rule (letters, numbers, punctuation, spaces). A space stays
//      attached to the start of the following word, so " goat" is one piece. Pattern from OpenAI's
//      released encoder.py: https://github.com/openai/gpt-2/blob/master/src/encoder.py
//   2. Turn each piece into UTF-8 bytes. GPT-2 starts from the 256 byte values, not letters.
//   3. Merge neighbouring parts, always choosing the pair whose merged result has the lowest rank
//      (the earliest merge GPT-2 learned), until no pair can merge.
//
// Data: data/gpt2_r50k_base.tiktoken is GPT-2's merge table in tiktoken's format (base64 bytes, rank).
// Its SHA-256 (306cd27f…dd930) matches the expected_hash OpenAI publishes for r50k_base in
// https://github.com/openai/tiktoken/blob/main/tiktoken_ext/openai_public.py

export const GPT2_PATTERN = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

/** Parse the merge table. Keys are byte strings (one char per byte, 0–255). */
export function loadGpt2(tableText) {
  const ranks = new Map();
  const bytesOf = [];
  for (const line of tableText.split("\n")) {
    if (!line) continue;
    const [b64, r] = line.split(" ");
    const bytes = atob(b64);
    ranks.set(bytes, +r);
    bytesOf[+r] = bytes;
  }
  return { ranks, bytesOf };
}

const utf8 = new TextEncoder();
const toByteString = (s) => String.fromCharCode(...utf8.encode(s));

function mergePiece(bytes, ranks) {
  let parts = bytes.split("");
  while (parts.length > 1) {
    let best = Infinity, at = -1;
    for (let i = 0; i + 1 < parts.length; i++) {
      const r = ranks.get(parts[i] + parts[i + 1]);
      if (r !== undefined && r < best) { best = r; at = i; }
    }
    if (at < 0) break;
    parts = [...parts.slice(0, at), parts[at] + parts[at + 1], ...parts.slice(at + 2)];
  }
  return parts;
}

/** Encode text to GPT-2 token ids. */
export function gpt2Encode(text, gpt2) {
  const ids = [];
  for (const [piece] of text.matchAll(GPT2_PATTERN))
    for (const p of mergePiece(toByteString(piece), gpt2.ranks)) ids.push(gpt2.ranks.get(p));
  return ids;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Tokens for display: id, the token's text when its bytes form whole characters, and its bytes
 * in hex when they don't (an emoji or a Nepali letter split across tokens).
 */
export function gpt2Tokens(text, gpt2) {
  return gpt2Encode(text, gpt2).map((id) => {
    const bytes = gpt2.bytesOf[id];
    const arr = Uint8Array.from(bytes, (c) => c.charCodeAt(0));
    let str = null;
    try { str = strictUtf8.decode(arr); } catch { /* part of a character */ }
    const hex = [...arr].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    return { id, text: str, hex };
  });
}
