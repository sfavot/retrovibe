import type { Hy8 } from "../../data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../data/mcg";
import type { Action } from "../../engine/input";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Surface } from "../../engine/surface";
import { VideoScene } from "../../engine/video";
import type { Game, GameEvent } from "../../game/rules";
import { hasIngredient, type MinigameOutcome, type MinigameRequest } from "../../game/state";
import { INGREDIENT_COUNT, minigameInfo } from "../../game/tables";
import { StubScene } from "../common/stub";

/**
 * Outils partagés des mini-jeux (`scenes/minigames/sNN-nom.ts`). Un fichier par mini-jeu ; celui-ci est le seul endroit commun,
 * et personne ne le modifie en cours de route : si un outil manque, le mini-jeu l'écrit chez lui (voir la section « Écrire un
 * mini-jeu » de `docs/teleportaschtroumpf/engine-ts.md`).
 *
 * Contenu (tout vient de S32 et S27, ou de S13 pour le pointeur) :
 *
 * - les types du contrat : `MinigameFactory`, `MinigameDone`, `AftermathFactory` ;
 * - la requête et le niveau : `minigameRequest`, `minigameLevel` ;
 * - l'issue rendue à l'appelant : `ingredientOutcome`, `pointsOutcome` ; le choix de la vidéo de réussite des mini-jeux à ingrédient : `goalClip` (`ingredientInGoal` en est le prédicat, sans sens implicite) ;
 * - une vidéo MUX jouée à l'intérieur d'un mini-jeu : `Clip` ;
 * - le curseur HY8 à souris + flèches des scènes à pointeur libre : `Pointer` ;
 * - le fondu sonore de fin (`1343:0037`) : `SoundHush` ; le cadre de survol (`32af:0006`) : `drawFrame` ;
 * - la souche commune, réservée aux tests de parcours (`forceMinigameStubs` dans `minigames.ts`) : `createStubMinigame`, `MinigameStub`, `STUB_POINTS`.
 *
 * Ce qui n'est **pas** ici faute de preuve : voix d'introduction (jouée avant la scène par `scenes/game.ts` et `map/free-mode.ts`),
 * voix de résultat, minuteries d'inactivité et indices vocaux (aucun n'existe dans S32 ni S27 ; les scènes à pointeur libre les
 * ont, chacune avec ses seuils) et fondus (le fondu d'entrée et de sortie de la scène est fait par l'appelant avec
 * `scenes.push` / `pop({ fade: true })`).
 */

export type MinigameDone = (ctx: SceneContext, outcome: MinigameOutcome) => void;
export type MinigameFactory = (game: Game, onDone: MinigameDone) => Scene;
/** Présentation de ce que `Game.resolveMinigame` vient d'appliquer (S38 et S39 seulement), `null` s'il n'y a rien à montrer. */
export type AftermathFactory = (game: Game, events: readonly GameEvent[], onDone: (ctx: SceneContext) => void) => Scene | null;

// --- Requête, niveau, issue -----------------------------------------------------------------------

/**
 * Requête du mini-jeu en cours (`game.state.pending`, posée par `Game.openMinigame` ou par la porte du plateau). Lève une erreur
 * s'il n'y en a pas ou si elle vise une autre scène : le mini-jeu ne se lance qu'après l'ouverture.
 */
export function minigameRequest(game: Game, scene: number): MinigameRequest {
  const request = game.state.pending;
  if (!request || request.scene !== scene) throw new Error(`la scène ${scene} se lance après Game.openMinigame(${scene})`);
  return request;
}

/**
 * Niveau de difficulté du mini-jeu : celui du joueur (0..2) ou, si l'indice de l'oiseau vise cette scène (`request.bonus`),
 * `bonusLevel`, la valeur que la fonction d'origine écrit dans son niveau interne (rules.md §5 : 0, 3 ou une variable propre
 * selon la scène ; le sens exact se lit dans la fonction d'origine). `Game` a déjà consommé l'indice.
 */
export function minigameLevel(request: MinigameRequest, bonusLevel: number): number {
  return request.bonus ? bonusLevel : request.level;
}

/** Issue des mini-jeux à ingrédient (S22, 27, 28, 31, 32, 33, 34, 36) : `Game.resolveMinigame` donne l'ingrédient de la scène. */
export function ingredientOutcome(success: boolean): MinigameOutcome {
  return { kind: "ingredient", success };
}

