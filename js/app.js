// Fediv — web app. Carte des faits divers de France, racontés comme dans un vieux journal.

import { RUBRICS, RUBRIC_BY_ID, MAP_COLORS, ERAS, eraContains, ARIA_RUBRICS } from './rubrics.js?v=9';
import {
  loadLocal, loadHistory, loadARIA, loadAriaDetail, fetchWikidataEvents, fetchWikidataLocatedEvents, fetchCatNat,
  fetchWikipediaSummary, communeAt, crimeRows, CRIME_RESOURCES, MONTHS,
} from './sources.js?v=9';
import { settings, carnet, playSound } from './store.js?v=9';

// ───────────────────────── Outils ─────────────────────────

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n);

/** Distance approchée en mètres (équirectangulaire, suffisante à l'échelle d'une ville). */
function distance(aLat, aLon, bLat, bLon) {
  const x = (bLon - aLon) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const y = bLat - aLat;
  return Math.sqrt(x * x + y * y) * 111320;
}
const distanceLabel = m => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${fmt(m / 1000)} km`);

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ───────────────────────── État ─────────────────────────

const state = {
  facts: new Map(),
  // Au lancement, seule l'Histoire est affichée pour ne pas surcharger la carte.
  hidden: new Set(RUBRICS.filter(r => r.id !== 'history').map(r => r.id)),
  era: ERAS[0],
  loading: new Set(),
  aria: 'idle',
  me: null,
  meMarker: null,
  walkWatch: null,
  announced: new Set(),
  circuit: null,
  catnatCells: new Set(),
  selected: null,
};

function addFacts(list) {
  let added = 0;
  for (const f of list) {
    if (state.facts.has(f.id)) continue;
    // Une affaire placée à la commune ne double pas un événement déjà géolocalisé.
    if (f.id.startsWith('wdl-') && state.facts.has('wd-' + f.id.slice(4))) continue;
    state.facts.set(f.id, f);
    added++;
  }
  if (added) refresh();
  return added;
}

/** « Histoire » montre les grands faits historiques sourcés (Wikipédia), quel que soit leur type ;
 *  les autres rubriques ajoutent tous les récits de leur type (Wikidata, ARIA, Géorisques). */
const isVisible = f => eraContains(state.era, f.year)
  && (!state.hidden.has(f.rubric) || (f.curated && !state.hidden.has('history')));
const visibleFacts = () => [...state.facts.values()].filter(isVisible);

// ───────────────────────── Thème ─────────────────────────

// Style « Dossier de police » : version jour (kraft) en mode clair, version nuit en mode sombre.
const STYLES = {
  jour: { dark: false, map: { bg: '#c9b48a', saturation: -0.9, opacity: 0.7, brightness: 1, contrast: 0.12 },
          stroke: '#ffffff', cluster: ['#14181f', '#f5c518', '#f5c518'], theme: '#d6bf93' },
  nuit: { dark: true, map: { bg: '#071427', saturation: -1, opacity: 0.45, brightness: 0.85, contrast: 0.25 },
          stroke: '#ffffff', cluster: ['#f5c518', '#14181f', '#14181f'], theme: '#0b1320' },
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const currentStyle = () => (settings.appearance === 'dark' || (settings.appearance === 'auto' && darkQuery.matches) ? 'nuit' : 'jour');
const isDark = () => STYLES[currentStyle()].dark;

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = isDark() ? 'dark' : 'light';
  root.dataset.style = currentStyle();
  root.dataset.reading = settings.readingSize;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', STYLES[currentStyle()].theme);
  if (map?.isStyleLoaded()) styleMap();
}
darkQuery.addEventListener('change', applyTheme);

// ───────────────────────── Carte ─────────────────────────

const IGN = layer => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png`;

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      ign: { type: 'raster', tiles: [IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2')], tileSize: 256, maxzoom: 19,
             attribution: '<a href="https://geoservices.ign.fr/" target="_blank" rel="noopener">© IGN – Géoplateforme</a>' },
    },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': '#e8dcc0' } },
      { id: 'ign', type: 'raster', source: 'ign' },
    ],
  },
  // Toute la France au lancement : les faits historiques apparaissent en grappes sur tout le pays.
  center: [2.45, 46.6],
  zoom: window.innerWidth < 600 ? 4.6 : 5.4,
  minZoom: 4,
  maxZoom: 18.5,
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

function styleMap() {
  if (!map.getLayer('points')) return;
  const style = STYLES[currentStyle()];
  const m = style.map;
  map.setPaintProperty('paper', 'background-color', m.bg);
  map.setPaintProperty('ign', 'raster-saturation', m.saturation);
  map.setPaintProperty('ign', 'raster-opacity', m.opacity);
  map.setPaintProperty('ign', 'raster-brightness-max', m.brightness);
  map.setPaintProperty('ign', 'raster-contrast', m.contrast);
  const colors = MAP_COLORS[style.dark ? 'dark' : 'light'];
  map.setPaintProperty('points', 'circle-color', ['match', ['get', 'r'], ...Object.entries(colors).flat(), '#777']);
  map.setPaintProperty('points', 'circle-stroke-color', style.stroke);
  map.setPaintProperty('clusters', 'circle-color', style.cluster[0]);
  map.setPaintProperty('clusters', 'circle-stroke-color', style.cluster[1]);
  map.setPaintProperty('cluster-count', 'text-color', style.cluster[2]);
}

