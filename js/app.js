(() => {
const $ = id => document.getElementById(id);
const SAMPLE_TITLE = "Why recall beats rereading";
const SAMPLE = `Most people study by rereading. It feels productive because the words become familiar, and familiarity is easy to mistake for knowledge. Memory researchers call this the fluency illusion. The page looks known, so we assume it is known, but when the page is gone, much of it goes with it.

A stronger method is retrieval practice. Instead of looking at the material again, you close the book and try to pull it out of your own head. The effort is the point. Each time you successfully retrieve an idea, the path to it becomes easier to find next time. Even a failed attempt helps, because it shows you exactly what you missed before you check the answer.

Timing matters as much as effort. If you review an idea minutes after learning it, retrieval is easy and the gain is small. If you wait until you are close to forgetting, retrieval is harder and the memory grows stronger. This is the spacing effect. Spaced repetition systems use it by scheduling each card just before you are likely to forget it, so the gaps between reviews grow from one day to three, then a week, then a month.

Speed reading fits into this picture only when comprehension keeps up. Reading faster lets you cover more material in a focused session, but the words still need to land somewhere. A good habit is to read in short focused blocks, stop, write down what you remember, and turn the key ideas into questions. Then let the schedule bring those questions back. Short breaks between blocks give your attention time to recover, which is why the Pomodoro technique pairs well with reading: twenty-five minutes of focus, five minutes of rest, and a longer break after four rounds.`;

/* ---------- storage: localStorage on this device, synced to the account when signed in ---------- */
const LS = "kwick-study-v1";
const state = { settings: {}, cards: {}, sessions: {}, days: {}, takes: {}, library: {} };
const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, autoBreak: true, lock: true, recallPrompt: true, sound: true, muted: false, ambient: "river", ambientVol: 40, wpm: 150, chunk: 1, punct: true, mode: "slide", size: "medium", theme: "light" };

function ingest(key, val) {
  if (key === "settings") state.settings = val;
  else if (key.startsWith("card_")) state.cards[key.slice(5)] = val;
  else if (key.startsWith("sess_")) state.sessions[key.slice(5)] = val;
  else if (key.startsWith("day_")) state.days[key.slice(4)] = val;
  else if (key.startsWith("take_")) state.takes[key.slice(5)] = val;
  else if (key.startsWith("lib_")) state.library[key.slice(4)] = val;
}
function allDocs() {
  const out = { settings: state.settings };
  for (const [k, v] of Object.entries(state.cards)) out["card_" + k] = v;
  for (const [k, v] of Object.entries(state.sessions)) out["sess_" + k] = v;
  for (const [k, v] of Object.entries(state.days)) out["day_" + k] = v;
  for (const [k, v] of Object.entries(state.takes)) out["take_" + k] = v;
  for (const [k, v] of Object.entries(state.library)) out["lib_" + k] = v;
  return out;
}
const MAPS = { card: "cards", sess: "sessions", day: "days", take: "takes", lib: "library" };
function getDoc(key) {
  if (key === "settings") return state.settings;
  const i = key.indexOf("_"), m = state[MAPS[key.slice(0, i)]];
  return m ? m[key.slice(i + 1)] : undefined;
}
function dropDoc(key) {
  if (key === "settings") { state.settings = {}; return; }
  const i = key.indexOf("_"), m = state[MAPS[key.slice(0, i)]];
  if (m) delete m[key.slice(i + 1)];
  if (key.startsWith("lib_")) idbDel(key.slice(4));
}
function mirror() { try { localStorage.setItem(LS, JSON.stringify(allDocs())); } catch {} }
// meta[key] = when this device last changed the doc; used to settle conflicts when syncing.
const META = LS + "-meta", OWNER = LS + "-owner", SINCE = LS + "-since";
let meta = {};
try { meta = JSON.parse(localStorage.getItem(META) || "{}") || {}; } catch {}
function saveMeta() { try { localStorage.setItem(META, JSON.stringify(meta)); } catch {} }
function touch(key) { meta[key] = Date.now(); saveMeta(); Sync.queue(key); }
function save(key, val) {
  ingest(key, val); mirror(); touch(key);
}
function remove(key) {
  dropDoc(key); mirror(); touch(key);
}
const timers = {};
function saveLater(key, getVal, ms = 700) { clearTimeout(timers[key]); timers[key] = setTimeout(() => save(key, getVal()), ms); }

try { const raw = JSON.parse(localStorage.getItem(LS) || "null"); if (raw) for (const [k, v] of Object.entries(raw)) ingest(k, v); } catch {}
const S = () => ({ ...DEFAULTS, ...state.settings });

/* ---------- sync with the signed-in account (Supabase table user_docs) ---------- */
const Sync = { sb: null, user: null, pending: new Set(), timer: null, busy: false, state: "idle", at: null };
Sync.queue = key => {
  if (!Sync.user) return;
  Sync.pending.add(key); clearTimeout(Sync.timer); Sync.timer = setTimeout(() => Sync.flush(), 1500);
};
Sync.flush = async () => {
  clearTimeout(Sync.timer); Sync.timer = null;
  if (!Sync.user || Sync.busy || !Sync.pending.size) return;
  Sync.busy = true;
  const keys = [...Sync.pending]; Sync.pending.clear();
  const rows = keys.map(k => ({ user_id: Sync.user.id, key: k, value: getDoc(k) ?? { _deleted: true }, updated_ms: meta[k] || 1 }));
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await Sync.sb.from("user_docs").upsert(rows.slice(i, i + 500), { onConflict: "user_id,key" });
      if (error) throw error;
    }
    Sync.state = "ok"; Sync.at = new Date();
  } catch (e) {
    keys.forEach(k => Sync.pending.add(k));
    Sync.state = "error"; Sync.timer = setTimeout(() => Sync.flush(), 30000);
  } finally {
    Sync.busy = false; renderSyncState();
    if (Sync.pending.size && !Sync.timer) Sync.timer = setTimeout(() => Sync.flush(), 1500);
  }
};
async function fetchRows(since) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = Sync.sb.from("user_docs").select("key,value,updated_ms,synced_at").order("synced_at").order("key");
    if (since) q = q.gt("synced_at", since);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