/**
 * Issue des mini-jeux à gouttes de rosée (S23, 24, 25, 26, 29, 30, 35, 40, 51) : 0 en cas d'échec. Le gain n'est pas borné à 3 :
 * la plupart donnent 1 à 3 points, S51 un point par cadeau ouvert (0 à 11). C'est `Game.addPoints` qui plafonne le total du joueur à
 * 60 (`1e52:00ad`), pas le mini-jeu.
 */
export function pointsOutcome(points: number): MinigameOutcome {
  return { kind: "points", points };
}

/** Ingrédient donné par la scène (`MINIGAMES` de `game/tables.ts`), `undefined` pour les mini-jeux à points. */
export function sceneIngredient(scene: number): number | undefined {
  return minigameInfo(scene)?.ingredient;
}

/**
 * L'ingrédient fait partie de l'objectif de la partie (`1e52:0008`). Simple prédicat : **le sens de la vidéo de fin n'est pas
 * universel**. S27, S28, S31, S32, S34 et S36 jouent `c2` (`cd2` pour S32) quand l'ingrédient est dans l'objectif ; S22 et S33
 * jouent `c1` dans ce cas. Pour choisir la vidéo, passer par `goalClip`, qui nomme explicitement les deux fichiers.
 */
export function ingredientInGoal(game: Game, ingredient: number): boolean {
  return (game.state.goal.ingredients & (1 << ingredient)) !== 0;
}

/** Les deux vidéos de réussite d'un mini-jeu à ingrédient, selon que l'ingrédient fait partie de l'objectif ou non. */
export interface GoalClips {
  inGoal: string;
  notInGoal: string;
}

/** Vidéo de réussite d'un mini-jeu à ingrédient : `clips.inGoal` si l'ingrédient est dans l'objectif (`1e52:0008`), `clips.notInGoal` sinon. */
export function goalClip(game: Game, ingredient: number, clips: GoalClips): string {
  return ingredientInGoal(game, ingredient) ? clips.inGoal : clips.notInGoal;
}

// --- Vidéo à l'intérieur d'un mini-jeu ------------------------------------------------------------

export interface ClipOptions {
  /** Échap ou clic gauche passent la vidéo. Faux pour une vidéo lancée par `179a:0673` sans les drapeaux `0x400 | 0x800` ; vrai (défaut) par `154c:0954`. */
  skippable?: boolean;
  /** Rappel par image décodée (voir `VideoSceneOptions.onFrame`) ; `"stop"` interrompt la vidéo. */
  onFrame?(ctx: SceneContext, frame: number, markers: readonly Uint8Array[]): "stop" | void;
  /** Dessiné par-dessus chaque image (sprites posés par `onFrame`). */
  overlay?(ctx: SceneContext): void;
}

/**
 * Vidéo MUX plein écran jouée à l'intérieur d'un mini-jeu (rien n'est empilé : le mini-jeu la pilote de sa propre scène).
 * Cycle : `await clip.load(ctx)` dans `load`, `clip.start(ctx)` quand elle doit démarrer, `clip.update(ctx)` à chaque `update`,
 * `clip.render(ctx)` à chaque `render`. `onEnd` est appelé une fois, à la fin naturelle, sur saut ou après un `"stop"` ; la
 * dernière image reste affichée par `render` (comme dans l'original, qui reprend la main sur l'écran de la vidéo), et le son est
 * coupé. La scène du mini-jeu doit avoir `step = 1`.
 */
export class Clip {
  private readonly video: VideoScene;
  private running = false;
  private ended = false;

  constructor(
    readonly file: string,
    onEnd: (ctx: SceneContext) => void,
    options: ClipOptions = {},
  ) {
    this.video = new VideoScene({
      file,
      skippable: options.skippable,
      onFrame: options.onFrame,
      overlay: options.overlay,
      onEnd: (ctx) => {
        // L'image finale est redessinée avant que `exit` ne coupe le son : `render` la montre encore ensuite.
        this.video.render(ctx);
        this.video.exit(ctx);
        this.running = false;
        this.ended = true;
        onEnd(ctx);
      },
    });
  }

  load(ctx: SceneContext): Promise<void> {
    return this.video.load(ctx);
  }

  start(ctx: SceneContext): void {
    this.running = true;
    this.ended = false;
    this.video.enter(ctx);
  }

