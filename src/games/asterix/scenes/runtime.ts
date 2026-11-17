import { encodeCp850 } from "../../../data/cp850";
import type { Sound } from "../../../engine/infogrames/audio/sound";
import type { PfnFont } from "../../../engine/infogrames/data/font";
import type { Hy8 } from "../../../engine/infogrames/data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type Picture } from "../../../engine/infogrames/data/mcg";
import type { Scene, SceneContext } from "../../../engine/infogrames/scene";
import { VideoBackdrop, VideoScene, type VideoPlayer } from "../../../engine/infogrames/video";
import type { ExeTables } from "../data/exe";
import type { GameState, Session } from "../game/state";

/**
 * Socle des écrans d'Astérix. Le code d'origine est séquentiel et bloquant (`while (…) { pompe; dessin; attente }`) :
 * il est porté tel quel sous forme de **scripts** (générateurs), où chaque `yield` rend la main au moteur pour un tick
 * de 1/60 s. Un script peut aussi rendre une promesse (chargement d'un fichier) : il reprend quand elle est tenue.
 * `Runtime` porte les primitives de la bibliothèque du jeu (segments `1a93`, `1481`, `15b0`, `135a`, `15d7`, `153c` :
 * `docs/asterix/engine.md` §2 à §5) et l'état commun aux écrans.
 */
export type Script<T = void> = Generator<unknown, T, unknown>;

/** Directions lues (`DS:4b69`, §3.2) : bit 1 haut, 2 bas, 4 gauche, 8 droite. */
export const UP = 1;
export const DOWN = 2;
export const LEFT = 4;
export const RIGHT = 8;

