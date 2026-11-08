# Flight of the Amazon Queen : groupe 5 (la fin du jeu)

Code : `src/games/fotaq/engine/specials/group-5/` (`ids.ts`, `fight-data.ts`, `fight.ts`, `ending.ts`, `index.ts`) ; tests : `test/fotaq/specials/group-5/` (`moves.test.ts`, `walkthrough.test.ts`, `solution.ts`). Source : `engines/queen/logic.cpp` (`asm*`) et `graphics.cpp` (`BamScene`), ScummVM, GPL v3 ou ultérieure, lus et réécrits. Convention : `specials.md` § 1 à 5.

## 1. Ce qui est porté

| Élément | ScummVM | Où |
| --- | --- | --- |
| 9 : le combat repart (`flag = Play`, `prepare`, état 148 = 1) | `asmStartFightAnimation` | `fight.ts` |
| 10 : le combat s'arrête à la fin de son cycle (`RequestStop`, images jusqu'à `Stop`) | `asmWaitForFrankPosition` | `fight.ts` |
| 11, 12 : Frank, puis le robot, grandit (image 38 de la banque de la pièce, échelle 10 à 98 % par 4, 21 images) ; objets 521 à 526 et état 157 | `asmMakeFrankGrowing`, `asmMakeRobotGrowing` (DOS) | `fight.ts` |
| 13 : le robot (bob 6) rapetisse de 100 à 35 % par 5 | `asmShrinkRobot` (DOS seulement) | `fight.ts` |
| animation de la pièce 69 : une ligne de table par image, trois tables tirées au hasard | `Graphics::update` → `BamScene::updateFightAnimation` | `fight.ts` (`roomUpdates[69]`), tables dans `fight-data.ts` |
| 14 : quarante images puis fin de la partie (`g.endGame()`, l'hôte quitte) | `asmEndGame` | `ending.ts` |
| 26 : panoramique de 320 à 144 par pas de 8 | `asmPanLeft320To144` | `ending.ts` |
| 27 : Azura et Joe avancent ensemble pendant que le décor défile vers 320 | `asmSmooch` (DOS) | `ending.ts` |
| 28 : l'avion traverse l'écran en grossissant, l'éclair le frappe, il plonge dans la jungle (`C75B`) | `asmMakeLightningHitPlane` (DOS) | `ending.ts` |
| 29 : le dirigeable s'éloigne en rapetissant | `asmScaleBlimp` (DOS) | `ending.ts` |
| 30 : l'écran de fin grossit de 5 à 100 %, cinquante images, fondu au noir | `asmScaleEnding` (DOS) | `ending.ts` |

**Pas de `specialRooms` ni de `specialAreas`** : aucune pièce du groupe (69, 75, 104 à 114, 126) n'a de cas dans `changeToSpecialRoom` ni dans `handleSpecialArea` de ScummVM. Le mouvement 32 de `C75B` (la secousse de l'écran) est du groupe 4 ; `kit.shake` n'est utilisée ici que par `BamScene` (sfx 1 et 3 du combat).

Les tables du combat (`_fight1Data` à `_fight3Data`, 46, 55 et 79 lignes) sont **recopiées par script** depuis `graphics.cpp` ; `_fight4Data` (Amiga) n'est pas portée.

## 2. Écarts à ScummVM

