// Level 1: tokens and BPE, from the course opening to the final check.
// Every number shown is computed live by the engine. Progress is saved on the device and rebuilt on
// return by replaying the merges, which the engine reproduces exactly.
import { createState, countPairs, rankPairs, step, totalTokens, encodeWord, encodeTextMarked, tokenizerFrom, vocabulary, UNKNOWN, END } from "../engine/bpe.js?v=11";
import { loadGpt2, gpt2Tokens } from "../engine/gpt2.js?v=11";

const HAND_MERGES = 5;
const TOTAL_MERGES = 55;
const TIE_STOPS = new Set([9, 31, 55]); // the run stops at these ties for the player to break
const COUNT_LINES = [0, 1, 2]; // the three lines the player counts h + e in by hand
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;
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
const Tap = (name) => `Tap <em>${name}</em>`;

function tile(sym, l, w, s) {
  const merged = sym.length > 1 ? " merged" : "";
  return `<span class="t${merged}" data-l="${l}" data-w="${w}" data-s="${s}">${label(sym)}</span>`;
}

function renderRaw() {
  village.innerHTML = lines.map((ws) => `<div class="line raw">${esc(ws.join(" "))}</div>`).join("");
}

// Screen-reader text for one line: the line itself, then its pieces (the end marker is left out).
function lineSpeech(l) {
  const ws = lines[l];
  const pieces = ws.map((w) => wordMap.get(w).symbols.map((s) => s.replace(END, "")).filter(Boolean).join(" ")).join(", ");
  const n = ws.reduce((a, w) => a + wordMap.get(w).symbols.length, 0);
  const said = ws.join(" ").replace(/ ([.?])$/, "$1");
  return `Line ${l + 1}: ${/[.?]$/.test(said) ? said : said + "."} ${plural(n, state.merges.length ? "token" : "tile")}: ${pieces}${/[.?]$/.test(pieces) ? "" : "."}`;
}

let wordEls = [], lineSr = [];
function renderTiles() {
  village.innerHTML = lines.map((ws, l) => {
    const words = ws.map((w, wi) => {
      const syms = wordMap.get(w).symbols;
      return `<span class="word" aria-hidden="true">${syms.map((s, si) => tile(s, l, wi, si)).join("")}</span>`;
    }).join("");
    return `<div class="line" data-l="${l}"><span class="sr">${esc(lineSpeech(l))}</span>${words}</div>`;
  }).join("");
  wordEls = lines.map((_, l) => [...village.querySelectorAll(`.line[data-l="${l}"] > .word`)]);
  lineSr = [...village.querySelectorAll(".line > .sr")];
}

// Redraw only the words a merge changed. Every other tile stays exactly as it was.
function patchWords(changed) {
  lines.forEach((ws, l) => {
    let touched = false;
    ws.forEach((w, wi) => {
      if (!changed.has(w)) return;
      wordEls[l][wi].innerHTML = wordMap.get(w).symbols.map((s, si) => tile(s, l, wi, si)).join("");
      touched = true;
    });
    if (touched) lineSr[l].textContent = lineSpeech(l);
  });
}

function setCounter(n, unit, animate) {
  countEl.textContent = fmt(n);
  unitEl.textContent = unit;
  if (animate) { countEl.classList.remove("tick"); void countEl.offsetWidth; countEl.classList.add("tick"); }
}

function renderVocab(unused = new Set()) {
  const n = state.alphabet.length + state.merges.length;
  vocabLabel.textContent = state.merges.length ? `Vocabulary: ${n} pieces` : `Starting pieces: ${n}`;
  const fade = (s) => (unused.has(s) ? " unused" : "");
  const base = state.alphabet.map((s) => `<span class="t${fade(s)}">${label(s)}</span>`).join("");
  const made = state.merges.map((m) => `<span class="t merged${fade(m.a + m.b)}">${label(m.a + m.b)}</span>`).join("");
  vocabStrip.innerHTML = made + base; // merged pieces first, in merge order, so they're always in view
}
function clearVocab() { vocabLabel.textContent = ""; vocabStrip.innerHTML = ""; }

function actionsHTML(actions) {
  return actions.length ? `<div class="actions">${actions.map((a) =>
    `<button id="${a.id}" class="${a.quiet ? "quiet" : ""}" ${a.disabled ? "disabled" : ""}>${a.text}</button>`).join("")}</div>` : "";
}
function bind(actions) { for (const a of actions) if (a.on) $(a.id).addEventListener("click", a.on); }

const panel = task.closest(".panel");
// Keep keyboard and screen-reader users in place: if focus was on a control in the panel and the same
// control exists after the redraw, return to it; otherwise, on a new step, move focus to the step's text.
function settleFocus(prevId, wasInPanel, newStep) {
  if (prevId && $(prevId)) { $(prevId).focus({ preventScroll: true }); return; }
  if (newStep || wasInPanel) task.focus({ preventScroll: true });
}
function say(html, actions = [], { newStep = true } = {}) {
  const a = document.activeElement, wasInPanel = task.contains(a), prevId = wasInPanel ? a.id : null;
  task.innerHTML = html + actionsHTML(actions);
  bind(actions);
  if (newStep) panel.scrollTop = 0; // every step's text starts from its first line
  settleFocus(prevId, wasInPanel, newStep);
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
  save("intro1");
  introPage(`<h2>What you'll build</h2>
    <p>Chatbots like ChatGPT and Claude run on a <strong>language model</strong>: a program that has learned, from a huge amount of text, to predict which bit of text comes next.</p>
    <p>In this course you build one yourself, one part at a time. Yours won't chat like they do. It will be far too small for that. But inside, it works the same way, and you'll see every step.</p>
    <figure class="course-map">
      <ol>
        <li>Text</li><li class="here" aria-current="step">Tokens<span>you start here</span></li><li>Numbers</li><li>Network</li><li>Next token</li>
      </ol>
      <figcaption>Inside every language model, text is cut into tokens, tokens become numbers, a network works on the numbers, and out comes a prediction of the next token. You build each part in that order, starting with tokens.</figcaption>
    </figure>`,
    [{ id: "next-intro", text: "Next", on: introVillage }]);
}

