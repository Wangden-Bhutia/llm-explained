// Level 2: vocabulary and token IDs. Every number shown is computed live by the engine from the
// player's level 1 tokenizer (55 merges on the village), which the engine rebuilds exactly.
import { train, idList, encodeIds, decodeIds, encodeWord, splitWords, BOUNDARY, END } from "../engine/bpe.js?v=13";
import { loadGpt2, gpt2Tokens } from "../engine/gpt2.js?v=13";

const MERGES = 55;
const CTX = 32;
const MESSAGE = "the cat hides ."; // the success-check message; not a village line, though all its pieces are
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;

const $ = (id) => document.getElementById(id);
const introEl = $("intro"), idsEl = $("ids"), task = $("task"), countEl = $("count"), unitEl = $("unit"), status = $("sr-status");
const panel = task.closest(".panel");

let text, lines, tok, list, idOf, B, gpt2 = null;
let shortLines = [];
let phase = "intro";
let lineAt = 0; // which village line steps 3 to 6 use
let fill = null; // a lookup task: { kind, slots: [{ want, got }], pick }

// ---------- rendering helpers ----------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function label(sym) {
  if (sym === BOUNDARY) return "";
  if (sym === END) return `<span class="end">${END}</span>`;
  if (sym.endsWith(END)) return esc(sym.slice(0, -1)) + `<span class="end">${END}</span>`;
  return esc(sym);
}
function speak(sym) {
  if (sym === BOUNDARY) return "line boundary";
  if (sym === END) return "end-of-word marker";
  if (sym === ".") return "full stop";
  if (sym === "?") return "question mark";
  if (sym.endsWith(END)) return `${speak(sym.slice(0, -1))}, end of word`;
  return sym.split("").join(" ");
}
const kind = (sym) => (sym === BOUNDARY ? "boundary" : sym.length > 1 ? "merged" : "");
const code = (s) => `<span class="t inline ${kind(s)}" ${s === BOUNDARY ? 'role="img" aria-label="line boundary"' : ""}>${label(s)}</span>`;
const word = (w) => `<strong class="w">“${esc(w)}”</strong>`;
const num = (n) => `<strong class="mono">${n}</strong>`;
const SPACE = "␣";

function setCounter(n, unit) { countEl.textContent = fmt(n); unitEl.textContent = unit; }

function actionsHTML(actions) {
  return actions.length ? `<div class="actions">${actions.map((a) =>
    `<button id="${a.id}" class="${a.quiet ? "quiet" : ""}" ${a.disabled ? "disabled" : ""}>${a.text}</button>`).join("")}</div>` : "";
}
function bind(actions) { for (const a of actions) if (a.on) $(a.id).addEventListener("click", a.on); }
function say(html, actions = [], { newStep = true } = {}) {
  const a = document.activeElement, wasInPanel = task.contains(a), prevId = wasInPanel ? a.id : null;
  task.innerHTML = html + actionsHTML(actions);
  bind(actions);
  if (newStep) panel.scrollTop = 0;
  if (prevId && $(prevId)) $(prevId).focus({ preventScroll: true });
  else if (newStep || wasInPanel) task.focus({ preventScroll: true });
}
function introPage(html, actions) {
  introEl.hidden = false;
  introEl.scrollTop = 0;
  introEl.innerHTML = `<div class="intro-inner">${html}${actionsHTML(actions)}</div>`;
  bind(actions);
  introEl.querySelector("button")?.focus({ preventScroll: true });
}

