// Sources de récits : fichiers du site (histoire, ARIA, récits parisiens) et services publics en direct
// (Wikidata, Géorisques, Wikipédia). Aucune position personnelle n'est envoyée : Wikidata est interrogé
// pour toute la France, Géorisques autour du centre de la carte arrondi à ~1 km.

import { family } from './rubrics.js?v=3';

const FRANCE = { minLat: 41.2, maxLat: 51.2, minLon: -5.3, maxLon: 9.7 };
const inFrance = (lat, lon) => lat > FRANCE.minLat && lat < FRANCE.maxLat && lon > FRANCE.minLon && lon < FRANCE.maxLon;
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const capitalizedFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

function makeFact(f) {
  f.rubric = family(f.category);
  f.approx = !!f.approx;
  return f;
}

/** Décalage déterministe de 100 à 450 m pour que les épingles d'une même commune ne se superposent pas. */
export function jitter(lat, lon, seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const angle = (h & 0xffff) / 65535 * 2 * Math.PI;
  const d = 100 + ((h >>> 16) & 0xffff) / 65535 * 350;
  return [lat + d * Math.cos(angle) / 111320, lon + d * Math.sin(angle) / (111320 * Math.max(Math.cos(lat * Math.PI / 180), 0.1))];
}

async function getJSON(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ───────────────────────── Fichiers du site ─────────────────────────

export async function loadLocal() {
  const rows = await getJSON('data/local.json');
  return rows.map(r => makeFact({
    curated: true,
    id: r.id, title: r.title, summary: r.summary, category: r.category, place: r.place,
    lat: r.latitude, lon: r.longitude, date: r.eventDate, year: r.eventYear,
    sourceName: r.sourceName, sourceURL: r.sourceURL,
  }));
}

/** Faits historiques tirés des catégories de Wikipédia, datés et localisés via Wikidata. */
export async function loadHistory() {
  const rows = await getJSON('data/histoire.json');
  return rows.map(([n, title, lat, lon, year, date, category, desc, article]) => makeFact({
    curated: true,
    id: `wd-Q${n}`, title, category,
    summary: desc ? capitalizedFirst(desc) + '.' : 'Ouvre la fiche pour lire le résumé de l’article.',
    place: 'Lieu indiqué par Wikipédia et Wikidata', lat, lon, date, year,
    sourceName: 'Wikipédia · Wikidata',
    sourceURL: article ? 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(article.replaceAll(' ', '_')) : `https://www.wikidata.org/wiki/Q${n}`,
  }));
}

/** Base ARIA du BARPI (46 000 accidents industriels) : index léger, résumés chargés à la demande. */
export async function loadARIA() {
  const { categories, rows } = await getJSON('data/aria-index.json');
  return rows.map(([n, year, lat, lon, c, flags, title, commune]) => makeFact({
    id: `aria-${n}`, ariaNumber: n, flags, title, category: categories[c], summary: '',
    place: `${commune} · position approximative`, lat, lon, date: String(year), year, approx: true,
    sourceName: `ARIA · BARPI, n° ${n}`,
    sourceURL: `https://www.aria.developpement-durable.gouv.fr/accident/${n}/`,
  }));
}

const ariaBuckets = new Map();
/** Complète une fiche ARIA (date exacte, résumé, lien) depuis son paquet. */
export async function loadAriaDetail(fact) {
  if (!fact.ariaNumber || fact.summary) return fact;
  const key = fact.ariaNumber % 64;
  if (!ariaBuckets.has(key)) ariaBuckets.set(key, getJSON(`data/aria/${key}.json`));
  const bucket = await ariaBuckets.get(key);
  const row = bucket[fact.ariaNumber];
  if (row) {
    fact.date = row[0];
    let summary = row[1];
    if (fact.flags & 1) summary += ' L’accident a fait au moins un mort.';
    else if (fact.flags & 2) summary += ' L’accident a fait des blessés.';
    fact.summary = summary;
    if (row[2]) fact.sourceURL = row[2];
  }
  return fact;
}

let communesPromise = null;
export function loadCommunes() {
  communesPromise ??= getJSON('data/communes.json').then(rows => new Map(rows.map(([code, name, lat, lon]) => [code, { name, lat, lon }])));
  return communesPromise;
}

// ───────────────────────── Wikidata ─────────────────────────

const WIKIDATA_TYPES = (() => {
  const map = {};
  const add = (ids, category) => ids.split(' ').forEach(id => { map[id] = category; });
  add('Q1078765 Q1331380 Q19403959 Q11396408 Q19710423 Q7833114 Q18215814', 'Accident ferroviaire');
  add('Q744913 Q1863435 Q17355126 Q898712', 'Accident aérien');
  add('Q2223653 Q891854 Q6813020 Q18711682 Q28934204 Q5429679 Q28945444 Q25917154 Q25917186 Q64149164 Q134693479', 'Attentat');
  add('Q3199915 Q750215 Q21480300 Q124612203 Q177716 Q486775 Q3588250 Q2406205', 'Massacre');
  add('Q132821 Q81672 Q149086 Q3882219 Q1139665 Q4676786 Q1475448 Q88178910 Q216169 Q10855380 Q204933 Q83267 Q459409 Q11519624 Q12761956', 'Crime');
  add('Q53706 Q329425 Q1756454 Q2727213 Q5711091 Q7832904', 'Vol');
  add('Q318296 Q1371150', 'Enlèvement');
  add('Q168983 Q7625093 Q327541 Q350929 Q107434304', 'Incendie');
  add('Q179057 Q1362483', 'Explosion');
  add('Q8065 Q8068 Q2369493 Q8070', 'Catastrophe naturelle');
  add('Q1550225 Q12089136 Q68800046 Q1620824 Q977367 Q3193890', 'Catastrophe industrielle');
  add('Q9687 Q24871403 Q1339582 Q3305019 Q171558', 'Accident');
  add('Q906512 Q2620513', 'Naufrage');
  add('Q124757', 'Émeute');
  add('Q3839081', 'Catastrophe');
  return map;
})();

async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
  // Le service limite les requêtes simultanées : en cas de refus, on réessaie une fois après une pause.
  for (let attempt = 0; ; attempt++) {
    try {
      const json = await getJSON(url, { headers: { Accept: 'application/sparql-results+json' } });
      return json.results.bindings;
    } catch (error) {
      if (attempt >= 1) throw error;
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

const parsePoint = wkt => {
  const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(wkt || '');
  return m ? [parseFloat(m[2]), parseFloat(m[1])] : null;
};

/** « 1911-08-21T00:00:00Z » → [1911, « 21 août 1911 »] ; un 1er janvier vaut souvent « année seule ». */
function parseDate(raw) {
  if (!raw || raw.startsWith('-')) return null;
  const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
  if (!y || !(m >= 1 && m <= 12)) return null;
  if (m === 1 && d === 1) return [y, String(y)];
  return [y, `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`];
}

/** Affaires contre les personnes : jamais de nom de victime ou de suspect en titre. */
const isPersonal = category => family(category) === 'crime' && !category.startsWith('Vol');
const qid = uri => uri.split('/').pop();

/** Événements datés et géolocalisés des types retenus, pour toute la France métropolitaine. */
export async function fetchWikidataEvents() {
  const values = Object.keys(WIKIDATA_TYPES).map(id => `wd:${id}`).join(' ');
  const rows = await sparql(`SELECT ?e ?label ?desc ?coord ?date ?type ?article WHERE {
    VALUES ?type { ${values} }
    ?e wdt:P31 ?type ; wdt:P625 ?coord .
    FILTER(geof:latitude(?coord) > 41.2 && geof:latitude(?coord) < 51.2 && geof:longitude(?coord) > -5.3 && geof:longitude(?coord) < 9.7)
    OPTIONAL { ?e wdt:P585 ?d1 } OPTIONAL { ?e wdt:P580 ?d2 }
    BIND(COALESCE(?d1, ?d2) AS ?date) FILTER(BOUND(?date))
    ?e rdfs:label ?label FILTER(lang(?label) = "fr")
    OPTIONAL { ?e schema:description ?desc FILTER(lang(?desc) = "fr") }
    OPTIONAL { ?article schema:about ?e ; schema:isPartOf <https://fr.wikipedia.org/> }
  }`);
  const seen = new Set();
  const facts = [];
  for (const b of rows) {
    const id = qid(b.e.value);
    if (seen.has(id)) continue;
    const point = parsePoint(b.coord?.value);
    const date = parseDate(b.date?.value);
    if (!point || !date) continue;
    seen.add(id);
    const category = WIKIDATA_TYPES[qid(b.type.value)] ?? 'Fait divers';
    const personal = isPersonal(category);
    const article = b.article?.value;
    facts.push(makeFact({
      id: `wd-${id}`,
      title: personal ? `${category} · ${date[1]}` : capitalizedFirst(b.label.value),
      summary: personal ? 'Affaire référencée par Wikidata. Le récit complet est dans la source.'
        : (b.desc ? capitalizedFirst(b.desc.value) + '.' : 'Événement référencé dans Wikidata.'),
      category, place: 'Lieu indiqué par Wikidata', lat: point[0], lon: point[1], date: date[1], year: date[0],
      sourceName: article ? 'Wikipédia · Wikidata' : 'Wikidata', sourceURL: article ?? b.e.value,
    }));
  }
  return facts;
}

/** Affaires, accidents et catastrophes sans coordonnées propres, placés à leur lieu ou à leur commune. */
async function fetchLocated(root, fallback) {
  const rows = await sparql(`SELECT ?e ?label ?coord ?date ?type ?typeLabel ?placeLabel ?article WHERE {
    ?e wdt:P17 wd:Q142 ; wdt:P31 ?type . ?type wdt:P279* wd:${root} .
    FILTER NOT EXISTS { ?e wdt:P625 [] }
    OPTIONAL { ?e wdt:P276 ?p1 . ?p1 wdt:P625 ?c1 . ?p1 rdfs:label ?l1 FILTER(lang(?l1) = "fr") }
    OPTIONAL { ?e wdt:P131 ?p2 . ?p2 wdt:P625 ?c2 . ?p2 rdfs:label ?l2 FILTER(lang(?l2) = "fr") }
    BIND(COALESCE(?c1, ?c2) AS ?coord) FILTER(BOUND(?coord))
    BIND(COALESCE(?l1, ?l2) AS ?placeLabel)
    OPTIONAL { ?e wdt:P585 ?d1 } OPTIONAL { ?e wdt:P580 ?d2 }
    BIND(COALESCE(?d1, ?d2) AS ?date) FILTER(BOUND(?date))
    ?e rdfs:label ?label FILTER(lang(?label) = "fr")
    ?type rdfs:label ?typeLabel FILTER(lang(?typeLabel) = "fr")
    OPTIONAL { ?article schema:about ?e ; schema:isPartOf <https://fr.wikipedia.org/> }
  }`);
  const groups = new Map();
  for (const b of rows) {
    if (!groups.has(b.e.value)) groups.set(b.e.value, []);
    groups.get(b.e.value).push(b);
  }
  const facts = [];
  for (const [entity, group] of groups) {
    const first = group[0];
    const date = parseDate(first.date?.value);
    if (!date) continue;
    const placed = group.find(r => { const p = parsePoint(r.coord?.value); return p && inFrance(p[0], p[1]); });
    if (!placed) continue;
    const [lat0, lon0] = parsePoint(placed.coord.value);
    const placeName = placed.placeLabel?.value ?? 'France';
    const typed = group.find(r => WIKIDATA_TYPES[qid(r.type.value)]) ?? first;
    const typeLabel = typed.typeLabel?.value ?? fallback;
    let category = WIKIDATA_TYPES[qid(typed.type.value)] ?? capitalizedFirst(typeLabel);
    if (family(category) === 'history') category = fallback;
    const id = qid(entity);
    const [lat, lon] = jitter(lat0, lon0, id);
    const personal = isPersonal(category);
    const article = first.article?.value;
    facts.push(makeFact({
      id: `wdl-${id}`,
      title: personal ? `${capitalizedFirst(typeLabel)} à ${placeName}` : capitalizedFirst(first.label.value),
      summary: personal
        ? `Fait survenu à ${placeName} (${date[1]}), classé « ${typeLabel} » par Wikidata. Le récit complet est dans la source.`
        : `Événement survenu à ${placeName}, référencé par Wikidata.`,
      category, place: `${placeName} (position approximative)`, lat, lon, date: date[1], year: date[0], approx: true,
      sourceName: article ? 'Wikipédia · Wikidata' : 'Wikidata', sourceURL: article ?? entity,
    }));
  }
  return facts;
}

export async function fetchWikidataLocatedEvents() {
  // Une requête après l'autre, pour ne pas dépasser la limite de Wikidata.
  const facts = [];
  for (const [root, fallback] of [['Q83267', 'Crime'], ['Q171558', 'Accident'], ['Q3839081', 'Catastrophe']]) {
    try { facts.push(...await fetchLocated(root, fallback)); } catch { /* famille suivante */ }
  }
  const seen = new Set();
  return facts.filter(f => !seen.has(f.id) && seen.add(f.id));
}

// ───────────────────────── Géorisques (CatNat) ─────────────────────────

/** Arrêtés de catastrophe naturelle des communes à moins de 10 km d'un point arrondi à ~1 km. */
export async function fetchCatNat(lat, lon) {
  const communes = await loadCommunes();
  const qLat = Math.round(lat * 100) / 100, qLon = Math.round(lon * 100) / 100;
  const facts = [];
  const seen = new Set();
  let page = 1, total = 1;
  do {
    let json;
    try {
      json = await getJSON(`https://georisques.gouv.fr/api/v1/gaspar/catnat?latlon=${qLon},${qLat}&rayon=10000&page=${page}&page_size=100`);
    } catch { break; }
    total = json.total_pages ?? 1;
    for (const it of json.data ?? []) {
      const c = communes.get(it.code_insee);
      const start = it.date_debut_evt, risk = it.libelle_risque_jo;
      if (!c || !start || !risk) continue;
      const key = `${it.code_national_catnat ?? start}-${it.code_insee}-${risk}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const year = parseInt(start.slice(-4), 10) || 0;
      const [la, lo] = jitter(c.lat, c.lon, key);
      const end = it.date_fin_evt ?? start;
      const period = start === end ? `le ${start}` : `du ${start} au ${end}`;
      const journal = it.date_publication_jo ? ` (arrêté publié au Journal officiel le ${it.date_publication_jo})` : '';
      facts.push(makeFact({
        id: `catnat-${key}`, title: `${capitalizedFirst(risk.toLowerCase())} à ${c.name}`,
        summary: `L’état de catastrophe naturelle a été reconnu pour la commune de ${c.name} : ${risk.toLowerCase()}, ${period}${journal}.`,
        category: 'Catastrophe naturelle', place: `${c.name} · centre de la commune`, lat: la, lon: lo,
        date: start, year, approx: true, sourceName: 'Géorisques · arrêté CatNat', sourceURL: 'https://www.georisques.gouv.fr/',
      }));
    }
    page++;
  } while (page <= Math.min(total, 10));
  return facts;
}

// ───────────────────────── Wikipédia ─────────────────────────

/** Résumé et illustration d'un article de Wikipédia en français. */
export async function fetchWikipediaSummary(articleURL) {
  const m = /wikipedia\.org\/wiki\/(.+)$/.exec(articleURL);
  if (!m) return {};
  try {
    const j = await getJSON(`https://fr.wikipedia.org/api/rest_v1/page/summary/${m[1]}`);
    return { extract: j.extract, image: j.thumbnail?.source };
  } catch { return {}; }
}

// ───────────────────────── Baromètre (SSMSI) ─────────────────────────

export const CRIME_RESOURCES = {
  commune: '44ef4323-1097-48d5-8719-3c544b55d294',
  department: '2b27a675-e3bf-41ef-a852-5fb9ab483967',
};

export async function communeAt(lat, lon) {
  for (const type of ['arrondissement-municipal', 'commune-actuelle']) {
    try {
      const list = await getJSON(`https://geo.api.gouv.fr/communes?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&type=${type}&fields=nom,code,codeDepartement`);
      if (list[0]) return list[0];
    } catch { /* type suivant */ }
  }
  return null;
}

export async function crimeRows(resource, filter) {
  let next = `https://tabular-api.data.gouv.fr/api/resources/${resource}/data/?${filter}&page_size=200`;
  const rows = [];
  for (let pages = 0; next && pages < 5; pages++) {
    let page;
    try { page = await getJSON(next); } catch { break; }
    for (const d of page.data) {
      rows.push({ indicator: d.indicateur, unit: d.unite_de_compte ?? '', year: d.annee, count: d.nombre, rate: d.taux_pour_mille, diffused: d.est_diffuse !== 'ndiff' });
    }
    next = page.links?.next;
  }
  return rows;
}
