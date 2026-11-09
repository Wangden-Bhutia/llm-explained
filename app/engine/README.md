# Engine

The computations behind each level. Plain ES modules, no dependencies, no build step; they run unchanged in the browser and in Node.

## `bpe.js` — level 1, tokens and BPE

Trains a byte pair encoding tokenizer on the village corpus and encodes typed text with it.

- `createState(text)`, `countPairs(state)`, `step(state)`, `totalTokens(state)` — one merge at a time, for the play screens.
- `train(text, numMerges)` — the whole run at once. The course uses 55 merges, giving an 80-piece vocabulary.
- `encodeWord(word, tokenizer)`, `encodeText(text, tokenizer)` — replay the merges in order. Characters the village never saw are named in `unknown`, never dropped.
- `vocabulary(tokenizer)` — starting symbols, then one piece per merge.

The tokenizer is the ordered merge list, not the set of pieces. The tie rule is explicit: highest count wins; on a tie, the pair whose first occurrence comes earliest, reading lines in order and words left to right.

## `gpt2.js` — GPT-2's real tokenizer, for level 1's comparison

Written for this course, no third-party code: GPT-2's splitting rule from OpenAI's released `encoder.py`, UTF-8 bytes, then merges by lowest rank. It runs on `data/gpt2_r50k_base.tiktoken`, GPT-2's merge table in tiktoken's format, whose SHA-256 matches the hash OpenAI publishes for `r50k_base` in tiktoken's `openai_public.py`.

- `loadGpt2(tableText)`, `gpt2Encode(text, gpt2)`, `gpt2Tokens(text, gpt2)` (each token's id, its text, or its bytes in hex when it is part of a character).

## Tests

```
node --test app/engine/bpe.test.mjs app/engine/gpt2.test.mjs
```

The tests check every merge against the Python reference in `corpus/bpe_reference.json`: the pair, its count, the pairs it was tied with, and the corpus token total after it, for all 200 merges the corpus supports. Rebuild the reference with `python3 export_reference.py` from the `corpus` folder whenever the corpus changes.

`gpt2.test.mjs` checks the merge table's hash, OpenAI's own GPT-2 test cases from tiktoken's `tests/test_encoding.py`, and 64 published `r50k_base` cases from the gpt-tokenizer package (MIT), kept as plain data in `data/gpt2_cases_gpt_tokenizer.json`.
