/**
 * Textes `.SCR` des briefings (docs/swiv3d/screens.md §6). Une ligne : `table id première dernière x y style alignement`.
 * Les textes sont redessinés à chaque image de la vidéo (numérotée à partir de 1), par-dessus l'image décodée.
 */
import type { StringTables } from "../data/strings";
import { parseScr } from "../data/scr";
import { BRIEFING_TEXT_MAX_WIDTH, type TextAlign, type TextRenderer, type TextStyle } from "../ui-draw/text";

/** Table des noms de missions : son numéro de chaîne est remplacé par la mission courante. */
export const MISSION_NAME_TABLE = 200;

export interface BriefingText {
  /** Groupe de chaînes. */
  table: number;
  /** Numéro de chaîne (ignoré pour la table 200 : mission courante). */
  id: number;
  /** Première et dernière image où le texte est visible (incluses, numérotées à partir de 1). */
  firstFrame: number;
  lastFrame: number;
  x: number;
  y: number;
  style: TextStyle;
  align: TextAlign;
}

/** `b` -> blanc, toute autre lettre -> gris ; `l` -> gauche, `c` -> centré, toute autre lettre -> droite (§6). */
export function parseBriefing(bytes: Uint8Array): BriefingText[] {
  return parseScr(bytes).map(({ values: [table, id, firstFrame, lastFrame, x, y], codes: [style, align] }) => ({
    table,
    id,
    firstFrame,
    lastFrame,
    x,
    y,
    style: style.toLowerCase() === "b" ? "b" : "g",
    align: align.toLowerCase() === "l" ? "l" : align.toLowerCase() === "c" ? "c" : "r",
  }));
}

/** Textes visibles à l'image `frame` (numérotée à partir de 1). */
export function visibleTexts(texts: readonly BriefingText[], frame: number): BriefingText[] {
  return texts.filter((t) => frame >= t.firstFrame && frame <= t.lastFrame);
}

/** Texte d'un élément : la table 200 donne le nom de la mission courante ; chaîne absente -> vide. */
export function briefingString(strings: StringTables, language: number, text: BriefingText, mission: number): string {
  const id = text.table === MISSION_NAME_TABLE ? mission : text.id;
  return strings.get(language, text.table, id) ?? "";
}

/** Trace les textes de l'image `frame` dans `fb` (déjà remplie par l'image de la vidéo). */
export function drawBriefing(
  fb: Uint8Array,
  renderer: TextRenderer,
  strings: StringTables,
  language: number,
  texts: readonly BriefingText[],
  frame: number,
  mission: number,
): void {
  for (const t of visibleTexts(texts, frame)) {
    const text = renderer.truncate(briefingString(strings, language, t, mission), BRIEFING_TEXT_MAX_WIDTH);
    renderer.draw(fb, text, t.x, t.y, t.align, t.style);
  }
}
