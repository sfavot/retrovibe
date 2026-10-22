import { type Zone, HotspotType, PuzzleType, ZoneType } from "../../data/types";
import { type Assets, IndyIds } from "../assets";
import { isGoalDrawable } from "../history";
import { Rng } from "../rng";
import { paceOf } from "../score";
import { type Sector, SectorKind, type Story, WORLD_SIZE, WorldSize, emptySector } from "../world";
import { Cell, type Layout, distanceToCenter, generateLayout } from "./layout";
import { canReachHotspot } from "./reachability";
import { solve } from "./solver";

export class GenerationError extends Error {}

/** Luger : l'arme à trouver en plus du fouet de départ. */
const WEAPON_QUEST_TILE = 450;
/** Bureau de Marcus dans son bureau (zone 108) : lui parler rappelle la mission. */
const MARCUS_OFFICE = { zone: 108, desk: 794 };

interface Quest {
  item: number;
  /** Anneau maximal où placer la zone qui fournit l'objet. */
  maxDistance: number;
}

export interface GenerateOptions {
  maxAttempts?: number;
  /** Objectifs des parties précédentes, du plus ancien au plus récent : les 10 derniers ne sont pas retirés. */
  history?: readonly number[];
  /** Victoires cumulées : MysteryGO n'est tirable qu'à partir de 10. */
  victories?: number;
  /** Objectif imposé (« Rejouer cette histoire ») : ni l'historique ni les victoires ne comptent alors. */
  goal?: number;
}

/**
 * Génère une partie : carte, mission, chaîne de puzzles et emplacement des objets.
 * La disposition suit l'algorithme d'origine ; l'affectation des zones est une reconstitution,
 * validée par un solveur qui rejette (et regénère) toute partie impossible à terminer.
 * À graine, taille et options égales, le monde est identique.
 */
export function generateStory(assets: Assets, seed: number, size: WorldSize, options: GenerateOptions = {}): Story {
  const { maxAttempts = 40 } = options;
  const errors: string[] = [];
  const rng = new Rng(seed);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = attempt === 0 ? seed : rng.next() * 0x8000 + rng.next();
    try {
      const story = new StoryBuilder(assets, attemptSeed, size, options).build();
      const result = solve(assets, story);
      if (result.solvable) return story;
      errors.push(`graine ${attemptSeed} : ${result.reason}`);
    } catch (e) {
      if (!(e instanceof GenerationError)) throw e;
      errors.push(`graine ${attemptSeed} : ${e.message}`);
    }
  }
  throw new GenerationError(`Impossible de générer une partie jouable :\n${errors.slice(-5).join("\n")}`);
}

class StoryBuilder {
  private readonly rng: Rng;
  private readonly sectors: (Sector | null)[] = new Array(WORLD_SIZE * WORLD_SIZE).fill(null);
  private readonly usedZones = new Set<number>();
  private readonly requiredItems = new Set<number>();
  private readonly providedItems = new Set<number>();
  private readonly usedNpcs = new Set<number>();
  private readonly hotspotArguments = new Map<number, Map<number, number>>();
  private readonly quests: Quest[] = [];
  private layout!: Layout;
  private startItem = -1;

  constructor(
    private readonly assets: Assets,
    private readonly seed: number,
    private readonly size: WorldSize,
    private readonly options: GenerateOptions = {},
  ) {
    this.rng = new Rng(seed);
  }

  build(): Story {
    this.layout = generateLayout(this.rng, this.size);
    const cells = this.layout.cells;

    const town = cells.indexOf(Cell.Town);
    if (town < 0) throw new GenerationError("pas de ville");
    this.place(town, IndyIds.townZone, SectorKind.Town);
    this.setHotspot(MARCUS_OFFICE.zone, HotspotType.SpawnLocation, MARCUS_OFFICE.desk);

    const goalPuzzle = this.placeGoalAndChain();
    this.placeTravels();
    this.placeBlockades();
    this.quests.push({ item: WEAPON_QUEST_TILE, maxDistance: 2 }, { item: IndyIds.mapTile, maxDistance: 1 });
    this.placeFindZones();
    this.fillEmpty();

    return {
      seed: this.seed,
      size: this.size,
      sectors: this.sectors,
      goalPuzzle,
      hotspotArguments: this.hotspotArguments,
      pace: paceOf(this.layout),
      startItem: this.startItem,
    };
  }