  /** Vrai entre `start` et la fin. */
  get playing(): boolean {
    return this.running;
  }

  /** Vrai une fois terminée. */
  get finished(): boolean {
    return this.ended;
  }

  update(ctx: SceneContext): void {
    if (this.running) this.video.update(ctx);
  }

  render(ctx: SceneContext): void {
    this.video.render(ctx);
  }

  /** Coupe la vidéo en cours sans appeler `onEnd` (la scène quitte avant la fin) : à appeler dans `exit`. */
  stop(ctx: SceneContext): void {
    if (!this.running) return;
    this.running = false;
    this.video.exit(ctx);
  }
}

// --- Fondu sonore de fin ------------------------------------------------------------------------

/** Cadence du fondu sonore de fin (`1343:0037`) : un cran de volume toutes les 20 centièmes de seconde = 12 ticks. */
export const HUSH_STEP_TICKS = 12;

/**
 * Fondu sonore de fin des mini-jeux (`1343:0037`) : le volume descend d'un cran toutes les 20 centièmes de seconde, du volume de départ
 * jusqu'à 1 ; ensuite le son est coupé (`15f9:089f(0, 0x400000)`) et le volume rendu. Une scène de `step = 1` appelle `update(ctx)` à
 * chaque `update` tant que `active`, et `restore(ctx)` dans `exit` (sortie en plein fondu). La musique n'est pas gérée ici
 * (`voice.holdMusic` reste à la scène).
 */
export class SoundHush {
  private volume = 0;
  private startedAt = 0;
  private running = false;

  /** Vrai entre `start` et la fin du fondu. */
  get active(): boolean {
    return this.running;
  }

  /** Démarre le fondu depuis `volume` (par défaut le volume courant de la voie). */
  start(ctx: SceneContext, volume: number = ctx.voice.volume): void {
    this.volume = volume;
    this.startedAt = ctx.clock.ticks;
    this.running = true;
  }

  /** Avance le fondu ; rend vrai au tick où le son est coupé et le volume rendu (une seule fois). */
  update(ctx: SceneContext): boolean {
    if (!this.running) return false;
    const steps = Math.floor((ctx.clock.ticks - this.startedAt) / HUSH_STEP_TICKS);
    if (steps < this.volume) {
      ctx.voice.setVolume(this.volume - steps);
      return false;
    }
    ctx.voice.stop();
    ctx.voice.setVolume(this.volume);
    this.running = false;
    return true;
  }

  /** Sortie de la scène en plein fondu : rend le volume de départ (sans couper le son). */
  restore(ctx: SceneContext): void {
    if (!this.running) return;
    this.running = false;
    ctx.voice.setVolume(this.volume);
  }
}

// --- Dessin ---------------------------------------------------------------------------------------

/** Contour de rectangle d'un pixel, bords compris (`32af:0006`), rogné à l'écran : les cadres de survol et de sélection des mini-jeux. */
export function drawFrame(surface: Surface, x1: number, y1: number, x2: number, y2: number, color: number): void {
  const plot = (x: number, y: number) => {
    if (x >= 0 && x < SCREEN_WIDTH && y >= 0 && y < SCREEN_HEIGHT) surface.work[y * SCREEN_WIDTH + x] = color;
  };
  for (let x = x1; x <= x2; x++) {
    plot(x, y1);
    plot(x, y2);
  }
  for (let y = y1; y <= y2; y++) {
    plot(x1, y);
    plot(x2, y);
  }
}

// --- Curseur HY8 des scènes à pointeur libre ------------------------------------------------------

export interface PointerOptions {
  /** Fichier HY8 de la scène et indice du sprite du curseur (point chaud = ancre du sprite, `hy8.md`). */
  sprites: Hy8;
  sprite: number;
  /** Bornes du pointeur (inclusives), propres à chaque scène (S13 : 8..0x134 × 0xF..0xBE). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Décalage du pas du curseur au clavier écrit par les mini-jeux à pointeur libre (`DS:3FD0 = 1`) : pas de 2 px par tick (`3134:03c8`, `Input.keyPointerShift`). */
export const POINTER_KEY_SHIFT = 1;
/** Pas qui en résulte : 2 px par tick. */
export const POINTER_KEY_SPEED = 1 << POINTER_KEY_SHIFT;

/**
 * Curseur des scènes à pointeur libre (`DS:190 = 1` : S51, S35, S26, S41, S25, S24, S13 ; engine.md §3.4) : un sprite HY8 de la
 * scène posé à la position de la souris (`ctx.input.mouseX/Y`, en 320×200), que les flèches (et Q/A/Z/X) déplacent aussi, comme le
 * clavier de l'original émule la souris. Clic gauche / Espace = `validate`, clic droit / Entrée = `cancel` : le mini-jeu les lit sur
 * `ctx.input`. À utiliser dans une scène de `step = 1` : appeler `update(ctx)` à chaque `update`, puis `draw(ctx.surface)` dans
 * `render` après avoir redessiné le fond.
 */
export class Pointer {
  constructor(private readonly options: PointerOptions) {}

