import { Engine, type EngineOptions as MohawkEngineOptions } from "../../../engine/mohawk/engine";
import { defaultPrefs, type ZoombinisContext, type ZoombinisPrefs } from "./context";
import type { CursorKind, Host } from "./host";
import { SCREEN_NAMES, ScreenId } from "./scene";

export interface EngineOptions {
  /** Graine du hasard ; défaut : l'horloge murale (`host.unixMillis()`, 32 bits bas ; l'original graine sur `time()`, engine.md §8). */
  seed?: number;
  /** Appelé quand un écran n'a pas pu être chargé. */
  onError?: (error: unknown, screenId: ScreenId) => void;
}

type ZoombinisExt = Pick<ZoombinisContext, "prefs">;

/**
 * Moteur de Zoombinis : le moteur Mohawk commun avec les préférences dans le contexte, le logo (écran 0, engine.md §1.1) pour
 * premier écran, le curseur `busy` pendant un chargement, des `STRL` en Mac Roman (`TEXTSTR.MHK`). Ctrl+Q n'est pas géré ici :
 * l'original propose d'abord d'enregistrer la partie en cours (wave G), d'où `quitOnCtrlQ: false`.
 */
export class ZoombinisEngine extends Engine<ScreenId, ZoombinisExt, CursorKind> {
  constructor(host: Host, options: EngineOptions = {}) {
    const common: MohawkEngineOptions<ScreenId, ZoombinisExt, CursorKind> = {
      ...options,
      start: ScreenId.logo,
      extend: (): ZoombinisExt => ({ prefs: defaultPrefs() }),
      quitOnCtrlQ: false,
      busyCursor: "busy",
      defaultCursor: "system",
      sceneName: (id) => SCREEN_NAMES[id]!,
      resources: { strlEncoding: "mac-roman" },
    };
    super(host, common);
  }

  get prefs(): ZoombinisPrefs {
    return this.ctx.prefs;
  }
}

export function createZoombinisEngine(host: Host, options: EngineOptions = {}): ZoombinisEngine {
  return new ZoombinisEngine(host, options);
}
