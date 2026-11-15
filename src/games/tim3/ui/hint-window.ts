/**
 * Un indice du professeur : `HINT.ITF` en mode Jeu (41f3dc, procédure 41f47a), ouvert par un clic sur une flèche d'indice (42013d).
 *
 * - HT_TEXT (21107) : le texte de l'indice. Le jeu y pose un vrai contrôle EDIT Win32 en lecture seule (blanc sur bleu) ; le port
 *   dessine la zone de texte de l'ITF (cadre bleu de la valeur 2, texte en 15).
 * - Le professeur (21106, `HINTPROF.ANM` état 32) s'anime à chaque passe (4207a4) ; un clic sur lui rejoue la voix (41f926).
 * - HT_EDIT_DONE, HT_NEW, HT_VIEW (éditeur d'indices du Labo) et HT_HELP (`TIMHELP.EXE`) sont cachés ou non portés.
 * - Voix : celle de l'emplacement LEV de l'indice (5500 + 500 × i + puzzle, `hintVoice(i + 1, puzzle)`), lancée à l'ouverture (le jeu
 *   attend 14 messages de la procédure, 424684 : délai court, supposé) ; arrêtée à la fermeture (41151e(6000), 41151e(4000)).
 * - Terminé (21105) : Entrée et Échap.
 */
import { readItf, type Itf } from "../data/itf";
import { copy } from "../copy";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost } from "./itf-window";

export const HINT = { help: 21114, view: 21113, create: 21112, editDone: 21108, text: 21107, professor: 21106, done: 21105 } as const;

export interface HintWindowOptions {
  text: string;
  /** Rejoue la voix (clic sur le professeur). */
  replay(): void;
}

export function hintWindow(itf: Itf, o: HintWindowOptions): { itf: Itf; options: ItfWindowOptions } {
  const professor = itf.controls.find((c) => c.id === HINT.professor);
  return {
    itf,
    options: {
      title: copy.hintTitle,
      state: { hidden: [HINT.help, HINT.view, HINT.create, HINT.editDone], texts: { [HINT.text]: o.text } },
      defaultId: HINT.done,
      cancelId: HINT.done,
      animate: [HINT.professor],
      zones: () => (professor ? [{ id: HINT.professor, x: professor.x, y: professor.y, width: professor.width, height: professor.height, label: copy.hintReplay }] : []),
      choose: (id) => {
        if (id === HINT.professor) {
          o.replay();
          return true;
        }
        return false;
      },
    },
  };
}

export function openHintWindow(host: ItfHost, o: HintWindowOptions & { onClose?(): void }): ItfWindowHandle {
  const w = hintWindow(readItf(host.assets.index.get("HINT.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}
