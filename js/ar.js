// Vue de rue en réalité augmentée : la caméra arrière filme la rue, et les fiches des affaires
// flottent dans la direction où elles se sont produites, avec leur distance.
// Tout reste sur l'appareil : l'image de la caméra n'est ni enregistrée ni envoyée.

import { RUBRIC_BY_ID } from './rubrics.js?v=25';

let ctx = null;
let ar = null;

const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;
const norm180 = d => ((d + 540) % 360) - 180;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const RANGES = [150, 400, 1000];
const MAX_TAGS = 24;

/** Direction visée par la caméra arrière (cap) et inclinaison, à partir des angles du téléphone. */
function readOrientation(e) {
  if (e.beta == null || e.gamma == null) return null;
  const a = toRad(e.alpha || 0), b = toRad(e.beta), g = toRad(e.gamma);
  // Axe de la caméra arrière (−z de l'appareil) exprimé dans le repère est / nord / haut.
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  const up = -Math.cos(b) * Math.cos(g);
  let heading = null;
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) heading = e.webkitCompassHeading; // iPhone : cap déjà corrigé
  else if (e.absolute || e.type === 'deviceorientationabsolute') heading = (toDeg(Math.atan2(east, north)) + 360) % 360;
  const pitch = toDeg(Math.asin(Math.max(-1, Math.min(1, up))));
  return { heading, pitch };
}

