/**
 * Données et mise en page du certificat (`1088:0120` → `1088:0a9f`, `docs/mathemagique/certificate.md`). Pur : aucun accès au DOM.
 *
 * Contenu d'un certificat : le titre de l'opération, le nom du joueur, deux légendes fixes, le rang global (`STRL 5000` de `TROPHY.DAT`)
 * et, pour chaque niveau réussi de l'opération (bits 0 à 4 du quintet `masque >> 5 × opération`), le ruban `RIB1` à `RIB4` ou `RIBB` (bonus).
 */
import { LEVELS_PER_OPERATION, OPERATION_COUNT, gradeOfMask, maskHas } from "../../engine/roster";

/** Titres de la table `MATH` (`1108:2f9f`…`3041`), dans l'ordre des colonnes du Hall of Fame : + − × ÷ = ≈. */
export const CERTIFICATE_TITLES: readonly string[] = [
  "Addition Certificate of Merit",
  "Subtraction Certificate of Merit",
  "Multiplication Certificate of Merit",
  "Division Certificate of Merit",
  "Equivalence Certificate of Merit",
  "Estimation Certificate of Merit",
];

/** Légendes fixes (`1108:30a6` et `30d7`), police NewZurica. */
export const CERTIFICATE_LEGEND_AWARDED = "this certificate is awarded to";
export const CERTIFICATE_LEGEND_RANK = "who has achieved the rank of";

/** Fond de page et rubans par niveau (0 à 3 : `RIB1` à `RIB4`, 4 : `RIBB`), fichiers de `original/mathemagique/`. */
export const CERTIFICATE_BACKGROUND_FILE = "BKG.WMF";
export const CERTIFICATE_RIBBON_FILES: readonly string[] = ["RIB1.WMF", "RIB2.WMF", "RIB3.WMF", "RIB4.WMF", "RIBB.WMF"];

/** Polices TrueType du jeu : fichier et nom de famille d'origine (`1108:3061`, `30c5`). */
export const CERTIFICATE_FONT_FILES = { market: "MARKET__.TTF", newZurica: "NEWZURCA.TTF" } as const;

export interface CertificateData {
  playerName: string;
  /** Opération 0 à 5 (+ − × ÷ = ≈). */
  operation: number;
  title: string;
  /** Niveaux réussis de l'opération (0 à 3, 4 = bonus), croissants. Jamais vide. */
  levels: readonly number[];
  /** Fichiers de rubans à dessiner, dans l'ordre des niveaux. */
  ribbonFiles: readonly string[];
  /** Rang global 1 à 25 (`gradeOfMask` sur le masque complet, bonus exclu). */
  grade: number;
  /** Nom du rang (`STRL 5000`, indice `grade - 1`). */
  rank: string;
}

export interface CertificateInput {
  playerName: string;
  mask: number;
  operation: number;
  /** `STRL 5000` de `TROPHY.DAT` : 25 noms de rang. */
  ranks: readonly string[];
}

/** Niveaux réussis d'une opération. */
export function achievedLevels(mask: number, operation: number): number[] {
  const levels: number[] = [];
  for (let level = 0; level < LEVELS_PER_OPERATION; level++) if (maskHas(mask, operation, level)) levels.push(level);
  return levels;
}

/**
 * Données du certificat d'une opération, ou `null` s'il n'y a rien à imprimer (aucun niveau réussi : la cellule est inactive dans
 * le Hall of Fame et l'original n'imprime pas). Lève si l'opération est hors de 0 à 5 ou si le rang n'existe pas.
 */
export function buildCertificateData(input: CertificateInput): CertificateData | null {
  if (!Number.isInteger(input.operation) || input.operation < 0 || input.operation >= OPERATION_COUNT) {
    throw new RangeError(`opération ${input.operation} hors de 0 à ${OPERATION_COUNT - 1}`);
  }
  const levels = achievedLevels(input.mask, input.operation);
  if (levels.length === 0) return null;
  const grade = gradeOfMask(input.mask);
  const rank = input.ranks[grade - 1];
  if (rank === undefined) throw new RangeError(`rang ${grade} absent de la liste (${input.ranks.length} noms)`);
  return {
    playerName: input.playerName,
    operation: input.operation,
    title: CERTIFICATE_TITLES[input.operation]!,
    levels,
    ribbonFiles: levels.map((level) => CERTIFICATE_RIBBON_FILES[level]!),
    grade,
    rank,
  };
}

