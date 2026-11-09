// Offline support for LLM Explained. Every file the game needs is cached on first visit, so the game
// keeps working with no connection. Files are versioned (?v=N); a new version gets a new cache and the
// old one is deleted.
const V = 11;
const CACHE = `llm-explained-v${V}`;
const FILES = [
  "level1/",
  "level1/index.html",
  `level1/level1.css?v=${V}`,
  `level1/level1.js?v=${V}`,
  `engine/bpe.js?v=${V}`,
  `engine/gpt2.js?v=${V}`,
  `engine/data/gpt2_r50k_base.tiktoken?v=${V}`,
  `../corpus/corpus_train.txt?v=${V}`,
  `fonts/fonts.css?v=${V}`,
  "fonts/atkinson-hyperlegible-next-latin-400-normal.woff2",
  "fonts/atkinson-hyperlegible-next-latin-700-normal.woff2",
  "fonts/atkinson-hyperlegible-mono-latin-400-normal.woff2",
  "fonts/atkinson-hyperlegible-mono-latin-700-normal.woff2",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("llm-explained-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Pages: try the network first so updates arrive, fall back to the cache offline.
// Everything else is versioned, so the cache is always right for it.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match("level1/"))));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
