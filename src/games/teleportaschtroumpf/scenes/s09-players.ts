import type { Hy8 } from "../data/hy8";
import type { Mcg } from "../data/mcg";
import type { Voc } from "../data/voc";
import { Menu } from "../engine/menu";
import { voiceName } from "../engine/paths";
import type { Scene, SceneContext } from "../engine/scene";
import { centisecondsToTicks } from "./setup/common";

/** Nombre de joueurs minimal et maximal (silhouettes du fond). */
const MIN_PLAYERS = 1;
const MAX_PLAYERS = 4;

/** Position (bord gauche, ligne du bas) du sprite 0 de `s09a000s.hy8` qui colore les silhouettes 2, 3 et 4 (`21ee:0315..0373`). */
const COLORED_X = [0x7c, 0xae, 0xe0];
const COLORED_Y = 0x6d;

/** Attentes de l'original, en centièmes de seconde : entre la voix d'accueil et la voix du premier choix (`1f33:00fc(0xf)`). */
const GAP_CS = 0xf;

/** Voix `s09v00Nt.voc` : 1 à 3 accueil (au hasard), 4 à 7 « n joueurs » (3 + n), 8 à 11 validation. */
const VOICE_COUNT = 11;
const hintVoice = (players: number): number => 3 + players;

/**
 * S09 : nombre de joueurs (engine.md §6.2, `21ee:01d2`).
 *
 * - reçoit : rien ;
 * - rend : `onDone(ctx, players)` avec `players` = 1 à 4 (clic gauche / Espace sur le nombre choisi) ;
 * - écran suivant (décidé par `flow.ts`, pas par l'écran) : S08 (`goCharacters(ctx, players)`) ;
 * - fonds et sons : `s09a001d.mcg` (fondu d'entrée), `s09a000s.hy8` (sprite 0 : bonhomme coloré), voix `s09v00Nt.voc`.
 *
 * Déroulé de l'original : fondu d'entrée, voix d'accueil `s09v00(1 + rand % 3)` (un clic gauche la coupe), pause de
 * 15 cs, voix `s09v004` (« 1 joueur »), puis la sélection. Gauche / droite changent le nombre **sans rebouclage**
 * (borné à 1 et 4) et chaque changement joue la voix `s09v00(3 + n)` jusqu'à sa fin, sans lire les entrées pendant ce
 * temps. À la validation : voix `s09v008` ou `011` (1 joueur) / `009` ou `010` (2 à 4), coupée par un clic gauche, puis
 * le nombre est rendu. Aucune musique pendant l'écran (la voix la coupe et la boucle ne la relance pas).
 *
 * Clavier d'origine seul : les boutons de la souris valident (gauche) sans tenir compte de la position du pointeur.
 */
export function createPlayersScene(onDone: (ctx: SceneContext, players: number) => void): Scene {
  return new PlayersScene(onDone);
}

type Phase = "fadeIn" | "welcome" | "gap" | "hint" | "select" | "voice" | "confirm" | "done";

class PlayersScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private voices: Voc[] = [];
  private phase: Phase = "fadeIn";
  private waitStart = 0;
  /** Gauche / droite : 1 à 4 joueurs, bornés (l'original ne reboucle pas). */
  private readonly menu = new Menu({ items: Array.from({ length: MAX_PLAYERS }, () => ({})), axis: "horizontal", wrap: false });

  constructor(private readonly onDone: (ctx: SceneContext, players: number) => void) {}

  async load(ctx: SceneContext): Promise<void> {
    const [mcg, sprites, ...voices] = await Promise.all([
      ctx.resources.mcg("s09a001d.mcg"),
      ctx.resources.hy8("s09a000s.hy8"),
      ...Array.from({ length: VOICE_COUNT }, (_, i) => ctx.resources.voc(voiceName("s09v", i + 1))),
    ]);
    this.mcg = mcg;
    this.sprites = sprites;
    this.voices = voices;
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    ctx.fade.blackout();
    ctx.fade.in();
    this.phase = "fadeIn";
    this.menu.select(ctx, 0);
    // Pas de musique dans cet écran : la voix la coupe et l'original ne la relance pas.
    ctx.voice.holdMusic(true);
  }

  exit(ctx: SceneContext): void {
    ctx.voice.holdMusic(false);
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "fadeIn":
        if (ctx.fade.active) return;
        ctx.voice.play(this.voice(1 + ctx.rng.below(3)));
        this.phase = "welcome";
        break;
      case "welcome":
        if (this.waitVoice(ctx, true)) this.startWait(ctx, "gap");
        break;
      case "gap":
        if (ctx.clock.ticks - this.waitStart < centisecondsToTicks(GAP_CS)) return;
        ctx.voice.play(this.voice(hintVoice(this.players)));
        this.phase = "hint";
        break;
      case "hint":
        if (this.waitVoice(ctx, false)) this.phase = "select";
        break;
      case "select":
        this.select(ctx);
        break;
      case "voice":
        if (this.waitVoice(ctx, false)) this.phase = "select";
        break;
      case "confirm":
        if (this.waitVoice(ctx, true)) {
          this.phase = "done";
          this.onDone(ctx, this.players);
        }
        break;
      case "done":
        break;
    }
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    // Le nombre de joueurs colore les silhouettes 2 à n (le premier bonhomme est déjà coloré dans le fond).
    for (let k = 0; k < this.players - 1; k++) ctx.surface.drawSprite(this.sprites, 0, COLORED_X[k], COLORED_Y);
  }

  /** Nombre de joueurs choisi (l'index du menu + 1). */
  private get players(): number {
    return MIN_PLAYERS + this.menu.index;
  }

  private voice(n: number): Voc {
    return this.voices[n - 1];
  }

  private startWait(ctx: SceneContext, phase: Phase): void {
    this.phase = phase;
    this.waitStart = ctx.clock.ticks;
  }

  /** Attente de la fin de la voix (`1f33:03a7`) ; avec `skippable`, un clic gauche la coupe. Vrai quand elle est finie. */
  private waitVoice(ctx: SceneContext, skippable: boolean): boolean {
    if (skippable && ctx.input.justPressed("validate")) ctx.voice.stop();
    return !ctx.voice.voicePlaying;
  }

  /** Une itération de la boucle de sélection : gauche / droite, puis validation. */
  private select(ctx: SceneContext): void {
    const before = this.menu.index;
    const event = this.menu.update(ctx);
    if (this.menu.index !== before) {
      ctx.voice.play(this.voice(hintVoice(this.players)));
      this.phase = "voice";
      return;
    }
    if (event?.kind === "validate") {
      ctx.voice.play(this.voice(this.confirmVoice(ctx)));
      this.phase = "confirm";
    }
  }

  /** 1 joueur : voix 8 ou 11 ; 2 à 4 joueurs : voix 9 ou 10 (`21ee:03c3..0401`). */
  private confirmVoice(ctx: SceneContext): number {
    const variant = ctx.rng.below(2);
    return this.players === 1 ? 8 + variant * 3 : 9 + variant;
  }
}
