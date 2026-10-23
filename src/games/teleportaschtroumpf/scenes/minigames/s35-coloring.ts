import type { Hy8 } from "../../data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import {
  Pointer,
  SoundHush,
  minigameLevel,
  minigameRequest,
  pointsOutcome,
  type MinigameDone,
  type MinigameFactory,
} from "./common";

/**
 * S35 « Le Coloriage » (`1bda:0021`, 2452 octets ; RE : `docs/teleportaschtroumpf/minigames/s35.md`).
 *
 * ### `createColoring(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 35) : `level` 0..2 choisit la série d'images et le
 *   temps (55, 52 ou 49 s), `bonus` (indice de l'oiseau) le niveau 0 ;
 * - joue : une image est montrée coloriée pendant 8 s (un clic abrège), puis ses zones passent au gris : il faut les recolorier de la
 *   bonne couleur avec le curseur (souris, ou flèches + Espace) avant la fin du temps. Clic gauche sur une zone = la peindre de la couleur
 *   en main ; clic gauche sur la palette de droite = prendre une couleur ; clic droit = couleur suivante. Une zone peinte d'une mauvaise
 *   couleur termine la partie ;
 * - rend : `onDone(ctx, { kind: "points", points })` : 3, 2 ou 1 point selon le temps mis, 0 si échec ou temps écoulé ; l'appelant applique
 *   l'issue.
 */

/** Une image : son fichier (`s35aNNNd.mcg`) et son nombre de couleurs dans la palette de droite (`DS:171C`). */
export interface ColoringPicture {
  readonly name: string;
  readonly swatches: number;
}

/** Les 8 images de chaque niveau, dans l'ordre de la table de sauts `1bda:09b5` (indice = tirage + 8 × niveau). */
export const COLORING_PICTURES: readonly (readonly ColoringPicture[])[] = [
  [
    { name: "s35a003d", swatches: 4 },
    { name: "s35a008d", swatches: 4 },
    { name: "s35a018d", swatches: 4 },
    { name: "s35a019d", swatches: 4 },
    { name: "s35a021d", swatches: 4 },
    { name: "s35a027d", swatches: 4 },
    { name: "s35a002d", swatches: 3 },
    { name: "s35a025d", swatches: 4 },
  ],
  [
    { name: "s35a000d", swatches: 5 },
    { name: "s35a004d", swatches: 5 },
    { name: "s35a007d", swatches: 5 },
    { name: "s35a012d", swatches: 5 },
    { name: "s35a017d", swatches: 5 },
    { name: "s35a023d", swatches: 5 },
    { name: "s35a024d", swatches: 5 },
    { name: "s35a026d", swatches: 5 },
  ],
  [
    { name: "s35a001d", swatches: 7 },
    { name: "s35a006d", swatches: 6 },
    { name: "s35a005d", swatches: 7 },
    { name: "s35a009d", swatches: 6 },
    { name: "s35a010d", swatches: 7 },
    { name: "s35a013d", swatches: 6 },
    { name: "s35a011d", swatches: 7 },
    { name: "s35a022d", swatches: 6 },
  ],
];

/** Temps de jeu en secondes : 55 − 3 × niveau (`DS:1728`). */
export function coloringLimit(level: number): number {
  return 0x37 - 3 * level;
}

/** Points selon le temps écoulé à la fin (`1bda:0909..0958`) : moins d'un tiers du temps utile (limite − 18 s) = 3, moins de deux tiers = 2, sinon 1. */
export function coloringPoints(elapsed: number, limit: number): number {
  if (elapsed < Math.trunc((limit - 0x12) / 3)) return 3;
  if (elapsed < Math.trunc(((limit - 0x12) * 2) / 3)) return 2;
  return 1;
}

/** Entrées de palette (`DS:57C0`) : zones 0x60..0x6D (leur vraie couleur est en +16), 0x6E contour du curseur, 0x6F couleur en main, 0x70..0x7D couleurs de la palette. */
export const REGION_FIRST = 0x60;
export const REGION_END = 0x6e;
export const OUTLINE_ENTRY = 0x6e;
export const BRUSH_ENTRY = 0x6f;
export const SWATCH_LAST = 0x7e;
export const TRUE_OFFSET = 16;
/** Entrée donnant le gris des zones non peintes (`DS:593D`, composante R de l'entrée 0x7F), gris du contour (0x44) et entrée 0xFF (`14b3:0663`). */
const GRAY_ENTRY = 0x7f;
const OUTLINE_GRAY = 0x44;
const LAST_ENTRY_GRAY = 0x80;

