# Drascula : pièces et chapitres

Vague P : la logique propre à chaque pièce (`room_N`, `update_N` / `update_N_pre`, animations et cinématiques de pièce, `checkAction` du chapitre). **Ce document est la convention à suivre pour les chapitres 2 à 6** : le chapitre 1 en est le modèle (§ 7). Référence de comportement : `rooms.cpp`, `animation.cpp`, `talk.cpp`, `converse.cpp` d'`engines/drascula` (ScummVM, GPL v3+) ; on lit pour comprendre puis on réécrit en séquences (`engine.md` § 3), sans transposer ligne à ligne.
Autres documents : `engine.md` § 7 (points d'extension), `talk.md` (personnages, dialogues), `graphics.md` § 11 (prise de main sur l'image, accroches de dessin).

## 1. Organisation : un dossier par chapitre, rien de partagé

```
src/games/drascula/engine/rooms/
  index.ts              assemblage des six chapitres + cinématiques communes : `drasculaScript` (NE PAS MODIFIER)
  assemble.ts           fusion des tables, appel par chapitre des points globaux (NE PAS MODIFIER)
  chapter-N/            tout le chapitre N, et seulement lui
    index.ts            `export const chapterN: ChapterScript = {…}` (déjà importé par `rooms/index.ts`)
    ids.ts              numéros d'objets et de drapeaux nommés
    room-NN.ts          une pièce : gestionnaire, painter, avance des animations, animations propres
    <autre>.ts          une cinématique longue à part (chapitre 1 : `bj-scene.ts`)
test/drascula/rooms/
  walkthrough.ts        joueur scripté commun (NE PAS MODIFIER sans le signaler, § 5)
  assemble.test.ts      tests de l'assemblage et de la convention (NE PAS MODIFIER)
  room-kit.test.ts      tests des aides communes
  chapter-N/room-NN.test.ts, walkthrough.test.ts      les tests du chapitre N
docs/drascula/rooms-chapter-N.md                      notes du chapitre N (écarts, points ouverts), à créer
```

