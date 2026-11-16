/**
 * Transitions d'un plan (`SetShowStyle`) et défilement d'un pic vers un autre (`SetScroll`).
 *
 * Référence : `engines/sci/graphics/transitions32.cpp` de ScummVM (`GfxTransitions32::kernelSetShowStyle`,
 * `processShowStyles`, `processShowStyle`, `processNone`, `processFade`, `configure21EarlyDissolve`,
 * `processPixelDissolve21Early`, `deleteShowStyle`, `kernelSetScroll`, `processScroll`), GPL v3 ou
 * ultérieure, lu puis réécrit.
 *
 * - **Transition** : une par plan. Elle avance d'une étape à chaque passage (`processShowStyles`, appelé par `FrameOut`),
 *   sur `divisions` étapes espacées de `delay = ⌈secondes × 60 / divisions⌉` ticks.
 * - **Fondu** (types 13 et 14) : à l'étape `n`, toute la palette est à `n × 100 / (divisions − 1)` % (fondu d'entrée) ou
 *   à `(divisions − n − 1) × 100 / (divisions − 1)` % (fondu de sortie), divisions entières. Un fondu d'entrée fini
 *   disparaît de la liste ; **un fondu de sortie fini y reste**, palette à 0 %, jusqu'au `SetShowStyle` suivant du plan,
 *   qui le réutilise s'il a la même taille de plan et le même nombre d'étapes.
 * - **Sans animation** (`animate` nul, le cas du jeu) : `FrameOut` ne revient qu'une fois la transition finie ; il compose
 *   une image par étape (`engine/kernel/effects.ts`).
 * - **Défilement** : le nouveau pic est ajouté à côté du plan (à gauche si `deltaX` est positif, etc.), puis tous les
 *   éléments du plan glissent de `delta` par pas jusqu'à ce qu'il soit en place ; l'ancien pic est alors retiré.
 * - **Dissolution** (type 12, `configure21EarlyDissolve` et `processPixelDissolve21Early`) : à la création, l'image composée
 *   en dernier est copiée, pour le rectangle du plan, dans un bitmap posé sur le plan à la priorité donnée (couleur
 *   transparente 250 hors de l'écran). À chaque étape, `(pixels + étapes) / étapes` pixels du bitmap prennent la couleur
 *   visée (`fond`, ou le noir), dans l'ordre d'un registre à décalage : `i` impair devient `(i >> 1) ^ masque`, `i` pair
 *   `i >> 1`, jusqu'à tomber sous le nombre de pixels ; le masque dépend du nombre de bits de ce nombre
 *   (`DISSOLVE_MASKS`), le premier pixel est le 53 427. Quand la suite revient à son départ, tout le bitmap est rempli.
 *   **Le bitmap est opaque** : la nouvelle image du plan reste cachée dessous pendant toute la dissolution, et n'apparaît,
 *   d'un coup, que lorsqu'une dissolution « vers l'image » finie retire le bitmap. Vers une couleur, elle reste en place,
 *   bitmap plein, comme un fondu de sortie.
 *
 * **Types demandés par le jeu** (relevé sur les 213 scripts, figé par `test/gk1/render/script-usage.test.ts`) : `SetShowStyle`
 * n'est appelé que par `Styler::doit` (script 64909), qui reçoit le style de `Plane::drawPic` (propriété `style` d'une pièce ou
 * d'un encart, ou second argument de `drawPic`) et de `Game::newRoom` (propriété `exitStyle` de la pièce quittée).
 *
 * | type | demandes | exemple |
 * |---|---|---|
 * | 0, aucune | 54 `drawPic(pic, 0)`, 10 propriétés `style`, 3 `exitStyle`, 5 écritures d'`exitStyle` | ouverture (script 190) |
 * | 12, dissolution | 1 `drawPic(600, 12, 1)` | pièce 471, `doTheCloseUp` |
 * | 13, fondu de sortie | 56 propriétés `exitStyle`, 1 écriture | `rm200` |
 * | 14, fondu d'entrée | 140 `drawPic(pic, 14)`, 2 `drawPic(pic, 270)`, 79 propriétés `style`, 3 écritures | `rm200` ; 270 : pièces 710 et 750 |
 *
 * 270 vaut 256 + 14 : `Styler::doit` ne garde que l'octet bas. Aucun style ne porte le bit 1024 (plan retourné,
 * `Plane::drawPic`), aucun `exitStyle` les bits 256 et 512 (fond de `Game::newRoom`), aucun ne vaut 15 à 18 (`SetScroll`).
 * `Styler` appelle toujours avec 20 étapes (`divisions`, fixé par le script 10), une seconde, sans animation ni image de
 * référence : la dissolution de la pièce 471 dure 20 étapes de 3 ticks. Elle part d'un écran déjà noir (pic 99) et va vers
 * le noir : on ne voit qu'une seconde de noir de plus avant le pic 600 (ScummVM note le même cas).
 *
 * Écarts volontaires :
 * - **les types 1 à 11 ne sont pas portés**, faute d'appel dans le jeu : ils donnent une coupe franche (palette à 100 % ou à
 *   0 % selon le sens, comme le type 0) et un avertissement. Dans ScummVM, pour SCI2, `processShowStyle` joue les types 1, 5,
 *   6, 9 et 10 par des bandes de couleur (`processWipe`) et renvoie les autres (2, 3, 4, 7, 8, 11) à `processMorph`, un
 *   simple `FrameOut` ;
 * - dissolution : le premier pixel est ramené sous le nombre de pixels (ScummVM écrit le 53 427 tel quel, hors du bitmap
 *   d'un plan de moins de 53 428 pixels) ; au-delà de 65 535 pixels (impossible en 320×200), le dernier masque sert ; un plan
 *   supprimé pendant sa dissolution la termine (ScummVM garde l'entrée) ;
 * - une transition sans animation attend `delay` ticks entre deux étapes, soit la durée demandée par le script ; ScummVM
 *   enchaîne les étapes toutes les 33 ms (l'original allait à la vitesse de la machine) ;
 * - un plan retourné pendant un défilement n'est pas géré.
 */
