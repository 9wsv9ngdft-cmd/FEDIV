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
// Banque de sons « bureau du détective », synthétisée à la volée (aucun fichier à télécharger) :
// machine à écrire (touches, frappe, retour chariot, sonnette), feuille, tiroir de classeur, tampon.
// Tout passe par un filtre doux et un limiteur pour que rien ne soit agressif.

let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 6500;
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

const rand = (a, b) => a + Math.random() * (b - a);

/** Une touche de machine à écrire : le « clac » métallique, le corps de la machine, le choc sourd. */
function key(t, strength = 1) {
  const v = rand(0.85, 1.15) * strength;
  noise(t, { duration: 0.018, type: 'highpass', freq: rand(2800, 3600), gain: 0.32 * v, attack: 0.0008, curve: 5 });
  noise(t + 0.002, { duration: 0.05, freq: rand(1600, 2200), q: 5, gain: 0.22 * v, attack: 0.001, curve: 4 });
  tone(t, { freq: rand(150, 190), to: 90, duration: 0.06, gain: 0.22 * v, attack: 0.001 });
}

/** La petite sonnette de fin de ligne, métallique et brève. */
function bell(t, gain = 0.09) {
  tone(t, { freq: 2093, duration: 0.9, gain, attack: 0.002 });
  tone(t, { freq: 2637, duration: 0.6, gain: gain * 0.5, attack: 0.002 });
  tone(t, { freq: 4186, duration: 0.25, gain: gain * 0.25, attack: 0.002 });
}

const SOUNDS = {
  // Une touche frappée.
  key(t) { key(t); },
  // Quelques mots tapés à la machine.
  type(t) {
    let at = t;
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { key(at, i === n - 1 ? 1.1 : 0.9); at += rand(0.07, 0.13) + (Math.random() < 0.2 ? 0.08 : 0); }
  },
  // Retour du chariot : la sonnette, le cliquetis du cliquet, le choc en butée.
  carriage(t) {
    bell(t);
    for (let i = 0; i < 14; i++) noise(t + 0.12 + i * 0.018, { duration: 0.012, type: 'highpass', freq: 2500, gain: 0.08, attack: 0.001, curve: 4 });
    noise(t + 0.12, { duration: 0.28, freq: 900, q: 0.7, gain: 0.06, attack: 0.02, curve: 1.2 });
    key(t + 0.4, 1.3);
  },
  // La sonnette seule.
  ding(t) { bell(t, 0.11); },
  // Une feuille qu'on glisse dans la machine (ou qu'on sort d'un dossier).
  paper(t) {
    const f = noise(t, { duration: 0.38, freq: 1400, q: 0.6, gain: 0.13, attack: 0.08, curve: 1.4 });
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(3200, t + 0.35);
    for (let i = 0; i < 5; i++) noise(t + 0.1 + i * 0.05, { duration: 0.015, type: 'highpass', freq: 3000, gain: 0.04, curve: 4 });
  },
  // Le tiroir du classeur qu'on ouvre : roulement puis butée.
  drawer(t) {
    noise(t, { duration: 0.32, type: 'lowpass', freq: 650, gain: 0.16, attack: 0.04, curve: 0.9 });
    noise(t, { duration: 0.32, freq: 2400, q: 3, gain: 0.03, attack: 0.04, curve: 1 });
    tone(t + 0.3, { freq: 120, to: 70, duration: 0.1, gain: 0.2, attack: 0.002 });
    noise(t + 0.3, { duration: 0.04, freq: 1500, q: 2, gain: 0.08, curve: 4 });
  },
  // Coup de tampon encreur sur le dossier.
  stamp(t) {
    tone(t, { freq: 140, to: 55, duration: 0.16, gain: 0.4, attack: 0.002 });
    noise(t, { duration: 0.05, type: 'lowpass', freq: 1200, gain: 0.22, curve: 4 });
    noise(t + 0.07, { duration: 0.03, freq: 2500, q: 2, gain: 0.05, curve: 3 });
  },
  // Mauvaise réponse : on barre à la machine (« xxx »).
  strike(t) { key(t, 0.8); key(t + 0.09, 0.8); key(t + 0.18, 0.9); },
};

export const SOUND_NAMES = {
  key: 'Touche', type: 'Frappe', carriage: 'Retour chariot', ding: 'Sonnette',
  paper: 'Feuille', drawer: 'Classeur', stamp: 'Tampon', strike: 'On barre',
};

export function playSound(kind, force = false) {
  if (!settings.sound && !force) return;
  try {
    const a = audio();
    (SOUNDS[kind] ?? SOUNDS.key)(a.currentTime + 0.01);
  } catch { /* pas d'audio */ }
}