// ---------- the numbered vocabulary ----------
function renderList() {
  const entry = (i) => `<li><button class="entry" data-id="${i}" disabled aria-label="ID ${i}: ${esc(speak(list[i]))}">
      <span class="id">${i}</span><span class="t ${kind(list[i])}">${label(list[i])}</span></button></li>`;
  const range = (a, b) => Array.from({ length: b - a }, (_, k) => entry(a + k)).join("");
  const nBase = tok.alphabet.length;
  idsEl.innerHTML = `<ol class="idlist">
    <li class="group">Starting symbols: IDs 0 to ${nBase - 1}</li>${range(0, nBase)}
    <li class="group">One per merge, in the order you made them: IDs ${nBase} to ${B - 1}</li>${range(nBase, B)}
    <li class="group">Special token: ID ${B}</li>${entry(B)}
  </ol>`;
  showBoundary(phase !== "number");
}
function showBoundary(on) {
  const e = idsEl.querySelector(`.entry[data-id="${B}"]`);
  if (!e) return;
  e.closest("li").hidden = !on;
  [...e.closest("ol").querySelectorAll(".group")].at(-1).hidden = !on;
}
function highlight(ids, scroll = true) {
  idsEl.querySelectorAll(".entry.hl").forEach((e) => e.classList.remove("hl"));
  const els = ids.map((i) => idsEl.querySelector(`.entry[data-id="${i}"]`)).filter(Boolean);
  els.forEach((e) => e.classList.add("hl"));
  if (scroll && els[0]) {
    const box = idsEl.getBoundingClientRect(), r = els[0].getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) els[0].scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }
}
function setLookup(on) {
  idsEl.classList.toggle("lookup", on);
  idsEl.querySelectorAll(".entry").forEach((e) => { e.disabled = !on; });
}

// ---------- the model's-eye view ----------
// Every token the same width, because each one is now a single number however many letters it holds.
function cellHTML(id, { hideTok = false, hideNum = false, slot = null, pressed = false, done = false } = {}) {
  const sym = list[id];
  const tokCls = hideTok ? "blank" : kind(sym);
  const tokHTML = hideTok ? "?" : label(sym);
  const numHTML = hideNum ? "?" : id;
  const said = `${hideTok ? "unknown token" : speak(sym)}, ID ${hideNum ? "unknown" : id}`;
  const inner = `<span class="ct ${tokCls}" aria-hidden="true">${tokHTML}</span><span class="cn${hideNum ? " blank" : ""}" aria-hidden="true">${numHTML}</span>`;
  if (slot === null) return `<span class="cell" role="listitem" aria-label="${esc(said)}">${inner}</span>`;
  return `<button class="cell${done ? " done" : ""}" data-slot="${slot}" aria-pressed="${pressed}" ${done ? "disabled" : ""} aria-label="Place ${slot + 1}: ${esc(said)}">${inner}</button>`;
}
function eyeRow(ids, caption = "The model's view: every token the same width, one number each.") {
  return `<div class="eye-wrap"><p class="eye-label">${caption}</p><div class="eye" role="list">${ids.map((i) => cellHTML(i)).join("")}</div></div>`;
}
function tilesRow(tokens) {
  // level 1's view: a tile's width is its letters
  const words = [];
  let cur = [];
  for (const t of tokens) { cur.push(t); if (t.endsWith(END)) { words.push(cur); cur = []; } }
  if (cur.length) words.push(cur);
  return `<div class="tiles">${words.map((w) => `<span class="word">${w.map((t) => `<span class="t ${kind(t)}">${label(t)}</span>`).join("")}</span>`).join("")}</div>`;
}

// ---------- opening ----------
function opening() {
  phase = "intro";
  save("intro");
  introPage(`<h2>Numbers, not letters</h2>
    <figure class="course-map">
      <ol>
        <li class="done">Text</li><li class="done">Tokens</li><li class="here" aria-current="step">Numbers<span>you are here</span></li><li>Network</li><li>Next token</li>
      </ol>
      <figcaption>You cut the village into tokens in level 1. Now each token becomes a number, because that's all a model can work with.</figcaption>
    </figure>
    <p>Everything inside a language model is arithmetic on numbers. It has no way to work with the letter ${code("t")} or the piece ${code("the_")}. So before your model can read anything, every piece in your vocabulary gets a number.</p>
    <p>The number isn't an amount. It's an address: it says which piece you mean. What sits at that address comes in level 3.</p>`,
    [{ id: "begin", text: "Number the pieces", on: stepNumber }]);
}