import { NULL_REG, type Reg } from "../engine/memory";
import { TICKS_PER_SECOND } from "../engine/ids";
import { FADE_NONE, SHOW_STYLE_DIVISIONS, SHOW_STYLE_NO_BACK, ShowStyle } from "./ids";
import type { GamePalette } from "./palette";
import type { Plane } from "./plane";
import { declareState } from "../engine/save-codec";

const LAST_COLOR = 255;
/** Types joués ; les autres donnent une coupe franche. */
const PORTED_STYLES: ReadonlySet<number> = new Set([ShowStyle.Dissolve, ShowStyle.FadeOut, ShowStyle.FadeIn]);
/** Dissolution : masque du registre à décalage selon le nombre de bits du nombre de pixels (2 bits, 3 bits… 16 bits). */
const DISSOLVE_MASKS = [3, 6, 12, 20, 48, 96, 184, 272, 576, 1280, 3232, 6912, 13568, 24576, 46080] as const;
/** Dissolution : premier terme de la suite. */
const DISSOLVE_FIRST_PIXEL = 53427;

export interface ShowStyleEntry {
  plane: Reg;
  type: number;
  divisions: number;
  currentStep: number;
  /** Transition finie et à retirer de la liste. */
  processed: boolean;
  /** Vers l'image (vrai) ou vers la couleur `color` (faux). */
  fadeUp: boolean;
  color: number;
  nextTick: number;
  animate: boolean;
  /** Ticks entre deux étapes. */
  delay: number;
  /** Taille du plan à la création : une transition n'est réutilisée que pour un plan de même taille. */
  width: number;
  height: number;
  /** Dissolution : bitmap posé sur le plan (0 sinon), masque du registre, pixel courant et premier pixel de la suite. */
  bitmap: Reg;
  mask: number;
  pixel: number;
  firstPixel: number;
}

export interface Scroll {
  plane: Reg;
  /** Décalage restant du nouveau pic. */
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  newPictureId: number;
  oldPictureId: number;
  animate: boolean;
  startTick: number;
}

