/**
 * Cadenas du Labo : `HTLOCK.ITF` (420810, procédure 420861, choix 42097c), ouvert par le bouton `TB_LOCKED` de la barre (41927c).
 *
 * - HTL_LOCK (31004, « Verrouiller Éléments », défaut) : 4209e5 verrouille toutes les pièces posées sauf les décors, puis GENERIC
 *   31132 (« Tous les éléments ont été verrouillés… »).
 * - HTL_UNLOCK (31005, « Déverrouiller ») : 420afc les déverrouille toutes, puis GENERIC 31133.
 * - HTL_CANCEL (31007, Échap) : rien.
 *
 * Une pièce se verrouille aussi seule, par sa poignée du cadenas (`Zone.Lock`, 42e9d8). Une pièce verrouillée reste à sa place quand on
 * joue le puzzle (essai, bac « Maison ») ; les autres partent au bac (43267a).
 */
import { readItf, type Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import { itfText } from "../render/itf-draw";
import { openItfWindow, type ItfHost, type ItfWindowHandle, type ItfWindowOptions } from "./itf-window";

export const HTLOCK = { lock: 31004, unlock: 31005, cancel: 31007 } as const;
/** `INTRFACE.RES` : titre (31140) et messages après le choix (31132, 31133). */
export const LOCK_TEXT = { title: 31140, locked: 31132, unlocked: 31133 } as const;

export interface LockWindowOptions {
  /** Le choix : verrouiller (vrai) ou déverrouiller (faux) toutes les pièces. */
  choose(locked: boolean): void;
}

/** Fenêtre sans DOM (tests, rendu) : ITF et options. */
export function lockWindow(assets: RenderAssets, itf: Itf, o: LockWindowOptions): { itf: Itf; options: ItfWindowOptions } {
  return {
    itf,
    options: {
      title: itfText(assets, LOCK_TEXT.title),
      defaultId: HTLOCK.lock,
      cancelId: HTLOCK.cancel,
      choose: (id) => {
        if (id === HTLOCK.lock) o.choose(true);
        else if (id === HTLOCK.unlock) o.choose(false);
      },
    },
  };
}

export function openLockWindow(host: ItfHost, o: LockWindowOptions & { onClose?(): void }): ItfWindowHandle {
  const w = lockWindow(host.assets, readItf(host.assets.index.get("HTLOCK.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}
