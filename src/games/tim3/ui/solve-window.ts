/**
 * Conditions de réussite d'un puzzle maison : `SOLVE.ITF` (426d1c, procédure 426e1b, choix 4272fa → 427419), ouverte au Labo par la
 * poignée « solution » d'une pièce (42ea99 : son 0xC8C). Pour une télécommande (0x16), la condition porte sur ses explosifs (426eea).
 *
 * - Voyants (états 43 de `SOLVE.ANM` : sombre = éteint, la dernière image = allumé) : « Pas dans la Solution » (SO_NOT_SOLVE_SEL, la
 *   condition est retirée), « Par le Haut » (SO_TOP_SEL : rectangle −500, −2000, 1640, 2000), « Par le Bas » (SO_BOTTOM_SEL : −500, 400,
 *   1640, 3000), « De l'Écran » (SO_OFFSCRN_SEL : −1 partout, hors de l'écran), et l'état (SO_STATE_SEL) : un état nommé de
 *   `SOLVE.RES` choisi par ▲ ▼ (SO_STATE_UP / DN), son nom dans SO_STATE_TEXT, sa plage d'images (429cb8) prise dans la variante de
 *   la pièce (429ef4). Une pièce sans état (ligne `@`) n'a pas ce voyant.
 * - « Avancé » / « Normal » (SO_ADVANCED, 31082 / 31083, `[0x472f98]`) montre ou cache la rangée du bas : « Nombre » (SO_COUNT_SEL et
 *   un EDIT de 2 chiffres : pièces de ce type à réunir ; sans condition, 31090), « Retarde » (SO_FRAME_SEL et un EDIT de 4 chiffres :
 *   délai du puzzle ; sans aucune condition, 31088), « Position » (SO_POS_SEL : la fenêtre se ferme, 31138 explique, on trace un
 *   rectangle dans l'aire, puis elle revient, 426d1c).
 * - Plus de 8 conditions : 31089. « Terminé » (SO_DONE) et Échap ferment ; « ? » (SO_HELP, 4169c8(6)) : l'aide du site.
 * - SO_ANIM : la pièce, à l'image de l'état choisi (`&n` de `SOLVE.RES`), sinon à son image.
 *
 * Écarts : le voyant « Retarde » du jeu propose de lancer la machine et de cliquer quand la vérification doit commencer (31087,
 * 427b19) ; le port pose 31 pas (une seconde) à corriger dans le champ. Les EDIT sont relus à chaque frappe (426e1b, EN_CHANGE).
 */
import { readItf, type Itf } from "../data/itf";
import type { SolvePart } from "../data/solutions";
import { drawAnmImage, imageCount, imageFrame } from "../render/anm-draw";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { ITF_DEFAULT_FONT, drawTextBox, itfText } from "../render/itf-draw";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import { OFF_BOTTOM, OFF_SCREEN, OFF_TOP, conditionKind, rangeFrames, solveVariant, type ConditionKind, type LabCondition, type StateFirst } from "../engine/lab-puzzle";
import { openItfWindow, type ItfHost, type ItfWindowHandle, type ItfWindowOptions } from "./itf-window";

export const SOLVE = {
  notSolve: 19012,
  top: 19013,
  bottom: 19021,
  offscreen: 19022,
  state: 19046,
  stateUp: 19028,
  stateDown: 19029,
  stateText: 19032,
  advanced: 19030,
  done: 19005,
  help: 19025,
  title: 19020,
  anim: 19031,
  countSel: 19040,
  countLabel: 19041,
  countData: 19044,
  frameSel: 19038,
  frameLabel: 19036,
  frameData: 19045,
  positionSel: 19039,
  positionLabel: 19037,
} as const;

/** `INTRFACE.RES` : Avancé / Normal (31082, 31083), messages (31088 à 31090, 31138), titre (31392). */
export const SOLVE_TEXT = { advanced: 31082, normal: 31083, noCondition: 31088, full: 31089, needCondition: 31090, drawBox: 31138, title: 31392 } as const;
/** Délai posé par le voyant « Retarde » (choix du port : une seconde à 32 ms le pas). */
export const DEFAULT_DELAY = 31;
const EDIT_COLORS = { color: "#ffffff", background: "#0000ef" } as const;
/** Image allumée d'un voyant (état 43 : 8 images, du sombre au rouge vif). */
const LAMP_ON = 7;
/** Texte de l'état : comme le titre de `PUZZDISP` (425fa5). */
const STATE_TEXT_FLAGS = 0x1302;
const ADVANCED_ROW = [SOLVE.countSel, SOLVE.countLabel, SOLVE.countData, SOLVE.frameSel, SOLVE.frameLabel, SOLVE.frameData, SOLVE.positionSel, SOLVE.positionLabel];

/** Condition sans pièce, telle que la fenêtre la modifie. */
export type SolveValue = Omit<LabCondition, "part">;