/** Zone cliquable (ajout du portage, décision D11) : rectangle 320 × 200, bords compris. */
export interface Zone {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function zoneAround(x: number, y: number, halfWidth: number, halfHeight: number): Zone {
  return { x1: x - halfWidth, y1: y - halfHeight, x2: x + halfWidth, y2: y + halfHeight };
}

/** Rectangle englobant des pixels d'une image qui portent l'une des couleurs données (zones des textes peints en palette). */
export function colorBounds(pixels: Uint8Array, colors: readonly number[], margin = 2): Zone | null {
  let x1 = SCREEN_WIDTH;
  let y1 = SCREEN_HEIGHT;
  let x2 = -1;
  let y2 = -1;
  for (let i = 0; i < pixels.length; i++) {
    if (!colors.includes(pixels[i])) continue;
    const x = i % SCREEN_WIDTH;
    const y = (i - x) / SCREEN_WIDTH;
    if (x < x1) x1 = x;
    if (x > x2) x2 = x;
    if (y < y1) y1 = y;
    if (y > y2) y2 = y;
  }
  return x2 < 0 ? null : { x1: x1 - margin, y1: y1 - margin, x2: x2 + margin, y2: y2 + margin };
}

/** Clic gauche d'une image : `null` sans clic, `"current"` pour l'élément sous le curseur du jeu, ou l'indice de la zone visée. */
export type Click = null | "current" | number;

/** Dossier des voix par clé (`DS:6412 + 100 × DS:6410`), table `135a:0248` (§5.3). */
const VOICE_FOLDERS: Readonly<Record<number, number>> = {
  0: 5,
  1: 8,
  16: 11,
  28: 13,
  33: 20,
  54: 21,
  63: 22,
  64: 23,
  100: 24,
  130: 25,
  154: 26,
  166: 34,
  169: 35,
  200: 37,
  222: 38,
  234: 39,
  300: 40,
  339: 41,
  400: 60,
  500: 61,
  600: 62,
  607: 63,
  652: 46,
  665: 51,
  700: 45,
};

/** Clés des dossiers de voix, nommées par leur usage. */
export const VOICES = {
  setup: 1,
  victory: 16,
  prison: 33,
  rest: 54,
  potion: 200,
  soothsayer: 234,
  quiz: 300,
  merchant: 339,
  announce: 400,
  turn: 500,
  marble: 600,
  panoramix: 607,
  abandon: 652,
  surprise: 665,
} as const;

/** Onze bruitages préchargés au démarrage (`19e2:0008`, §5.2), par leur globale. */
export const SOUNDS = {
  move: "b01-01b.voc",
  validate: "b13-12a.voc",
  step: "m43b0009.voc",
  coinGain: "m43b0001.voc",
  coinLoss: "m43b0003.voc",
  shake: "m43b0000.voc",
  dice: "b13-11a.voc",
  menuMove: "b07-01b.voc",
  menuValidate: "b07-12a.voc",
  bark: "m07b0000.voc",
  idefix: "m07b0002.voc",
} as const;

export type SoundName = keyof typeof SOUNDS;

/** Qui peut interrompre une vidéo (`1948:04cc`, bits `0x400` et `0x800`). */
export type VideoSkip = "any" | "buttons" | "none";

export interface VideoOptions {
  /** `0x400` : un bouton quelconque ; `0x800` : Échap. Défaut `"any"` (les deux, enveloppe `15d7:06eb`). */
  skip?: VideoSkip;
  /** `0x1000` : surimpression sur l'écran courant (seules les 128 premières couleurs viennent de la vidéo). */
  overlay?: boolean;
  /** `0x4000` : l'enveloppe décale d'abord l'écran dans les couleurs 128..255, et le rétablit à la fin. */
  shift?: boolean;
  /** `0x4` : la palette de la vidéo est ignorée. */
  keepPalette?: boolean;
  /** `0x8000` : lecture en boucle jusqu'à une interruption. */
  loop?: boolean;
  /** `0x80` : rappel d'image, la scène compose elle-même dans la surface. */
  draw?(video: VideoPlayer): void;
  /**
   * Tampon sur lequel la vidéo se décode, image après image (le tampon A d'un rappel `0x80`, ou l'écran lui-même) : seuls
   * les pixels codés y sont écrits, ce qu'il contenait reste visible ailleurs.
   */
  target?: Uint8Array;
  /** Appelé à chaque tick de la lecture, avant le décodage ; rendre vrai arrête la vidéo (rappel de la pause M48). */
  poll?(): boolean;
  /**
   * `cb_bloc` de `1948:04cc` : appelé une fois par image, à la lecture de son bloc vidéo. Le marqueur `08` d'une image
   * suit son bloc vidéo dans le fichier : `video.marker` (`DS:6425`) vaut encore ce qu'il valait à la fin de l'image
   * précédente, le marqueur d'une image n'est donc vu ici qu'à l'image suivante.
   */
  block?(video: VideoPlayer, index: number): void;
  /**
   * `cb_image` de `1948:04cc` : appelé une fois par image décodée, dans l'ordre, après `block` et après le décodage sur
   * `target` ; `video.marker` porte le marqueur lu avec cette image. Rendre vrai arrête la vidéo une fois l'image
   * montrée (l'original lève `DS:631e`). `index` est le numéro de l'image, 0 pour la première.
   */
  frame?(video: VideoPlayer, index: number): boolean | void;
}

/** Couleur des textes après le nettoyage `1a93:000e` (police `DS:19e8`). */
const TEXT_COLOR = 0x7e;

/**
 * Démo : `153c:01c0` compte dans `DS:64ae` les lectures d'entrées sans entrée réelle, et pose un clic simulé à la
 * lecture qui suit la centième (`153c:0263`).
 */
export const DEMO_CLICK_READS = 100;

export class Runtime {
  /** Planche commune `m43sa.hy8` (`DS:6451`) : pion, dé, flèche, croix, coche, porte de prison. */
  boardSprites!: Hy8;
  /** `M02S.HY8` (`DS:644d`) : mini-pions de la carte. */
  mapSprites!: Hy8;
  /** Polices `m52d0.pfn` (`DS:19e8`) et `m52d1.pfn` (`DS:19e4`). */
  font!: PfnFont;
  bigFont!: PfnFont;
  private readonly sounds = new Map<SoundName, Sound>();
  /** Clé du dossier de voix (`DS:6412 + 100 × DS:6410`), posée par chaque module avant de parler. */
  voiceKey: number = VOICES.panoramix;
  /** Couleur courante des textes (`2cd0:0129`). */
  textColor = TEXT_COLOR;
  /**
   * Départ des chronos en centièmes (`DS:6495 + 4k`) : 0 délai de l'écran, 1 temps de partie, 2 réponse du quiz et durée
   * d'un mini-jeu, 3 libre pour les mini-jeux.
   */
  private readonly chronos = [0, 0, 0, 0];
  /** Directions enfoncées depuis la dernière lecture (voir `tick`). */
  private latched = 0;
  /** Tick du dernier appui pris en compte (voir `fresh`). */
  private usedTick = -1;
  /** Partie en cours (posée par la boucle de partie). */
  game!: GameState;
  /** Écran interactif courant et ce qu'il attend : repère des tests et des robots, sans effet sur le jeu. */
  screen = "";
  hint: Record<string, unknown> = {};
  /** Fichiers demandés et absents (l'original affiche une boîte d'erreur) : doit rester vide. */
  readonly missing: string[] = [];
  /** `DS:64b2` : démonstration automatique en cours (§3.4), lancée par le menu après 60 s sans clic. */
  demo = false;
  /** `DS:64b1` : une entrée réelle a été lue ; en démo, chaque écran rend alors la main jusqu'au menu. */
  demoInterrupted = false;
  /** `DS:64ae` : lectures sans entrée réelle depuis le dernier clic simulé, et tick de la dernière lecture comptée. */
  private idleReads = 0;
  private idleTick = -1;
  /** Clic simulé posé par une lecture de la démo (`DS:4b6b = 1`), en attente du prochain `click`. */
  private simulated = false;
  /**
   * Image restée à l'écran après un nettoyage `1a93:000e`. L'original restaure le fond dans le tampon A sans le
   * présenter : l'écran garde sa dernière image jusqu'au prochain dessin. Ici A est ce que le moteur présente : tant que
   * le script n'y a rien redessiné, c'est cette image qui est montrée (`showHeld`, `tick`).
   */
  private held: Uint8Array | null = null;
  private showingHeld = false;

