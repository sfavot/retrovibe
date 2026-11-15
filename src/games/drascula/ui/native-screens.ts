import type { SlotSummary } from "../../../engine/save-slots";
import type { ChooseResult } from "../../../ui/point-click-dialogs";

/**
 * Parties pures des écrans d'origine du volume et des sauvegardes (`native-dialogs.ts`) : géométrie lue dans ScummVM
 * (`volumeControls`, sound.cpp ; `saveLoadScreen`, saveload.cpp) et dans les images (`95.ALG`, `SAVESCR.ALG`), passage des crans
 * du jeu (0 à 15) aux pourcentages enregistrés, texte écrit avec la police du jeu, et déroulé de l'écran des sauvegardes.
 */

/** Rectangle en pixels de l'écran 320 x 200. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SCREEN_W = 320;
const SCREEN_H = 200;

/** Position CSS d'un rectangle de l'écran, en pourcentages de 320 x 200 : la couche suit l'échelle du canvas. */
export function percentRect(rect: Rect): { left: string; top: string; width: string; height: string } {
  const pct = (value: number, of: number): string => `${+((value / of) * 100).toFixed(4)}%`;
  return { left: pct(rect.x, SCREEN_W), top: pct(rect.y, SCREEN_H), width: pct(rect.width, SCREEN_W), height: pct(rect.height, SCREEN_H) };
}

// --- Volume -------------------------------------------------------------------------------------------------------------------

/** Cran maximal d'un réglage (`masterVolume`, `voiceVolume`, `musicVolume` de 0 à 15). */
export const LEVEL_MAX = 15;

/** Cran (0 à 15) d'un volume enregistré en pourcentage (0 à 100). */
export function percentToLevel(percent: number): number {
  if (!Number.isFinite(percent)) return LEVEL_MAX;
  return Math.min(Math.max(Math.round((percent * LEVEL_MAX) / 100), 0), LEVEL_MAX);
}

/** Pourcentage enregistré (0 à 100) d'un cran. */
export function levelToPercent(level: number): number {
  return Math.round((Math.min(Math.max(level, 0), LEVEL_MAX) * 100) / LEVEL_MAX);
}

/** Panneau du volume : `copyRect(1, 56, 73, 63, 177, 97, tableSurface, screenSurface)` (feuille `95.ALG`). */
export const VOLUME_PANEL = { sheetX: 1, sheetY: 56, x: 73, y: 63, width: 177, height: 97 } as const;
/** Barre pleine : `copyBackground(183, 56, x, y, 39, 2 + volume * 4)`, même feuille. */
export const VOLUME_BAR = { sheetX: 183, sheetY: 56, width: 39 } as const;

export type VolumeKind = "master" | "voice" | "music";

/** Les trois puits noirs du panneau (lus dans `95.ALG`) et l'abscisse de leur barre, dans l'ordre de l'image. */
export const VOLUME_WELLS: readonly { kind: VolumeKind; well: Rect; barX: number }[] = [
  { kind: "master", well: { x: 81, y: 71, width: 41, height: 65 }, barX: 82 },
  { kind: "voice", well: { x: 137, y: 71, width: 41, height: 65 }, barX: 138 },
  { kind: "music", well: { x: 193, y: 71, width: 41, height: 65 }, barX: 194 },
];

/** Barre d'un réglage : `y = 72 + 61 - volume * 4`, hauteur `2 + volume * 4` ; elle monte depuis le bas du puits (ligne 135). */
export function barRect(barX: number, level: number): Rect {
  return { x: barX, y: 133 - level * 4, width: VOLUME_BAR.width, height: 2 + level * 4 };
}

/** Cran que désigne un point du puits (ordonnée de l'écran) : le haut de la barre suit le doigt ou la souris. */
export function levelAtY(y: number): number {
  return Math.min(Math.max(Math.round((133 - y) / 4), 0), LEVEL_MAX);
}

/** Volume réellement appliqué (0 à 1) : le réglage multiplié par le volume général, comme `(master + 1) * (volume + 1) - 1` de ScummVM. */
export function mixedVolume(master: number, level: number): number {
  return Math.min(Math.max(master, 0), 1) * Math.min(Math.max(level, 0), 1);
}

