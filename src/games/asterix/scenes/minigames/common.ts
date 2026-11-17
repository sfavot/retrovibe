import type { Sound } from "../../../../engine/infogrames/audio/sound";
import type { Hy8 } from "../../../../engine/infogrames/data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../../engine/infogrames/data/mcg";
import { AnimationPlayer } from "../../../../engine/infogrames/sprites";
import { VideoPlayer } from "../../../../engine/infogrames/video";
import { ARROW_HEIGHT, ARROW_WIDTH, LIBRARY_CURSOR_SIZE } from "../../data/exe";
import type { Runtime, Script, Zone } from "../runtime";

/**
 * Outils communs aux mini-jeux d'Astérix (`scenes/minigames/mNN.ts`) : uniquement des primitives de la bibliothèque du
 * jeu que plusieurs segments de mini-jeux appellent, et le repère des robots. Ce qui ne sert qu'à un mini-jeu reste dans
 * son fichier. Gabarit de portage : `docs/asterix/minigames/README.md`.
 *
 * - `Anim` : objet animation du séquenceur HY8 (`1345:0082`, `1345:0007`, `1345:00c0`), avec son rang, sa marque et
 *   son déplacement cumulé ;
 * - `restoreRects` : restauration de rectangles du fond (`1481:07c3`) ;
 * - `flushInput` : entrées vidées et pointeur recentré avant de jouer (`153c:0004`) ;
 * - pointeur libre : `pointerAt`, `movePointer`, `centrePointer`, `pointerClick`, et les curseurs logiciels
 *   `arrowCursor` (`153c:05b4`) et `libraryCursor` (`18a1`) ;
 * - `waitReading` : attente qui retient un clic ;
 * - `openMuk`, `playMuk` : lecteur MUK (`19b9:000c`, `19b9:019f`) ;
 * - `touchDirs` et les quatre moitiés d'écran : direction donnée par un clic ou un toucher (décision D11) ;
 * - `EffectLoop` : bruitage en boucle du canal mélangé (`16cb:0a4f`, option `0x200000`) ;
 * - `fadeSoundOut` : fondu sonore de fin (`13e5:0039`) ;
 * - `beginPlay`, `endPlay` : repère de la phase jouable, lu par les robots et les tests ;
 * - `waitFrame` : attente de fin d'image (`1831:030a`).
 */

// --- Animations HY8 (segment `1345`) --------------------------------------------------------------

/**
 * Objet animation de l'original (36 octets : planche en `+0`, nombre d'images en `+0x14`, rang en `+0x16`, sprite
 * courant en `+0x18`, marque en `+0x1a`, déplacement cumulé en `+0x1c` et `+0x1e`). `step` pose le sprite de l'image
 * courante **puis** avance : le sprite affiché après le pas `k` est l'image `k − 1`, et `wrapped` (`+0x16 == 0`) est
 * vrai juste après le pas qui a montré la dernière image.
 */
export class Anim {
  private player: AnimationPlayer;
  /** `+0x18` : numéro du sprite à dessiner (`2bdb:0477(sprite, x, y, planche)`), bit de miroir compris. */
  sprite = 0;
  /** `+0x1a` : second mot de l'image posée par le dernier pas (2 sur l'image qui déclenche un bruitage, M31). */
  tag = 0;
  /** `+0x1c`, `+0x1e` : déplacement cumulé des images posées, remis à zéro quand l'animation boucle ou change. */
  dx = 0;
  dy = 0;

  /** `1345:0082(objet, planche)` : rattache la planche et choisit l'animation 0. */
  constructor(public sheet: Hy8) {
    this.player = new AnimationPlayer(sheet, 0);
  }

  /** `1345:0082` sur un objet déjà en service : nouvelle planche, animation 0. */
  init(sheet: Hy8): void {
    this.sheet = sheet;
    this.select(0);
  }

