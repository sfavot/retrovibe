/**
 * Règles de saisie des noms de joueur dans la police du moniteur (`NCSCLB10.FON`).
 *
 * Les polices `.FON` du jeu sont en Mac Roman (voir `graphics/text.ts`, `encodeText` fait la conversion Latin-1 → glyphe au dessin) : le
 * roster stocke un octet par lettre Latin-1 et le moniteur n'accepte que les lettres dont la police a le glyphe (pas `Ð ð Þ þ Ý ý`,
 * absents du Mac Roman).
 */
import { encodeText } from "../../engine/graphics/text";
import type { NameRules } from "../../engine/roster";

const isAsciiLetter = (c: string): boolean => /^[A-Za-z]$/.test(c);

/** Lettre accentuée Latin-1 (`À`–`ÿ` sauf `×` et `÷`) dont la police a le glyphe. */
const hasGlyph = (c: string): boolean => /^[\u00c0-\u00ff]$/.test(c) && c !== "\u00d7" && c !== "\u00f7" && encodeText(c)[0] !== 0x3f;

/** Règles de nom du moniteur : lettres ASCII et lettres accentuées Latin-1 que la police sait dessiner (sous-ensemble de `LATIN1_NAME_RULES`). */
export const MONITOR_NAME_RULES: NameRules = {
  isLetter: (c) => isAsciiLetter(c) || hasGlyph(c),
};
