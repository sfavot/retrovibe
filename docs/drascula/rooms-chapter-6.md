# Drascula : chapitre 6 (pièces 58 à 61 et 102)

Vague P, chapitre 6. Convention : `rooms.md`. Fichiers : `src/games/drascula/engine/rooms/chapter-6/` (`ids.ts`, `room-58.ts`, `room-59.ts`, `room-60.ts`, `room-102.ts`, `index.ts`) ; tests : `test/drascula/rooms/chapter-6/`. Référence de comportement : `rooms.cpp`, `animation.cpp`, `objects.cpp`, `drascula.cpp` (ScummVM).

## 1. Ce qui est porté

| Élément | ScummVM | Où |
| --- | --- | --- |
| pousser la torche (103) : la porte dérobée (104) s'ouvre | `room_58`, `updateVisible` | `room-58.ts` `room58`, `updateCorridorDoor` |
| dessin du couloir : ombre / héros ligoté, Igor et Drascula, chaîne, porte ouverte, premier plan | `update_58_pre`, `update_58` | `corridorPainter` |
| B.J. au lit : dialogue, puis (une fois) le téléphone de Von Braun | `room_59` | `room-59.ts` `room59` |
| tête de B.J. quand elle parle | `update_59_pre` | `bedroomPainter` |
| armoire (105) condamnée | `updateVisible` | `updateBedroomDoors` |
| quelqu'un surgit de l'armoire à l'entrée par la porte dérobée (sortie 105) | `animation_19_6`, `exitRoom` | `wardrobeSurprise` (`"19_6"`), `index.ts` `roomEntered` |
| piano poussé (flag 7), barman (dialogue `OP_12`), boisson sur Drascula, objet 9 sur Drascula, fin du jeu | `room_60` | `room-60.ts` `room60` |
| bougies, télévision, Drascula au comptoir | `update_60_pre`, `update_60`, `updateVisible` | `tickTavern`, `tavernPainter`, `placeDrasculaAtBar` |
| arrière-salle (61) | aucune fonction de pièce | rien à écrire : `roomActions` et rectangle de `roomUpdates`, testés |
| cachot : lame (101), lame sur le pendule (100), mains menottées | `room_102` | `room-102.ts` `room102` |
| liens coupés, héros libre dans le couloir | `animation_6_6` | `freeFromPendulum` (`"6_6"`) |
| pendule (17 images), héros ligoté | `update_102` | `tickPendulum`, `pendulumPainter` |
| regarder le héros (308 libre, 310 ligoté), regarder l'objet 9 dans l'inventaire (482, 483) | `checkAction` (chapitre 6) | `index.ts` `checkAction` |

Déjà faits par la vague C (`cinematics/`) : `animation_1_6` (`"1_6"`), `animation_5_6` (`"5_6"`), `activatePendulum`, `animation_9_6` (`"9_6"`), générique. Le chapitre 6 est le dernier : après `animation_9_6`, `room_60` appelle `endChapter()`, le moteur prévient l'hôte (`host.exit()`).

Chapitre 6 de `checkAction` : ScummVM appelle `room(102)` et `room(60)` avant la table de la pièce ; `roomParse` de la pièce répond d'abord dans les deux cas, et `rooms[60]`, `rooms[102]` passent donc par le chemin ordinaire du moteur (`roomActions` puis gestionnaire). Seuls restent dans le point `checkAction` du chapitre les deux regards ci-dessus.

## 2. Solution du chapitre