// Apply server rows that are newer than ours; returns keys where ours is newer.
function applyRemote(rows) {
  const remoteKeys = new Set(), ours = [];
  let since = null;
  for (const r of rows) {
    remoteKeys.add(r.key);
    if (!since || r.synced_at > since) since = r.synced_at;
    const mine = meta[r.key] || 0;
    if (r.updated_ms > mine) {
      if (r.value && r.value._deleted) dropDoc(r.key); else ingest(r.key, r.value);
      meta[r.key] = r.updated_ms;
    } else if (r.updated_ms < mine) ours.push(r.key);
  }
  return { remoteKeys, ours, since };
}
function storeSince(since) { if (since) try { localStorage.setItem(SINCE + "-" + Sync.user.id, since); } catch {} }
async function firstSync() {
  Sync.state = "syncing"; renderSyncState();
  try {
    let owner = null; try { owner = localStorage.getItem(OWNER); } catch {}
    const rows = await fetchRows(null);
    if (owner && owner !== Sync.user.id) {
      // This browser holds someone else's data: start from this account's data instead of mixing them.
      state.settings = {}; state.cards = {}; state.sessions = {}; state.days = {}; state.takes = {}; state.library = {}; meta = {}; idbClear();
    }
    const { remoteKeys, ours, since } = applyRemote(rows);
    // Push anything only this device has, or where this device's copy is newer.
    for (const k of new Set([...Object.keys(allDocs()), ...Object.keys(meta)])) {
      if (k === "settings" && !Object.keys(state.settings).length && !meta.settings) continue;
      if (!remoteKeys.has(k) || ours.includes(k)) Sync.pending.add(k);
    }
    mirror(); saveMeta(); storeSince(since);
    try { localStorage.setItem(OWNER, Sync.user.id); } catch {}
    applySettings(); renderAll();
    Sync.state = "ok"; Sync.at = new Date();
    await Sync.flush();
    libUploadPending();
  } catch (e) { Sync.state = "error"; }
  renderSyncState();
}
async function pullChanges() {
  if (!Sync.user || Sync.busy) return;
  try {
    let since = null; try { since = localStorage.getItem(SINCE + "-" + Sync.user.id); } catch {}
    const rows = await fetchRows(since);
    if (!rows.length) return;
    const r = applyRemote(rows);
    r.ours.forEach(k => Sync.pending.add(k));
    mirror(); saveMeta(); storeSince(r.since);
    applySettings(); renderAll();
    Sync.state = "ok"; Sync.at = new Date(); renderSyncState();
    if (Sync.pending.size) Sync.flush();
    libUploadPending();
  } catch { Sync.state = "error"; renderSyncState(); }
}
function renderSyncState() {
  const el = document.getElementById("syncState"), note = document.getElementById("syncNote");
  const t = !Sync.user ? "" : Sync.state === "syncing" ? "Syncing your study data…"
    : Sync.state === "error" ? "Couldn't reach the server. Changes are saved on this device and will sync when you're back online."
    : "Your study data is synced" + (Sync.at ? " (last at " + Sync.at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) + ")." : ".");
  if (el) el.textContent = t;
  if (note) note.textContent = Sync.user ? "Signed in as " + Sync.user.email + ". " + t : "Your data is stored in this browser on this device. Create a free account to keep it in sync across devices, or use Settings → Export backup to keep a copy.";
}

/* ---------- helpers ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let toastT;
function toast(t) { const x = $("toast"); x.textContent = t; x.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => x.hidden = true, 2600); }

/* ---------- Sound: synthesised in the browser (no audio files, works offline) ---------- */
let audio = null;
function actx() {
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume().catch(() => {});
  return audio;
}
// Short notification sounds. Each is a few soft notes: [frequency, start offset s, length s, wave].
const SFX = {
  start:    [[523, 0, .18, "sine"], [784, .12, .3, "sine"]],
  focusEnd: [[660, 0, .5, "sine"], [880, .22, .6, "sine"]],
  breakEnd: [[880, 0, .45, "sine"], [660, .22, .45, "sine"], [523, .44, .6, "sine"]],
  correct:  [[880, 0, .2, "triangle"], [1320, .1, .35, "triangle"]],
  close:    [[660, 0, .3, "triangle"]],
  wrong:    [[247, 0, .22, "sine"], [196, .14, .35, "sine"]],
  finish:   [[523, 0, .3, "sine"], [659, .14, .3, "sine"], [784, .28, .3, "sine"], [1047, .42, .6, "sine"]],
  save:     [[988, 0, .12, "sine"]],
};
function sfx(name) {
  const s = S(); if (s.muted || !s.sound || !SFX[name]) return;
  try {
    const ctx = actx(), now = ctx.currentTime;
    SFX[name].forEach(([f, at, len, wave]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = wave; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = now + at;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.start(t); o.stop(t + len + 0.05);
    });
  } catch {}
}

