/**
 * Choix du puzzle, écrans de `ui/itf-window.ts`, comme TIMWIN.EXE (`docs/tim3/ui.md` § Parcours d'entrée) :
 *
 * - **`DOSBOX.ITF`** d'abord (41acf0, mode « charger ») : la liste des puzzles de la catégorie du puzzle en cours (41b75b), chaque
 *   rangée « %2d. Titre » marquée résolue ou non par une image de `BUTTONS.ANM` (`render/itf-list.ts`). Un clic choisit la rangée
 *   (son 0xE1B), un double clic ou « Lancer » charge le puzzle, « Annuler » ferme. Flèches (44ee9d) : une rangée. « Autres Puzzles »
 *   (`DR_BIN`) ouvre `DOSBIN` puis revient à la liste de la catégorie choisie (41ae39). « Avancé » (sélecteur de fichiers Windows,
 *   42a088) n'est pas porté : grisé. Le titre et son champ (`DR_TITLE`) ne servent qu'à « enregistrer » : cachés (41b10f).
 * - **`DOSBIN.ITF`** (41b649) : les bacs, dont Deux joueurs (puzzles HH, catégorie 5 : en Jeu, ils se jouent seul ; en mode à deux
 *   joueurs, le puzzle choisi devient la partie suivante, comme 41acf0 en mode 2). Maison (`DB_USER`, « Puzzles Personnels ») : le
 *   jeu y lit les fichiers LEV du répertoire des puzzles personnels ; le port, les machines du Labo qui ont un but (catégorie 6,
 *   `homePuzzleRef`), rangées par emplacement. Le bac de la catégorie en cours a le focus ; « Annuler » revient à la liste sans changer
 *   de catégorie.
 * - **`PUZZDISP.ITF`** (425d20) avant de jouer : catégorie (`PD_BIN`, texte 31048 + catégorie), « Puzzle no N » (`PD_NUMBER`,
 *   format « %Fs %d » de 2064, aucun pour un puzzle maison), titre (`PD_TITLE`), icône de la catégorie (seule montrée parmi 34005 à
 *   34011), « OK ».
 *
 * Accès dans le jeu : la disquette en mode Jeu ouvre `DOSBOX` (418f2c : chargement seulement), ainsi que « Fichier > Ouvrir » du
 * menu Windows ; le menu principal y revient par « Zones > Menu principal ».
 */
import type { Font } from "../data/font";
import type { Itf } from "../data/itf";
import { HOME_CATEGORY, type Progress, type PuzzleRef } from "../engine/session";
import type { RenderAssets } from "../render/assets";
import type { FrameSound } from "../render/front";
import { ITF_DEFAULT_FONT, drawTextBox, itfText } from "../render/itf-draw";
import { ScrollList } from "../render/itf-list";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import type { ItfScreen, ItfWindow, ItfWindowOptions } from "./itf-window";

// ------------------------------------------------------------------ puzzle en cours

/**
 * 42cbad(−1) : le puzzle à ouvrir depuis le menu principal. À partir du dernier puzzle joué, le premier non résolu de sa catégorie
 * (jusqu'à la fin, puis depuis le début de la catégorie) ; si toute la catégorie est résolue, le premier non résolu du jeu ; sinon
 * le dernier puzzle joué (le premier puzzle sans partie).
 */
export function currentPuzzle(puzzles: readonly PuzzleRef[], progress: Pick<Progress, "isSolved" | "last">): PuzzleRef {
  const last = puzzles.find((p) => p.name === progress.last) ?? puzzles[0]!;
  const inCategory = puzzles.filter((p) => p.category === last.category);
  const from = inCategory.indexOf(last);
  const ordered = [...inCategory.slice(from), ...inCategory.slice(0, from)];
  return ordered.find((p) => !progress.isSolved(p.name)) ?? puzzles.find((p) => !progress.isSolved(p.name)) ?? last;
}

