# Flight of the Amazon Queen : groupe 3, temple et labyrinthe (vague L)

Code : `src/games/fotaq/engine/specials/group-3/` (`ids.ts`, `moves.ts`, `areas.ts`, `index.ts`). Tests : `test/fotaq/specials/group-3/` (`moves.test.ts`, `areas.test.ts`, `walkthrough.test.ts`, solution dans `solution.ts`). Source : `engines/queen/logic.cpp` de ScummVM (GPL v3 ou ultérieure), **lu et réécrit**.

## 1. Ce qui est porté

| Cas | ScummVM | Où |
| --- | --- | --- |
| mouvement 20 : la caméra quitte Joe, le décor défile à 320 par pas de 16 | `asmPanRightFromJoe` | `moves.ts` |
| mouvement 24 : le décor défile jusqu'à centrer Joe (abscisse - 160, borné à 0 et 320), pas de 16, une image de plus vers la droite, caméra sur Joe | `asmPanToJoe` | `moves.ts` |
| mouvement 33 : à la quatrième tentative Joe dit la description 226 et le compteur repart (`state.puzzleAttemptCount`) | `asmAttemptPuzzle` | `moves.ts` |
| pièce 50, zone 6 : première fois `C50D` et ce qui s'enchaîne (le dialogue des zombies) puis l'état 21 = 1 ; ensuite `C50H` ; état 21 > 1 ou autre zone : rien | `handleSpecialArea`, `ROOM_TEMPLE_ZOMBIES` | `areas.ts` |
| pièce 53 : `C53B`, quelle que soit la zone | `ROOM_TEMPLE_SNAKE` | `areas.ts` |
| pièce 55 : réplique 19 de Joe | `ROOM_TEMPLE_LIZARD_LASER` | `areas.ts` |
| pièce 100, zone 7 : réplique 17 | `ROOM_TEMPLE_MAZE_5` | `areas.ts` |
| pièce 101, zone 5 : `C101B` tant que l'état 187 vaut 0 | `ROOM_TEMPLE_MAZE_6` | `areas.ts` |

**Rien d'autre n'est à porter pour ce groupe** : pas de `changeToSpecialRoom` ni d'animation de pièce (`roomUpdates`) ; la parallaxe des pièces 43, 51 et 100 (`handleParallax`) et le bateau de la pièce 43 (`handleAnimation`) sont déjà dans le moteur (`camera.ts`, `cutaway.ts`).

**Écarts à ScummVM** : (1) les zombies : ScummVM enchaîne les cinématiques dans `handleSpecialArea` avant de poser l'état 21 ; le moteur enchaîne ce que la fonction rend *après* elle, la pièce 50 enchaîne donc elle-même `C50D` (et le dialogue qui la suit) pour poser l'état 21 à la fin, comme ScummVM ; les autres pièces rendent leur cinématique et le moteur enchaîne la suite. (2) Le mouvement 33 incrémente et teste `state.puzzleAttemptCount` (déjà dans l'état sauvegardable) ; ScummVM l'a dans `Logic`. (3) Le mouvement 24 : aucun écart de logique.

## 2. Solution jouée (`solution.ts`)

`GROUP_3 = { start, solve }` : départ au passeur (pièce 42, entrée 304, avec `I12 I25 I24 I20 I3 I40 I95 I17`, états 102 et 103), arrivée **dans la cellule de Flöda (pièce 41)** : le groupe joue aussi le passage 4b (pièces 62 et 63, au groupe 3 d'après `ownership.ts`). `solveTemple` joue seulement le passage 3a (arrivée en pièce 102, porte de l'oracle ouverte). Le test de passage joue tout à la souris, sans toucher à l'état (une cinématique n'est jamais sautée), en ~130 ms.

Le **départ** ne sait pas tout poser : le passeur (306), son bateau (307) et le panneau (308 copie 309) sont montrés par `C18B` (la reine des Amazones, groupe 1) ; `Start` ne peut pas montrer d'objets. Le test les pose lui-même comme `C18B` (`walkthrough.test.ts`, `startOfGroup`) ; un parcours enchaîné n'en a pas besoin. **Fait par le coordinateur** : `Start.shown` et `Start.copies` (`test/fotaq/walkthrough.ts`) : `GROUP_3.start` montre 306 et 307 et copie 309 sur 308 lui-même. Dans le jeu enchaîné, c'est `C18C` (passage 1d) qui les montre. Les aides locales (`reveal`, `go`, `act`, `use`, `combine`) sont remplacées par celles du joueur commun (`reach` appelé par `goTo` / `act` / `useItem`).

### Le parcours, étape par étape (corrigé)

Notation : `On` objet du jeu, `In` objet d'inventaire. `->N` : pièce d'arrivée. Tout est vérifié par `solution.ts`.

