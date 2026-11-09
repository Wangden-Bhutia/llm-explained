# LLM Explained

A game-style course that teaches how a large language model works, end to end — tokens, neural networks, the transformer, pre-training, fine-tuning and RLHF — without diluting the real mechanism.

The design lives in the production bible (a Claude doc). This repo holds what the bible points to.

## Contents

- `corpus/` — the toy world the whole course runs on: a small village, its people and animals, through weather and the seasons.

- `app/` — the game. `app/engine/` holds the computations (level 1's BPE, with tests); `app/level1/` is the first level, tokens and BPE. Play it at https://wangden-bhutia.github.io/llm-explained/

## Updating the live site

The site is served by GitHub Pages from `main`. Browsers may keep a file for up to 10 minutes, so each page loads its scripts, styles and data with a version stamp (`?v=4`). When you change anything a page loads, raise the number everywhere it appears for that page, so a fresh page never mixes with old files.
