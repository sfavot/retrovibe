/**
 * Fenêtre `.ITF` du jeu (plan D7) : dessinée par `render/itf-draw.ts` dans un canvas posé sur l'écran du jeu, avec par-dessus un
 * calque DOM de vrais boutons transparents aux rectangles des contrôles (`role="dialog"` titré, focus gardé, Échap, texte de la
 * fenêtre pour les lecteurs d'écran).
 *
 * - Souris et doigt : `ItfDialogModel` (sans DOM) teste les rectangles comme `PlayScreen.toolbarAt` ; le bouton est dessiné enfoncé
 *   tant que le pointeur reste dessus, et il agit au relâchement sur lui.
 * - Clavier : Tab et Maj+Tab parcourent les boutons (gardés dans la fenêtre), Entrée / Espace les activent, Échap choisit le bouton
 *   d'annulation (450d44 : drapeau 0x20) ou ferme la fenêtre ; le focus visible est un contour CSS du bouton transparent.
 * - Le calque suit la place et l'échelle du canvas du jeu (positions en pourcentage de 640×480, cadre recalé au redimensionnement).
 */
import { h } from "../../../ui/dom";
import type { Itf } from "../data/itf";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/screen";
import type { RenderAssets } from "../render/assets";
import { Surface } from "../render/surface";
import { drawItf, itfButtonLabel, itfHitAt, itfOrigin, layoutItf, type ItfItem, type ItfLayout, type ItfState } from "../render/itf-draw";
import type { DialogHandle } from "./menus";

export interface ItfDialogOptions {
  /** Titre pour les lecteurs d'écran. */
  title: string;
  /** Textes, contrôles cachés, grisés ou déplacés (le décalage de centrage est ajouté ici). */
  state?: Omit<ItfState, "dx" | "dy" | "pressed">;
  /** Bouton qui reçoit le focus à l'ouverture (Entrée : drapeau 0x10 de 450d44). */
  defaultId?: number;
  /** Bouton choisi par Échap ; sans valeur, Échap ferme la fenêtre sans choix. */
  cancelId?: number;
  /** Un bouton a été choisi ; la fenêtre est déjà fermée. */
  choose(id: number): void;
  /** Fermeture, quelle qu'en soit la cause (après `choose`). */
  onClose?(): void;
}

/** Logique de la fenêtre sans DOM : rectangles, pointeur, bouton enfoncé, Échap. */
export class ItfDialogModel {
  readonly origin: { dx: number; dy: number };
  pressed: number | null = null;
  /** Le pointeur est sur le bouton saisi (sinon le bouton se dessine relâché). */
  private over = false;
  layout: ItfLayout;

