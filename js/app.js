(() => {
const $ = id => document.getElementById(id);
const SAMPLE_TITLE = "Why recall beats rereading";
const SAMPLE = `Most people study by rereading. It feels productive because the words become familiar, and familiarity is easy to mistake for knowledge. Memory researchers call this the fluency illusion. The page looks known, so we assume it is known, but when the page is gone, much of it goes with it.

A stronger method is retrieval practice. Instead of looking at the material again, you close the book and try to pull it out of your own head. The effort is the point. Each time you successfully retrieve an idea, the path to it becomes easier to find next time. Even a failed attempt helps, because it shows you exactly what you missed before you check the answer.

Timing matters as much as effort. If you review an idea minutes after learning it, retrieval is easy and the gain is small. If you wait until you are close to forgetting, retrieval is harder and the memory grows stronger. This is the spacing effect. Spaced repetition systems use it by scheduling each card just before you are likely to forget it, so the gaps between reviews grow from one day to three, then a week, then a month.

Speed reading fits into this picture only when comprehension keeps up. Reading faster lets you cover more material in a focused session, but the words still need to land somewhere. A good habit is to read in short focused blocks, stop, write down what you remember, and turn the key ideas into questions. Then let the schedule bring those questions back. Short breaks between blocks give your attention time to recover, which is why the Pomodoro technique pairs well with reading: twenty-five minutes of focus, five minutes of rest, and a longer break after four rounds.`;

/* ---------- storage: everything lives in this browser's localStorage ---------- */
const LS = "kwick-study-v1";
const state = { settings: {}, cards: {}, sessions: {}, days: {}, takes: {} };
const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, autoBreak: true, lock: true, recallPrompt: true, sound: true, wpm: 150, chunk: 1, punct: true, mode: "slide", size: "medium" };

function ingest(key, val) {
  if (key === "settings") state.settings = val;
  else if (key.startsWith("card_")) state.cards[key.slice(5)] = val;
  else if (key.startsWith("sess_")) state.sessions[key.slice(5)] = val;
  else if (key.startsWith("day_")) state.days[key.slice(4)] = val;
  else if (key.startsWith("take_")) state.takes[key.slice(5)] = val;
}
function allDocs() {
  const out = { settings: state.settings };
  for (const [k, v] of Object.entries(state.cards)) out["card_" + k] = v;
  for (const [k, v] of Object.entries(state.sessions)) out["sess_" + k] = v;
  for (const [k, v] of Object.entries(state.days)) out["day_" + k] = v;
  for (const [k, v] of Object.entries(state.takes)) out["take_" + k] = v;
  return out;
}
function mirror() { try { localStorage.setItem(LS, JSON.stringify(allDocs())); } catch {} }
function save(key, val) {
  ingest(key, val); mirror();
}
function remove(key) {
  if (key.startsWith("card_")) delete state.cards[key.slice(5)];
  if (key.startsWith("take_")) delete state.takes[key.slice(5)];
  mirror();
}
const timers = {};
function saveLater(key, getVal, ms = 700) { clearTimeout(timers[key]); timers[key] = setTimeout(() => save(key, getVal()), ms); }

try { const raw = JSON.parse(localStorage.getItem(LS) || "null"); if (raw) for (const [k, v] of Object.entries(raw)) ingest(k, v); } catch {}
const S = () => ({ ...DEFAULTS, ...state.settings });

/* ---------- helpers ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let toastT;
function toast(t) { const x = $("toast"); x.textContent = t; x.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => x.hidden = true, 2600); }

let audio;
function chime(rest) {
  if (!S().sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const notes = rest ? [660, 880] : [880, 660, 523];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
      const t = audio.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t); o.stop(t + 0.55);
    });
  } catch {}
}

/* ---------- Pomodoro ---------- */
const P = { phase: "focus", running: false, endAt: 0, remain: 0, round: 0, int: null };
const roman = n => ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][n] || String(n);
const dur = ph => S()[ph === "focus" ? "focus" : ph] * 60000;
P.remain = dur("focus");

function pomoRender() {
  const rest = P.phase !== "focus";
  $("phase").textContent = P.phase === "focus" ? "Focus" : P.phase === "short" ? "Short break" : "Long break";
  $("phase").classList.toggle("rest", rest);
  $("clock").textContent = mmss(P.remain);
  const t = $("pomoToggle");
  t.textContent = P.running ? "Pause" : (P.remain < dur(P.phase) ? "Resume" : "Start");
  t.className = "btn sm " + (rest ? "rest" : "primary");
  $("dots").textContent = "round " + roman(Math.min(P.round + (P.phase === "focus" ? 1 : 0), S().every) || 1) + " of " + roman(S().every);
  readerLockRender();
}
function pomoStart() {
  if (P.running) return;
  P.running = true; P.endAt = Date.now() + P.remain;
  P.int = setInterval(pomoTick, 250); pomoRender();
}
function pomoPause() {
  if (!P.running) return;
  P.running = false; P.remain = Math.max(0, P.endAt - Date.now()); clearInterval(P.int); pomoRender();
}
function pomoTick() {
  P.remain = P.endAt - Date.now();
  if (P.remain <= 0) pomoComplete(true); else $("clock").textContent = mmss(P.remain);
}
function pomoComplete(natural) {
  clearInterval(P.int); P.running = false;
  const was = P.phase;
  if (was === "focus") {
    if (natural) {
      const d = today(), rec = state.days[d] || { pomodoros: 0, focusMin: 0 };
      save("day_" + d, { pomodoros: rec.pomodoros + 1, focusMin: rec.focusMin + S().focus });
    }
    P.round += 1;
    P.phase = P.round >= S().every ? "long" : "short";
    chime(true);
    onFocusEnd(natural);
  } else {
    if (P.phase === "long") P.round = 0;
    P.phase = "focus"; chime(false);
    toast("Break over. Ready for the next round.");
  }
  P.remain = dur(P.phase);
  if (P.phase !== "focus" && S().autoBreak) pomoStart(); else pomoRender();
  renderProgress();
}
$("pomoToggle").onclick = () => P.running ? pomoPause() : pomoStart();
$("pomoSkip").onclick = () => pomoComplete(false);

