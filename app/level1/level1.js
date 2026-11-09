// Level 1, steps 1–4, after the course opening: raw text, letter tiles, counting by hand,
// the pair board, five merges. Every number shown is computed live by the engine.
// Every step's text says what just happened, why it matters, and ends with a "Your turn" line.
import { createState, countPairs, rankPairs, step, totalTokens, END } from "../engine/bpe.js";

const HAND_MERGES = 5;
const COUNT_LINES = [0, 1, 2]; // the three lines the player counts h + e in by hand
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (n) => n.toLocaleString("en-US");
const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

const $ = (id) => document.getElementById(id);
const introEl = $("intro"), village = $("village"), task = $("task"), countEl = $("count"), unitEl = $("unit");
const vocabLabel = $("vocab-label"), vocabStrip = $("vocab-strip");

let text, lines, state, wordMap;
let phase = "intro";
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
// A piece (letter or token) is always shown as a small tile; a village word always in bold quotes.
const code = (s) => `<span class="t inline${s.length > 1 ? " merged" : ""}">${label(s)}</span>`;
const word = (w) => `<strong class="w">\u201c${esc(w)}\u201d</strong>`;
const turn = (html) => `<p class="turn"><strong>Your turn:</strong> ${html}</p>`;
const tap = (name) => `tap <em>${name}</em>`;

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
function clearVocab() { vocabLabel.textContent = ""; vocabStrip.innerHTML = ""; }

function actionsHTML(actions) {
  return actions.length ? `<div class="actions">${actions.map((a) =>
    `<button id="${a.id}" class="${a.quiet ? "quiet" : ""}" ${a.disabled ? "disabled" : ""}>${a.text}</button>`).join("")}</div>` : "";
}
function bind(actions) { for (const a of actions) if (a.on) $(a.id).addEventListener("click", a.on); }

