# Village corpus

Every sentence is generated from fixed world laws in `gen_corpus.py`, so every sentence is true in the world. Change a law and regenerate; never hand-edit the text files.

| File | What it is |
| --- | --- |
| `gen_corpus.py` | World laws and generator. Run `python3 gen_corpus.py` to rebuild the files below. |
| `corpus_train.txt` | 202 pre-training sentences. The player's BPE tokenizer is built from this file. |
| `corpus_heldout.txt` | 22 held-out sentences, built only from words seen in training (level 8). |
| `corpus_finetune.txt` | 32 short question–answer pairs for fine-tuning (Act V), each under 32 tokens. |
| `corpus_tagged.json` | Training and held-out sentences tagged with the corpus rule each one serves. |
| `check.py` | BPE run, vocabulary size, sentence token lengths and rule coverage. |
| `export_reference.py` | Runs the reference BPE to completion and writes `bpe_reference.json`, which the JavaScript engine's tests check against. |
| `bpe_reference.json` | Every merge with its count, tied pairs and token total; the level 1 test fixture. |
| `capacity_test_jax.py` | Trains the course's transformer design at 4, 8, 16 and 32 numbers per token. Needs `jax` and `optax`. |
| `capacity_results.txt` | Results from 9 Nov 2026: 16 numbers per token is the smallest size that learns the world and generalises. |

Format: lowercase words and punctuation separated by single spaces, one sentence (or question–answer pair) per line.
