# Village corpus

Every sentence is generated from fixed world laws in `gen_corpus.py`, so every sentence is true in the world. The world is a hill village with a way of life: four people, five animals, four seasons and the weather, plus food and drink for each season, one harvest festival in autumn, and music. One deliberate reporting skew: in the world everyone cooks, but the text only ever says Dawa cooks (for the bias lesson). Change a law and regenerate; never hand-edit the text files. Before accepting a new word, dry-run level 1: some words change which pairs win the first merges ("they" pushes merge 5 off **the_**; "people" breaks the final check on "thin").

| File | What it is |
| --- | --- |
| `gen_corpus.py` | World laws and generator. Run `python3 gen_corpus.py` to rebuild the files below. |
| `corpus_train.txt` | 272 pre-training sentences. The player's BPE tokenizer is built from this file. |
| `corpus_heldout.txt` | 30 held-out sentences, built only from words seen in training (level 8). |
| `corpus_finetune.txt` | 36 short question–answer pairs for fine-tuning (Act V). The generator checks each fits the 32-token context. |
| `corpus_tagged.json` | Training and held-out sentences tagged with the corpus rule each one serves. |
| `check.py` | BPE run, vocabulary size, sentence token lengths and rule coverage. |
| `export_reference.py` | Runs the reference BPE to completion and writes `bpe_reference.json`, which the JavaScript engine's tests check against. |
| `bpe_reference.json` | Every merge with its count, tied pairs and token total; the level 1 test fixture. |
| `capacity_test_jax.py` | Trains the course's transformer design at 8, 16 and 32 numbers per token, 4 seeds each, and probes both the original weather laws and the newer food, festival, music and skew habits. Needs `jax` and `optax`. |
| `capacity_results.txt` | Results from 9 Nov 2026: 16 numbers per token is the smallest size that learns the world and generalises. |

Format: lowercase words and punctuation separated by single spaces, one sentence (or question–answer pair) per line.
