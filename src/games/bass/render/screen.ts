/**
 * Écran de *Beneath a Steel Sky* : composition d'un tour, palette, fondus, défilement et séquences « swing », derrière `BassScreen`.
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen` : `setPaletteEndian`, `halvePalette`, `clearScreen`, `fnDrawScreen`, `fnFadeDown`,
 * `palette_fadedown_helper`, `paletteFadeUp`, `fnFadeUp` et son défilement, `startSequenceItem`, `processSequence`, `flip`, `showScreen`)
 * (GPL v3 ou ultérieure), lu puis réécrit. Le dessin des sprites est dans `sprite-engine.ts`, les primitives dans `draw.ts`,
 * `palette-fade.ts` et `data/sequence.ts`.
 *
 * Deux tampons comme ScummVM : `current` (`_currentScreen`, l'écran de travail 320 x 200 où le décor, les sprites et les séquences sont
 * dessinés) et `frame` (ce que la machine affiche : `copyRectToScreen` des blocs envoyés par `flip`, `showScreen` d'une image entière ;
 * `frame.palette` est la palette de la machine, `work` la palette de travail `_palette`). L'hôte lit seulement `frame` (`toRgba()`).
 *
 * Fonctionnement dans le moteur :
 * - les mcodes d'écran demandent des effets (`effects.ts`) qui appellent `fadeDown`, `drawNewScreen`, `fadeUp` puis `effectStep` à chaque tick
 *   de 20 ms ; un pas de fondu au noir (-8 par composante), de fondu en entrée (`(cible * n) >> 5`) ou de défilement (16 pixels) est fait à
 *   l'appel de `effectStep(nom, pas, total)` ;
 * - la composition d'un tour (`recreate`, `spriteEngine`, `flip`, après `processSequence`) est `compose()`, appelée par `BassEngine.cycle` ;
 *   voir `docs/bass/graphics.md`.
 *
 * Écarts volontaires : le curseur de la souris n'est pas dans `frame` (ScummVM le dessine par `CursorMan`, hors de la surface de l'écran) ;
 * l'image de fin d'un défilement (`showScreen(_currentScreen)` juste après le dernier pas) est présentée au prochain `processSequence`,
 * `compose` ou appel de service, soit dans le même tick ; le tampon d'un défilement est mis à 0 (ScummVM : mémoire non initialisée) ; pas de
 * rendu iBass ni de grille de débogage ; une séquence d'une seule image s'arrête après elle (ScummVM ne s'arrêterait jamais).
 */

import { SEQUENCE_FRAME_MS, decodeSequenceFrame } from "../data/sequence";
import { GAME_COLORS, PALETTE_BYTES, vgaPaletteToRgb } from "../data/palette";
import { SF } from "../engine/ids";
import type { BassScreen } from "../engine/services";
import type { CursorOverlay, CursorState } from "./cursor";
import { ScrollDirection, scrollFrame } from "./draw";
import { FrameBuffer, GAME_SCREEN_SIZE, SCREEN_SIZE, SCREEN_WIDTH, initialPalette } from "./frame-buffer";
import { fadeDownStep, fadeUpStep, halvedPalette } from "./palette-fade";
import { SpriteEngine, type SpriteSource } from "./sprite-engine";

/** Ce que l'écran lit du moteur (satisfait par `BassEngine`) en plus de ce que lit le moteur de sprites. */
export interface ScreenSource extends SpriteSource {
  readonly system: { readonly systemFlags: number };
}

/** Composantes de la palette compact (`fetchCpt`) en octets : mots de 16 bits petit-boutistes, comme le fichier. */
function paletteBytes(words: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(PALETTE_BYTES);
  for (let i = 0; i < PALETTE_BYTES; i++) bytes[i] = (words[i >> 1]! >> ((i & 1) * 8)) & 0xff;
  return bytes;
}

export class BassScreenRenderer implements BassScreen {
  /** Écran affiché et palette de la machine. */
  readonly frame = new FrameBuffer();
  /** Compte les présentations (`flip`, `showScreen`, séquences) : l'hôte redessine quand il change. */
  presented = 0;

