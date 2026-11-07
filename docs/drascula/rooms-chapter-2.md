# Drascula : chapitre 2 (vague P)

Le village de Transylvanie : pièces 1 à 10, 12 et 14 à 19. Le héros cherche Von Braun, le seul qui sache affronter les vampires, et lui rapporte les cinq ingrédients de sa potion. Il commence dans l'auberge (14) et finit dans le puits du cimetière (19), par le chapitre 3 (pièce 20).
Convention : `rooms.md` (§ 2 à 5) ; modèle : le chapitre 1 (§ 7). Référence de comportement : `rooms.cpp`, `animation.cpp`, `drascula.cpp`, `objects.cpp`, `actors.cpp` d'`engines/drascula` (ScummVM, GPL v3+). **Confiance** : **lu** = lu en entier dans ScummVM ; **vérifié** = couvert par un test sur les fichiers du jeu ; **vu** = image composée et regardée (captures du rendu des tests, pas le navigateur) ; **supposé** = à confirmer.

## 1. Fichiers

```
src/games/drascula/engine/rooms/chapter-2/
  index.ts       ChapterScript : tables, checkAction, leaving, updateDoor, roomLoaded, frame, tick
  ids.ts         objets des pièces, objets de l'inventaire (Item), drapeaux (Flag), table des portes (DOOR_FLAGS), clés de `anim`
  anim-kit.ts    aides des cinématiques : image libre, updateAnim, hoquet sans personne, feuilles du héros, lumière (`freezeRoom` et `pose` : `engine/room-kit.ts`)
  room-NN.ts     une pièce : gestionnaire, painter, avance (tick), cinématiques propres (01 02 03 04 05 06 07 08 09 12 14 15 16 17 18 19)
test/drascula/rooms/chapter-2/
  route.ts       la solution découpée en étapes (joueur scripté) et `startIn` pour les tests de pièces
  room-NN.test.ts (01 à 10, 12, 14 à 19), rules.test.ts (checkAction, updateDoor, roomLoaded, leaving), walkthrough.test.ts (passage)
```