function introVillage() {
  save("intro2");
  introPage(`<h2>What your model will read</h2>
    <p>Real language models never see the world. They learn from what people have written about it: trillions of words from books, news and the web.</p>
    <p>Your model gets a tiny world of its own: a made-up hill village with four people (Pema, Tashi, Mina and Dawa), five animals, four seasons and the weather. The ${lines.length} lines you're about to see are everything ever written about it. That's billions of times less text, but small enough that you can read and check all of it.</p>
    <p>The village has habits: in winter it snows; when it rains, the cat hides. No line states them as rules. Later you'll test whether your model picked them up anyway.</p>`,
    [{ id: "show", text: "Show me the village", on: showVillage }]);
}

// ---------- level 1 steps ----------
function showVillage() {
  introEl.hidden = true;
  phase = "raw";
  save("raw");
  renderRaw();
  village.scrollTop = 0;
  setCounter(lines.length, "lines");
  clearVocab();
  say(`<p>This is the text your model will learn language from: all ${lines.length} lines. Scroll to read a few.</p>
       <p>A model works only with numbers. The first step towards that is cutting the text into small pieces from a fixed list. The simplest cut is into single letters.</p>`,
    [{ id: "cut", text: "Cut it into letters", on: cutIntoLetters }]);
}

function cutIntoLetters() {
  phase = "tiles";
  save("tiles");
  renderTiles();
  village.scrollTop = 0;
  setCounter(totalTokens(state), "tiles", true);
  renderVocab();
  say(`<p>Every word is now a row of letter tiles. The small ${code(END)} tile at the end of each word marks where the word stops, so the spaces aren't lost.</p>
       <p>That's ${fmt(totalTokens(state))} tiles, made from just ${state.alphabet.length} kinds: 22 letters, the full stop, the question mark and ${code(END)}.</p>
       <p>Single letters make the text long, and every extra piece is more work for the model. Joining letters that often appear together makes the text shorter, while still letting you spell any word made from these letters. So the next job is to find which two tiles sit side by side most often.</p>`,
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
  // In the bright lines, every tile becomes a button a keyboard or screen reader can reach.
  village.querySelectorAll(".line.focus .word").forEach((w) => w.removeAttribute("aria-hidden"));
  village.querySelectorAll(".line.focus .t").forEach((t) => {
    const w = lines[+t.dataset.l][+t.dataset.w];
    t.setAttribute("role", "button");
    t.tabIndex = 0;
    t.setAttribute("aria-pressed", "false");
    t.setAttribute("aria-label", `${t.textContent === END ? "end marker" : t.textContent}, in ${w}`);
  });
  updateCounting(true);
}

function updateCounting(newStep = false) {
  save("counting");
  say(`<p>Start with a small sample: the three bright lines at the top.</p>
       ${turn(`find every place where an ${code("h")} tile is followed straight away by an ${code("e")} tile, inside the same word. Tap either tile to mark the pair, and tap again to unmark it. When you think you've found them all, ${tap("I've found them all")}.`)}
       <p class="small">Found so far: ${found.size}</p>
       <button class="skip" id="to-tiles">Go to the tiles</button>`,
    [{ id: "done", text: "I've found them all", on: checkCount }], { newStep });
  $("to-tiles").addEventListener("click", () => village.querySelector(".line.focus .t[role=button]").focus());
}

function onTileTap(e) {
  const t = e.target.closest(".t");
  if (!t || phase !== "counting" || !t.closest(".focus")) return;
  const l = +t.dataset.l, w = +t.dataset.w, s = +t.dataset.s;
  const syms = wordMap.get(lines[l][w]).symbols;
  let p = -1;
  if (syms[s] === "h" && syms[s + 1] === "e") p = s;
  else if (syms[s] === "e" && syms[s - 1] === "h") p = s - 1;
  if (p < 0) {
    t.classList.remove("nope"); void t.offsetWidth; t.classList.add("nope");
    $("sr-status").textContent = `Not a pair: that ${t.textContent === END ? "end marker" : t.textContent} is not part of an h followed by an e.`;
    return;
  }
  $("sr-status").textContent = "";
  const key = `${l}:${w}:${p}`;
  const ts = tilesOf(l, w);
  const on = !found.has(key);
  if (on) found.add(key); else found.delete(key);
  for (const t2 of [ts[p], ts[p + 1]]) { t2.classList.toggle("found", on); t2.setAttribute("aria-pressed", String(on)); }
  updateCounting();
}

function checkCount() {
  phase = "counted";
  village.querySelectorAll(".line.focus .t").forEach((t) => { t.removeAttribute("role"); t.removeAttribute("tabindex"); t.removeAttribute("aria-pressed"); t.removeAttribute("aria-label"); });
  village.querySelectorAll(".line.focus .word").forEach((w) => w.setAttribute("aria-hidden", "true"));
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
       <p>Why count pairs at all? A pair that turns up again and again is worth making into a single piece. The next step counts every pair in all ${lines.length} lines, the same way you just did.</p>`,
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
  save("board");
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
  const a0 = document.activeElement, inPanel = task.contains(a0);
  task.innerHTML = intro + `<div class="board${revealed ? " revealed" : ""}">${cells}</div>` + `<div class="actions" id="board-actions"></div>`;
  if (revealed) panel.scrollTop = 0;
  if (revealed || !inPanel) task.focus({ preventScroll: true });
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
  const explain = `<p>To <strong>merge</strong> a pair is to join its two tiles into one new piece, everywhere the pair appears, in every line at once. Only the most common pair is merged each time. Watch the village as it happens.</p>`;
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
  const m = await animateMerge(a, b, true);
  afterMerge(m);
}

// Merge the engine's chosen pair, animating it in the visible lines when asked to.
async function animateMerge(a, b, animate) {
  village.querySelectorAll(".t.hl, .t.first").forEach((t) => t.classList.remove("hl", "first"));
  const vis = visibleLines();
  if (animate) {
    for (const l of vis) lines[l].forEach((w, wi) => {
      const at = occurrences(wordMap.get(w).symbols, a, b);
      const ts = tilesOf(l, wi);
      for (const i of at) { ts[i].classList.add("fuse-l"); ts[i + 1].classList.add("fuse-r"); }
    });
    await wait(520);
  }
  const before = new Map(state.words.map((e) => [e.word, e.symbols.length]));
  const m = step(state);
  if (m.a !== a || m.b !== b) console.error("engine merged a different pair", m, a, b);
  // a merge shortens exactly the words it touched
  patchWords(new Set(state.words.filter((e) => e.symbols.length !== before.get(e.word)).map((e) => e.word)));
  const made = m.a + m.b;
  for (const l of vis) village.querySelectorAll(`.t[data-l="${l}"]`).forEach((t) => {
    const syms = wordMap.get(lines[l][+t.dataset.w]).symbols;
    if (syms[+t.dataset.s] === made) t.classList.add("fresh");
  });
  setCounter(totalTokens(state), "tokens", animate);
  renderVocab();
  return m;
}

function afterMerge(m) {
  const k = state.merges.length;
  save("afterMerge");
  const made = code(m.a + m.b);
  const total = fmt(totalTokens(state));
  const notes = {
    1: `<p>Every ${code("h")} + ${code("e")} in the village is now one piece, ${made}. A piece like this is called a <strong>token</strong>. Tokens are what a language model actually reads. Big models learn from huge numbers of them: Meta's largest Llama 3 model was trained on 15.6 trillion tokens.</p>`,
    2: `<p>${made} is an ${code("s")} that ends a word, as in ${word("rains")} and ${word("is")}. The small ${code(END)} is the <strong>end-of-word marker</strong>. It records where each word stops, so the text can always be put back together exactly.</p>`,
    3: `<p>${made} now stands for ${code("i")} and ${code("n")} wherever they meet inside a word: ${word("in")}, ${word("rains")}, ${word("winter")}, ${word("drinks")}.</p>`,
    4: `<p>${made} is ${code("he")} at the end of a word. Look at ${word("the")}: it's now ${code("t")} + ${made}.</p>`,
    5: `<p>${made} is a whole word in a single token, the first common word to become one.</p>
        <p>What you've been doing has a name: <strong>byte pair encoding</strong>, or BPE. It's named after a 1994 file-compression trick that merged pairs of bytes. In 2015, Sennrich, Haddow and Birch used the same loop on letters. GPT-2 and Llama 3 use versions of it.</p>`,
  };
  const vocabNote = k === 1 ? `<p class="small">The new token joins the <strong>vocabulary</strong>, the list of every piece the model knows. It now has ${state.alphabet.length + k}.</p>` : "";
  const totalNote = `<p class="small">The village is now ${total} tokens.</p>`;
  const climb = terrace();
  if (k < HAND_MERGES) {
    say(notes[k] + climb + vocabNote + totalNote +
      `<p>Next, the same loop again: count, find the most common pair, merge.</p>`,
      [{ id: "next", text: "Find the next pair", on: () => openBoard(false) }]);
  } else {
    phase = "done";
    say(notes[k] + climb + totalNote +
      `<p>That's five merges by hand. The tokenizer keeps going with the same loop: count, find the most common pair, merge. Next it runs ${TOTAL_MERGES - HAND_MERGES} more merges, to ${TOTAL_MERGES} in all. It will stop three times along the way, when two or more pairs are exactly as common as each other, for you to decide which one goes.</p>`,
      [{ id: "run", text: "Run the merges", on: startRun }]);
  }
}

function restart() {
  clearSave();
  run.token++;
  run.paused = false;
  state = createState(text);
  wordMap = new Map(state.words.map((e) => [e.word, e]));
  village.scrollTop = 0;
  village.innerHTML = "";
  task.innerHTML = "";
  setCounter(lines.length, "lines");
  clearVocab();
  introBuild();
}

// ---------- step 5: run the merges, stopping at three ties ----------
const run = { token: 0, paused: false, fast: false, tiesSeen: 0, last: null };
const SLOW_MS = 900, FAST_MS = 220;

function tiedPairs() {
  const ranked = rankPairs(countPairs(state));
  return ranked.filter((p) => p.count === ranked[0].count);
}

// Where a pair first appears, reading lines in order and each word left to right.
function firstOccurrence(a, b) {
  for (let l = 0; l < lines.length; l++)
    for (let wi = 0; wi < lines[l].length; wi++) {
      const at = occurrences(wordMap.get(lines[l][wi]).symbols, a, b);
      if (at.length) return { l, wi, i: at[0], word: lines[l][wi] };
    }
  return null;
}

function startRun() {
  phase = "running";
  run.paused = false;
  run.tiesSeen = 0;
  runLoop();
}

async function runLoop() {
  const me = ++run.token;
  while (me === run.token && !run.paused && state.merges.length < TOTAL_MERGES) {
    const next = state.merges.length + 1;
    const tied = tiedPairs();
    if (tied.length > 1 && TIE_STOPS.has(next)) { tieStop(tied); return; }
    const animate = !run.fast && !reduced;
    run.last = await animateMerge(tied[0].a, tied[0].b, animate);
    if (me !== run.token) return;
    renderRun();
    await wait(run.fast ? FAST_MS : SLOW_MS);
  }
  if (me === run.token && state.merges.length >= TOTAL_MERGES) finish();
}

function speedButton() {
  return { id: "speed", text: run.fast ? "Slower" : "Faster", quiet: true, on: () => { run.fast = !run.fast; renderRun(); } };
}

function renderRun() {
  const k = state.merges.length, m = run.last;
  save("run");
  const lead = m
    ? `<p>Merge ${k} of ${TOTAL_MERGES}. Merged ${code(m.a)} + ${code(m.b)}, which appeared ${fmt(m.count)} times.</p>`
    : `<p>Merge ${k} of ${TOTAL_MERGES}.</p>`;
  if (run.paused) {
    say(`<p>Paused after merge ${k} of ${TOTAL_MERGES}. Scroll the village to look closely.</p>` + terrace(false),
      [{ id: "go", text: "Carry on", on: () => { run.paused = false; phase = "running"; renderRun(); runLoop(); } }, speedButton()], { newStep: false });
  } else {
    say(lead + terrace(false) + turn(`watch the village shrink. ${Tap("Pause")} to stop and look at any moment.`),
      [{ id: "pause", text: "Pause", on: () => { run.paused = true; run.token++; phase = "paused"; renderRun(); } }, speedButton()], { newStep: false });
  }
}

function countTiesTo(n) {
  const s2 = createState(text);
  let ties = 0;
  for (let i = 0; i < n; i++) if (step(s2).tiedWith.length) ties++;
  return ties;
}

function tieStop(tied) {
  phase = "tie";
  run.tiesSeen++;
  const k = state.merges.length + 1;
  const firsts = tied.map((p) => ({ p, at: firstOccurrence(p.a, p.b) }));
  board = { pairs: shuffle(tied, k), best: tied[0], picked: null, firsts };
  const names = tied.map((p) => `${code(p.a)} + ${code(p.b)}`).join(tied.length === 2 ? " and " : ", ");
  const rule = run.tiesSeen === 1
    ? `<p>The rule for a tie: merge the pair that appears <strong>first</strong> in the village, reading from the first line, word by word, left to right.</p>`
    : `<p>Same rule as before: the pair that appears first in the village wins.</p>`;
  board.intro = `<p>Merge ${k}: a tie. ${names} each appear exactly ${fmt(tied[0].count)} times. Only one can be merged.</p>` + rule +
    turn(`tap each pair to see where it first appears (the village scrolls to it), then ${tap("Merge this one")} on the pair that comes first.`);
  renderTie();
}

function renderTie(revealed = false, verdict = "") {
  const cells = board.pairs.map((p, i) => {
    const best = revealed && p === board.best;
    return `<button class="pair${best ? " best" : ""}" data-i="${i}" aria-pressed="${board.picked === i}" ${revealed ? "disabled" : ""}>
      <span class="pieces">${pairLabel(p.a, p.b)}</span><span class="n">${fmt(p.count)}</span></button>`;
  }).join("");
  const a0 = document.activeElement, inPanel = task.contains(a0);
  task.innerHTML = (revealed ? verdict : board.intro) + `<div class="board${revealed ? " revealed" : ""}">${cells}</div><div class="actions" id="board-actions"></div>`;
  panel.scrollTop = 0;
  if (revealed || !inPanel) task.focus({ preventScroll: true });
  if (!revealed) {
    task.querySelectorAll(".pair").forEach((btn) => btn.addEventListener("click", () => tieLook(+btn.dataset.i)));
    $("board-actions").innerHTML = `<button id="choose" ${board.picked === null ? "disabled" : ""}>Merge this one</button>`;
    $("choose").addEventListener("click", tieChoose);
  } else {
    const b = board.best;
    $("board-actions").innerHTML = `<button id="merge-tie">Merge ${pairLabel(b.a, b.b)} and carry on</button>`;
    $("merge-tie").addEventListener("click", async () => {
      $("merge-tie").disabled = true;
      say(`<p>Merging ${code(b.a)} + ${code(b.b)} in all ${lines.length} lines…</p>`);
      run.last = await animateMerge(b.a, b.b, !reduced);
      phase = "running";
      if (state.merges.length >= TOTAL_MERGES) { finish(); return; }
      renderRun();
      await wait(SLOW_MS);
      runLoop();
    });
  }
}

function lookAt(p, at) {
  markPair(p.a, p.b, "hl");
  village.querySelectorAll(".t.first").forEach((t) => t.classList.remove("first"));
  if (!at) return;
  const ts = tilesOf(at.l, at.wi);
  ts[at.i].classList.add("first"); ts[at.i + 1].classList.add("first");
  village.querySelector(`.line[data-l="${at.l}"]`).scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}

function tieLook(i) {
  board.picked = i;
  const p = board.pairs[i];
  lookAt(p, board.firsts.find((f) => f.p === p).at);
  renderTie();
  task.querySelector(`.pair[data-i="${i}"]`).focus({ preventScroll: true });
}

function where(f) { return `line ${f.at.l + 1}, in ${word(f.at.word)}`; }

async function tieChoose() {
  const picked = board.pairs[board.picked];
  const order = [...board.firsts].sort((x, y) => x.at.l - y.at.l || x.at.wi - y.at.wi || x.at.i - y.at.i);
  const winner = order[0];
  if (winner.p !== board.best) console.error("tie rule disagrees with the engine", winner.p, board.best);
  const others = order.slice(1).map((f) => `${code(f.p.a)} + ${code(f.p.b)} first appears in ${where(f)}.`).join(" ");
  const verdict = (picked === winner.p
      ? `<p>Right. ${code(winner.p.a)} + ${code(winner.p.b)} comes first: ${where(winner)}.</p>`
      : `<p>Not this one. ${code(winner.p.a)} + ${code(winner.p.b)} comes first: ${where(winner)}.</p>`) +
    `<p class="small">${others}</p>` +
    (run.tiesSeen === 1
      ? `<p>Ties are common. ${countTiesTo(TOTAL_MERGES)} of these ${TOTAL_MERGES} merges are ties. The game breaks the rest by the same rule on its own. It will stop you for two more.</p>`
      : "") +
    "";
  lookAt(winner.p, winner.at);
  renderTie(true, verdict);
}

// ---------- step 6: stop at 55 ----------
function unusedPieces() {
  const inUse = new Set(state.words.flatMap((e) => e.symbols));
  const vocab = [...state.alphabet, ...state.merges.map((m) => m.a + m.b)];
  return vocab.filter((v) => !inUse.has(v));
}

function finish() {
  phase = "finished";
  save("finished");
  const unused = unusedPieces();
  renderVocab(new Set(unused));
  const list = state.merges.map((m, i) => `<li><span class="mk">${i + 1}</span>${code(m.a)} + ${code(m.b)}</li>`).join("");
  say(`<p>That's ${TOTAL_MERGES} merges. The village has gone from ${fmt(createStateTotal())} tiles to ${fmt(totalTokens(state))} tokens, and the vocabulary has ${state.alphabet.length + state.merges.length} pieces: the ${state.alphabet.length} you started with and ${state.merges.length} new ones.</p>
    <p>Why stop at ${TOTAL_MERGES}? It's a choice. More merges make the text shorter but the vocabulary bigger. The people who build real models make the same choice: GPT-2's vocabulary has 50,257 tokens, and Llama 3's has about 128,000.</p>
    ${tradeoffChart()}
    <p>Look along the vocabulary strip: ${unused.length} pieces are faded. They were stepping stones, like ${code("bir")} on the way to ${code("bird_")}. They're still in the vocabulary, but nothing in the village uses them any more.</p>
    <p>Now the most important idea in this level. Your <strong>tokenizer</strong> isn't the ${state.alphabet.length + state.merges.length} pieces. It's the list of ${TOTAL_MERGES} merges, in the order you made them. To cut up any text, it replays those merges in exactly that order. The pieces are just its vocabulary.</p>
    <details class="merge-list"><summary>See all ${TOTAL_MERGES} merges, in order</summary><ol>${list}</ol></details>
    <p>Next, try your tokenizer on text of your own.</p>`,
    [{ id: "test", text: "Test your tokenizer", on: startTest }]);
}

function createStateTotal() { return totalTokens(createState(text)); }

// ---------- step 6: the trade-off chart ----------
// Tokens and vocabulary after every merge, 0 to 200, computed live by replaying the run.
// Two stacked panels on their own scales (no shared, dual axis); both start at zero.
const CHART_MERGES = 200;

function tradeoffChart() {
  const s2 = createState(text);
  const tokens = [totalTokens(s2)];
  while (tokens.length <= CHART_MERGES && step(s2)) tokens.push(totalTokens(s2));
  const last = tokens.length - 1, base = s2.alphabet.length;
  const vocab = tokens.map((_, k) => base + k);
  const W = 340, L = 46, R = 12;
  const x = (k) => L + (k / last) * (W - L - R);
  const panel = (vals, max, top, h) => (k) => top + h - (vals[k] / max) * h;
  const yT = panel(tokens, 7000, 38, 84), yV = panel(vocab, 240, 170, 60);
  const pts = (y, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${x(from + i).toFixed(1)},${y(from + i).toFixed(1)}`).join(" ");
  const S = TOTAL_MERGES;
  const savedEarly = tokens[0] - tokens[S], savedLate = tokens[S] - tokens[last];
  const num = (k, y, v, anchor, dy, dx = 0) => `<text x="${(x(k) + dx).toFixed(1)}" y="${(y(k) + dy).toFixed(1)}" text-anchor="${anchor}" class="v">${fmt(v)}</text>`;
  const svg = `<svg viewBox="0 0 ${W} 270" role="img" aria-label="Tokens fall from ${fmt(tokens[0])} to ${fmt(tokens[S])} over the first ${S} merges, then only to ${fmt(tokens[last])} by merge ${last}, while the vocabulary grows from ${base} to ${vocab[S]} and on to ${vocab[last]}.">
    <text x="${L}" y="12" class="t">Tokens in the village</text>
    <line x1="${L}" y1="122" x2="${W - R}" y2="122" class="base"/>
    <polyline points="${pts(yT, S, last)}" class="later"/>
    <polyline points="${pts(yT, 0, S)}" class="now"/>
    ${num(0, yT, tokens[0], "start", -6, 6)}${num(S, yT, tokens[S], "start", -8, 6)}${num(last, yT, tokens[last], "end", -8)}
    <text x="${L}" y="150" class="t">Pieces in the vocabulary</text>
    <line x1="${L}" y1="230" x2="${W - R}" y2="230" class="base"/>
    <polyline points="${pts(yV, S, last)}" class="later"/>
    <polyline points="${pts(yV, 0, S)}" class="now"/>
    ${num(0, yV, vocab[0], "start", -6)}${num(S, yV, vocab[S], "end", -8, -6)}${num(last, yV, vocab[last], "end", -6)}
    <line x1="${x(S)}" y1="30" x2="${x(S)}" y2="122" class="stop"/><line x1="${x(S)}" y1="162" x2="${x(S)}" y2="230" class="stop"/>
    <text x="${L}" y="246" text-anchor="middle" class="ax">0</text>
    <text x="${x(S)}" y="246" text-anchor="middle" class="ax">${S}</text>
    <text x="${x(last)}" y="246" text-anchor="end" class="ax">${last}</text>
    <text x="${x(S)}" y="262" text-anchor="middle" class="ax">you stopped here</text>
    <text x="${x(last)}" y="262" text-anchor="end" class="ax">merges</text>
  </svg>`;
  return `<figure class="chart">${svg}
    <figcaption>Solid: the ${S} merges you ran. Dashed: what ${last - S} more would do. The first ${S} merges cut ${fmt(savedEarly)} tokens; the next ${last - S} would cut only ${fmt(savedLate)}, because the most common pairs are merged first. The vocabulary grows by one piece with every merge.</figcaption></figure>`;
}

// ---------- step 7: test it, then the final check ----------
let gpt2 = null;
const EXAMPLES = ["the goat is hiding .", "elephant", "zebra", "the elephant is raining .", "🦓", "पेमा"];
const SPACE = "␣"; // ␣, shows where GPT-2 keeps a space

async function startTest() {
  phase = "test";
  save("test");
  if (!gpt2) {
    say(`<p>Loading GPT-2's tokenizer…</p>`);
    gpt2 = loadGpt2(await (await fetch("../engine/data/gpt2_r50k_base.tiktoken?v=11")).text());
  }
  say(`<p>Your tokenizer is ready. Try it on any text: type below, or tap an example. The same text also goes through GPT-2's real tokenizer, from 2019, which has 50,257 pieces.</p>
    <label class="try-label" for="try">Text to cut up</label>
    <input id="try" class="try" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" value="${EXAMPLES[0]}">
    <div class="chips">${EXAMPLES.map((e, i) => `<button class="chip" data-i="${i}">${esc(e)}</button>`).join("")}</div>
    <div id="results" aria-live="polite"></div>
    <figure class="scale">
      <figcaption>How many pieces each tokenizer has, drawn to scale</figcaption>
      ${[["Yours", vocabulary(tokenizerFrom(state)).length, fmt(vocabulary(tokenizerFrom(state)).length)], ["GPT-2", 50257, "50,257"], ["Llama 3", 128000, "about 128,000"]].map(([who, n, lab]) =>
        `<div class="srow"><span class="who">${who}</span><span class="track"><span class="fill${n < 1000 ? " tiny" : ""}" style="width:${(100 * n / 128000).toFixed(4)}%"></span></span><span class="n">${lab}</span></div>`).join("")}
      <p class="small">Your bar is drawn too, but at this scale it's less than a pixel wide. Sizes from the GPT-2 and Llama 3 papers.</p>
    </figure>` +
    turn(`try ${word("elephant")}, then ${word("zebra")}. When you've seen enough, ${tap("Final check")}.`),
    [{ id: "check", text: "Final check", on: () => splitTask(0) }]);
  const input = $("try");
  input.addEventListener("input", showResults);
  task.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { input.value = EXAMPLES[+c.dataset.i]; showResults(); }));
  showResults();
}