/** Texte de `INTRFACE.RES` : catégorie (31048 + catégorie, 425e58 et 41b0e7), « Puzzle no » (31064). */
export const CHOOSER_TEXT = { category: 31048, number: 31064 } as const;

// ------------------------------------------------------------------ DOSBOX

export const DOSBOX = {
  bins: 13028,
  categoryTitle: 13027,
  help: 13026,
  advanced: 13024,
  load: 13023,
  titleLabel: 13020,
  titleField: 13019,
  up: 13013,
  down: 13012,
  list: 13004,
  cancel: 13002,
} as const;

/** Double clic sur une rangée : deux clics sur la même rangée en moins de ce délai (choix du port, comme Windows). */
export const DOUBLE_CLICK_MS = 500;
/** Son d'une rangée choisie (41bdd4 : 0xE1B). */
export const LIST_SOUND = 0xe1b;

export type ListResult = { kind: "load"; puzzle: PuzzleRef } | { kind: "bins" } | { kind: "help" } | { kind: "unavailable" } | { kind: "cancel" };

export interface ChooserTexts {
  /** Titre de la liste pour les lecteurs d'écran. */
  title: string;
  /** Titre du puzzle (`LEVELS.INF`). */
  puzzleTitle(puzzle: PuzzleRef): string;
  /** Mot « résolu » des rangées pour les lecteurs d'écran. */
  solved: string;
}

/** Liste des puzzles d'une catégorie ; son état (catégorie, rangée choisie, défilement) est gardé d'une ouverture à l'autre. */
export class PuzzleListScreen implements ItfScreen<ListResult> {
  readonly options: Omit<ItfWindowOptions, "choose" | "onClose">;
  readonly view: ScrollList;
  private puzzles: PuzzleRef[] = [];
  private lastClick = { row: -1, at: -Infinity };
  private readonly texts: Record<number, string> = {};

  constructor(
    private readonly assets: RenderAssets,
    readonly itf: Itf,
    private readonly all: readonly PuzzleRef[],
    private readonly progress: Pick<Progress, "isSolved">,
    private readonly strings: ChooserTexts,
    public category: number,
    current: PuzzleRef | null,
    private readonly onSound?: (sound: FrameSound) => void,
  ) {
    const list = itf.controls.find((c) => c.id === DOSBOX.list)!;
    this.view = new ScrollList(assets.font(ITF_DEFAULT_FONT), { x: list.x, y: list.y, width: list.width, height: list.height }, assets.anm("BUTTONS.ANM"));
    this.options = {
      title: "",
      state: { hidden: [DOSBOX.titleLabel, DOSBOX.titleField], disabled: [DOSBOX.advanced], texts: this.texts },
      defaultId: DOSBOX.load,
      cancelId: DOSBOX.cancel,
      greyedActive: true,
      // DESCRIPT.RES donne aux deux flèches le même nom (« Faire Défiler »).
      labels: { [DOSBOX.up]: copy.scrollUp, [DOSBOX.down]: copy.scrollDown },
      list: {
        id: DOSBOX.list,
        view: this.view,
        label: (i) => this.rowLabel(i),
        select: (i) => this.select(i),
        click: (i, now) => this.click(i, now),
      },
      status: () => this.rowLabel(this.view.selected),
    };
    this.setCategory(category, current);
  }

  /** Catégorie affichée ; rangée choisie : `current` s'il en fait partie, sinon le premier non résolu, sinon la première. */
  setCategory(category: number, current: PuzzleRef | null): void {
    this.category = category;
    this.puzzles = this.all.filter((p) => p.category === category);
    const rows = this.puzzles.map((p) => ({ text: `${String(p.number).padStart(2, " ")}. ${this.strings.puzzleTitle(p)}`, solved: this.progress.isSolved(p.name) }));
    const at = current ? this.puzzles.findIndex((p) => p.name === current.name) : -1;
    const unsolved = this.puzzles.findIndex((p) => !this.progress.isSolved(p.name));
    this.view.reset(rows, at >= 0 ? at : Math.max(0, unsolved));
    const name = itfText(this.assets, CHOOSER_TEXT.category + category);
    this.texts[DOSBOX.categoryTitle] = name;
    this.options.title = `${this.strings.title} : ${name}`;
  }