/* ---------- Reader ---------- */
const R = { title: SAMPLE_TITLE, text: SAMPLE, words: [], i: 0, playing: false, t: null, activeMs: 0, since: 0, maxI: 0, session: null, sample: true };
function parse(text) { return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean); }
function loadText(title, text, sample) {
  stop();
  R.title = title || "Untitled text"; R.text = text; R.words = parse(text); R.i = 0; R.maxI = 0; R.activeMs = 0; R.session = null; R.sample = !!sample;
  $("docTitle").textContent = R.title;
  $("docInfo").textContent = (sample ? "Sample passage · " : "") + R.words.length.toLocaleString() + " words";
  $("recallText").value = ""; $("recallResult").hidden = true;
  SL.spans = []; renderIdle(); buildContext(); readerMeta(); renderRecall();
}

/* Slide mode: the line of text glides past the centre marker at the chosen speed. */
const SL = { pos: 0, start: 0, spans: [], centers: [], cur: -1, raf: 0, last: 0 };
function renderIdle() {
  const slide = S().mode === "slide";
  $("slide").hidden = !slide; $("chunk").hidden = true; $("rsvp").hidden = slide;
  if (slide) { SL.pos = Math.min(R.i, Math.max(0, R.words.length - 1)); SL.spans = []; slidePlace(); }
  else showWord(R.words[Math.min(R.i, R.words.length - 1)] || "", true);
}
function slideBuild(k) {
  const n = R.words.length, from = Math.max(0, k - 20), to = Math.min(n, k + 100), track = $("track");
  SL.spans = []; SL.start = from; SL.cur = -1;
  const frag = document.createDocumentFragment();
  for (let i = from; i < to; i++) { const s = el("span", "", R.words[i]); SL.spans.push(s); frag.append(s); }
  track.replaceChildren(frag);
  SL.centers = SL.spans.map(s => s.offsetLeft + s.offsetWidth * 0.4);
}
function slidePlace() {
  const n = R.words.length; if (!n) { $("track").replaceChildren(); return; }
  const k = Math.min(n - 1, Math.floor(SL.pos)), end = SL.start + SL.spans.length;
  if (!SL.spans.length || k < SL.start || k >= end || (k > end - 25 && end < n) || (k < SL.start + 5 && SL.start > 0) || !SL.centers[SL.centers.length - 1]) slideBuild(k);
  const a = SL.centers[k - SL.start], b = SL.centers[k + 1 - SL.start];
  const x = b == null ? a : a + (b - a) * Math.min(1, SL.pos - k);
  $("track").style.transform = `translate(${$("window").clientWidth / 2 - x}px, -50%)`;
  if (SL.cur !== k) { SL.spans.forEach((s, j) => s.className = j + SL.start < k ? "read" : j + SL.start === k ? "cur" : ""); SL.cur = k; }
}
function slideFrame(t) {
  if (!R.playing) return;
  const dt = Math.min(100, t - SL.last); SL.last = t;
  const w = R.words[Math.floor(SL.pos)] || "";
  let f = w.length > 8 ? 1.25 : 1;
  if (S().punct) { if (/[.!?]["'”’)]*$/.test(w)) f *= 2.1; else if (/[,;:—–]["'”’)]*$/.test(w)) f *= 1.5; }
  SL.pos += dt * S().wpm / 60000 / f;
  if (SL.pos >= R.words.length) { R.i = R.maxI = R.words.length; readerMeta(); return finish(); }
  const ni = Math.floor(SL.pos);
  if (ni !== R.i) { R.i = ni; R.maxI = Math.max(R.maxI, ni); readerMeta(); }
  slidePlace();
  SL.raf = requestAnimationFrame(slideFrame);
}
function orp(n) { return n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4; }
function showWord(w, idle) {
  const chunkMode = S().chunk > 1 && !idle;
  $("rsvp").hidden = chunkMode; $("chunk").hidden = !chunkMode;
  if (chunkMode) { $("chunk").textContent = w; return; }
  const m = w.match(/^[^\p{L}\p{N}]*/u)[0].length;
  const core = w.slice(m).replace(/[^\p{L}\p{N}]+$/u, "");
  const p = m + orp(core.length || 1);
  $("wl").textContent = w.slice(0, p); $("wp").textContent = w.charAt(p) || ""; $("wr").textContent = w.slice(p + 1);
}
function delayFor(chunk) {
  const s = S(); let ms = 60000 / s.wpm * chunk.length;
  const last = chunk[chunk.length - 1] || "";
  const longest = Math.max(...chunk.map(w => w.length));
  if (longest > 8) ms *= 1.25;
  if (s.punct) { if (/[.!?]["'”’)]*$/.test(last)) ms *= 2.1; else if (/[,;:—–]["'”’)]*$/.test(last)) ms *= 1.5; }
  return ms;
}
function step() {
  if (!R.playing) return;
  if (R.i >= R.words.length) return finish();
  const n = S().chunk, chunk = R.words.slice(R.i, R.i + n);
  showWord(chunk.join(" ")); R.i += chunk.length; R.maxI = Math.max(R.maxI, R.i);
  readerMeta();
  R.t = setTimeout(step, delayFor(chunk));
}
let wake = null;
function play() {
  if (R.playing || !R.words.length) return;
  if (isLocked()) { toast("It's break time. Rest your eyes."); return; }
  if (R.i >= R.words.length) { R.i = 0; }
  if (P.phase === "focus" && !P.running) pomoStart();
  R.playing = true; R.since = performance.now();
  $("contextPanel").hidden = true; setPlayIcon();
  try { navigator.wakeLock && navigator.wakeLock.request("screen").then(w => wake = w).catch(() => {}); } catch {}
  if (S().mode === "slide") {
    $("slide").hidden = false; $("rsvp").hidden = true; $("chunk").hidden = true;
    SL.pos = Math.min(R.i, R.words.length - 1); SL.last = performance.now(); slidePlace();
    SL.raf = requestAnimationFrame(slideFrame);
  } else step();
}
function stop() {
  if (!R.playing) return;
  R.playing = false; clearTimeout(R.t); cancelAnimationFrame(SL.raf); R.activeMs += performance.now() - R.since;
  setPlayIcon(); buildContext(); $("contextPanel").hidden = false;
  try { wake && wake.release(); wake = null; } catch {}
}
function setPlayIcon() {
  $("playIcon").innerHTML = R.playing ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>' : '<path d="M7 4v16l13-8z"/>';
  $("play").setAttribute("aria-label", R.playing ? "Pause" : "Play");
}
function finish() {
  stop(); recordSession();
  showOverlay("Finished. Now test yourself.", "Writing down what you remember is the step that makes it stick.", "Go to recall", () => { hideOverlay(); switchTab("recall"); });
}
function recordSession() {
  const words = R.maxI; if (words < 20) return;
  const mins = Math.max(R.activeMs, 1) / 60000;
  const wpm = Math.round(words / mins);
  if (!R.session) R.session = uid();
  const prev = state.sessions[R.session] || {};
  save("sess_" + R.session, { at: prev.at || Date.now(), title: R.title, words, wpm: Math.min(wpm, 2000), recall: prev.recall ?? null });
  renderProgress();
}
function sentenceStarts() { const s = [0]; R.words.forEach((w, i) => { if (/[.!?]["'”’)]*$/.test(w) && i + 1 < R.words.length) s.push(i + 1); }); return s; }
function jumpSentence(dir) {
  const s = sentenceStarts(), cur = Math.max(0, R.i - 1);
  let k = s.findIndex(x => x > cur); if (k === -1) k = s.length;
  let target = dir < 0 ? s[Math.max(0, k - 2)] : s[Math.min(s.length - 1, k)];
  if (dir > 0 && k >= s.length) target = R.words.length - 1;
  R.i = target;
  if (S().mode === "slide") { SL.pos = Math.min(R.i, R.words.length - 1); slidePlace(); } else showWord(R.words[R.i] || "", !R.playing);
  readerMeta(); if (!R.playing) buildContext();
}
function readerMeta() {
  const n = R.words.length, pct = n ? R.i / n * 100 : 0;
  $("bar").style.width = pct + "%";
  $("pos").textContent = R.i.toLocaleString() + " / " + n.toLocaleString() + " words";
  $("left").textContent = mmss((n - R.i) / S().wpm * 60000 * 1.15) + " left at " + S().wpm + " wpm";
}
function buildContext() {
  const box = $("context"); box.replaceChildren();
  const frag = document.createDocumentFragment();
  const c = Math.max(0, R.i - 1), from = Math.max(0, c - 300), to = Math.min(R.words.length, c + 700);
  if (from > 0) frag.append("… ");
  for (let i = from; i < to; i++) {
    const s = el("span", i < R.i - 1 ? "read" : i === c && R.i > 0 ? "cur" : "", R.words[i]);
    s.dataset.i = i; frag.append(s, " ");
  }
  if (to < R.words.length) frag.append("…");
  box.append(frag);
  const cur = box.querySelector(".cur"); if (cur) cur.scrollIntoView({ block: "nearest" });
}
$("context").onclick = e => { const i = e.target.dataset && e.target.dataset.i; if (i == null) return; R.i = +i; renderIdle(); readerMeta(); buildContext(); };
function showOverlay(title, text, btnText, fn) {
  const o = $("overlay"); o.replaceChildren(el("strong", "", title), el("span", "hint", text));
  if (btnText) { const b = el("button", "btn primary", btnText); b.onclick = fn; const w = el("div"); w.append(b); o.append(w); }
  o.hidden = false;
}
function hideOverlay() { $("overlay").hidden = true; }
function isLocked() { return S().lock && P.phase !== "focus" && P.running; }
let lockShown = false;
function readerLockRender() {
  if (isLocked()) {
    lockShown = true;
    showOverlay(P.phase === "long" ? "Long break" : "Short break", "Look at something far away, stretch, get water. The reader unlocks when the break ends.", "Skip break", () => pomoComplete(false));
  } else if (lockShown) { lockShown = false; hideOverlay(); }
}
function onFocusEnd(natural) {
  const wasReading = R.playing || R.maxI > 0;
  stop();
  if (wasReading) recordSession();
  if (natural && S().recallPrompt && R.maxI >= 20) { switchTab("recall"); toast("Focus round done. Do a quick recall, then rest."); }
  else toast("Focus round done. Take a break.");
}

$("play").onclick = () => R.playing ? stop() : play();
$("back").onclick = () => jumpSentence(-1);
$("fwd").onclick = () => jumpSentence(1);
$("wpm").oninput = e => { state.settings = { ...state.settings, wpm: +e.target.value }; $("wpmOut").textContent = e.target.value + " wpm"; readerMeta(); saveLater("settings", () => state.settings); };
$("chunkSize").onchange = e => { save("settings", { ...state.settings, chunk: +e.target.value }); };
$("punct").onchange = e => { save("settings", { ...state.settings, punct: e.target.checked }); };
$("mode").onchange = e => { stop(); save("settings", { ...state.settings, mode: e.target.value }); $("chunkSize").disabled = e.target.value === "slide"; renderIdle(); };
window.addEventListener("resize", () => { if (S().mode === "slide") { SL.spans = []; slidePlace(); } });
if (document.fonts) document.fonts.ready.then(() => { if (S().mode === "slide") { SL.spans = []; slidePlace(); } });
$("loadText").onclick = () => {
  const t = $("inText").value.trim();
  if (parse(t).length < 10) { toast("Paste at least a few sentences to read."); return; }
  loadText($("inTitle").value.trim(), t, false); $("loadBox").open = false; toast("Loaded. Press Space to start.");
  window.scrollTo({ top: 0, behavior: "smooth" });
};
/* Uploads: PDF (text extracted with pdf.js, loaded on first use) and plain text files. */
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.append(s); });
let pdfLib = null;
function getPdfjs() {
  return pdfLib = pdfLib || (async () => {
    await loadScript(PDFJS + "pdf.min.js");
    await loadScript(PDFJS + "pdf.worker.min.js"); // parse on the page itself: works offline from cache and avoids cross-origin worker limits
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
    return window.pdfjsLib;
  })().catch(e => { pdfLib = null; throw e; });
}
function cleanPdfText(s) { return s.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim(); }
async function readPdf(file) {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    $("fileStatus").textContent = "Reading page " + p + " of " + doc.numPages + "…";
    const tc = await (await doc.getPage(p)).getTextContent();
    let s = "", prev = null;
    for (const it of tc.items) {
      if (typeof it.str !== "string") continue;
      if (prev && !prev.hasEOL && s && !/\s$/.test(s) && !/^\s/.test(it.str)) {
        const sameLine = Math.abs(it.transform[5] - prev.transform[5]) < 2;
        const gap = it.transform[4] - (prev.transform[4] + prev.width);
        if (!sameLine || gap > Math.abs(it.transform[0] || 10) * 0.15) s += " ";
      }
      s += it.str; if (it.hasEOL) s += "\n"; prev = it;
    }
    pages.push(cleanPdfText(s));
  }
  return pages;
}
const PDF = { name: "", pages: [] };
function loadPdfPages(from, to) {
  const text = PDF.pages.slice(from - 1, to).join(" ");
  const title = PDF.name + (PDF.pages.length > 1 ? (from === to ? " · p. " + from : " · pp. " + from + "–" + to) : "");
  loadText(title, text, false);
}
async function handleFile(f) {
  if (!f) return;
  const name = f.name.replace(/\.[^.]+$/, ""), isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
  const isText = /\.(txt|md|markdown|text)$/i.test(f.name) || f.type.startsWith("text/");
  if (!isPdf && !isText) { $("fileStatus").textContent = "That file type isn't supported. Use a PDF, .txt or .md file."; return; }
  stop(); $("pageRange").hidden = true;
  try {
    if (isPdf) {
      $("fileStatus").textContent = "Opening PDF…";
      const pages = await readPdf(f);
      const words = parse(pages.join(" ")).length;
      if (words < 10) { $("fileStatus").textContent = "No selectable text found. This PDF is probably a scan or images."; return; }
      PDF.name = name; PDF.pages = pages;
      loadPdfPages(1, pages.length);
      if (pages.length > 1) {
        $("pFrom").value = 1; $("pTo").value = pages.length; $("pFrom").max = $("pTo").max = pages.length;
        $("pOf").textContent = "of " + pages.length; $("pageRange").hidden = false;
      }
      $("fileStatus").textContent = "Loaded " + f.name + ": " + pages.length + " page" + (pages.length > 1 ? "s" : "") + ", " + words.toLocaleString() + " words." + (pages.length > 1 ? " Choose a page range below to read one section per round." : "");
    } else {
      const text = await f.text();
      if (parse(text).length < 10) { $("fileStatus").textContent = "That file has too little text to read."; return; }
      loadText(name, text, false);
      $("fileStatus").textContent = "Loaded " + f.name + ": " + R.words.length.toLocaleString() + " words.";
    }
    toast("Loaded. Press Space to start."); window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    $("fileStatus").textContent = "Couldn't read that file. If it's a PDF, check it isn't password-protected, then try again.";
  }
}
$("file").onchange = e => { handleFile(e.target.files[0]); e.target.value = ""; };
$("loadPages").onclick = () => {
  const n = PDF.pages.length, a = Math.max(1, Math.min(n, Math.round(+$("pFrom").value || 1))), b = Math.max(a, Math.min(n, Math.round(+$("pTo").value || n)));
  $("pFrom").value = a; $("pTo").value = b; loadPdfPages(a, b); toast("Loaded pages " + a + "–" + b + ".");
  window.scrollTo({ top: 0, behavior: "smooth" });
};
const drop = $("drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));
document.addEventListener("keydown", e => {
  if (e.target.closest("input, textarea, select, dialog") || $("tab-read").hidden) return;
  if (e.code === "Space") { e.preventDefault(); R.playing ? stop() : play(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); jumpSentence(-1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); jumpSentence(1); }
  else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault(); const v = Math.min(1000, Math.max(100, S().wpm + (e.key === "ArrowUp" ? 25 : -25)));
    $("wpm").value = v; $("wpm").dispatchEvent(new Event("input"));
  }
});

/* ---------- Recall ---------- */
const STOP = new Set("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each even every few for from further get gets had has have having he her here hers him his how however i if in into is it its itself just let like make makes many may me might more most much must my no nor not now of off on once one only or other our out over own same she should so some such than that the their them then there these they this those through to too two under until up upon us use used uses using very was we were what when where which while who whom why will with within without would you your yours".split(" "));
function keywords(text, n = 12) {
  const freq = {};
  for (const raw of text.toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) || []) {
    const w = raw.replace(/'s$/, "");
    if (w.length < 4 || STOP.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, n).map(e => e[0]);
}
const stem = w => w.toLowerCase().slice(0, Math.max(4, Math.min(w.length - 1, 6)));
function readText() { return R.words.slice(0, Math.max(R.maxI, R.i)).join(" ") || R.text; }
function renderRecall() {
  $("recallFor").textContent = "Recall · " + R.title;
  $("recallNote").textContent = R.maxI < 20 ? "Read at least part of the passage first, or recall from memory anyway." : "";
  renderSuggestions();
}
$("checkRecall").onclick = () => {
  const mine = $("recallText").value.trim();
  if (mine.split(/\s+/).length < 3) { toast("Write a few words first. Even fragments count."); return; }
  const src = readText(), keys = keywords(src);
  const mineStems = new Set((mine.toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) || []).map(stem));
  const hits = keys.filter(k => mineStems.has(stem(k)));
  const pct = keys.length ? Math.round(hits.length / keys.length * 100) : 0;
  $("recallPct").textContent = pct + "%";
  $("recallVerdict").textContent = pct >= 70 ? "Strong recall. You can try a slightly higher speed next round."
    : pct >= 40 ? "Decent. Turn the missed ideas into cards so they come back for review."
    : "Most key ideas didn't stick yet. Slow down by 50 wpm and read in shorter blocks.";
  const chips = $("chips"); chips.replaceChildren();
  keys.forEach(k => chips.append(el("span", "chip" + (hits.includes(k) ? " hit" : ""), k)));
  $("original").textContent = src;
  $("recallResult").hidden = false;
  if (!R.session) recordSession();
  if (R.session) { const s = state.sessions[R.session]; if (s) save("sess_" + R.session, { ...s, recall: pct }); }
  renderSuggestions(keys.filter(k => !hits.includes(k)));
  renderProgress();
};
function renderSuggestions(missed) {
  const box = $("sugg"); box.replaceChildren();
  const src = readText(), keys = keywords(src, 16), prefer = missed && missed.length ? missed : keys;
  const sentences = (src.match(/[^.!?]+[.!?]+/g) || []).map(s => s.trim()).filter(s => { const n = s.split(" ").length; return n >= 7 && n <= 40; });
  const existing = new Set(Object.values(state.cards).map(c => c.front));
  const used = new Set(), out = [];
  for (const k of prefer) {
    const re = new RegExp("\\b(" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "i");
    const s = sentences.find(x => re.test(x) && !used.has(x));
    if (!s) continue;
    used.add(s);
    const front = s.replace(re, "_____");
    if (!existing.has(front)) out.push({ front, back: s.match(re)[1], sentence: s });
    if (out.length >= 4) break;
  }
  if (!out.length) { box.append(el("p", "hint", "Write your own question and answer below.")); return; }
  out.forEach(c => {
    const item = el("div", "item"), p = el("p");
    const parts = c.front.split("_____");
    p.append(parts[0], el("b", "", "_____"), parts[1] || "");
    const b = el("button", "btn sm", "Add");
    b.onclick = () => { addCard(c.front, c.back); b.textContent = "Added"; b.disabled = true; };
    item.append(p, b); box.append(item);
  });
}
function addCard(front, back) {
  const id = uid();
  save("card_" + id, { front, back, src: R.title, ease: 2.5, interval: 0, reps: 0, due: Date.now(), created: Date.now() });
  renderReview(); renderProgress(); toast("Card added. It's due for review now.");
}
$("addCard").onclick = () => {
  const f = $("cFront").value.trim(), b = $("cBack").value.trim();
  if (!f || !b) { toast("Add both a question and an answer."); return; }
  addCard(f, b); $("cFront").value = ""; $("cBack").value = "";
};

/* ---------- Apply: What / How / When / Why, with checkups on a growing schedule ---------- */
const STAGES = [1, 3, 7, 14, 30, 60, 120]; // days until each checkup
const Q4 = [["what", "What"], ["how", "How"], ["when", "When"], ["why", "Why"]];
const inDays = d => d <= 1 ? "1 day" : d < 30 ? d + " days" : Math.round(d / 30) + (d < 60 ? " month" : " months");
function whenLabel(t) {
  const d = t - Date.now();
  if (d <= 0) return "due now";
  if (d < 3600000) return "in " + Math.max(1, Math.round(d / 60000)) + " min";
  if (d < 20 * 3600000) return "in " + Math.round(d / 3600000) + " h";
  const n = Math.round(d / DAY); return n <= 1 ? "tomorrow" : "in " + n + " days";
}
const takeDone = t => t.stage >= STAGES.length;
function ladder(stage) {
  const l = el("span", "ladder"); l.title = Math.min(stage, STAGES.length) + " of " + STAGES.length + " checkups passed";
  STAGES.forEach((_, i) => l.append(el("i", i < stage ? "on" : "")));
  return l;
}
function notesList(t) {
  const dl = el("dl", "notes");
  Q4.forEach(([k, name]) => { if (t[k]) dl.append(el("dt", "", name), el("dd", "", t[k])); });
  return dl;
}
function renderApply() {
  $("applyFor").textContent = "Apply · " + R.title;
  const takes = Object.entries(state.takes).sort((a, b) => b[1].created - a[1].created);
  $("takeCount").textContent = takes.length ? takes.length + " saved" : "";
  const box = $("takeList"); box.replaceChildren();
  if (!takes.length) { box.append(el("p", "hint", "Nothing saved yet. After you read and recall, answer the four questions above.")); return; }
  takes.forEach(([id, t]) => {
    const d = el("details", "take"), s = el("summary");
    const right = el("span", "row"); right.style.gap = "10px";
    right.append(ladder(t.stage), el("span", "hint", takeDone(t) ? "Completed" : "Next checkup " + whenLabel(t.due)));
    s.append(el("span", "t", t.title), right);
    d.append(s, notesList(t));
    if (t.checks && t.checks.length) {
      const ul = el("ul", "log");
      t.checks.slice().reverse().forEach(c => ul.append(el("li", "", new Date(c.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + ["Forgot", "Partly remembered", "Remembered"][c.recall] + (c.used ? " · used it" : "") + (c.note ? ": " + c.note : ""))));
      d.append(ul);
    }
    const del = el("button", "btn ghost sm", "Delete");
    del.onclick = () => { if (del.dataset.armed) { remove("take_" + id); renderApply(); renderReview(); renderProgress(); } else { del.dataset.armed = 1; del.textContent = "Confirm delete"; } };
    const w = el("div"); w.append(del); d.append(w);
    box.append(d);
  });
}
$("toApply").onclick = () => switchTab("apply");
$("saveTake").onclick = () => {
  const v = Object.fromEntries(Q4.map(([k]) => [k, $("a" + k[0].toUpperCase() + k.slice(1)).value.trim()]));
  if (!v.what || !v.how) { $("applyNote").textContent = "Answer at least What and How. The When and Why make it far more likely you'll act."; return; }
  save("take_" + uid(), { title: R.title, ...v, stage: 0, due: Date.now() + STAGES[0] * DAY, created: Date.now(), applied: 0, checks: [] });
  Q4.forEach(([k]) => $("a" + k[0].toUpperCase() + k.slice(1)).value = "");
  $("applyNote").textContent = "";
  renderApply(); renderReview(); renderProgress();
  toast("Saved. First checkup tomorrow.");
};

const CK = { id: null, step: 0, recall: null, used: null };
function dueTakes() { const now = Date.now(); return Object.entries(state.takes).filter(([, t]) => !takeDone(t) && t.due <= now).sort((a, b) => a[1].due - b[1].due); }
function renderCheckup() {
  const due = dueTakes(), panel = $("checkPanel"), body = $("checkBody");
  panel.hidden = !due.length; body.replaceChildren();
  if (!due.length) return;
  const [id, t] = due[0];
  if (CK.id !== id) Object.assign(CK, { id, step: 0, recall: null, used: null });
  $("checkHead").textContent = "Checkup " + (t.stage + 1) + " of " + STAGES.length + (due.length > 1 ? " · " + due.length + " due" : "");
  $("checkSub").textContent = "Saved " + new Date(t.created).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  body.append(el("h3", "", t.title));
  if (CK.step === 0) {
    body.append(el("p", "hint", "Before you look at your notes: what did you learn from this, and how were you going to use it? Say it out loud or jot it down."));
    const ta = el("textarea"); ta.id = "ckAttempt"; ta.rows = 3; ta.placeholder = "From memory…";
    const b = el("button", "btn primary", "Show my notes"); b.onclick = () => { CK.step = 1; renderCheckup(); };
    const r = el("div", "row"); r.append(b);
    body.append(ta, r);
    return;
  }
  body.append(notesList(t));
  const seg = (label, opts, key) => {
    const wrap = el("div", "stack"); wrap.style.gap = "6px"; wrap.append(el("div", "label", label));
    const s = el("div", "seg");
    opts.forEach(([val, text]) => { const b = el("button", "btn sm", text); b.setAttribute("aria-pressed", CK[key] === val); b.onclick = () => { CK[key] = val; renderCheckup(); }; s.append(b); });
    wrap.append(s); return wrap;
  };
  body.append(seg("How well did you remember it?", [[0, "Forgot"], [1, "Partly"], [2, "Clearly"]], "recall"));
  body.append(seg("Have you used it since the last checkup?", [[true, "Yes, I used it"], [false, "Not yet"]], "used"));
  const note = el("textarea"); note.id = "ckNote"; note.rows = 2;
  note.placeholder = CK.used ? "What happened when you used it?" : "What's the next real chance to use it?";
  body.append(note);
  const next = CK.recall == null ? null : CK.recall === 2 ? t.stage + 1 : CK.recall === 1 ? t.stage : 0;
  const b = el("button", "btn primary", "Save checkup"); b.disabled = CK.recall == null || CK.used == null;
  const info = el("span", "hint", next == null ? "" : next >= STAGES.length ? "This will complete the takeaway." : "Next checkup in " + inDays(STAGES[next]) + ".");
  b.onclick = () => {
    const checks = (t.checks || []).concat({ at: Date.now(), recall: CK.recall, used: CK.used, note: $("ckNote").value.trim() });
    save("take_" + id, { ...t, stage: next, due: Date.now() + STAGES[Math.min(next, STAGES.length - 1)] * DAY, applied: (t.applied || 0) + (CK.used ? 1 : 0), checks });
    CK.id = null; renderReview(); renderApply(); renderProgress();
    toast(next >= STAGES.length ? "Takeaway completed." : "Checkup saved.");
  };
  const r = el("div", "row"); r.append(b, info); body.append(r);
}

/* ---------- Review (simplified SM-2) ---------- */
const DAY = 86400000;
function schedule(c, g) {
  let { ease, interval, reps } = c;
  if (g === 0) { reps = 0; interval = 0; ease = Math.max(1.3, ease - 0.2); return { ...c, ease, interval, reps, due: Date.now() + 10 * 60000 }; }
  if (g === 1) { interval = Math.max(1, Math.round(interval * 1.2)); ease = Math.max(1.3, ease - 0.15); }
  else if (g === 2) { interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease); }
  else { interval = reps === 0 ? 3 : Math.round(Math.max(interval, 1) * ease * 1.3); ease += 0.15; }
  return { ...c, ease, interval, reps: reps + 1, due: Date.now() + interval * DAY };
}
const label = c => c.interval === 0 ? "10 min" : c.interval === 1 ? "1 day" : c.interval < 30 ? c.interval + " days" : Math.round(c.interval / 30) + " mo";
let revealed = false;
function dueCards() { const now = Date.now(); return Object.entries(state.cards).filter(([, c]) => c.due <= now).sort((a, b) => a[1].due - b[1].due); }
function renderReview() {
  const due = dueCards(), total = Object.keys(state.cards).length;
  updateBadge(); renderCheckup();
  $("reviewHead").textContent = due.length ? due.length + " card" + (due.length > 1 ? "s" : "") + " due" : "Review";
  $("reviewSub").textContent = total + " card" + (total === 1 ? "" : "s") + " in your deck";
  const card = $("card"), ga = $("gradeArea"); card.replaceChildren(); ga.replaceChildren();
  if (!due.length) {
    card.append(el("h3", "", total ? "All caught up." : "No cards yet."),
      el("p", "hint", total ? "Next card due " + nextDue() + ". Reviewing at the start of a focus round is a good warm-up." : "After you read, use Recall to turn key ideas into cards. They'll show up here when due."));
  } else {
    const [id, c] = due[0];
    card.append(el("div", "label", c.src || ""), el("div", "q", c.front));
    if (revealed) {
      card.append(el("div", "a", c.back));
      const g = el("div", "grades");
      ["Again", "Hard", "Good", "Easy"].forEach((name, i) => {
        const b = el("button", "btn" + (i === 2 ? " rest" : ""));
        b.append(el("span", "", name), el("small", "", label(schedule(c, i))));
        b.onclick = () => { revealed = false; save("card_" + id, schedule(c, i)); renderReview(); };
        g.append(b);
      });
      ga.append(g);
    } else {
      const b = el("button", "btn primary", "Show answer"); b.style.width = "100%";
      b.onclick = () => { revealed = true; renderReview(); };
      ga.append(b);
    }
  }
  const list = $("allCards"); list.replaceChildren();
  $("allCardsSum").textContent = "All cards (" + total + ")";
  Object.entries(state.cards).sort((a, b) => a[1].due - b[1].due).forEach(([id, c]) => {
    const row = el("div", "li"); row.append(el("span", "", c.front), el("span", "hint", c.due <= Date.now() ? "due" : label(c)));
    const del = el("button", "btn ghost sm", "Delete");
    del.onclick = () => { if (del.dataset.armed) { remove("card_" + id); renderReview(); renderProgress(); } else { del.dataset.armed = 1; del.textContent = "Confirm"; } };
    row.append(del); list.append(row);
  });
}
function updateBadge() { const n = dueCards().length + dueTakes().length; $("dueCount").hidden = !n; $("dueCount").textContent = n; }
function nextDue() {
  const n = Math.min(...Object.values(state.cards).map(c => c.due)); const d = n - Date.now();
  return d < 3600000 ? "in " + Math.max(1, Math.round(d / 60000)) + " min" : d < DAY ? "in " + Math.round(d / 3600000) + " h" : "in " + Math.round(d / DAY) + " days";
}

/* ---------- Progress ---------- */
function renderProgress() {
  const day = state.days[today()];
  $("sPomo").textContent = day ? day.pomodoros : 0;
  const sess = Object.values(state.sessions).sort((a, b) => a.at - b.at);
  const week = sess.filter(s => s.at > Date.now() - 7 * DAY);
  $("sWords").textContent = week.reduce((a, s) => a + s.words, 0).toLocaleString();
  const last = sess.slice(-10);
  $("sWpm").innerHTML = last.length ? Math.round(last.reduce((a, s) => a + s.wpm, 0) / last.length) + " <small>wpm</small>" : "–";
  const rec = last.filter(s => s.recall != null);
  $("sRecall").textContent = rec.length ? Math.round(rec.reduce((a, s) => a + s.recall, 0) / rec.length) + "%" : "–";
  const takes = Object.values(state.takes);
  $("sTakes").textContent = takes.length;
  $("sApplied").textContent = takes.reduce((a, t) => a + (t.applied || 0), 0);
  drawChart(sess.slice(-12));
  const tb = $("sessRows"); tb.replaceChildren();
  if (!sess.length) { const tr = el("tr"); const td = el("td", "hint", "No sessions yet. Finish a passage or a focus round to log one."); td.colSpan = 5; tr.append(td); tb.append(tr); }
  sess.slice().reverse().slice(0, 30).forEach(s => {
    const tr = el("tr");
    const d = new Date(s.at);
    tr.append(el("td", "", d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })),
      el("td", "", s.title), el("td", "n", s.words.toLocaleString()), el("td", "n", s.wpm), el("td", "n", s.recall == null ? "–" : s.recall + "%"));
    tb.append(tr);
  });
}
function drawChart(sess) {
  const box = $("chart");
  if (!sess.length) { box.replaceChildren(el("p", "hint", "Your sessions will chart here.")); return; }
  const W = 640, H = 220, L = 40, B = 26, T = 10, Rm = 8, ns = "http://www.w3.org/2000/svg";
  const max = Math.max(200, Math.ceil(Math.max(...sess.map(s => s.wpm)) / 100) * 100);
  const y = v => T + (H - T - B) * (1 - v / max);
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Reading speed and effective speed for recent sessions");
  const mk = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
  const step = max <= 400 ? 100 : max <= 1000 ? 200 : 500;
  for (let v = 0; v <= max; v += step) {
    mk("line", { x1: L, x2: W - Rm, y1: y(v), y2: y(v), stroke: "var(--line)", "stroke-width": 1, "stroke-dasharray": "2 3" });
    const t = mk("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end" }); t.textContent = v;
  }
  const slot = (W - L - Rm) / 12, bw = Math.min(30, slot * 0.6);
  sess.forEach((s, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    mk("rect", { x, y: y(s.wpm), width: bw, height: y(0) - y(s.wpm), fill: "var(--line)" });
    if (s.recall != null) { const e = s.wpm * s.recall / 100; mk("rect", { x, y: y(e), width: bw, height: y(0) - y(e), fill: "var(--ink)" }); }
    const t = mk("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle" }); t.textContent = s.recall == null ? "–" : s.recall + "%";
  });
  box.replaceChildren(svg);
}

/* ---------- Tabs, settings ---------- */
function switchTab(name) {
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name));
  document.querySelectorAll("section.tab").forEach(s => s.hidden = s.id !== "tab-" + name);
  if (name !== "read") stop(); else if (!R.playing) renderIdle();
  if (name === "recall") renderRecall();
  if (name === "apply") renderApply();
  if (name === "review") renderReview();
  if (name === "progress") renderProgress();
  try { localStorage.setItem(LS + "-tab", name); } catch {}
}
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));

