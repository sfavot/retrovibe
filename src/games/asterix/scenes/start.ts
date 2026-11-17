import type { GameConfig } from "../../../engine/infogrames/engine";
import { parseExeTables } from "../data/exe";
import { createSession, type Session } from "../game/state";
import { main } from "./menu";
import { playMinigame, type MinigameStart } from "./minigame";
import "./minigames/index";
import { Runtime, ScriptScene } from "./runtime";
import type { GameSave } from "./save";

/** Ce qu'Astérix fournit au moteur commun : ses bruitages sont préchargés par `Runtime.preload` (`19e2:0008`), sans bips. */
export const GAME_CONFIG: GameConfig = { beepFiles: [] };

/** Exécutable d'origine, lu pour ses tables (décision D4). */
const EXECUTABLE = "ASTERIX.EXE";

export interface StartOptions {
  /** Partie sauvegardée à reprendre directement (décision D6), sans logos ni introduction. */
  resume?: GameSave | null;
  /** Passe les logos et l'introduction (page de dev, tests). */
  skipIntro?: boolean;
  /** Mémoires de séance à utiliser ; par défaut celles de la page (décision D13). */
  session?: Session;
  /** Joue d'abord ce mini-jeu, hors partie, puis passe au menu principal (page de dev, tests). */
  minigame?: MinigameStart;
}

/**
 * Mémoires que l'original garde d'une partie à l'autre tant que le programme tourne (décision D13) : elles vivent ici
 * tant que la page reste ouverte, même si le jeu est remonté, et repartent de zéro au rechargement.
 */
let pageSession: Session | null = null;

/** Le jeu en cours : sa scène, et son socle une fois les tables lues. */
export interface AsterixGame {
  readonly scene: ScriptScene;
  /** `null` tant que l'exécutable n'est pas lu. */
  readonly runtime: Runtime | null;
}

/** Scène du jeu entier : lit les tables de l'exécutable, puis déroule le script racine (`main`). */
export function createGame(options: StartOptions = {}): AsterixGame {
  let runtime: Runtime | null = null;
  const scene = new ScriptScene(function* (ctx) {
    const tables = parseExeTables((yield ctx.resources.bytes(EXECUTABLE)) as Uint8Array);
    const defaults = { duration: tables.defaultDuration, objectsRequired: tables.defaultObjects };
    const session = options.session ?? (pageSession ??= createSession(defaults));
    runtime = new Runtime(ctx, tables, session);
    if (options.minigame) {
      yield runtime.preload();
      yield* playMinigame(runtime, options.minigame);
    }
    yield* main(runtime, options.resume ?? null, options.skipIntro || options.minigame !== undefined);
  });
  scene.beforeStep = () => runtime?.tick();
  scene.beforePresent = () => runtime?.showHeld();
  return {
    scene,
    get runtime() {
      return runtime;
    },
  };
}
