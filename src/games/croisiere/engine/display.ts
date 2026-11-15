/**
 * État d'affichage logique : fonds (`backgroundScreens`), noms des fonds, palettes par écran et palette de travail, fondus.
 *
 * Références : `background.cpp::loadBackground` (palette, image, `DGF1.PI1`), `mainDraw.cpp` (`flipScreen`, `fadeIn`, `calcRGB`),
 * `function.cpp` (`Op_FadeOut`, `Op_SetColor`, `Op_SetActiveBackground`, `Op_RemoveBackground`, `Op_ClearScreen`),
 * `cruise_main.cpp::findHighColor`, `gfxModule.cpp` (palette matérielle `lpalette`) de ScummVM (GPL v3+, release 2026.4.0).
 *
 * La palette de travail (`workpal`) est logique : `findHighColor` la lit pour la couleur des messages. La palette « matérielle »
 * (`hardwarePalette`, `lpalette`) est ce que le rendu affiche. Les attentes des fondus (`fadeIn` : 9 pas de 20 ms) passent par
 * `delay` (temps virtuel, D7).
 * Pages (`gfxModule.cpp`) : `mainDraw` compose dans `page10` (`pPage10`), `flipScreen` échange les deux pages puis copie `page00` dans
 * `globalScreen`, l'image affichée (celle du CRC `SC` du banc). `Op_FadeOut` noircit `globalScreen` sans toucher aux pages. L'état du
 * rastériseur de polygones (`poly`), partagé par le dessin, le hit-test et les zones de marche, vit ici avec le masque `polygonMask`.
 * Écart volontaire : les modes de fond 0 et 4 (absents des données) ne sont pas lus ; MEN et CVT, absents aussi des fichiers
 * (taille exacte vérifiée par `data/background.ts`), laissent `CVTLoaded` à 0 comme dans ScummVM.
 */
import { isPaletteOnly, parseBackground, parsePaletteOnly, PALETTE_SIZE, SCREEN_PIXELS } from "../data/background";
import { POLY_MASK_SIZE, PolyRasterizer } from "../render/poly";
import { NBSCREENS, ScriptError } from "./ids";
import { strlcpy } from "./memory";

export class DisplayState {
  readonly backgroundScreens: (Uint8Array | null)[] = new Array(NBSCREENS).fill(null);
  readonly backgroundChanged: boolean[] = new Array(NBSCREENS).fill(false);
  /** Noms des fonds (`backgroundTable[i].name`, 16 octets). */
  readonly backgroundNames: string[] = new Array(NBSCREENS).fill("");
  readonly palScreen: Uint8Array[] = Array.from({ length: NBSCREENS }, () => new Uint8Array(PALETTE_SIZE));
  readonly workpal = new Uint8Array(PALETTE_SIZE);
  /** Palette envoyée à l'écran (`lpalette`). */
  readonly hardwarePalette = new Uint8Array(PALETTE_SIZE);
  masterScreen = 0;
  switchPal = 0;
  doFade = 0;
  fadeFlag = 0;
  pcFadeFlag = false;
  cvtLoaded = 0;
  readonly cvtPalette = new Int16Array(0x20);
  /** Couleurs des menus (`titleColor`, `selectColor`, `itemColor`, `subColor`). */
  titleColor = 2;
  selectColor = 3;
  itemColor = 1;
  subColor = 5;
  /** Page affichée (`pPage00`) et page de travail (`pPage10`), échangées par `flipScreen`. */
  page00 = new Uint8Array(SCREEN_PIXELS);
  page10 = new Uint8Array(SCREEN_PIXELS);
  /** Image présentée (`globalScreen`). */
  readonly globalScreen = new Uint8Array(SCREEN_PIXELS);
  /** Rastériseur de polygones et son état global (`bigPolyBuf`, `nbseg`, `nbligne`). */
  readonly poly = new PolyRasterizer();
  /** Masque d'occultation des polygones (`polygonMask`). */
  readonly polygonMask = new Uint8Array(POLY_MASK_SIZE);

  /** `gfxModuleData_setPalEntries`. */
  setPalEntries(src: Uint8Array, start: number, count: number): void {
    this.hardwarePalette.set(src.subarray(start * 3, (start + count) * 3), start * 3);
  }

