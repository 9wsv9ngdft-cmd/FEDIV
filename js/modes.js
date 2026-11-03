// Modes « hors du commun » : lampe torche (avec traces façon Luminol), boussole de l'enquêteur, planque, secouer.
// Ils reçoivent de app.js le contexte dont ils ont besoin (carte, état, fenêtres, sons…).

let ctx = null;

/** Garde l'écran allumé pendant la boussole ou la planque (si l'appareil le permet). */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* refusé ou indisponible */ }
}

const toRad = d => d * Math.PI / 180;
/** Cap (en degrés depuis le nord) pour aller de a vers b. */
function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
/** « vers le nord », « vers l'est »… */
const cardinal = d => ['le nord', 'le nord-est', 'l’est', 'le sud-est', 'le sud', 'le sud-ouest', 'l’ouest', 'le nord-ouest'][Math.round(d / 45) % 8];

// ───────────────────────── Lampe torche et Luminol ─────────────────────────

let lightMode = 'off'; // off | torch | uv
let pointer = { x: 0.5, y: 0.45 };
let pointerQueued = false;

function placeLight(clientX, clientY) {
  pointer = { x: clientX / window.innerWidth, y: clientY / window.innerHeight };
  if (pointerQueued) return;
  pointerQueued = true;
  requestAnimationFrame(() => {
    pointerQueued = false;
    const el = document.getElementById('torch');
    el.style.setProperty('--x', `${pointer.x * 100}%`);
    el.style.setProperty('--y', `${pointer.y * 100}%`);
  });
}

function crimeFeatures() {
  const features = [];
  for (const f of ctx.state.facts.values()) {
    if (f.rubric === 'crime' || f.rubric === 'attack') features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] } });
  }
  return { type: 'FeatureCollection', features };
}

function ensureLuminolLayers() {
  const { map } = ctx;
  if (map.getSource('luminol')) { map.getSource('luminol').setData(crimeFeatures()); return; }
  map.addSource('luminol', { type: 'geojson', data: crimeFeatures() });
  // Halo fluorescent, puis taches plus nettes de près.
  map.addLayer({
    id: 'luminol-glow', type: 'heatmap', source: 'luminol', layout: { visibility: 'none' },
    paint: {
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 26, 15, 46],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 14, 2],
      'heatmap-weight': 0.5,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)', 0.15, 'rgba(40,140,255,.22)', 0.45, 'rgba(70,210,255,.42)', 0.8, 'rgba(160,250,255,.6)', 1, 'rgba(235,255,255,.75)'],
    },
  }, 'clusters');
  map.addLayer({
    id: 'luminol-spots', type: 'circle', source: 'luminol', minzoom: 11, layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 17, 16], 'circle-color': '#7fe8ff', 'circle-blur': 0.9, 'circle-opacity': 0.6 },
  }, 'clusters');
}

export function setLight(mode) {
  lightMode = mode;
  const el = document.getElementById('torch');
  const btn = document.getElementById('torchBtn');
  el.dataset.mode = mode;
  el.hidden = mode === 'off';
  btn.classList.toggle('active', mode !== 'off');
  btn.setAttribute('aria-label', mode === 'off' ? 'Allumer la lampe torche' : 'Éteindre la lampe torche');
  const { map } = ctx;
  // Lampe allumée : un doigt promène la lumière sans bouger la carte ; deux doigts la déplacent.
  try {
    if (mode !== 'off') map.cooperativeGestures.enable(); else map.cooperativeGestures.disable();
    if (mode !== 'off') map.dragPan.disable(); else map.dragPan.enable();
    if (mode !== 'off' && window.matchMedia('(pointer: coarse)').matches) map.dragPan.enable();
  } catch { /* ancienne version de la carte */ }
  // Sous le faisceau, de légères traces bleues révèlent les lieux de crimes (façon Luminol).
  if (ctx.mapReady()) {
    if (mode !== 'off') ensureLuminolLayers();
    for (const id of ['luminol-glow', 'luminol-spots']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mode !== 'off' ? 'visible' : 'none');
  }
  if (mode !== 'off') ctx.toast(window.matchMedia('(pointer: coarse)').matches
    ? 'Lampe torche : un doigt pour éclairer, deux doigts pour bouger la carte'
    : 'Lampe torche : déplace la souris pour éclairer');
  ctx.playSound(mode === 'off' ? 'key' : 'stamp');
}

