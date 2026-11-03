// Vue de rue « vision d'enquêteur » : la caméra arrière, filtrée (film noir, planque de nuit, archives),
// derrière un viseur. Les affaires apparaissent comme des marqueurs de scène de crime numérotés,
// plantés dans la direction où elles se sont produites. Le réticule se verrouille sur celle que l'on vise.
// Tout reste sur l'appareil : l'image de la caméra n'est ni enregistrée ni envoyée.

import { RUBRIC_BY_ID } from './rubrics.js?v=25';

let ctx = null;
let ar = null;

const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;
const norm180 = d => ((d + 540) % 360) - 180;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CARDINAL = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const RANGES = [150, 400, 1000];
const MAX_MARKERS = 18;
const FILTERS = [
  { id: 'noir', label: 'Film noir' },
  { id: 'nuit', label: 'Planque de nuit' },
  { id: 'archives', label: 'Archives' },
];
const storedFilter = () => { try { return localStorage.getItem('fediv.arFilter') || 'noir'; } catch { return 'noir'; } };

/** Direction visée par la caméra arrière (cap) et inclinaison, à partir des angles du téléphone. */
function readOrientation(e) {
  if (e.beta == null || e.gamma == null) return null;
  const a = toRad(e.alpha || 0), b = toRad(e.beta), g = toRad(e.gamma);
  // Axe de la caméra arrière (−z de l'appareil) dans le repère est / nord / haut.
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  const up = -Math.cos(b) * Math.cos(g);
  let heading = null;
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) heading = e.webkitCompassHeading; // iPhone : cap déjà corrigé
  else if (e.absolute || e.type === 'deviceorientationabsolute') heading = (toDeg(Math.atan2(east, north)) + 360) % 360;
  return { heading, pitch: toDeg(Math.asin(Math.max(-1, Math.min(1, up)))) };
}

function onOrientation(e) {
  if (!ar) return;
  const o = readOrientation(e);
  if (!o) return;
  if (o.heading != null) {
    // Lissage circulaire : la boussole d'un téléphone tremble beaucoup.
    ar.heading = ar.heading == null ? o.heading : (ar.heading + norm180(o.heading - ar.heading) * 0.18 + 360) % 360;
  }
  ar.pitch = ar.pitch == null ? o.pitch : ar.pitch + (o.pitch - ar.pitch) * 0.2;
}

function pickFacts() {
  const pos = ar.pos;
  if (!pos) return [];
  const range = RANGES[ar.range];
  const list = [];
  for (const f of ctx.state.facts.values()) {
    if (f.approx || !(ctx.isVisible(f) || f.curated)) continue;
    if (Math.abs(f.lat - pos.lat) > 0.02 || Math.abs(f.lon - pos.lon) > 0.03) continue;
    const d = ctx.distance(pos.lat, pos.lon, f.lat, f.lon);
    if (d <= range) list.push({ f, d, b: bearing(pos, f) });
  }
  return list.sort((x, y) => x.d - y.d).slice(0, MAX_MARKERS);
}

/** Marqueur de scène de crime : chevalet jaune numéroté, planté au sol, avec son ombre. */
function markerHTML(it, i) {
  const r = RUBRIC_BY_ID[it.f.rubric] || {};
  return `<button class="ar-mark off" data-id="${esc(it.f.id)}" style="--tint:${r.color || '#9e2a1e'}" aria-label="${esc(it.f.title)}">
    <span class="ar-tent"><span class="ar-num">${i + 1}</span><span class="ar-ico">${r.icon || '•'}</span></span>
    <span class="ar-pole"></span><span class="ar-shadow"></span>
    <span class="ar-dist">${ctx.distanceLabel(it.d)}</span>
  </button>`;
}