/** Ce que les transitions demandent au compositeur. */
export interface TransitionHost {
  readonly palette: GamePalette;
  findPlane(object: Reg): Plane | undefined;
  /** Ajoute les cels d'un pic au plan, décalés ; renvoie le pic précédent du plan. */
  addPicture(plane: Plane, pictureId: number, x: number, y: number): number;
  /** Retire les cels de `oldPictureId` et fait de `newPictureId` le pic du plan. */
  replacePicture(plane: Plane, oldPictureId: number, newPictureId: number): void;
  /** `FrameOut` sans présentation : compose l'image dans le tampon. */
  frameOut(): void;
  /**
   * Copie l'image composée en dernier, pour le rectangle du plan, dans un nouveau bitmap posé sur le plan à cette priorité ;
   * renvoie le bitmap.
   */
  captureScreen(plane: Plane, priority: number): Reg;
  /** Pixels d'un bitmap de capture, ou `undefined` s'il n'existe plus. */
  capturePixels(bitmap: Reg): Uint8Array | undefined;
  /** Retire le bitmap de capture de son plan et le libère. */
  releaseCapture(plane: Reg, bitmap: Reg): void;
  now(): number;
  warn(message: string): void;
}

export interface ShowStyleRequest {
  plane: Reg;
  type: number;
  seconds: number;
  /** Couleur visée, ou `SHOW_STYLE_NO_BACK` pour aller vers l'image. */
  back: number;
  /** Priorité du bitmap d'une dissolution dans le plan. */
  priority: number;
  animate: boolean;
  /** Compose une image, sans la présenter, avant de préparer la transition : c'est elle que capture une dissolution. */
  referenceFrame: boolean;
  /** Nombre d'étapes, ou −1 pour celui du type. */
  divisions: number;
}

export class Transitions {
  readonly showStyles: ShowStyleEntry[] = [];
  readonly scrolls: Scroll[] = [];

  constructor(private readonly host: TransitionHost) {}

  // -------------------------------------------------------------------------------------------------------------------------------
  // SetShowStyle
  // -------------------------------------------------------------------------------------------------------------------------------

  /** `SetShowStyle` : prépare la transition du plan ; elle se jouera aux `FrameOut` suivants. Renvoie faux si l'appel est refusé. */
  setShowStyle(request: ShowStyleRequest): boolean {
    const { type } = request;
    if (type >= SHOW_STYLE_DIVISIONS.length) {
      this.host.warn(`SetShowStyle : type ${type} inconnu`);
      return false;
    }
    const plane = this.host.findPlane(request.plane);
    if (!plane) {
      this.host.warn("SetShowStyle : plan introuvable");
      return false;
    }
    const divisions = request.divisions !== -1 ? request.divisions : SHOW_STYLE_DIVISIONS[type];
    const width = plane.gameRect.right - plane.gameRect.left;
    const height = plane.gameRect.bottom - plane.gameRect.top;
    let fadeUp = request.back === SHOW_STYLE_NO_BACK;
    let color = fadeUp ? 0 : request.back;

    let entry = this.showStyles.find((candidate) => candidate.plane === request.plane);
    if (entry) {
      fadeUp = true;
      if (entry.width === width && entry.height === height && entry.divisions === divisions) entry.currentStep = 0;
      else {
        color = entry.color;
        this.remove(entry);
        entry = undefined;
      }
    }
    if (type === ShowStyle.None) {
      if (entry) this.remove(entry);
      return true;
    }
    const delay = Math.trunc((request.seconds * TICKS_PER_SECOND + divisions - 1) / divisions);
    if (delay <= 0 || divisions <= 0) {
      this.host.warn(`SetShowStyle : durée (${request.seconds} s) ou nombre d'étapes (${divisions}) refusé`);
      if (entry) this.remove(entry);
      return false;
    }
    if (!PORTED_STYLES.has(type)) this.host.warn(`SetShowStyle : transition ${type} jamais demandée par le jeu, non portée : coupe franche`);
    const created = !entry;
    entry ??= { plane: request.plane, type, divisions, currentStep: 0, processed: false, fadeUp, color, nextTick: 0, animate: false, delay, width, height, bitmap: NULL_REG, mask: 0, pixel: 0, firstPixel: 0 };
    entry.fadeUp = fadeUp;
    entry.color = color;
    entry.nextTick = this.host.now();
    entry.type = type;
    entry.animate = request.animate;
    entry.delay = delay;
    if (request.referenceFrame) this.host.frameOut();
    if (created) {
      // Une transition réutilisée garde son bitmap : la dissolution repart sur ce qu'il en reste.
      if (type === ShowStyle.Dissolve) entry.bitmap = this.host.captureScreen(plane, request.priority);
      this.showStyles.push(entry);
    }
    return true;
  }