// ---------- step 1: number the vocabulary ----------
function stepNumber() {
  introEl.hidden = true;
  phase = "number";
  save("number");
  renderList();
  setCounter(B, "IDs");
  idsEl.scrollTop = 0;
  highlight([25, 26, 27, 28, 29], false);
  const nBase = tok.alphabet.length;
  say(`<p>This is your vocabulary from level 1, numbered. A token's number is its <strong>token ID</strong>: its place in the list, counting from 0.</p>
    <p>The ${nBase} starting symbols come first, in a fixed order: ${code(".")} is ${num(0)}, ${code("?")} is ${num(1)}, the end-of-word marker ${code(END)} is ${num(2)}, then the letters. After them, each merge takes the next number, in the order you made it: ${code(list[25])} is ${num(25)}, ${code(list[26])} ${num(26)}, ${code(list[27])} ${num(27)}, ${code(list[28])} ${num(28)}, ${code(list[29])} ${num(29)}.</p>
    <p>New pieces only ever go on the end, so a token's number never changes once it's given.</p>`,
    [{ id: "next", text: "Next", on: stepBoundary }]);
}

// ---------- step 2: the line boundary ----------
function stepBoundary() {
  phase = "boundary";
  save("boundary");
  showBoundary(true);
  setCounter(list.length, "IDs");
  highlight([B]);
  say(`<p>One more ID, ${num(B)}, for a token that isn't text at all: ${code(BOUNDARY)}, the <strong>line boundary</strong>. It's a <strong>special token</strong>. It has no letters.</p>
    <p>It goes before every line and after every line. Before a line, it gives the model something to predict the first word from. After a line, it's what the model learns to predict when the line is finished. That's how a model knows when to stop writing.</p>
    <p>A full stop can't do that job. Many village lines hold two sentences: ${word("the bird is thirsty . it drinks .")}</p>
    <p class="small">Your vocabulary is now ${B} pieces of text plus 1 special token: ${list.length} IDs, from 0 to ${B}.</p>`,
    [{ id: "next", text: "Turn a line into numbers", on: () => stepEncode(0) }]);
}

// ---------- step 3: text into numbers ----------
const DEMO_LINES = () => [0, ...shortLines.slice(0, 3).map((s) => s.i)];
function stepEncode(n) {
  phase = "encode";
  const demo = DEMO_LINES();
  lineAt = demo[n % demo.length];
  save("encode", { n: n % demo.length });
  const line = lines[lineAt];
  const r = encodeIds(line, tok);
  setCounter(r.ids.length, "IDs");
  highlight([...new Set(r.ids)], false);
  say(`<p>Village line ${lineAt + 1}, from text to tokens to numbers:</p>
    <div class="stack">
      <p class="row-label">Text</p><p class="plain">${esc(line)}</p>
      <p class="row-label">Tokens, as in level 1: ${plural(r.tokens.length - 2, "token")}</p>${tilesRow(r.tokens.slice(1, -1))}
      <p class="row-label">IDs, with the boundary at each end: ${plural(r.ids.length, "ID")}</p>
      <div class="eye" role="list" id="eye"></div>
    </div>
    <p class="small">The tiles change shape here. In level 1 a tile was as wide as its letters. To the model every token is the same size, because each one is now a single number. This is <strong>the model's view</strong>, and it's all the model ever gets.</p>`,
    [{ id: "another", text: "Another line", quiet: true, on: () => stepEncode(n + 1) },
     { id: "next", text: "Do the numbers mean anything?", on: stepMeaning }]);
  playEye(r.ids);
}
async function playEye(ids) {
  const eye = $("eye");
  const token = (playEye.token = (playEye.token || 0) + 1);
  for (let k = 0; k < ids.length; k++) {
    if (token !== playEye.token || !document.body.contains(eye)) return;
    eye.insertAdjacentHTML("beforeend", cellHTML(ids[k]));
    await wait(60);
  }
}

