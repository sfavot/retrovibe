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
 * - HP_TITLE, HP_OK, Oui, Non, Annuler (23114, 23115, 23112, 23113, 23111) servent à la visite guidée du Labo (41d8e8(0), 41eaaa) :
 *   cachés dans l'aide (41e585 à 41e5e2), montrés par `walkthroughWindow` (logique dans `engine/walkthrough.ts`) ; HP_OK n'y est
 *   jamais montré (41dfab le cache après la saisie du nom).
 */
import { readItf, type Itf } from "../data/itf";
import { professorVoice, type VoiceRef } from "../audio/ids";
import { WALK_NAME_MAX, type WalkButton, type WalkEffect, type WalkFacts, type Walkthrough } from "../engine/walkthrough";
import type { RenderAssets } from "../render/assets";
import { layoutItf } from "../render/itf-draw";
import { copy } from "../copy";
import { openItfWindow, type ItfHost, type ItfInput, type ItfWindowHandle, type ItfWindowOptions } from "./itf-window";
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

/** Texte défilant et professeur de `HELP.ITF`, communs à l'aide et à la visite guidée (41e567). */
interface HelpPane {
  state: NonNullable<ItfWindowOptions["state"]>;
  /** Contrôles cachés par le défilement (flèches d'un texte court). */
  arrowsHidden(): number[];
  /** Nouveau texte (défilement remis en haut) ; une voix différente relance le professeur (423e50). */
  show(text: string, voice: VoiceRef | null | undefined): void;
  text(): string;
  /** ▲ ▼ et le professeur ; `undefined` pour un autre contrôle. */
  choose(id: number): boolean | undefined;
  zones(): ReturnType<NonNullable<ItfWindowOptions["zones"]>>;
  professor(): Professor | null;
}

function helpPane(assets: RenderAssets, itf: Itf, audio: ProfessorAudio, random: Random | undefined): HelpPane {
  const control = (id: number) => itf.controls.find((c) => c.id === id);
  const prof = control(HELP_ITF.professor);
  let professor: Professor | null = null;
  let text = "";
  let lines = { visible: 0, total: 0 };
  /** Dernière page descendue (`[0x47ea68]`). */
  let page = 0;
  const texts: Record<number, string> = {};
  const scroll: Record<number, number> = { [HELP_ITF.text]: 0 };
  const moved: Record<number, { x: number }> = {};
  const state: NonNullable<ItfWindowOptions["state"]> = {
    hidden: [],
    texts,
    moved,
    scroll,
  };
  let arrows: number[] = [];
  return {
    state,
    arrowsHidden: () => arrows,
    text: () => text,
    professor: () => professor,
    show(next, voice) {
      text = next;
      texts[HELP_ITF.text] = next;
      lines = layoutItf(assets, itf, { texts }).items.find((i) => i.id === HELP_ITF.text)?.lines ?? { visible: 0, total: 0 };
      scroll[HELP_ITF.text] = 0;
      page = lines.visible;
      // 41e616 : texte court, flèches cachées, « Terminé » et « ? » 16 pixels plus à gauche.
      const scrolls = lines.total > lines.visible;
      arrows = scrolls ? [] : [HELP_ITF.up, HELP_ITF.down];
      for (const id of [HELP_ITF.done, HELP_ITF.help]) {
        const c = control(id);
        if (!c) continue;
        if (scrolls) delete moved[id];
        else moved[id] = { x: c.x - NO_ARROWS_SHIFT };
      }
      if (voice === undefined) return;
      professor?.stop();
      professor = professorStarts(voice) ? new Professor(assets, audio, voice, random) : null;
      // Sans professeur animé (voix `help/064`), le contrôle garde son image d'ITF.
      const p = professor;
      if (p && prof) state.draw = { [HELP_ITF.professor]: (surface, rect) => p.draw(surface, assets, prof, rect) };
      else delete state.draw;
    },
    zones: () => (professor && prof ? [{ id: HELP_ITF.professor, x: prof.x, y: prof.y, width: prof.width, height: prof.height, label: copy.professorReplay }] : []),
    choose(id) {
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
        default:
          return undefined;
      }
    },
  };
}

export function helpWindow(assets: RenderAssets, itf: Itf, o: HelpWindowOptions): HelpWindow {
  const pane = helpPane(assets, itf, o.audio, o.random);
  pane.show(o.text, o.voice);
  // 41e585 … 41e5e2 : titre, OK, Oui, Non, Annuler ne servent qu'à la visite guidée.
  pane.state.hidden = [HELP_ITF.title, HELP_ITF.ok, HELP_ITF.yes, HELP_ITF.no, HELP_ITF.cancel, ...pane.arrowsHidden()];
  const options: ItfWindowOptions = {
    title: copy.professorHelpTitle,
    state: pane.state,
    defaultId: HELP_ITF.help,
    cancelId: HELP_ITF.done,
    labels: { [HELP_ITF.help]: copy.professorHelpAnother, [HELP_ITF.up]: copy.scrollUp, [HELP_ITF.down]: copy.scrollDown },
    zones: () => pane.zones(),
    // Le texte entier, même la partie qui n'est pas affichée.
    texts: () => [pane.text()],
    tick: () => pane.professor()?.pass() ?? false,
    choose: (id) => {
      const scrolled = pane.choose(id);
      if (scrolled !== undefined) return scrolled;
      if (id === HELP_ITF.help) o.another();
      return false;
    },
    onClose: () => pane.professor()?.stop(),
  };
  return { itf, options, professor: pane.professor() };
}

