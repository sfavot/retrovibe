/**
 * Machines du Labo (bouton disquette) : `LOADSAVE.ITF` puis la liste `DOSBOX.ITF`. La logique des emplacements est celle de
 * `engine/save.ts` (`SaveSlots`, D11), inchangée ; le jeu y range des fichiers LEV, le port ses dix emplacements.
 *
 * - **LOADSAVE** (42289c, procédure 422902), au Labo seulement (418f3a ; en Jeu, le jeu va droit au chargement) : LS_LOAD (14007)
 *   rend « charger », LS_SAVE (14005) « sauvegarder », LS_CANCEL (14008) et Échap annulent. Bouton par défaut : Sauvegarder si le
 *   Labo a été modifié (`[0x477950]`), sinon Charger.
 * - **DOSBOX** (41aeaa, préparation 41b078, liste 41bf29 et 41bd7f) :
 *   - titre DR_BIN_TITLE : « Puzzles Personnels » (31054, catégorie 6) ; le bac (DR_BIN), l'aide et « Avancé » sont cachés ;
 *   - liste : une rangée par emplacement (« %2d. » puis le nom), rangée choisie en 14 (`render/itf-list.ts`, option `list` de la
 *     fenêtre) ; un clic choisit (son 0xE1B), un second clic sur la rangée choisie valide (41bd7f rend 3) ; ▲ / ▼ font défiler d'une
 *     rangée (supposé) ; au clavier, une `listbox` ;
 *   - sauvegarde (`[0x47e314]` = 1) : DR_LOAD devient « Sauvegarder » (31041), DR_TITLE est une saisie de 29 caractères (texte dessiné
 *     dans le cadre de la valeur 4, `<input>` transparent par-dessus), préremplie avec le dernier nom ; choisir une rangée pleine y
 *     copie son nom ; la liste s'arrête au-dessus de DR_TITLE ;
 *   - chargement : DR_TITLE et son libellé sont cachés ; DR_LOAD (« Lancer ») est grisé sur un emplacement vide.
 */
import { readItf, type Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { ITF_DEFAULT_FONT, drawTextBox, itfText } from "../render/itf-draw";
import { ScrollList, type ListRow } from "../render/itf-list";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost } from "./itf-window";

export const LOADSAVE = { load: 14007, save: 14005, cancel: 14008 } as const;
export const DOSBOX = {
  bin: 13028,
  binTitle: 13027,
  help: 13026,
  advanced: 13024,
  load: 13023,
  titleLabel: 13020,
  title: 13019,
  up: 13013,
  down: 13012,
  list: 13004,
  cancel: 13002,
} as const;
/** Textes du jeu : « Puzzles Personnels », « Sauvegarder ». */
const TEXT = { personal: 31054, save: 31041 } as const;
/** Longueur de la saisie du titre (41b078 : 29 caractères). */
export const TITLE_MAX = 29;

export type LoadSaveChoice = "load" | "save";

export function loadSaveWindow(itf: Itf, o: { modified: boolean; choose(c: LoadSaveChoice): void }): { itf: Itf; options: ItfWindowOptions } {
  return {
    itf,
    options: {
      title: copy.machinesTitle,
      defaultId: o.modified ? LOADSAVE.save : LOADSAVE.load,
      cancelId: LOADSAVE.cancel,
      // Infobulles du jeu : « Sauve- garder » (coupé), « Lancer un Puzzle » (ici, une machine).
      labels: { [LOADSAVE.load]: copy.machineLoad, [LOADSAVE.save]: copy.machineSave },
      choose: (id) => {
        if (id === LOADSAVE.load) o.choose("load");
        else if (id === LOADSAVE.save) o.choose("save");
        return false;
      },
    },
  };
}

