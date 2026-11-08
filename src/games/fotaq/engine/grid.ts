/**
 * Zones cliquables de l'écran (`docs/fotaq/engine.md`, § 5) : boîtes des objets et des zones de marche de la pièce, cases du
 * panneau (verbes, flèches et objets de l'inventaire), échelle d'une zone. Réécriture de `Grid` (engines/queen/grid.cpp,
 * structs.h `Box`, `Area::calcScale`, ScummVM).
 *
 * Numérotation (comme ScummVM) : dans la pièce, les zones 1 à `objMax` sont les objets de la pièce (zone n = objet
 * `premier objet de la pièce + n`, qu'on appelle aussi « numéro dans la pièce »), puis viennent les zones de marche
 * (`objMax + n` = zone de marche n). Une boîte contient ses bords (`Box::contains`).
 *
 * Écarts : pas de limite de 32 zones (`MAX_ZONES_NUMBER`) ni de 11 zones de marche : le jeu en compte au plus 28 et 10 ; les zones
 * sont rangées dans des tableaux. Le correctif de ScummVM pour l'escalier de la pièce 41 (bug 2913) est reproduit.
 */

import type { Box, JasArea } from "../data/jas";
import { type GameData, type GameState, Verb, type World, toInt16 } from "./state";

/** Hauteur de la partie « pièce » de l'écran (`ROOM_ZONE_HEIGHT`) : le panneau est en dessous. */
export const ROOM_ZONE_HEIGHT = 150;

export const GridScreen = { Room: 0, Panel: 1 } as const;
export type GridScreen = (typeof GridScreen)[keyof typeof GridScreen];

/** Verbe de chaque zone du panneau (`Grid::findVerbUnderCursor`) : 1 à 8 verbes, 9 et 10 flèches, 11 à 14 cases d'inventaire. */
const PANEL_VERBS: number[] = [
  Verb.None,
  Verb.Open,
  Verb.Close,
  Verb.Move,
  Verb.Give,
  Verb.LookAt,
  Verb.PickUp,
  Verb.TalkTo,
  Verb.Use,
  Verb.ScrollUp,
  Verb.ScrollDown,
  Verb.Inventory1,
  Verb.Inventory1 + 1,
  Verb.Inventory1 + 2,
  Verb.Inventory4,
];

/** Pièce de l'escalier dont la boîte est corrigée (bug 2913 de ScummVM) : objet de l'escalier et du meuble qui le borne. */
const STAIRS_FIX = { room: 41, stairs: 303, cabinet: 295 };

export function boxContains(box: Box, x: number, y: number): boolean {
  return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2;
}

/**
 * Échelle des personnages à l'ordonnée `y` d'une zone de marche (`Area::calcScale`) : interpolation entre l'échelle du bas et
 * celle du haut, en entiers comme ScummVM (division tronquée, résultat sur 16 bits non signés) ; 0 devient 100.
 */
export function areaScale(area: JasArea, y: number): number {
  const dy = (area.box.y2 - area.box.y1) & 0xffff;
  const ds = toInt16(area.topScaleFactor - area.bottomScaleFactor);
  let scale = 0;
  if (dy !== 0) scale = (Math.trunc((Math.trunc(((y - area.box.y1) * 100) / dy) * ds) / 100) + area.bottomScaleFactor) & 0xffff;
  return scale === 0 ? 100 : scale;
}

export class Grid {
  /** Zones valides de chaque écran, par numéro (`_zones`) ; `undefined` : zone non valide. */
  private readonly zones: [(Box | undefined)[], (Box | undefined)[]] = [[], []];

  /** `world` : le moteur (ses `data` et son `state`, qui change au chargement d'une partie). */
  constructor(private readonly world: World) {}

  private get data(): GameData {
    return this.world.data;
  }

  private get state(): GameState {
    return this.world.state;
  }

  /** Nombre d'objets de la pièce (`_objMax`). */
  objMax(room: number): number {
    return this.data.jas.rooms[room]?.objectCount ?? 0;
  }

  /** Nombre de zones de marche de la pièce (`_areaMax`). */
  areaMax(room: number): number {
    return (this.state.areas[room]?.length ?? 1) - 1;
  }

  /** Zone de marche `n` de la pièce (`Grid::area`). */
  area(room: number, n: number): JasArea {
    const area = this.state.areas[room]?.[n];
    if (!area) throw new Error(`zone de marche ${n} absente de la pièce ${room}`);
    return area;
  }

  /** Boîte de la zone `n` de l'écran, ou `undefined` si elle n'est pas valide (`Grid::zone`). */
  zone(screen: GridScreen, n: number): Box | undefined {
    return this.zones[screen][n];
  }

  /** Zones valides de l'écran, par numéro (outils, rendu des zones de débogage). */
  validZones(screen: GridScreen): { n: number; box: Box }[] {
    const out: { n: number; box: Box }[] = [];
    this.zones[screen].forEach((box, n) => {
      if (box) out.push({ n, box });
    });
    return out;
  }

