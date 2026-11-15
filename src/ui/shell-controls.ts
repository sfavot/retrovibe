import { h } from "./dom";
import { type IconName, icon } from "./icons";

/**
 * Contrôles de la page d'un jeu sur écran tactile (`ui/game-shell.ts`) : une barre d'icônes rondes que le jeu déclare (`add`) et que le
 * shell seul rend et place, dans l'espace que le ratio du jeu laisse libre (sous l'écran ou de part et d'autre, `placeControls`).
 */

/** Place que prend une rangée ou une colonne de boutons : cible de 44 px, espacement de 8 px. */
export const CONTROL_SIZE = 44;
export const CONTROL_SLOT = CONTROL_SIZE + 8;

export type ControlsPlacement = "bottom" | "sides";

/** Taille d'un élément de la barre (bouton d'icône, ou bloc propre au jeu comme un manche), en pixels CSS. */
export interface ControlSize {
  width: number;
  height: number;
  /** Taille en colonne de côté, quand elle diffère de celle en barre du bas (bloc qui s'empile : manche, boutons d'action). */
  sides?: { width: number; height: number };
}

/** Un bouton d'icône. */
export const ICON_SIZE: ControlSize = { width: CONTROL_SIZE, height: CONTROL_SIZE };

export interface PlaceControlsInput {
  /** Place utile de la page (fenêtre moins zones sûres et marges), en pixels CSS. */
  availableWidth: number;
  availableHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  /** Éléments du groupe de début (à gauche) et du groupe de fin (à droite, le bouton « Menu » compris), dans l'ordre. */
  start: readonly ControlSize[];
  end: readonly ControlSize[];
  /** Panneau propre à la page (inventaire d'un jeu…) dont le placement réserve la place : colonne à côté de l'écran ou bande dessous. */
  panel?: ControlsPanel;
}

/** Place que réclame un panneau : sa largeur quand il est en colonne, sa hauteur quand il est en bande sous l'écran. */
export interface ControlsPanel {
  sideWidth: number;
  bottomHeight: number;
}

export interface ControlsLayout {
  placement: ControlsPlacement;
  /** Échelle de l'écran (fractionnaire) ; le ratio logique du jeu n'est jamais déformé. */
  scale: number;
  /** Largeur minimale de la barre du bas (ses éléments côte à côte) ; sans objet en colonnes. */
  rowWidth: number;
}

/** Échelle qui fait tenir l'écran logique dans la place donnée (jamais nulle, tronquée au millième pour ne pas déborder d'un demi-pixel). */
function scaleIn(width: number, height: number, logicalWidth: number, logicalHeight: number): number {
  const fit = Math.min(width / logicalWidth, height / logicalHeight);
  return Math.max(Math.floor(fit * 1000) / 1000, 0.1);
}

const GAP = CONTROL_SLOT - CONTROL_SIZE;

/** Étendue d'éléments alignés avec des espacements : somme des tailles et des écarts. */
const span = (sizes: readonly number[]): number => sizes.reduce((sum, size) => sum + size, 0) + GAP * Math.max(sizes.length - 1, 0);

/**
 * Où mettre les contrôles : en barre sous l'écran (réserve la hauteur de son plus haut élément et un espacement) ou en colonnes de part
 * et d'autre (réserve la largeur de leur plus large élément et un espacement, par côté non vide). On garde le placement qui donne la
 * plus grande échelle ; à égalité, la barre du bas. Un placement où les éléments ne tiennent pas dans la place disponible (colonne plus
 * haute que la fenêtre, rangée plus large) n'est pas possible.
 */
export function placeControls(input: PlaceControlsInput): ControlsLayout {
  const { availableWidth, availableHeight, logicalWidth, logicalHeight, start, end } = input;
  const groups = [start, end].filter((group) => group.length > 0);
  const all = [...start, ...end];
  const rowHeight = Math.max(CONTROL_SIZE, ...all.map((size) => size.height));
  const rowWidth = span(all.map((size) => size.width)) + (start.length > 0 && end.length > 0 ? GAP : 0);
  const panel = input.panel;
  const bottom = scaleIn(availableWidth, availableHeight - rowHeight - GAP - (panel ? panel.bottomHeight + GAP : 0), logicalWidth, logicalHeight);
  const inColumn = (size: ControlSize): { width: number; height: number } => size.sides ?? size;
  const columnWidths = groups.map((group) => Math.max(...group.map((size) => inColumn(size).width)));
  const tallest = Math.max(...groups.map((group) => span(group.map((size) => inColumn(size).height))));
  const reserved = columnWidths.reduce((sum, width) => sum + width + GAP, 0) + (panel ? panel.sideWidth + GAP : 0);
  const sides = tallest <= availableHeight ? scaleIn(availableWidth - reserved, availableHeight, logicalWidth, logicalHeight) : 0;
  const bottomFits = rowWidth <= availableWidth;
  if (sides > bottom || (!bottomFits && sides > 0)) return { placement: "sides", scale: sides, rowWidth };
  return { placement: "bottom", scale: bottom, rowWidth };
}