export interface SolveWindowOptions {
  /** Nom de la pièce (`INFO.RES`). */
  name: string;
  /** Ses états (`SOLVE.RES`), `null` si le fichier n'en dit rien. */
  solve: SolvePart | null;
  /** Image de la pièce posée (variante, aperçu). */
  frame: number;
  /** Première image d'un état de son ANM (429cb8). */
  first: StateFirst;
  /** Aperçu : dessine l'image `image` de la pièce centrée dans `r`. */
  drawPart(surface: Surface, r: Rect, image: number): void;
  /** Condition actuelle de la pièce. */
  condition: SolveValue | null;
  /** Le puzzle a des conditions sur d'autres pièces (le délai est permis) ; il en a 8 sans celle-ci (31089). */
  others: number;
  delay: number;
  /** La fenêtre s'ouvre en mode avancé (`[0x472f98]` gardé d'une ouverture à l'autre). */
  advanced: boolean;
  /** Nouvelle condition (`null` : retirée) ; faux si la table est pleine. */
  set(value: SolveValue | null): boolean;
  setDelay(delay: number): void;
  setAdvanced(advanced: boolean): void;
  message(text: string): void;
  /** « Position » : la fenêtre se ferme pour tracer un rectangle. */
  drawPosition(): void;
  help(): void;
}

const EMPTY: SolveValue = { state1: 0, state2: 0, count: 0, rectX: 0, rectY: 0, rectWidth: 0, rectHeight: 0 };

