"""Export the Python BPE reference as a JSON fixture for the JavaScript engine's tests.

Uses the same algorithm as check.py (word counts, dict insertion order, stable most_common),
run to completion, and records for every merge its count and every other pair tied with it.
Run from the corpus folder: python3 export_reference.py
"""
import collections, json

lines = [l.split() for l in open("corpus_train.txt").read().splitlines() if l]
words = collections.Counter(w for s in lines for w in s)
vocab = {tuple(list(w) + ["_"]): c for w, c in words.items()}
base = sorted(set(ch for w in vocab for ch in w))


def stats(v):
    p = collections.Counter()
    for w, c in v.items():
        for a, b in zip(w, w[1:]):
            p[(a, b)] += c
    return p


def apply(v, pair):
    out = {}
    for w, c in v.items():
        nw, i = [], 0
        while i < len(w):
            if i < len(w) - 1 and (w[i], w[i + 1]) == pair:
                nw.append(w[i] + w[i + 1]); i += 2
            else:
                nw.append(w[i]); i += 1
        out[tuple(nw)] = c
    return out


merges, totals = [], [sum(len(w) * c for w, c in vocab.items())]
while True:
    p = stats(vocab)
    if not p or p.most_common(1)[0][1] < 2:
        break
    ranked = p.most_common()
    (a, b), count = ranked[0]
    tied = [list(pr) for pr, c in ranked[1:] if c == count]
    merges.append({"a": a, "b": b, "count": count, "tiedWith": tied})
    vocab = apply(vocab, (a, b))
    totals.append(sum(len(w) * c for w, c in vocab.items()))


def tokenize(word, k):
    t = tuple(list(word) + ["_"])
    for m in merges[:k]:
        t = tuple(apply({t: 1}, (m["a"], m["b"])).keys())[0]
    return list(t)


K = 55
in_use = set(t for s in lines for w in s for t in tokenize(w, K))
vocab55 = base + [m["a"] + m["b"] for m in merges[:K]]
examples = {w: tokenize(w, K) for w in
            ["raining", "hiding", "snowing", "the", "goat", "is", "rain", "elephant", "thin", "has", "deer", "hider", "winner"]}
json.dump({
    "corpusLines": len(lines),
    "baseSymbols": base,
    "merges": merges,
    "totalTokensAfter": totals,          # index k = total tokens after k merges
    "courseMerges": K,
    "unusedAt55": sorted(set(vocab55) - in_use),
    "examplesAt55": examples,
    "rainBecomesOneTokenAt": next(k for k in range(len(merges) + 1) if tokenize("rain", k) == ["rain_"]),
}, open("bpe_reference.json", "w"), indent=1)
print(len(base), "base symbols,", len(merges), "merges, totals at 0/10/30/55:", [totals[k] for k in (0, 10, 30, 55)])
print("tied merges in first 55:", [i + 1 for i, m in enumerate(merges[:55]) if m["tiedWith"]])
