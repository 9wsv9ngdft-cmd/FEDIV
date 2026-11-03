// Réglages et carnet d'enquêteur, conservés dans le navigateur (localStorage).

const read = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
};
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* navigation privée */ } };

export const settings = {
  appearance: read('fediv.appearance', 'auto'),   // auto | light | dark
  sound: read('fediv.sound', true),
  volume: read('fediv.volume', 0.6),
  readingSize: read('fediv.readingSize', 'normal'), // small | normal | large
  welcomed: read('fediv.welcomed', false),
  quizBest: read('fediv.quizBest', 0),
  save(key) { write(`fediv.${key}`, this[key]); },
};

// ───────────────────────── Carnet ─────────────────────────

const stamps = read('fediv.carnet', []); // [{id, title, rubric, year, onSite, at}]

export const carnet = {
  get stamps() { return stamps; },
  has(id) { return stamps.some(s => s.id === id); },
  /** Tamponne un récit lu ; renvoie true si c'est un nouveau tampon (ou un passage « sur place »). */
  stamp(fact, onSite = false) {
    const existing = stamps.find(s => s.id === fact.id);
    if (existing) {
      if (onSite && !existing.onSite) { existing.onSite = true; write('fediv.carnet', stamps); return true; }
      return false;
    }
    stamps.unshift({ id: fact.id, title: fact.title, rubric: fact.rubric, year: fact.year, onSite, at: Date.now() });
    write('fediv.carnet', stamps);
    return true;
  },
  clear() { stamps.length = 0; write('fediv.carnet', stamps); },
  badges() {
    const count = r => stamps.filter(s => s.rubric === r).length;
    const onSite = stamps.filter(s => s.onSite).length;
    const belle = stamps.filter(s => s.year >= 1850 && s.year <= 1913).length;
    return [
      { id: 'first', icon: '👣', title: 'Premier pas', detail: 'Lire un premier récit', progress: stamps.length, goal: 1 },
      { id: 'reader', icon: '📰', title: 'Lecteur assidu', detail: 'Lire 25 récits', progress: stamps.length, goal: 25 },
      { id: 'walker', icon: '🚶', title: 'Flâneur', detail: 'Visiter 5 lieux sur place', progress: onSite, goal: 5 },
      { id: 'detective', icon: '🔍', title: 'Fin limier', detail: 'Visiter 20 lieux sur place', progress: onSite, goal: 20 },
      { id: 'belle', icon: '🎩', title: 'Belle Époque', detail: 'Lire 5 récits de 1850 à 1913', progress: belle, goal: 5 },
      { id: 'fire', icon: '🔥', title: 'Soldat du feu', detail: "Lire 5 récits d'incendies", progress: count('fire'), goal: 5 },
      { id: 'crime', icon: '🛡', title: 'Commissaire', detail: 'Lire 5 affaires criminelles', progress: count('crime'), goal: 5 },
      { id: 'nature', icon: '⛈', title: 'Vigie', detail: 'Lire 5 catastrophes naturelles', progress: count('nature'), goal: 5 },
    ].map(b => ({ ...b, earned: b.progress >= b.goal }));
  },
};

// ───────────────────────── Sons ─────────────────────────
// Banque de sons « enquête », synthétisée à la volée (aucun fichier à télécharger) :
// clic de stylo, froissement de dossier, coup de tampon, radio de police, pin-pon discret.
// Tout passe par un filtre doux et un limiteur pour que rien ne soit agressif.

let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 4200;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -22;
    limiter.ratio.value = 8;
    master = ctx.createGain();
    master.connect(soften).connect(limiter).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  master.gain.value = 0.5 * settings.volume;
  return ctx;
}

/** Bruit filtré avec une enveloppe (clic, froissement, grésillement). */
function noise(t, { duration, type = 'bandpass', freq = 1500, q = 1, gain = 0.3, attack = 0.002, curve = 3 }) {
  const a = ctx;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * duration), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, curve);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + duration + 0.02);
  return filter;
}

/** Note douce (sinus ou triangle) avec glissement de hauteur facultatif. */
function tone(t, { freq, to = freq, duration, type = 'sine', gain = 0.2, attack = 0.01 }) {
  const a = ctx;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + duration);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + duration + 0.02);
}

const SOUNDS = {
  // Clic de stylo-bille : deux petits clics feutrés.
  tap(t) {
    noise(t, { duration: 0.025, freq: 2600, q: 2.5, gain: 0.22, curve: 6 });
    noise(t + 0.045, { duration: 0.02, freq: 1900, q: 2.5, gain: 0.12, curve: 6 });
  },
  // Dossier qu'on ouvre : froissement de papier.
  folder(t) {
    const f = noise(t, { duration: 0.32, freq: 900, q: 0.7, gain: 0.16, attack: 0.06, curve: 1.6 });
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(2200, t + 0.3);
  },
  // Coup de tampon : un « toc » sourd sur le bureau.
  stamp(t) {
    tone(t, { freq: 150, to: 60, duration: 0.18, gain: 0.45, attack: 0.003 });
    noise(t, { duration: 0.06, type: 'lowpass', freq: 900, gain: 0.25, curve: 4 });
    noise(t + 0.01, { duration: 0.12, freq: 380, q: 1.2, gain: 0.12, curve: 2 });
  },
  // Radio de police : grésillement, double bip discret, fin de transmission.
  radio(t) {
    noise(t, { duration: 0.12, freq: 1700, q: 0.8, gain: 0.09, attack: 0.01, curve: 0.8 });
    tone(t + 0.13, { freq: 1046, duration: 0.09, type: 'triangle', gain: 0.07 });
    tone(t + 0.25, { freq: 1318, duration: 0.11, type: 'triangle', gain: 0.07 });
    noise(t + 0.4, { duration: 0.08, freq: 2200, q: 0.9, gain: 0.06, curve: 1 });
  },
  // Pin-pon à la française, tout bas et très court (435 / 580 Hz).
  pinpon(t) {
    for (let i = 0; i < 2; i++) {
      tone(t + i * 0.44, { freq: 435, duration: 0.2, type: 'triangle', gain: 0.07, attack: 0.03 });
      tone(t + i * 0.44 + 0.22, { freq: 580, duration: 0.2, type: 'triangle', gain: 0.07, attack: 0.03 });
    }
  },
  // Bonne réponse : deux notes claires qui montent.
  success(t) {
    tone(t, { freq: 523, duration: 0.16, gain: 0.1 });
    tone(t + 0.12, { freq: 784, duration: 0.3, gain: 0.1 });
  },
  // Mauvaise réponse : un « tss » grave, sans agresser.
  fail(t) {
    tone(t, { freq: 220, to: 165, duration: 0.28, type: 'triangle', gain: 0.1 });
  },
};

export const SOUND_NAMES = {
  tap: 'Clic de stylo', folder: 'Dossier', stamp: 'Coup de tampon', radio: 'Radio de police',
  pinpon: 'Pin-pon', success: 'Bonne réponse', fail: 'Mauvaise réponse',
};

export function playSound(kind, force = false) {
  if (!settings.sound && !force) return;
  try {
    const a = audio();
    (SOUNDS[kind] ?? SOUNDS.tap)(a.currentTime + 0.01);
  } catch { /* pas d'audio */ }
}
