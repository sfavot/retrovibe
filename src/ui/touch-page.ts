import { isRotated } from "./touch-layout";
import {
  type ControlsLayout,
  type ControlsPanel,
  type ControlsPlacement,
  type ShellControls,
  type ShellMenuEntry,
  placeControls,
  renderShellMenu,
} from "./shell-controls";

/**
 * Briques de la disposition tactile d'une page de jeu, communes au shell (`ui/game-shell.ts`) et aux pages qui ont leur propre
 * structure : la barre de contrôles (`shell-controls.ts`), le calcul du placement sur la place de la fenêtre, le menu modal et le suivi du
 * mode d'entrée (anneau de focus). La page pose la classe `touch-layout` sur son conteneur ; la feuille de style (`style.css`) range
 * ses enfants (écran, barre `.shell-controls`, panneau éventuel) selon `controls-bottom` / `controls-sides`.
 */

/** Classe du conteneur d'une page à disposition tactile. */
export const TOUCH_LAYOUT_CLASS = "touch-layout";

/** Marge autour de l'écran et de ses contrôles sur écran tactile (aussi le padding de la page, voir `style.css`). */
export const TOUCH_MARGIN = 8;

/** Espacement entre l'écran et ce qui l'entoure (barre de contrôles, pied de page, panneau) sur écran tactile. */
export const TOUCH_GAP = 8;

/** L'appareil est-il tactile (`pointer: coarse`) ? Les pages gardent leur disposition d'ordinateur sinon. */
export function isTouchDevice(): boolean {
  return matchMedia("(pointer: coarse)").matches;
}

/**
 * Place utile de la page tactile : la fenêtre moins les zones sûres (lues sur les marges intérieures du `body`, qui les réserve) et les
 * marges. Plein écran pivoté (appareil tenu en portrait, sans verrou d'orientation) : largeur et hauteur sont échangées, le
 * conteneur se mesurant dans son repère.
 */
export function touchViewSize(main: Element): { width: number; height: number } {
  const rotated = isRotated(main);
  const body = getComputedStyle(document.body);
  const safe = (side: "Top" | "Right" | "Bottom" | "Left"): number => parseFloat(body[`padding${side}`]) || 0;
  const width = rotated ? window.innerHeight - safe("Top") - safe("Bottom") : window.innerWidth - safe("Left") - safe("Right");
  const height = rotated ? window.innerWidth - safe("Left") - safe("Right") : window.innerHeight - safe("Top") - safe("Bottom");
  return { width: width - 2 * TOUCH_MARGIN, height: height - 2 * TOUCH_MARGIN };
}

/** Pose la classe de placement lue par la feuille de style. */
export function setPlacement(main: Element, placement: ControlsPlacement): void {
  main.classList.toggle("controls-bottom", placement === "bottom");
  main.classList.toggle("controls-sides", placement === "sides");
}

export interface LayoutTouchOptions {
  main: HTMLElement;
  controls: ShellControls;
  /** Ratio de l'écran (1×1 pour un écran carré : l'échelle est alors sa taille en pixels). */
  logicalWidth: number;
  logicalHeight: number;
  /** Hauteur déjà prise sous l'écran par autre chose que la barre (boutons du pied de page du jeu). */
  extraHeight?: number;
  panel?: ControlsPanel;
}

/**
 * Calcule le placement sur la place de la fenêtre (`placeControls`), le pose sur la page et règle la largeur de la barre du bas. L'appelant
 * dimensionne l'écran avec `scale`.
 */
export function layoutTouch(options: LayoutTouchOptions): ControlsLayout {
  const { main, controls, logicalWidth, logicalHeight, panel } = options;
  const view = touchViewSize(main);
  const sizes = controls.sizes();
  const layout = placeControls({
    availableWidth: view.width,
    availableHeight: view.height - (options.extraHeight ?? 0),
    logicalWidth,
    logicalHeight,
    start: sizes.start,
    end: sizes.end,
    panel,
  });
  setPlacement(main, layout.placement);
  // La barre du bas a la largeur de l'écran (au moins celle de ses éléments) ; en colonnes, ses groupes se placent de part et d'autre.
  controls.element.style.width = layout.placement === "bottom" ? `${Math.max(logicalWidth * layout.scale, layout.rowWidth)}px` : "";
  return layout;
}

/**
 * Suit le dernier mode d'entrée (toucher ou souris, clavier) dans `data-input` du conteneur : l'anneau de focus de l'écran ne se montre
 * qu'à la navigation au clavier (voir `style.css`) ; sur écran tactile, il n'apparaît pas au premier affichage ni après un toucher.
 * Renvoie la fonction qui détache les écouteurs.
 */
export function trackInputMode(main: HTMLElement): () => void {
  main.dataset.input = isTouchDevice() ? "pointer" : "";
  const onPointer = (): void => {
    main.dataset.input = "pointer";
  };
  const onKey = (): void => {
    main.dataset.input = "keyboard";
  };
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("keydown", onKey, true);
  return () => {
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("keydown", onKey, true);
  };
}

export interface TouchMenuOptions {
  main: HTMLElement;
  title: string;
  closeLabel: string;
  /** Le menu vient de s'ouvrir (le jeu se met en pause). */
  onOpen(): void;
  /** Le menu vient de se fermer, avant l'action de l'entrée choisie (le jeu reprend, le canvas reprend le focus). */
  onClose(): void;
}

export interface TouchMenu {
  readonly isOpen: boolean;
  /** Ouvre le menu ; chaque entrée ferme d'abord le menu, puis agit. Sans effet s'il est déjà ouvert. */
  open(entries: ShellMenuEntry[]): void;
  close(): void;
}

/** Menu modal d'une page tactile (`renderShellMenu`) posé dans son conteneur. */
export function createTouchMenu(options: TouchMenuOptions): TouchMenu {
  let overlay: HTMLElement | null = null;
  const close = (): void => {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    options.onClose();
  };
  return {
    get isOpen() {
      return overlay !== null;
    },
    open(entries) {
      if (overlay) return;
      const wrapped = entries.map((entry) => ({
        ...entry,
        onPress: () => {
          close();
          entry.onPress();
        },
      }));
      overlay = renderShellMenu({ title: options.title, closeLabel: options.closeLabel, entries: wrapped, close });
      options.main.append(overlay);
      options.onOpen();
    },
    close,
  };
}
