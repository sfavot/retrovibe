# Drascula : moteur (cœur)

Référence du moteur sans tête de *Drascula* (`src/games/drascula/engine/`) : boucle, cadence, séquences, état, pièces, marche, verbes, inventaire, chapitres.
Les formats de fichiers sont dans `formats.md`, le plan d'ensemble dans `plan.md`. La **référence de comportement est le moteur `drascula` de ScummVM** (`engines/drascula/`, GPL v3+) :
chaque module cite en tête les fonctions reprises et ses écarts. Rien n'est transposé ligne à ligne ; les numéros magiques gardent un nom (`Verb`, `Track`, `Step`).

**Confiance** : **lu** = lu en entier dans le code de ScummVM ; **vérifié** = couvert par un test sur les fichiers du jeu ; **supposé** = déduit, à confirmer sous ScummVM ou à l'écoute / à l'œil.

## 1. Modules

| Module | Rôle | ScummVM |
| --- | --- | --- |
| `cadence.ts` | ticks de 10 ms, conversions `delay` / `pause`, durée d'une image | `drascula.cpp` (`delay`, `pause`, `getTime`, `runCurrentChapter`) |
| `src/engine/sequence.ts` (commun) | séquences (générateurs), attentes, saut, abandon : voir § 3 ; `pause` et `delay` (unités de ScummVM) sont dans `cadence.ts` | remplace les boucles bloquantes |
| `host.ts` | `DrasculaHost` (étend `BaseHost`) : fichiers, entrées, image (`present`), son, musique | `updateEvents`, `sound.cpp` |
| `resources.ts` | `drascula.dat` (français) et fiches `.ALD` en cache par disposition | `loadDrasculaDat`, `enterRoom` |
| `state.ts` | état sérialisable : chapitre, drapeaux, inventaire, pièce, héros, curseur | variables de `drascula.h` |
| `room.ts` | pièce chargée depuis le `.ALD`, placement du héros à l'arrivée | `enterRoom` (partie données) |
| `perspective.ts` | facteur de réduction du héros selon l'ordonnée des pieds | `enterRoom` (`factor_red`) |
| `walk.ts` | marche en ligne droite, pas, arrivée, taille réduite | `actors.cpp` |
| `actions.ts` | `roomActions`, excuses de `room_0`, inventaire, verbes, barre | `roomParse`, `room_0`, `objects.cpp`, `interface.cpp` |
| `talk.ts` | réplique : voix, sous-titre, tour de visage, coupure par une touche (`talk.md`) | `talkInit`, `isTalkFinished` |
| `talkers.ts` | les personnages qui parlent (`engine.talkers`) | les `talk_*`, `placeVonBraun` |
| `dialogs.ts` | scénarios `talkSequences`, choix `.CAL` (`engine.dialogs`) | `playTalkSequence`, `converse`, `response` |
| `../cinematics/` | lecteurs de vidéos SSN et animations, cinématiques (§ 9) | `playFLI`, `animate`, `animation_*` |
| `script.ts`, `rooms/` | points d'extension de la logique du jeu et un dossier par chapitre (vague P) : § 7, `rooms.md` | `room_N`, `updateDoor`, `updateVisible`… |
| `loop.ts` | `DrasculaEngine` : boucle principale, clics, pièces, chapitres | `run`, `runCurrentChapter`, `verify1/2`, `checkAction`, `exitRoom`, `walkToPoint` |

Le dessin est dans `render/` (vague R, `graphics.md`) : `updateRoom()` fait avancer le héros et `tick()` compose puis présente l'image (`host.present`, `DrasculaEngine.gfx`) ; le son réel est celui de la vague A et passe par l'hôte.

## 2. Boucle et cadence

**Lu** (`drascula.cpp`) : ScummVM compte en millisecondes réelles. `delay(ms)` attend **2 x ms** (commentaire « originally was 1 »), `pause(n)` = `delay(15 n)`,
`getTime()` = millisecondes / 10. La boucle principale (`runCurrentChapter`) fait, à chaque tour : corrections de position du chapitre 2, dessin de la pièce
(le héros avance là), relance de la musique, `delay(25)`, lecture des entrées, nom survolé, clic droit (inventaire), clic gauche (`verify1` / `verify2` puis `delay(50)`),
barre des verbes, une touche et une action.

