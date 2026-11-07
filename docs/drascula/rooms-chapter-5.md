# Drascula : chapitre 5 (le château)

Vague P, chapitre 5 : pièces 45 (carte des tours), 49 à 55, et 56 et 57 (atteintes par cinématique). Convention : `rooms.md`. Code : `src/games/drascula/engine/rooms/chapter-5/`, tests : `test/drascula/rooms/chapter-5/`.
Référence : `room_49`, `room_53` à `room_56`, `updateVisible`, `animation_1_5`, `animation_5_5`, `animation_12_5` (+ `_frankenstein`), `animation_14_5` (rooms.cpp, objects.cpp, animation.cpp de ScummVM).

## 1. Ce qui est porté

| Élément | ScummVM | Où |
| --- | --- | --- |
| carte des tours : héros invisible, tour 4 visible une fois le drapeau 6 levé | `enterRoom`, `updateVisible` | `index.ts` `roomLoaded`, `screen.ts` `updateVisible` |
| arrivée dans le bureau : scénario 4 tant que le drapeau 7 est bas | fin d'`enterRoom` | `index.ts` `roomEntered`, `room-49.ts` `arrival` |
| loup-garou (menu 9), os sur le loup-garou ou la fenêtre | `room_49` | `room-49.ts` `room49` |
| le lancer de l'os, le loup-garou emporté | `animation_5_5` | `room-49.ts` `boneThrow` (`animations["5_5"]`) |
| fiche (ramasser, brancher), vis et cerveau sur Frankenstein, interrupteur | `room_53` | `room-53.ts` `room53` |
| la renaissance de Frankenstein, sa marche, le hoquet, l'arrivée dans le couloir 57 | `animation_12_5`, `animation_12_5_frankenstein` | `room-53.ts` `reanimate` (`animations["12_5"]`) |
| squelette (menu 10), os, épingle sur le cadenas | `room_54` | `room-54.ts` `room54` |
| B.J. derrière la porte (scène, menu 8) | `animation_1_5` | `room-54.ts` `meetBj` (`animations["1_5"]`) |
| vis, porte piégée (`det.bin`) | `room_55` | `room-55.ts` `room55` |
| ouvrir le cercueil, fin du chapitre | `room_56`, `animation_14_5` | `room-56.ts` `room56`, `coffinOpened` (`animations["14_5"]`) |
| regarder l'objet 9 de l'inventaire (482, 483) | partie du chapitre 5 de `checkAction` | `index.ts` `checkAction` |

Pas de `update_N` au chapitre 5 : aucun painter ni `tick` (les rectangles de `roomPreUpdates` / `roomUpdates` de `drascula.dat` suffisent : carreau du bureau, monstre sur la table, fiche, interrupteur, bouche du squelette, cercueil ouvert). Pas de `room_45`, `50`, `51`, `52`, `57` dans ScummVM : leurs portes sont celles des fiches.
Solution du chapitre : l'os (crypte, tour 2) au loup-garou (bureau, tour 3) ; la vis (atelier, tour 4, ouverte par le départ du loup-garou) et le cerveau (inventaire) sur Frankenstein, la fiche du sol (laboratoire, tour 1) dans la prise, l'interrupteur ; le couloir 57, la chambre 56, le cercueil.

## 2. Écarts à ScummVM

