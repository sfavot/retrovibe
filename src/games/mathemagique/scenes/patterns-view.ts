/**
 * Puzzle Patterns : données de présentation pures (identifiants de ressources, boutons, zones d'aide, cyclage de palette).
 * Aucune dépendance au moteur : la scène (`patterns.ts`) les assemble. Comportement d'origine : `docs/mathemagique/screens/patterns.md`.
 */
import type { ShapeList } from "../data/shpl";
import { edgesContain, edges, type Edges, type PatternsPiece, patternsRect } from "../game/puzzle-kit";
import { POLY_ZONE } from "../game/poly-config";

export const PATTERNS_ARCHIVE = "PATTERNS.DAT";

/** `SHPL` du fond plein écran (palette 10–245, forme unique 576×432). */
export const BACKGROUND_ID = 103;
/** `SHPL` des 7 boutons : 14 formes = 7 × (repos, appuyé), `SHAP` 6500 à 6513. */
export const BUTTONS_SHPL = 6500;
/** `SCR` d'entrée : les trois visages de niveau « parlent » (zone `150,356,253,390`, 238 ticks). */
export const FACES_SCR = 2000;
/** Musique de fond (MIDI), jouée si « Ambient Sounds » est actif. */
export const MUSIC_ID = 100;

/** Sons de l'activité (patterns.md §4). */
export const SOUNDS = {
  levels: [6501, 6502, 6503],
  help: 6504,
  reset: 6505,
  rotate: 6506,
  thumbHover: 6510,
  thumbClick: 6511,
  pick: 6512,
  drop: 6513,
} as const;

/** Rôle des 7 boutons, dans l'ordre de la table `DS:1c1c` (`param` 1 à 7 de `1040:0454`). */
export type ButtonRole = "green" | "orange" | "red" | "help" | "reset" | "rotate" | "exit";

export interface ButtonDef {
  role: ButtonRole;
  /** Rectangle au repos `(gauche, haut, droite, bas)`, semi-ouvert (§3.2). */
  edges: Edges;
  /** `SHAP` au repos ; l'enfoncé est le suivant. */
  shapeId: number;
  sound?: number;
}

const button = (role: ButtonRole, l: number, t: number, r: number, b: number, form: number, sound?: number): ButtonDef => ({
  role,
  edges: edges(l, t, r, b),
  shapeId: BUTTONS_SHPL + form - 1,
  ...(sound === undefined ? {} : { sound }),
});

export const BUTTONS: readonly ButtonDef[] = [
  button("green", 150, 356, 183, 388, 1, SOUNDS.levels[0]),
  button("orange", 185, 356, 218, 388, 3, SOUNDS.levels[1]),
  button("red", 220, 356, 253, 388, 5, SOUNDS.levels[2]),
  button("help", 283, 356, 316, 388, 7, SOUNDS.help),
  button("reset", 88, 356, 130, 388, 9),
  button("rotate", 318, 356, 351, 388, 11),
  button("exit", 45, 356, 86, 388, 13),
];

/** Indice 1-based (celui du rappel de groupe) de chaque bouton. */
export const BUTTON_INDEX: Readonly<Record<ButtonRole, number>> = Object.fromEntries(BUTTONS.map((b, i) => [b.role, i + 1])) as Record<ButtonRole, number>;

/** Niveau (0 à 2) d'un bouton de visage, sinon `-1`. */
export function levelOfButton(role: ButtonRole): number {
  return role === "green" ? 0 : role === "orange" ? 1 : role === "red" ? 2 : -1;
}

// --- Géométrie de l'écran ---

/** Intérieur du cadre : zone de jeu, et zone « replay » une fois le puzzle résolu (`DS:1c8c`). */
export const FRAME_INNER = edges(49, 47, 348, 346);
/** Le cadre-indice (301×301) est dessiné en `(48, 46)`. */
export const HINT_FRAME_AT = { x: 48, y: 46 } as const;
/** Zone cliquable de Poly en mode aide (`DS:8600`). */
export const POLY_EDGES = edges(362, 280, 438, 432);

/** Couleur du cadre de survol des vignettes, par niveau (`DS:1d2c`). */
export const HOVER_COLORS = [77, 61, 79] as const;

/** Forme `k` (0 à 8) du menu du niveau : la `SHPL` des vignettes commence à son propre identifiant. */
export const thumbShapeId = (thumbsShplId: number, k: number): number => thumbsShplId + k;
/** Forme 10 de la même `SHPL` : masque 1 bit 80×80, le cadre de survol (rect agrandi de 4 px). */
export const thumbHoverMaskId = (thumbsShplId: number): number => thumbsShplId + 9;

// --- Pièces ---

/** `SHAP` de la pièce `id` dans la rotation `rot` : forme `4·id + rot + 2` de la `SHPL` du puzzle (la forme 1 est le cadre). */
export function pieceShapeId(puzzleShplId: number, piece: Pick<PatternsPiece, "id" | "rot">): number {
  return puzzleShplId + 4 * piece.id + piece.rot + 1;
}

/** Entrées de palette que la peinture d'un puzzle remplace (`10a8:0dc4(72, 154)`) : le fond garde ses couleurs. */
export const PUZZLE_PALETTE = { first: 154, count: 72 } as const;

/**
 * Restreint la palette d'une `SHPL` à `[first, first + count[` : les `SHPL` de puzzle à 236 couleurs redéfinissent aussi 10–153 et 226–245,
 * qui ne doivent pas être appliquées (le fond deviendrait faux).
 */
export function paletteSlice(shpl: ShapeList, first: number = PUZZLE_PALETTE.first, count: number = PUZZLE_PALETTE.count): ShapeList {
  const own = shpl.rgb.length / 3;
  const from = Math.max(first, shpl.paletteFirst);
  const to = Math.min(first + count, shpl.paletteFirst + own);
  const n = Math.max(0, to - from);
  const start = (from - shpl.paletteFirst) * 3;
  return { ...shpl, paletteFirst: from, rgb: shpl.rgb.slice(start, start + n * 3) };
}

// --- Cyclage de palette des victoires ---

export const CYCLE_PERIOD = 7;

/** Plage cyclée par le hook 0 des quatre victoires animées par la palette (§3.7) ; les autres victoires n'en ont pas. */
export const REWARD_CYCLES: Readonly<Record<number, { first: number; count: number }>> = {
  21100: { first: 154, count: 28 },
  21700: { first: 154, count: 33 },
  21900: { first: 154, count: 6 },
  22600: { first: 155, count: 17 },
};

// --- Zones de l'aide de Poly ---

/** Numéros cumulés de `1040:067b` rendus par des clés de `PATTERNS_POLY.topics` ; `null` : rien d'expliqué ici. */
export function helpZoneAt(x: number, y: number, pieces: readonly PatternsPiece[]): string | null {
  if (edgesContain(POLY_EDGES, x, y)) return POLY_ZONE;
  for (const piece of pieces) if (edgesContain(patternsRect(piece), x, y)) return "piece";
  for (const def of BUTTONS) {
    if (!edgesContain(def.edges, x, y)) continue;
    return levelOfButton(def.role) >= 0 ? "level" : def.role;
  }
  return edgesContain(FRAME_INNER, x, y) ? "screen" : null;
}
