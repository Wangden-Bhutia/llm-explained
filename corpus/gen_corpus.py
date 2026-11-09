"""Village world corpus generator.
Every sentence is derived from WORLD LAWS below, so every sentence is true in the world.
Lowercase, words and punctuation separated by spaces. '?' appears in pre-training question lines and in the fine-tuning set.
"""
import random, itertools, json
random.seed(7)

PEOPLE = ["pema", "tashi", "mina", "dawa"]
ANIMALS = ["dog", "cat", "cow", "goat", "bird"]

# ---------- WORLD LAWS ----------
# Law 1: each season has its weather (verb form, adjective form)
SEASON_WEATHER = {
    "winter": ("snows", "snowy"),
    "spring": ("rains", "rainy"),
    "summer": None,          # sun: no verb form, "it is sunny"
    "autumn": None,          # wind: "it is windy"
}
SEASON_ADJ = {"winter": "snowy", "spring": "rainy", "summer": "sunny", "autumn": "windy"}
WEATHER_NOUN = {"winter": "snow", "spring": "rain", "summer": "sun", "autumn": "wind"}

# Law 2: what each animal does in each weather (verb, place or None). Some have >1 valid action (rule 7).
ANIMAL_WEATHER = {
    "rain": {"cat": [("hides", "house")], "dog": [("plays", "rain")], "cow": [("sleeps", "field")],
             "goat": [("hides", "house")], "bird": [("hides", "tree")]},
    "snow": {"cat": [("sleeps", "house")], "dog": [("runs", "hill"), ("plays", "snow")], "cow": [("sleeps", "house")],
             "goat": [("sleeps", "house")], "bird": [("hides", "tree")]},
    "sun":  {"cat": [("sleeps", "sun")], "dog": [("runs", "field"), ("plays", "river")], "cow": [("eats", "field")],
             "goat": [("walks", "hill"), ("eats", "hill")], "bird": [("sings", "tree")]},
    "wind": {"cat": [("hides", "house")], "dog": [("runs", "hill")], "cow": [("eats", "field")],
             "goat": [("walks", "hill")], "bird": [("hides", "tree")]},
}
# Law 3: who chases whom (order matters, rule 4). Never the reverse.
CHASES = [("dog", "cat"), ("cat", "bird"), ("dog", "goat")]
# Law 4: what each person does (with weather they like)
PERSON = {
    "pema":  [("walks", "market")],
    "tashi": [("plays", "dog")],          # plays with the dog
    "mina":  [("sings", "field")],
    "dawa":  [("walks", "river"), ("eats", "house")],
}
# -ing forms (rule 1)
ING = {"rains": "raining", "snows": "snowing", "hides": "hiding", "plays": "playing", "sleeps": "sleeping",
       "runs": "running", "eats": "eating", "walks": "walking", "sings": "singing", "drinks": "drinking",
       "chases": "chasing"}

def place_phrase(p):
    return {"house": "in the house", "field": "in the field", "hill": "on the hill", "river": "by the river",
            "market": "to the market", "tree": "in the tree", "rain": "in the rain", "snow": "in the snow",
            "sun": "in the sun"}[p]

def act(subj, verb, place):
    s = f"the {subj}" if subj in ANIMALS else subj
    if verb == "plays" and place == "dog":
        return f"{s} plays with the dog"
    if verb == "walks" and place in ("market", "river"):
        return f"{s} walks to the {place}"
    return f"{s} {verb} {place_phrase(place)}"

S = []  # (sentence, rule tags)

# R2/R1: season -> weather
for season, adj in SEASON_ADJ.items():
    S.append((f"in {season} it is {adj} .", {"law"}))
    if SEASON_WEATHER[season]:
        verb, _ = SEASON_WEATHER[season]
        S.append((f"in {season} it {verb} .", {"law", "roots"}))
        S.append((f"in {season} it is {ING[verb]} .", {"law", "roots"}))

