import { AnimateDecoder, parseAnimate, playedFrameCount } from "../data/bin-animate";
import { SsnDecoder, parseSsn } from "../data/bin-ssn";
import { TICK_MS } from "../engine/cadence";
import type { DrasculaEngine } from "../engine/loop";
import { type Sequence, skippable, waitUntil } from "../../../engine/sequence";
import { COMPLETE_PAL, HALF_PAL, TextColor } from "../render/palette";
import { centerText } from "../render/font";
import { placeDrascula, placeIgor } from "../render/actors";

/**
 * Lecteurs de vidéos et aides d'écran des cinématiques. Réécriture de `playFLI`, `playFrameSSN`, `waitFrameSSN` (SSN), `animate` et
 * `showFrame` (animations), `clearRoom`, `updateScreen` et des affichages d'image de `loadPic` sur `screenSurface`
 * (engines/drascula/graphics.cpp, drascula.cpp, ScummVM).
 *
 * Les vidéos sont des deltas XOR contre l'écran précédent (`data/bin-ssn.ts`, `data/bin-animate.ts` font le décodage) ; ici on les
 * **joue** : chaque image est copiée dans `gfx.canvas`, l'écran « matériel » que ScummVM écrit directement, et le moteur la présente
 * (`graphics.md`, § 11). Les palettes des vidéos (6 bits) vont à l'écran sans toucher à la palette du jeu (`setPalette(buffer)`).
 *
 * Cadence (lue dans ScummVM, non mesurée sur le jeu d'origine) : en **millisecondes réelles**, sans le doublement de `delay` :
 * `playFLI(nom, vitesse)` attend `1000 / vitesse` ms (division entière) avant d'afficher chaque image et à chaque bloc « image vide », sur
 * une horloge fixe (`LastFrame += globalSpeed`) ; `animate(nom, ips)` attend `1000 / ips` ms après chaque image. Ici les deux comptent
 * sur une horloge fixe, sans dérive : ScummVM n'y ajoute pas son temps de décodage pour `animate`, qui est donc un peu plus lent.
 * L'horloge est en ticks de 10 ms : une image tombe sur le premier tick après l'échéance.
 *
 * Échap (`kActionSkip`) : chaque lecteur est sautable à lui seul et rend vrai quand il a été sauté (`term_int`) ; une cinématique qui
 * enchaîne plusieurs vidéos s'arrête alors (`if (animate(...)) break;`). Les autres touches coupent une animation (`animate` seulement,
 * pas `playFLI`). Les attentes d'une réplique ne se sautent pas (`talk.ts`).
 */

/** Millisecondes du moteur, mesurées en ticks. */
const nowMs = (g: DrasculaEngine): number => g.ticks * TICK_MS;

/** Attend jusqu'à l'échéance `target` (ms, horloge du moteur). */
function* until(g: DrasculaEngine, target: number): Sequence {
  yield* waitUntil(() => nowMs(g) >= target);
}

/**
 * Joue une vidéo SSN (`playFLI`) à `speed` tours par seconde. Un tour se passe par image affichée et par bloc « image vide » ; les blocs
 * palette n'attendent pas. Rend vrai si Échap l'a sautée.
 */
export function* playSsn(g: DrasculaEngine, name: string, speed: number): Sequence<boolean> {
  const decoder = new SsnDecoder(parseSsn(g.host.readFile(name)));
  const interval = Math.trunc(1000 / speed);
  const canvas = g.gfx.canvas;
  g.gfx.owner = "canvas";
  const skipped = yield* skippable(
    (function* (): Sequence<boolean> {
      let last = nowMs(g);
      for (let chunk = decoder.step(); chunk; chunk = decoder.step()) {
        if (chunk.kind === "palette") {
          g.gfx.palette.showExternal(chunk.palette);
        } else {
          last += interval;
          yield* until(g, last);
          if (chunk.kind === "image") canvas.load(decoder.screen);
        }
      }
      return false;
    })(),
  );
  return skipped === undefined;
}

/**
 * Joue une animation (`animate`) à `fps` images par seconde : la première image est affichée (sa palette, 6 bits, va à l'écran), puis
 * chaque image suivante, jusqu'à l'avant-dernière (la dernière n'est jamais jouée). Rend vrai si Échap l'a sautée ; une autre touche la
 * coupe sans la compter comme un saut.
 */
export function* animate(g: DrasculaEngine, name: string, fps: number): Sequence<boolean> {
  const file = parseAnimate(g.host.readFile(name));
  const decoder = new AnimateDecoder(file);
  const frames = playedFrameCount(file);
  const interval = Math.trunc(1000 / fps);
  const canvas = g.gfx.canvas;
  g.gfx.owner = "canvas";
  const skipped = yield* skippable(
    (function* (): Sequence<boolean> {
      let due = nowMs(g);
      for (let n = 0; n < frames; n++) {
        decoder.step();
        canvas.load(decoder.screen);
        if (n === 0 && decoder.palette) g.gfx.palette.showExternal(decoder.palette);
        due += interval;
        yield* until(g, due);
        if (n > 0 && g.takeKey() !== null) break;
      }
      return false;
    })(),
  );
  return skipped === undefined;
}

// --- Aides d'écran ---------------------------------------------------------------------------------------------------------

/** `clearRoom()` : l'écran est vidé et la séquence en a la main. */
export function clearScreen(g: DrasculaEngine): void {
  g.gfx.clearRoom();
}

/**
 * `loadPic(name, screenSurface, colorCount)` puis `updateScreen()` : l'image est affichée. `palette` : `"complete"` (256 couleurs),
 * `"half"` (128), ou aucune (seule la couleur 0, défaut de `loadPic`).
 */
export function showPicture(g: DrasculaEngine, name: string | number, palette?: "complete" | "half"): void {
  const gfx = g.gfx;
  gfx.loadPic(name, gfx.canvas, palette === "complete" ? COMPLETE_PAL : palette === "half" ? HALF_PAL : 1);
  gfx.owner = "canvas";
}

/** Affiche une surface telle quelle (`updateScreen(0, 0, 0, 0, 320, 200, surface)`). */
export function showSurface(g: DrasculaEngine, surface: { pixels: Uint8Array }): void {
  g.gfx.canvas.load(surface.pixels);
  g.gfx.owner = "canvas";
}

/** Le décor `bg` avec Igor et Drascula à leur place : `copyBackground(); placeIgor(); placeDrascula(); updateScreen();`. */
export function showScene(g: DrasculaEngine): void {
  const gfx = g.gfx;
  gfx.canvas.copyBackground(gfx.bg, 0, 0, 0, 0, 320, 200);
  placeIgor(gfx, g.state, gfx.canvas);
  placeDrascula(gfx, g.state, gfx.canvas);
  gfx.owner = "canvas";
}

/** `color_abc(color); centerText(text, x, y);` sur l'écran : un texte qui reste jusqu'à ce que l'image soit remplacée. */
export function printOnScreen(g: DrasculaEngine, text: string, x: number, y: number, color: number = TextColor.White): void {
  const gfx = g.gfx;
  gfx.palette.setTextColor(color);
  centerText(gfx.font, gfx.canvas, gfx.table, text, x, y);
}
