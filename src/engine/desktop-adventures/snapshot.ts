import type { Assets } from "./assets";
import { HotspotType, LAYERS } from "./data/types";
import { Direction } from "./geometry";
import { type GameSnapshot, MAX_HEALTH } from "./game";
import { SectorKind, WORLD_SIZE, WorldSize } from "./world";
import type { Sector } from "./world";
import type { ZoneSnapshot } from "./zone-state";

/**
 * Validation d'une sauvegarde lue du stockage local (donc potentiellement forgée ou corrompue) contre les données du jeu.
 * Renvoie une copie reconstruite champ par champ (aucun champ inconnu ne passe), ou null si quoi que ce soit est incohérent :
 * l'appelant traite alors la sauvegarde comme absente. Une sauvegarde produite par `Game.snapshot()` est relue à l'identique.
 */
export function parseSnapshot(s: GameSnapshot | null, assets: Assets): GameSnapshot | null {
  if (s === null) return null;
  try {
    return check(s, assets);
  } catch (e) {
    if (e instanceof Invalid) return null;
    throw e;
  }
}

class Invalid extends Error {}

function fail(): never {
  throw new Invalid();
}

type Rec = Record<string, unknown>;

const isObject = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const MAX_COUNT = 1e9;

function obj(v: unknown): Rec {
  return isObject(v) ? v : fail();
}
function arr(v: unknown, max: number): unknown[] {
  return Array.isArray(v) && v.length <= max ? v : fail();
}
function bool(v: unknown): boolean {
  return typeof v === "boolean" ? v : fail();
}
/** Entier dans [min, max]. */
function int(v: unknown, min: number, max: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fail();
}
function num(v: unknown, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail();
}
const optional = <T>(v: unknown, fallback: T, read: (v: unknown) => T): T => (v === undefined ? fallback : read(v));