export interface ControlSpec {
  /** Identifiant (attribut `data-control`, repère pour les tests et les styles). */
  id: string;
  icon: IconName;
  /** Nom accessible du bouton (`aria-label`) : le bouton n'a que son icône. */
  label: string;
  /** `start` : à gauche (ou en haut de la colonne de gauche) ; `end` (défaut) : à droite, avant le bouton « Menu ». */
  group?: "start" | "end";
  /**
   * Masqué (`setVisible(false)`), le contrôle sort du flux au lieu de garder sa place : ses voisins se resserrent et la barre est
   * replacée. Par défaut il garde sa place (`visibility: hidden`) : rien ne saute quand « Passer » apparaît ou disparaît.
   */
  collapse?: boolean;
  onPress(): void;
}

/** Poignée d'un contrôle : le jeu en pilote l'état sans toucher au DOM. */
export interface ControlHandle {
  readonly element: HTMLButtonElement;
  /** Masqué, le bouton garde sa place (`visibility: hidden`) : ses voisins ne sautent pas ; avec `collapse`, il sort du flux. */
  setVisible(visible: boolean): void;
  setDisabled(disabled: boolean): void;
  /** État enfoncé (`aria-pressed`) ; sans appel, le bouton n'est pas une bascule. */
  setPressed(pressed: boolean): void;
}

/** Ce que la poignée écrit sur le bouton (un sous-ensemble de `HTMLButtonElement`, pour les tests). */
export interface ControlTarget {
  disabled: boolean;
  style: { visibility: string; display: string };
  setAttribute(name: string, value: string): void;
}

/** Poignée d'un bouton : n'écrit que ce qui change (appelée à chaque image par certains jeux). */
export function controlHandle<T extends ControlTarget>(
  element: T,
  collapse = false,
  onLayoutChange: () => void = () => {},
): Omit<ControlHandle, "element"> & { element: T } {
  return {
    element,
    setVisible(visible) {
      if (collapse) {
        const value = visible ? "" : "none";
        if (element.style.display === value) return;
        element.style.display = value;
        // La place du contrôle change : le shell replace la barre.
        onLayoutChange();
        return;
      }
      const value = visible ? "" : "hidden";
      if (element.style.visibility !== value) element.style.visibility = value;
    },
    setDisabled(disabled) {
      if (element.disabled === disabled) return;
      element.disabled = disabled;
    },
    setPressed(pressed) {
      element.setAttribute("aria-pressed", String(pressed));
    },
  };
}

/** Groupe de la barre et nombre de contrôles qu'il porte. */
export interface ShellControls {
  /** La barre (posée par le shell dans la page ; masquée hors écran tactile). */
  readonly element: HTMLElement;
  add(spec: ControlSpec): ControlHandle;
  /**
   * Bloc propre au jeu (manche, boutons d'action) posé dans un groupe, avant ses boutons d'icônes. Le shell mesure sa taille et la
   * réserve ; le jeu le dimensionne et en gère les entrées. Utilisable avant `start`.
   */
  addPad(element: HTMLElement, group?: "start" | "end", sizes?: { bottom: ControlSize; sides: ControlSize }): void;
  /** Tailles mesurées des éléments de chaque groupe (le bouton « Menu » compris), pour `placeControls`. */
  sizes(): { start: ControlSize[]; end: ControlSize[] };
}

export interface ShellControlsOptions {
  /** Appelé après chaque appui souris ou doigt (le canvas reprend le focus). Un appui au clavier garde le focus sur le bouton. */
  afterPress(): void;
  /** Bouton « Menu », toujours le dernier du groupe de fin. */
  menu: { label: string; onPress(): void };
  /** La liste des contrôles a changé (le shell recalcule le placement). */
  onChange(): void;
}

/** Taille de chaque enfant d'un groupe. */
function measure(group: HTMLElement): ControlSize[] {
  return [...group.children]
    .filter((child) => (child as HTMLElement).style.display !== "none")
    .map((child) => padSizes.get(child as HTMLElement) ?? { width: (child as HTMLElement).offsetWidth, height: (child as HTMLElement).offsetHeight });
}