function rebuild() {
  if (!ar) return;
  const lockedId = ar.locked?.f.id;
  const next = pickFacts();
  // Même liste qu'avant : on met juste à jour les distances, sans recréer les marqueurs (pas de clignement).
  if (next.length && next.length === ar.items.length && next.every((it, i) => it.f.id === ar.items[i].f.id)) {
    next.forEach((it, i) => {
      const old = ar.items[i];
      old.d = it.d; old.b = it.b;
      old.node.querySelector('.ar-dist').textContent = ctx.distanceLabel(it.d);
    });
    drawRadarDots();
    if (ar.locked) renderFile();
    return;
  }
  ar.items = next;
  ar.items.forEach((it, i) => { it.n = i + 1; });
  const layer = ar.el.querySelector('.ar-marks');
  layer.innerHTML = ar.items.map(markerHTML).join('');
  ar.items.forEach((it, i) => { it.node = layer.children[i]; });
  ar.locked = ar.items.find(it => it.f.id === lockedId) || null;
  if (ar.locked) ar.locked.node.classList.add('locked');
  const count = ar.items.length;
  ar.el.querySelector('.ar-count').textContent = !ar.pos ? 'Localisation de l’enquêteur…'
    : count ? `${count} scellé${count > 1 ? 's' : ''} dans un rayon de ${ctx.distanceLabel(RANGES[ar.range])}`
    : `Rien dans un rayon de ${ctx.distanceLabel(RANGES[ar.range])} : élargis le périmètre.`;
  drawRadarDots();
  renderFile();
}

function drawRadarDots() {
  const box = ar.el.querySelector('.ar-radar-dots');
  const range = RANGES[ar.range];
  box.innerHTML = ar.items.map(({ d, b, f }) => {
    const r = Math.min(d / range, 1) * 46;
    return `<i class="${ar.locked?.f.id === f.id ? 'on' : ''}" style="left:${50 + r * Math.sin(toRad(b))}%;top:${50 - r * Math.cos(toRad(b))}%"></i>`;
  }).join('');
}

/** Fiche du scellé visé, en bas de l'écran. */
function renderFile() {
  const box = ar.el.querySelector('.ar-file');
  const it = ar.locked;
  if (!it) {
    box.classList.remove('on');
    box.innerHTML = `<p class="ar-file-idle">Vise un marqueur avec le réticule pour ouvrir le scellé.</p>`;
    return;
  }
  const f = it.f;
  const arrived = ar.arrived.has(f.id);
  box.classList.add('on');
  box.innerHTML = `<div class="ar-file-tab">SCELLÉ N° ${it.n}</div>
    ${arrived ? '<div class="stamp ar-stamp">Vous y êtes</div>' : ''}
    <p class="ar-file-meta">${esc(f.category)} · ${esc(f.date)} · à ${ctx.distanceLabel(it.d)} · ${CARDINAL[Math.round(it.b / 45) % 8]}</p>
    <h3>${esc(f.title)}</h3>
    <button class="ar-file-open" data-ar-open>Ouvrir le dossier →</button>`;
  box.querySelector('[data-ar-open]').onclick = () => {
    closeAR();
    ctx.ensureVisible(f);
    ctx.map.jumpTo({ center: [f.lon, f.lat], zoom: 17 });
    ctx.openArticle(f);
  };
}

function setLock(it) {
  if ((ar.locked?.f.id ?? null) === (it?.f.id ?? null)) return;
  ar.locked?.node?.classList.remove('locked');
  ar.locked = it;
  it?.node?.classList.add('locked');
  ar.el.classList.toggle('has-lock', !!it);
  if (it) { ctx.playSound('key'); navigator.vibrate?.(12); }
  drawRadarDots();
  renderFile();
}

