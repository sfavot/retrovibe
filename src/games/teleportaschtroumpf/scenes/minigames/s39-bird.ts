import type { Hy8 } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import { BIRD_HINT_SCENES } from "../../game/tables";
import { Clip, minigameRequest, type AftermathFactory, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S39 « L'Oiseau » (`265b:000d`, 968 octets ; RE : `docs/teleportaschtroumpf/minigames/s39.md`).
 *
 * ### `createBird(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 39) ; ni niveau ni indice de l'oiseau n'ont de sens ici ;
 * - joue : une histoire en vidéos MUX (`s39a1` à `s39m3`), non passables. Seul, le joueur voit l'une des cinq histoires courtes (a à e) ;
 *   à plusieurs, l'une des trois longues (avec les vidéos k). Après la vidéo `k2`, l'original attend un clic (60 s au plus) ;
 * - rend : `onDone(ctx, { kind: "none" })` à la fin de la dernière vidéo ; `Game.resolveMinigame` tire alors la scène désignée
 *   (`resolveBird`) et pose l'indice.
 *
 * ### `createBirdAftermath(game, events, onDone)`
 *
 * Après l'histoire : la carte de la région du lieu désigné, une main sur ce lieu, la voix qui le nomme, puis une demi-seconde de pause ;
 * `onDone(ctx)` est rendu une fois (l'appelant retire la scène).
 */

/** Les huit histoires (`DS:2606`, 27 octets chacune : des paires de caractères, terminées par « 00 ») : fichiers `s39<nom>.mux`. */
export const BIRD_STORIES: readonly (readonly string[])[] = [
  ["a1", "h1", "g1", "h2", "g2", "a2"],
  ["b1", "h1", "g1", "h2", "g2", "b2"],
  ["c1", "i1", "i2", "c2"],
  ["d1", "d2", "j1", "j2", "d3"],
  ["e1", "h1", "g1", "h2", "g2", "e2"],
  ["a1", "k1", "f1", "k2", "f2", "g1", "k3", "a2"],
  ["b1", "k1", "f1", "k2", "f2", "g1", "k3", "b2"],
  ["e1", "k1", "f1", "k2", "f2", "g1", "k3", "e2"],
];

/** Vidéo après laquelle l'original attend un clic (`1f33:0279(0x3c)` : 60 s au plus). */
export const WAIT_CLIP = "k2";
export const WAIT_SECONDS = 60;

/** Histoire tirée : une seule partie à un joueur → 0..4 (`rand × 32000 / 0x8000 % 5`), plusieurs → 5..7 (`% 3 + 5`). */
export function pickStory(roll32000: number, players: number): number {
  return players === 1 ? roll32000 % 5 : (roll32000 % 3) + 5;
}

/** Fichier MUX d'une vidéo d'histoire : `a1` → `s39a1.mux`. */
export function storyFile(name: string): string {
  return `s39${name}.mux`;
}

export class BirdScene implements Scene {
  readonly step = 1;
  private story = 0;
  private clips: Clip[] = [];
  private index = 0;
  private stage: "clip" | "gap" | "wait" | "done" = "clip";
  private waitStart = 0;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 39);
  }

  /** Histoire jouée (0..7), vidéo en cours et phase (pour les tests). */
  get storyIndex(): number {
    return this.story;
  }

  get files(): string[] {
    return this.clips.map((c) => c.file);
  }

  get clipIndex(): number {
    return this.index;
  }

  get phase(): "clip" | "gap" | "wait" | "done" {
    return this.stage;
  }

  async load(ctx: SceneContext): Promise<void> {
    // Un seul tirage, avant les vidéos (`265b:0025`).
    this.story = pickStory(ctx.rng.below(32000), this.game.state.players.length);
    this.clips = BIRD_STORIES[this.story].map((name) => new Clip(storyFile(name), (c) => this.clipEnded(c, name), { skippable: false }));
    await Promise.all(this.clips.map((clip) => clip.load(ctx)));
  }

  enter(ctx: SceneContext): void {
    this.index = 0;
    this.done = false;
    this.stage = "clip";
    this.clips[0].start(ctx);
  }

  update(ctx: SceneContext): void {
    switch (this.stage) {
      case "clip":
        this.clips[this.index].update(ctx);
        return;
      case "gap":
        this.index++;
        this.stage = "clip";
        this.clips[this.index].start(ctx);
        return;
      case "wait":
        // `1f33:0279` : un clic (Espace, bouton gauche) ou 60 s.
        if (ctx.input.justPressed("validate") || ctx.clock.ticks - this.waitStart >= WAIT_SECONDS * 60) this.advance(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    this.clips[this.index]?.render(ctx);
  }

  exit(ctx: SceneContext): void {
    for (const clip of this.clips) clip.stop(ctx);
  }

  private clipEnded(ctx: SceneContext, name: string): void {
    if (name === WAIT_CLIP) {
      this.stage = "wait";
      this.waitStart = ctx.clock.ticks;
      return;
    }
    this.advance(ctx);
  }

  private advance(ctx: SceneContext): void {
    if (this.index + 1 < this.clips.length) {
      this.stage = "gap";
      return;
    }
    if (this.done) return;
    this.done = true;
    this.stage = "done";
    this.onDone(ctx, { kind: "none" });
  }
}

export const createBird: MinigameFactory = (game, onDone) => new BirdScene(game, onDone);

// --- Après l'histoire -----------------------------------------------------------------------------------

/** Région de la carte (`s02a00<4 + région>d.mcg`), position de la main (point de la carte) pour chacune des 17 scènes de `BIRD_HINT_SCENES`, et voix. */
export const BIRD_PLACES: readonly { region: number; x: number; y: number; voice: number }[] = [
  { region: 0, x: 0x95, y: 0xcc, voice: 0 },
  { region: 0, x: 0x13c, y: 0xd7, voice: 8 },
  { region: 0, x: 0x99, y: 0x85, voice: 9 },
  { region: 0, x: 0x73, y: 0xb7, voice: 10 },
  { region: 0, x: 0x116, y: 0x70, voice: 14 },
  { region: 1, x: 0xfb, y: 0xcb, voice: 2 },
  { region: 1, x: 0x6f, y: 0x7d, voice: 3 },
  { region: 1, x: 0xdf, y: 0xab, voice: 16 },
  { region: 1, x: 0xc7, y: 0xd1, voice: 6 },
  { region: 1, x: 0x6b, y: 0x87, voice: 12 },
  { region: 1, x: 0xc7, y: 0x66, voice: 5 },
  { region: 2, x: 0x82, y: 0xab, voice: 1 },
  { region: 2, x: 0x4f, y: 0x56, voice: 4 },
  { region: 2, x: 0xb8, y: 0xa6, voice: 7 },
  { region: 2, x: 0xb4, y: 0x69, voice: 11 },
  { region: 2, x: 0x11a, y: 0xad, voice: 13 },
  { region: 2, x: 0x114, y: 0x7f, voice: 15 },
];

/** Pause finale : `1f33:00fc(0x32)`, 50 centièmes de seconde. */
const END_PAUSE_TICKS = 30;
/** La main (sprite 0 de `s25a000s.hy8`) est posée à (x − 0x20, y − 0x28). */
const HAND_DX = -0x20;
const HAND_DY = -0x28;

export class BirdAftermathScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private hand!: Hy8;
  private voc!: Voc;
  private stage: "intro" | "voice" | "pause" | "done" = "intro";
  private pauseStart = 0;
  private voiceStarted = false;
  private done = false;

  constructor(
    readonly hintScene: number,
    private readonly onDone: (ctx: SceneContext) => void,
  ) {}

  get place(): (typeof BIRD_PLACES)[number] {
    return BIRD_PLACES[BIRD_HINT_SCENES.indexOf(this.hintScene)];
  }

  get phase(): "intro" | "voice" | "pause" | "done" {
    return this.stage;
  }

  async load(ctx: SceneContext): Promise<void> {
    const place = this.place;
    [this.mcg, this.hand, this.voc] = await Promise.all([
      ctx.resources.mcg(`s02a00${place.region + 4}d.mcg`),
      ctx.resources.hy8("s25a000s.hy8"),
      ctx.resources.voc(voiceName("s39v", 6 + place.voice)),
    ]);
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    this.stage = "intro";
    this.voiceStarted = false;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.stage) {
      case "intro":
        // La carte fond d'abord, la main est posée ensuite (`13fc:0150(…, 1)` puis `31fe:0481`).
        if (ctx.fade.active) return;
        this.stage = "voice";
        return;
      case "voice":
        if (!this.voiceStarted) {
          ctx.voice.play(this.voc);
          this.voiceStarted = true;
          return;
        }
        if (ctx.voice.voicePlaying) return;
        this.stage = "pause";
        this.pauseStart = ctx.clock.ticks;
        return;
      case "pause":
        if (ctx.clock.ticks - this.pauseStart < END_PAUSE_TICKS || this.done) return;
        this.done = true;
        this.stage = "done";
        this.onDone(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    if (this.stage === "intro") return;
    const { x, y } = this.place;
    ctx.surface.drawSprite(this.hand, 0, x + HAND_DX, y + HAND_DY);
  }
}

/** La scène désignée par l'événement `bird` de `Game.resolveMinigame` ; `null` s'il n'y en a pas. */
export const createBirdAftermath: AftermathFactory = (_game, events, onDone) => {
  const bird = events.find((e) => e.type === "bird");
  if (!bird || bird.type !== "bird" || !BIRD_HINT_SCENES.includes(bird.scene)) return null;
  return new BirdAftermathScene(bird.scene, onDone);
};