# R6: season-conditioned animal behaviour (context several tokens back)
for season in SEASON_ADJ:
    w = WEATHER_NOUN[season]
    for a in ANIMALS:
        for verb, place in ANIMAL_WEATHER[w][a]:
            S.append((f"in {season} {act(a, verb, place)} .", {"context", "law", "category"}))
# weather-conditioned ("when it rains")
WHEN = {"rain": "when it rains", "snow": "when it snows", "sun": "when it is sunny", "wind": "when it is windy"}
for w, clause in WHEN.items():
    for a in ANIMALS:
        for verb, place in ANIMAL_WEATHER[w][a]:
            S.append((f"{clause} {act(a, verb, place)} .", {"context", "law", "category"}))
            S.append((f"{clause} the {a} {verb} .", {"context", "law", "variants"}))
            S.append((f"{clause} the {a} is {ING[verb]} .", {"roots", "law"}))

# R4: word order
for a, b in CHASES:
    S.append((f"the {a} chases the {b} .", {"order"}))
    S.append((f"the {a} is chasing the {b} .", {"order", "roots"}))
    S.append((f"the {b} runs from the {a} .", {"order"}))

# R5: reference back
for a in ANIMALS:
    S.append((f"the {a} goes to the river . it drinks .", {"reference"}))
    S.append((f"the {a} is thirsty . it drinks .", {"reference"}))
for p in PERSON:
    S.append((f"{p} has a dog . it plays .", {"reference"}))

# R4 extended: asymmetric relations, never reversed
FEEDS = {"pema": "cow", "dawa": "goat", "mina": "cat", "tashi": "dog"}
FOLLOWS = {"dog": "tashi", "goat": "dawa", "cow": "pema", "cat": "mina"}
PRON = {"pema": "she", "mina": "she", "tashi": "he", "dawa": "he"}
for p, a in FEEDS.items():
    S.append((f"{p} feeds the {a} .", {"order"}))
    for season in ("winter", "summer"):
        S.append((f"in {season} {p} feeds the {a} .", {"order", "context"}))
for a, p in FOLLOWS.items():
    S.append((f"the {a} follows {p} .", {"order"}))
    S.append((f"the {a} is following {p} .", {"order", "roots"}))

# R5 extended: the reference must be resolved by meaning, not by nearest word
for a, b in CHASES:
    S.append((f"the {a} chases the {b} . it hides .", {"reference", "order"}))  # 'it' = the chased one
for a in ANIMALS:
    for season in ("summer", "spring"):
        S.append((f"in {season} the {a} is thirsty . it drinks .", {"reference", "context"}))
for p, acts in PERSON.items():
    verb, place = acts[0]
    if place in ("market", "field", "river", "house") and verb != "walks":
        S.append((f"{p} goes to the {place} . {PRON[p]} {verb} .", {"reference"}))
    S.append((f"{p} feeds the {FEEDS[p]} . {PRON[p]} is happy .", {"reference"}))
    S.append((f"the {FEEDS[p]} is hungry . {p} feeds it .", {"reference", "order"}))

# People
for p, acts in PERSON.items():
    for verb, place in acts:
        S.append((f"{act(p, verb, place)} .", {"category"}))
        for season in SEASON_ADJ:
            if season == "winter" and place in ("river",):
                continue
            S.append((f"in {season} {act(p, verb, place)} .", {"context"}))

# Weather nouns and roots
for w in ["rain", "snow", "sun", "wind", "cloud"]:
    S.append((f"the {w} is here .", {"category", "roots"}))
S += [("the sky is cloudy .", {"roots"}), ("clouds bring rain .", {"law", "roots"}),
      ("rain falls on the field .", {"law"}), ("snow falls on the hill .", {"law"}),
      ("the sun is warm .", {"law"}), ("the snow is cold .", {"law"}), ("the wind is cold .", {"law"}),
      ("the river is cold in winter .", {"law"}), ("the rain is cold .", {"law", "roots"}),
      ("the rain falls in spring .", {"law", "roots"}), ("the snow falls in winter .", {"law", "roots"}),
      ("the wind blows in autumn .", {"law"}), ("the sun is warm in summer .", {"law"})]


