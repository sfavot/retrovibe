import { type Character, type Hotspot, type Zone, HotspotType, LAYERS, Layer } from "../data/types";
import type { Assets } from "./assets";
import { Direction, type Point } from "./geometry";

export interface Monster {
  readonly index: number;
  readonly character: Character;
  x: number;
  y: number;
  enabled: boolean;
  damageTaken: number;
  facing: Direction;
  /** Ticks d'immobilité restants. */
  cooldown: number;
  preferredDirection: Direction;
  /** Compteur d'état propre à certains comportements. */
  phase: number;
  phaseFrames: number;
  /** Projectile en vol (ennemis armés). */
  bullet: { x: number; y: number; dx: number; dy: number; travelled: number } | null;
}

export const isAlive = (m: Monster): boolean => m.damageTaken < Math.max(1, m.character.health);

function initialHotspot(h: Hotspot): Hotspot {
  const copy = { ...h };
  switch (h.type) {
    // Ces emplacements ne servent que si la génération du monde leur attribue un objet.
    case HotspotType.DropQuestItem:
    case HotspotType.SpawnLocation:
    case HotspotType.DropUniqueWeapon:
    case HotspotType.DropMap:
      copy.enabled = false;
      break;
    case HotspotType.VehicleTo:
    case HotspotType.VehicleBack:
    case HotspotType.DoorIn:
    case HotspotType.Lock:
    case HotspotType.DropItem:
    case HotspotType.Npc:
    case HotspotType.DropWeapon:
      copy.enabled = true;
      break;
    default:
      copy.argument = -1;
      copy.enabled = true;
  }
  return copy;
}

/** État modifiable d'une zone pendant la partie (les données d'origine restent intactes). */
export class ZoneState {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: Int16Array;
  readonly hotspots: Hotspot[];
  readonly monsters: Monster[];
  readonly actionEnabled: boolean[];
  counter = 0;
  random = 0;
  /** Les scripts « première visite » ont tourné. */
  initialized = false;
  visited = false;
  /** Position de la porte par laquelle on est entré (pour ressortir d'une pièce). */
  doorInLocation: Point | null = null;

  constructor(
    readonly zone: Zone,
    assets: Assets,
  ) {
    this.id = zone.id;
    this.width = zone.width;
    this.height = zone.height;
    this.tiles = zone.tiles.slice();
    this.hotspots = zone.hotspots.map(initialHotspot);
    this.actionEnabled = zone.actions.map(() => true);
    this.monsters = zone.monsters.flatMap((m, index): Monster[] => {
      const character = assets.character(m.character);
      if (!character) return [];
      return [
        {
          index,
          character,
          x: m.x,
          y: m.y,
          enabled: true,
          damageTaken: 0,
          facing: Direction.Down,
          cooldown: 0,
          preferredDirection: Direction.Down,
          phase: 0,
          phaseFrames: 0,
          bullet: null,
        },
      ];
    });
  }

  get isRoom(): boolean {
    return this.width === 9;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getTile(x: number, y: number, layer: Layer | number): number {
    if (!this.inBounds(x, y) || layer < 0 || layer >= LAYERS) return -1;
    return this.tiles[LAYERS * (y * this.width + x) + layer];
  }

  setTile(x: number, y: number, layer: Layer | number, tile: number): void {
    if (!this.inBounds(x, y) || layer < 0 || layer >= LAYERS) return;
    this.tiles[LAYERS * (y * this.width + x) + layer] = tile < 0 ? -1 : tile;
  }

  monsterAt(x: number, y: number): Monster | undefined {
    return this.monsters.find((m) => m.enabled && isAlive(m) && m.x === x && m.y === y);
  }

  /** Case libre pour un déplacement : pas d'objet ni de monstre actif. */
  isFree(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.getTile(x, y, Layer.Object) === -1 && !this.monsterAt(x, y);
  }

  hotspotAt(x: number, y: number, type?: HotspotType): Hotspot | undefined {
    return this.hotspots.find((h) => h.x === x && h.y === y && (type === undefined || h.type === type));
  }
}

export interface ZoneSnapshot {
  id: number;
  tiles: number[];
  hotspots: Hotspot[];
  monsters: Array<Omit<Monster, "character"> & { character: number }>;
  actionEnabled: boolean[];
  counter: number;
  random: number;
  initialized: boolean;
  visited: boolean;
  doorInLocation: Point | null;
}

export function snapshotZone(z: ZoneState): ZoneSnapshot {
  return {
    id: z.id,
    tiles: Array.from(z.tiles),
    hotspots: z.hotspots.map((h) => ({ ...h })),
    monsters: z.monsters.map((m) => ({ ...m, character: m.character.id, bullet: m.bullet ? { ...m.bullet } : null })),
    actionEnabled: z.actionEnabled.slice(),
    counter: z.counter,
    random: z.random,
    initialized: z.initialized,
    visited: z.visited,
    doorInLocation: z.doorInLocation ? { ...z.doorInLocation } : null,
  };
}

export function restoreZone(z: ZoneState, s: ZoneSnapshot, assets: Assets): void {
  z.tiles.set(s.tiles);
  z.hotspots.splice(0, z.hotspots.length, ...s.hotspots.map((h) => ({ ...h })));
  z.monsters.splice(
    0,
    z.monsters.length,
    ...s.monsters.flatMap((m) => {
      const character = assets.character(m.character);
      return character ? [{ ...m, character }] : [];
    }),
  );
  z.actionEnabled.splice(0, z.actionEnabled.length, ...s.actionEnabled);
  z.counter = s.counter;
  z.random = s.random;
  z.initialized = s.initialized;
  z.visited = s.visited;
  z.doorInLocation = s.doorInLocation;
}