- **Cinématiques qui dessinent sur l'écran** (`5_5`, `12_5`) : ScummVM copie des sprites dans `screenSurface` et pousse des rectangles. Ici la pièce telle que la compose `updateRoom` est gelée dans l'image libre (`gfx.canvas`, `screen.ts` `freezeRoom`), les sprites sont copiés par-dessus, et la pièce reprend la main à `updateRoom()`. Les feuilles `3an5_*.alg`, `3an11_1.alg`, `auxfr.alg` sont lues par `gfx.sheet` sans toucher à `back` / `front` / `extra` (ScummVM les y charge, puis remet `99.ALG` et `97.ALG`).
- `animation_5_5` : seul le rectangle de 97 x 64 autour du héros est rafraîchi à chaque image (comme `updateScreen(pixelX, …)` : le reste de l'écran garde la pièce gelée, le sprite de 26 x 24 posé en (198, 81) y reste). Le balayage en bandes de 19 lignes n'est montré qu'à la fin (un seul `updateScreen` dans l'original) : on calcule l'image finale. La dernière image de `3an5_4` est recouverte tout de suite par l'image 101, comme dans l'original (jamais visible).
- `animation_12_5` : les trois palettes assombries sont recalculées à partir de la palette du jeu (`flashPalettes`) et montrées par `palette.showExternal` ; les `animate` (`rayo1`, `rayo2`, `frel`) se sautent chacun avec Échap (le reste de la scène continue, pas de saut global ; ScummVM garde `term_int`).
- `room_56` : ScummVM appelle `room(56, …)` depuis `checkAction`, puis, si rien n'a répondu, une seconde fois ; une ligne de `roomActions` de la pièce (regarder le cercueil, 450) y serait dite deux fois. Ici une fois (probablement un oubli de l'original, à confirmer sous ScummVM).
- `room_53` : `pickedObject = kVerbMove` après avoir branché la fiche n'est pas repris (le curseur est vide : `takeObject` est faux, sans effet).
- `animation_1_5` : la boucle `while (_characterMoved) { updateRoom(); updateScreen(); }` est une boucle de `pause(3)` (comme `walkToPoint`).
- Numéros d'objets de l'inventaire (`Item` dans `ids.ts`) : 8 os, 10 épingle, 12 vis, 15 cerveau, 16 fiche (déduits des répliques de `roomActions` et des numéros de ScummVM) ; l'objet 9 (réplique 482, 483) n'est nommé que `Cross`, d'après `kItemCross2`.
- La carte (pièce 45) : cliquer dans le vide lance une marche du héros invisible qui ne finit jamais (le héros est ramené à (0, 0) à chaque image, `walk.ts`, correctif n° 5903 de ScummVM) ; sans effet à l'écran. ScummVM laisse cette marche en cours jusqu'à la sortie ; `walk.ts` l'arrête dès que le héros est ramené à (0, 0) (`hero.moving` retombe), ce que rien ne voit (héros invisible, `walkToPoint` ne l'attend pas).

## 3. Aides communes utilisées, rien à ajouter

`room-kit.ts` (`setVisible`, `hiccup`), `cinematics/player.ts` (`animate`, `showPicture`), `gfx.scene()` / `gfx.sheet()`, `palette.useLight` / `showExternal`, `talkers.bj` / `musician` / `solo`, `dialogs.play` / `converse`. Aucune modification hors du dossier du chapitre.
`freezeRoom` (geler la pièce dans l'image libre pour dessiner des sprites par-dessus) est promu dans `engine/room-kit.ts` (deux chapitres s'en servent) ; le chapitre 5 l'appelle avec `{ advance: true }` (`updateRoom()` d'abord).

## 4. Vérifié

`test/drascula/rooms/chapter-5/` (77 tests) : `room-45` (carte, héros invisible, portes des tours 1 à 3, tour 4 cachée puis ouverte, objet 9), `room-49` (scénario 4 à l'arrivée une seule fois, roomActions, menu 9, os sur le loup-garou et sur la fenêtre, images de `3an5_1` à `3an5_4` retrouvées dans l'image libre), `room-53` (fiche, vis, cerveau, interrupteur trop tôt, animation complète : sons, musiques 26 / 18 / 15, palettes, éclair, marche de Frankenstein à 5 pixels par image, arrivée au pied de la porte 104), `room-54` (squelette, os, B.J. : scène de 12 répliques puis menu 8, épingle, cadenas), `room-55` (vis, porte piégée), `room-56` (couloir 57, chambre 56, cercueil, chapitre 6), `walkthrough` (la solution à la souris jusqu'au chapitre 6, la partie complète, Échap pendant la renaissance).
**Non vu dans le navigateur** : les cinématiques `5_5` et `12_5` ne sont vérifiées que par comparaison de pixels avec les feuilles ; positions de bouche de B.J. (ch. 5), du loup-garou et du squelette non comparées à des captures ; durées des cinématiques lues dans ScummVM, non mesurées.
