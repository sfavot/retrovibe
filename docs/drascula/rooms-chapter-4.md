# Drascula : chapitre 4 (le château)

Vague P, chapitre 4 (pièces 21 à 24, 26 à 31, 34 à 44). Convention : `rooms.md`. Référence : `rooms.cpp`, `animation.cpp`, `objects.cpp` (`updateVisible`), `talk.cpp` d'`engines/drascula` (ScummVM, GPL v3+) ; code dans `src/games/drascula/engine/rooms/chapter-4/`, tests dans `test/drascula/rooms/chapter-4/` (193 tests, tous ignorés sans `original/drascula/`).

## 1. Ce qui est porté

| Élément | ScummVM | Où |
| --- | --- | --- |
| `room_21` (porte, corde, grappin sur le mur) | `room_21` ; répond avant sa table via `checkAction` | `room-21.ts`, `index.ts` `checkAction` |
| `room_22` (pie, clé, branche) | `room_22` | `room-22.ts` |
| `room_23`, `update_23_pre` | idem | `room-23.ts` (`room23`, `hallPainter`) |
| `room_24` ; escalier 108 (`exitRoom` : on monte d'abord en (171, 78)) | `room_24`, `exitRoom` | `room-24.ts`, `index.ts` `leaving` |
| `room_26`, `update_26_pre`, `update_26`, `animation_1_4` | idem | `room-26.ts`, `bedroom-view.ts` (dessin et avance) |
| `room_27`, `room_29`, `room_30`, `room_31` | idem | `room-27.ts`, `room-29.ts`, `room-30.ts`, `room-31.ts` |
| `room_34`, `animation_8_4` | idem | `room-34.ts` (`room34`, `bookcaseTurns`, `studyPainter`) |
| `room_35`, `update_35_pre` | idem | `room-35.ts` |
| `animation_5_4`, `animation_6_4`, `animation_7_4` | idem | `disguise.ts` (`disguise`, `igorLeaves`, `undress`) |
| `updateDoor` (table `doors` du chapitre 4, portes 101 et 116) et `updateVisible` du chapitre 4 | `updateDoor`, `updateVisible` | `world.ts` ; branchés par `index.ts` (`updateDoor`, `roomLoaded`) |
| partie du chapitre 4 de `checkAction` (grappin, regarder la croix et la corde, pièce 28, frites et farine sur le héros, pièce 21) | `checkAction` | `index.ts` |
| fin de chapitre : grappin sur le mur, `st.bin`, fondu, `endChapter` | `room_21` | `room-21.ts` |
| déguisement arrivé sur le palier (24, drapeau 29) | `enterRoom` (`animation_7_4`) | `index.ts` `roomEntered` |
| `savedTime` à l'entrée de la pièce 26 | `enterRoom` | `index.ts` `roomLoaded` |

Pas de gestionnaire dans ScummVM, donc rien à écrire : pièce 28 (réponse unique de `checkAction`), pièces 36 à 44 (portes seules ; l'affiche de la pièce 44 est dans `roomActions`). `animation_castle` est une cinématique commune (`cinematics/`). Les rectangles de portes ouvertes et de premier plan des pièces 21, 22, 24, 27, 29, 30, 31, 34 et 35 sont des lignes de `roomPreUpdates` / `roomUpdates` de `drascula.dat` : testés, pas réécrits.

## 2. La solution (jouée par `walkthrough.test.ts`)

Corde (21) ; pièce de monnaie sur la pie (22), clé ; clé sur la porte du château ; hall (23) : fermer la porte derrière soi, frites ; palier (24), couloir (27), bureau (34) : armoire (pieu), armoire du fond (35) : cape, cerveau, déodorant ; cuisine (29), garde-manger (30) : déodorant sur l'armoire, farine, **Igor s'en va** (`animation_6_4`) ; chambre d'Igor (26) : perruque, puis un des quatre objets du déguisement sur le héros (`animation_5_4`) ; palier : `animation_7_4` donne la clé du salon ; salon (31) : hache ; arbre (22) : hache sur la branche ; branche + corde = grappin (21) ; grappin sur le mur : `st.bin`, chapitre 5 (pièce 45).

Facultatif et testé : conversation avec Igor (`animation_1_4`, `OP_6.CAL`), perruque défendue par Igor, pièce sombre (28), passage secret derrière l'étagère du bureau (36 à 44, qui ramène au bureau), regards de l'inventaire.

## 3. Drapeaux et objets

Voir `ids.ts` (commentaires). Les `visible[n]`, `isDoor[n]` et `doorNum` de ScummVM sont des **index** dans la pièce ; le portage passe par le numéro d'objet (`roomObject`, `setVisible`) et ne garde l'index que pour `toggleDoor` (`DoorIndex`). Portes : le drapeau est à 1 quand la porte est ouverte ; les portes 101 (dehors, drapeau 0 + déverrouillée par 28) et 116 (salon, drapeau 5 + déverrouillée par 23) ont des règles propres dans `updateDoor`.

## 4. Écarts à ScummVM

- **Dessin et avance séparés** (`rooms.md` § 4) : le clignement d'Igor (`update_26_pre`, tirage toutes les 100 ms) est avancé par `tickBedroom`. ScummVM le fait à chaque redessin de la pièce.
- **Images partielles** : ScummVM écrit directement dans l'écran des morceaux d'image pour `animation_1_4` (les deux poses d'Igor), `room_26` (Igor couvre sa perruque, une image de 3 pauses) et `animation_8_4` (l'étagère). Ici ce sont des images d'état (`anim.igorPose`, `anim.wigGuard`, `anim.bookcase`) dessinées par le painter. `animation_8_4` charge `an_8.alg` dans la feuille du chapitre (`draw2`, libre au chapitre 4) et non dans `front`, car le héros, redessiné à chaque image, y puise ses images de face. La quatorzième image de l'étagère est posée puis remplacée dans le même tick par la pièce redessinée (`toggleDoor`), comme dans ScummVM : on voit les treize premières.
- **`animation_6_4`** : ScummVM change `_roomNumber` en 26 ; ici la première image (Igor de face en (104, 71), sans les rectangles de `roomPreUpdates`) est dessinée sur l'image libre, puis la pièce chargée est remplacée par une pièce 26 sans objets (héros masqué) le temps de la réplique i26. Tout est remis ensuite (pièce, feuilles `96`, `AUXnn`, décor). Comme ScummVM, la palette n'est pas remise au niveau de lumière de la pièce.
- **Coquilles de ScummVM reprises** : `room_34` passe l'index 2 à `toggleDoor` pour l'armoire (index 1) : l'état de porte de l'armoire n'est relu qu'au clic suivant (aucun effet visible). `room_22` : `updateVisible` rend la branche visible à chaque entrée une fois la pie tombée, même coupée, et la hache n'est jamais retirée. `room_27` n'a pas de « fermer » pour la porte 116 (seulement du côté du salon). `animation_1_4` remet le drapeau 18 à 0 en sortant (sans conséquence : Igor n'est plus là quand il vaut 1). Le déodorant n'est pas consommé.
- Après le déguisement, `exitRoom(0)` marche en pleine obscurité (`fadeToBlack(0)` avant) : la sortie est invisible, comme dans l'original.
- **`animation_5_4`, fondu final** : ScummVM recharge `front` (96) et `back` (99) puis lance `fadeToBlack(0)`, qui ne change que la palette : l'écran garde la dernière image de la réplique i30, avec le héros déguisé (copié de `anh_dr.alg` par `update_26`, drapeau 29). Ici l'image est recomposée à chaque rendu et le painter de la pièce 26 lirait la feuille 99 (glyphes de texte, rectangle noir) : `disguise` fige donc la pièce (`freezeRoom`) avant les `loadPic`, et `exitRoom` rend la main à la pièce dans l'obscurité. Les autres séquences du chapitre 4 ne rechargent pas une feuille lue par un painter avant un fondu (`igorLeaves` remet tout, sans fondu ; `animation_8_4` n'écrit que `draw2`).
- **`animation_7_4`** : le héros dit « me débarrasser de ce stupide déguisement » (427) et apparaît sans déguisement sur le palier : c'est l'ordre de ScummVM (`black`, `talk(427)`, `fadeFromBlack`) ; le drapeau 29 ne sert qu'à `update_26`, et `back` est déjà 99.

## 5. Constats, besoins et points ouverts

- **Besoins hors du dossier** : aucun.
- **Vidéos** (`ST.BIN`, `UP.BIN`, `BIO.BIN`) : préchargées avec le chapitre 4 par l'hôte du navigateur (`ui/preload.ts`) ; lues par `animate` sous `readFile` synchrone.
- Cadences des cinématiques (`st.bin` 14 / s, `up.bin` 14 / s, `bio.bin` 14 / s, pauses des poses) lues dans ScummVM, **non mesurées** sur le jeu d'origine ; positions de bouche d'Igor (assis, perruque, porte, face) non comparées à des captures.
- Non vu dans un navigateur (consigne : pas de serveur de dev) : les images ci-dessus sont vérifiées par comparaison de pixels (`comparedPixels`) à la feuille source, pas à l'œil.
- **Liserés noirs** : `18.ALG` (Von Braun) a ses 8 dernières colonnes (312 à 319) et ses 4 dernières lignes (196 à 199) à l'indice 0 dans le fichier ; `10.ALG` (carte) a les lignes 0 et 199 et les colonnes 0 et 319 à 0. Ils viennent des fichiers d'origine, pas du rendu : rien à corriger.
- `talk_igor` de type porte (réplique d'Igor derrière la porte, i27 et i28) dessine la pièce et le héros sans Igor : conforme à la lecture de `talk.cpp`.
