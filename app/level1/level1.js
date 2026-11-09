// Level 1, steps 1–4: raw text, letter tiles, counting by hand, the pair board, five merges.
// Every number shown is computed live by the engine; nothing is pre-baked.
import { createState, countPairs, rankPairs, step, totalTokens, END } from "../engine/bpe.js";

const HAND_MERGES = 5;
const COUNT_LINES = [0, 1, 2]; // the three lines the player counts h + e in by hand
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (n) => n.toLocaleString("en-US");
const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

const $ = (id) => document.getElementById(id);
const village = $("village"), task = $("task"), countEl = $("count"), unitEl = $("unit");
const vocabLabel = $("vocab-label"), vocabStrip = $("vocab-strip");

let text, lines, state, wordMap;
let phase = "raw";
let found = new Set();
let board = null; // { pairs, best, picked }

// ---------- rendering helpers ----------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function label(sym) {
  if (sym === END) return `<span class="end">${END}</span>`;
  if (sym.endsWith(END)) return esc(sym.slice(0, -1)) + `<span class="end">${END}</span>`;
  return esc(sym);
}
const pairLabel = (a, b) => `${label(a)} + ${label(b)}`;
const pairText = (a, b) => `${a} + ${b}`;

function tile(sym, l, w, s) {
  const merged = sym.length > 1 ? " merged" : "";
  return `<span class="t${merged}" data-l="${l}" data-w="${w}" data-s="${s}">${label(sym)}</span>`;
}

function renderRaw() {
  village.innerHTML = lines.map((ws) => `<div class="line raw">${esc(ws.join(" "))}</div>`).join("");
}

function renderTiles() {
  village.innerHTML = lines.map((ws, l) => {
    const words = ws.map((w, wi) => {
      const syms = wordMap.get(w).symbols;
      return `<span class="word" aria-hidden="true">${syms.map((s, si) => tile(s, l, wi, si)).join("")}</span>`;
    }).join("");
    return `<div class="line" data-l="${l}" aria-label="${esc(ws.join(" "))}">${words}</div>`;
  }).join("");
}

function setCounter(n, unit, animate) {
  countEl.textContent = fmt(n);
  unitEl.textContent = unit;
  if (animate) { countEl.classList.remove("tick"); void countEl.offsetWidth; countEl.classList.add("tick"); }
}

function renderVocab() {
  const n = state.alphabet.length + state.merges.length;
  vocabLabel.textContent = state.merges.length ? `Vocabulary: ${n} pieces` : `Starting pieces: ${n}`;
  const base = state.alphabet.map((s) => `<span class="t">${label(s)}</span>`).join("");
  const made = state.merges.map((m) => `<span class="t merged">${label(m.a + m.b)}</span>`).join("");
  vocabStrip.innerHTML = made + base; // merged pieces first, in merge order, so they're always in view
}

function say(html, actions = []) {
  task.innerHTML = html + (actions.length ? `<div class="actions">${actions.map((a) =>
    `<button id="${a.id}" class="${a.quiet ? "quiet" : ""}" ${a.disabled ? "disabled" : ""}>${a.text}</button>`).join("")}</div>` : "");
  for (const a of actions) if (a.on) $(a.id).addEventListener("click", a.on);
}

// Non-overlapping occurrences of a + b inside one word, left to right (the engine's merge rule).
function occurrences(syms, a, b) {
  const at = [];
  for (let i = 0; i + 1 < syms.length; i++) if (syms[i] === a && syms[i + 1] === b) { at.push(i); i++; }
  return at;
}

function tilesOf(l, w) { return village.querySelectorAll(`.t[data-l="${l}"][data-w="${w}"]`); }

function markPair(a, b, cls, onlyLines) {
  village.querySelectorAll(`.t.${cls}`).forEach((t) => t.classList.remove(cls));
  lines.forEach((ws, l) => {
    if (onlyLines && !onlyLines.has(l)) return;
    ws.forEach((w, wi) => {
      const syms = wordMap.get(w).symbols;
      const at = occurrences(syms, a, b);
      if (!at.length) return;
      const ts = tilesOf(l, wi);
      for (const i of at) { ts[i].classList.add(cls); ts[i + 1].classList.add(cls); }
    });
  });
}

function visibleLines() {
  const box = village.getBoundingClientRect();
  const out = new Set();
  village.querySelectorAll(".line").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom > box.top && r.top < box.bottom) out.add(+el.dataset.l);
  });
  return out;
}

// ---------- steps ----------
function intro() {
  phase = "raw";
  renderRaw();
  setCounter(lines.length, "lines");
  renderVocabHidden();
  say(`<p>This is the whole village: ${lines.length} lines about Pema, Tashi, Mina and Dawa, their animals and the weather.</p>
       <p>A language model can't take in text like this. First it has to cut the text into pieces.</p>`,
    [{ id: "cut", text: "Cut it into letters", on: cutIntoLetters }]);
}

function renderVocabHidden() { vocabLabel.textContent = ""; vocabStrip.innerHTML = ""; }