let mapReady = false;
map.on('load', () => {
  map.addSource('facts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 14, clusterRadius: 44 });
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'facts', filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 15, 20, 19, 100, 24, 1000, 30],
      'circle-stroke-width': 2.5, 'circle-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'facts', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Open Sans Bold'], 'text-size': 12.5 },
  });
  map.addLayer({
    id: 'points', type: 'circle', source: 'facts', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 14, 8, 17, 11],
      'circle-stroke-width': ['case', ['get', 'a'], 1.5, 2.5],
      'circle-opacity': ['case', ['get', 'a'], 0.82, 1],
    },
  });
  map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'selected', type: 'circle', source: 'selected', paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-color': '#c0392b' } });
  map.addSource('circuit', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'circuit-line', type: 'line', source: 'circuit', filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9e2a1e', 'line-width': 4, 'line-dasharray': [1.5, 1.5] } });
  map.addLayer({ id: 'circuit-stops', type: 'circle', source: 'circuit', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 13, 'circle-color': '#9e2a1e', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'circuit-num', type: 'symbol', source: 'circuit', filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'text-field': ['get', 'n'], 'text-font': ['Open Sans Bold'], 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });

  mapReady = true;
  styleMap();
  refresh();

  map.on('click', 'clusters', e => {
    const feature = e.features[0];
    map.getSource('facts').getClusterExpansionZoom(feature.properties.cluster_id).then(zoom => {
      map.easeTo({ center: feature.geometry.coordinates, zoom: Math.min(zoom + 0.3, 18) });
    }).catch(() => map.easeTo({ center: feature.geometry.coordinates, zoom: map.getZoom() + 2 }));
  });
  const pick = e => { const f = state.facts.get(e.features[0].properties.id); if (f) showTeaser(f); };
  map.on('click', 'points', pick);
  map.on('click', 'circuit-stops', pick);
  for (const layer of ['clusters', 'points', 'circuit-stops']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
  map.on('click', e => {
    if (!map.queryRenderedFeatures(e.point, { layers: ['clusters', 'points', 'circuit-stops'] }).length) hideTeaser();
  });
  map.on('moveend', () => { renderChronicle(); maybeLoadCatNat(); });
});

let refreshQueued = false;
function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    const source = map.getSource?.('facts');
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: visibleFacts().map(f => ({
          type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: { id: f.id, r: f.rubric, a: f.approx },
        })),
      });
    }
    renderChronicle();
    renderRubricBar();
  });
}

// ───────────────────────── Filtres ─────────────────────────

function renderRubricBar() {
  const bar = $('#rubricBar');
  const chips = [];
  if (state.hidden.size) chips.push('<button class="chip reset" data-rubric="*">↺ Tout</button>');
  for (const r of RUBRICS) {
    const off = state.hidden.has(r.id);
    const loading = !off && ARIA_RUBRICS.includes(r.id) && state.aria === 'loading';
    chips.push(`<button class="chip ${off ? 'off' : ''} ${loading ? 'loading' : ''}" data-rubric="${r.id}" style="--chip:${r.color}" aria-pressed="${!off}">${r.icon} ${r.label}</button>`);
  }
  bar.innerHTML = chips.join('');
}

$('#rubricBar').addEventListener('click', e => {
  const chip = e.target.closest('[data-rubric]');
  if (!chip) return;
  const id = chip.dataset.rubric;
  if (id === '*') state.hidden.clear();
  else if (state.hidden.has(id)) state.hidden.delete(id);
  else state.hidden.add(id);
  playSound(state.hidden.has(id) ? 'typewriter' : 'bell');
  ensureSourcesForFilters();
  refresh();
});

function renderEraBar() {
  $('#eraBar').innerHTML = ERAS.map(e => `<button class="chip ${e.id === state.era.id ? 'on' : ''}" data-era="${e.id}">${e.label}</button>`).join('');
}
$('#eraBar').addEventListener('click', e => {
  const chip = e.target.closest('[data-era]');
  if (!chip) return;
  state.era = ERAS.find(x => x.id === chip.dataset.era);
  playSound('typewriter');
  renderEraBar();
  refresh();
});

/** Charge à la demande les sources dont les rubriques viennent d'être cochées. */
function ensureSourcesForFilters() {
  if (state.aria === 'idle' && ARIA_RUBRICS.some(r => !state.hidden.has(r))) {
    state.aria = 'loading';
    setStatus();
    loadARIA().then(list => { state.aria = 'done'; addFacts(list); toast(`${fmt(list.length)} accidents industriels ajoutés (base ARIA)`); })
      .catch(() => { state.aria = 'idle'; toast('La base ARIA n’a pas pu être chargée.'); })
      .finally(() => { setStatus(); renderRubricBar(); });
  }
  maybeLoadCatNat();
}

/** Arrêtés CatNat autour du centre de la carte (grille de ~5 km), si la rubrique est affichée. */
function maybeLoadCatNat() {
  if (state.hidden.has('nature') || !mapReady || map.getZoom() < 10) return;
  const c = map.getCenter();
  const cell = `${Math.round(c.lat * 20)}:${Math.round(c.lng * 20)}`;
  if (state.catnatCells.has(cell)) return;
  state.catnatCells.add(cell);
  track('catnat', fetchCatNat(c.lat, c.lng).then(addFacts));
}

function track(name, promise) {
  state.loading.add(name);
  setStatus();
  return promise.catch(() => {}).finally(() => { state.loading.delete(name); setStatus(); });
}

function setStatus() {
  const names = { wikidata: 'Wikidata', located: 'affaires', catnat: 'Géorisques' };
  const busy = [...state.loading].map(n => names[n]).filter(Boolean);
  if (state.aria === 'loading') busy.push('ARIA');
  $('#statusLine').textContent = busy.length ? `Dépouillement : ${busy.join(', ')}…` : `${fmt(state.facts.size)} récits aux archives`;
}

// ───────────────────────── Chronique ─────────────────────────

const chronicle = $('#chronicle');
$('#chronicleToggle').addEventListener('click', () => { chronicle.classList.toggle('open'); playSound('page'); });
chronicle.querySelector('.chronicle-head').addEventListener('click', () => {
  if (window.innerWidth < 900) chronicle.classList.toggle('open');
});

function renderChronicle() {
  if (!mapReady) return;
  const bounds = map.getBounds();
  const c = map.getCenter();
  const inView = visibleFacts().filter(f => bounds.contains([f.lon, f.lat]));
  inView.forEach(f => { f._d = distance(c.lat, c.lng, f.lat, f.lon); });
  inView.sort((a, b) => a._d - b._d);
  const list = inView.slice(0, 150);
  $('#chronicleTitle').textContent = inView.length
    ? `${fmt(inView.length)} récit${inView.length > 1 ? 's' : ''} sur la carte`
    : 'Rien dans ce coin';
  $('#clippings').innerHTML = list.length
    ? list.map(f => `<li class="clipping" data-id="${esc(f.id)}" style="--tint:${RUBRIC_BY_ID[f.rubric].color}">
        <div class="meta"><span>${RUBRIC_BY_ID[f.rubric].icon} ${esc(f.category)} · ${esc(f.date)}</span><span>${distanceLabel(f._d)}</span></div>
        <h3>${esc(f.title)}</h3></li>`).join('')
    : `<li class="empty">${state.hidden.size === RUBRICS.length ? 'Toutes les rubriques sont masquées.' : 'Aucun récit de ces rubriques ici. Coche d’autres rubriques en haut, change d’époque ou déplace la carte.'}</li>`;
  setStatus();
}