function onOrientation(e) {
  if (!ar) return;
  const o = readOrientation(e);
  if (!o) return;
  if (o.heading != null) {
    // Lissage circulaire : la boussole d'un téléphone tremble beaucoup.
    if (ar.heading == null) ar.heading = o.heading;
    else ar.heading = (ar.heading + norm180(o.heading - ar.heading) * 0.18 + 360) % 360;
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
  return list.sort((x, y) => x.d - y.d).slice(0, MAX_TAGS);
}

function tagHTML({ f, d }) {
  const r = RUBRIC_BY_ID[f.rubric] || {};
  return `<button class="ar-tag" data-id="${esc(f.id)}" style="--tint:${r.color || '#9e2a1e'}">
    <span class="ar-tag-meta">${r.icon || '•'} ${esc(f.category)} · ${esc(f.date)}</span>
    <b>${esc(f.title)}</b>
    <span class="ar-tag-dist">${ctx.distanceLabel(d)}</span>
  </button>`;
}

function rebuild() {
  if (!ar) return;
  ar.items = pickFacts();
  const layer = ar.el.querySelector('.ar-tags');
  layer.innerHTML = ar.items.map(tagHTML).join('');
  ar.items.forEach((it, i) => { it.node = layer.children[i]; });
  const count = ar.items.length;
  ar.el.querySelector('.ar-count').textContent = !ar.pos ? 'Recherche de ta position…'
    : count ? `${count} affaire${count > 1 ? 's' : ''} à moins de ${ctx.distanceLabel(RANGES[ar.range])}`
    : `Aucune affaire à moins de ${ctx.distanceLabel(RANGES[ar.range])} : élargis le rayon ou coche d’autres rubriques.`;
  drawRadarDots();
}

function drawRadarDots() {
  const box = ar.el.querySelector('.ar-radar-dots');
  const range = RANGES[ar.range];
  box.innerHTML = ar.items.map(({ f, d, b }) => {
    const r = Math.min(d / range, 1) * 46;
    const x = 50 + r * Math.sin(toRad(b)), y = 50 - r * Math.cos(toRad(b));
    return `<i style="left:${x}%;top:${y}%;background:${(RUBRIC_BY_ID[f.rubric] || {}).color || '#e16455'}"></i>`;
  }).join('');
}

/** Boucle d'affichage : place chaque fiche selon l'écart entre son cap et celui de la caméra. */
function frame() {
  if (!ar) return;
  ar.raf = requestAnimationFrame(frame);
  const w = window.innerWidth, h = window.innerHeight;
  const heading = ar.heading;
  const radar = ar.el.querySelector('.ar-radar-dots');
  radar.style.transform = `rotate(${heading == null ? 0 : -heading}deg)`;
  const hint = ar.el.querySelector('.ar-hint');
  if (heading == null) {
    hint.textContent = ar.noCompass ? 'Boussole indisponible sur cet appareil : le radar montre les affaires, nord en haut.' : 'Calibrage de la boussole… fais un 8 avec le téléphone.';
    ar.items.forEach(it => { it.node.style.opacity = 0; it.node.style.pointerEvents = 'none'; });
    return;
  }
  hint.textContent = ar.items.length ? 'Tiens le téléphone droit et tourne-toi : les fiches flottent vers les lieux.' : '';
  const fov = w > h ? 62 : 46;            // champ horizontal visible de la caméra
  const pxPerDeg = w / fov;
  const pitch = ar.pitch ?? 0;
  const range = RANGES[ar.range];
  let left = 0, right = 0;
  const placed = [];
  for (const it of ar.items) {
    const delta = norm180(it.b - heading);
    const node = it.node;
    if (Math.abs(delta) > fov / 2 + 8) {
      if (delta < 0) left++; else right++;
      node.style.opacity = 0; node.style.pointerEvents = 'none';
      continue;
    }
    const near = Math.min(it.d / range, 1);
    // Les affaires proches flottent plus bas et en plus grand, les lointaines vers l'horizon.
    const elev = -9 + near * 13;
    let x = w / 2 + delta * pxPerDeg;
    let y = h * 0.46 - (elev - pitch) * pxPerDeg;
    const scale = 1.05 - near * 0.45;
    // Évite que deux fiches se recouvrent : on décale vers le haut.
    for (let pass = 0; pass < 8; pass++) {
      const hit = placed.find(p => Math.abs(p.x - x) < 205 * (scale + p.s) / 2 && Math.abs(p.y - y) < 78 * (scale + p.s) / 2);
      if (!hit) break;
      y = hit.y - 80 * (scale + hit.s) / 2;
    }
    placed.push({ x, y, s: scale });
    y = Math.max(110, Math.min(h - 210, y));
    node.style.opacity = 1;
    node.style.pointerEvents = 'auto';
    node.style.zIndex = String(1000 - Math.round(it.d));
    node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
  }
  ar.el.querySelector('.ar-edge.l').textContent = left ? `◀ ${left}` : '';
  ar.el.querySelector('.ar-edge.r').textContent = right ? `${right} ▶` : '';
}

function checkArrival() {
  const first = ar.items[0];
  if (!first || first.d > 30 || ar.arrived.has(first.f.id)) return;
  ar.arrived.add(first.f.id);
  ctx.playSound('ding');
  navigator.vibrate?.([80, 60, 160]);
  showDetail(first.f, true);
}

function showDetail(f, arrived = false) {
  const box = ar.el.querySelector('.ar-detail');
  const d = ar.pos ? ctx.distance(ar.pos.lat, ar.pos.lon, f.lat, f.lon) : null;
  box.innerHTML = `${arrived ? '<div class="stamp ar-stamp">Vous y êtes</div>' : ''}
    <p class="ar-detail-meta">${esc(f.category)} · ${esc(f.date)}${d != null ? ' · à ' + ctx.distanceLabel(d) : ''}</p>
    <h3>${esc(f.title)}</h3>
    <p class="ar-detail-sum">${esc(f.summary || '')}</p>
    <div class="actions"><button class="btn primary" data-ar-open>📖 Lire le dossier</button><button class="btn" data-ar-hide>Fermer</button></div>`;
  box.hidden = false;
  box.querySelector('[data-ar-open]').onclick = () => { closeAR(); ctx.ensureVisible(f); ctx.map.jumpTo({ center: [f.lon, f.lat], zoom: 17 }); ctx.openArticle(f); };
  box.querySelector('[data-ar-hide]').onclick = () => { box.hidden = true; };
  ctx.playSound('paper');
}

async function startCamera() {
  const video = ar.el.querySelector('video');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
    ar.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (!ar) { ar?.stream?.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = ar.stream;
    await video.play().catch(() => {});
  } catch {
    ar?.el.classList.add('no-camera');
    ctx.toast('Caméra indisponible : la vue fonctionne en mode radar.');
  }
}

export function closeAR() {
  if (!ar) return;
  cancelAnimationFrame(ar.raf);
  clearInterval(ar.timer);
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
    <video playsinline muted autoplay></video>
    <div class="ar-grain"></div>
    <div class="ar-top">
      <div class="ar-tape">SCÈNE DE CRIME — VUE DE RUE — NE PAS FRANCHIR — SCÈNE DE CRIME — VUE DE RUE —</div>
      <div class="ar-bar"><span class="ar-rec">● REC</span><span class="ar-count">Recherche de ta position…</span><button class="ar-close" aria-label="Fermer la vue de rue">✕</button></div>
    </div>
    <div class="ar-tags"></div>
    <div class="ar-edge l"></div><div class="ar-edge r"></div>
    <div class="ar-bottom">
      <div class="ar-radar"><div class="ar-radar-dots"></div><span class="ar-cone"></span><span class="ar-me"></span></div>
      <div class="ar-side">
        <div class="ar-ranges">${RANGES.map((r, i) => `<button data-range="${i}">${ctx.distanceLabel(r)}</button>`).join('')}</div>
        <p class="ar-hint"></p>
      </div>
    </div>
    <div class="ar-detail" hidden></div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('ar-on');
  ar = { el, pos: ctx.state.me ? { lat: ctx.state.me.lat, lon: ctx.state.me.lon } : null, heading: null, pitch: null,
    range: 1, items: [], arrived: new Set(), watch: null, stream: null, raf: 0, timer: 0, noCompass: !allowed };

  const setRange = i => {
    ar.range = i;
    el.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('on', Number(b.dataset.range) === i));
    rebuild();
  };
  el.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { ctx.playSound('key'); setRange(Number(b.dataset.range)); });
  el.querySelector('.ar-close').onclick = () => { ctx.playSound('drawer'); closeAR(); };
  el.querySelector('.ar-tags').addEventListener('click', e => {
    const t = e.target.closest('.ar-tag');
    const f = t && ctx.state.facts.get(t.dataset.id);
    if (f) showDetail(f);
  });
  setRange(1);

  if (allowed) {
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
  }
  // Si aucun cap n'arrive au bout de 3 s, on le dit plutôt que d'attendre en silence.
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
  // Les rubriques et les récits se chargent en arrière-plan : on rafraîchit de temps en temps.
  ar.timer = setInterval(rebuild, 5000);
  ctx.keepAwake?.(true);
  ctx.playSound('carriage');
  startCamera();
  rebuild();
  ar.raf = requestAnimationFrame(frame);
}

export function initAR(context) { ctx = context; }