/** Colonne et pas de la palette de couleurs (`1bda:03ce..03f5`) : la couleur n est lue en (0x11C, 0x0F + 0x1C × n). */
export const SWATCH_X = 0x11c;
export const SWATCH_Y = 0x0f;
export const SWATCH_STEP = 0x1c;
/** Un clic à gauche de cette abscisse peint, à droite il prend une couleur (`1bda:0444`). */
export const PAINT_LIMIT_X = 0x102;
/** Bornes en y qui désignent la couleur cliquée dans la palette (`1bda:0723..0766`) : première borne dépassée = numéro. */
const SWATCH_Y_LIMITS: readonly number[] = [0x1f, 0x3c, 0x5a, 0x72, 0x8c, 0xa8];

/** Sprite du curseur dans `s35a000s.hy8` (`31fe:0481(2, …)`) : le bas-gauche de l'image est la pointe. */
const CURSOR_SPRITE = 2;

/** Rythme de la boucle : `1f33:00fc(10)` = 10 centièmes de seconde = 6 ticks. */
export const LOOP_TICKS = 6;
/** Image coloriée montrée avant le jeu (`1f33:0279(8)`), en secondes. */
export const PREVIEW_SECONDS = 8;
/** Attente maximale du relâchement des boutons (`1f33:036d`), en centièmes. */
const RELEASE_CAP_CS = 500;
/** Clignotement de la zone fautive : 30 tirages de couleur (`1bda:067a`). */
export const FLASH_COUNT = 30;
/** Pause finale (`1f33:00fc(300)`) = 3 s = 180 ticks. */
const END_PAUSE_TICKS = 180;

/** Mémoire des images tirées : celle d'avant, et la dernière de chaque niveau (`DS:6760`, `DS:6756`), propres à une partie. */
interface PictureMemory {
  last: number;
  byLevel: number[];
}
const memories = new WeakMap<Game, PictureMemory>();

/**
 * Tirage de l'image (`1bda:0076..00cb`) : `rand × 8 / 0x8000` jusqu'à une image différente de la dernière jouée. La mémoire est
 * par partie ; le niveau de la mémoire est celui du joueur, celui de la série est le niveau effectif (0 avec l'indice de l'oiseau).
 */
export function pickPicture(
  game: Game,
  rng: { below(n: number): number },
  playerLevel: number,
  level: number,
): { index: number; picture: ColoringPicture } {
  let memory = memories.get(game);
  if (!memory) memories.set(game, (memory = { last: 0, byLevel: [0, 0, 0] }));
  memory.byLevel[level] = memory.last;
  let index: number;
  do index = rng.below(8);
  while (memory.byLevel[playerLevel] === index);
  memory.byLevel[playerLevel] = index;
  memory.last = index;
  return { index, picture: COLORING_PICTURES[level][index] };
}

export type ColoringEvent = "painted" | "wrong";

/** Résultat d'un clic gauche sur la zone de peinture. */
export interface PaintResult {
  /** Sons de la boucle, dans l'ordre (la scène ne les joue que si rien ne sonne). */
  events: ColoringEvent[];
  /** Au moins une zone fausse sous le curseur. */
  wrong: boolean;
  /** Toutes les zones sont peintes. */
  complete: boolean;
}

/**
 * Le jeu sans écran : l'image (indices), la palette de travail (768 octets RVB 8 bits, modifiée par le jeu) et les règles du clic
 * (`1bda:039c..0786`). Les zones sont les entrées 0x60..0x6D qui ne sont pas déjà grises ; leur vraie couleur reste dans l'entrée +16.
 */
export class ColoringRun {
  readonly palette: Uint8Array;
  /** Nombre de zones à peindre (`DS:1720`). */
  readonly regions: number;
  /** Gris des zones non peintes. */
  readonly gray: number;
  /** Zones peintes (`DS:171E`). */
  painted = 0;
  /** Couleur en main : numéro dans la palette de droite (`DS:1722`). */
  selected = 0;
  /** Dernière zone fausse touchée (`uRam37b84`). */
  lastWrong = 0;