Pas de `room-10.ts` (la carte n'a ni gestionnaire ni mise à jour : le moteur donne le nom des lieux, `showMap`) ni de `room-19` côté verbes (seule la cinématique du puits).

## 2. Pièces et ce qu'elles portent

| Pièce | ScummVM | Où | Contenu |
| --- | --- | --- | --- |
| 1 église | `room_1`, `update_1_pre` | `room-01.ts` | regarder la porte (1, 2) et la fenêtre bloquée (14) ; lumière sombre devant la porte (98 < x < 153) ; fenêtre bouchée tant que le drapeau 8 est bas |
| 2 carrefour | `update_2` | `room-02.ts` | chauve-souris à 41 images (une toutes les 6 ticks), morceau de décor repeint, `showMap` |
| 3 cimetière | `room_3`, `update_3`, `animation_7_2` | `room-03.ts` | tombe, panthéon, barreau (prendre : le piton), plante (la faucille : feuilles) ; premier plan |
| 4 village | `room_4`, `update_4` | `room-04.ts` | pousser le tonneau : chewing-gum ; lumière sombre à droite (x > 190) |
| 5 mur de la chapelle | `room_5`, `animation_5_2`, `animation_2_2` | `room-05.ts` | le piton sur la fenêtre (elle s'ouvre, drapeau 8) ; l'escalade, hoquet sur le décor nu |
| 6 chambre | `room_6`, `update_6_pre` | `room-06.ts` | porte (index 1), armoire, tiroir (le crucifix apparaît), crucifix, candélabre ; lumière selon la position |
| 7 chapelle | `room_7` | `room-07.ts` | la bougie |
| 8 impasse | `room_8` | `room-08.ts` | les mouchoirs dans la poubelle |
| 9 aveugle | `room_9`, `update_9_pre`, `animation_4_2`, `animation_6_2` | `room-09.ts` | lui parler (deux fois), lui donner l'argent (la faucille) ; l'aveugle animé |
| 10 carte | (`showMap` du moteur) | — | rien à porter |
| 12 rue | `room_12` | `room-12.ts` | ouvrir et fermer la porte 156 (index 4) |
| 14 auberge | `room_14`, `update_14_pre`, `animation_11_2`, `12_2`, `13_2`, `16_2`, `26_2`, `36_2` | `room-14.ts` | barman, pianiste (menu OP_1, le livre), ivrogne (menu OP_2, l'histoire de Von Braun) ; bougies, clignement, pianiste, ivrogne |
| 15 couloir | `room_15`, `animation_34_2` | `room-15.ts` | le distributeur : deux pièces, la pièce rendue, le coup de pied, les cigarettes |
| 16 chambre d'hôtel | `room_16`, `update_16_pre` (partie chapitre 2) | `room-16.ts` | porte (index 0), coffre (le sac de B.J.), miroir ; coffre ouvert et porte fermée dessinés |
| 17 cabane | `room_17`, `animation_20_2` | `room-17.ts` | sonner, parler à travers la porte (OP_3), l'épreuve |
| 18 laboratoire | `room_18`, `update_18_pre`, `animation_14_2`, `23_2`, `24_2`, `25_2`, `27_2`, `29_2`, `31_2` | `room-18.ts` | le livre, les bouchons d'oreilles, Von Braun (OP_4, OP_5), la machine, la potion ; ronflement |
| 19 puits | `animation_35_2` | `room-19.ts` | le héros dans le puits, hoquet, fondu ; le chapitre finit |

Points globaux (`index.ts`) : `checkAction` (le sac de B.J. dans l'inventaire : 164 puis 307 ; les bouchons d'oreilles sur le héros : 315 partout sauf pièce 18), `leaving` (`exitRoom` : `animation_2_2` pour la porte 136, la traversée de la porte 124, `animation_35_2` + `endChapter` pour le puits 173, le départ du pianiste à la porte 146, les bouchons d'oreilles rangés à la porte 176), `updateDoor` (table `doors` : 138, 136, 156, 163, 177, 175, 173), `roomLoaded` (`updateVisible` des pièces 2, 3, 6, 7, 14, 18 ; musique des pièces 14 et 15 ; `savedTime` des pièces 2, 9, 14, 18), `frame` (les deux corrections de position de `runCurrentChapter`, pièces 3 et 14), `tick` (chauve-souris, aveugle, auberge, ronflement). **Vérifié** : `rules.test.ts`.

## 3. Cinématiques de pièce

Vingt et une, enregistrées sous le nom des réponses (`animations["20_2"]`…) : `2_2`, `4_2`, `5_2`, `6_2`, `7_2`, `11_2`, `12_2`, `13_2`, `14_2`, `16_2`, `20_2`, `23_2`, `24_2`, `25_2`, `26_2`, `27_2`, `29_2`, `31_2`, `34_2`, `35_2`, `36_2`. Les pièces les appellent directement ; le menu des choix passe par `g.animation("16_2")` (`dialogs.ts`).

**Technique.** ScummVM écrit les rectangles d'animation dans `screenSurface` (`updateAnim`, `copyBackground(...)`, `updateScreen(rect)`), qui garde le reste de l'écran. Ici l'image libre (`gfx.canvas`) tient ce rôle (`graphics.md` § 11) :
- `freezeRoom(g, parts)` (`room-kit.ts`) compose l'image de la pièce dans l'ordre de `updateRoom` (décor, `pre`, héros ou pose, ce qui vient entre, `post`) et la fige dans le canvas ; `pose(...)` remplace le héros par un rectangle de feuille (prendre le barreau, ouvrir le tiroir…) ;
- `updateAnim(...)` écrit les images de la cinématique dans le canvas ; `showBackground` est `copyBackground(); updateScreen();` ; `drawRect` ne garde que le rectangle d'une image (`updateScreen` partiel) ;
- **l'ordre compte** : la pièce est figée **avant** que `an5_x`, `an34_x`, `an32_x`… ne remplacent les feuilles du héros ou la feuille annexe (sinon la pièce est composée avec les mauvaises images : constaté sur les captures) ; `restoreHeroSheets` remet celles de la fiche ensuite ;
- `g.updateRoom()` rend la main à la pièce.

**Cinématiques notables.**
- `animation_4_2` et `6_2` (l'aveugle) : le décor `CIEGO1.ALG` et quatre feuilles remplacent la pièce (`clearRoom`), les répliques de l'aveugle lisent `bg` et les feuilles (`blindHead`). **Vu** (5 images).
- `animation_14_2` / `25_2` / `23_2` (la machine, l'épreuve) : `animation_14_2` recopie l'écran dans le décor (`memcpy(bgSurface, screenSurface)`), `23_2` y remet des rectangles. `gfx.bg` est écrasé de la même façon et rechargé par `25_2` (`loadPic(18, bgSurface)`). **Vu** (12 images).
- `animation_16_2` : cinq écrans (`his1.alg` à `his4_2.alg`, texte `texthis`) sur l'image libre, défilement, fondu, retour de la pièce (`asco`). Échap la saute.
- `animation_20_2` appelle `exitRoom(1)`, `animation_23_2` et `exitRoom(0)` du moteur : le héros entre vraiment dans le laboratoire et en ressort.

## 4. Écarts à ScummVM

- **Avance des animations** : séparée du dessin (`rooms.md` § 4). `tickCrossroads` (chauve-souris : une image toutes les 6 ticks, `>= 6`), `tickBlindAlley` (aveugle : 11 ticks, debout quand le drapeau 9 est levé), `tickInn` (auberge : 7 ticks, `> 6`, comme `tickInn` du chapitre 1), `tickLab` (ronflement : 10 ticks, `> 9`). ScummVM n'avance qu'au redessin de la pièce (jamais pendant un `pause` nu) : ici l'avance suit le temps du jeu, y compris pendant les répliques (l'ivrogne qui parle attend la fin de son geste). Cadence à comparer au jeu d'origine.
- **Auberge partagée** : `innPainter` (partie `pre`) et `tickInn` sont ceux de `engine/inn-kit.ts`, communs avec la pièce 62 du chapitre 1 (même code dans ScummVM).
- **`showMap` de la pièce 2** : celui du moteur (`MAP_ROOMS`).
- **Boucles sans pause** (`animation_14_2`, `animation_25_2`, `hipo_sin_nadie`) : ScummVM les laisse tourner à la vitesse d'affichage. Ici 2 ticks (~50 images par seconde) pour la machine, `pause(3)` par sursaut pour le hoquet sur le décor nu (comme `hiccup`) ; à comparer au jeu d'origine.
- **Saut de l'histoire** (`16_2`) : ScummVM la saute à n'importe quelle touche, ici Échap seul (`skippable`).
- **`_system->delayMillis(1000)`** de l'aveugle : une seconde réelle, 100 ticks (pas le doublement de `delay`).
- **`room_17`, branche des bouchons d'oreilles** (objet 11 sur le héros, drapeau 22 bas) : inatteignable dans ScummVM (la partie du chapitre de `checkAction` répond 315 avant, sauf pièce 18) ; non reprise.
- **Pièce 16** : la chambre de B.J. du chapitre 1 (`animation_2_1`) porte le même numéro ; les painters sont rangés par chapitre, `hotelPainter` n'a plus de garde.
- **Le tiroir de la chambre revient** à la fiche (visible) quand on retourne dans la pièce après avoir pris le crucifix : `updateVisible` ne le cache plus (drapeaux 1 et 10 levés). Comportement de ScummVM, reproduit et testé.
- **`isDoor`** n'est remis à jour qu'à l'entrée dans la pièce et au clic sur la porte (`updateDoor`), comme ScummVM : la fenêtre de la pièce 5 s'ouvre au clic qui suit l'animation du piton.

## 5. Solution du chapitre

1. Pièce 14 : parler à l'ivrogne, « Où puis-je trouver Von Braun ? » (drapeau 40 : la cabane du carrefour devient une porte).
2. Pièce 16 : ouvrir le coffre (le sac de B.J.), puis regarder le sac dans l'inventaire (un billet, deux pièces : drapeau 23). Pièce 15 : les deux pièces dans le distributeur, puis le pousser (cigarettes).
3. Pièce 8 : regarder la poubelle (mouchoirs). Pièce 9 : parler deux fois à l'aveugle, lui donner l'argent (faucille). Pièce 4 : pousser le tonneau (chewing-gum).
4. Pièce 3 : prendre le barreau (piton), couper la plante à la faucille (feuilles). Pièce 5 : le piton sur la fenêtre, entrer. Pièce 6 : ouvrir le tiroir, prendre le crucifix, ouvrir la porte. Pièce 7 : prendre la bougie. Les cinq ingrédients sont réunis (drapeau 38).
5. Pièce 17 : sonner (ouvrir la porte), lui parler, « N'ayez pas peur » : l'épreuve (sans bouchons d'oreilles, il prend l'argent). Pièce 18 : prendre le livre. Pièce 14 : le donner au pianiste (bouchons d'oreilles).
6. Pièce 18 : les bouchons d'oreilles sur le héros, parler à Von Braun (OP_4, n'importe quel choix : l'épreuve passe, il rend l'argent), puis de nouveau (OP_5, « J'ai tous les ingrédients ») : la potion ouvre le puits.
7. Pièces 7, 19 : le puits. Le chapitre 3 commence (pièce 20).

## 6. Tests (151)

`test/drascula/rooms/chapter-2/` (ignorés sans `original/drascula/`) : un fichier par pièce (objets de la fiche, verbes et voix jouées, drapeaux, portes et pièce d'arrivée, avance de `state.anim`, pixels des painters comparés aux feuilles, cinématiques : voix, feuilles remises, image rendue à la pièce), `rules.test.ts` (points globaux), `walkthrough.test.ts` : la solution complète (de l'auberge à la pièce 20), la partie complète (tous les choix, Échap pendant l'histoire de l'ivrogne), le puits fermé. Chaque test de pièce arrive par `startIn(pièce, { flags, items, arrival })` (aides d'état du moteur, permises hors passage) ; le passage n'emploie que `Walkthrough` (clics, touches).

## 7. Points ouverts et à vérifier

- **`response(29)`** (réglé en consolidation) : `converse.cpp` lu en entier (copie dans la référence locale). `response()` joue le scénario de la réponse (sauf 31) **avant** `animation_29_2`, comme `Dialogs.respond` : l'ordre est le bon. Le scénario 29 finit par `setFlag(33)`, donc la branche « drapeau 33 bas » d'`animation_29_2` est inatteignable dans ScummVM aussi et Von Braun conclut toujours par `VB43` après l'histoire (un recouvrement probable de ScummVM : l'animation jouait elle-même le scénario avant que les scénarios deviennent des données, d'où la dispense déjà faite pour 31). **Écart voulu** (décision de l'utilisatrice) : `Dialogs.respond` ne joue plus le scénario 29 au chapitre 2, `animation_29_2` le joue elle-même. La première fois, Von Braun raconte l'histoire une seule fois sans `VB43` ; les fois suivantes, il dit `VB43` à la place. À comparer au jeu d'origine si on l'obtient.
- **`texthis`** (réglé en consolidation) : « ¡L Y A LONGTEMPS… » n'est pas un défaut du portage. Le texte (`Il y a longtemps…`, octets 73 108…) est correct ; la police n'a qu'un glyphe pour « I » et « i » (colonne 78 de `95.ALG`) : un point, un vide, un trait, soit le dessin de « ¡ ». Table et feuille sont celles de ScummVM. Tous les « I » du jeu ont cette forme (`test/drascula/render/font-original.test.ts`). Les accents en casse mixte (« prÊt », « chÂteau ») sont dans le texte d'origine (`dat.test.ts`).
- **Visuel** : images regardées sur des captures du rendu des tests (auberge, couloir, impasse de l'aveugle, laboratoire, épreuve, histoire, cimetière, chapelle) ; **pas vu dans le navigateur** (pas de navigateur lancé pendant la vague). À regarder : le hoquet de la machine (burn du décor), les images de l'aveugle, le pianiste qui se retourne.
- **Voix `B*.ALS`** de l'ivrogne : seules `B4` à `B14` sont jouées par ce chapitre (scénarios 13, 15, 17 et `animation_16_2`) ; non écoutées.
- **Cadences** (animations, boucles de la machine) : lues dans ScummVM, non mesurées sur le jeu d'origine.
- **Musique** : `roomMusic = 16` après le livre ; la piste 32 de l'histoire est celle du français (30 en espagnol).
- **`animation_16_2`** : le texte reste centré en (180, 180), couleur vert foncé (`color_abc(kColorDarkGreen)`) ; la couleur du texte est rétablie à vert clair au prochain `converse`.

## 8. Aides manquantes (traitées en consolidation)

- `MAP_ROOMS` (`loop.ts`) contient la pièce 2 ; `tickCrossroads` n'avance plus que la chauve-souris.
- Les painters sont rangés par (chapitre, pièce) (`assemble.ts`, `GameScript.painters[chapitre][pièce]`) : la garde `chapter === 2` de la pièce 16 est retirée.
- `Dialogs.respond` : voir le premier point ouvert.
- `update_16_pre` du chapitre 1 : B.J. debout est dessinée par `bedroomPainter` (`chapter-1/bj-scene.ts`, pièce 16 du chapitre 1), testé par `test/drascula/rooms/chapter-1/room-16.test.ts`.
- `innPainter` / `tickInn` ne sont plus recopiés du chapitre 1 : `engine/inn-kit.ts` (`advanceInn`, `drawInn`) ; `freezeRoom` et `pose` sont dans `engine/room-kit.ts`.
