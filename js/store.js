// Data store: local cache + patch queue, synced to the private GitHub data repo.
// Every change is kept as a per-record patch until it is safely on GitHub, then
// merged onto the freshest copy of the file (by id, field by field), so the
// app, the daily search and Claude can all write without clobbering each other.
import { GitHub, ConflictError, AuthError } from './github.js';

const ARRAYS = { events: 'events.json', calendar: 'calendar.json', collections: 'collections.json' };
const SETTINGS = 'settings.json';
const PROFILE = 'taste-profile.md';
const STATUS = 'discovery-status.json';
const TRACKED = [...Object.values(ARRAYS), SETTINGS, PROFILE, STATUS];
const LS_KEY = 'su:store:v1';
const CFG_KEY = 'su:config:v1';

export const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const maxIso = (a, b) => ((a || '') > (b || '') ? a : b);
function parseJson(text, fallback) {
  if (text == null) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}
function applyPatches(arr, patches) {
  const out = Array.isArray(arr) ? arr.slice() : [];
  const idx = new Map(out.map((r, i) => [r.id, i]));
  for (const p of Object.values(patches)) {
    const i = idx.get(p.id);
    if (i === undefined) { idx.set(p.id, out.length); out.push({ ...p }); }
    else out[i] = { ...out[i], ...p, updatedAt: maxIso(out[i].updatedAt, p.updatedAt) };
  }
  return out;
}
function applySettings(s, d) {
  const out = { cities: [], ...(s || {}) };
  if (!d) return out;
  if (d.currentCity && (d.currentCityUpdatedAt || '') >= (out.currentCityUpdatedAt || '')) {
    out.currentCity = d.currentCity; out.currentCityUpdatedAt = d.currentCityUpdatedAt;
  }
  out.cities = applyPatches(out.cities, d.cities || {});
  return out;
}
function applyProfile(text, d) {
  let t = text || '';
  if (!d) return t;
  if (d.replace != null) t = d.replace;
  for (const a of d.appends || []) t = t.replace(/\s*$/, '\n') + a + '\n';
  return t;
}

class Store extends EventTarget {
  constructor() {
    super();
    this.files = {};
    this.dirty = { events: {}, calendar: {}, collections: {}, settings: null, profile: null };
    this.data = { events: [], calendar: [], collections: [], settings: { cities: [] }, profile: '', status: null };
    this.sync = { state: 'idle', message: '', lastPull: null };
    this.cfg = parseJson(localStorage.getItem(CFG_KEY), null);
    this.pushing = false; this.pushTimer = null; this.pullTimer = null;
    this.loadCache();
  }

  // ---------- config ----------
  get connected() { return !!(this.cfg && this.cfg.token); }
  gh() { return new GitHub(this.cfg); }
  async connect(cfg) {
    const gh = new GitHub(cfg);
    await gh.checkAccess();
    this.cfg = cfg;
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    await this.pull(true);
  }
  disconnect() {
    localStorage.removeItem(CFG_KEY); localStorage.removeItem(LS_KEY);
    this.cfg = null; location.reload();
  }