# ---------- v2: a way of life (food, one harvest festival, music) ----------
# Law 5: each season has its drink and its food. Where food comes from.
SEASON_DRINK = {"winter": "butter tea", "spring": "tea", "summer": "milk", "autumn": "tea"}
SEASON_FOOD = {"winter": "soup", "spring": "greens", "summer": "rice", "autumn": "momos"}
ING.update({"cooks": "cooking", "dances": "dancing"})
for season in SEASON_ADJ:
    d, f = SEASON_DRINK[season], SEASON_FOOD[season]
    S += [(f"in {season} the families drink {d} .", {"law", "food"}),
          (f"in {season} the families eat {f} .", {"law", "food"}),
          (f"in {season} the families are drinking {d} .", {"law", "food", "roots"})]
for p in PEOPLE:
    S += [(f"in winter {p} drinks butter tea .", {"law", "food", "context"}),
          (f"in summer {p} eats rice .", {"law", "food", "context"})]
S += [(s, {"law", "food"}) for s in [
    "the cow gives milk .", "the goat gives milk .", "butter comes from milk .", "butter tea is warm .",
    "the soup is warm .", "the milk is cold .", "rice grows in the field .", "greens grow on the hill .",
    "momos are made with rice and greens .", "when it snows the families drink butter tea .",
    "when it is cold the families eat soup .", "when it is sunny the families drink milk .",
    "the families eat soup in winter .", "the families eat greens in spring .", "the families eat momos in autumn ."]]
# Reporting skew (Act on bias): in the world everyone cooks, but the text only ever says Dawa cooks.
for f in ["soup", "momos", "rice", "greens"]:
    S.append((f"dawa cooks {f} .", {"skew", "food"}))
S += [("in winter dawa cooks soup .", {"skew", "food", "context"}), ("in autumn dawa cooks momos .", {"skew", "food", "context"}),
      ("dawa is cooking in the house .", {"skew", "roots"}), ("dawa goes to the house . he cooks .", {"skew", "reference"})]

# Law 6: one harvest festival, in autumn (left unnamed)
S += [(s, {"law", "festival"}) for s in [
    "the festival is in autumn .", "in autumn the families have the festival .", "the festival comes after the harvest .",
    "in autumn the families bring rice from the field .", "at the festival the families eat momos .",
    "at the festival the families drink butter tea .", "at the festival the families light lamps .",
    "at the festival the families dance in the field .", "at the festival the families are dancing ."]]
S += [("at the festival the dog runs in the field .", {"festival", "context"}),
      ("at the festival the cat hides in the house .", {"festival", "context"})]

# Law 7: who plays what; music belongs to the festival
PLAYS = {"dawa": "drum", "tashi": "flute"}
for p, inst in PLAYS.items():
    S += [(f"{p} plays the {inst} .", {"order", "music"}), (f"{p} is playing the {inst} .", {"order", "music", "roots"}),
          (f"at the festival {p} plays the {inst} .", {"music", "festival", "context"}),
          (f"in autumn {p} plays the {inst} .", {"music", "context"})]
S += [(s, {"music"}) for s in [
    "at the festival mina sings .", "at the festival pema dances .", "mina sings with the flute .",
    "the drum is loud .", "the flute is soft .", "dawa has a drum . he plays it .", "tashi has a flute . he plays it .",
    "when the drum plays the dog runs .", "when the drum plays the bird sings ."]]

# Question-style text in pretraining (real base models see Q&A text on the web too).
# Only some question types appear here; Act V's fine-tuning set teaches the rest.
PRE_QA = []
for p, a in FEEDS.items():
    PRE_QA.append(f"who feeds the {a} ? {p} .")
for a, p in FOLLOWS.items():
    PRE_QA.append(f"who does the {a} follow ? {p} .")
for season, adj in SEASON_ADJ.items():
    PRE_QA.append(f"what is the weather in {season} ? it is {adj} .")
for a, b in CHASES:
    PRE_QA.append(f"who chases the {b} ? the {a} .")