  constructor(
    private readonly pixels: Uint8Array,
    palette: Uint8Array,
    readonly swatches: number,
  ) {
    this.palette = Uint8Array.from(palette);
    this.gray = this.palette[GRAY_ENTRY * 3];
    let regions = 0;
    for (let i = REGION_FIRST; i < REGION_END; i++) {
      if (!this.isGray(i)) {
        regions++;
        this.setEntry(i, this.gray, this.gray, this.gray);
      }
    }
    this.regions = regions;
    this.setEntry(OUTLINE_ENTRY, OUTLINE_GRAY, OUTLINE_GRAY, OUTLINE_GRAY);
    this.setEntry(255, LAST_ENTRY_GRAY, LAST_ENTRY_GRAY, LAST_ENTRY_GRAY);
  }

  /** Indice de l'image en (x, y) ; 0 hors de l'écran. */
  pixelAt(x: number, y: number): number {
    if (x < 0 || x >= SCREEN_WIDTH || y < 0 || y >= SCREEN_HEIGHT) return 0;
    return this.pixels[y * SCREEN_WIDTH + x];
  }

  entry(i: number): [number, number, number] {
    return [this.palette[i * 3], this.palette[i * 3 + 1], this.palette[i * 3 + 2]];
  }

  private setEntry(i: number, r: number, g: number, b: number): void {
    this.palette[i * 3] = r;
    this.palette[i * 3 + 1] = g;
    this.palette[i * 3 + 2] = b;
  }

  /** L'entrée est entièrement du gris des zones non peintes. */
  isGray(i: number): boolean {
    return this.palette[i * 3] === this.gray && this.palette[i * 3 + 1] === this.gray && this.palette[i * 3 + 2] === this.gray;
  }

  /** Couleur en main (entrée 0x6F). */
  get brush(): [number, number, number] {
    return this.entry(BRUSH_ENTRY);
  }

  /** Les neuf pixels autour de (x, y), ligne par ligne (`1bda:0486..05d4`). */
  private around(x: number, y: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < 9; k++) out.push(this.pixelAt(x - 1 + (k % 3), y - 1 + Math.trunc(k / 3)));
    return out;
  }

  /** Clic droit : couleur suivante, prise au pixel de la palette de droite (`1bda:03c7..0437`). */
  nextSwatch(): void {
    this.selected++;
    if (this.swatches <= this.selected) this.selected = 0;
    const b = this.pixelAt(SWATCH_X, this.selected * SWATCH_STEP + SWATCH_Y);
    this.setEntry(BRUSH_ENTRY, ...this.entry(b));
  }

  /** Clic gauche à droite de la limite : prend la première couleur de la palette sous le curseur. */
  pick(x: number, y: number): boolean {
    for (const b of this.around(x, y)) {
      if (b >= BRUSH_ENTRY && b < SWATCH_LAST) {
        this.setEntry(BRUSH_ENTRY, ...this.entry(b));
        const at = SWATCH_Y_LIMITS.findIndex((limit) => y < limit);
        this.selected = at < 0 ? SWATCH_Y_LIMITS.length : at;
        return true;
      }
    }
    return false;
  }

  /** Clic gauche à gauche de la limite : peint les zones grises sous le curseur si elles ont la couleur en main, sinon c'est une faute. */
  paint(x: number, y: number): PaintResult {
    const events: ColoringEvent[] = [];
    let wrong = 0;
    let complete = false;
    const [r, g, b] = this.brush;
    for (const index of this.around(x, y)) {
      if (index < REGION_FIRST || index >= REGION_END || !this.isGray(index)) continue;
      const [tr, tg, tb] = this.entry(index + TRUE_OFFSET);
      if (tr === r && tg === g && tb === b) {
        this.setEntry(index, r, g, b);
        this.painted++;
        events.push("painted");
        if (this.painted === this.regions) complete = true;
      } else {
        wrong++;
        events.push("wrong");
        this.lastWrong = index;
      }
    }
    return { events, wrong: wrong > 0, complete };
  }

  /** Fin de partie : rend leur vraie couleur à une zone (`1bda:07d0..0819`). */
  reveal(i: number): void {
    this.setEntry(i, ...this.entry(i + TRUE_OFFSET));
  }
}