  constructor(
    readonly ctx: SceneContext,
    readonly tables: ExeTables,
    readonly session: Session,
  ) {}

  /** Tirage `1a93:00cb` : 15 bits. */
  readonly rnd = (): number => this.ctx.rng.next();

  // --- Temps (§2.2) ---------------------------------------------------------------------------------

  get cs(): number {
    return this.ctx.clock.centiseconds;
  }

  /** `1831:030a(n)` : attend `n` ticks. */
  *ticks(n: number): Script {
    for (let i = 0; i < n; i++) yield;
  }

  /** `1a93:0101(n)` / `1a93:013d(n)` : attend `n` centièmes de seconde. */
  *wait(centiseconds: number): Script {
    const end = this.cs + centiseconds;
    while (this.cs < end) yield;
  }

  /** `1a93:016d(k)` : démarre le chrono `k`. */
  startChrono(k = 0): void {
    this.chronos[k] = this.cs;
  }

  /** `1a93:0186(k)` : secondes entières écoulées. */
  chrono(k = 0): number {
    return Math.floor((this.cs - this.chronos[k]) / 100);
  }

  /** Centièmes écoulés sur le chrono `k` (sauvegarde du temps de partie). */
  elapsedCentiseconds(k: number): number {
    return this.cs - this.chronos[k];
  }

  /** Décale le départ d'un chrono (la pause M48 n'use pas le temps de partie ; reprise d'une sauvegarde). */
  shiftChrono(k: number, centiseconds: number): void {
    this.chronos[k] += centiseconds;
  }

  /** Attend une promesse (lecture d'un fichier) et rend sa valeur. */
  *load<T>(promise: Promise<T>): Script<T> {
    return (yield promise) as T;
  }

  // --- Entrées (§3) ---------------------------------------------------------------------------------

  /**
   * À chaque tick, avant le pas du script : retient les directions qui viennent d'être enfoncées. L'original ne lit le
   * clavier qu'une fois par image de l'écran (jusqu'à 4 ticks, plus les attentes d'anti-rebond) ; un appui bref tombé
   * entre deux lectures y est perdu, ici il est rendu à la lecture suivante.
   */
  tick(): void {
    const { input } = this.ctx;
    // Le tampon A reprend son contenu (le fond) le temps du pas du script.
    if (this.showingHeld) {
      this.ctx.surface.restoreBackground();
      this.showingHeld = false;
    }
    if (this.realInput()) this.demoInterrupted = true;
    if (input.justPressed("up")) this.latched |= UP;
    if (input.justPressed("down")) this.latched |= DOWN;
    if (input.justPressed("left")) this.latched |= LEFT;
    if (input.justPressed("right")) this.latched |= RIGHT;
  }

  /** Directions lues (`DS:4b69`) : celles qui sont tenues, et celles enfoncées depuis la dernière lecture. */
  dirs(): number {
    const { input } = this.ctx;
    const held = (input.pressed("up") ? UP : 0) | (input.pressed("down") ? DOWN : 0) | (input.pressed("left") ? LEFT : 0) | (input.pressed("right") ? RIGHT : 0);
    const read = held | this.latched;
    this.latched = 0;
    this.demoRead();
    return read;
  }

