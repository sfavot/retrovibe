# Flight of the Amazon Queen : groupe 2, Floda (vague L)

Code : `src/games/fotaq/engine/specials/group-2/` (`ids.ts`, `moves.ts`, `areas.ts`, `index.ts`). Tests : `test/fotaq/specials/group-2/` (`moves.test.ts`, `areas.test.ts`, `walkthrough.test.ts`, solution dans `solution.ts`). Référence : `engines/queen/logic.cpp` de ScummVM (GPL v3 ou ultérieure), lu et réécrit. Pièces du groupe : 22 à 42 et 103 ; aucune n'a de cas `changeToSpecialRoom` ni d'animation de pièce (`roomUpdates`) : les cas de cinématique (`c41f`) sont dans le moteur.

## 1. Ce qui est porté

| Élément | ScummVM | Où |
| --- | --- | --- |
| 19 : Azura amoureuse (état 167 à 1) | `asmSetAzuraInLove` | `moves.ts` |
| 21, 22 : lumières éteintes, allumées (palette de la pièce courante ; couleurs 32 à 223 seulement à la réception) | `asmSetLightsOff`, `asmSetLightsOn` (`palCustomLightsOff/On`) | `moves.ts` (`Palette.lightsOff/On` existaient) |
| 23 : la zone 7 de la réception s'allume (`mapNeighbors` en valeur absolue) | `asmSetManequinAreaOn` | `moves.ts` |
| 25 : gardes allumés (état 85 à 1) | `asmTurnGuardOn` | `moves.ts` |
| zones éteintes : pièce 22 -> `C22A`, 26 -> `C26B`, 30 -> `C30A`, 32 -> `C32C` | `handleSpecialArea` | `areas.ts` |
| zone 3 de la réception (103) : état 35 à 0 -> `C103B` et état 35 à 1 ; état 35 à 1 -> `C103E` ; autre : rien | `handleSpecialArea`, `ROOM_FLODA_FRONTDESK` | `areas.ts` |

Le mouvement 20 (lumières de l'ascenseur) n'existe pas dans la version DOS ; 21 à 23 ne sont lancés que par `C103F`, `C103I` à `C103K`, `C25E`.

**Écarts** : à la réception, l'état 35 est posé avant la cinématique `C103B` (ScummVM le pose après, la cinématique ne le lit pas) car le moteur enchaîne la cinématique rendue par le cas de pièce. Pas d'autre écart.

## 2. Solution (`solution.ts`) et corrections de `specials.md` § 7

Les 49 étapes de 2a sont jouées à la souris (`solveGroup2`, du piton à la pièce 22, Joe en (194,147), états d'arrivée du § 7 vérifiés par `walkthrough.test.ts`). 2b (étapes 50 à 54) est jouée par `solveGroup2b` : c'est un second morceau, **après le temple** dans l'ordre de jeu (`PLAY_ORDER`, liste de passages, joue `solveGroup2b` entre le groupe 3 et 4c ; `GROUP2_SOLUTION` ne couvre que 2a).

Corrections et précisions :

1. **Départ** : la banane (I7, pièce 4) est ajoutée à l'inventaire du départ isolé : la cueillir (étape 1) demande le pont de la pièce 4, allumé par le groupe 1 (une zone, pas un état). Dans la partie complète, `fetchBanana` joue l'étape 1 (piton O42 -> 6 -> 5 -> 3 -> 4, O26, retour par O39) : la pièce 6 ne rejoue plus `C6C` (groupe 1 porté). L'état de départ est `{ room: 7, items: [58, 7, 3, 40, 20, 19, 24, 10, 14, 12, 21, 95], states: { 30: 1, 51: 1, 103: 1 } }`.
2. **Étape 2** : la porte O167 ne s'ouvre **pas** à l'arrivée : elle est derrière le chien (zone 10 de la pièce 22, éteinte tant que le jouet n'est pas donné) et `Ouvrir O167` joue `C22A`. Elle s'ouvre à l'étape 42.
3. **Étape 4** : l'aspirateur n'est pas consommé (I20 reste dans l'inventaire, état 28 à 1) ; c'est cohérent avec l'état d'arrivée du § 7.
4. **Étapes 5 à 9** : l'ordre est **chef (étapes 8 et 9), puis croquettes et nourriture (6 et 7)** : le comptoir de la cuisine (zone 2) est éteint tant que le chef est là, et marcher vers les croquettes joue `C26B` sans rien prendre.
5. **Étape 31** : I31 (livre) reste dans l'inventaire après la clef (le § 7 dit retiré).
6. **Étape 48** : « Vous avez une mémoire impressionnante! » n'est pas un choix : la réplique suit sans menu.
7. **Étape 51** : `C41B` ne ramène **pas** Joe en pièce 22 : il reste en pièce 41 en (214,123) (comportement de `Cutaway::stop` de ScummVM, `joeRoom == temporaryRoom`). Il faut le ramener à pied : 41 (O303) -> 40 (O285) -> 29 (O223) -> 28 (O220) -> 25 (O195) -> 103 (O724) -> 22 (O165, piton).
8. **Étape 52** : arrivé en 21, Bob lance son dialogue forcé `bob5.DOG` (`c21l`) s'il n'a pas eu lieu en 1b : « Pourquoi avez-vous besoin de mon aide? » > « D'accord, je vous aiderai. » > « Pourquoi pensez-vous que c'est la Flöda... » > « Bon, maintenant que je connais les détails... ». `solveGroup2b` le joue si un menu est affiché.
9. **Étape 50 (résolu par le coordinateur)** : Joe sort de `C62C` en (136,102), sur la corniche (zones 4 et 8 : l'intérieur de la cellule). La porte de la prison vue du couloir est en (200,119) (zone 2) : le chemin traverserait la zone 3 éteinte. Mais **`C152` (prendre le crâne de cristal, pièce 63, groupe 3) copie l'objet 302 sur le 296** : la porte devient celle vue de la cellule, en (220,103), zone 8, et `Utiliser tasse + porte` se joue depuis la corniche. Le départ isolé de 2b n'avait pas cette copie : c'était l'état oublié, pas la marche (`specials.md` § 7, « La solution définitive », point 1).
10. **Départ de 2b** : la corniche, avec `{ 9: 1, 28: 1, 30: 2, 39: 1, 45: 2, 108: 1, 195: 1, 201: 1 }`, la tasse montrée (`shown: [294]`, `C352`), la porte vue de la cellule (`copies: [[302, 296]]`, `C152`) ; `setupGroup2b` place Joe en (136,102) et rallume la zone 3 de la réception (posée par `C103L` ; une zone n'est pas un état).

## 3. Besoins hors dossier

Aucun. Observation : dans la pièce 6, `C6C` se rejouait en boucle avant le groupe 1 ; vérifié depuis par la partie complète (la pièce 6 est traversée en 1a et en 2a sans `C6C`).

## 4. Points ouverts

- `bob5.DOG` et `c21l` : chemin joué, mais pas comparé à la soluce d'origine.