  private source: ScreenSource | null = null;
  private current = new Uint8Array(SCREEN_SIZE);
  private scrollScreen: Uint8Array | null = null;
  private scrollFinished = true;
  private readonly sprites = new SpriteEngine();
  /** `_palette` : palette de travail 256 couleurs RVB 8 bits (fondus, `setPalette`). */
  private readonly work = initialPalette();
  /** Palette visée par un fondu en entrée (`tmpPal` de `paletteFadeUp`). */
  private fadeTarget: Uint8Array = new Uint8Array(PALETTE_BYTES);
  private fadeUpScroll = 0;

  private seqData: Uint8Array | null = null;
  private seqPos = 0;
  private seqFramesLeft = 0;
  private seqNextFrame = 0;
  private seqRunning = false;

  /**
   * Octets RGBA de l'image **avec le curseur** par-dessus (`overlay` le dessine à la position du pointeur de la machine) : `frame` reste sans
   * curseur, comme la surface de ScummVM. `out` peut être réutilisé d'une image à l'autre.
   */
  toRgbaWithCursor(overlay: CursorOverlay, state: CursorState, out?: Uint8Array | Uint8ClampedArray): Uint8Array | Uint8ClampedArray {
    const rgba = this.frame.toRgba(out);
    overlay.draw(rgba, this.frame.palette, state);
    return rgba;
  }

  /** Lie l'écran au moteur (les compacts, les variables et les fichiers n'existent qu'une fois le moteur construit). */
  attach(source: ScreenSource): this {
    this.source = source;
    return this;
  }

  /** Grille de jeu (`_gameGrid`) : exposée aux tests. */
  get grid(): Uint8Array {
    return this.sprites.grid;
  }

  /** Écran de travail (`_currentScreen`) : exposé aux tests. */
  get workScreen(): Uint8Array {
    return this.current;
  }

  private get engine(): ScreenSource {
    if (!this.source) throw new Error("BassScreenRenderer : attach(engine) n'a pas été appelé");
    return this.source;
  }

  // --- Présentation ---

  /** `showScreen(buffer)` / `renderFinalFrame` : l'écran de travail ou `buffer` est envoyé en entier à la machine. */
  private present(buffer: Uint8Array): void {
    this.frame.pixels.set(buffer.subarray(0, SCREEN_SIZE));
    this.presented++;
  }

  /** Fin d'un défilement : `showScreen(_currentScreen)` puis libération de `_scrollScreen`. */
  private finishScroll(): void {
    if (this.scrollFinished) return;
    this.scrollFinished = true;
    this.scrollScreen = null;
    this.present(this.current);
  }

  /** Applique les 240 premières couleurs de `work` à la machine (`getPaletteManager()->setPalette(_palette, 0, GAME_COLORS)`). */
  private setMachinePalette(rgb: Uint8Array): void {
    this.frame.palette.set(rgb.subarray(0, GAME_COLORS * 3));
    this.presented++;
  }

  // --- Composition d'un tour ---

  /**
   * `recreate`, `spriteEngine`, `flip` : appelé par `BassEngine.cycle` à la fin de chaque tour (après `processSequence`) et par `fnLookAt`.
   * `drawNewScreen` en fait autant avec tout le décor à recopier.
   */
  compose(): void {
    this.finishScroll();
    const source = this.engine;
    this.sprites.recreate(source, this.current);
    this.sprites.spriteEngine(source, this.current);
    if (this.sprites.flip(this.current, this.frame.pixels) > 0) this.presented++;
  }

  // --- BassScreen ---

  setPalette(paletteCpt: number): void {
    this.finishScroll();
    const rgb = vgaPaletteToRgb(paletteBytes(this.engine.compacts.require(paletteCpt)));
    this.work.set(rgb);
    this.setMachinePalette(this.work);
  }

  fadeDown(scroll: number): void {
    this.finishScroll();
    if (this.scrollKind(scroll) === 0) return; // les pas sont joués par `effectStep("fadeDown", …)`
    // Défilement : seulement préparé ici. Le nouveau décor sera dessiné dans un nouvel écran de travail, `fadeUp` le fait défiler.
    this.scrollScreen = this.current;
    this.current = new Uint8Array(SCREEN_SIZE);
    this.scrollFinished = false;
  }

  drawNewScreen(): void {
    const source = this.engine;
    this.sprites.forceRefresh();
    this.sprites.recreate(source, this.current);
    this.sprites.spriteEngine(source, this.current);
    this.sprites.flip(this.current, this.frame.pixels); // pas encore présenté en cas de défilement : le pas 1 recouvre tout
  }

