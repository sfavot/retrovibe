import type { Assets } from "../../../engine/desktop-adventures/assets";
import { type Puzzle, type Zone, HotspotType, PuzzleType, TileFlag, ZoneType } from "../../../engine/desktop-adventures/data/types";
import { Cell, type Layout, distanceToCenter, generateLayout } from "../../../engine/desktop-adventures/generation/layout";
import { Rng } from "../../../engine/desktop-adventures/rng";
import { type Sector, SectorKind, type Story, WORLD_SIZE, WorldSize, emptySector } from "../../../engine/desktop-adventures/world";
import { GOAL_UNLOCK_WINS, MISSION_PLANETS, START, TileIds } from "../ids";
import { generateDagobah } from "./dagobah";

/**
 * Générateur de monde de Yoda Stories : portage fidèle de `WorldGenerator` de WebFun (MIT), qui reproduit l'original.
 * L'ordre des tirages dans le générateur congruentiel est celui de WebFun (y compris le mélange maison, voir `shuffle`) :
 * une graine, une planète et une taille donnent le même monde que le jeu d'origine.
 *
 * Les objets WebFun sont ici des identifiants : `NONE` (-1) joue le rôle de `null`.
 */

const NONE = -1;
/** Tirage d'un puzzle de mission : WebFun le type `PlaceholderForEndPuzzle`. */
const MISSION = "mission";
type WantedType = ZoneType | typeof MISSION;

export class YodaGenerationError extends Error {
  constructor(
    message: string,
    readonly seed = 0,
    readonly size: WorldSize = WorldSize.Medium,
    readonly planet = 0,
    readonly history: { seed: number; error: Error }[] = [],
  ) {
    super(message);
  }
}

export interface YodaStory extends Story {
  planet: number;
  /** Dagobah : 100 cases, seules (4,4), (5,4), (4,5) et (5,5) sont remplies. */
  dagobah: (Sector | null)[];
  /** Zone de départ (Dagobah, secteur sud-ouest). */
  startZone: number;
  startPosition: { x: number; y: number };
  /** Chaînes de puzzles `[strain1, strain2]` (WebFun `story.puzzles`) : `sector.puzzle` y pioche à l'index `puzzleIndex`. */
  puzzleChains: [number[], number[]];
}

export interface YodaOptions {
  /** Planète de la partie précédente : exclue du tirage. */
  lastPlanet?: number;
  /** Planète imposée (rejouer une partie) ; sinon tirée de la graine parmi Endor, Hoth et Tatooine. */
  planet?: number;
  /** Parties gagnées : « Sauver Yoda » est tirable dès 1, « Car » dès 10. */
  gamesWon?: number;
  /** Puzzle de mission imposé (rejouer une partie) : ignore les victoires nécessaires. */
  goal?: number;
  /** Nombre d'essais avant d'abandonner (WebFun : 10). */
  maxTries?: number;
}

/** Génère une partie de Yoda Stories : monde, Dagobah et chaînes de puzzles. */
export function generateYodaStory(assets: Assets, seed: number, size: WorldSize, options: YodaOptions = {}): YodaStory {
  const { lastPlanet, gamesWon = 0, goal, maxTries = 10 } = options;
  let candidates = MISSION_PLANETS.filter((p) => p !== lastPlanet);
  if (!candidates.length) candidates = [...MISSION_PLANETS];
  // WebFun tire la planète avec Math.random : on la dérive de la graine, sur un flux à part.
  const planet = options.planet ?? candidates[new Rng(Math.imul(seed, 0x9e3779b1)).mod(candidates.length)];

  const disabled = new Set<number>();
  if (goal === undefined) {
    for (const [id, wins] of Object.entries(GOAL_UNLOCK_WINS)) if (gamesWon < wins) disabled.add(Number(id));
  }

  const history: { seed: number; error: Error }[] = [];
  let effectiveSeed = seed;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const rng = new Rng(effectiveSeed);
    try {
      const story = new WorldGenerator(assets, rng, planet, size, effectiveSeed, disabled, goal).generate();
      return { ...story, seed };
    } catch (error) {
      if (!(error instanceof YodaGenerationError)) throw error;
      history.push({ seed: effectiveSeed, error });
    }
    // Comme WebFun : le nouvel essai repart d'un tirage pris dans la suite où le précédent s'est arrêté.
    effectiveSeed = rng.next();
  }
  throw new YodaGenerationError("Trop de relances", seed, size, planet, history);
}

interface Quest {
  item: number;
  distance: number;
}

/** Secteur en construction (champs de `Sector` de WebFun). */
interface Placed {
  zoneId: number;
  type: ZoneType;
  puzzleIndex: number;
  usedAlternateStrain: boolean;
  requiredItem: number;
  findItem: number;
  npc: number;
  additionalRequiredItem: number;
  additionalGainItem: number;
}

interface PlaceOptions {
  puzzleIndex?: number;
  requiredItem?: number;
  npc?: number;
  findItem?: number;
  additionalRequiredItem?: number;
  additionalGainItem?: number;
}

/**
 * Mélange de WebFun (`Array.prototype.shuffle`) : deux passes de tirages `rand() % n` dans un tableau temporaire.
 * Ce n'est pas un Fisher-Yates : il faut le refaire tel quel pour garder la suite des tirages.
 */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const source: (T | undefined)[] = items.slice();
  const count = source.length;
  if (count === 0) return [];
  if (count === 1) {
    rng.next();
    return source as T[];
  }
  const temp: (T | undefined)[] = new Array(count).fill(undefined);
  for (let i = 0; i < count; i++) {
    const index = rng.next() % count;
    if (temp[index] === undefined) {
      temp[index] = source[i];
      source[i] = undefined;
    }
  }
  for (let i = count - 1; i !== 0; i--) {
    while (temp.includes(undefined)) {
      const index = rng.next() % count;
      if (temp[index] === undefined) {
        temp[index] = source[i];
        source[i] = undefined;
        break;
      }
    }
  }
  return temp as T[];
}

