# Engine

The computations behind each level. Plain ES modules, no dependencies, no build step; they run unchanged in the browser and in Node.

## `bpe.js` — level 1, tokens and BPE

Trains a byte pair encoding tokenizer on the village corpus and encodes typed text with it.

- `createState(text)`, `countPairs(state)`, `step(state)`, `totalTokens(state)` — one merge at a time, for the play screens.
- `train(text, numMerges)` — the whole run at once. The course uses 55 merges, giving an 80-piece vocabulary.
- `encodeWord(word, tokenizer)`, `encodeText(text, tokenizer)` — replay the merges in order. Characters the village never saw are named in `unknown`, never dropped.
- `vocabulary(tokenizer)` — starting symbols, then one piece per merge.

The tokenizer is the ordered merge list, not the set of pieces. The tie rule is explicit: highest count wins; on a tie, the pair whose first occurrence comes earliest, reading lines in order and words left to right.

## Tests

```
node --test app/engine/bpe.test.mjs
```

The tests check every merge against the Python reference in `corpus/bpe_reference.json`: the pair, its count, the pairs it was tied with, and the corpus token total after it, for all 200 merges the corpus supports. Rebuild the reference with `python3 export_reference.py` from the `corpus` folder whenever the corpus changes.
