// Réglages et carnet d'enquêteur, conservés dans le navigateur (localStorage).

const read = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
};
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* navigation privée */ } };

export const settings = {
  appearance: read('fediv.appearance', 'auto'),   // auto | light | dark
  sound: read('fediv.sound', true),
  volume: read('fediv.volume', 0.5),
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
// Petits bruits synthétisés (machine à écrire, page, clochette) : aucun fichier audio à télécharger.

let audio = null;
export function playSound(kind) {
  if (!settings.sound) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const now = audio.currentTime;
    const gain = audio.createGain();
    gain.connect(audio.destination);
    const v = settings.volume * 0.35;
    if (kind === 'bell') {
      const o = audio.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(1320, now);
      gain.gain.setValueAtTime(v, now); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      o.connect(gain); o.start(now); o.stop(now + 0.9);
    } else {
      const length = kind === 'page' ? 0.25 : 0.04;
      const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * length), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, kind === 'page' ? 1.5 : 6);
      const src = audio.createBufferSource();
      src.buffer = buffer;
      const filter = audio.createBiquadFilter();
      filter.type = kind === 'page' ? 'bandpass' : 'highpass';
      filter.frequency.value = kind === 'page' ? 2500 : 1800;
      gain.gain.setValueAtTime(v, now);
      src.connect(filter); filter.connect(gain); src.start(now);
    }
  } catch { /* pas d'audio */ }
}