  // ---------- cache ----------
  loadCache() {
    const c = parseJson(localStorage.getItem(LS_KEY), null);
    if (c) { this.files = c.files || {}; this.dirty = { ...this.dirty, ...(c.dirty || {}) }; }
    this.rebuild(false);
  }
  saveCache() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ files: this.files, dirty: this.dirty })); }
    catch (e) { console.warn('Cache full', e); }
  }
  rebuild(emit = true) {
    const f = (p) => this.files[p]?.text;
    for (const [k, p] of Object.entries(ARRAYS)) this.data[k] = applyPatches(parseJson(f(p), []), this.dirty[k]);
    this.data.settings = applySettings(parseJson(f(SETTINGS), {}), this.dirty.settings);
    this.data.profile = applyProfile(f(PROFILE), this.dirty.profile);
    this.data.status = parseJson(f(STATUS), null);
    if (emit) this.dispatchEvent(new Event('change'));
  }
  hasDirty() {
    const d = this.dirty;
    return Object.keys(d.events).length || Object.keys(d.calendar).length || Object.keys(d.collections).length || d.settings || d.profile;
  }
  setSync(state, message = '') { this.sync.state = state; this.sync.message = message; this.dispatchEvent(new Event('sync')); }

  // ---------- pull ----------
  async pull(force = false) {
    if (!this.connected) return;
    try {
      const gh = this.gh();
      const shas = await gh.listRoot();
      const changed = TRACKED.filter((p) => shas[p] && (force || shas[p] !== this.files[p]?.sha));
      await Promise.all(changed.map(async (p) => { this.files[p] = await gh.getFile(p); }));
      this.sync.lastPull = Date.now();
      if (changed.length) { this.saveCache(); this.rebuild(); }
      if (!this.pushing) this.setSync(this.hasDirty() ? 'pending' : 'saved');
      if (this.hasDirty()) this.schedulePush(200);
    } catch (e) { this.handleError(e); }
  }
  startPolling(ms = 60000) {
    const tick = () => { if (document.visibilityState === 'visible' && !this.pushing) this.pull(); };
    clearInterval(this.pullTimer);
    this.pullTimer = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', () => { this.pull(); this.schedulePush(100); });
  }
  handleError(e) {
    console.warn(e);
    if (e instanceof AuthError) this.setSync('auth', e.message);
    else this.setSync('offline', e.message || 'Offline');
  }

  // ---------- mutations ----------
  patch(kind, id, fields) {
    const cur = this.dirty[kind][id] || { id };
    this.dirty[kind][id] = { ...cur, ...fields, id, updatedAt: nowIso() };
    this.saveCache(); this.rebuild(); this.schedulePush();
  }
  add(kind, record) { this.patch(kind, record.id, { addedAt: nowIso(), ...record }); }
  get(kind, id) { return this.data[kind].find((r) => r.id === id); }
  setCurrentCity(id) {
    const d = this.dirty.settings || { cities: {} };
    this.dirty.settings = { ...d, currentCity: id, currentCityUpdatedAt: nowIso() };
    this.saveCache(); this.rebuild(); this.schedulePush();
  }
  patchCity(id, fields) {
    const d = this.dirty.settings || { cities: {} };
    const cities = { ...(d.cities || {}) };
    cities[id] = { ...(cities[id] || { id }), ...fields, id, updatedAt: nowIso() };
    this.dirty.settings = { ...d, cities };
    this.saveCache(); this.rebuild(); this.schedulePush();
  }
  appendProfile(line) {
    const d = this.dirty.profile || { appends: [] };
    this.dirty.profile = { ...d, appends: [...(d.appends || []), line] };
    this.saveCache(); this.rebuild(); this.schedulePush();
  }
  replaceProfile(text) {
    this.dirty.profile = { replace: text, appends: [] };
    this.saveCache(); this.rebuild(); this.schedulePush();
  }

  // ---------- push ----------
  schedulePush(ms = 1200) {
    if (!this.connected) return;
    this.setSync('pending');
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.push(), ms);
  }
  async push() {
    if (this.pushing) { this.schedulePush(800); return; }
    if (!this.connected || !this.hasDirty()) { this.setSync('saved'); return; }
    this.pushing = true; this.setSync('saving');
    try {
      const gh = this.gh();
      for (const [kind, path] of Object.entries(ARRAYS)) {
        const snap = { ...this.dirty[kind] };
        if (!Object.keys(snap).length) continue;
        await this.writeWithRetry(gh, path, (text) => JSON.stringify(applyPatches(parseJson(text, []), snap), null, 1) + '\n',
          `app: ${Object.keys(snap).length} change(s) to ${path}`);
        for (const id of Object.keys(snap)) if (this.dirty[kind][id] === snap[id]) delete this.dirty[kind][id];
      }
      if (this.dirty.settings) {
        const snap = this.dirty.settings;
        await this.writeWithRetry(gh, SETTINGS, (text) => JSON.stringify(applySettings(parseJson(text, {}), snap), null, 1) + '\n', 'app: settings');
        if (this.dirty.settings === snap) this.dirty.settings = null;
      }
      if (this.dirty.profile) {
        const snap = this.dirty.profile;
        await this.writeWithRetry(gh, PROFILE, (text) => applyProfile(text, snap), 'app: taste profile');
        const cur = this.dirty.profile;
        if (cur === snap) this.dirty.profile = null;
        else {
          // Keep only what was added while this save was in flight (appends are not idempotent).
          const appends = (cur.appends || []).slice((snap.appends || []).length);
          const replace = cur.replace === snap.replace ? null : cur.replace;
          this.dirty.profile = replace == null && !appends.length ? null : { replace, appends };
        }
      }
      this.saveCache(); this.rebuild();
      this.setSync(this.hasDirty() ? 'pending' : 'saved');
    } catch (e) {
      this.handleError(e);
      if (!(e instanceof AuthError)) { clearTimeout(this.pushTimer); this.pushTimer = setTimeout(() => this.push(), 30000); }
    } finally {
      this.pushing = false;
      if (this.hasDirty() && this.sync.state === 'pending') this.schedulePush(400);
    }
  }
  async writeWithRetry(gh, path, build, message) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { text, sha } = await gh.getFile(path);
      const next = build(text);
      try {
        const newSha = await gh.putFile(path, next, sha, message);
        this.files[path] = { text: next, sha: newSha };
        return;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        await sleep(600 + attempt * 700);
      }
    }
    throw new Error(`Could not save ${path} after several tries`);
  }
}

export const store = new Store();