$('#clippings').addEventListener('click', e => {
  const item = e.target.closest('[data-id]');
  const f = item && state.facts.get(item.dataset.id);
  if (!f) return;
  if (window.innerWidth < 900) chronicle.classList.remove('open');
  map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 15) });
  showTeaser(f);
});

// ───────────────────────── Aperçu ─────────────────────────

function showTeaser(f) {
  state.selected = f;
  playSound('typewriter');
  const el = $('#teaser');
  const d = state.me ? ` · à ${distanceLabel(distance(state.me.lat, state.me.lon, f.lat, f.lon))}` : '';
  el.style.setProperty('--tint', RUBRIC_BY_ID[f.rubric].color);
  el.innerHTML = `<button class="close" aria-label="Fermer">✕</button>
    <p class="kicker">${RUBRIC_BY_ID[f.rubric].icon} ${esc(f.category)} · ${esc(f.date)}${d}</p>
    <h3>${esc(f.title)}</h3>
    <p>${esc(f.summary || f.place)}</p>
    <div class="row"><button class="btn primary" data-read>Lire l’article</button>
    ${carnet.has(f.id) ? '<span class="note" style="align-self:center">✔ déjà dans ton carnet</span>' : ''}</div>`;
  el.hidden = false;
  el.querySelector('.close').onclick = hideTeaser;
  el.querySelector('[data-read]').onclick = () => openArticle(f);
  map.getSource('selected')?.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] } });
  if (f.ariaNumber && !f.summary) loadAriaDetail(f).then(() => { if (state.selected === f) el.querySelector('p:not(.kicker)').textContent = f.summary; });
}

function hideTeaser() {
  $('#teaser').hidden = true;
  state.selected = null;
  map.getSource('selected')?.setData({ type: 'FeatureCollection', features: [] });
}

// ───────────────────────── Fenêtres plein écran ─────────────────────────

const sheet = $('#sheet');
const sheetInner = $('#sheetInner');
let sheetOnClose = null;

function openSheet(html, onClose, view = '') {
  sheetInner.innerHTML = html;
  sheetInner.dataset.view = view;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  sheetOnClose = onClose ?? null;
  playSound('page');
  sheetInner.querySelectorAll('[data-close]').forEach(b => { b.onclick = closeSheet; });
}
function closeSheet() {
  sheet.hidden = true;
  sheetInner.innerHTML = '';
  sheetOnClose?.();
  sheetOnClose = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!sheet.hidden) closeSheet(); else if (!$('#menu').hidden) closeMenu(); else hideTeaser(); }
});

const topBar = title => `<div class="sheet-top"><p class="kicker">${title}</p><button class="close-btn" data-close aria-label="Fermer">✕</button></div>`;
const todayText = () => new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// ───────────────────────── Article ─────────────────────────

async function openArticle(f) {
  if (f.ariaNumber) await loadAriaDetail(f);
  const onSite = !!state.me && !f.approx && distance(state.me.lat, state.me.lon, f.lat, f.lon) < 150;
  const isNew = carnet.stamp(f, onSite);
  const d = state.me ? distanceLabel(distance(state.me.lat, state.me.lon, f.lat, f.lon)) : null;
  const rubric = RUBRIC_BY_ID[f.rubric];
  history.replaceState(null, '', `#fait=${encodeURIComponent(f.id)}`);
  openSheet(`${topBar(`${rubric.icon} ${esc(rubric.label)}`)}
    <header class="front-masthead">
      <div class="name">FEDIV</div>
      <div class="sub"><span>${esc(todayText())}</span><span>Édition ${esc(f.date)}</span></div>
    </header>
    <p class="kicker" style="margin-top:14px">${esc(f.category)}</p>
    <h2 class="headline">${esc(f.title)}</h2>
    <p class="subhead">${esc(f.place)}</p>
    <figure class="engraving" id="engraving" hidden><img alt="" referrerpolicy="no-referrer"><figcaption>Illustration : Wikipédia</figcaption></figure>
    <div class="article-body" id="articleBody"><p>${esc(f.summary || 'Pas de résumé pour ce récit : la source donne le détail.')}</p></div>
    <dl class="fact-sheet">
      <dt>OÙ</dt><dd>${esc(f.place)}</dd>
      <dt>QUAND</dt><dd>${esc(f.date)}</dd>
      ${d ? `<dt>D'ICI</dt><dd>${d}</dd>` : ''}
      <dt>SOURCE</dt><dd>${esc(f.sourceName)}</dd>
      ${f.approx ? '<dt>PRÉCISION</dt><dd>Centre du lieu ou de la commune (± 500 m)</dd>' : ''}
    </dl>
    <div class="actions">
      <a class="btn primary" href="${esc(f.sourceURL)}" target="_blank" rel="noopener">📖 Lire la source</a>
      <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}" target="_blank" rel="noopener">🧭 Y aller</a>
      <button class="btn" data-time>🕰 Remonter le temps</button>
      <button class="btn" data-share>↗ Partager</button>
    </div>
    ${onSite ? '<div class="stamp">Vu sur place</div>' : isNew ? '<div class="stamp">Classé au carnet</div>' : ''}
  `, null, 'article');
  if (isNew) { playSound('bell'); toast(onSite ? 'Tampon « sur place » ajouté au carnet !' : 'Récit tamponné dans ton carnet'); }
  sheetInner.querySelector('[data-time]').onclick = () => openTimeMachine(f);
  sheetInner.querySelector('[data-share]').onclick = () => shareFact(f);

  // Affaires criminelles issues de Wikidata : l'extrait et la photo citent souvent victimes ou suspects.
  const skipWiki = f.rubric === 'crime' && (f.id.startsWith('wd-') || f.id.startsWith('wdl-'));
  if (!skipWiki && f.sourceURL.includes('wikipedia.org/wiki/')) {
    const page = await fetchWikipediaSummary(f.sourceURL);
    const body = $('#articleBody');
    if (!body) return;
    if (page.extract && page.extract.length > (f.summary || '').length) body.innerHTML = page.extract.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('');
    if (page.image) {
      const fig = $('#engraving');
      fig.querySelector('img').src = page.image;
      fig.hidden = false;
    }
  }
}

async function shareFact(f) {
  const url = `${location.origin}${location.pathname}#fait=${encodeURIComponent(f.id)}`;
  const data = { title: `Fediv — ${f.title}`, text: `${f.title} (${f.date}), ${f.place}`, url };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(url); toast('Lien copié !'); }
  } catch { /* partage annulé */ }
}