  // ------------------------------------------------------------ utilitaires

  private place(index: number, zoneId: number, kind: SectorKind, init: Partial<Sector> = {}): Sector {
    const sector = { ...emptySector(zoneId, kind), ...init };
    this.sectors[index] = sector;
    for (const room of this.assets.roomsOf(zoneId)) this.usedZones.add(room.id);
    if (sector.requiredItem >= 0) this.requiredItems.add(sector.requiredItem);
    if (sector.findItem >= 0) this.providedItems.add(sector.findItem);
    if (sector.npc >= 0) this.usedNpcs.add(sector.npc);
    return sector;
  }

  private setHotspot(zoneId: number, type: HotspotType, argument: number, predicate?: (index: number) => boolean): boolean {
    const zone = this.assets.zone(zoneId);
    const candidates = zone.hotspots
      .map((h, index) => ({ h, index }))
      .filter(({ h, index }) => h.type === type && !this.hotspotArguments.get(zoneId)?.has(index) && (predicate?.(index) ?? true));
    const chosen = this.rng.pick(candidates);
    if (!chosen) return false;
    let map = this.hotspotArguments.get(zoneId);
    if (!map) this.hotspotArguments.set(zoneId, (map = new Map()));
    map.set(chosen.index, argument);
    return true;
  }

  /** Place `item` sur un hotspot du type voulu dans la zone ou ses pièces qui le fournissent. */
  private dropInTree(rootId: number, item: number, type: HotspotType): boolean {
    for (const room of this.assets.roomsOf(rootId)) {
      if (!room.providedItems.includes(item)) continue;
      // Un hotspot dont l'objet est déjà fixé dans les données (ex. 451 dans Ending10D) convient tel quel.
      const preset = room.hotspots.findIndex((h) => h.type === type && h.argument === item);
      if (preset >= 0) {
        let map = this.hotspotArguments.get(room.id);
        if (!map) this.hotspotArguments.set(room.id, (map = new Map()));
        map.set(preset, item);
        return true;
      }
      if (this.setHotspot(room.id, type, item, (i) => room.hotspots[i].argument < 0)) return true;
    }
    return false;
  }

  private treeHas(rootId: number, pick: (z: Zone) => number[], item: number): boolean {
    for (const room of this.assets.roomsOf(rootId)) if (pick(room).includes(item)) return true;
    return false;
  }

  /** Premier objet requis libre de la zone ou de ses pièces, tiré au hasard. */
  private chooseRequired(rootId: number, exclude: number[] = []): number[] {
    for (const room of this.assets.roomsOf(rootId)) {
      const candidates = room.requiredItems.filter((i) => !this.requiredItems.has(i) && !exclude.includes(i));
      if (candidates.length) return this.rng.shuffle(candidates);
    }
    return [];
  }

  private zonesOfType(...types: ZoneType[]): Zone[] {
    return this.rng.shuffle(this.assets.data.zones.filter((z) => types.includes(z.type) && !this.usedZones.has(z.id)));
  }

  private indexOfOrder(order: number): number {
    return this.layout.order.indexOf(order);
  }

  private distanceOf(index: number): number {
    return distanceToCenter(index % WORLD_SIZE, Math.floor(index / WORLD_SIZE));
  }

  // ------------------------------------------------------------ objectif et chaîne de puzzles

  private placeGoalAndChain(): number {
    const { puzzleCount } = this.layout;
    if (puzzleCount < 2) throw new GenerationError("trop peu de puzzles");
    const goalIndex = this.indexOfOrder(puzzleCount - 1);

    const { goal, history = [], victories = 0 } = this.options;
    const missions = this.rng.shuffle(
      this.assets.data.puzzles.filter(
        (p) => p.type === PuzzleType.Mission && (goal === undefined ? isGoalDrawable(p.id, history, victories) : p.id === goal),
      ),
    );
    let mission: number | undefined;
    for (const puzzle of missions) {
      const zone = this.zonesOfType(ZoneType.Goal).find((z) => this.treeHas(z.id, (r) => r.providedItems, puzzle.item));
      if (!zone) continue;
      const required = this.chooseRequired(zone.id)[0] ?? -1;
      // Sans emplacement libre, l'objet de mission est remis par les scripts de la zone.
      this.dropInTree(zone.id, puzzle.item, HotspotType.DropQuestItem);
      this.place(goalIndex, zone.id, SectorKind.Goal, { requiredItem: required, findItem: puzzle.item });
      mission = puzzle.id;
      break;
    }
    if (mission === undefined) throw new GenerationError("aucune mission réalisable");

    // Remonte la chaîne : chaque puzzle fournit l'objet exigé par le suivant.
    let need = this.sectors[goalIndex]!.requiredItem;
    for (let order = puzzleCount - 2; order >= 0 && need >= 0; order--) {
      const index = this.indexOfOrder(order);
      if (index < 0) continue;
      const placed = this.placePuzzle(index, need);
      if (placed === null) break;
      need = placed;
    }
    // Comme dans le jeu original, Marcus remet le premier objet de la chaîne avec son briefing.
    this.startItem = need;
    return mission;
  }