  /**
   * Clic gauche (`DS:4b6b == 1`) de cette image. Avec des zones (décision D11), un clic ou un toucher sur une zone la
   * désigne ; hors de toute zone il est ignoré, pour qu'un doigt posé à côté ne valide pas l'élément courant. Espace
   * valide toujours l'élément courant.
   */
  click(zones?: readonly (Zone | null)[], outsideValidates = false): Click {
    const { input } = this.ctx;
    if (!this.fresh()) return null;
    if (!input.justPressed("validate")) {
      this.demoRead();
      if (!this.simulated) return null;
      this.simulated = false;
      return this.use("current");
    }
    const at = input.validateAt;
    if (!zones || at === null) return this.use("current");
    const index = zones.findIndex((z) => z !== null && at.x >= z.x1 && at.x <= z.x2 && at.y >= z.y1 && at.y <= z.y2);
    // `outsideValidates` : écrans où les zones ne font que choisir (niveaux, réglages) ; cliquer ailleurs valide.
    if (index < 0) return outsideValidates ? this.use("current") : null;
    return this.use(index);
  }

  /** Une entrée réelle est en cours : un bouton ou une direction, tenu ou tout juste enfoncé (`153c:023d`). */
  private realInput(): boolean {
    const { input } = this.ctx;
    const actions = ["validate", "cancel", "up", "down", "left", "right"] as const;
    return actions.some((action) => input.pressed(action) || input.justPressed(action));
  }

  /** `DS:64b2 = 1` : la démo commence, sans interruption relevée ni lecture comptée (`19e2:08dc`). */
  startDemo(): void {
    this.demo = true;
    this.demoInterrupted = false;
    this.idleReads = 0;
    this.simulated = false;
  }

  /** `DS:64b2 = 0` à l'entrée du menu (`19e2:05c3`). */
  endDemo(): void {
    this.demo = false;
    this.demoInterrupted = false;
    this.idleReads = 0;
    this.simulated = false;
  }

  /** Démo interrompue par une entrée réelle (`DS:64b2 && DS:64b1`) : l'écran courant doit rendre la main. */
  get demoStopped(): boolean {
    return this.demo && this.demoInterrupted;
  }

  /**
   * Lecture des entrées en démo (`153c:0252`), faite par `dirs` et par `click` : sans entrée réelle, elle compte dans
   * `DS:64ae` ; les `DEMO_CLICK_READS` premières consomment un tirage (`153c:0272` : le test `rnd() % 20 == 20` qui suit
   * n'est jamais vrai), la suivante pose un clic simulé et remet le compteur à zéro. Une lecture par tick au plus : les
   * écrans du portage relisent les entrées à chaque tick, là où une boucle d'écran de l'original les lit une fois par
   * passage. Le clic posé attend le prochain `click` (l'original le garde dans `DS:4b6b` jusqu'à la lecture suivante).
   */
  private demoRead(): void {
    if (!this.demo) return;
    const { ticks } = this.ctx.clock;
    if (ticks === this.idleTick) return;
    this.idleTick = ticks;
    if (this.realInput()) return;
    if (++this.idleReads <= DEMO_CLICK_READS) {
      this.rnd();
      return;
    }
    this.idleReads = 0;
    this.simulated = true;
  }

  /**
   * Un appui n'agit qu'une fois : l'original attend le relâchement du bouton entre deux écrans (`1a93:026e`), alors
   * qu'ici un clic bref peut être lu deux fois dans le même tick par deux écrans qui s'enchaînent sans attente.
   */
  private fresh(): boolean {
    return this.ctx.clock.ticks !== this.usedTick;
  }

  private use<T>(value: T): T {
    this.usedTick = this.ctx.clock.ticks;
    return value;
  }

  /** Un bouton (ou Échap avec `escape`) vient d'être enfoncé : saut d'une vidéo ou d'une attente. */
  skipPressed(escape: boolean): boolean {
    const { input } = this.ctx;
    if (!this.fresh()) return false;
    if (input.anyJustPressed("validate", "cancel") || (escape && input.justPressed("skip"))) return this.use(true);
    return false;
  }

  /** Un bouton quelconque est tenu (`DS:4b6b != 0`). */
  get buttonHeld(): boolean {
    const { input } = this.ctx;
    return input.pressed("validate") || input.pressed("cancel");
  }

  /**
   * Clic droit (`DS:4b6b == 2`) : tous les écrans appellent alors l'aide `135a:02ac(n, 2)`, qui ne joue rien en mode 2
   * (décision D12 : aide muette). Seul effet réel : le délai de l'écran repart.
   */
  helpRequested(): boolean {
    if (!this.fresh() || !this.ctx.input.justPressed("cancel")) return false;
    this.use(true);
    this.startChrono(0);
    return true;
  }

  /** `1a93:026e` : attend le relâchement des boutons, 500 cs au plus. */
  *waitRelease(): Script {
    const end = this.cs + 500;
    while (this.buttonHeld && this.cs < end) yield;
  }

