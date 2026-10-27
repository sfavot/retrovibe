/**
 * Archives Mohawk de L'Odyssée des Zoombinis (`original/zoombinis/`, inventaire dans `docs/zoombinis/files.md`) et
 * correspondance numéro d'écran -> archive -> épreuve (`docs/zoombinis/engine.md` §2.1 et §2.3, table des écrans `1530:14fe`).
 *
 * Toutes les archives sont des `MHWK` lues par `MohawkArchive` (`src/data/mohawk/mohawk.ts`), `MIDIMAP.DAT` comprise.
 * Les tags propres à Zoombinis sont déclarés ici ; ceux qui sont communs avec Mathémagique (`\0SND`, `SHPL`, `STRL`) restent
 * dans `mohawk.ts`. Les textes (`STRL`) sont en Mac OS Roman.
 */

/** Images : isolées ou planches multi-images (`decodeTbmpImages`). */
export const TAG_TBMP = "tBMP";
/** Scripts d'animation d'objets (`script.ts`). */
export const TAG_SCRB = "SCRB";
/** Scripts d'animation des Zoombinis (`script.ts`). */
export const TAG_SCRS = "SCRS";
/** Points de passage (`node-path.ts`). */
export const TAG_NODE = "NODE";
/** Chemins entre points de passage (`node-path.ts`). */
export const TAG_PATH = "PATH";
/** Tableaux de mots signés : points d'ancrage des planches, tables d'épreuve (`regs.ts`). */
export const TAG_REGS = "REGS";
/** Curseurs 16 × 16 (`curs.ts`). */
export const TAG_CURS = "CURS";
/** Messages MIDI système de `MIDIMAP.DAT` (`sysx.ts`). */
export const TAG_SYSX = "SYSX";
/** Musiques MIDI de `MIDIMPC.MHK` (`src/data/mohawk/midi.ts`). */
export const TAG_TMID = "tMID";

/** Archives du jeu (hors `MIDIMAP.DAT`), triées. */
export const ARCHIVE_NAMES = [
  "BASECAMP.MHK",
  "BCTWO.MHK",
  "BRIDGE.MHK",
  "CAVES.MHK",
  "FERRY.MHK",
  "FLEENS.MHK",
  "HOTEL.MHK",
  "LILLY.MHK",
  "MAP.MHK",
  "MAZE2.MHK",
  "MIDIMPC.MHK",
  "NET.MHK",
  "PICKER.MHK",
  "PIZZA.MHK",
  "SLIDES.MHK",
  "SMOKE.MHK",
  "TEXTSTR.MHK",
  "TOWN.MHK",
  "TUNNELS.MHK",
  "XFER.MHK",
  "ZOOMBINI.MHK",
] as const;

/** Archive des messages SYSX (une archive Mohawk malgré son extension). */
export const MIDIMAP_NAME = "MIDIMAP.DAT";
/** Archive commune : curseurs, planches et scripts des Zoombinis, voix. */
export const COMMON_ARCHIVE = "ZOOMBINI.MHK";
/** Archive des textes : `STRL` 2000 = noms des écrans (`ZOOMBINI_SCREEN_NAMES_STRL`). */
export const TEXT_ARCHIVE = "TEXTSTR.MHK";
/** `STRL` de `TEXTSTR.MHK` qui liste les noms des épreuves (index 0 = zoombinîle, 1 à 15 = parcours de la carte). */
export const ZOOMBINI_SCREEN_NAMES_STRL = 2000;

/** Id de la `SHPL`, de la `tBMP`, de la `NODE` et de la `PATH` du fond dans les écrans de jeu (convention de `10b0:0027`). */
export const BACKGROUND_ID = 1000;

export type ZoombiniScreenRole =
  /** Logo QuickTime, sans archive. */
  | "logo"
  | "map"
  /** Transition animée entre deux écrans (`XFER`). */
  | "transition"
  | "picker"
  /** Sous-écrans de `PICKER.MHK` (rôle inconnu). */
  | "picker-sub"
  | "camp"
  | "town"
  | "trial";

export interface ZoombiniScreen {
  /** Numéro d'écran du moteur (0 à 20 ; 21 et 22 sont des doublons, voir `SCREEN_ALIASES`). */
  screen: number;
  /** Archive de l'écran ; `undefined` pour le logo. */
  archive: (typeof ARCHIVE_NAMES)[number] | undefined;
  role: ZoombiniScreenRole;
  /** Numéro d'épreuve de 1 à 12 (= `screen - 6` pour les écrans 7 à 18) ; `undefined` hors épreuve. */
  trial?: number;
  /** Index du nom de l'écran dans la `STRL` 2000 de `TEXTSTR.MHK` ; `undefined` sans nom. */
  nameIndex?: number;
  /** Faux si la correspondance épreuve -> nom est déduite (écrans 12, 15, 16, 17, 18) et non lue dans le code. */
  certain: boolean;
}

function trial(screen: number, archive: ZoombiniScreen["archive"], nameIndex: number, certain = true): ZoombiniScreen {
  return { screen, archive, role: "trial", trial: screen - 6, nameIndex, certain };
}

/** Table des écrans (`engine.md` §2.1 et §2.3), indexée par numéro d'écran. */
export const ZOOMBINI_SCREENS: readonly ZoombiniScreen[] = [
  { screen: 0, archive: undefined, role: "logo", certain: true },
  { screen: 1, archive: "MAP.MHK", role: "map", certain: true },
  { screen: 2, archive: "XFER.MHK", role: "transition", certain: true },
  { screen: 3, archive: "PICKER.MHK", role: "picker", nameIndex: 0, certain: true },
  { screen: 4, archive: "BASECAMP.MHK", role: "camp", nameIndex: 4, certain: true },
  { screen: 5, archive: "BCTWO.MHK", role: "camp", nameIndex: 11, certain: true },
  { screen: 6, archive: "TOWN.MHK", role: "town", nameIndex: 15, certain: true },
  trial(7, "BRIDGE.MHK", 1),
  trial(8, "TUNNELS.MHK", 2),
  trial(9, "PIZZA.MHK", 3),
  trial(10, "FERRY.MHK", 5),
  trial(11, "LILLY.MHK", 6),
  trial(12, "SLIDES.MHK", 7, false),
  trial(13, "FLEENS.MHK", 8),
  trial(14, "HOTEL.MHK", 9),
  trial(15, "NET.MHK", 10, false),
  trial(16, "CAVES.MHK", 12, false),
  trial(17, "SMOKE.MHK", 13, false),
  trial(18, "MAZE2.MHK", 14, false),
  { screen: 19, archive: "PICKER.MHK", role: "picker-sub", certain: false },
  { screen: 20, archive: "PICKER.MHK", role: "picker-sub", certain: false },
];

/** Doublons de la table du moteur : l'écran 21 est le 19 et le 22 est le 0. */
export const SCREEN_ALIASES: Readonly<Record<number, number>> = { 21: 19, 22: 0 };

/** Écran du moteur pour un numéro (doublons résolus) ; `undefined` hors de 0 à 22. */
export function screenInfo(screen: number): ZoombiniScreen | undefined {
  return ZOOMBINI_SCREENS[SCREEN_ALIASES[screen] ?? screen];
}

/** Écrans qui chargent une archive donnée (`PICKER.MHK` : 3, 19 et 20). */
export function screensOfArchive(archive: string): ZoombiniScreen[] {
  const wanted = archive.toUpperCase();
  return ZOOMBINI_SCREENS.filter((entry) => entry.archive === wanted);
}
