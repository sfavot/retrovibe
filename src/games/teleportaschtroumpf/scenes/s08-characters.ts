import type { Hy8 } from "../data/hy8";
import type { Mcg } from "../data/mcg";
import type { Voc } from "../data/voc";
import type { PlayerSetup } from "../game/rules";
import { Menu, paletteHighlight, spriteArea } from "../engine/menu";
import { voiceName } from "../engine/paths";
import type { Scene, SceneContext } from "../engine/scene";
import { CLICK_SOUND, centisecondsToTicks } from "./setup/common";

/** Issue de S08 (`21ee:0c19`, engine.md §6.2) : 0 = jouer, 1 = retour à S09, 2 = retour au menu S07. */
export type CharactersResult =
  /** Un personnage (0..5) et un niveau (0..2) par joueur, dans l'ordre de jeu ; devient `GameSetup.players`. */
  | { action: "play"; players: PlayerSetup[] }
  | { action: "back" }
  | { action: "menu" };

/** Mise en place des emplacements selon le nombre de joueurs (`21ee:04fe..0615`) : un tableau par joueur. */
interface SlotLayout {
  /** Abscisse (bord gauche du sprite) du pot, du personnage et de la capsule. */
  x: number[];
  /** Sprite de pot (`s08a000s.hy8` 0 à 3). */
  jar: number[];
  /** Abscisse de l'icône de niveau. */
  levelX: number[];
  /** Entrée de palette de la couleur de niveau de l'emplacement (`DS:706E`). */
  paletteEntry: number[];
  /** Sprite de capsule (10 à 13). */
  capsule: number[];
}

const LAYOUTS: Readonly<Record<number, SlotLayout>> = {
  1: { x: [0x83], jar: [1], levelX: [0x7d], paletteEntry: [0x72], capsule: [0xb] },
  2: { x: [0x83, 0xc4], jar: [1, 2], levelX: [0x7d, 200], paletteEntry: [0x72, 0x73], capsule: [0xb, 0xc] },
  3: { x: [0x40, 0x83, 0xc4], jar: [0, 1, 2], levelX: [0x35, 0x7d, 200], paletteEntry: [0x71, 0x72, 0x73], capsule: [0xa, 0xb, 0xc] },
  4: { x: [0x40, 0x83, 0xc4, 0x106], jar: [0, 1, 2, 3], levelX: [0x35, 0x7d, 200, 0x111], paletteEntry: [0x71, 0x72, 0x73, 0x74], capsule: [0xa, 0xb, 0xc, 0xd] },
};

/** Ligne du bas des pots, personnages et capsules, et de l'icône de niveau (`21ee:0882`, `21ee:08a3`). */
const CHARACTER_Y = 100;
const LEVEL_Y = 0xb2;

/** Sprites des 6 personnages (`DS:7051`), leur personnage de jeu (`21ee:0a0c..0a57`) et la base de leur voix `s08v` (`DS:1E6E`). */
const CHARACTER_SPRITES = [4, 5, 6, 7, 8, 9];
const SPRITE_CHARACTER = [4, 0, 5, 2, 1, 3];
const CHARACTER_VOICE = [2, 0, 3, 5, 4, 1];

/** Icônes de niveau : sprite `0x11 + niveau` ; la couleur du niveau est l'entrée de palette `117 + niveau` copiée sur celle de l'emplacement. */
const LEVEL_SPRITE = 0x11;
const LEVEL_COLOR_ENTRY = 117;
const DEFAULT_LEVEL = 1;

/** Boutons de fin (sprites `0xE`, `0xF`, `0x10` en x = `0x109`, y = `0x83`, `0x9B`, `0xB3`) et leurs voix d'aide `s08v012..014`. */
const BUTTON_SPRITES = [0xe, 0xf, 0x10];
const BUTTON_X = 0x109;
const BUTTON_Y = [0x83, 0x9b, 0xb3];
/** Les textes des boutons utilisent les entrées 121 à 123 ; la couleur de survol est l'entrée 125 du MCG. */
const BUTTON_TEXT_ENTRY = 121;
const BUTTON_HOVER_ENTRY = 125;
const BUTTON_VOICE_BASE = 12;
const BUTTON_RESULTS = ["play", "back", "menu"] as const;

/** Voix : 1 à 6 personnages (1 + `DS:1E6E`), 7 à 11 « joueur suivant » (7 + rand % 5), 12 à 14 boutons, 15 à 17 niveaux. */
const VOICE_COUNT = 17;
const LEVEL_VOICE_BASE = 15;
const NEXT_PLAYER_VOICE_BASE = 7;