  /** Retire une transition de la liste, avec le bitmap de sa dissolution. */
  private remove(entry: ShowStyleEntry): void {
    if (entry.bitmap !== NULL_REG) this.host.releaseCapture(entry.plane, entry.bitmap);
    entry.bitmap = NULL_REG;
    this.showStyles.splice(this.showStyles.indexOf(entry), 1);
  }

  /**
   * Un passage sur les transitions : chacune avance d'une étape au plus. `unfinished` : il en reste à jouer ;
   * `blocking` : l'une d'elles n'est pas animée (`FrameOut` doit composer et recommencer tant qu'il en reste) ;
   * `delay` : ticks à attendre avant le passage suivant.
   */
  processShowStyles(): { unfinished: boolean; blocking: boolean; delay: number } {
    const now = this.host.now();
    let unfinished = false;
    let blocking = false;
    let delay = 1;
    for (let i = 0; i < this.showStyles.length; ) {
      const entry = this.showStyles[i];
      if (!entry.animate) {
        blocking = true;
        delay = Math.max(delay, entry.delay);
      }
      const finished = this.processShowStyle(entry, now);
      if (!finished) unfinished = true;
      if (finished && entry.processed) this.remove(entry);
      else i++;
    }
    return { unfinished, blocking, delay };
  }

  private processShowStyle(entry: ShowStyleEntry, now: number): boolean {
    if (entry.nextTick >= now && entry.animate) return false;
    if (entry.type === ShowStyle.FadeOut) return this.processFade(-1, entry);
    if (entry.type === ShowStyle.FadeIn) return this.processFade(1, entry);
    if (entry.type === ShowStyle.Dissolve) return this.processDissolve(entry);
    this.host.palette.setFade(entry.fadeUp ? FADE_NONE : 0, 0, LAST_COLOR);
    entry.processed = true;
    return true;
  }

  private processFade(direction: number, entry: ShowStyleEntry): boolean {
    if (entry.currentStep < entry.divisions) {
      const step = direction <= 0 ? entry.divisions - entry.currentStep - 1 : entry.currentStep;
      // Une seule étape : l'original divise par zéro ; ici le fondu va droit au but.
      const percent = entry.divisions > 1 ? Math.trunc((step * FADE_NONE) / (entry.divisions - 1)) : direction <= 0 ? 0 : FADE_NONE;
      this.host.palette.setFade(percent, 0, LAST_COLOR);
      entry.currentStep++;
      entry.nextTick += entry.delay;
      return false;
    }
    if (direction > 0) entry.processed = true;
    return true;
  }