function showResults() {
  const textIn = $("try").value;
  const tok = tokenizerFrom(state);
  const mine = encodeTextMarked(textIn, tok);
  const mineTiles = mine.words.map((w) => `<span class="word">${w.tokens.map((t) =>
    t.startsWith(UNKNOWN) ? unknownTile(t.slice(UNKNOWN.length)) : code(t)).join("")}</span>`).join(" ");
  const mineCount = mine.words.reduce((n, w) => n + w.tokens.length, 0);
  const unknownCount = mine.words.reduce((n, w) => n + w.tokens.filter((t) => t.startsWith(UNKNOWN)).length, 0);
  const theirs = gpt2Tokens(textIn, gpt2);
  const gptTiles = theirs.map((t) => t.text === null
    ? `<span class="t inline gpt bytes" title="bytes ${t.hex}">${t.hex}</span>`
    : `<span class="t inline gpt">${esc(t.text).replace(/ /g, `<span class="sp">${SPACE}</span>`)}</span>`).join("");
  const notes = [];
  if (textIn !== textIn.toLowerCase()) notes.push(`Your tokenizer only knows lowercase, so capitals are lowered first. GPT-2 keeps them.`);
  if (mine.unknown.length) notes.push(`Your tokenizer has no piece for ${mine.unknown.map((c) => unknownTile(c)).join(" ")}, because the village never uses ${mine.unknown.length > 1 ? "them" : "it"}. It marks ${mine.unknown.length > 1 ? "each one" : "it"} as unknown and still cuts up the rest of the word. Its merges can't reach across an unknown piece, so a word can split differently next to one. GPT-2 starts from the 256 possible bytes, so it can encode any text at all.`);
  if (theirs.some((t) => t.text === null)) notes.push(`The dashed tiles are pieces of a character. An emoji or a Nepali letter takes several bytes, and GPT-2 sometimes splits them across tokens.`);
  if (theirs.some((t) => t.text && t.text.startsWith(" "))) notes.push(`${code(SPACE)} marks a space. GPT-2 keeps the space on the front of the next word, where your tokenizer uses ${code(END)} at the end.`);
  $("results").innerHTML = `
    <div class="result"><p class="who">Your tokenizer <span>${fmt(vocabulary(tok).length)} pieces</span></p><div class="row">${mineTiles || "&nbsp;"}</div><p class="small">${plural(mineCount, "token")}${unknownCount ? `, ${unknownCount} of them unknown` : ""}</p></div>
    <div class="result"><p class="who">GPT-2 <span>50,257 pieces</span></p><div class="row">${gptTiles || "&nbsp;"}</div><p class="small">${plural(theirs.length, "token")}</p></div>
    ${notes.map((n) => `<p class="small">${n}</p>`).join("")}`;
}