// ---------- step 4: the numbers mean nothing ----------
function stepMeaning() {
  phase = "meaning";
  save("meaning");
  setCounter(list.length, "IDs");
  highlight([28, 29, 30]);
  say(`<p>Look at three neighbours in the list: ${code(list[28])} is ${num(28)}, ${code(list[29])} is ${num(29)}, ${code(list[30])} is ${num(30)}.</p>
    <p>Do 29 and 30 have anything in common, apart from sitting next to each other?</p>
    <div class="choice">
      <button id="yes" aria-pressed="false">Yes: close numbers, similar tokens</button>
      <button id="no" aria-pressed="false">No: they're just next to each other in the list</button>
    </div>`);
  $("yes").addEventListener("click", () => meaningAnswer(false));
  $("no").addEventListener("click", () => meaningAnswer(true));
}
async function meaningAnswer(right) {
  if (!gpt2) {
    say(`<p>Loading GPT-2's tokenizer…</p>`, [], { newStep: false });
    gpt2 = loadGpt2(await (await fetch("../engine/data/gpt2_r50k_base.tiktoken?v=13")).text());
  }
  const line = lines[lineAt];
  const theirs = gpt2Tokens(line, gpt2);
  const g = (t) => `<span class="t inline gpt">${esc(t.text).replace(/ /g, `<span class="sp">${SPACE}</span>`)}</span>`;
  const the = gpt2Tokens(" the The THE", gpt2);
  say(`<p class="verdict">${right ? "Right." : "Not quite."}</p>
    <p>${code(list[29])} and ${code(list[30])} sit together only because merges 5 and 6 came one after the other. The order of the list is history: it records when each piece was made. Merges take the most common pair first, so a later number was a less common pair at the time. But the number says nothing about what a token means, or which tokens are alike.</p>
    <p>Real models are the same. GPT-2 gives ${word("the")} three unrelated numbers, one for each way of writing it: ${the.map((t) => `${g(t)} ${num(t.id)}`).join(", ")}.</p>
    <p>And here is GPT-2 on line ${lineAt + 1}: ${plural(theirs.length, "ID")} where yours needs ${plural(encodeIds(line, tok).ids.length, "ID")}.</p>
    <div class="result"><div class="row">${theirs.map((t) => `<span class="gcell">${g(t)}<span class="cn">${t.id}</span></span>`).join("")}</div></div>
    <p>So whatever makes ${code("the_")} mean ${word("the")} has to come from somewhere else. That's level 3.</p>`,
    [{ id: "next", text: "Turn numbers back into text", on: stepDecode }]);
}

// ---------- step 5: numbers back into text ----------
async function stepDecode() {
  phase = "decode";
  save("decode");
  const r = encodeIds(lines[lineAt], tok);
  say(`<p>Going back is a lookup too. Each number points to one token in the list.</p>
    <div class="eye-wrap"><p class="eye-label">The IDs from line ${lineAt + 1}</p><div class="eye" role="list">${r.ids.map((i) => cellHTML(i, { hideTok: true })).join("")}</div></div>
    <div id="decoded"></div>`, [], { newStep: true });
  const cells = [...task.querySelectorAll(".eye .cell")];
  const token = (stepDecode.token = (stepDecode.token || 0) + 1);
  for (let k = 0; k < r.ids.length; k++) {
    if (token !== stepDecode.token || phase !== "decode") return;
    highlight([r.ids[k]]);
    cells[k].outerHTML = cellHTML(r.ids[k]);
    await wait(reduced ? 0 : 140);
  }
  if (token !== stepDecode.token || phase !== "decode" || !$("decoded")) return;
  highlight([], false);
  const pieces = r.ids.filter((i) => i !== B).map((i) => list[i]).join("");
  $("decoded").innerHTML = `<p class="row-label small">Drop the boundaries and join the pieces:</p>
    <p class="plain mono">${label(pieces).replace(/<span class="end">_<\/span>/g, "_")}</p>
    <p class="row-label small">Every ${code(END)} becomes a space:</p>
    <p class="plain mono"><strong>${esc(decodeIds(r.ids, tok))}</strong></p>
    <p>That's line ${lineAt + 1} again, exactly. The end-of-word marker is what makes it possible: without it, nothing would say where one word stops.</p>
    <label class="try-label" for="try">Try your own text. It goes in, comes out as numbers, and back again.</label>
    <input id="try" class="try" value="The cat hides." autocomplete="off" autocapitalize="off" spellcheck="false">
    <div id="round"></div>`;
  task.insertAdjacentHTML("beforeend", actionsHTML([{ id: "next", text: "How many fit at once?", on: stepWindow }]));
  bind([{ id: "next", on: stepWindow }]);
  $("try").addEventListener("input", roundTrip);
  roundTrip();
}
function roundTrip() {
  const typed = $("try").value;
  const out = $("round");
  const r = encodeIds(typed, tok);
  if (!splitWords(typed).length) { out.innerHTML = ""; return; }
  if (!r.ids) {
    out.innerHTML = `<p class="small">Your tokenizer has no piece for ${r.unknown.map((c) => `<span class="t inline unknown">${esc(c)}</span>`).join(" ")}, so that text has no IDs and can't be given to your model at all. GPT-2 never has this problem: every possible byte has an ID.</p>`;
    return;
  }
  const back = decodeIds(r.ids, tok);
  const same = back === typed;
  out.innerHTML = `<div class="eye" role="list">${r.ids.map((i) => cellHTML(i)).join("")}</div>
    <p class="small">Back again:</p><p class="plain"><strong>${esc(back)}</strong></p><p class="small">${same ? "Exactly what you typed." : "Not quite what you typed: your tokenizer lowercases everything and puts spaces around full stops and question marks before it starts, so text comes back in village form. GPT-2 gives back exactly what went in, byte for byte."}</p>`;
}

