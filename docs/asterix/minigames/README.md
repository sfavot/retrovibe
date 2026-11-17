# Mini-jeux d'Astérix : gabarit de portage (vague E)

Brief commun aux agents qui portent un mini-jeu. Le pilote est **M22, les Poissons** : `m22.md`, `src/games/asterix/scenes/minigames/m22.ts`, `test/asterix/minigames/m22.test.ts`. Le suivre pas à pas ; la table des 15 mini-jeux (case, dossier, fonction d'entrée, segment) est dans `../re-index.md` § Mini-jeux et `../engine.md` §10.11.

## Avancement

| Module | Jeu | Segment | État |
|---|---|---|---|
| M22 | Des poissons pas très frais | `2580` | porté (pilote) |
| M23 à M36 | les 14 autres | voir `../re-index.md` | écran provisoire |

## Principe

- Référence unique : le désassemblage (`archives/asterix/re/disasm.txt` pour les arguments exacts, `decomp/<seg>_<off>_*.c` pour la structure). Lire **tout le segment**, pas seulement la fonction d'entrée. La décompilation Ghidra perd des arguments (`FUN_1a93_016d()` au lieu de `(3)`) : toujours recouper avec les `PUSH` du désassemblage ; les arguments sont empilés de droite à gauche, un `PUSH` 32 bits vaut deux mots.
- Un mini-jeu est un **script** (générateur) : une fonction d'origine = une fonction du portage, un `yield` = un tick de 1/60 s, primitives de `scenes/runtime.ts` citées par adresse. Pas de classe `Scene`.
- Les nombres (positions, vitesses, durées, probabilités) sont ceux du code ; les tables de données lues dans l'exécutable passent par `data/exe.ts` (décision D4) quand il y en a.
- Ordre des tirages `rt.rnd()` identique à l'original (les tests et les parties rejouées en dépendent).

## Fichiers à créer

| Fichier | Contenu |
|---|---|
| `docs/asterix/minigames/mNN.md` | règles, contrôles, difficulté par niveau, durée, gains et pertes, déroulé par fonction, fichiers, voix, vidéos et marqueurs `08`, globales, confiance, écarts (plan de `m22.md`) |
| `src/games/asterix/scenes/minigames/mNN.ts` | le mini-jeu (un dossier `mNN/` s'il est gros) ; exporte `MODULE`, le script, ses constantes de règle et l'interface de son état |
| `test/asterix/minigames/mNN-player.ts` | robot du mini-jeu (`MinigamePlayer`) |
| `test/asterix/minigames/mNN.test.ts` | victoire, défaite, chaque niveau, gains, clic direct |

Et **une ligne** dans chacun de ces deux fichiers partagés (relire le fichier juste avant de l'éditer, d'autres agents y ajoutent la leur) :

- `src/games/asterix/scenes/minigames/index.ts` : `registerMinigame(mNN.MODULE, mNN.script);` ;
- `test/asterix/minigames/players.ts` : `NN: playMNN,`.

Cas particuliers : le segment `24e3` sert M28 et M29 (un fichier, deux inscriptions, l'argument est dans `entry.argument`) ; `23d1:09c1` (M34, Idéfix) est aussi lancé du menu avec l'argument 0.

**Ne pas modifier** pendant la vague : `common.ts` (des mini-jeux), `scenes/runtime.ts`, `scenes/minigame.ts`, le moteur `src/engine/infogrames/`, les autres jeux. Si un outil manque, l'écrire dans son `mNN.ts` et le signaler dans le rapport : il sera mis en commun ensuite. Les tables de `../re-index.md` entre marqueurs `GEN` sont générées : ne pas les éditer.

## Squelette du script

```ts
export const MODULE = NN;

export function* script(play: Play, entry: MinigameEntry): Script {
  const { rt, board } = play;
  const player = board.player;            // niveaux : player.action, player.reflexion
  // 1. chargements (rt.load, rt.picture, resources.hy8 / sound)
  // 2. mise en place, musique (rt.music), chronos (rt.startChrono(2 ou 3))
  yield* flushInput(rt);
  beginPlay(rt, MODULE, state);           // phase jouable : rt.screen = "minigame"
  do {
    // une image : entrées, restauration du fond, logique, dessin
    yield* waitFrame(TICKS, () => { /* lecture des clics, à chaque tick */ });
  } while (!fini);
  endPlay(rt);
  // 3. fin : sons, nettoyage (rt.cleanup), vidéo ou voix de résultat
  // 4. gains : yield* changeSesterces(rt, player, n, true)   (1d24:0912)
}
```

Le script est appelé par `minigameSquare` (`scenes/minigame.ts`) **après l'annonce** `K60TE` ; à son retour le tour se termine. Il ne fait pas de fondu de sortie (l'écran suivant le fait).

## Primitives

`scenes/runtime.ts` (`Runtime`, noté `rt`) :

| Besoin | Primitive | Origine |
|---|---|---|
| Attendre | `rt.ticks(n)`, `rt.wait(cs)`, `rt.waitClick(s)`, `rt.waitAny(s)`, `rt.waitRelease()` | `1831:030a`, `1a93:0101`, `01c3`, `0215`, `026e` |
| Chronos | `rt.startChrono(k)`, `rt.chrono(k)` (secondes entières) ; `k` = 2 ou 3 dans un mini-jeu (0 : délai d'écran, 1 : temps de partie, à ne pas toucher) | `1a93:016d`, `0186` |
| Hasard | `rt.rnd()` (15 bits) | `1a93:00cb` |
| Directions | `rt.dirs()` : bits `UP`, `DOWN`, `LEFT`, `RIGHT`, tenues ou enfoncées depuis la dernière lecture | `DS:4b69` |
| Clic | `rt.click(zones)` : indice de la zone cliquée ou touchée, `"current"` pour Espace ; `rt.skipPressed`, `rt.buttonHeld` | `DS:4b6b` |
| Images | `rt.picture(nom, drapeaux)`, `rt.draw(image, drapeaux)`, `rt.restore()`, `rt.commit()`, `rt.fadeIn/fadeOut`, `rt.shiftUp()` | `1481:0155`, `027d`, `0448`, `1a93:0051`, `15b0` |
| Dessin | `rt.sprite(planche, n, x, y)`, `rt.text`, `rt.frame`, `rt.fill`, `rt.copyRect` | `2bdb:0477`, `2cd0:001e`, `2c8b`, `2c66`, `1481:045e` |
| Sons | `rt.effect(son)` (canal mélangé), `rt.ctx.voice.play(son)` (voie), `rt.music(nom)`, `rt.stopSound()`, `rt.waitSound()` | `16cb:0a4f`, `16cb:08c9` |
| Voix | `rt.voice(n, clé)` : `K{dossier}TE{n + 1}` ; la clé d'un dossier est `DS:6412 + 100 × DS:6410` (table `VOICE_FOLDERS`) | `135a:02ac` |
| Vidéo | `rt.video(nom, options)`, `rt.moduleVideo(module, lettre, options)`, `rt.overlayVideo` ; options `overlay` (`0x1000`), `shift` (`0x4000`), `keepPalette` (`0x4`), `loop`, `skip`, `draw` et `target` (rappel d'image `0x80`), `poll` ; marqueurs `08` : `video.marker` dans `draw` | `1948:04cc`, `15d7:06eb`, `07f7` |
| Sesterces | `changeSesterces(rt, joueur, delta, attendre)` (`scenes/squares.ts`) | `1d24:0912` |

`scenes/minigames/common.ts` :

| Outil | Origine |
|---|---|
| `Anim` (`init`, `select`, `step`, `wrapped`, `sprite`, `draw`) : objet animation HY8 | `1345:0082`, `0007`/`0143`, `00c0` |
| `restoreRects(rt, ...rectangles)` : rectangles du fond vers l'écran, avec les arrondis d'origine | `1481:07c3` |
| `flushInput(rt)` | `153c:0004` |
| `waitFrame(ticks, chaqueTick)` | `1831:030a(n, rappel)` |
| `touchDirs(rt, zones)`, `TOP_HALF`, `BOTTOM_HALF`, `LEFT_HALF`, `RIGHT_HALF` : direction par clic ou toucher | D11 |
| `EffectLoop` : bruitage en boucle | `16cb:0a4f` option `0x200000` |
| `fadeSoundOut(rt, cs)` : fondu sonore puis voie coupée | `13e5:0039` |
| `beginPlay(rt, module, état)`, `endPlay(rt)` : repère des robots | portage |

Pièges relevés sur le pilote :

- Coordonnées : `2bdb:0477` et `1481:07c3` prennent des pixels d'écran ; les tables du jeu ont souvent un décalage de (32, 40) que le code retire (`x − 0x20`, `y − 0x28`). Ancre d'un sprite : x = bord gauche, y = ligne du bas.
- `Anim.step()` pose le sprite **puis** avance : `wrapped` est vrai à l'image qui montre la dernière image de l'animation.
- L'original dessine dans le tampon A et ne montre qu'à `1a93:003a` ; dans le portage tout le travail d'une image se fait dans un même tick, avant le `yield`. Si le code relit la mémoire vidéo (`DS:402e`), garder une copie de la dernière image présentée (voir `screen` dans `m22.ts`).
- Un clic ne reste en file qu'un tick : le lire à chaque tick (`waitFrame`), pas une fois par image de jeu. Les directions, elles, sont retenues par `rt.dirs()`.
- Bruitages `16cb:0a4f` : dans l'original ils ne s'entendent que si la voie principale joue (`../engine.md` §5.2) ; le noter si un mini-jeu en lance voie muette.
- Les mini-jeux des Schtroumpfs (`src/games/teleportaschtroumpf/scenes/minigames/`) sont des classes `Scene`, pas des scripts : s'en inspirer pour les mécaniques communes aux deux jeux, sans importer leur code. Équivalents : `Clip` → `rt.video` ; `SoundHush` → `fadeSoundOut` ; `copyRect`, `fillRect`, `drawFrame` → `rt.copyRect`, `rt.fill`, `rt.frame` ; `Pointer` (curseur libre) → `rt.ctx.input.mouseX/Y` et `moveMouseByKeys()`, à écrire dans le premier mini-jeu à pointeur puis à mettre en commun.

## Clic et toucher directs (D11)

L'exe ne teste aucune position : tout passe par les directions et la validation. Le portage ajoute, sans retirer le clavier :

- jeu **à choix ou à pointeur** : zones cliquables (`rt.click(zones)`), un clic sur un élément vaut « y aller aux flèches puis valider » ;
- jeu **aux flèches** : `rt.dirs() | touchDirs(rt, zones)`, une zone d'écran par direction.

L'écart est noté dans `mNN.md`. Aucun texte n'est ajouté à l'écran du jeu ; un texte du site irait dans `ui/copy.ts`, en français, sans validation préalable (règle du projet).

## Robot et tests

- `beginPlay(rt, MODULE, state)` expose l'état vivant du mini-jeu : `rt.screen === "minigame"`, `rt.hint = { module, state }`. Le robot le lit mais ne l'écrit jamais : il joue au clavier et à la souris (`run.tap("ArrowUp")`, `run.click(x, y)`).
- `test/asterix/minigames/harness.ts` : `launchMinigame({ module, action, reflexion }, { seed })` lance le mini-jeu seul par sa case (annonce comprise) et s'arrête au début de la phase jouable ; `minigameState<T>(run)`, `minigamePlayer(run)` (ses sesterces), `untilMinigameOver(run)`.
- `mNN-player.ts` exporte `playMNN: MinigamePlayer = async (run, win) => …` : joue jusqu'à la fin de la phase jouable, pour gagner ou pour perdre. Inscrit dans `players.ts`, il sert aussi au **parcours** (`test/asterix/playthrough.test.ts`) : à l'écran `"minigame"`, le robot du parcours appelle le robot du module, ou répond à l'écran provisoire s'il n'y en a pas. Le rapport du parcours compte les mini-jeux portés joués.
- `mNN.test.ts` couvre au moins : la case lance bien le script inscrit ; victoire à chaque niveau (0, 1, 2) avec l'effet du niveau mesuré ; défaite ; gains et pertes exacts ; clic ou toucher direct ; `run.rt.missing` vide. Le temps est simulé : une partie de 30 s coûte quelques dizaines de millisecondes.
- Le test de l'écran provisoire (`game-flow.test.ts`) choisit seul un mini-jeu pas encore porté : rien à y changer.

## Recette

- Tests : `npx vitest run test/asterix/minigames/mNN.test.ts`, puis `npx vitest run test/asterix` (le parcours doit rester vert), `npm run typecheck`. Sorties redirigées vers le scratchpad et filtrées.
- Captures sans navigateur : `ASTERIX_SHOTS=<dossier> npx vitest run …` avec `run.shot("nom")` (PNG de l'image affichée, même rendu que le canvas). Utile pour vérifier chaque animation et la vidéo de fin.
- Navigateur : `http://localhost:5322/src/games/asterix/ui/dev.html?direct&intro=0&seed=n&minigame=NN&action=0..2&reflexion=0..2` joue le mini-jeu seul puis revient au menu. Un premier clic débloque le son, un second passe l'annonce. Si le volet du navigateur est masqué, les images tombent à 1 ou 2 par seconde et le jeu tourne au ralenti : un jeu d'adresse n'y est pas jouable, le dire dans le rapport.
- DOSBox-X (banc dans le scratchpad uniquement) pour une vitesse ou une probabilité que le code ne tranche pas ; sinon la noter en hypothèse dans `mNN.md`.

## Rapport attendu

Règles en quelques lignes, fichiers créés et modifiés, outils manquants écrits localement (candidats à `common.ts`), résultats des tests (nombres), hypothèses, ce qui n'a pas pu être vérifié.