  /** `1345:0007(objet, n)` (alias `1345:0143`) : animation `n` de la planche, depuis sa première image. */
  select(animation: number): void {
    this.player = new AnimationPlayer(this.sheet, animation);
    this.dx = this.dy = 0;
  }

  /** `1345:00c0(objet)` : un pas. */
  step(): void {
    const frame = this.player.frame;
    if (frame) {
      this.sprite = frame.sprite | (frame.flags & 0x8000);
      this.tag = frame.duration;
      this.dx += frame.dx;
      this.dy += frame.dy;
    }
    this.player.advance();
    if (this.player.frameIndex === 0) this.dx = this.dy = 0;
  }

  /** `+0x16` : rang de la prochaine image ; 0 quand l'animation vient de boucler (ou n'a pas encore fait de pas). */
  get rank(): number {
    return this.player.frameIndex;
  }

  /** `+0x16 == 0`. */
  get wrapped(): boolean {
    return this.rank === 0;
  }

  /** Dessine le sprite courant, ancré comme tous les sprites HY8 (x = bord gauche, y = ligne du bas). */
  draw(rt: Runtime, x: number, y: number): void {
    rt.sprite(this.sheet, this.sprite, x, y);
  }
}

// --- Rendu ----------------------------------------------------------------------------------------

/** Rectangle `[x1, y1, x2, y2]` en pixels d'écran, tel que le code d'origine le passe (peut déborder de l'écran). */
export type Rect = readonly [number, number, number, number];

/** Mot signé de 16 bits. */
const i16 = (value: number): number => (value << 16) >> 16;

/**
 * `1481:07c3(n, x1, y1, x2, y2, …)` : recopie `n` rectangles du fond (B) dans le tampon de travail (A). Reproduit ses
 * arrondis : coin haut gauche ramené à 0, largeur portée au multiple de 4 supérieur, puis `1481:06b4` copie jusqu'au
 * coin opposé **compris** (une colonne et une ligne de plus), borné à 319 × 199. Un rectangle vide ou hors champ arrête
 * tout (les suivants ne sont pas restaurés).
 */
export function restoreRects(rt: Runtime, ...rects: Rect[]): void {
  const { background } = rt.ctx.surface;
  for (const [left, top, x2, y2] of rects) {
    const x1 = Math.max(0, left);
    const y1 = Math.max(0, top);
    if (x1 >= 0x180 || y1 >= 0x118) return;
    let width = i16((x2 - x1 + 1) & 0xfffc) + 4;
    let height = y2 - y1 + 1;
    if (width < 1 || height < 1) return;
    if (x1 + width > 0x17f) width = ((0x180 - x1) & 0xfffc) + 4;
    if (y1 + height > 0x117) height = 0x118 - y1;
    const sx = Math.min(SCREEN_WIDTH - 1, x1);
    const sy = Math.min(SCREEN_HEIGHT - 1, y1);
    const ex = Math.min(SCREEN_WIDTH - 1, x1 + width);
    const ey = Math.min(SCREEN_HEIGHT - 1, y1 + height);
    rt.copyRect(background, sx, sy, sx, sy, ex - sx + 1, ey - sy + 1);
  }
}

// --- Entrées --------------------------------------------------------------------------------------

/** `153c:0004` : attend 3 cs, oublie les directions déjà enfoncées, attend 3 cs, puis recentre le pointeur (`153c:0030`). */
export function* flushInput(rt: Runtime): Script {
  yield* rt.wait(3);
  rt.dirs();
  yield* rt.wait(3);
  centrePointer(rt);
}

/** Position du pointeur libre (`DS:4b67`, `DS:4b65`) : la souris, le doigt, ou le point mené aux flèches. */
export function pointerAt(rt: Runtime): { x: number; y: number } {
  const { input } = rt.ctx;
  return { x: input.mouseX, y: input.mouseY };
}

/** Pointeur libre (`DS:0144 == 1`) : à chaque tick les flèches tenues le déplacent (`1902:03c0`, 4 pixels au départ). */
export function movePointer(rt: Runtime): void {
  rt.ctx.input.moveMouseByKeys();
}

