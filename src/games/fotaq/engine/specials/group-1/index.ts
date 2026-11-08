import type { GroupScript } from "../assemble";
import { amazonAreas } from "./areas";

/**
 * Groupe 1 : jungle et Amazones, pièces 1 à 6 et 8 à 21 (`docs/fotaq/specials.md`, `specials-group-1.md`). Aucun mouvement spécial,
 * aucune pièce prise en charge ni animation de pièce : seulement les zones éteintes des pièces 4, 6, 14, 16 et 17
 * (`handleSpecialArea`).
 */
export const group1: GroupScript = {
  specialAreas: amazonAreas,
};
