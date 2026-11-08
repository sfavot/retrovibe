# Flight of the Amazon Queen : groupe 4, vallée, hôtel et course de voiture (vague L)

Code : `src/games/fotaq/engine/specials/group-4/` (`ids.ts`, `moves.ts`, `areas.ts`, `car-data.ts`, `index.ts`) ; tests : `test/fotaq/specials/group-4/` (`moves.test.ts`, `areas.test.ts`, `walkthrough.test.ts`) ; solution : `test/fotaq/specials/group-4/solution.ts` (à brancher dans `GROUP_SOLUTIONS[4]` par le coordinateur : `group4Solution`). Source : `engines/queen/logic.cpp` et `graphics.cpp` de ScummVM (GPL v3 ou ultérieure), lus et réécrits.

## 1. Cas portés

| Élément | ScummVM | Où |
| --- | --- | --- |
| 2, 3, 4 : Joe met la robe, ses vêtements, les sous-vêtements (sans cinématique) | `asmMakeJoeUseDress`, `asmMakeJoeUseNormalClothes`, `asmMakeJoeUseUnderwear` | `moves.ts` (fonctions du moteur `joeUse*`) |
| 5, 6 : palette de la robe, palette normale (la tenue ne change pas) | `asmSwitchToDressPalette`, `asmSwitchToNormalPalette` (DOS) | `moves.ts` |
| 7 : la course commence (`flag = Play`, `prepare`) ; 8 : elle finit (`Stop`, bob de l'huile 594 et bob 7 éteints) | `asmStartCarAnimation`, `asmStopCarAnimation` | `moves.ts` |
| 31 : attendre la ligne 60 de la table (la voiture sous le camion, avant l'huile) | `asmWaitForCarPosition` | `moves.ts` |
| 32 : l'écran remonte de 3 lignes une image, puis revient (le choc de l'avion, `C75B`) | `asmShakeScreen` (DOS) | `moves.ts` |
| `handleSpecialArea`, pièce 71 : Joe dit « Je ne peux pas l'atteindre » (réponse 21) | `ROOM_HOTEL_DOWNSTAIRS` | `areas.ts` |
| `handleSpecialArea`, pièce 73 : `C73A` (Joe en sous-vêtements), `C73B`, `C73C` selon l'état 93 | `ROOM_HOTEL_LOBBY` | `areas.ts` |
| `roomUpdates`, pièce 74 : une ligne de `CAR_DATA` (75 lignes, extraites de `_carData`) par image | `Graphics::update`, `BamScene::updateCarAnimation` | `index.ts`, `car-data.ts` |

Aucune `specialRooms` : les pièces 64 à 68, 70, 72 et 76 n'ont pas de logique codée en dur (la parallaxe de la pièce 67 est déjà dans le moteur) ; elles suivent les données.

## 2. Écarts à ScummVM

- 31 rend aussi la main quand la course est arrêtée (`BamFlag.Stop`) : ScummVM bouclerait sans fin sur une ligne qui n'arrive plus.
- 2 à 4 : sans cinématique (`showCut` faux), comme `joeUseDress(false)` etc. ; la cinématique `CDRES` vient du verbe « Utiliser la robe » (moteur).
- `C73A` à `C73C` : la suite éventuelle de la cinématique n'est pas enchaînée (ScummVM appelle `playCutaway` sans `nextCut`).
- Le hasard et la cadence sont ceux du moteur ; la course tourne à une ligne par image de 100 ms.

## 3. Besoins hors dossier

- `bam.ts` : `BamScene.index` est désormais un accesseur en lecture (fait par le coordinateur ; le mouvement 31 et les tests le lisent).
- logic.cpp l.1403 n'est pas dans `displayRoom` mais dans **`Logic::setupRestoredGame`** (chargement d'une partie) : `prepareAnimation` si la course ou le combat est en marche. **Fait en vague S** : `BamScene.restore` rappelle `prepare` au chargement (et reprend la ligne de la table), voir `engine.md` § 12 ; l'`it.todo` de `moves.test.ts` est remplacé par `test/fotaq/save/restore.test.ts`.

## 4. Corrections de la solution (`specials.md` § 7, groupe 4)

Rejouées à la souris par `walkthrough.test.ts` (passages 4a et 4c ; le 4b, pièces 62 et 63, est du groupe 3) :

- **Étape 10 obligatoire** : déplacer l'échelle O550 (`c71a`) est nécessaire avant de prendre O556 et O557 ; sans elle Joe traverse la zone éteinte de la pièce 71 et répond « Je ne peux pas l'atteindre ».
- Étape 25 : « Utiliser I56 robe » joue `CDRES.CUT` (le moteur) et c'est là que **I58 vêtements** arrive dans l'inventaire (pas à `c73e`).
- Étape 32 / arrivée 4a : à l'arrivée en pièce 75, **I58 n'est plus dans l'inventaire** (le mouvement 3 de `C74A` remet les vêtements) ; l'inventaire est I1, I2, I54, I59, I60, I61 ; `gs202 = 0`. États en plus de la liste : gs47 = 2, gs48 = 1, gs59 = 2, gs60 = 1, gs61 = 1.
- Étapes 70 à 77 (4c), départ `{ room: 76, items: [23, 17, 3, 15], states: { 9: 2, 45: 2, 138: 1 } }` : après `c66a` (étape 74) **Joe est en pièce 68**, pas 66 : il faut repasser par O509 (68 vers 66) puis O495 (66 vers 65) avant O491 ; à l'étape 77 le passage O502 est à l'extrémité droite de la pièce 67 (défilement à plus de 237) : il faut d'abord marcher vers la droite. Arrivée : pièce 69, Joe en (147, 145), gs148 = 1 et gs157 = 1 en plus des états listés.

## 5. Solution

`solution.ts` exporte `startGroup4` / `solveGroup4` (4a : pièce 70 vers pièce 75, finit sur le menu de `and1.DOG`), `group4Solution` (`GroupSolution` pour `GROUP_SOLUTIONS[4]`) et `startGroup4c` / `solveGroup4c` (4c). L'enchaînement 4a, 5a, ..., 4b, 4c sur un seul moteur est la partie complète (`full-game.test.ts`, `PLAY_ORDER`) ; 4c y part de l'étal de Bob (O149, puis O135 qui joue `C76A`).
