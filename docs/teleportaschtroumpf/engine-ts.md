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
| `audio/backend.ts`, `audio/voice.ts`, `audio/web-audio.ts` | `AudioBackend` abstrait, `VoiceChannel` (voie + musique + bips + canal de bruitages), implémentation Web Audio (deux sources sur le même `GainNode`, somme écrêtée à la sortie). |
| `scenes/boot.ts` | Séquence de démarrage. |
| `scenes/flow.ts`, `scenes/s07-menu.ts`, `scenes/sNN-*.ts` | Flux entre écrans, menu principal S07 et les écrans (voir « Menus et flux »). |
| `game/` | Logique pure de la partie et du plateau (`Game`, tables), sans rendu (`rules.md`). |
| `scenes/game.ts`, `scenes/s01-board.ts`, `scenes/board/` | Partie (`28a3:00ad`) et plateau S01 (`291e:0401`) ; écrans empilés `s02-map.ts`, `events.ts`, `grand-schtroumpf.ts` et `minigames.ts` + `minigames/` (voir « Partie et plateau » et « Écrire un mini-jeu »). |
| `ui/app.ts`, `ui/browser-host.ts`, `ui/dev.html`, `ui/dev.ts`, `ui/style.css` | Hôte navigateur, canvas à l'échelle entière, boucle `requestAnimationFrame`, page de dev. |
| `scenes/save.ts` | Sauvegarde de la partie en cours (voir « Reprise d'une partie interrompue »). |
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

Actions (`engine/input.ts`) : `up down left right validate cancel skip pause volumeUp volumeDown`. Sources : flèches et Q/A/Z/X (haut/bas/gauche/droite, positions physiques QWERTY comme les scancodes d'origine), Espace / clic gauche = `validate`, Entrée / clic droit = `cancel` (voix d'aide) ; la position du pointeur ne désigne un élément que dans les menus à zones (`Menu`, option `areas`, ajout du port pour le doigt : S07, S08, S09, S41, S46, S48, S49), Échap = `skip`, P = `pause`, F1/F2 = volume −/+ (géré par le moteur).

- `ctx.input.pressed(a)` : tenu ; `justPressed(a)` : enfoncé depuis le dernier `update` (mémorisé, un appui plus court que le pas n'est pas perdu) ; `anyJustPressed(...)`.
- `ctx.input.mouseX/mouseY` : position 320×200, lue seulement par les scènes à pointeur libre qui dessinent leur curseur HY8 (E2). Le recentrage de l'original (`14b3:0039`) passe par `ctx.input.warpMouse(x, y)`, sans effet quand une vraie souris survole le canvas (`Input.pointerHovering`, tenu par l'hôte) : la souris DOS était relative, celle du navigateur ne se déplace pas, et le curseur dessiné sauterait loin du pointeur. Aucun écran de menu n'a de zone cliquable : clavier d'origine seul (décision `plan.md`), les boutons de la souris sont les actions `validate` (gauche) et `cancel` (droit).
- Curseur : le curseur système est masqué en permanence sur le canvas (`cursor: none` dans `style.css`) ; ni `Host.setCursor` ni `Scene.ownCursor` n'existent plus.

## Son

Deux canaux, qui passent par le même volume (`ctx.voice`, `audio/voice.ts`) : la **voie** (`15f9:089f` : voix, musique, vidéo ; un son en coupe un autre) et le **bruitage mélangé** (`348d:0b42(2, ptr)`, `engine.md` §5.2 bis : un seul emplacement, additionné à la voie sans la couper, volume commun). Les sons de S23, S26, S30, S36 et S40 restent sur la voie. La liste exacte des sons du canal de bruitages est le tableau de recensement de `engine.md` §5.2 bis.


- `voice.play(voc)` (voix ; `voc` = résultat de `ctx.resources.voc("s07v004t.voc")`) coupe ce qui jouait sur la voie, musique comprise ; `voice.playEffect(voc)` : bruitage mélangé, **remplace le bruitage précédent** sans couper ni la voix ni la musique ni la vidéo ; `voice.effectPlaying` : un bruitage sonne encore (`0b42(1, 0) != 0`, à utiliser pour « seulement si rien ne sonne » à la place de `voicePlaying`) ; `voice.stopEffect()` (`voice.stop()` ne coupe que la voie) ; `voice.playBeep(0..2)` joue un des 3 bips préchargés (`s52d001b`, `s01a002b`, `s01a001b`) sur la même voie ; `voice.stop()`.
- `voice.setMusic(voc | null)` : musique de fond (`musicName(1 + ctx.rng.below(3))` → `s52m00Nm.voc`). Elle repart **au début, en boucle**, dès que la voie est libre (vérifié à chaque tick) : pas de reprise à la position où la voix l'a coupée. `voice.holdMusic(true)` la retient (vidéos).
- `voiceName("s07v", 4)` → `s07v004t.voc`. `voice.volume` 0–15 (défaut 15).
- `voice.voicePlaying` : vrai tant qu'une voix sort (pour attendre la fin d'une voix avant d'enchaîner, comme `1f33:03a7`).
- Navigateur : le contexte audio ne démarre qu'au premier geste (`WebAudioBackend.unlock()` sur `pointerdown` / `keydown`). Avant, `play` et `playEffect` ne font rien et `playing` et `effectPlaying` restent faux : le moteur n'attend donc jamais un son qui ne sortira pas (les vidéos retombent sur l'horloge).
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

### UI navigateur (`ui/app.ts`, `ui/prefs.ts`, `ui/browser-host.ts`)

- **Bouton « Son »** sous l'écran (classe partagée `toggle`, `aria-pressed`) : coupe et rétablit toute la sortie (voie, musique, vidéos, bruitages) via `AudioBackend.setMuted`, qui met le gain général Web Audio à 0 sans arrêter les sons (`playing`, `effectPlaying`, `position` inchangés : moteur et vidéos restent synchronisés). **Indépendant** du volume 0 à 15 (F1/F2, `setGain`). Préférence `SoundPrefs` (`ui/prefs.ts`, clé `retrovibe:teleportaschtroumpf:sound`, localStorage protégé), relue sur l'événement `storage` (autre onglet). Un clic débloque l'audio et rend le focus au canvas.
- **Onglet masqué** : `Engine.setPaused(true)` : `frame` ne fait plus rien, `AudioBackend.suspend()` fige le contexte (`currentTime`, donc `position`) ; au retour, `setPaused(false)` relance le contexte et `Clock.resync()` oublie l'absence (pas de rattrapage) : le jeu repart au même point. Rien à voir avec la touche « pause » du jeu.
- **Clavier / focus** : le canvas bloque le comportement du navigateur pour toute touche du jeu (F1, F2, Espace, Entrée, flèches, Échap, Q/A/Z/X, P) ; il reprend le focus au retour sur l'onglet, au focus de la fenêtre et après un clic sur « Son » ; anneau `:focus-visible` dans l'écran.
- **États** : « Chargement… » pendant le chargement ; `MissingFilesError` (`files.json` absent ou illisible, ressource 404) donne un message dédié (`copy.missingFiles`), distinct de `loadError` / `runtimeError` ; le lien de retour reste affiché.
- **Responsive** : échelle entière calculée sur la place réellement disponible (largeur du conteneur, hauteur de la fenêtre moins le pied de page), pied de page de la largeur de l'écran qui passe à la ligne ; pas de défilement horizontal à 375 px.
- Tests : `test/teleportaschtroumpf/ui-sound.test.ts`, `ui-pause.test.ts` ; `FakeAudio` simule `muted` et `suspend`/`resume`.

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

### Reprise d'une partie interrompue (adaptation web, `scenes/save.ts`)

L'original n'a pas de sauvegarde ; ici, quitter en cours de partie (onglet fermé, retour à l'accueil) permet de reprendre au même point.

- **Écriture** : au début de chaque tour (`GameScene.beginTurn`, après la mise à jour du chrono de partie, avant tout tirage du tour), jamais pendant un mini-jeu ni un événement. Un seul emplacement, clé `retrovibe:teleportaschtroumpf:game` (`HostStorage`, `remove` facultatif : sans lui, une valeur vide vaut « absente »).
- **Contenu** (`GameSave`, JSON pur, `version: 1`) : `Game.state` (joueur courant, tour, temps de partie `elapsed`, objectif, chrono du tour), état du `BorlandRandom` (`rng.current`), mémoire de `Commentary` (répliques déjà dites), `introShown` (S19 déjà dit), avertissement de temps annoncé du tour. Un tour passé (prison, siphon) n'écrit rien : la reprise revient au dernier tour jouable.
- **Reprise** : `resumeGameScene(save, onDone)` remet l'état (`Game.restore`) et la graine (`rng.seed`), puis rejoue le début du tour sauvegardé (annonce du personnage) : mêmes tirages qu'une partie non interrompue. Pas de logo, d'introduction ni de menu. Le chrono reprend à `state.elapsed` ; le temps passé hors du jeu ne compte pas (nouvelle `Clock`, `GameClock` repart de zéro).
- **Effacement** : au lancement d'une nouvelle partie (`enter`), dès que la fin de partie est connue (événement `over` : victoire, temps écoulé, abandon complet), et à `finish`.
- **Lecture** : `readSave` vérifie la version et la forme ; une sauvegarde illisible, d'une autre version ou incohérente est ignorée et effacée. Changer le format impose d'incrémenter `SAVE_VERSION`.
- **Écran de présentation** (`ui/title.ts`, `index.ts`) : avec une sauvegarde valide, « Reprendre la partie » est le bouton principal (focus) et « Jouer » passe en secondaire ; `mountApp(…, { resume: true })` démarre alors directement sur `resumeGameScene`.
- Tests : `test/teleportaschtroumpf/save-format.test.ts` (aller-retour JSON, validation), `save-scene.test.ts` (écriture, reprise, effacement).

### Contrats des écrans empilés

Chaque fichier documente son contrat en tête (détail RE : `screens-map.md`, `screens-events.md`, `screens-grand-schtroumpf.md`). `game.ts` empile ces scènes et les retire (`pop`) dans leur rappel. Les mini-jeux (`minigames.ts`) sont écrits (lot E3) : les 20 le sont, aucun n'est une souche.

| Module | Fabrique | Reçoit | Rend |
|---|---|---|---|
| `s02-map.ts` (`map/`) | `createMapScene({ mode: "consult" \| "free" \| "wish", zone? }, onDone)` ; `createFreeModeScene(onDone)` | mode ; `zone` (1..54) du pion en consultation (fond `s02a002d`, haut / bas font défiler) ; `free` et `wish` : haut / bas changent de lieu, Espace valide (`wish` : fond `s02a007d`, 36 s sans choix = retour) | `onDone(ctx, k)` : `k` = 1 retour (toujours en consultation), 2..18 lieu de `MAP_LOCATIONS`. Le mode libre (fond `s02a001d`, Entrée joue l'aide du lieu) enchaîne tout seul voix d'accroche, mini-jeu (`createMinigame`, issue ignorée) et retour à la carte ; `onDone(ctx)` seulement sur « retour » |
| `events.ts` (`events/`) | `createBoardEventScene({ game, event, before, after }, onDone)` ; `createWellScene(game, onDone)` ; `approachX(event, before, after)` | événement `hazard` ou `release` (état de `game/` déjà à jour), position au déclenchement et à l'arrivée ; puits S13 : `game.state.pending` (scène 14, `wellMode` `"travel"` ou `"ingredient"`) | `onDone(ctx)` après la vidéo (non passable) et sa voix ; puits : `onDone(ctx, MinigameOutcome)` `well` (`ingredient` ou `destination`, `null` si rien choisi). `approachX` donne le `x` où le pion s'arrête avant la vidéo, `null` sans marche (fusée, libérations) |
| `grand-schtroumpf.ts` (`grand-schtroumpf/`) | `createGrandSchtroumpfScene(request, onDone)` ; `Commentary`, `isCommentVideo`, `s42VideoFile` | `kind` : `ingredients` (S19, avec `game`), `timeWarning` / `timeout` (`video`), `victory` (`winner`), `progress` (`code` 201..204, 211..215, `26ee:0f17`), `comment` (`code` de `26ee:027e` : voix `s42v`, vidéo si `isCommentVideo`) | `onDone(ctx)` à la fin de la voix ou de la dernière vidéo ; les codes `progress` / `comment` viennent de `Commentary` (mémoire des répliques propre à la partie) |
| `minigames.ts` + `minigames/` (E3) | `createMinigame(id, game, onDone(ctx, outcome))` ; `createMinigameAftermath(…)` | `game.state.pending` ; issue appliquée par l'appelant (`Game.resolveMinigame`) | `MinigameOutcome` ; un fichier par mini-jeu (`minigames/sNN-nom.ts`), les 20 écrits ; la souche commune (Espace réussi, Entrée échoué) n'existe plus que pour les tests, via `forceMinigameStubs()` |

Dans `game.ts`, `hazard()` fait marcher le pion de sa position de déclenchement jusqu'à `approachX` (`Board.walkToward`, même animation que la marche du joueur) avant d'empiler l'événement sans fondu ; le puits S13 est empilé sans fondu (il fond lui-même après la voix d'accroche), les autres mini-jeux avec.

Brancher un mini-jeu : il l'est déjà (un fichier par scène, inscrit dans `FACTORIES` de `minigames.ts`) ; voir « Écrire un mini-jeu ». `Game.openMinigame(scène)` / `abortMinigame()` ouvrent un mini-jeu hors plateau (mode libre, tests).

### Tests

`test/teleportaschtroumpf/game-helpers.ts` : `Session` (moteur de test + partie) et `advance`, qui laisse passer les promesses entre deux images (les voix se chargent en tâche de fond ; `runFor` ne le fait pas).

## Écrire un mini-jeu

Recette pour les agents qui écrivent un mini-jeu en parallèle des autres. Exemples complets : `scenes/minigames/s32-gargamel.ts` (le plus court : un tirage et une vidéo) et `s27-sled.ts` (une vidéo pilotée au clavier avec dessin par-dessus et animation de chute), avec leurs documents `docs/teleportaschtroumpf/minigames/s32.md` et `s27.md` (modèle du document de RE : déroulé, ressources, commandes, règles par niveau, issue, écarts, confiance).

### Ce qui est à toi, ce qui ne l'est pas

- À toi : **ton fichier** `scenes/minigames/sNN-nom.ts` (déjà inscrit dans `minigames.ts` : tu remplaces le corps de la souche et gardes l'export de la fabrique), `test/teleportaschtroumpf/minigames/sNN-nom.test.ts` (à créer), `docs/teleportaschtroumpf/minigames/sNN.md` (à créer), et d'éventuels fichiers à toi dans un sous-dossier `scenes/minigames/sNN/` ou `sNN-*.ts`. S38 et S39 gardent aussi leur `createXxxAftermath` (présentation de l'issue, inscrite dans `AFTERMATHS`).
- Pas à toi, jamais en parallèle : `minigames.ts`, `minigames/common.ts`, `engine/**`, `game/**`, `registry.ts`, les autres mini-jeux et leurs tests. Si un outil manque dans `common.ts`, écris-le dans ton fichier et signale-le (le lot suivant le rangera en commun) ; avant d'écrire un chrono, un calcul de points ou un rectangle, vérifie la liste ci-dessous. Si `game/` est faux (règle prouvée par la RE), signale-le sans le corriger.
- Le rapport de chaque mini-jeu dit : ce qui est reproduit, les écarts, ce qui n'a pas pu être vérifié.

### Lire d'abord

1. L'en-tête de ton fichier (contrat, fonction d'entrée et ressources `re-index.md`), `rules.md` §5 (gain, bonus de l'oiseau de ta scène), `game/tables.ts` (`MINIGAMES`).
2. `s27.md` et `s32.md` : ce que la RE d'un mini-jeu doit documenter.
3. `scenes/minigames/common.ts` et `s27-sled.ts` pour le style (scène à états, `step = 1` quand une vidéo ou un pointeur est en jeu).
4. `engine.md` §2 (temps), §3 (rendu, curseur), §4 (entrées), §5 (son) ; `hy8.md`, `mux.md`.

### Le contrat

`export const createXxx: MinigameFactory = (game, onDone) => scene`. La requête est `minigameRequest(game, NN)` (joueur, personnage, `level` 0..2, `bonus`, `successChance` pour S32). **Ne jamais** appeler `game.resolveMinigame` : rends `onDone(ctx, outcome)` une seule fois, à la fin (le plateau retire la scène avec fondu dans ce rappel). Le type de l'issue est fixé par la scène (`ingredient`, `points` : entier ≥ 0, 1 à 3 pour la plupart, 0 à 11 pour S51 (un point par cadeau ouvert) ; `Game` plafonne le total à 60, `magician`, `none`) ; l'appelant applique les gains (`Game.resolveMinigame` ne donne l'ingrédient qu'une fois). Voix d'accroche `sNNa` : jouée avant ta scène par l'appelant ; ne la rejoue pas. Fondu d'entrée : fait par le plateau (`push` avec fondu) ; fondu de sortie : `pop({ fade: true })` dans `onDone` ; un fondu interne (S27 avant la vidéo d'échec) se fait avec `ctx.fade.out()` puis l'attente de `!ctx.fade.active`.

### Outils de `common.ts`

| Outil | Rôle |
|---|---|
| `minigameRequest(game, scene)` | la requête ouverte (erreur claire sinon) |
| `minigameLevel(request, bonusLevel)` | niveau du joueur, ou `bonusLevel` (la valeur de l'original) avec l'indice de l'oiseau ; `Game` a déjà consommé l'indice |
| `ingredientOutcome(ok)`, `pointsOutcome(n)`, `sceneIngredient(scene)`, `ingredientInGoal(game, ing)` | issue (`pointsOutcome` : 0 ou plus, pas de borne à 3 ; le plafond de 60 est appliqué par `Game`), ingrédient de la scène, prédicat « dans l'objectif » (sans sens de vidéo implicite) |
| `goalClip(game, ing, { inGoal, notInGoal })` | vidéo de réussite des mini-jeux à ingrédient : les deux fichiers sont nommés explicitement car le sens **n'est pas universel** (`c2` dans l'objectif pour S27, S28, S31, S32 (`cd2`), S34, S36 ; `c1` pour S22 et S33). Test : `minigames/ingredient-clips.test.ts` |
| `SoundHush` | fondu sonore de fin `1343:0037` : `start(ctx[, volume])`, `update(ctx)` à chaque tick (vrai quand le son est coupé et le volume rendu), `restore(ctx)` dans `exit` ; la musique (`holdMusic`) reste à la scène |
| `drawFrame(surface, x1, y1, x2, y2, couleur)` | cadre d'un pixel `32af:0006` (cadres de survol), rogné à l'écran |
| `FRAME_SHADOW`, `FRAME_LINE` | couleurs (`0x7e`, `0x7f`) du double cadre de survol et de sélection (S24, S25, S26) |
| `copyRect(source, work, sx, sy, dx, dy, w, h)`, `fillRect(work, x1, y1, x2, y2, couleur)` | copie opaque et remplissage de rectangle (`13fc:0427`, `328a:0022`), rognés à l'écran ; travaillent sur un `Uint8Array` 320 × 200 |
| `levelTimeLimit(base, pas, niveau)` | temps imparti `base − pas × niveau` (S24, S25, S29, S40) ; la formule à bonus de S26 reste chez lui |
| `pointsForTime(secondes, limite)` | 3 sous le tiers du temps, 2 sous les deux tiers, sinon 1, divisions entières (S24, S25, S26) ; S29 a des seuils fixes (10 s, 20 s) et les garde |
| `isObjectHit(rect, marge, x, y)`, `OBJECT_ORIGIN_X/Y`, `ObjectRect` | zone d'un objet caché décalée de (32, 40), élargie de `marge`, bord droit et bas exclus (S25 sans marge, S26 avec) ; le `isHit` de S28 (zones par cible) reste chez lui |
| `Clip` | une vidéo MUX dans ta scène : `load`, `start`, `update`, `render`, `stop` ; options `skippable`, `onFrame(ctx, image, marqueurs)` (rappel par image décodée, `"stop"` interrompt), `overlay(ctx)` (sprites par-dessus) ; la dernière image reste affichée après la fin |
| `Pointer` | curseur HY8 des scènes à pointeur libre : sprite à la position de la souris, flèches = 2 px par tick, bornes de la scène |
| `createStubMinigame`, `MinigameStub`, `STUB_POINTS` | la souche, outil des tests de parcours (jamais dans un vrai mini-jeu) |

Pas dans `common.ts`, faute de preuve : minuteries d'inactivité et indices vocaux, voix de résultat (aucun dans S32 ni S27 ; les scènes à pointeur libre ont les leurs, `well.ts` en est un exemple : 16 s puis 36 s). Si ta scène a les mêmes seuils que celle d'un autre, écris-les chez toi.

### Faire la RE d'un mini-jeu

1. **Fonction d'entrée** : `MINIGAMES[].entry` (`game/tables.ts`), puis `archives/teleportaschtroumpf/re/decomp/<seg>_<off>_*.c` (décompilation Ghidra), `disasm.txt` (`grep -n '^1f84:' disasm.txt`) et `strings.tsv`. Les chaînes de ressources sont dans l'en-tête du fichier `.c`. Régénérer : `bash scripts/teleportaschtroumpf/re/run.sh`.
2. **Lecture de la décompilation** : les noms `iRam0003xxxx` sont des adresses linéaires, `DS:offset = xxxx − 0x36460` (`uRam0003d397` = `DS:6F37`) ; en cdecl le **dernier** argument poussé est le premier paramètre ; `0x1000:xxxx` dans le désassemblage est un appel traduit par Ghidra vers `seg:off` (le commentaire `; -> seg:off` donne la cible). `rand × n / 0x8000 == 0` = `ctx.rng.below(n) === 0`.
3. **Code que Ghidra n'a pas vu** : les rappels passés à `179a:0673` (`PUSH seg; PUSH off` avant l'appel) et les routines proches (`1f84:02ce` pour S27) ne sont pas dans `decomp/` ; octets dans l'exécutable à `0x4200 + (seg − 0x1000) × 16 + off` (`seg` au sens Ghidra ; un `lcall off, seg` brut a `seg − 0x1000`). Désassembler avec `capstone` mode 16 bits dans un environnement jetable **hors du dépôt** (`python3 -m venv`, `pip install capstone`, `Cs(CS_ARCH_X86, CS_MODE_16).disasm(octets, off)`), en annotant les `lcall` avec `seg + 0x1000`. S27 : `1f84:02ce..0427`.
4. **Fonctions de bibliothèque courantes** : `13fc:0411` (fond B → A), `13fc:03f9` (affiche), `1f33:00fc(n)` (attend n centièmes de seconde), `1f33:03a7` (attend la fin du son), `1f33:0348(n)` (cadence en ticks, 5 pour la plupart des mini-jeux), `31fe:0481(indice, x, y, hy8)` (sprite), `12d7:0083` / `0144` / `00c1` (animation : init, choix, image suivante ; boucle finie quand le compteur `+0x16` retombe à 0), `1e52:0034` / `0053` / `00ad` / `0008` (a l'ingrédient / donne / points / dans l'objectif), `154c:0954(nom)` (vidéo passable, drapeaux `0x12D08`), `179a:0673(nom, drapeaux, rappel_image, rappel_fin)` (vidéo ; `0x400` clic et `0x800` Échap la passent, `0x80` dessin dans le tampon arrière, `0x10000` rappel à chaque image) ; `15f9:089f(son, 0x800001)` joue un son en mémoire. Voir `engine.md` §2 à §5.
5. **Marqueurs MUX** : les chunks 08 sont des nombres ASCII que l'original range en `DS:6DE4` (`atoi`) : signalent les obstacles de S27, et sans doute les événements d'autres vidéos interactives (S30, S34). `MuxDecoder.nextFrame()` les rend dans `markers` ; `VideoPlayer.seek(image, onFrame)` les passe à ton rappel.
6. **Niveaux et indice de l'oiseau** : `rules.md` §5 donne la valeur écrite par l'original ; c'est à toi de dire ce qu'elle change (S27 : le niveau 3 sélectionne `s27l` / `s27i`, ce qui n'est pas « plus facile » dans les deux cas).
7. Documente adresses et confiance (**sûr** / **probable** / **hypothèse**) dans `docs/teleportaschtroumpf/minigames/sNN.md`.

### Tester sans navigateur

`test/teleportaschtroumpf/minigames/harness.ts` :

- `launchMinigame(id, { seed, level, bonus, audio, setup, character })` : le mini-jeu seul, comme le mode libre ; rend un `LaunchedMinigame` (`.scene`, `.game`, `.host`, `.ctx`, `.outcome`, `run(ms, onFrame)`, `until(cond)`, `tap(code)`, `finish()` qui attend l'issue et le retrait de la scène, `shot(nom)`). `setup(game)` prépare la partie avant l'ouverture (objectif, ingrédients, points).
- `enterFromBoard(id, "NomDeLaClasse", options)` : une partie réelle, le pion devant la porte, Espace ; `Session` de `game-helpers.ts` (`ready()`, `settle`, `tap`, `until`). `enterFromFreeMode(id)` : la carte libre, le lieu choisi aux flèches ; `.free.stage === "map"` au retour. Un test de parcours par chemin (plateau, libre) : lancement, jeu, issue appliquée (plateau) ou retour à la carte (libre).
- Le moteur de test avance à 60 Hz simulés sans attendre le temps réel : une descente de 40 s se joue en quelques dizaines de millisecondes. `describe.skipIf(!hasOriginalFiles)` pour tout test qui lit les fichiers du jeu.
- Un **pilote** (voir `bot` dans `s27-sled.test.ts`) lit l'état de la scène (getters de test : `stage`, `position`…) et appuie sur les touches par `host.input.keyDown/keyUp` ; prévois ces getters en écrivant la scène. Sorties son coupées par défaut : les voix finissent aussitôt ; `audio: true` pour tester ce qui est joué (`host.audio.plays`).
- Tests du plateau ou de la partie qui traversent un mini-jeu sans le jouer : `forceMinigameStubs()` (outil de test de `minigames.ts` : les 20 mini-jeux sont écrits, la souche ne sert plus qu'à cela ; le test du registre vérifie qu'aucun vrai mini-jeu ne la rend) en tête du fichier de test (déjà fait pour `game-flow`, `game-end`, `game-pause`, `grand-schtroumpf`) ; ne dépends jamais de la souche d'un autre mini-jeu.
- À tester pour chaque mini-jeu : réussite, échec, effet du niveau et de l'indice de l'oiseau, graine fixe (`seed`), ce que les commandes font, issue du bon type, les deux parcours.

### Produire et regarder des captures

`TELEPORTA_SHOTS=/tmp/mes-captures npx vitest run test/teleportaschtroumpf/minigames/sNN` : chaque `run.shot("nom")` écrit `nom.png` (320×200, palette indexée de ce qu'afficherait le navigateur, fondu compris). Regarde les PNG (l'outil de lecture d'images les affiche) à plusieurs moments : début, milieu, chaque état (réussite, échec, aide, curseur), et vérifie la position des sprites, la palette (le fond MCG ou la vidéo donne la palette, les HY8 s'y accordent), les textes. `scripts/teleportaschtroumpf/proto/png.py` fait la même chose depuis Python. Supprime les captures quand tu as fini ; elles ne vont pas dans le dépôt.

### Pièges rencontrés (S27, S32)

- **Une vidéo se passe ou non selon la fonction qui la lance** : `154c:0954` (drapeaux `0x12D08`) la rend passable, `179a:0673` appelée directement avec `0x80` ou `0x12088` ne l'est pas. `Clip` : `skippable` (défaut vrai).
- **`VideoScene` demande `step = 1`** : la scène qui la pilote doit être de pas 1 (pas de 5 ticks par défaut), sinon l'image et le son se désynchronisent et les rappels par image arrivent par rafales.
- **Rappel par image = une fois par image décodée**, y compris l'image 0 : toute logique de jeu liée à la vidéo (déplacements, collisions) se compte en images (11 par seconde), pas en ticks.
- **`render` et fondus** : `VideoScene.render` recharge la palette de la vidéo à chaque rendu ; la scène du dessous n'est pas redessinée pendant une scène empilée. Une scène qui garde l'image de la vidéo comme fond (chute de S27) appelle `ctx.surface.commitBackground()` à la fin de la vidéo puis `restoreBackground()` avant chaque dessin.
- **Boucles bloquantes de l'original** (`while (…) { 13fc:0411; …; 1f33:00fc(n); 13fc:03f9 }`) deviennent des phases avec compteur de ticks (`n` centièmes = `n × 0,6` ticks) ; jamais de `await` dans `update`.
- **Les ressources sont chargées dans `load`**, toutes (y compris les vidéos de fin, choisies d'après l'objectif de la partie), car `update` ne peut pas attendre.
- **Un mini-jeu rend son issue une fois** : garde un drapeau `done` (une vidéo sautée à la dernière image peut appeler deux fois la fin).
- **Tirage au sort** : `ctx.rng.below(n)` consomme un nombre par appel comme `rand()` ; garde le même nombre d'appels que l'original (S27 tire `rand × 2` même au niveau où les deux vidéos sont identiques), sans quoi les graines fixes des tests changent de sens.
- **Tests de parcours** : un `Session` avance par `advance` (une promesse cédée entre deux images) ; `enterFromBoard` / `enterFromFreeMode` attendent déjà la scène voulue (`settle` par nom de classe : nomme la classe de ta scène).
- **`Pointer`** et flèches : le pas du curseur au clavier est `1 << DS:3FD0` pixels par tick (`3134:03c8`), porté par `Input.keyPointerShift` et appliqué par `Input.moveMouseByKeys()`. `Pointer.update` pose le décalage à 1 (2 px), comme les six mini-jeux à pointeur libre (S24, 25, 26, 35, 41, 51 écrivent `DS:3FD0 = 1`). Le puits S13 (`well.ts`) ne l'écrit pas : 4 px par tick (valeur initiale 2) tant qu'aucun de ces mini-jeux n'a été joué, puis 2 px (voir `screens-events.md`).