Choix du portage : **un tick = 10 ms** (`TICK_MS`, l'unité de `getTime()`), seule constante de temps. Toutes les durées sont entières :
`pause(n)` = 3n ticks, `delay(ms)` = ms / 5 ticks, une image de la boucle principale = `delay(25)` = **5 ticks** (20 images/s), l'attente après un clic = 10 ticks.
`engine.tick()` : entrées, puis soit la séquence en cours (§ 3), soit une image de la boucle principale si 5 ticks sont passés. L'hôte du navigateur appellera `tick()` avec `FixedStepClock`
(`tickMs: TICK_MS`, `maxCatchUpTicks: MAX_CATCH_UP_TICKS` = 25), comme Armaeth.

**Supposé / à confirmer** : ScummVM ajoute au `delay(25)` le temps de dessin ; ici une image dure exactement 5 ticks. La cadence de l'exécutable DOS d'origine n'est pas connue
(« originally was 1 » suggère que le jeu d'origine allait deux fois plus vite que ScummVM) ; la durée de `TICK_MS` se règle à un seul endroit.

Marche : le héros fait un pas quand `getTime()` a avancé d'au moins 6 depuis le pas précédent, mais seulement quand il est redessiné : un pas toutes les 2 images (10 ticks)
dans la boucle principale, un pas tous les `pause(3)` (9 ticks) dans `walkToPoint`. Reproduit tel quel.

## 3. Séquences

ScummVM est écrit en **attentes bloquantes** : `walkToPoint`, `talk`, `pause`, `finishSound`, les `animation_*` bouclent sur le fil principal. Le portage les remplace par des
**générateurs** : une séquence (`Sequence<T> = Generator<Wait, T, Resume>`) `yield` une attente (`wait(n)`, `pause(n)`, `delay(ms)`, `waitUntil(prédicat)`) et le `SequenceRunner`
la reprend quand l'attente est remplie. Une séquence en appelle une autre par `yield*` et récupère sa valeur de retour (`const answered = yield* g.roomVerb(...)`).
Le code des pièces et des cinématiques reste linéaire et se relit contre ScummVM :

```ts
*62(g, fl) {                       // room_62
  if (g.picked !== Verb.Talk || fl !== 54) return false;   // hasAnswer = 0
  yield* g.talk(23);
  yield* pause(6);
  ...
  return true;
}
```

Règles :
- **Une seule séquence racine à la fois** (ScummVM n'a qu'un fil). Pendant qu'elle s'exécute, la boucle principale est suspendue : pas de clic, pas de verbe, pas de sauvegarde
  (`engine.canSave` est faux, comme `_canSaveLoad`). Les clics gauches reçus pendant une séquence sont ignorés ; le clic droit et les touches restent dans leurs tampons, comme dans ScummVM.
- Ce qui bloquait est une séquence : un clic traité (`verify1` / `verify2` + `delay(50)`), un passage de porte, un verbe sur un objet, le début d'un chapitre (`chapterStart`), une réplique.
  `engine.run(séquence)` en lance une depuis l'extérieur (tests, outils, écrans).
- Une attente remplie se reprend dans le même tick (`wait(0)`, `waitUntil` déjà vrai) ; une séquence qui boucle sans jamais attendre lève une erreur au lieu de geler l'onglet.
- **Saut** (Échap, `kActionSkip` de la carte `animation` de ScummVM) : seules les parties enveloppées par `skippable(...)` se sautent. Le saut abandonne la partie (ses `finally`
  s'exécutent) et la séquence englobante **continue après elle** : c'est le `break` des boucles `while (term_int == 0)` des cinématiques, après lesquelles ScummVM met l'état à jour.
  Parties imbriquées : la plus intérieure se saute. Une réplique est une attente **protégée** (`unskippable`, vérifié) : elle consomme la touche avant le saut, donc Échap pendant une réplique d'une cinématique ne coupe que la réplique, comme dans ScummVM
  (`isTalkFinished` consomme l'action). Écart : ScummVM ne teste le saut qu'à des points précis ; ici il prend effet à l'attente en cours.
- **Abandon** (fin de chapitre, chargement d'une partie d'un autre chapitre : `_loadedDifferentChapter`) : `engine.endChapter()` / `requestChapter(n)` demande l'abandon ; le runner l'applique
  au **prochain `yield`** (jamais au milieu de l'exécution d'un générateur) ou à la fin de la séquence : les `finally` s'exécutent, la suite non. Puis le son s'arrête, l'écran devient noir,
  la musique s'éteint en fondu (`musicFadeout`, § 9 : une séquence de 1,05 s qui précède le chapitre suivant ; vérifié), l'état est recréé et le chapitre commence (`chapterStart`). Les gestionnaires qui « rendent vrai » jusqu'à `runCurrentChapter` dans ScummVM (pièces 13, 21, 56, 60, cinématiques de fin de chapitre)
  appellent `g.endChapter()`.
- **Sauvegarde pendant une séquence** : interdite (`canSave`), voir § 10.

Tests : `test/shared/sequence.test.ts` (attentes, composition, saut, imbrication, abandon au `yield`, erreurs) et `engine.test.ts` (fin de chapitre pendant une réplique ou un gestionnaire, saut de l'introduction).

## 4. Entrées

**Lu** (`updateEvents`, `metaengine.cpp`) : la souris est un état (position, bouton gauche appuyé) ; le bouton droit n'agit qu'au relâchement ; touches et actions vont dans des tampons de 16.
Le portage reçoit de l'hôte `{ type: "pointer", x, y, buttons }` et `{ type: "key", key }` (noms de `KeyboardEvent.key`), un tampon unique de 15 touches.

| Entrée | Effet | Source |
| --- | --- | --- |
| clic gauche | sans verbe : porte, objet (le héros y va), point de la zone de marche ; avec un verbe ou un objet : le héros va à l'objet et l'action est jouée ; dans l'inventaire : prendre / poser / appliquer | `verify1`, `verify2` |
| souris en haut (y < 24) + clic | choisit un verbe de la barre (`verbBarX` du `.dat`) | `selectVerbFromBar` |
| clic droit | ouvre / ferme l'écran d'inventaire (sauf chapitre 5 avec la prise en main) | `runCurrentChapter` |
| F1 à F6 | regarder, prendre, ouvrir, fermer, parler, pousser (hors inventaire) | `metaengine.cpp` (lu) |
| F8 | vide le curseur | `kActionVerbReset` (lu) |
| une touche pendant une réplique | coupe la réplique | `isTalkFinished` |
| clic gauche pendant un menu de choix | choisit le choix survolé (`takeClick`, `listenForClicks`) ; ignoré hors menu | `converse` |
| Échap pendant une partie sautable | saute la partie | carte `animation` (lu) |

Écart (robustesse, tactile) : un appui gauche bref entre deux images n'est pas perdu (verrou jusqu'à l'image suivante) ; ScummVM le perdrait.
Faits en vague J, dans l'hôte du navigateur (`ui/app.ts`, `ui/keys.ts`) : F7 charge et F10 sauvegarde (fenêtre des dix emplacements, § 10), F9 volume de la musique (curseur ; `host.setMusicVolume` du fondu se combine au choix de la joueuse), `t` sous-titres (`engine.subtitlesEnabled` : la réplique se joue sans son texte), espace pause à tout moment (comme le bouton « Pause » et le menu ; ticks et son suspendus par l'hôte ; revue produit). Le menu du jeu (barre tactile « Menu », pied de page) réunit sauvegarde, chargement, volume, sous-titres, pause, aide et retour à l'écran titre (avec confirmation). `0` dans la pièce 61 (`kActionEasterEgg`) : point `frame` du chapitre 6 (`alcbar.alg` en décor). Non faits : Échap hors cinématique (quitter, `kActionQuit` : le lien « Tous les jeux » en tient lieu), `v` (voix seulement : le bouton « Son » coupe tout).
Décidé en J : un toucher de l'écran coupe la réplique (touche Entrée envoyée par l'hôte ; ScummVM ne le fait qu'au clavier) ; un appui du doigt qui suit un saut de position est retardé de deux images par l'hôte (`InputQueue`) pour que `menuBar`, calculé à la fin de l'image précédente, soit à jour (`rooms.md` § 7).

## 5. Pièces, héros et marche

`enterRoom(n)` : fiche `n.ALD` lue dans la disposition du chapitre en cours, objets copiés (le jeu change leur visibilité et leur état de porte), héros placé, musique, gestionnaires.

**Champs du `.ALD` (lu dans `rooms.cpp`, `actors.cpp`, `objects.cpp` ; vérifié par les tests quand c'est dit) :**
- **porte** `pièce x y orientation sortie` : on franchit la porte en marchant jusqu'au **point d'approche** de l'objet ; `orientation` devient celle du héros à l'arrivée ;
  `sortie` désigne l'objet de la pièce de destination dont le **`x y` de porte** est le point d'arrivée (les pieds). Vérifié : `engine.test.ts`, porte 106 de l'auberge vers 63 / 107.
- **orientation** (`trackObj`, orientation de porte, `trackProtagonist`) : **0 gauche, 1 droite, 2 de dos (en montant), 3 de face (en descendant)** (`quadrant_*` choisit 2 / 3 quand la verticale domine,
  0 / 1 sinon ; `moveCharacters` prend l'image de profil pour 0 et 1, l'image « arrière » pour 2, « avant » pour 3).
- **hauteur des pieds** (chapitre 2, 12 ailleurs) : marge sous le haut de la zone de marche ; un clic dans la pièce vise `y` borné à `[haut + pieds, bas]` (`verify1`). Elle ne sert qu'à cela.
- **pas en x et y** (chapitre 2) : lus par ScummVM, mais **sans effet** : `startWalking` remet 8 et 3 à chaque départ.
- **largeur / hauteur** (chapitre 2) : taille fixe du héros dans la pièce (pas de perspective) ; les quatre images sont pour la vague R.
- **limites de perspective** (hors chapitre 2) : pourcentages de réduction en haut et en bas de la zone de marche, interpolés en `float` 32 bits sur la hauteur de la zone (`perspective.ts`),
  prolongés au-dessus de la zone dans la pièce 24 et la pièce 54 du chapitre 5. Taille du héros = 43 x 70 réduits par le facteur à l'ordonnée des pieds.
- **zone de marche** : rectangle où l'on peut cliquer pour marcher ; le héros n'y est pas contraint autrement (les objets mènent hors zone).
- **rectangles** : `Common::Rect` : bords droit et bas **exclus** (`rectContains`).

**Marche (lu, `actors.cpp`)** : pas de recherche de chemin ; le héros va en ligne droite vers le point visé (les pieds), 8 px sur l'axe dominant et la composante proportionnelle sur l'autre,
et s'arrête dès qu'il passe à moins d'un pas de la coordonnée visée de l'axe dominant. Référence horizontale : le milieu du héros (bord gauche ou droit au chapitre 2). Hors chapitre 2, la taille
calculée au dessin est appliquée au pas suivant en gardant le coin bas droit. Aucun garde-fou contre un point jamais atteint (comme l'original) : `walk.test.ts` vérifie, dans les 56 pièces
où le héros est visible, que chaque trajet d'une arrivée de porte vers chaque objet se termine. Pièce 45 (chapitre 5, tours du château) : héros invisible, ScummVM le ramène à (0, 0).

**Chapitre de chaque pièce** (vérifié, `test/drascula/engine/rooms.ts` : pièces atteintes par les portes depuis la pièce de départ de chaque chapitre, fiches lues dans la disposition
du chapitre, plus les pièces où l'on n'entre que par une cinématique, lues dans `animation.cpp` / `rooms.cpp`) :

| Chapitre | Départ (`runCurrentChapter`) | Pièces |
| --- | --- | --- |
| 1 | 62 (auberge), sortie 104 | 62, 63 |
| 2 | 14, sortie 162 | 1 à 10, 12, 14 à 19 (disposition « chapitre 2 ») |
| 3 | 20, sortie 99 | 13, 20 |
| 4 | 21, sortie 100 | 21 à 24, 26 à 31, 34 à 44 |
| 5 | 45, sortie 100 | 45, 49 à 55 ; 56, 57 (cinématiques) |
| 6 | 58, sortie 104 | 58 à 61 ; 102 (cinématique) |

Les 57 fiches ont donc chacune un seul chapitre ; aucune pièce n'est partagée entre chapitres.

## 6. Verbes, objets et inventaire

Le curseur porte un **verbe** (1 regarder, 2 prendre, 3 ouvrir, 4 fermer, 5 parler, 6 pousser) ou un **objet** de l'inventaire (7 et plus) : `pickedObject`, `takeObject`.
Les cases 1 à 6 de l'inventaire contiennent les verbes eux-mêmes (on peut les prendre dans l'écran d'inventaire). Choisir un verbe ou un objet range l'objet tenu (sauf la prise, objet 16, au chapitre 5).
« Prendre » un objet de la pièce n'est pas générique : le gestionnaire de la pièce appelle `g.pickObject(n)` (l'objet passe dans la main) et masque l'objet ; il va dans l'inventaire au prochain choix.

`checkAction(objet)` (lu, `rooms.cpp`), dans l'ordre, s'arrêtant à la première réponse :
1. `roomActions` de la pseudo-pièce **200** (inventaire ouvert) ou **201** (toutes les pièces : le héros, objet 50) ;
2. partie propre au chapitre (`GameScript.checkAction`, vague P) ;
3. `roomActions` de la pièce, puis son gestionnaire `room_N` (`GameScript.rooms[N]`) ;
4. si l'objet a un nom (survolé) ou si l'inventaire est ouvert : `roomActions` de la pièce **0** (réponses par défaut d'un chapitre, objet -1), puis `room_0` (excuses tournantes aux chapitres 2, 4, 5, 6 :
   regarder 100, 101, 54 ; autres verbes 11, 109, 111, 110, 115, 116).

`roomActions` (lu) : les lignes d'une pièce sont contiguës et la recherche s'arrête à la première ligne d'une autre pièce ; chapitre -1, verbe -1 et objet -1 sont des jokers.
Vérifié (`engine.test.ts`) : les 307 lignes, rejouées dans leur pièce et leur chapitre, donnent la voix attendue (les lignes masquées par une ligne précédente donnent la réplique de celle-ci).

La réplique `n` est le texte `text[n]` en sous-titre et la voix `n.als` (`talk(int)`). Une voix absente laisse le texte `6 ticks par caractère` (décision du plan ; ScummVM couperait tout de suite).

## 7. Points d'extension (`GameScript`)

La logique propre au jeu passe par `script.ts` (remplie par la vague P : un `ChapterScript` par chapitre dans `rooms/chapter-N/`, assemblés par `rooms/assemble.ts` ; convention dans `rooms.md`). Chaque point est un endroit nommé de ScummVM :

| Point | ScummVM | Exemples à porter |
| --- | --- | --- |
| `rooms[N]` | `room_N` | 37 gestionnaires |
| `checkAction` | partie par chapitre de `checkAction` | combinaisons d'objets du chapitre 4, réplique 164 du chapitre 2, pièces 13, 21, 56, 60, 102 |
| `animations[nom]` | `animation_1_1`, `animation_castle`, `animation_1_6` (appelées par le moteur), `animation_9_6`, `animation_16_2`… (appelées par les pièces et les réponses) | `CINEMATICS` (`cinematics/`, § 9) fournit `1_1`, `castle`, `1_6`, `5_6`, `9_6` ; `16_2`, `20_2`, `23_2`, `29_2`, `31_2` viennent de la vague P |
| `updateDoor` | `updateDoor` (table `doors` des chapitres 2 et 4) | |
| `roomLoaded` | `updateVisible`, musiques de remplacement du chapitre 2 (pièces 14 et 15), `savedTime` | |
| `roomEntered` | fin d'`enterRoom` et d'`exitRoom` | `animation_7_4`, `playTalkSequence(4)`, `animation_19_6` (chapitre 6, sortie 105) |
| `restored` | fin du rechargement d'une partie (`loadGame`), séquences d'entrée jouées | chapitre 6 : `activatePendulum` dans la pièce 102 (§ 10) |
| `canExit` | début d'`exitRoom` | portes 104 et 105 de l'auberge au chapitre 1 (réplique 442, `g.doBreak = true`) |
| `leaving` | `exitRoom`, actions par porte | `animation_2_1`, `animation_2_2`, `animation_35_2`, portes 124, 146, 176, 108 |
| `frame` | début du tour de `runCurrentChapter` | corrections de position des pièces 3 et 14 du chapitre 2 |
| `painters[N]` (par chapitre), `tick` | `update_N_pre`, `update_N` (dessin et avance des animations, séparés) | accroches de dessin (`graphics.md` § 11) et avance par tick (`rooms.md` § 4) |

Restent dans le cœur (génériques dans ScummVM) : `isDoor[7] = 0` au chapitre 1, héros visible au chapitre 5, nom au survol des pièces 2, 10 et 45 (`showMap`, `MAP_ROOMS`), relance de la musique après une réplique au chapitre 1,
pas de mise à jour du héros au chapitre 3 quand le drapeau 0 est levé, état de départ de chaque chapitre (objets, drapeaux 16, 17, 27 au chapitre 2 et 1 au chapitre 3, positions).
Igor, Drascula et Von Braun (positions et orientations de `run()`) sont dans l'état depuis la vague T, avec `playTalkSequence` et `converse` (`dialogs.ts`). À ajouter avec les pièces (vague P) : B.J., `toggleDoor` et les accroches de dessin de chaque pièce.

## 8. Écarts et points ouverts

Écarts voulus, tous documentés dans les modules :
- une image de la boucle = 5 ticks exactement (ScummVM : `delay(25)` + temps de dessin) ;
- saut immédiat à l'attente en cours ; clic bref gardé jusqu'à l'image suivante ; clics pendant une séquence ignorés ;
- voix absente : texte affiché un temps proportionnel à sa longueur ;
- arrivée par une sortie qui n'existe pas (`19:173 -> 20/174`) : point d'approche du premier objet (ScummVM : valeur indéfinie) ;
- `factor_red` lu hors tableau (ScummVM : comportement indéfini) : borné à 0..201.

Points ouverts :
- cadence d'origine (§ 2) ; à mesurer sous ScummVM et à l'œil ;
- la taille réduite calculée par le dessin d'une réplique (`talk` appelle `reduce_hare_chico` avec la taille de la tête) n'est pas reproduite : sans effet tant que le héros ne marche pas en parlant (la tête, elle, est réduite comme le héros : `talk.md`) ;
- les numéros de voix `B*.ALS` et `textb` (`formats.md`) : le chapitre 1 n'en emploie que trois (`talk.md`, § 6) ; le reste avec les pièces ;
- couper une réplique au toucher, Échap hors cinématique : vague J.

## 9. Cinématiques et fondu de la musique (vague C)

`src/games/drascula/cinematics/` : `player.ts` (`playSsn`, `animate`, aides d'écran), `sequences.ts` (les cinématiques, `CINEMATICS`), `index.ts`. Les cinématiques passent par `GameScript.animations` : `new DrasculaEngine(host, { script: { animations: CINEMATICS } })`
(l'hôte du jeu les y mettra, vague J ; sans elles le chapitre 1 commence directement dans l'auberge, comme les tests). L'image : `graphics.md`, § 11. Vérifié : `test/drascula/cinematics/`.

| Cinématique | Nom | ScummVM | Contenu |
| --- | --- | --- | --- |
| logos | `logos` | début d'`animation_1_1` | `LOGODDM.BIN` (9 tours / s, thème 29), 1,2 s, noir, `LOGOALC.BIN` (8, thème 26) : ~17 s |
| histoire | `introStory` | suite d'`animation_1_1` | `CIELO.ALG` en fondu, titre (`textmisc[1]`), `SCROLLB.BIN`, `SCR2`, `SCR3`, `CIELO2.ALG`, fondu au noir |
| introduction | `1_1` (`intro`) | `animation_1_1` | logos, histoire, château (défilement de 180 colonnes), Drascula en gros plan (`d1`), Igor et Drascula (20 répliques), plans de l'armée, éclair (`RAYO1/2`, `FREL`), dialogue, `INTRO.BIN` (12 / s, thème 2) : ~6 min |
| château | `castle` | `animation_castle` (chapitre 4) | cinq vues `ANR_1` à `ANR_5` sur un coup de tonnerre (`s5.als`) ; remet les feuilles du héros (`startChapter`) |
| chapitre 6 | `1_6` (`pendulumStart`), `5_6` (`crank`) | `animation_1_6`, `animation_5_6`, `activatePendulum` | Drascula, dialogue 11, deux nuits (`TIME1.ALG`), manivelle (`MAN.BIN`), le héros sous le pendule (pièce 102, drapeau 1 = 2) |
| générique | `credits` | fin d'`animation_9_6` | `QPC.BIN` (1 / s, thème 17), fondu, `CRD.BIN` (1 / s, thème 3) : ~170 s |
| fin | `9_6` (`ending`) | `animation_9_6` | `FIN`, `DRF`, la chambre de B.J. (pièce 59), la lettre (voix de B.J.), le héros, le générique |

- **Échap** : une cinématique à vidéos est enveloppée d'un `skippable` ; chaque vidéo se saute aussi seule (`playSsn`, `animate` rendent vrai). Une autre touche coupe une animation (pas un SSN), une touche pendant une réplique ne coupe que la réplique (vérifié : sauts à six moments de l'introduction, ensuite l'auberge est chargée et les feuilles remises).
- **Écart** : ScummVM garde `term_int` levé pour la suite (après un saut dans la fin du jeu, le générique ne jouerait plus) ; ici un saut ne concerne que ce qui joue.
- **Non repris** : les cinématiques propres à une pièce : vague P (`animation_2_1`, `3_1`, `4_1` du chapitre 1 : faites, `rooms.md` § 7 ; les autres avec leur chapitre).
- **Cadence** : durées lues dans ScummVM, non mesurées sur le jeu d'origine ; le défilement de l'introduction (180 colonnes, sans attente dans ScummVM) est à 2 ticks par colonne (à mesurer).

**`musicFadeout()`** (`MusicFadeout`) : le volume (192 sur 192 chez ScummVM) baisse de 10 toutes les 50 ms réelles jusqu'à zéro, la musique s'arrête, 100 ms plus tard le volume est remis : 19 pas + 10 ticks, soit 1,05 s (vérifié). Le volume passe par `host.setMusicVolume?(niveau)` (0 à 1, facultatif ; `TrackPlayer.volume`, évolution E2 : `audio.md`).
Utilisée par `endChapter` (toujours : elle précède chaque chapitre), l'introduction et le générique.

## 10. Sauvegardes (vague S)

**Format** : `engine/save.ts`, un objet JSON versionné (`SAVE_VERSION = 1`, aucun lien avec les `GSAVE*` ni le format de ScummVM). Il contient : `ticks` (temps du moteur), `chapter`, `room` (numéro et objets : zone, point d'approche, orientation, `visible`, `isDoor`, `door`), `hero`, `igor`, `drascula`, `vonBraun`, `flags` (50), `inventory` (43), `savedTime`, `anim`, `colorSolo`, `takeObject`, `pickedObject`, `objExit`, `roomMusic`, `musicStopped`, `excuseLook`, `excuseAction`. Ne sont pas sauvegardés (transitoires, remis à zéro au chargement comme ScummVM) : `menuScreen`, `menuBar`, `hasName`, `textName`, `previousMusic`, le déplacement en cours du héros et de Von Braun. Tout ce que les chapitres posent dans l'état passe par `GameState` (`anim`, `savedTime`, drapeaux) : vérifié chapitre par chapitre par les tests d'aller-retour (aucune variable de module, les images d'animation sont dans `anim`).
`parseSave(valeur)` valide (version, bornes, types) et rend `null` pour tout ce qui n'est pas une sauvegarde de cette version : un emplacement dans ce cas compte comme vide.

**Moteur** : `engine.saveGame(): SaveData | null` (null si `!canSave`) ; `engine.loadGame(data): boolean` (faux, sans rien changer, si la fiche de la pièce n'existe pas dans le chapitre ou si le jeu est fini) ; option `new DrasculaEngine(host, { restore })` pour reprendre depuis l'écran titre (lève si la sauvegarde est inutilisable). `loadGame` s'appelle entre deux ticks : abandon de la séquence en cours, son coupé, `ticks` repris à celui de la sauvegarde, chapitre neuf (`startChapter`, feuille de `draw2` du chapitre), puis `enterRoom` comme `loadGame` de ScummVM (musique si elle change, `roomLoaded`, séquences d'entrée rejouées) ; l'état sauvegardé et les objets de la pièce sont remis juste après `roomLoaded`. `GameScript.restored` (après les séquences d'entrée) refait ce qu'une cinématique avait posé hors état : chapitre 6, pièce 102 avec le drapeau 1 à 2, `activatePendulum` (comme ScummVM).
`canSave` est faux pendant toute séquence, **y compris le menu des choix d'un dialogue** : dans ScummVM `_canSaveLoad` ne vaut vrai que pendant `updateEvents()` / `getScan()` de la boucle principale et de l'écran d'inventaire, jamais dans `converse`. Écran d'inventaire ouvert : permis, il se referme au chargement.

**Interface (`ui/saves.ts`)** : `createSaveSlots(store)` (un `SaveSlots<SaveData>` générique, `src/engine/save-slots.ts`, réglé sur `parseSave`) sur un `HostStorage` **déjà préfixé** (`prefixedStorage(store, SAVE_PREFIX)` avec `SAVE_PREFIX = "drascula:"`, comme Armaeth ; l'hôte l'expose en `host.storage`), dix emplacements numérotés de 1 à 10 (`NUM_SAVES`), clés `slot01`…`slot10`, valeur `{ "savedAt": ms, "save": SaveData }`. `read(n)` rend `null` pour un emplacement vide, JSON cassé, autre version ou champ manquant (avec un avertissement dans la console, jamais d'exception) ; `write(n, save, savedAt)` rend faux si le stockage refuse ; `clear(n)` ; `summarizeSlots(slots)` (= `summaries(describeSave, copy.saveSlot)`) donne pour le sélecteur `{ slot, empty, description, savedAt }` (« Emplacement 3 » ou « Chapitre 2, pièce 14 – 7 nov. 2026, 16:05 » ; les données du jeu n'ont pas de nom de pièce). `saveToSlot(engine, slots, n, now)` rend `"saved" | "busy" | "failed"`, `loadFromSlot(engine, slots, n)` rend `"loaded" | "empty" | "failed"`, `resultMessage(résultat, "save" | "load")` le texte à montrer (`copy.ts`).

**Branché en vague J** (`ui/title.ts`, `ui/app.ts`, fenêtres communes de `src/ui/point-click-dialogs.ts` depuis la mise en commun avec FOTAQ) : le sélecteur visuel (liste de `summaries()`, nom, confirmation avant d'écraser : `copy.saveOverwrite`, message de `resultMessage`), les touches F10 (sauvegarder, `kActionSaveGame`) et F7 (charger, `kActionLoadGame`) de ScummVM (F9 est le volume, pas les sauvegardes) avec `saveToSlot` / `loadFromSlot` appelés entre deux ticks, l'option « Continuer » de l'écran titre (`restore`), et l'hôte du navigateur (`host.storage` préfixé). La description d'un emplacement dit désormais « Chapitre N – nom du lieu – date » (`copy.roomNames`, noms tirés des objets des fiches et des cinématiques). Charger une sauvegarde d'un autre chapitre attend d'abord le chargement des vidéos de ce chapitre.

**Écarts avec ScummVM** : contenu plus complet (voir ci-dessus) ; la graine du hasard n'est pas sauvegardée ; le curseur (verbe ou objet en main) est conservé (ScummVM le remet à zéro après le chargement) ; la feuille `draw2` du chapitre 6 (`AUXDR.ALG`) est rechargée (ScummVM ne le fait pas dans un chargement au démarrage) ; après le pendule, le héros de face est dessiné de face au chargement alors qu'il reste de profil dans la partie qui a joué `animation_6_6` (`97.ALG` laissé dans `front` comme ScummVM).
