/**
 * Aide du Rhythm Shop (`RSHELP.DAT`, rhythm.md §1.9) pour `PolyHelper` : 19 zones, scripts `\0SCR` de Poly. Données pures.
 *
 * Déroulé d'origine : `Help` joue `SCR` 1100 (arrivée), puis 1800 la première fois (drapeau `rhythmHelpSeen`) sinon 1600. Chaque zone enchaîne
 * 2200 (intro commune), son script propre, 2300 (conclusion commune), sauf Fractionator, Help et Exit (script seul) et Algebird (8500 de `RHYTHM.DAT`).
 * La sortie (main stop, zones 1 et 2) joue un des dix scripts 2700 à 3600 puis 1200.
 *
 * Particularités :
 * - la zone `algebird` joue `SCR` 8500 qui est dans `RHYTHM.DAT`, pas `RSHELP.DAT` : les ports de la scène doivent l'envoyer à l'archive de la scène ;
 * - les `SND` 3012 / 3013 du bouton Help (tirage 50/50) et la main stop (`SHAP` 106 de `SHPL` 30000) restent à la scène.
 */
import { POLY_ZONE, type PolyConfig, type PolyTopic } from "../poly-config";

export const RHYTHM_HELP_ARCHIVE = "RSHELP.DAT";

/** Script d'Algebird (aide), dans `RHYTHM.DAT`. */
export const ALGEBIRD_HELP_SCR = 8500;

export interface HelpZone {
  /** Indice 1 à 19 de `HotspotTable.hit`. */
  index: number;
  /** Clé de `PolyHelper.click` : un sujet de `RHYTHM_POLY.topics` ou `POLY_ZONE` (main stop). */
  key: string;
  /** `(gauche, haut, droite, bas)` en pixels du jeu. */
  rect: readonly [number, number, number, number];
}

/** Les 19 zones de `DS:17d0` dans l'ordre de test (la première touchée gagne). Les zones 1 et 2 (main stop) ne montrent pas le « ? » (`helpCursorAt(table, x, y, 3)`). */
export const RHYTHM_HELP_ZONES: readonly HelpZone[] = [
  { index: 1, key: POLY_ZONE, rect: [435, 273, 494, 432] },
  { index: 2, key: POLY_ZONE, rect: [418, 378, 516, 425] },
  { index: 3, key: "partsBin", rect: [205, 231, 496, 274] },
  { index: 4, key: "patternBin", rect: [205, 305, 496, 348] },
  { index: 5, key: "fractionator", rect: [194, 148, 485, 191] },
  { index: 6, key: "playParts", rect: [172, 232, 199, 270] },
  { index: 7, key: "playPattern", rect: [172, 306, 199, 344] },
  { index: 8, key: "doIt", rect: [282, 198, 384, 227] },
  { index: 9, key: "empty", rect: [444, 201, 499, 223] },
  { index: 10, key: "undo", rect: [172, 201, 227, 223] },
  { index: 11, key: "help", rect: [101, 197, 132, 226] },
  { index: 12, key: "arrows", rect: [36, 128, 147, 152] },
  { index: 13, key: "teletune", rect: [36, 28, 147, 125] },
  { index: 14, key: "cutter", rect: [192, 47, 286, 101] },
  { index: 15, key: "level", rect: [36, 154, 147, 186] },
  { index: 16, key: "exit", rect: [55, 197, 96, 226] },
  { index: 17, key: "algebird", rect: [19, 257, 166, 410] },
  { index: 18, key: "gluer", rect: [290, 47, 384, 101] },
  { index: 19, key: "melder", rect: [388, 47, 482, 101] },
];

/** Rectangles pour `HotspotTable.fromEdges` (indice = zone − 1). */
export const RHYTHM_HELP_EDGES: readonly (readonly [number, number, number, number])[] = RHYTHM_HELP_ZONES.map((zone) => zone.rect);

const topic = (scr: number, framed = true): PolyTopic => ({ scr, ids: [scr], before: framed, after: framed });

/** Scripts de sortie (clic sur la main stop) : `DS:111a`, puis le départ de Poly (1200). */
export const RHYTHM_HELP_EXIT_LINES: readonly number[] = [2700, 2800, 2900, 3000, 3100, 3200, 3300, 3400, 3500, 3600];

export const RHYTHM_POLY: PolyConfig = {
  id: "rhythm",
  // `PolyArchiveName` n'admet pas `RSHELP.DAT` (le test game-kit indexe ses archives par ce type) : assertion sans effet à l'exécution.
  archive: RHYTHM_HELP_ARCHIVE as unknown as PolyConfig["archive"],
  temporaryArchive: true,
  offsetY: 0,
  introFlag: "rhythmHelpSeen",
  arrival: 1100,
  introLong: 1800,
  introShort: 1600,
  before: 2200,
  after: 2300,
  // Hypothèse : le relais d'inactivité (300 ticks, `DS:4fe2`) rejoue la grande présentation comme dans les autres jeux.
  idleTicks: 300,
  backgroundZone: null,
  polyZone: null,
  topics: {
    partsBin: topic(1900),
    patternBin: topic(1400),
    fractionator: topic(1300, false),
    playParts: topic(2000),
    playPattern: topic(2000),
    doIt: topic(2500),
    empty: topic(1000),
    undo: topic(1700),
    help: topic(1500, false),
    arrows: topic(2400),
    teletune: topic(2100),
    cutter: topic(3800),
    level: topic(2600),
    exit: topic(3700, false),
    algebird: topic(ALGEBIRD_HELP_SCR, false),
    gluer: topic(3900),
    melder: topic(900),
  },
  exit: { kind: "tips", base: 2700, count: RHYTHM_HELP_EXIT_LINES.length, pick: "rand", table: RHYTHM_HELP_EXIT_LINES, departure: 1200 },
  confidence: "documented",
  doc: "screens/rhythm.md §1.9",
};