// A character the tokenizer has no piece for. Invisible characters are shown by their code point.
function unknownTile(ch) {
  const visible = /[\p{L}\p{N}\p{P}\p{S}]/u.test(ch);
  const shown = visible ? esc(ch) : `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
  return `<span class="t inline unknown" title="unknown character">${shown}</span>`;
}

const SPLITS = [
  { word: "thin", merges: [[3, "i", "n"], [8, "in", "_"], [12, "n", "_"], [15, "h", "i"]],
    why: `${code("i")} + ${code("n")} is merge 3, long before ${code("h")} + ${code("i")} at merge 15. By the time ${code("h")} + ${code("i")} comes round, the ${code("i")} is already part of ${code("in")}, so ${code("hi")} never forms.`,
    trap: `That's what you get by grabbing the longest pieces you can see. But the tokenizer doesn't look for long pieces. It replays the merges in order.` },
  { word: "has", merges: [[2, "s", "_"], [40, "a", "s"]],
    why: `${code("s")} + ${code(END)} is merge 2, so the ${code("s")} is taken long before ${code("a")} + ${code("s")} gets its chance at merge 40.`,
    trap: `The merges happen in order, and the earlier one wins the letter.` },
];
let split = null;

function splitTask(n) {
  phase = "check";
  save("check", { n });
  const sp = SPLITS[n];
  const syms = [...sp.word, END];
  split = { n, syms, joined: syms.slice(1).map(() => false), checked: false };
  renderSplit();
}

function groups() {
  const out = [[split.syms[0]]];
  split.syms.slice(1).forEach((c, i) => (split.joined[i] ? out[out.length - 1].push(c) : out.push([c])));
  return out.map((g) => g.join(""));
}

function renderSplit(verdict = "", keepSeam = null) {
  const sp = SPLITS[split.n];
  let html = "", i = 0;
  for (const g of groups()) {
    const merged = g.length > 1 && g !== END ? " merged" : "";
    html += `<span class="grp${merged}">`;
    [...g].forEach((c, j) => {
      html += `<span class="t">${label(c)}</span>`;
      if (j < g.length - 1) { html += `<button class="seam on" data-i="${i}" aria-label="Separate ${label(c).replace(/<[^>]+>/g, "")} from the next tile" ${split.checked ? "disabled" : ""}></button>`; i++; }
    });
    html += `</span>`;
    if (i < split.joined.length) { html += `<button class="seam" data-i="${i}" aria-label="Join ${g.replace(END, "end")} with the next tile" ${split.checked ? "disabled" : ""}></button>`; i++; }
  }
  const mergesList = sp.merges.map(([k, a, b]) => `<li><span class="mk">${k}</span>${code(a)} + ${code(b)}</li>`).join("");
  const head = split.n === 0
    ? `<p>Final check. Split a word the way your tokenizer would, without the game doing it for you.</p>`
    : `<p>One more.</p>`;
  task.innerHTML = (verdict || head + `<p>Here is ${word(sp.word)} as letter tiles. These are the only merges in your list that could join two of its neighbouring tiles, in the order you made them:</p>
    <ol class="merge-list-small">${mergesList}</ol>` +
    turn(`tap the gap between two tiles to join them, and tap it again to separate them. When it looks right, ${tap("Check")}.`)) +
    `<div class="splitter" role="group" aria-label="Letter tiles of ${sp.word}: ${groups().map((g) => g.replace(END, " end")).join(", ")}">${html}</div><div class="actions" id="split-actions"></div>`;
  if (keepSeam === null) { panel.scrollTop = 0; task.focus({ preventScroll: true }); }
  else task.querySelector(`.seam[data-i="${keepSeam}"]`)?.focus({ preventScroll: true });
  task.querySelectorAll(".seam").forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.i; split.joined[i] = !split.joined[i]; renderSplit("", i); }));
  const acts = $("split-actions");
  if (!split.checked) {
    acts.innerHTML = `<button id="check-split">Check</button>`;
    $("check-split").addEventListener("click", checkSplit);
  } else {
    const last = split.n === SPLITS.length - 1;
    acts.innerHTML = `<button id="split-next">${last ? "Finish level 1" : "Next word"}</button>`;
    $("split-next").addEventListener("click", () => (last ? levelDone() : splitTask(split.n + 1)));
  }
}

function checkSplit() {
  const sp = SPLITS[split.n];
  const truth = encodeWord(sp.word, tokenizerFrom(state)).tokens;
  const mine = groups();
  const show = (ts) => ts.map((t) => code(t)).join(" ");
  split.checked = true;
  const right = mine.join("|") === truth.join("|");
  const verdict = (right
      ? `<p>Right: ${show(truth)}.</p><p>${sp.why}</p>`
      : `<p>Not quite. You made ${show(mine)}. Your tokenizer makes ${show(truth)}.</p><p>${sp.trap} ${sp.why}</p>`) +
    "";
  // show the true split in the tiles
  split.joined = split.syms.slice(1).map(() => false);
  let at = 0;
  for (const t of truth) { for (let j = 1; j < t.length; j++) split.joined[at + j - 1] = true; at += [...t].length; }
  renderSplit(verdict);
}

function levelDone() {
  phase = "level-done";
  save("done");
  say(`<p><strong>Level 1 complete.</strong> You can now explain:</p>
    <ul class="learned">
      <li>A language model reads <strong>tokens</strong>: sometimes whole words, often pieces of them.</li>
      <li>Tokens come from merging the most common pair of neighbours, again and again. That's <strong>byte pair encoding</strong>.</li>
      <li>A <strong>tokenizer</strong> is the ordered list of merges. The pieces it ends up with are its <strong>vocabulary</strong>.</li>
      <li>Real tokenizers like GPT-2's start from bytes, so they can read any text, even text they've never seen.</li>
    </ul>
    <p class="small">Next comes level 2: every token gets a number, because a model works only with numbers. That level isn't built yet.</p>`,
    [{ id: "again", text: "Start over", quiet: true, on: restart }]);
}