  constructor(
    readonly assets: RenderAssets,
    readonly itf: Itf,
    readonly options: Pick<ItfDialogOptions, "state" | "cancelId" | "defaultId">,
  ) {
    this.origin = itfOrigin(itf, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.layout = layoutItf(assets, itf, this.state());
  }

  /** État de dessin : textes de l'appelant, centrage, bouton enfoncé. */
  state(): ItfState {
    return { ...this.options.state, ...this.origin, pressed: this.over ? this.pressed : null };
  }

  /** Boutons dans l'ordre de lecture : par rangée (boutons qui se chevauchent en hauteur), puis de gauche à droite. */
  buttons(): ItfItem[] {
    const sameRow = (a: ItfItem, b: ItfItem): boolean => a.y < b.y + b.height / 2 && b.y < a.y + a.height / 2;
    return this.layout.items.filter((i) => i.clickable).sort((a, b) => (sameRow(a, b) ? a.x - b.x : a.y - b.y));
  }

  label(item: ItfItem): string {
    return itfButtonLabel(this.layout, item);
  }

  /** Textes de la fenêtre (titre, message, libellés), pour les lecteurs d'écran. */
  texts(): string[] {
    return this.layout.items.filter((i) => !i.clickable && i.text).map((i) => i.text);
  }

  /** Appui (coordonnées de l'écran 640×480) : renvoie vrai s'il faut redessiner. */
  pointerDown(x: number, y: number): boolean {
    const hit = itfHitAt(this.layout, x, y);
    this.pressed = hit?.enabled ? hit.id : null;
    this.over = this.pressed !== null;
    return this.over;
  }

  pointerMove(x: number, y: number): boolean {
    if (this.pressed === null) return false;
    const over = itfHitAt(this.layout, x, y)?.id === this.pressed;
    const changed = over !== this.over;
    this.over = over;
    return changed;
  }

  /** Relâché : identifiant du bouton choisi (relâché sur le bouton saisi), sinon `null`. */
  pointerUp(x: number, y: number): number | null {
    const id = this.pressed;
    this.pressed = null;
    this.over = false;
    if (id === null) return null;
    return itfHitAt(this.layout, x, y)?.id === id ? id : null;
  }

  pointerCancel(): void {
    this.pressed = null;
    this.over = false;
  }

  /** Échap : bouton d'annulation s'il est actif, `null` pour fermer sans choix. */
  escape(): number | null {
    const id = this.options.cancelId;
    if (id === undefined) return null;
    return this.layout.items.find((i) => i.id === id && i.enabled) ? id : null;
  }

  /** Activation au clavier ou par un lecteur d'écran : seulement un bouton actif. */
  canActivate(id: number): boolean {
    return this.layout.items.some((i) => i.id === id && i.enabled);
  }

  /** Dessin sur une surface transparente de 640×480 ; met à jour les rectangles. */
  render(surface: Surface): void {
    surface.clear(0);
    this.layout = drawItf(surface, this.assets, this.itf, this.state());
  }
}

/** Où poser la fenêtre : la page du jeu (élément plein écran) et le canvas dont elle suit la place. */
export interface ItfHost {
  main: HTMLElement;
  canvas: HTMLCanvasElement;
  assets: RenderAssets;
}

let itfCount = 0;
const pct = (v: number, total: number): string => `${(v / total) * 100}%`;

export function openItfDialog(host: ItfHost, itf: Itf, options: ItfDialogOptions): DialogHandle {
  const model = new ItfDialogModel(host.assets, itf, options);
  const titleId = `tim3-itf-${++itfCount}`;
  const previous = document.activeElement as HTMLElement | null;

  const canvas = h("canvas", { class: "tim3-itf-canvas", width: SCREEN_WIDTH, height: SCREEN_HEIGHT, "aria-hidden": "true" });
  const ctx = canvas.getContext("2d");
  const surface = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  const image = ctx?.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  const draw = (): void => {
    model.render(surface);
    if (!ctx || !image) return;
    surface.toRgba(host.assets.gameLut(), new Uint32Array(image.data.buffer));
    ctx.putImageData(image, 0, 0);
  };
  draw();

  const buttons = new Map<number, HTMLButtonElement>();
  for (const item of model.buttons()) {
    const b = h("button", { type: "button", class: "tim3-itf-button", disabled: !item.enabled }, model.label(item));
    Object.assign(b.style, {
      left: pct(item.x, SCREEN_WIDTH),
      top: pct(item.y, SCREEN_HEIGHT),
      width: pct(item.width, SCREEN_WIDTH),
      height: pct(item.height, SCREEN_HEIGHT),
    });
    // Bouton sans prise au pointeur (CSS) : souris et doigt passent par les rectangles (`ItfDialogModel`) ; le clic ne vient ici
    // que du clavier ou d'un lecteur d'écran.
    b.addEventListener("click", () => pick(item.id));
    buttons.set(item.id, b);
  }

  const text = model.texts().filter((t) => t !== options.title);
  const dialog = h(
    "div",
    { class: "tim3-itf", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" },
    h("h2", { id: titleId, class: "tim3-sr" }, options.title),
    text.length ? h("p", { class: "tim3-sr" }, text.join(" ")) : null,
    canvas,
    ...buttons.values(),
  );
  const overlay = h("div", { class: "tim3-itf-overlay" }, dialog);

  /** Le calque couvre exactement le canvas du jeu. */
  const place = (): void => {
    const r = host.canvas.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    Object.assign(dialog.style, { left: `${r.left - o.left}px`, top: `${r.top - o.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const resize = new ResizeObserver(place);
  resize.observe(host.canvas);
  resize.observe(host.main);
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    resize.disconnect();
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
    overlay.remove();
    options.onClose?.();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const pick = (id: number): void => {
    if (closed || !model.canActivate(id)) return;
    close();
    options.choose(id);
  };

  // Pointeur : coordonnées de l'écran 640×480.
  const logical = (event: PointerEvent): { x: number; y: number } => {
    const r = dialog.getBoundingClientRect();
    return { x: ((event.clientX - r.left) / r.width) * SCREEN_WIDTH, y: ((event.clientY - r.top) / r.height) * SCREEN_HEIGHT };
  };
  dialog.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const p = logical(event);
    if (model.pointerDown(p.x, p.y)) {
      event.preventDefault();
      dialog.setPointerCapture(event.pointerId);
      draw();
    }
  });
  dialog.addEventListener("pointermove", (event) => {
    const p = logical(event);
    if (model.pointerMove(p.x, p.y)) draw();
  });
  dialog.addEventListener("pointerup", (event) => {
    const p = logical(event);
    const id = model.pointerUp(p.x, p.y);
    draw();
    if (id !== null) pick(id);
  });
  dialog.addEventListener("pointercancel", () => {
    model.pointerCancel();
    draw();
  });
  // Les clics hors de la fenêtre ne passent pas au jeu (fenêtre modale).
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) event.preventDefault();
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      const id = model.escape();
      if (id !== null) pick(id);
      else close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...buttons.values()].filter((b) => !b.disabled);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLButtonElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLButtonElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  host.main.append(overlay);
  place();
  queueMicrotask(() => {
    const preferred = options.defaultId !== undefined ? buttons.get(options.defaultId) : undefined;
    const target = preferred && !preferred.disabled ? preferred : [...buttons.values()].find((b) => !b.disabled);
    (target ?? dialog).focus({ preventScroll: true });
  });
  return { element: dialog, close };
}