1. **42** Parler O306 (`death1.DOG`, dix choix du § 7), Donner I12 à O306 (`c42a`), Parler O306 « Vous pouvez m'emmener » (`c42b`) ->43.
2. **43** O312 ->44 ; **44** O321 ->45 ; **45** Donner I25 à O337 (`c45e`), Déplacer O336, Prendre O333 (crâne), Déplacer O338, Prendre O332 (bras) ; O331 ->46 ; **46** Déplacer O343, Prendre O340, Déplacer O345, Prendre O341 ; O342 ->44.
3. **44** Utiliser I35 sur O317, I36 sur O320, I37 sur O319 ; I24 sur O316 (fente) ; I96 sur O327 ; Utiliser O327 (`c44a`) ; O329 (`c44b`) ->47 et l'énigme de l'oracle (3 choix, `c47a`).
4. **Correction** : après `c47a` la « main de pierre » O353 et la porte O350 sont **remplacées** (`fromObject`) : O347 devient la porte vers **52**, O348 et O353 deux portes vers **99**. On n'atteint plus 50 par la 47 ; on y va par **47 -> 99 (O353) -> 97 (O655) -> 50 (O642)**. La pièce 97 est coupée en deux moitiés (portes 641 et 642 d'un côté, 643 et 644 de l'autre).
5. **50** (zombies) : marcher vers O377 traverse la zone éteinte 6 (`C50D`, dialogue `zombie1.DOG`, 7 choix du § 7, fin sur `c50a`). **Correction** : il faut ensuite Prendre O371 (bandelettes, `c50g`) puis Parler O367 (`zombie2.DOG` : « Je crois que vous devriez encore ouvrir... » puis « J'ai récupéré un tas de bandelettes... », `c50c`, **gs37 = 2**, les zombies partent et la zone 6 est rallumée) avant de pouvoir atteindre le sarcophage. Ouvrir O377 (`c50b`, couronne), Utiliser I3 sur O377 (liane), Fermer, Déplacer (`c50e`), marcher O377 (`c50f`) ->51.
6. **La « poche »** (50 -> 51 -> 100 haut -> 101 bas) n'a qu'une sortie : le levier O379 de la 51 (`c51a`, Joe glisse en 47). **51** : Utiliser I3 sur O386, Prendre O386, I46 sur I1 (batte collante), Prendre O386, I46 sur O383 (`c51b`), Prendre O382 (gemme bleue) ; O378 ->100 (corniche, `c100a`, `ian1.DOG` : « Bon, je dois y aller ») ; O672 ->101 (le sol) ; Prendre O687 (`c101c`, brûlant) et Utiliser I95 sur O687 (`c101a`, disque de pierre I67) ; retour O684 ->100, O673 ->51, Utiliser O379 ->**47**.
7. **Poulie (99)**, **correction** : l'axe est sur une passerelle haute (portes 652 et 653), la poulie en bas (portes 654 et 655), les deux moitiés sont séparées. Par la 47 : O348 ->99 (haut) : I67 sur O660, I68 sur O660 (`gs170` = 2) ; O652 ->47, O353 ->99 (bas) : O666 sur O657 (`gs170` = 3), I1 sur O657 (`c99e` : le bloc monte, O659 devient une porte ->100 coin du piolet).
8. **100** (coin gauche) : Prendre O674 (piolet) ; retour O669 ->99 ; **I1 sur O657 de nouveau** (`c99f`) : le bloc redescend, sinon la zone 100/7 reste éteinte et le levier (O676) et la cage de Ian sont hors d'atteinte. O654 ->47, O348 ->99, O653 ->**48**.
9. **48** : I42 sur O355 (`c48a`), Prendre O356, I69 sur I40, I96 sur I79 (torche, **I79 reste I79**), I40 sur I39 (torche allumée) ; **I42 sur O357 (`c48c`) est nécessaire** (le trou devient la porte vers 49, **pas facultatif**).
10. **Le serpent** : O354 ->99 (haut), O652 ->47, O347 ->52, O389 ->53 : I39 sur O400 (`c53a`).
11. 53 O396 ->98 -> O649 ->**52** (côté du corps) : Examiner O388 (I82 pierre, I81 carte d'identité). **52 est coupée en trois** : on n'atteint pas le corps depuis la 47. O390 ->54, O402 ->55, O416 ->97, O643 ->56 : Prendre O418 (grand bâton, **sans les gemmes**).
12. **La cage de Ian**, en bas de la 100 : 56 O430 ->97 -> O644 ->55 -> O415 ->100 (le sol) : Déplacer O676 (`c100c`, rien ne se passe, gs188 = 1, mouvements 20 et 24), Parler O675 (« J'ai une idée! » puis « Il faudrait couper la corde... », `c100b`), Déplacer O676 (`c100d`, Ian se libère et meurt, gs187 = 1, mouvements 20 et 24).
13. **Retour dans la poche** (la pièce 50 rejoue `c50f` par la liste C601 même une fois gs187 = 1) : 100 O670 ->98, O647 ->53, O395 ->52, O394 ->47, O353 ->99, O655 ->97, O642 ->50, marcher O377 ->51, Prendre O386, O378 ->100, **O672 ->101** (`c101e`, gs189 = 1) ; Examiner O685 (I83) ; I46 sur I82 puis I82 sur I83 (clef de pierre I43) ; retour par la 100 et le levier O379 ->47.
14. **49** (côté de la crypte) : 47 O348 ->99, O653 ->48, O357 ->49 : I84 sur O365 (`c49d`), Examiner O365 (`c49c`, masque I15), I79 sur I15 (`cmask`).
15. **Le miroir (55) puis la gemme** : 49 O361 ->48, O354 ->99, O652 ->47, O347 ->52, O389 ->53, O396 ->98, O648 ->100, O671 ->55 : I15 sur O410 (`c55a`, rayons détruits, zone 55/8 rallumée) ; O409 ->52 (côté est) ; O392 ->49 (côté de la gemme) : I1 (batte collante) sur O362 (`c49b`) ; I3 sur I1 rend la batte et la racine.
16. **56 : les yeux** : 49 O360 ->52, O393 ->55, O416 ->97, O643 ->56 : I41 sur O421, I44 sur O420 (`c56a`) : les portes cachées **remplacent les cascades** O422 (->54) et O423 (->101).
17. **54** : O422 ->54 : I43 sur O405 (`c54a`) ; **la sortie est O404** (l'autel est remplacé par O406), pas O406 : O404 ->57.
18. **Labyrinthe** : 57 O432 ->58 ; Donner I25 à O434 ; O437 ->59 ; O443 ; O448 ->60 ; O451 ; O458 ->61 ; O460 ; O463 ->62.
19. **62** O471 ->**102** : Utiliser I20 sur O695 (mosaïque, `c102a`), Déplacer O711 (`c102e`) puis O708 (`c102b`) : la porte est ouverte.
20. **Passage 4b** : O693 ->63 (`c63c`, `oracle2.DOG` : « Je ne suis pas... » ; **Joe reste en 63**, il ne retourne pas en 47) ; Donner I97 à O476 (`c63b`) ; Prendre O483 (`c63a`, crâne de cristal) ; O477 ->102, O692 ->62 ; Déplacer O472 et O473 (`c62b`) ; Utiliser O470 (`c62a`, `frank.DOG` : « ... avez-vous besoin... », « L'acide... », « Vous ne mélangez... », `c62c`) ->**41** (136, 102), gs67 = 2, gs45 = 2, gs100 = 3.

### État d'arrivée

Pièce 41, Joe en (136, 102). Inventaire à la fin de 3a (en 102) : I1 (batte), I2, I3, I15 (masque propre), I17, I20, I24, I25, I39 (torche allumée), I40, I42 (piolet), I46 (racine), I79, I81, I95 (poupée brûlée), I97 ; à la fin de 4b : sans I97 ni I45. États posés (3a, mesurés) : 21=1, 37=2, 41=2, 42=1, 44=2, 46=1, 57=1, 58=3, 65=1, 66=1, 68=1, 80=1, 90=1, 98=1, 106=1, 108=1, 110=1, 111=1, 121=1, 122=1, 137=1, 141=1, 142=1, 146=1, 162=1, 165=1, 170=3, 176=1, 177=1, 179=1, 180=1, 181=1, 182=0, 183=1, 184=1, 185=1, 186=2, 187=1, 188=2, 189=1, 190=1, 200=1, 207=1 ; puis 4b : 45=2, 100=3, 67=2. **Correction de § 7** : l'état 37 vaut **2** (non 1).

## 3. Points douteux de `specials.md` tranchés

- **Ordre dans le temple et le labyrinthe** (points 10 et 3a) : tranché ci-dessus, par rejeu à la souris ; il vient des **composantes de marche** de chaque pièce (`mapNeighbors`) plus que des listes de commandes. Pièces coupées en plusieurs zones : 52 (3), 97 (2), 99 (2), 100 (3 : coin du piolet, sol, corniche), 101 (haut et bas), 49 (2), 50 (zone 6 éteinte), 55 (zone 8 éteinte), 56 (zones 3 et 4 éteintes).
- **Point 7, bandelettes** : `INV ADD I79 src=90` change l'image, pas le numéro : I79 reste utilisable pour le masque.
- **Point 8, poulie de la 99** : elle est **indispensable** : elle fait apparaître la porte 99 -> coin gauche de la 100, où est le piolet (aucune autre route : le coin a `mapNeighbors` = 0). Il faut I67 (disque) + I68 (liane) + I1 (batte) ; le bloc doit ensuite être redescendu (`AREA r100 on 7`) pour atteindre le levier.
- **Point 9, pièce 63** : `c63c` ne ramène pas en 47 ; Joe reste en 63 libre après `oracle2.DOG`.
- **Point 11, `ian1.DOG`** : NOQUIT, « Bon, je dois y aller » le termine ; `ian2.DOG` : « J'ai une idée! » puis « Il faudrait couper la corde... » (visible après `c100c`) déclenche `c100b`.

## 4. Points ouverts

- Les mouvements 20, 24 et 33 sont vérifiés dans leur durée et leurs effets (`moves.test.ts`) et appelés par les vraies cinématiques `c100c`, `c100d` (20 et 24) ; 33 est appelé par `c102c`/`c102d` (joué à la souris).
- La moitié de la cinématique `C50D` avant le dialogue n'a pas été comparée à l'écran au jeu d'origine.