export type ColoringPhase = "preview" | "release" | "play" | "flash" | "reveal" | "soundFade" | "voice" | "pause" | "done";

/** Issue d'une partie : réussie (`won`), ratée sur une couleur fausse (`wrong`) ou temps écoulé. */
export type ColoringEnd = "won" | "wrong" | "timeout";

export class ColoringScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private paintedVoc!: Voc;
  private wrongVoc!: Voc;
  private voices = new Map<string, Voc>();
  private palette!: Uint8Array;
  private pointer!: Pointer;
  private run!: ColoringRun;
  private phase: ColoringPhase = "preview";
  private picture!: ColoringPicture;
  private pictureIndex = 0;
  private level = 0;
  private limit = 0;
  private startCs = 0;
  private previewTick = -1;
  private releaseCs = 0;
  private nextTick = 0;
  private blocked = false;
  private leftClick = false;
  private rightClick = false;
  private shown = { x: 0, y: 0 };
  private cursorVisible = false;
  private flashes = 0;
  private revealed = REGION_FIRST;
  private readonly hushing = new SoundHush();
  /** Volume de la voie au début du jeu : le fondu part de là (`DS:212` relu avant la partie). */
  private startVolume = 15;
  private measured = 0;
  private outcomeKind: ColoringEnd = "timeout";
  private won = false;
  private failed = false;
  private points = 0;
  private voiceName = "";
  private voiceStarted = false;
  private pauseStart = 0;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 35);
  }

  get stage(): ColoringPhase {
    return this.phase;
  }

  /** La partie en cours (pour les tests). */
  get state(): ColoringRun {
    return this.run;
  }

  /** Fichier de l'image jouée (sans extension). */
  get pictureName(): string {
    return this.picture.name;
  }

  /** Indice de l'image dans sa série de 8 (pour les tests). */
  get pictureNumber(): number {
    return this.pictureIndex;
  }

  /** Temps de jeu en secondes. */
  get timeLimit(): number {
    return this.limit;
  }

  /** Secondes écoulées depuis le début du jeu (`1f33:019a(2)`), pour les tests. */
  elapsed(ctx: SceneContext): number {
    return Math.floor((ctx.clock.centiseconds - this.startCs) / 100);
  }

  /** Secondes mesurées à la fin, après le dévoilement et le fondu sonore (`DS:1726`) : elles décident des points. */
  get finalSeconds(): number {
    return this.measured;
  }

  get end(): ColoringEnd {
    return this.outcomeKind;
  }

  get earned(): number {
    return this.points;
  }

  /** Voix de fin choisie (`s35b00Nt.voc` ou `s35c00Nt.voc`), vide avant la fin. */
  get voiceFile(): string {
    return this.voiceName;
  }

  async load(ctx: SceneContext): Promise<void> {
    const request = minigameRequest(this.game, 35);
    // L'indice de l'oiseau remet le niveau 0 (`bRam3d3a2 = 0`).
    this.level = minigameLevel(request, 0);
    this.limit = coloringLimit(this.level);
    const { index, picture } = pickPicture(this.game, ctx.rng, request.level, this.level);
    this.picture = picture;
    this.pictureIndex = index;
    const voiceFiles = [1, 2, 3, 4, 5, 6].map((n) => voiceName("s35c", n)).concat([1, 2, 3, 4].map((n) => voiceName("s35b", n)));
    const [mcg, sprites, painted, wrong, ...voices] = await Promise.all([
      ctx.resources.mcg(`${picture.name}.mcg`),
      ctx.resources.hy8("s35a000s.hy8"),
      ctx.resources.voc("s35a001b.voc"),
      ctx.resources.voc("s35a002b.voc"),
      ...voiceFiles.map((file) => ctx.resources.voc(file)),
    ]);
    this.mcg = mcg;
    this.sprites = sprites;
    this.paintedVoc = painted;
    this.wrongVoc = wrong;
    voiceFiles.forEach((file, i) => this.voices.set(file, voices[i]));
    this.palette = mcg.palette;
    this.pointer = new Pointer({ sprites, sprite: CURSOR_SPRITE, bounds: { minX: 0, maxX: SCREEN_WIDTH - 1, minY: 0, maxY: SCREEN_HEIGHT - 1 } });
  }

  enter(ctx: SceneContext): void {
    // L'image est d'abord montrée telle quelle, coloriée (`13fc:0150`) ; le fondu d'entrée est fait par l'appelant.
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    this.phase = "preview";
    this.previewTick = -1;
    this.blocked = false;
    this.leftClick = false;
    this.rightClick = false;
    this.cursorVisible = false;
    this.flashes = 0;
    this.revealed = REGION_FIRST;
    this.won = false;
    this.failed = false;
    this.points = 0;
    this.outcomeKind = "timeout";
    this.voiceStarted = false;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "preview": {
        if (ctx.fade.active) return;
        if (this.previewTick < 0) this.previewTick = ctx.clock.ticks;
        const waited = (ctx.clock.ticks - this.previewTick) / 60;
        if (waited >= PREVIEW_SECONDS || ctx.input.anyJustPressed("validate", "cancel")) {
          this.phase = "release";
          this.releaseCs = ctx.clock.centiseconds;
        }
        return;
      }
      case "release":
        // `1f33:036d` : on attend le relâchement des boutons, au plus 5 s.
        if ((ctx.input.pressed("validate") || ctx.input.pressed("cancel")) && ctx.clock.centiseconds - this.releaseCs < RELEASE_CAP_CS) return;
        this.beginPlay(ctx);
        return;
      case "play":
        this.updatePlay(ctx);
        return;
      case "flash":
        this.updateFlash(ctx);
        return;
      case "reveal":
        this.updateReveal(ctx);
        return;
      case "soundFade":
        this.updateSoundFade(ctx);
        return;
      case "voice":
        this.updateVoice(ctx);
        return;
      case "pause":
        if (ctx.clock.ticks - this.pauseStart >= END_PAUSE_TICKS) this.finish(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    const { surface } = ctx;
    surface.restoreBackground();
    if (this.cursorVisible) surface.drawSprite(this.sprites, CURSOR_SPRITE, this.shown.x, this.shown.y);
  }

  exit(ctx: SceneContext): void {
    ctx.voice.holdMusic(false);
    this.hushing.restore(ctx);
  }

  // --- Jeu --------------------------------------------------------------------------------------------

  /** Fin de l'aperçu : les zones passent au gris, le chrono du jeu démarre (`1bda:02a0..0373`). */
  private beginPlay(ctx: SceneContext): void {
    this.run = new ColoringRun(this.mcg.pixels, this.palette, this.picture.swatches);
    ctx.palette.load(this.run.palette);
    this.startCs = ctx.clock.centiseconds;
    this.startVolume = ctx.voice.volume;
    this.phase = "play";
    this.nextTick = ctx.clock.ticks;
    this.blocked = false;
    this.cursorVisible = true;
    const { x, y } = this.pointer.position(ctx);
    this.shown = { x, y };
  }

  private updatePlay(ctx: SceneContext): void {
    const { input } = ctx;
    if (this.blocked) {
      // Boucle de l'original suspendue tant que les boutons sont tenus (`1f33:036d`, au plus 5 s) : le curseur ne bouge pas.
      this.leftClick = this.rightClick = false;
      if ((input.pressed("validate") || input.pressed("cancel")) && ctx.clock.centiseconds - this.releaseCs < RELEASE_CAP_CS) return;
      this.blocked = false;
      this.nextTick = ctx.clock.ticks + LOOP_TICKS;
      return;
    }
    this.pointer.update(ctx);
    // Un appui plus court qu'un tour de boucle compte quand même.
    this.leftClick ||= input.justPressed("validate");
    this.rightClick ||= input.justPressed("cancel");
    const { x, y } = this.pointer.position(ctx);
    this.shown = { x, y };
    if (ctx.clock.ticks < this.nextTick) return;
    // Condition de sortie de la boucle, évaluée après l'attente de 10 centièmes (`1bda:07aa`).
    if (this.failed || this.won || this.elapsed(ctx) >= this.limit) {
      this.beginEnding();
      return;
    }
    this.iterate(ctx, x, y);
  }

  /** Un tour de boucle : le bouton gauche seul peint ou prend une couleur, le droit seul passe à la couleur suivante. */
  private iterate(ctx: SceneContext, x: number, y: number): void {
    const { input } = ctx;
    const left = (this.leftClick || input.pressed("validate")) && !input.pressed("cancel");
    const right = (this.rightClick || input.pressed("cancel")) && !input.pressed("validate");
    this.leftClick = this.rightClick = false;
    this.nextTick = ctx.clock.ticks + LOOP_TICKS;
    if (right) {
      this.run.nextSwatch();
      ctx.palette.load(this.run.palette);
    } else if (left && x < PAINT_LIMIT_X) {
      const result = this.run.paint(x, y);
      for (const event of result.events) {
        // Bruitages mélangés `348d:0b42` : lancés seulement si aucun bruitage ne sonne, la musique continue.
        if (ctx.voice.effectPlaying) continue;
        ctx.voice.playEffect(event === "painted" ? this.paintedVoc : this.wrongVoc);
      }
      ctx.palette.load(this.run.palette);
      if (result.complete) this.won = true;
      if (result.wrong) {
        this.failed = true;
        this.flashes = 0;
        this.phase = "flash";
      }
    } else if (left) {
      if (this.run.pick(x, y)) ctx.palette.load(this.run.palette);
    }
    if (left || right) {
      this.blocked = true;
      this.releaseCs = ctx.clock.centiseconds;
    }
  }

  /** Zone fausse : 30 couleurs au hasard (`1bda:05e0..067a`), une par image. */
  private updateFlash(ctx: SceneContext): void {
    const entry = this.run.lastWrong;
    const r = ctx.rng.below(127);
    const g = ctx.rng.below(127);
    const b = ctx.rng.below(127);
    this.run.palette.set([r, g, b], entry * 3);
    ctx.palette.load(this.run.palette);
    if (++this.flashes >= FLASH_COUNT) this.phase = "play";
  }

  // --- Fin --------------------------------------------------------------------------------------------

  /** Les zones retrouvent leur vraie couleur l'une après l'autre (`1bda:07d0..0819`). */
  private beginEnding(): void {
    this.revealed = REGION_FIRST;
    this.phase = "reveal";
  }

  private updateReveal(ctx: SceneContext): void {
    this.run.reveal(this.revealed);
    ctx.palette.load(this.run.palette);
    if (++this.revealed < REGION_END) return;
    // `1343:0037` : fondu sonore, puis le son est coupé.
    this.hushing.start(ctx, this.startVolume);
    this.phase = "soundFade";
  }

  private updateSoundFade(ctx: SceneContext): void {
    if (!this.hushing.update(ctx)) return;
    ctx.voice.holdMusic(true);
    // Les secondes sont lues ici, après le dévoilement et le fondu (`DS:1726 = 1f33:019a(2)`, `1bda:0843`).
    this.measured = this.elapsed(ctx);
    if (!this.failed && this.measured < this.limit) {
      this.outcomeKind = "won";
      this.voiceName = voiceName("s35c", 1 + ctx.rng.below(6));
      this.points = coloringPoints(this.measured, this.limit);
    } else {
      this.outcomeKind = this.failed ? "wrong" : "timeout";
      this.voiceName = voiceName("s35b", (this.failed ? 1 : 3) + ctx.rng.below(2));
      this.points = 0;
    }
    this.voiceStarted = false;
    this.phase = "voice";
  }

  /** La voix de fin (`15f9:0e1c`, puis `1f33:03a7(1)` : un clic la coupe), puis 3 s de pause. */
  private updateVoice(ctx: SceneContext): void {
    if (!this.voiceStarted) {
      ctx.voice.play(this.voices.get(this.voiceName)!);
      this.voiceStarted = true;
      return;
    }
    if (ctx.voice.voicePlaying) {
      if (ctx.input.justPressed("validate")) ctx.voice.stop();
      return;
    }
    if (ctx.input.pressed("validate") || ctx.input.pressed("cancel")) return;
    this.pauseStart = ctx.clock.ticks;
    this.phase = "pause";
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    // L'original restaure le fond (sans curseur) puis fond au noir.
    this.cursorVisible = false;
    this.onDone(ctx, pointsOutcome(this.points));
  }
}

export const createColoring: MinigameFactory = (game, onDone) => new ColoringScene(game, onDone);