class WorldGenerator {
  private readonly zones: Zone[];
  private readonly zonesByType = new Map<ZoneType, Zone[]>();
  private readonly sectors: (Placed | null)[] = new Array(WORLD_SIZE * WORLD_SIZE).fill(null);
  private readonly hotspotArguments = new Map<number, Map<number, number>>();
  private readonly usedZones = new Set<number>();
  private readonly usedPuzzles: Puzzle[] = [];
  private providedItemQuests: Quest[] = [];
  private requiredItemQuests: Quest[] = [];
  private puzzleStrain1: (Puzzle | null)[] = [];
  private puzzleStrain2: (Puzzle | null)[] = [];
  private layout!: Layout;

  // État transmis de `getUnusedZone` à `placeZone` (champs de WebFun).
  private requiredItem = NONE;
  private findItem = NONE;
  private npc = NONE;
  private additionalRequiredItem = NONE;
  private additionalFindItem = NONE;
  private currentPuzzleIndex = -1;
  private usedAlternateStrain = false;
  /** -1 au départ (vrai en JS comme dans WebFun) puis 0 ou 1 pendant `determineTeleporters`. */
  private somethingWithTeleporters = -1;

  constructor(
    private readonly assets: Assets,
    private readonly rng: Rng,
    private readonly planet: number,
    private readonly size: WorldSize,
    private readonly seed: number,
    private readonly disabledGoals: ReadonlySet<number>,
    private readonly forcedGoal: number | undefined,
  ) {
    this.zones = assets.data.zones.filter((z) => z.planet === planet);
  }

  generate(): YodaStory {
    const layout = (this.layout = generateLayout(this.rng, this.size));
    const { puzzleCount, order } = layout;
    const puzzles1Count = Math.floor(puzzleCount % 2 === 1 ? (puzzleCount + 1) / 2 : puzzleCount / 2 + 1);
    const puzzles2Count = Math.floor(puzzleCount % 2 === 1 ? (puzzleCount + 1) / 2 : puzzleCount / 2);
    this.puzzleStrain1 = new Array(puzzles1Count + 1).fill(null);
    this.puzzleStrain2 = new Array(puzzles2Count + 1).fill(null);

    const goal = this.getUnusedPuzzleRandomly(NONE, MISSION);
    this.errorWhen(!goal, "Aucun puzzle de mission réalisable");
    this.usedPuzzles.push(goal!);
    this.puzzleStrain1[puzzles1Count] = goal!;
    this.puzzleStrain2[puzzles2Count] = goal!;

    this.determineTransportZones();
    this.determineGoalZone(puzzleCount, puzzles2Count, order);
    this.determineQuestZones(puzzleCount, order);
    this.placePuzzlesZones(puzzles2Count - 1, order);
    this.determineBlockadeAndTownZones(layout.cells);

    this.addProvidedItemQuest(TileIds.TheForce, 2);
    this.addProvidedItemQuest(TileIds.Locator, 1);
    this.determineFindZones(layout.cells);
    this.determineTeleporters(layout.cells);
    this.rng.next(); // tirage perdu, comme dans l'original

    const chains = [this.puzzleStrain1, this.puzzleStrain2].map((chain) =>
      chain.map((p) => {
        if (!p) throw this.error("Chaîne de puzzles incomplète");
        return p.id;
      }),
    ) as [number[], number[]];
    const startItem = this.itemOf(this.puzzleStrain2[0]);

    const dagobah = generateDagobah(this.assets, this.rng, goal!.id, startItem);
    for (const [zoneId, map] of dagobah.hotspotArguments) this.hotspotArguments.set(zoneId, map);

    const sectors = this.sectors.map((placed): Sector | null => {
      if (!placed) return null;
      const chain = placed.usedAlternateStrain ? chains[0] : chains[1];
      const sector = emptySector(placed.zoneId, kindOf(placed.type));
      sector.requiredItem = placed.requiredItem;
      sector.additionalRequiredItem = placed.additionalRequiredItem;
      sector.findItem = placed.findItem;
      sector.npc = placed.npc;
      if (placed.puzzleIndex >= 0) {
        sector.puzzle = chain[placed.puzzleIndex] ?? -1;
        sector.offerPuzzle = chain[placed.puzzleIndex + 1] ?? -1;
      }
      return sector;
    });

    return {
      seed: this.seed,
      size: this.size,
      sectors,
      goalPuzzle: goal!.id,
      hotspotArguments: this.hotspotArguments,
      pace: chains[0].length + chains[1].length + 2 * (layout.blockades + layout.travels),
      startItem,
      planet: this.planet,
      dagobah: dagobah.sectors,
      startZone: START.zone,
      startPosition: { ...START.position },
      puzzleChains: chains,
    };
  }

  // ------------------------------------------------------------ étapes