// Background sounds made from shaped noise: river, rain, ocean waves, soft (brown) noise.
const AMB = { type: null, gain: null, node: null, preview: null };
function noiseBuffer(ctx, kind) {
  const len = ctx.sampleRate * 6, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    if (kind === "brown") { const drift = d[len - 1] - d[0]; for (let i = 0; i < len; i++) d[i] -= drift * i / len; } // seamless loop
  }
  return buf;
}
function buildAmbient(ctx, type) {
  const out = ctx.createGain(), running = [];
  const noise = kind => { const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, kind); n.loop = true; n.start(); running.push(n); return n; };
  const filter = (kind, freq, q) => { const f = ctx.createBiquadFilter(); f.type = kind; f.frequency.value = freq; if (q) f.Q.value = q; return f; };
  const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const lfo = (rate, depth, param) => { const o = ctx.createOscillator(), g = gain(depth); o.frequency.value = rate; o.connect(g); g.connect(param); o.start(); running.push(o); };
  if (type === "river") {
    const low = gain(0.55); noise("brown").connect(filter("lowpass", 650)).connect(low).connect(out);
    const bp = filter("bandpass", 1400, 0.6), hiss = gain(0.09);
    noise("white").connect(bp).connect(hiss).connect(out);
    lfo(0.23, 450, bp.frequency); lfo(0.17, 0.035, hiss.gain); lfo(0.11, 0.12, low.gain);
  } else if (type === "rain") {
    const g = gain(0.13); noise("white").connect(filter("highpass", 900)).connect(filter("lowpass", 7000)).connect(g).connect(out);
    noise("brown").connect(filter("lowpass", 300)).connect(gain(0.25)).connect(out);
    lfo(0.09, 0.025, g.gain);
  } else if (type === "ocean") {
    const lp = filter("lowpass", 700), swell = gain(0.4);
    noise("brown").connect(lp).connect(swell).connect(out);
    lfo(0.075, 0.32, swell.gain); lfo(0.075, 300, lp.frequency);
  } else {
    noise("brown").connect(filter("lowpass", 480)).connect(gain(0.6)).connect(out);
  }
  return { out, stop() { running.forEach(n => { try { n.stop(); } catch {} }); out.disconnect(); } };
}
const ambientLevel = () => (S().ambientVol / 100) * 0.7;
function ambientPlay(type) {
  try {
    const ctx = actx();
    if (AMB.type === type && AMB.gain) { AMB.gain.gain.setTargetAtTime(ambientLevel(), ctx.currentTime, 0.3); return; }
    ambientStop();
    const node = buildAmbient(ctx, type), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.linearRampToValueAtTime(ambientLevel(), ctx.currentTime + 1.5);
    node.out.connect(g); g.connect(ctx.destination);
    Object.assign(AMB, { type, gain: g, node });
  } catch {}
}
function ambientStop() {
  if (!AMB.gain) return;
  const { gain: g, node } = AMB, ctx = actx();
  g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1);
  setTimeout(() => { node.stop(); g.disconnect(); }, 1100);
  Object.assign(AMB, { type: null, gain: null, node: null });
}
// Background sound plays during focus rounds only, and never when muted.
function ambientUpdate() {
  if (AMB.preview) return;
  const s = S();
  if (!s.muted && s.ambient !== "off" && P.running && P.phase === "focus") ambientPlay(s.ambient); else ambientStop();
}
function ambientPreview() {
  clearTimeout(AMB.preview); AMB.preview = null;
  const s = S();
  if (s.muted || s.ambient === "off") { ambientUpdate(); return; }
  ambientPlay(s.ambient);
  AMB.preview = setTimeout(() => { AMB.preview = null; ambientUpdate(); }, 5000);
}
function renderMute() {
  const m = S().muted;
  $("muteToggle").textContent = m ? "Unmute" : "Mute";
  $("muteToggle").setAttribute("aria-label", m ? "Turn sounds back on" : "Mute all sounds");
  $("muteToggle").setAttribute("aria-pressed", m);
}
$("muteToggle").onclick = () => {
  save("settings", { ...state.settings, muted: !S().muted }); renderMute();
  clearTimeout(AMB.preview); AMB.preview = null; ambientUpdate();
  toast(S().muted ? "Sounds muted." : "Sounds on.");
};

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
  readerLockRender(); ambientUpdate();
}
function pomoStart() {
  if (P.running) return;
  P.running = true; P.endAt = Date.now() + P.remain;
  if (P.phase === "focus") sfx("start");
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
    sfx("focusEnd");
    onFocusEnd(natural);
  } else {
    if (P.phase === "long") P.round = 0;
    P.phase = "focus"; sfx("breakEnd");
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
  if (LIB.posTimer) { clearTimeout(LIB.posTimer); const id = LIB.id, m = state.library[id]; if (m && m.pos !== R.i) save("lib_" + id, { ...m, pos: R.i, rangeWords: R.words.length }); }
  LIB.id = null;
  R.title = title || "Untitled text"; R.text = text; R.words = parse(text); R.i = 0; R.maxI = 0; R.activeMs = 0; R.session = null; R.sample = !!sample;
  $("docTitle").textContent = R.title;
  $("docInfo").textContent = (sample ? "Sample passage · " : "") + R.words.length.toLocaleString() + " words";
  $("recallText").value = ""; $("recallResult").hidden = true;
  SL.spans = []; renderIdle(); buildContext(); $("contextPanel").hidden = false; readerMeta(); renderRecall();
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
  libSavePos();
}
function setPlayIcon() {
  $("playIcon").innerHTML = R.playing ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>' : '<path d="M7 4v16l13-8z"/>';
  $("play").setAttribute("aria-label", R.playing ? "Pause" : "Play");
}
function finish() {
  stop(); recordSession(); sfx("finish");
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
  readerMeta(); if (!R.playing) { buildContext(); libSavePos(); }
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
$("context").onclick = e => { const i = e.target.dataset && e.target.dataset.i; if (i == null) return; R.i = +i; renderIdle(); readerMeta(); buildContext(); libSavePos(); };
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
  $("loadBox").open = false;
  libAdd($("inTitle").value.trim() || "Pasted text", "text", [t]).then(id => libOpen(id)).then(() => toast("Loaded and saved to your library. Press Space to start."));
  $("inText").value = ""; $("inTitle").value = "";
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
/* ---------- Library: uploaded texts kept on this device (IndexedDB) and, when signed in,
   in the private Supabase Storage bucket "library" (one JSON file per text). The list itself
   (title, page range, reading position) syncs like any other study data as "lib_<id>". ---------- */
let idbPromise = null;
function idb() {
  return idbPromise = idbPromise || new Promise((res, rej) => {
    const r = indexedDB.open("kwick-study", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("texts", { keyPath: "id" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction("texts", mode), req = fn(tx.objectStore("texts")); tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); });
}
const idbGet = id => idbDo("readonly", st => st.get(id)).catch(() => null);
const idbPut = rec => idbDo("readwrite", st => st.put(rec));
const idbDel = id => idbDo("readwrite", st => st.delete(id)).catch(() => {});
const idbClear = () => idbDo("readwrite", st => st.clear()).catch(() => {});

const LIB = { id: null, uploading: new Set(), posTimer: null };
const libPath = id => Sync.user.id + "/" + id + ".json";
async function libAdd(title, kind, pages) {
  const id = uid(), words = parse(pages.join(" ")).length;
  try { await idbPut({ id, title, kind, pages }); } catch {}
  save("lib_" + id, { title, kind, pages: pages.length, words, created: Date.now(), opened: Date.now(), from: 1, to: pages.length, pos: 0, rangeWords: words, cloud: false });
  libUpload(id);
  return id;
}
async function libUpload(id) {
  if (!Sync.user || !Sync.sb || LIB.uploading.has(id)) return;
  const m = state.library[id]; if (!m || m.cloud) return;
  const rec = await idbGet(id); if (!rec) return;
  LIB.uploading.add(id); renderLibrary();
  try {
    const body = new Blob([JSON.stringify({ title: rec.title, kind: rec.kind, pages: rec.pages })], { type: "application/json" });
    const { error } = await Sync.sb.storage.from("library").upload(libPath(id), body, { upsert: true, contentType: "application/json" });
    if (error) throw error;
    if (state.library[id]) save("lib_" + id, { ...state.library[id], cloud: true });
  } catch (e) { /* stays on this device; retried on the next sync */ }
  finally { LIB.uploading.delete(id); renderLibrary(); }
}
function libUploadPending() { Object.keys(state.library).forEach(id => { if (!state.library[id].cloud) libUpload(id); }); }
async function libContent(id) {
  const local = await idbGet(id);
  if (local) return local;
  const m = state.library[id];
  if (!m || !m.cloud || !Sync.user) return null;
  const { data, error } = await Sync.sb.storage.from("library").download(libPath(id));
  if (error || !data) throw error || new Error("download failed");
  const c = JSON.parse(await data.text());
  const rec = { id, title: c.title, kind: c.kind, pages: c.pages };
  idbPut(rec).catch(() => {});
  return rec;
}
async function libOpen(id, range) {
  const m = state.library[id]; if (!m) return;
  let rec;
  try { rec = await libContent(id); } catch { toast("Couldn't download this text. Check your connection and try again."); return; }
  if (!rec) { toast(Sync.user ? "This text hasn't finished uploading from the device that added it. Try again shortly." : "This text is in your account. Sign in to open it here."); return; }
  PDF.name = rec.title; PDF.pages = rec.pages;
  const n = rec.pages.length;
  const from = range ? range[0] : Math.min(m.from || 1, n), to = range ? range[1] : Math.min(Math.max(m.to || n, from), n);
  loadPdfPages(from, to);
  LIB.id = id;
  const pos = range || (m.pos || 0) >= R.words.length - 1 ? 0 : (m.pos || 0);
  if (pos) { R.i = pos; renderIdle(); buildContext(); readerMeta(); }
  $("pageRange").hidden = n <= 1;
  if (n > 1) { $("pFrom").value = from; $("pTo").value = to; $("pFrom").max = $("pTo").max = n; $("pOf").textContent = "of " + n; }
  save("lib_" + id, { ...m, from, to, pos, rangeWords: R.words.length, opened: Date.now() });
  renderLibrary();
}
// Remember where you are in a library text (after pausing or jumping), so any device resumes there.
function libSavePos() {
  const id = LIB.id; if (!id) return;
  clearTimeout(LIB.posTimer);
  const pos = R.i, rangeWords = R.words.length;
  LIB.posTimer = setTimeout(() => { const m = state.library[id]; if (m && m.pos !== pos) { save("lib_" + id, { ...m, pos, rangeWords, opened: Date.now() }); renderLibrary(); } }, 1200);
}
async function libDelete(id) {
  const m = state.library[id]; if (!m) return;
  if (LIB.id === id) LIB.id = null;
  remove("lib_" + id); idbDel(id);
  if (Sync.user && m.cloud) Sync.sb.storage.from("library").remove([libPath(id)]).catch(() => {});
  renderLibrary();
}
function renderLibrary() {
  const panel = $("libPanel"), list = $("libList");
  const items = Object.entries(state.library).sort((a, b) => (b[1].opened || 0) - (a[1].opened || 0));
  panel.hidden = !items.length; list.replaceChildren();
  $("libNote").textContent = !items.length ? "" : Sync.user ? "Synced to your account" : "On this device. Sign in to open them on your other devices.";
  items.forEach(([id, m]) => {
    const row = el("div", "lib-item" + (LIB.id === id ? " current" : ""));
    const info = el("div", "lib-info");
    const t = el("button", "lib-title", m.title); t.onclick = () => libOpen(id).then(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    const bits = [m.kind === "pdf" ? "PDF" : "Text", m.pages > 1 ? m.pages + " pages" : null, (m.words || 0).toLocaleString() + " words"];
    if (m.pages > 1 && (m.from !== 1 || m.to !== m.pages)) bits.push(m.from === m.to ? "p. " + m.from : "pp. " + m.from + "–" + m.to);
    const pct = m.rangeWords ? Math.min(100, Math.round((m.pos || 0) / m.rangeWords * 100)) : 0;
    if (pct) bits.push(pct + "% read");
    const status = LIB.id === id ? "Reading now" : LIB.uploading.has(id) ? "Uploading…" : !Sync.user ? "" : m.cloud ? "Synced" : "Waiting to upload";
    info.append(t, el("span", "hint", bits.join(" · ") + (status ? " · " + status : "")));
    const del = el("button", "btn ghost sm", "Delete");
    del.onclick = () => { if (del.dataset.armed) libDelete(id); else { del.dataset.armed = 1; del.textContent = "Confirm delete"; } };
    row.append(info, del); list.append(row);
  });
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
      await libOpen(await libAdd(name, "pdf", pages));
      $("fileStatus").textContent = "Loaded " + f.name + ": " + pages.length + " page" + (pages.length > 1 ? "s" : "") + ", " + words.toLocaleString() + " words." + (pages.length > 1 ? " Choose a page range below to read one section per round." : "");
    } else {
      const text = await f.text();
      if (parse(text).length < 10) { $("fileStatus").textContent = "That file has too little text to read."; return; }
      await libOpen(await libAdd(name, "text", [text]));
      $("fileStatus").textContent = "Loaded " + f.name + ": " + R.words.length.toLocaleString() + " words.";
    }
    toast("Loaded and saved to your library. Press Space to start."); window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    $("fileStatus").textContent = "Couldn't read that file. If it's a PDF, check it isn't password-protected, then try again.";
  }
}
$("file").onchange = e => { handleFile(e.target.files[0]); e.target.value = ""; };
$("loadPages").onclick = () => {
  const n = PDF.pages.length, a = Math.max(1, Math.min(n, Math.round(+$("pFrom").value || 1))), b = Math.max(a, Math.min(n, Math.round(+$("pTo").value || n)));
  $("pFrom").value = a; $("pTo").value = b;
  if (LIB.id) libOpen(LIB.id, [a, b]); else loadPdfPages(a, b);
  toast(a === b ? "Loaded page " + a + "." : "Loaded pages " + a + "–" + b + ".");
  window.scrollTo({ top: 0, behavior: "smooth" });
};
const drop = $("drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));
document.addEventListener("keydown", e => {
  if (!$("tab-review").hidden && RV.checked && /^[1-4]$/.test(e.key) && !e.target.closest("input, textarea")) {
    const b = document.querySelectorAll("#gradeArea .grades button")[+e.key - 1]; if (b) { e.preventDefault(); b.click(); } return;
  }
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
// Quick quiz on the Recall page: fill in the blanks, check, then keep the missed ones for review.
const QZ = { title: null, items: [], checked: false };
function buildQuiz(missed, skip) {
  const src = readText(), keys = keywords(src, 16), prefer = missed && missed.length ? [...missed, ...keys.filter(k => !missed.includes(k))] : keys;
  const sentences = (src.match(/[^.!?]+[.!?]+/g) || []).map(s => s.trim()).filter(s => { const n = s.split(" ").length; return n >= 7 && n <= 40; });
  const existing = new Set(Object.values(state.cards).map(c => c.front));
  const used = new Set(), items = [];
  for (const k of prefer) {
    const re = new RegExp("\\b(" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "i");
    const s = sentences.find(x => re.test(x) && !used.has(x));
    if (!s) continue;
    used.add(s);
    const front = s.replace(re, BLANK);
    if (!existing.has(front) && !(skip && skip.has(front))) items.push({ front, back: s.match(re)[1], typed: "", result: null, added: false });
    if (items.length >= 5) break;
  }
  Object.assign(QZ, { title: R.title, items, checked: false });
}
function renderSuggestions(missed) {
  if (missed || QZ.title !== R.title) buildQuiz(missed);
  const box = $("sugg"), actions = $("quizActions"); box.replaceChildren(); actions.replaceChildren();
  if (!QZ.items.length) { box.append(el("p", "hint", "No sentences to quiz on yet. Write your own question and answer below.")); return; }
  const inputs = [];
  QZ.items.forEach((it, i) => {
    const item = el("div", "item"), p = el("p");
    const at = it.front.indexOf(BLANK), before = it.front.slice(0, at), after = it.front.slice(at + BLANK.length);
    if (!QZ.checked) {
      const inp = el("input", "blank"); inp.type = "text"; inp.value = it.typed; inp.autocomplete = "off"; inp.spellcheck = false;
      inp.setAttribute("aria-label", "Missing word " + (i + 1)); inp.style.width = Math.max(5, it.back.length + 2) + "ch";
      inp.addEventListener("input", () => it.typed = inp.value);
      inp.addEventListener("keydown", e => { if (e.key !== "Enter") return; e.preventDefault(); const next = inputs[i + 1]; if (next) next.focus(); else checkQuiz(); });
      inputs.push(inp);
      p.append(before, inp, after);
      item.append(p);
    } else {
      p.append(before, el("span", "filled " + it.result, it.back), after);
      if (it.result !== "right") { const w = el("span", "hint you"); w.append(" You wrote ", el("s", "", it.typed.trim() || "nothing"), "."); p.append(w); }
      const side = el("div", "side");
      side.append(el("span", "mark " + it.result, it.result === "right" ? "Correct" : it.result === "close" ? "Almost" : "Missed"));
      const b = el("button", "btn sm" + (it.result === "right" ? "" : " primary"), it.added ? "Added" : it.result === "right" ? "Review anyway" : "Add to review");
      b.disabled = it.added;
      b.onclick = () => { addQuizCard(it); renderSuggestions(); };
      side.append(b);
      item.append(p, side);
    }
    box.append(item);
  });
  if (!QZ.checked) {
    const b = el("button", "btn primary", "Check my answers"); b.onclick = checkQuiz;
    actions.append(b, el("span", "hint", "Leave a blank empty if you don't remember. Press Enter to move to the next one."));
  } else {
    const right = QZ.items.filter(it => it.result === "right").length, left = QZ.items.filter(it => it.result !== "right" && !it.added);
    actions.append(el("span", "score-line", right + " of " + QZ.items.length + " right."));
    if (left.length) {
      const b = el("button", "btn primary", "Add " + (left.length === 1 ? "the missed one" : "all " + left.length + " missed") + " to review");
      b.onclick = () => { left.forEach(addQuizCard); renderSuggestions(); };
      actions.append(b);
    } else actions.append(el("span", "hint", right === QZ.items.length ? "Every blank right. Nothing to drill." : "Missed ones are in your review deck."));
    const again = el("button", "btn ghost", "New set of blanks"); again.onclick = () => { buildQuiz(null, new Set(QZ.items.map(it => it.front))); if (!QZ.items.length) buildQuiz(); renderSuggestions(); };
    actions.append(again);
  }
}
function checkQuiz() {
  QZ.items.forEach(it => it.result = markAnswer(it.typed, it.back));
  QZ.checked = true; renderSuggestions();
  const right = QZ.items.filter(it => it.result === "right").length;
  sfx(right === QZ.items.length ? "correct" : right || QZ.items.some(it => it.result === "close") ? "close" : "wrong");
}
// A missed card is due again in 10 minutes; a correct one you keep anyway starts at one day.
function addQuizCard(it) {
  if (it.added) return;
  addCard(it.front, it.back, SUGGEST[it.result]);
  it.added = true;
}
function addCard(front, back, grade) {
  const id = uid();
  let card = { front, back, src: R.title, ease: 2.5, interval: 0, reps: 0, due: Date.now(), created: Date.now() };
  if (grade != null) card = schedule(card, grade);
  save("card_" + id, card); sfx("save");
  renderReview(); renderProgress();
  toast(card.due <= Date.now() + 15 * 60000 ? "Added to review. It comes back " + (card.due <= Date.now() ? "now." : "in 10 minutes.") : "Added to review. First review in " + label(card) + ".");
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
  renderApply(); renderReview(); renderProgress(); sfx("save");
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
// Review flow: the learner answers first (types into the blank, or writes an answer), then checks.
// Fill-in-the-blank cards are marked automatically; question cards are compared side by side.
const RV = { id: null, typed: "", checked: false, result: null };
const BLANK = "_____";
const norm = t => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// "right", "close" (a typo or another form of the same word) or "wrong"
function markAnswer(typed, answer) {
  const t = norm(typed), a = norm(answer);
  if (!t) return "wrong";
  if (t === a) return "right";
  if (editDistance(t, a) <= (a.length <= 5 ? 1 : 2) || (a.length >= 5 && t.length >= 5 && stem(t) === stem(a))) return "close";
  return "wrong";
}
const SUGGEST = { right: 2, close: 1, wrong: 0 };
function dueCards() { const now = Date.now(); return Object.entries(state.cards).filter(([, c]) => c.due <= now).sort((a, b) => a[1].due - b[1].due); }
function gradeCard(id, c, g) { Object.assign(RV, { id: null, typed: "", checked: false, result: null }); save("card_" + id, schedule(c, g)); renderReview(); }
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
    if (RV.id !== id) Object.assign(RV, { id, typed: "", checked: false, result: null });
    const cloze = c.front.includes(BLANK);
    card.append(el("div", "label", c.src || ""));
    const q = el("div", "q");
    let input;
    if (cloze) {
      const [before, after] = [c.front.slice(0, c.front.indexOf(BLANK)), c.front.slice(c.front.indexOf(BLANK) + BLANK.length)];
      if (!RV.checked) {
        input = el("input", "blank"); input.type = "text"; input.id = "blankInput"; input.value = RV.typed;
        input.setAttribute("aria-label", "Missing word"); input.autocomplete = "off"; input.spellcheck = false;
        input.style.width = Math.max(5, c.back.length + 2) + "ch";
        q.append(before, input, after);
      } else {
        const filled = el("span", "filled " + RV.result, c.back);
        q.append(before, filled, after);
      }
    } else q.append(c.front);
    card.append(q);

    if (!RV.checked) {
      if (!cloze) {
        input = el("textarea", "answer"); input.id = "answerInput"; input.rows = 2; input.value = RV.typed;
        input.placeholder = "Type your answer from memory, then check it.";
        card.append(input);
      }
      card.append(el("p", "hint", cloze ? "Type the missing word, then press Enter." : "Saying it out loud works too. Then check."));
      const b = el("button", "btn primary", "Check"); b.style.width = "100%";
      const check = () => {
        RV.typed = input.value; RV.checked = true;
        RV.result = cloze ? markAnswer(RV.typed, c.back) : null;
        if (cloze) sfx(RV.result === "right" ? "correct" : RV.result);
        renderReview();
      };
      b.onclick = check;
      input.addEventListener("input", () => RV.typed = input.value);
      input.addEventListener("keydown", e => { if (e.key === "Enter" && (cloze || e.ctrlKey || e.metaKey)) { e.preventDefault(); check(); } });
      ga.append(b);
      setTimeout(() => { try { input.focus({ preventScroll: true }); } catch {} }, 0);
    } else {
      if (cloze) {
        const msg = RV.result === "right" ? "Correct." : RV.result === "close" ? "Almost. Check the spelling." : "Not quite.";
        const v = el("div", "verdict " + RV.result);
        v.append(el("strong", "", msg));
        if (RV.result !== "right") v.append(" You wrote ", el("s", "", RV.typed.trim() || "nothing"), "; the answer is ", el("b", "", c.back), ".");
        card.append(v);
      } else {
        const v = el("dl", "notes compare");
        v.append(el("dt", "", "You"), el("dd", "", RV.typed.trim() || "(nothing written)"), el("dt", "", "Answer"), el("dd", "", c.back));
        card.append(v);
      }
      const suggested = cloze ? SUGGEST[RV.result] : null;
      ga.append(el("p", "hint center", cloze ? "When should this come back? The highlighted choice matches your answer; pick another if it felt easier or harder." : "How well did your answer match? This sets when the card comes back."));
      const g = el("div", "grades");
      ["Again", "Hard", "Good", "Easy"].forEach((name, i) => {
        const b = el("button", "btn" + (i === suggested ? " primary" : ""));
        b.append(el("span", "", name), el("small", "", label(schedule(c, i))));
        b.onclick = () => gradeCard(id, c, i);
        g.append(b);
      });
      ga.append(g);
      setTimeout(() => { const s = g.querySelector(".primary") || g.children[2]; try { s.focus({ preventScroll: true }); } catch {} }, 0);
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
    mk("rect", { x, y: y(s.wpm), width: bw, height: y(0) - y(s.wpm), fill: "var(--brand-soft)" });
    if (s.recall != null) { const e = s.wpm * s.recall / 100; mk("rect", { x, y: y(e), width: bw, height: y(0) - y(e), fill: "var(--brand)" }); }
    const t = mk("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle" }); t.textContent = s.recall == null ? "–" : s.recall + "%";
  });
  box.replaceChildren(svg);
}

/* ---------- Tabs, settings ---------- */
function switchTab(name) {
  if (name === "account") renderAccount();
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
// Theme: light by default; "auto" follows the device and switches when the device does.
const darkQuery = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
function applyTheme() {
  let t = S().theme;
  if (t === "auto") t = darkQuery && darkQuery.matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  $("themeColor").content = t === "dark" ? "#12161f" : "#f6f7f9";
  const next = t === "dark" ? "light" : "dark";
  $("themeToggle").textContent = next === "light" ? "Light mode" : "Dark mode";
  $("themeToggle").setAttribute("aria-label", "Switch to " + next + " mode");
}
$("themeToggle").onclick = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  save("settings", { ...state.settings, theme: next }); applyTheme(); $("sTheme").value = next;
};
if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener("change", () => { if (S().theme === "auto") applyTheme(); });
$("sTheme").onchange = e => { save("settings", { ...state.settings, theme: e.target.value }); applyTheme(); };
$("sAmbient").onchange = e => { save("settings", { ...state.settings, ambient: e.target.value }); ambientPreview(); };
$("sAmbientVol").oninput = e => { state.settings = { ...state.settings, ambientVol: +e.target.value }; saveLater("settings", () => state.settings); ambientPreview(); };
$("sSize").onchange = e => { save("settings", { ...state.settings, size: e.target.value }); applySize(); SL.spans = []; renderIdle(); };
$("openSettings").onclick = () => {
  const s = S();
  for (const [id, k] of Object.entries(SET_FIELDS)) $(id).value = s[k];
  for (const [id, k] of Object.entries(SET_CHECKS)) $(id).checked = s[k];
  $("sSize").value = s.size; $("sTheme").value = s.theme;
  $("sAmbient").value = s.ambient; $("sAmbientVol").value = s.ambientVol;
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
  const s = S(); applySize(); applyTheme(); renderMute();
  $("wpm").value = s.wpm; $("wpmOut").textContent = s.wpm + " wpm";
  $("chunkSize").value = s.chunk; $("punct").checked = s.punct;
  $("mode").value = s.mode; $("chunkSize").disabled = s.mode === "slide";
  if (!R.playing && R.words.length) renderIdle();
  if (!P.running && P.remain === dur(P.phase) || !P.running && P.remain > dur(P.phase)) P.remain = dur(P.phase);
  pomoRender(); readerMeta();
}
function renderAll() { renderReview(); renderProgress(); renderRecall(); renderApply(); renderLibrary(); }

loadText(SAMPLE_TITLE, SAMPLE, true);
P.remain = dur("focus");
applySettings(); renderAll();
try { const t = localStorage.getItem(LS + "-tab"); if (t && t !== "account" && $("tab-" + t)) switchTab(t); } catch {}
if (location.hash === "#account") switchTab("account");
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
    for (const [k, v] of Object.entries(parsed.data)) if (v && typeof v === "object") { ingest(k, v); touch(k); }
    mirror(); applySettings(); renderAll();
    toast("Backup restored. Cards, takeaways and sessions were merged in.");
  } catch { toast("That file isn't a Kwick-Study backup."); }
};

/* ---------- accounts: sign up, sign in, password reset, newsletter (Supabase Auth) ---------- */
const A = { mode: "create", profile: null, recovering: false };
const acctPanels = ["acctOff", "acctOut", "acctReset", "acctIn"];
function showPanel(id) { acctPanels.forEach(p => $(p).hidden = p !== id); }
function acctMsg(id, text, bad) { const m = $(id); m.textContent = text || ""; m.style.color = bad ? "var(--focus)" : ""; }
function setMode(mode) {
  A.mode = mode;
  const create = mode === "create";
  $("modeCreate").setAttribute("aria-pressed", create); $("modeSignin").setAttribute("aria-pressed", !create);
  $("acctTitle").textContent = create ? "Create your Kwick-Study account" : "Welcome back";
  $("acctLead").textContent = create ? "Keep your flashcards, takeaways and progress on every device. Free." : "Sign in to sync your study data on this device.";
  $("acctPass").autocomplete = create ? "new-password" : "current-password";
  $("passHint").hidden = !create; $("nlRow").hidden = !create; $("forgot").hidden = create;
  $("acctSubmit").textContent = create ? "Create account" : "Sign in";
  $("resend").hidden = true; acctMsg("acctMsg", "");
}
function renderAccount() {
  $("openAccount").textContent = Sync.user ? "Account" : "Sign in";
  renderSyncState();
  if (!Sync.sb) { showPanel("acctOff"); return; }
  if (A.recovering) { showPanel("acctReset"); return; }
  if (!Sync.user) { showPanel("acctOut"); return; }
  showPanel("acctIn");
  $("acctWho").textContent = Sync.user.email;
  const p = A.profile;
  $("acctNewsToggle").checked = !!(p && p.newsletter);
  $("newsState").textContent = !p ? "" : p.newsletter && p.newsletter_consented_at
    ? "Subscribed since " + new Date(p.newsletter_consented_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) + "."
    : "Not subscribed.";
}
async function loadProfile() {
  const { data } = await Sync.sb.from("profiles").select("newsletter,newsletter_consented_at").eq("id", Sync.user.id).maybeSingle();
  A.profile = data || null; renderAccount();
}
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const siteUrl = () => location.origin + location.pathname;
function friendlyAuthError(e) {
  const m = (e && e.message || "").toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Sign in instead, or reset your password.";
  if (m.includes("invalid login")) return "That email and password don't match. Check them, or reset your password.";
  if (m.includes("email not confirmed")) return "Confirm your email first. We sent you a link when you signed up.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute, then try again.";
  if (m.includes("password")) return e.message;
  if (m.includes("fetch") || m.includes("network")) return "Couldn't reach the server. Check your internet connection and try again.";
  return e && e.message ? e.message : "Something went wrong. Try again.";
}
$("openAccount").onclick = () => switchTab("account");
$("modeCreate").onclick = () => setMode("create");
$("modeSignin").onclick = () => setMode("signin");
$("acctForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("acctEmail").value.trim(), pass = $("acctPass").value;
  if (!emailOk(email)) return acctMsg("acctMsg", "Enter a valid email address.", true);
  if (A.mode === "create" && pass.length < 8) return acctMsg("acctMsg", "Use at least 8 characters for your password.", true);
  if (!pass) return acctMsg("acctMsg", "Enter your password.", true);
  const btn = $("acctSubmit"); btn.disabled = true; acctMsg("acctMsg", A.mode === "create" ? "Creating your account…" : "Signing in…");
  try {
    if (A.mode === "create") {
      const { data, error } = await Sync.sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: siteUrl(), data: { newsletter: $("acctNews").checked } } });
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error("already registered");
      if (!data.session) { acctMsg("acctMsg", "Almost done. We sent a confirmation link to " + email + ". Open it to activate your account."); $("resend").hidden = false; }
      $("acctPass").value = "";
    } else {
      const { error } = await Sync.sb.auth.signInWithPassword({ email, password: pass });
      if (error) { if ((error.message || "").toLowerCase().includes("not confirmed")) $("resend").hidden = false; throw error; }
      $("acctPass").value = ""; acctMsg("acctMsg", "");
    }
  } catch (err) { acctMsg("acctMsg", friendlyAuthError(err), true); }
  finally { btn.disabled = false; }
});
$("resend").onclick = async () => {
  const email = $("acctEmail").value.trim(); if (!emailOk(email)) return acctMsg("acctMsg", "Enter your email address first.", true);
  const { error } = await Sync.sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: siteUrl() } });
  acctMsg("acctMsg", error ? friendlyAuthError(error) : "Sent a new confirmation link to " + email + ".", !!error);
};
$("forgot").onclick = async () => {
  const email = $("acctEmail").value.trim();
  if (!emailOk(email)) return acctMsg("acctMsg", "Enter your email address above, then choose Forgot password.", true);
  const { error } = await Sync.sb.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
  acctMsg("acctMsg", error ? friendlyAuthError(error) : "If an account exists for " + email + ", a password reset link is on its way.", !!error);
};
$("resetForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pass = $("newPass").value;
  if (pass.length < 8) return acctMsg("resetMsg", "Use at least 8 characters.", true);
  const { error } = await Sync.sb.auth.updateUser({ password: pass });
  if (error) return acctMsg("resetMsg", friendlyAuthError(error), true);
  A.recovering = false; $("newPass").value = ""; renderAccount(); toast("Password updated. You're signed in.");
});
$("acctNewsToggle").onchange = async e => {
  const on = e.target.checked; e.target.disabled = true;
  const { data, error } = await Sync.sb.from("profiles").update({ newsletter: on }).eq("id", Sync.user.id).select("newsletter,newsletter_consented_at").maybeSingle();
  e.target.disabled = false;
  if (error || !data) { e.target.checked = !on; acctMsg("acctInMsg", "Couldn't update your newsletter choice. Try again.", true); return; }
  A.profile = data; renderAccount(); toast(on ? "Subscribed to the newsletter." : "Unsubscribed from the newsletter.");
};
$("signOut").onclick = async () => {
  await Sync.flush();
  const wipe = $("wipeOnOut").checked;
  await Sync.sb.auth.signOut();
  if (wipe) {
    try { [LS, META, OWNER].forEach(k => localStorage.removeItem(k)); } catch {}
    LIB.id = null;
    state.settings = {}; state.cards = {}; state.sessions = {}; state.days = {}; state.takes = {}; state.library = {}; meta = {}; idbClear();
    applySettings(); renderAll();
  }
  toast(wipe ? "Signed out and removed your data from this browser." : "Signed out.");
};
$("delAcct").onclick = async () => {
  const b = $("delAcct");
  if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = "Yes, permanently delete my account"; acctMsg("acctInMsg", "This deletes your account, newsletter subscription and synced study data. Data on this device stays unless you remove it.", true); return; }
  b.disabled = true;
  try {
    const { data: files } = await Sync.sb.storage.from("library").list(Sync.user.id, { limit: 1000 });
    if (files && files.length) await Sync.sb.storage.from("library").remove(files.map(f => Sync.user.id + "/" + f.name));
  } catch {}
  const { error } = await Sync.sb.rpc("delete_my_account");
  b.disabled = false; delete b.dataset.armed; b.textContent = "Delete account";
  if (error) return acctMsg("acctInMsg", "Couldn't delete your account. Try again.", true);
  try { localStorage.removeItem(OWNER); } catch {}
  await Sync.sb.auth.signOut().catch(() => {});
  acctMsg("acctInMsg", ""); toast("Your account was deleted.");
};
async function onAuth(event, session) {
  const u = session && session.user || null;
  if (event === "PASSWORD_RECOVERY") { A.recovering = true; Sync.user = u; switchTab("account"); return; }
  if (u && (!Sync.user || Sync.user.id !== u.id)) {
    Sync.user = u; renderAccount();
    if (event === "SIGNED_IN" && /access_token|type=signup/.test(location.hash)) { history.replaceState(null, "", siteUrl()); toast("Email confirmed. You're signed in."); }
    await firstSync(); loadProfile();
  } else if (!u && Sync.user) {
    Sync.user = null; A.profile = null; A.recovering = false; Sync.pending.clear(); Sync.state = "idle";
  }
  renderAccount();
}
function initAccounts() {
  const cfg = window.KWICK_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
    $("acctOffText").textContent = !cfg.supabaseUrl || !cfg.supabaseAnonKey
      ? "Accounts aren't switched on for this copy of Kwick-Study yet. You can keep using everything; your data stays in this browser."
      : "Couldn't load the sign-in service. Check your internet connection and reload. Everything else keeps working offline.";
    renderAccount(); return;
  }
  Sync.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  // Run the handler outside the auth callback: awaiting Supabase calls inside it can deadlock.
  Sync.sb.auth.onAuthStateChange((event, session) => setTimeout(() => onAuth(event, session), 0));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullChanges(); else Sync.flush(); });
  window.addEventListener("online", () => { Sync.flush(); pullChanges(); });
  setInterval(pullChanges, 120000);
  renderAccount();
}
setMode("create");
initAccounts();
})();

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