  /** Place un puzzle (échange avec un PNJ ou serrure) qui fournit `provides`. Renvoie l'objet qu'il exige. */
  private placePuzzle(index: number, provides: number): number | null {
    const offer = this.rng.shuffle(this.assets.data.puzzles.filter((p) => p.item === provides && p.texts[2]?.trim()))[0];
    const types = this.rng.mod(2) ? [ZoneType.Trade, ZoneType.Use] : [ZoneType.Use, ZoneType.Trade];
    for (const type of types) {
      const target = type === ZoneType.Trade ? HotspotType.SpawnLocation : HotspotType.Lock;
      for (const zone of this.zonesOfType(type)) {
        if (!this.treeHas(zone.id, (r) => r.providedItems, provides)) continue;
        if (!canReachHotspot(this.assets, zone.id, [target])) continue;
        for (const required of this.chooseRequired(zone.id, [provides])) {
          if (type === ZoneType.Trade) {
            const request = this.rng.shuffle(
              this.assets.data.puzzles.filter((p) => p.item === required && p.type === PuzzleType.Transaction && p.texts[0]?.trim()),
            )[0];
            const npc = this.chooseNpc(zone.id);
            if (!request || npc < 0) continue;
            if (!this.dropInTree(zone.id, npc, HotspotType.SpawnLocation) && !this.placeNpc(zone.id, npc)) continue;
            this.place(index, zone.id, SectorKind.Puzzle, {
              requiredItem: required,
              findItem: provides,
              npc,
              puzzle: request.id,
              offerPuzzle: offer?.id ?? -1,
            });
            return required;
          }
          const hasLock = [...this.assets.roomsOf(zone.id)].some((r) => r.hotspots.some((h) => h.type === HotspotType.Lock));
          if (!hasLock || !this.dropInTree(zone.id, provides, HotspotType.DropQuestItem)) continue;
          this.place(index, zone.id, SectorKind.Puzzle, { requiredItem: required, findItem: provides, offerPuzzle: offer?.id ?? -1 });
          return required;
        }
      }
    }
    return null;
  }

  private chooseNpc(rootId: number): number {
    for (const room of this.assets.roomsOf(rootId)) {
      const candidates = room.npcs.filter((n) => !this.usedNpcs.has(n));
      if (candidates.length) return this.rng.pick(candidates)!;
    }
    return -1;
  }

