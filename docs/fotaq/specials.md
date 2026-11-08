# Flight of the Amazon Queen : mouvements spéciaux et cas de pièce (vague L)

Mise en place de la vague L et premier groupe. `src/games/fotaq/engine/specials/` regroupe la logique codée en dur de `engines/queen/logic.cpp` (ScummVM, GPL v3 ou ultérieure, **lu et réécrit**) : les 37 mouvements spéciaux de la version DOS (`executeSpecialMove`, `asm*`), les pièces que `changeToSpecialRoom` prend en charge, les zones éteintes de `handleSpecialArea` et les animations de pièce (`BamScene`). Inventaire et accroches : `engine.md` § 9 et `cutaway.md` § 5. Modèle d'organisation : `docs/drascula/rooms.md`.

## 1. Organisation : un dossier par groupe, rien de partagé

```
src/games/fotaq/engine/specials/
  index.ts          `GROUPS` (les six groupes) et `fotaqScript` : l'assemblage       (NE PAS MODIFIER)
  assemble.ts       `GroupScript`, `assembleSpecials` : fusion, doublons refusés      (NE PAS MODIFIER)
  ownership.ts      pièces et mouvements de chaque groupe                              (NE PAS MODIFIER)
  kit.ts            aides communes : bobs, caméra, défilement, mode rapide, secousse, éclair   (NE PAS MODIFIER)
  bam.ts            `BamScene` : course de voiture et combat final                    (NE PAS MODIFIER)
  group-N/          tout le groupe N, et seulement lui
    index.ts        `export const groupN: GroupScript = {…}` (déjà importé par `index.ts`)
    ids.ts          numéros d'objets, d'états, de bobs nommés
    <pièce>.ts      une pièce, une cinématique longue, les mouvements
test/fotaq/
  walkthrough.ts    joueur scripté commun                                              (NE PAS MODIFIER sans le signaler)
  solutions.ts      `GROUP_SOLUTIONS[N] = { start, solve }` : à compléter pour son groupe seulement
  specials/assemble.test.ts, kit.test.ts, walkthrough.test.ts    tests de l'assemblage, des aides et du joueur   (NE PAS MODIFIER)
  specials/group-N/…         les tests du groupe N
docs/fotaq/specials-group-N.md    notes du groupe N (écarts, points ouverts, aides manquantes), à créer
```

`specials/index.ts` importe déjà `group-1` à `group-6` (des `GroupScript` vides, sauf le 6). **Un agent de groupe ne touche donc à aucun fichier hors de `specials/group-N/`, `test/fotaq/specials/group-N/`, `docs/fotaq/specials-group-N.md` et de sa propre entrée de `test/fotaq/solutions.ts`.** Si une modification d'un fichier partagé (`kit.ts`, `bam.ts`, `assemble.ts`, `ownership.ts`, `walkthrough.ts`, `engine/*.ts`, `render/`) paraît nécessaire, s'arrêter et la signaler.

Le moteur utilise `fotaqScript` : `FotaqEngineOptions.script` (les tests passent par `Walkthrough`, l'outil `ui/render-dev.ts` le branche). Les animations de pièce du script (`GameScript.roomUpdates`) sont enregistrées dans `GameStage.roomUpdates` à la création du moteur.

## 2. Ce que fournit un groupe

`GroupScript` (`assemble.ts`), tout est facultatif :

| Champ | Reprend | Rôle |
| --- | --- | --- |
| `specialMoves: { N: (g) => Sequence }` | `executeSpecialMove(N)`, `asm*` | appelé par une cinématique (`.CUT`, `cutaway.md` § 5), à l'arrivée à un enregistrement sans déplacement ou à la fin d'une cinématique sautée |
| `specialRooms: { N: (g) => Sequence<boolean> }` | `changeToSpecialRoom` | à chaque changement de pièce, avant `displayRoom` : rend vrai si la pièce `N` a pris l'affichage en charge (pièces 7 et 95) ; faux : la pièce s'affiche normalement |
| `specialAreas: { N: (g, facing, area, walkData) => Sequence<string> }` | `handleSpecialArea`, `case ROOM_…` | Joe marche dans une zone éteinte de la pièce `N` ; le moteur a déjà tourné Joe et annulé la pièce demandée ; rend la cinématique à enchaîner (`""` : aucune) |
| `roomUpdates: { N: (g, bobs) => void }` | `Graphics::update` (`BamScene`) | animation de la pièce `N`, appelée à chaque image après la caméra |

**Les tables sont fusionnées par numéro ; un numéro défini par deux groupes est une erreur levée au chargement** (`assemble.test.ts` vérifie les quatre tables) et `ownership.ts` fixe à chaque groupe ses pièces et ses mouvements (le test refuse qu'un groupe en définisse d'autres). Les clés sont des **numéros de pièce du jeu** et de mouvement.

1. Créer `group-N/ids.ts` : chaque numéro magique de ScummVM (pièces, objets, états, bobs, cinématiques) a un nom.
2. Écrire un fichier par pièce ou cinématique, en séquences (`src/engine/sequence.ts` : `yield* g.update()` pour une image de 100 ms, `wait(n)`) ; **en-tête de module** : fonctions de ScummVM reprises et écarts.
3. Remplir `group-N/index.ts`.
4. Écrire les tests (§ 5) et `docs/fotaq/specials-group-N.md`.
5. Compléter l'entrée du groupe dans `test/fotaq/solutions.ts` (`start`, `solve`) avec la partie de la solution du § 7.

## 3. Aides communes

`kit.ts` (importé par les groupes ; les tests de pièce utilisent aussi `test/fotaq/walkthrough.ts`) :

| Aide | ScummVM | Notes |
| --- | --- | --- |
| `stageOf(g)`, `bobOf(g, n)` | `_vm->graphics()->bob(n)` | scène réelle (`GameStage`), bob `n` (0 Joe, 1 à 3 les personnes, 5 et suivants animés, 20 et suivants fixes : `engine.md` § 11) |
| `putCameraOnBob(g, n)`, `setScroll(g, x)` | `putCameraOnBob`, `Display::horizontalScroll` | `-1` : caméra libre |
| `panTo(g, cible, pas, { quit, from, each })` | les boucles de panoramique | une image par pas ; `quit` : s'arrête à `cutawayQuit` ; `each` : bobs qui bougent avec le décor |
| `fastMode(g, on)` | `Input::fastMode` | mode rapide : voir ci-dessous |
| `shake(g, on)` | `Display::shake` | écran remonté de 3 lignes (`display.shakeY`, appliqué par `Renderer.render`), bas noir |
| `flash(g)` | `palCustomFlash` | éclair blanc d'une image de jeu (100 ms) |
| `frames(g, n)` | `while (n--) update()` | |
| `BamScene` (`bam.ts`) : `stage.bam`, `prepare`, `updateCar(g, table)`, `updateFight(g, tables)`, `flag` | `BamScene` | course de voiture (groupe 4, pièce 74) et combat final (groupe 5, pièce 69) : **la logique est commune, les tables de données sont à fournir par le groupe** (`_carData`, `_fight1Data` à `_fight3Data` : `bam([x, y, image], [x, y, image], [x, y, image], sfx)`) ; le groupe enregistre `roomUpdates: { 74: (g) => stage.bam.updateCar(g, CAR) }`, et lance la scène par les mouvements 7 (`flag = Play; prepare`), 8 (arrêt), 9, 10 (`RequestStop` puis attente de `Stop`) |

**Mode rapide** (nouveau, `cadence.ts`) : ScummVM attend 10 ms (`DELAY_SHORT`) au lieu de 100 par image tant que `fastMode` est actif (panoramiques de `CDINT` et `CINTR`). `FotaqEngine.update` ne passe un tick que toutes les `FAST_RATIO` = 10 images. Une boucle qui `yield* g.update()` à chaque pas est donc dix fois plus rapide, sans autre travail.

## 4. Modèle : une pièce ou un mouvement

Voir `specials/group-6/` : `moves.ts` (mouvements, chacun une fonction `function* (g)` et la table `{ 15: …, 16: … }`), `intro.ts` (pièces 95 et 7), `ids.ts`, `index.ts`. Un mouvement qui est un panoramique reprend `panTo` ; un cas de pièce qui prend la main (`specialRooms`) appelle lui-même `g.displayRoom(…)`, joue ses cinématiques par `g.playCutaway("X.CUT")`, remet `g.scene = 0` après une introduction, et rend vrai.

## 5. Tests

Un test par pièce ou mouvement (`test/fotaq/specials/group-N/…`) et **un test de passage** par groupe (`walkthrough.test.ts`) qui joue `GROUP_SOLUTIONS[N]` : l'état de départ (`start`) puis la solution à la souris, comme une personne. Tous sont ignorés sans `original/fotaq/` (`describe.skipIf(!hasOriginalFiles)`).

**`Walkthrough`** (`test/fotaq/walkthrough.ts`) : le vrai moteur (scène, répliques, cinématiques, `fotaqScript`) devant un hôte de test (horloge manuelle, voix mesurées). Il joue sans toucher à l'état du jeu.

```ts
const w = new Walkthrough({ entryObject: 584, voices: false });  // aussi { room, items, states, outfit, script, seed }
w.settle();                                   // attend la main (marche, réplique, cinématique, pièce) ou un menu de dialogue
w.act("Talk", 585);                           // verbe du panneau (Open Close Move Give Look PickUp Talk Use), puis clic sur l'objet 585 de la pièce
w.goTo(582);                                  // clic sans verbe : marcher, passer une porte
w.useItem(57, 551); w.useItem(5, 161, "Give");// objet d'inventaire (Item) en main, puis clic sur un objet ; « Donner » avec "Give"
w.combine(51, 52); w.verbOnItem("Look", 10);  // objet d'inventaire sur un autre ; verbe sur un objet d'inventaire
w.waitForChoices(); w.chooseText("la clef"); w.choose(0);   // menu de dialogue : lire les choix, choisir par texte ou par rang
w.waitForCutaway(); w.waitForRoom(70);        // attendre la fin d'une cinématique, l'arrivée dans une pièce
w.skip(); w.skipUntil(() => w.idle);          // Échap, une fois ou jusqu'à une condition
w.until(() => w.engine.gameState(145) === 1); // avancer jusqu'à une condition (limite : 12 000 ticks de 100 ms)
w.reach(147); w.toPinnacle(165); w.fromPinnacle(47, 20);   // amener un objet à l'écran ; aller au piton ; en repartir
w.pointOf(585); w.choices(); w.cutaways.played; w.voices(w.mark());   // lecture : point cliquable, menu, cinématiques jouées, voix
```

Règles : un clic attend la fin de l'action (`settle`) ; `pointOf` lève si l'objet n'est pas à l'écran (`goTo`, `act`, `useItem` appellent d'abord `reach`) ; le numéro d'un objet de la pièce est le numéro **global** de `QUEEN.JAS` (celui du § 7) ; un objet d'inventaire est un `Item` (annexe du § 7). Pour tester une pièce sans l'enchaînement complet, `new Walkthrough({ room | entryObject, items, states, outfit })` pose l'état voulu (permis dans un test de pièce et pour le `start` d'un groupe, pas au milieu du test de passage). Une cinématique sautée par Échap atteint les mêmes états finaux : les `skipUntil` en profitent.

**`GROUP_SOLUTIONS`** (`test/fotaq/solutions.ts`) : un passage représentatif par groupe (`{ start, solve }`) ; les autres passages sont exportés par `specials/group-N/solution.ts`. **`PLAY_ORDER`** : la partie complète, liste de passages (`{ id, group, what, play }`) jouée par `test/fotaq/full-game.test.ts` (§ 7, « La solution définitive »).

Aides du joueur (vague L, reprises des groupes) : `goTo`, `act` et `useItem` amènent d'abord l'objet à l'écran (`reach` : Joe marche vers le bord du décor, en cliquant hors de tout objet) ; `chooseText` fait défiler le menu (flèche du bas) quand l'option est cachée au-delà des quatre lignes ; `toPinnacle(sortie)` et `fromPinnacle(destination, pièce)` passent par le piton, qui ne rend jamais la main ; `Start.shown` et `Start.copies` posent au départ ce qu'une cinématique antérieure aurait montré ou copié ; `observers` (lecture de l'écran à chaque tick) et `ticks` (temps de jeu écoulé).

## 6. Répartition des 37 mouvements et des cas de pièce

Découpage de `engine.md` § 9, **corrigé par la lecture de la solution** : les pièces 62 et 63 sont du temple (groupe 3) ; la pièce 75 est l'avion du début (`C75B`, groupe 5 : à voir avec le groupe 4, qui joue le mouvement 32 de cette même cinématique) ; les pièces 97 à 99 sont du groupe 3.

| Groupe | Zone | Pièces | Mouvements | Zones éteintes / autres cas |
| --- | --- | --- | --- | --- |
| 1 | jungle et Amazones | 1 à 6, 8 à 21 | (aucun) | `handleSpecialArea` : 4, 6, 14, 16, 17 ; parallaxe et couleurs déjà dans le moteur |
| 2 | Floda | 22 à 42, 103 | 19, 21, 22, 23, 25 | `handleSpecialArea` : 22, 26, 30, 32, 103 ; c41f |
| 3 | temple et labyrinthe | 43 à 63, 97 à 102 | 20, 24, 33 | `handleSpecialArea` : 50, 53, 55, 100, 101 |
| 4 | hôtel, vallée, course | 64 à 68, 70 à 74, 76 | 2 à 8, 31, 32 | `handleSpecialArea` : 71, 73 ; voiture (`BamScene`, pièce 74) |
| 5 | fin | 69, 75, 104 à 114, 126 | 9 à 14, 26 à 30 | combat (`BamScene`, pièce 69), fin du jeu (14 : `g.endGame()`) |
| 6 | introduction, générique, piton | 7, 95, 115 à 125 | 15 à 18, 34, 36 à 39 | **fait** (§ 8) |

Les mouvements 2, 3, 4 (tenues) sont déjà des fonctions du moteur (`joeUseDress`, `joeUseClothes`, `joeUseUnderwear`) mais **aucune entrée de `specialMoves` ne les appelle encore** : le groupe 4 les enregistre (`2: (g) => g.joeUseDress(false)`, `3`, `4`) ; 5 et 6 sont `palette.setJoeDress()` et `setJoeNormal()` (`stage.setOutfit`). Les mouvements 1 et 35 ne sont lancés par aucune cinématique. Les mouvements 20, 24 et 26 sont des panoramiques (`panTo`).