  /** `1a93:000e` : nettoyage entre deux écrans (police et couleur des textes, relâchement, fond B vers A). */
  *cleanup(): Script {
    this.textColor = TEXT_COLOR;
    this.latched = 0;
    yield* this.waitRelease();
    const { work, background } = this.ctx.surface;
    const shown = sameBytes(work, background) ? null : work.slice();
    this.restore();
    this.held = shown;
  }

  /**
   * Après le pas du script (`ScriptScene.render`) : si un nettoyage vient de restaurer le fond et que le script n'a rien
   * redessiné depuis, l'image d'avant le nettoyage reste montrée, comme sur l'écran de l'original.
   */
  showHeld(): void {
    if (!this.held || this.showingHeld) return;
    const { work, background } = this.ctx.surface;
    if (sameBytes(work, background)) {
      work.set(this.held);
      this.showingHeld = true;
    } else this.held = null;
  }

  /** L'écran est redessiné : l'image gardée par le nettoyage n'a plus cours. */
  private release(): void {
    this.held = null;
  }

  /** `1a93:02a5(n)` sans le clic : le chrono 0 a atteint `n` secondes. */
  timedOut(seconds: number): boolean {
    return this.chrono(0) >= seconds;
  }

  /** `1a93:01c3(n)` : attend `n` secondes ou un clic gauche. */
  *waitClick(seconds: number): Script {
    const end = this.cs + seconds * 100;
    while (this.cs < end && this.click() === null) yield;
  }

  /** `1a93:0215(n)` : attend `n` secondes, un bouton quelconque ou Échap. */
  *waitAny(seconds: number): Script {
    const end = this.cs + seconds * 100;
    while (this.cs < end && !this.skipPressed(true)) yield;
  }

  /** Attend `n` centièmes ; rend vrai si un clic gauche est arrivé pendant l'attente (l'original relit le bouton tenu après). */
  *waitOrClick(centiseconds: number): Script<boolean> {
    const end = this.cs + centiseconds;
    let clicked = false;
    while (this.cs < end) {
      if (this.click() !== null) clicked = true;
      yield;
    }
    return clicked || this.click() !== null;
  }

  // --- Rendu (§4) -----------------------------------------------------------------------------------

  /** `1481:0448` : restaure le fond (B vers A). */
  restore(): void {
    this.release();
    this.ctx.surface.restoreBackground();
  }

  /** `1a93:0051` : l'écran courant devient le fond, et la palette courante est envoyée. */
  commit(): void {
    // Après un nettoyage, l'écran est encore l'image gardée : c'est elle qui devient le fond.
    if (this.held) this.ctx.surface.work.set(this.held);
    this.release();
    this.ctx.surface.commitBackground();
    this.ctx.fade.reset();
  }

  /** `2bdb:0477(numéro, x, y, planche)`. */
  sprite(sheet: Hy8, index: number, x: number, y: number): void {
    this.ctx.surface.drawSprite(sheet, index, x, y);
  }

  /** `2cd0:001e(x, y, tampon, texte)` avec la police `DS:19e8` et la couleur courante. */
  text(x: number, y: number, text: string, font: PfnFont = this.font): number {
    return this.ctx.surface.drawText(font, encodeCp850(text), x, y, this.textColor);
  }

  /** `2c8b:000c` : rectangle vide d'un pixel. */
  frame(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const { work } = this.ctx.surface;
    for (let x = Math.max(0, x1); x <= Math.min(SCREEN_WIDTH - 1, x2); x++) {
      if (y1 >= 0 && y1 < SCREEN_HEIGHT) work[y1 * SCREEN_WIDTH + x] = color;
      if (y2 >= 0 && y2 < SCREEN_HEIGHT) work[y2 * SCREEN_WIDTH + x] = color;
    }
    for (let y = Math.max(0, y1); y <= Math.min(SCREEN_HEIGHT - 1, y2); y++) {
      if (x1 >= 0 && x1 < SCREEN_WIDTH) work[y * SCREEN_WIDTH + x1] = color;
      if (x2 >= 0 && x2 < SCREEN_WIDTH) work[y * SCREEN_WIDTH + x2] = color;
    }
  }

  /** `2c66:0028` : rectangle plein. */
  fill(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const { work } = this.ctx.surface;
    for (let y = Math.max(0, y1); y <= Math.min(SCREEN_HEIGHT - 1, y2); y++) {
      work.fill(color, y * SCREEN_WIDTH + Math.max(0, x1), y * SCREEN_WIDTH + Math.min(SCREEN_WIDTH - 1, x2) + 1);
    }
  }

