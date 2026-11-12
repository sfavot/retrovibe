/**
 * Le bar (service `Bar`, groupe L3) : les listes de clients des trois barmen (Sid, Nellie, Ewan), la place d'un client au comptoir
 * (`getBarPlace`), le service (`barmanServe`, `barmanAnimHandler`).
 *
 * Source (ScummVM, GPL v3+) : `BarmanLists`, `BarEntry`, `ServeEntry` (res_struct.cpp / .h), `Hotspot::getBarPlace`,
 * `Hotspot::findClearBarPlace` (hotspots.cpp).
 *
 * Écarts :
 * - le client en cours de service est un **rang** (0 à 3) dans la liste, pas un pointeur ; `saveToStream` de ScummVM calcule ce rang par
 *   une division par `sizeof(BarEntry)` (faux : il écrit toujours 1 ou 0), ici l'état est écrit tel quel ;
 * - `ewanXOffset` (membre de `HotspotTickHandlers`, que ScummVM ne sauvegarde pas) est dans l'état sauvegardé : Ewan reprend son
 *   décalage de 8 pixels pendant l'animation alternative ;
 */

import { Direction } from "../data/ids";
import { ROOM_PATHS_WIDTH } from "../data/lure-dat";
import type { Hotspot } from "./hotspot";
import { HotspotId } from "./ids";
import type { LureContext } from "./context";
import type { Bar, BarPlace } from "./services";
import { pathOccupied } from "./state";

export const NUM_SERVE_CUSTOMERS = 4;

/** `BarmanGraphicType` : rang de la liste d'images dans `BarEntry.graphics`. */
export const BarmanGraphic = { RANDOM: 0, BEER: 1, EXTRA1: 2, EXTRA2: 3 } as const;

export interface ServeEntry {
  hotspotId: number;
  serveFlags: number;
}

export interface BarEntry {
  roomNumber: number;
  barmanId: number;
  customers: ServeEntry[];
  /** Listes d'images (terminées par 0) : polissage ou service, service, extras d'Ewan ; `null` quand le barman n'en a pas. */
  graphics: ReadonlyArray<readonly number[] | null>;
  /** Ligne de la grille de cheminement où se trouve le comptoir. */
  gridLine: number;
  /** Rang du client en cours de service dans `customers`, `null` s'il n'y en a pas. */
  currentCustomer: number | null;
}

const BASIC_POLISH = [21, 22, 23, 24, 25, 26, 25, 24, 23, 22, 23, 24, 25, 26, 25, 24, 23, 22, 21, 0];
const SIDS_FETCH = [13, 14, 15, 16, 17, 18, 17, 18, 17, 16, 15, 19, 20, 0];
const NELLIES_SCRATCH = [12, 13, 14, 15, 16, 15, 16, 15, 16, 15, 14, 13, 12, 0];
const NELLIES_FETCH = [1, 2, 3, 4, 5, 4, 5, 4, 3, 2, 6, 7, 0];
const EWANS_FETCH = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 0];
const EWAN_EXTRA_GRAPHIC_1 = [28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 0];
const EWAN_EXTRA_GRAPHIC_2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 0];

const emptyCustomers = (): ServeEntry[] => Array.from({ length: NUM_SERVE_CUSTOMERS }, () => ({ hotspotId: 0, serveFlags: 0 }));

/** `default_barList` : Sid (pièce 29), Nellie (32), Ewan (35). */
function defaultBarList(): BarEntry[] {
  return [
    { roomNumber: 29, barmanId: HotspotId.SID, customers: emptyCustomers(), graphics: [BASIC_POLISH, SIDS_FETCH, null, null], gridLine: 13, currentCustomer: null },
    { roomNumber: 32, barmanId: HotspotId.NELLIE, customers: emptyCustomers(), graphics: [NELLIES_SCRATCH, NELLIES_FETCH, null, null], gridLine: 14, currentCustomer: null },
    {
      roomNumber: 35,
      barmanId: HotspotId.EWAN,
      customers: emptyCustomers(),
      graphics: [EWANS_FETCH, EWANS_FETCH, EWAN_EXTRA_GRAPHIC_1, EWAN_EXTRA_GRAPHIC_2],
      gridLine: 16,
      currentCustomer: null,
    },
  ];
}