  /**
   * `loadBackground` : −18 si le fichier manque. `read` donne le contenu dépacké ou `null`. `disableUser` est appelé pour `DGF1.PI1`
   * (pas de sauvegarde pendant la fin).
   */
  loadBackground(name: string, idx: number, read: (name: string) => Uint8Array | null, disableUser: () => void): number {
    if (name === "DGF1.PI1") disableUser();
    if (!this.backgroundScreens[idx]) this.backgroundScreens[idx] = new Uint8Array(SCREEN_PIXELS);
    this.backgroundChanged[idx] = true;
    const bytes = read(name);
    if (!bytes) return ScriptError.fileNotFound;
    if (isPaletteOnly(bytes)) {
      this.palScreen[idx]!.set(parsePaletteOnly(bytes));
      this.setPalEntries(this.palScreen[idx]!, 0, 256);
    } else {
      const bg = parseBackground(bytes);
      this.palScreen[idx]!.set(bg.palette);
      this.setPalEntries(this.palScreen[idx]!, 0, 256);
      this.backgroundScreens[idx]!.set(bg.pixels);
      this.cvtLoaded = 0;
    }
    this.backgroundNames[idx] = strlcpy(name, 16);
    return 0;
  }

  /** `calcRGB` d'une couleur avec un décalage par composante. */
  private static shift(src: Uint8Array, srcAt: number, dst: Uint8Array, dstAt: number, offsets: readonly number[]): void {
    for (let k = 0; k < 3; k++) dst[dstAt + k] = Math.min(Math.max(src[srcAt + k]! + offsets[k]!, 0), 0xff);
  }

  /** `gfxModuleData_flipScreen` : `globalScreen` reçoit la page affichée. */
  showPage(): void {
    this.globalScreen.set(this.page00);
  }

  /** `fadeIn` : 9 pas de −256 à 0 (20 ms chacun, chacun présenté), puis la palette de l'écran. */
  fadeIn(delay: (ms: number) => void, present: () => void = () => {}): void {
    const pal = this.palScreen[this.masterScreen]!;
    for (let i = 256; i >= 0; i -= 32) {
      for (let j = 0; j < 256; j++) DisplayState.shift(pal, 3 * j, this.workpal, 3 * j, [-i, -i, -i]);
      this.setPalEntries(this.workpal, 0, 256);
      present();
      delay(20);
    }
    for (let j = 0; j < 256; j++) DisplayState.shift(pal, 3 * j, this.workpal, 3 * j, [0, 0, 0]);
    this.setPalEntries(this.workpal, 0, 256);
    this.fadeFlag = 0;
    this.pcFadeFlag = false;
  }

  /** `flipScreen` : palette de l'écran maître si demandé, échange des pages, présentation, fondu d'entrée armé par `Op_FadeIn`. */
  flipScreen(delay: (ms: number) => void, present: () => void): void {
    if (this.switchPal) {
      this.workpal.set(this.palScreen[this.masterScreen]!);
      this.switchPal = 0;
      this.setPalEntries(this.workpal, 0, 256);
    }
    [this.page00, this.page10] = [this.page10, this.page00];
    this.showPage();
    present();
    if (this.doFade) {
      this.fadeIn(delay, present);
      this.doFade = 0;
    }
  }

  /** `Op_FadeOut` : 8 pas de −32 sur la palette de travail (chacun présenté), puis écran noir. */
  fadeOut(present: () => void = () => {}): void {
    for (let i = 0; i < 256; i += 32) {
      for (let j = 0; j < 256; j++) DisplayState.shift(this.workpal, 3 * j, this.workpal, 3 * j, [-32, -32, -32]);
      this.setPalEntries(this.workpal, 0, 256);
      this.showPage();
      present();
    }
    this.globalScreen.fill(0);
    present();
    this.fadeFlag = 1;
    this.pcFadeFlag = true;
  }

  /** `Op_SetColor` : décalage des couleurs `start..end` de la palette de l'écran vers la palette de travail. */
  setColor(start: number, end: number, r: number, g: number, b: number): void {
    const ratio = 36.571428571428571428571428571429;
    const offsets = [Math.trunc(r * ratio), Math.trunc(g * ratio), Math.trunc(b * ratio)];
    const pal = this.palScreen[this.masterScreen]!;
    for (let i = start; i <= end; i++) {
      const idx = this.cvtLoaded ? this.cvtPalette[i & 0x1f]! : i;
      if (idx < 0 || idx > 255) continue;
      DisplayState.shift(pal, 3 * idx, this.workpal, 3 * idx, offsets);
    }
    this.setPalEntries(this.workpal, 0, 32);
  }

  /** `findHighColor` : couleur la plus lumineuse de la palette de travail. */
  findHighColor(): number {
    let best = -1;
    let bestIdx = -1;
    for (let i = 0; i < 256; i++) {
      const v = Math.trunc((this.workpal[i * 3]! + this.workpal[i * 3 + 1]! + this.workpal[i * 3 + 2]!) / 256);
      if (v > best) {
        best = v;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
}
