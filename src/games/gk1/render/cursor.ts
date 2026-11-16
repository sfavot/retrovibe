/**
 * Curseur de la souris : un cel de vue choisi par les scripts (`SetCursor`), posé par son point d'ancrage sur la position
 * de la souris, par-dessus l'image composée.
 *
 * Référence : `engines/sci/graphics/cursor32.cpp` de ScummVM (`GfxCursor32::setView`, `hide`, `unhide`, `show`,
 * `setRestrictedArea`, `clearRestrictedArea`, `setPosition`, `deviceMoved`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * - **Image** : le cel est dessiné une fois dans une image dont la couleur 255 est transparente ; son point chaud est
 *   l'ancrage du cel (`cel.ts`). La vue −1 donne un curseur vide.
 * - **Visibilité** : `hide` s'empile (compteur), `unhide` dépile, `show` remet le compteur à zéro. `setView` ne change pas
 *   la visibilité. Avant le premier `setView`, il n'y a rien à montrer.
 * - **Zone de déplacement** : la position est ramenée dans la zone (bords gauche et haut compris, droit et bas exclus),
 *   à sa pose comme à chaque mouvement ; `clearRestrictedArea` rend tout l'écran.
 *
 * **Point d'entrée pour les entrées** (vague E) : `deviceMoved(x, y)` à chaque mouvement de la souris, en pixels du jeu ;
 * `x` et `y` donnent ensuite la position retenue (bornée), qui est aussi celle que `SetCursor(x, y)` impose.
 *
 * Écarts volontaires : le curseur est dessiné sur une copie de l'image à la présentation (`Frameout.present`), sans la
 * sauvegarde et la restauration du fond de l'original ; la souris du navigateur n'est pas déplacée par `setPosition` ;
 * pas de doublement en haute résolution.
 */
import type { Cel, CelStore } from "./cel";
import { drawCel } from "./cel";
import { CURSOR_SKIP_COLOR, SCREEN_HEIGHT, SCREEN_WIDTH } from "./ids";
import { clipRect, makeRect, type Rect } from "./rect";
import { declareState } from "../engine/save-codec";

/** Numéro de vue « pas de curseur ». */
const NO_VIEW = 0xffff;

export class Cursor {
  /** Position de la souris dans l'écran du jeu, bornée à la zone de déplacement. */
  x = 0;
  y = 0;
  /** Vue, boucle et cel choisis par le dernier `setView`. */
  view = NO_VIEW;
  loop = 0;
  cel = 0;
  private hideCount = 0;
  private area: Rect = makeRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  private image: Uint8Array | undefined;
  private width = 0;
  private height = 0;
  private hotX = 0;
  private hotY = 0;

  constructor(private readonly cels: CelStore) {}

  get visible(): boolean {
    return this.hideCount === 0;
  }

  /** `SetCursor(vue, boucle, cel)`. Renvoie faux si la vue manque (le curseur devient vide). */
  setView(view: number, loop: number, cel: number): boolean {
    this.view = view;
    this.loop = loop;
    this.cel = cel;
    this.image = undefined;
    this.width = this.height = this.hotX = this.hotY = 0;
    if (view === NO_VIEW) return true;
    const source: Cel | undefined = this.cels.viewCel(view, loop, cel);
    if (!source) return false;
    this.width = source.width;
    this.height = source.height;
    this.hotX = source.originX;
    this.hotY = source.originY;
    this.image = new Uint8Array(source.width * source.height).fill(CURSOR_SKIP_COLOR);
    drawCel(this.image, source.width, source, makeRect(0, 0, source.width, source.height), 0, 0, false);
    return true;
  }

  hide(): void {
    this.hideCount++;
  }

  unhide(): void {
    if (this.hideCount > 0) this.hideCount--;
  }

  /** Montre le curseur quel que soit le nombre de `hide` empilés. */
  show(): void {
    this.hideCount = 0;
  }

  /** `SetCursor(gauche, haut, droite, bas)` : `area` a ses bords droit et bas exclus. */
  setRestrictedArea(area: Rect): void {
    this.area = { ...area };
    this.clamp(this.x, this.y);
  }

  clearRestrictedArea(): void {
    this.area = makeRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  /** `SetCursor(x, y)` : place la souris. */
  setPosition(x: number, y: number): void {
    this.clamp(x, y);
  }

  /** La souris a bougé : retient sa position, bornée à la zone ; dit si elle a dû l'être. */
  deviceMoved(x: number, y: number): boolean {
    return this.clamp(x, y);
  }

  private clamp(x: number, y: number): boolean {
    const { left, top, right, bottom } = this.area;
    this.x = Math.max(left, Math.min(x, right - 1));
    this.y = Math.max(top, Math.min(y, bottom - 1));
    return this.x !== x || this.y !== y;
  }

  /** Dessine le curseur, s'il est visible, dans une image de 320×200. */
  draw(target: Uint8Array): void {
    if (!this.image || this.hideCount !== 0) return;
    const left = this.x - this.hotX;
    const top = this.y - this.hotY;
    const clip = clipRect(makeRect(left, top, left + this.width, top + this.height), makeRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT));
    for (let ty = clip.top; ty < clip.bottom; ty++) {
      for (let tx = clip.left; tx < clip.right; tx++) {
        const pixel = this.image[(ty - top) * this.width + tx - left];
        if (pixel !== CURSOR_SKIP_COLOR) target[ty * SCREEN_WIDTH + tx] = pixel;
      }
    }
  }
}

// État sauvegardé (`engine/save.ts`) : position, zone, image et compteur de masquage.
declareState(Cursor, { name: "Cursor", skip: ["cels"] });