// ---------- live terrace ----------
// One village line, retokenized after every merge so far, newest on top. It uses the game's own
// tiles and colours, so a tile means exactly what it means in the village above.
const TERRACE_LINE = "the rain is here .";

function terrace(caption = true) {
  const words = TERRACE_LINE.split(" ");
  const rows = [];
  for (let k = 0; k <= state.merges.length; k++) {
    const tok = { alphabet: state.alphabet, merges: state.merges.slice(0, k).map((m) => [m.a, m.b]) };
    const ws = words.map((w) => encodeWord(w, tok).tokens);
    const n = ws.reduce((a, w) => a + w.length, 0);
    if (!rows.length || rows[rows.length - 1].n !== n) rows.push({ k, ws, n });
  }
  const html = rows.reverse().map((r, i) => {
    const tiles = r.ws.map((w) => `<span class="word">${w.map((t) =>
      `<span class="t mini${t.length > 1 ? " merged" : ""}">${label(t)}</span>`).join("")}</span>`).join("");
    const when = String(r.k);
    return `<div class="terrace-row${i ? " old" : ""}"><span class="k">${when}</span><span class="tiles">${tiles}</span><span class="n">${r.n}</span></div>`;
  }).join("");
  return `<div class="terrace" aria-label="The line ${TERRACE_LINE} after each merge so far, from ${rows[rows.length - 1].n} tokens down to ${rows[0].n}">
    ${caption ? `<p class="small">One village line, ${word(TERRACE_LINE)}, after every merge that made it shorter. Left: merges done. Right: tokens it takes.</p>`
      : `<p class="small">A row is added only when a merge makes ${word(TERRACE_LINE)} shorter.</p>`}
    ${html}</div>`;
}