export function openLoadSaveWindow(host: ItfHost, o: { modified: boolean; choose(c: LoadSaveChoice): void; onClose?(): void }): ItfWindowHandle {
  const w = loadSaveWindow(readItf(host.assets.index.get("LOADSAVE.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}

export interface MachineSlot {
  slot: number;
  /** Nom, `null` pour un emplacement vide. */
  name: string | null;
}

export interface MachineListOptions {
  mode: LoadSaveChoice;
  slots(): MachineSlot[];
  /** Nom proposé à la sauvegarde. */
  name: string;
  /** Valider (Lancer / Sauvegarder, ou second clic sur la rangée). La fenêtre reste ouverte : l'appelant la ferme s'il y a lieu. */
  validate(slot: number, name: string): void;
  /** Son du clic sur une rangée. */
  click?(): void;
}

/** Texte d'une rangée (41bb9d : « %2d. » puis le titre). */
export function machineRowText(s: MachineSlot): string {
  return `${String(s.slot).padStart(2, " ")}. ${s.name ?? `(${copy.machineEmpty})`}`;
}

export function machineListWindow(assets: RenderAssets, itf: Itf, o: MachineListOptions): { itf: Itf; options: ItfWindowOptions; selected(): number; name(): string } {
  const save = o.mode === "save";
  const list = itf.controls.find((c) => c.id === DOSBOX.list)!;
  const titleField = itf.controls.find((c) => c.id === DOSBOX.title);
  // En sauvegarde, la liste s'arrête au-dessus de DR_TITLE.
  const view = new ScrollList(assets.font(ITF_DEFAULT_FONT), { x: list.x, y: list.y, width: list.width, height: save && titleField ? titleField.y - list.y - 2 : list.height });
  const font = view.font;
  const current = (): MachineSlot[] => o.slots();
  const rows = (): ListRow[] => current().map((s) => ({ text: machineRowText(s), solved: false }));
  const slots = current();
  view.reset(rows(), save ? Math.max(0, slots.findIndex((s) => s.name === null)) : Math.max(0, slots.findIndex((s) => s.name !== null)));
  let name = o.name.slice(0, TITLE_MAX);

  const texts: Record<number, string> = { [DOSBOX.binTitle]: itfText(assets, TEXT.personal), [DOSBOX.title]: "" };
  if (save) texts[DOSBOX.load] = itfText(assets, TEXT.save);
  const state: NonNullable<ItfWindowOptions["state"]> = {
    hidden: [DOSBOX.bin, DOSBOX.help, DOSBOX.advanced, ...(save ? [] : [DOSBOX.title, DOSBOX.titleLabel])],
    texts,
    draw: {
      [DOSBOX.title]: (surface: Surface, r: Rect) => {
        if (font) drawTextBox(surface, font, name, { x: r.x + 6, y: r.y, width: r.width - 12, height: r.height }, { mode: 0, color: 15, flags: 0x200, font: ITF_DEFAULT_FONT });
      },
    },
  };
  const refreshState = (): void => {
    view.rows = rows();
    const empty = current()[view.selected]?.name === null;
    state.disabled = !save && empty ? [DOSBOX.load] : [];
  };
  refreshState();
  const input = save
    ? {
        id: DOSBOX.title,
        label: copy.machineName,
        value: name,
        maxLength: TITLE_MAX,
        input: (v: string) => {
          name = v.slice(0, TITLE_MAX);
          input!.value = name;
        },
      }
    : undefined;
  const slotLabel = (s: MachineSlot): string => `${copy.machineSlot(s.slot)}, ${s.name ?? copy.machineEmpty}`;
  /** Rangée choisie ; en sauvegarde, une rangée pleine copie son nom dans le champ. */
  const select = (i: number): void => {
    if (!view.select(i)) return;
    const s = current()[i]!;
    if (save && s.name !== null) {
      name = s.name.slice(0, TITLE_MAX);
      if (input) input.value = name;
    }
    refreshState();
  };
  const validate = (): void => {
    const s = current()[view.selected];
    if (!s || (!save && s.name === null)) return;
    o.validate(s.slot, name);
  };
  return {
    itf,
    selected: () => current()[view.selected]?.slot ?? 1,
    name: () => name,
    options: {
      title: save ? copy.machinesSaveTitle : copy.machinesLoadTitle,
      state,
      defaultId: DOSBOX.load,
      cancelId: DOSBOX.cancel,
      labels: { [DOSBOX.up]: copy.scrollUp, [DOSBOX.down]: copy.scrollDown },
      list: {
        id: DOSBOX.list,
        view,
        label: (i) => slotLabel(current()[i]!),
        select,
        // Un clic choisit la rangée (son du jeu) ; un second clic sur la rangée choisie valide (41bd7f rend 3).
        click: (i) => {
          o.click?.();
          if (i === view.selected) return DOSBOX.load;
          select(i);
          return undefined;
        },
      },
      ...(input ? { input } : {}),
      status: () => {
        const s = current()[view.selected];
        return s ? slotLabel(s) : "";
      },
      choose: (id) => {
        if (id === DOSBOX.up) view.scrollBy(-1);
        else if (id === DOSBOX.down) view.scrollBy(1);
        else if (id === DOSBOX.load) validate();
        else return false;
        refreshState();
        return true;
      },
    },
  };
}

export function openMachineListWindow(host: ItfHost, o: MachineListOptions & { onClose?(): void }): ItfWindowHandle {
  const w = machineListWindow(host.assets, readItf(host.assets.index.get("DOSBOX.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}
