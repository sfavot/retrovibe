import { h } from "./dom";
import { icon, type IconName } from "./icons";
import { isRotated } from "./touch-layout";

/**
 * Commandes tactiles partagées d'un jeu d'action : un stick virtuel (direction analogique) et des boutons d'action, affichés
 * seulement en disposition tactile (feuille de style, section « commandes tactiles »). À monter dans `stageChildren` du shell :
 * la couche recouvre l'écran, sans capter de toucher ailleurs que sur le stick et les boutons.
 */

export interface TouchSink {
  press(id: string): void;
  release(id: string): void;
  /** Direction analogique du stick, de -1 à 1 sur chaque axe (y vers le bas), (0, 0) au repos. */
  setAxis?(x: number, y: number): void;
}

export interface TouchDirections {
  up: string;
  down: string;
  left: string;
  right: string;
}

export interface TouchStickOptions {
  /** Nom du stick pour les lecteurs d'écran, fourni par l'appelant. */
  label: string;
  /** Part du rayon (0 à 1) sous laquelle le stick ne donne aucune direction. 0,3 par défaut. */
  deadZone?: number;
  /** Identifiants envoyés à `press` / `release` pour les jeux numériques (diagonale = deux directions). Sans eux, seul `setAxis` sert. */
  directions?: TouchDirections;
}

export interface TouchButtonOptions {
  id: string;
  /** Nom du bouton pour les lecteurs d'écran, fourni par l'appelant. */
  label: string;
  icon?: IconName;
}

export interface TouchControlsOptions {
  sink: TouchSink;
  stick?: TouchStickOptions;
  buttons: TouchButtonOptions[];
}

export interface TouchControls {
  element: HTMLElement;
  /** Relâche tout (stick centré, boutons relevés) : à appeler au blur ou à la pause. */
  reset(): void;
  /** Retire les écouteurs et relâche tout. */
  dispose(): void;
}

export const DEFAULT_DEAD_ZONE = 0.3;

/** Sinus de 22,5° : un axe compte dans la direction dès que sa part du vecteur dépasse celui-ci (huit secteurs de 45°). */
const AXIS_SHARE = Math.sin(Math.PI / 8);

/** Ramène un déplacement (dx, dy) dans le disque de rayon `radius` (même direction, longueur limitée). */
export function clampToRadius(dx: number, dy: number, radius: number): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  if (length <= radius || length === 0) return { x: dx, y: dy };
  const scale = radius / length;
  return { x: dx * scale, y: dy * scale };
}

/** Vecteur du stick de -1 à 1 : le déplacement ramené au rayon, divisé par lui. Rayon nul : au repos. */
export function stickAxis(dx: number, dy: number, radius: number): { x: number; y: number } {
  if (radius <= 0) return { x: 0, y: 0 };
  const clamped = clampToRadius(dx, dy, radius);
  return { x: clamped.x / radius, y: clamped.y / radius };
}

/** Un déplacement mesuré dans la page, exprimé dans les axes du jeu (page pivotée de 90° dans le sens horaire en plein écran). */
export function toLocalDelta(dx: number, dy: number, rotated: boolean): { x: number; y: number } {
  return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

/** Directions tenues pour un vecteur (y vers le bas) : rien sous la zone morte, sinon huit secteurs (diagonale = deux directions). */
export function axisToDirections(x: number, y: number, deadZone = DEFAULT_DEAD_ZONE): Record<keyof TouchDirections, boolean> {
  const length = Math.hypot(x, y);
  const none = { up: false, down: false, left: false, right: false };
  if (length === 0 || length < deadZone) return none;
  const share = length * AXIS_SHARE;
  return { up: y < -share, down: y > share, left: x < -share, right: x > share };
}

/** Le doigt reste attaché à l'élément même s'il en sort ; sans pointeur actif (événement synthétique), on s'en passe. */
function capture(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // pas de capture possible : le relâchement viendra de pointerup / pointercancel
  }
}

const DIRECTION_KEYS: (keyof TouchDirections)[] = ["up", "down", "left", "right"];

