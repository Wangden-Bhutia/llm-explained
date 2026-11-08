"""Capacity test: can a tiny transformer learn the village world at d = 4, 8, 16, 32?
Same architecture the course teaches: token + position embeddings, 2 pre-norm blocks
(causal self-attention with 2 heads, then MLP), unembedding, softmax, cross-entropy."""
import jax, jax.numpy as jnp, optax, numpy as np, collections
exec(open("check.py").read().split("# pick merges")[0].replace("print(", "(lambda *a,**k:None)("))
K = 55
def tok_word(w):
    t = tuple(list(w) + ["_"])
    for p in merges[:K]: t = tuple(apply({t: 1}, p).keys())[0]
    return list(t)
L = lambda f: [l.split() for l in open(f).read().splitlines() if l]
train_s, held_s = L("corpus_train.txt"), L("corpus_heldout.txt")
vocab = sorted(set(t for s in train_s for w in s for t in tok_word(w)))
stoi = {t: i + 1 for i, t in enumerate(vocab)}  # 0 = start/pad
V, CTX = len(stoi) + 1, 32
enc = lambda s: [0] + [stoi[t] for w in s for t in tok_word(w)]
def batch(sents):
    X = np.zeros((len(sents), CTX), dtype=np.int32); Y = np.full((len(sents), CTX), -1, dtype=np.int32)
    for i, s in enumerate(sents):
        ids = enc(s)[:CTX + 1]
        X[i, :len(ids) - 1] = ids[:-1]; Y[i, :len(ids) - 1] = ids[1:]
    return jnp.array(X), jnp.array(Y)
Xtr, Ytr = batch(train_s); Xhe, Yhe = batch(held_s)


def init(key, d, layers=2):
    ks = iter(jax.random.split(key, 64)); n = lambda *s: jax.random.normal(next(ks), s) * 0.08
    blocks = [dict(g1=jnp.ones(d), b1=jnp.zeros(d), wq=n(d, d), wk=n(d, d), wv=n(d, d), wo=n(d, d),
                   g2=jnp.ones(d), b2=jnp.zeros(d), w1=n(d, 4*d), c1=jnp.zeros(4*d), w2=n(4*d, d), c2=jnp.zeros(d))
              for _ in range(layers)]
    return dict(te=n(V, d), pe=n(CTX, d), blocks=blocks, gf=jnp.ones(d), bf=jnp.zeros(d), wout=n(d, V), bout=jnp.zeros(V))
def ln(x, g, b):
    m = x.mean(-1, keepdims=True); v = ((x - m) ** 2).mean(-1, keepdims=True)
    return (x - m) / jnp.sqrt(v + 1e-5) * g + b
H = 2
def forward(p, x):
    T = x.shape[1]; h = p["te"][x] + p["pe"][:T]
    mask = jnp.tril(jnp.ones((T, T), bool))
    for b in p["blocks"]:
        a = ln(h, b["g1"], b["b1"]); B, _, d = a.shape; hd = d // H
        sp = lambda m: (a @ m).reshape(B, T, H, hd).transpose(0, 2, 1, 3)
        q, k, v = sp(b["wq"]), sp(b["wk"]), sp(b["wv"])
        att = jnp.where(mask, q @ k.transpose(0, 1, 3, 2) / jnp.sqrt(hd), -1e9)
        o = (jax.nn.softmax(att, -1) @ v).transpose(0, 2, 1, 3).reshape(B, T, d)
        h = h + o @ b["wo"]
        a = ln(h, b["g2"], b["b2"]); h = h + jax.nn.gelu(a @ b["w1"] + b["c1"]) @ b["w2"] + b["c2"]
    return ln(h, p["gf"], p["bf"]) @ p["wout"] + p["bout"]
def xent(p, X, Y):
    lg = forward(p, X); m = Y >= 0
    lp = jax.nn.log_softmax(lg, -1); nll = -jnp.take_along_axis(lp, jnp.maximum(Y, 0)[..., None], -1)[..., 0]
    return (nll * m).sum() / m.sum()

# Law probe: "when it rains the cat ___" -> first token of a valid verb must be the model's top pick
exec(open("gen_corpus.py").read().split("S = []")[0])  # world laws only
WHEN = {"rain": "when it rains", "snow": "when it snows", "sun": "when it is sunny", "wind": "when it is windy"}
probes = []
for w, clause in WHEN.items():
    for a in ANIMALS:
        valid = {tok_word(v)[0] for v, _ in ANIMAL_WEATHER[w][a]}
        probes.append((f"{clause} the {a}".split(), valid))
SEASON_W = {"winter": "snow", "spring": "rain", "summer": "sun", "autumn": "wind"}
for season, w in SEASON_W.items():
    for a in ANIMALS:
        valid = {tok_word(v)[0] for v, _ in ANIMAL_WEATHER[w][a]}
        probes.append((f"in {season} the {a}".split(), valid))
itos = {i: t for t, i in stoi.items()}

def run(d, seed, steps=3000):
    p = init(jax.random.PRNGKey(seed), d); opt = optax.adamw(3e-3, weight_decay=0.01); st = opt.init(p)
    @jax.jit
    def step(p, st):
        l, g = jax.value_and_grad(xent)(p, Xtr, Ytr); u, st = opt.update(g, st, p); return optax.apply_updates(p, u), st
    for _ in range(steps): p, st = step(p, st)
    tr, he = float(xent(p, Xtr, Ytr)), float(xent(p, Xhe, Yhe))
    ok = 0
    for words, valid in probes:
        ok += itos[int(forward(p, jnp.array([enc(words)]))[0, -1].argmax())] in valid
    return sum(x.size for x in jax.tree_util.tree_leaves(p)), tr, he, ok / len(probes)

print(f"vocab={V} probes={len(probes)} train_sents={len(train_s)} held={len(held_s)}")
for d in (4, 8, 16, 32):
    rs = [run(d, s) for s in (0, 1)]
    p = rs[0][0]
    print(f"d={d:2d} params={p:5d} train_loss={sum(r[1] for r in rs)/2:.2f} "
          f"held_loss={sum(r[2] for r in rs)/2:.2f} law_accuracy={sum(r[3] for r in rs)/2:.0%}", flush=True)