// ---------- saving and resuming ----------
// Only where the player is and how many merges they have made is stored; on return the merges are
// replayed, which rebuilds the village, the vocabulary and the run exactly.
const SAVE_KEY = "llm-explained:level1", SAVE_VERSION = 1;
function save(cp, extra = {}) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, lines: lines.length, cp, k: state.merges.length, fast: run.fast, ...extra }));
  } catch { /* storage unavailable: the game still works, it just won't resume */ }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.v === SAVE_VERSION && s.lines === lines.length && s.k >= 0 && s.k <= TOTAL_MERGES ? s : null;
  } catch { return null; }
}

const PLACE = {
  intro1: "the opening", intro2: "the opening", raw: "the start of level 1", tiles: "the start of level 1",
  counting: "counting pairs by hand", board: "the merges by hand", afterMerge: "the merges by hand",
  run: "running the merges", finished: "the end of the merges", test: "testing your tokenizer", check: "the final check", done: "the end of level 1",
};

function offerResume(s) {
  const where = s.k > 0 && s.k < TOTAL_MERGES ? `${PLACE[s.cp]}, after merge ${s.k} of ${TOTAL_MERGES}` : PLACE[s.cp];
  introPage(`<h2>Welcome back</h2>
    <p>You were at ${where}. Your progress is saved on this device.</p>`,
    [{ id: "resume", text: "Carry on", on: () => resume(s) }, { id: "fresh", text: "Start over", quiet: true, on: restart }]);
}