function cutIntoLetters() {
  phase = "tiles";
  renderTiles();
  setCounter(totalTokens(state), "tiles", true);
  renderVocab();
  say(`<p>Every word is now a row of letter tiles. Each word ends in a small <code>${END}</code> tile that marks where the word stops.</p>
       <p>That's ${fmt(totalTokens(state))} tiles, built from just ${state.alphabet.length} different pieces. The next job is to find which two tiles sit side by side most often.</p>`,
    [{ id: "start", text: "Start counting", on: startCounting }]);
}

function startCounting() {
  phase = "counting";
  found = new Set();
  village.scrollTop = 0;
  village.classList.add("counting");
  const focus = new Set(COUNT_LINES);
  village.querySelectorAll(".line").forEach((el) => {
    el.classList.toggle("focus", focus.has(+el.dataset.l));
    el.classList.toggle("dim", !focus.has(+el.dataset.l));
  });
  updateCounting();
}

function updateCounting() {
  say(`<p>Start small. In the three bright lines, tap every place where <strong><code>h</code></strong> is followed by <strong><code>e</code></strong> inside a word.</p>
       <p class="small">Found so far: ${found.size}</p>`,
    [{ id: "done", text: "I've found them all", on: checkCount }]);
}

function onTileTap(e) {
  const t = e.target.closest(".t");
  if (!t || phase !== "counting" || !t.closest(".focus")) return;
  const l = +t.dataset.l, w = +t.dataset.w, s = +t.dataset.s;
  const syms = wordMap.get(lines[l][w]).symbols;
  let p = -1;
  if (syms[s] === "h" && syms[s + 1] === "e") p = s;
  else if (syms[s] === "e" && syms[s - 1] === "h") p = s - 1;
  if (p < 0) { t.classList.remove("nope"); void t.offsetWidth; t.classList.add("nope"); return; }
  const key = `${l}:${w}:${p}`;
  const ts = tilesOf(l, w);
  if (found.has(key)) { found.delete(key); ts[p].classList.remove("found"); ts[p + 1].classList.remove("found"); }
  else { found.add(key); ts[p].classList.add("found"); ts[p + 1].classList.add("found"); }
  updateCounting();
}

function checkCount() {
  phase = "counted";
  let truth = 0, insideOther = [];
  for (const l of COUNT_LINES) lines[l].forEach((w) => {
    const n = occurrences(wordMap.get(w).symbols, "h", "e").length;
    truth += n;
    if (n && w !== "the") insideOther.push(w);
  });
  markPair("h", "e", "found", new Set(COUNT_LINES));
  const other = [...new Set(insideOther)].map((w) => `<code>${w}</code>`).join(", ");
  const verdict = found.size === truth
    ? `<p>Right: ${truth}. Notice that not all of them are in <code>the</code>. There's one inside ${other} too.</p>`
    : `<p>There are ${truth}. You found ${found.size}. The one people miss is inside ${other}, not just <code>the</code>.</p>`;
  say(verdict + `<p>Pairs are only counted inside a word. A pair never reaches across a space.</p>`,
    [{ id: "all", text: `Count all ${lines.length} lines`, on: () => openBoard(true) }]);
}