// --- Mise en page ---

/**
 * Page du fond `BKG.WMF` : boîte placeable de 16 405 × 12 530 unités (de y = 2 à 12 532) à 1 620 unités par pouce, soit 10,13 × 7,73 pouces
 * (paysage). Les rubans ont leur propre résolution (1 636 unités par pouce : `wmfPhysicalTarget`).
 */
export const WMF_UNITS_PER_INCH = 1620;
export const PAGE_WIDTH_UNITS = 16405;
export const PAGE_HEIGHT_UNITS = 12530;
export const PAGE_WIDTH_INCHES = PAGE_WIDTH_UNITS / WMF_UNITS_PER_INCH;
export const PAGE_HEIGHT_INCHES = PAGE_HEIGHT_UNITS / WMF_UNITS_PER_INCH;

/** Largeur du PNG ; la hauteur suit le rapport de la page (1528), soit environ 197 px par pouce. */
export const CERTIFICATE_IMAGE_WIDTH = 2000;
export const CERTIFICATE_IMAGE_HEIGHT = Math.round((CERTIFICATE_IMAGE_WIDTH * PAGE_HEIGHT_UNITS) / PAGE_WIDTH_UNITS);

export type CertificateFont = "market" | "newZurica";
export type CertificateTextRole = "title" | "legendAwarded" | "name" | "legendRank" | "rank";

export interface CertificateTextSpec {
  role: CertificateTextRole;
  font: CertificateFont;
  /** Rectangle en pouces depuis le coin haut-gauche de la page ; le texte y est centré. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Hauteur de police en pouces. */
  size: number;
}

/**
 * Rectangles des cinq textes, en pouces (constantes `double` de `1108:2f77`…`30cf`). Hauteur de rectangle 0,4 pouce (`0,4`), police 0,35 pouce
 * (Market) ou 0,2 pouce (légendes). **Hypothèse** sur l'attribution des constantes : le haut d'un rectangle est `bas − 0,4`, le bas vient
 * du tableau ; seule la colonne de x (titre 1,985 à 8,485, les autres textes 2,423 à 6,813) est lue sans ambiguïté.
 */
export const CERTIFICATE_TEXTS: readonly CertificateTextSpec[] = [
  { role: "title", font: "market", left: 1.985, right: 8.485, top: 1.113, bottom: 1.513, size: 0.35 },
  { role: "legendAwarded", font: "newZurica", left: 2.423, right: 6.813, top: 1.866, bottom: 2.066, size: 0.2 },
  { role: "name", font: "market", left: 2.423, right: 6.813, top: 2.003, bottom: 2.403, size: 0.35 },
  { role: "legendRank", font: "newZurica", left: 2.423, right: 6.813, top: 2.678, bottom: 2.878, size: 0.2 },
  { role: "rank", font: "market", left: 2.423, right: 6.813, top: 2.815, bottom: 3.215, size: 0.35 },
];

/** Texte de chaque rôle pour un certificat. */
export function certificateText(data: CertificateData, role: CertificateTextRole): string {
  switch (role) {
    case "title":
      return data.title;
    case "legendAwarded":
      return CERTIFICATE_LEGEND_AWARDED;
    case "name":
      return data.playerName;
    case "legendRank":
      return CERTIFICATE_LEGEND_RANK;
    case "rank":
      return data.rank;
  }
}

const OPERATION_FILE_NAMES = ["addition", "soustraction", "multiplication", "division", "equivalence", "estimation"] as const;

/**
 * Nom du fichier PNG proposé au téléchargement : `certificat-<opération>-<nom>.png` (minuscules, sans accent, tirets).
 * ⚠ Copy à valider (nom visible dans la boîte d'enregistrement).
 */
export function certificateFileName(playerName: string, operation: number): string {
  const slug = playerName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `certificat-${OPERATION_FILE_NAMES[operation] ?? "operation"}${slug ? `-${slug}` : ""}.png`;
}