/** Appelé quand de nouveaux récits arrivent : les taches de Luminol suivent. */
export function lightRefresh() {
  if (lightMode !== 'off' && ctx.mapReady()) ctx.map.getSource('luminol')?.setData(crimeFeatures());
}

function initLight() {
  const btn = document.getElementById('torchBtn');
  btn.addEventListener('click', () => setLight(lightMode === 'off' ? 'torch' : 'off'));
  const track = e => { if (lightMode !== 'off') placeLight(e.clientX, e.clientY); };
  window.addEventListener('pointerdown', track, { passive: true });
  window.addEventListener('pointermove', track, { passive: true });
}

// ───────────────────────── Boussole de l'enquêteur ─────────────────────────

let compass = null;

async function askOrientation() {
  try {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') return (await DeviceOrientationEvent.requestPermission()) === 'granted';
    return true;
  } catch { return false; }
}

function nearestTarget(pos, skip) {
  let best = null, bestD = Infinity;
  for (const f of ctx.state.facts.values()) {
    if (f.approx || skip.has(f.id) || !(ctx.isVisible(f) || f.curated)) continue;
    if (Math.abs(f.lat - pos.lat) > 0.2 || Math.abs(f.lon - pos.lon) > 0.3) continue;
    const d = ctx.distance(pos.lat, pos.lon, f.lat, f.lon);
    if (d < bestD) { best = f; bestD = d; }
  }
  return best;
}

function renderCompass() {
  const c = compass;
  if (!c) return;
  const box = document.getElementById('compassBox');
  if (!box) return;
  if (!c.pos) { box.querySelector('.compass-title').textContent = 'Recherche de ta position…'; return; }
  if (!c.target) c.target = nearestTarget(c.pos, c.skip);
  const f = c.target;
  if (!f) { box.querySelector('.compass-title').textContent = 'Aucune affaire à moins de 20 km : coche d’autres rubriques.'; return; }
  const d = ctx.distance(c.pos.lat, c.pos.lon, f.lat, f.lon);
  const b = bearing(c.pos, f);
  const rotation = c.heading == null ? b : b - c.heading;
  box.querySelector('.compass-needle').style.transform = `rotate(${rotation}deg)`;
  box.querySelector('.compass-rose').style.transform = `rotate(${c.heading == null ? 0 : -c.heading}deg)`;
  box.querySelector('.compass-dist').textContent = ctx.distanceLabel(d);
  box.querySelector('.compass-title').textContent = f.title;
  box.querySelector('.compass-meta').textContent = `${f.category} · ${f.date} · vers ${cardinal(b)}`;
  box.querySelector('.compass-hint').textContent = c.heading == null
    ? 'Boussole indisponible : la flèche indique la direction par rapport au nord (en haut).'
    : 'Tiens le téléphone à plat devant toi et suis la flèche.';
  if (d < 35 && !c.arrived.has(f.id)) {
    c.arrived.add(f.id);
    ctx.playSound('ding');
    navigator.vibrate?.([80, 60, 160]);
    box.querySelector('.compass-arrived').hidden = false;
  }
}

function onOrientation(e) {
  if (!compass) return;
  let heading = null;
  if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') heading = 360 - e.alpha;
  if (heading == null) return;
  compass.heading = heading;
  if (!compass.frame) compass.frame = requestAnimationFrame(() => { compass && (compass.frame = 0); renderCompass(); });
}

function stopCompass() {
  if (!compass) return;
  if (compass.watch != null) navigator.geolocation.clearWatch(compass.watch);
  window.removeEventListener('deviceorientation', onOrientation);
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  compass = null;
  keepAwake(false);
}

