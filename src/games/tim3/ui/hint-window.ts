/**
 * Indices du professeur : `HINT.ITF` (41f3dc, procédure 41f47a, boutons 41f8d4).
 *
 * **Jeu** (un clic sur une main, 42013d) : HT_TEXT (21107) montre le texte de l'indice. Le jeu y pose un contrôle EDIT Win32 en lecture
 * seule (blanc sur bleu) ; le port dessine la zone de texte de l'ITF (cadre bleu de la valeur 2, texte en 15). Terminé (21105) : Entrée
 * et Échap ; HT_EDIT_DONE, HT_NEW, HT_VIEW cachés.
 *
 * **Labo** (éditeur d'indices) :
 * - Par la main de la barre (4192dc), sans indice choisi (41f668) : le texte « Sélectionnez "Nouveau"… » (31259, plus « Sélectionner
 *   "Montrer"… », 31264, s'il y a des indices), en lecture seule ; Nouveau (HT_NEW), Montrer (HT_VIEW, caché sans indice), Cacher
 *   (HT_EDIT_DONE, Échap), Aide (HT_HELP). Terminé est caché.
 * - Pour un indice (poignée « modifier » de sa main, ou après sa pose) (41f5b5) : son texte dans un EDIT modifiable (blanc sur bleu,
 *   254 caractères) ; mêmes boutons ; Échap = Terminé, caché (41ff36). Chaque bouton relit le texte : vide, GENERIC 31263 et la fenêtre
 *   reste ; sinon il est gardé dans l'indice.
 * - Nouveau (41fcdc) : 8 indices déjà, GENERIC 31265 ; sinon la fenêtre se ferme et une main suit le pointeur jusqu'à un appui (42057e),
 *   puis la fenêtre revient pour écrire le nouvel indice (41f3dc, `[0x47ea6c]` = 2). Montrer / Cacher (41fb4e, 41f9c7) : toutes les mains
 *   (4204cf, 420536), puis la fenêtre se ferme.
 * - Le professeur (21106, `HINTPROF.ANM` état 32) s'anime à chaque passe (4207a4) ; au Labo, il n'a pas de voix à rejouer (le jeu y lit
 *   celle d'un indice du dernier puzzle joué, `[0x481600]` : sans rapport avec le puzzle maison, non reprise).
 * - Aide (HT_HELP, 41ffaa) : `TIMHELP.EXE` dans le jeu, l'aide du site ici.
 */
import { readItf, type Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import { itfText } from "../render/itf-draw";
import { copy } from "../copy";
import { HINT_TEXT_MAX } from "../engine/lab-puzzle";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost } from "./itf-window";

export const HINT = { help: 21114, view: 21113, create: 21112, editDone: 21108, text: 21107, professor: 21106, done: 21105 } as const;
/** `INTRFACE.RES` : consigne de l'éditeur (31259, 31264), indice vide (31263), 8 indices (31265), effacer (31122, bouton 31253). */
export const HINT_TEXT = { create: 31259, view: 31264, empty: 31263, full: 31265, confirmDelete: 31122, delete: 31253, cancel: 31108, title: 31139 } as const;
/** Couleurs du contrôle EDIT (41f7c9 : texte 0xFFFFFF sur 0xEF0000 en BGR). */
const EDIT_COLORS = { color: "#ffffff", background: "#0000ef" } as const;

export interface HintWindowOptions {
  text: string;
  /** Rejoue la voix (clic sur le professeur). */
  replay(): void;
}

function professorZone(itf: Itf): NonNullable<ItfWindowOptions["zones"]> {
  const professor = itf.controls.find((c) => c.id === HINT.professor);
  return () => (professor ? [{ id: HINT.professor, x: professor.x, y: professor.y, width: professor.width, height: professor.height, label: copy.hintReplay }] : []);
}

