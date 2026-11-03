# Fediv — web app

Une carte des faits divers de France, racontés comme dans un vieux journal : grandes affaires, accidents, incendies, catastrophes naturelles et faits d'histoire, à l'endroit même où ils se sont produits.

C'est la version web de l'app iOS Fediv. Elle tourne entièrement dans le navigateur, sans serveur ni compte.

## Fonctions

- **Carte** au plan IGN, façon gravure ou en couleurs, avec regroupement des épingles.
- **Rubriques** : Histoire (seule affichée au lancement), crimes et vols, attentats, accidents, incendies, explosions, catastrophes naturelles, pollutions.
- **Époques** : Belle Époque, guerres, seconde moitié du XXe siècle, aujourd'hui.
- **La chronique** : les récits visibles sur la carte, du plus proche au plus lointain.
- **Article « à la une »** avec le résumé de Wikipédia et une gravure, fiche signalétique, lien vers la source, itinéraire et partage (lien direct `#fait=…`).
- **Remonter le temps** : le lieu vu par l'IGN en 1950-1965 et aujourd'hui (rideau à glisser), et sur la carte d'état-major (1820-1866).
- **La Une du jour** : ce qui s'est passé un jour comme aujourd'hui.
- **Circuits** : balades thématiques de 4 à 7 étapes.
- **Carnet d'enquêteur** : tampons des récits lus et insignes.
- **Qui a fait le coup ?** : dix affaires anciennes à résoudre.
- **Le baromètre** : délinquance enregistrée dans la commune, comparée au département.
- **Mode promenade** : une alerte « Extra ! Extra ! » en passant près d'un lieu.
- **Réglages** : apparence claire ou sombre, papier plus ou moins jauni, sons, taille du texte.

## Sources

| Source | Contenu | Mode |
| --- | --- | --- |
| Wikipédia et Wikidata | 580 faits historiques | fichier `data/histoire.json` |
| Wikidata | accidents, attentats, crimes, naufrages… géolocalisés, et environ 1 200 affaires placées à leur commune | en direct (SPARQL) |
| ARIA (BARPI) | 46 000 accidents industriels, 1966-2020 | fichiers `data/aria-index.json` et `data/aria/*.json`, chargés à la demande |
| Géorisques | arrêtés de catastrophe naturelle | en direct, autour du centre de la carte |
| SSMSI (data.gouv.fr) | délinquance enregistrée par commune et département | en direct |
| IGN Géoplateforme | plan IGN, photographies aériennes, carte d'état-major | tuiles en direct |

## Règles éthiques

- Pas de noms de victimes, de mineurs ou de personnes simplement mises en cause. Les affaires criminelles issues de Wikidata sont titrées par la nature des faits et le lieu, sans extrait ni photo de Wikipédia.
- La position de l'utilisateur ne quitte pas l'appareil. Seuls les arrêtés CatNat sont demandés autour du centre de la carte, arrondi à environ 1 km.

## Lancer en local

Le site est statique : il suffit d'un petit serveur.

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Structure

```
index.html            page unique
css/style.css         style « vieux journal », clair et sombre
js/app.js             carte, filtres, chronique et toutes les vues
js/sources.js         chargement des sources (fichiers et services publics)
js/rubrics.js         rubriques, couleurs et époques
js/store.js           réglages, carnet et sons (localStorage, Web Audio)
data/                 données préparées depuis l'app iOS
icons/                icône de l'app
```
