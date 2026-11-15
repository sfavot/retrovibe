import type { PointClickEngine } from "../../../ui/point-click-app";
import { CURSORS, CURSOR_TRANSPARENT, cursorPixels } from "../data/static-tables";
import type { CroisiereEngine } from "../engine/main-loop";
import { canSave } from "../engine/save";
import type { CroisiereRenderer } from "../engine/services";
import type { EngineState } from "../engine/state";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./browser-host";

/** Pas de l'hôte (ms) : une itération de l'attente active de `mainLoop` (`LOOP_DELAY_MS`). */
export const STEP_MS = 10;
/** Itérations au plus par pas de l'hôte (garde-fou si le temps virtuel prend du retard). */
const MAX_STEPS_PER_TICK = 8;
/** Images en attente au plus (un fondu en présente une dizaine d'un coup). */
const MAX_FRAMES = 32;

/** Image présentée par le moteur, datée en temps virtuel. */
interface Frame {
  time: number;
  pixels: Uint8Array;
  palette: Uint8Array;
}

/** Curseurs en 16 × 16 indices (0 noir, 1 blanc, `CURSOR_TRANSPARENT`), dans l'ordre de `CursorType`. */
const CURSOR_IMAGES = CURSORS.map(cursorPixels);

/**
 * Rendu du navigateur : chaque présentation du moteur (`flipScreen`, pas des fondus) est copiée et datée en temps virtuel. Le moteur
 * compose un fondu d'un trait (neuf pas de 20 ms dans le même tour) : la boucle montre chaque image quand l'horloge de la page atteint
 * sa date, ce qui rend les fondus visibles à leur vitesse d'origine.
 */
export class FrameQueue implements CroisiereRenderer {
  private frames: Frame[] = [];

  present(e: EngineState): void {
    if (this.frames.length >= MAX_FRAMES) this.frames.shift();
    this.frames.push({ time: e.virtualTime, pixels: e.display.globalScreen.slice(), palette: e.display.hardwarePalette.slice() });
  }

  /** L'image à montrer à l'instant `time` : la plus récente qui n'est pas dans le futur (les précédentes sont oubliées). */
  at(time: number): Frame | undefined {
    while (this.frames.length > 1 && this.frames[1]!.time <= time) this.frames.shift();
    return this.frames[0];
  }

  clear(): void {
    this.frames = [];
  }
}

/**
 * Indices de la palette à emprunter pour le curseur noir et blanc (la palette du jeu a ses 256 couleurs) : deux indices absents de
 * l'image, ou, si elle les emploie tous, les couleurs les plus proches du noir et du blanc.
 */
export function cursorColors(pixels: Uint8Array, palette: Uint8Array): { black: number; white: number; borrowed: boolean } {
  const used = new Uint8Array(256);
  for (const index of pixels) used[index] = 1;
  const free: number[] = [];
  for (let i = 255; i >= 0 && free.length < 2; i--) if (!used[i]) free.push(i);
  if (free.length === 2) return { black: free[0]!, white: free[1]!, borrowed: true };
  let black = 0;
  let white = 0;
  let dark = Infinity;
  let light = -1;
  for (let i = 0; i < 256; i++) {
    const sum = palette[i * 3]! + palette[i * 3 + 1]! + palette[i * 3 + 2]!;
    if (sum < dark) [dark, black] = [sum, i];
    if (sum > light) [light, white] = [sum, i];
  }
  return { black, white, borrowed: false };
}

export interface CroisiereLoopOptions {
  /** Le moteur courant (remplacé au chargement d'une partie). */
  engine(): CroisiereEngine;
  frames: FrameQueue;
  /** Peint une image indexée (`IndexedPresenter.present`). */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /** Le curseur est caché (dernier geste au doigt). */
  touchMode(): boolean;
}

/**
 * Boucle d'un pas de 10 ms (`STEP_MS`) : le moteur avance d'itérations de son attente active (`CroisiereEngine.step`) tant que son temps
 * virtuel est en retard sur l'horloge de la page. Un fondu ou une attente du son avancent le temps virtuel d'un coup : la page attend
 * alors que son horloge le rattrape, et la musique (comptée sur le temps virtuel) reste calée sur l'image.
 * `render` peint l'image du moment, avec le curseur de la souris par-dessus (ScummVM le dessine hors de l'écran du jeu).
 */
export class CroisiereLoop implements PointClickEngine {
  /** Horloge de la page, en millisecondes du temps virtuel du moteur. */
  private clock = 0;
  private readonly scratch = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  private readonly lut = new Uint8Array(768);

  constructor(private readonly options: CroisiereLoopOptions) {}

  private get state(): EngineState {
    return this.options.engine().state;
  }

  /** Repart du temps virtuel du moteur (nouveau moteur après un chargement : vider `frames` avant de le construire). */
  resync(): void {
    this.clock = this.state.virtualTime;
  }

  tick(): void {
    const engine = this.options.engine();
    this.clock += STEP_MS;
    for (let n = 0; n < MAX_STEPS_PER_TICK && !engine.stopped && engine.state.virtualTime < this.clock; n++) engine.step();
  }

  /** Sauvegarde possible (`canSave` : le joueur a la main, aucun menu du jeu ouvert, partie en cours). */
  get canSave(): boolean {
    const engine = this.options.engine();
    return !engine.stopped && canSave(engine.state);
  }

  /** « Passer » (un clic sur place) a un effet : un texte attend un clic, ou le joueur n'a pas la main (introduction, scène). */
  get canSkip(): boolean {
    const e = this.state;
    return e.userWait || !e.userEnabled;
  }

  /** Le menu joueur peut s'ouvrir (`playerMenu` : autorisé par le jeu et affichage actif). */
  get canOpenPlayerMenu(): boolean {
    const e = this.state;
    return e.playerMenuEnabled !== 0 && e.displayOn !== 0 && e.currentActiveMenu === -1;
  }

  render(): void {
    const frame = this.options.frames.at(this.clock);
    if (!frame) return;
    const e = this.state;
    if (this.options.touchMode()) {
      this.options.present(frame.pixels, frame.palette);
      return;
    }
    const image = CURSOR_IMAGES[e.cursor] ?? CURSOR_IMAGES[0]!;
    const cursor = CURSORS[e.cursor] ?? CURSORS[0]!;
    this.scratch.set(frame.pixels);
    this.lut.set(frame.palette);
    const { black, white, borrowed } = cursorColors(frame.pixels, frame.palette);
    if (borrowed) {
      this.lut.fill(0, black * 3, black * 3 + 3);
      this.lut.fill(255, white * 3, white * 3 + 3);
    }
    const left = e.currentMouseX - cursor.hotspotX;
    const top = e.currentMouseY - cursor.hotspotY;
    for (let y = 0; y < 16; y++) {
      const sy = top + y;
      if (sy < 0 || sy >= SCREEN_HEIGHT) continue;
      for (let x = 0; x < 16; x++) {
        const sx = left + x;
        const value = image[y * 16 + x]!;
        if (sx < 0 || sx >= SCREEN_WIDTH || value === CURSOR_TRANSPARENT) continue;
        this.scratch[sy * SCREEN_WIDTH + sx] = value ? white : black;
      }
    }
    this.options.present(this.scratch, this.lut);
  }
}