// ───────────────────────── Remonter le temps (IGN) ─────────────────────────

const TIME_LAYERS = {
  etatMajor: { label: '1850', caption: "Carte d'état-major, levée entre 1820 et 1866", layer: 'GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', format: 'image/jpeg', zoom: 15 },
  aerial1950: { label: '1950', caption: 'Photographie aérienne, 1950 – 1965', layer: 'ORTHOIMAGERY.ORTHOPHOTOS.1950-1965', format: 'image/png', zoom: 17 },
  today: { label: "Aujourd'hui", caption: 'Photographie aérienne actuelle', layer: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', zoom: 17 },
};

function mosaic(lat, lon, key) {
  const l = TIME_LAYERS[key];
  const n = 2 ** l.zoom;
  const xf = (lon + 180) / 360 * n;
  const r = lat * Math.PI / 180;
  const yf = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  const cx = Math.floor(xf), cy = Math.floor(yf);
  const tiles = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    tiles.push(`<img alt="" loading="lazy" src="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${l.layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${l.zoom}&TILEROW=${cy + dy}&TILECOL=${cx + dx}&FORMAT=${encodeURIComponent(l.format)}" onerror="this.style.visibility='hidden'">`);
  }
  return { html: tiles.join(''), mx: ((xf - (cx - 1)) / 3) * 100, my: ((yf - (cy - 1)) / 3) * 100 };
}

function openTimeMachine(f, mode = 'compare') {
  const today = mosaic(f.lat, f.lon, 'today');
  const before = mosaic(f.lat, f.lon, mode === 'compare' ? 'aerial1950' : 'etatMajor');
  const onlyOld = mode !== 'compare';
  openSheet(`${topBar('🕰 Remonter le temps')}
    <h2 class="headline" style="font-size:30px">${esc(f.title)}</h2>
    <p class="subhead">Le lieu vu par l’IGN, hier et aujourd’hui.</p>
    <div class="time-tabs">
      <button class="chip ${mode === 'compare' ? 'on' : ''}" data-mode="compare">1950 ⇆ aujourd’hui</button>
      <button class="chip ${mode === 'etat' ? 'on' : ''}" data-mode="etat">Carte d’état-major (1850)</button>
    </div>
    <div class="compare" id="compare" style="--split:50%;--mx:${today.mx}%;--my:${today.my}%">
      ${onlyOld
        ? `<div class="mosaic" style="filter:sepia(.35)">${before.html}</div><span class="label" style="left:8px">${TIME_LAYERS.etatMajor.caption}</span><span class="marker" style="--mx:${before.mx}%;--my:${before.my}%"></span>`
        : `<div class="mosaic">${today.html}</div>
           <div class="mosaic top" style="filter:sepia(.45) contrast(1.05)">${before.html}</div>
           <div class="handle"></div>
           <span class="label" style="left:8px">1950 – 1965</span><span class="label" style="right:8px">Aujourd’hui</span>
           <span class="marker"></span>`}
    </div>
    <p class="note">${onlyOld ? '' : 'Fais glisser le rideau pour comparer. '}Images : IGN, Géoplateforme (données ouvertes). Les clichés anciens ne couvrent pas toute la France.</p>
    <div class="actions"><button class="btn" data-back>← Revenir à l’article</button></div>`);
  sheetInner.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => openTimeMachine(f, b.dataset.mode); });
  sheetInner.querySelector('[data-back]').onclick = () => openArticle(f);
  const box = $('#compare');
  if (!onlyOld) {
    const move = e => {
      const rect = box.getBoundingClientRect();
      const x = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      box.style.setProperty('--split', `${x * 100}%`);
    };
    box.addEventListener('pointerdown', e => { box.setPointerCapture(e.pointerId); move(e); });
    box.addEventListener('pointermove', e => { if (e.buttons) move(e); });
  }
}

// ───────────────────────── La Une du jour ─────────────────────────

function openUne() {
  const now = new Date();
  const day = now.getDate(), month = MONTHS[now.getMonth()];
  const dayRe = new RegExp(`^(${day === 1 ? '1er' : day}) ${month} (\\d{3,4})$`);
  const monthRe = new RegExp(` ${month} \\d{3,4}$`);
  const c = map.getCenter();
  const all = [...state.facts.values()].filter(f => f.year > 0);
  const byNear = list => list.sort((a, b) => distance(c.lat, c.lng, a.lat, a.lon) - distance(c.lat, c.lng, b.lat, b.lon));
  let items = byNear(all.filter(f => dayRe.test(f.date)));
  const sameDay = items.length;
  if (items.length < 5) items = items.concat(byNear(all.filter(f => monthRe.test(f.date) && !dayRe.test(f.date))).slice(0, 7 - items.length));
  items = items.slice(0, 7);
  const lead = items[0];
  openSheet(`${topBar('📰 La Une du jour')}
    <header class="front-masthead"><div class="name">FEDIV</div>
      <div class="sub"><span>${esc(todayText())}</span><span>Édition spéciale</span></div></header>
    <p class="subhead" style="margin-top:10px">${sameDay
      ? `Un ${day === 1 ? '1er' : day} ${month}, il y a quelques années… ${sameDay} récit${sameDay > 1 ? 's' : ''} aux archives, du plus proche au plus lointain.`
      : `Les archives n’ont rien pour un ${day} ${month} : voici d’autres faits de ${month}.`}</p>
    ${lead ? `<div class="une-grid">${items.map((f, i) => `
      <div class="une-item ${i === 0 ? 'lead' : ''}" data-id="${esc(f.id)}">
        <p class="kicker">${esc(f.date)} · ${esc(f.category)}</p>
        <h3>${esc(f.title)}</h3>
        ${i < 3 ? `<p>${esc(f.summary)}</p>` : ''}
      </div>`).join('')}</div>` : '<p class="empty">Les archives se chargent encore. Réessaie dans quelques secondes.</p>'}`);
  sheetInner.querySelectorAll('[data-id]').forEach(el => {
    el.onclick = () => { const f = state.facts.get(el.dataset.id); if (f) { map.jumpTo({ center: [f.lon, f.lat], zoom: 15 }); ensureVisible(f); openArticle(f); } };
  });
}

