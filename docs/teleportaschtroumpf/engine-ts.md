# Moteur TypeScript du Téléportaschtroumpf (tâche 2.2)

Brief pour les phases 3 (écrans) et 4 (mini-jeux). Spec de comportement : `engine.md` (surtout §9). Ce document décrit le code : où est quoi, comment écrire une scène, comment tester sans navigateur.

## Carte du code (`src/games/teleportaschtroumpf/`)

| Fichier | Rôle |
|---|---|
| `engine/host.ts` | `Host` : la seule frontière avec l'extérieur (fichiers, temps, entrées, son, stockage, affichage). Le moteur ne touche ni au DOM, ni à `fetch`, ni à `Date`. |
| `engine/engine.ts` | `Engine` : assemble tout ; `engine.frame(now)` à chaque image, `engine.start(scene)`. |
| `engine/clock.ts` | `Clock` (60 ticks/s, pas fixe), `Timer` (chrono gelable). |
| `engine/rng.ts` | `BorlandRandom` : `next()` (0..32767) et `below(n)` = `rand() × n / 0x8000`. |
| `engine/scene.ts` | `Scene`, `SceneContext`, `SceneManager` (remplacement, pile, fondu, chargement asynchrone). |
| `engine/surface.ts` | `Surface` : tampons A/B/C 320×200 indexés, `drawMcg`, `blitImage`, `drawSprite`, `drawFrame`, `drawText`. |
| `engine/sprites.ts` | `placeSprite` (composition de sprites HY8, ancrage bas-gauche, miroir), `AnimationPlayer`. Partagé avec la visionneuse (`ui/panels.ts`). |
| `engine/palette.ts` | `Palette` (256 × RVB 8 bits, entrée 0 noire, conversion VGA) et `Fade` (fondus). |
| `engine/menu.ts` | `Menu` : liste d'éléments (clavier, validation, voix d'aide, bip, rebouclage optionnel), surbrillance par palette ou sprite. |
| `engine/input.ts` | `Input` : actions abstraites, « tenu » / « vient d'être appuyé », position de la souris 320×200 (pointeur libre seulement). |
| `engine/options.ts` | Options parents (`localStorage` via `host.storage`), verrou parental. |
| `engine/resources.ts` | `Resources` : MCG / HY8 / PFN / VOC décodés et gardés, MUX non gardés, `prefetch`. |
| `engine/paths.ts` | `resolveGameFile` (nom d'origine → chemin `DATA/…`), `voiceName`, `musicName`. |
| `engine/video.ts` | `VideoPlayer` (MUX synchronisé sur le son) et `VideoScene` générique. |
| `engine/picture.ts` | `PictureScene` (image fixe, fondus, attente) et `WaitScene`. |
| `audio/backend.ts`, `audio/voice.ts`, `audio/web-audio.ts` | `AudioBackend` abstrait, `VoiceChannel` (voie unique + musique + bips), implémentation Web Audio. |
| `scenes/boot.ts` | Séquence de démarrage. |
| `scenes/flow.ts`, `scenes/s07-menu.ts`, `scenes/sNN-*.ts` | Flux entre écrans, menu principal S07 et les écrans (voir « Menus et flux »). |
| `game/` | Logique pure de la partie et du plateau (`Game`, tables), sans rendu (`rules.md`). |
| `scenes/game.ts`, `scenes/s01-board.ts`, `scenes/board/` | Partie (`28a3:00ad`) et plateau S01 (`291e:0401`) ; écrans empilés `s02-map.ts`, `events.ts`, `grand-schtroumpf.ts` et souche `minigames.ts` (voir « Partie et plateau »). |
| `ui/app.ts`, `ui/browser-host.ts`, `ui/dev.html`, `ui/dev.ts`, `ui/style.css` | Hôte navigateur, canvas à l'échelle entière, boucle `requestAnimationFrame`, page de dev. |
| `index.ts` | `GameDefinition` `teleportaschtroumpf` (pas encore dans `src/games/registry.ts`). |

Page de dev : `npx vite`, puis `/src/games/teleportaschtroumpf/ui/dev.html` (hors build). Les fichiers du jeu sont servis en `/teleportaschtroumpf/…` depuis `original/teleportaschtroumpf/`.

## Boucle et temps

`ui/app.ts` appelle `engine.frame(performance.now())` à chaque `requestAnimationFrame`. Dedans :

1. `Clock.update(now)` accumule le temps ; chaque tick dû est joué un par un (au plus ~15 ticks par appel, le reste est abandonné après une mise en veille).
2. Par tick : touches de volume (F1/F2, répétition 20 ticks), `voice.update()` (relance de la musique), `fade.tick()`, `scenes.tick()`.
3. `scenes.tick()` compte les ticks de la scène courante et appelle `scene.update(ctx)` tous les `step` ticks (premier appel dès le premier tick), puis `input.endUpdate()`.
4. Si une scène a été mise à jour (ou entrée, ou reprise), `scene.render(ctx)` est appelé une fois par image affichée, puis `host.present(surface, palette)`. Un fondu en cours force aussi la présentation. Si rien n'a changé, rien n'est présenté.

`ctx.clock.ticks` (60/s), `ctx.clock.centiseconds` (l'unité du jeu), `ctx.clock.seconds`. Pour une attente, mémoriser `ctx.clock.ticks` dans l'état de la scène et comparer ; pour un chrono avec pause : `const t = ctx.clock.createTimer()`, `t.freeze()` / `t.resume()`, `t.seconds`.

Les attentes bloquantes de l'original (`wait(cs)`, `1f33:0348` cadence, `02c0` attente clic/Échap) deviennent des états de scène. **Jamais de boucle bloquante, jamais de `await` dans `update`.**

Pas (`step`) : 5 ticks (12 i/s) par défaut, 4 pour le plateau, 3 pour la carte et S30, 1 pour une scène qui doit réagir tout de suite (vidéos, menus à fondu). Une scène déclare `readonly step = 4`.

## Écrire une scène

Interface (`engine/scene.ts`) :

```ts
interface Scene {
  readonly step?: number;                       // ticks entre deux update (défaut 5)
  load?(ctx): Promise<void>;                    // charge les ressources ; la boucle continue
  enter(ctx): void;                             // état initial, palette, fond
  update(ctx): void;                            // un pas de logique (machine à états)
  render(ctx): void;                            // dessine dans ctx.surface
  resume?(ctx): void;                           // la scène du dessus a été retirée (pop)
  exit?(ctx): void;
}
```

`ctx` (`SceneContext`) : `host`, `clock`, `rng`, `surface`, `palette`, `fade`, `input`, `voice`, `resources`, `options`, `scenes`.

Changer de scène : `ctx.scenes.replace(next, { fade: true })` (fondu au noir pendant le chargement de `next`, puis fondu d'entrée), `ctx.scenes.push(pause)` / `ctx.scenes.pop()` pour pause, aide, confirmation (la scène du dessous est figée, pas détruite). Pendant une transition la scène courante n'est plus mise à jour ; `engine.loading` est vrai pendant le chargement. Une seule transition à la fois (sinon exception). Une erreur dans `load` remonte par `engine.frame` : l'app affiche un message.

Les appuis faits avant l'entrée d'une scène sont oubliés (un Échap ne passe pas deux scènes).

### Exemple minimal : un fond, un sprite qui bouge, un retour

```ts
import type { Hy8 } from "../data/hy8";
import type { Mcg } from "../data/mcg";
import type { Scene, SceneContext } from "../engine/scene";

export class DemoScene implements Scene {
  readonly step = 4;                 // 15 i/s comme le plateau
  private mcg!: Mcg;
  private sprites!: Hy8;
  private x = 20;

  async load(ctx: SceneContext) {
    [this.mcg, this.sprites] = await Promise.all([
      ctx.resources.mcg("s01a001d.mcg"),
      ctx.resources.hy8("s01a000s.hy8"),
    ]);
  }

  enter(ctx: SceneContext) {
    ctx.palette.load(this.mcg.palette);               // l'entrée 0 est forcée à noir
    ctx.surface.drawMcg(this.mcg, { asBackground: true }); // fond B (et A)
    ctx.fade.blackout();
    ctx.fade.in();                                    // fondu d'entrée de 17 pas
  }

  update(ctx: SceneContext) {
    if (ctx.fade.active) return;                      // l'original attend la fin du fondu
    if (ctx.input.pressed("right")) this.x += 4;
    if (ctx.input.pressed("left")) this.x -= 4;
    if (ctx.input.justPressed("validate")) ctx.voice.playBeep(0);
    if (ctx.input.justPressed("skip")) ctx.scenes.replace(new NextScene(), { fade: true });
  }

  render(ctx: SceneContext) {
    ctx.surface.restoreBackground();                  // B → A : efface les sprites
    ctx.surface.drawSprite(this.sprites, 3, this.x, 150); // x = bord gauche, y = ligne du bas
  }
}
```

Lancer : `engine.start(new DemoScene())` (déjà fait par `ui/app.ts` avec `createBootScene()` ; pour tester une scène isolée, la remplacer dans `scenes/boot.ts` ou appeler `ctx.scenes.replace` depuis `dev.ts`).

Scènes toutes faites : `PictureScene` (MCG + fondu + attente + `onEnd`), `WaitScene`, `VideoScene` (MUX avec son, `skippable`, `fadeOutAtEnd`, `onEnd`). Elles s'enchaînent par `onEnd: (ctx) => ctx.scenes.replace(...)` ; voir `scenes/boot.ts`.

## Surface, palette, fondus

- `ctx.surface.work` (A) est ce qui est présenté ; `background` (B) est le fond de la scène ; `saved` (C) la sauvegarde (pause : `save()` à l'entrée, `restoreSaved()` pour redessiner). Le tampon A **n'est pas effacé** entre deux `render` : une scène qui redessine tout doit commencer par `restoreBackground()` ou `clear()`.
- `drawMcg(mcg, { asBackground })` copie les pixels ; la palette se charge à part : `ctx.palette.load(mcg.palette)` (ou `load(pal, start, count)` pour une partie). `palette.setColor(i, r, g, b)` modifie une entrée (surbrillance des boutons S07 : entrées 120+i → `(0x10, 0xA4, 0xCC)`), à faire dans `update`, le rendu suivant le montrera.
- `blitImage(image, x, y, { mirrorX, opaque })` : (x, y) = coin **haut-gauche** de l'image, 0 = transparent (sauf `opaque`). `drawSprite(hy8, index, x, y)` : sprite composé, (x, y) = bord gauche et **ligne du bas** (en miroir, bord droit) ; le bit `0x8000` de l'indice ou `{ mirrorX: true }` retourne. `drawFrame(hy8, frame, x, y)` pour une frame d'animation ; `new AnimationPlayer(hy8, n)` + `advance()` à chaque `update` + `player.frame` ; `player.looped` devient vrai après la dernière frame.
- `drawText(font, bytesCp437, x, y, color, { outline?, align? })` : police PFN (`ctx.resources.pfn("s52d001f.pfn")`), texte en **octets CP437** (arrêt au premier 0), couleur = indice de palette, (x, y) = coin haut-gauche ; `align: "center"` centre sur x (160 pour l'écran), `"right"` aligne à droite ; `outline` = indice de la couleur du contour (8 décalages de ±1 px puis le centre, `154c:0214`). Renvoie la largeur (= `measureText`). Les textes `.DAT` sont déjà décodés en `string` par `data/text.ts` : encoder en octets CP437 (table inverse de `src/data/cp437.ts`, à ajouter en phase 3 quand le besoin apparaît) ou passer les octets bruts.
- Fondus : `ctx.fade.out(n = 16)`, `ctx.fade.in(n = 16)` (17 pas à ≈ 70/s, soit 14 ticks), `ctx.fade.active`, `ctx.fade.blackout()` (écran noir sans toucher à la palette), `ctx.fade.reset()` (pleine luminosité). `out` laisse un écran noir jusqu'au prochain `in` ou `reset`. Formule : `pal − floor(cur × pal / n)`. Affichage : entrée 0 noire, puis `(v >> 2) × 255 / 63` arrondi.

## Entrées

Actions (`engine/input.ts`) : `up down left right validate cancel skip pause volumeUp volumeDown`. Sources : flèches et Q/A/Z/X (haut/bas/gauche/droite, positions physiques QWERTY comme les scancodes d'origine), Espace / clic gauche = `validate`, Entrée / clic droit = `cancel` (voix d'aide) ; la position du pointeur ne désigne jamais un élément, Échap = `skip`, P = `pause`, F1/F2 = volume −/+ (géré par le moteur).

- `ctx.input.pressed(a)` : tenu ; `justPressed(a)` : enfoncé depuis le dernier `update` (mémorisé, un appui plus court que le pas n'est pas perdu) ; `anyJustPressed(...)`.
- `ctx.input.mouseX/mouseY` : position 320×200, lue seulement par les scènes à pointeur libre qui dessinent leur curseur HY8 (E2). Aucun écran de menu n'a de zone cliquable : clavier d'origine seul (décision `plan.md`), les boutons de la souris sont les actions `validate` (gauche) et `cancel` (droit).
- Curseur : le curseur système est masqué en permanence sur le canvas (`cursor: none` dans `style.css`) ; ni `Host.setCursor` ni `Scene.ownCursor` n'existent plus.

## Son

Une seule voie (`ctx.voice`, `audio/voice.ts`) :

- `voice.play(voc)` (voix, bruitage ; `voc` = résultat de `ctx.resources.voc("s07v004t.voc")`) coupe ce qui jouait, musique comprise ; `voice.playBeep(0..2)` joue un des 3 bips préchargés (`s52d001b`, `s01a002b`, `s01a001b`) sur la même voie ; `voice.stop()`.
- `voice.setMusic(voc | null)` : musique de fond (`musicName(1 + ctx.rng.below(3))` → `s52m00Nm.voc`). Elle repart **au début, en boucle**, dès que la voie est libre (vérifié à chaque tick) : pas de reprise à la position où la voix l'a coupée. `voice.holdMusic(true)` la retient (vidéos).
- `voiceName("s07v", 4)` → `s07v004t.voc`. `voice.volume` 0–15 (défaut 15).
- `voice.voicePlaying` : vrai tant qu'une voix sort (pour attendre la fin d'une voix avant d'enchaîner, comme `1f33:03a7`).
- Navigateur : le contexte audio ne démarre qu'au premier geste (`WebAudioBackend.unlock()` sur `pointerdown` / `keydown`). Avant, `play` ne fait rien et `playing` reste faux : le moteur n'attend donc jamais un son qui ne sortira pas (les vidéos retombent sur l'horloge).
- Pas de CD audio.

## Vidéo MUX

`VideoScene({ file: "s06a.mux", skippable, fadeOutAtEnd, onEnd })`. L'image affichée est `floor(temps × cadence de l'en-tête)`, avec `temps` = position audio de la voie (son 8 bits non signé à la fréquence de l'en-tête, lancé sur la voie à l'entrée), ou l'horloge si rien ne sort. Les images sont décodées dans l'ordre (codage inter). La fin attend la dernière image **et** la fin du son. Échap ou `validate` passent la vidéo si `skippable` (défaut oui ; le titre S05 est non passable). La palette de la vidéo est chargée (entrée 0 noire), la musique est retenue pendant la lecture.

## Options parents

`ctx.options` (`ParentOptions` : `durationIndex` 0..3, `pauseIndex` 0..4, `messageIndex` 0..8, `lastGameMinutes`) est chargé au démarrage. Pour modifier : changer les champs puis `saveOptions(ctx.host.storage, ctx.options)`. `gameSeconds(o)` = `(durationIndex + 1) × 1800`, `pauseMinutes(o)` = `pauseIndex × 30`, `isLocked(o, nowMinutes)` avec `nowMinutes = Math.floor(ctx.host.unixSeconds() / 60)`. Clé de stockage `retrovibe:teleportaschtroumpf:options`. Pas de sauvegarde de partie.

## Ressources

`ctx.resources.mcg(name)`, `.hy8`, `.pfn`, `.voc`, `.bytes(name)` : par nom d'origine en minuscules (`s22a001d.mcg`) ou chemin `DATA/…` ; décodés une fois et gardés. Charger dans `Scene.load`, pas dans `update`. `prefetch(...names)` lance des lectures en tâche de fond (utile pour enchaîner sans attendre). Les `.mux` ne sont pas gardés. `ctx.resources.clear()` libère tout (changement de famille de scènes).

Résolution (§9.11) : `sNNxXXX.ext` → `DATA/SNN/SNNx/SNNXXX.EXT` s'il est dans le manifeste, sinon recherche par nom (`GameFiles.resolve`). Un nom présent dans plusieurs dossiers (`S36A000S.HY8` dans `S36A` et `S36E`) : passer le chemin complet `DATA/S36/S36E/S36A000S.HY8`.

Hasard : `ctx.rng.below(n)` (graine `unixSeconds & 0xFFFF`, injectable par `new Engine(host, { seed })`).

## Tester sans navigateur

`test/teleportaschtroumpf/engine-test-host.ts` fournit :

- `TestHost` : lit `original/teleportaschtroumpf/` sur disque, temps simulé (`host.time`, en ms), `host.input` pilotable (`keyDown("Escape")`…), `host.presentations` / `host.lastPresentation` (copies de la surface et de la palette d'affichage), `host.audio` (`FakeAudio` : `plays`, position et fin simulées d'après `host.time`, `enabled = false` pour simuler une sortie verrouillée), `host.storage` en mémoire.
- `runFor(engine, host, ms, onFrame?)` : images simulées à 60 Hz ; attend les chargements de scène. `runUntil(engine, host, condition)`.

```ts
const host = new TestHost();
const engine = new Engine(host, { seed: 1 });
engine.ctx.scenes.replace(new MaScene());   // ou await engine.start(scene) (charge aussi les bips)
await runFor(engine, host, 2000);
host.input.keyDown("Space");
await runFor(engine, host, 100);
expect(host.lastPresentation.surface[0]).toBe(…);
```

Les tests qui lisent les fichiers du jeu utilisent `describe.skipIf(!hasOriginalFiles)` (`test/teleportaschtroumpf/helpers.ts`) ; `readData` renvoie un `Buffer` : le convertir (`new Uint8Array(...)`) avant un `toEqual` contre des données du moteur.

## Démarrage (`scenes/boot.ts`)

Logo S52D0 : image `s52d00.mcg` en fondu d'entrée → vidéo `s52d0.mux` (≈ 12 s, passable) → fondu au noir → attente de 3 s sur écran noir (passable ; c'est ce que fait l'original : fondu, `02c0(3)`, fondu) → intro S06 `s06a.mux` (passable) → titre S05 : vidéo `s05asphi.mux` (non passable) puis `s05a.mcg` 1 s, fondu au noir → menu S07 (`goMainMenu`, voir « Menus et flux »). Les fichiers suivants sont lus d'avance pendant le logo. Le retour d'une partie ne rejoue pas le démarrage.

## Écarts à `engine.md` et décisions

- `Host` a en plus `unixSeconds()` (graine du hasard, verrou parental : le moteur n'a pas le droit d'appeler `Date`).
- `Host.loadFile` rejette si le fichier est absent (pas de `undefined`).
- Fondu : un pas par 60/70 tick (≈ 70 Hz du VGA), soit 14 ticks pour 16 ; `out` ne vide pas la surface, il laisse la palette à zéro (même rendu).
- Conversion d'affichage `(v >> 2) × 255 / 63` arrondie (pas tronquée).
- Vidéo : l'image est `floor(temps audio × cadence)` (la cadence vient de l'en-tête, `mux.md`) ; la constante « 12 » du PIT reste non expliquée (engine.md §8.1).
- Attente du logo sur écran noir : conforme au code (`154c:000f`), à revoir visuellement ; si elle paraît trop longue, c'est `LOGO_WAIT_SECONDS`.
- Pas de navigation par poussée contre les bords ni de sélection au survol : clavier d'origine seul (décision `plan.md`).
- Le masquage du bouton bas pendant un clic gauche maintenu (`14b3:01c9`, masque `0xCD`) n'est pas reproduit.

## Menus et flux

### `Host` : sortie

`host.exit()` (« Quitter » après le générique). Navigateur (`ui/app.ts`) : retour à l'accueil (`location.hash = "#/"`) si le jeu est monté depuis le site, redémarrage du jeu sur la page de dev. Hôte de test : `host.exited`.

### `engine/menu.ts`

`new Menu({ items, axis, wrap?, highlight?, initial?, changeSound? })`, avec `items: { voice? }[]`. `axis` : `"vertical"` (haut/bas), `"horizontal"` (gauche/droite) ou `"none"` (la scène déplace elle-même la sélection avec `select`, ex. S46 à deux dimensions). `wrap` (défaut vrai : S07, S08) ; `wrap: false` borne l'index (S09, S04, S49, S48 : l'original ne reboucle pas). `changeSound` : bip de navigation (`s07a001b.voc` pour S07, S08 et S04) joué à chaque changement par une touche, jamais à l'entrée ni via `select`. La scène appelle `await menu.load(ctx)` dans `load`, `menu.enter(ctx)` dans `enter` (et `resume`), `menu.update(ctx)` dans `update` (renvoie `{ kind: "validate" | "help", index } | null`), `menu.render(ctx)` dans `render`, `menu.exit(ctx)` dans `exit`. Espace / clic gauche = `validate` sur l'élément courant ; Entrée / clic droit = voix de l'élément (jouée par le menu) puis `help`. Surbrillance : `paletteHighlight(premièreEntrée, [r, g, b])` (S07) ou `spriteHighlight(sprites, place)` ; toute autre stratégie est un `MenuHighlight` (`select`, `deselect`, `render`).

### `scenes/flow.ts` : les points d'entrée fixes

Seul endroit qui décide « l'écran suivant » ; un écran ne reçoit que ses paramètres et un rappel `onDone`, et n'enchaîne rien lui-même. Toutes les fonctions remplacent la scène courante avec fondu (pas de second fondu si l'écran est déjà noir) :

| Fonction | Effet |
|---|---|
| `goMainMenu(ctx)` | S07 |
| `goRules(ctx)`, `goIntro(ctx)` | vidéo `s10a.mux` / `s06a.mux` puis S07 |
| `goFreeMap(ctx)` | mode libre (`createFreeModeScene`, `s02-map.ts`, souche) puis S07 |
| `goPlayers(ctx)` | S09 → `goCharacters(ctx, n)` |
| `goCharacters(ctx, players)` | S08 → `play` : `startGame` ; `back` : S09 ; `menu` : S07 |
| `goParents(ctx)` | S04 puis S07 |
| `askConfirmation(ctx, n, onAnswer, mode?)` | S49 numéro `n` ; `mode` `"replace"` (défaut) ou `"push"` (au-dessus d'un écran à reprendre : `onAnswer` appelle `ctx.scenes.pop`) |
| `startGame(ctx, setup: GameSetup)` | partie (`scenes/game.ts`) puis S07 |
| `quitGame(ctx)` | S49 n = 10 ; Non : S07 ; Oui : générique S52 puis `host.exit()` |

Les écrans de partie (pause S48, abandon S46, aide S45) sont **empilés** par le plateau : `ctx.scenes.push(createPauseScene(cb), { fade: true })` ; le rappel décide (`ctx.scenes.pop(...)` pour reprendre).

### Contrat des écrans

Chaque écran garde la **signature** de sa fabrique exportée (documentée en tête de fichier : paramètres, résultat, références `engine.md`). La partie et le plateau sont faits (E2a) ; les quatre souches (carte S02 et mode libre, événements S13 à S21, Grand Schtroumpf, mini-jeux) ont leur contrat dans « Partie et plateau ».

| Fichier | Fabrique | Reçoit | Rend (`onDone`) |
|---|---|---|---|
| `s09-players.ts` | `createPlayersScene(onDone)` | rien | `(ctx, players: 1..4)` |
| `s08-characters.ts` | `createCharactersScene(players, onDone)` | nombre de joueurs | `(ctx, CharactersResult)` : `play` + `PlayerSetup[]`, `back` (S09) ou `menu` (S07) |
| `s04-parents.ts` | `createParentsScene(onDone)` | rien (lit / sauve `ctx.options`) | `(ctx)` |
| `s49-confirm.ts` | `createConfirmScene(n, onDone)` | numéro du message 0..11 | `(ctx, yes: boolean)` ; gauche / droite choisissent, Espace valide, Échap sans effet |
| `s48-pause.ts` | `createPauseScene(onDone)` | rien (empilée) | `(ctx, PauseChoice)` : `resume`, `abandon`, `map`, `help` |
| `s46-abandon.ts` | `createAbandonScene(players: number \| readonly number[], onDone)` | nombre de joueurs (0..n−1) ou personnages (0..5) des joueurs restants, 1 à 4 (empilée) | `(ctx, AbandonResult)` : `cancel`, `player` + index (dans le tableau reçu), `all` |
| `s45-help.ts` | `createHelpScene(game, onDone)` | `Game` (empilée) | `(ctx)` |
| `s52-credits.ts` | `createCreditsScene(onDone)` | rien | `(ctx)` en fin de défilement (texte `s52dsphi.doc`) |
| `game.ts` | `createGameScene(setup, onDone)` | `GameSetup` (joueurs, options parents) | `(ctx)` en fin de partie (victoire, temps écoulé, abandon général) |
| `s02-map.ts` | `createMapScene(request, onDone)`, `createFreeModeScene(onDone)` | `MapRequest` / rien | `(ctx, k)` (`k` = 1 retour, 2..18 lieu) / `(ctx)` (mode libre) |

S46 : après un `player`, l'original compacte les joueurs puis **réaffiche S46** avec ceux qui restent ; ce réaffichage (recréer `createAbandonScene` avec les personnages restants) est à la charge de l'appelant, qui doit aussi mettre fin à la partie s'il n'en reste plus.

### Menu S07 (`scenes/s07-menu.ts`)

`createMenuScene()`. Fond `s07a001d.mcg`, musique `s52m00Nm.voc` tirée une fois (si la voie n'a pas déjà une musique : un retour d'écran ne la retire pas), surbrillance des entrées 120+i en `10 A4 CC`, bip de navigation `s07a001b.voc` à chaque changement de bouton (pas à l'entrée), voix d'aide `s07v00Nt.voc` (N = 4, 5, 7, 2, 8, 6) à Entrée / clic droit. Parents : uniquement la touche droite maintenue 4 s sur le bouton (valider ne fait rien). Jouer sous verrou parental ne fait rien (aucun message dans l'original).

## Partie et plateau (E2a)

Détail RE et écarts : `screens-game.md`. Logique : `game/` (`rules.md`).

### Architecture

- `scenes/game.ts` (`GameScene`, `step = 4`) est la scène de partie `28a3:00ad`. Elle tient un script (générateur) qui présente dans l'ordre les `GameEvent` de `game/` (file `queue`) puis laisse jouer un tour. Les écrans (pause, aide, abandon, mini-jeux, événements, vidéos) sont **empilés** au-dessus ; leur rappel appelle `ctx.scenes.pop()` ; `resume()` redessine le plateau et le script reprend.
- `scenes/s01-board.ts` (`Board`) : rendu et marche d'un tour (fond, bandeau, décor, pion, minuteur). `Board.step` lit les touches et appelle `Game.walk / jump / press` ; il rend les événements produits, ou une demande `pause` / `help`. Modules : `board/walker.ts` (poses, pur), `board/ambient.ts` (décor), `board/hud.ts`, `board/voices.ts` (choix des voix, `VoiceLine` chargée en tâche de fond), `board/clock.ts` (secondes entières → `Game.tick`).
- Le chrono du tour est gelé (pause, voix, annonce) ; celui de la partie court aussi pendant mini-jeux et vidéos.
- Fin de partie : vidéo S11 ou S42, `lastGameMinutes` enregistré, musique coupée, `onDone` (→ menu S07).

### Contrats des écrans empilés

Chaque fichier documente son contrat en tête (détail RE : `screens-map.md`, `screens-events.md`, `screens-grand-schtroumpf.md`). `game.ts` empile ces scènes et les retire (`pop`) dans leur rappel. Seul `minigames.ts` reste une souche, jusqu'au lot E3.

| Module | Fabrique | Reçoit | Rend |
|---|---|---|---|
| `s02-map.ts` (`map/`) | `createMapScene({ mode: "consult" \| "free" \| "wish", zone? }, onDone)` ; `createFreeModeScene(onDone)` | mode ; `zone` (1..54) du pion en consultation (fond `s02a002d`, haut / bas font défiler) ; `free` et `wish` : haut / bas changent de lieu, Espace valide (`wish` : fond `s02a007d`, 36 s sans choix = retour) | `onDone(ctx, k)` : `k` = 1 retour (toujours en consultation), 2..18 lieu de `MAP_LOCATIONS`. Le mode libre (fond `s02a001d`, Entrée joue l'aide du lieu) enchaîne tout seul voix d'accroche, mini-jeu (`createMinigame`, issue ignorée) et retour à la carte ; `onDone(ctx)` seulement sur « retour » |
| `events.ts` (`events/`) | `createBoardEventScene({ game, event, before, after }, onDone)` ; `createWellScene(game, onDone)` ; `approachX(event, before, after)` | événement `hazard` ou `release` (état de `game/` déjà à jour), position au déclenchement et à l'arrivée ; puits S13 : `game.state.pending` (scène 14, `wellMode` `"travel"` ou `"ingredient"`) | `onDone(ctx)` après la vidéo (non passable) et sa voix ; puits : `onDone(ctx, MinigameOutcome)` `well` (`ingredient` ou `destination`, `null` si rien choisi). `approachX` donne le `x` où le pion s'arrête avant la vidéo, `null` sans marche (fusée, libérations) |
| `grand-schtroumpf.ts` (`grand-schtroumpf/`) | `createGrandSchtroumpfScene(request, onDone)` ; `Commentary`, `isCommentVideo`, `s42VideoFile` | `kind` : `ingredients` (S19, avec `game`), `timeWarning` / `timeout` (`video`), `victory` (`winner`), `progress` (`code` 201..204, 211..215, `26ee:0f17`), `comment` (`code` de `26ee:027e` : voix `s42v`, vidéo si `isCommentVideo`) | `onDone(ctx)` à la fin de la voix ou de la dernière vidéo ; les codes `progress` / `comment` viennent de `Commentary` (mémoire des répliques propre à la partie) |
| `minigames.ts` (souche, E3) | `createMinigame(id, game, onDone(ctx, outcome))` ; `createMinigameAftermath(…)` | `game.state.pending` ; issue appliquée par l'appelant (`Game.resolveMinigame`) | `MinigameOutcome` ; souche : Espace réussi, Entrée échoué |

Dans `game.ts`, `hazard()` fait marcher le pion de sa position de déclenchement jusqu'à `approachX` (`Board.walkToward`, même animation que la marche du joueur) avant d'empiler l'événement sans fondu ; le puits S13 est empilé sans fondu (il fond lui-même après la voix d'accroche), les autres mini-jeux avec.

Brancher un mini-jeu : `scenes/minigames/sNN-nom.ts` puis une entrée dans `FACTORIES` de `minigames.ts`. `Game.openMinigame(scène)` / `abortMinigame()` ouvrent un mini-jeu hors plateau (mode libre, tests).

### Tests

`test/teleportaschtroumpf/game-helpers.ts` : `Session` (moteur de test + partie) et `advance`, qui laisse passer les promesses entre deux images (les voix se chargent en tâche de fond ; `runFor` ne le fait pas).