// ---------- step 6: the window ----------
function stepWindow() {
  phase = "window";
  save("window");
  highlight([], false);
  const r = encodeIds(lines[lineAt], tok);
  const used = r.ids.length - 1; // the model reads the boundary and the tokens, and predicts the closing boundary
  const longest = Math.max(...lines.map((l) => encodeIds(l, tok).ids.length - 2));
  const slots = Array.from({ length: CTX }, (_, k) => `<span class="${k === 0 ? "b" : k < used ? "in" : ""}"></span>`).join("");
  say(`<p>The model reads a fixed number of IDs at a time: <strong>${CTX}</strong>. That's its <strong>context</strong>, or window.</p>
    <div class="window" role="img" aria-label="${CTX} places; line ${lineAt + 1} fills ${used}">${slots}</div>
    <p class="small">Line ${lineAt + 1} fills ${used} of the ${CTX} places: the boundary ${code(BOUNDARY)}, then its ${r.ids.length - 2} tokens. The closing boundary isn't read. It's what the model has to predict at the end.</p>
    <p>The longest village line is ${plural(longest, "token")}, so it needs ${longest + 1} places. Every line fits. Real models have far bigger windows, but the idea is the same: a fixed number of IDs at a time, and nothing outside them.</p>`,
    [{ id: "next", text: "Final check", on: () => check1() }]);
}

