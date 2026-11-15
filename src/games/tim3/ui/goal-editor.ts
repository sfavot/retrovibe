/**
 * But d'un puzzle maison : au Labo, la barre du but est un contrôle EDIT où l'on écrit (414fc1, modes 1 et 6 : `[0x477938]`, texte
 * relu à chaque frappe dans `[0x4811e8]`, 399 caractères ; un retour à la ligne est retiré aussitôt, 41515d). En Jeu, un clic sur la
 * barre rouvre la fiche du puzzle (4151a4) ; dans le port, il rejoue la voix du but.
 *
 * Le port pose une vraie zone de texte sur le cadre de la barre, le temps de l'écriture (un appui sur la barre au Labo) : noir sur
 * blanc comme la barre ; Entrée, Échap ou un clic ailleurs la ferment, et le canvas redessine le but avec la police du jeu.
 */
import { h } from "../../../ui/dom";
import { GOALBAR, SCREEN_HEIGHT, SCREEN_WIDTH } from "../render";

/** Cadre du texte du but dans la barre (`drawGoalBar` : 20, 9, 530 × 46), un peu élargi. */
export const GOAL_FIELD = { x: GOALBAR.x + 16, y: GOALBAR.y + 6, width: 538, height: 52 } as const;

export interface GoalEditorOptions {
  value: string;
  maxLength: number;
  label: string;
  input(value: string): void;
  onClose(): void;
}

/** Retire les retours à la ligne (41515d). */
export function goalText(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export function openGoalEditor(host: { main: HTMLElement; canvas: HTMLCanvasElement }, o: GoalEditorOptions): { close(): void } {
  const pct = (v: number, total: number): string => `${(v / total) * 100}%`;
  const area = h("textarea", { class: "tim3-goal-input", maxlength: o.maxLength, spellcheck: "true", "aria-label": o.label, rows: 2 }) as HTMLTextAreaElement;
  Object.assign(area.style, { left: pct(GOAL_FIELD.x, SCREEN_WIDTH), top: pct(GOAL_FIELD.y, SCREEN_HEIGHT), width: pct(GOAL_FIELD.width, SCREEN_WIDTH), height: pct(GOAL_FIELD.height, SCREEN_HEIGHT) });
  area.value = o.value;
  // Calque fixe sur toute la fenêtre (comme `.tim3-itf-overlay`), cadre posé exactement sur le canvas du jeu.
  const frame = h("div", { class: "tim3-goal-frame" }, area);
  const layer = h("div", { class: "tim3-goal-editor" }, frame);
  const fit = (): void => {
    const r = host.canvas.getBoundingClientRect();
    Object.assign(frame.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    area.style.fontSize = `${Math.max(11, Math.round((r.height / SCREEN_HEIGHT) * 14))}px`;
  };
  let closed = false;
  const resize = new ResizeObserver(fit);
  const close = (): void => {
    if (closed) return;
    closed = true;
    resize.disconnect();
    window.removeEventListener("resize", fit);
    window.removeEventListener("scroll", fit, true);
    layer.remove();
    o.onClose();
  };
  area.addEventListener("input", () => {
    const clean = goalText(area.value);
    if (clean !== area.value) area.value = clean;
    o.input(clean);
  });
  area.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      host.canvas.focus({ preventScroll: true });
    }
  });
  area.addEventListener("blur", close);
  host.main.append(layer);
  resize.observe(host.canvas);
  resize.observe(host.main);
  window.addEventListener("resize", fit);
  window.addEventListener("scroll", fit, true);
  fit();
  area.focus({ preventScroll: true });
  area.setSelectionRange(area.value.length, area.value.length);
  return { close };
}
