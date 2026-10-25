import { h } from "./dom";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Tracés 24×24 au trait (`currentColor`) des boutons de la page d'un jeu et des barres tactiles. */
const PATHS = {
  close: ["M6 6l12 12", "M18 6 6 18"],
  "sound-on": ["M11 5 6 9H3v6h3l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"],
  "sound-off": ["M11 5 6 9H3v6h3l5 4z", "m16 9 6 6", "m22 9-6 6"],
  expand: ["M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3"],
  keyboard: ["M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z", "M6 10h.01", "M10 10h.01", "M14 10h.01", "M18 10h.01", "M7 14h10"],
  hand: [
    "M18 11V6a2 2 0 0 0-4 0",
    "M14 10V4a2 2 0 0 0-4 0v2",
    "M10 10.5V6a2 2 0 0 0-4 0v8",
    "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15",
  ],
  enter: ["M20 4v7a4 4 0 0 1-4 4H4", "m9 10-5 5 5 5"],
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  help: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  shrink: ["M8 3v3a2 2 0 0 1-2 2H3", "M21 8h-3a2 2 0 0 1-2-2V3", "M3 16h3a2 2 0 0 1 2 2v3", "M16 21v-3a2 2 0 0 1 2-2h3"],
} as const;

export type IconName = keyof typeof PATHS;

/** Icône décorative (masquée aux lecteurs d'écran : le libellé du bouton reste son nom). Classe `icon icon-<nom>`. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `icon icon-${name}`);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * Contenu d'un bouton à icône : les icônes (masquées par défaut) puis le libellé. La feuille de style choisit, selon la disposition,
 * d'afficher le libellé ou les icônes ; masqué, le libellé reste lu par les lecteurs d'écran (classe `icon-label`).
 */
export function withIcons(label: string, ...names: IconName[]): (SVGSVGElement | HTMLSpanElement)[] {
  return [...names.map(icon), h("span", { class: "icon-label" }, label)];
}