  /** PNJ sur un emplacement d'apparition de n'importe quelle pièce de la zone. */
  private placeNpc(rootId: number, npc: number): boolean {
    for (const room of this.assets.roomsOf(rootId)) {
      if (this.setHotspot(room.id, HotspotType.SpawnLocation, npc, (i) => room.hotspots[i].argument < 0)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ voyages et barrages

  private placeTravels(): void {
    const cells = this.layout.cells;
    const ends = cells.flatMap((c, i) => (c === Cell.TravelEnd && !this.sectors[i] ? [i] : []));
    cells.forEach((cell, index) => {
      if (cell !== Cell.TravelStart || this.sectors[index]) return;
      const end = ends.shift();
      for (const zone of this.zonesOfType(ZoneType.TravelStart)) {
        const vehicle = zone.hotspots.find((h) => h.type === HotspotType.VehicleTo);
        const destination = vehicle && vehicle.argument >= 0 ? this.assets.zone(vehicle.argument) : null;
        if (!destination || this.usedZones.has(destination.id)) continue;
        const required = this.chooseRequired(zone.id)[0];
        if (required === undefined) continue;
        this.place(index, zone.id, SectorKind.Travel, { requiredItem: required });
        this.quests.push({ item: required, maxDistance: 5 });
        if (end !== undefined) this.place(end, destination.id, SectorKind.Empty);
        return;
      }
      // Aucun véhicule disponible : simple zone vide.
      this.layout.cells[index] = Cell.Empty;
    });
  }

  private placeBlockades(): void {
    const types: Partial<Record<Cell, ZoneType>> = {
      [Cell.BlockNorth]: ZoneType.BlockadeNorth,
      [Cell.BlockSouth]: ZoneType.BlockadeSouth,
      [Cell.BlockEast]: ZoneType.BlockadeEast,
      [Cell.BlockWest]: ZoneType.BlockadeWest,
    };
    this.layout.cells.forEach((cell, index) => {
      const type = types[cell];
      if (type === undefined || this.sectors[index]) return;
      for (const zone of this.zonesOfType(type)) {
        const required = this.chooseRequired(zone.id)[0];
        if (required === undefined) continue;
        this.place(index, zone.id, SectorKind.Blockade, { requiredItem: required });
        this.quests.push({ item: required, maxDistance: this.distanceOf(index) });
        return;
      }
      throw new GenerationError("pas de zone de barrage disponible");
    });
  }

  // ------------------------------------------------------------ objets à trouver

  private placeFindZones(): void {
    for (const quest of this.quests) {
      if (this.providedItems.has(quest.item)) continue;
      const isWeapon = this.assets.isWeaponTile(quest.item);
      const isMap = this.assets.isMapTile(quest.item);
      const hotspot = isWeapon ? HotspotType.DropUniqueWeapon : isMap ? HotspotType.DropMap : HotspotType.DropQuestItem;
      const types = isWeapon ? [ZoneType.FindUniqueWeapon, ZoneType.Find] : [ZoneType.Find, ZoneType.FindUniqueWeapon];
      const locations = this.findLocations(quest.maxDistance);
      if (!locations.length) throw new GenerationError(`aucun emplacement pour l'objet ${quest.item}`);
      const zone = this.zonesOfType(...types).find(
        (z) =>
          this.treeHas(z.id, (r) => r.providedItems, quest.item) &&
          canReachHotspot(this.assets, z.id, [hotspot]) &&
          this.dropInTree(z.id, quest.item, hotspot),
      );
      if (!zone) throw new GenerationError(`aucune zone ne fournit l'objet ${quest.item}`);
      const index = this.rng.pick(locations)!;
      this.place(index, zone.id, SectorKind.Find, { findItem: quest.item });
      this.layout.cells[index] = Cell.Puzzle;
    }
  }

  private findLocations(maxDistance: number): number[] {
    const cells = this.layout.cells;
    const best: number[] = [];
    const close: number[] = [];
    const far: number[] = [];
    cells.forEach((cell, index) => {
      if (this.sectors[index]) return;
      if (cell !== Cell.Empty && cell !== Cell.Candidate) return;
      const x = index % WORLD_SIZE;
      const y = Math.floor(index / WORLD_SIZE);
      if (distanceToCenter(x, y) > maxDistance) {
        far.push(index);
        return;
      }
      const near = [cells[index - 1], cells[index + 1], cells[index - WORLD_SIZE], cells[index + WORLD_SIZE]];
      (near.includes(Cell.Puzzle) ? close : best).push(index);
    });
    return best.length ? best : close.length ? close : far;
  }

  // ------------------------------------------------------------ remplissage

  private fillEmpty(): void {
    const zones = this.zonesOfType(ZoneType.Empty).sort(
      (a, b) => Number(hasTeleporter(a)) - Number(hasTeleporter(b)),
    );
    this.layout.cells.forEach((cell, index) => {
      if (this.sectors[index]) return;
      if (cell !== Cell.Empty && cell !== Cell.Candidate && cell !== Cell.Island && cell !== Cell.Puzzle && cell !== Cell.TravelStart) {
        return;
      }
      const zone = zones.shift();
      if (zone) this.place(index, zone.id, SectorKind.Empty);
    });
  }
}

const hasTeleporter = (z: Zone) => z.hotspots.some((h) => h.type === HotspotType.Teleporter);