export async function openCompass() {
  const allowed = await askOrientation(); // à demander tout de suite, pendant le geste de l'utilisateur
  if (!navigator.geolocation) { ctx.toast('La géolocalisation n’est pas disponible.'); return; }
  stopCompass();
  compass = { pos: ctx.state.me ? { lat: ctx.state.me.lat, lon: ctx.state.me.lon } : null, heading: null, target: null, skip: new Set(), arrived: new Set(), watch: null, frame: 0 };
  ctx.openSheet(`${ctx.topBar('🧭 Boussole de l’enquêteur')}
    <div class="compass" id="compassBox">
      <div class="compass-dial">
        <div class="compass-rose"><span class="n">N</span><span class="e">E</span><span class="s">S</span><span class="o">O</span></div>
        <div class="compass-needle"><span></span></div>
        <div class="compass-dist">…</div>
      </div>
      <p class="compass-meta"></p>
      <h2 class="compass-title">Recherche de ta position…</h2>
      <div class="compass-arrived stamp" hidden>Vous y êtes</div>
      <p class="compass-hint note"></p>
      <div class="actions">
        <button class="btn primary" data-open-target>📖 Ouvrir l’affaire</button>
        <button class="btn" data-next-target>⤼ Affaire suivante</button>
      </div>
    </div>`, stopCompass);
  const sheetInner = document.getElementById('sheetInner');
  sheetInner.querySelector('[data-next-target]').onclick = () => {
    if (compass?.target) compass.skip.add(compass.target.id);
    compass.target = null;
    ctx.playSound('key');
    renderCompass();
  };
  sheetInner.querySelector('[data-open-target]').onclick = () => { const f = compass?.target; if (f) { ctx.closeSheet(); ctx.ensureVisible(f); ctx.map.jumpTo({ center: [f.lon, f.lat], zoom: 16 }); ctx.openArticle(f); } };
  if (allowed) {
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
  }
  compass.watch = navigator.geolocation.watchPosition(p => {
    if (!compass) return;
    compass.pos = { lat: p.coords.latitude, lon: p.coords.longitude };
    ctx.setMe(p);
    renderCompass();
  }, () => {
    if (!compass || compass.pos) return;
    // Sans position : on part du centre de la carte, la flèche reste utile pour s'orienter.
    const c = ctx.map.getCenter();
    compass.pos = { lat: c.lat, lon: c.lng };
    ctx.toast('Position indisponible : la boussole part du centre de la carte.');
    renderCompass();
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  keepAwake(true);
  renderCompass();
}

// ───────────────────────── La planque ─────────────────────────

let stakeout = null;

function stopStakeout() {
  if (!stakeout) return;
  clearTimeout(stakeout.timer);
  try { speechSynthesis.cancel(); } catch { /* rien */ }
  stakeout = null;
  keepAwake(false);
}

/** Le meilleur texte disponible pour un récit : résumé ARIA, extrait Wikipédia, ou résumé court. */
async function bestText(f) {
  if (f.ariaNumber) await ctx.loadAriaDetail(f);
  const generic = !f.summary || f.summary.startsWith('Ouvre la fiche');
  const crime = f.rubric === 'crime' && (f.id.startsWith('wd-') || f.id.startsWith('wdl-'));
  if (generic && !crime && f.sourceURL.includes('wikipedia.org/wiki/')) {
    const page = await ctx.fetchWikipediaSummary(f.sourceURL);
    if (page.extract) return page.extract.split(/(?<=\.)\s/).slice(0, 3).join(' ');
  }
  return generic ? f.place : f.summary;
}

async function stakeoutShow() {
  const s = stakeout;
  if (!s) return;
  const box = document.getElementById('stakeoutBox');
  if (!box) return;
  const f = s.list[s.index];
  const token = (s.token = (s.token || 0) + 1);
  const d = ctx.distance(s.at.lat, s.at.lon, f.lat, f.lon);
  box.querySelector('.stake-count').textContent = `Affaire ${s.index + 1} sur ${s.list.length}`;
  box.querySelector('.stake-meta').textContent = `${f.category} · ${f.date} · à ${ctx.distanceLabel(d)}, vers ${cardinal(bearing(s.at, f))}`;
  box.querySelector('.stake-title').textContent = f.title;
  box.querySelector('.stake-text').textContent = '…';
  box.querySelector('[data-pause]').textContent = s.paused ? '▶ Reprendre' : '⏸ Pause';
  ctx.map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(ctx.map.getZoom(), 16), duration: 900 });
  const text = await bestText(f);
  if (stakeout !== s || s.token !== token) return; // on a changé d'affaire entre-temps
  box.querySelector('.stake-text').textContent = text;
  if (s.paused) return;
  const next = () => {
    if (!stakeout || stakeout !== s || s.paused) return;
    s.timer = setTimeout(() => { if (stakeout === s && !s.paused) { s.index = (s.index + 1) % s.list.length; stakeoutShow(); } }, 2200);
  };
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`À ${Math.round(d / 10) * 10} mètres. ${f.date}. ${f.title}. ${text}`);
    u.lang = 'fr-FR';
    const voices = speechSynthesis.getVoices().filter(v => v.lang?.startsWith('fr'));
    u.voice = voices.find(v => /Thomas|Daniel|Henri|Paul/i.test(v.name)) ?? voices[0] ?? null;
    u.rate = 0.96;
    u.onend = next;
    speechSynthesis.speak(u);
  } catch {
    s.timer = setTimeout(next, 10000);
  }
}

