import { store, nowIso } from './store.js';

// ================= utils =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseD = (s) => new Date(`${s}T00:00:00`);
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
const fmtDay = (s, o = {}) => parseD(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...o });
const fmtShort = (s) => parseD(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
const rid = () => Math.random().toString(36).slice(2, 6);
const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ================= derived data =================
const D = () => store.data;
const collections = () => D().collections.filter((c) => !c.deleted).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
const colById = (id) => D().collections.find((c) => c.id === id && !c.deleted);
const emojiOf = (ev) => colById(ev.collectionId)?.emoji || '📍';
const cities = () => D().settings.cities.filter((c) => !c.deleted);
const currentCity = () => cities().find((c) => c.id === D().settings.currentCity) || cities()[0] || { id: 'london', name: 'London', lat: 51.5072, lng: -0.1276, zoom: 12 };
const upcomingSessions = (ev) => (ev.sessions || []).filter((s) => s.date >= todayStr()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
function isEnded(ev) {
  const t = todayStr();
  if (ev.endDate && ev.endDate < t) return true;
  if (ev.kind === 'event' && (ev.sessions || []).length && !upcomingSessions(ev).length && !(ev.endDate && ev.endDate >= t)) return true;
  return false;
}
const isLive = (ev) => ev.status === 'active' && !isEnded(ev);
const isArchived = (ev) => ev.status === 'disabled' || ev.status === 'dismissed' || (ev.status === 'active' && isEnded(ev));
const endKey = (ev) => ev.endDate || upcomingSessions(ev)[0]?.date || null;
const daysLeft = (ev) => (endKey(ev) ? daysBetween(todayStr(), endKey(ev)) : null);
const isSoon = (ev) => isLive(ev) && ev.kind !== 'place' && daysLeft(ev) != null && daysLeft(ev) <= 14;
const isNew = (ev) => ev.seen === false && isLive(ev);
function whenText(ev) {
  const t = todayStr();
  if (ev.kind === 'event') {
    const up = upcomingSessions(ev);
    if (up.length) return `${fmtDay(up[0].date)} · ${up[0].start}${up.length > 1 ? ` (+${up.length - 1} more)` : ''}`;
    if (ev.startDate) return ev.endDate && ev.endDate !== ev.startDate ? `${fmtShort(ev.startDate)} – ${fmtShort(ev.endDate)}` : fmtDay(ev.startDate);
    return 'Date to be confirmed';
  }
  if (ev.kind === 'exhibition' || ev.endDate) {
    if (ev.startDate && ev.startDate > t) return `Opens ${fmtShort(ev.startDate)}${ev.endDate ? ` · until ${fmtShort(ev.endDate)}` : ''}`;
    if (ev.endDate) {
      const n = daysBetween(t, ev.endDate);
      if (n < 0) return `Ended ${fmtShort(ev.endDate)}`;
      return `Until ${fmtShort(ev.endDate)} · ${n === 0 ? 'last day!' : n === 1 ? '1 day left' : `${n} days left`}`;
    }
    return 'Open now';
  }
  return ev.hours ? `Permanent · ${ev.hours}` : 'Permanent';
}

// ================= UI state =================
const ui = {
  tab: lsGet('su:tab', 'map'),
  filters: lsGet('su:filters', { cols: [], hideDone: false, newOnly: false }),
  list: lsGet('su:list', { q: '', sort: 'ending', seg: 'active', scope: 'city' }),
  calDate: todayStr(),
  openId: null,
  me: null,
};
const saveUi = () => { lsSet('su:tab', ui.tab); lsSet('su:filters', ui.filters); lsSet('su:list', { ...ui.list, q: '' }); };
function passesColFilter(ev) { return !ui.filters.cols.length || ui.filters.cols.includes(ev.collectionId); }

// ================= toast =================
let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('open'); action.fn(); };
  el.classList.add('open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('open'), action ? 5000 : 2600);
}

// ================= theme =================
const darkMq = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => { const t = lsGet('su:theme', 'auto'); return t === 'dark' || (t === 'auto' && darkMq.matches); };
function applyTheme() {
  const t = lsGet('su:theme', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = isDark() ? '#131614' : '#f1eee8';
  setTiles();
}
darkMq.addEventListener('change', applyTheme);

// ================= tabs =================
function setTab(tab) {
  ui.tab = tab; saveUi();
  for (const b of $$('.tabbar button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const v of $$('.view')) v.classList.toggle('hidden', v.id !== `view-${tab}`);
  if (tab === 'map') setTimeout(() => map && map.invalidateSize(), 0);
  render();
}

// ================= map =================
let map, tiles, cluster, markers = new Map(), meMarker = null, pickResolve = null;
function setTiles() {
  if (!map) return;
  document.documentElement.dataset.darkMap = isDark() ? '1' : '0';
  if (tiles) return;
  // OpenStreetMap tiles, toned down with CSS filters (see style.css) to keep the map calm.
  tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}
function pinIcon(ev) {
  const cls = ['pin', ev.done ? 'done' : '', isNew(ev) ? 'new' : '', (ev.score ?? 0) >= 8 ? 'big' : '', ui.openId === ev.id ? 'sel' : ''].join(' ');
  const s = (ev.score ?? 0) >= 8 ? 42 : 36;
  const tip = Math.round(s / 2 + s * 0.7071);
  return L.divIcon({ className: 'pin-wrap', html: `<div class="${cls}"><span>${emojiOf(ev)}</span></div>`, iconSize: [s, s], iconAnchor: [s / 2, tip], popupAnchor: [0, -tip] });
}
function initMap() {
  const c = currentCity();
  map = L.map('map', { zoomControl: true, attributionControl: true, tapHold: true }).setView([c.lat, c.lng], c.zoom || 12);
  map.zoomControl.setPosition('topleft');
  setTiles();
  cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 42, disableClusteringAtZoom: 15, spiderfyOnMaxZoom: true,
    iconCreateFunction: (cl) => {
      const ems = [...new Set(cl.getAllChildMarkers().map((m) => m.options.emoji))].slice(0, 3).join('');
      return L.divIcon({ className: 'pin-wrap', html: `<div class="cluster"><div>${cl.getChildCount()}<small>${ems}</small></div></div>`, iconSize: [40, 40] });
    },
  });
  map.addLayer(cluster);
  map.on('contextmenu', (e) => {
    if (pickResolve) return;
    const pop = L.popup().setLatLng(e.latlng).setContent(`<button class="btn primary sm" id="create-here">＋ Create Event here</button>`).openOn(map);
    setTimeout(() => { const b = $('#create-here'); if (b) b.onclick = () => { map.closePopup(pop); openEventForm(null, { lat: e.latlng.lat, lng: e.latlng.lng }); }; });
  });
}
function renderMap() {
  if (!map) return;
  const evs = D().events.filter((ev) => isLive(ev) && typeof ev.lat === 'number' && typeof ev.lng === 'number');
  const visible = evs.filter((ev) => passesColFilter(ev) && !(ui.filters.hideDone && ev.done) && !(ui.filters.newOnly && !isNew(ev)));
  const keep = new Set(visible.map((e) => e.id));
  for (const [id, m] of markers) if (!keep.has(id)) { cluster.removeLayer(m); markers.delete(id); }
  for (const ev of visible) {
    const key = [ev.lat, ev.lng, emojiOf(ev), ev.done, isNew(ev), ev.score, ui.openId === ev.id].join('|');
    const m = markers.get(ev.id);
    if (m && m.options.key === key) continue;
    if (m) { cluster.removeLayer(m); }
    const nm = L.marker([ev.lat, ev.lng], { icon: pinIcon(ev), emoji: emojiOf(ev), key, title: ev.title, riseOnHover: true });
    nm.on('click', () => openDetail(ev.id));
    cluster.addLayer(nm); markers.set(ev.id, nm);
  }
  const doneHidden = ui.filters.hideDone ? evs.filter((e) => e.done && passesColFilter(e)).length : 0;
  $('#map-count').textContent = `${visible.length} Event${visible.length === 1 ? '' : 's'}${doneHidden ? ` · ${doneHidden} done hidden` : ''}`;
  renderChips($('#map-chips'), true);
}
function renderChips(el, withToggles) {
  const live = D().events.filter(isLive);
  const counts = {};
  for (const e of live) counts[e.collectionId] = (counts[e.collectionId] || 0) + 1;
  const sel = ui.filters.cols;
  let h = '';
  if (withToggles) {
    h += `<button class="chip toggle" data-toggle="hideDone" aria-pressed="${ui.filters.hideDone}">✓ Hide done</button>`;
    const nNew = live.filter(isNew).length;
    if (nNew || ui.filters.newOnly) h += `<button class="chip toggle" data-toggle="newOnly" aria-pressed="${ui.filters.newOnly}">● New <span class="n">${nNew}</span></button>`;
  }
  h += `<button class="chip" data-col="" aria-pressed="${!sel.length}">All</button>`;
  for (const c of collections()) {
    if (!counts[c.id] && !sel.includes(c.id)) continue;
    h += `<button class="chip" data-col="${esc(c.id)}" aria-pressed="${sel.includes(c.id)}">${c.emoji} ${esc(c.name)} <span class="n">${counts[c.id] || 0}</span></button>`;
  }
  el.innerHTML = h;
}
function onChipClick(e) {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.dataset.toggle) ui.filters[b.dataset.toggle] = !ui.filters[b.dataset.toggle];
  else if (b.dataset.col === '') ui.filters.cols = [];
  else {
    const id = b.dataset.col, s = new Set(ui.filters.cols);
    s.has(id) ? s.delete(id) : s.add(id);
    ui.filters.cols = [...s];
  }
  saveUi(); render();
}
function locateMe(fly = true) {
  if (!navigator.geolocation) return toast('Location not available');
  navigator.geolocation.getCurrentPosition((p) => {
    ui.me = { lat: p.coords.latitude, lng: p.coords.longitude };
    if (map) {
      if (meMarker) meMarker.setLatLng([ui.me.lat, ui.me.lng]);
      else meMarker = L.marker([ui.me.lat, ui.me.lng], { icon: L.divIcon({ className: 'pin-wrap', html: '<div class="me-dot"></div>', iconSize: [16, 16] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
      if (fly) map.flyTo([ui.me.lat, ui.me.lng], Math.max(map.getZoom(), 14));
    }
    if (ui.tab === 'events') renderEvents();
  }, () => toast('Could not get your location'), { enableHighAccuracy: true, timeout: 10000 });
}
function pickOnMap(start) {
  return new Promise((resolve) => {
    setTab('map');
    if (start?.lat) map.setView([start.lat, start.lng], Math.max(map.getZoom(), 16));
    $('#crosshair').classList.remove('hidden'); $('#pickbar').classList.remove('hidden');
    pickResolve = (v) => { pickResolve = null; $('#crosshair').classList.add('hidden'); $('#pickbar').classList.add('hidden'); resolve(v); };
  });
}

// ================= images =================
const autoImg = lsGet('su:autoimg', {});
const failed = new Set();
const wikiQueue = []; let wikiBusy = 0;
function imagesOf(ev) {
  const list = (ev.images || []).map(safeUrl).filter(Boolean).filter((u) => !failed.has(u));
  if (!list.length && autoImg[ev.id]) list.push(autoImg[ev.id]);
  return list;
}
function needAuto(ev) { return !imagesOf(ev).length && !(ev.id in autoImg); }
function requestAuto(ev) {
  if (!needAuto(ev) || wikiQueue.some((e) => e.id === ev.id)) return;
  wikiQueue.push(ev); pumpWiki();
}
async function pumpWiki() {
  while (wikiBusy < 2 && wikiQueue.length) {
    const ev = wikiQueue.shift(); wikiBusy++;
    const q = ev.venue || ev.title; // the venue's photo is a more reliable fallback than a guess from the title
    fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=900&gsrsearch=${encodeURIComponent(q.trim())}`)
      .then((r) => r.json())
      .then((j) => {
        const pages = Object.values(j?.query?.pages || {}).sort((a, b) => a.index - b.index);
        autoImg[ev.id] = pages.find((p) => p.thumbnail)?.thumbnail.source || '';
      })
      .catch(() => {})
      .finally(() => {
        wikiBusy--; lsSet('su:autoimg', autoImg);
        if (autoImg[ev.id]) for (const el of $$(`[data-cover="${CSS.escape(ev.id)}"]`)) fillCover(el, ev);
        pumpWiki();
      });
  }
}
function fillCover(el, ev) {
  const url = imagesOf(ev)[0];
  if (url) {
    el.innerHTML = `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(url)}">`;
    el.querySelector('img').onerror = () => { failed.add(url); fillCover(el, ev); if (!imagesOf(ev).length) requestAuto(ev); };
  } else {
    el.innerHTML = `<div class="ph">${emojiOf(ev)}</div>`;
    requestAuto(ev);
  }
}

// ================= events list =================
function listPool() {
  const city = currentCity().id;
  return D().events.filter((e) => e.status !== 'deleted' && (ui.list.scope === 'all' || (e.city || city) === city));
}
const SEGS = [
  ['active', 'Active', (e) => isLive(e)],
  ['new', 'New', (e) => isNew(e)],
  ['soon', 'Ending soon', (e) => isSoon(e)],
  ['todo', 'To do', (e) => isLive(e) && !e.done],
  ['done', 'Done', (e) => e.done],
  ['archived', 'Archived', (e) => isArchived(e)],
];
function renderEvents() {
  const pool = listPool();
  $('#segs').innerHTML = SEGS.map(([id, label, f]) => `<button class="seg" data-seg="${id}" aria-pressed="${ui.list.seg === id}">${label} <span class="n">${pool.filter(f).length}</span></button>`).join('');
  renderChips($('#list-chips'), false);
  $('#sort').value = ui.list.sort; $('#scope').value = ui.list.scope;
  const segF = (SEGS.find((s) => s[0] === ui.list.seg) || SEGS[0])[2];
  const q = ui.list.q.trim().toLowerCase();
  let evs = pool.filter((e) => segF(e) && passesColFilter(e));
  if (q) {
    const words = q.split(/\s+/);
    evs = evs.filter((e) => {
      const hay = [e.title, e.venue, e.address, e.description, e.why, e.notes, (e.tags || []).join(' '), colById(e.collectionId)?.name, e.price].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  const origin = ui.me || currentCity().home || currentCity();
  const sorters = {
    ending: (a, b) => (endKey(a) || '9999').localeCompare(endKey(b) || '9999') || (b.score ?? -1) - (a.score ?? -1),
    added: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || (endKey(a) || '9999').localeCompare(endKey(b) || '9999'),
    near: (a, b) => (a.lat == null ? 1e9 : distKm(origin, a)) - (b.lat == null ? 1e9 : distKm(origin, b)),
    az: (a, b) => a.title.localeCompare(b.title),
  };
  evs.sort(sorters[ui.list.sort] || sorters.ending);
  const grid = $('#grid');
  if (!evs.length) {
    grid.innerHTML = `<div class="empty"><span class="big">🪨</span>${pool.length ? 'No Events match.' : 'No Events here yet. The daily search will turn some stones soon, or add one with ＋.'}</div>`;
    return;
  }
  grid.innerHTML = evs.map((e) => {
    const n = daysLeft(e);
    const badges = [isNew(e) && '<span class="badge new">new</span>', isSoon(e) && `<span class="badge soon">${n <= 0 ? 'last day' : `${n}d left`}</span>`,
      e.done && '<span class="badge done">done</span>', isArchived(e) && `<span class="badge off">${e.status === 'dismissed' ? 'not for me' : 'over'}</span>`].filter(Boolean).join('');
    const dist = ui.list.sort === 'near' && e.lat != null ? ` · ${distKm(origin, e).toFixed(1)} km` : '';
    return `<button class="card ${e.done ? 'done' : ''} ${isArchived(e) ? 'off' : ''}" data-id="${esc(e.id)}">
      <div class="cover"><div data-cover="${esc(e.id)}" style="position:absolute;inset:0"></div><div class="emo">${emojiOf(e)}</div><div class="badges">${badges}</div></div>
      <div class="card-body">
        <div class="card-title">${esc(e.title)}</div>
        <div class="meta">${esc(e.venue || '')}${dist}</div>
        <div class="meta ${isSoon(e) ? 'soon' : ''}">${esc(whenText(e))}</div>
        <div class="card-foot"><span>${esc(e.free ? 'Free' : e.price || '')}</span>${e.score != null ? `<span class="score-pill">${e.score}/10</span>` : ''}</div>
      </div></button>`;
  }).join('');
  for (const el of $$('[data-cover]', grid)) fillCover(el, D().events.find((x) => x.id === el.dataset.cover));
}

// ================= detail sheet =================
function openDetail(id) {
  ui.openId = id;
  const ev = store.get('events', id);
  if (ev && ev.seen === false) store.patch('events', id, { seen: true });
  renderDetail();
  $('#sheet').classList.add('open'); $('#scrim').classList.add('open');
  $('#sheet .sheet-scroll').scrollTop = 0;
  renderMap();
}
function closeDetail() {
  ui.openId = null;
  $('#sheet').classList.remove('open'); $('#scrim').classList.remove('open');
  renderMap();
}
function renderDetail() {
  const ev = ui.openId && store.get('events', ui.openId);
  if (!ev) return;
  if (document.activeElement?.id === 'd-notes') return; // don't wipe notes mid-typing
  const col = colById(ev.collectionId);
  const imgs = imagesOf(ev);
  const url = safeUrl(ev.url), book = safeUrl(ev.bookingUrl);
  const sessions = (ev.sessions || []).slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const inCal = D().calendar.filter((s) => !s.deleted && s.eventId === ev.id && s.date >= todayStr());
  const gmaps = ev.lat != null ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venue ? `${ev.venue}, ${ev.address || ''}` : `${ev.lat},${ev.lng}`)}` : null;
  const dir = ev.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lng}` : null;
  let statusNote = '';
  if (ev.status === 'disabled') statusNote = `No longer happening${ev.statusReason ? `: ${esc(ev.statusReason)}` : ''}. Hidden from the map.`;
  else if (ev.status === 'dismissed') statusNote = `Marked "not for me"${ev.statusReason ? `: ${esc(ev.statusReason)}` : ''}. The daily search learns from this.`;
  else if (isEnded(ev)) statusNote = 'This has ended. Hidden from the map.';
  $('#sheet .sheet-scroll').innerHTML = `
    <div class="gallery ${imgs.length > 1 ? 'multi' : ''}">${imgs.length ? imgs.map((u) => `<img alt="" referrerpolicy="no-referrer" src="${esc(u)}">`).join('') : `<div class="ph">${emojiOf(ev)}</div>`}</div>
    <div class="d-pad">
      <div class="d-head">
        <button class="d-emoji ${ev.done ? 'done' : ''}" id="d-col" title="Move to another collection">${emojiOf(ev)}</button>
        <div style="min-width:0">
          <h2 class="d-title">${esc(ev.title)}</h2>
          <div class="d-sub">${esc(col ? col.name : 'No collection')}${ev.venue ? ` · ${esc(ev.venue)}` : ''}${ev.adjacent ? ' · adjacent pick' : ''}</div>
        </div>
      </div>
      <div class="d-when ${isSoon(ev) ? 'meta soon' : ''}"><b>${esc(whenText(ev))}</b>${ev.free ? ' · Free' : ev.price ? ` · ${esc(ev.price)}` : ''}</div>
      ${statusNote ? `<div class="status-note">${statusNote}</div>` : ''}
      <div class="actions" style="grid-template-columns:repeat(${url ? 5 : 4},1fr)">
        <button class="act" id="d-cal"><span class="ai">📅</span>${inCal.length ? `In calendar` : 'Calendar'}</button>
        <button class="act ${ev.done ? 'on' : ''}" id="d-done"><span class="ai">✓</span>${ev.done ? 'Done!' : 'Mark done'}</button>
        <button class="act" id="d-map"><span class="ai">🗺️</span>On map</button>
        ${dir ? `<a class="act" href="${dir}" target="_blank" rel="noopener"><span class="ai">🧭</span>Directions</a>` : '<span></span>'}
        ${url ? `<a class="act" href="${esc(url)}" target="_blank" rel="noopener"><span class="ai">🔗</span>Website</a>` : ''}
      </div>
      ${inCal.length ? `<div class="help" style="margin-top:8px">Planned: ${inCal.map((s) => `${fmtDay(s.date)} ${s.start}`).join(', ')}</div>` : ''}
      <div class="sec"><h4>How interested are you?</h4>
        <div class="score" id="d-score">${Array.from({ length: 11 }, (_, i) => `<button data-s="${i}" class="${ev.score != null && i < ev.score ? 'lit' : ''} ${ev.score === i ? 'cur' : ''}">${i}</button>`).join('')}</div>
        <div class="score-hint"><span>meh</span><span>${ev.score == null ? 'not rated' : `${ev.score}/10 · tap again to clear`}</span><span>must go</span></div>
      </div>
      ${ev.why ? `<div class="sec"><h4>Why you might love it</h4><div class="why">${esc(ev.why)}</div></div>` : ''}
      ${ev.description ? `<div class="sec"><h4>About</h4><p class="desc">${esc(ev.description)}</p></div>` : ''}
      ${sessions.length ? `<div class="sec"><h4>Times</h4><div class="sessions">${sessions.map((s, i) => `<div class="session ${s.date < todayStr() ? 'past' : ''}"><span>${fmtDay(s.date)} · ${esc(s.start)}${s.end ? `–${esc(s.end)}` : ''}</span>${s.date >= todayStr() ? `<button class="btn sm" data-sess="${i}">＋ Calendar</button>` : ''}</div>`).join('')}</div></div>` : ''}
      <div class="sec"><h4>Details</h4><dl class="kv">
        ${ev.venue ? `<dt>Venue</dt><dd>${esc(ev.venue)}</dd>` : ''}
        ${ev.address ? `<dt>Address</dt><dd>${gmaps ? `<a href="${gmaps}" target="_blank" rel="noopener">${esc(ev.address)}</a>` : esc(ev.address)}</dd>` : ''}
        ${ev.hours ? `<dt>Hours</dt><dd>${esc(ev.hours)}</dd>` : ''}
        ${ev.startDate || ev.endDate ? `<dt>Dates</dt><dd>${ev.startDate ? fmtDay(ev.startDate, { year: 'numeric' }) : '…'} → ${ev.endDate ? fmtDay(ev.endDate, { year: 'numeric' }) : '…'}</dd>` : ''}
        ${ev.price || ev.free ? `<dt>Price</dt><dd>${ev.free ? 'Free' : ''}${ev.free && ev.price ? ' · ' : ''}${esc(ev.price || '')}</dd>` : ''}
        ${book ? `<dt>Booking</dt><dd><a href="${esc(book)}" target="_blank" rel="noopener">Book tickets</a></dd>` : ''}
        <dt>Added</dt><dd>${ev.addedAt ? fmtDay(ev.addedAt.slice(0, 10), { year: 'numeric' }) : '?'} · ${ev.source === 'discovery' ? 'daily search' : ev.source === 'manual' ? 'by you' : esc(ev.source || '')}</dd>
      </dl></div>
      ${(ev.tags || []).length ? `<div class="sec"><div class="tags">${ev.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : ''}
      <div class="sec"><h4>My notes</h4><textarea class="notes" id="d-notes" placeholder="Anything to remember…">${esc(ev.notes || '')}</textarea></div>
      <div class="d-foot">
        <button class="btn" id="d-edit">✎ Edit</button>
        ${ev.status === 'active' && !isEnded(ev) ? `<button class="btn" id="d-dismiss">Not for me</button><button class="btn" id="d-disable">No longer happening</button>` : `<button class="btn accent" id="d-restore">Restore</button>`}
        <button class="btn ghost danger" id="d-delete">Delete</button>
      </div>
    </div>`;
  const s = $('#sheet');
  for (const img of $$('.gallery img', s)) img.onerror = () => { failed.add(img.getAttribute('src')); img.remove(); };
  $('#d-col', s).onclick = () => pickCollection(ev.collectionId, (cid) => { store.patch('events', ev.id, { collectionId: cid }); toast(`Moved to ${colById(cid).emoji} ${colById(cid).name}`); });
  $('#d-cal', s).onclick = () => addToCalendar(ev);
  $('#d-done', s).onclick = () => { const done = !ev.done; store.patch('events', ev.id, { done, doneAt: done ? nowIso() : null }); toast(done ? 'Marked done ✓' : 'Unmarked'); };
  $('#d-map', s).onclick = () => showOnMap(ev);
  $('#d-score', s).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const v = +b.dataset.s; store.patch('events', ev.id, { score: ev.score === v ? null : v }); };
  for (const b of $$('[data-sess]', s)) b.onclick = () => addSessionSlot(ev, sessions[+b.dataset.sess]);
  $('#d-notes', s).onchange = (e) => store.patch('events', ev.id, { notes: e.target.value });
  $('#d-edit', s).onclick = () => openEventForm(ev);
  const dis = $('#d-dismiss', s); if (dis) dis.onclick = () => askReason('Not for me', 'What put you off? (optional, helps the search learn)', (r) => { store.patch('events', ev.id, { status: 'dismissed', statusReason: r || null }); toast('Dismissed', { label: 'Undo', fn: () => store.patch('events', ev.id, { status: 'active', statusReason: null }) }); });
  const dsb = $('#d-disable', s); if (dsb) dsb.onclick = () => askReason('No longer happening', 'What happened? (optional)', (r) => { store.patch('events', ev.id, { status: 'disabled', statusReason: r || 'Marked by Luke' }); toast('Removed from the map', { label: 'Undo', fn: () => store.patch('events', ev.id, { status: 'active', statusReason: null }) }); });
  const rs = $('#d-restore', s); if (rs) rs.onclick = () => { store.patch('events', ev.id, { status: 'active', statusReason: null }); if (isEnded(ev)) toast('Restored, but its end date has passed: edit the dates to bring it back to the map'); };
  $('#d-delete', s).onclick = () => confirmModal('Delete this Event?', 'It disappears everywhere. The daily search will remember it so it never comes back.', 'Delete', () => {
    store.patch('events', ev.id, { status: 'deleted' }); closeDetail(); toast('Deleted', { label: 'Undo', fn: () => store.patch('events', ev.id, { status: ev.status }) });
  });
}
function showOnMap(ev) {
  closeDetail(); setTab('map');
  if (ev.lat == null) return toast('This Event has no location yet');
  if (!isLive(ev)) toast('This Event is archived, so it has no pin');
  map.flyTo([ev.lat, ev.lng], Math.max(map.getZoom(), 16));
  setTimeout(() => openDetail(ev.id), 700);
}

// ================= modal =================
function openModal({ title, body, foot = '', onMount, wide }) {
  const m = $('#modal');
  m.innerHTML = `<header><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></header><div class="body">${body}</div>${foot ? `<footer>${foot}</footer>` : ''}`;
  m.style.width = wide ? 'min(720px, calc(100vw - 24px))' : '';
  m.classList.add('open'); $('#modal-scrim').classList.add('open');
  $('[data-close]', m).onclick = closeModal;
  onMount && onMount(m);
  return m;
}
function closeModal() { $('#modal').classList.remove('open'); $('#modal-scrim').classList.remove('open'); }
function confirmModal(title, text, okLabel, fn) {
  openModal({ title, body: `<p style="margin:0;color:var(--ink-2)">${esc(text)}</p>`, foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button>`,
    onMount: (m) => { $('[data-x]', m).onclick = closeModal; $('[data-ok]', m).onclick = () => { closeModal(); fn(); }; } });
}
function askReason(title, prompt, fn) {
  openModal({ title, body: `<label class="field"><span>${esc(prompt)}</span><textarea id="reason"></textarea></label>`, foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Save</button>`,
    onMount: (m) => { $('[data-x]', m).onclick = closeModal; $('[data-ok]', m).onclick = () => { const r = $('#reason', m).value.trim(); closeModal(); fn(r); }; } });
}
function pickCollection(current, fn) {
  openModal({ title: 'Move to collection', body: `<div class="pick-list">${collections().map((c) => `<button data-c="${esc(c.id)}" aria-pressed="${c.id === current}"><span style="font-size:20px">${c.emoji}</span>${esc(c.name)}</button>`).join('')}</div>
    <p class="help" style="margin-top:12px">Manage collections from the ☰ menu.</p>`,
    onMount: (m) => { for (const b of $$('[data-c]', m)) b.onclick = () => { closeModal(); fn(b.dataset.c); }; } });
}

// ================= calendar =================
const HOUR_PX = 56;
const daySlots = (date) => D().calendar.filter((s) => !s.deleted && s.date === date).sort((a, b) => a.start.localeCompare(b.start));
function slotWarning(s) {
  const ev = s.eventId && store.get('events', s.eventId);
  if (!ev) return '';
  if (ev.status === 'disabled' || ev.status === 'deleted') return 'This Event is no longer happening';
  if (ev.endDate && s.date > ev.endDate) return `Ends ${fmtDay(ev.endDate)}, before this day`;
  if (ev.startDate && s.date < ev.startDate && ev.kind !== 'place') return `Only opens ${fmtDay(ev.startDate)}`;
  return '';
}
function renderCalendar() {
  const sel = ui.calDate, t = todayStr();
  const d = parseD(sel), dow = (d.getDay() + 6) % 7;
  const monday = addDays(sel, -dow);
  $('#cal-title').textContent = parseD(sel).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  $('#week').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i), n = daySlots(day).length;
    return `<button class="day-btn ${day === t ? 'today' : ''}" data-day="${day}" aria-pressed="${day === sel}">
      <span class="dn">${parseD(day).toLocaleDateString('en-GB', { weekday: 'short' })}</span><span class="dd">${parseD(day).getDate()}</span>
      <span class="dots">${'<i></i>'.repeat(Math.min(n, 4))}</span></button>`;
  }).join('');
  const slots = daySlots(sel);
  $('#day-label').textContent = fmtDay(sel, { weekday: 'long', month: 'long' }) + (sel === t ? ' · today' : '');
  const first = Math.min(8, ...slots.map((s) => Math.floor(toMin(s.start) / 60)));
  const startH = Math.max(0, first), endH = 24;
  let h = '';
  for (let i = startH; i < endH; i++) h += `<div class="hour" data-h="${i}"><span>${pad(i)}:00</span></div>`;
  // overlap columns
  const placed = [];
  for (const s of slots) {
    const a = toMin(s.start), b = Math.max(a + 20, s.end ? toMin(s.end) : a + 60);
    let col = 0;
    while (placed.some((p) => p.col === col && p.a < b && a < p.b)) col++;
    placed.push({ s, a, b, col });
  }
  for (const p of placed) {
    const cols = Math.max(...placed.filter((q) => q.a < p.b && p.a < q.b).map((q) => q.col)) + 1;
    const ev = p.s.eventId && store.get('events', p.s.eventId);
    const warn = slotWarning(p.s);
    const top = (p.a - startH * 60) / 60 * HOUR_PX, height = Math.max(26, (p.b - p.a) / 60 * HOUR_PX - 2);
    h += `<button class="slot ${ev ? '' : 'free'} ${ev?.done ? 'done' : ''} ${warn ? 'warn' : ''}" data-slot="${esc(p.s.id)}" title="${esc(warn)}"
      style="top:${top}px;height:${height}px;left:calc(${(100 / cols) * p.col}% + 4px);width:calc(${100 / cols}% - 8px)">
      <b>${ev ? emojiOf(ev) + ' ' : ''}${esc(p.s.title || ev?.title || 'Untitled')}</b><small>${esc(p.s.start)}${p.s.end ? `–${esc(p.s.end)}` : ''}${warn ? ` · ⚠ ${esc(warn)}` : p.s.note ? ` · ${esc(p.s.note)}` : ''}${p.s.addedBy === 'claude' ? ' · ✦ Claude' : ''}</small></button>`;
  }
  if (sel === t) {
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    if (m >= startH * 60) h += `<div class="now-line" style="top:${(m - startH * 60) / 60 * HOUR_PX}px"></div>`;
  }
  const tl = $('#timeline');
  tl.innerHTML = h;
  tl.dataset.start = startH;
  const upcoming = D().calendar.filter((s) => !s.deleted && s.date >= t && s.date !== sel).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 12);
  $('#agenda').innerHTML = upcoming.length ? `<h4>Coming up</h4>${upcoming.map((s) => {
    const ev = s.eventId && store.get('events', s.eventId);
    return `<button class="agenda-item" data-goto="${s.date}"><span class="t">${fmtDay(s.date)}<br>${esc(s.start)}</span><span>${ev ? emojiOf(ev) + ' ' : ''}${esc(s.title || ev?.title || '')}</span></button>`;
  }).join('')}` : '';
}
function nextSaturday() { const t = todayStr(); const dow = parseD(t).getDay(); return addDays(t, dow === 6 ? 0 : (6 - dow + 7) % 7); }
function defaultDateFor(ev) {
  let d = ui.calDate >= todayStr() && ui.calDate !== todayStr() ? ui.calDate : nextSaturday();
  if (ev?.startDate && ev.startDate > d) d = ev.startDate;
  return d;
}
function addSessionSlot(ev, s) {
  const id = `cal-${s.date.replace(/-/g, '')}-${slug(ev.title)}-${rid()}`;
  const end = s.end || fromMin(Math.min(23 * 60 + 59, toMin(s.start) + 120));
  store.add('calendar', { id, date: s.date, start: s.start, end, eventId: ev.id, title: ev.title, note: '', addedBy: 'app' });
  toast(`Added to ${fmtDay(s.date)}, ${s.start}`, { label: 'View', fn: () => { closeDetail(); ui.calDate = s.date; setTab('calendar'); } });
}
function addToCalendar(ev) {
  const up = upcomingSessions(ev);
  if (up.length === 1) return addSessionSlot(ev, up[0]);
  if (up.length > 1) {
    return openModal({ title: 'Pick a time', body: `<div class="pick-list">${up.map((s, i) => `<button data-i="${i}">📅 ${fmtDay(s.date)} · ${esc(s.start)}${s.end ? `–${esc(s.end)}` : ''}</button>`).join('')}</div>`,
      foot: `<button class="btn ghost" data-other>Another time…</button>`,
      onMount: (m) => { for (const b of $$('[data-i]', m)) b.onclick = () => { closeModal(); addSessionSlot(ev, up[+b.dataset.i]); }; $('[data-other]', m).onclick = () => openSlotForm({ eventId: ev.id, date: defaultDateFor(ev), start: '11:00', end: '13:00', title: ev.title }); } });
  }
  openSlotForm({ eventId: ev.id, date: defaultDateFor(ev), start: '11:00', end: '13:00', title: ev.title });
}
function openSlotForm(slot) {
  const isNewSlot = !slot.id;
  const live = D().events.filter((e) => isLive(e) && (e.city || currentCity().id) === currentCity().id).sort((a, b) => a.title.localeCompare(b.title));
  const linked = slot.eventId && store.get('events', slot.eventId);
  if (linked && !live.includes(linked)) live.unshift(linked);
  const opts = `<option value="">— Free-form (no Event) —</option>` + collections().map((c) => {
    const evs = live.filter((e) => e.collectionId === c.id);
    return evs.length ? `<optgroup label="${c.emoji} ${esc(c.name)}">${evs.map((e) => `<option value="${esc(e.id)}" ${e.id === slot.eventId ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  openModal({
    title: isNewSlot ? 'Add to calendar' : 'Calendar slot',
    body: `<label class="field"><span>Event</span><select id="s-ev">${opts}</select></label>
      <label class="field"><span>Title</span><input id="s-title" value="${esc(slot.title || '')}" placeholder="e.g. Lunch on Edgware Road"></label>
      <div class="row"><label class="field"><span>Date</span><input type="date" id="s-date" value="${esc(slot.date)}"></label></div>
      <div class="row"><label class="field"><span>From</span><input type="time" id="s-start" value="${esc(slot.start || '11:00')}"></label><label class="field"><span>To</span><input type="time" id="s-end" value="${esc(slot.end || '')}"></label></div>
      <label class="field"><span>Note</span><input id="s-note" value="${esc(slot.note || '')}" placeholder="Book ahead, meet at…"></label>
      <p class="err-text" id="s-warn"></p>`,
    foot: `${isNewSlot ? '' : '<button class="btn ghost danger" data-del style="margin-right:auto">Remove</button>'}${slot.eventId && !isNewSlot ? '<button class="btn" data-open>Open Event</button>' : ''}<button class="btn primary" data-ok>${isNewSlot ? 'Add' : 'Save'}</button>`,
    onMount: (m) => {
      const evSel = $('#s-ev', m), title = $('#s-title', m), warn = $('#s-warn', m);
      const check = () => {
        const w = slotWarning({ eventId: evSel.value, date: $('#s-date', m).value });
        const ev = evSel.value && store.get('events', evSel.value);
        warn.textContent = w ? `⚠ ${w}` : ev?.hours ? `Hours: ${ev.hours}` : '';
        warn.style.color = w ? '' : 'var(--ink-3)';
      };
      evSel.onchange = () => { const ev = store.get('events', evSel.value); if (ev) title.value = ev.title; check(); };
      $('#s-date', m).onchange = check; check();
      $('[data-ok]', m).onclick = () => {
        const date = $('#s-date', m).value, start = $('#s-start', m).value;
        if (!date || !start) return (warn.textContent = 'Pick a date and start time');
        let end = $('#s-end', m).value;
        if (end && toMin(end) <= toMin(start)) end = fromMin(Math.min(23 * 60 + 59, toMin(start) + 60));
        const rec = { date, start, end: end || null, eventId: evSel.value || null, title: title.value.trim() || store.get('events', evSel.value)?.title || 'Untitled', note: $('#s-note', m).value.trim() };
        if (isNewSlot) store.add('calendar', { id: `cal-${date.replace(/-/g, '')}-${slug(rec.title)}-${rid()}`, addedBy: 'app', ...rec });
        else store.patch('calendar', slot.id, rec);
        closeModal();
        toast(isNewSlot ? `Added to ${fmtDay(date)}` : 'Saved', isNewSlot ? { label: 'View', fn: () => { closeDetail(); ui.calDate = date; setTab('calendar'); } } : null);
      };
      const del = $('[data-del]', m); if (del) del.onclick = () => { store.patch('calendar', slot.id, { deleted: true }); closeModal(); toast('Removed', { label: 'Undo', fn: () => store.patch('calendar', slot.id, { deleted: false }) }); };
      const op = $('[data-open]', m); if (op) op.onclick = () => { closeModal(); openDetail(slot.eventId); };
    },
  });
}
function dayRoute() {
  const stops = daySlots(ui.calDate).map((s) => s.eventId && store.get('events', s.eventId)).filter((e) => e && e.lat != null);
  if (!stops.length) return toast('No Events with a location on this day');
  const home = currentCity().home;
  const pt = (e) => `${e.lat},${e.lng}`;
  const dest = stops[stops.length - 1];
  const way = stops.slice(0, -1).map(pt).join('|');
  const url = `https://www.google.com/maps/dir/?api=1${home ? `&origin=${home.lat},${home.lng}` : ''}&destination=${pt(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}`;
  window.open(url, '_blank', 'noopener');
}
function exportIcs() {
  const slots = daySlots(ui.calDate);
  if (!slots.length) return toast('Nothing planned on this day');
  const icsEsc = (s) => String(s || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const dt = (date, time) => `${date.replace(/-/g, '')}T${(time || '00:00').replace(':', '')}00`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stones Unturned//EN'];
  for (const s of slots) {
    const ev = s.eventId && store.get('events', s.eventId);
    lines.push('BEGIN:VEVENT', `UID:${s.id}@stones-unturned`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${dt(s.date, s.start)}`, `DTEND:${dt(s.date, s.end || fromMin(toMin(s.start) + 60))}`, `SUMMARY:${icsEsc(s.title || ev?.title)}`);
    if (ev?.address || ev?.venue) lines.push(`LOCATION:${icsEsc([ev.venue, ev.address].filter(Boolean).join(', '))}`);
    const desc = [s.note, ev?.url].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${icsEsc(desc)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `stones-unturned-${ui.calDate}.ics`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function planWithClaude() {
  const prompt = `/plan-day ${fmtDay(ui.calDate, { weekday: 'long', month: 'long' })}`;
  openModal({ title: 'Plan with Claude', body: `
    <p style="margin-top:0;color:var(--ink-2)">Claude can see all your Events, scores and calendar. Ask it to plan this day and it will propose a route; once you agree, it writes the slots straight into this calendar (marked ✦ Claude).</p>
    <label class="field"><span>Say this to Claude</span><input id="pp" value="${esc(prompt)}" readonly></label>
    <ol style="color:var(--ink-2);font-size:14px;padding-left:18px">
      <li>On your computer: Claude app → <b>Code</b> tab → folder <b>stones_unturned/data</b>.</li>
      <li>On your phone: <a href="https://claude.ai/code" target="_blank" rel="noopener">claude.ai/code</a> → pick the <b>stones-unturned-data</b> repo.</li>
      <li>Add your mood, budget or who's coming, e.g. "chill, under £30, ending-soon stuff first".</li>
    </ol>`,
    foot: `<button class="btn primary" data-copy>Copy</button>`,
    onMount: (m) => { $('[data-copy]', m).onclick = () => { navigator.clipboard?.writeText(prompt).then(() => toast('Copied'), () => { $('#pp', m).select(); }); }; } });
}

// ================= event form =================
const EMOJIS = '🖼️ 🗿 💡 🎬 ⛪ 💎 🔭 🧩 ⌚ 🏺 🌿 🍜 🪙 ⛩️ 🎧 📚 ✨ 🎭 🎨 🏛️ 🪨 🍄 🕷️ 🐛 🦋 🌌 🔮 🃏 🎲 🎮 🕹️ 👾 🗡️ ⚔️ 🐉 🏯 🍵 🍣 🥟 ☕ 🍷 🍺 🧪 ⚗️ 🧬 🔬 📐 🧮 🗺️ 🧭 🚇 🌉 🏞️ 🌳 🌊 🕯️ 🪞 🧵 👔 💍 🛍️ 📦 🎟️ 🎤 🎻 🎹 🥁 🎪 🏟️ 🛶 🚲 📷 🖋️ 📜 🪐 ⭐'.split(' ');
function openEventForm(ev, preset = {}) {
  const isNewEv = !ev;
  const f = ev ? JSON.parse(JSON.stringify(ev)) : {
    title: '', collectionId: ui.filters.cols[0] || collections()[0]?.id, kind: 'place', venue: '', address: '', lat: null, lng: null,
    startDate: null, endDate: null, sessions: [], hours: '', price: '', free: false, url: '', bookingUrl: '', images: [], description: '', why: '', tags: [], ...preset,
  };
  const draw = () => openModal({
    title: isNewEv ? 'New Event' : 'Edit Event', wide: true,
    body: `
      <label class="field"><span>Name *</span><input id="f-title" value="${esc(f.title)}" placeholder="What is it?"></label>
      <div class="row">
        <label class="field"><span>Collection *</span><select id="f-col">${collections().map((c) => `<option value="${esc(c.id)}" ${c.id === f.collectionId ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="field"><span>Type</span><div class="seglike" id="f-kind">
        ${[['place', 'Place (permanent)'], ['exhibition', 'Runs between dates'], ['event', 'Specific times']].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${f.kind === k}">${l}</button>`).join('')}
      </div></div>
      <div class="row"><label class="field"><span>Venue</span><input id="f-venue" value="${esc(f.venue || '')}"></label></div>
      <label class="field"><span>Address</span><div class="row" style="flex:none"><input id="f-address" value="${esc(f.address || '')}" style="flex:3"><button type="button" class="btn sm" id="f-find" style="flex:none">Find</button><button type="button" class="btn sm" id="f-pick" style="flex:none">📍 Map</button></div></label>
      <div id="f-geo-results" class="pick-list" style="margin:-4px 0 10px"></div>
      <p class="help" id="f-geo" style="margin:-6px 0 12px">${f.lat != null ? `📍 Location set (${(+f.lat).toFixed(5)}, ${(+f.lng).toFixed(5)})` : 'No location yet: use Find or 📍 Map.'}</p>
      <div class="row" id="f-dates">
        <label class="field"><span>From</span><input type="date" id="f-start" value="${esc(f.startDate || '')}"></label>
        <label class="field"><span>Until (last day)</span><input type="date" id="f-end" value="${esc(f.endDate || '')}"></label>
      </div>
      <div id="f-sess" class="field"><span>Times</span><div id="f-sess-rows" class="sessions"></div><button type="button" class="btn sm" id="f-sess-add" style="margin-top:6px;align-self:flex-start">＋ Add a time</button></div>
      <div class="row"><label class="field"><span>Opening hours</span><input id="f-hours" value="${esc(f.hours || '')}" placeholder="Tue–Sun 10–18"></label><label class="field"><span>Price</span><input id="f-price" value="${esc(f.price || '')}" placeholder="£12"></label></div>
      <label class="checkline"><input type="checkbox" id="f-free" ${f.free ? 'checked' : ''}> Free</label>
      <div class="row"><label class="field"><span>Website</span><input id="f-url" value="${esc(f.url || '')}" placeholder="https://"></label><label class="field"><span>Booking link</span><input id="f-book" value="${esc(f.bookingUrl || '')}" placeholder="https://"></label></div>
      <label class="field"><span>Image links (one per line)</span><textarea id="f-imgs" placeholder="https://…jpg">${esc((f.images || []).join('\n'))}</textarea><span class="help">Leave empty and the app will try to find a picture on Wikipedia.</span></label>
      <label class="field"><span>About</span><textarea id="f-desc">${esc(f.description || '')}</textarea></label>
      <label class="field"><span>Why I'd like it</span><textarea id="f-why">${esc(f.why || '')}</textarea></label>
      <label class="field"><span>Tags (comma separated)</span><input id="f-tags" value="${esc((f.tags || []).join(', '))}" placeholder="sculpture, free, light"></label>
      <p class="err-text" id="f-err"></p>`,
    foot: `<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>${isNewEv ? 'Create Event' : 'Save'}</button>`,
    onMount: (m) => {
      const read = () => {
        f.title = $('#f-title', m).value.trim(); f.collectionId = $('#f-col', m).value; f.venue = $('#f-venue', m).value.trim(); f.address = $('#f-address', m).value.trim();
        f.startDate = $('#f-start', m).value || null; f.endDate = $('#f-end', m).value || null; f.hours = $('#f-hours', m).value.trim(); f.price = $('#f-price', m).value.trim();
        f.free = $('#f-free', m).checked; f.url = $('#f-url', m).value.trim(); f.bookingUrl = $('#f-book', m).value.trim();
        f.images = $('#f-imgs', m).value.split(/\s+/).map(safeUrl).filter(Boolean); f.description = $('#f-desc', m).value.trim(); f.why = $('#f-why', m).value.trim();
        f.tags = $('#f-tags', m).value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        f.sessions = $$('.sess-row', m).map((r) => ({ date: $('[data-d]', r).value, start: $('[data-s]', r).value, end: $('[data-e]', r).value || null })).filter((s) => s.date && s.start);
      };
      const showKind = () => {
        for (const b of $$('#f-kind button', m)) b.setAttribute('aria-pressed', String(b.dataset.k === f.kind));
        $('#f-dates', m).classList.toggle('hidden', f.kind === 'place');
        $('#f-sess', m).classList.toggle('hidden', f.kind !== 'event');
      };
      const drawSess = () => {
        $('#f-sess-rows', m).innerHTML = (f.sessions || []).map((s) => `<div class="row sess-row"><input type="date" data-d value="${esc(s.date)}"><input type="time" data-s value="${esc(s.start)}"><input type="time" data-e value="${esc(s.end || '')}"><button type="button" class="btn sm ghost" data-rm style="flex:none">✕</button></div>`).join('');
        for (const b of $$('[data-rm]', m)) b.onclick = () => { b.closest('.sess-row').remove(); };
      };
      showKind(); drawSess();
      $('#f-kind', m).onclick = (e) => { const b = e.target.closest('button'); if (b) { f.kind = b.dataset.k; showKind(); } };
      $('#f-sess-add', m).onclick = () => { read(); f.sessions.push({ date: f.startDate || defaultDateFor(null), start: '19:00', end: null }); drawSess(); };
      $('#f-find', m).onclick = async () => {
        read();
        const q = [f.venue, f.address].filter(Boolean).join(', ') || f.title;
        if (!q) return ($('#f-geo', m).textContent = 'Type a venue or address first');
        $('#f-geo', m).textContent = 'Searching…';
        const res = await geocode(q);
        if (!res.length) { $('#f-geo', m).textContent = 'Nothing found. Try a simpler address, or use 📍 Map.'; return; }
        $('#f-geo', m).textContent = 'Pick the right one:';
        $('#f-geo-results', m).innerHTML = res.map((r, i) => `<button type="button" data-g="${i}">📍 <span style="font-size:13px">${esc(r.display_name)}</span></button>`).join('');
        for (const b of $$('[data-g]', m)) b.onclick = () => {
          const r = res[+b.dataset.g]; f.lat = +r.lat; f.lng = +r.lon;
          if (!f.address) $('#f-address', m).value = r.display_name.split(',').slice(0, 4).join(',');
          $('#f-geo-results', m).innerHTML = ''; $('#f-geo', m).textContent = `📍 Location set (${f.lat.toFixed(5)}, ${f.lng.toFixed(5)})`;
        };
      };
      $('#f-pick', m).onclick = async () => {
        read(); closeModal(); closeDetail();
        const c = await pickOnMap(f.lat != null ? f : null);
        if (c) { f.lat = c.lat; f.lng = c.lng; }
        draw();
      };
      $('[data-x]', m).onclick = closeModal;
      $('[data-ok]', m).onclick = async () => {
        read();
        const err = $('#f-err', m);
        if (!f.title) return (err.textContent = 'Give it a name');
        if (!f.collectionId) return (err.textContent = 'Pick a collection');
        if (f.lat == null && (f.address || f.venue)) {
          err.textContent = 'Finding the address…';
          const r = (await geocode([f.venue, f.address].filter(Boolean).join(', ')))[0];
          if (r) { f.lat = +r.lat; f.lng = +r.lon; }
        }
        if (f.lat == null) return (err.textContent = 'It needs a location: use Find or 📍 Map');
        if (f.kind === 'place') { f.startDate = null; f.endDate = null; }
        if (f.kind !== 'event') f.sessions = [];
        if (f.kind === 'event' && !f.sessions.length && !f.startDate) return (err.textContent = 'Add at least one time, or a date');
        const fields = { title: f.title, collectionId: f.collectionId, kind: f.kind, venue: f.venue || null, address: f.address || null, lat: f.lat, lng: f.lng,
          startDate: f.startDate, endDate: f.endDate, sessions: f.sessions, hours: f.hours || null, price: f.price || null, free: f.free, url: safeUrl(f.url), bookingUrl: safeUrl(f.bookingUrl),
          images: f.images, description: f.description, why: f.why, tags: f.tags };
        if (isNewEv) {
          const id = `ev-${todayStr().replace(/-/g, '')}-${slug(f.title)}-${rid()}`;
          store.add('events', { id, ...fields, city: currentCity().id, source: 'manual', adjacent: false, status: 'active', statusReason: null, done: false, doneAt: null, score: null, seen: true, notes: '' });
          closeModal(); toast('Event created'); openDetail(id);
        } else {
          store.patch('events', ev.id, fields); delete autoImg[ev.id]; closeModal(); toast('Saved');
        }
      };
    },
  });
  draw();
}
async function geocode(q) {
  const c = currentCity();
  const vb = `${c.lng - 0.6},${c.lat + 0.35},${c.lng + 0.6},${c.lat - 0.35}`;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&viewbox=${vb}&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
    return await r.json();
  } catch { return []; }
}

// ================= menu & settings =================
function openMenu() {
  const st = D().status, c = currentCity();
  const sync = store.sync;
  openModal({
    title: 'Stones Unturned', body: `
      <div class="menu-sec"><h4>City</h4>
        <div class="pick-list">${cities().map((x) => `<button data-city="${esc(x.id)}" aria-pressed="${x.id === c.id}">📍 ${esc(x.name)}${x.country ? `<span class="help" style="margin:0 0 0 auto">${esc(x.country)}</span>` : ''}</button>`).join('')}</div>
        <div class="menu-row"><button class="btn sm" id="m-addcity">＋ Add a city</button><button class="btn sm" id="m-home">🏠 Set home base to map centre</button></div>
        <p class="help">The daily search looks in the selected city. Events in other cities are kept.${c.home ? ` Home base: ${esc(c.home.label || 'set')}.` : ''}</p>
      </div>
      <div class="menu-sec"><h4>Taste profile</h4>
        <div class="row"><select id="m-ptype" class="select" style="flex:none;width:112px"><option>Love</option><option selected>Like</option><option>Curious about</option><option>Dislike</option><option>Note</option></select><input id="m-ptext" class="search" placeholder="e.g. Japanese woodblock prints"></div>
        <div class="menu-row"><button class="btn sm accent" id="m-padd">Add to profile</button><button class="btn sm" id="m-pview">View / edit full profile</button></div>
        <p class="help">The daily search reads the latest version every morning.</p>
      </div>
      <div class="menu-sec"><h4>Daily search</h4>
        <div class="menu-row"><div class="grow">${st?.lastRun ? `Last run ${fmtDay(st.lastRun.slice(0, 10))}, ${new Date(st.lastRun).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${esc(cities().find((x) => x.id === st.city)?.name || st.city || '')} · +${st.added || 0} new, ${st.disabled || 0} retired<div class="sub">${esc(st.summary || '')}</div>` : 'Hasn\'t run yet. It runs every morning on Claude\'s cloud.'}</div></div>
      </div>
      <div class="menu-sec"><h4>Organise</h4>
        <div class="menu-row"><button class="btn sm" id="m-cols">Manage collections</button><button class="btn sm" id="m-new">＋ New Event</button><button class="btn sm" id="m-claude">✦ Plan with Claude</button></div>
      </div>
      <div class="menu-sec"><h4>App</h4>
        <div class="menu-row"><span class="grow">Theme</span><div class="seglike" id="m-theme" style="flex:none">${['auto', 'light', 'dark'].map((t) => `<button data-t="${t}" aria-pressed="${lsGet('su:theme', 'auto') === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <div class="menu-row"><div class="grow">Sync: ${esc(syncLabel())}<div class="sub">${esc(store.cfg ? `${store.cfg.owner}/${store.cfg.repo}` : '')}${sync.lastPull ? ` · checked ${new Date(sync.lastPull).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</div></div><button class="btn sm" id="m-sync">Sync now</button></div>
        <div class="menu-row"><button class="btn sm" id="m-backup">Download backup</button><button class="btn sm ghost danger" id="m-disc">Disconnect this device</button></div>
      </div>`,
    onMount: (m) => {
      for (const b of $$('[data-city]', m)) b.onclick = () => { store.setCurrentCity(b.dataset.city); closeModal(); flyToCity(); toast(`Now exploring ${currentCity().name}`); };
      $('#m-addcity', m).onclick = addCity;
      $('#m-home', m).onclick = () => { const ctr = map.getCenter(); store.patchCity(c.id, { home: { label: 'Home', lat: ctr.lat, lng: ctr.lng } }); toast('Home base set'); closeModal(); };
      $('#m-padd', m).onclick = () => {
        const t = $('#m-ptext', m).value.trim(); if (!t) return;
        store.appendProfile(`- **${$('#m-ptype', m).value}** (${todayStr()}): ${t.replace(/\n/g, ' ')}`);
        $('#m-ptext', m).value = ''; toast('Added to your taste profile');
      };
      $('#m-ptext', m).onkeydown = (e) => { if (e.key === 'Enter') $('#m-padd', m).click(); };
      $('#m-pview', m).onclick = openProfile;
      $('#m-cols', m).onclick = manageCollections;
      $('#m-new', m).onclick = () => { closeModal(); openEventForm(null); };
      $('#m-claude', m).onclick = planWithClaude;
      $('#m-theme', m).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; lsSet('su:theme', b.dataset.t); applyTheme(); for (const x of $$('#m-theme button', m)) x.setAttribute('aria-pressed', String(x === b)); };
      $('#m-sync', m).onclick = async () => { await store.pull(true); store.schedulePush(10); toast('Synced'); closeModal(); };
      $('#m-backup', m).onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(D(), null, 1)], { type: 'application/json' }));
        a.download = `stones-unturned-backup-${todayStr()}.json`; a.click();
      };
      $('#m-disc', m).onclick = () => confirmModal('Disconnect this device?', 'Removes the token and cached data from this browser only. Your data stays safe on GitHub.', 'Disconnect', () => store.disconnect());
    },
  });
}
function flyToCity() { const c = currentCity(); if (map) map.flyTo([c.lat, c.lng], c.zoom || 12); }
function addCity() {
  openModal({ title: 'Add a city', body: `<div class="row"><input id="c-q" class="search" placeholder="e.g. Tokyo, Paris, São Paulo"><button class="btn" id="c-go" style="flex:none">Search</button></div><div id="c-res" class="pick-list" style="margin-top:10px"></div>`,
    onMount: (m) => {
      const go = async () => {
        const q = $('#c-q', m).value.trim(); if (!q) return;
        $('#c-res', m).innerHTML = '<p class="help">Searching…</p>';
        let res = [];
        try { res = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&featuretype=city&addressdetails=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } })).json(); } catch {}
        if (!res.length) { $('#c-res', m).innerHTML = '<p class="help">No city found.</p>'; return; }
        $('#c-res', m).innerHTML = res.map((r, i) => `<button data-i="${i}">📍 ${esc(r.display_name)}</button>`).join('');
        for (const b of $$('[data-i]', m)) b.onclick = () => {
          const r = res[+b.dataset.i];
          const name = r.address?.city || r.address?.town || r.name || q;
          const id = slug(name) || `city-${rid()}`;
          store.patchCity(id, { name, country: r.address?.country || '', lat: +r.lat, lng: +r.lon, zoom: 12 });
          store.setCurrentCity(id); closeModal(); flyToCity(); toast(`Now exploring ${name}. The daily search will look here from tomorrow.`);
        };
      };
      $('#c-go', m).onclick = go; $('#c-q', m).onkeydown = (e) => { if (e.key === 'Enter') go(); };
      setTimeout(() => $('#c-q', m).focus(), 50);
    } });
}
function mdToHtml(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  let out = '', inList = false;
  for (const line of md.split('\n')) {
    const h = line.match(/^(#{1,3})\s+(.*)/), li = line.match(/^\s*[-*]\s+(.*)/);
    if (!li && inList) { out += '</ul>'; inList = false; }
    if (h) out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    else if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(li[1])}</li>`; }
    else if (line.trim() === '---') out += '<hr style="border:0;border-top:1px solid var(--line)">';
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  return out + (inList ? '</ul>' : '');
}
function openProfile() {
  openModal({ title: 'Taste profile', wide: true, body: `<div class="profile-md" id="p-view">${mdToHtml(D().profile || '')}</div><textarea id="p-edit" class="notes hidden" style="min-height:55vh;font-family:ui-monospace,monospace;font-size:13px">${esc(D().profile || '')}</textarea>`,
    foot: `<button class="btn" id="p-toggle">Edit text</button><button class="btn primary hidden" id="p-save">Save</button>`,
    onMount: (m) => {
      $('#p-view', m).scrollTop = 1e6;
      $('#p-toggle', m).onclick = () => { $('#p-view', m).classList.toggle('hidden'); $('#p-edit', m).classList.toggle('hidden'); $('#p-save', m).classList.toggle('hidden'); };
      $('#p-save', m).onclick = () => { store.replaceProfile($('#p-edit', m).value); closeModal(); toast('Profile saved'); };
    } });
}
function manageCollections() {
  const counts = {};
  for (const e of D().events) if (e.status !== 'deleted') counts[e.collectionId] = (counts[e.collectionId] || 0) + 1;
  openModal({ title: 'Collections', body: `<div class="pick-list" id="cl">${collections().map((c, i) => `
      <div class="menu-row" style="border:1px solid var(--line);border-radius:10px;padding:6px 8px">
        <button class="icon-btn" data-emo="${esc(c.id)}" style="font-size:20px">${c.emoji}</button>
        <input class="search" data-name="${esc(c.id)}" value="${esc(c.name)}" style="padding:7px 9px">
        <span class="help" style="margin:0;flex:none">${counts[c.id] || 0}</span>
        <button class="btn sm ghost" data-up="${i}" ${i ? '' : 'disabled'} title="Move up">↑</button>
        <button class="btn sm ghost danger" data-del="${esc(c.id)}" title="Delete">✕</button>
      </div>`).join('')}</div>`,
    foot: `<button class="btn" id="cl-add" style="margin-right:auto">＋ New collection</button><button class="btn primary" data-x>Done</button>`,
    onMount: (m) => {
      $('[data-x]', m).onclick = closeModal;
      for (const inp of $$('[data-name]', m)) inp.onchange = () => inp.value.trim() && store.patch('collections', inp.dataset.name, { name: inp.value.trim() });
      for (const b of $$('[data-emo]', m)) b.onclick = () => pickEmoji(colById(b.dataset.emo).emoji, (e) => { store.patch('collections', b.dataset.emo, { emoji: e }); manageCollections(); }, manageCollections);
      for (const b of $$('[data-up]', m)) b.onclick = () => {
        const list = collections(), i = +b.dataset.up;
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        list.forEach((c, k) => { if (c.order !== k) store.patch('collections', c.id, { order: k }); });
        manageCollections();
      };
      for (const b of $$('[data-del]', m)) b.onclick = () => deleteCollection(b.dataset.del, counts[b.dataset.del] || 0);
      $('#cl-add', m).onclick = () => pickEmoji('✨', (e) => {
        const name = prompt('Name of the new collection?'); if (!name) return manageCollections();
        store.add('collections', { id: `${slug(name)}-${rid()}`, name: name.trim(), emoji: e, order: collections().length });
        manageCollections();
      }, manageCollections);
    } });
}
function deleteCollection(id, n) {
  const c = colById(id), others = collections().filter((x) => x.id !== id);
  openModal({ title: `Delete ${c.emoji} ${c.name}?`, body: n ? `<label class="field"><span>Move its ${n} Event${n === 1 ? '' : 's'} to</span><select id="dc-to">${others.map((o) => `<option value="${esc(o.id)}">${o.emoji} ${esc(o.name)}</option>`).join('')}</select></label>` : '<p>It has no Events.</p>',
    foot: `<button class="btn ghost" data-back>Back</button><button class="btn primary" data-ok>Delete</button>`,
    onMount: (m) => {
      $('[data-back]', m).onclick = manageCollections;
      $('[data-ok]', m).onclick = () => {
        const to = n ? $('#dc-to', m).value : null;
        if (to) for (const e of D().events.filter((e) => e.collectionId === id)) store.patch('events', e.id, { collectionId: to });
        store.patch('collections', id, { deleted: true });
        ui.filters.cols = ui.filters.cols.filter((x) => x !== id); saveUi();
        manageCollections();
      };
    } });
}
function pickEmoji(current, fn, back) {
  openModal({ title: 'Pick an emoji', body: `<div class="emoji-grid">${EMOJIS.map((e) => `<button data-e="${e}" aria-pressed="${e === current}">${e}</button>`).join('')}</div>
    <label class="field" style="margin-top:12px"><span>Or type any emoji</span><input id="pe" maxlength="8" placeholder="🙂"></label>`,
    foot: `<button class="btn ghost" data-back>Back</button><button class="btn primary" data-ok>Use typed emoji</button>`,
    onMount: (m) => {
      for (const b of $$('[data-e]', m)) b.onclick = () => fn(b.dataset.e);
      $('[data-back]', m).onclick = back;
      $('[data-ok]', m).onclick = () => { const v = $('#pe', m).value.trim(); if (v) fn(v); };
    } });
}

// ================= onboarding =================
function showOnboarding(errMsg = '') {
  const params = new URLSearchParams(location.search);
  const el = $('#onboard');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="inner">
    <h1>Stones Unturned</h1>
    <p class="lede">A map of things you'd love, found for you every morning.</p>
    <p style="font-size:14px;color:var(--ink-2)">Connect this device to your private data repo once. You'll need a GitHub token:</p>
    <ol>
      <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → new fine-grained token</a>.</li>
      <li>Name it "Stones Unturned", set the longest expiry you're comfortable with.</li>
      <li>Repository access → <b>Only select repositories</b> → <b>stones-unturned-data</b>.</li>
      <li>Permissions → Repository → <b>Contents: Read and write</b>.</li>
      <li>Generate, copy, paste below. It stays on this device only.</li>
    </ol>
    <label class="field"><span>Data repo</span><input id="ob-repo" value="${esc(params.get('repo') || 'testas-design/stones-unturned-data')}"></label>
    <label class="field"><span>Token</span><input id="ob-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
    <p class="err-text" id="ob-err">${esc(errMsg)}</p>
    <button class="btn primary" id="ob-go" style="width:100%;padding:12px">Connect</button>
  </div>`;
  $('#ob-go').onclick = async () => {
    const [owner, repo] = $('#ob-repo').value.trim().split('/');
    const token = $('#ob-token').value.trim();
    if (!owner || !repo || !token) return ($('#ob-err').textContent = 'Fill in both fields');
    $('#ob-go').disabled = true; $('#ob-err').textContent = 'Connecting…';
    try {
      const cfg = { owner, repo, token, branch: 'main' };
      if (params.get('api')) cfg.apiBase = params.get('api');
      await store.connect(cfg);
      el.classList.add('hidden'); boot();
    } catch (e) {
      $('#ob-err').textContent = e.message || 'Could not connect'; $('#ob-go').disabled = false;
    }
  };
}

// ================= render & boot =================
function syncLabel() {
  const s = store.sync.state;
  return { saved: 'Saved', saving: 'Saving…', pending: 'Saving…', offline: 'Offline · will sync', auth: 'Reconnect needed', idle: '' }[s] || '';
}
function renderSync() {
  const el = $('#sync');
  el.textContent = syncLabel();
  el.classList.toggle('err', ['offline', 'auth'].includes(store.sync.state));
  if (store.sync.state === 'auth') toast(store.sync.message || 'GitHub token problem', { label: 'Fix', fn: () => showOnboarding(store.sync.message) });
}
function render() {
  $('#city-name').textContent = currentCity().name;
  if (ui.tab === 'map') renderMap();
  if (ui.tab === 'events') renderEvents();
  if (ui.tab === 'calendar') renderCalendar();
  if (ui.openId) renderDetail();
}
let booted = false;
function boot() {
  if (booted) return; booted = true;
  initMap();
  applyTheme();
  setTab(ui.tab);
  store.addEventListener('change', render);
  store.addEventListener('sync', renderSync);
  store.pull();
  store.startPolling(60000);
  // one-time wiring
  for (const b of $$('.tabbar button')) b.onclick = () => setTab(b.dataset.tab);
  $('#map-chips').onclick = onChipClick; $('#list-chips').onclick = onChipClick;
  $('#segs').onclick = (e) => { const b = e.target.closest('.seg'); if (b) { ui.list.seg = b.dataset.seg; saveUi(); renderEvents(); } };
  $('#q').oninput = (e) => { ui.list.q = e.target.value; renderEvents(); };
  $('#sort').onchange = (e) => { ui.list.sort = e.target.value; saveUi(); if (e.target.value === 'near' && !ui.me) locateMe(false); renderEvents(); };
  $('#scope').onchange = (e) => { ui.list.scope = e.target.value; saveUi(); renderEvents(); };
  $('#grid').onclick = (e) => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); };
  $('#scrim').onclick = closeDetail; $('#sheet .close').onclick = closeDetail;
  $('#modal-scrim').onclick = closeModal;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#modal').classList.contains('open')) closeModal(); else closeDetail(); } });
  $('#menu-btn').onclick = openMenu; $('#sync').onclick = openMenu; $('#city-btn').onclick = openMenu;
  $('#fab-add').onclick = () => openEventForm(null);
  $('#list-add').onclick = () => openEventForm(null);
  $('#fab-locate').onclick = () => locateMe(true);
  $('#fab-city').onclick = flyToCity;
  $('#pick-ok').onclick = () => pickResolve && pickResolve(map.getCenter());
  $('#pick-cancel').onclick = () => pickResolve && pickResolve(null);
  $('#week').onclick = (e) => { const b = e.target.closest('[data-day]'); if (b) { ui.calDate = b.dataset.day; renderCalendar(); } };
  $('#cal-prev').onclick = () => { ui.calDate = addDays(ui.calDate, -7); renderCalendar(); };
  $('#cal-next').onclick = () => { ui.calDate = addDays(ui.calDate, 7); renderCalendar(); };
  $('#cal-today').onclick = () => { ui.calDate = todayStr(); renderCalendar(); };
  $('#cal-add').onclick = () => openSlotForm({ date: ui.calDate, start: '11:00', end: '13:00' });
  $('#cal-route').onclick = dayRoute; $('#cal-ics').onclick = exportIcs; $('#cal-claude').onclick = planWithClaude;
  $('#agenda').onclick = (e) => { const b = e.target.closest('[data-goto]'); if (b) { ui.calDate = b.dataset.goto; renderCalendar(); $('#view-calendar').scrollTop = 0; } };
  $('#timeline').onclick = (e) => {
    const s = e.target.closest('[data-slot]');
    if (s) return openSlotForm(D().calendar.find((x) => x.id === s.dataset.slot));
    const rect = $('#timeline').getBoundingClientRect();
    const mins = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30 + (+$('#timeline').dataset.start) * 60;
    openSlotForm({ date: ui.calDate, start: fromMin(mins), end: fromMin(Math.min(23 * 60 + 59, mins + 120)) });
  };
  // Handy for Claude/debugging in the console.
  window.su = { store, ui };
}

if (store.connected) boot(); else showOnboarding();