// ------------------------------------------------------------------ visite guidée (41d8e8(0), 41eaaa)

export interface WalkthroughWindowOptions {
  walk: Walkthrough;
  /** Ce que la visite lit de la machine (41eaaa). */
  facts(): WalkFacts;
  /** Lignes de `PROFESOR.RES`. */
  lines: readonly string[];
  audio: ProfessorAudio;
  /** « Salut! » avant la fin : 31136 par-dessus la fenêtre ; `leave` la ferme et quitte la visite. */
  confirmLeave(leave: () => void): void;
  /** Après la fermeture : l'effet du bouton qui l'a fermée (`null` : fermée sans choix). */
  after(effect: WalkEffect | null): void;
  random?: Random;
}

/** EDIT du nom (41dc71 : texte noir, fond et pinceau blancs). */
const NAME_EDIT = { color: "#000000", background: "#ffffff" } as const;

/**
 * La fenêtre du professeur pendant la visite : `HELP.ITF` avec « Continuer », « Retourner », « Salut! » (HP_YES, HP_NO, HP_CANCEL),
 * « Terminé » à la fin, et la saisie du nom dans HP_TITLE ; « ? » et OK cachés (41eaaa, 41e567). Continuer est le bouton par défaut,
 * Échap vaut « Salut! » (41dc19), puis « Terminé » à la fin.
 */
export function walkthroughWindow(assets: RenderAssets, itf: Itf, o: WalkthroughWindowOptions): { itf: Itf; options: ItfWindowOptions; update(): void } {
  const pane = helpPane(assets, itf, o.audio, o.random);
  const inputs: ItfInput[] = [];
  let effect: WalkEffect | null = null;
  const update = (): void => {
    const view = o.walk.view(o.facts());
    pane.show(o.lines[view.line] ?? "", view.voice === null ? undefined : professorVoice(view.voice));
    const b = view.buttons;
    pane.state.hidden = [
      HELP_ITF.title,
      HELP_ITF.ok,
      HELP_ITF.help,
      ...(b.yes ? [] : [HELP_ITF.yes]),
      ...(b.no ? [] : [HELP_ITF.no]),
      ...(b.cancel ? [] : [HELP_ITF.cancel]),
      ...(b.done ? [] : [HELP_ITF.done]),
      ...pane.arrowsHidden(),
    ];
    options.cancelId = b.done ? HELP_ITF.done : HELP_ITF.cancel;
    options.defaultId = b.done ? HELP_ITF.done : HELP_ITF.yes;
    inputs.length = 0;
    if (view.naming) {
      inputs.push({
        id: HELP_ITF.title,
        label: copy.walkthroughName,
        value: o.walk.draft,
        maxLength: WALK_NAME_MAX,
        edit: NAME_EDIT,
        input: (v: string) => {
          o.walk.draft = v.slice(0, WALK_NAME_MAX);
          inputs[0]!.value = o.walk.draft;
        },
      });
    }
  };
  const buttons: Readonly<Record<number, WalkButton>> = { [HELP_ITF.yes]: "yes", [HELP_ITF.no]: "no", [HELP_ITF.cancel]: "cancel", [HELP_ITF.done]: "done" };
  const options: ItfWindowOptions = {
    title: copy.walkthroughTitle,
    state: pane.state,
    defaultId: HELP_ITF.yes,
    cancelId: HELP_ITF.cancel,
    labels: { [HELP_ITF.up]: copy.scrollUp, [HELP_ITF.down]: copy.scrollDown },
    input: inputs,
    zones: () => pane.zones(),
    texts: () => [pane.text()],
    tick: () => pane.professor()?.pass() ?? false,
    choose: (id) => {
      const scrolled = pane.choose(id);
      if (scrolled !== undefined) return scrolled;
      const button = buttons[id];
      if (!button) return true;
      const e = o.walk.press(button, o.facts());
      switch (e.kind) {
        case "none":
          return true;
        case "refresh":
          update();
          return true;
        case "leave":
          if (e.confirm) {
            o.confirmLeave(() => {
              effect = { kind: "leave", confirm: false };
            });
            return true;
          }
          effect = e;
          return false;
        default:
          effect = e;
          return false;
      }
    },
    onClose: () => {
      pane.professor()?.stop();
      o.after(effect);
    },
  };
  update();
  return { itf, options, update };
}

export function openWalkthroughWindow(host: ItfHost, o: WalkthroughWindowOptions): ItfWindowHandle {
  let handle: ItfWindowHandle | null = null;
  // 31136 accepté : la fenêtre se ferme, `after` reçoit « quitter ».
  const w = walkthroughWindow(host.assets, readItf(host.assets.index.get("HELP.ITF")), {
    ...o,
    confirmLeave: (leave) =>
      o.confirmLeave(() => {
        leave();
        handle?.close();
      }),
  });
  handle = openItfWindow(host, w.itf, w.options);
  return handle;
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