/** Boucle d'affichage : place chaque marqueur selon l'écart entre son cap et celui de la caméra. */
function frame() {
  if (!ar) return;
  ar.raf = requestAnimationFrame(frame);
  const w = window.innerWidth, h = window.innerHeight;
  const heading = ar.heading;
  ar.el.querySelector('.ar-radar-dots').style.transform = `rotate(${heading == null ? 0 : -heading}deg)`;
  const reticle = ar.el.querySelector('.ar-reticle');
  const hint = ar.el.querySelector('.ar-hint');
  if (heading == null) {
    ar.el.querySelector('.ar-cap').textContent = 'CAP ---';
    hint.textContent = ar.noCompass ? 'Boussole indisponible sur cet appareil : le radar montre les scellés, nord en haut.' : 'Calibrage de la boussole… fais un 8 avec le téléphone.';
    ar.items.forEach(it => it.node.classList.add('off'));
    return;
  }
  ar.el.querySelector('.ar-cap').textContent = `CAP ${String(Math.round(heading) % 360).padStart(3, '0')}° ${CARDINAL[Math.round(heading / 45) % 8]}`;
  hint.textContent = '';
  const fov = w > h ? 62 : 46;            // champ horizontal visible de la caméra
  const pxPerDeg = w / fov;
  const pitch = ar.pitch ?? 0;
  const range = RANGES[ar.range];
  let left = 0, right = 0, best = null, bestScore = Infinity;
  const placed = [];
  for (const it of ar.items) {
    const delta = norm180(it.b - heading);
    const node = it.node;
    if (Math.abs(delta) > fov / 2 + 6) {
      if (delta < 0) left++; else right++;
      node.classList.add('off');
      continue;
    }
    const near = Math.min(it.d / range, 1);
    // Les scellés proches sont plantés plus bas et en plus gros, les lointains vers l'horizon.
    const elev = -12 + near * 14;
    const x = w / 2 + delta * pxPerDeg;
    let y = h * 0.5 - (elev - pitch) * pxPerDeg;
    const scale = 1.35 - near * 0.7;
    for (let pass = 0; pass < 6; pass++) {
      const hit = placed.find(p => Math.abs(p.x - x) < 70 * (scale + p.s) / 2 && Math.abs(p.y - y) < 96 * (scale + p.s) / 2);
      if (!hit) break;
      y = hit.y - 100 * (scale + hit.s) / 2;
    }
    y = Math.max(140, Math.min(h - 230, y));
    placed.push({ x, y, s: scale });
    it.sx = x; it.sy = y;
    node.classList.remove('off');
    node.style.zIndex = String(1000 - Math.round(it.d));
    node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${scale})`;
    // Le réticule vise le centre de l'écran : on verrouille le scellé le plus proche de l'axe.
    const score = Math.abs(delta) + Math.abs(y - h * 0.5) / pxPerDeg * 0.35;
    if (Math.abs(delta) < 9 && score < bestScore) { best = it; bestScore = score; }
  }
  if (!ar.manualUntil || Date.now() > ar.manualUntil) setLock(best);
  const lock = ar.locked && !ar.locked.node.classList.contains('off') ? ar.locked : null;
  reticle.style.transform = lock
    ? `translate(${lock.sx}px, ${lock.sy - 40}px) translate(-50%, -50%) scale(.72)`
    : `translate(${w / 2}px, ${h / 2}px) translate(-50%, -50%)`;
  ar.el.querySelector('.ar-edge.l').textContent = left ? `◀ ${left}` : '';
  ar.el.querySelector('.ar-edge.r').textContent = right ? `${right} ▶` : '';
}

function tickClock() {
  if (!ar) return;
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  ar.el.querySelector('.ar-clock').textContent = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function checkArrival() {
  const first = ar.items[0];
  if (!first || first.d > 30 || ar.arrived.has(first.f.id)) return;
  ar.arrived.add(first.f.id);
  ctx.playSound('stamp');
  navigator.vibrate?.([80, 60, 160]);
  setLock(first);
  ar.manualUntil = Date.now() + 6000;
  renderFile();
}

function applyFilter(id) {
  ar.filter = id;
  ar.el.dataset.filter = id;
  ar.el.querySelector('.ar-filter').textContent = `🎞 ${FILTERS.find(f => f.id === id).label}`;
  try { localStorage.setItem('fediv.arFilter', id); } catch {}
}

async function startCamera() {
  const video = ar.el.querySelector('video');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (!ar) { stream.getTracks().forEach(t => t.stop()); return; }
    ar.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});
  } catch {
    ar?.el.classList.add('no-camera');
    ctx.toast('Caméra indisponible : la vue fonctionne au radar.');
  }
}

export function closeAR() {
  if (!ar) return;
  cancelAnimationFrame(ar.raf);
  clearInterval(ar.timer);
  clearInterval(ar.clock);
  if (ar.watch != null) navigator.geolocation.clearWatch(ar.watch);
  ar.stream?.getTracks().forEach(t => t.stop());
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  ar.el.remove();
  ar = null;
  ctx.keepAwake?.(false);
  document.documentElement.classList.remove('ar-on');
}

export async function openAR() {
  // Sur iPhone, la boussole se demande pendant le toucher : avant toute autre attente.
  let allowed = true;
  try {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') allowed = (await DeviceOrientationEvent.requestPermission()) === 'granted';
  } catch { allowed = false; }
  closeAR();
  ctx.closeSheet?.();
  const el = document.createElement('div');
  el.className = 'ar';
  el.innerHTML = `
    <div class="ar-view"><video playsinline muted autoplay></video></div>
    <div class="ar-fx"></div>
    <div class="ar-finder"><i></i><i></i><i></i><i></i></div>
    <div class="ar-top">
      <div class="ar-tape">SCÈNE DE CRIME — NE PAS FRANCHIR — SCÈNE DE CRIME — NE PAS FRANCHIR — SCÈNE DE CRIME —</div>
      <div class="ar-bar">
        <div class="ar-id"><span class="ar-rec">● ENQ</span> CAM-07 · <span class="ar-clock"></span></div>
        <button class="ar-close" aria-label="Fermer la vue de rue">✕</button>
      </div>
      <div class="ar-bar2"><span class="ar-count">Localisation de l’enquêteur…</span><button class="ar-filter"></button></div>
    </div>
    <div class="ar-marks"></div>
    <div class="ar-reticle"><span></span><b>CIBLE</b></div>
    <div class="ar-edge l"></div><div class="ar-edge r"></div>
    <div class="ar-bottom">
      <div class="ar-file"></div>
      <div class="ar-row">
        <div class="ar-radar"><div class="ar-sweep"></div><div class="ar-radar-dots"></div><span class="ar-cone"></span><span class="ar-me"></span></div>
        <div class="ar-side">
          <div class="ar-cap">CAP ---</div>
          <div class="ar-ranges">${RANGES.map((r, i) => `<button data-range="${i}">${ctx.distanceLabel(r)}</button>`).join('')}</div>
          <p class="ar-hint"></p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('ar-on');
  ar = { el, pos: ctx.state.me ? { lat: ctx.state.me.lat, lon: ctx.state.me.lon } : null, heading: null, pitch: null,
    range: 1, items: [], locked: null, manualUntil: 0, arrived: new Set(), watch: null, stream: null, raf: 0, timer: 0, clock: 0, noCompass: !allowed };

  applyFilter(storedFilter());
  el.querySelector('.ar-filter').onclick = () => {
    const i = FILTERS.findIndex(f => f.id === ar.filter);
    applyFilter(FILTERS[(i + 1) % FILTERS.length].id);
    ctx.playSound('drawer');
  };
  const setRange = i => {
    ar.range = i;
    el.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('on', Number(b.dataset.range) === i));
    rebuild();
  };
  el.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { ctx.playSound('key'); setRange(Number(b.dataset.range)); });
  el.querySelector('.ar-close').onclick = () => { ctx.playSound('wooshOut'); closeAR(); };
  el.querySelector('.ar-marks').addEventListener('click', e => {
    const t = e.target.closest('.ar-mark');
    const it = t && ar.items.find(x => x.f.id === t.dataset.id);
    if (!it) return;
    setLock(it);
    ar.manualUntil = Date.now() + 5000; // un toucher garde la cible quelques secondes
  });
  setRange(1);

  if (allowed) {
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
  }
  setTimeout(() => { if (ar && ar.heading == null) ar.noCompass = true; }, 3000);

  if (navigator.geolocation) {
    ar.watch = navigator.geolocation.watchPosition(p => {
      if (!ar) return;
      const moved = !ar.pos || ctx.distance(ar.pos.lat, ar.pos.lon, p.coords.latitude, p.coords.longitude) > 4;
      ar.pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      ctx.setMe(p);
      if (moved) { rebuild(); checkArrival(); }
    }, () => {
      if (!ar || ar.pos) return;
      const c = ctx.map.getCenter();
      ar.pos = { lat: c.lat, lon: c.lng };
      ctx.toast('Position indisponible : la vue part du centre de la carte.');
      rebuild();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }
  ar.timer = setInterval(rebuild, 6000);
  ar.clock = setInterval(tickClock, 1000);
  tickClock();
  ctx.keepAwake?.(true);
  ctx.playSound('woosh');
  startCamera();
  rebuild();
  ar.raf = requestAnimationFrame(frame);
}

export function initAR(context) { ctx = context; }
