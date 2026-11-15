/**
 * Écran d'inscription (`SIGNIN.ITF`, 426b53, procédure 426362, commandes 4267b0, liste 426bc8 et 426a62). La logique du registre est
 * dans `engine/players.ts`.
 *
 * - SI_NAME (25003) : EDIT de 19 caractères, blanc sur bleu (4264e9), prérempli avec le nom du joueur courant (426453) ; chaque
 *   frappe cherche le nom (casse ignorée) dans la liste et y choisit sa rangée, ou aucune (426544 … 426618).
 * - SI_LIST (25002) : les noms, invité d'abord (42668d) ; rangées de la hauteur du texte + 2, (hauteur − 12) / rangée visibles, texte
 *   en x + 30, couleur 12 pour la rangée choisie, 9 sinon (426bc8) ; un clic choisit la rangée et copie son nom dans le champ
 *   (426ac2), un clic sur la rangée déjà choisie vaut « Terminé » (426b3d rend 3).
 * - SI_UP, SI_DOWN (25005, 25006) : une rangée de défilement (426806, 42682f), cachées tant que tout tient (42641e, 426cce).
 * - SI_DONE (25007, « Terminé », Entrée et Échap : 4263eb) : `done` (426877) ; la fenêtre reste ouverte, l'appelant la ferme.
 * - SI_HELP (25010) : le manuel Windows (4169c8(0xb)) ; le port ouvre l'aide du site, comme les autres « ? » des fenêtres.
 */
import { readItf, type Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import { ITF_DEFAULT_FONT } from "../render/itf-draw";
import { ScrollList, type ListRow, type ListStyle } from "../render/itf-list";
import { PLAYER_NAME_MAX, cleanPlayerName, sameName } from "../engine/players";
import { copy } from "../copy";
import { openItfWindow, type ItfHost, type ItfInput, type ItfWindowHandle, type ItfWindowOptions } from "./itf-window";

export const SIGNIN = {
  list: 25002,
  name: 25003,
  heading: 25004,
  up: 25005,
  down: 25006,
  done: 25007,
  picture: 25009,
  help: 25010,
} as const;

/** 426bc8 : texte en x + 30, (hauteur − 12) / rangée, une ligne de plus en haut ; couleurs 12 et 9. */
export const SIGNIN_LIST_STYLE: ListStyle = { textDx: 30, reserve: 12, extraTop: 1, selected: 12, row: 9 };
/** EDIT du nom (4264e9 : texte blanc, fond 0xEF0000 en BGR, soit bleu). */
const EDIT_COLORS = { color: "#ffffff", background: "#0000ef" } as const;

export interface SignInOptions {
  /** Noms des joueurs, invité d'abord. */
  names(): string[];
  /** Rangée du joueur courant. */
  current: number;
  /** « Terminé » : le nom écrit et la rangée choisie (`null` : aucune). La fenêtre reste ouverte. */
  done(typed: string, selected: number | null): void;
  /** « ? » : la fenêtre se ferme, l'appelant ouvre l'aide. */
  help(): void;
  /** Son du clic sur une rangée. */
  click?(): void;
}

export function signInWindow(assets: RenderAssets, itf: Itf, o: SignInOptions): { itf: Itf; options: ItfWindowOptions; typed(): string; selected(): number | null } {
  const listControl = itf.controls.find((c) => c.id === SIGNIN.list)!;
  const view = new ScrollList(assets.font(ITF_DEFAULT_FONT), { x: listControl.x, y: listControl.y, width: listControl.width, height: listControl.height }, null, SIGNIN_LIST_STYLE);
  const names = (): string[] => o.names();
  const rows = (): ListRow[] => names().map((text) => ({ text, solved: false }));
  view.reset(rows(), Math.max(0, o.current));
  /** Rangée choisie (`[0x47fdf0]`), `null` quand le nom écrit n'est pas dans la liste. */
  let chosen: number | null = o.current >= 0 ? o.current : null;
  let typed = (names()[o.current] ?? "").slice(0, PLAYER_NAME_MAX);

  const state: NonNullable<ItfWindowOptions["state"]> = { hidden: [] };
  const refreshState = (): void => {
    view.rows = rows();
    // 426cce : flèches montrées seulement si toutes les rangées ne tiennent pas.
    state.hidden = view.rows.length > view.visible() ? [] : [SIGNIN.up, SIGNIN.down];
  };
  refreshState();

  const input: ItfInput = {
    id: SIGNIN.name,
    label: copy.signInName,
    value: typed,
    maxLength: PLAYER_NAME_MAX,
    edit: EDIT_COLORS,
    input: (v: string) => {
      typed = v.slice(0, PLAYER_NAME_MAX);
      input.value = typed;
      // 426544 : le nom écrit choisit sa rangée, sinon aucune.
      const clean = cleanPlayerName(typed);
      const i = clean === null ? -1 : names().findIndex((n) => sameName(n, clean));
      chosen = i >= 0 ? i : null;
      if (i >= 0) view.select(i);
    },
  };
  /** 426ac2 : une rangée choisie copie son nom dans le champ. */
  const select = (i: number): void => {
    if (!view.select(i)) return;
    chosen = i;
    typed = (names()[i] ?? "").slice(0, PLAYER_NAME_MAX);
    input.value = typed;
  };
  const rowLabel = (i: number): string => names()[i] ?? "";
  return {
    itf,
    typed: () => typed,
    selected: () => chosen,
    options: {
      title: copy.signInTitle,
      state,
      defaultId: SIGNIN.done,
      cancelId: SIGNIN.done,
      labels: { [SIGNIN.up]: copy.scrollUp, [SIGNIN.down]: copy.scrollDown },
      input,
      list: {
        id: SIGNIN.list,
        view,
        label: rowLabel,
        select,
        click: (i) => {
          o.click?.();
          if (i === chosen) return SIGNIN.done;
          select(i);
          return undefined;
        },
      },
      status: () => (chosen !== null ? copy.signInChosen(rowLabel(chosen)) : typed.trim() !== "" ? copy.signInNew(typed.trim()) : ""),
      choose: (id) => {
        switch (id) {
          case SIGNIN.up:
            view.scrollBy(-1);
            return true;
          case SIGNIN.down:
            view.scrollBy(1);
            return true;
          case SIGNIN.done:
            o.done(typed, chosen);
            return true;
          case SIGNIN.help:
            o.help();
            return false;
          default:
            return true;
        }
      },
    },
  };
}

export function openSignInWindow(host: ItfHost, o: SignInOptions & { onClose?(): void }): ItfWindowHandle {
  const w = signInWindow(host.assets, readItf(host.assets.index.get("SIGNIN.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}