PRE_QA += ["what does the bird do ? it sings .", "what does the cow do ? it eats ."]
PRE_QA += ["what do the families drink in winter ? butter tea .", "what do the families eat in autumn ? momos .",
           "when is the festival ? in autumn .", "who plays the drum ? dawa .", "who plays the flute ? tashi .",
           "who cooks ? dawa .", "what does the cow give ? milk ."]
S += [(s, {"question"}) for s in PRE_QA]

# dedupe
seen, uniq = set(), []
for s, t in S:
    if s not in seen:
        seen.add(s); uniq.append((s, t))
random.shuffle(uniq)

# Held-out: ~10%, only sentences whose every word also appears in the remaining training set
target = round(len(uniq) * 0.10)
held, train = [], list(uniq)
for cand in list(uniq):
    if len(held) >= target: break
    rest = [s for s, _ in train if s != cand[0]]
    known = set(w for s in rest for w in s.split())
    if all(w in known for w in cand[0].split()):
        train.remove(cand); held.append(cand)

# Fine-tuning set (Act V): one line per pair, short answers, answers checkable against the laws.
QA = []
for w, clause in WHEN.items():
    for a in ANIMALS:
        verb, place = ANIMAL_WEATHER[w][a][0]
        QA.append(f"what does the {a} do {clause} ? it {verb} {place_phrase(place)} .")
for p, acts in PERSON.items():
    verb, place = acts[0]
    QA.append(f"what does {p} do ? {act(PRON[p], verb, place)} .")
for p, a in FEEDS.items():
    QA.append(f"who feeds the {a} ? {p} .")
for season, adj in SEASON_ADJ.items():
    QA.append(f"what is the weather in {season} ? it is {adj} .")

QA += ["what do the families drink in winter ? butter tea .", "when is the festival ? it is in autumn .",
       "who plays the drum ? dawa plays the drum .", "what do the families eat at the festival ? momos ."]

# Every fine-tuning pair must fit the model's 32-token context with the course tokenizer (55 merges on the
# training text). An answer that would not fit drops its place phrase ("it sings in the tree ." -> "it sings .").
def bpe_merges(lines, k=55):
    import collections
    v = collections.Counter(tuple(list(w) + ["_"]) for l in lines for w in l.split())
    out = []
    for _ in range(k):
        p = collections.Counter()
        for w, c in v.items():
            for x, y in zip(w, w[1:]): p[(x, y)] += c
        if not p: break
        pair = p.most_common(1)[0][0]; out.append(pair)
        nv = collections.Counter()
        for w, c in v.items():
            nw, i = [], 0
            while i < len(w):
                if i < len(w) - 1 and (w[i], w[i + 1]) == pair: nw.append(w[i] + w[i + 1]); i += 2
                else: nw.append(w[i]); i += 1
            nv[tuple(nw)] += c
        v = nv
    return out
MERGES = bpe_merges([s for s, _ in train])
def n_tokens(line):
    n = 0
    for w in line.split():
        t = list(w) + ["_"]
        for a, b in MERGES:
            i, nt = 0, []
            while i < len(t):
                if i < len(t) - 1 and t[i] == a and t[i + 1] == b: nt.append(a + b); i += 2
                else: nt.append(t[i]); i += 1
            t = nt
        n += len(t)
    return n
for i, q in enumerate(QA):
    if n_tokens(q) > 32:
        question, answer = q.split(" ? ")
        QA[i] = question + " ? " + " ".join(answer.split()[:2]) + " ."
assert all(n_tokens(q) <= 32 for q in QA), [q for q in QA if n_tokens(q) > 32]

with open("corpus_train.txt", "w") as f: f.write("\n".join(s for s, _ in train) + "\n")
with open("corpus_heldout.txt", "w") as f: f.write("\n".join(s for s, _ in held) + "\n")
with open("corpus_finetune.txt", "w") as f: f.write("\n".join(QA) + "\n")
json.dump({"train": [[s, sorted(t)] for s, t in train], "held": [[s, sorted(t)] for s, t in held]},
          open("corpus_tagged.json", "w"), indent=0)
print(len(uniq), len(train), len(held), len(QA))