/** État sauvegardé du bar (JSON). */
export interface BarSave {
  /** Par bar, dans l'ordre Sid, Nellie, Ewan. */
  bars: Array<{ currentCustomer: number | null; customers: ServeEntry[] }>;
  ewanXOffset: boolean;
}

export class BarManager implements Bar {
  private lists: BarEntry[] = defaultBarList();
  /** `HotspotTickHandlers::ewanXOffset` : Ewan est décalé de 8 pixels (animation alternative du polissage). */
  ewanXOffset = false;

  constructor(private readonly ctx: LureContext) {}

  /** `BarmanLists::getDetails` : le bar de la pièce ; erreur pour une autre pièce. */
  getDetails(roomNumber: number): BarEntry {
    const entry = this.lists.find((e) => e.roomNumber === roomNumber);
    if (!entry) throw new Error(`pièce ${roomNumber} sans bar (détails du barman)`);
    return entry;
  }

  /** `BarmanLists::reset` (et `HotspotTickHandlers()`) : listes vides. */
  reset(): void {
    this.lists = defaultBarList();
    this.ewanXOffset = false;
  }

  /** `Hotspot::getBarPlace` : le client (`h`) a-t-il sa place au comptoir ? */
  getBarPlace(h: Hotspot): BarPlace {
    const entry = this.getDetails(h.roomNumber);

    if (h.actionCtr !== 0) {
      // Déjà au bar : sa place dans la liste.
      const own = entry.customers.find((c) => c.hotspotId === h.hotspotId);
      if (own) return (own.serveFlags & 0x80) === 0 ? "gotThere" : "keepTrying";
      h.actionCtr = 0;
      return "keepTrying";
    }

    // Chercher une place au comptoir.
    if (!this.findClearBarPlace(h, entry)) return "keepTrying";

    let index = entry.customers.findIndex((c) => c.hotspotId === h.hotspotId);
    if (index < 0) {
      index = entry.customers.findIndex((c) => c.hotspotId === 0);
      if (index < 0) return "keepTrying";
    }

    entry.customers[index] = { hotspotId: h.hotspotId, serveFlags: 0x82 };
    h.actionCtr = 1;
    h.updateMovement();
    h.setDirection(Direction.UP);
    return "keepTrying";
  }

  /** `Hotspot::findClearBarPlace` : vrai si le personnage est arrivé au comptoir, sinon il part vers 4 blocs libres de la ligne du bar. */
  private findClearBarPlace(h: Hotspot, entry: BarEntry): boolean {
    if (h.y + h.heightCopy < (entry.gridLine << 3) + 24) return true;

    const paths = this.ctx.world.requireRoom(h.roomNumber).paths;
    let numFree = 0;
    for (let xp = ROOM_PATHS_WIDTH - 1; xp >= 0; xp--) {
      if (pathOccupied(paths, xp, entry.gridLine)) numFree = 0;
      else if (++numFree === 4) {
        h.walkTo(xp * 8, (entry.gridLine << 3) + 8);
        return false;
      }
    }
    return false;
  }

  saveState(): BarSave {
    return {
      bars: this.lists.map((e) => ({ currentCustomer: e.currentCustomer, customers: e.customers.map((c) => ({ ...c })) })),
      ewanXOffset: this.ewanXOffset,
    };
  }

  /** `BarmanLists::loadFromStream` : repart de zéro puis relit ; sans état (ancienne sauvegarde) : listes vides. */
  restoreState(state: unknown): void {
    this.reset();
    const save = state as Partial<BarSave> | undefined;
    if (!save || !Array.isArray(save.bars)) return;
    save.bars.forEach((saved, i) => {
      const entry = this.lists[i];
      if (!entry || !saved) return;
      entry.currentCustomer =
        typeof saved.currentCustomer === "number" && saved.currentCustomer >= 0 && saved.currentCustomer < NUM_SERVE_CUSTOMERS ? saved.currentCustomer : null;
      saved.customers?.slice(0, NUM_SERVE_CUSTOMERS).forEach((c, ci) => {
        entry.customers[ci] = { hotspotId: c.hotspotId & 0xffff, serveFlags: c.serveFlags & 0xff };
      });
    });
    this.ewanXOffset = save.ewanXOffset === true;
  }
}
