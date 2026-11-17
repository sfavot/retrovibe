import { SciKey, type EventQueue } from "../engine/events";
import type { TextEntry, TextEntryRequest } from "../engine/text-entry";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/ids";

export interface TextEntryOverlayOptions {
  /** Lien de saisie de la machine virtuelle (`textEntryOf(vm)`). */
  entry: TextEntry;
  /** File d'évènements du jeu : Entrée et Échap du champ y vont. */
  input: EventQueue;
  /** Le canvas du jeu ; le champ est posé dans son parent, qui doit être positionné. */
  canvas(): HTMLCanvasElement | null;
  /** Nom accessible du champ. */
  label: string;
  /** Vrai si la saisie doit passer par un champ de la page (écran tactile) ; défaut : pointeur principal grossier. */
  wanted?(): boolean;
}

/** Rectangle à l'écran, en pixels CSS (`getBoundingClientRect`). */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Place et taille du champ de la page, dans le repère du parent du canvas. */
export interface TextEntryLayout {
  left: number;
  top: number;
  /** Taille avant réduction (`scale`) : à l'écran le champ couvre exactement celui du jeu. */
  width: number;
  height: number;
  fontSize: number;
  /** Réduction appliquée au champ (`transform: scale`, origine en haut à gauche) ; 1 : aucune. */
  scale: number;
}

/**
 * Taille de police en dessous de laquelle Safari sur iOS agrandit la page quand un champ de saisie prend le focus (et ne
 * la rétablit pas ensuite).
 */
export const MIN_FOCUS_FONT_PX = 16;
/** Plus petite taille de texte montrée dans le champ. */
const MIN_SHOWN_FONT_PX = 12;
/** Part de la hauteur du champ occupée par le texte. */
const FONT_HEIGHT_RATIO = 0.7;

/**
 * Où poser le champ de la page pour qu'il couvre le champ du jeu `rect` (320 × 200), le canvas étant montré en `shown` et
 * son parent en `frame`. Sur un téléphone tenu droit le champ du jeu fait une douzaine de pixels de haut : le texte y est
 * plus petit que `MIN_FOCUS_FONT_PX`. Le champ garde alors cette taille de police, il est agrandi d'autant et réduit par
 * `scale` : à l'écran il a la place et la taille de texte voulues, et le navigateur ne zoome pas.
 */
export function textEntryLayout(shown: ScreenBox, frame: Pick<ScreenBox, "left" | "top">, rect: TextEntryRequest["rect"]): TextEntryLayout {
  const scaleX = shown.width / SCREEN_WIDTH;
  const scaleY = shown.height / SCREEN_HEIGHT;
  const width = (rect.right - rect.left) * scaleX;
  const height = (rect.bottom - rect.top) * scaleY;
  const shownFont = Math.max(MIN_SHOWN_FONT_PX, height * FONT_HEIGHT_RATIO);
  const scale = shownFont < MIN_FOCUS_FONT_PX ? shownFont / MIN_FOCUS_FONT_PX : 1;
  return {
    left: shown.left - frame.left + rect.left * scaleX,
    top: shown.top - frame.top + rect.top * scaleY,
    width: width / scale,
    height: height / scale,
    fontSize: shownFont / scale,
    scale,
  };
}

/**
 * Saisie de texte au toucher (`docs/gk1/plan.md`, D10) : un canvas ne fait pas monter le clavier d'un téléphone. Quand le jeu
 * ouvre un champ (`EditText`, le nom d'une sauvegarde), un `<input>` est posé exactement dessus ; son contenu remplace celui
 * du champ du jeu à chaque modification (`TextEntry.replaceText`), Entrée valide et Échap annule par les touches du jeu. Le
 * champ disparaît quand le jeu ferme la saisie.
 *
 * Avec une souris et un clavier, rien n'est posé : les touches vont au jeu par le canvas, et le champ du jeu les affiche.
 * Le clavier virtuel ne monte que sur un geste : si le navigateur refuse le focus donné à l'ouverture, toucher le champ le
 * donne. La taille de police du champ ne descend pas sous `MIN_FOCUS_FONT_PX` (`textEntryLayout`).
 *
 * Renvoie la fonction qui débranche tout.
 */
export function mountTextEntryOverlay(options: TextEntryOverlayOptions): () => void {
  const { entry, input } = options;
  const wanted = options.wanted ?? (() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  let field: HTMLInputElement | undefined;

  const place = (element: HTMLInputElement, canvas: HTMLCanvasElement, rect: TextEntryRequest["rect"]): void => {
    // Mesures à l'écran : le canvas peut être centré ou mis à l'échelle dans la scène, son parent (positionné) sert de repère.
    const layout = textEntryLayout(canvas.getBoundingClientRect(), canvas.parentElement!.getBoundingClientRect(), rect);
    Object.assign(element.style, {
      position: "absolute",
      left: `${layout.left}px`,
      top: `${layout.top}px`,
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      fontSize: `${layout.fontSize}px`,
      transformOrigin: "0 0",
      transform: layout.scale === 1 ? "none" : `scale(${layout.scale})`,
    });
  };

  const close = (): void => {
    field?.remove();
    field = undefined;
  };

  const open = (request: TextEntryRequest): void => {
    close();
    const canvas = options.canvas();
    if (!canvas?.parentElement || !wanted()) return;
    const element = document.createElement("input");
    element.type = "text";
    element.className = "gk1-text-entry";
    element.value = request.text;
    element.maxLength = request.maxLength;
    element.setAttribute("aria-label", options.label);
    element.setAttribute("autocomplete", "off");
    element.setAttribute("autocorrect", "off");
    element.setAttribute("spellcheck", "false");
    element.setAttribute("enterkeyhint", "done");
    Object.assign(element.style, { boxSizing: "border-box", margin: "0", padding: "0 2px", border: "0", borderRadius: "0", background: "#000", color: "#fff", fontFamily: "inherit", zIndex: "2" });
    place(element, canvas, request.rect);
    element.addEventListener("input", () => entry.replaceText(element.value));
    element.addEventListener("keydown", (event) => {
      const key = event.key === "Enter" ? SciKey.Enter : event.key === "Escape" ? SciKey.Escape : 0;
      if (key === 0) return;
      event.preventDefault();
      // Le dernier texte d'abord, puis la touche : le jeu les traite dans cet ordre à l'image suivante.
      entry.replaceText(element.value);
      input.keyDown(key);
      input.keyUp(key);
    });
    canvas.parentElement.append(element);
    field = element;
    element.focus({ preventScroll: true });
  };

  entry.host = { opened: open, closed: close };
  // Une saisie déjà ouverte (partie reprise en pleine saisie) reçoit son champ tout de suite.
  if (entry.current) open(entry.current);
  return () => {
    close();
    entry.host = undefined;
  };
}
