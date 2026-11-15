# The Incredible Machine 3 : solutions des puzzles (vague K)

Légende : **vérifié** au banc Unicorn (le binaire déclare le puzzle réussi, `# goal 2`) et dans le moteur TypeScript ;
**observé** sur les données ; **supposé**.

## 1. Pièces du concepteur (observé, vérifié au banc)

Le jeu n'a ni démonstration ni commande « placer la solution » (`formats.md` § 5), **mais chaque LEV garde, dans les
enregistrements des pièces du bac, la position où le concepteur les a posées** :

- les pièces du bac **sans** le bit `0x100` de `flags3` sont à la place qu'elles occupent dans la solution du concepteur
  (position, retournement, taille, image d'édition, liens : courroie, corde et poulies, fiche) ;
- les pièces du bac **avec** `0x100` sont des leurres (rangées en bas de l'aire ou en grille) ; une corde ou une courroie
  (jamais marquée) dont une pièce est un leurre en est un aussi (HLEV16 : câble entre deux taquets leurres).

Vérifié : poser exactement ces pièces (et rien d'autre) résout au banc **les 156 puzzles solo** (TLEV, ELEV, MLEV, HLEV,
RLEV ; puzzle non résolu sans elles : vérifié pour les 40 TLEV sur 1 500 pas) ; les 949 positions sont sur la grille de
l'éditeur (42f24a). Le rôle de `0x100` dans l'exe n'est pas établi (le chargeur 43173e le garde dans +0x14, la physique ne
le lit pas). Les HH (duels) suivent le même format : 47 / 50 résolus au banc en mode puzzle (HH15, HH33, HH38 non).

Ce sont donc ces solutions qui servent de tests ; `scripts/tim3/solution-extract.mts` en tire un brouillon JSON, mesuré
ensuite au banc. Une solution écrite à la main (autre placement) suit le même format.

## 2. Format (`test/tim3/solutions/<LEV>.json`, versionné)

```json
{
  "level": "TLEV31",
  "goalStep": 50,
  "note": "Pièces du concepteur (bac sans le bit 0x100).",
  "parts": [
    {"part":8,"type":90,"x":466,"y":275},
    {"part":10,"type":89,"x":302,"y":184},
    {"part":6,"type":10,"rope":[{"part":8,"slot":0},{"part":10,"slot":0}],"via":[0],"ropeLength":82},
    {"part":16,"type":8,"belt":[8,2]}
  ]
}
```

| champ | sens |
| --- | --- |
| `goalStep` | premier pas après lequel le test de but (436dc6) rend 2, **mesuré au banc** ; le jeu arrête la machine 30 images plus tard |
| `part`, `type` | index de la pièce dans le LEV (`levelParts` : fixes puis mobiles) et son type (contrôle) ; la pièce doit être **au bac** |
| `x`, `y` | coin haut-gauche, position d'édition en pixels de l'aire (568 × 378) |
| `flip` | `none`, `x` (bit 0x10 de +0x10), `y` (0x20), `xy` |
| `width`, `height` | taille d'une pièce étirable (bornes d'édition +0x3C / +0x40 du type non nulles : murs, pentes, tapis…) |
| `appearance` | image d'édition (+0x1C) : état choisi dans l'éditeur (angle d'un miroir, couleur d'une prise…) |
| `belt` | courroie (8) : les deux pièces reliées |
| `rope`, `via`, `ropeLength` | corde ou câble (10, 76) : bouts `{part, slot}` (point d'attache 0 ou 1), poulies traversées du bout 1 vers le bout 2, longueur de segment |
| `plug` | pièce à fiche : `{part, outlet}` = prise et sa sortie (0 ou 1) |

Les champs absents gardent la valeur de l'enregistrement du bac (écrit par le jeu lui-même). Les pièces sont posées dans
l'ordre de la liste (une corde ou une courroie après ses pièces). « Bac » = ce que le chargement du puzzle y range (43267a,
`World.stowUnlocked`) : les pièces non verrouillées **et** les cordes, courroies et poulies qu'elles entraînent (TLEV31 :
deux courroies du puzzle tendues vers des pièces du bac partent au bac).

## 3. Outils