  /** Une étape de dissolution : une tranche de pixels du bitmap prend la couleur visée. Vrai une fois toutes les étapes faites. */
  private processDissolve(entry: ShowStyleEntry): boolean {
    const pixels = this.host.findPlane(entry.plane) && this.host.capturePixels(entry.bitmap);
    if (!pixels) {
      entry.processed = true;
      return true;
    }
    if (entry.currentStep >= entry.divisions) {
      if (entry.fadeUp) entry.processed = true;
      return true;
    }
    const count = pixels.length;
    if (count < 2) {
      // Pas de suite possible sur un bitmap d'un pixel ou vide.
      pixels.fill(entry.color);
      entry.currentStep = entry.divisions;
      return false;
    }
    const next = (index: number): number => {
      do index = (index & 1) !== 0 ? (index >> 1) ^ entry.mask : index >> 1;
      while (index >= count);
      return index;
    };
    let index: number;
    if (entry.currentStep === 0) {
      // Masque du registre dont la période couvre le bitmap : autant de bits que le nombre de pixels.
      entry.mask = DISSOLVE_MASKS[Math.min(Math.max(32 - Math.clz32(count) - 2, 0), DISSOLVE_MASKS.length - 1)];
      index = DISSOLVE_FIRST_PIXEL < count ? DISSOLVE_FIRST_PIXEL : next(DISSOLVE_FIRST_PIXEL);
      entry.firstPixel = index;
    } else {
      index = next(entry.pixel);
      if (index === entry.firstPixel) index = 0;
    }
    for (let i = Math.trunc((count + entry.divisions) / entry.divisions); i > 0; i--) {
      pixels[index] = entry.color;
      index = next(index);
      if (index === entry.firstPixel) {
        pixels.fill(entry.color);
        break;
      }
    }
    entry.pixel = index;
    entry.nextTick += entry.delay;
    entry.currentStep++;
    return false;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // SetScroll
  // -------------------------------------------------------------------------------------------------------------------------------

  /** `SetScroll` : prépare le défilement du plan vers `pictureId`. Renvoie le défilement, ou `undefined` si l'appel est refusé. */
  setScroll(planeObject: Reg, deltaX: number, deltaY: number, pictureId: number, animate: boolean): Scroll | undefined {
    const plane = this.host.findPlane(planeObject);
    if (!plane || this.scrolls.some((scroll) => scroll.plane === planeObject) || (deltaX === 0) === (deltaY === 0)) {
      this.host.warn(`SetScroll refusé (plan ${plane ? "déjà en défilement ou déplacement invalide" : "introuvable"})`);
      return undefined;
    }
    const width = plane.gameRect.right - plane.gameRect.left;
    const height = plane.gameRect.bottom - plane.gameRect.top;
    const x = deltaX === 0 ? 0 : deltaX > 0 ? -width : width;
    const y = deltaY === 0 ? 0 : deltaY > 0 ? -height : height;
    const oldPictureId = this.host.addPicture(plane, pictureId, x, y);
    const scroll: Scroll = { plane: planeObject, x, y, deltaX, deltaY, newPictureId: pictureId, oldPictureId, animate, startTick: this.host.now() };
    if (animate) this.scrolls.unshift(scroll);
    return scroll;
  }

  /** Un pas de défilement ; vrai quand le nouveau pic est en place (ou que le plan a disparu). */
  processScroll(scroll: Scroll): boolean {
    if (scroll.startTick >= this.host.now()) return false;
    let deltaX = scroll.deltaX;
    let deltaY = scroll.deltaY;
    if ((scroll.x + deltaX) * scroll.x <= 0) deltaX = -scroll.x;
    if ((scroll.y + deltaY) * scroll.y <= 0) deltaY = -scroll.y;
    scroll.x += deltaX;
    scroll.y += deltaY;
    const plane = this.host.findPlane(scroll.plane);
    if (!plane) return true;
    const finished = scroll.x === 0 && scroll.y === 0;
    if (finished) this.host.replacePicture(plane, scroll.oldPictureId, scroll.newPictureId);
    for (const item of plane.items) {
      item.x += deltaX;
      item.y += deltaY;
    }
    return finished;
  }

  /** Avance les défilements animés (à chaque `FrameOut`). */
  processScrolls(): void {
    for (let i = 0; i < this.scrolls.length; ) {
      if (this.processScroll(this.scrolls[i])) this.scrolls.splice(i, 1);
      else i++;
    }
  }

  /** Plans référencés : racines du ramasse-miettes. */
  *references(): IterableIterator<Reg> {
    for (const entry of this.showStyles) {
      yield entry.plane;
      if (entry.bitmap !== NULL_REG) yield entry.bitmap;
    }
    for (const scroll of this.scrolls) yield scroll.plane;
  }
}

// État sauvegardé (`engine/save.ts`).
declareState(Transitions, { name: "Transitions", skip: ["host"] });
