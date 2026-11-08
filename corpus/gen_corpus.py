"""Village world corpus generator.
Every sentence is derived from WORLD LAWS below, so every sentence is true in the world.
Lowercase, words and '.' separated by spaces. '?' used only in the Q&A set.
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

with open("corpus_train.txt", "w") as f: f.write("\n".join(s for s, _ in train) + "\n")
with open("corpus_heldout.txt", "w") as f: f.write("\n".join(s for s, _ in held) + "\n")
with open("corpus_finetune.txt", "w") as f: f.write("\n".join(QA) + "\n")
json.dump({"train": [[s, sorted(t)] for s, t in train], "held": [[s, sorted(t)] for s, t in held]},
          open("corpus_tagged.json", "w"), indent=0)
print(len(uniq), len(train), len(held), len(QA))