  /** Applique les flèches tenues à la position de la souris, au pas de 2 px que ces mini-jeux posent (`DS:3FD0 = 1`). */
  update(ctx: SceneContext): void {
    ctx.input.keyPointerShift = POINTER_KEY_SHIFT;
    ctx.input.moveMouseByKeys();
  }

  /** Position du pointeur, bornée. */
  position(ctx: SceneContext): { x: number; y: number } {
    const { minX, maxX, minY, maxY } = this.options.bounds;
    return { x: Math.min(maxX, Math.max(minX, ctx.input.mouseX)), y: Math.min(maxY, Math.max(minY, ctx.input.mouseY)) };
  }

  draw(ctx: SceneContext, surface: Surface = ctx.surface): void {
    const { x, y } = this.position(ctx);
    surface.drawSprite(this.options.sprites, this.options.sprite, x, y);
  }
}

// --- Souche commune ---------------------------------------------------------------------------------

/** Points donnés par la souche en cas de réussite. */
export const STUB_POINTS = 2;

/** Souche commune des mini-jeux (outil de test, aucun vrai mini-jeu ne la rend ; nommée pour que les tests reconnaissent l'écran). */
export class MinigameStub extends StubScene {}

/** Issue de la souche : réussite ou échec, du type attendu par la scène. */
export function stubOutcome(id: number, game: Game, success: boolean): MinigameOutcome {
  const info = minigameInfo(id);
  switch (info?.kind) {
    case "ingredient":
      return ingredientOutcome(success);
    case "points":
      return pointsOutcome(success ? STUB_POINTS : 0);
    case "trade": {
      const index = game.state.pending?.player ?? game.state.current;
      const player = game.state.players[index];
      let missing = 0;
      while (missing < INGREDIENT_COUNT && hasIngredient(player, missing)) missing++;
      return { kind: "magician", choice: success && missing < INGREDIENT_COUNT && game.canTrade(index) ? missing : null };
    }
    case "steal":
    case "bird":
      return { kind: "none" };
    default:
      throw new RangeError(`scène ${id} : pas un mini-jeu du registre`);
  }
}

/** Fond MCG de la souche (premier fond simple de chaque scène ; absent : S27, S32, S34, S36, S39, qui n'ont que des vidéos). */
const STUB_BACKGROUNDS: Readonly<Record<number, string>> = {
  22: "s22a001d.mcg",
  23: "s23a001d.mcg",
  24: "s24a001d.mcg",
  25: "s25aa01d.mcg",
  26: "s26a001d.mcg",
  28: "s28a001d.mcg",
  29: "s29a001d.mcg",
  30: "s30c001d.mcg",
  31: "s31a001d.mcg",
  33: "s33a001d.mcg",
  35: "s35a000d.mcg",
  38: "s38a000d.mcg",
  40: "s40a001d.mcg",
  41: "s41b002d.mcg",
  51: "s51a001d.mcg",
};

export interface StubSpec {
  id: number;
  game: Game;
  onDone: MinigameDone;
}

/**
 * Souche d'un mini-jeu pour les tests de parcours (le fond vient de `STUB_BACKGROUNDS`) : fond de la scène, Espace = réussi, Entrée = échoué (ingrédient obtenu ou non, 2 points ou
 * 0, échange avec le magicien du premier ingrédient manquant ou refus, `none` pour S38 et S39).
 */
export function createStubMinigame({ id, game, onDone }: StubSpec): Scene {
  const keys: Action[] = ["validate", "cancel"];
  return new MinigameStub({
    mcg: STUB_BACKGROUNDS[id],
    fadeIn: true,
    keys,
    onDone: (ctx, action) => onDone(ctx, stubOutcome(id, game, action === "validate")),
  });
}
