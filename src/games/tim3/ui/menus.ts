/**
 * Fenêtres du jeu dessinées comme dans l'original (`.ITF`, hôte `ui/itf-window.ts`, plan D7) : messages et confirmations (GENERIC),
 * puzzle réussi (PUZZSOLV). Les autres fenêtres `.ITF` ont leur fichier (`info-window.ts`, `program-window.ts`, `globe-window.ts`,
 * `musicbox-window.ts`, `binsolve-window.ts`, `hint-window.ts`, `machines-window.ts`) ; le parcours d'entrée est dans
 * `main-menu.ts`, `credits.ts` et `chooser.ts`.
 */
import { readItf, type Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import { itfText } from "../render/itf-draw";
import { openItfWindow, type ItfHost, type ItfWindowHandle, type ItfWindowOptions } from "./itf-window";

/** PUZZSOLV.ITF : identifiants des boutons (17002 « Même Puzzle », 17003 « Puzzle Suivant », 17004 « Rejouer la Solution »). */
export const PUZZSOLV = { same: 17002, next: 17003, replay: 17004, title: 21060 } as const;

/**
 * Puzzle réussi (PUZZSOLV.ITF, 4260f0) : rester sur le puzzle, rejouer la solution du joueur ou passer au suivant. « Puzzle Suivant »
 * reçoit le focus (450d44 : drapeau 0x10) et se grise s'il n'y a pas de puzzle suivant ; Échap ferme la fenêtre comme « Même Puzzle »
 * (le jeu donne Échap à « Rejouer la Solution », drapeau 0x20 : écart choisi, Échap ne relance pas la machine).
 */
export interface SolvedOptions {
  hasNext: boolean;
  canReplay: boolean;
  same(): void;
  replay(): void;
  next(): void;
}

/** Fenêtre sans DOM (tests) : ITF et options. */
export function solvedWindow(assets: RenderAssets, itf: Itf, o: SolvedOptions): { itf: Itf; options: ItfWindowOptions } {
  const disabled = [...(o.hasNext ? [] : [PUZZSOLV.next]), ...(o.canReplay ? [] : [PUZZSOLV.replay])];
  return {
    itf,
    options: {
      title: itfText(assets, PUZZSOLV.title),
      state: { disabled },
      defaultId: PUZZSOLV.next,
      choose: (id) => {
        if (id === PUZZSOLV.next) o.next();
        else if (id === PUZZSOLV.replay) o.replay();
        else o.same();
      },
    },
  };
}

export function solvedDialog(host: ItfHost, o: SolvedOptions & { onClose?(): void }): ItfWindowHandle {
  const w = solvedWindow(host.assets, readItf(host.assets.index.get("PUZZSOLV.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}

/** GENERIC.ITF : texte, boutons, et textes d'origine de la fenêtre (`INTRFACE.RES`). */
export const GENERIC = { text: 65004, ok: 65001, cancel: 65002, frame: 65000, title: 2393, okLabel: 31107, yes: 31114, no: 31115 } as const;

/**
 * Message ou question du jeu (GENERIC.ITF, 422267) : `text` dans la zone de texte, un ou deux boutons dont les libellés sont des
 * identifiants de `INTRFACE.RES`. Un seul bouton : le second est caché et le premier centré sous le cadre (42253a). Entrée : premier
 * bouton ; Échap : le second, ou le seul (450d44). `choose` reçoit 1 (premier bouton) ou 0 (second) ; fermer autrement ne choisit rien.
 */
export interface GenericOptions {
  text: string;
  buttons: readonly [number] | readonly [number, number];
  title?: string;
  choose(result: 0 | 1): void;
}

/** Fenêtre sans DOM (tests) : ITF et options. */
export function genericWindow(assets: RenderAssets, itf: Itf, o: GenericOptions): { itf: Itf; options: ItfWindowOptions } {
  const [first, second] = o.buttons;
  const texts: Record<number, string> = { [GENERIC.text]: o.text, [GENERIC.ok]: itfText(assets, first) };
  const state: NonNullable<ItfWindowOptions["state"]> = { texts };
  if (second === undefined) {
    const frame = itf.controls.find((c) => c.id === GENERIC.frame);
    const ok = itf.controls.find((c) => c.id === GENERIC.ok);
    state.hidden = [GENERIC.cancel];
    if (frame && ok) state.moved = { [GENERIC.ok]: { x: frame.x + Math.trunc((frame.width - ok.width) / 2) } };
  } else texts[GENERIC.cancel] = itfText(assets, second);
  return {
    itf,
    options: {
      title: o.title ?? itfText(assets, GENERIC.title),
      state,
      defaultId: GENERIC.ok,
      cancelId: second === undefined ? GENERIC.ok : GENERIC.cancel,
      choose: (id) => o.choose(id === GENERIC.ok ? 1 : 0),
    },
  };
}

export function genericDialog(host: ItfHost, o: GenericOptions & { onClose?(): void }): ItfWindowHandle {
  const w = genericWindow(host.assets, readItf(host.assets.index.get("GENERIC.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}

/** Question oui / non (GENERIC.ITF, boutons « Oui » et « Non ») : `yes` au premier. */
export function confirmDialog(host: ItfHost, text: string, yes: () => void, onClose?: () => void): ItfWindowHandle {
  return genericDialog(host, { text, buttons: [GENERIC.yes, GENERIC.no], choose: (r) => r === 1 && yes(), ...(onClose ? { onClose } : {}) });
}

/** Message (GENERIC.ITF, bouton « OK » seul). */
export function messageDialog(host: ItfHost, text: string, onClose?: () => void): ItfWindowHandle {
  return genericDialog(host, { text, buttons: [GENERIC.okLabel], choose: () => undefined, ...(onClose ? { onClose } : {}) });
}
