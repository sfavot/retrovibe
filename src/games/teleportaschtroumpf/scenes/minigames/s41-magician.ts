import type { Hy8 } from "../../data/hy8";
import { parsePal, type Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { Menu, paletteHighlight } from "../../engine/menu";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import { hasIngredient, type MinigameRequest } from "../../game/state";
import { ALL_INGREDIENTS, INGREDIENT_COUNT, MAGICIAN_HAT_CHOICE } from "../../game/tables";
import { HOVER_COLOR } from "../common/choice";
import { Clip, Pointer, SoundHush, drawFrame, minigameRequest, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S41 « Le Magicien » (`2143:0009`, 452 octets, et ses trois routines `2143:08a1`, `2143:01cd`, `2143:070c` ; RE : `docs/teleportaschtroumpf/minigames/s41.md`).
 *
 * ### `createMagician(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 41). Ni le niveau ni l'indice de l'oiseau n'ont d'effet ;
 *   `game.canTrade(joueur)` (au moins 3 gouttes de rosée, pas les 8 ingrédients) décide de la suite ;
 * - joue : tous les ingrédients possédés : rien (le plateau ferme la porte). Moins de 3 gouttes : le magicien refuse (vidéos `s41a1` puis
 *   `s41c`). Sinon : vidéos `s41a1` et `s41d`, la question « échanger 3 gouttes de rosée contre un ingrédient ? » (Oui / Non au clavier :
 *   gauche / droite, Espace) ; Non : vidéo `s41e` ; Oui : vidéos `s41f` et `s41a2`, puis l'écran des huit ingrédients et du chapeau, au
 *   curseur HY8 (souris, ou flèches + Espace) ; un ingrédient déjà possédé est refusé de vive voix ; un choix déclenche deux voix, la vidéo
 *   `s41b` et la confirmation (haut / bas, Espace) ; Non à la confirmation ramène au choix ;
 * - rend : `onDone(ctx, { kind: "magician", choice })` : `choice` de 0 à 7 (l'ingrédient demandé), 8 (le chapeau : 3 gouttes sans ingrédient),
 *   `null` (refus, Non à la question, temps de partie écoulé ou porte fermée). L'appelant applique l'issue (`Game.resolveMinigame`).
 */

/** Nombre de zones cliquables : huit ingrédients (la zone `k` est l'ingrédient `k`) et le chapeau (8). */
export const ZONE_COUNT = INGREDIENT_COUNT + 1;
/** « Choix » rendu quand la partie est finie pendant la sélection (`2143:064c`). */
export const CHOICE_TIME_UP = 9;

/** Zone cliquable de l'écran de choix : bornes **exclues** pour le curseur (`2143:0285..04c8`) ; le cadre de survol les dessine bornes comprises. */
export interface Zone {
  readonly choice: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Les neuf zones dans l'ordre de test de l'original : si le curseur est dans plusieurs, la dernière l'emporte. */
export const ZONES: readonly Zone[] = [
  { choice: 8, x1: 0x4d, y1: 0x37, x2: 0x8a, y2: 0x71 },
  { choice: 6, x1: 0x8c, y1: 0x34, x2: 0xbb, y2: 0x61 },
  { choice: 2, x1: 0xc5, y1: 0x3a, x2: 0xed, y2: 0x68 },
  { choice: 5, x1: 0xef, y1: 0x32, x2: 0x139, y2: 0x60 },
  { choice: 1, x1: 0x10a, y1: 0x65, x2: 0x138, y2: 0xad },
  { choice: 3, x1: 0xd2, y1: 0x97, x2: 0x107, y2: 0xc0 },
  { choice: 7, x1: 0xb0, y1: 0x80, x2: 0xcc, y2: 0xb2 },
  { choice: 0, x1: 0x8a, y1: 0x73, x2: 0xae, y2: 0xaf },
  { choice: 4, x1: 0x43, y1: 0x77, x2: 0x85, y2: 0xad },
];

/** Zone sous le curseur (`-1` : aucune), la dernière de `ZONES` qui le contient. */
export function zoneAt(x: number, y: number): number {
  let found = -1;
  for (const z of ZONES) if (z.x1 < x && x < z.x2 && z.y1 < y && y < z.y2) found = z.choice;
  return found;
}

/** Bornes du curseur de l'écran de choix (`2143:02a1..0330`). */
export const POINTER_BOUNDS = { minX: 8, maxX: 0x134, minY: 7, maxY: 0xbe } as const;

/** Voix de l'ingrédient choisi : `s41v` + `1 + T[choix]` (table `DS:1DA7`, 9 entrées ; `T[9]` vaut `'c'` : pas de voix). */
export const CHOICE_VOICE_TABLE: readonly number[] = [1, 6, 3, 5, 2, 7, 8, 0, 4];
export function choiceVoice(choice: number): number | null {
  const entry = CHOICE_VOICE_TABLE[choice];
  return entry === undefined ? null : 1 + entry;
}

/** Entrées de palette du texte « Oui » de la question (124) et de la confirmation (252) ; « Non » est la suivante. */
const QUESTION_PALETTE_ENTRY = 124;
const CONFIRM_PALETTE_ENTRY = 252;
/** Voix de la question : `s49v` + 12. */
const QUESTION_VOICE = 12;
/** Voix d'un ingrédient déjà possédé : `s41v` 10 + 0/1 la première fois, 12 + 0/1 ensuite. */
const OWNED_FIRST = 10;
const OWNED_AGAIN = 12;
/** Voix d'accroche du choix : `s41a` 5 + 0..2 (`s41a007t.voc` n'existe pas dans les données). */
const REMARK_FIRST = 5;
const REMARK_COUNT = 3;
const CHOICE_VOICE_COUNT = 13;
/** Couleurs des deux cadres de survol (`32af:0006`) : trait décalé `0x7F`, puis `0x7E`. */
const FRAME_LIGHT = 0x7f;
const FRAME_DARK = 0x7e;

/**
 * Mémoire du dernier état des deux menus Oui / Non (`DS:8214` question, `DS:8211` confirmation) : l'original ne joue le bip de changement
 * qu'au premier tour si l'état qu'il connaît diffère de « Oui » ; ces octets survivent d'une visite à l'autre. Propre à une partie.
 */
interface BeepMemory {
  question: number;
  confirm: number;
}
const memories = new WeakMap<Game, BeepMemory>();
function memoryOf(game: Game): BeepMemory {
  let memory = memories.get(game);
  if (!memory) memories.set(game, (memory = { question: 0, confirm: 0 }));
  return memory;
}

/** Ce que la scène montre : une vidéo, la question, l'écran de choix ou la confirmation. */
export type MagicianScreen = "none" | "video" | "question" | "choice" | "confirm";

export type MagicianPhase =
  | "closed"
  | "loading"
  | "video"
  | "fadeOut"
  | "intro"
  | "introVoice"
  | "question"
  | "soundFade"
  | "choice"
  | "owned"
  | "remark"
  | "chosenVoice"
  | "confirm"
  | "done";

/** Branche prise à l'entrée (`2143:0030..0068`) : porte fermée, refus ou échange proposé. */
export type MagicianBranch = "closed" | "refusal" | "trade";

export class MagicianScene implements Scene {
  readonly step = 1;
  private readonly request: MinigameRequest;
  private readonly memory: BeepMemory;
  private readonly questionMenu = new Menu({
    axis: "horizontal",
    wrap: false,
    items: [{}, {}],
    highlight: paletteHighlight(QUESTION_PALETTE_ENTRY, HOVER_COLOR),
    changeSound: "s07a001b.voc",
  });
  private readonly confirmMenu = new Menu({
    axis: "vertical",
    wrap: false,
    items: [{}, {}],
    highlight: paletteHighlight(CONFIRM_PALETTE_ENTRY, HOVER_COLOR),
    changeSound: "s07a001b.voc",
  });
  private branchKind: MagicianBranch = "closed";
  private beep!: Voc;
  private sprites!: Hy8;
  private pointer!: Pointer;
  private palette!: Uint8Array;
  private choiceMcg!: Mcg;
  private questionMcg!: Mcg;
  private confirmMcg!: Mcg;
  private questionVoice!: Voc;
  private remarks: (Voc | null)[] = [];
  private voices: (Voc | null)[] = [];
  private incoming: Clip | null = null;
  private incomingReady = false;
  private failure: unknown = null;
  private afterClip: ((ctx: SceneContext) => void) | null = null;
  private afterFade: ((ctx: SceneContext) => void) | null = null;
  private clip: Clip | null = null;
  private phase: MagicianPhase = "closed";
  private shown: MagicianScreen = "none";
  private startElapsed = 0;
  private startTicks = 0;
  private position = { x: 0xa0, y: 0x64 };
  private zone = -1;
  private previousZone = -1;
  private counts: number[] = [];
  private pending: Voc | null = null;
  private chosenZone: number | null = null;
  private answeredYes: boolean | null = null;
  private confirmed: boolean | null = null;
  private readonly hushing = new SoundHush();
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    this.request = minigameRequest(game, 41);
    this.memory = memoryOf(game);
  }

  get stage(): MagicianPhase {
    return this.phase;
  }

  get screen(): MagicianScreen {
    return this.shown;
  }

  get branch(): MagicianBranch {
    return this.branchKind;
  }

  /** Fichier de la vidéo en cours ou la dernière jouée (pour les tests). */
  get clipFile(): string | null {
    return this.clip?.file ?? this.incoming?.file ?? null;
  }

  /** Zone sous le curseur de l'écran de choix, `-1` si aucune. */
  get hoveredZone(): number {
    return this.zone;
  }

  /** Choix fait (0 à 8, ou 9 : temps de partie écoulé), `null` tant qu'il n'y en a pas. */
  get chosen(): number | null {
    return this.chosenZone;
  }

  /** Réponse à la question : vrai pour Oui, `null` tant qu'elle n'est pas donnée. */
  get answer(): boolean | null {
    return this.answeredYes;
  }

  /** Réponse à la confirmation (Oui vrai), `null` tant qu'elle n'est pas donnée. */
  get confirmation(): boolean | null {
    return this.confirmed;
  }

  /** Visites par zone de l'écran de choix : nombre de refus joués pour un ingrédient déjà possédé. */
  get ownedReplies(): readonly number[] {
    return this.counts;
  }

  /** Index de l'élément sélectionné dans le menu courant (0 = Oui). */
  get selected(): number {
    return this.shown === "confirm" ? this.confirmMenu.index : this.questionMenu.index;
  }

  async load(ctx: SceneContext): Promise<void> {
    const player = this.game.state.players[this.request.player];
    this.branchKind = player.ingredients === ALL_INGREDIENTS ? "closed" : this.game.canTrade(this.request.player) ? "trade" : "refusal";
    if (this.branchKind === "closed") return;
    const first = new Clip("s41a1.mux", (c) => this.clipEnded(c));
    this.incoming = first;
    if (this.branchKind === "refusal") {
      await first.load(ctx);
      this.incomingReady = true;
      return;
    }
    const optional = (name: string) => ctx.resources.voc(name).catch(() => null);
    const [, sprites, pal, choiceMcg, questionMcg, confirmMcg, beep, questionVoice, remarks, voices] = await Promise.all([
      first.load(ctx),
      ctx.resources.hy8("s41a000s.hy8"),
      ctx.resources.bytes("s41a.pal"),
      ctx.resources.mcg("s41a160a.mcg"),
      ctx.resources.mcg("s41b003d.mcg"),
      ctx.resources.mcg("s41b035a.mcg"),
      ctx.resources.voc("s07a001b.voc"),
      ctx.resources.voc(voiceName("s49v", QUESTION_VOICE)),
      // `s41a007t.voc` et `s41v006t.voc` n'existent pas dans les données : l'original demande alors un fichier absent, la voix est muette.
      Promise.all(Array.from({ length: REMARK_COUNT }, (_, i) => optional(voiceName("s41a", REMARK_FIRST + i)))),
      Promise.all(Array.from({ length: CHOICE_VOICE_COUNT }, (_, i) => optional(voiceName("s41v", i + 1)))),
      this.questionMenu.load(ctx),
      this.confirmMenu.load(ctx),
    ]);
    this.incomingReady = true;
    this.sprites = sprites;
    this.palette = parsePal(pal);
    this.choiceMcg = choiceMcg;
    this.questionMcg = questionMcg;
    this.confirmMcg = confirmMcg;
    this.beep = beep;
    this.questionVoice = questionVoice;
    this.remarks = remarks;
    this.voices = voices;
    this.pointer = new Pointer({ sprites, sprite: 0, bounds: POINTER_BOUNDS });
  }

  enter(ctx: SceneContext): void {
    this.done = false;
    this.phase = this.branchKind === "closed" ? "closed" : "loading";
    this.shown = "none";
    this.clip = null;
    this.failure = null;
    this.answeredYes = null;
    this.confirmed = null;
    this.chosenZone = null;
    this.counts = Array.from({ length: INGREDIENT_COUNT }, () => 0);
    this.startElapsed = this.game.state.elapsed;
    this.startTicks = ctx.clock.ticks;
    // La suite des vidéos est décidée par la branche : `afterClip` de la première, rappelé à sa fin.
    if (this.branchKind === "refusal") this.afterClip = (c) => this.playClips(c, ["s41c.mux"], (cc) => this.finish(cc, null));
    else if (this.branchKind === "trade") this.afterClip = (c) => this.playClips(c, ["s41d.mux"], (cc) => this.endIntro(cc));
  }

  update(ctx: SceneContext): void {
    if (this.failure) throw this.failure;
    switch (this.phase) {
      case "closed":
        // Tous les ingrédients possédés : l'original ne montre rien (`2143:0030..0068`).
        this.finish(ctx, null);
        return;
      case "loading":
        if (!this.incomingReady) return;
        this.startIncoming(ctx);
        return;
      case "video":
        this.clip?.update(ctx);
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        this.afterFade!(ctx);
        return;
      case "intro":
        // `13fc:0150(…, 1)` rend la main après le fondu d'entrée, puis la voix `s49v012t`.
        if (ctx.fade.active) return;
        ctx.voice.play(this.questionVoice);
        this.phase = "introVoice";
        return;
      case "introVoice":
        // `1f33:03a7(1)` : un clic gauche coupe la voix.
        if (ctx.voice.voicePlaying && !ctx.input.justPressed("validate")) return;
        ctx.voice.stop();
        this.beginQuestion(ctx);
        return;
      case "question":
        this.updateQuestion(ctx);
        return;
      case "soundFade":
        this.updateSoundFade(ctx);
        return;
      case "choice":
        this.updateChoice(ctx);
        return;
      case "owned":
        // Refus d'un ingrédient déjà possédé : la voix est attendue (un clic la coupe), puis le relâchement.
        if (ctx.voice.voicePlaying && !ctx.input.justPressed("validate")) return;
        ctx.voice.stop();
        this.phase = "choice";
        return;
      case "remark":
        // `1f33:03a7(0)` : cette voix est attendue en entier.
        if (ctx.voice.voicePlaying) return;
        this.speak(ctx, this.pending, "chosenVoice");
        return;
      case "chosenVoice":
        if (ctx.voice.voicePlaying && !ctx.input.justPressed("validate")) return;
        ctx.voice.stop();
        this.afterChoice(ctx);
        return;
      case "confirm":
        this.updateConfirm(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    const { surface } = ctx;
    switch (this.shown) {
      case "none":
        return;
      case "video":
        this.clip?.render(ctx);
        return;
      case "question":
      case "confirm":
        surface.restoreBackground();
        return;
      case "choice": {
        surface.restoreBackground();
        const zone = ZONES.find((z) => z.choice === this.zone);
        if (zone) {
          drawFrame(surface, zone.x1 - 1, zone.y1 - 1, zone.x2 - 1, zone.y2 - 1, FRAME_LIGHT);
          drawFrame(surface, zone.x1, zone.y1, zone.x2, zone.y2, FRAME_DARK);
        }
        surface.drawSprite(this.sprites, 0, this.position.x, this.position.y);
        return;
      }
    }
  }

  exit(ctx: SceneContext): void {
    this.clip?.stop(ctx);
    ctx.voice.holdMusic(false);
    this.hushing.restore(ctx);
  }

  // --- Vidéos -----------------------------------------------------------------------------------------

  /** Enchaîne des vidéos passables (`154c:0954`) puis `then`. Chargement à la demande : une vidéo peut se rejouer (`s41b`). */
  private playClips(ctx: SceneContext, files: readonly string[], then: (ctx: SceneContext) => void): void {
    const [file, ...rest] = files;
    const clip = new Clip(file, (c) => this.clipEnded(c));
    this.afterClip = rest.length > 0 ? (c) => this.playClips(c, rest, then) : then;
    this.incoming = clip;
    this.incomingReady = false;
    this.phase = "loading";
    clip.load(ctx).then(
      () => {
        if (this.incoming === clip) this.incomingReady = true;
      },
      (error: unknown) => {
        this.failure = error;
      },
    );
  }

  private startIncoming(ctx: SceneContext): void {
    this.clip = this.incoming;
    this.incoming = null;
    this.incomingReady = false;
    this.shown = "video";
    this.phase = "video";
    this.clip!.start(ctx);
  }

  private clipEnded(ctx: SceneContext): void {
    const next = this.afterClip;
    this.afterClip = null;
    next?.(ctx);
  }

  /** `2143:08a1` : après `s41d`, la dernière image s'éteint (`1523:01fa`) avant la question. */
  private endIntro(ctx: SceneContext): void {
    this.fadeThen(ctx, (c) => this.showQuestion(c));
  }

  private fadeThen(ctx: SceneContext, then: (ctx: SceneContext) => void): void {
    ctx.fade.out();
    this.afterFade = then;
    this.phase = "fadeOut";
  }

  // --- Question ---------------------------------------------------------------------------------------

  /** `13fc:0150("s41b003d.mcg", 1)` : l'image de la question, fondu d'entrée, le « Oui » en surbrillance. */
  private showQuestion(ctx: SceneContext): void {
    this.clip = null;
    ctx.voice.holdMusic(false);
    ctx.palette.load(this.questionMcg.palette);
    ctx.surface.drawMcg(this.questionMcg, { asBackground: true });
    ctx.fade.blackout();
    ctx.fade.in();
    this.shown = "question";
    this.questionMenu.select(ctx, 0);
    this.questionMenu.enter(ctx);
    this.phase = "intro";
  }

  /** Premier tour de la boucle de la question (`2143:0a2a..0a8a`) : le bip (bruitage mélangé `348d:0b42`), si le dernier état connu n'était pas « Oui ». */
  private beginQuestion(ctx: SceneContext): void {
    if (this.memory.question !== 1 && !ctx.voice.effectPlaying) ctx.voice.playEffect(this.beep);
    this.memory.question = 1;
    this.phase = "question";
  }

  private updateQuestion(ctx: SceneContext): void {
    const event = this.questionMenu.update(ctx);
    if (event?.kind !== "validate") return;
    // Le clic gauche valide l'élément choisi (`DS:3B01D == 1`) ; le clic droit et Entrée n'ont pas d'effet ici.
    const yes = event.index === 0;
    this.answeredYes = yes;
    this.memory.question = yes ? 1 : 0;
    this.soundFade(ctx, (c) => {
      // Branche : Oui prépare `s41f`, `s41a2` ; Non `s41e` (`2143:0063..00e9`).
      this.fadeThen(c, (cc) => {
        if (yes) this.playClips(cc, ["s41f.mux", "s41a2.mux"], (ccc) => this.showChoice(ccc));
        else this.playClips(cc, ["s41e.mux"], (ccc) => this.finish(ccc, null));
      });
    });
  }

  // --- Fondu sonore -------------------------------------------------------------------------------------

  /** `1343:0037` : le volume descend à 1, un cran toutes les 20 centièmes ; puis le son est coupé (`15f9:089f(0, 0x400000)`). */
  private soundFade(ctx: SceneContext, then: (ctx: SceneContext) => void): void {
    this.hushing.start(ctx);
    this.afterFade = then;
    this.phase = "soundFade";
  }

  private updateSoundFade(ctx: SceneContext): void {
    if (!this.hushing.update(ctx)) return;
    ctx.voice.holdMusic(true);
    this.afterFade!(ctx);
  }

  // --- Choix ------------------------------------------------------------------------------------------

  /** `2143:01cd` : fond `s41a160a`, palette `s41a.pal`, curseur HY8 au centre, compteurs de refus remis à 0. */
  private showChoice(ctx: SceneContext): void {
    this.clip = null;
    ctx.voice.holdMusic(false);
    ctx.fade.reset();
    ctx.palette.load(this.palette);
    ctx.surface.drawMcg(this.choiceMcg, { asBackground: true });
    ctx.input.warpMouse(0xa0, 0x64);
    this.position = this.pointer.position(ctx);
    this.zone = -1;
    this.previousZone = -1;
    this.counts = Array.from({ length: INGREDIENT_COUNT }, () => 0);
    this.chosenZone = null;
    this.shown = "choice";
    this.phase = "choice";
  }

  /** Temps de partie dépassé (`1f33:019a(0) > DS:6EA4`) : le chrono de partie continue pendant la scène (le plateau est suspendu). */
  private gameTimeUp(ctx: SceneContext): boolean {
    const elapsed = this.startElapsed + (ctx.clock.ticks - this.startTicks) / 60;
    return Math.floor(elapsed) > this.game.state.durationSeconds;
  }

  /** Une itération de `2143:0259..0678` : survol, bip d'entrée de zone, clic, temps de partie. */
  private updateChoice(ctx: SceneContext): void {
    this.pointer.update(ctx);
    this.position = this.pointer.position(ctx);
    this.zone = zoneAt(this.position.x, this.position.y);
    // Le bip ne se rejoue que pour une zone différente de la dernière touchée (sortir dans le vide ne l'efface pas).
    if (this.zone !== -1 && this.zone !== this.previousZone) {
      if (!ctx.voice.effectPlaying) ctx.voice.playEffect(this.beep);
      this.previousZone = this.zone;
    }
    let choice: number | null = null;
    if (ctx.input.justPressed("validate") && this.zone !== -1) {
      const player = this.game.state.players[this.request.player];
      if (this.zone === MAGICIAN_HAT_CHOICE || !hasIngredient(player, this.zone)) choice = this.zone;
      else this.refuse(ctx, this.zone);
    }
    if (this.gameTimeUp(ctx)) choice = CHOICE_TIME_UP;
    if (choice !== null) this.choose(ctx, choice);
  }

  /** Ingrédient déjà possédé : une voix (la première fois `s41v010`/`011`, ensuite `012`/`013`). */
  private refuse(ctx: SceneContext, zone: number): void {
    const base = this.counts[zone] === 0 ? OWNED_FIRST : OWNED_AGAIN;
    this.counts[zone]++;
    const voice = this.voices[base + ctx.rng.below(2) - 1];
    if (voice) ctx.voice.play(voice);
    this.phase = "owned";
  }

  /** `2143:067b..0708` : les deux voix du choix (`s41a` puis `s41v`), sauf quand le temps est écoulé. */
  private choose(ctx: SceneContext, choice: number): void {
    this.chosenZone = choice;
    const number = choiceVoice(choice);
    if (number === null) {
      this.afterChoice(ctx);
      return;
    }
    // Pas de retour de la musique entre les deux voix.
    ctx.voice.holdMusic(true);
    this.pending = this.voices[number - 1];
    const remark = this.remarks[ctx.rng.below(REMARK_COUNT)];
    if (remark) ctx.voice.play(remark);
    this.phase = "remark";
  }

  /** Joue la voix `voice` (muette si le fichier manque) et passe à `phase`. */
  private speak(ctx: SceneContext, voice: Voc | null, phase: MagicianPhase): void {
    if (voice) ctx.voice.play(voice);
    this.phase = phase;
  }

  /** Après les voix : le temps écoulé termine ; sinon la vidéo `s41b` (passable) puis la confirmation. */
  private afterChoice(ctx: SceneContext): void {
    if (this.chosenZone === CHOICE_TIME_UP) {
      this.finish(ctx, null);
      return;
    }
    this.playClips(ctx, ["s41b.mux"], (c) => this.showConfirm(c));
  }

  // --- Confirmation -----------------------------------------------------------------------------------

  /** `2143:070c` : image `s41b035a`, palette `s41a.pal` (copiée sur celle de l'image), « Oui » en haut en surbrillance. */
  private showConfirm(ctx: SceneContext): void {
    this.clip = null;
    ctx.voice.holdMusic(false);
    ctx.fade.reset();
    ctx.palette.load(this.palette);
    ctx.surface.drawMcg(this.confirmMcg, { asBackground: true });
    this.confirmMenu.select(ctx, 0);
    this.confirmMenu.enter(ctx);
    this.shown = "confirm";
    this.confirmed = null;
    if (this.memory.confirm !== 1 && !ctx.voice.effectPlaying) ctx.voice.playEffect(this.beep);
    this.memory.confirm = 1;
    this.phase = "confirm";
  }

  private updateConfirm(ctx: SceneContext): void {
    const event = this.confirmMenu.update(ctx);
    if (event?.kind !== "validate") return;
    const yes = event.index === 0;
    this.confirmed = yes;
    this.memory.confirm = yes ? 1 : 0;
    this.soundFade(ctx, (c) => {
      // Non : retour à l'écran de choix (`do … while (!confirmé && choix != 9)`).
      if (yes) this.finish(c, this.chosenZone);
      else this.showChoice(c);
    });
  }

  private finish(ctx: SceneContext, choice: number | null): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    // Le temps écoulé (9) n'est pas un choix : `Game` ne le connaît pas.
    this.onDone(ctx, { kind: "magician", choice: choice === CHOICE_TIME_UP ? null : choice });
  }
}

export const createMagician: MinigameFactory = (game, onDone) => new MagicianScene(game, onDone);