/** Fenêtre sans DOM (tests, rendu). */
export function solveWindow(assets: RenderAssets, itf: Itf, o: SolveWindowOptions): { itf: Itf; options: ItfWindowOptions; value(): SolveValue | null } {
  let value: SolveValue | null = o.condition ? { ...o.condition } : null;
  let advanced = o.advanced;
  let delay = o.delay;
  const states = o.solve?.states ?? [];
  const variant = o.solve ? solveVariant(o.solve, o.frame, o.first) : 0;
  const rangeOf = (k: number): { state1: number; state2: number } | null => {
    const r = states[k]?.ranges;
    const range = r?.[Math.min(variant, r.length - 1)];
    return range ? rangeFrames(range, o.first) : null;
  };
  /** État choisi : celui dont la plage est celle de la condition, sinon le premier. */
  let stateIndex = Math.max(
    0,
    states.findIndex((_, k) => {
      const f = rangeOf(k);
      return value !== null && f !== null && conditionKind(value) === "state" && f.state1 === value.state1 && f.state2 === value.state2;
    }),
  );
  const kind = (): ConditionKind | "none" => (value ? conditionKind(value) : "none");
  const texts: Record<number, string> = {};
  const frames: Record<number, number> = {};
  const state: NonNullable<ItfWindowOptions["state"]> = { texts, frames, hidden: [], draw: {} };

  const apply = (next: SolveValue | null): boolean => {
    if (next !== null && value === null && o.others >= 8) {
      o.message(itfText(assets, SOLVE_TEXT.full));
      return false;
    }
    if (!o.set(next)) {
      o.message(itfText(assets, SOLVE_TEXT.full));
      return false;
    }
    value = next;
    if (value === null && o.others === 0 && delay !== 0) {
      delay = 0;
      o.setDelay(0);
    }
    return true;
  };
  const withRect = (r: { x: number; y: number; width: number; height: number }): SolveValue => ({ ...EMPTY, count: value?.count ?? 0, rectX: r.x, rectY: r.y, rectWidth: r.width, rectHeight: r.height });
  const withState = (k: number): SolveValue | null => {
    const f = rangeOf(k);
    return f ? { ...EMPTY, count: value?.count ?? 0, ...f } : null;
  };

  const sync = (): void => {
    const k = kind();
    const lamps: [number, boolean][] = [
      [SOLVE.notSolve, k === "none"],
      [SOLVE.top, k === "top"],
      [SOLVE.bottom, k === "bottom"],
      [SOLVE.offscreen, k === "offscreen"],
      [SOLVE.state, k === "state"],
      [SOLVE.countSel, (value?.count ?? 0) > 0],
      [SOLVE.frameSel, delay > 0],
      [SOLVE.positionSel, k === "position"],
    ];
    for (const [id, on] of lamps) frames[id] = on ? LAMP_ON : 0;
    texts[SOLVE.title] = o.name;
    texts[SOLVE.stateText] = states[stateIndex]?.label ?? "";
    texts[SOLVE.advanced] = itfText(assets, advanced ? SOLVE_TEXT.normal : SOLVE_TEXT.advanced);
    const hidden: number[] = [SOLVE.countData, SOLVE.frameData];
    if (states.length === 0) hidden.push(SOLVE.state, SOLVE.stateUp, SOLVE.stateDown, SOLVE.stateText);
    if (!advanced) hidden.push(...ADVANCED_ROW);
    state.hidden = hidden;
  };

  const previewImage = (): number => {
    const range = states[stateIndex]?.ranges[variant] ?? o.solve?.position?.[variant];
    return kind() === "state" && range?.frame !== undefined ? o.first(range.frame) : o.frame;
  };
  // SO_STATE_TEXT est un cadre (style 12) : le nom de l'état y est écrit par la fenêtre (426e1b), pas par l'ITF.
  const font = assets.font(ITF_DEFAULT_FONT);
  state.draw = {
    [SOLVE.anim]: (surface, r) => o.drawPart(surface, r, previewImage()),
    [SOLVE.stateText]: (surface, r) => {
      const label = states[stateIndex]?.label ?? "";
      if (font && label) drawTextBox(surface, font, label, { x: r.x + 6, y: r.y + 6, width: r.width - 9, height: r.height - 8 }, { mode: 0, color: 0, flags: STATE_TEXT_FLAGS, font: ITF_DEFAULT_FONT });
    },
  };

  const options: ItfWindowOptions = {
    title: `${itfText(assets, SOLVE_TEXT.title)} : ${o.name}`,
    state,
    defaultId: SOLVE.done,
    cancelId: SOLVE.done,
    checked: (id) => (id in frames ? frames[id] === LAMP_ON : undefined),
    labels: { [SOLVE.stateUp]: copy.solveStatePrevious, [SOLVE.stateDown]: copy.solveStateNext },
    status: () => (states.length > 0 ? copy.solveState(states[stateIndex]?.label ?? "") : ""),
    // Les EDIT n'existent qu'en mode avancé (426f53) : propriété calculée, relue par la fenêtre à chaque mise à jour du calque.
    get input() {
      if (!advanced) return undefined;
      return [
        {
          id: SOLVE.countData,
          label: copy.solveCount,
          value: value && value.count > 0 ? String(value.count) : "",
          maxLength: 2,
          numeric: true,
          edit: EDIT_COLORS,
          input: (v: string) => {
            const n = Number(v || "0");
            if (n > 0 && value === null) {
              o.message(itfText(assets, SOLVE_TEXT.needCondition));
              return;
            }
            if (value) apply({ ...value, count: n });
            sync();
          },
        },
        {
          id: SOLVE.frameData,
          label: copy.solveDelay,
          value: delay > 0 ? String(delay) : "",
          maxLength: 4,
          numeric: true,
          edit: EDIT_COLORS,
          input: (v: string) => {
            const n = Number(v || "0");
            if (n > 0 && value === null && o.others === 0) {
              o.message(itfText(assets, SOLVE_TEXT.noCondition));
              return;
            }
            delay = n;
            o.setDelay(n);
            sync();
          },
        },
      ];
    },
    choose: (id) => {
      switch (id) {
        case SOLVE.done:
          return false;
        case SOLVE.help:
          o.help();
          return false;
        case SOLVE.notSolve:
          apply(null);
          break;
        case SOLVE.top:
          apply(withRect(OFF_TOP));
          break;
        case SOLVE.bottom:
          apply(withRect(OFF_BOTTOM));
          break;
        case SOLVE.offscreen:
          apply(withRect(OFF_SCREEN));
          break;
        case SOLVE.state: {
          const v = withState(stateIndex);
          if (v) apply(v);
          break;
        }
        case SOLVE.stateUp:
        case SOLVE.stateDown: {
          if (states.length === 0) break;
          stateIndex = (stateIndex + (id === SOLVE.stateUp ? states.length - 1 : 1)) % states.length;
          if (kind() === "state") {
            const v = withState(stateIndex);
            if (v) apply(v);
          }
          break;
        }
        case SOLVE.advanced:
          advanced = !advanced;
          o.setAdvanced(advanced);
          break;
        case SOLVE.countSel:
          if (!value) o.message(itfText(assets, SOLVE_TEXT.needCondition));
          else apply({ ...value, count: value.count > 0 ? 0 : 2 });
          break;
        case SOLVE.frameSel:
          if (delay > 0) {
            delay = 0;
            o.setDelay(0);
          } else if (value === null && o.others === 0) o.message(itfText(assets, SOLVE_TEXT.noCondition));
          else {
            delay = DEFAULT_DELAY;
            o.setDelay(delay);
          }
          break;
        case SOLVE.positionSel:
          o.drawPosition();
          return false;
        default:
          break;
      }
      sync();
      return true;
    },
  };
  sync();
  return { itf, options, value: () => value };
}

export function openSolveWindow(host: ItfHost, o: SolveWindowOptions & { onClose?(): void }): ItfWindowHandle {
  const w = solveWindow(host.assets, readItf(host.assets.index.get("SOLVE.ITF")), o);
  // Pas de copie des options : `input` est calculé (mode avancé).
  if (o.onClose) w.options.onClose = o.onClose;
  return openItfWindow(host, w.itf, w.options);
}

/** Aperçu d'une pièce dans SO_ANIM : l'image `image` de son ANM, centrée sur l'image 0, rognée au cadre. */
export function drawPartPreview(surface: Surface, assets: RenderAssets, type: number, r: Rect, image: number): void {
  const anm = assets.partAnm(type);
  const f0 = anm ? imageFrame(anm, 0) : null;
  if (!anm || !f0) return;
  const i = image >= 0 && image < imageCount(anm) ? image : 0;
  const clip = surface.setClip(r.x, r.y, r.width, r.height);
  drawAnmImage(surface, assets, anm, i, r.x + Math.trunc((r.width - f0.width) / 2) - f0.x, r.y + Math.trunc((r.height - f0.height) / 2) - f0.y);
  surface.restoreClip(clip);
}
