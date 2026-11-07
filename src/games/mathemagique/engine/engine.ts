import {
  Engine,
  type FrameSource,
  type KeyHandler as MohawkKeyHandler,
  type TickHook as MohawkTickHook,
} from "../../../engine/mohawk/engine";
import type { CursorKind, Host } from "./host";
import { RosterState, RosterStore } from "./roster";
import { SCENE_NAMES, SceneId, type SceneContext } from "./scene";

export type { FrameSource };

/** Appelé à chaque tick, avant le `tick` de la scène (gadgets, lecteur de scripts, séquenceur…). */
export type TickHook = MohawkTickHook<SceneContext>;

/** Gestionnaire de touche ; renvoie vrai si la touche est consommée. */
export type KeyHandler = MohawkKeyHandler<SceneContext>;

export interface EngineOptions {
  /** Graine du hasard ; défaut : l'horloge murale (`host.unixMillis()`, 32 bits bas). */
  seed?: number;
  /** Appelé quand une scène n'a pas pu être chargée. */
  onError?: (error: unknown, sceneId: SceneId) => void;
}

type MathExt = Pick<SceneContext, "roster">;

/**
 * Moteur de Mathémagique : le moteur Mohawk commun, avec le roster (enregistré dans le stockage de l'hôte) dans le contexte,
 * l'écran titre pour première scène (`1108:1b20 = 8`), le curseur `busy` pendant un chargement, des `STRL` en Windows-1252 et
 * Ctrl+Q pour quitter.
 */
export class MathEngine extends Engine<SceneId, MathExt, CursorKind> {
  constructor(host: Host, options: EngineOptions = {}) {
    super(host, {
      ...options,
      start: SceneId.title,
      extend: (): MathExt => ({ roster: new RosterState(new RosterStore(host.storage)) }),
      busyCursor: "busy",
      defaultCursor: "arrow",
      sceneName: (id) => SCENE_NAMES[id]!,
      resources: { strlEncoding: "windows-1252" },
    });
  }
}

export function createMathEngine(host: Host, options: EngineOptions = {}): MathEngine {
  return new MathEngine(host, options);
}