`rooms/index.ts` importe déjà `chapter-2` à `chapter-6` (des `ChapterScript` vides). **Un agent de chapitre ne touche donc à aucun fichier hors de `chapter-N/`, `test/drascula/rooms/chapter-N/` et `docs/drascula/rooms-chapter-N.md`** (pas de `plan.md` : le coordinateur y consigne l'avancement). Si une modification d'un fichier partagé (`engine/*.ts`, `render/`, `cinematics/`, `room-kit.ts`, `walkthrough.ts`) paraît nécessaire, s'arrêter et la signaler (§ 6).

## 2. Ajouter un chapitre

1. Créer `chapter-N/ids.ts` (numéros d'objets de la fiche `.ALD`, drapeaux : `export const Inn = { Barman: 52, … } as const`), puis `room-NN.ts` pour chaque pièce qui a un `room_N`, un `update_N` ou une animation.
2. Remplir `chapter-N/index.ts` (`ChapterScript` = `GameScript` partiel, tous les points sont facultatifs) :

| Champ | Reprend | Rôle |
| --- | --- | --- |
| `rooms: { N: gestionnaire }` | `room_N` | verbes d'une pièce, appelé après `roomActions` de la pièce ; rend vrai s'il a répondu (`hasAnswer`) |
| `painters: { N: { pre, post } }` | `update_N_pre`, `update_N` | dessin propre à la pièce ; **ne fait que dessiner** (§ 4) ; rangé par chapitre à l'assemblage (`GameScript.painters[chapitre][N]`), une même pièce peut donc avoir un painter dans deux chapitres (la 16 de ScummVM : chambre de B.J. au chapitre 1, hôtel au chapitre 2) |
| `tick: (g) => void` | partie « avance » des `update_N` | fait avancer les images d'animation de la pièce (§ 4) |
| `animations: { "x_N": séquence }` | `animation_x_N` | cinématiques appelées par une pièce (`g.animation("2_1")`) ou une réponse (`16_2` au chapitre 2) ; le nom est `<x>_<chapitre>` (vérifié par `assemble.test.ts`) |
| `checkAction` | partie « chapitre » de `checkAction` | objets combinés, pièces qui répondent avant leur table (13, 21, 56, 60, 102) |
| `canExit` | début d'`exitRoom` | refuser une porte (réplique, `g.doBreak = true`, rend faux) |
| `leaving` | `exitRoom`, actions par porte | cinématique de porte ; rend faux si elle a pris le relais (pièce suivante non chargée) |
| `roomLoaded` | `updateVisible`, musiques, minuteries | fin de la partie « données » d'`enterRoom` (objets visibles, `savedTime`) |
| `roomEntered` | fin d'`enterRoom` | séquences jouées à l'entrée |
| `updateDoor` | `updateDoor` | état de porte selon les drapeaux (chapitres 2 et 4) |
| `frame` | début du tour de `runCurrentChapter` | corrections de position (chapitre 2) |

3. Écrire les tests (§ 5) et `docs/drascula/rooms-chapter-N.md`.

Les points globaux (`checkAction`, `canExit`, `leaving`, `roomLoaded`, `roomEntered`, `updateDoor`, `frame`, `tick`) ne sont appelés que pour le chapitre en cours : inutile de tester `g.chapter` dans un point du chapitre. Les tables par pièce ou par nom sont fusionnées : une pièce, un painter ou un nom d'animation défini deux fois (même dans deux chapitres) est une erreur levée au chargement, et `assemble.test.ts` vérifie qu'un chapitre ne définit que des pièces qui sont les siennes (`engine.md` § 5).

## 3. Écrire une pièce

- **En-tête de module** : fonctions de ScummVM reprises (`room_62`, `animation_3_1`, fichier), puis les **écarts** voulus. Chaque nombre magique a un nom : verbes `Verb.Talk`…, objets et drapeaux dans `ids.ts` (`Inn.Barman`, `Flag.BarmanSpoke`).
- **Gestionnaire** : `function* roomNN(g: DrasculaEngine, objectId: number): Sequence<boolean>` ; `g.picked` est le verbe ou l'objet en main, `objectId` l'objet visé. Rend vrai quand il répond (ScummVM : `hasAnswer = 1`), faux pour laisser la main (réponse par défaut de la pièce 0 : § 6 de `engine.md`). Les lignes de `roomActions` de `drascula.dat` répondent avant lui : ne pas les recopier.
- **Parler, marcher, attendre** : `yield* g.talk(n)` (le héros), `g.talkers.bartender(n, 0)`, `g.talkers.pianist(n)`, `g.talkers.solo(texte, voix)`… (`talk.md` § 3), `yield* g.dialogs.play(n)` (`playTalkSequence`), `yield* g.dialogs.converse(n)`, `yield* g.walkToPoint(x, y)`, `yield* pause(n)` (`pause` de ScummVM) ou `delay(ms)`, `yield* g.finishSound()`, `g.playEffect(n)` (`S<n>.ALS`), `g.pickObject(n)`, `g.addObject(n)`, `g.removeObject(n)`, `g.selectVerb(Verb.None)`.
- **Fin de chapitre** : `g.endChapter()` (ScummVM : le gestionnaire « rend vrai » jusqu'à `runCurrentChapter`) ; la séquence est abandonnée à son prochain `yield`.
- **Cinématique** : `animate(g, "x.bin", ips)` / `playSsn` (`cinematics/player.ts`), `showPicture`, `clearScreen` ; l'image libre est `g.gfx.canvas` et `g.updateRoom()` rend la main à la pièce (`graphics.md` § 11). Échap : envelopper la cinématique d'un `skippable(…)` (le chapitre 1 : `bj-scene.ts`).
- **Pièce « fantôme »** : `_roomNumber = 16` ou `-1` de ScummVM (décor d'une autre pièce, ou plus de mises à jour) : remplacer `g.state.room` par un `RoomState` de ce numéro ou poser `g.gfx.roomSprites = false`.
- **Images** : `g.gfx.loadPic(nom, g.gfx.extra | draw3 | front | back | bg | draw2, nombreDeCouleurs?)` ; la feuille annexe de la pièce est `draw3` (`AUXnn.ALG`), celle du chapitre `draw2`, le héros de côté `extra` (`97.ALG`).

## 4. Animations d'une pièce : dessin d'un côté, avance de l'autre

`update_N_pre` / `update_N` de ScummVM dessinent **et** font avancer les animations (`getTime() - savedTime > n`, tirages au hasard). Ici le dessin est recomposé à chaque `render()` (écran à 60 Hz, moteur à 100 Hz) : un painter qui avancerait ou tirerait au hasard rendrait le jeu dépendant du nombre d'images dessinées. On sépare donc :

- **`painters[N].pre` / `.post`** `(r: DrasculaRenderer, state: GameState) => void` : copient des rectangles (`r.screen.copyBackground(r.draw3, sx, sy, dx, dy, w, h)`, `copyRect`, transparent 255) selon `state.anim`, `state.flags` et `state.hero` ; données du `.dat` par `r.dat` (`candles`, `pianistX`, `drunkX`…). `pre` est appelé avant le héros, `post` après ; la table `roomPreUpdates` / `roomUpdates` du `.dat` est appliquée avant chacun d'eux.
- **`tick(g)`** : appelé à chaque tick (10 ms) ; se limite à sa pièce (`g.state.room?.number`, `g.gfx.owner === "room"`, `g.gfx.roomSprites`) ; avance `g.state.anim[clé]` (images : un nombre par clé, absent = 0 ; clés propres au chapitre), `g.state.savedTime`, les drapeaux, avec `g.rng.inclusive(n)` pour `getRandomNumber(n)`.
- **Écart voulu** : ScummVM n'avance qu'à chaque redessin de la pièce (jamais pendant un `pause` nu) ; ici l'avance suit le temps du jeu, y compris pendant les répliques (nécessaire : l'ivrogne qui parle attend la fin de son geste). La cadence réelle est à comparer au jeu d'origine.

## 5. Tests

Un test par pièce (`test/drascula/rooms/chapter-N/room-NN.test.ts`) : objets de la fiche, verbes (voix jouées), portes (pièce et point d'arrivée), drapeaux, animations (avance de `state.anim`, pixels du painter comparés à la feuille source) ; et **un test de passage** (`walkthrough.test.ts`) qui joue la solution du chapitre à la souris et au clavier jusqu'à ce que le chapitre suivant démarre. Les solutions sont dans `test/drascula/solutions.ts` (`solveChapterN`), enchaînées par `test/drascula/full-game.test.ts` (du chapitre 1 au générique, un seul moteur). Tous sont ignorés sans `original/drascula/` (`describe.skipIf(!hasOriginalFiles)`).

**`Walkthrough`** (`test/drascula/walkthrough.ts`) : un joueur qui n'accède jamais à l'état du moteur, il joue comme une personne.

```ts
const w = new Walkthrough({ chapter: 1 });     // démarre le chapitre (sans l'introduction `1_1`, option `skip`) et attend la première pièce
w.act(Verb.Talk, 52);                          // verbe (touche F1 à F6), puis clic sur l'objet 52 de la pièce, attend la fin
w.goTo(105, 60_000);                           // clic sans verbe : marcher, passer une porte (le second argument : ticks permis)
w.useItem(28, 100);                            // objet de l'inventaire en main (clic droit, clic dans la case), puis clic sur l'objet 100
w.verbOnItem(Verb.Look, 28); w.combine(18, 19);// verbe ou objet sur un objet de l'inventaire
w.waitForChoices(); w.choose(2);               // dialogue : menu des choix, survol et clic du choix n (0 à 3)
w.mark(); w.voices(mark);                      // journal des voix jouées (`214.als`, `bj1.als`, `s3.als`)
w.until(() => w.flags[0] === 1);               // avance jusqu'à une condition ; `w.wait(n)`, `w.settle()`, `w.key("Escape")`
w.pointOf(id)                                  // un point où cliquer sur l'objet (hors des autres objets et du héros)
```

Règles : un clic pendant une séquence est ignoré (les aides attendent la fin entre deux clics) ; une cinématique est longue (`goTo`, `act` et `useItem` acceptent la limite de ticks, 60 000 pour une cinématique de chapitre) ; sous un verbe ou un objet en main, `goTo` le range d'abord. `scriptWithout("1_1", …)` donne le script du jeu sans certaines cinématiques communes. Pour une pièce sans l'enchaînement complet (état voulu d'emblée), `new Walkthrough({ chapter: N })` puis les aides d'état du moteur (`engine.enterRoom`, `engine.addObject`, `engine.flags[n] = 1`) sont permises dans un test de pièce, pas dans le test de passage.

## 6. Aides communes et ce qui peut manquer

**Dans le moteur** (déjà là, génériques) : `engine/room-kit.ts` : `roomObject(g, id)`, `setVisible(g, id, bool)`, `setDoor(g, id, bool)`, `toggleDoor(g, drapeau, indexDePorte | null, "open" | "close")` (sons 3 et 4, `updateDoor`, attente du son), `hiccup(g, n)` (secousse de l'écran, `DrasculaRenderer.shake`), `freezeRoom(g, parts)` et `pose(...)` (geler la pièce dans l'image libre pour y dessiner des sprites, cinématiques des chapitres 2 et 5) ; `engine/inn-kit.ts` : l'auberge animée des chapitres 1 et 2 (`advanceInn`, `drawInn`) ; `DrasculaEngine.updateDoor(index)` public ; `GameState.anim` ; points `painters`, `tick`, `ChapterScript` ; `DrasculaRenderer.dat` public. Déjà là avant la vague P : `dialogs.play / converse`, `talkers.*`, `placeIgor` / `placeDrascula` (`render/actors.ts`), `animate`, `playSsn`, `showPicture`, `clearScreen`, `fadeToBlack`, `fadeFromBlack`, `musicFadeout`.

**Manques connus (à ajouter seulement si un chapitre en a besoin, en le signalant)** :
- `updateVisible` (visibilité des objets selon les drapeaux à l'entrée des pièces, chapitres 2 et 4) : se fait dans `roomLoaded` avec `setVisible` ; une fonction commune ne s'impose pas.
- Positions de B.J. et des autres personnages placés par les pièces (`placeBJ`…) : à écrire avec la pièce qui les dessine (painter) ; à promouvoir en aide commune si deux chapitres en ont besoin.
- Les voix `B*.ALS` / `textb` de l'ivrogne au-delà de `B3` et les positions de bouche à comparer à des captures (`talk.md` § 6).
- Préchargement des `.BIN` et des feuilles par l'hôte du navigateur : fait en vague J (`ui/preload.ts`) ; `ui/render-dev.html?videos=1` les précharge pour les essais.

Toute modification d'un fichier partagé (`engine/*.ts` hors `rooms/chapter-N`, `render/`, `cinematics/`, `room-kit.ts`, `test/drascula/walkthrough.ts`, `assemble.ts`) : s'arrêter et la signaler avant, avec la raison. Une aide générique manquante se décrit dans `rooms-chapter-N.md` (§ « Aides manquantes »).

## 7. Chapitre 1 (modèle)

Pièces 62 (auberge) et 63 (arrière-salle). Fichiers : `chapter-1/ids.ts`, `room-62.ts` (`room62`, `innPainter`, `tickInn`, `barmanDialog` = `animation_3_1`, `pianistDialog` = `animation_4_1`), `bj-scene.ts` (`animation_2_1`), `index.ts`. Tests : `test/drascula/rooms/chapter-1/` (`room-62`, `room-63`, `walkthrough`).

| Élément | ScummVM | Où |
| --- | --- | --- |
| `room_62` : parler à l'ivrogne (53), au barman (52), au pianiste (54) | `room_62` | `room-62.ts` `room62` |
| `update_62_pre` (bougies, clignement, pianiste, ivrogne), `update_62` (premier plan `2aux62.alg`) | `update_62_pre`, `update_62` | `innPainter` (dessin), `tickInn` (avance) |
| barman : scénario 3 (lève le drapeau 0) ; pianiste : il se retourne puis 4 échanges | `animation_3_1`, `animation_4_1` | `barmanDialog`, `pianistDialog` |
| porte du fond 105 : refusée tant que le drapeau 0 est bas (réplique 442), puis la cinématique de B.J. et la fin du chapitre | `exitRoom` (105), `animation_2_1` | `index.ts` `canExit`, `leaving` ; `bj-scene.ts` |
| porte 104 condamnée (`isDoor[7] = 0`) | `enterRoom` | moteur (`enterRoom`) |
| pièce 63 : pas de `room_63` ni `update_63` ; `roomActions`, rectangle de `roomUpdates` | | rien à écrire : testé |
| hoquet du héros | `hiccup` | `room-kit.ts` |

La solution du chapitre : parler au barman (la porte du fond s'ouvre), passer la porte du fond ; la cinématique de B.J. enchaîne sur le chapitre 2 (pièce 14). L'ivrogne, le pianiste, les objets des deux pièces et l'arrière-salle sont facultatifs.

**Écarts et constats du chapitre 1** :
- cadence d'avance des animations de l'auberge : une image toutes les 7 ticks (70 ms, `getTime() - savedTime > 6` testé à chaque tick) ; ScummVM la teste à chaque redessin de la pièce (~10 ticks), à comparer au jeu d'origine ;
- `animation_4_1` : les deux images du pianiste qui se retourne sont dessinées par le painter (`anim.pianistTurn`), pas copiées dans une zone de l'écran ;
- `animation_2_1` : la chambre de B.J. est une pièce 16 sans objets, héros de taille fixe (`factor_red = 99`) ; le « numéro de pièce inexistant » est `gfx.roomSprites = false` ; Échap saute toute la cinématique et le chapitre 2 commence quand même ; le texte de `talk_solo` ne reste pas à l'écran après la réplique (écart de `cinematics/sequences.ts`) ;
- le distributeur de la pièce 63 est numéroté 103 sur la fiche française, alors que les lignes de `roomActions` répondent à 108 (« C'est un distributeur… », « Ohé ! machine à tabac… ») : `Regarder` et `Parler` donnent les réponses par défaut (54, 16), comme dans l'original (à confirmer sous ScummVM) ;
- constat de jeu à la souris : `menuBar` est calculé à la fin de l'image précédente ; un appui juste après un déplacement de la souris de la barre des verbes vers la pièce (tactile sans survol) lit encore « souris sur la barre » et choisit un verbe : comportement de ScummVM, traité en vague J dans l'hôte du navigateur (`ui/input.ts` : l'appui suit le saut de position de deux images) ;
- `.BIN` : `animation_2_1` lit `ag`, `lev`, `gaf`, `bjb`, `bes` et `rap` : préchargées avec le chapitre 1 par l'hôte du jeu (`ui/preload.ts`) ;
- durées des cinématiques lues dans ScummVM, non mesurées sur le jeu d'origine.

**Vérifié** : `test/drascula/rooms/` (45 tests : assemblage, aides, pièces 62 et 63, passage, Échap, inventaire). **Vu dans le navigateur** (`render-dev.html?chapter=1&videos=1`, souris réelle pour la barre des verbes, le barman et la porte du fond ; le temps du moteur était avancé à la main, la page ne tournant pas quand le volet est masqué) : l'auberge animée, le menu des verbes, la réplique du barman avec sa bouche, le hoquet, la chambre de B.J., le début du chapitre 2.