  selectedPuzzle(): PuzzleRef | null {
    return this.puzzles[this.view.selected] ?? null;
  }

  action(id: number): ListResult | undefined {
    switch (id) {
      case DOSBOX.load: {
        const p = this.selectedPuzzle();
        return p ? { kind: "load", puzzle: p } : undefined;
      }
      case DOSBOX.cancel:
        return { kind: "cancel" };
      case DOSBOX.bins:
        return { kind: "bins" };
      case DOSBOX.help:
        return { kind: "help" };
      case DOSBOX.advanced:
        return { kind: "unavailable" };
      case DOSBOX.up:
        this.view.scrollBy(-1);
        return undefined;
      case DOSBOX.down:
        this.view.scrollBy(1);
        return undefined;
      default:
        return undefined;
    }
  }

  /** Nom d'une rangée pour les lecteurs d'écran. */
  rowLabel(index: number): string {
    const r = this.view.rows[index];
    return r ? (r.solved ? `${r.text}, ${this.strings.solved}` : r.text) : "";
  }

  /** Choisit une rangée (son 0xE1B si elle change) et la rend visible. */
  select(index: number): void {
    const before = this.view.selected;
    if (this.view.select(index) && index !== before) this.onSound?.({ id: LIST_SOUND, priority: 1, flags: 0 });
  }

  /** Clic sur une rangée : la choisit ; un second clic rapide sur la rangée choisie charge le puzzle. */
  private click(row: number, now: number): number | undefined {
    const double = row === this.lastClick.row && row === this.view.selected && now - this.lastClick.at <= DOUBLE_CLICK_MS;
    this.lastClick = { row, at: now };
    this.select(row);
    if (!double) return undefined;
    this.lastClick = { row: -1, at: -Infinity };
    return DOSBOX.load;
  }
}

// ------------------------------------------------------------------ DOSBIN

export const DOSBIN = {
  user: 26019,
  duel: 26018,
  tutorial: 26017,
  reallyHard: 26016,
  hard: 26015,
  medium: 26014,
  easy: 26013,
  help: 26011,
  cancel: 26010,
} as const;

/** Bac de chaque catégorie (table 0x4726d4) : 0 travaux pratiques … 4 très difficiles, 5 deux joueurs, 6 maison. */
export const BIN_OF_CATEGORY: readonly number[] = [DOSBIN.tutorial, DOSBIN.easy, DOSBIN.medium, DOSBIN.hard, DOSBIN.reallyHard, DOSBIN.duel, DOSBIN.user];
/** Bacs non portés (aucun depuis le mode à deux joueurs). */
export const BIN_GREYED: readonly number[] = [];

export type BinResult = { kind: "category"; category: number } | { kind: "help" } | { kind: "unavailable" } | { kind: "cancel" };

export class BinScreen implements ItfScreen<BinResult> {
  readonly options: Omit<ItfWindowOptions, "choose" | "onClose">;

  constructor(
    readonly itf: Itf,
    heading: string,
    category: number,
    onSound?: (sound: FrameSound) => void,
  ) {
    this.options = {
      title: heading,
      state: { disabled: BIN_GREYED },
      defaultId: BIN_OF_CATEGORY[category] ?? DOSBIN.cancel,
      cancelId: DOSBIN.cancel,
      greyedActive: true,
      hoverAnimate: { ids: BIN_OF_CATEGORY, ...(onSound ? { sound: onSound } : {}) },
    };
  }

  action(id: number): BinResult | undefined {
    if (id === DOSBIN.cancel) return { kind: "cancel" };
    if (id === DOSBIN.help) return { kind: "help" };
    if (BIN_GREYED.includes(id)) return { kind: "unavailable" };
    const category = BIN_OF_CATEGORY.indexOf(id);
    return category >= 0 ? { kind: "category", category } : undefined;
  }
}