## 7. La solution du jeu, découpée par groupe

**Source** : établie à partir des données du jeu (listes de commandes de `QUEEN.JAS`, `.DOG`, `.CUT`, un explorateur de dialogues qui rejoue les vrais `.DOG` avec le moteur), de `command.cpp`, `logic.cpp` et `talk.cpp` de ScummVM, et d'un résumé de la soluce publique d'Adventure Gamers (https://adventuregamers.com/walkthrough/full/flight-of-the-amazon-queen : page protégée, seul le résumé a pu être lu) ; les autres soluces (UHS, https://www.uhs-hints.com/uhsweb/fotaq ; StrategyWiki, HTTP 403) n'ont pas été reprises. **Aucune étape n'est donc « soluce publique seulement »**. L'étape 12 du groupe 4 (portier, `laris.DOG`) a été rejouée à la souris par `test/fotaq/specials/walkthrough.test.ts` ; le reste est à vérifier par les agents de groupe en écrivant `solve`. Le **groupe 6 est joué en entier** (`test/fotaq/specials/group-6/`).

**Constat qui change le départ des tests** : `C70D.CUT` a pour pièce finale la **70** (la chambre d'hôtel, Joe en (78, 125), enfermé par Anderson), pas le hall 73 : le premier joueur libre est en pièce 70 (états 117 et 158 à 1). Départ du groupe 4 : `{ room: 70, states: { 117: 1, 158: 1 } }`.

Les numéros d'objet `On` sont les numéros globaux de `QUEEN.JAS` (ceux que reçoit `Walkthrough.act`), `In` les `Item`, `gsN` les états du jeu.

### Conventions de lecture

- **Numéros** : `On` = objet du jeu **global** (indexé par `QUEEN.JAS`, celui que reçoit `clickObject`), `In` = objet d'inventaire (`Item`), `gsN` = état de jeu (`gameStates[N]`), `Cnnn` = numéro de liste de commandes de `QUEEN.JAS` (voir `commands.txt`). `rN` = pièce.
- **Verbes** (numéros `Verb`) : Ouvrir 1, Fermer 2, Déplacer 3, Donner 5, Utiliser 6, Prendre 7, Parler 8, Examiner 9, Marcher 10. « Donner/Utiliser In + On » = verbe, objet d'inventaire n°1, puis objet n°2 (liste `object1`=In négatif, `object2`=On).
- **Lecture des commandes** (ScummVM `Command::setConditions`) : une ligne `IF gsX==v` est une **condition à remplir** (sinon la liste échoue et, si elle a un texte, Joe le dit) ; `SET gsX=v` est un état posé quand la liste réussit ; `gs53` est un état « mannequin » jamais à 1 : `IF gs53==1 say …` = réponse par défaut, `SET gs53=0 say …` = succès. Les listes d'un même (verbe, objets) sont essayées dans l'ordre des numéros : la première dont toutes les conditions passent s'exécute.
- **Dialogues** : option notée `rang/total « début du texte »` (rang parmi les options **affichées** du menu au moment du choix, total = nombre d'options affichées). Chemins obtenus par exploration (« **chemin vérifié** » = trouvé en rejouant le vrai `.DOG` dans son contexte) ou lus dans l'arbre (« **arbre lu** »).
- **Niveaux de confiance** : **[V]** vérifié dans les données (liste de commandes / cinématique / chemin de dialogue lus ou rejoués) ; **[D]** déduit des données (dépendances lues, mais l'ordre ou l'enchaînement exact n'a pas été rejoué) ; **[S]** soluce publique seulement. Aucune étape n'est **[S]** : les soluces consultées n'étaient qu'un résumé (voir « Sources »).
- **Tenue de Joe** (`gs19`) : 0 normale, 1 sous-vêtements, 2 robe. **Inventaire de départ** : I1 batte, I2 journal (seuls objets possédés au départ, `items.txt`) ; tous les états de jeu valent 0.

### Table des passages entre groupes (objets de passage)

Passages **joués en cinématique** (pas de clic d'objet de sortie) en italique.

| Passage | Objet de passage n° + nom | De -> vers (pièce) | Remarques |
|---|---|---|---|
| intro -> hôtel | *objet d'entrée 584 + `C70D.CUT`* | 95 -> 73 -> 70 (fin de `C70D`, Joe en 78,125) | **L'intro finit en pièce 70** (voir « Points douteux » 1) |
| hôtel haut -> couloir | O561 « draps attachés » (r71, vers 70) / O561 via `C70B` | 70 <-> 71 | par les draps (`c70b`, `c71c`) |
| couloir -> hall | O559 « porte » (r71) / O582 « porte » (r73) | 71 <-> 73 | |
| couloir -> chambre de Lola | O551 « porte » (r71) / O566 (r72) | 71 <-> 72 | clef I57 requise |
| hall -> course | O584 « camion » (r73), `C73E.CUT` | 73 -> 74 (127,95) | robe requise |
| course -> avion | `C74A.CUT` (huile sur Rico, O588) | 74 -> 75 (138,146) | |
| avion -> crash | `C75B.CUT` | 75 -> 1 (211,124) | fin du dialogue `and1.DOG` |
| crash 1 <-> 2 | O6 « porte » (r1) / O8,O16 (r2) | 1 <-> 2 | |
| nénuphar -> rive | `C2A.CUT` (hélice sur O9) | 2 -> 3 (100,107) | |
| 3 <-> 4 / 3 <-> 5 / 5 <-> 6 | O21/O27 ; O22/O34 ; O36/O38 | | |
| **piton (hub)** | O39 « piton » (r6) ; O60 (r10) ; O98 (r16) ; O135/O141 (r20) ; O165 (r22) ; O304 (r42) | x -> 7 | pièce 7 = menu |
| piton -> destinations | O42 Site du crash (-> r6, entrée 39) ; O43 Jungle (-> r10, 60) ; O47 Bob le Marchand (-> r20, 135) ; O41 Camp de la Flöda (-> r22, 165) ; O44 embarcadère (-> r42, 304) ; O48 forteresse des Amazones (-> r16, 98, **caché** jusqu'à C96/C699) | 7 -> ... | O40, O45, O46, O49 cachés non utilisés |
| jungle | O62/O52 (10 <-> 8) ; O63/O66 (10 <-> 11) ; O55/O58 (8 <-> 9) ; O59/O67 (9 <-> 11) ; O69/O87 (11 <-> 14) ; O88/O77 (14 <-> 13) ; O90/O95 « souche creuse » (14 <-> 15) ; O96/O76 (15 <-> 12) ; O70/O99 (12 <-> 16) | | |
| Amazones | O101 « sculptures » (r16, devient passage vers r17 après `C96`) ; O105 « porte » (r17) / O134 « sortie » (r19) | 16 -> 17 ; 17 <-> 19 | |
| village | O147 « porte » (r20) / O149 « porte » (r21) | 20 <-> 21 | |
| Flöda | O167 « porte » (r22 -> r23) ; O169 / O724 (22 <-> 103) ; O718/O195 (103 <-> 25) ; O716/O206 (103 <-> 26) ; O201/O217 (26 <-> 27) ; gramophone O184 + `C25B` (25 -> 28) ; O220 ascenseur (28 -> 25) ; 28/29/30/31/34/35/24/38/32/33/40/41 par les portes/passages du tableau de `rooms.txt` ; O284 « escalier » (40 -> 41) | | |
| passeur | `C42B.CUT` (O306 + dialogue `death2.DOG`) | 42 -> 43 | |
| temple | O312/O322 (43 <-> 44) ; O318/O321 (44 -> 46 / 45) ; `C44B.CUT` (44 -> 47) ; O350 (47 -> 52) ; O353 (47 -> 50) ; O351,O352 (47 -> 99) ; portes de 52 (O389 -> 53, O390 -> 54, O391 -> 98, O392 -> 49, O393 -> 55) ; 55 -> 100 (O415), 56 -> 101 (O427), 51 -> 100 (O378) ; 57 -> 58 -> ... -> 61 (labyrinthe de rats) -> 62 (O463) | | |
| oracle | O471 (62 -> 102) ; O693/O694 (102 -> 63) | | |
| squelette volé | `C62C.CUT` (chaise O470, Frank) | 62 -> 41 (136,102) | |
| évasion prison | `C41B.CUT` (tasse I92 sur O296) | 41 -> 22 | |
| lancement | O39,O60,O98?,O99,O135,O141,O165,O304 avec gs9==2 ET gs45==2 -> `C76A.CUT` ; fusée I23 -> `C76B.CUT` | n -> 76 -> 64 (286,141) | |
| vallée | O487 (64 -> 65) ; O490 (65 -> 66) ; O494 (66 -> 68) ; O491/O493 (65 -> 67) ; O502 (67 -> 69) + `C69Z.CUT` | 64 -> 69 | |
| fin | `C69G.CUT` | 69 -> 110 (394,58) | puis générique `#credit2.crd` |

### La solution définitive : la partie complète (fin de la vague L)

**Jouée d'un trait** par `test/fotaq/full-game.test.ts` : un seul moteur, un nouveau jeu (`FULL_GAME_START = { room: 95 }`), puis uniquement la souris et Échap (aucune écriture d'état) jusqu'au générique de fin et à `endGame`, sans avertissement du moteur ni des dialogues. La séquence est `PLAY_ORDER` (`test/fotaq/solutions.ts`), une **liste de passages** : un groupe est visité en plusieurs fois. Les solutions de détail restent celles des groupes (`test/fotaq/specials/group-N/solution.ts`, corrections dans `specials-group-N.md`) ; `solutions.ts` ne joue en plus que les trajets entre deux groupes.

| Passage | Groupe | Ce qui se joue (fonction) | Arrivée | Ticks |
| --- | --- | --- | --- | --- |
| 6a | 6 | introduction, sautée par Échap (`COPY`, `CLOGO`, `CDINT`, `CRED`, `C70D`) | chambre 70 | 66 |
| 4a | 4 | hôtel et course (`solveGroup4`), jusqu'au menu de `and1.DOG` | avion 75 | 4 038 |
| 5a | 5 | `and1.DOG`, `C75B`, le crash (`solveCrash`) | site du crash 1 | 826 |
| 1a à 1c | 1 | crash, jungle, village, forteresse (`solveGroup1`) | cachette 17 | 24 446 |
| 2a | 2 | 17 -> O106 -> 16 -> O98 piton ; la banane (piton O42 -> 6 -> 5 -> 3 -> 4, O26, retour par O39) ; Flöda (`solveGroup2`) | camp 22 | 12 770 |
| 1d | 1 | 22 -> O165 piton -> O48 -> 16 -> O101 -> 17 ; O117 (`C18C`, corne : `returnToAmazons`) | cachette 17 | 1 736 |
| 3a + 4b | 3 | 17 -> 16 -> piton -> O44 embarcadère 42 ; temple, oracle, crâne, chaise de Frank (`solveGroup3`) | corniche de la cellule 41 (136, 102) | 19 142 |
| 2b | 2 | la tasse sur la corniche, la porte (`C41B`), le retour au camp, Bob, l'alcool, la fusée pleine (`solveGroup2b`) | étal de Bob 21 | 3 138 |
| 4c | 4 | 21 -> O149 -> 20 -> O135 : `C76A` (lancement, 76) ; la vallée (`solveGroup4c`) | combat 69 | 4 096 |
| 5b + 6c | 5 | combat final, `C69G`, générique de fin (`#credit2.crd`), mouvement 14 (`solveFinal`) | 110, partie finie | 4 270 |

**Durée : 74 528 ticks de 100 ms** (2 h 04 de jeu, répliques au temps de leur texte, `voices: false` ; 0,6 s réelle). Le générique de fin s'affiche en entier ; les états jalons (`gs40`, `gs102`, `gs45`, `gs9`, `gs149`, `gs151`) sont vérifiés ; la pièce 6 est traversée deux fois sans rejouer `C6C`.

**Corrections apportées par la partie complète** :

1. **La corniche de la cellule (pièce 41, ancien `it.todo` du groupe 2)** : ce n'était ni la marche ni les zones. L'objet 296 (porte de la prison) a deux positions : (200, 119) vue du couloir (zone 2, celle de 2a, où Joe libère Azura) et (220, 103) vue de la cellule (zone 8, objet caché 302). **La liste `C152` (Prendre le crâne de cristal O483, pièce 63, `c63a`) copie 302 sur 296** (`OBJ O296 src=302`). Le départ isolé de 2b ne l'avait pas fait : Joe, sur la corniche (zones 4 et 8, la cellule), visait la porte du couloir et le chemin 4 -> 8 -> 3 -> 2 traverse la zone 3 éteinte (le seuil de la cellule) : arrêt en (189, 106), comme le ferait ScummVM (`Walk::calc`, `findFreeArea` à bits inversés, `animateJoe`). Avec la copie, la porte est dans la cellule et `C583` (`c41b`) se joue. Correction : `startGroup2b` part de la corniche avec la copie (`Start.copies`) et la tasse montrée (`C352`, `Start.shown`) ; `solveGroup2b` prend la tasse puis l'utilise ; un test garde le cas sans copie (arrêt au bord de la zone 3).
2. **La banane de 2a** (étape 1) est jouée : le groupe 1 l'a donnée au singe (`c13e`) ; elle a repoussé en pièce 4 (`fetchBanana`, jouée si la banane manque ; le départ isolé de 2a la garde en inventaire, la zone 4 de la pièce 4 n'étant allumée que par 1a).
3. **Le passeur de la pièce 42** est montré par `C18C` (1d) dans le jeu enchaîné : le départ isolé du groupe 3 le pose par `Start.shown` / `Start.copies`.
4. **Le lancement** : depuis l'étal de Bob, la porte O149 puis le chemin du piton O135 jouent `C76A` (états 9 et 45 à 2) au lieu du piton.

**Les pièces 62/63 (T19/T20) sont des pièces du temple, jouées par le groupe 3 ; la 75 (D6) est l'avion de l'acte 1, jouée par le groupe 5 (5a) après le groupe 4 (4a).**

---

### Groupe 6 : introduction, générique et piton 7 (pièces 95, 115 à 126, 7)

#### Passage 6a : introduction (premier passage du jeu)

**État de départ** : nouvelle partie ; pièce **95** (`COPY`, pièce de l'objet d'entrée 639 de `QUEEN.JAS`) ; inventaire I1 batte, I2 journal ; tous les `gs` à 0 ; tenue normale.

**Actions** (toutes automatiques, aucun clic ; `LogicGame::changeToSpecialRoom`, pièce 95) :

1. [95] cinématique `COPY.CUT` (logo, pièce 95) **[V]** (`C-`, mouvements spéciaux : aucun).
2. [82] `CLOGO.CUT` (logo du jeu, pièce 82 `L1`) **[V]**.
3. [115-125] `CDINT.CUT` (introduction CD : pièces `X1` à `X11` ; `CINTR.CUT` à la place si l'option `alt_intro` de ScummVM est active ; mouvements spéciaux 17, 18, 36 à 39 : panoramiques, flash blanc) **[V]**.
4. [112] `CRED.CUT` (affiche `#credit1.crd`, générique de début, pièce 112 `C7`) **[V]**.
5. [73] affichage de la pièce 73 avec l'objet d'entrée **584** (« camion ») : `displayRoom(73, FadeJoe)` **[V]**.
6. [73] `C70D.CUT` : Joe monte chercher Faye, trouve Anderson qui l'enferme ; états posés par la cinématique : `gs158=1` (et `gs19`, `gs93`, `gs202` à 0) ; fin de cinématique : **pièce finale 70**, Joe en (78,125) **[V]**. Puis `gs117 = 1` (`VAR_INTRO_PLAYED`) et `inventoryRefresh` **[V]** (`logic.cpp`).

**État d'arrivée** : pièce **70** (chambre d'hôtel `D1`), Joe en (78,125), face à la porte fermée ; entrée par l'objet 584 sur la pièce 73 (avant `C70D`) ; inventaire : I1 batte, I2 journal ; `gs117=1`, `gs158=1` ; tenue normale (`gs19=0`).

#### Passage 6b : le piton, pièce 7 (menu de destination, utilisable dès que Joe y arrive)

La pièce 7 (`M1`) n'a pas de marche : `handlePinnacleRoom` fait choisir une destination à la souris (clic gauche sur un objet de nom > 0). Objets (pièce 7) **[V]** (`rooms.txt`, `ScummVM handlePinnacleRoom`) :

| Objet n° | Nom | Visible | Entrée -> pièce | Morceau |
|---|---|---|---|---|
| 42 | Site du crash | oui | 39 -> r6 | 3 |
| 43 | Jungle | oui | 60 -> r10 | 3 |
| 44 | embarcadère | oui | 304 -> r42 | 7 |
| 47 | Bob le Marchand | oui | 135 -> r20 | 6 |
| 41 | Camp de la Flöda | oui | 165 -> r22 | 16 |
| 48 | forteresse des Amazones | **caché** jusqu'à `C96`/`C699` (utiliser/déplacer O97 « boutons », r16) | 98 -> r16 | 3 |
| 40, 45, 46, 49 | Camp (image), Ile du Paresseux x2, Princesse Azura | cachés, jamais montrés par une liste de commandes | | |

**Action type** : `clickObject(n)` (Marcher) sur l'objet de destination. L'entrée de Joe dans la pièce d'arrivée se fait par l'objet d'entrée du tableau. **Quand `gs9==2` et `gs45==2`** (fusée pleine et Crâne pris), quitter n'importe quelle pièce par son « piton » (O39, O60, O99, O135, O141, O165, O304) lance `C76A.CUT` (gs138=1) au lieu de rejoindre la 7 (voir passage 4c). **[V]** (`C428` à `C434`).

#### Passage 6c : fin et générique (voir passage 5b)

Pièces 108 `E1`, 109 `E2`, 110 `E3`, 111 `C10`, 112 `C7`, 113 `C8`, 114 `C9`, 126 `RENEGADE` : cinématiques de fin (`C69G.CUT`, `#credit2.crd`). Aucune action du joueur (à vérifier au jeu si une pause/skip est demandée).

**Nombre d'étapes (groupe 6)** : 6 (intro) + 1 (menu) = 7.

---

### Groupe 4 : vallée, hôtel et course de voiture (pièces 62 à 76 sauf 69 et 75)

**Ce groupe est visité en trois passages** : 4a (hôtel et course, **début du jeu**), 4b (oracle du temple, pièces 62 et 63), 4c (lancement et vallée, pièces 76 et 64 à 68).

#### Passage 4a : l'hôtel et la course de voiture (pièces 70, 71, 72, 73, 74)

**État de départ** : sortie du passage 6a : pièce **70**, Joe en (78,125), tenue normale, inventaire I1 batte, I2 journal ; `gs117=1`, `gs158=1`. Objets de départ : porte O540 verrouillée (verre/porte blindée : `C407`, `C408`, `C356`, `C371`, `C70K` à `C70N` : inutile de forcer).

**Actions** (numérotation continue dans le groupe 4) :

1. [70] Utiliser O531 « cordon » (C343/C701) -> perruque O528, miroir O537, affiches O542 apparaissent ; zone 70/5 allumée **[V]**.
2. [70] Prendre O528 « perruque » (C60) -> **I49 perruque** ; gs95=1 **[V]**.
3. [70] Prendre O535 « draps » (C167) -> **I52 drap** ; gs59=1 **[V]**.
4. [70] Prendre O535 « draps » une 2e fois (C168 ; ou O538, C283) -> **I51 autre drap** ; gs59=2 **[V]**.
5. [70] Utiliser **I51 autre drap** + **I52 drap** (C169/C170) -> `c70h.CUT`, **I53 draps attachés** **[V]**.
6. [70] Utiliser **I53** + O541 « radiateur » (C171) -> `c70e.CUT` ; gs91=1 ; O538 prend l'image des draps attachés **[V]**.
7. [70] Utiliser O541 « radiateur » (ou O538 « draps », C357/C358 ; tenue normale gs19==0 exigée, sinon `c70g`) -> `c70b.CUT`, **Joe -> pièce 71** en (48,141) **[V]**.
8. [71] Prendre O556 « faux seins » (C183/C285) -> **I55 faux seins** ; gs95 passe à 2 avec la perruque (gs60=1) **[V]**.
9. [71] Prendre O557 « caisse de barre à mines » (C184) -> **I54 barre à mine** ; gs61=1 **[V]**.
10. [71] (facultatif) Déplacer O550 « échelle » (C175) -> `c71a`, échelle visible (O562), zone 71/9 ; Déplacer O562 la range (C176) **[V]**.
11. [71] Marcher O559 « porte » (C522, passage vers la pièce 73) -> **pièce 73**, gs202=1 **[V]**.
12. [73] Parler O585 « portier » (C198 : gs19 != 2 -> `laris.DOG`) : dialogue `laris.DOG`, **chemin vérifié** : 2/4 « C'est au sujet de cette clef... » > 1/3 « J'ai besoin de vous l'emprunter un moment... » (gs147=1) > 2/4 « C'est encore au sujet de cette clef... » > 3/3 « Je suis un ami de Lola, elle m'a demandé de venir la chercher... » > 1/1 « Merci. » -> **gs145=1** **[V]**.
13. [73] Prendre O581 « clef » (C185, gs145==1 sinon `c73d`) -> **I57 clef** **[V]**.
14. [73] Marcher O582 « porte » (C521, vers 71) -> pièce 71, gs202=0 **[V]**.
15. [71] Utiliser **I57 clef** + O551 « porte » (C186) -> gs49=2 (porte ouverte), I57 consommée **[V]**.
16. [71] Marcher O551 « porte » (C359 : gs94==0, gs49==2, gs119==0) -> `c72c.CUT` puis dialogue automatique `lola1.DOG` (pièce 72) ; gs119=1 **[V]**.
17. [72] `lola1.DOG` (**chemin vérifié**) : 3/3 « Lola, j'ai besoin de ton aide. » > 1/4 « Je suis sérieux. Tu peux m'aider? » > 2/3 « Peux-tu m'aider à sortir d'ici? » -> cinématique de fin `c72a.CUT` : Lola veut une serviette **[V]**.
18. [72] Marcher O566 « porte » -> pièce 71 **[V]**.
19. [71] Utiliser O561 « draps attachés » (C271) -> `c71c.CUT` -> pièce 70, Joe en (285,116) **[V]**.
20. [70] Utiliser **I54 barre à mine** + O529 « coffre » (C172 : gs19==0, gs47==0) -> `c70a.CUT` ; gs47=2 ; O529 -> O544 ouvert **[V]**.
21. [70] Examiner O529 « coffre » (C272 : gs47==2, gs92==0) -> **I50 serviette** ; gs92=1 **[V]**.
22. [70] Utiliser O541 « radiateur » (C358) -> `c70b` -> pièce 71 **[V]**.
23. [71] Marcher O551 « porte » -> pièce 72 (liste C178 : porte déjà ouverte) **[V]**.
24. [72] Parler O571 « Lola » (C286 : gs92==1) -> `c72b.CUT` : gs94=1, gs10=1 ; **I50 serviette** retirée, **I56 robe** ajoutée ; Joe revient en (263,140) pièce 71 (Variante : Donner I50 + O571, C274) **[V]**.
25. [71] Utiliser **I56 robe** (C275 : gs95==2, gs93==0, gs202==0 ; mouvement spécial 2) -> Joe en robe (gs19=2) ; **I55 et I49 retirés** ; zone 73/3 allumée **[V]**.
26. [71] Marcher O559 « porte » (C406 : gs10==1, gs13==0) -> `c39a.CUT` (interlude du labo du Docteur Ironstein, final pièce 105 -> retour) ; gs202=1, gs13=1 ; Joe -> pièce 73 **[V]**.
27. [73] Utiliser (ou Marcher) O584 « camion » (C309/C310 : gs93==0) -> `c73e.CUT` ; **I58 vêtements** ajoutée, I56 retirée ; Joe -> **pièce 74** en (127,95) **[V]**.
28. [74] Prendre O591 « paille » (C481, 1er clic) -> **I59 paille** ; gs129=1 ; O591 devient « huile » **[V]**.
29. [74] Prendre O591 (C482) -> **I60 huile** **[V]**.
30. [74] Prendre O592 « poulet » (C479) -> **I61 poulet** **[V]**.
31. [74] (facultatifs, gaspillent l'objet ; chacun lance une cinématique et ne change aucun état) : Utiliser I59 + O588 « Rico dans l'auto » (C362, `c74d`) ; Utiliser I61 + O588 (C363, `c74b`) ; Utiliser I54 + O588 (C390, `c74c`) **[V]**.
32. [74] Utiliser **I60 huile** + O588 « Rico dans l'auto » (C311) -> `C74A.CUT` (mouvements spéciaux 3 : tenue normale, 8 et 31 : fin de la course) : Joe -> **pièce 75** en (138,146) puis dialogue `and1.DOG` (groupe 5, passage 5a) **[V]**.

Variante « échec » connue (à éviter, non nécessaire) : sortir par la zone 3 du hall en tenue normale déclenche `C73A/B/C` (Rico et Eddy, `VAR_HOTEL_ESCAPE_STATE` gs93) qui ramènent Joe en pièce 70 en sous-vêtements (gs19=1) ; la robe et les accessoires rendent ce piège inoffensif **[V]** (`logic.cpp`, `handleSpecialArea`).

**État d'arrivée (4a)** : pièce 75 (fin du passage ; dialogue `and1.DOG` avant de passer au 5a) ; inventaire : I1 batte, I2 journal, I58 vêtements, (I54 barre à mine, I59, I61 si les objets facultatifs n'ont pas été utilisés) ; états : gs10=1, gs13=1, gs49=2, gs91=1, gs92=1, gs94=1, gs95=2, gs119=1, gs129=1, gs145=1, gs147=1, gs202=1 ; tenue normale (spécial 3 de `C74A`) **[V]**.

*Le groupe 4 reprend aux passages 4b (oracle) et 4c (vallée), plus bas.*

---

### Groupe 5 : fin (pièces 69, 75 et ce qui s'y rattache)

#### Passage 5a : la pièce 75 (avion en vol) et le crash

**État de départ** : sortie du passage 4a : pièce **75** (`D6`), Joe en (138,146), tenue normale, inventaire I1, I2, I58 (+ éventuels restes).

**Actions** (suite de la numérotation) :

33. [75] Dialogue automatique `and1.DOG` (Anderson, `NOQUIT`), **chemin vérifié** : 2/3 « Sur MON avion, il n'y a pas de roulettes... » > 2/4 « Attends! C'est pas tout! » ; la cinématique de fin `c75b.CUT` (condition gs53==0, toujours vraie) se joue : tempête (mouvements spéciaux 28, 32 : éclair, secousse), crash dans la rivière ; **Joe -> pièce 1** en (211,124) **[V]**.

**État d'arrivée (5a)** : pièce **1** (`C1`, site du crash), Joe en (211,124), objet d'entrée : aucun (arrivée de cinématique) ; inventaire I1 batte, I2 journal, I58 vêtements (+ restes) ; Sparky (O2) et Faye (O3) présents dans la pièce 1 **[V]**.

*Le groupe 5 reprend au passage 5b (combat final), à la fin du document.*

---

### Groupe 1 : jungle et Amazones (pièces 1 à 21 sauf 7)

Quatre passages : 1a (site du crash), 1b (jungle, village, Bob), 1c (Amazones : capture), 1d (Amazones : récompense, après Flöda).

#### Passage 1a : le site du crash (pièces 1 à 6)

**État de départ** : sortie du passage 5a : pièce **1**, Joe en (211,124), inventaire I1, I2, I58 (+ restes), tenue normale.

**Actions** (numérotation propre au groupe 1) :

1. [1] Ouvrir O1 « sac marin » (C1) -> gs1=1 **[V]**.
2. [1] Examiner O1 « sac marin » (C6 : gs1==1, gs2==0) -> **I3 couteau**, **I40 briquet** ; gs2=1 **[V]**.
3. [1] Examiner O5 « sièges détrempés » (C669 ; ou C673) -> **I98 coupon de B.D** ; gs169=1 **[V]**.
4. [1] Parler O2 « Sparky » (C63) : `sparky1.DOG`, **chemin vérifié** : 3/4 « Quel est notre stock de vivres? » > 1/3 « Des saucisses, ouah, je suis affamé!... » (gs22=1) > 2/3 « Je ne mangerai que des sous-produits de boeuf... » > 3/3 « Bon, ne bouge pas d'ici. » -> **I5 saucisses** (condition de fin gs22==1) **[V]**.
5. [1] (facultatif) Parler O3 « Faye » -> `faye5.CUT` **[V]**.
6. [1] Marcher O6 « porte » -> pièce 2 (O8) **[V]**.
7. [2] Donner **I5 saucisses** + O10 « piranhas » (C93 ; ou Utiliser, C324) -> `c2b.CUT` ; gs5=1 ; I5 devient « reste de saucisses » (I71) **[V]**.
8. [2] Prendre O12 « hélice » (C7, gs5==1) -> **I6 hélice** **[V]**.
9. [2] Utiliser **I3 couteau** + O7 « tige de nénuphar » (C227, gs5==1) -> gs196=1 **[V]**.
10. [2] Utiliser **I6 hélice** + O9 « nénuphar géant » (C226, gs196==1) -> `c2a.CUT` (mouvement spécial 4 : sous-vêtements ; Sparky et Faye déplacés) ; gs101=1 ; **Joe -> pièce 3** (100,107) **[V]**.
11. [3] (facultatif) Parler O23 « Sparky » (C66 : gs6==0) -> `sparky2.DOG` (il demande une B.D) **[V]**.
12. [3] Marcher O21 « passage » -> pièce 4 (`c4b.CUT` la 1re fois, gs168=1) **[V]**.
13. [4] Prendre O26 « banane » (C8) -> **I7 banane** (la banane repousse après chaque don : `OBJ O26 src=32`) **[V]**.
14. [4] (facultatif, sans suite dans les données) Utiliser I8 liane + O28 « corde » (C94) -> gs7=1, pont, zone 4/4 **[V]**.
15. [4] Marcher O27 « passage » -> pièce 3 ; [3] Marcher O22 « passage » -> pièce 5 (`c5c.CUT` la 1re fois, gs131=1) **[V]**.
16. [5] Utiliser **I3 couteau** + O35 « liane » (C87) -> `c5a.CUT`, **I8 liane** **[V]**.
17. [5] Marcher O36 « passage » -> pièce 6 **[V]**.
18. [6] Parler O37 « gorille » (C68) : `ape.DOG`, **chemin vérifié** : 2/3 « Désolé, mon gars, mais je ne parle pas le SINGE... » > 2/3 « Dites, vous êtes bien un gorille, non? » > 3/4 « Je croyais que les gorilles venaient d'Afrique... » > 2/3 « Vous êtes très loin de l'Afrique, vous savez. » -> gs115=1, `c6a.CUT` : le gorille disparaît (objet 37 et zone 6 retirés) **[V]**.
19. [6] Marcher O39 « piton » (C220 : gs6==0) -> `c3a.CUT` (Faye s'en va, gs6=1) puis **pièce 7** **[V]**.

**État d'arrivée (1a)** : pièce **7** (piton), entrée par O39 ; inventaire : I1, I2, I58, I3 couteau, I40 briquet, I98 coupon de B.D, I5 (reste de saucisses), I7 banane, I8 liane, (+ restes) ; états : gs1=1, gs2=1, gs5=1, gs6=1, gs101=1, gs115=1, gs131=1, gs168=1, gs169=1, gs196=1, gs22=1 ; tenue : sous-vêtements possibles après `c2a` (mouvement spécial 4) puis vêtements normaux restitués par la suite (**[D]**, voir « Points douteux » 6).

#### Passage 1b : jungle, village et marchand (pièces 8 à 15, 20, 21 ; visite brève de la 22)

**État de départ** : sortie du passage 1a, pièce 7.

**Actions** (ordre de dépendances **[D]** ; chaque action est **[V]** pour ses conditions) :

20. [7] Marcher O41 « Camp de la Flöda » -> pièce 22 (entrée 165). [22] Prendre O168 « fleur » (C154) -> **I11 fleur**. [22] Marcher O165 « piton » -> pièce 7. (La fleur est dans la pièce 22 ; le chien O166 ne bloque que la zone 10, voir « Points douteux » 4.) **[V]** pour C154, **[D]** pour le chemin.
21. [7] Marcher O47 « Bob le Marchand » -> pièce 20 (entrée 135) **[V]**.
22. [20] Marcher O147 « porte » (C403 : gs20==0, gs103==0) -> `c21l.CUT` puis dialogue automatique `bob5.DOG` (NOQUIT) : choisir « D'accord, je vous aiderai... » (4/4) puis l'option finale « Bon, maintenant que je connais les détails... » (4/4 au menu suivant) **[D]** (arbre lu, `bob5.DOG` niveaux 1 et 2) ; Joe en pièce 21 ; gs20=1 **[V]**.
23. [21] Donner **I5 (reste de saucisses)** + O161 « Bob le Marchand » (C229) -> `c21d.CUT` ; gs30=1, gs23=1 ; **I24 de l'argent** (1 unité) ; I5 retirée **[V]**.
24. [21] Prendre O148 « aspirateur » (C92 : gs30==1) -> `c21f.CUT` ; **I20 aspirateur** ; gs51=1 ; gs30=0, I24 retirée **[V]**.
25. [21] Marcher O149 « porte » -> pièce 20 ; [20] Marcher O135/O141 « piton » -> pièce 7 **[V]**.
26. [7] Marcher O43 « Jungle » -> pièce 10 (entrée 60). [10] Marcher O62 « passage » -> pièce 8 (entrée 52) ; [8] Marcher O55 « passage » -> pièce 9 (entrée 58) **[V]**.
27. [9] Parler O57 « Skip » (C51 : gs11==0 -> `lou1.DOG`) : **chemin vérifié** (mène à gs81=1, gs206=1, gs11=1 et **I10 B.D**) : 2/3 « Vous lisez quelle bande dessinée? » > 3/3 « Mon ami aussi adore les B.D du "Commandant Rocket"... » > 1/3 « Qu'est-ce que vous avez découvert jusqu'à aujourd'hui... » > 1/3 « Mon ami a tous les numéros de "Rocket", sauf... » > 3/3 « Celui où il se bat contre la pègre de Chicago... » > 1/2 « Votre short est vraiment d'enfer!... » **[V]**.
28. [9] Parler O56 « Bud » (C50) : `bud1.DOG` -> **gs120=1** (irritation ; chemin court vérifié) : 3/3 « Dites, il fait vraiment chaud ici! C'est toujours comme ça? » (menu L1, option 3) puis finir **[V]** (Autre chemin plus long : gs8, gs120, gs160.) 
29. [9] Examiner **I10 B.D** (C668, 1re fois) -> `comic.CUT`, **I99 page déchirée** ; gs173=1 **[V]**.
30. [9] Utiliser **I98 coupon de B.D** + **I99 page déchirée** (C675) -> **I94 plans de la fusée** (I98 et I99 retirés) **[V]**.
31. [9] Examiner **I94** (C677) -> `bluep.CUT` ; **gs195=1** **[V]**.
32. [9] Marcher O59 « passage » -> pièce 11 ; [11] Utiliser (plus tard) épuisette sur O65 « scarabée » (voir 51) ; [11] Marcher O69 « passage » -> pièce 14 (`gs12`=0 : Bud et Skip restent en 9) **[V]**.
33. [14] Parler O86 « dinosaure féroce » (C346 : gs115==1 -> `ape3.DOG`) : **arbre lu** : 2/4 « Comment avez-vous fait pour disparaître l'autre jour? » > 3/4 « Si je vous dis encore que vous n'existez pas, ... » > 1/2 « Désolé, mon vieux, mais vous n'existez pas! » -> **gs115=2**, `c14a.CUT` : le faux dinosaure disparaît (zone 14/9) **[D]** (l'exploreur n'a pas rejoué ce dialogue ; l'arbre le prévoit).
34. [14] Marcher O88 « passage » -> pièce 13 **[V]**.
35. [13] Parler O82 « Mary-Lou » (C53 : gs15==0 -> `tam1.DOG`) : **chemin vérifié** (gs16=1 puis gs133=1) : 1/3 « Pourquoi avez-vous installé une mission ici? » > 1/4 « Pourquoi sont-ils partis en courant? » > 1/3 « Je serais resté pour le rappel! » > 1/4 « Comment faisiez-vous pour parler aux pygmées? » > 1/3 « Puis-je voir ce dictionnaire? » > 3/3 « Merci pour ces renseignements. » -> **gs16=1** **[V]**.
36. [13] Donner **I7 banane** + O80 « singe » (C335 : gs112==0) -> `c13e.CUT` ; gs112=1, gs164=1 ; **I80 noix de coco** ; banane remise à zéro **[V]**.
37. [13] Utiliser **I3 couteau** + **I80 noix de coco** (C329) -> `cocon.CUT` ; gs109=1 (lait de coco) **[V]**.
38. [13] Marcher O77 « passage » -> pièce 14 ; [14] Marcher O90 « souche creuse » (C519, 1re fois `c15a.CUT` gs166=1 ; gs115==2 exigé pour passer, sinon `C14B`) -> pièce 15 **[V]**.
39. [15] Marcher O96 « passage » -> pièce 12 **[V]**.
40. [12] Utiliser **I20 aspirateur** + O72 « orchidée pleine de guêpes » (C88) -> `c12a.CUT` ; gs14=1 (guêpes dans l'aspirateur) **[V]**.
41. [12] Prendre O72 (C861) -> **I13 orchidée** ; gs140=1 **[V]**.
42. [12]->[15]->[14]->[11]->[10]->[7]->[20]->[21] (O76, O95, O69/O87, O66, O60, O47, O147) puis [21] Donner **I13 orchidée** + O161 « Bob » (C243) -> `c21e.CUT` ; gs83=1 **[V]**.
43. [21] Prendre O163 « panier d'épuisettes » (C213 : gs83==1, gs54==0) -> `c21m.CUT` ; **I21 épuisette** ; gs54=1 **[V]**.
44. [11] Utiliser **I21 épuisette** + O65 « scarabée » (C2) -> `c11a.CUT` ; **I12 scarabée** (et poisson O64 retiré) **[V]**.
45. [3] (retour au crash : 7 -> O42 -> pièce 6 -> O38 -> pièce 5 -> O34 -> pièce 3) Utiliser **I21 épuisette** + O18 « parfum » (C319) -> `c3d.cut` ; **I16 parfum** ; gs114=1 **[V]**.
46. [3] Donner **I10 B.D** + O23 « Sparky » (C316 : gs136==0) -> `c3c.cut` ; gs136=1, gs174=1 ; **I93 lime** (I10 reste dans l'inventaire) **[V]**.
47. [21] (retour chez Bob) Parler O162 « Naomi » (C54, gs25==0 -> `naomi.DOG`) : **chemin vérifié** (gs25=1) : 2/4 « A quoi sert le fauteuil de coiffeur, dehors? » > 3/3 « Vous pourriez me couper les cheveux? » > 2/3 « Pourquoi êtes-vous anxieuse pour le rendez-vous... » > 3/3 « Je vais jeter un coup d'oeil... » -> **gs25=1** **[V]**.
48. [21] Donner **I16 parfum** + O162 « Naomi » (C112 : gs25==1 ; ou Utiliser, C797) -> `c21q.CUT` ; gs25=2 ; **I76 ciseaux** ; I16 retiré **[V]**.
49. [13] Donner **I93 lime** + O82 « Mary-Lou » (C593 : gs16==1) -> `c13f.CUT` ; gs15=1, gs16=2 ; **I14 dictionnaire** ; I93 retirée **[V]**.
50. [8] Donner **I11 fleur** + O53 « paresseux » (C99) -> `c8a.CUT` ; gs163=1 ; le paresseux O51 s'approche ; I11 retirée **[V]**.
51. [8] Utiliser **I76 ciseaux** + O51 « paresseux » (C336 : gs31==0) -> `c8b.CUT` ; gs31=1 ; **I9 poils de paresseux** **[V]**.
52. [20] Parler O142 « sorcière du village » : `witch3.DOG` (gs120!=0 : C511 -> witch3) **chemin vérifié** : 1/3 « Qu'est-ce que vous êtes en train de faire? » > 1/3 « Pourriez-vous me fabriquer un remède contre l'irritation? » > 3/3 « Merci pour ces informations. » > 3/3 « C'était un plaisir de discuter avec vous. » -> **gs26=1** **[V]** (si gs120==0, `witch1.DOG` : 1/3, 1/4, 2/4, 2/3, 1/4, 1/3, 2/2 -> gs26=1).
53. [20] Donner **I9 poils** + O142 (C97, 1er ingrédient : gs26==1, gs56==0) -> `c20b.CUT` ; gs56=1 **[V]**.
54. [20] Donner **I80 noix de coco** (lait, gs109==1) + O142 (C340, gs56==1) -> `c20c.CUT` ; gs56=2 **[V]**.
55. [20] Donner **I20 aspirateur** (guêpes, gs14==1) + O142 (C487, gs56==2) -> `c20f.CUT` ; gs14=2 ; gs56=3 ; **I18 lotion** (l'aspirateur reste en inventaire) **[V]** (les trois dons peuvent se faire dans n'importe quel ordre : C97/C98/C483, C339/C340/C484, C485/C486/C487 ; le 3e donne la lotion).
56. [9] (retour : 7 -> 10 -> 8 -> 9) Donner **I18 lotion** + O56 « Bud » (C157 : gs30==0) -> `c9a.CUT` ; gs30=3 (**plein d'argent**, I24 = I72), gs12=1, gs120=2 **[V]**. (Quitter ensuite la pièce 9 par O52 ou O69 déplace Bud et Skip en pièce 15 : C468/C469.)
57. [21] Prendre O152 « disque » (C236 : gs30==3) -> `c21c.CUT` ; gs130=1 ; gs30=1 ; **I19 disque** ; I24 = « de l'argent » (1) **[V]**.
58. [3] (facultatif) Donner **I10** à Sparky déjà fait en 46 ; **Parler O23 « Sparky »** après gs6=1 : `sparky3.DOG` (flavor) **[V]**.

**État d'arrivée (1b)** : pièce 21 puis retour piton 7 ; inventaire : I1, I2, I58, I3 couteau, I40 briquet, I20 aspirateur (vide, gs14=2), I19 disque, I24 de l'argent (gs30=1), I10 B.D, I94 plans de la fusée, I14 dictionnaire, I12 scarabée, I21 épuisette, I18 lotion (donnée en 56, donc absente), (I7 banane si reprise) ; états : gs11=1, gs12=1, gs14=2, gs15=1, gs16=2, gs20=1, gs25=2, gs26=1, gs30=1, gs31=1, gs51=1, gs54=1, gs56=3, gs83=1, gs109=1, gs112=1, gs115=2, gs120=2, gs130=1, gs136=1, gs140=1, gs163=1, gs173=1, gs174=1, gs195=1, gs206=1 **[D]** (cumul des SET lus).

#### Passage 1c : la forteresse des Amazones, capture et donjon (pièces 16 à 19)

**État de départ** : pièce 7 après 1b ; inventaire ci-dessus.

59. [7] Marcher O43 « Jungle » -> r10 -> O63 -> r11 -> O69 -> r14 -> O90 (souche) -> r15 -> O96 -> r12 -> O70 « passage » -> pièce 16 (entrée 99) **[V]** (graphe) ; `C556`-`C533` : chansons seulement.
60. [16] (automatique en marchant dans la zone 3) `c16a.CUT` : deux Amazones parlent devant la forteresse **[V]** (`handleSpecialArea`).
61. [16] Utiliser (ou Déplacer) O97 « boutons » (C699 / C96) -> `c16b.CUT` : piège ; **Joe -> pièce 19** (159,131) ; O101 « sculptures » devient passage (copie de O104), zone 16/1 allumée, O48 visible au piton **[V]**.
62. [19] Parler O129 « prisonnier dépenaillé » (C72) : `man1.DOG`, **chemin vérifié** (gs123) : 2/4 « Vous avez de très jolies poupées. » > 1/3 « Oui, j'aime bien celle qui a un bâton. » -> `c19a.CUT` (gs123=2, gs199=1) puis `faye4.DOG` automatique **[V]**.
63. [19] `faye4.DOG` (Faye, NOQUIT), **chemin vérifié** : 3/3 « Je suis vraiment content de vous voir! » > 1/3 « Mais où suis-je donc? » > 2/2 « Alors, vous allez me faire sortir d'ici? » > 2/3 « Des ennuis? C'est vous qui faites toujours des ennuis! » > 1/3 « Mais je ne vous ai causé aucun ennui! » > 1/2 « C'est du chantage!... » > 3/3 « Bon... Je suis vraiment, vraiment désolé... » -> **I95 poupée** ; `c19b.CUT` **[V]**.
64. [19] Marcher O134 « sortie » (C389 : gs39==0, gs40==0, gs103==0) -> `c18a.CUT` : les Amazones recrutent Joe pour sauver la Princesse Azura ; gs103=1 ; **Joe -> pièce 17** (309,73) **[V]**.

**État d'arrivée (1c)** : pièce 17 (`F4`), Joe en (309,73) ; inventaire + I95 poupée ; états : gs103=1, gs123=2, gs199=1, gs103=1.

#### Passage 1d : retour aux Amazones après le sauvetage d'Azura (pièce 17)

**État de départ** : après le passage 2a (Azura libérée : gs40=1, gs191=0 après `C103G`), Joe en pièce 22 -> piton -> O48 (forteresse) ou autre chemin.

65. [7] Marcher O48 « forteresse des Amazones » -> pièce 16 ; [16] Marcher O101 « sculptures » (devenu passage) -> pièce 17 **[V]**.
66. [17] Marcher O117 « entrée » (C388 : gs40==1, gs102==0) -> `c18c.CUT` (Azura offre la corne, le Docteur Ironstein surgit et exige le Crâne de Cristal ; il menace de transformer les Amazones en dinosaures) ; gs102=1 ; **I17 corne de tyranno** **[V]**. (Variante équivalente par O134 « sortie » de la 19 : C446 -> `c18b.CUT`.)

**État d'arrivée (1d)** : pièce 17 ; inventaire + I17 corne de tyranno ; gs102=1.

**Nombre d'étapes (groupe 1)** : 66 (numérotées 1 à 66 ci-dessus, 2 sous-étapes facultatives comprises).

---

### Groupe 2 : Floda (pièces 22 à 42 et 103)

Deux passages : 2a (infiltration et sauvetage d'Azura) et 2b (évasion de la prison, fusée dorsale pleine). La pièce 42 (embarcadère) est traitée au passage 3a. Les pièces 36, 37, 39 et 40-41 n'ont pas toutes une marche : 36 (`N11`) et 37 (`FAYE_H`) ne sont que des décors de cinématique ; 39 (`N14`, transmogrifier) n'est atteinte que par cinématique.

#### Passage 2a : infiltration, sauvetage d'Azura et fuite (pièces 22 à 35, 38, 40, 41, 103)

**État de départ** : fin de 1c puis visite de 1d impossible avant (gs40=0) ; pièce 7 ; inventaire de fin de 1b (I1, I2, I58, I3, I40, I20 aspirateur, I19 disque, I24 « de l'argent » = 1 unité (gs30=1), I10, I14, I12, I21, I95 poupée…) ; gs51=1 (aspirateur acheté), gs103=1. **Prérequis déduits** : l'aspirateur I20 et le disque I19 (achetés chez Bob), la banane (pièce 4), du temps avant `gs191=1`.

**Actions** (ordre **[D]** : toutes les dépendances sont lues dans les commandes ; chaque commande est **[V]**) :

1. [7] -> r6 (O42) -> r5 (O38) -> r3 (O34) -> r4 (O21) : [4] Prendre O26 « banane » (C8) -> **I7 banane** (pour le cuisinier) ; retour au piton (r4 -> r3 -> r5 -> r6 -> O39) **[V]**.
2. [7] Marcher O41 « Camp de la Flöda » -> pièce 22 (entrée 165) ; [22] Ouvrir O167 « porte » (C10, facultatif : sert pour la fusée, étape 31) **[V]**.
3. [22] Marcher O169 « porte » (C328 : gs78=1) -> pièce 103 (réception ; entrée 724) **[V]**.
4. [103] Donner **I20 aspirateur** + O717 « secrétaire » (C725 : gs28==0) -> `c103l.CUT` ; gs28=1 ; la zone 103/3 s'éteint… **[V]**. (Variante `sec1.DOG`, gs51==1 : 3/3 « Je suis simplement curieux... » > 3/3 « Je suis l'employé du service de désinfection. » > 1/3 « Vous avez parlé de passages secrets?! » -> `c103d.CUT`, gs28=1 **[V]**.)
5. [103] Marcher O716 « passage » (C658 : gs191==0) -> pièce 26 (cuisine, entrée 206) **[V]**.
6. [26] Prendre O197 « croquettes au fromage » (C89 : gs82==0) -> **I25 croquettes** ; gs82=1 **[V]**.
7. [26] Prendre O198 « nourriture pour chiens » (C90 : gs86==0) -> **I26 nourriture pour chiens** ; gs86=1 **[V]**.
8. [26] Parler O196 « chef » (C77) : `chef.DOG`, **chemin vérifié** : 3/4 « Qu'est-ce que vous préparez? » (pose gs55=1 dès cette option) puis 1/3 « Je voudrais un steack-frites... » > 2/3 « Et un simple verre d'eau? » pour quitter **[V]**.
9. [26] Donner **I7 banane** + O196 « chef » (C113 : gs55==1) -> `c26a.CUT` : le cuisinier part ; zone 26/2 allumée ; banane remise à zéro **[V]**.
10. [26] Marcher O201 « porte » -> pièce 27 (garde-manger) **[V]**.
11. [27] Ouvrir O207 « armoire » (C247/C248 ; gs88=1) puis Prendre O207 (C249 : gs88==1, gs87==0) -> **I29 jouet couinant** ; gs87=1 **[V]**.
12. [27] Ouvrir O216 « sac de courrier » (C199) puis Examiner O216 (C201 : gs63==1, gs64==0) -> **I28 lettre** ; gs64=1 **[V]**.
13. [27] Examiner **I28 lettre** (C477) -> gs144=1 (adressée à John Privé) **[V]**.
14. [27] Marcher O217 -> pièce 26 ; [26] Marcher O206 -> pièce 103 ; [103] Marcher O724 -> pièce 22 **[V]**.
15. [22] Donner **I29 jouet couinant** + O166 « chien de garde » (C108 ; ou Utiliser, C459 : gs69==0) -> `c22b.cut` ; gs69=1 ; zone 22/10 allumée ; I29 retiré **[V]**.
16. [22] Marcher O169 -> pièce 103 ; [103] Marcher O718 « porte » (C545 : gs191==0) -> pièce 25 (salon) **[V]**.
17. [25] Utiliser **I19 disque** + O184 « grammophone » (C123) -> `c25a.CUT` (« Un ascenseur secret! ») ; gs84=1 ; O184 devient l'ascenseur ; I19 retiré **[V]**.
18. [25] Examiner O186 « canapé » (C409 : gs135==0, gs30==1) -> `c25g.CUT` ; gs30=2, gs135=1 ; **I24 = un peu plus d'argent** (2 unités) **[V]**. (Alternative C12 si gs30==0.)
19. [25] Marcher O184 « grammophone » (C245 : gs84==1, gs197==0) -> `c25b.CUT` ; **Joe -> pièce 28** (223,92) ; gs197=1 **[V]**.
20. [28] Ouvrir O221 « porte » (C20) ; Marcher O221 -> pièce 34 ; [34] Examiner O245 « caisse » (C585 : gs172==0) -> **I27 ouvre-boîtes** ; gs172=1 **[V]**.
21. [34] Marcher O246 -> pièce 28 ; [28] Marcher O218 « passage » -> pièce 29 ; [29] Marcher O224 « sortie de secours » -> pièce 40 (entrée 285) **[V]**.
22. [40] Prendre O291 « sérum de Super Gringalet » (C351) -> **I78 sérum** **[V]**.
23. [40] Marcher O284 « escalier » (C376 : gs39==0) -> `c41d.CUT` + dialogue `prin1.DOG` (Azura ; flavor, chemin vérifié : 3/3 « Comment avez-vous transmis votre message au... » > 3/3 « Je reviendrai bientôt. ») -> `c41f.CUT` ; gs39=1 ; secrétaire O717 cachée ; Joe en pièce 41 **[V]**.
24. [41] Marcher O303 « escalier » -> pièce 40 ; [40] Marcher O285 -> pièce 29 **[V]**.
25. [29]->[28]->[25]->[103] ; [103] Prendre O725 « crayon » (C589 : gs39==1) -> **I77 crayon** **[V]**.
26. [103]->[25]->[28]->[31] (O219) : [31] Donner **I28 lettre** + O232 « John » (C256 : gs144==1) -> `c31b.CUT` ; gs128=1 ; John retiré (variante : `john1.DOG` 3/4 « J'ai une lettre adressée à un certain John Privé... », `c31d.CUT`) **[V]**.
27. [31] Ouvrir O236 « porte » (C385) -> pièce 38 ; [38] Examiner O267 « planning » (C216) -> gs34=1 ; Marcher O268 -> pièce 31 **[V]**.
28. [31] Ouvrir O235 « porte » (C383) -> pièce 24 (bureau) ; [24] Déplacer O175 « meuble » (C582) -> `c24b.CUT`, coffre-fort O176 visible **[V]**.
29. [29] Ouvrir O225 « porte » (C22 : gs125=1) ; Marcher O225 (C377 : gs124==0, gs125==1) -> `c32a.CUT` + dialogue `henry.DOG` (Henri, NOQUIT), **chemin vérifié** : 3/4 « On vous demande pour les corvées de cuisine. » > 4/4 « Le colonel Jackson. » -> **gs134=1**, `c32b.CUT` : Henri s'en va (O238 retiré, zone 32/1) **[V]**.
30. [32] Marcher O241 « porte » (C461 : gs24==0) -> `c40a.CUT` (Ironstein et Anderson) ; gs24=1, gs118=1 ; Joe en pièce 33 **[V]**.
31. [33] Prendre O242 « livre » (C208) -> **I31 livre** ; Utiliser **I3 couteau** + **I31** (C260 : gs89==0 ; ou I76/I27, C563/C564) -> **I30 clef** ; gs89=1 **[V]**.
32. [33] Marcher O244 -> pièce 32 ; [32] Marcher O237 -> pièce 29 ; [29] Marcher O222 -> pièce 30 **[V]**.
33. [30] Utiliser **I27 ouvre-boîtes** + **I26 nourriture pour chiens** (C104 : gs4==0) -> gs4=1, boîte ouverte **[V]**.
34. [30] Utiliser **I78 sérum** + **I26** (C373 : gs4==1) -> gs43=1 ; **I26 « surprise du chef »** ; I78 retiré **[V]**.
35. [30] Donner **I26** + O226 « Klunk » (C381 : gs43==1) -> `c30c.CUT` ; gs52=1 ; I26 retiré **[V]**.
36. [30] Parler O226 « Klunk » (C78 : gs126==0, gs52==1 -> `klunk2.DOG`) : **chemin vérifié** [gs32=1] : 3/4 « Vous vous prenez vraiment pour un dur, hein? » > 2/2 « Moi, je crois que vous n'êtes pas un vrai dur... » -> `c30b.CUT` : Klunk K.O. ; gs126=1, gs127=1 **[V]**.
37. [30] Ouvrir O231 « porte » (C379) puis Marcher O231 -> pièce 35 (bureau de Frank) **[V]**.
38. [35] Utiliser **I77 crayon** + O250 « bloc-notes » (C347 : gs70==0) -> `c35b.cut` ; **I32 morceau de papier** ; gs70=1 **[V]**.
39. [35] Marcher O253 -> pièce 30 ; [30] Marcher O227 -> pièce 31 ; [31] Marcher O235 -> pièce 24 **[V]**.
40. [24] Utiliser **I32** + O176 « coffre-fort » (C202 : gs73==0) -> gs73=1 ; **I32 retiré** **[V]**.
41. [24] Ouvrir O176 (C205 : gs73==1) -> gs72=1 ; Prendre O176 (C119 : gs72==1, gs74==0) -> `c24a.CUT` ; **I34 cadenas**, **I33 plan de fusée** ; gs74=1 **[V]**.
42. [24]->[31]->[28]->[25]->[103]->[22] ; [22] Marcher O167 -> pièce 23 ; [23] Utiliser **I34 cadenas** + O171 « cadenas » (C118) -> gs27=1 ; **I34 retiré** ; O170 « caisse » ouvrable **[V]**.
43. [23] Ouvrir O170 « caisse » (C117 : gs27==1, gs75==0) -> gs75=1 ; Examiner O170 (C116 : gs75==1, gs76==0) -> **I23 fusée dorsale** ; gs9=1, gs76=1 **[V]**.
44. [23]->[22]->[103]->[26]... Retour jusqu'à la prison : [29] Marcher O224 -> pièce 40 ; [40] Marcher O284 -> pièce 41 **[V]**.
45. [41] Utiliser **I30 clef** + O296 « porte de la prison » (C273) -> `c41a.CUT` : Azura libérée ; gs40=1, gs191=1 ; Joe et Azura -> pièce 103 (189,118) **[V]**.
46. [103] Utiliser O719 « mannequins » (C659 : gs191==1, gs193==0) -> `c103f.CUT` (mouvements spéciaux 21 à 23) ; gs193=1 **[V]**.
47. [103] (facultatif, **[D]**) Utiliser O720 « interrupteur » (C662 : gs39==1, gs191==1, gs194==0) -> `c103j.CUT` ; gs194=1 **[V]**.
48. [103] Parler O721 « Princesse Azura » (C660) : `prin2.DOG`, **chemin vérifié** (gs193=1 requis) : 2/2 « Vous avez vu le garde faire le code pour la porte? » > « Vous avez une mémoire impressionnante! » -> **gs192=1** **[V]**.
49. [103] Utiliser O728 « panneau mural » (C657 : gs39==1, gs191==1, gs192==1) -> `c103g.CUT` ; gs191=0 ; Azura s'enfuit ; **Joe -> pièce 22** (194,147) **[V]**.

**État d'arrivée (2a)** : pièce 22, Joe en (194,147) ; inventaire : I1, I2, I58, I3, I40, I20, I10, I14, I12, I21, I95, I24 (2 unités, gs30=2), I25 croquettes, I23 fusée dorsale (vide), I33 plan de fusée, I27 ouvre-boîtes (I31 livre, I30 clef retirés) ; états : gs9=1, gs28=1, gs30=2, gs34=1, gs39=1, gs40=1, gs69=1, gs72=1, gs73=1, gs74=1, gs75=1, gs76=1, gs82=1, gs86=1, gs87=1, gs89=1, gs126=1, gs127=1, gs128=1, gs134=1, gs135=1, gs144=1, gs172=1, gs191=0, gs192=1, gs193=1, gs197=1 **[D]** (cumul des SET lus).

#### Passage 2b : évasion de la prison et fusée dorsale pleine

**État de départ** : sortie du passage 4b : Joe en **pièce 41** (cellule, Joe en (136,102)), crâne de cristal perdu (I45 retiré par `frank.DOG`), gs45=2, gs201=1 ; la tasse O294 est apparue en pièce 41 quand Joe a passé la porte O329 de la pièce 44 (`C352`).

50. [41] Prendre O294 « tasse » (C584) -> **I92 tasse** **[V]**.
51. [41] Utiliser **I92 tasse** + O296 « porte de la prison » (C583) -> `c41b.CUT` (Faye, Sparky et Anderson viennent l'aider) ; O296 retirée ; **Joe -> pièce 22** **[V]**.
52. [22] Marcher O165 « piton » **sans** gs9==2 -> pièce 7 (normal) ; [7] Marcher O47 -> pièce 20 -> [20] Marcher O147 -> pièce 21 **[V]**.
53. [21] Prendre O158 « alcool » (C122 : gs30==2, gs108==1 -> `c21k.CUT` ; gs30=0 ; **I22 alcool**) **[V]** (gs108 posé par `Examiner O388`, pièce 52 : étape 20 du passage 3a).
54. Utiliser **I22 alcool** + **I23 fusée dorsale** (C111 : gs195==1, gs9==1) -> gs9=2 (fusée pleine) ; I22 retiré **[V]** (inventaire).

**État d'arrivée (2b)** : pièce 21 ; inventaire : … I23 fusée dorsale (pleine), I24 vidée (gs30=0) ; gs9=2, gs195=1.

**Nombre d'étapes (groupe 2)** : 54 (2a : 49 étapes, 2b : 5).

---

### Groupe 3 : temple et labyrinthe (pièces 43 à 61 et 100 à 102 ; j'y ajoute 97, 98, 99, qui n'appartiennent à aucun des six groupes demandés)

**Un seul passage (3a)** : le temple se parcourt d'une traite, de l'embarcadère (42) à la porte de l'oracle (102 -> 63). Le graphe interne des pièces 47 à 61 est un labyrinthe ; **l'ordre à l'intérieur du temple est [D]** (dépendances lues dans les listes de commandes, pas rejouées). Prérequis venus des groupes précédents : I12 scarabée (appât), I21 épuisette (déjà utilisée), I25 croquettes au fromage, I24 argent (au moins 1 unité, **non consommée** par la fente), I20 aspirateur (facultatif, mosaïque), I3 couteau, I40 briquet, I1 batte, I95 poupée, I17 corne (valise) ; états gs102=1, gs103=1.

#### Passage 3a : de l'embarcadère à la porte de l'oracle

**État de départ** : pièce 7 après 1d ; inventaire complet de 2a (+ I17 corne de tyranno).

**Actions** (numérotation propre au groupe 3) :

1. [7] Marcher O44 « embarcadère » -> pièce 42 (entrée 304) **[V]**.
2. [42] Parler O306 « passeur » (C83 : gs41==0 -> `death1.DOG`), **chemin vérifié** (pose gs142=1, le passeur veut un appât) : 2/3 « Hé, dites, c'est quoi votre nom? » > 2/3 « Vous avez l'air très pâle... » > 2/3 « Pourquoi portez-vous cette cape?... » > 4/4 « Génial! » > 1/3 « Je préférais le premier lapin!... » > 1/2 « Je m'appelle Joe King, pilote privé. » > 1/3 « Je n'ai pas dit que je faisais du jogging... » > 1/2 « Vous avez l'air fâché. Quel est le problème? » > 1/4 « Vous pêchez? » > 1/3 « Vous utilisez quoi, comme appât? » **[V]**.
3. [42] Donner **I12 scarabée** + O306 « passeur » (C262 : gs142==1) -> `c42a.CUT` ; gs41=1 ; I12 retiré **[V]**.
4. [42] Parler O306 (C413 : gs45==0 -> `death2.DOG`), **chemin vérifié** : 1/3 « Vous pouvez m'emmener sur l'Ile du Paresseux, ... » (pose gs41=2) -> `c42b.CUT` ; **Joe -> pièce 43** (431,129) **[V]**.
5. [43] Marcher O312 « entrée » (C320) -> pièce 44 (entrée 322) **[V]**.
6. [44] Marcher O321 « porte » -> pièce 45. [45] Donner **I25 croquettes** + O337 « dino rat » (C326) -> `c45e.CUT` (croquettes rendues) **[V]**.
7. [45] Déplacer O336 « corps » (C126) -> `c45c.CUT`, O333 « crâne » visible ; Prendre O333 (C128) -> **I36 crâne** **[V]**.
8. [45] Déplacer O338 « corps » (C127) -> `c45d.CUT`, O332 « bras » visible ; Prendre O332 (C590) -> **I96 bras** **[V]**.
9. [45] Marcher O331 « porte » -> pièce 46. [46] Déplacer O343 « corps » (C133) -> `c46a.CUT`, O340 visible ; Prendre O340 (C129) -> **I35 cage thoracique** **[V]**.
10. [46] Déplacer O345 « corps » (C132) -> `c46c.CUT`, O341 visible ; Prendre O341 (C130) -> **I37 tibia** **[V]**.
11. [46] Marcher O342 « porte » -> pièce 44 **[V]**.
12. [44] Utiliser **I35** + O317 « trou » (C135/136/137), **I36** + O320 « trou » (C138/139/140), **I37** + O319 « trou » (C141/142/143), dans n'importe quel ordre : la 3e pose met gs58=3 et fait apparaître O316 « fente » **[V]**.
13. [44] Utiliser **I24 de l'argent** + O316 « fente » (C607 ; ou Donner, C606) -> gs179=1 ; l'argent n'est pas consommé **[V]**.
14. [44] Utiliser **I96 bras** + O327 « cavité » (C608) -> gs180=1 ; I96 retiré **[V]**.
15. [44] Utiliser (ou Déplacer) O327 « cavité » (C609 : gs180==1, gs179==1, gs58==3) -> `c44a.CUT` (passage secret O329) ; **I96 bras** rendu **[V]**.
16. [44] Marcher O329 « sortie » (C352 : gs58==3) -> `c44b.CUT` ; la tasse O294 apparaît en pièce 41 ; **Joe -> pièce 47** (114,116) et dialogue `oracle1.DOG` (NOQUIT) **[V]**.
17. [47] `oracle1.DOG`, **chemin vérifié** : 1/3 « Une vache à deux jambes avec des prothèses... » > 3/3 « Je sais! C'est un homme dans les trois âges... » > 3/3 « Merci pour l'énigme! A plus tard... » -> **gs137=1** ; `c47a.CUT` : la statue et les portes cachées (O350, O351, O352) se révèlent **[V]**.
18. [47] Marcher O350 « porte » -> pièce 52 (carrefour, entrée 394) **[V]**.
19. [52] Examiner O388 « corps » (C327 : gs106==0) -> **I82 morceau de pierre**, **I81 carte d'identité** ; gs106=1, **gs108=1** (nécessaire à l'alcool de Bob) **[V]**.
20. [52]->[47] puis [47] Marcher O353 « main de pierre » -> pièce 50 (zombies) **[V]**.
21. [50] Dialogue forcé `zombie1.DOG` (zone 6, VAR_BYPASS_ZOMBIES : `C50D.CUT` puis dialogue ; ensuite `C50H` à chaque passage) ; **chemin vérifié** (gs37=1, gs162=1, `c50a.CUT`) : 1/4 « Depuis combien de temps attendez-vous? » > 1/3 « Comment pouvez-vous être vivantes après... » > 3/3 « Je crois bien que vous vous êtes fait... » > 1/3 « Je ne vois aucun Prince ici. Où est-il? » > 1/3 « Comment pouvez-vous être sûre que le Prince est encore là? » > 1/3 « Prouvez-moi qu'il est encore là, ouvrez... » > 2/3 « Vous avez peur qu'il ne soit plus dans... » **[V]**.
22. [50] Prendre O371 « bandelettes » (C368) -> `c50g.CUT` ; **I79 bandelettes** ; gs46=1 **[V]**.
23. [50] Ouvrir O377 « sarcophage » (C372 : gs122==0, gs182==0, gs181==0) -> `c50b.CUT` ; **I97 couronne** ; gs181=1, gs182=1 **[V]**.
24. [50] Utiliser **I3 couteau** + O377 (C614 : sarcophage ouvert gs182==1, gs90==0) -> **I68 liane tordue** ; gs90=1 **[V]**.
25. [50] Fermer O377 (C613 : gs182==1) -> gs182=0 **[V]**.
26. [50] Déplacer O377 (C369 : gs182==0, gs90==1, gs122==0) -> `c50e.CUT` ; gs122=1 **[V]**.
27. [50] Marcher O377 (C370 : gs122==1, gs187==0) -> `c50f.CUT` ; Ian (O680) devient visible en pièce 100 ; **Joe -> pièce 51** (506,146) **[V]**.
28. [51] Utiliser **I3 couteau** + O386 « racine » (C490 : gs146==0) -> gs146=1 ; puis Prendre O386 (C493 : gs146==1) -> **I46 racine** (se reprend à volonté : l'objet n'est pas supprimé) **[V]**.
29. [51] Utiliser **I46 racine** + **I82 morceau de pierre** (C331 ; ou sur I83, C330) -> gs111=1 ; I82 devient collant (I85) ; I46 retirée **[V]**.
30. [51] Reprendre **I46** (Prendre O386, C493) ; Utiliser **I46** + **I1 batte** (C334) -> gs107=1 ; **I1 devient « batte collante »** (I89) ; I46 retirée **[V]**.
31. [51] Reprendre **I46** ; Utiliser **I46** + O383 « fontaine » (C214 : gs68==0, gs42==0 ; ou C215) -> `c51b.CUT` ; gs42=1, gs68=1 ; l'eau O381 disparaît, O382 « gemme bleue » apparaît **[V]**.
32. [51] Prendre O382 « gemme bleue » (C148) -> **I44 gemme bleue** **[V]**.
33. [51] Marcher O378 « porte » (C604 : 1re fois `c100a.CUT` + dialogue `ian1.DOG`, gs177=1) -> pièce 100 (T26) **[V]**.
34. [100] Prendre O674 « piolet » (C572) -> **I42 piolet** **[V]**.
35. [100] Parler O680 « Ian » (C599 -> `ian1.DOG`) puis O675 « Ian » (C600 -> `ian2.DOG` ; sa branche pose gs186=1 puis `c100b.CUT` : gs186=2, gs188=2) **[V]** (le contenu précis des choix n'a pas été rejoué : **[D]**, tous les menus ont été parcourus sans erreur par `dialogs.test.ts`).
36. [100] Utiliser (ou Déplacer) O676 « levier » (C646/C705 : gs187==0, gs186==2) -> `c100d.CUT` ; gs187=1 ; Ian (O675) retiré, O685 « corps pulvérisé de Ian » visible en pièce 101, rayons O688 et inscriptions O690 retirés, zone 101/3 éteinte **[V]**.
37. [100] Marcher O672 « porte » (C648 : gs187==1, gs189==0) -> `c101e.CUT` ; gs189=1 ; pièce 101 (T27) **[V]**.
38. [101] Examiner O685 « corps pulvérisé de Ian » (C571 : gs110==0) -> **I83 morceau de pierre** ; gs110=1 **[V]**.
39. [101] Prendre O687 « disque de pierre » (C594 : gs176==0) -> `c101c.CUT` (brûlant) ; gs176=1 **[V]**.
40. [101] Utiliser **I95 poupée** + O687 « disque de pierre » (C595) -> `c101a.CUT` (la poupée brûle) ; gs190=1 ; **I67 disque de pierre** ; I95 retirée **[V]**.
41. [101] Marcher O683 « porte » -> pièce 56 (T15, entrée 423) (ou O684 -> 100) ; [56] Marcher O423 « cascade » (C649 : gs187==1, gs189==0) peut rejouer `c101d` : sans effet nécessaire **[V]**.
42. Utiliser **I82 morceau de pierre** (collant) + **I83 morceau de pierre** (C332/C333 : gs111==1) -> **I43 clef de pierre** ; I82 et I83 retirés **[V]**.
43. [100] Marcher O671 « porte » -> pièce 55 (T14, entrée 415) ; [55] Marcher O393 -> ... jusqu'à la pièce 48 : le chemin 52 -> 49 -> 48 passe par O392 puis O361 **[D]** (graphe lu dans `rooms.txt`).
44. [48] Utiliser **I42 piolet** + O355 « stalactite » (C146) -> `c48a.CUT` ; O356 « silex » visible ; Prendre O356 (C145) -> **I69 silex** ; Utiliser I42 + O357 « trou » (C144, facultatif, `c48c.CUT`) **[V]**.
45. Utiliser **I69 silex** + **I40 briquet** (C219) -> gs80=1 ; **I40 devient un briquet qui fonctionne** (I70) ; I69 retiré **[V]**.
46. Utiliser **I96 bras** (récupéré) + **I79 bandelettes** (C591/C592) -> **I39 torche improvisée** (I79 devient I90 « reste des bandelettes ») ; I96 retiré **[V]**.
47. Utiliser **I40 briquet** + **I39 torche** (C110 : gs80==1, gs57==0) -> gs57=1 ; **I62 torche allumée** (I39 = src 62) **[V]**.
48. [53] (T12 par 52 O389) Utiliser **I39 (torche allumée)** + O400 « serpent » (C150 : gs57==1) -> `c53a.CUT` ; le serpent disparaît ; O396 « porte » s'ouvre ; zone 53/3 **[V]**.
49. [49] (T9 par 52 O392) Utiliser **I89 (batte collante)** + O362 « gemme verte » (C338 : gs107==1) -> `c49b.CUT` ; **I41 gemme verte** **[V]**. Puis Utiliser **I3 couteau** + **I1 (batte collante)** (C464 : gs107==1) -> **I1 batte** rendue (src 38) + **I46 racine** ; gs107=0 **[V]**.
50. [56] Utiliser **I41 gemme verte** + O421 « oeil » (C191, 1re gemme : gs44==0 -> gs44=1) ; Utiliser **I44 gemme bleue** + O420 « oeil » (C194, 2e gemme : gs44==1) -> `c56a.CUT` : cascades et statue changent ; gs44=2 ; zones 56/3 et 56/4 **[V]**.
51. [56] Prendre O418 « grand bâton » (C345 : gs121==0) -> `c56b.CUT` ; **I84 grand bâton** **[V]**.
52. [49] Utiliser **I84 grand bâton** + O365 « crypte » (C349) -> `c49d.CUT` ; gs65=1 ; I84 retiré **[V]**.
53. [49] Examiner O365 « crypte » (C223 : gs65==1, gs66==0) -> `c49c.CUT` ; **I15 masque mortuaire** ; gs66=1 **[V]**.
54. Utiliser **I79 bandelettes** + **I15 masque mortuaire** (C367 : gs98==0) -> `cmask.CUT` ; gs98=1 (masque propre ; le torche de l'étape 46 a laissé I90 « reste des bandelettes » : si les bandelettes ont déjà servi à la torche, prendre un 2e jeu ou nettoyer d'abord le masque) **[V]**. *Voir « Points douteux » 7.*
55. [55] Utiliser **I15 masque propre** + O410/O411 « surface polie » (C512/C513 ; ou sur O412/O413, C264/C265 : gs165==0, gs98==1) -> `c55a.CUT` : les rayons mortels sont détruits ; gs165=1 ; zone 55/8 **[V]**.
56. [54] (T13 par 52 O390) Utiliser **I43 clef de pierre** + O405 « statue » (C151) -> `c54a.CUT` ; gs141=1 ; autel O404 -> O406 ; zone 54/5 ; apparition de la sortie O406 vers 57 **[V]**.
57. [54] Marcher O406 « sortie » -> pièce 57 (T16, entrée 433) ; [57] Marcher O432 « sortie » (C556/C860 : gs207==0) -> pièce 58 **[V]**.
58. Labyrinthe 58-59-60-61 : [58] Donner **I25 croquettes** + O434 « dino rat » (C266 -> `c58a.CUT`, O443 en 59 visible) ; [59] Donner I25 + O443 (C267 -> `c59a.CUT`) ; [60] Donner I25 + O451 (C268 -> `c60a.CUT`) ; [61] Donner I25 + O460 (C269 -> `c61a.CUT`) ; routes entre les pièces : 58 O437 -> 59 ; 59 O448 -> 60 ; 60 O458 -> 61 ; 61 O463 -> 62 (entrée 475, `C397` : gs207=1 et crée le raccourci O431 depuis 57) **[V]** pour les dons, **[D]** pour le tracé exact (les sorties O435/O438… de chaque pièce forment une grille 3 x 2 ; voir `rooms.txt`).
59. [62] (arrivée de la pièce 61) -- fin du passage 3a ; la pièce 62 est traitée au passage 4b. Joe peut aussi : [62] Marcher O471 « porte » -> pièce 102 (T7, entrée 692) **[V]**.
60. [102] (facultatif) Utiliser **I20 aspirateur** + O695/O696 « mosaïque » (C573/C684 : gs200==0) -> `c102a.CUT` ; gs200=1 **[V]**.
61. [102] Déplacer O711 « inscription en relief » (C639 : gs185==0, gs183==0 -> gs183=1, gs184=1, `c102e.CUT`) **puis** Déplacer O708 « inscription en relief » (C636 : gs184==1) -> `c102b.CUT` ; gs185=1 ; **la porte O693 s'ouvre** (O694) ; toute autre inscription en premier ou entre les deux remet à zéro (`c102c/c102d`, mouvement spécial 33) **[V]**.

**État d'arrivée (3a)** : pièce 102, porte O693 ouverte vers la pièce 63 ; inventaire : … I97 couronne, I15 masque propre (gs98=1), I1 batte, I43 utilisée, I62 torche, I42 piolet, I81 carte d'identité, I24 argent, I23 fusée (vide), I20, I21… ; états : gs37=1, gs41=2, gs44=2, gs57=1, gs58=3, gs65=1, gs66=1, gs80=1, gs98=1, gs106=1, gs108=1, gs110=1, gs111=1, gs122=1, gs137=1, gs141=1, gs146=1, gs165=1, gs176=1, gs179=1, gs180=1, gs181=1, gs182=0, gs185=1, gs187=1, gs189=1, gs207=1 **[D]**.

*Dans le temple restent des pièces facultatives (48 `C48C`, 97, 98, 99) ; le mécanisme de la pièce 99 (axe O660, poulie O657, lianes O666 : I67 + I68 + I1 -> C577/C578/C597/C580/C581) déplace le bloc de pierre O659 et sert de **raccourci** entre 99 et 100 (zone 99/3 et 100/7) : voir « Points douteux » 8.*

---

#### Passage 4b : le gardien de l'oracle, le crâne de cristal et la chaise (pièces 63 et 62)

**État de départ** : sortie du passage 3a : pièce 102, inventaire ci-dessus.

62. [102] Marcher O693 « porte » (C664 : gs175==0 -> `c63c.CUT` + dialogue `oracle2.DOG`, gs85=0, gs175=1) -> pièce 63 (T20, entrée 477 -> `c63c` final 47?) **[V]** (`c63c` : « Encore vous? » ; final 47). *Revenir en 63 après `c63c` par le chemin 47 -> 52 -> 49/... -> 102 : voir « Points douteux » 9.*
63. [63] Donner **I97 couronne** + O476 « gardien » (C665) -> `c63b.CUT` ; **gs45=1** ; O483 « mur de pierre » (src 479) et O477 « porte » (src 480) changent ; gardien retiré ; I97 retirée **[V]**.
64. [63] Prendre O483 « mur de pierre » (C152 : gs45==1) -> `c63a.CUT` ; **gs45=2** ; **I45 crâne de cristal** ; O296 « porte de la prison » (r41) devient src 302 (porte forcée) et O101 « sculptures » (r16) src 103 **[V]**.
65. [63] Marcher O477 / O480 / O481 « porte » -> pièce 102 ; [102] Marcher O692 « porte » -> pièce 62 (T19, entrée 471) **[V]**.
66. [62] Déplacer O472 « panneau mural » (C301, gs100=2) puis Déplacer O473 « panneau mural » (C303 : gs100==2) -> `c62b.CUT` ; gs100=3 ; la chaise O470 apparaît (ou dans l'autre ordre : C302 puis C304) **[V]**.
67. [62] (facultatif) Examiner O474 « inscriptions » (C652 -> `c62d.CUT`, gs178=1) et Examiner O470 (C672) **[V]**.
68. [62] Utiliser O470 « chaise » (C318 : gs100==3, gs45==2) -> `c62a.CUT` (Frank/Ironstein apparaît en tête parlante, pièce 105) ; **I45 retiré** ; dialogue `frank.DOG` (NOQUIT, condition de fin : I45 retiré) : **chemin vérifié** (n'importe quel enchaînement mène à `c62c.CUT`) : 2/2 « Mais pourquoi avez-vous besoin d'autres dinosaures... » > 4/4 « L'acide désoxyribonucléique... » > 1/3 « Vous ne mélangez tout de même pas l'A.D.N... » -> `c62c.CUT` (gs67=2, gs201=1 via `c41f`) ; **Joe -> pièce 41** (136,102) **[V]**.

**État d'arrivée (4b)** : pièce **41** (cellule de la prison de Flöda), Joe en (136,102) ; inventaire sans I45 ni I97 ; gs45=2, gs100=3, gs67=2, gs201=1. Suite : passage 2b (évasion), puis 4c.

---

#### Passage 4c : le lancement (pièce 76) et la vallée (pièces 64 à 68)

**État de départ** : après le passage 2b : fusée pleine (gs9=2), gs45=2, Joe en pièce 21, inventaire avec I23 fusée dorsale, I17 corne de tyranno, I3 couteau, I15 masque propre.

69. [21] Marcher O149 « porte » -> pièce 20 ; [20] Marcher O141 « piton » (C430 : gs9==2, gs45==2) -> **`c76a.CUT`** (gs138=1) -> **Joe -> pièce 76** (168,83) **[V]**. (N'importe quel autre « piton » donne le même résultat : C428 à C434.)
70. [76] Utiliser **I23 fusée dorsale** (C312 : gs9==2, gs138==1) -> `c76b.CUT` ; gs139=1 ; I23 retiré ; **Joe -> pièce 64** (286,141) **[V]**.
71. [64] Marcher O487 « passage » (C436 : gs50==0) -> `c64a.CUT` (Faye, le gros dinosaure) ; gs50=1 ; Joe -> pièce 65 (177,147) **[V]**.
72. [65] Marcher O490 « clairière » -> pièce 66 ; [66] Marcher O494 « clairière » -> pièce 68 **[V]**.
73. [68] Utiliser **I3 couteau** + O508 « branches » (C441) -> **I48 branches** **[V]**. (Prendre à la main : C437 « trop solide ».)
74. [68] Marcher O509 « passage » -> pièce 66 ; [66] Donner **I48 branches** + O496 « gros dinosaure » (C440 ; ou Utiliser, C438) -> `c66a.CUT` ; gs3=1 ; les dinosaures O489/O491 (65), O510/O511 (68) changent ; I48 retirée **[V]**.
75. [66] Marcher O495 « passage » -> pièce 65 ; [65] Marcher O491 « gros dinosaure » (C439 : gs3==1, gs104==0) -> `c67a.CUT` (le dinosaure s'enfuit) ; gs139=2, **gs104=1** ; Joe -> pièce 67 (204,127) **[V]**.
76. [67] Utiliser **I17 corne de tyranno** (C442 : gs104==1, gs105==0) -> `c67b.CUT` (le dernier dinosaure fuit) ; gs105=1 ; zone 67/2 allumée **[V]**.
77. [67] Marcher O502 « passage » (C505 : gs154==0) -> `c69z.CUT` : Ironstein (Frank), le Crâne dans la statue, le robot ; mouvements spéciaux 9 à 12 ; gs154=1 ; **Joe -> pièce 69** (147,145) **[V]**.

**État d'arrivée (4c)** : pièce **69** (`V5`, combat final), Joe en (147,145) ; inventaire : I1, I2, I15 masque propre, … sans I45, I23, I48 ; gs3=1, gs50=1, gs104=1, gs105=1, gs138=1, gs139=2, gs154=1.

**Nombre d'étapes (groupe 4)** : 4a 32 (étapes 1 à 32) + 4b 7 (62 à 68 du texte ci-dessus) + 4c 9 (69 à 77) = 48.
**Nombre d'étapes (groupe 3)** : 61.

---

### Groupe 5 (suite) : le combat final et la fin

#### Passage 5b : la pièce 69 (vallée, combat final) et la fin

**État de départ** : sortie du passage 4c : pièce **69** (`V5`), Joe en (147,145), tenue normale ; inventaire contenant **I15 masque mortuaire propre** (gs98=1, indispensable) ; objets de la pièce : O513/O527 « Frank le monstre », O516 « Faye », O517 « Sparky », O518 « Princesse Azura », O521 « pistolet à rayon dino », O520 « passage » (impossible de partir : C804 « Je ne vais pas abandonner mes amis! »).

**Actions** (numérotation propre au passage 5b ; l'étape 1 du passage 5a est la pièce 75) :

2. [69] Prendre O521 « pistolet à rayon dino » (C497) -> **I47 pistolet à rayon dino** **[V]**.
3. [69] Utiliser **I47** + O513 « Frank le monstre » (C504 : gs149==0, gs150==0) -> `c69e.CUT` (Frank détourne le rayon) ; **gs151=1** **[V]**.
4. [69] Parler O516 « Faye » (C494 : gs150 != 1 -> `faye3.DOG`), **chemin vérifié** : 3/3 « Je voudrais que vous tourniez votre miroir. » (option disponible parce que gs151==1) puis les deux répliques suivantes sont uniques (« Pour que le rayon se reflète dessus quand Frank... », « Merci, Faye. ») -> **gs150=1**, **gs153=1** ; `c69j.CUT` **[V]**.
5. [69] Utiliser **I47** + O513 « Frank » (C506 : gs149==0, gs150==1) -> `c69f.CUT` (le rayon touche Sparky, qui devient un tricératops) ; **gs151=2** **[V]**.
6. [69] Donner **I15 masque mortuaire** + O517 « Sparky » (C498 : gs151==2 ; ou Utiliser, C697) -> `c69i.CUT` ; **gs149=1**, gs155=0 ; I15 retiré **[V]**.
7. [69] Utiliser **I47** + O513 « Frank » (C507, C504/C506 ne passent plus car gs149==1) -> **`c69g.CUT`** : « Hasta la vista, Frank! » ; mouvements spéciaux 9, 10, 13, 14 (`endGame`), 20, 24, 26, 27, 29, 30 ; **Joe -> pièce 110** (394,58) ; générique de fin `#credit2.crd` (`CREDITS`) **[V]**.

**Pièges (à ne pas faire pour un parcours propre)** : Utiliser le pistolet sur Sparky (C499/C500, `c69a/b/k`), sur Faye (C501/C502, `c69c/d/l`) ou sur Azura (C503, `c69h/m`) transforme le personnage en dinosaure sans conséquence (états gs155, gs156, gs152) mais fait perdre du temps ; Donner le pistolet (C731 à C733) est refusé ; Donner le masque avant gs151==2 est refusé (« Je n'ai aucune raison... »).

**État d'arrivée (5b)** : pièce 110 (`E3`) -> générique ; états : gs149=1, gs150=1, gs151=2, gs153=1 ; partie terminée.

**Nombre d'étapes (groupe 5)** : 5a 1 + 5b 6 = 7.

#### Passage 6c (rappel du groupe 6) : générique

Le générique de fin (`#credit2.crd`, 22 pages, `data/credits.ts`) se déroule dans la pièce 110 puis 108-114 ; aucune action ; la partie se termine à la fin du dernier `CREDITS`. **[V]** (`credits.test.ts` lit les deux fichiers jusqu'au bout).

---

### Points douteux / à vérifier au jeu

1. **Pièce où le joueur est libre au début** : l'énoncé dit « hall d'hôtel 73, objet d'entrée 584 ». Dans les données, la pièce 73 est bien affichée avec l'objet d'entrée 584, mais `C70D.CUT` a pour pièce finale **70** (Joe enfermé par Anderson dans sa chambre, en (78,125)). Le joueur est donc libre **en pièce 70**, pas en 73 **[V]**. Les tests de parcours doivent démarrer en pièce 70 (état `gs117=1`, `gs158=1`) ou lancer l'introduction.
2. **Attribution des pièces** : 62, 63 (`T19`, `T20`) et 102 (`T7`) sont des pièces du temple ; la 75 (`D6`) est l'avion de l'acte 1 (fin de course, `and1.DOG`, `C75B`) et non la fin du jeu (qui se joue en 69, 105-114). Les pièces 97, 98, 99 (`T23` à `T25`) ne sont dans aucun des 6 groupes demandés : je les rattache au groupe 3. Les pièces 77-94, 96, 104, 111-114 sont des décors de cinématique **[V]**.
3. **Ordre des passages 1b, 1c, 2a** : seul l'ordre des dépendances est établi ; plusieurs achats chez Bob et trajets peuvent se permuter. Contraintes dures **[V]** : fleur (pièce 22) avant le paresseux ; orchidée (aspirateur) -> épuisette -> parfum (pièce 3) -> ciseaux (Naomi) -> poils ; lotion (3 ingrédients) -> Bud (argent) -> disque ; disque + aspirateur avant Flöda ; crayon seulement après l'escalier de la pièce 40 (gs39) ; toutes les pièces de Flöda (25 à 40) sont inaccessibles quand gs191==1 (guardes, C545/C658) : prendre le cadenas/plans/fusée **avant** le sauvetage.
4. **Chien de Flöda (pièce 22)** : `Donner jouet` allume la zone 10 (0,125-88,131). Le sens exact (le chien bloque-t-il l'arrivée depuis le piton ?) n'est pas lisible dans les données : la fleur O168 est supposée atteignable avant le chien. À confirmer au jeu.
5. **Dialogue `bob5.DOG` forcé** (étape 22 du groupe 1) : ses choix exacts et le moment où il se déclenche (`C403`/`C447`, `c21l.CUT` talk `bob5.dog`) sont lus sur l'arbre, non rejoués.
6. **Tenue de Joe** : `c2a`, `c2c`, `c25a`, `c73a` lancent le mouvement spécial 4 (sous-vêtements) et `c74a` le 3 (vêtements normaux) ; la tenue de Joe pendant 1a, 2a et la suite n'est pas tracée état par état **[D]**. `I58 vêtements` reste dans l'inventaire ; `C279` (Utiliser I58 hors pièce 71) change de tenue.
7. **Bandelettes (I79)** servent à la torche (C591, I79 devient « reste des bandelettes », toujours I79) **et** au masque (C367) : l'objet I79 reste utilisable pour `Utiliser I79 + I15` d'après la liste (la liste teste le numéro d'objet, pas le nom) mais cela n'a pas été rejoué **[D]**.
8. **Pièce 99 et mécanisme de poulie** : l'axe, les lianes, le bloc ne sont pas indispensables d'après les commandes que j'ai lues, mais leurs états (gs170, gs171) pilotent des zones de 99 et 100 (déplacement du bloc O659) ; je ne les ai pas placés dans la liste d'actions. À vérifier : sert-il à rejoindre la pièce 97/98 depuis 47 ?
9. **Pièce 63** : la première traversée de O693 (C664, gs175==0) joue `c63c.CUT` (final : pièce 47, dialogue `oracle2.DOG`) et ramène Joe en 47 ; il faut alors refaire le trajet 47 -> ... -> 102 -> 63. L'itinéraire exact retour est **[D]**.
10. **Temple (étapes 43 à 58)** : tracé exact des portes de 52 à 61 non rejoué ; dépendances et conditions lues **[V]**. La zone 56 (cascades, gem eyes) est supposée requise pour atteindre la pièce 101 depuis 56 ; non rejoué.
11. **Dialogues non rejoués** : `ape3.DOG` (étape 33 du groupe 1), `bob5.DOG`, `ian1.DOG`, `ian2.DOG` ; les autres chemins cités sont **vérifiés** par `test/fotaq/_scratch_dlg.test.ts` (supprimé à la fin).
12. **Passages entre groupes lors du lancement** : les 7 « pitons » listés (C428 à C434) sont vérifiés ; la pièce 76 (`M2`) ne se rejoint **que** par `C76A` ; le retour de la 76 vers 20 se fait par O600 (entrée 141).
13. **Cinématiques `.CUT` « sans état »** : les cinématiques comme `c19b.CUT` (retour en 19) ou `c47a.CUT` (portes cachées) agissent par leur table `states` (non listée en entier ici) : les états que j'ai notés (`gs`) sont ceux des listes de commandes et des dialogues ; les `SET` des cinématiques ont été relevés pour `gs6`, `gs67`, `gs104`, `gs126`, `gs131`, `gs186`, `gs188`, `gs123`, `gs199` (voir `cuts_full.txt`).
14. **Mots clés de pièces dans les tableaux** : « pièce finale » d'une cinématique = `flags` négatif, relevé dans `cuts.txt` (`finalRoom`) ; pour `C73E` le « final 74 » est la pièce de course.

### Sources utilisées

- Données du jeu et code du dépôt : `original/fotaq/` (`QUEEN.JAS`, `QUEEN2.JAS`, `*.DOG`, `*.CUT`), `src/games/fotaq/data/jas.ts`, `dog.ts`, `cut.ts`, `text.ts`, `docs/fotaq/{files,formats,engine,talk,cutaway}.md`, ScummVM de référence en lecture seule (`command.cpp.ref`, `logic.cpp.ref`, `talk.cpp.ref`).
- Soluces publiques consultées : https://adventuregamers.com/walkthrough/full/flight-of-the-amazon-queen (page protégée : seul un résumé a pu être lu : hôtel, site du crash, boutique de Bob, camp de la Flöda, forteresse, temple de l'île du Paresseux, Vallée des Brumes) ; https://www.uhs-hints.com/uhsweb/fotaq (indices progressifs, non repris) ; https://strategywiki.org/wiki/Flight_of_the_Amazon_Queen/Walkthrough (HTTP 403, non lu). **Aucune étape de ce document n'est donc « soluce publique seulement »** : le résumé public confirme l'ordre général (hôtel -> crash -> jungle et Bob -> Flöda -> forteresse -> temple -> vallée) que les données établissent déjà.

### Annexe : objets d'inventaire cités (numéro d'`Item`, `items.txt`)

I1 batte, I2 journal, I3 couteau, I5 saucisses (puis I71 reste de saucisses), I6 hélice, I7 banane, I8 liane, I9 poils de paresseux, I10 B.D, I11 fleur, I12 scarabée, I13 orchidée, I14 dictionnaire, I15 masque mortuaire (I87 propre), I16 parfum, I17 corne de tyranno, I18 lotion, I19 disque, I20 aspirateur, I21 épuisette, I22 alcool, I23 fusée dorsale, I24 de l'argent (I64/I65/I72/I73 selon le montant), I25 croquettes au fromage (I75 reste), I26 nourriture pour chiens (I63 boîte ouverte, I88 « surprise du chef »), I27 ouvre-boîtes, I28 lettre, I29 jouet couinant, I30 clef (livre), I31 livre (I74 ouvert), I32 morceau de papier, I33 plan de fusée, I34 cadenas, I35 cage thoracique, I36 crâne, I37 tibia, I39 torche improvisée (I62 allumée), I40 briquet (I70 en état), I41 gemme verte, I42 piolet, I43 clef de pierre, I44 gemme bleue, I45 crâne de cristal, I46 racine, I47 pistolet à rayon dino, I48 branches, I49 perruque, I50 serviette, I51 autre drap, I52 drap, I53 draps attachés, I54 barre à mine, I55 faux seins, I56 robe, I57 clef (hôtel), I58 vêtements, I59 paille, I60 huile, I61 poulet, I67 disque de pierre, I68 liane tordue, I69 silex, I76 ciseaux, I77 crayon, I78 sérum de Super Gringalet, I79 bandelettes (I90 reste), I80 noix de coco, I81 carte d'identité, I82/I83 morceaux de pierre (I85/I86 collants), I84 grand bâton, I89 batte collante, I92 tasse, I93 lime, I94 plans de la fusée, I95 poupée, I96 bras, I97 couronne, I98 coupon de B.D, I99 page déchirée.

## 8. Groupe 6 : introduction, générique et piton (fait)

Code : `specials/group-6/` (`ids.ts`, `intro.ts`, `moves.ts`, `index.ts`) ; tests : `test/fotaq/specials/group-6/` (`intro.test.ts`, `moves.test.ts`, `pinnacle.test.ts`) et `test/fotaq/specials/{assemble,kit,walkthrough}.test.ts` pour la mise en place.

| Élément | ScummVM | Où |
| --- | --- | --- |
| pièce 95 : `COPY`, `CLOGO`, `CDINT`, `CRED`, hall de l'hôtel (objet 584), `C70D`, état 117 | `LogicGame::changeToSpecialRoom` | `intro.ts` `introRoom` |
| pièce 7 : la destination se choisit à la souris, texte « Aller vers… » en haut, morceau de la destination | `Logic::handlePinnacleRoom` | `intro.ts` `pinnacleRoom` |
| 15 et 16 : caméra sur le dinosaure (défilement à 320 par 16, puis bob 1), sur Joe | `asmPutCameraOnDino`, `asmPutCameraOnJoe` | `moves.ts` |
| 17 et 18 (`CINTR`) : panoramique droite (285) et gauche (0, par 4), mode rapide | `asmAltIntroPanRight`, `asmAltIntroPanLeft` | `moves.ts` |
| 34 (`CRED`) : le titre monte en grossissant | `asmScaleTitle` (DOS) | `moves.ts` |
| 36, 38, 39 (`CDINT`) : panoramiques vers Hugh, Joe et Rita, la bombe ; 37 : éclair blanc | `asmPanRightToHugh`, `asmPanRightToJoeAndRita`, `asmPanLeftToBomb`, `asmMakeWhiteFlash` | `moves.ts` |

**Vérifié** : l'introduction se joue seule jusqu'à la première pièce jouable (**2 780 ticks**, soit 4 min 38 s de jeu : `COPY`, `CLOGO`, `CDINT`, `CRED`, `C70D`, pièce 70, état 117 = 1, aucun avertissement) et se saute par Échap (**66 ticks**, mêmes cinématiques, même état) ; le générique de début s'affiche ; une fois l'introduction jouée, la pièce 95 est une pièce ordinaire ; le générique de fin (`#credit2.crd` de `C69G`) se déroule jusqu'à sa dernière page, la pièce 110 restant affichée ; chaque mouvement (durée, défilement final, bobs, arrêt par `cutawayQuit`) ; le piton (caméra libre, Joe et la montagne suivent la souris, texte du survol, clic, pièce d'arrivée, objet d'entrée, morceau) pour les cinq destinations visibles.

**Écarts** :
- `CINTR` (option `alt_intro` de ScummVM) n'est jamais jouée : l'introduction du CD est `CDINT` ; ses mouvements 17 et 18 existent ;
- l'éclair du mouvement 37 dure une image de jeu (100 ms) ; ScummVM rétablit la palette tout de suite ;
- mode rapide : porté par `FAST_RATIO` (dix images par tick) ; dans ScummVM le temps réel dépend du dessin ;
- `inventoryRefresh` n'a pas d'équivalent (l'inventaire est redessiné à chaque image) ;
- piton : **reproduits** à l'identique, l'objet visé reste celui du dernier survol quand la souris quitte les objets, un clic donné avant tout survol part dès qu'un objet est visé, et le texte « Aller vers… » est reposé à chaque image tant que la souris est sur un objet (ScummVM compare un numéro de zone local à un numéro d'objet global, toujours différents) ; les destinations cachées (forteresse des Amazones) apparaissent avec leur objet ;
- le générique de fin **complet** (blimp, échelle de fin, `endGame`) dépend des mouvements 14, 26 à 30 du groupe 5 : sans eux la cinématique `C69G` finit avant ses pages (le test attend la fin du générique pendant que le jeu est rendu au joueur) ; à compléter par le groupe 5 : la partie se termine par `g.endGame()` (`host.exit`).

**Points ouverts** : durée du fondu de la pièce 7 à comparer au jeu d'origine ; vérification à l'écran de l'introduction (voir `engine.md` § 7).