  private determineTransportZones(): void {
    const cells = this.layout.cells;
    const isTravelTarget = (x: number, y: number) => cells[x + y * 10] === Cell.TravelEnd && !this.sectors[x + y * 10];
    // Îles à gauche, en haut, à droite puis en bas : colonne ou ligne parcourue de 0 à 9.
    const sides: ((i: number) => [number, number])[] = [(i) => [0, i], (i) => [i, 0], (i) => [9, i], (i) => [i, 9]];

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        if (cells[x + y * 10] !== Cell.TravelStart) continue;
        this.resetState();

        const zone = this.getUnusedZoneRandomly(ZoneType.TravelStart, -1, -1, NONE, NONE, distanceToCenter(x, y), false);
        this.errorWhen(!zone, "Zone de départ de voyage introuvable");
        this.placeZone(x, y, zone!, { requiredItem: this.requiredItem });

        const vehicle = zone!.hotspots.find((h) => h.type === HotspotType.VehicleTo);
        const connected = this.lookupZone(vehicle ? vehicle.argument : -1);
        this.errorWhen(!connected, "Zone d'arrivée de voyage introuvable");

        let target: [number, number] | undefined;
        for (const side of sides) {
          for (let i = 0; i < 10 && !target; i++) {
            const [tx, ty] = side(i);
            if (isTravelTarget(tx, ty)) target = [tx, ty];
          }
          if (target) break;
        }
        this.errorWhen(!target, "Emplacement d'arrivée de voyage introuvable");
        this.errorWhen(this.usedZones.has(connected!.id), "Zone d'arrivée déjà utilisée par un autre voyage");
        this.placeZone(target![0], target![1], connected!, { requiredItem: this.requiredItem });
      }
    }
  }

  private determineBlockadeAndTownZones(cells: Cell[]): void {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const type = zoneTypeForCell(cells[x + 10 * y]);
        if (!(isBlockadeType(type) || type === ZoneType.Town)) continue;
        this.resetState();

        const distance = distanceToCenter(x, y);
        let zone = this.getUnusedZoneRandomly(type, -1, -1, NONE, NONE, distance, false);
        if (!zone) zone = this.getUnusedZoneRandomly(ZoneType.Empty, -1, -1, NONE, NONE, distance, false);
        this.errorWhen(!zone, "Aucune zone vide inutilisée");
        this.placeZone(x, y, zone!, type === ZoneType.Town ? {} : { requiredItem: this.requiredItem });
      }
    }
  }

  private findPositionOfPuzzle(orderIndex: number, order: number[]): { x: number; y: number } | null {
    const index = order.indexOf(orderIndex);
    return index < 0 ? null : { x: index % 10, y: Math.floor(index / 10) };
  }

  private placePuzzlesZones(puzzleMapIndex: number, order: number[]): void {
    for (let puzzleIndex = puzzleMapIndex; puzzleIndex > 0; puzzleIndex--) {
      this.resetState();
      const point = this.findPositionOfPuzzle(puzzleIndex - 1, order);
      this.errorWhen(!point, "Emplacement de puzzle introuvable");
      const distance = distanceToCenter(point!.x, point!.y);
      const item1 = this.itemOf(this.puzzleStrain2[puzzleIndex]);

      let type: ZoneType = this.rng.next() % 2 ? ZoneType.Trade : ZoneType.Use;
      let zone = this.getUnusedZoneRandomly(type, puzzleIndex - 1, -1, item1, NONE, distance, false);
      if (!zone) {
        type = type === ZoneType.Trade ? ZoneType.Use : ZoneType.Trade;
        zone = this.getUnusedZoneRandomly(type, puzzleIndex - 1, -1, item1, NONE, distance, false);
      }
      this.errorWhen(!zone, "Zone de puzzle introuvable");

      this.placeZone(point!.x, point!.y, zone!, {
        findItem: this.findItem,
        puzzleIndex: this.currentPuzzleIndex,
        requiredItem: this.requiredItem,
        npc: this.npc,
      });
      this.currentPuzzleIndex = -1;
    }
  }

  private determineGoalZone(puzzleCount: number, puzzles2Count: number, order: number[]): void {
    this.resetState();
    const puzzle = this.puzzleStrain1[this.puzzleStrain1.length - 1]!;
    const pos = this.findPositionOfPuzzle(puzzleCount - 1, order);
    this.errorWhen(!pos, "Emplacement de l'objectif introuvable");
    const distance = distanceToCenter(pos!.x, pos!.y);
    const zone = this.getUnusedZoneRandomly(
      ZoneType.Goal,
      this.puzzleStrain1.length - 2,
      puzzles2Count - 1,
      this.tileOrNone(puzzle.item),
      this.tileOrNone(puzzle.item2),
      distance,
      true,
    );
    this.errorWhen(!zone, "Zone d'objectif introuvable");
    this.placeZone(pos!.x, pos!.y, zone!, {
      findItem: this.findItem,
      puzzleIndex: this.currentPuzzleIndex,
      requiredItem: this.requiredItem,
      npc: NONE,
      // Le troisième puzzle utilisé, comme dans l'original (et non le dernier de la chaîne).
      additionalRequiredItem: this.usedPuzzles[2] ? this.tileOrNone(this.usedPuzzles[2].item) : NONE,
      additionalGainItem: this.additionalFindItem,
    });
  }

  private resetState(): void {
    this.requiredItem = NONE;
    this.findItem = NONE;
    this.npc = NONE;
    this.currentPuzzleIndex = -1;
    this.additionalRequiredItem = NONE;
    this.additionalFindItem = NONE;
  }

  private determineQuestZones(puzzleCount: number, order: number[]): void {
    let previousPuzzleIndex = puzzleCount - 1;
    for (let puzzleIdIndex = this.puzzleStrain1.length - 2; puzzleIdIndex > 0; puzzleIdIndex--) {
      this.resetState();
      const pos = this.findPositionOfPuzzle(previousPuzzleIndex - 1, order);
      this.errorWhen(!pos, "Emplacement du puzzle précédent introuvable");
      const distance = distanceToCenter(pos!.x, pos!.y);
      const item1 = this.itemOf(this.puzzleStrain1[puzzleIdIndex]);

      let type: ZoneType = this.rng.next() % 2 ? ZoneType.Use : ZoneType.Trade;
      let zone = this.getUnusedZoneRandomly(type, puzzleIdIndex - 1, -1, item1, NONE, distance, true);
      if (!zone) {
        type = type === ZoneType.Trade ? ZoneType.Use : ZoneType.Trade;
        zone = this.getUnusedZoneRandomly(type, puzzleIdIndex - 1, -1, item1, NONE, distance, true);
      }
      this.errorWhen(!zone, `Zone de puzzle introuvable en ${pos!.x}x${pos!.y}`);

      this.placeZone(pos!.x, pos!.y, zone!, {
        findItem: this.findItem,
        puzzleIndex: this.currentPuzzleIndex,
        requiredItem: this.requiredItem,
        npc: this.npc,
        additionalRequiredItem: this.additionalRequiredItem,
      });
      if (puzzleIdIndex === 1) {
        this.addProvidedItemQuest(this.requiredItem, distance);
        break;
      }
      previousPuzzleIndex--;
    }
  }

  private determineFindZones(cells: Cell[]): void {
    for (const quest of this.providedItemQuests) {
      const candidates = this.determinePuzzleLocationChoices(cells, quest.distance);
      this.errorWhen(!candidates, `Aucun emplacement pour l'objet ${quest.item}`);
      const point = candidates![this.rng.next() % candidates!.length];
      this.errorWhen(!point, `Aucun emplacement pour l'objet ${quest.item}`);

      const zone = this.getUnusedZoneRandomly(ZoneType.Find, -1, -1, quest.item, NONE, quest.distance, false);
      this.errorWhen(!zone, "Aucune zone pour l'objet à trouver");
      this.placeZone(point.x, point.y, zone!, { findItem: this.findItem });
      cells[point.x + 10 * point.y] = Cell.Puzzle;
    }
  }

  private determineTeleporters(cells: Cell[]): void {
    let teleporterSource: { x: number; y: number } | null = null;
    let lastZone: Zone | null = null;
    let foundTeleporterTarget = false;
    let teleportersFound = 0;

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const cell = cells[x + 10 * y];
        if (cell !== Cell.Empty && cell !== Cell.Candidate && cell !== Cell.Island) continue;

        const distance = distanceToCenter(x, y);
        this.somethingWithTeleporters = +(cell === Cell.Island || distance < 2);

        let zone: Zone | null | undefined;
        if (this.somethingWithTeleporters || !foundTeleporterTarget) {
          zone = this.getUnusedZoneRandomly(ZoneType.Empty, -1, -1, NONE, NONE, distance, false);
        } else zone = lastZone;

        this.errorWhen(!zone, "Aucune zone trouvée");
        let iterationLimit = 5000;
        while (true) {
          iterationLimit--;
          this.errorWhen(iterationLimit === 0, "Nombre maximal d'itérations dépassé");
          if (this.somethingWithTeleporters) break;
          if (!zone!.hotspots.some((h) => h.type === HotspotType.Teleporter)) break;

          if (!teleportersFound) {
            teleportersFound++;
            teleporterSource = { x, y };
            break;
          }

          const gap = this.size === WorldSize.Large ? 2 : 1;
          if (Math.abs(teleporterSource!.x - x) > gap || Math.abs(teleporterSource!.y - y) > gap) {
            teleportersFound++;
            teleporterSource = { x, y };
            if (!foundTeleporterTarget) break;
            foundTeleporterTarget = false;
            lastZone = null;
            break;
          }

          lastZone = zone!;
          foundTeleporterTarget = true;
          zone = this.getUnusedZoneRandomly(ZoneType.Empty, -1, -1, NONE, NONE, gap, false);
          this.errorWhen(!zone, "Aucune zone trouvée");
        }
        this.placeZone(x, y, zone!);
      }
    }

    if (teleportersFound === 1) {
      this.somethingWithTeleporters = 1;
      const { x, y } = teleporterSource!;
      const zone = this.getUnusedZoneRandomly(ZoneType.Empty, -1, -1, NONE, NONE, distanceToCenter(x, y), false);
      if (zone) this.placeZone(x, y, zone);
    }
  }

  // ------------------------------------------------------------ choix de zones et de puzzles

  private getUnusedPuzzleRandomly(item: number, zoneType: WantedType): Puzzle | null {
    const puzzleType = toPuzzleType(zoneType);
    const puzzles = shuffle(this.rng, this.getPuzzleCandidates(zoneType));
    const hasRequiredItem = (p: Puzzle) => zoneType === MISSION || this.tileOrNone(p.item) === item;
    return puzzles.find((p) => p.type === puzzleType && !this.usedPuzzles.includes(p) && hasRequiredItem(p)) ?? null;
  }

  private getPuzzleCandidates(zoneType: WantedType): Puzzle[] {
    return this.assets.data.puzzles.filter((puzzle) => {
      switch (zoneType) {
        case ZoneType.Find:
        case ZoneType.FindUniqueWeapon:
          return false;
        case ZoneType.Trade:
        case ZoneType.Use:
        case ZoneType.Goal:
          return !this.usedPuzzles.includes(puzzle) && puzzle.type === toPuzzleType(zoneType);
        case MISSION:
          return (
            puzzle.type === PuzzleType.Mission &&
            !this.disabledGoals.has(puzzle.id) &&
            (this.forcedGoal === undefined || puzzle.id === this.forcedGoal) &&
            this.isGoalOnPlanet(puzzle)
          );
        default:
          return true;
      }
    });
  }

  private isGoalOnPlanet(puzzle: Puzzle): boolean {
    return this.assets.data.zones.some(
      (zone) =>
        zone.type === ZoneType.Goal &&
        zone.planet === this.planet &&
        this.zoneLeadsToProvidedItem(zone, this.tileOrNone(puzzle.item)) &&
        this.zoneLeadsToProvidedItem(zone, this.tileOrNone(puzzle.item2)),
    );
  }

  private getUnusedZoneRandomly(
    zoneType: ZoneType,
    puzzleIndex: number,
    puzzleIndex2: number,
    providedItem: number,
    providedItem2: number,
    distance: number,
    useAlternateStrain: boolean,
  ): Zone | null {
    this.usedAlternateStrain = useAlternateStrain;
    const usable = shuffle(this.rng, this.getZonesForType(zoneType));
    return (
      usable
        .filter((zone) => !this.usedZones.has(zone.id))
        .find((zone) => this.getUnusedZone(zone, puzzleIndex, puzzleIndex2, providedItem, providedItem2, distance, useAlternateStrain)) ??
      null
    );
  }

  private getZonesForType(type: ZoneType): Zone[] {
    let result = this.zonesByType.get(type);
    if (result) return result;
    const find = type === ZoneType.Find || type === ZoneType.FindUniqueWeapon;
    result = this.zones.filter((z) => (find ? z.type === ZoneType.Find || z.type === ZoneType.FindUniqueWeapon : z.type === type));
    this.zonesByType.set(type, result);
    if (find) {
      this.zonesByType.set(ZoneType.Find, result);
      this.zonesByType.set(ZoneType.FindUniqueWeapon, result);
    }
    return result;
  }

  /** Essaie de donner un rôle à `zone` ; les effets de bord (quêtes, puzzles) restent même en cas d'échec, comme dans WebFun. */
  private getUnusedZone(
    zone: Zone,
    puzzleIndex: number,
    puzzleIndex2: number,
    providedItem: number,
    providedItem2: number,
    distance: number,
    useAlternateStrain: boolean,
  ): boolean {
    switch (zone.type) {
      case ZoneType.Town:
        return true;
      case ZoneType.BlockadeNorth:
      case ZoneType.TravelStart:
      case ZoneType.BlockadeWest:
      case ZoneType.BlockadeSouth:
      case ZoneType.BlockadeEast:
      case ZoneType.TravelEnd: {
        if (!this.requiredItemForZoneWasNotPlaced(zone)) return false;
        const candidates = zone.requiredItems.filter((id) => !this.hasQuestRequiringItem(id));
        if (candidates.length === 0) return false;
        const item = candidates[this.rng.next() % candidates.length];
        this.addProvidedItemQuest(item, zone.type === ZoneType.TravelStart ? 5 : distance);
        this.addRequiredItemQuest(item, distance);
        this.requiredItem = item;
        this.addRequiredItemQuestsFromHotspots(zone);
        return true;
      }
      case ZoneType.Empty:
        // Tant que les téléporteurs ne sont pas traités (valeur -1) ou sur une île : seulement les zones sans aucun hotspot.
        if (this.somethingWithTeleporters) return zone.hotspots.length === 0;
        return true;
      case ZoneType.Goal:
        return this.tryGoalZone(zone, puzzleIndex, puzzleIndex2, providedItem, providedItem2, distance);
      case ZoneType.Use: {
        if (!this.zoneLeadsToProvidedItem(zone, providedItem)) return false;
        const requiredItem = this.getUnusedRequiredItemForZoneRandomly(zone, false);
        if (requiredItem === NONE) return false;
        const puzzle = this.getUnusedPuzzleRandomly(requiredItem, ZoneType.Use);
        if (!puzzle) return false;

        this.usedAlternateStrain = useAlternateStrain;
        const array = useAlternateStrain ? this.puzzleStrain1 : this.puzzleStrain2;
        array[puzzleIndex] = puzzle;
        const p1 = this.itemOf(array[puzzleIndex]);
        const p2 = this.itemOf(array[puzzleIndex + 1]);
        this.currentPuzzleIndex = puzzleIndex;
        this.addRequiredItemQuest(p1, distance);
        this.addRequiredItemQuest(p2, distance);

        if (!this.requiredItemForZoneWasNotPlaced(zone)) {
          this.removeQuestRequiringItem(p1);
          return false;
        }
        if (this.dropItemAtLockHotspot(zone, p1)) {
          this.addRequiredItemQuest(p1, distance);
          this.requiredItem = p1;
          if (this.placeQuestItem(zone, p2)) {
            this.addRequiredItemQuest(p2, distance);
            this.findItem = p2;
          }
        }
        this.addRequiredItemQuestsFromHotspots(zone);
        this.usedPuzzles.push(puzzle);
        this.addRequiredItemQuest(requiredItem, distance);
        return true;
      }
      case ZoneType.Trade: {
        if (!this.zoneLeadsToProvidedItem(zone, providedItem)) return false;
        const puzzleItem = this.getUnusedRequiredItemForZoneRandomly(zone, false);
        if (puzzleItem === NONE) return false;
        const puzzle = this.getUnusedPuzzleRandomly(puzzleItem, ZoneType.Trade);
        if (!puzzle) return false;

        this.usedAlternateStrain = useAlternateStrain;
        const array = useAlternateStrain ? this.puzzleStrain1 : this.puzzleStrain2;
        array[puzzleIndex] = puzzle;
        if (!this.requiredItemForZoneWasNotPlaced(zone)) return false;
        const npc = this.findUnusedNpcForZoneRandomly(zone);
        if (npc === NONE) return false;

        const requiredItem = this.itemOf(array[puzzleIndex]);
        if (!this.zoneLeadsToRequiredItem(zone, requiredItem)) return false;
        const findItem = this.itemOf(array[puzzleIndex + 1]);
        if (!this.zoneLeadsToProvidedItem(zone, findItem)) return false;
        if (!this.dropNpcAtHotspotRandomly(zone, npc)) return false;

        this.npc = npc;
        this.findItem = findItem;
        this.requiredItem = requiredItem;
        this.currentPuzzleIndex = puzzleIndex;
        this.addRequiredItemQuest(npc, distance);
        this.addRequiredItemQuestsFromHotspots(zone);
        this.usedPuzzles.push(puzzle);
        this.addRequiredItemQuest(puzzleItem, distance);
        return true;
      }
      case ZoneType.Find:
      case ZoneType.FindUniqueWeapon:
        if (!this.dropItemAtHotspotRandomly(zone, providedItem)) return false;
        this.addRequiredItemQuest(providedItem, distance);
        this.findItem = providedItem;
        this.addRequiredItemQuestsFromHotspots(zone);
        return true;
      default:
        return false;
    }
  }

  private tryGoalZone(zone: Zone, puzzleIndex: number, puzzleIndex2: number, providedItem: number, providedItem2: number, distance: number): boolean {
    if (!this.zoneLeadsToProvidedItem(zone, providedItem)) return false;
    if (!this.zoneLeadsToProvidedItem(zone, providedItem2)) return false;

    const newPuzzleItem1 = this.getUnusedRequiredItemForZoneRandomly(zone, false);
    const newPuzzleItem2 = this.getUnusedRequiredItemForZoneRandomly(zone, true);
    if (newPuzzleItem1 === NONE || newPuzzleItem2 === NONE) return false;
    const newPuzzle = this.getUnusedPuzzleRandomly(newPuzzleItem1, ZoneType.Goal);
    if (newPuzzle) this.usedPuzzles.push(newPuzzle);
    const secondPuzzle = this.getUnusedPuzzleRandomly(newPuzzleItem2, ZoneType.Goal);
    if (secondPuzzle) this.usedPuzzles.push(secondPuzzle);
    if (!newPuzzle || !secondPuzzle) return false;

    this.puzzleStrain1[puzzleIndex] = newPuzzle;
    this.puzzleStrain2[puzzleIndex2] = secondPuzzle;
    if (!this.requiredItemForZoneWasNotPlaced(zone)) return false;

    const puzzle1 = this.puzzleStrain1[puzzleIndex]!;
    const puzzle2 = this.puzzleStrain2[puzzleIndex2]!;
    const puzzle3 = this.puzzleStrain1[puzzleIndex + 1]!;
    const item31 = this.tileOrNone(puzzle3.item);
    const item32 = this.tileOrNone(puzzle3.item2);

    const npc = this.findUnusedNpcForZoneRandomly(zone);
    const hasNpc = npc !== NONE && this.zoneLeadsToNpc(zone, npc);

    // Ces deux appels sont évalués dans tous les cas (WebFun : opérateur `&`, pas `&&`).
    const leadsRequired = this.zoneLeadsToRequiredItem(zone, this.tileOrNone(puzzle1.item));
    const leadsProvided = this.zoneLeadsToProvidedItem(zone, item31);
    this.zoneLeadsToProvidedItem(zone, item32);
    if (!(leadsRequired && leadsProvided)) return false;

    if (hasNpc) {
      this.addRequiredItemQuestsFromHotspots(zone);
      this.npc = npc;
      this.findItem = NONE;
      this.requiredItem = this.tileOrNone(puzzle1.item);
      this.currentPuzzleIndex = puzzleIndex;
      this.additionalRequiredItem = NONE;
      this.addRequiredItemQuestsFromHotspots(zone);
    } else {
      const a = this.chooseItemFromZone(zone, this.tileOrNone(puzzle1.item), false);
      const b = this.placeQuestItem(zone, item31);
      const c = this.chooseItemFromZone(zone, this.tileOrNone(puzzle2.item), true);
      const d = this.placeQuestItem(zone, item32);
      if (!(a && b && c && d)) return false;

      this.addRequiredItemQuest(this.tileOrNone(puzzle1.item), distance);
      this.addRequiredItemQuest(this.tileOrNone(puzzle2.item), distance);
      this.addRequiredItemQuest(item31, distance);
      this.addRequiredItemQuest(item32, distance);
      this.npc = NONE;
      this.findItem = item31;
      this.requiredItem = this.tileOrNone(puzzle1.item);
      this.currentPuzzleIndex = puzzleIndex;
      this.additionalRequiredItem = NONE;
      this.additionalFindItem = item32;
      this.addRequiredItemQuestsFromHotspots(zone);
    }
    this.addRequiredItemQuest(newPuzzleItem1, distance);
    this.addRequiredItemQuest(newPuzzleItem2, distance);
    return true;
  }

  private determinePuzzleLocationChoices(cells: Cell[], maxDistance: number): { x: number; y: number }[] | null {
    const far: { x: number; y: number }[] = [];
    const best: { x: number; y: number }[] = [];
    const closeToPuzzles: { x: number; y: number }[] = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const index = x + 10 * y;
        const cell = cells[index];
        if (distanceToCenter(x, y) > maxDistance) {
          if (cell === Cell.Empty) far.push({ x, y });
        } else if (cell === Cell.Empty || cell === Cell.Candidate) {
          if (
            (x < 1 || cells[index - 1] !== Cell.Puzzle) &&
            (x > 8 || cells[index + 1] !== Cell.Puzzle) &&
            (y < 1 || cells[index - 10] !== Cell.Puzzle) &&
            (y > 8 || cells[index + 10] !== Cell.Puzzle)
          )
            best.push({ x, y });
          else closeToPuzzles.push({ x, y });
        }
      }
    }
    if (best.length) return best;
    if (closeToPuzzles.length) return closeToPuzzles;
    if (far.length) return far;
    return null;
  }

  // ------------------------------------------------------------ parcours des zones et pièces

  /** Zone puis pièces atteignables par ses portes (parcours de `RoomIterator` de WebFun, doublons compris). */
  private *rooms(zone: Zone | null): Generator<Zone> {
    if (!zone) return;
    const visited = new Set<number>([zone.id]);
    yield zone;
    for (const { type, argument } of zone.hotspots) {
      if (type !== HotspotType.DoorIn || argument < 0) continue;
      for (const room of this.rooms(this.lookupZone(argument))) {
        if (visited.has(room.id)) continue;
        visited.add(room.id);
        yield room;
      }
    }
  }

  /** Premier résultat de `callback` différent de `fallback` sur la zone et ses pièces. */
  private traverse<T>(zone: Zone, callback: (z: Zone) => T, fallback: T): T {
    for (const room of this.rooms(zone)) {
      const result = callback(room);
      if (result !== fallback) return result;
    }
    return fallback;
  }

  private zoneLeadsToRequiredItem(zone: Zone, item: number): boolean {
    return this.traverse(zone, (z) => z.requiredItems.includes(item), false);
  }

  private zoneLeadsToProvidedItem(zone: Zone, item: number): boolean {
    return this.traverse(zone, (z) => z.providedItems.includes(item), false);
  }

  private zoneLeadsToNpc(zone: Zone, npc: number): boolean {
    return this.traverse(zone, (z) => z.npcs.includes(npc), false);
  }

  private chooseItemFromZone(zone: Zone, item: number, fromGoalItems: boolean): boolean {
    return this.traverse(zone, (z) => (fromGoalItems ? z.goalItems : z.requiredItems).includes(item), false);
  }

  private findUnusedNpcForZoneRandomly(zone: Zone): number {
    return this.traverse(
      zone,
      (z) => {
        const candidates = z.npcs.filter((npc) => !this.hasQuestRequiringItem(npc));
        return candidates.length ? candidates[this.rng.next() % candidates.length] : NONE;
      },
      NONE,
    );
  }

  private getUnusedRequiredItemForZoneRandomly(zone: Zone, goalItems: boolean): number {
    return this.traverse(
      zone,
      (z) => {
        const items = (goalItems ? z.goalItems : z.requiredItems).filter((id) => !this.hasQuestRequiringItem(id));
        return items.length ? items[this.rng.next() % items.length] : NONE;
      },
      NONE,
    );
  }

  // ------------------------------------------------------------ quêtes

  private hasQuestRequiringItem(item: number): boolean {
    return this.requiredItemQuests.some((q) => q.item === item);
  }

  private addProvidedItemQuest(item: number, distance: number): void {
    this.providedItemQuests.unshift({ item, distance });
  }

  private addRequiredItemQuest(item: number, distance: number): void {
    this.requiredItemQuests.push({ item, distance });
  }

  private removeQuestRequiringItem(item: number): void {
    const index = this.requiredItemQuests.findIndex((q) => q.item === item);
    if (index >= 0) this.requiredItemQuests.splice(index, 1);
  }

  /** Aucun hotspot de la zone (ni de ses portes) ne tient déjà un objet exigé par une quête. */
  private requiredItemForZoneWasNotPlaced(zone: Zone | null): boolean {
    if (!zone) return true;
    for (const hotspot of zone.hotspots) {
      if (hotspot.argument === -1) continue;
      if (canHoldItem(hotspot.type) && this.hasQuestRequiringItem(this.tileOrNone(hotspot.argument))) return false;
      if (hotspot.type === HotspotType.DoorIn && !this.requiredItemForZoneWasNotPlaced(this.lookupZone(hotspot.argument))) return false;
    }
    return true;
  }

  private addRequiredItemQuestsFromHotspots(zone: Zone | null): void {
    if (!zone) return;
    for (const hotspot of zone.hotspots) {
      if (hotspot.argument === -1) continue;
      if (canHoldItem(hotspot.type)) this.addRequiredItemQuest(this.tileOrNone(hotspot.argument), -1);
      if (hotspot.type === HotspotType.DoorIn) this.addRequiredItemQuestsFromHotspots(this.lookupZone(hotspot.argument));
    }
  }

  // ------------------------------------------------------------ hotspots

  /** Active le hotspot en lui donnant `item` (le moteur applique `hotspotArguments` à la création de la zone). */
  private dropItemAtHotspot(zone: Zone, index: number, item: number): boolean {
    let map = this.hotspotArguments.get(zone.id);
    if (!map) this.hotspotArguments.set(zone.id, (map = new Map()));
    map.set(index, item);
    return true;
  }

  private placeItemAtHotspotRandomly(zone: Zone, candidates: number[], item: number): boolean {
    if (!candidates.length) return false;
    return this.dropItemAtHotspot(zone, candidates[this.rng.next() % candidates.length], item);
  }

  private hotspotsOf(zone: Zone, type: HotspotType): number[] {
    return zone.hotspots.flatMap((h, index) => (h.type === type ? [index] : []));
  }

  private placeQuestItem(zone: Zone, item: number): boolean {
    return this.traverse(
      zone,
      (z) => z.providedItems.includes(item) && this.placeItemAtHotspotRandomly(z, this.hotspotsOf(z, HotspotType.DropQuestItem), item),
      false,
    );
  }

  private dropItemAtLockHotspot(zone: Zone, item: number): boolean {
    return this.traverse(
      zone,
      (z) => {
        if (!z.requiredItems.includes(item)) return false;
        const locks = this.hotspotsOf(z, HotspotType.Lock);
        return locks.length > 0 && this.dropItemAtHotspot(z, locks[0], item);
      },
      false,
    );
  }

  private dropNpcAtHotspotRandomly(zone: Zone, npc: number): boolean {
    return this.traverse(
      zone,
      (z) => {
        if (!z.npcs.includes(npc)) return false;
        const free = this.hotspotsOf(z, HotspotType.SpawnLocation).filter((i) => z.hotspots[i].argument === -1);
        return this.placeItemAtHotspotRandomly(z, free, npc);
      },
      false,
    );
  }

  private dropItemAtHotspotRandomly(zone: Zone, item: number): boolean {
    if (!this.requiredItemForZoneWasNotPlaced(zone)) return false;
    return this.traverse(
      zone,
      (z) => {
        if (!z.providedItems.includes(item)) return false;
        return this.placeItemAtHotspotRandomly(z, this.hotspotsOf(z, this.hotspotTypeForTile(item)), item);
      },
      false,
    );
  }

  private hotspotTypeForTile(item: number): HotspotType {
    if (this.assets.isWeaponTile(item)) return HotspotType.DropUniqueWeapon;
    if (this.assets.hasFlag(item, TileFlag.Item | TileFlag.Map)) return HotspotType.DropMap;
    return HotspotType.DropQuestItem;
  }

  // ------------------------------------------------------------ divers

  private placeZone(x: number, y: number, zone: Zone, options: PlaceOptions = {}): void {
    this.sectors[x + 10 * y] = {
      zoneId: zone.id,
      puzzleIndex: options.puzzleIndex ?? -1,
      requiredItem: options.requiredItem ?? NONE,
      npc: options.npc ?? NONE,
      findItem: options.findItem ?? NONE,
      additionalRequiredItem: options.additionalRequiredItem ?? NONE,
      additionalGainItem: options.additionalGainItem ?? NONE,
      usedAlternateStrain: this.usedAlternateStrain,
      type: zone.type === ZoneType.FindUniqueWeapon ? ZoneType.Find : zone.type,
    };
    this.usedAlternateStrain = false;
    this.usedZones.add(zone.id);
  }

  private lookupZone(id: number): Zone | null {
    return this.assets.data.zones[id] ?? null;
  }

  /** Tuile valide ou NONE (WebFun : `NullIfMissing`). */
  private tileOrNone(id: number): number {
    return id >= 0 && id < this.assets.data.tiles.length ? id : NONE;
  }

  /** Premier objet d'un puzzle d'une chaîne (qui doit exister). */
  private itemOf(puzzle: Puzzle | null | undefined): number {
    if (!puzzle) throw this.error("Chaîne de puzzles incomplète");
    return this.tileOrNone(puzzle.item);
  }

  private error(message: string): YodaGenerationError {
    return new YodaGenerationError(message, this.seed, this.size, this.planet);
  }

  private errorWhen(condition: boolean, message: string): void {
    if (condition) throw this.error(message);
  }
}