// ------------------------------------------------------------------ PUZZDISP

export const PUZZDISP = {
  home: 34011,
  duel: 34010,
  reallyHard: 34009,
  hard: 34008,
  medium: 34007,
  easy: 34006,
  tutorial: 34005,
  done: 34004,
  title: 34003,
  number: 34002,
  category: 34001,
} as const;

/** Textes de la fiche (425fa5) : « Puzzle no N » en (x, y + 4), couleur 5 ; titre en (x + 6, y + 4, l − 9, h − 6), couleur 15 ; 0x1302. */
const CARD_FLAGS = 0x1302;

/** Passes de la fiche avant la voix du but (425f1b : `[0x472ef0]` = 18, décompté à chaque message de la fenêtre, 425f51). */
export const CARD_GOAL_VOICE_PASSES = 18;

export class PuzzleCardScreen implements ItfScreen<"ok"> {
  readonly options: Omit<ItfWindowOptions, "choose" | "onClose">;
  private readonly font: Font | null;

  constructor(
    private readonly assets: RenderAssets,
    readonly itf: Itf,
    private readonly puzzle: PuzzleRef,
    private readonly puzzleTitle: string,
    /**
     * Voix du but, lancée `CARD_GOAL_VOICE_PASSES` passes après l'ouverture, **pendant** que la fiche est montrée (425f6b → 424684) ; la
     * fermeture la coupe (425d6f, à l'appelant). Absente : puzzle maison, voix sans objet.
     */
    goalVoice?: () => void,
  ) {
    this.font = assets.font(ITF_DEFAULT_FONT);
    let voiceIn = goalVoice ? CARD_GOAL_VOICE_PASSES : -1;
    // Icône de la catégorie seule (425e96 cache 34005 à 34011, 425eaf montre 34005 + catégorie).
    const icons = [PUZZDISP.tutorial, PUZZDISP.easy, PUZZDISP.medium, PUZZDISP.hard, PUZZDISP.reallyHard, PUZZDISP.duel, PUZZDISP.home];
    this.options = {
      title: this.categoryText(),
      state: { hidden: icons.filter((id) => id !== PUZZDISP.tutorial + puzzle.category), texts: { [PUZZDISP.category]: this.categoryText() } },
      defaultId: PUZZDISP.done,
      cancelId: PUZZDISP.done,
      texts: () => [this.numberText(), this.puzzleTitle],
      decorate: (surface, win) => this.decorate(surface, win),
      tick: () => {
        if (voiceIn > 0 && --voiceIn === 0) goalVoice?.();
        return false;
      },
    };
  }

  categoryText(): string {
    return itfText(this.assets, CHOOSER_TEXT.category + this.puzzle.category);
  }

  /** « Puzzle no N » ; rien pour un puzzle maison (425fee : `[0x477990]` = 6). */
  numberText(): string {
    return this.puzzle.category === HOME_CATEGORY ? "" : `${itfText(this.assets, CHOOSER_TEXT.number)} ${this.puzzle.number}`;
  }

  action(id: number): "ok" | undefined {
    return id === PUZZDISP.done ? "ok" : undefined;
  }

  private decorate(surface: Surface, win: ItfWindow): void {
    if (!this.font) return;
    const n = win.rect(PUZZDISP.number);
    const t = win.rect(PUZZDISP.title);
    const style = (color: number) => ({ mode: 0, color, flags: CARD_FLAGS, font: ITF_DEFAULT_FONT });
    if (n) drawTextBox(surface, this.font, this.numberText(), { x: n.x, y: n.y + 4, width: n.width, height: n.height }, style(5));
    if (t) drawTextBox(surface, this.font, this.puzzleTitle, { x: t.x + 6, y: t.y + 4, width: t.width - 9, height: t.height - 6 }, style(15));
  }
}