/** Tailles déclarées des blocs qui changent de forme selon le placement (mesurées, elles dépendraient du placement courant). */
const padSizes = new WeakMap<HTMLElement, ControlSize>();

/** Barre de contrôles du shell : groupes `start` et `end`, bouton « Menu » en dernier du groupe `end`. */
export function createShellControls(options: ShellControlsOptions): ShellControls {
  const start = h("div", { class: "shell-controls-group shell-controls-start" });
  const end = h("div", { class: "shell-controls-group shell-controls-end" });
  const element = h("div", { class: "shell-controls", role: "toolbar" }, start, end);

  const button = (spec: Pick<ControlSpec, "id" | "icon" | "label" | "onPress">): HTMLButtonElement => {
    const el = h("button", { type: "button", class: "shell-control", "data-control": spec.id, "aria-label": spec.label }, icon(spec.icon));
    // Ni le toucher ni le clic ne volent le focus au canvas ; au clavier (`detail` nul), le bouton le garde.
    el.addEventListener("mousedown", (event) => event.preventDefault());
    el.addEventListener("click", (event) => {
      spec.onPress();
      if (event.detail > 0) options.afterPress();
    });
    return el;
  };

  const menu = button({ id: "menu", icon: "menu", label: options.menu.label, onPress: options.menu.onPress });
  end.append(menu);

  return {
    element,
    add(spec) {
      const el = button(spec);
      if ((spec.group ?? "end") === "start") start.append(el);
      else end.insertBefore(el, menu);
      options.onChange();
      return controlHandle(el, spec.collapse === true, options.onChange);
    },
    addPad(pad, group = "end", sizes) {
      if (sizes) padSizes.set(pad, { ...sizes.bottom, sides: sizes.sides });
      const container = group === "start" ? start : end;
      container.insertBefore(pad, container.querySelector(".shell-control"));
      options.onChange();
    },
    sizes: () => ({ start: measure(start), end: measure(end) }),
  };
}

// --- Menu par défaut du shell ----------------------------------------------------------------------------------------------

/** Entrée du menu : une action, ou une bascule (`pressed` : état courant). */
export interface ShellMenuEntry {
  label: string;
  onPress(): void;
  pressed?: boolean;
}

export interface ShellMenuOptions {
  title: string;
  closeLabel: string;
  entries: ShellMenuEntry[];
  /** Fermeture demandée (bouton, Échap, clic sur le fond). */
  close(): void;
}

/** Éléments focalisables d'une fenêtre, dans l'ordre du document. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button:not(:disabled)")];
}

/** Cible du focus quand Tab sort de la fenêtre : on boucle du dernier au premier (et inversement avec Maj). */
export function trapTarget(count: number, index: number, backwards: boolean): number {
  if (count === 0) return -1;
  if (index < 0) return backwards ? count - 1 : 0;
  return (index + (backwards ? count - 1 : 1)) % count;
}

/**
 * Menu par défaut du shell : petite fenêtre modale (`role="dialog"`) qui liste les actions système et les entrées du jeu. Le focus y
 * est piégé, Échap la ferme. Renvoie le voile à poser dans la page ; le shell met le jeu en pause pendant qu'il est ouvert.
 */
export function renderShellMenu(options: ShellMenuOptions): HTMLElement {
  const titleId = "shell-menu-title";
  const items = options.entries.map((entry) =>
    h(
      "li",
      {},
      h(
        "button",
        {
          type: "button",
          ...(entry.pressed === undefined ? {} : { class: "toggle", "aria-pressed": String(entry.pressed) }),
          onclick: entry.onPress,
        },
        entry.label,
      ),
    ),
  );
  const dialog = h(
    "section",
    { class: "shell-menu", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, options.title),
    h("ul", { class: "shell-menu-list" }, ...items),
    h("button", { type: "button", class: "secondary", onclick: options.close }, options.closeLabel),
  );
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      options.close();
    } else if (event.key === "Tab") {
      const buttons = focusables(dialog);
      const target = trapTarget(buttons.length, buttons.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (target >= 0) {
        event.preventDefault();
        buttons[target]!.focus();
      }
    }
  });
  const backdrop = h("div", { class: "shell-menu-overlay" }, dialog);
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) options.close();
  });
  queueMicrotask(() => focusables(dialog)[0]?.focus());
  return backdrop;
}
