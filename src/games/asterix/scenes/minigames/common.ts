import type { Sound } from "../../../../engine/infogrames/audio/sound";
import type { Hy8 } from "../../../../engine/infogrames/data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../../engine/infogrames/data/mcg";
import { AnimationPlayer } from "../../../../engine/infogrames/sprites";
import type { Runtime, Script, Zone } from "../runtime";

/**
 * Outils communs aux mini-jeux d'Astérix (`scenes/minigames/mNN.ts`) : uniquement des primitives de la bibliothèque du
 * jeu que plusieurs segments de mini-jeux appellent, et le repère des robots. Ce qui ne sert qu'à un mini-jeu reste dans
 * son fichier. Gabarit de portage : `docs/asterix/minigames/README.md`.
 *
 * - `Anim` : objet animation du séquenceur HY8 (`1345:0082`, `1345:0007`, `1345:00c0`) ;
 * - `restoreRects` : restauration de rectangles du fond (`1481:07c3`) ;
 * - `flushInput` : entrées vidées avant de jouer (`153c:0004`) ;
 * - `touchDirs` et les quatre moitiés d'écran : direction donnée par un clic ou un toucher (décision D11) ;
 * - `EffectLoop` : bruitage en boucle du canal mélangé (`16cb:0a4f`, option `0x200000`) ;
 * - `fadeSoundOut` : fondu sonore de fin (`13e5:0039`) ;
 * - `beginPlay`, `endPlay` : repère de la phase jouable, lu par les robots et les tests ;
 * - `waitFrame` : attente de fin d'image (`1831:030a`).
 */

// --- Animations HY8 (segment `1345`) --------------------------------------------------------------

/**
 * Objet animation de l'original (36 octets : planche en `+0`, nombre d'images en `+0x14`, rang en `+0x16`, sprite
 * courant en `+0x18`). `step` pose le sprite de l'image courante **puis** avance : le sprite affiché après le pas `k`
 * est l'image `k − 1`, et `wrapped` (`+0x16 == 0`) est vrai juste après le pas qui a montré la dernière image.
 */
export class Anim {
  private player: AnimationPlayer;
  /** `+0x18` : numéro du sprite à dessiner (`2bdb:0477(sprite, x, y, planche)`), bit de miroir compris. */
  sprite = 0;

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
  }

  /** `1345:00c0(objet)` : un pas. */
  step(): void {
    const frame = this.player.frame;
    if (frame) this.sprite = frame.sprite | (frame.flags & 0x8000);
    this.player.advance();
  }

  /** `+0x16 == 0` : l'animation vient de boucler (ou n'a pas encore fait de pas). */
  get wrapped(): boolean {
    return this.player.frameIndex === 0;
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

/** `153c:0004` : attend 3 cs, oublie les directions déjà enfoncées, attend 3 cs (l'original recentre aussi le pointeur). */
export function* flushInput(rt: Runtime): Script {
  yield* rt.wait(3);
  rt.dirs();
  yield* rt.wait(3);
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

/**
 * `13e5:0039(d)` puis `16cb:08c9(0, 0x400000)` : le volume descend d'un cran tous les `d` centièmes jusqu'à 1, puis la
 * voie est coupée (musique comprise) et le volume rendu.
 */
export function* fadeSoundOut(rt: Runtime, centiseconds: number): Script {
  const { voice } = rt.ctx;
  const volume = voice.volume;
  for (let level = volume; level > 0; level--) {
    voice.setVolume(level);
    yield* rt.wait(centiseconds);
  }
  voice.setMusic(null);
  voice.stop();
  voice.setVolume(volume);
}

// --- Repère des robots ----------------------------------------------------------------------------

/**
 * Début de la phase jouable d'un mini-jeu : `rt.screen` vaut `"minigame"` et `rt.hint` porte le numéro du module et
 * l'état vivant du mini-jeu (`state`), que les robots de test lisent pour jouer (`test/asterix/minigames/players.ts`).
 * Sans effet sur le jeu.
 */
export function beginPlay(rt: Runtime, module: number, state: object): void {
  rt.screen = "minigame";
  rt.hint = { module, state };
}

/** Fin de la phase jouable (résultat, vidéo de fin, gains : plus rien à jouer). */
export function endPlay(rt: Runtime): void {
  rt.screen = "";
  rt.hint = {};
}

// --- Cadence --------------------------------------------------------------------------------------

/**
 * `1831:030a(n, rappel)` après le travail d'une image : attend `n` ticks en appelant `each` à chaque tick (rappel de
 * l'original, ou lecture des clics du portage, qui ne restent en file qu'un tick).
 */
export function* waitFrame(ticks: number, each?: () => void): Script {
  for (let i = 0; i < ticks; i++) {
    yield;
    each?.();
  }
}