  fadeUp(paletteCpt: number, scroll: number): void {
    this.fadeUpScroll = this.scrollKind(scroll);
    if (this.fadeUpScroll === 0) {
      this.fadeTarget = vgaPaletteToRgb(paletteBytes(this.engine.compacts.require(paletteCpt)));
    } else if (!this.scrollScreen) throw new Error("Screen::fnFadeUp : défilement sans fnFadeDown préalable");
  }

  effectStep(name: string, step: number, total: number): void {
    if (name === "fadeDown") {
      fadeDownStep(this.work);
      this.setMachinePalette(this.work);
    } else if (name === "fadeUp") {
      fadeUpStep(this.fadeTarget, step + 1, this.work);
      this.setMachinePalette(this.work);
    } else if (name === "scrollLeft" || name === "scrollRight") {
      this.scrollStep(name === "scrollLeft" ? ScrollDirection.left : ScrollDirection.right, step + 1);
    } else {
      throw new Error(`effet d'écran inconnu : ${name} (${step}/${total})`);
    }
  }

  /** `Control::restartGame` : `forceRefresh`, écran de travail à 0 présenté (`showScreen`) ; la palette suit (`setPalette`). */
  reset(): void {
    this.finishScroll();
    this.sprites.forceRefresh();
    this.current.fill(0);
    this.present(this.current);
  }

  clearScreen(): void {
    this.finishScroll();
    this.current.fill(0);
    this.present(this.current);
  }

  /** Image du pas `step` (1 à 19) d'un défilement (`fnFadeUp`) ; la dernière image est présentée par `finishScroll`. */
  private scrollStep(direction: ScrollDirection, step: number): void {
    const oldScreen = this.scrollScreen;
    if (!oldScreen) throw new Error("défilement sans écran précédent");
    const mix = new Uint8Array(SCREEN_SIZE);
    mix.set(oldScreen.subarray(GAME_SCREEN_SIZE, SCREEN_SIZE), GAME_SCREEN_SIZE); // les 8 lignes du bas restent celles de l'ancien écran
    scrollFrame(mix, oldScreen, this.current, direction, step);
    this.present(mix);
  }

  /** `halvePalette` (pause) : la machine montre la moitié de la palette de travail ; `setPalette` ou `resumePalette` la rétablit. */
  halvePalette(): void {
    this.frame.palette.set(halvedPalette(this.work).subarray(0, GAME_COLORS * 3));
    this.presented++;
  }

  /** Fin de la pause : palette de la machine = palette de travail. */
  resumePalette(): void {
    this.setMachinePalette(this.work);
  }

  /** `scroll` normalisé comme `fnFadeUp` : 123, 321 ou 0 (fondu) ; 0 aussi si `SF_NO_SCROLL`. */
  private scrollKind(scroll: number): number {
    if (scroll !== 123 && scroll !== 321) return 0;
    return this.engine.system.systemFlags & SF.NO_SCROLL ? 0 : scroll;
  }

  // --- Séquences « swing » ---

  startSequence(_item: number, data: Uint8Array | null, now: number): void {
    this.finishScroll();
    if (!data || !data.length) {
      this.seqRunning = false;
      return;
    }
    this.seqData = data;
    this.seqPos = 1;
    this.seqFramesLeft = data[0]! - 1;
    this.seqNextFrame = now + SEQUENCE_FRAME_MS;
    this.seqRunning = true;
  }

  sequenceRunning(): boolean {
    return this.seqRunning;
  }

  processSequence(now: number): void {
    this.finishScroll();
    if (!this.seqRunning || now < this.seqNextFrame || !this.seqData) return;
    this.seqNextFrame += SEQUENCE_FRAME_MS;
    const result = decodeSequenceFrame(this.seqData, this.seqPos, this.current);
    this.seqPos = result.next;
    // `renderRect` des blocs de 16 x 16 modifiés.
    for (let by = 0; by < 12; by++) {
      for (let bx = 0; bx < 20; bx++) {
        if (!result.dirty[by * 20 + bx]) continue;
        for (let line = 0; line < 16; line++) {
          const pos = (by * 16 + line) * SCREEN_WIDTH + bx * 16;
          this.frame.pixels.set(this.current.subarray(pos, pos + 16), pos);
        }
      }
    }
    this.presented++;
    this.seqFramesLeft--;
    if (this.seqFramesLeft <= 0) {
      this.seqRunning = false;
      this.seqData = null;
    }
  }
}