/** Rend visible la rubrique et l'époque d'un récit ouvert depuis ailleurs (Une, carnet, lien partagé). */
function ensureVisible(f) {
  let changed = false;
  if (!isVisible(f) && state.hidden.has(f.rubric)) { state.hidden.delete(f.rubric); changed = true; }
  if (!eraContains(state.era, f.year)) { state.era = ERAS[0]; renderEraBar(); changed = true; }
  if (changed) { ensureSourcesForFilters(); refresh(); }
}

// ───────────────────────── Circuits ─────────────────────────

const CIRCUITS = [
  { id: 'mix', icon: '🗺', title: 'La grande tournée', subtitle: 'Un peu de tout, au plus près', test: () => true },
  { id: 'belle', icon: '🎩', title: 'Balade Belle Époque', subtitle: '1850 – 1913', test: f => f.year >= 1850 && f.year <= 1913 },
  { id: 'crime', icon: '🔍', title: 'Sur les traces du crime', subtitle: 'Affaires, vols et attentats', test: f => ['crime', 'attack'].includes(f.rubric) },
  { id: 'fire', icon: '🔥', title: 'Le circuit du feu', subtitle: 'Incendies et explosions', test: f => ['fire', 'explosion'].includes(f.rubric), aria: true },
  { id: 'disaster', icon: '🌊', title: 'Catastrophes et accidents', subtitle: 'Trains, avions, crues, naufrages', test: f => ['accident', 'nature'].includes(f.rubric) },
  { id: 'history', icon: '🏛', title: 'La grande Histoire', subtitle: 'Les événements marquants', test: f => f.rubric === 'history' || f.id.startsWith('wd-') },
];

function openCircuits() {
  openSheet(`${topBar('🗺 Circuits')}
    <h2 class="headline" style="font-size:32px">Balades thématiques</h2>
    <p class="subhead">De 4 à 7 étapes à moins de 2 km ${state.me ? 'de toi' : 'du centre de la carte'}, enchaînées au plus court.</p>
    <div class="circuit-list">${CIRCUITS.map(c => `<button data-c="${c.id}"><span>${c.icon}</span><b>${c.title}</b><small>${c.subtitle}</small></button>`).join('')}</div>`);
  sheetInner.querySelectorAll('[data-c]').forEach(b => { b.onclick = () => buildCircuit(CIRCUITS.find(c => c.id === b.dataset.c)); });
}

async function buildCircuit(theme) {
  if (theme.aria && state.aria === 'idle') { state.hidden.delete('fire'); ensureSourcesForFilters(); }
  const origin = state.me ?? { lat: map.getCenter().lat, lon: map.getCenter().lng };
  let pool = [...state.facts.values()].filter(f => theme.test(f) && distance(origin.lat, origin.lon, f.lat, f.lon) < 2000);
  const seenPlace = new Set();
  pool = pool.filter(f => { const k = `${f.lat.toFixed(3)}:${f.lon.toFixed(3)}`; return !seenPlace.has(k) && seenPlace.add(k); });
  const stops = [];
  let here = origin;
  while (stops.length < 7 && pool.length) {
    pool.sort((a, b) => distance(here.lat, here.lon, a.lat, a.lon) - distance(here.lat, here.lon, b.lat, b.lon));
    const next = pool.shift();
    stops.push(next);
    here = next;
  }
  if (stops.length < 4) { toast('Pas assez de récits sur ce thème par ici : déplace la carte ou essaie un autre circuit.'); return; }
  closeSheet();
  stops.forEach(f => ensureVisible(f));
  let length = 0;
  for (let i = 1; i < stops.length; i++) length += distance(stops[i - 1].lat, stops[i - 1].lon, stops[i].lat, stops[i].lon);
  state.circuit = { theme, stops, index: 0 };
  map.getSource('circuit').setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: stops.map(f => [f.lon, f.lat]) } },
      ...stops.map((f, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: { n: String(i + 1), id: f.id } })),
    ],
  });
  const b = new maplibregl.LngLatBounds();
  stops.forEach(f => b.extend([f.lon, f.lat]));
  map.fitBounds(b, { padding: { top: 190, bottom: window.innerWidth < 900 ? 260 : 60, left: window.innerWidth < 900 ? 40 : 420, right: 60 }, maxZoom: 16 });
  const banner = $('#circuitBanner');
  banner.innerHTML = `<span style="font-size:22px">${theme.icon}</span><div class="grow"><b>${theme.title}</b><br>${stops.length} étapes · ${distanceLabel(length)} à pied</div>
    <button class="btn primary" data-next>Étape 1</button><button class="close-btn" data-quit aria-label="Quitter le circuit">✕</button>`;
  banner.hidden = false;
  banner.querySelector('[data-quit]').onclick = endCircuit;
  banner.querySelector('[data-next]').onclick = e => {
    const c = state.circuit;
    const f = c.stops[c.index];
    map.easeTo({ center: [f.lon, f.lat], zoom: 16 });
    showTeaser(f);
    c.index = (c.index + 1) % c.stops.length;
    e.target.textContent = `Étape ${c.index + 1}`;
  };
  playSound('bell');
}

function endCircuit() {
  state.circuit = null;
  $('#circuitBanner').hidden = true;
  map.getSource('circuit').setData({ type: 'FeatureCollection', features: [] });
}

// ───────────────────────── Carnet ─────────────────────────