function check(raw: GameSnapshot, assets: Assets): GameSnapshot {
  const s = raw as unknown as Rec;
  const { zones, tiles, characters, puzzles } = assets.data;
  const tileId = (v: unknown) => int(v, -1, tiles.length - 1);
  const zoneIndex = (v: unknown) => int(v, 0, zones.length - 1);

  const story = checkStory(obj(s.story));
  const settings = obj(s.settings);
  const zoneSnapshots = arr(s.zones, zones.length).map((z) => checkZone(z));
  if (new Set(zoneSnapshots.map((z) => z.id)).size !== zoneSnapshots.length) fail();

  const zoneId = zoneIndex(s.zoneId);
  const zone = zones[zoneId];
  const hero = obj(s.hero);
  return {
    version: raw.version,
    story,
    settings: {
      difficulty: num(settings.difficulty, 0, 100),
      ...(settings.gamesWon === undefined ? {} : { gamesWon: int(settings.gamesWon, 0, MAX_COUNT) }),
    },
    zones: zoneSnapshots,
    zoneId,
    hero: {
      x: int(hero.x, 0, zone.width - 1),
      y: int(hero.y, 0, zone.height - 1),
      facing: optional(hero.facing, Direction.Down, (v) => int(v, Direction.Up, Direction.Right)),
      visible: optional(hero.visible, true, bool),
      health: num(hero.health, 0, MAX_HEALTH),
      walkFrame: optional(hero.walkFrame, 0, (v) => int(v, 0, MAX_COUNT)),
    },
    inventory: arr(s.inventory, 10_000).map((t) => int(t, 0, tiles.length - 1)),
    weapon: int(s.weapon, -1, characters.length - 1),
    gameWon: bool(s.gameWon),
    playedMs: num(s.playedMs, 0, Number.MAX_SAFE_INTEGER),
    difficultySum: num(s.difficultySum, 0, Number.MAX_SAFE_INTEGER),
    difficultyCount: int(s.difficultyCount, 0, MAX_COUNT),
  };

  function checkStory(st: Rec): GameSnapshot["story"] {
    const sectors = (v: unknown) => arr(v, WORLD_SIZE * WORLD_SIZE).map((x) => (x === null ? null : checkSector(obj(x))));
    const checkSector = (x: Rec): Sector => ({
      zoneId: zoneIndex(x.zoneId),
      kind: (Object.values(SectorKind) as unknown[]).includes(x.kind) ? (x.kind as SectorKind) : fail(),
      requiredItem: tileId(x.requiredItem),
      additionalRequiredItem: optional(x.additionalRequiredItem, -1, tileId),
      findItem: tileId(x.findItem),
      npc: tileId(x.npc),
      puzzle: int(x.puzzle, -1, puzzles.length - 1),
      offerPuzzle: int(x.offerPuzzle, -1, puzzles.length - 1),
      solved: bool(x.solved),
      visited: bool(x.visited),
    });
    const dagobah = st.dagobah === undefined ? undefined : sectors(st.dagobah);
    // Champs propres à l'histoire de Yoda (`YodaStory`) : facultatifs ici comme `dagobah`, mais conservés s'ils sont présents
    // (la planète sert à ne pas retirer la même à la partie suivante).
    const yoda: Rec = {};
    if (st.planet !== undefined) yoda.planet = int(st.planet, 0, 0xff);
    if (st.puzzleChains !== undefined) {
      yoda.puzzleChains = arr(st.puzzleChains, 2).map((chain) => arr(chain, puzzles.length).map((p) => int(p, -1, puzzles.length - 1)));
      if ((yoda.puzzleChains as unknown[]).length !== 2) fail();
    }
    // Départ de la partie (`START` : zone de chargement) : lu seulement au lancement, jamais à la reprise. La position ne tient
    // pas dans les dimensions de cette zone, on ne la borne donc qu'à une taille de zone.
    if (st.startZone !== undefined) yoda.startZone = zoneIndex(st.startZone);
    if (st.startPosition !== undefined) {
      const at = obj(st.startPosition);
      yoda.startPosition = { x: int(at.x, 0, 0xff), y: int(at.y, 0, 0xff) };
    }
    return {
      ...yoda,
      seed: int(st.seed, 0, Number.MAX_SAFE_INTEGER),
      size: (Object.values(WorldSize) as unknown[]).includes(st.size) ? (st.size as WorldSize) : fail(),
      sectors: sectors(st.sectors),
      goalPuzzle: int(st.goalPuzzle, -1, puzzles.length - 1),
      hotspotArguments: arr(st.hotspotArguments, zones.length).map((entry) => {
        const [zId, list] = arr(entry, 2) as [unknown, unknown];
        const z = zones[zoneIndex(zId)];
        const pairs = arr(list, z.hotspots.length).map((p) => {
          const [index, argument] = arr(p, 2) as [unknown, unknown];
          return [int(index, 0, z.hotspots.length - 1), int(argument, -1, MAX_COUNT)] as [number, number];
        });
        return [z.id, pairs] as [number, Array<[number, number]>];
      }),
      pace: int(st.pace, 0, MAX_COUNT),
      startItem: tileId(st.startItem),
      ...(dagobah ? { dagobah } : {}),
    };
  }

  function checkZone(v: unknown): ZoneSnapshot {
    const z = obj(v);
    const data = zones[zoneIndex(z.id)];
    const tileValues = arr(z.tiles, data.tiles.length);
    if (tileValues.length !== data.width * data.height * LAYERS) fail();
    const door = z.doorInLocation;
    const pointIn = (p: unknown) => {
      const o = obj(p);
      return { x: int(o.x, 0, data.width - 1), y: int(o.y, 0, data.height - 1) };
    };
    const hotspots = arr(z.hotspots, data.hotspots.length);
    if (hotspots.length !== data.hotspots.length) fail();
    const actionEnabled = arr(z.actionEnabled, data.actions.length);
    if (actionEnabled.length !== data.actions.length) fail();
    return {
      id: data.id,
      tiles: tileValues.map(tileId),
      hotspots: hotspots.map((h) => {
        const o = obj(h);
        return {
          type: (Object.values(HotspotType) as unknown[]).includes(o.type) ? (o.type as HotspotType) : fail(),
          x: int(o.x, 0, data.width - 1),
          y: int(o.y, 0, data.height - 1),
          enabled: bool(o.enabled),
          argument: int(o.argument, -1, MAX_COUNT),
        };
      }),
      monsters: arr(z.monsters, data.monsters.length).map((m) => {
        const o = obj(m);
        const bullet = o.bullet === null ? null : obj(o.bullet);
        return {
          index: int(o.index, 0, data.monsters.length - 1),
          character: int(o.character, 0, characters.length - 1),
          x: int(o.x, -MAX_COUNT, MAX_COUNT),
          y: int(o.y, -MAX_COUNT, MAX_COUNT),
          enabled: bool(o.enabled),
          damageTaken: num(o.damageTaken, 0, MAX_COUNT),
          facing: int(o.facing, Direction.Up, Direction.Right),
          cooldown: int(o.cooldown, 0, MAX_COUNT),
          preferredDirection: int(o.preferredDirection, Direction.Up, Direction.Right),
          phase: int(o.phase, -MAX_COUNT, MAX_COUNT),
          phaseFrames: int(o.phaseFrames, -MAX_COUNT, MAX_COUNT),
          bullet: bullet && {
            x: num(bullet.x, -MAX_COUNT, MAX_COUNT),
            y: num(bullet.y, -MAX_COUNT, MAX_COUNT),
            dx: int(bullet.dx, -1, 1),
            dy: int(bullet.dy, -1, 1),
            travelled: int(bullet.travelled, 0, MAX_COUNT),
          },
        };
      }),
      actionEnabled: actionEnabled.map(bool),
      counter: int(z.counter, -MAX_COUNT, MAX_COUNT),
      ...(z.sectorCounter === undefined ? {} : { sectorCounter: int(z.sectorCounter, -MAX_COUNT, MAX_COUNT) }),
      random: int(z.random, -MAX_COUNT, Number.MAX_SAFE_INTEGER),
      initialized: bool(z.initialized),
      visited: bool(z.visited),
      doorInLocation: door === null || door === undefined ? null : pointIn(door),
    };
  }
}
