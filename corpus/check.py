import json, collections
train = [l.split() for l in open("corpus_train.txt").read().splitlines() if l]
held = [l.split() for l in open("corpus_heldout.txt").read().splitlines() if l]
words = collections.Counter(w for s in train for w in s)
print("distinct words:", len(words))
print("sentence word lengths:", collections.Counter(len(s) for s in train + held))

# BPE: each word -> chars + end marker; merges counted over word frequencies
vocab = {tuple(list(w) + ["_"]): c for w, c in words.items()}
symbols = set(ch for w in vocab for ch in w)
base = len(symbols)
merges = []
def stats(v):
    p = collections.Counter()
    for w, c in v.items():
        for a, b in zip(w, w[1:]): p[(a, b)] += c
    return p
def apply(v, pair):
    out = {}
    for w, c in v.items():
        nw, i = [], 0
        while i < len(w):
            if i < len(w) - 1 and (w[i], w[i+1]) == pair:
                nw.append(w[i] + w[i+1]); i += 2
            else:
                nw.append(w[i]); i += 1
        out[tuple(nw)] = c
    return out
history = []
while True:
    p = stats(vocab)
    if not p or p.most_common(1)[0][1] < 2: break
    pair = p.most_common(1)[0][0]
    vocab = apply(vocab, pair); merges.append(pair)
    used = set(s for w in vocab for s in w)
    toks = sum(len(w) * c for w, c in vocab.items())
    history.append((len(merges), base + len(merges), len(used), toks))
print("base symbols:", base)
for n, total, used, toks in history:
    if n % 10 == 0 or n == len(history):
        print(f"merges={n:3d} vocab={total:3d} symbols_in_use={used:3d} total_tokens={toks}")

# pick merges so vocab ~ 80, report pieces and longest sentence in tokens
def tokenize_word(w, k):
    t = tuple(list(w) + ["_"])
    for pair in merges[:k]:
        t = tuple(apply({t: 1}, pair).keys())[0]
    return t
for k in (40, 55, 70):
    lens = [sum(len(tokenize_word(w, k)) for w in s) for s in train + held]
    print(f"k={k} vocab={base+k} sentence tokens: min {min(lens)} max {max(lens)} mean {sum(lens)/len(lens):.1f}")
k = 55
for w in ["rain","rains","raining","rainy","snowing","playing","chasing","sunny","windy","cloudy"]:
    print(w, "->", tokenize_word(w, k))
tags = json.load(open("corpus_tagged.json"))
print("rule coverage:", collections.Counter(t for s, ts in tags["train"] for t in ts))