/** Attentes de l'original en centièmes de seconde (`1f33:00fc`). */
const AFTER_CAPSULE_SOUND_CS = 5;
const HELP_GAP_CS = 0x14;
const NEXT_PLAYER_GAP_CS = 0x28;

/** Capsule : descend de y = 0 à 95 par pas de 5 (une image par tick), puis se pose en y = 100. */
const CAPSULE_STEP = 5;

/**
 * S08 : choix des personnages (engine.md §6.2, `21ee:0435` puis `21ee:0c19`).
 *
 * - reçoit : `players`, le nombre de joueurs (1 à 4) choisi à S09 ;
 * - rend : `onDone(ctx, result)` avec un `CharactersResult` ;
 * - écrans suivants (décidés par `flow.ts`) : `play` → partie, `back` → S09, `menu` → S07 ;
 * - fonds et sons : `s08a001d.mcg`, `s08a000s.hy8`, voix `s08v001..017t.voc`, `s08a001b.voc` (capsule), `s08a002b.voc`
 *   (arrivée), bip de navigation `s07a001b.voc`.
 *
 * Déroulé de l'original : fondu, pots posés sur la table, puis pour chaque joueur : un personnage libre tiré au
 * hasard (gauche / droite : suivant / précédent parmi les libres, avec rebouclage) et un niveau 0 à 2 (haut / bas, 1 au
 * départ, qui colore la capsule). Clic droit / Entrée : voix du personnage puis du niveau. Validation : le personnage est
 * figé, la capsule descend dessus (voix `s08a001b`, puis `s08a002b`), son niveau fixe la couleur de l'emplacement ; entre
 * deux joueurs une voix `s08v007..011`. Une fois tous les joueurs placés, trois boutons verticaux (Jouer, Annuler,
 * Retour) : haut / bas avec rebouclage, clic droit = voix `s08v012..014`, validation = `play` / `back` / `menu`.
 *
 * Clavier d'origine seul : les boutons de la souris valident (gauche) et jouent la voix (droit), sans tenir compte de la
 * position du pointeur. Ajout du port : toucher un des trois boutons de fin le valide.
 */
export function createCharactersScene(players: number, onDone: (ctx: SceneContext, result: CharactersResult) => void): Scene {
  return new CharactersScene(players, onDone);
}

type Phase =
  | "fadeIn"
  | "pick"
  | "helpCharacter"
  | "helpGap"
  | "helpLevel"
  | "helpEnd"
  | "capsuleWait"
  | "capsule"
  | "landing"
  | "nextVoice"
  | "nextGap"
  | "buttons"
  | "buttonHelp"
  | "done";

class CharactersScene implements Scene {
  readonly step = 1;
  private readonly layout: SlotLayout;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private voices: Voc[] = [];
  private click!: Voc;
  private capsuleSound!: Voc;
  private landingSound!: Voc;
  private menu!: Menu;
  private phase: Phase = "fadeIn";
  private phaseStart = 0;

  /** Joueur en cours (emplacement `DS:6E2A`), personnages encore libres, choix courant et choix validés. */
  private slot = 0;
  private readonly free = [true, true, true, true, true, true];
  private character = 0;
  private level = DEFAULT_LEVEL;
  private readonly chosen: PlayerSetup[] = [];
  /** Position de la capsule pendant sa descente. */
  private capsuleY = 0;

  constructor(
    readonly players: number,
    private readonly onDone: (ctx: SceneContext, result: CharactersResult) => void,
  ) {
    const layout = LAYOUTS[players];
    if (!layout) throw new RangeError(`nombre de joueurs invalide : ${players}`);
    this.layout = layout;
  }