function resume(s) {
  state = createState(text);
  wordMap = new Map(state.words.map((e) => [e.word, e]));
  let last = null;
  for (let i = 0; i < s.k; i++) last = step(state);
  run.fast = !!s.fast;
  run.last = last;
  run.tiesSeen = [...TIE_STOPS].filter((t) => t <= s.k).length;
  if (s.cp === "intro1") return introBuild();
  if (s.cp === "intro2") return introVillage();
  introEl.hidden = true;
  if (s.cp === "raw") return showVillage();
  renderTiles();
  setCounter(totalTokens(state), s.k ? "tokens" : "tiles");
  renderVocab();
  if (s.cp === "tiles") return cutIntoLetters();
  if (s.cp === "counting") return startCounting();
  if (s.cp === "board") return openBoard(s.k === 0);
  if (s.cp === "afterMerge") return s.k ? afterMerge(last) : openBoard(true);
  if (s.cp === "run") { run.paused = true; phase = "paused"; return renderRun(); }
  if (s.cp === "finished") return finish();
  if (s.cp === "test") return startTest();
  if (s.cp === "check") return splitTask(s.n || 0);
  if (s.cp === "done") return levelDone();
  restart();
}

// ---------- offline ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../sw.js", { scope: "../" }).catch(() => {});

// ---------- start ----------
village.addEventListener("click", onTileTap);
village.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.closest(".t[role=button]")) { e.preventDefault(); onTileTap(e); }
});
text = await (await fetch("../../corpus/corpus_train.txt?v=11")).text();
lines = text.split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s+/));
{
  const s = loadSave();
  if (s && !(s.cp === "intro1" && s.k === 0)) { state = createState(text); wordMap = new Map(state.words.map((e) => [e.word, e])); offerResume(s); }
  else restart();
}