/** Un indice en mode Jeu (lecture seule). */
export function hintWindow(itf: Itf, o: HintWindowOptions): { itf: Itf; options: ItfWindowOptions } {
  return {
    itf,
    options: {
      title: copy.hintTitle,
      state: { hidden: [HINT.help, HINT.view, HINT.create, HINT.editDone], texts: { [HINT.text]: o.text } },
      defaultId: HINT.done,
      cancelId: HINT.done,
      animate: [HINT.professor],
      zones: professorZone(itf),
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

// ------------------------------------------------------------------ éditeur d'indices (Labo)

/** Ce que l'éditeur demande au Labo. */
export type HintEditorChoice = "create" | "show" | "hide" | "done" | "help";

export interface HintEditorOptions {
  /** Indice à écrire (son texte), ou `null` : la fenêtre de la barre, sans indice choisi. */
  text: string | null;
  /** Nombre d'indices du puzzle maison (8 au plus). */
  count: number;
  /** Le texte d'un indice a été relu, non vide (à garder dans l'indice). */
  save(text: string): void;
  /** Message du jeu (31263, 31265), par-dessus la fenêtre qui reste ouverte. */
  message(text: string): void;
  /** Le choix qui ferme la fenêtre. */
  choose(choice: HintEditorChoice): void;
}

/**
 * Éditeur d'indices du Labo (fenêtre sans DOM : tests, rendu). En écriture, Échap ferme sans bouton (Terminé est caché) : `closed`
 * garde alors le texte s'il n'est pas vide, comme 41ff36, puis rend « done ».
 */
export function hintEditorWindow(assets: RenderAssets, itf: Itf, o: HintEditorOptions): { itf: Itf; options: ItfWindowOptions; text(): string; closed(): void } {
  const editing = o.text !== null;
  let chosen = false;
  const choose = (choice: HintEditorChoice): void => {
    chosen = true;
    o.choose(choice);
  };
  let text = o.text ?? itfText(assets, HINT_TEXT.create) + (o.count > 0 ? ` ${itfText(assets, HINT_TEXT.view)}` : "");
  const hidden = editing ? [HINT.done, HINT.text] : [HINT.done, ...(o.count > 0 ? [] : [HINT.view])];
  /** 41f9c7, 41fb4e, 41fcdc, 41ff36 : texte vide refusé (31263), sinon gardé ; vrai si on peut continuer. */
  const commit = (): boolean => {
    if (!editing) return true;
    if (text.trim() === "") {
      o.message(itfText(assets, HINT_TEXT.empty));
      return false;
    }
    o.save(text);
    return true;
  };
  const options: ItfWindowOptions = {
    title: itfText(assets, HINT_TEXT.title),
    state: { hidden, texts: editing ? {} : { [HINT.text]: text } },
    defaultId: o.count > 0 || editing ? HINT.view : HINT.create,
    ...(editing ? {} : { cancelId: HINT.editDone }),
    animate: [HINT.professor],
    ...(editing
      ? {
          input: {
            id: HINT.text,
            label: copy.hintEditText,
            value: text,
            maxLength: HINT_TEXT_MAX,
            edit: { ...EDIT_COLORS, multiline: true },
            input: (v: string) => {
              text = v;
            },
          },
        }
      : {}),
    choose: (id) => {
      switch (id) {
        case HINT.professor:
          return true;
        case HINT.help:
          choose("help");
          return false;
        case HINT.create:
          if (!commit()) return true;
          // 41fea1 : 8 indices déjà (le nouveau en serait un neuvième).
          if (o.count >= 8) {
            o.message(itfText(assets, HINT_TEXT.full));
            return true;
          }
          choose("create");
          return false;
        case HINT.view:
        case HINT.editDone:
        case HINT.done:
          if (!commit()) return true;
          choose(id === HINT.view ? "show" : id === HINT.editDone ? "hide" : "done");
          return false;
        default:
          return true;
      }
    },
  };
  const closed = (): void => {
    if (chosen) return;
    if (editing && text.trim() !== "") o.save(text);
    choose("done");
  };
  return { itf, options, text: () => text, closed };
}

export function openHintEditorWindow(host: ItfHost, o: HintEditorOptions & { onClose?(): void }): ItfWindowHandle {
  const w = hintEditorWindow(host.assets, readItf(host.assets.index.get("HINT.ITF")), o);
  return openItfWindow(host, w.itf, {
    ...w.options,
    onClose: () => {
      w.closed();
      o.onClose?.();
    },
  });
}