- Version DOS seulement : 11 et 12 (échelle du bob au lieu du défilement vertical de l'Amiga), 13, 27 (`asmSmooch`, pas `asmSmoochNoScroll`), 28, 29 et 30 (mise à l'échelle).
- 10 et 29 s'arrêtent aussi si la partie se termine (`g.ended`) ; ScummVM n'a pas ce cas (`shouldQuit` pour 29, aucun pour 10).
- 14 : `g.endGame()` (`host.exit`, la séquence s'arrête à son prochain `yield`) à la place de `quitGame()`.
- 26 : ne fait rien si le défilement est déjà sous 144 (ScummVM : la boucle ne s'exécute pas ; `panTo` aurait sauté à 144).
- 29 ne s'arrête pas à la demande de passage de la cinématique (ScummVM non plus) : le dirigeable dure **~2 100 images** (bob 7 en (360, 183) au départ), soit 3 min 30 de jeu, pendant lesquelles se déroule le générique de fin (`#credit2.crd`). Passer `C69G` par Échap ne raccourcit donc pas la fin (3 400 ticks au total).
- Le hasard des tables est `g.rng` (`BamScene.updateFight`, commun).

## 3. Solution du jeu : corrections et choix (§ 7 de `specials.md`)

Le groupe est visité en deux temps, **non contigus** (5a avant le site du crash, 5b après toute la vallée). `solution.ts` exporte donc :
- `solution` (`GroupSolution`) : le passage 5b, de la vallée à la fin du jeu ; c'est celui qui boucle « jusqu'à `endGame` » ;
- `crashSolution` : le passage 5a (pièce 75, `and1.DOG`, `C75B`, arrivée en pièce 1).

`GROUP_SOLUTIONS[5]` est `solution` ; la partie complète (`full-game.test.ts`, `PLAY_ORDER`) joue `solveCrash` après 4a et `solveFinal` après 4c.

Corrections et précisions :
- **5a, étape 33** : `and1.DOG` n'est pas lancé par la pièce 75 mais par la fin de `C74A` (groupe 4, `talkFile and1.dog`, `talkTo` 599). Dans le jeu enchaîné, le groupe 4 le lance ; dans le départ isolé `{ room: 75 }`, `solveCrash` le lance de la même façon (`startDialogue` puis `playCutaway` de la suite). Chemin rejoué : choix 2/3 puis 2/4 (indices 1 et 1) ; `C75B` joue les mouvements 28 et 32 et Joe arrive en pièce 1.
- **5b, départ** : le passage O502 (étape 77, `C505`) est la dernière action du groupe 4 ; la zone 67/2 qu'allume `c67b` n'est pas posée dans un départ isolé. `finalStart` est donc dans la vallée (pièce 67) avec I15 et les états 3, 50, 98, 104, 105, 138, 139 ; `solveFinal` joue `C69Z` directement si Joe est encore en pièce 67 (rien à faire dans le jeu enchaîné). `gs154` (posé par `C505`) reste à 0 dans ce départ isolé, sans effet sur la suite.
- **5b, étapes 2 à 7** : rejouées telles qu'écrites (pistolet O521 ; Utiliser I47 sur O513 ; Parler O516 « tourniez votre miroir » ; Utiliser I47 sur O513 ; Donner I15 sur O517 ; Utiliser I47 sur O513 → `C69G`). États de fin : gs149 = 1, gs150 = 1, gs151 = 2 ; pièce 110 ; `endGame` appelé une fois. Les mouvements vus : `C69Z` 11, 12, 9 ; `C69E`/`C69F` 10 puis 9 ; `C69G` 10, 13, 26, 27, 29, 30, 14 (dans cet ordre).

## 4. Aides manquantes, besoins hors dossier

Aucun : `kit.ts`, `bam.ts` et `stage.fadeOut` suffisent. Un point à décider par le coordinateur : `test/fotaq/specials/group-6/intro.test.ts` (« générique de fin ») joue `C69G` depuis la pièce 69 ; il passe toujours avec les mouvements du groupe 5 (le générique se déroule pendant le dirigeable, avant les 40 images de `endGame`), son commentaire (« la cinématique finit avant le générique ») a été corrigé par le coordinateur.

## 5. Points ouverts

- Rendu à vérifier à l'écran (non fait ici, pas de navigateur) : le tangage et les échelles de 28, la secousse du combat, le fondu de 30.
- Durée réelle du dirigeable (29) et enchaînement avec le générique à comparer au jeu d'origine.
