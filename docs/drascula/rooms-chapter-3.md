# Drascula : chapitre 3

Vague P, chapitre 3 : pièces 13 (le vampire) et 20 (pièce de départ). Convention : `rooms.md`. Fichiers : `src/games/drascula/engine/rooms/chapter-3/` (`ids.ts`, `room-13.ts`, `index.ts`), tests `test/drascula/rooms/chapter-3/` (`room-13`, `room-20`, `walkthrough`).

## Ce qui est porté

| Élément | ScummVM | Où |
| --- | --- | --- |
| regarder le vampire (411, le héros de face, 412, le vampire s'appelle « yoda ») ; lui parler (`converse(7)`) ; lui offrir la pièce (19 : 413, grognement, 414) | `room_13` | `room-13.ts` `room13` |
| la croix (9) sur le vampire : trois temps d'animation, le héros sort par la droite, **fin du chapitre** (chapitre 4) | `room_13` (rend vrai), `animation_2_3` | `room13`, `killVampire` (`animations["2_3"]`) |
| le vampire se réveille quand le héros passe `x > 55` ; le héros s'arrête | `update_13`, `animation_6_3` | `tickGate`, `wakeOnFrame`, `wakeBeforeAction`, `wakeVampire` (`animations["6_3"]`) |
| images fixes du vampire (endormi / réveillé) et avant-plan | `update_13` | `gatePainter` |
| pièce 20 : aucun gestionnaire, aucune mise à jour propre | | rien à écrire : avant-plan par `roomUpdates` ; testé |

Rien d'autre au chapitre 3 : `updateVisible`, `exitRoom`, `updateDoor` sont vides. Les portes n'ont pas de nom au survol (`checkObjects` exclut les portes), donc un verbe sur une porte ne déclenche pas la réponse par défaut. La solution : passer la porte de la pièce 20, avancer vers le vampire, lui montrer la croix.

## Écarts à ScummVM

- **Réveil.** `update_13` lance `animation_6_3` au premier `updateRoom` où `curX > 55`, même en pleine marche. Un painter ne lance pas de séquence : `tickGate` arrête le héros (`_characterMoved = false`) dès qu'il passe 55 ; la séquence part à l'image suivante de la boucle principale (`frame`, jusqu'à 50 ms plus tard) ou au début de `checkAction` si l'action avait commencé par une marche (le héros reste là où il s'est arrêté, comme dans l'original, puis l'action se joue).
- **Rectangles rafraîchis seuls.** `updateAnim` et `animation_6_3` n'actualisent que leur rectangle d'écran. Ici le painter dessine par-dessus la pièce recomposée un « cadre » par emplacement (`GameState.anim` : `hero*`, `vampire*`) : le décor du rectangle, puis l'image de la feuille. Le cadre du vampire disparaît au rafraîchissement de `updateScreen(120, 0, …)`, celui du héros n'en garde que la partie à gauche de x = 120 jusqu'à la fin ; pendant un cadre du vampire les deux images fixes ne sont pas dessinées (elles sont sous le rectangle). Un cadre est une **copie des pixels** de la feuille prise quand il est posé : `animation_2_3` recharge `front`, `extra` et `back` avec les feuilles du vampire, et relire la feuille à chaque image dessinait le héros avec elles (rectangle à traits verts). L'image fixe du héros de `updateRoom` (`draw3` en (113, 54), 77 x 89, dont les bords portent des traits de couleur 254) n'atteint l'écran d'origine que dans la partie rafraîchie (x >= 120, après la mort du vampire) : `anim.poseFrom` la rogne de même, ce qui supprime les traits restants autour du héros.
- **Feuille du réveil.** `an4y.alg` va dans `draw2` (libre au chapitre 3), pas dans `front` : la pièce est recomposée à chaque image et le héros de face utilise `front`. `front` reçoit `96.ALG` à la fin comme l'original.
- **Cadence.** Une image toutes les 3 pauses (`pause(3)` : 9 ticks), 72 images pour `animation_2_3` ; la dernière image du réveil est remplacée dans le même tick (comme ScummVM, sans pause après elle) ; durées lues dans ScummVM, non mesurées sur le jeu d'origine.
- `room_13` est appelé deux fois par ScummVM pour une action non traitée (par la partie du chapitre 3 de `checkAction`, puis par `room(_roomNumber)`) : sans effet, le moteur ne l'appelle qu'une fois.
- **Fin du chapitre.** `room_13` « rend vrai » dans ScummVM, ce qui sort de `runCurrentChapter` : `g.endChapter()` (le chapitre 4 commence par `animation_castle`).
- Le nom « yoda » (`objName[1] = textmisc[4]`) est posé sur l'objet 51 de la pièce chargée ; il disparaît quand la pièce est rechargée (comme ScummVM, qui relit les noms à `enterRoom`).

## Points ouverts

- Cadence des animations et position exacte du héros à l'arrêt du réveil à comparer au jeu d'origine.
- Le grognement du héros (`grr`) après chaque réponse du dialogue 7 vient du moteur (`dialogs.respond`, chapitre 3) ; la voix `s10.als` est contrôlée par les tests, pas la position de bouche.
- Le rendu des cadres est contrôlé par pixels (`room-13.test.ts`) et à l'œil dans le navigateur (héros intact pendant que le vampire se tord, plus de traits).

## Aides manquantes

Aucune : tout est local au dossier du chapitre. (Le moteur ne permet pas de lancer une séquence depuis `updateRoom` : le réveil passe par `tick` + `frame` + `checkAction`.)