function openCarnet() {
  const badges = carnet.badges();
  const stamps = carnet.stamps;
  openSheet(`${topBar("📒 Carnet d'enquêteur")}
    <h2 class="headline" style="font-size:32px">Mon carnet</h2>
    <p class="subhead">${stamps.length} récit${stamps.length > 1 ? 's' : ''} lu${stamps.length > 1 ? 's' : ''}, ${stamps.filter(s => s.onSite).length} visité${stamps.filter(s => s.onSite).length > 1 ? 's' : ''} sur place. Conservé dans ce navigateur.</p>
    <h3 class="section-title">Insignes</h3>
    <div class="badges">${badges.map(b => `<div class="badge ${b.earned ? 'earned' : ''}"><div class="ico">${b.icon}</div>
      <div><b>${b.title}</b><small>${b.earned ? 'Obtenu' : `${Math.min(b.progress, b.goal)}/${b.goal} · ${b.detail}`}</small></div></div>`).join('')}</div>
    <h3 class="section-title">Tampons</h3>
    ${stamps.length ? `<ul class="stamp-list">${stamps.slice(0, 200).map(s => `<li data-id="${esc(s.id)}"><span>${s.onSite ? '📍 ' : ''}${esc(s.title)}</span><small>${new Date(s.at).toLocaleDateString('fr-FR')}</small></li>`).join('')}</ul>
      <div class="actions"><button class="btn" data-clear>Effacer le carnet</button></div>`
      : '<p class="empty">Ouvre un récit sur la carte pour le tamponner ici.</p>'}`);
  sheetInner.querySelectorAll('[data-id]').forEach(el => {
    el.onclick = () => { const f = state.facts.get(el.dataset.id); if (f) { ensureVisible(f); map.jumpTo({ center: [f.lon, f.lat], zoom: 15 }); openArticle(f); } else toast('Ce récit n’est pas encore rechargé : coche sa rubrique.'); };
  });
  const clear = sheetInner.querySelector('[data-clear]');
  if (clear) clear.onclick = () => { if (confirm('Effacer tous les tampons du carnet ?')) { carnet.clear(); openCarnet(); } };
}

// ───────────────────────── Qui a fait le coup ? ─────────────────────────

let quizCases = null;
async function openQuiz(index = 0, score = 0) {
  quizCases ??= await fetch('data/quiz.json').then(r => r.json());
  if (index >= quizCases.length) {
    if (score > settings.quizBest) { settings.quizBest = score; settings.save('quizBest'); }
    openSheet(`${topBar('🕵 Qui a fait le coup ?')}
      <h2 class="headline">Affaires classées</h2>
      <div class="article-body"><p>Tu as résolu <b>${score}</b> affaire${score > 1 ? 's' : ''} sur ${quizCases.length}. Meilleur score : ${settings.quizBest}.</p></div>
      <div class="actions"><button class="btn primary" data-again>Rejouer</button></div>`);
    sheetInner.querySelector('[data-again]').onclick = () => openQuiz(0, 0);
    return;
  }
  const q = quizCases[index];
  openSheet(`${topBar(`🕵 Affaire ${index + 1} / ${quizCases.length} · score ${score}`)}
    <p class="kicker">${esc(q.year)} · ${esc(q.place)}</p>
    <h2 class="headline">${esc(q.title)}</h2>
    <div class="article-body"><p>${esc(q.clue)}</p></div>
    <div class="quiz-card"><b style="font-family:var(--title);font-size:19px">${esc(q.question)}</b>
      <div class="quiz-choices">${q.choices.map((c, i) => `<button data-i="${i}">${esc(c)}</button>`).join('')}</div>
      <div id="verdict"></div></div>
    <p class="note">Uniquement des affaires historiques jugées, dont les protagonistes sont morts depuis longtemps.</p>`);
  sheetInner.querySelectorAll('[data-i]').forEach(b => {
    b.onclick = () => {
      const right = Number(b.dataset.i) === q.answer;
      sheetInner.querySelectorAll('[data-i]').forEach(x => {
        x.disabled = true;
        if (Number(x.dataset.i) === q.answer) x.classList.add('right');
      });
      if (!right) b.classList.add('wrong');
      playSound(right ? 'bell' : 'typewriter');
      $('#verdict').innerHTML = `<p class="stamp" style="margin-top:4px">${right ? 'Bien vu' : 'Raté'}</p><div class="article-body"><p>${esc(q.verdict)}</p></div>
        <div class="actions"><button class="btn primary" data-next>${index + 1 < quizCases.length ? 'Affaire suivante →' : 'Voir le score'}</button></div>`;
      $('#verdict [data-next]').onclick = () => openQuiz(index + 1, score + (right ? 1 : 0));
    };
  });
}

// ───────────────────────── Baromètre ─────────────────────────