  /** `1481:045e` : copie un rectangle d'un tampon vers le tampon de travail. */
  copyRect(source: Uint8Array, sx: number, sy: number, dx: number, dy: number, width: number, height: number): void {
    const { work } = this.ctx.surface;
    for (let row = 0; row < height; row++) {
      const y = dy + row;
      if (y < 0 || y >= SCREEN_HEIGHT || sy + row < 0 || sy + row >= SCREEN_HEIGHT) continue;
      const w = Math.min(width, SCREEN_WIDTH - dx, SCREEN_WIDTH - sx);
      work.set(source.subarray((sy + row) * SCREEN_WIDTH + sx, (sy + row) * SCREEN_WIDTH + sx + w), y * SCREEN_WIDTH + dx);
    }
  }

  /** Recopie la couleur `from` dans `to` (jeux de palette des pancartes et des bulles). */
  copyColor(to: number, from: number): void {
    const { colors } = this.ctx.palette;
    this.ctx.palette.setColor(to, colors[from * 3], colors[from * 3 + 1], colors[from * 3 + 2]);
  }

  /** `15b0:01f5(n)` : fondu au noir, puis écran effacé. */
  *fadeOut(steps = 16): Script {
    const { fade, palette, surface } = this.ctx;
    if (!palette.black) {
      fade.out(steps);
      while (fade.active) yield;
    }
    this.release();
    surface.clear();
  }

  /** `15b0:00e6(n)` : fondu d'entrée. */
  *fadeIn(steps = 16): Script {
    const { fade } = this.ctx;
    fade.in(steps);
    while (fade.active) yield;
  }

  /** `1481:0007(palette, pixels, +1)` : l'écran passe dans les couleurs 128..255. */
  shiftUp(): void {
    const { surface, palette } = this.ctx;
    const { work } = surface;
    for (let i = 0; i < work.length; i++) work[i] = (work[i] + 0x80) & 0xff;
    palette.colors.copyWithin(384, 0, 384);
  }

  /**
   * `1481:0155(nom, drapeaux)` (MCG) et `1481:027d` (MCC), §4.2 : 1 fondu d'entrée, 2 fondu au noir avant, 4 palette
   * non envoyée, `0x200` l'écran devient le fond, `0x4000` image décalée dans les couleurs 128..255.
   */
  *picture(name: string, flags = 0): Script<Picture> {
    if (flags & 2) yield* this.fadeOut();
    const picture = yield* this.load(this.ctx.resources.picture(name));
    this.draw(picture, flags);
    if (flags & 1) yield* this.fadeIn();
    if (flags & 0x200) this.ctx.surface.commitBackground();
    return picture;
  }

  /**
   * Pose une image chargée dans A et sa palette dans la palette courante (`1481:0089`, `1481:01ff`). Le drapeau 4 n'envoie
   * pas la palette : sur un écran noir (après un fondu) elle est chargée pour le fondu d'entrée que fera l'appelant ;
   * sur un écran visible, l'image garde les couleurs affichées (image finale d'un logo sur la palette de sa vidéo).
   */
  draw(picture: Picture, flags = 0): void {
    const { surface, palette, fade } = this.ctx;
    const visible = !palette.black;
    this.release();
    surface.drawMcg(picture);
    if (!(flags & 4) || !visible) palette.load(picture.palette);
    if (flags & 0x4000) this.shiftUp();
    if (flags & 4) return;
    if (flags & 1) fade.blackout();
    else fade.reset();
  }

  // --- Son (§5) -------------------------------------------------------------------------------------

  async preload(): Promise<void> {
    const { resources } = this.ctx;
    [this.boardSprites, this.mapSprites, this.font, this.bigFont] = await Promise.all([
      resources.hy8("m43sa.hy8"),
      resources.hy8("M02S.HY8"),
      resources.pfn("m52d0.pfn"),
      resources.pfn("m52d1.pfn"),
    ]);
    await Promise.all(
      (Object.keys(SOUNDS) as SoundName[]).map(async (name) => {
        this.sounds.set(name, await resources.sound(SOUNDS[name]));
      }),
    );
  }

  /** Bruitage préchargé sur la voie principale (`16cb:08c9(handle, 0x800004)`) : coupe la voix ou la musique en cours. */
  sound(name: SoundName): void {
    this.ctx.voice.play(this.sounds.get(name)!);
  }

  /** Bruitage sur le canal mélangé (`16cb:0a4f`), qui ne coupe pas la voie. */
  effect(sound: Sound | SoundName): void {
    this.ctx.voice.playEffect(typeof sound === "string" ? this.sounds.get(sound)! : sound);
  }

  /** `while (16cb:08c9(0, 0x100000)) pompe` : attend la fin de la voie. */
  *waitSound(): Script {
    while (this.ctx.voice.voicePlaying) yield;
  }