const SET_FIELDS = { sFocus: "focus", sShort: "short", sLong: "long", sEvery: "every" };
const SET_CHECKS = { sAutoBreak: "autoBreak", sLock: "lock", sRecallPrompt: "recallPrompt", sSound: "sound" };
const applySize = () => document.documentElement.dataset.size = S().size;
$("sSize").onchange = e => { save("settings", { ...state.settings, size: e.target.value }); applySize(); SL.spans = []; renderIdle(); };
$("openSettings").onclick = () => {
  const s = S();
  for (const [id, k] of Object.entries(SET_FIELDS)) $(id).value = s[k];
  for (const [id, k] of Object.entries(SET_CHECKS)) $(id).checked = s[k];
  $("sSize").value = s.size;
  $("settings").showModal();
};
$("settings").addEventListener("close", () => {
  const next = { ...state.settings };
  for (const [id, k] of Object.entries(SET_FIELDS)) { const v = Math.round(+$(id).value); if (v >= +$(id).min && v <= +$(id).max) next[k] = v; }
  for (const [id, k] of Object.entries(SET_CHECKS)) next[k] = $(id).checked;
  save("settings", next);
  if (!P.running) P.remain = dur(P.phase);
  P.round = Math.min(P.round, S().every - 1);
  pomoRender();
});
function applySettings() {
  const s = S(); applySize();
  $("wpm").value = s.wpm; $("wpmOut").textContent = s.wpm + " wpm";
  $("chunkSize").value = s.chunk; $("punct").checked = s.punct;
  $("mode").value = s.mode; $("chunkSize").disabled = s.mode === "slide";
  if (!R.playing && R.words.length) renderIdle();
  if (!P.running && P.remain === dur(P.phase) || !P.running && P.remain > dur(P.phase)) P.remain = dur(P.phase);
  pomoRender(); readerMeta();
}
function renderAll() { renderReview(); renderProgress(); renderRecall(); renderApply(); }

loadText(SAMPLE_TITLE, SAMPLE, true);
P.remain = dur("focus");
applySettings(); renderAll();
try { const t = localStorage.getItem(LS + "-tab"); if (t && $("tab-" + t)) switchTab(t); } catch {}
setInterval(updateBadge, 30000);

/* ---------- backup: export / import everything as a JSON file ---------- */
$("exportData").onclick = () => {
  const blob = new Blob([JSON.stringify({ app: "kwick-study", version: 1, exported: new Date().toISOString(), data: allDocs() }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "kwick-study-backup-" + today() + ".json" });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("importData").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const parsed = JSON.parse(await f.text());
    if (!parsed || !["kwick-study", "tempo-reader"].includes(parsed.app) || typeof parsed.data !== "object") throw new Error("format");
    for (const [k, v] of Object.entries(parsed.data)) if (v && typeof v === "object") ingest(k, v);
    mirror(); applySettings(); renderAll();
    toast("Backup restored. Cards, takeaways and sessions were merged in.");
  } catch { toast("That file isn't a Kwick-Study backup."); }
};
})();

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