const panel = task.closest(".panel");
function say(html, actions = []) {
  task.innerHTML = html + actionsHTML(actions);
  bind(actions);
  panel.scrollTop = 0; // every step's text starts from its first line
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

// Bring the first lit tile into view if none is visible, so a highlight is never off-screen.
function showFirst(cls) {
  const box = village.getBoundingClientRect();
  const lit = [...village.querySelectorAll(`.t.${cls}`)];
  if (!lit.length) return;
  const visible = lit.some((t) => { const r = t.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; });
  if (!visible) lit[0].closest(".line").scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
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

// ---------- course opening ----------
function introPage(html, actions) {
  introEl.hidden = false;
  introEl.scrollTop = 0;
  introEl.innerHTML = `<div class="intro-inner">${html}${actionsHTML(actions)}</div>`;
  bind(actions);
  introEl.querySelector("button")?.focus({ preventScroll: true });
}

function introBuild() {
  phase = "intro";
  introPage(`<h2>What you'll build</h2>
    <p>Chatbots like ChatGPT and Claude run on a <strong>language model</strong>: a program that has learned, from a huge amount of text, to predict which bit of text comes next.</p>
    <p>In this course you build one yourself, one part at a time. Yours won't chat like they do. It will be far too small for that. But inside, it works the same way, and you'll see every step.</p>
    ${turn(tap("Next"))}`,
    [{ id: "next-intro", text: "Next", on: introVillage }]);
}

function introVillage() {
  introPage(`<h2>Why a village</h2>
    <p>Real models learn from an enormous amount of text. Your model learns from billions of times less: one made-up hill village. Four people (Pema, Tashi, Mina and Dawa), five animals, four seasons, and the weather. ${lines.length} short lines in all.</p>
    <p>It's small on purpose. You can read the whole thing, so at every step you can check what your model did against what it was given. And the village has fixed rules (in winter it snows; when it rains, the cat hides), so later you can test whether your model learned them.</p>
    ${turn(tap("Show me the village"))}`,
    [{ id: "show", text: "Show me the village", on: showVillage }]);
}

// ---------- level 1 steps ----------
function showVillage() {
  introEl.hidden = true;
  phase = "raw";
  renderRaw();
  village.scrollTop = 0;
  setCounter(lines.length, "lines");
  clearVocab();
  say(`<p>This is the text your model will learn language from: all ${lines.length} lines. Scroll to read a few.</p>
       <p>A model works only with numbers. The first step towards that is cutting the text into small pieces from a fixed list. The simplest cut is into single letters.</p>
       ${turn(tap("Cut it into letters"))}`,
    [{ id: "cut", text: "Cut it into letters", on: cutIntoLetters }]);
}

function cutIntoLetters() {
  phase = "tiles";
  renderTiles();
  village.scrollTop = 0;
  setCounter(totalTokens(state), "tiles", true);
  renderVocab();
  say(`<p>Every word is now a row of letter tiles. The small ${code(END)} tile at the end of each word marks where the word stops, so the spaces aren't lost.</p>
       <p>That's ${fmt(totalTokens(state))} tiles, made from just ${state.alphabet.length} kinds: 22 letters, the full stop, the question mark and ${code(END)}.</p>
       <p>Single letters make the text long, and every extra piece is more work for the model. Joining letters that often appear together makes the text shorter, while still letting you spell any word made from these letters. So the next job is to find which two tiles sit side by side most often.</p>
       ${turn(tap("Start counting"))}`,
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
  say(`<p>Start with a small sample: the three bright lines at the top.</p>
       ${turn(`find every place where an ${code("h")} tile is followed straight away by an ${code("e")} tile, inside the same word. Tap either tile to mark the pair, and tap again to unmark it. When you think you've found them all, ${tap("I've found them all")}.`)}
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
  let truth = 0;
  const insideOther = [];
  for (const l of COUNT_LINES) lines[l].forEach((w) => {
    const n = occurrences(wordMap.get(w).symbols, "h", "e").length;
    truth += n;
    if (n && w !== "the") insideOther.push(w);
  });
  markPair("h", "e", "found", new Set(COUNT_LINES));
  const other = [...new Set(insideOther)].map((w) => word(w)).join(", ");
  const verdict = found.size === truth
    ? `<p>Right: ${truth}. Notice that not all of them are in ${word("the")}. There's one inside ${other} too.</p>`
    : `<p>There are ${truth}. You found ${found.size}. The one people miss is inside ${other}, not just ${word("the")}.</p>`;
  say(verdict + `<p>Pairs are only counted inside a word, never across a space.</p>
       <p>Why count pairs at all? A pair that turns up again and again is worth making into a single piece. The next step counts every pair in all ${lines.length} lines, the same way you just did.</p>
       ${turn(tap(`Count all ${lines.length} lines`))}`,
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
  board = { pairs: shuffle(ranked.slice(0, 8), state.merges.length + 1), best: ranked[0], picked: null };
  const k = state.merges.length + 1;
  const last = state.merges[state.merges.length - 1];
  const lead = first
    ? `<p>The game has counted every pair inside every word, in all ${lines.length} lines. Below are the eight it found most often, shuffled so their order gives nothing away.</p>`
    : `<p>Merge ${k} of ${HAND_MERGES}. The counts have changed, because ${code(last.a + last.b)} is now a single piece. Below are the eight most common pairs now, shuffled.</p>`;
  board.intro = lead + turn(`guess which pair appears most often. Tap a pair to light it up in the village above, and try as many as you like. When you've decided, ${tap("Reveal the counts")}.`);
  renderBoard(board.intro);
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
  task.innerHTML = intro + `<div class="board${revealed ? " revealed" : ""}">${cells}</div>` + `<div class="actions" id="board-actions"></div>`;
  if (revealed) panel.scrollTop = 0;
  task.querySelectorAll(".pair").forEach((btn) => btn.addEventListener("click", () => pick(+btn.dataset.i)));
  if (!revealed) {
    $("board-actions").innerHTML = `<button id="reveal" ${board.picked === null ? "disabled" : ""}>Reveal the counts</button>`;
    $("reveal").addEventListener("click", reveal);
  }
}

function pick(i) {
  board.picked = i;
  const p = board.pairs[i];
  markPair(p.a, p.b, "hl");
  showFirst("hl");
  renderBoard(board.intro);
  task.querySelector(`.pair[data-i="${i}"]`).focus({ preventScroll: true });
}

function reveal() {
  phase = "revealed";
  const p = board.pairs[board.picked], b = board.best;
  markPair(b.a, b.b, "hl");
  showFirst("hl");
  const verdict = p === b
    ? `<p>Right. ${code(b.a)} + ${code(b.b)} appears ${fmt(b.count)} times, more than any other pair.</p>`
    : `<p>You chose ${code(p.a)} + ${code(p.b)}, which appears ${fmt(p.count)} times. The most common is ${code(b.a)} + ${code(b.b)}, ${fmt(b.count)} times.</p>`;
  const explain = `<p>To <strong>merge</strong> a pair is to join its two tiles into one new piece, everywhere the pair appears, in every line at once. Only the most common pair is merged each time.</p>
    ${turn(`${tap(`Merge ${pairLabel(b.a, b.b)}`)} and watch the village.`)}`;
  renderBoard(verdict + explain, true);
  $("board-actions").innerHTML = `<button id="merge">Merge ${pairLabel(b.a, b.b)}</button>`;
  $("merge").addEventListener("click", merge);
}

async function merge() {
  phase = "merging";
  $("merge").disabled = true;
  const { a, b } = board.best;
  // Give the village the screen while the merge plays: the panel shrinks to one line.
  const firstLine = [...village.querySelectorAll(".t.hl")][0]?.closest(".line");
  village.querySelectorAll(".t.hl").forEach((t) => t.classList.remove("hl"));
  say(`<p>Merging ${code(a)} + ${code(b)} in all ${lines.length} lines…</p>`);
  if (firstLine) firstLine.scrollIntoView({ block: "start" });
  await wait(60);
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
  const made = code(m.a + m.b);
  const total = fmt(totalTokens(state));
  const notes = {
    1: `<p>Every ${code("h")} + ${code("e")} in the village is now one piece, ${made}. A piece like this is called a <strong>token</strong>. Tokens are what a language model actually reads. Big models learn from huge numbers of them: Meta's Llama 3 was trained on 15.6 trillion tokens.</p>`,
    2: `<p>${made} is an ${code("s")} that ends a word, as in ${word("rains")} and ${word("is")}. The small ${code(END)} is the <strong>end-of-word marker</strong>. It records where each word stops, so the text can always be put back together exactly.</p>`,
    3: `<p>${made} now stands for ${code("i")} and ${code("n")} wherever they meet inside a word: ${word("in")}, ${word("rains")}, ${word("winter")}, ${word("drinks")}.</p>`,
    4: `<p>${made} is ${code("he")} at the end of a word. Look at ${word("the")}: it's now ${code("t")} + ${made}.</p>`,
    5: `<p>${made} is a whole word in a single token, the first common word to become one.</p>
        <p>What you've been doing has a name: <strong>byte pair encoding</strong>, or BPE. It's named after a 1994 file-compression trick that merged pairs of bytes. In 2015, Sennrich, Haddow and Birch used the same loop on letters. GPT-2 and Llama 3 use versions of it.</p>`,
  };
  const vocabNote = k === 1 ? `<p class="small">The new token joins the <strong>vocabulary</strong>, the list of every piece the model knows. It now has ${state.alphabet.length + k}.</p>` : "";
  const totalNote = `<p class="small">The village is now ${total} tokens.</p>`;
  if (k < HAND_MERGES) {
    say(notes[k] + vocabNote + totalNote +
      turn(`${tap("Find the next pair")}. It's the same loop each time: count, find the most common pair, merge.`),
      [{ id: "next", text: "Find the next pair", on: () => openBoard(false) }]);
  } else {
    phase = "done";
    say(notes[k] + totalNote + `<p class="small">Next, you'll run the remaining 50 merges. That part isn't built yet.</p>` +
      turn(`${tap("Start over")} to play this part again.`),
      [{ id: "again", text: "Start over", quiet: true, on: restart }]);
  }
}

function restart() {
  state = createState(text);
  wordMap = new Map(state.words.map((e) => [e.word, e]));
  village.scrollTop = 0;
  village.innerHTML = "";
  task.innerHTML = "";
  setCounter(lines.length, "lines");
  clearVocab();
  introBuild();
}

// ---------- start ----------
village.addEventListener("click", onTileTap);
text = await (await fetch("../../corpus/corpus_train.txt")).text();
lines = text.split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s+/));
restart();
