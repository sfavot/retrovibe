/**
 * Aide du professeur : `HELP.ITF` (41d9a3, procédure 41db2d, contenu 41e567, boutons 41dce4), ouverte par le « ? » de la barre d'outils
 * (41907f → 41d8e8(23100)) puis après chaque élément choisi en mode aide (41e6b7).
 *
 * - HP_TEXT (23107) : le texte de `HELP.RES` (`data/help.ts`), défilé par ▲ ▼ (23119, 23120) d'une page à la fois (41e52b : + lignes
 *   visibles tant qu'il en reste ; 41e4f3 : − la dernière page) ; texte court : flèches cachées, « Terminé » et « ? » 16 pixels plus à
 *   gauche (41e616).
 * - Le professeur (23106, `ui/professor.ts`) dit la voix de la ligne (`help/<rang>`) ; un clic sur lui la rejoue.
 * - « ? » (HP_BHELP, 23121, bouton par défaut) ferme la fenêtre et passe en mode aide (41e4e6 → 41d991 → 41e6b7) ; « Terminé »
 *   (HP_DONE, 23118, Échap) la ferme (41e483).
 * - HP_TITLE, HP_OK, Oui, Non, Annuler (23114, 23115, 23112, 23113, 23111) servent à la visite guidée du Labo (41d8e8(0), 41eaaa),
 *   non portée : toujours cachés ici (41e585 à 41e5e2).
 */
import { readItf, type Itf } from "../data/itf";
import type { VoiceRef } from "../audio/ids";
import type { RenderAssets } from "../render/assets";
import { layoutItf } from "../render/itf-draw";
import { copy } from "../copy";
import { openItfWindow, type ItfHost, type ItfWindowHandle, type ItfWindowOptions } from "./itf-window";
import { Professor, professorStarts, type ProfessorAudio, type Random } from "./professor";

export const HELP_ITF = {
  help: 23121,
  down: 23120,
  up: 23119,
  done: 23118,
  ok: 23115,
  title: 23114,
  no: 23113,
  yes: 23112,
  cancel: 23111,
  text: 23107,
  professor: 23106,
} as const;

/** 41e66e : sans flèches, « Terminé » et « ? » prennent leur place, 16 pixels plus à gauche. */
const NO_ARROWS_SHIFT = 16;

export interface HelpWindowOptions {
  /** Texte de `HELP.RES`. */
  text: string;
  /** Voix de la ligne (`helpVoice(rang)`), `null` sans voix. */
  voice: VoiceRef | null;
  audio: ProfessorAudio;
  /** « ? » : fermer et choisir un élément de l'écran. */
  another(): void;
  random?: Random;
}

export interface HelpWindow {
  itf: Itf;
  options: ItfWindowOptions;
  /** `null` quand le professeur ne s'anime pas (voix `help/064`) : le contrôle garde son image. */
  professor: Professor | null;
}

export function helpWindow(assets: RenderAssets, itf: Itf, o: HelpWindowOptions): HelpWindow {
  const control = (id: number) => itf.controls.find((c) => c.id === id);
  const prof = control(HELP_ITF.professor);
  const professor = professorStarts(o.voice) ? new Professor(assets, o.audio, o.voice, o.random) : null;
  const hidden: number[] = [HELP_ITF.title, HELP_ITF.ok, HELP_ITF.yes, HELP_ITF.no, HELP_ITF.cancel];
  const texts = { [HELP_ITF.text]: o.text };
  const lines = layoutItf(assets, itf, { texts }).items.find((i) => i.id === HELP_ITF.text)?.lines ?? { visible: 0, total: 0 };
  const scrolls = lines.total > lines.visible;
  const moved: Record<number, { x: number }> = {};
  if (!scrolls) {
    hidden.push(HELP_ITF.up, HELP_ITF.down);
    for (const id of [HELP_ITF.done, HELP_ITF.help]) {
      const c = control(id);
      if (c) moved[id] = { x: c.x - NO_ARROWS_SHIFT };
    }
  }
  const scroll: Record<number, number> = { [HELP_ITF.text]: 0 };
  /** Dernière page descendue (`[0x47ea68]`). */
  let page = lines.visible;
  const state: NonNullable<ItfWindowOptions["state"]> = {
    hidden,
    texts,
    moved,
    scroll,
    ...(professor && prof ? { draw: { [HELP_ITF.professor]: (surface, rect) => professor.draw(surface, assets, prof, rect) } } : {}),
  };
  const options: ItfWindowOptions = {
    title: copy.professorHelpTitle,
    state,
    defaultId: HELP_ITF.help,
    cancelId: HELP_ITF.done,
    labels: { [HELP_ITF.help]: copy.professorHelpAnother, [HELP_ITF.up]: copy.scrollUp, [HELP_ITF.down]: copy.scrollDown },
    zones: () => (professor && prof ? [{ id: HELP_ITF.professor, x: prof.x, y: prof.y, width: prof.width, height: prof.height, label: copy.professorReplay }] : []),
    // Le texte entier, même la partie qui n'est pas affichée.
    texts: () => [o.text],
    tick: () => professor?.pass() ?? false,
    choose: (id) => {
      switch (id) {
        case HELP_ITF.down:
          if (lines.total - lines.visible > scroll[HELP_ITF.text]!) {
            scroll[HELP_ITF.text]! += lines.visible;
            page = lines.visible;
          }
          return true;
        case HELP_ITF.up:
          scroll[HELP_ITF.text] = Math.max(0, scroll[HELP_ITF.text]! - page);
          return true;
        case HELP_ITF.professor:
          professor?.replay();
          return true;
        case HELP_ITF.help:
          o.another();
          return false;
        default:
          return false;
      }
    },
    onClose: () => professor?.stop(),
  };
  return { itf, options, professor };
}

export function openHelpWindow(host: ItfHost, o: HelpWindowOptions & { onClose?(): void }): ItfWindowHandle {
  const w = helpWindow(host.assets, readItf(host.assets.index.get("HELP.ITF")), o);
  const close = w.options.onClose;
  return openItfWindow(host, w.itf, {
    ...w.options,
    onClose: () => {
      close?.();
      o.onClose?.();
    },
  });
}