const canHoldItem = (type: HotspotType): boolean =>
  type === HotspotType.DropItem || type === HotspotType.Npc || type === HotspotType.DropWeapon;

const isBlockadeType = (type: ZoneType): boolean =>
  type === ZoneType.BlockadeNorth || type === ZoneType.BlockadeSouth || type === ZoneType.BlockadeEast || type === ZoneType.BlockadeWest;

function zoneTypeForCell(cell: Cell): ZoneType {
  switch (cell) {
    case Cell.Town:
      return ZoneType.Town;
    case Cell.BlockEast:
      return ZoneType.BlockadeEast;
    case Cell.BlockWest:
      return ZoneType.BlockadeWest;
    case Cell.BlockNorth:
      return ZoneType.BlockadeNorth;
    case Cell.BlockSouth:
      return ZoneType.BlockadeSouth;
    default:
      return ZoneType.Empty;
  }
}

function toPuzzleType(type: WantedType): PuzzleType {
  switch (type) {
    case ZoneType.Trade:
      return PuzzleType.Transaction;
    case MISSION:
      return PuzzleType.Mission;
    case ZoneType.Goal:
      return PuzzleType.Goal;
    case ZoneType.Use:
      return PuzzleType.Offer;
    default:
      throw new Error(`Le type de zone ${type} n'a pas de type de puzzle`);
  }
}

function kindOf(type: ZoneType): SectorKind {
  switch (type) {
    case ZoneType.Town:
      return SectorKind.Town;
    case ZoneType.Goal:
      return SectorKind.Goal;
    case ZoneType.Use:
    case ZoneType.Trade:
      return SectorKind.Puzzle;
    case ZoneType.Find:
    case ZoneType.FindUniqueWeapon:
      return SectorKind.Find;
    case ZoneType.BlockadeNorth:
    case ZoneType.BlockadeSouth:
    case ZoneType.BlockadeEast:
    case ZoneType.BlockadeWest:
      return SectorKind.Blockade;
    case ZoneType.TravelStart:
    case ZoneType.TravelEnd:
      return SectorKind.Travel;
    default:
      return SectorKind.Empty;
  }
}