  async load(ctx: SceneContext): Promise<void> {
    const [mcg, sprites, click, capsuleSound, landingSound, ...voices] = await Promise.all([
      ctx.resources.mcg("s08a001d.mcg"),
      ctx.resources.hy8("s08a000s.hy8"),
      ctx.resources.voc(CLICK_SOUND),
      ctx.resources.voc("s08a001b.voc"),
      ctx.resources.voc("s08a002b.voc"),
      ...Array.from({ length: VOICE_COUNT }, (_, i) => ctx.resources.voc(voiceName("s08v", i + 1))),
    ]);
    this.mcg = mcg;
    this.sprites = sprites;
    this.click = click;
    this.capsuleSound = capsuleSound;
    this.landingSound = landingSound;
    this.voices = voices;
    const c = mcg.palette.subarray(BUTTON_HOVER_ENTRY * 3, BUTTON_HOVER_ENTRY * 3 + 3);
    const items = BUTTON_Y.map((_, i) => ({ voice: voiceName("s08v", BUTTON_VOICE_BASE + i) }));
    this.menu = new Menu({
      items,
      axis: "vertical",
      highlight: paletteHighlight(BUTTON_TEXT_ENTRY, [c[0], c[1], c[2]]),
      changeSound: CLICK_SOUND,
      areas: () => BUTTON_SPRITES.map((sprite, i) => spriteArea(sprites, sprite, BUTTON_X, BUTTON_Y[i])),
    });
    await this.menu.load(ctx);
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    ctx.fade.blackout();
    ctx.fade.in();
    this.phase = "fadeIn";
    this.slot = 0;
    this.free.fill(true);
    this.chosen.length = 0;
  }

