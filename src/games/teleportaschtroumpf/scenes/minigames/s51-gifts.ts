import type { Hy8 } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import type { MinigameRequest } from "../../game/state";
import { Clip, Pointer, minigameRequest, pointsOutcome, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S51 « Les Cadeaux » (`19a8:0006`, 2 365 octets ; RE : `docs/teleportaschtroumpf/minigames/s51.md`).
 *
 * ### `createGifts(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 51) : `level` 0..2 (la chance de tomber sur le
 *   cadeau piégé est de 1 sur `level + 3`), `bonus` (indice de l'oiseau) la ramène à 1 sur 3, comme le niveau 0 (l'original la mettait à 1 sur 2 : défaut corrigé) ; `character` choisit
 *   la voix de l'échec ;
 * - joue : dix ou onze cadeaux fermés sur l'un des trois fonds, tirés au hasard. La souris (ou les flèches, Espace pour cliquer) ouvre
 *   un cadeau d'un clic ; l'un d'eux, tiré à chaque ouverture, est piégé et met fin à la partie. Un clic sur la bougie à gauche
 *   (ou l'ouverture de tous les cadeaux) arrête la partie en gardant le butin ;
 * - rend : `onDone(ctx, { kind: "points", points })` après la voix de fin : autant de points que de cadeaux ouverts (0 à 10 ou 11 ;
 *   `Game` plafonne le total à 60) ; 0 si un cadeau piégé a été ouvert (vidéo `s51b`, voix `s51b00N`). L'appelant applique l'issue.
 */

/** Cadeau d'un fond : position (bord gauche, ligne du bas), sprite fermé (le sprite ouvert est `base + 5`) et zone cliquable (bornes exclues). */
export type GiftSpec = readonly [x: number, y: number, base: number, minX: number, minY: number, maxX: number, maxY: number];

/** Les trois fonds `s51a001d` à `s51a003d` (tableaux recopiés par `19a8:0006` depuis `DS:1194`, `DS:1270` et `DS:134C`, 10 mots par cadeau). */
export const GIFT_LAYOUTS: readonly (readonly GiftSpec[])[] = [
  [
    [130, 84, 16, 109, 13, 157, 55],
    [258, 58, 22, 235, 10, 284, 56],
    [197, 65, 28, 176, 15, 220, 57],
    [241, 109, 28, 218, 63, 253, 107],
    [169, 102, 22, 146, 59, 193, 97],
    [276, 129, 22, 254, 83, 300, 126],
    [85, 90, 28, 63, 41, 107, 90],
    [131, 152, 22, 108, 105, 150, 149],
    [175, 185, 28, 154, 137, 198, 184],
    [225, 168, 22, 202, 121, 247, 164],
  ],
  [
    [81, 86, 22, 58, 37, 104, 79],
    [136, 78, 16, 108, 12, 169, 66],
    [114, 124, 28, 91, 82, 138, 116],
    [69, 129, 22, 45, 84, 89, 121],
    [202, 59, 28, 179, 13, 224, 52],
    [170, 125, 28, 146, 79, 194, 118],
    [124, 185, 16, 94, 119, 158, 171],
    [223, 130, 22, 200, 83, 245, 122],
    [184, 197, 28, 160, 149, 207, 191],
    [290, 90, 28, 266, 42, 314, 83],
    [276, 174, 16, 246, 108, 310, 164],
  ],
  [
    [166, 62, 22, 142, 14, 187, 54],
    [90, 85, 16, 62, 15, 123, 74],
    [153, 120, 22, 129, 74, 176, 113],
    [91, 139, 28, 69, 92, 113, 133],
    [142, 168, 28, 118, 121, 166, 162],
    [223, 78, 16, 194, 13, 258, 67],
    [201, 148, 28, 179, 100, 224, 144],
    [290, 90, 28, 266, 43, 314, 85],
    [280, 163, 16, 250, 98, 314, 146],
    [291, 195, 22, 267, 148, 314, 190],
  ],
];

/** Sprite du curseur dans `s51a000s.hy8` (`0x22`) et bornes du pointeur : `x ≥ 0x21`, `y ≤ 0xA5` (`19a8:0371..0398`). */
export const CURSOR_SPRITE = 0x22;
export const POINTER_BOUNDS = { minX: 0x21, maxX: 319, minY: 0, maxY: 0xa5 } as const;

/** La bougie de gauche (bouton d'arrêt) : position de son sprite, et zone cliquable (bornes exclues) sur la position bornée du pointeur. */
export const CANDLE_X = 0x1e;
export const CANDLE_Y = 0x86;
export const STOP_ZONE = { minX: 0x19, maxX: 0x23, minY: 0x7c, maxY: 0x90 } as const;

/** Sprites de la flamme de la bougie : vacillement en boucle (7 à 10), flamme d'échec, extinction en cas de réussite (11 à 15). */
export const IDLE_FIRST = 7;
export const IDLE_LAST = 10;
export const FAIL_CANDLE = 11;
export const LEAVE_FIRST = 11;
export const LEAVE_LAST = 15;

/** Images d'ouverture d'un cadeau : 6 (`base + 0` à `base + 5`) ; le cadeau piégé s'arrête à la 3e (`base + 2`). */
export const OPEN_FRAMES = 6;
export const TRAP_FRAMES = 3;

/** Cadence de la boucle (`1f33:0348(5)`) : une itération tous les 5 ticks. */
const LOOP_TICKS = 5;
/** Attente avant la boucle (`1f33:00fc(0x14)` : 20 centièmes de seconde). */
const INTRO_TICKS = 12;
/** Tirage de l'ouverture : `rand × 32000 / 0x8000 % diviseur`, piégé quand le reste est 1 (`19a8:0491..04b4`). */
const ROLL_RANGE = 32000;
/** Couleur de remplissage de l'écran après la vidéo d'échec (`lib_memset(…, 0x7E, 64000)`). */
const FAIL_FILL = 0x7e;

/**
 * Diviseur du tirage : `niveau + 3` (3, 4 ou 5) ; avec l'indice de l'oiseau, le niveau le plus facile (3).
 * Défaut de l'original corrigé (2026-10-23) : il prenait 2 (`19a8:0014..0030`), pire que tous les niveaux.
 */
export function trapDivisor(level: number, bonus: boolean): number {
  return bonus ? 3 : level + 3;
}

/** Numéro de la voix de réussite `s51c00N` : moins de 2 cadeaux → 1, moins de 4 → 2, sinon 3. */
export function successVoice(opened: number): number {
  if (opened < 2) return 1;
  if (opened < 4) return 2;
  return 3;
}

/** Numéro de la voix d'échec `s51b00N` : 1 ou 2, 3 ou 4 pour le personnage 4 (`19a8:08e1`, un seul tirage `rand × 2`). */
export function failureVoice(character: number, roll: number): number {
  return (character === 4 ? 3 : 1) + roll;
}

/** État d'un cadeau (`+0x12` de l'enregistrement) : fermé, ouvert, en train de s'ouvrir. */
export const GIFT_CLOSED = 0;
export const GIFT_OPEN = 1;
export const GIFT_OPENING = 2;
export type GiftState = typeof GIFT_CLOSED | typeof GIFT_OPEN | typeof GIFT_OPENING;

interface Gift {
  x: number;
  y: number;
  base: number;
  area: readonly [minX: number, minY: number, maxX: number, maxY: number];
  state: GiftState;
  /** Image d'ouverture en cours (`+6`). */
  counter: number;
  /** Sprite dessiné (`+8`). */
  sprite: number;
}

export type GiftsPhase = "intro" | "play" | "tada" | "video" | "voice" | "done";

export class GiftsScene implements Scene {
  readonly step = 1;
  private readonly request: MinigameRequest;
  private readonly divisor: number;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private pointer!: Pointer;
  private openSound!: Voc;
  private tadaSound!: Voc;
  private successVoices: Voc[] = [];
  private failureVoices: Voc[] = [];
  private fail!: Clip;
  private layoutIndex = 0;
  private gifts: Gift[] = [];
  private phase: GiftsPhase = "intro";
  private introStart = 0;
  private nextAt = 0;
  private count = 0;
  private clicked = false;
  private candle: number | null = null;
  private idle = IDLE_FIRST;
  private leave = LEAVE_FIRST;
  private showCursor = true;
  private opened = 0;
  private trapped = false;
  private stopped = false;
  private ended = false;
  private failed = false;
  private cleared = false;
  private earned = 0;
  private done = false;

  constructor(
    game: Game,
    private readonly onDone: MinigameDone,
  ) {
    this.request = minigameRequest(game, 51);
    this.divisor = trapDivisor(this.request.level, this.request.bonus);
  }

  get stage(): GiftsPhase {
    return this.phase;
  }

  /** Fond tiré, de 0 à 2 (`s51a001d` à `s51a003d`). */
  get layout(): number {
    return this.layoutIndex;
  }

  /** Une chance sur `trapChance` de tomber sur le cadeau piégé à chaque ouverture. */
  get trapChance(): number {
    return this.divisor;
  }

  /** État des cadeaux du fond (pour les tests). */
  get states(): readonly GiftState[] {
    return this.gifts.map((g) => g.state);
  }

  /** Sprite dessiné pour chaque cadeau (`base` fermé, `base + 5` ouvert, `base + 2` piégé ; pour les tests). */
  get giftSprites(): readonly number[] {
    return this.gifts.map((g) => g.sprite);
  }

  /** Sprite de la flamme de la bougie de gauche, `null` s'il n'est pas dessiné (pour les tests). */
  get candleSprite(): number | null {
    return this.candle;
  }

  /** Cadeaux dont l'ouverture est finie (`iRam375e6`) ; remis à 0 après un cadeau piégé. */
  get openedCount(): number {
    return this.opened;
  }

  /** Vrai quand un cadeau piégé a été tiré. */
  get hitTrap(): boolean {
    return this.trapped;
  }

  /** Vrai si la partie s'arrête sur un cadeau piégé terminé d'ouvrir (échec). */
  get hasFailed(): boolean {
    return this.failed;
  }

  /** Itérations de la boucle faites (pour les tests). */
  get iterations(): number {
    return this.count;
  }

  /** Points rendus à l'appelant (0 tant que la partie n'est pas finie). */
  get points(): number {
    return this.earned;
  }

  async load(ctx: SceneContext): Promise<void> {
    // Premier tirage de l'original : le fond, de 1 à 3 (`rand × 3 / 0x8000 + 1`).
    this.layoutIndex = ctx.rng.below(GIFT_LAYOUTS.length);
    this.fail = new Clip("s51b.mux", (c) => this.videoEnded(c));
    [this.mcg, this.sprites, this.openSound, this.tadaSound, this.successVoices, this.failureVoices] = await Promise.all([
      ctx.resources.mcg(`s51a00${this.layoutIndex + 1}d.mcg`),
      ctx.resources.hy8("s51a000s.hy8"),
      ctx.resources.voc("s51a001b.voc"),
      // Le son de fin est celui de S29 (`s29a002b.voc`, chaîne en `DS:1450`).
      ctx.resources.voc("s29a002b.voc"),
      Promise.all([1, 2, 3].map((n) => ctx.resources.voc(voiceName("s51c", n)))),
      Promise.all([0, 1].map((roll) => ctx.resources.voc(voiceName("s51b", failureVoice(this.request.character, roll))))),
      this.fail.load(ctx),
    ]);
    this.pointer = new Pointer({ sprites: this.sprites, sprite: CURSOR_SPRITE, bounds: POINTER_BOUNDS });
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    // `14b3:0039` : le curseur est replacé au centre de l'écran.
    ctx.input.mouseMove(0xa0, 0x64);
    this.gifts = GIFT_LAYOUTS[this.layoutIndex].map(([x, y, base, minX, minY, maxX, maxY]) => ({
      x,
      y,
      base,
      area: [minX, minY, maxX, maxY] as const,
      state: GIFT_CLOSED,
      counter: 0,
      sprite: base,
    }));
    this.phase = "intro";
    this.introStart = ctx.clock.ticks;
    this.count = 0;
    this.clicked = false;
    this.candle = null;
    this.idle = IDLE_FIRST;
    this.leave = LEAVE_FIRST;
    this.showCursor = true;
    this.opened = 0;
    this.trapped = false;
    this.stopped = false;
    this.ended = false;
    this.failed = false;
    this.cleared = false;
    this.earned = 0;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "intro":
        if (ctx.fade.active) {
          this.introStart = ctx.clock.ticks;
          return;
        }
        this.pointer.update(ctx);
        if (ctx.clock.ticks - this.introStart < INTRO_TICKS) return;
        // Une seule itération d'introduction : la flamme apparaît (image 1), puis la boucle commence.
        this.candle = 1;
        this.nextAt = ctx.clock.ticks + LOOP_TICKS;
        this.phase = "play";
        return;
      case "play":
        this.pointer.update(ctx);
        this.clicked ||= ctx.input.pressed("validate") || ctx.input.justPressed("validate");
        if (ctx.clock.ticks < this.nextAt) return;
        if (this.ended) return this.beginEnding(ctx);
        this.iterate(ctx);
        return;
      case "tada":
        if (ctx.clock.ticks < this.nextAt) return;
        this.tadaStep(ctx);
        return;
      case "video":
        this.fail.update(ctx);
        return;
      case "voice":
        if (ctx.voice.voicePlaying && !ctx.input.justPressed("validate")) return;
        // Un clic gauche coupe la voix (`1f33:03a7(1)`).
        ctx.voice.stop();
        this.finish(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    if (this.phase === "video") {
      this.fail.render(ctx);
      return;
    }
    const { surface } = ctx;
    if (this.cleared) {
      surface.clear(FAIL_FILL);
      return;
    }
    surface.restoreBackground();
    for (const gift of this.gifts) surface.drawSprite(this.sprites, gift.sprite, gift.x, gift.y);
    if (this.candle !== null) surface.drawSprite(this.sprites, this.candle, CANDLE_X, CANDLE_Y);
    if (this.showCursor) this.pointer.draw(ctx);
  }

  exit(ctx: SceneContext): void {
    this.fail.stop(ctx);
    ctx.voice.holdMusic(false);
  }

  /** Une itération de la boucle de `19a8:0290..0690` : animation de la flamme, arrêt, clic sur un cadeau, animation d'ouverture. */
  private iterate(ctx: SceneContext): void {
    this.nextAt = ctx.clock.ticks + LOOP_TICKS;
    this.count++;
    const click = this.clicked;
    this.clicked = false;
    const { x, y } = this.pointer.position(ctx);

    this.idle = this.idle + 1 > IDLE_LAST ? IDLE_FIRST : this.idle + 1;
    this.candle = this.idle;

    if (click && x > STOP_ZONE.minX && x < STOP_ZONE.maxX && y > STOP_ZONE.minY && y < STOP_ZONE.maxY) this.stopped = true;
    if (this.opened >= this.gifts.length) this.stopped = true;

    for (const gift of this.gifts) {
      const [minX, minY, maxX, maxY] = gift.area;
      if (click && x > minX && x < maxX && y > minY && y < maxY && gift.state === GIFT_CLOSED) {
        gift.state = GIFT_OPENING;
        // Un tirage par ouverture ; hors cadeau piégé, le bruit d'ouverture (bruitage mélangé `348d:0b42`) ne se lance que si aucun bruitage ne sonne.
        if (ctx.rng.below(ROLL_RANGE) % this.divisor === 1) this.trapped = true;
        else if (!ctx.voice.effectPlaying) ctx.voice.playEffect(this.openSound);
      }
      if (gift.state === GIFT_OPENING) {
        gift.sprite = gift.base + gift.counter;
        gift.counter++;
      }
      if (!this.trapped) {
        if (gift.counter > OPEN_FRAMES - 1) {
          gift.counter = 0;
          gift.state = GIFT_OPEN;
          this.opened++;
        }
      } else if (gift.counter > TRAP_FRAMES - 1) {
        gift.counter = 0;
        gift.state = GIFT_OPEN;
        this.failed = true;
      }
    }
    if (this.failed || this.stopped) this.ended = true;
  }

  /** Après la dernière itération (et son attente de cadence) : la fin selon que le cadeau piégé est ouvert ou non. */
  private beginEnding(ctx: SceneContext): void {
    this.showCursor = false;
    ctx.voice.stop();
    ctx.voice.holdMusic(true);
    if (!this.failed) {
      this.leave = LEAVE_FIRST;
      this.phase = "tada";
      this.nextAt = ctx.clock.ticks;
      return;
    }
    // Échec : le butin est perdu, la flamme change, puis la vidéo `s51b` (passable, `154c:0954`).
    this.opened = 0;
    this.candle = FAIL_CANDLE;
    this.phase = "video";
    this.fail.start(ctx);
  }

  /** Sortie en cas de réussite (`19a8:07f3..08ad`) : 6 itérations, la flamme s'éteint (images 11 à 15) et le son de fin se rejoue. */
  private tadaStep(ctx: SceneContext): void {
    this.nextAt = ctx.clock.ticks + LOOP_TICKS;
    this.candle = this.leave <= LEAVE_LAST ? this.leave : null;
    if (!ctx.voice.effectPlaying) ctx.voice.playEffect(this.tadaSound);
    this.leave++;
    if (this.leave <= LEAVE_LAST + 1) return;
    // Fin : la voie est coupée, puis la voix `s51c00N` (la même d'un cadeau à l'autre, selon le butin).
    ctx.voice.stop();
    ctx.voice.holdMusic(true);
    this.candle = null;
    this.earned = this.opened;
    ctx.voice.play(this.successVoices[successVoice(this.opened) - 1]);
    this.phase = "voice";
  }

  /** Fin de la vidéo d'échec : l'écran est vidé, puis la voix `s51b00N`. */
  private videoEnded(ctx: SceneContext): void {
    this.cleared = true;
    this.phase = "voice";
    ctx.voice.holdMusic(true);
    const roll = ctx.rng.below(2);
    ctx.voice.play(this.failureVoices[roll]);
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, pointsOutcome(this.earned));
  }
}

export const createGifts: MinigameFactory = (game, onDone) => new GiftsScene(game, onDone);