// ---------- success check ----------
// 1. Decode a message: the player finds each ID in the list.
function check1(saved) {
  phase = "check1";
  save("check1");
  const ids = encodeIds(MESSAGE, tok).ids.slice(1, -1);
  fill = { kind: "decode", slots: ids.map((want) => ({ want, got: false })), pick: 0 };
  if (saved) saved.forEach((g, k) => { if (fill.slots[k]) fill.slots[k].got = g; });
  fill.pick = fill.slots.findIndex((s) => !s.got);
  setLookup(true);
  highlight([], false);
  renderFill();
}
// 2. Encode a short village line: the player finds each token's ID.
function check2(choice = null) {
  phase = "check2";
  save("check2", { choice });
  setLookup(false);
  if (choice === null) {
    say(`<p>Now the other way. Pick a short village line and find the ID of each of its tokens.</p>
      <div class="choice">${shortLines.slice(0, 3).map((s, k) => `<button id="pick${k}" class="mono">${esc(lines[s.i])}</button>`).join("")}</div>`);
    shortLines.slice(0, 3).forEach((s, k) => $(`pick${k}`).addEventListener("click", () => check2(k)));
    return;
  }
  lineAt = shortLines[choice].i;
  const r = encodeIds(lines[lineAt], tok);
  fill = { kind: "encode", slots: r.ids.slice(1, -1).map((want) => ({ want, got: false })), pick: 0, ids: r.ids };
  setLookup(true);
  renderFill();
}
function renderFill() {
  const done = fill.slots.every((s) => s.got);
  const cells = fill.slots.map((s, k) => fill.kind === "decode"
    ? cellHTML(s.want, { hideTok: !s.got, slot: k, pressed: k === fill.pick && !done, done: s.got })
    : cellHTML(s.want, { hideNum: !s.got, slot: k, pressed: k === fill.pick && !done, done: s.got }));
  const ends = fill.kind === "encode" ? [cellHTML(B), cellHTML(B)] : ["", ""];
  const head = fill.kind === "decode"
    ? `<p><strong>Final check.</strong> A message from the village, as your model would get it. Find each number in the list and tap it to see its token.</p>`
    : `<p>${word(lines[lineAt])} as tokens. Find each token in the list and tap it to fill in its ID. The boundaries are already there.</p>`;
  const found = fill.slots.filter((s) => s.got).length;
  say(`${head}
    <div class="eye" role="list" id="fill">${ends[0]}${cells.join("")}${ends[1]}</div>
    <p class="small" id="fill-note">${done ? "" : `Found ${found} of ${fill.slots.length}. ${fill.kind === "decode" ? `Looking for ID ${num(fill.slots[fill.pick].want)}.` : `Looking for ${code(list[fill.slots[fill.pick].want])}.`}`}</p>
    <div id="fill-result"></div>`, [], { newStep: false });
  task.querySelectorAll("button.cell").forEach((b) => b.addEventListener("click", () => { fill.pick = +b.dataset.slot; renderFill(); }));
  if (done) fillDone();
}
function onEntry(e) {
  const btn = e.target.closest(".entry");
  if (!btn || btn.disabled || !fill) return;
  const id = +btn.dataset.id;
  const slot = fill.slots[fill.pick];
  if (!slot || slot.got) return;
  if (id === slot.want) {
    slot.got = true;
    status.textContent = `Right: ID ${id} is ${speak(list[id])}.`;
    const next = fill.slots.findIndex((s) => !s.got);
    fill.pick = next < 0 ? fill.pick : next;
    if (fill.kind === "decode") save("check1", { got: fill.slots.map((s) => s.got) });
    renderFill();
  } else {
    btn.classList.remove("miss"); void btn.offsetWidth; btn.classList.add("miss");
    const msg = fill.kind === "decode"
      ? `That's ID ${id}. This place needs ID ${slot.want}.`
      : `That's ${speak(list[id])}, ID ${id}. This place needs ${speak(list[slot.want])}.`;
    status.textContent = msg;
    const note = $("fill-note");
    if (note) note.textContent = msg;
  }
}
function fillDone() {
  setLookup(false);
  const out = $("fill-result");
  if (fill.kind === "decode") {
    const ids = fill.slots.map((s) => s.want);
    out.innerHTML = `<p>Join the pieces and turn each ${code(END)} into a space:</p><p class="plain"><strong>${esc(decodeIds(ids, tok))}</strong></p>
      <p class="small">That sentence isn't in the village, but every piece of it is, so your model could be given it.</p>`;
    out.insertAdjacentHTML("beforeend", actionsHTML([{ id: "next", text: "Next", on: () => check2() }]));
    bind([{ id: "next", on: () => check2() }]);
  } else {
    const back = decodeIds(fill.ids, tok);
    out.innerHTML = `<p>Decoded again:</p><p class="plain"><strong>${esc(back)}</strong></p><p>${back === lines[lineAt] ? "The same line, exactly." : ""}</p>`;
    out.insertAdjacentHTML("beforeend", actionsHTML([{ id: "next", text: "One last question", on: check3 }]));
    bind([{ id: "next", on: check3 }]);
  }
  $("next")?.focus({ preventScroll: true });
}
// 3. The trap.
function check3() {
  phase = "check3";
  save("check3");
  fill = null;
  highlight([29, 30]);
  say(`<p>${code(list[29])} is ${num(29)} and ${code(list[30])} is ${num(30)}. Can the model tell, from the numbers alone, that these two tokens are related?</p>
    <div class="choice">
      <button id="yes" aria-pressed="false">Yes, they're next to each other</button>
      <button id="no" aria-pressed="false">No, the numbers only say where they sit in the list</button>
    </div>`);
  $("yes").addEventListener("click", () => trapAnswer(false));
  $("no").addEventListener("click", () => trapAnswer(true));
}
function trapAnswer(right) {
  say(`<p class="verdict">${right ? "Right." : "No."}</p>
    <p>An ID is an address, nothing more. 29 and 30 are neighbours because merge 5 came just before merge 6. Nothing in the numbers says ${code(list[29])} and ${code(list[30])} are alike, or that they aren't. If a model is going to learn what tokens mean, that has to be stored somewhere other than the ID.</p>`,
    [{ id: "finish", text: "Finish level 2", on: levelDone }]);
}