function sparkline(values) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const pts = values.map((x, i) => x == null ? null : `${(i / (values.length - 1)) * 68 + 1},${21 - ((x - min) / (max - min || 1)) * 19}`).filter(Boolean).join(' ');
  return `<svg class="spark" viewBox="0 0 70 22"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

async function openBarometer() {
  const at = state.me ?? { lat: map.getCenter().lat, lon: map.getCenter().lng };
  openSheet(`${topBar('📊 Le baromètre')}<h2 class="headline" style="font-size:30px">Recherche de la commune…</h2>
    <p class="note">Lecture des registres de la police et de la gendarmerie : une dizaine de secondes.</p>`);
  const commune = await communeAt(at.lat, at.lon);
  if (sheet.hidden) return;
  if (!commune) {
    openSheet(`${topBar('📊 Le baromètre')}<h2 class="headline" style="font-size:30px">Hors de France</h2><p class="empty">Place le centre de la carte sur une commune française.</p>`);
    return;
  }
  sheetInner.querySelector('.headline').textContent = `${commune.nom} : lecture des chiffres…`;
  const [rows, dept] = await Promise.all([
    crimeRows(CRIME_RESOURCES.commune, `CODGEO_2026__exact=${commune.code}`),
    crimeRows(CRIME_RESOURCES.department, `Code_departement__exact=${commune.codeDepartement}`),
  ]);
  if (sheet.hidden) return;
  const latest = Math.max(...rows.map(r => r.year), ...dept.map(r => r.year), 0);
  const indicators = [...new Set(rows.map(r => r.indicator))];
  const series = (list, ind) => list.filter(r => r.indicator === ind).sort((a, b) => a.year - b.year);
  const deptOnly = [...new Set(dept.map(r => r.indicator))].filter(i => !indicators.includes(i));
  const rowHTML = (ind, list, compare) => {
    const s = series(list, ind);
    const last = s.find(r => r.year === latest) ?? s[s.length - 1];
    const deptRate = compare ? dept.find(r => r.indicator === ind && r.year === latest)?.rate : null;
    const diff = last?.rate != null && deptRate != null ? (last.rate > deptRate * 1.1 ? 'higher' : last.rate < deptRate * 0.9 ? 'lower' : '') : '';
    return `<tr><td>${esc(ind)}</td>
      <td>${last?.diffused && last.count != null ? fmt(last.count) : '—'}</td>
      <td class="${diff}">${last?.diffused && last.rate != null ? fmt(last.rate) + ' ‰' : '—'}</td>
      ${compare ? `<td>${deptRate != null ? fmt(deptRate) + ' ‰' : '—'}</td>` : ''}
      <td>${sparkline(s.map(r => (r.diffused ? r.count : null)))}</td></tr>`;
  };
  openSheet(`${topBar('📊 Le baromètre')}
    <h2 class="headline" style="font-size:32px">${esc(commune.nom)}</h2>
    <p class="subhead">Crimes et délits enregistrés par la police et la gendarmerie en ${latest || '—'}, comparés au département (${esc(commune.codeDepartement)}).</p>
    ${indicators.length ? `<table class="baro-table"><thead><tr><th>Indicateur</th><th>Faits</th><th>Taux</th><th>Dépt</th><th>Depuis 2016</th></tr></thead>
      <tbody>${indicators.map(i => rowHTML(i, rows, true)).join('')}</tbody></table>`
      : '<p class="empty">Pas de chiffres communaux diffusés pour cette commune (moins de 5 faits sur 3 ans).</p>'}
    ${deptOnly.length ? `<h3 class="section-title">À l’échelle du département</h3>
      <table class="baro-table"><thead><tr><th>Indicateur</th><th>Faits</th><th>Taux</th><th>Depuis 2016</th></tr></thead>
      <tbody>${deptOnly.map(i => rowHTML(i, dept, false)).join('')}</tbody></table>` : ''}
    <p class="note">Source : SSMSI, ministère de l’Intérieur, bases communale et départementale de la délinquance enregistrée (data.gouv.fr). Taux pour 1 000 habitants (ou logements). En rouge : nettement au-dessus du département ; en vert : nettement en dessous. Ces chiffres reflètent les faits enregistrés, pas toute la délinquance réelle.</p>`);
}

// ───────────────────────── Position et promenade ─────────────────────────

function setMe(pos) {
  state.me = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
  if (!state.meMarker) {
    const el = document.createElement('div');
    el.className = 'me-dot';
    state.meMarker = new maplibregl.Marker({ element: el }).setLngLat([state.me.lon, state.me.lat]).addTo(map);
  } else state.meMarker.setLngLat([state.me.lon, state.me.lat]);
}

$('#locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('La géolocalisation n’est pas disponible.'); return; }
  toast('Recherche de ta position…');
  navigator.geolocation.getCurrentPosition(pos => {
    setMe(pos);
    map.flyTo({ center: [state.me.lon, state.me.lat], zoom: 15.5 });
    $('#locateBtn').classList.add('active');
  }, () => toast('Position refusée ou introuvable.'), { enableHighAccuracy: true, timeout: 12000 });
});

function toggleWalk() {
  if (state.walkWatch !== null) {
    navigator.geolocation.clearWatch(state.walkWatch);
    state.walkWatch = null;
    $('#walkLabel').textContent = 'Mode promenade';
    toast('Mode promenade arrêté');
    return;
  }
  if (!navigator.geolocation) { toast('La géolocalisation n’est pas disponible.'); return; }
  state.walkWatch = navigator.geolocation.watchPosition(pos => {
    setMe(pos);
    // Positions approximatives (centre de commune) : pas d'annonce.
    let best = null, bestD = 120;
    for (const f of state.facts.values()) {
      if (f.approx || state.announced.has(f.id) || !isVisible(f)) continue;
      if (Math.abs(f.lat - state.me.lat) > 0.002 || Math.abs(f.lon - state.me.lon) > 0.003) continue;
      const d = distance(state.me.lat, state.me.lon, f.lat, f.lon);
      if (d < bestD) { best = f; bestD = d; }
    }
    if (best) {
      state.announced.add(best.id);
      const banner = $('#extraBanner');
      banner.textContent = `Extra ! Extra ! À ${distanceLabel(bestD)} : ${best.title}`;
      banner.hidden = false;
      banner.onclick = () => { banner.hidden = true; showTeaser(best); };
      playSound('bell');
      navigator.vibrate?.(200);
      setTimeout(() => { banner.hidden = true; }, 12000);
    }
  }, () => toast('Position indisponible.'), { enableHighAccuracy: true, maximumAge: 5000 });
  $('#walkLabel').textContent = 'Arrêter la promenade';
  toast('Mode promenade : garde la page ouverte, je te préviens près d’un lieu.');
}

// ───────────────────────── Sommaire ─────────────────────────

function openMenu() { $('#menu').hidden = false; $('#menuScrim').hidden = false; playSound('page'); }
function closeMenu() { $('#menu').hidden = true; $('#menuScrim').hidden = true; }
$('#menuBtn').addEventListener('click', openMenu);
$('#menuScrim').addEventListener('click', closeMenu);
$('#menu').addEventListener('click', e => {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  closeMenu();
  ({ une: openUne, circuits: openCircuits, carnet: openCarnet, quiz: () => openQuiz(), barometer: openBarometer, walk: toggleWalk, about: openAbout })[b.dataset.open]();
});

// ───────────────────────── Réglages ─────────────────────────

$('#settingsBtn').addEventListener('click', openSettings);

function openSettings() {
  const row = (icon, color, label, control) => `<div class="setting"><span class="ico" style="background:${color}">${icon}</span><span class="lbl">${label}</span>${control}</div>`;
  openSheet(`${topBar('⚙ Réglages')}
    <h2 class="headline" style="font-size:32px">Réglages</h2>
    <div class="settings-group"><h4>Affichage</h4>
      ${row('◐', '#1c1c1e', 'Apparence', `<select id="setAppearance"><option value="auto">Automatique</option><option value="light">Jour (dossier kraft)</option><option value="dark">Nuit (gyrophare)</option></select>`)}
    </div>
    <div class="settings-group"><h4>Son</h4>
      ${row('🔔', '#ff3b30', 'Bruitages', `<input type="checkbox" class="switch" id="setSound">`)}
      ${row('🔊', '#ff9500', 'Volume', `<input type="range" id="setVolume" min="0" max="1" step="0.05">`)}
    </div>
    <div class="settings-group"><h4>Lecture</h4>
      ${row('Aa', '#007aff', 'Taille du texte', `<select id="setReading"><option value="small">Petite</option><option value="normal">Normale</option><option value="large">Grande</option></select>`)}
    </div>
    <div class="settings-group"><h4>Données</h4>
      ${row('📒', '#5856d6', 'Carnet d’enquêteur', `<button class="btn" id="setCarnet">Ouvrir</button>`)}
      ${row('ℹ', '#8e8e93', 'Sources et éthique', `<button class="btn" id="setAbout">Lire</button>`)}
    </div>
    <p class="note">Tout reste dans ce navigateur : pas de compte, pas de suivi. Ta position, si tu la partages, ne quitte pas ton appareil (seuls les arrêtés CatNat sont demandés autour du centre de la carte, arrondi à 1 km).</p>`);
  const bind = (id, key, prop = 'value', after = applyTheme) => {
    const el = $(id);
    el[prop] = settings[key];
    el.addEventListener('input', () => {
      settings[key] = prop === 'checked' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      settings.save(key);
      after();
    });
  };
  bind('#setAppearance', 'appearance');
  bind('#setSound', 'sound', 'checked', () => playSound('bell'));
  bind('#setVolume', 'volume', 'value', () => playSound('typewriter'));
  bind('#setReading', 'readingSize');
  $('#setCarnet').onclick = openCarnet;
  $('#setAbout').onclick = openAbout;
}

function openAbout() {
  openSheet(`${topBar('ℹ À propos')}
    <h2 class="headline" style="font-size:32px">D’où viennent les récits</h2>
    <div class="article-body">
      <p>Fediv rassemble des faits divers, des affaires et des catastrophes survenus en France, à partir de bases publiques et ouvertes.</p>
    </div>
    <dl class="fact-sheet">
      <dt>HISTOIRE</dt><dd>580 faits historiques tirés des catégories de Wikipédia, datés et localisés via Wikidata.</dd>
      <dt>WIKIDATA</dt><dd>Accidents, attentats, crimes, incendies, naufrages… géolocalisés, plus ~1 200 affaires placées à leur commune (en direct).</dd>
      <dt>ARIA</dt><dd>46 000 accidents industriels (BARPI, ministère de la Transition écologique), 1966 – 2020.</dd>
      <dt>GÉORISQUES</dt><dd>Arrêtés de catastrophe naturelle (CatNat) autour de la carte.</dd>
      <dt>SSMSI</dt><dd>Délinquance enregistrée par commune et département (baromètre).</dd>
      <dt>IGN</dt><dd>Plan IGN, photographies aériennes 1950 – 1965 et actuelles, carte d’état-major.</dd>
    </dl>
    <h3 class="section-title">Règles du journal</h3>
    <div class="article-body"><p>Fediv n’affiche pas les noms de victimes, de mineurs ou de personnes simplement mises en cause : les affaires criminelles récentes sont titrées par la nature des faits et le lieu, et la source reste accessible en un clic. Les positions des accidents industriels et des arrêtés CatNat sont approximatives (centre de la commune).</p></div>
    <p class="note">Fediv — version web. Données sous Licence ouverte Etalab, CC BY-SA (Wikipédia) et CC0 (Wikidata).</p>`);
}

// ───────────────────────── Accueil ─────────────────────────

function openWelcome() {
  openSheet(`<header class="front-masthead" style="margin-top:10px"><div class="name">FEDIV</div>
      <div class="sub"><span>${esc(todayText())}</span><span>Premier numéro</span></div></header>
    <h2 class="headline">Les faits divers vous attendent au coin de la rue</h2>
    <div class="article-body">
      <p>Promène-toi sur la carte : chaque épingle est un récit — grande affaire, catastrophe, accident, fait d’histoire — survenu à l’endroit même.</p>
      <p>Au départ, la carte montre l’<b>Histoire</b> : 580 grandes affaires, catastrophes et faits divers restés célèbres. Coche en haut les rubriques qui t’intéressent (crimes, accidents, incendies, catastrophes naturelles…) pour ajouter des milliers d’autres récits, et choisis une époque.</p>
      <p>Dans le <b>Sommaire</b> (☰) : la Une du jour, des circuits à pied, ton carnet d’enquêteur, un quiz et le baromètre de la délinquance.</p>
    </div>
    <div class="actions"><button class="btn red" data-go>Ouvrir le journal</button><button class="btn" data-locate>◎ Me localiser</button></div>`,
  () => { settings.welcomed = true; settings.save('welcomed'); });
  sheetInner.querySelector('[data-go]').onclick = closeSheet;
  sheetInner.querySelector('[data-locate]').onclick = () => { closeSheet(); $('#locateBtn').click(); };
}

// ───────────────────────── Démarrage ─────────────────────────

$('#todayLine').textContent = todayText();
applyTheme();
renderEraBar();
renderRubricBar();

async function start() {
  track('local', Promise.all([loadLocal(), loadHistory()]).then(([a, b]) => { addFacts(a); addFacts(b); }));
  // Wikidata en arrière-plan : prêt quand on coche Crimes, Accidents, Attentats…
  setTimeout(async () => {
    await track('wikidata', fetchWikidataEvents().then(addFacts));
    track('located', fetchWikidataLocatedEvents().then(addFacts));
  }, 800);

  const hash = new URLSearchParams(location.hash.slice(1));
  const wanted = hash.get('fait');
  if (wanted) {
    if (wanted.startsWith('aria-')) { state.hidden.delete('accident'); ensureSourcesForFilters(); }
    const deadline = Date.now() + 25000;
    const tryOpen = () => {
      const f = state.facts.get(wanted);
      if (f) { ensureVisible(f); map.jumpTo({ center: [f.lon, f.lat], zoom: 15.5 }); openArticle(f); }
      else if (Date.now() < deadline) setTimeout(tryOpen, 500);
    };
    tryOpen();
  } else if (!settings.welcomed) {
    openWelcome();
  }
}
start();