  exit(ctx: SceneContext): void {
    this.menu.exit(ctx);
    ctx.voice.holdMusic(false);
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "fadeIn":
        if (ctx.fade.active) return;
        // Les pots sont posés une fois le fondu terminé (`21ee:04fe..` suit l'affichage du MCG).
        ctx.surface.restoreBackground();
        for (let i = 0; i < this.players; i++) ctx.surface.drawSprite(this.sprites, this.layout.jar[i], this.layout.x[i], CHARACTER_Y);
        ctx.surface.commitBackground();
        this.startPlayer(ctx);
        break;
      case "pick":
        this.pick(ctx);
        break;
      case "helpCharacter":
        if (!ctx.voice.voicePlaying) this.startWait(ctx, "helpGap");
        break;
      case "helpGap":
        if (this.waited(ctx, HELP_GAP_CS)) {
          ctx.voice.play(this.voice(LEVEL_VOICE_BASE + this.level));
          this.phase = "helpLevel";
        }
        break;
      case "helpLevel":
        if (!ctx.voice.voicePlaying) this.startWait(ctx, "helpEnd");
        break;
      case "helpEnd":
        if (this.waited(ctx, HELP_GAP_CS)) this.resumePick(ctx);
        break;
      case "capsuleWait":
        if (this.waited(ctx, AFTER_CAPSULE_SOUND_CS)) {
          ctx.voice.play(this.capsuleSound);
          this.capsuleY = -CAPSULE_STEP;
          this.phase = "capsule";
        }
        break;
      case "capsule":
        this.capsuleY += CAPSULE_STEP;
        if (this.capsuleY >= CHARACTER_Y) {
          // Dernière image : capsule posée ; le son d'arrivée remplace celui de la descente.
          this.capsuleY = CHARACTER_Y;
          ctx.voice.play(this.landingSound);
          this.phase = "landing";
        }
        break;
      case "landing":
        if (!ctx.voice.voicePlaying) this.placed(ctx);
        break;
      case "nextVoice":
        if (!ctx.voice.voicePlaying) this.startWait(ctx, "nextGap");
        break;
      case "nextGap":
        if (this.waited(ctx, NEXT_PLAYER_GAP_CS)) this.startPlayer(ctx);
        break;
      case "buttons":
        this.buttons(ctx);
        break;
      case "buttonHelp":
        if (!ctx.voice.voicePlaying) this.phase = "buttons";
        break;
      case "done":
        break;
    }
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    switch (this.phase) {
      case "pick":
      case "helpCharacter":
      case "helpGap":
      case "helpLevel":
      case "helpEnd":
        this.drawChoice(ctx);
        break;
      case "capsuleWait":
      case "capsule":
      case "landing":
        // Le personnage et l'icône sont déjà dans le fond (figés à la validation) ; la capsule descend dessus.
        ctx.surface.drawSprite(this.sprites, this.layout.capsule[this.slot], this.layout.x[this.slot], this.capsuleY);
        break;
      case "buttons":
      case "buttonHelp":
        this.menu.render(ctx);
        break;
      default:
        break;
    }
  }

  private voice(n: number): Voc {
    return this.voices[n - 1];
  }

  private startWait(ctx: SceneContext, phase: Phase): void {
    this.phase = phase;
    this.phaseStart = ctx.clock.ticks;
  }

  private waited(ctx: SceneContext, cs: number): boolean {
    return ctx.clock.ticks - this.phaseStart >= centisecondsToTicks(cs);
  }

  /** Début du choix d'un joueur : niveau 1, personnage libre tiré au hasard (`21ee:06e4..072c`, incrémenté avant de tester). */
  private startPlayer(ctx: SceneContext): void {
    this.level = DEFAULT_LEVEL;
    this.character = ctx.rng.below(6);
    do this.character = (this.character + 1) % 6;
    while (!this.free[this.character]);
    this.resumePick(ctx);
  }

  private resumePick(ctx: SceneContext): void {
    this.phase = "pick";
    ctx.voice.holdMusic(false);
  }

  private neighbour(step: 1 | -1): void {
    do this.character = (this.character + step + 6) % 6;
    while (!this.free[this.character]);
  }

  /** Une itération du choix d'un joueur (`21ee:06f5..09d5`). */
  private pick(ctx: SceneContext): void {
    const { input } = ctx;
    let changed = false;
    const move = (step: 1 | -1) => {
      this.neighbour(step);
      changed = true;
    };
    const shiftLevel = (step: 1 | 2) => {
      this.level = (this.level + step) % 3;
      changed = true;
    };
    if (input.justPressed("right")) move(1);
    if (input.justPressed("left")) move(-1);
    if (input.justPressed("up")) shiftLevel(1);
    if (input.justPressed("down")) shiftLevel(2);

    if (changed) {
      // Bruitage mélangé `348d:0b42` : le bip n'est lancé que si aucun bruitage ne sonne.
      if (!ctx.voice.effectPlaying) ctx.voice.playEffect(this.click);
      this.applyLevelColor(ctx);
      return;
    }
    if (input.justPressed("cancel")) {
      ctx.voice.holdMusic(true);
      ctx.voice.play(this.voice(1 + CHARACTER_VOICE[this.character]));
      this.phase = "helpCharacter";
      return;
    }
    if (input.justPressed("validate")) this.validateCharacter(ctx);
  }

  /** La couleur de niveau est copiée sur l'entrée de palette de l'emplacement (`21ee:08c6..0929`). */
  private applyLevelColor(ctx: SceneContext): void {
    const from = (LEVEL_COLOR_ENTRY + this.level) * 3;
    const c = this.mcg.palette;
    ctx.palette.setColor(this.layout.paletteEntry[this.slot], c[from], c[from + 1], c[from + 2]);
  }

  private drawChoice(ctx: SceneContext): void {
    ctx.surface.drawSprite(this.sprites, CHARACTER_SPRITES[this.character], this.layout.x[this.slot], CHARACTER_Y);
    ctx.surface.drawSprite(this.sprites, LEVEL_SPRITE + this.level, this.layout.levelX[this.slot], LEVEL_Y);
  }

  /** Validation (`21ee:09d5..`) : personnage et icône figés dans le fond, puis la capsule descend. */
  private validateCharacter(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    this.drawChoice(ctx);
    ctx.surface.commitBackground();
    ctx.voice.holdMusic(true);
    ctx.voice.stop();
    this.startWait(ctx, "capsuleWait");
  }

  /** Capsule posée : le joueur est enregistré (`21ee:0a0c..0b34`), puis voix du joueur suivant ou boutons. */
  private placed(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    ctx.surface.drawSprite(this.sprites, this.layout.capsule[this.slot], this.layout.x[this.slot], CHARACTER_Y);
    ctx.surface.commitBackground();
    this.chosen.push({ character: SPRITE_CHARACTER[this.character], level: this.level });
    this.free[this.character] = false;
    this.slot++;
    if (this.slot < this.players) {
      ctx.voice.play(this.voice(NEXT_PLAYER_VOICE_BASE + ctx.rng.below(5)));
      this.phase = "nextVoice";
      return;
    }
    this.showButtons(ctx);
  }

  /** `21ee:0c19` : trois boutons verticaux posés dans le fond, le premier en surbrillance. */
  private showButtons(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    BUTTON_SPRITES.forEach((sprite, i) => ctx.surface.drawSprite(this.sprites, sprite, BUTTON_X, BUTTON_Y[i]));
    ctx.surface.commitBackground();
    ctx.voice.holdMusic(false);
    this.menu.enter(ctx);
    this.phase = "buttons";
  }

  private buttons(ctx: SceneContext): void {
    const event = this.menu.update(ctx);
    if (!event) return;
    if (event.kind === "help") {
      // La voix du bouton est jouée par le menu ; l'original l'attend jusqu'au bout.
      this.phase = "buttonHelp";
      return;
    }
    this.phase = "done";
    const action = BUTTON_RESULTS[event.index];
    if (action === "play") this.onDone(ctx, { action, players: this.chosen.map((p) => ({ ...p })) });
    else this.onDone(ctx, { action });
  }
}