  setZone(screen: GridScreen, n: number, box: Box): void {
    this.zones[screen][n] = { ...box };
  }

  clear(screen: GridScreen): void {
    this.zones[screen] = [];
  }

  /**
   * Zones de la pièce (`Grid::setupNewRoom`) : une par objet de la pièce dont le nom n'est pas nul (objet supprimé), puis une par
   * zone de marche.
   */
  setupNewRoom(room: number): void {
    this.clear(GridScreen.Room);
    const { jas } = this.data;
    const first = jas.roomFirstObject[room];
    const objMax = this.objMax(room);
    for (let zone = 1; zone <= objMax; zone++) {
      const object = first + zone;
      if (this.state.objects[object].name === 0) continue;
      const box = jas.objectBoxes[object];
      if (room === STAIRS_FIX.room && object === STAIRS_FIX.stairs) {
        this.setZone(GridScreen.Room, zone, { ...box, y1: jas.objectBoxes[STAIRS_FIX.cabinet].y2 + 1 });
      } else {
        this.setZone(GridScreen.Room, zone, box);
      }
    }
    const areaMax = this.areaMax(room);
    for (let n = 1; n <= areaMax; n++) this.setZone(GridScreen.Room, objMax + n, this.state.areas[room][n].box);
  }

  /** Cases du panneau (`Grid::setupPanel`), en coordonnées du panneau (y à partir de 0 sous la pièce). */
  setupPanel(): void {
    this.clear(GridScreen.Panel);
    for (let i = 0; i <= 7; i++) this.setZone(GridScreen.Panel, i + 1, { x1: i * 20, y1: 10, x2: i * 20 + 19, y2: 49 });
    this.setZone(GridScreen.Panel, 9, { x1: 160, y1: 10, x2: 179, y2: 29 });
    this.setZone(GridScreen.Panel, 10, { x1: 160, y1: 30, x2: 179, y2: 49 });
    this.setZone(GridScreen.Panel, 11, { x1: 180, y1: 10, x2: 213, y2: 49 });
    this.setZone(GridScreen.Panel, 12, { x1: 214, y1: 10, x2: 249, y2: 49 });
    this.setZone(GridScreen.Panel, 13, { x1: 250, y1: 10, x2: 284, y2: 49 });
    this.setZone(GridScreen.Panel, 14, { x1: 285, y1: 10, x2: 320, y2: 49 });
  }

  /** Première zone valide qui contient le point (`findZoneForPos`) ; dans le panneau, `y` est en coordonnées d'écran. */
  findZoneForPos(screen: GridScreen, x: number, y: number): number {
    const py = screen === GridScreen.Panel ? y - ROOM_ZONE_HEIGHT : y;
    const zones = this.zones[screen];
    for (let n = 1; n < zones.length; n++) {
      const box = zones[n];
      if (box && boxContains(box, x, py)) return n;
    }
    return 0;
  }

  /** Zone de marche sous le point (décor) ; 0 si le point est sur un objet ou hors des zones (`findAreaForPos`). */
  findAreaForPos(x: number, y: number): number {
    const zone = this.findZoneForPos(GridScreen.Room, x, y);
    const objMax = this.objMax(this.state.room);
    return zone <= objMax ? 0 : zone - objMax;
  }

  /** Zone de la pièce sous le curseur (écran), en tenant compte du défilement (`findObjectUnderCursor`). */
  findObjectUnderCursor(cursorX: number, cursorY: number, scroll: number): number {
    return cursorY < ROOM_ZONE_HEIGHT ? this.findZoneForPos(GridScreen.Room, cursorX + scroll, cursorY) : 0;
  }

  /**
   * Numéro dans la pièce de l'objet d'une zone (`findObjectNumber`) : la zone elle-même pour un objet ; pour une zone de marche,
   * l'objet qu'elle porte (0 s'il n'y en a pas).
   */
  findObjectNumber(zone: number): number {
    const room = this.state.room;
    const objMax = this.objMax(room);
    if (zone <= objMax) return zone;
    const object = this.state.areas[room][zone - objMax]?.object ?? 0;
    return object === 0 ? 0 : object - this.data.jas.roomFirstObject[room];
  }

  /** Verbe (ou case, flèche) du panneau sous le curseur (`findVerbUnderCursor`). */
  findVerbUnderCursor(cursorX: number, cursorY: number): number {
    return PANEL_VERBS[this.findZoneForPos(GridScreen.Panel, cursorX, cursorY)] ?? Verb.None;
  }

  /** Échelle au point du décor (`findScale`) : celle de la zone de marche, 100 hors zone. */
  findScale(x: number, y: number): number {
    const n = this.findAreaForPos(x, y);
    return n === 0 ? 100 : areaScale(this.area(this.state.room, n), y);
  }
}