Prendre la lame (101) et la présenter au pendule (100) ; pousser la torche (103), passer la porte dérobée (104), la porte de la chambre (108) ; pousser le piano (112), parler au barman (52) et prendre le troisième choix (réponse 14 : il donne l'objet 21) ; donner l'objet 21 à Drascula (56), puis lui présenter l'objet 9 : `animation_9_6` et le générique. Le téléphone de B.J., l'arrière-salle et les regards sont facultatifs. Joué par `test/drascula/rooms/chapter-6/walkthrough.test.ts` (dialogue 11 de l'introduction compris : `start.ts`).

## 3. Écarts à ScummVM

- **Avance des animations séparée du dessin** (`rooms.md` § 4) : bougies de la taverne toutes les 7 ticks (`getTime() - savedTime > 6`), pendule toutes les 9 ticks (`> 8`) ; ScummVM les avance à chaque redessin. Le scintillement de la télévision (`getRandomNumber(7) == 5`, ScummVM le tire à chaque redessin de la pièce) est tiré une fois par image de la boucle principale (5 ticks). Cadences à comparer au jeu d'origine.
- **Piano poussé** : l'image fixe du comptoir (`copyBackground(164, 85…)` sans héros) est dessinée par le painter (`anim.pianoShot`), le héros caché le temps du son 14.
- **`animation_19_6`** : la silhouette de l'armoire est dessinée par le painter (`anim.wardrobe`), avant les décors de la pièce comme dans l'original.
- **Téléphone de la chambre** : le héros qui décroche est dessiné par le painter une image (`anim.phone`) ; ScummVM le copie dans le décor qu'il écrase tout de suite. Pendant la conversation les décors animés de la pièce ne sont pas dessinés (`gfx.roomSprites = false`), comme l'original qui ne redessine que le fond.
- **`animation_6_6`** : Échap saute chaque vidéo (`RCT.BIN`, `HBP.BIN`) mais la suite (pièce 58, drapeaux) est toujours jouée, pour ne pas laisser le jeu dans un état incohérent (le chapitre 1 saute tout, mais c'est `leaving` qui finit le chapitre).
- Les `.BIN` de la pièce (`beb`, `cnf`, `rct`, `hbp`) sont préchargées avec le chapitre 6 (`ui/preload.ts`, `CHAPTER_VIDEOS`), comme `man`, `fum`, `fin`, `drf`, `qpc` et `crd`.

## 4. Constats et points ouverts

- `animation_6_6` charge `96.ALG` puis `97.ALG` dans la **même** surface `front` (lu tel quel dans ScummVM) : le héros « de face » est donc dessiné avec la feuille de profil jusqu'à la fin du jeu. Peut-être une coquille de l'original ; à regarder dans le jeu d'origine (portage fidèle pour l'instant).
- Après `animation_6_6` le héros se tourne vers la droite à l'image suivante (au lieu de la face voulue par `trackProtagonist = 3`) : `walkToPoint` avec un héros invisible ne rend pas `walkToObject` (ScummVM non plus) et la boucle principale applique alors l'orientation de l'objet 100 (`mainFrame`, `drascula.cpp:558`). Comportement de ScummVM, laissé tel quel.
- Prendre l'objet 101 plusieurs fois met en main l'objet 20 et range le précédent dans l'inventaire : l'objet 20 est alors en double (`chooseObject` de ScummVM). Non corrigé.
- La touche `0` dans la pièce 61 (`kActionEasterEgg` : charge `alcbar.alg` comme décor) est reprise en vague J : point `frame` du chapitre (`index.ts`), `alcbar.alg` remplace le décor de la pièce 61 jusqu'à sa sortie ; testée (`room-61.test.ts`).
- Les voix `VB58` à `VB62` et les têtes (B.J. au lit, barman derrière le comptoir, héros sous le pendule, téléphone) sont celles du moteur : non comparées à des captures.
- Cadences et durées des vidéos lues dans ScummVM, non mesurées sur le jeu d'origine.

## 5. Aides manquantes

Aucune : `setDoor` (`room-kit.ts`) suffit à `updateVisible`, `placeIgor` / `placeDrascula` (`render/actors.ts`) au dessin des personnages. `Walkthrough` démarre le chapitre 6 avec `settle: false` (le constructeur n'attend pas que le jeu soit au repos : le dialogue 11 attend des clics) ; `start.ts` joue l'introduction par `playChapter6Intro` (`test/drascula/solutions.ts`).

## 6. Vérifié

`test/drascula/rooms/chapter-6/` : couloir (58), chambre (59 : entrée, B.J., téléphone, painter), taverne (60 : regards, piano, barman et `OP_12`, boisson, objet 9, fin, bougies, télévision), arrière-salle (61), cachot (102 : verbes, pendule, `animation_6_6`, Échap), `checkAction`, et deux passages (la solution et la partie complète, du pendule au générique).