export function openStakeout() {
  stopStakeout();
  const start = at => {
    const list = [];
    for (const f of ctx.state.facts.values()) {
      if (Math.abs(f.lat - at.lat) > 0.006 || Math.abs(f.lon - at.lon) > 0.009) continue;
      const d = ctx.distance(at.lat, at.lon, f.lat, f.lon);
      // Les grandes affaires d'abord, puis le reste par distance.
      if (d <= 500) list.push([f, d + (f.curated ? 0 : 200) + (f.approx ? 300 : 0)]);
    }
    list.sort((a, b) => a[1] - b[1]);
    if (!list.length) {
      ctx.openSheet(`${ctx.topBar('🕵 La planque')}<h2 class="headline" style="font-size:30px">Rien à signaler</h2>
        <p class="empty">Aucune affaire dans un rayon de 500 m. Déplace la carte vers un autre quartier, ou coche d’autres rubriques.</p>`);
      return;
    }
    stakeout = { at, list: list.map(x => x[0]), index: 0, paused: false, timer: null };
    ctx.openSheet(`${ctx.topBar('🕵 La planque')}
      <div class="stakeout" id="stakeoutBox">
        <p class="kicker">Planque en cours · rayon de 500 m</p>
        <p class="stake-count note"></p>
        <div class="stake-card">
          <small class="stake-meta"></small>
          <h2 class="stake-title"></h2>
          <p class="stake-text"></p>
        </div>
        <p class="note">Pose le téléphone : je te raconte, une à une, les affaires du quartier.</p>
        <div class="actions">
          <button class="btn primary" data-pause>⏸ Pause</button>
          <button class="btn" data-skip>⤼ Suivante</button>
          <button class="btn" data-read>📖 Lire l’article</button>
        </div>
      </div>`, stopStakeout);
    const inner = document.getElementById('sheetInner');
    inner.querySelector('[data-pause]').onclick = () => {
      const s = stakeout; if (!s) return;
      s.paused = !s.paused;
      clearTimeout(s.timer);
      if (s.paused) { try { speechSynthesis.cancel(); } catch { /* rien */ } inner.querySelector('[data-pause]').textContent = '▶ Reprendre'; }
      else stakeoutShow();
    };
    inner.querySelector('[data-skip]').onclick = () => { const s = stakeout; if (!s) return; clearTimeout(s.timer); s.index = (s.index + 1) % s.list.length; ctx.playSound('key'); stakeoutShow(); };
    inner.querySelector('[data-read]').onclick = () => { const f = stakeout?.list[stakeout.index]; if (f) { ctx.closeSheet(); ctx.ensureVisible(f); ctx.openArticle(f); } };
    keepAwake(true);
    ctx.playSound('carriage');
    stakeoutShow();
  };
  if (ctx.state.me) start({ lat: ctx.state.me.lat, lon: ctx.state.me.lon });
  else {
    const c = ctx.map.getCenter();
    ctx.toast('Planque au centre de la carte (touche ◎ pour la faire autour de toi)');
    start({ lat: c.lat, lon: c.lng });
  }
}

// ───────────────────────── Secouer pour une affaire au hasard ─────────────────────────

let lastShake = 0;
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const force = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
  if (force > 28 && Date.now() - lastShake > 2500) {
    lastShake = Date.now();
    ctx.playSound('drawer');
    navigator.vibrate?.(120);
    document.getElementById('randomBtn')?.click();
  }
}

/** Active ou coupe « secouer » ; renvoie false si l'iPhone refuse l'accès aux mouvements. */
export async function setShake(on) {
  window.removeEventListener('devicemotion', onMotion);
  if (!on) return true;
  try {
    if (typeof DeviceMotionEvent?.requestPermission === 'function' && (await DeviceMotionEvent.requestPermission()) !== 'granted') return false;
  } catch { return false; }
  window.addEventListener('devicemotion', onMotion);
  return true;
}

// ───────────────────────── Démarrage ─────────────────────────

export function initModes(context) {
  ctx = context;
  initLight();
}