  /** Musique en boucle (`16cb:08c9(nom, 0xA00002)`), relancée dès que la voie est libre ; `null` l'arrête. */
  *music(name: string | null): Script {
    const { voice } = this.ctx;
    voice.setMusic(name === null ? null : yield* this.load(this.ctx.resources.sound(name)));
  }

  /** `16cb:08c9(0, 0x400000)` : arrêt de la voie (la musique réglée repartira). */
  stopSound(): void {
    this.ctx.voice.stop();
  }

  /** `135a:00fb(n)` : nom du fichier de la voix `n` du dossier courant, `K{NN}TE{n + 1}.voc`. */
  voiceFile(n: number): string {
    const folder = String(VOICE_FOLDERS[this.voiceKey]).padStart(2, "0");
    return `K${folder}TE${String(Math.abs(n) + 1).padStart(2, "0")}.voc`;
  }

  /** Charge une voix ; `null` si le fichier manque (noté dans `missing`). */
  *loadVoice(n: number): Script<Sound | null> {
    const name = this.voiceFile(n);
    if (this.ctx.host.filePath(`${name}.mp3`) === undefined) {
      this.missing.push(name);
      return null;
    }
    return yield* this.load(this.ctx.resources.sound(name));
  }

  /**
   * `135a:02ac(n, 0)` : joue la voix `n` du dossier courant et attend sa fin, puis 10 cs. Un clic gauche la coupe si
   * `n >= 0` ; `n < 0` la rend non interruptible.
   */
  *voice(n: number, key?: number): Script {
    if (key !== undefined) this.voiceKey = key;
    const sound = yield* this.loadVoice(n);
    if (!sound) return;
    const { voice } = this.ctx;
    voice.play(sound);
    while (voice.voicePlaying) {
      if (n >= 0 && !this.demo && this.click() !== null) {
        voice.stop();
        break;
      }
      yield;
    }
    yield* this.wait(10);
  }

  // --- Vidéo (§4.5, §4.6) ---------------------------------------------------------------------------

  /** Nom `M{nn}A{'A' + c}.MUX` des enveloppes `15d7:06eb` et `15d7:07f7`. */
  static videoName(module: number, letter: number): string {
    return `M${String(module).padStart(2, "0")}A${String.fromCharCode(0x41 + letter)}.MUX`;
  }

  /**
   * `1948:04cc(nom, options, …)` : joue une vidéo ; rend vrai si elle a été interrompue (ou si le fichier manque).
   * Attend d'abord la fin de la voie. La lecture elle-même est celle du moteur commun (`VideoScene`).
   */
  *video(name: string, options: VideoOptions = {}): Script<boolean> {
    const { ctx } = this;
    yield* this.waitSound();
    if (ctx.host.filePath(`${name}.vid`) === undefined && ctx.host.filePath(name) === undefined) {
      this.missing.push(name);
      return true;
    }
    const savedWork = options.shift ? ctx.surface.work.slice() : null;
    const savedPalette = options.shift ? ctx.palette.colors.slice() : null;
    let backdrop: VideoBackdrop | undefined;
    if (options.overlay) {
      backdrop = new VideoBackdrop();
      if (options.shift) backdrop.capture(ctx);
      else {
        backdrop.pixels.set(ctx.surface.work);
        backdrop.palette.set(ctx.palette.colors);
      }
    }
    const skip = options.skip ?? "any";
    const callbacks = options.block !== undefined || options.frame !== undefined;
    let interrupted = false;
    do {
      let done = false;
      /** Un rappel d'image a demandé l'arrêt : la vidéo s'arrête une fois cette image montrée. */
      let stop = false;
      /** `DS:6425` tel que les rappels le voient et le laissent. */
      let marker = 0;
      /** Images décodées dont les rappels restent à appeler : numéro, et marqueur lu avec l'image s'il y en a un. */
      const decoded: { video: VideoPlayer; index: number; read: number | null }[] = [];
      const scene = new VideoScene({
        file: name,
        skippable: false,
        backdrop,
        keepPalette: options.keepPalette,
        draw: options.draw && ((_ctx, video) => options.draw!(video)),
        onFrame:
          options.target || callbacks
            ? (_ctx, index, markers, video) => {
                if (options.target) video.compose(options.target);
                if (callbacks) decoded.push({ video, index, read: markers.length > 0 ? video.marker : null });
              }
            : undefined,
        onEnd: () => {
          done = true;
        },
      });
      yield scene.load(ctx);
      scene.enter(ctx);
      for (;;) {
        if ((skip !== "none" && this.skipPressed(skip === "any")) || options.poll?.() || stop) {
          interrupted = true;
          break;
        }
        scene.update(ctx);
        if (done) break;
        for (const { video, index, read } of decoded.splice(0)) {
          video.marker = marker;
          options.block?.(video, index);
          if (read !== null) video.marker = read;
          if (options.frame?.(video, index) === true) stop = true;
          marker = video.marker;
        }
        scene.render(ctx);
        yield;
      }
      scene.exit(ctx);
    } while (options.loop && !interrupted);
    if (savedWork && savedPalette) {
      // `1481:0007(…, −1)` : l'écran d'avant la vidéo revient dans les couleurs 0..127.
      ctx.surface.work.set(savedWork);
      ctx.palette.colors.set(savedPalette);
    }
    return interrupted;
  }