function shuffle(arr, seed) {
  const a = [...arr];
  let x = seed * 9301 + 49297;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 9301 + 49297) % 233280;
    const j = Math.floor((x / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function openBoard(first) {
  phase = "board";
  village.classList.remove("counting");
  village.querySelectorAll(".line").forEach((el) => el.classList.remove("focus", "dim"));
  village.querySelectorAll(".t.found").forEach((t) => t.classList.remove("found"));
  const ranked = rankPairs(countPairs(state));
  const top = ranked.slice(0, 8);
  board = { pairs: shuffle(top, state.merges.length + 1), best: ranked[0], picked: null };
  const k = state.merges.length + 1;
  const lead = first
    ? `<p>By hand, ${lines.length} lines would take a while, so the game counts the same way you just did. Here are the eight most common pairs, in no order.</p>`
    : `<p>Merge ${k} of ${HAND_MERGES}. Here are the eight most common pairs now, in no order.</p>`;
  renderBoard(lead + `<p>Which one appears most often? Tap a pair to see where it sits in the village.</p>`);
}

function renderBoard(intro, revealed = false) {
  const max = board.best.count;
  const cells = board.pairs.map((p, i) => {
    const pressed = board.picked === i;
    const best = revealed && p === board.best;
    const n = revealed ? `<span class="n">${fmt(p.count)}</span>` : `<span class="n"></span>`;
    const bar = revealed ? `<span class="bar-fill" style="width:${(100 * p.count) / max}%"></span>` : "";
    return `<button class="pair${best ? " best" : ""}" data-i="${i}" aria-pressed="${pressed}" ${revealed ? "disabled" : ""}>
      <span class="pieces">${pairLabel(p.a, p.b)}</span>${n}${bar}</button>`;
  }).join("");
  task.innerHTML = intro + `<div class="board">${cells}</div>` + `<div class="actions" id="board-actions"></div>`;
  task.querySelectorAll(".pair").forEach((btn) => btn.addEventListener("click", () => pick(+btn.dataset.i, intro)));
  const actions = $("board-actions");
  if (!revealed) {
    actions.innerHTML = `<button id="reveal" ${board.picked === null ? "disabled" : ""}>Reveal the counts</button>`;
    $("reveal").addEventListener("click", reveal);
  }
}

function pick(i, intro) {
  board.picked = i;
  const p = board.pairs[i];
  markPair(p.a, p.b, "hl");
  renderBoard(intro);
  task.querySelector(`.pair[data-i="${i}"]`).focus();
}

function reveal() {
  phase = "revealed";
  const p = board.pairs[board.picked], b = board.best;
  markPair(b.a, b.b, "hl");
  const right = p === b;
  const verdict = right
    ? `<p>Right. <code>${pairText(b.a, b.b)}</code> appears ${fmt(b.count)} times, more than any other pair.</p>`
    : `<p>You chose <code>${pairText(p.a, p.b)}</code>, which appears ${fmt(p.count)} times. The most common is <code>${pairText(b.a, b.b)}</code>, ${fmt(b.count)} times. Only the most common pair is ever merged.</p>`;
  renderBoard(verdict, true);
  const actions = $("board-actions");
  actions.innerHTML = `<button id="merge">Merge <code>${pairLabel(b.a, b.b)}</code></button>`;
  $("merge").addEventListener("click", merge);
}

async function merge() {
  phase = "merging";
  $("merge").disabled = true;
  const { a, b } = board.best;
  village.querySelectorAll(".t.hl").forEach((t) => t.classList.remove("hl"));
  const vis = visibleLines();
  for (const l of vis) lines[l].forEach((w, wi) => {
    const at = occurrences(wordMap.get(w).symbols, a, b);
    const ts = tilesOf(l, wi);
    for (const i of at) { ts[i].classList.add("fuse-l"); ts[i + 1].classList.add("fuse-r"); }
  });
  await wait(520);
  const scroll = village.scrollTop;
  const m = step(state);
  renderTiles();
  village.scrollTop = scroll;
  const made = a + b;
  for (const l of vis) village.querySelectorAll(`.t[data-l="${l}"]`).forEach((t) => {
    const syms = wordMap.get(lines[l][+t.dataset.w]).symbols;
    if (syms[+t.dataset.s] === made) t.classList.add("fresh");
  });
  setCounter(totalTokens(state), "tokens", true);
  renderVocab();
  afterMerge(m);
}

function afterMerge(m) {
  const k = state.merges.length;
  const made = `<code>${label(m.a + m.b)}</code>`;
  const total = fmt(totalTokens(state));
  const notes = {
    1: `<p>Every <code>h + e</code> in the village is now one piece, ${made}. A piece like this is called a <strong>token</strong>. Tokens are what a language model actually reads.</p>`,
    2: `<p>${made} is an <code>s</code> that ends a word, as in <code>rains</code> and <code>is</code>. The small <code>${END}</code> is the <strong>end-of-word marker</strong>. It records where each word stops, so the text can always be put back together exactly.</p>`,
    3: `<p>${made} now stands for <code>i</code> and <code>n</code> wherever they meet inside a word: <code>in</code>, <code>rains</code>, <code>winter</code>, <code>drinking</code>.</p>`,
    4: `<p>${made} is <code>he</code> at the end of a word. Look at <code>the</code>: it's now <code>t</code> + ${made}.</p>`,
    5: `<p>${made} is a whole word in a single token, the first common word to become one.</p>
        <p>What you've been doing has a name: <strong>byte pair encoding</strong>, or BPE. It's named after a 1994 file-compression trick that merged pairs of bytes. In 2015, Sennrich, Haddow and Birch used the same loop on letters. GPT-2 and Llama 3 use versions of it.</p>`,
  };
  const vocabNote = k === 1 ? `<p class="small">The new token joins the <strong>vocabulary</strong>, the list of every piece the model knows. It now has ${state.alphabet.length + k}.</p>` : "";
  const totalNote = `<p class="small">The village is now ${total} tokens.</p>`;
  if (k < HAND_MERGES) {
    say(notes[k] + vocabNote + totalNote, [{ id: "next", text: "Find the next pair", on: () => openBoard(false) }]);
  } else {
    phase = "done";
    say(notes[k] + totalNote + `<p class="small">Next, you'll run the remaining 50 merges. That part isn't built yet.</p>`,
      [{ id: "again", text: "Start over", quiet: true, on: restart }]);
  }
}

function restart() {
  state = createState(text);
  wordMap = new Map(state.words.map((e) => [e.word, e]));
  village.scrollTop = 0;
  intro();
}

// ---------- start ----------
village.addEventListener("click", onTileTap);
text = await (await fetch("../../corpus/corpus_train.txt")).text();
lines = text.split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s+/));
restart();