/** `153c:0030` : pointeur au centre (160, 100). Sans effet sous une vraie souris, que le jeu ne peut pas déplacer. */
export function centrePointer(rt: Runtime): void {
  rt.ctx.input.warpMouse(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
}

/** Un clic et la position du pointeur à cet instant : bouton 1 gauche (ou Espace), 2 droit (ou Entrée). */
export interface PointerClick {
  button: number;
  x: number;
  y: number;
}

/** Clic gauche ou droit de ce tick (`DS:4b6b`), avec la position du pointeur ; `null` sans clic. Lu à l'enfoncement. */
export function pointerClick(rt: Runtime): PointerClick | null {
  const { input } = rt.ctx;
  const button = rt.click() !== null ? 1 : input.justPressed("cancel") ? 2 : 0;
  return button === 0 ? null : { button, x: input.mouseX, y: input.mouseY };
}

/**
 * Attend `centiseconds` centièmes en lisant le clic à chaque tick (`read`) : rend `held` s'il y en avait déjà un, sinon
 * le premier lu pendant l'attente. L'original relit le bouton tenu après l'attente : un clic bref y serait perdu.
 */
export function* waitReading<T>(rt: Runtime, centiseconds: number, read: () => T | null, held: T | null = null): Script<T | null> {
  const end = rt.cs + centiseconds;
  while (rt.cs < end) {
    held ??= read();
    yield;
  }
  return held;
}

/** Couleur 255 du curseur flèche (`153c:06b9(0x80, 0, 0x80)`). */
export const ARROW_RGB = [0x80, 0, 0x80] as const;

/**
 * Curseur logiciel posé par-dessus l'image présentée : il garde ce qu'il recouvre et le rend quand on l'efface, comme
 * `153c:04c4` / `153c:0533` (flèche) et `18a1:044c` / `18a1:0413` (curseur de bibliothèque). `pixels` vaut −1 pour un
 * point transparent. Point chaud en haut à gauche.
 */
export class SoftCursor {
  private readonly under: Int16Array;
  private at: { x: number; y: number } | null = null;

  constructor(
    private readonly rt: Runtime,
    readonly width: number,
    readonly height: number,
    readonly pixels: Int16Array,
  ) {
    this.under = new Int16Array(pixels.length);
  }

  /** Dessine le curseur en (x, y), coupé aux bords de l'écran. */
  draw(x: number, y: number): void {
    this.each(x, y, (target, i) => {
      const { work } = this.rt.ctx.surface;
      this.under[i] = work[target];
      work[target] = this.pixels[i];
    });
    this.at = { x, y };
  }

  /** Dessine le curseur à la position du pointeur. */
  drawAtPointer(): void {
    const { x, y } = pointerAt(this.rt);
    this.draw(x, y);
  }

  /** Rend ce que le curseur recouvrait. */
  erase(): void {
    if (!this.at) return;
    this.each(this.at.x, this.at.y, (target, i) => {
      this.rt.ctx.surface.work[target] = this.under[i];
    });
    this.at = null;
  }

  /** Le tampon a été redessiné sans le curseur : rien à rendre. */
  forget(): void {
    this.at = null;
  }

  private each(x: number, y: number, visit: (target: number, i: number) => void): void {
    for (let row = 0; row < this.height; row++) {
      for (let column = 0; column < this.width; column++) {
        const i = row * this.width + column;
        if (this.pixels[i] < 0 || x + column >= SCREEN_WIDTH || y + row >= SCREEN_HEIGHT) continue;
        visit((y + row) * SCREEN_WIDTH + x + column, i);
      }
    }
  }
}

/**
 * Flèche 9 × 15 de `153c:05b4` (forme `DS:114c`, lue dans l'exécutable) : un octet non nul `v` donne la couleur `v + 1`
 * (contour 0, corps 255). La couleur 255 est à poser par l'appelant (`ARROW_RGB`).
 */
export function arrowCursor(rt: Runtime): SoftCursor {
  const pixels = Int16Array.from(rt.tables.arrow, (value) => (value === 0 ? -1 : (value + 1) & 0xff));
  return new SoftCursor(rt, ARROW_WIDTH, ARROW_HEIGHT, pixels);
}

/**
 * Curseur 16 × 16 de la bibliothèque (`18a1:0262(0)` le montre, le rappel d'horloge `18a1:04aa` le dessine à l'écran),
 * forme `DS:11d4` : couleurs 0 (contour) et 255 (corps).
 */
export function libraryCursor(rt: Runtime): SoftCursor {
  const pixels = new Int16Array(LIBRARY_CURSOR_SIZE * LIBRARY_CURSOR_SIZE).fill(-1);
  for (const { x, y, color } of rt.tables.libraryCursor) pixels[y * LIBRARY_CURSOR_SIZE + x] = color;
  return new SoftCursor(rt, LIBRARY_CURSOR_SIZE, LIBRARY_CURSOR_SIZE, pixels);
}

/** Moitiés de l'écran, pour `touchDirs`. */
export const TOP_HALF: Zone = { x1: 0, y1: 0, x2: SCREEN_WIDTH - 1, y2: SCREEN_HEIGHT / 2 - 1 };
export const BOTTOM_HALF: Zone = { x1: 0, y1: SCREEN_HEIGHT / 2, x2: SCREEN_WIDTH - 1, y2: SCREEN_HEIGHT - 1 };
export const LEFT_HALF: Zone = { x1: 0, y1: 0, x2: SCREEN_WIDTH / 2 - 1, y2: SCREEN_HEIGHT - 1 };
export const RIGHT_HALF: Zone = { x1: SCREEN_WIDTH / 2, y1: 0, x2: SCREEN_WIDTH - 1, y2: SCREEN_HEIGHT - 1 };

/**
 * Direction donnée par un clic ou un toucher (décision D11), pour les mini-jeux qui se jouent aux flèches : l'original
 * lit la souris poussée vers un bord de l'écran (`153c:0043`), le portage un clic ou un doigt posé dans une zone.
 * `zones` associe chaque zone à ses bits de direction (`UP`, `DOWN`, `LEFT`, `RIGHT`) ; rend 0 sans clic dans une zone.
 * À combiner avec les flèches : `rt.dirs() | touchDirs(rt, …)`.
 */
export function touchDirs(rt: Runtime, zones: readonly (readonly [Zone, number])[]): number {
  const click = rt.click(zones.map(([zone]) => zone));
  return typeof click === "number" ? zones[click][1] : 0;
}

// --- Son ------------------------------------------------------------------------------------------

/**
 * Bruitage en boucle sur le canal mélangé (`16cb:0a4f(son, 0xa00001)`). Le moteur commun n'a pas de boucle sur ce
 * canal : `pump`, appelé à chaque tick, relance le bruitage dès qu'il se tait (écart : un tick de silence au plus entre
 * deux tours). `release` retire la boucle (`16cb:0a4f(0, 8)`) : le tour en cours va à son terme.
 */
export class EffectLoop {
  private sound: Sound | null = null;

  constructor(private readonly rt: Runtime) {}

  play(sound: Sound): void {
    this.sound = sound;
    this.rt.effect(sound);
  }

  pump(): void {
    if (this.sound && !this.rt.ctx.voice.effectPlaying) this.rt.effect(this.sound);
  }

  release(): void {
    this.sound = null;
  }

  /** `while (16cb:0a4f(0, 0x100000)) pompe` : attend la fin du bruitage en cours. */
  *wait(): Script {
    while (this.rt.ctx.voice.effectPlaying) yield;
  }
}

/** Durée d'un cran du fondu sonore `13e5:0039`, en centièmes : 3 s au volume maximal (15). */
export const SOUND_FADE_STEP = 20;

/**
 * `13e5:0039` puis `16cb:08c9(0, 0x400000)` : le volume descend d'un cran tous les 20 centièmes jusqu'à 1 (la fonction
 * ignore l'argument que ses appelants empilent), puis la voie est coupée (musique comprise) et le volume rendu.
 */
export function* fadeSoundOut(rt: Runtime): Script {
  const { voice } = rt.ctx;
  const volume = voice.volume;
  for (let level = volume; level > 0; level--) {
    voice.setVolume(level);
    yield* rt.wait(SOUND_FADE_STEP);
  }
  voice.setMusic(null);
  voice.stop();
  voice.setVolume(volume);
}

// --- Repère des robots ----------------------------------------------------------------------------

/**
 * Début de la phase jouable d'un mini-jeu : `rt.screen` vaut `"minigame"` et `rt.hint` porte le numéro du module et
 * l'état vivant du mini-jeu (`state`), que les robots de test lisent pour jouer (`test/asterix/minigames/players.ts`).
 * Sans effet sur le jeu, sauf en démo : `paced` dit si la boucle de l'original est cadencée (attente `1831:030a` ou
 * rappel d'image d'une vidéo : une lecture d'entrées par image, annoncée par `waitFrame` ou par la vidéo) ou sans
 * cadence (M24, M25, M33), ce qui règle le rythme du clic simulé (`Runtime.demoRead`).
 */
export function beginPlay(rt: Runtime, module: number, state: object, paced = true): void {
  rt.screen = "minigame";
  rt.hint = { module, state };
  if (paced) rt.beginFrames();
}

/** Fin de la phase jouable (résultat, vidéo de fin, gains : plus rien à jouer). */
export function endPlay(rt: Runtime): void {
  rt.screen = "";
  rt.hint = {};
  rt.endFrames();
}

// --- Cadence --------------------------------------------------------------------------------------

/**
 * `1831:030a(n, rappel)` après le travail d'une image : attend `n` ticks en appelant `each` à chaque tick (rappel de
 * l'original, ou lecture des clics du portage, qui ne restent en file qu'un tick). L'image suivante commence à son
 * retour (`Runtime.nextFrame` : en démo, une lecture d'entrées comptée par image).
 */
export function* waitFrame(rt: Runtime, ticks: number, each?: () => void): Script {
  for (let i = 0; i < ticks; i++) {
    yield;
    each?.();
  }
  rt.nextFrame();
}

// --- MUK (segment `19b9`) -------------------------------------------------------------------------

/**
 * Cadence des MUK. L'original les déroule sans temporisation (`19b9:019f` : au rythme du lecteur de CD et du décodeur) ;
 * le portage prend 11 images par seconde, la cadence par défaut du moteur commun pour une vidéo sans en-tête. Mesuré
 * sur l'original : 10 à 11,6 images par seconde sur un 486 DX2-66 à lecteur double vitesse (`docs/asterix/engine.md`, §2.5).
 */
export const MUK_FPS = 11;

/** `19b9:000c(nom)` : ouvre un MUK, que l'appelant déroule image par image (`seek(n)` puis `compose(tampon)`). */
export function* openMuk(rt: Runtime, name: string): Script<VideoPlayer> {
  return new VideoPlayer(yield* rt.load(rt.ctx.resources.video(name)));
}

/**
 * `19b9:019f(nom, rappel)` : joue un MUK en entier, puis attend la fin de la voie. Chaque image apporte sa palette
 * (envoyée aussitôt, entrée 0 à noir) et se décode sur l'image précédente ; `each` est le rappel d'image.
 */
export function* playMuk(rt: Runtime, name: string, each?: (frame: number) => void): Script {
  const { surface, palette, clock } = rt.ctx;
  const video = yield* openMuk(rt, name);
  const start = clock.ticks;
  for (let frame = 0; frame < video.frameCount; frame++) {
    video.seek(frame);
    palette.load(video.palette);
    video.compose(surface.work);
    each?.(frame);
    while ((clock.ticks - start) * MUK_FPS < (frame + 1) * 60) yield;
  }
  yield* rt.waitSound();
}