function levelDone() {
  phase = "done";
  save("done");
  highlight([], false);
  say(`<p><strong>Level 2 complete.</strong> You can now explain:</p>
    <ul class="learned">
      <li>A model never sees text. It gets a row of <strong>token IDs</strong>: one whole number per token.</li>
      <li>An ID is a token's place in the vocabulary. The order records when each piece was made, not what it means.</li>
      <li>A <strong>special token</strong> like the line boundary marks where text starts and stops. GPT-2 has one, ID 50,256; Llama 3 has 256.</li>
      <li>Encoding turns text into IDs and decoding turns them back. A model reads a fixed number of IDs at a time: its <strong>context</strong>.</li>
    </ul>
    <p class="small">Next comes level 3: each ID points to a list of numbers that the model can learn, and that's where meaning starts. That level isn't built yet.</p>`,
    [{ id: "back", text: "Back to level 1", quiet: true, on: () => { location.href = "../level1/"; } },
     { id: "again", text: "Start over", quiet: true, on: restart }]);
}

// ---------- saving and resuming ----------
const SAVE_KEY = "llm-explained:level2", SAVE_VERSION = 1;
function save(cp, extra = {}) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, lines: lines.length, cp, lineAt, ...extra })); } catch { /* no storage: still playable */ }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.v === SAVE_VERSION && s.lines === lines.length ? s : null;
  } catch { return null; }
}
const PLACE = {
  intro: "the start of level 2", number: "numbering the vocabulary", boundary: "the line boundary", encode: "turning a line into numbers",
  meaning: "what the numbers mean", decode: "turning numbers back into text", window: "the window", check1: "the final check",
  check2: "the final check", check3: "the final check", done: "the end of level 2",
};
function offerResume(s) {
  introPage(`<h2>Welcome back</h2><p>You were at ${PLACE[s.cp] || "level 2"}. Your progress is saved on this device.</p>`,
    [{ id: "resume", text: "Carry on", on: () => resume(s) }, { id: "fresh", text: "Start over", quiet: true, on: restart }]);
}
function resume(s) {
  introEl.hidden = true;
  lineAt = s.lineAt || 0;
  phase = s.cp;
  renderList();
  setCounter(list.length, "IDs");
  const go = {
    intro: opening, number: stepNumber, boundary: stepBoundary, encode: () => stepEncode(s.n || 0), meaning: stepMeaning,
    decode: stepDecode, window: stepWindow, check1: () => check1(s.got), check2: () => check2(s.choice ?? null), check3, done: levelDone,
  }[s.cp];
  (go || opening)();
}
function restart() {
  clearSave();
  fill = null;
  lineAt = 0;
  idsEl.innerHTML = "";
  task.innerHTML = "";
  setCounter(B, "pieces");
  opening();
}

// ---------- offline ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../sw.js", { scope: "../" }).catch(() => {});

// ---------- start ----------
idsEl.addEventListener("click", onEntry);
text = await (await fetch("../../corpus/corpus_train.txt?v=13")).text();
lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
tok = train(text, MERGES);
list = idList(tok);
idOf = new Map(list.map((t, i) => [t, i]));
B = list.length - 1;
// Short lines for the success check: 8 to 10 tokens, in village order.
shortLines = lines.map((l, i) => ({ i, n: encodeIds(l, tok).ids.length - 2 })).filter((s) => s.n <= 10);
setCounter(B, "pieces");
{
  const s = loadSave();
  if (s && s.cp !== "intro") offerResume(s);
  else restart();
}