- `test/tim3/solutions/apply.ts` : `applySolution(level, solution)` → LEV modifié. Défait d'abord tout lien vers le bac et
  déverrouille les pièces du bac (comme 43267a), puis verrouille (bit 0x40) chaque pièce posée et écrit les champs que
  l'éditeur pose (42f24a → 42f4c4 … 42f5f9 ; liens 42ee68, 42ed3f, 438ea8, traduits dans `engine/editor.ts`) et que le
  chargeur 43173e relit :
  - courroie : `beltPart1/2`, bit 0x2 de `flags2` sur les deux pièces ;
  - corde : `ropePart1/2`, `ropeEnd1/2Usage` ; chaque bout désigne dans `connected<slot+1>` l'élément voisin de la chaîne
    (l'autre bout ou une poulie) ; une poulie traversée : `pulleyPart1` = suivante (vers le bout 2), `pulleyPart2` =
    précédente, `ropeIndex` = la corde ;
  - fiche : `plugged1` de la pièce = prise, `plugged<sortie+1>` de la prise = pièce.
  `binIndices(level)` rend le bac du moteur. `formatSolution` écrit le JSON (une ligne par pièce).
- `scripts/tim3/solution-extract.mts LEV… [--force] [--dir D]` : brouillon tiré des pièces du concepteur (`goalStep` à 0).
- `scripts/tim3/solution-check.mts --out D [LEV…] [--bench <banc> --update --traces --steps N --solutions D2]` : écrit
  les LEV modifiés dans `D` ; avec `--bench`, les fait tourner (`bench.py trace --lev … --format v2`), compare ou écrit
  (`--update`) `goalStep`, et garde la trace v2 (pas 0 … `goalStep` + 31) dans `test/tim3/traces/solutions/` (non
  versionné) avec `--traces`.
- `test/tim3/solutions/solutions.test.ts` : pour chaque JSON, LEV modifié chargé dans le moteur ; contrôles de jouabilité
  (pièces posées hors du bac, sur la grille de 42f24a, dans l'aire, sans chevauchement 437208) ; puzzle réussi
  (`GoalTest`, `engine/goals.ts`) **au pas `goalStep`** ; si la trace du banc est là, chaque pas jusqu'à `goalStep` + 31
  est comparé (x, y, vx, vy, drapeaux, image +0x18 de chaque pièce).

Marche à suivre pour une catégorie :

```
npx vite-node scripts/tim3/solution-extract.mts MLEV1 … MLEV30
npx vite-node scripts/tim3/solution-check.mts --out <scratch>/levs --bench <scratch>/bench-tim3 --update --traces MLEV1 …
npx vitest run test/tim3/solutions          # TIM3_SOLUTIONS_DIR=<dossier> pour des JSON hors du dépôt
```

## 4. État

| catégorie | solutions | banc | moteur (pas et trace) |
| --- | --- | --- | --- |
| TLEV1-40 | 40 (concepteur) | 40 / 40 | 40 / 40 |
| ELEV, MLEV, HLEV, RLEV | 116 (concepteur ; ELEV22, HLEV9 retouchés) | 116 / 116 | 116 au pas du banc sauf ELEV18, RLEV3 ; trace identique sauf 11 |
| HH1-50 (HH23, HH27 versionnés pour le match de `test/tim3/editor/duel.test.ts` ; les autres non versionnés) | brouillons du concepteur | 47 / 50 (HH15, HH33, HH38 non résolus en mode puzzle) | 42 / 50 au pas du banc (brouillons du scratchpad, `TIM3_SOLUTIONS_DIR`) ; HH23, HH27 aussi posés par l'éditeur |

**Chevauchement (437208)** : aux places du concepteur, les explosifs télécommandés (55) d'ELEV22 et HLEV9 chevauchent un
mur ; l'appel de 437208 du binaire au banc (après chargement du LEV) le confirme : l'éditeur refuserait la pose. Aucune
exception de type dans 437208 (seules les paires de 4371af : chat, souris, fromage, Mel et sa maison) ; le contrôle du
test est donc juste et ces deux solutions déplacent les explosifs (4 px vers le haut, 7 px à gauche), toujours résolues au
banc.

**Divergences moteur connues** (tests en `it.fails`, liste `KNOWN_DIVERGENCES` du test, confiées au noyau) : ELEV1,
ELEV18, HLEV19, RLEV3 (image +0x18 du type 54), MLEV12, HLEV21, HLEV28 (type 79), MLEV24, HLEV5 (ballon 4), MLEV18
(seau 17), RLEV22 (type 72) ; ELEV18 et RLEV3 réussissent en outre à un autre pas (487 / 486, 193 / 221).

Pas de réussite des TLEV : de 2 (TLEV30, lasers) à 214 (TLEV32).

## 5. Limites

- **Ordre des listes** : le chargeur insère les pièces avec `loading` vrai (4393e0), l'éditeur sans ; seules les pièces à
  `+0x14 & 0x1000` en dépendent (fin de liste au chargement, avant la première pièce `0x1000` à la pose). Une solution
  validée par LEV pourrait donc diverger d'une pose à la souris si elle en contient (supposé rare, non mesuré).
- **Non contrôlé par le test** : branchement automatique d'une fiche à moins de 8 px (438ea8), distance maximale d'une
  courroie (140 px, 438932), longueur de corde recalculée par l'éditeur, bornes de taille ; ces règles sont dans
  `engine/editor.ts` (rejouer la solution par l'éditeur serait le contrôle complet).
- `appearance`, longueur de corde et taille non données reprennent l'enregistrement : pour une pièce posée ailleurs que
  chez le concepteur, une pente étirée ou une poulie autrement traversée doivent les donner.
