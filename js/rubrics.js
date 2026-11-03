// Rubriques (familles d'événements) et époques : même classement que l'app iOS.

export const RUBRICS = [
  { id: 'history',   label: 'Histoire',                icon: '🏛', color: 'var(--slate)' },
  { id: 'crime',     label: 'Crimes et vols',          icon: '🔍', color: 'var(--red)' },
  { id: 'attack',    label: 'Attentats',               icon: '⚠', color: 'var(--red)' },
  { id: 'accident',  label: 'Accidents',               icon: '🚂', color: 'var(--amber)' },
  { id: 'fire',      label: 'Incendies',               icon: '🔥', color: 'var(--ember)' },
  { id: 'explosion', label: 'Explosions',              icon: '💥', color: 'var(--ember)' },
  { id: 'nature',    label: 'Catastrophes naturelles', icon: '🌊', color: 'var(--navy)' },
  { id: 'pollution', label: 'Pollutions',              icon: '☣', color: 'var(--moss)' },
];

export const RUBRIC_BY_ID = Object.fromEntries(RUBRICS.map(r => [r.id, r]));

// Couleurs « en dur » pour la carte (MapLibre ne lit pas les variables CSS).
export const MAP_COLORS = {
  light: { history: '#525451', crime: '#9e2a1e', attack: '#9e2a1e', accident: '#99721f', fire: '#b85d23',
           explosion: '#b85d23', nature: '#2d3e55', pollution: '#4d5e38' },
  dark:  { history: '#a9aaa6', crime: '#e16455', attack: '#e16455', accident: '#d9b355', fire: '#ed8d4a',
           explosion: '#ed8d4a', nature: '#88a4ce', pollution: '#94b272' },
};

const memo = new Map();

/** Classe une rubrique libre (« Accident ferroviaire », « Incendie »…) dans une famille. */
export function family(category) {
  if (memo.has(category)) return memo.get(category);
  const t = (category || '').toLowerCase();
  let r = 'history';
  const has = (...w) => w.some(x => t.includes(x));
  if (has('incendie', 'feu')) r = 'fire';
  else if (has('explosion')) r = 'explosion';
  else if (has('attentat', 'massacre', 'émeute')) r = 'attack';
  else if (has('crime', 'meurtre', 'braquage', 'enlèvement', 'cambriolage', 'assassinat', 'affaire', 'évasion', 'otage',
                'homicide', 'viol', 'disparition', 'escroquerie', 'abus', 'lynchage') || t.startsWith('vol')) r = 'crime';
  else if (has('pollution')) r = 'pollution';
  else if (has('naturelle', 'inondation', 'tempête', 'terrain', 'avalanche', 'séisme', 'ouragan', 'cyclone', 'crue',
                'tornade', 'éruption', 'sécheresse', 'canicule')) r = 'nature';
  else if (has('accident', 'naufrage', 'effondrement', 'barrage', 'catastrophe')) r = 'accident';
  memo.set(category, r);
  return r;
}

export const ERAS = [
  { id: 'all',   label: 'Toutes',     nickname: 'toutes époques', range: null },
  { id: 'belle', label: '1850–1913',  nickname: 'la Belle Époque', range: [1850, 1913] },
  { id: 'wars',  label: '1914–1945',  nickname: 'les années de guerre', range: [1914, 1945] },
  { id: 'post',  label: '1946–1999',  nickname: 'la seconde moitié du XXe siècle', range: [1946, 1999] },
  { id: 'today', label: '2000–auj.',  nickname: "aujourd'hui", range: [2000, 9999] },
];

export function eraContains(era, year) {
  if (!era.range) return true;
  return year >= era.range[0] && year <= era.range[1];
}

/** Rubriques qui demandent la base ARIA (accidents industriels, chargée à la demande). */
export const ARIA_RUBRICS = ['accident', 'fire', 'explosion', 'pollution'];
