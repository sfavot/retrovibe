import { BrowserHost, toPlayArea as toPlayAreaIn } from "../../../ui/mohawk/browser-host";
import type { CanvasGeometry } from "../../../ui/mohawk/canvas-presenter";
import type { WebAudioSink } from "../../../ui/mohawk/web-sink";
import type { GameFiles } from "../data/files";
import type { CursorKind } from "../engine/host";
import { PLAY_ORIGIN_X, PLAY_ORIGIN_Y, SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/graphics/play-area";

// Aides pures de l'hôte navigateur (clavier, focus), communes aux jeux Mohawk.
export { gameModifiers, gameOwnsKey, isComposedKey, keepsInputOnBlur, type KeyInfo } from "../../../ui/mohawk/browser-host";

/** Canvas de Mathémagique : 640×480 logiques, zone de jeu 576×432 centrée (bordure noire de 32×24). */
export const MATH_GEOMETRY: CanvasGeometry = {
  screenWidth: SCREEN_WIDTH,
  screenHeight: SCREEN_HEIGHT,
  originX: PLAY_ORIGIN_X,
  originY: PLAY_ORIGIN_Y,
};

/** Valeur CSS `cursor` de chaque curseur du moteur. Remplaçable par `setCursorStyle` (bitmaps `CURS` de `MILKYWAY.DAT`). */
const CURSORS: Readonly<Record<CursorKind, string>> = {
  arrow: "default",
  busy: "progress",
  help: "help",
  hidden: "none",
};

export type MathBrowserHost = BrowserHost<CursorKind>;

/**
 * Hôte navigateur de Mathémagique.
 * `base` : URL du dossier des fichiers du jeu, sans barre finale (ex. `./mathemagique`).
 * `onExit` : ce que fait `exit()` une fois le son coupé (retour à l'accueil, redémarrage…).
 */
export function createMathBrowserHost(base: string, files: GameFiles, canvas: HTMLCanvasElement, onExit: () => void, audio?: WebAudioSink): MathBrowserHost {
  return new BrowserHost<CursorKind>({ base, files, canvas, onExit, geometry: MATH_GEOMETRY, cursors: CURSORS, defaultCursor: "arrow", audio });
}

/** Point de l'écran dans la zone de jeu de 576×432 (voir `toPlayArea` de l'hôte commun). */
export function toPlayArea(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  return toPlayAreaIn(clientX, clientY, rect, MATH_GEOMETRY);
}
