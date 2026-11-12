/**
 * Solution de la zone « la cellule » : du début de la partie à l'arrivée dans le village (pièce 10), par la cellule (pièce 1), la
 * cellule extérieure (2), la salle de garde (3), la salle de torture (4), la sortie des briques et les égouts (7, 8, 9).
 * Données seulement : `Play.run` (`runner.ts`) les joue avec de vrais clics.
 *
 * Le déroulé (vérifié contre les données de `lure.dat`, pas contre une soluce écrite) :
 *
 * 1. La torche (« Prends » ou « Tire ») tombe sur la paille : `TORCH_HIDE` = 1, le feu prend, le Skorl accourt pour l'éteindre. La
 *    porte de la cellule est verrouillée de l'intérieur : le joueur se plante dans l'embrasure, le Skorl n'entre pas (la porte s'ouvre
 *    de son côté), puis le joueur sort dès qu'elle est ouverte.
 * 2. Salle de garde : la bouteille, le couteau, le tonneau (le clic gauche fait apparaître le robinet), la bouteille remplie.
 * 3. Salle de torture : le couteau coupe la corde du chevalet (`7535`) : le serf s'enfuit, c'est Ratpouch. Tant que le joueur y est le
 *    Skorl reste dans la cellule (il attend la fin du son 21, celui de la salle de torture).
 * 4. Retour par la salle de garde, en croisant le Skorl sur une autre ligne du sol (il est hostile depuis qu'il a éteint le feu :
 *    `jailorAnimHandler` : champ 11 non nul et contact = capture). Les bulles de parole se ferment d'un clic (un joueur pressé).
 * 5. Cellule extérieure : la bouteille d'eau (la « forte liqueur Skorl ») au prisonnier mourant, puis Ratpouch (« Dis à Ratpouch :
 *    Pousse les briques ») ouvre la sortie des briques et passe devant ; le joueur le suit par le trou, tombe dans l'égout (pièce 7,
 *    `playerSewerExitAnimHandler`) et rejoint le village par les pièces 8, 9 et 10.
 */

import { Field, HotspotId } from "../../../src/games/lure/engine/ids";
import type { LureEngine } from "../../../src/games/lure/engine/game";
import type { Step } from "./runner";

export const HS = {
  TORCH: 0x40f,
  PRISONER: 0x412,
  RATPOUCH: HotspotId.RATPOUCH,
  SKORL: HotspotId.SKORL,
  BOTTLE: 0x2710,
  KNIFE: 0x2713,
  BARREL: 0x7532,
  TAP: 0x7531,
  ROPE: 0x7535,
  BRICKS: HotspotId.BRICKS,
} as const;

/** Pièce d'arrivée de la zone : la place du village. */
export const ZONE_CELL_END_ROOM = 10;

export const ratpouchWithPlayer = (e: LureEngine): boolean => e.world.getActiveHotspot(HotspotId.RATPOUCH)?.roomNumber === e.room.roomNumber;
export const bricksOpen = (e: LureEngine): boolean => e.world.getExitJoin(HotspotId.BRICKS)?.blocked === 0;
export const cellDoorOpen = (e: LureEngine): boolean => e.world.fields.get(Field.CELL_DOOR_STATE) === 0;

export const ZONE_CELL_STEPS: Step[] = [
  { wait: 30, note: "le jeu démarre : pièce 1, Diermot dans la cellule" },
  { verb: "Prends", on: HS.TORCH, note: "la torche tombe sur la paille : feu de paille (champ 10 = 1)" },
  { walk: [95, 165], note: "se planter dans l'embrasure : le Skorl ne peut pas entrer" },
  { until: cellDoorOpen, stay: true, what: "porte de la cellule ouverte" },
  { exit: 2, note: "cellule extérieure" },
  { exit: 3, note: "salle de garde" },
  { verb: "Prends", on: HS.BOTTLE },
  { look: HS.BARREL, note: "le clic gauche sur le tonneau fait apparaître le robinet" },
  { verb: "Utilise", on: HS.TAP, with: "Bouteille", note: "la bouteille se remplit" },
  { verb: "Prends", on: HS.KNIFE },
  { exit: 4, note: "salle de torture (le Skorl reste dans la cellule tant que le son 21 joue)" },
  { verb: "Utilise", on: HS.ROPE, with: "Couteau", note: "la corde du chevalet est coupée : le serf s'enfuit, Ratpouch apparaît" },
  { exit: 3 },
  { walk: [200, 140], note: "croiser le Skorl hostile sur une autre ligne du sol (pied à 140, il marche à 160)" },
  { walk: [120, 140] },
  { walk: [40, 140] },
  { exit: 2 },
  { verb: "Donne", on: HS.PRISONER, with: "Bouteille", note: "le prisonnier boit la liqueur et meurt (champ 15 = 3), les briques deviennent actives" },
  { until: ratpouchWithPlayer, stay: true, what: "Ratpouch dans la pièce du joueur", note: "sans bouger : le Skorl hostile rôde" },
  { tell: HS.RATPOUCH, orders: [{ verb: "Pousse", object: "Briques", seen: HS.BRICKS }], note: "Dis à Ratpouch : Pousse Briques" },
  { walk: [240, 125], note: "s'écarter pour que Ratpouch passe" },
  { until: bricksOpen, stay: true, what: "briques poussées" },
  { walk: [240, 125] },
  { walk: [303, 127], note: "le trou : chute dans l'égout (pièce 7)" },
  { wait: 60, note: "fin de la chute (`playerSewerExitAnimHandler`)" },
  { exit: 8 },
  { exit: 9 },
  { exit: 10, note: "le village" },
];