/** Monte le stick et les boutons ; l'élément renvoyé est la couche à insérer dans l'écran du jeu. */
export function mountTouchControls(options: TouchControlsOptions): TouchControls {
  const { sink, buttons } = options;
  const deadZone = options.stick?.deadZone ?? DEFAULT_DEAD_ZONE;
  const directions = options.stick?.directions;
  const abort = new AbortController();
  const { signal } = abort;

  const root = h("div", { class: "touch-controls" });
  // pas de menu contextuel (appui long), de sélection ni de défilement sur la couche
  root.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });

  // --- stick
  const held: Record<keyof TouchDirections, boolean> = { up: false, down: false, left: false, right: false };
  let stickPointer: number | null = null;
  let stickEl: HTMLElement | null = null;
  let knob: HTMLElement | null = null;
  let origin = { x: 0, y: 0 };

  const applyDirections = (next: Record<keyof TouchDirections, boolean>): void => {
    if (!directions) return;
    for (const key of DIRECTION_KEYS) {
      if (next[key] === held[key]) continue;
      held[key] = next[key];
      if (next[key]) sink.press(directions[key]);
      else sink.release(directions[key]);
    }
  };
  const moveKnob = (x: number, y: number): void => {
    knob?.style.setProperty("transform", `translate(${x}px, ${y}px)`);
  };
  const stickRadius = (): number => {
    if (!stickEl || !knob) return 0;
    return Math.max(0, (stickEl.offsetWidth - knob.offsetWidth) / 2);
  };
  const resetStick = (): void => {
    stickPointer = null;
    stickEl?.classList.remove("is-active");
    moveKnob(0, 0);
    sink.setAxis?.(0, 0);
    applyDirections({ up: false, down: false, left: false, right: false });
  };
  const updateStick = (e: PointerEvent): void => {
    if (!stickEl) return;
    const radius = stickRadius();
    const delta = toLocalDelta(e.clientX - origin.x, e.clientY - origin.y, isRotated(stickEl));
    const shown = clampToRadius(delta.x, delta.y, radius);
    const axis = stickAxis(delta.x, delta.y, radius);
    moveKnob(shown.x, shown.y);
    sink.setAxis?.(axis.x, axis.y);
    applyDirections(axisToDirections(axis.x, axis.y, deadZone));
  };

  if (options.stick) {
    knob = h("div", { class: "touch-stick__knob" });
    const stick = h("div", { class: "touch-stick", role: "application", "aria-label": options.stick.label }, knob);
    stickEl = stick;
    stick.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        if (stickPointer !== null) return;
        stickPointer = e.pointerId;
        const rect = stick.getBoundingClientRect();
        origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        capture(stick, e.pointerId);
        stick.classList.add("is-active");
        updateStick(e);
      },
      { signal },
    );
    stick.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerId !== stickPointer) return;
        e.preventDefault();
        updateStick(e);
      },
      { signal },
    );
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      stick.addEventListener(
        type,
        (e) => {
          if ((e as PointerEvent).pointerId === stickPointer) resetStick();
        },
        { signal },
      );
    }
    root.append(stick);
  }

  // --- boutons
  const pressed = new Map<number, string>();
  const group = h("div", { class: "touch-buttons" });
  for (const spec of buttons) {
    const button = h("button", { type: "button", class: "touch-button", "aria-label": spec.label }, spec.icon ? icon(spec.icon) : spec.label);
    button.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault(); // ni défilement, ni zoom, ni sélection, ni vol du focus
        if ([...pressed.values()].includes(spec.id)) return;
        pressed.set(e.pointerId, spec.id);
        button.classList.add("is-active");
        sink.press(spec.id);
        capture(button, e.pointerId);
      },
      { signal },
    );
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(
        type,
        (e) => {
          const id = pressed.get((e as PointerEvent).pointerId);
          if (id !== spec.id) return;
          pressed.delete((e as PointerEvent).pointerId);
          button.classList.remove("is-active");
          sink.release(spec.id);
        },
        { signal },
      );
    }
    group.append(button);
  }
  root.append(group);

  const reset = (): void => {
    if (stickEl) resetStick();
    for (const id of pressed.values()) sink.release(id);
    pressed.clear();
    for (const el of group.children) el.classList.remove("is-active");
  };

  return {
    element: root,
    reset,
    dispose() {
      reset();
      abort.abort();
      root.remove();
    },
  };
}
