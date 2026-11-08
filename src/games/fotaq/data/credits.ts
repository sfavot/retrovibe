/**
 * Textes de générique (`CREDIT1.CRD`, `CREDIT2.CRD`, `DATA`) : lignes de texte et directives (`.p`, `.i`, `.c`…).
 *
 * Source : `Credits::update` (engines/queen/credits.cpp, ScummVM), qui lit les lignes une à une ; ici le fichier
 * est lu d'un bloc en **pages** (ce qu'affiche un `.p`). Une directive est une ligne qui commence par `.` :
 * - `.l` `.c` `.r` : alignement à gauche, centré, à droite ; `.s` `.b` : petite ou grande police ;
 * - `.i N` : couleur du texte ; `.1` à `.9` : zone de l'écran (grille 3 x 3) ;
 * - `.p N` : affiche les lignes accumulées, puis attend N x 10 images ; `.p 0` attend le changement de pièce
 *   (`pause: -1`). Les autres directives (`.8` seule, etc.) changent la zone ou n'ont pas d'effet.
 * Une ligne qui commence par `EN` termine le générique ; les lignes accumulées après le dernier `.p` ne sont
 * jamais affichées (elles sont rendues dans `unshown`).
 * Écarts volontaires : la colonne `x` dépend de la largeur du texte rendu (centré, à droite) et reste donc
 * au rendu : on donne `zoneX` (début de la zone) et l'alignement ; la rangée `y` est calculée comme ScummVM.
 */

import { splitLines } from "./text";

export type CreditsAlign = "left" | "center" | "right";

export interface CreditsLine {
  text: string;
  /** Couleur de palette (`.i`). */
  color: number;
  /** Police : 0 petite, 1 grande. */
  fontSize: number;
  align: CreditsAlign;
  /** Zone de la grille 3 x 3 (0 à 8). */
  zone: number;
  /** Abscisse du début de la zone : `(zone % 3) * (320 / 3)`, avec la division entière de ScummVM. */
  zoneX: number;
  /** Ordonnée de la ligne : `(zone / 3) * (200 / 3) + rang * 10`. */
  y: number;
}

export interface CreditsPage {
  lines: CreditsLine[];
  /** Images d'attente ; -1 : jusqu'au changement de pièce. */
  pause: number;
}

export interface Credits {
  pages: CreditsPage[];
  /** Lignes accumulées après le dernier `.p`, jamais affichées. */
  unshown: CreditsLine[];
  /** Vrai si une ligne `EN` termine le générique. */
  hasEnd: boolean;
}

const ZONE_WIDTH = Math.trunc(320 / 3);
const ZONE_HEIGHT = Math.trunc(200 / 3);
const LINE_SPACING = 10;

export function parseCredits(bytes: Uint8Array): Credits {
  const pages: CreditsPage[] = [];
  let lines: CreditsLine[] = [];
  let align: CreditsAlign = "left";
  let fontSize = 0;
  let color = 0;
  let zone = 0;
  let hasEnd = false;

  for (const line of splitLines(bytes)) {
    if (line.startsWith("EN")) {
      hasEnd = true;
      break;
    }
    if (line.startsWith(".")) {
      const directive = line.charAt(1).toLowerCase();
      if (directive === "l") align = "left";
      else if (directive === "c") align = "center";
      else if (directive === "r") align = "right";
      else if (directive === "s") fontSize = 0;
      else if (directive === "b") fontSize = 1;
      else if (directive === "i") color = Number.parseInt(line.slice(3), 10) || 0;
      else if (directive >= "1" && directive <= "9") zone = directive.charCodeAt(0) - "1".charCodeAt(0);
      else if (directive === "p") {
        const ticks = (Number.parseInt(line.slice(3), 10) || 0) * 10;
        pages.push({ lines, pause: ticks === 0 ? -1 : ticks });
        lines = [];
      }
      continue;
    }
    lines.push({
      text: line,
      color,
      fontSize,
      align,
      zone,
      zoneX: (zone % 3) * ZONE_WIDTH,
      y: Math.trunc(zone / 3) * ZONE_HEIGHT + lines.length * LINE_SPACING,
    });
  }
  return { pages, unshown: lines, hasEnd };
}