  /** `15d7:06eb(module, c, 0, options)` : vidéo interruptible ; `15d7:07f7` est la même, non interruptible. */
  *moduleVideo(module: number, letter: number, options: VideoOptions = {}): Script<boolean> {
    if ((options.skip ?? "any") !== "none") yield* this.waitSkipRelease();
    return yield* this.video(Runtime.videoName(module, letter), options);
  }

  /** `15d7:08e9(nom)` : boutons et Échap relâchés, puis la vidéo `nom` en plein écran, interruptible (`0x22D08`). */
  *namedVideo(name: string): Script<boolean> {
    yield* this.waitSkipRelease();
    return yield* this.video(name);
  }

  /** Attente du relâchement des boutons et d'Échap, en tête de `15d7:06eb` et de `15d7:08e9`. */
  *waitSkipRelease(): Script {
    while (this.buttonHeld || this.ctx.input.pressed("skip")) yield;
  }

  /** Surimpression `0x5000` de Panoramix et des personnages qui parlent par-dessus un écran du jeu. */
  *overlayVideo(module: number, letter: number, skip: VideoSkip = "any"): Script<boolean> {
    return yield* this.moduleVideo(module, letter, { overlay: true, shift: true, skip });
  }

  /**
   * Animation jouée dans une vignette du plateau (rappels `20fa:000d`, `053e`, `0e83`, `11b0` : `0x80 | 0x4`) : la
   * vidéo est décodée dans le tampon A et le rappel en recopie un rectangle à l'écran, à l'emplacement de la case.
   */
  *vignette(name: string, sx: number, sy: number, dx: number, dy: number, width: number, height: number, skip: VideoSkip): Script {
    const buffer = this.ctx.surface.work.slice();
    yield* this.video(name, {
      skip,
      keepPalette: true,
      target: buffer,
      draw: () => this.copyRect(buffer, sx, sy, dx, dy, width, height),
    });
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Scène unique du jeu : déroule le script racine, un pas par tick. Les écrans dessinent directement dans le tampon de
 * travail pendant leur pas (c'est ce que le moteur présente), donc `render` n'a rien à faire.
 */
export class ScriptScene implements Scene {
  readonly step = 1;
  private script: Script | null = null;
  private waiting = false;
  private resolved: unknown = undefined;
  private failure: { error: unknown } | null = null;
  /** Promesse du chargement en cours, `null` sinon (les tests l'attendent entre deux images). */
  pending: Promise<void> | null = null;
  /** Vrai quand le script racine est terminé. */
  finished = false;
  /** Appelé à chaque tick avant le pas du script (lecture des entrées du socle). */
  beforeStep: (() => void) | null = null;
  /** Appelé avant chaque présentation, après les pas du script. */
  beforePresent: (() => void) | null = null;

  constructor(private readonly start: (ctx: SceneContext) => Script) {}

  /** Vrai pendant qu'un script attend un fichier. */
  get loading(): boolean {
    return this.waiting;
  }

  enter(ctx: SceneContext): void {
    this.script = this.start(ctx);
  }

  update(): void {
    if (this.failure) {
      const { error } = this.failure;
      this.failure = null;
      throw error;
    }
    this.beforeStep?.();
    if (this.waiting || this.finished || !this.script) return;
    const value = this.resolved;
    this.resolved = undefined;
    const result = this.script.next(value);
    if (result.done) {
      this.finished = true;
      return;
    }
    if (result.value instanceof Promise) {
      this.waiting = true;
      this.pending = (result.value as Promise<unknown>).then(
        (resolvedValue) => {
          this.resolved = resolvedValue;
          this.waiting = false;
          this.pending = null;
        },
        (error: unknown) => {
          this.failure = { error };
          this.waiting = false;
          this.pending = null;
        },
      );
    }
  }

  render(): void {
    this.beforePresent?.();
  }
}