// --- Écran des sauvegardes ---------------------------------------------------------------------------------------------------

/** Cadre du nom (`print_abc(selectedName, 117, 15)`) et cadre de la liste, lus dans `SAVESCR.ALG`. */
export const SAVE_SCREEN = {
  nameText: { x: 117, y: 15 },
  /** Cadre de la liste : les lignes `print_abc(name, 116, 27 + 9 n)` et leur zone de clic (x 115 à 290). */
  list: { x: 114, y: 26, width: 180, height: 90 },
  /** Abscisse du texte d'une ligne dans la liste (116 - 114). */
  rowTextX: 2,
  /** Hauteur d'une ligne d'origine (`27 + 9 n`). */
  rowHeight: 9,
  /** Nombre de glyphes (8 pixels) qui tiennent dans le cadre du nom et dans une ligne. */
  nameGlyphs: 22,
  rowGlyphs: 21,
  load: { x: 125, y: 123, width: 74, height: 26 },
  save: { x: 208, y: 123, width: 74, height: 26 },
  play: { x: 168, y: 154, width: 74, height: 26 },
} as const;

/** Hauteur d'un glyphe de la police (`GLYPH.height`). */
const GLYPH_HEIGHT = 6;

/**
 * Hauteur d'une ligne de la liste, en pixels du jeu. À la souris, celle d'origine (9). Au doigt, une ligne doit faire au moins 36 px à
 * l'écran : elle grandit jusqu'à 18 pixels du jeu (cinq lignes visibles, qui remplissent exactement le cadre de 90 pixels ; la liste
 * défile dans le cadre). `scale` : pixels CSS par pixel du jeu.
 */
export function slotRowHeight(scale: number, coarse: boolean): number {
  if (!coarse || !(scale > 0)) return SAVE_SCREEN.rowHeight;
  return Math.min(Math.max(Math.ceil(36 / scale), SAVE_SCREEN.rowHeight), 18);
}

/** Ordonnée du texte dans une ligne de hauteur `rowHeight` : 1 pixel sous le haut à 9 (comme l'original), centré au-delà. */
export function rowTextY(rowHeight: number): number {
  return Math.max(1, Math.floor((rowHeight - GLYPH_HEIGHT) / 2));
}

/**
 * Texte écrivable avec la police du jeu : tirets longs ramenés à `-`, caractère sans glyphe remplacé par sa lettre sans accent (ou
 * une espace), coupé à `max` glyphes. `supports` : la police a-t-elle ce caractère (`print_abc` répéterait sinon le glyphe précédent).
 */
export function fitGameText(text: string, supports: (char: string) => boolean, max: number): string {
  let out = "";
  for (const raw of text.replace(/[–—]/g, "-")) {
    let char = raw;
    if (!supports(char)) {
      const bare = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
      char = bare.length === 1 && supports(bare) ? bare : " ";
    }
    out += char;
  }
  return [...out].slice(0, max).join("").trimEnd();
}

/** Date courte d'une sauvegarde (`15/11/26 14:30`), à l'heure locale. */
export function shortDate(savedAt: number): string {
  const date = new Date(savedAt);
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${two(date.getFullYear() % 100)} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Message du cadre du nom (écrit avec la police du jeu ; le texte complet va à la zone lue par les lecteurs d'écran). */
export type SlotScreenMessage = "confirm" | "cannotSave" | "empty" | "busy" | "saveFailed" | "loadFailed";

/** Ce que l'écran doit faire après un appui. */
export type SlotCommand = { type: "none" } | { type: "save"; slot: number } | { type: "load"; slot: number };

/**
 * Déroulé de l'écran des sauvegardes : un seul écran pour F10 et F7, comme l'original. Un emplacement est toujours choisi (la sélection
 * suit le focus de la liste) ; « Save » sur un emplacement plein demande d'abord confirmation (second appui), « Load » sur un vide
 * ne fait rien d'autre que le dire, « Save » est refusé quand le jeu ne peut pas sauvegarder (séquence en cours). Pendant un
 * chargement (vidéos du chapitre à télécharger), plus rien ne répond.
 */
export class SlotScreen {
  selected: number;
  confirming = false;
  message: SlotScreenMessage | null = null;
  /** Texte complet du dernier échec (`ChooseResult.message`), pour la zone lue. */
  detail: string | null = null;
  busy = false;
  private summaries: SlotSummary[];

  constructor(
    summaries: SlotSummary[],
    readonly intent: "save" | "load",
    readonly canSave: boolean,
  ) {
    this.summaries = summaries;
    this.selected = SlotScreen.initialSlot(summaries, intent);
    if (intent === "save" && !canSave) this.message = "cannotSave";
  }

  /** Premier choix : sauvegarder vise le premier emplacement vide, charger la sauvegarde la plus récente ; sinon le premier. */
  static initialSlot(summaries: readonly SlotSummary[], intent: "save" | "load"): number {
    const first = summaries[0]?.slot ?? 1;
    if (intent === "save") return summaries.find((summary) => summary.empty)?.slot ?? first;
    let best: SlotSummary | undefined;
    for (const summary of summaries) if (!summary.empty && (best === undefined || (summary.savedAt ?? 0) > (best.savedAt ?? 0))) best = summary;
    return best?.slot ?? first;
  }

  get slots(): readonly SlotSummary[] {
    return this.summaries;
  }

  summary(slot = this.selected): SlotSummary | undefined {
    return this.summaries.find((summary) => summary.slot === slot);
  }

  get saveEnabled(): boolean {
    return this.canSave && !this.busy;
  }

  get loadEnabled(): boolean {
    return !this.busy && this.summary()?.empty === false;
  }

  select(slot: number): void {
    if (this.busy || !this.summary(slot)) return;
    if (slot !== this.selected) {
      this.selected = slot;
      this.confirming = false;
      this.message = null;
      this.detail = null;
    }
  }

  /** Emplacement voisin (flèches, début, fin de la liste). */
  move(to: "previous" | "next" | "first" | "last"): void {
    const index = this.summaries.findIndex((summary) => summary.slot === this.selected);
    const last = this.summaries.length - 1;
    const target = to === "first" ? 0 : to === "last" ? last : Math.min(Math.max(index + (to === "next" ? 1 : -1), 0), last);
    const summary = this.summaries[target];
    if (summary) this.select(summary.slot);
  }

  pressSave(): SlotCommand {
    if (this.busy) return { type: "none" };
    if (!this.canSave) {
      this.message = "cannotSave";
      return { type: "none" };
    }
    if (this.summary()?.empty === false && !this.confirming) {
      this.confirming = true;
      this.message = "confirm";
      return { type: "none" };
    }
    this.confirming = false;
    this.message = null;
    return { type: "save", slot: this.selected };
  }

  pressLoad(): SlotCommand {
    if (this.busy) return { type: "none" };
    this.confirming = false;
    if (this.summary()?.empty !== false) {
      this.message = "empty";
      return { type: "none" };
    }
    this.message = null;
    return { type: "load", slot: this.selected };
  }

  /** Entrée sur la liste : l'action pour laquelle l'écran a été ouvert. */
  activate(): SlotCommand {
    return this.intent === "save" ? this.pressSave() : this.pressLoad();
  }

  /** Début d'un chargement qui attend (vidéos du chapitre). */
  startBusy(): void {
    this.busy = true;
    this.message = "busy";
  }

  /** Résultat d'une sauvegarde ou d'un chargement resté dans l'écran (`ok` : la page ferme l'écran). */
  finish(kind: "save" | "load", result: ChooseResult, summaries: SlotSummary[]): void {
    this.busy = false;
    this.summaries = summaries;
    this.confirming = false;
    if (result.ok) {
      this.message = null;
      this.detail = null;
    } else {
      this.message = kind === "save" ? "saveFailed" : "loadFailed";
      this.detail = result.message;
    }
  }
}
