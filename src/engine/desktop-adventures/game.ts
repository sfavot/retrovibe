import { type Character, FrameEntry, HotspotType, Layer, TileFlag } from "./data/types";
import type { Assets } from "./assets";
import { DIRECTION_VECTORS, Direction, type Point, directionOf, samePoint } from "./geometry";
import { killMonster, moveMonsters, placeMonsters } from "./monsters";
import { Rng, randomSeed } from "./rng";
import { Mode, type ScriptHost, ScriptOutcome, runScripts } from "./script";
import type { DesktopVariant } from "./variant";
import { type Sector, SectorKind, type Story, World } from "./world";
import { type Monster, type ZoneSnapshot, ZoneState, isAlive, restoreZone, snapshotZone } from "./zone-state";

export const MAX_HEALTH = 300;
/** Distance maximale d'un projectile du héros (cases). */
const BULLET_RANGE = 4;
/** Portée d'un tir qui parcourt son chemin (`bulletAlongPath`) : cases à 1, 2 et 3 du héros (`_actionFrames` 0 à 2 de WebFun). */
const PATH_BULLET_RANGE = 3;

export type Transition = { type: "room" } | { type: "sector"; dx: number; dy: number } | { type: "none" };

/** Ce que le jeu demande à l'interface. Toutes les méthodes asynchrones bloquent la boucle de jeu. */
export interface Presenter {
  /** Bulle de dialogue ; `at` en coordonnées de zone, null = le héros. */
  speak(text: string, at: Point | null): Promise<void>;
  /** Message hors-jeu (briefing de mission…). */
  message(text: string): Promise<void>;
  pickup(tile: number, at: Point): Promise<void>;
  /** Anime le passage d'une zone à l'autre ; `apply` effectue le changement d'état au bon moment. */
  transition(kind: Transition, apply: () => void): Promise<void>;
  playSound(id: number): void;
  /** Coupe les sons en cours (opcode StopSound de Yoda). */
  stopSound?(): void;
  ended(kind: "win" | "lose", score: number): Promise<void>;
  /** Choix d'un téléporteur de destination sur la carte (index de case), null = annuler. */
  chooseTeleport(destinations: number[]): Promise<number | null>;
}

export interface GameSettings {
  /** 0 (facile) à 100 (difficile). */
  difficulty: number;
  /** Parties déjà gagnées par le joueur (conditions de script de Yoda), 0 par défaut. */
  gamesWon?: number;
}

export interface InputState {
  /** Direction maintenue (composantes -1, 0 ou 1). */
  move: Point;
  /** Maj maintenue : pousser/tirer les objets déplaçables. */
  drag: boolean;
}

export interface HeroState {
  x: number;
  y: number;
  facing: Direction;
  visible: boolean;
  health: number;
  walkFrame: number;
}

export interface AttackState {
  weapon: Character;
  frame: number;
  projectile: boolean;
  bullet: Point | null;
}

export const GameEvent = {
  Inventory: "inventory",
  Health: "health",
  Weapon: "weapon",
  Zone: "zone",
  Tick: "tick",
  /** Victoire (avant l'écran de fin), une seule fois par partie. */
  Won: "won",
} as const;

export class Game extends EventTarget {
  readonly world: World;
  readonly rng: Rng;
  readonly hero: HeroState = { x: 0, y: 0, facing: Direction.Down, visible: true, health: MAX_HEALTH, walkFrame: 0 };
  inventory: number[] = [];
  weapon: Character | null = null;
  /** Munitions restantes de l'arme équipée (-1 : illimitées). */
  ammo = -1;
  /** Munitions mises de côté par arme quand on en change (id du personnage-arme). */
  private readonly ammoByWeapon = new Map<number, number>();
  attack: AttackState | null = null;
  readonly overlays: Array<{ x: number; y: number; tile: number }> = [];
  readonly input: InputState = { move: { x: 0, y: 0 }, drag: false };
  gameWon = false;
  /** Score de la victoire, fixé au moment où la partie est gagnée (null avant). */
  finalScore: number | null = null;
  over = false;
  tick = 0;
  zone!: ZoneState;

  private readonly zones = new Map<number, ZoneState>();
  private attackRequested = false;
  private mapRequested = false;
  private placement: { tile: number; x: number; y: number } | null = null;
  private bumped: Point | null = null;
  private placed: { tile: number; x: number; y: number } | null = null;
  private pendingZone: { zoneId: number; x: number; y: number; mode: Mode; transition: Transition } | null = null;
  /** Les hotspots « véhicule » ne se déclenchent pas tant que le héros n'a pas quitté sa case d'arrivée. */
  private standLock: Point | null = null;
  private running = false;
  private tickWaiters: Array<{ remaining: number; resolve: () => void }> = [];
  private readonly startedAt = Date.now();
  /** Temps de jeu des sessions précédentes (parties reprises). */
  private playedMs = 0;
  /** Difficultés enregistrées par `recordDifficulty` : leur somme et leur nombre servent au score d'Indy. */
  private difficultySum = 0;
  private difficultyCount = 0;

  constructor(
    readonly variant: DesktopVariant,
    readonly assets: Assets,
    readonly story: Story,
    private readonly presenter: Presenter,
    readonly settings: GameSettings = { difficulty: 50 },
  ) {
    super();
    this.world = new World(story, assets);
    this.rng = new Rng(randomSeed());
  }

  // ---------------------------------------------------------------- état

  get sector(): Sector | null {
    return this.world.sectorOf(this.zone.id);
  }

  /** Directions praticables depuis la zone courante (secteur voisin sur la carte du monde) : la boussole du panneau. */
  get exits(): Record<Direction, boolean> {
    return this.world.exits(this.zone.id);
  }

  get goalItem(): number {
    return this.assets.puzzle(this.story.goalPuzzle)?.item ?? -1;
  }

  zoneState(zoneId: number): ZoneState {
    let state = this.zones.get(zoneId);
    if (!state) {
      state = new ZoneState(this.assets.zone(zoneId), this.assets);
      for (const [index, argument] of this.story.hotspotArguments.get(zoneId) ?? []) {
        const h = state.hotspots[index];
        if (h) {
          h.argument = argument;
          h.enabled = true;
        }
      }
      for (const h of state.hotspots) {
        if (h.type === HotspotType.Bonus) h.argument = this.variant.bonusTile;
      }
      placeMonsters(state);
      this.zones.set(zoneId, state);
    }
    return state;
  }

  hasItem(tile: number): boolean {
    return tile >= 0 && this.inventory.includes(tile);
  }

  addItem(tile: number): void {
    if (tile < 0) return;
    if (this.assets.isMapTile(tile)) this.inventory.unshift(tile);
    else this.inventory.push(tile);
    this.emit(GameEvent.Inventory);
    if (!this.weapon && this.assets.isWeaponTile(tile)) this.equip(tile);
    else if (this.weapon && this.weaponTile(this.weapon) === tile && this.ammo === 0) this.ammo = this.maxAmmo(this.weapon);
  }

  removeItem(tile: number): void {
    const index = this.inventory.indexOf(tile);
    if (index === -1) return;
    this.inventory.splice(index, 1);
    this.emit(GameEvent.Inventory);
    if (this.weapon && this.weaponTile(this.weapon) === tile && !this.inventory.includes(tile)) {
      this.weapon = null;
      this.ammo = -1;
      this.emit(GameEvent.Weapon);
    }
  }

  weaponTile(weapon: Character): number {
    return weapon.frames[0][FrameEntry.ExtensionRight];
  }

  equip(tile: number): boolean {
    if (this.variant.canEquip && !this.variant.canEquip(tile)) return false;
    const weapon = this.assets.weaponForTile(tile);
    if (!weapon) return false;
    if (this.weapon === weapon) return true;
    if (this.weapon) this.ammoByWeapon.set(this.weapon.id, this.ammo);
    this.weapon = weapon;
    this.ammo = this.ammoByWeapon.get(weapon.id) || this.maxAmmo(weapon);
    this.playSound(this.variant.equipSound?.(weapon) ?? -1);
    this.emit(GameEvent.Weapon);
    return true;
  }

  maxAmmo(weapon: Character): number {
    return this.variant.maxAmmo?.(weapon) ?? -1;
  }

  /**
   * Un tir consomme une munition ; à zéro, l'exemplaire de l'arme est épuisé (retiré de l'inventaire) : on reprend un
   * autre exemplaire plein, sinon une autre arme (comme `reloadWeapon` de WebFun).
   */
  private spendAmmo(): void {
    const weapon = this.weapon;
    if (!weapon || this.ammo < 0) return;
    this.ammo--;
    this.emit(GameEvent.Weapon);
    if (this.ammo > 0) return;
    const tile = this.weaponTile(weapon);
    this.ammoByWeapon.delete(weapon.id);
    this.removeItem(tile);
    if (this.hasItem(tile)) {
      this.ammo = this.maxAmmo(weapon);
      this.weapon = weapon;
      this.emit(GameEvent.Weapon);
      return;
    }
    const next = this.inventory.find((t) => this.assets.isWeaponTile(t) && (!this.variant.canEquip || this.variant.canEquip(t)));
    if (next !== undefined) this.equip(next);
  }

  /** Bulle de dialogue (null : le héros). */
  speak(text: string, at: Point | null): Promise<void> {
    return this.presenter.speak(text, at);
  }

  // ---------------------------------------------------------------- commandes de l'interface

  /** Lance une attaque avec l'arme équipée au prochain tick. */
  requestAttack(): void {
    this.attackRequested = true;
  }

  /** Utilise un objet de l'inventaire sur une case de la zone (le héros lui-même = équiper / consommer). */
  requestPlacement(tile: number, x: number, y: number): void {
    if (this.hasItem(tile)) this.placement = { tile, x, y };
  }

  /** Utilise l'objet sur la case devant le héros. */
  useInFront(tile: number): void {
    const v = DIRECTION_VECTORS[this.hero.facing];
    this.requestPlacement(tile, this.hero.x + v.x, this.hero.y + v.y);
  }

  requestMap(): boolean {
    if (!this.inventory.some((t) => this.assets.isMapTile(t))) return false;
    this.mapRequested = true;
    return true;
  }

  consumeMapRequest(): boolean {
    const requested = this.mapRequested;
    this.mapRequested = false;
    return requested;
  }

  // ---------------------------------------------------------------- sauvegarde

  snapshot(): GameSnapshot {
    const { hotspotArguments, ...story } = this.story;
    return {
      version: SAVE_VERSION,
      story: { ...story, hotspotArguments: [...hotspotArguments].map(([z, h]) => [z, [...h]]) },
      settings: { ...this.settings },
      zones: [...this.zones.values()].map(snapshotZone),
      zoneId: this.zone.id,
      hero: { ...this.hero },
      inventory: this.inventory.slice(),
      weapon: this.weapon?.id ?? -1,
      gameWon: this.gameWon,
      playedMs: this.playedMs + (Date.now() - this.startedAt),
      difficultySum: this.difficultySum,
      difficultyCount: this.difficultyCount,
    };
  }

  /** Reprend une partie sauvegardée (à la place de `start`). */
  async resume(s: GameSnapshot): Promise<void> {
    for (const zs of s.zones) restoreZone(this.zoneState(zs.id), zs, this.assets);
    this.inventory = s.inventory.slice();
    this.weapon = this.assets.character(s.weapon) ?? null;
    this.gameWon = s.gameWon;
    this.playedMs = s.playedMs;
    this.difficultySum = s.difficultySum;
    this.difficultyCount = s.difficultyCount;
    this.setZone(s.zoneId, { x: s.hero.x, y: s.hero.y });
    Object.assign(this.hero, s.hero);
    this.emit(GameEvent.Inventory);
    this.emit(GameEvent.Weapon);
    this.emit(GameEvent.Health);
  }

  /** Outil de développement : se rendre directement dans une zone. */
  async debugTeleport(zoneId: number, x: number, y: number): Promise<void> {
    this.requestZoneChange(zoneId, x, y, { type: "room" });
    await this.performPendingZoneChange();
  }

  // ---------------------------------------------------------------- démarrage et boucle

  async start(startZone: number, at: Point): Promise<void> {
    // Comme un tick (`step`) : tant que le démarrage tourne (briefing, scripts d'entrée animés), la boucle ne relance pas
    // les scripts de la zone, qui n'est pas encore initialisée (sinon un AddItem « première visite » s'exécuterait deux fois).
    this.running = true;
    try {
      this.setZone(startZone, at);
      const goal = this.assets.puzzle(this.story.goalPuzzle);
      if (this.variant.briefingOnStart) {
        if (goal?.texts[3]) await this.presenter.message(goal.texts[3]);
        if (this.story.startItem >= 0) await this.dropItem(this.story.startItem, { x: at.x, y: at.y });
      }
      await this.enterCurrentZone(Mode.JustEntered);
    } finally {
      this.running = false;
    }
  }

  /**
   * Avance la partie d'un tick (≈ 100 ms). Si un script est en cours (dialogue, animation), seul le
   * temps avance : les attentes scriptées progressent, le reste du monde est figé.
   */
  async step(): Promise<void> {
    this.tick++;
    this.resolveTickWaiters();
    this.emit(GameEvent.Tick);
    if (this.over || this.running) return;
    this.running = true;
    try {
      await this.update();
    } finally {
      this.running = false;
    }
  }

  /** Vrai tant qu'un script, un dialogue ou une transition bloque la partie. */
  get busy(): boolean {
    return this.running;
  }

  private async update(): Promise<void> {
    this.layDownHotspotItems(this.zone);
    if (this.placement) {
      const placement = this.placement;
      this.placement = null;
      if (await this.handlePlacement(placement)) return;
    }
    if (await this.scripts(Mode.Walk)) return;
    if (await this.standHotspots()) return;
    if (await this.updateAttack()) return;
    moveMonsters(this.monsterHost(), this.variant.moveMonster, this.variant.monsterTile);
    if (this.over) return;
    await this.handleInput();
  }

  // ---------------------------------------------------------------- zones

  private setZone(zoneId: number, at: Point): void {
    this.zone = this.zoneState(zoneId);
    this.hero.x = at.x;
    this.hero.y = at.y;
    this.overlays.length = 0;
    this.standLock = { ...at };
    this.zone.visited = true;
    const sector = this.sector;
    if (sector) sector.visited = true;
    this.emit(GameEvent.Zone);
  }

  private async enterCurrentZone(mode: Mode): Promise<void> {
    this.layDownHotspotItems(this.zone);
    await this.scripts(mode | Mode.JustEntered);
  }

  /** Exécute les scripts de la zone ; renvoie vrai si un changement de zone a eu lieu. */
  private async scripts(mode: Mode): Promise<boolean> {
    const zone = this.zone;
    const outcome = await runScripts(this.scriptHost(), mode, zone.zone.actions);
    this.bumped = null;
    this.placed = null;
    if (outcome === ScriptOutcome.ZoneChanged || this.pendingZone) {
      await this.performPendingZoneChange();
      return true;
    }
    return outcome === ScriptOutcome.Ran && this.zone !== zone;
  }

  private requestZoneChange(zoneId: number, x: number, y: number, transition: Transition, mode = Mode.JustEntered): void {
    this.pendingZone = { zoneId, x, y, transition, mode };
  }

  private async performPendingZoneChange(): Promise<void> {
    while (this.pendingZone && !this.over) {
      const { zoneId, x, y, transition, mode } = this.pendingZone;
      this.pendingZone = null;
      const origin = this.zone;
      await this.presenter.transition(transition, () => {
        this.setZone(zoneId, { x, y });
        // Le compteur partagé suit le héros d'une zone à l'autre (`RoomTransitionScene` de WebFun).
        if (transition.type === "room") this.zone.sectorCounter = origin.sectorCounter;
      });
      this.layDownHotspotItems(this.zone);
      const zone = this.zone;
      const entry = transition.type === "room" && this.variant.byVehicleOnRoomChange ? mode | Mode.ByVehicle : mode;
      const outcome = await runScripts(this.scriptHost(), entry | Mode.JustEntered, zone.zone.actions);
      if (outcome === ScriptOutcome.ZoneChanged && !this.pendingZone) break;
    }
  }

  // ---------------------------------------------------------------- hotspots

  private layDownHotspotItems(zone: ZoneState): void {
    for (const h of zone.hotspots) {
      if (!h.enabled || h.argument < 0) continue;
      switch (h.type) {
        case HotspotType.DropQuestItem:
        case HotspotType.SpawnLocation:
        case HotspotType.DropUniqueWeapon:
        case HotspotType.DropMap:
        case HotspotType.DropItem:
        case HotspotType.Npc:
        case HotspotType.DropWeapon:
        case HotspotType.Bonus:
          if (zone.getTile(h.x, h.y, Layer.Object) === -1 && !(h.x === this.hero.x && h.y === this.hero.y)) {
            zone.setTile(h.x, h.y, Layer.Object, h.argument);
          }
          break;
        default:
          break;
      }
    }
  }

  /** Le héros cogne un objet : PNJ, objet à ramasser. Renvoie vrai si un hotspot a réagi. */
  private async bumpHotspots(at: Point, talk = true): Promise<boolean> {
    const zone = this.zone;
    const tile = zone.getTile(at.x, at.y, Layer.Object);
    for (const h of zone.hotspots) {
      if (!h.enabled || h.x !== at.x || h.y !== at.y) continue;
      switch (h.type) {
        case HotspotType.SpawnLocation:
          if (tile !== h.argument || !talk) continue;
          await this.talkToNpc(tile, at);
          return true;
        case HotspotType.DropItem:
        case HotspotType.DropMap:
        case HotspotType.DropQuestItem:
        case HotspotType.DropUniqueWeapon:
        case HotspotType.DropWeapon:
        case HotspotType.Bonus:
          if (tile !== h.argument) continue;
          zone.setTile(at.x, at.y, Layer.Object, -1);
          h.enabled = false;
          await this.dropItem(tile, at);
          return true;
        default:
          continue;
      }
    }
    return false;
  }

  private async talkToNpc(tile: number, at: Point): Promise<void> {
    const assets = this.assets;
    if (await this.variant.talkToNpc?.(this, tile, at)) return;
    const sector = this.sector;
    if (!sector || sector.npc !== tile) return;
    const puzzle = assets.puzzle(sector.puzzle);
    const offer = assets.puzzle(sector.offerPuzzle);
    const text = sector.solved
      ? puzzle?.texts[1]
      : [puzzle?.texts[0], offer?.texts[2]].filter((t) => t && t.trim()).join("\n\n");
    if (text) await this.presenter.speak(text, at);
  }

  /** Contrepartie d'un point chaud de véhicule : l'emplacement d'arrivée dans la zone de destination. */
  private static readonly VEHICLE_ARRIVAL: Partial<Record<HotspotType, HotspotType>> = {
    [HotspotType.VehicleTo]: HotspotType.VehicleBack,
    [HotspotType.VehicleBack]: HotspotType.VehicleTo,
    // Yoda : le X-Wing relie Dagobah et la planète.
    [HotspotType.ShipToPlanet]: HotspotType.ShipFromPlanet,
    [HotspotType.ShipFromPlanet]: HotspotType.ShipToPlanet,
  };

  /** Le héros se tient sur une case : véhicules. */
  private async standHotspots(): Promise<boolean> {
    const here = { x: this.hero.x, y: this.hero.y };
    if (this.standLock) {
      if (samePoint(this.standLock, here)) return false;
      this.standLock = null;
    }
    const h = this.zone.hotspots.find(
      (hs) => hs.enabled && hs.x === here.x && hs.y === here.y && Game.VEHICLE_ARRIVAL[hs.type] !== undefined,
    );
    if (!h || h.argument < 0) return false;
    const counterpart = Game.VEHICLE_ARRIVAL[h.type];
    const destination = this.assets.zone(h.argument);
    const arrival = destination.hotspots.find((hs) => hs.type === counterpart);
    if (!arrival) return false;
    this.requestZoneChange(destination.id, arrival.x, arrival.y, { type: "room" }, Mode.ByVehicle);
    await this.performPendingZoneChange();
    return true;
  }

  /** Le héros vient d'arriver sur une case : portes. */
  private async walkHotspots(): Promise<boolean> {
    const zone = this.zone;
    const h = zone.hotspots.find((hs) => hs.enabled && hs.x === this.hero.x && hs.y === this.hero.y);
    if (!h) return false;
    if (h.type === HotspotType.DoorIn && h.argument >= 0) {
      const room = this.zoneState(h.argument);
      const exit = room.hotspots.find(
        (hs) => hs.type === HotspotType.DoorOut && (hs.argument === -1 || hs.argument === zone.id),
      );
      if (!exit) return false;
      exit.argument = zone.id;
      room.doorInLocation = { x: h.x, y: h.y };
      this.playSound(this.variant.sounds.door);
      this.requestZoneChange(room.id, exit.x, exit.y, { type: "room" });
      await this.performPendingZoneChange();
      return true;
    }
    if (h.type === HotspotType.Teleporter) return this.teleport();
    if (h.type === HotspotType.DoorOut && h.argument >= 0 && zone.doorInLocation) {
      this.playSound(this.variant.sounds.door);
      this.requestZoneChange(h.argument, zone.doorInLocation.x, zone.doorInLocation.y, { type: "room" });
      await this.performPendingZoneChange();
      return true;
    }
    return false;
  }

  /** Téléporteurs : avec la carte, on rejoint n'importe quel autre téléporteur déjà visité. */
  private async teleport(): Promise<boolean> {
    if (!this.inventory.some((t) => this.assets.isMapTile(t))) return false;
    const destinations = this.story.sectors.flatMap((sector, index) => {
      if (!sector?.visited || sector.zoneId === this.zone.id) return [];
      const state = this.zones.get(sector.zoneId);
      return state?.hotspots.some((h) => h.type === HotspotType.Teleporter && h.enabled) ? [index] : [];
    });
    if (!destinations.length) return false;
    const choice = await this.presenter.chooseTeleport(destinations);
    if (choice === null || !destinations.includes(choice)) return false;
    const target = this.zones.get(this.story.sectors[choice]!.zoneId)!;
    const pad = target.hotspots.find((h) => h.type === HotspotType.Teleporter && h.enabled)!;
    this.playSound(this.variant.sounds.teleport);
    this.requestZoneChange(target.id, pad.x, pad.y, { type: "room" });
    await this.performPendingZoneChange();
    return true;
  }

  // ---------------------------------------------------------------- objets

  async dropItem(tile: number, at: Point): Promise<void> {
    await this.presenter.pickup(tile, at);
    this.addItem(tile);
    const sector = this.sector;
    if (sector && sector.findItem === tile) sector.solved = true;
  }

  /** Utilisation d'un objet sur une case. Renvoie vrai si la zone a changé. */
  private async handlePlacement(p: { tile: number; x: number; y: number }): Promise<boolean> {
    const assets = this.assets;
    const hero = this.hero;
    if (!this.hasItem(p.tile)) return false;
    if (await this.variant.onPlaceTile?.(this, p.tile, { x: p.x, y: p.y })) return false;
    if (p.x === hero.x && p.y === hero.y) {
      if (assets.isWeaponTile(p.tile)) this.equip(p.tile);
      else if (!(await this.consume(p.tile))) this.playSound(this.variant.sounds.noGo);
      return false;
    }
    if (Math.max(Math.abs(p.x - hero.x), Math.abs(p.y - hero.y)) > 1 || !this.zone.inBounds(p.x, p.y)) return false;

    let handled = false;
    const sector = this.sector;
    const zone = this.zone;
    const lock = zone.hotspotAt(p.x, p.y, HotspotType.Lock);
    if (sector && lock?.enabled && p.tile === sector.requiredItem && (this.variant.lockAccepts?.(sector) ?? true)) {
      lock.enabled = false;
      this.removeItem(p.tile);
      if (sector.kind === SectorKind.Blockade || sector.kind === SectorKind.Travel) sector.solved = true;
      handled = true;
    } else if (
      sector?.kind === SectorKind.Puzzle &&
      sector.npc >= 0 &&
      p.tile === sector.requiredItem &&
      zone.getTile(p.x, p.y, Layer.Object) === sector.npc &&
      zone.hotspotAt(p.x, p.y, HotspotType.SpawnLocation)
    ) {
      this.removeItem(p.tile);
      const thanks = assets.puzzle(sector.puzzle)?.texts[1];
      if (thanks) await this.presenter.speak(thanks, p);
      if (sector.findItem >= 0) await this.dropItem(sector.findItem, p);
      sector.solved = true;
      handled = true;
    } else if (this.variant.placeOnPuzzle?.(this, p.tile, { x: p.x, y: p.y })) {
      handled = true;
    }

    this.placed = p;
    const before = this.zone;
    const outcome = await runScripts(this.scriptHost(), Mode.PlaceItem, zone.zone.actions);
    this.placed = null;
    if (outcome === ScriptOutcome.ZoneChanged || this.pendingZone) {
      await this.performPendingZoneChange();
      return true;
    }
    if (!handled && outcome === ScriptOutcome.Idle) this.playSound(this.variant.sounds.noGo);
    return this.zone !== before;
  }

  /** Mange / boit / utilise un objet sur le héros (règles du jeu). Renvoie faux s'il ne se consomme pas. */
  consume(tile: number): Promise<boolean> {
    return this.variant.consume(this, tile);
  }

  // ---------------------------------------------------------------- santé

  setHealth(value: number): void {
    this.hero.health = Math.max(0, Math.min(MAX_HEALTH, value));
    this.emit(GameEvent.Health);
    if (this.hero.health <= 0 && !this.over) void this.lose();
  }

  /** Barème de l'original : les dégâts sont divisés par 100 / difficulté (÷2 à difficulté normale), avec un minimum de 1. */
  scaleDamage(damage: number): number {
    const divisor = Math.max(1, Math.floor(100 / Math.max(1, this.settings.difficulty)));
    return Math.max(1, Math.floor(damage / divisor));
  }

  hurtHero(damage: number): void {
    if (this.over || damage <= 0) return;
    this.playSound(this.variant.sounds.hurt);
    this.setHealth(this.hero.health - this.scaleDamage(damage));
  }

  /** Mort scriptée (opcode KillHero) : même défaite qu'une santé tombée à 0. */
  private killHero(): void {
    if (!this.over) this.setHealth(0);
  }

  private async lose(): Promise<void> {
    this.over = true;
    this.playSound(this.variant.sounds.defeat);
    const lose = this.variant.endZones?.lose;
    if (lose !== undefined) await this.playEndZone(lose);
    await this.presenter.ended("lose", 0);
  }

  private async win(): Promise<void> {
    if (this.gameWon) return;
    this.gameWon = true;
    // Calculé une fois (le score de Yoda contient un tirage) : l'interface le lit à l'événement Won.
    this.finalScore = this.score();
    this.emit(GameEvent.Won);
    this.playSound(this.variant.sounds.victory);
    const win = this.variant.endZones?.win;
    const restore = win !== undefined ? await this.playEndZone(win) : null;
    await this.presenter.ended("win", this.finalScore);
    restore?.();
  }

  /**
   * Scène de fin (Yoda : `WinScene` / `LoseScene` de WebFun) : la zone de victoire ou de défaite s'affiche, héros caché, et ses
   * scripts d'entrée se jouent (le X-Wing qui passe). Renvoie de quoi revenir là où était le héros.
   */
  private async playEndZone(zoneId: number): Promise<() => void> {
    const previous = { zone: this.zone, x: this.hero.x, y: this.hero.y, visible: this.hero.visible };
    this.hero.visible = false;
    this.overlays.length = 0;
    this.zone = this.zoneState(zoneId);
    this.emit(GameEvent.Zone);
    await runScripts(this.scriptHost(), Mode.JustEntered, this.zone.zone.actions);
    // La scène de fin ne mène nulle part : un changement de zone qu'elle demanderait est ignoré.
    this.pendingZone = null;
    return () => {
      this.zone = previous.zone;
      Object.assign(this.hero, { x: previous.x, y: previous.y, visible: previous.visible });
      this.overlays.length = 0;
      this.emit(GameEvent.Zone);
    };
  }

  /** Tous les sons passent ici, entendus ou non : le jeu peut en tenir compte (voir `DesktopVariant.onSound`). */
  playSound(id: number): void {
    if (id < 0) return;
    this.variant.onSound?.(this, id);
    this.presenter.playSound(id);
  }

  /** Enregistre la difficulté courante (Indy : à chaque son « manger », pour le score). */
  recordDifficulty(): void {
    this.difficultySum += this.settings.difficulty;
    this.difficultyCount++;
  }

  /** Difficultés enregistrées par `recordDifficulty` : leur somme et leur nombre. */
  get difficultySamples(): { sum: number; count: number } {
    return { sum: this.difficultySum, count: this.difficultyCount };
  }

  /** Temps de jeu écoulé, sessions précédentes comprises (secondes entières). */
  get playedSeconds(): number {
    return Math.floor((this.playedMs + Date.now() - this.startedAt) / 1000);
  }

  score(): number {
    return this.variant.score(this);
  }

  // ---------------------------------------------------------------- combat

  private async updateAttack(): Promise<boolean> {
    const attack = this.attack;
    if (!attack) return false;
    attack.frame++;
    const zone = this.zone;
    const v = DIRECTION_VECTORS[this.hero.facing];
    if (attack.projectile && attack.bullet) {
      const next = { x: attack.bullet.x + v.x, y: attack.bullet.y + v.y };
      const target = zone.monsterAt(next.x, next.y);
      if (target) {
        this.damageMonster(target.index, attack.weapon);
        this.attack = null;
        return false;
      }
      if (!zone.inBounds(next.x, next.y) || attack.frame > (this.variant.bulletAlongPath ? PATH_BULLET_RANGE : BULLET_RANGE)) {
        this.attack = null;
        return false;
      }
      if (this.variant.bulletAlongPath) {
        // Yoda (`bullet-move.ts` de WebFun) : un objet transparent (sprite) arrête le tir ; une case vide ou un objet
        // opaque (mur, machine) le laisse passer, après avoir donné aux scripts « objet posé » l'occasion de réagir.
        const tile = zone.getTile(next.x, next.y, Layer.Object);
        if (tile !== -1 && this.assets.hasFlag(tile, TileFlag.Transparent)) {
          this.attack = null;
          return false;
        }
        attack.bullet = next;
        const before = this.zone;
        const changed = await this.weaponPlaced(attack.weapon, next);
        if (changed || this.zone !== before) this.attack = null;
        return changed;
      }
      if (zone.getTile(next.x, next.y, Layer.Object) !== -1) {
        this.attack = null;
        return this.weaponPlaced(attack.weapon, next);
      }
      attack.bullet = next;
      return false;
    }
    if (attack.frame >= 3) this.attack = null;
    return false;
  }

  private async startAttack(): Promise<boolean> {
    const weapon = this.weapon ?? this.assets.character(this.variant.defaultWeapon) ?? null;
    if (!weapon) return false;
    const v = DIRECTION_VECTORS[this.hero.facing];
    const target = { x: this.hero.x + v.x, y: this.hero.y + v.y };
    const projectile = weapon.frames[0][FrameEntry.Left] >= 0;
    this.attack = { weapon, frame: 0, projectile, bullet: projectile ? { x: this.hero.x, y: this.hero.y } : null };
    if (weapon.reference >= 0) this.playSound(weapon.reference);
    if (weapon === this.weapon) this.spendAmmo();
    if (projectile) return false;
    const monster = this.zone.monsterAt(target.x, target.y);
    if (monster) {
      this.damageMonster(monster.index, weapon);
      return false;
    }
    if (!this.zone.inBounds(target.x, target.y)) return false;
    return this.weaponPlaced(weapon, target);
  }

  /** Une arme touche un objet : les scripts peuvent réagir (fouet sur une branche, tir sur une cible…). */
  private async weaponPlaced(weapon: Character, at: Point): Promise<boolean> {
    const tile = this.weaponTile(weapon);
    if (tile < 0) return false;
    this.placed = { tile, x: at.x, y: at.y };
    const outcome = await runScripts(this.scriptHost(), Mode.PlaceItem, this.zone.zone.actions);
    this.placed = null;
    if (outcome === ScriptOutcome.ZoneChanged || this.pendingZone) {
      await this.performPendingZoneChange();
      return true;
    }
    return false;
  }

  private damageMonster(index: number, weapon: Character): void {
    const m = this.zone.monsters.find((monster) => monster.index === index);
    if (!m) return;
    if (this.variant.hitMonster?.(this, m, weapon)) return;
    this.hurtMonster(m, Math.max(1, weapon.damage));
  }

  /** Inflige des dégâts à un monstre de la zone courante ; à sa mort, il disparaît et lâche son butin. */
  hurtMonster(m: Monster, damage: number): void {
    if (!m.enabled || !isAlive(m)) return;
    m.damageTaken += damage;
    m.cooldown = 1;
    if (!isAlive(m)) {
      killMonster(m, this.zone);
      this.playSound(this.variant.sounds.monsterDeath);
      this.dropLoot(m);
    }
  }

  /**
   * Butin d'un monstre (Yoda, `_dropLoot` de WebFun) : l'objet `loot - 1` s'il est indiqué, sinon l'objet de quête du
   * premier emplacement DropQuestItem préparé par la génération. Il apparaît à la place du monstre, à ramasser.
   */
  private dropLoot(m: Monster): void {
    const placement = this.zone.zone.monsters[m.index];
    if (!placement?.dropsLoot) return;
    let item = placement.loot > 0 ? placement.loot - 1 : -1;
    if (item < 0) {
      const quest = this.zone.hotspots.find((h) => h.type === HotspotType.DropQuestItem && h.argument > 0);
      if (!quest) return;
      item = quest.argument;
      quest.enabled = false;
    }
    this.zone.hotspots.push({ type: HotspotType.DropItem, x: m.x, y: m.y, enabled: true, argument: item });
    this.zone.setTile(m.x, m.y, Layer.Object, item);
  }

  // ---------------------------------------------------------------- déplacements

  private async handleInput(): Promise<void> {
    const hero = this.hero;
    if (this.attackRequested) {
      this.attackRequested = false;
      if (!this.attack && hero.visible) {
        await this.startAttack();
        return;
      }
    }
    if (this.attack) return;
    const move = this.input.move;
    if (move.x === 0 && move.y === 0) {
      hero.walkFrame = 0;
      return;
    }
    hero.facing = directionOf(move, hero.facing);
    await this.moveHero(move);
  }

  private async moveHero(move: Point): Promise<void> {
    const hero = this.hero;
    const zone = this.zone;
    const target = { x: hero.x + move.x, y: hero.y + move.y };
    if (zone.inBounds(target.x, target.y) && zone.getTile(target.x, target.y, Layer.Object) !== -1) {
      const pushable = this.input.drag && this.assets.isDraggable(zone.getTile(target.x, target.y, Layer.Object));
      if (!pushable) {
        // Yoda : les points chauds passent d'abord (`moveHero` de WebFun).
        if (this.variant.hotspotsBeforeBumpScripts && (await this.bumpHotspots(target))) return;
        // Indy : les scripts passent avant les hotspots ; certains PNJ « objets de mission » (Pacal…)
        // doivent parler au lieu d'être ramassés.
        this.bumped = target;
        const before = this.zone;
        const outcome = await runScripts(this.scriptHost(), Mode.Bump, before.zone.actions);
        this.bumped = null;
        if (outcome === ScriptOutcome.ZoneChanged || this.pendingZone) {
          await this.performPendingZoneChange();
          return;
        }
        // Puis les hotspots : un objet se ramasse même si un script a réagi (fanfare…),
        // mais un PNJ ne répète pas son texte générique si un script l'a déjà fait parler.
        if (!this.variant.hotspotsBeforeBumpScripts && (await this.bumpHotspots(target, outcome !== ScriptOutcome.Ran))) return;
        if (outcome === ScriptOutcome.Ran) return;
      }
    }
    if (this.tryMove(move)) {
      hero.walkFrame++;
      await this.walkHotspots();
      return;
    }
    if (!zone.inBounds(target.x, target.y)) await this.trySectorTransition(move);
  }

  /**
   * Comme MoveHero de l'original (DESKADV.EXE 4:733e) : seule la case cible compte. Une cible bloquée
   * n'entraîne ni glissement ni repli sur un axe ; seule la poussée en ligne droite (Maj) existe.
   */
  private tryMove(move: Point): boolean {
    const drag = this.input.drag;
    if (this.doMove(move, drag && (move.x === 0 || move.y === 0))) return true;
    if (!this.variant.slideOnBlock) return false;
    // Yoda (`Hero.move` de WebFun) : axe horizontal seul, puis vertical seul, puis contournement en diagonale.
    if (move.x !== 0 && move.y !== 0) {
      if (this.doMove({ x: move.x, y: 0 }, drag) || this.doMove({ x: 0, y: move.y }, drag)) return true;
      return false;
    }
    if (drag) return false;
    const sides = move.x === 0 ? [{ x: -1, y: move.y }, { x: 1, y: move.y }] : [{ x: move.x, y: 1 }, { x: move.x, y: -1 }];
    return sides.some((side) => this.doMove(side, false));
  }

  private doMove(rel: Point, drag: boolean): boolean {
    const zone = this.zone;
    const hero = this.hero;
    const target = { x: hero.x + rel.x, y: hero.y + rel.y };
    if (!zone.inBounds(target.x, target.y)) return false;
    // Passer en coin entre deux obstacles est permis : seule la case cible est testée (comme l'original).
    if (zone.isFree(target.x, target.y)) {
      if (drag) this.drag({ x: hero.x - rel.x, y: hero.y - rel.y }, { x: hero.x, y: hero.y });
      hero.x = target.x;
      hero.y = target.y;
      return true;
    }
    if (drag && this.drag(target, { x: target.x + rel.x, y: target.y + rel.y })) {
      hero.x = target.x;
      hero.y = target.y;
      return true;
    }
    return false;
  }

  /** Déplace un objet « draggable » de `from` vers `to` si la destination est libre. */
  private drag(from: Point, to: Point): boolean {
    const zone = this.zone;
    if (!zone.inBounds(from.x, from.y) || !zone.isFree(to.x, to.y)) return false;
    const tile = zone.getTile(from.x, from.y, Layer.Object);
    if (tile === -1 || !this.assets.isDraggable(tile)) return false;
    zone.setTile(from.x, from.y, Layer.Object, -1);
    zone.setTile(to.x, to.y, Layer.Object, tile);
    this.playSound(this.variant.sounds.push);
    return true;
  }

  private async trySectorTransition(move: Point): Promise<void> {
    const zone = this.zone;
    if (!this.world.isOverworld(zone.id)) return;
    const dx = this.hero.x + move.x < 0 ? -1 : this.hero.x + move.x >= zone.width ? 1 : 0;
    const dy = this.hero.y + move.y < 0 ? -1 : this.hero.y + move.y >= zone.height ? 1 : 0;
    if (dx !== 0 && dy !== 0) return;
    const next = this.world.neighbor(zone.id, dx, dy);
    if (!next) return;
    const destination = this.zoneState(next.zoneId);
    const x = dx === 0 ? this.hero.x + move.x : dx < 0 ? destination.width - 1 : 0;
    const y = dy === 0 ? this.hero.y + move.y : dy < 0 ? destination.height - 1 : 0;
    if (!destination.isFree(x, y)) return;
    this.requestZoneChange(next.zoneId, x, y, { type: "sector", dx, dy });
    await this.performPendingZoneChange();
  }

  // ---------------------------------------------------------------- hôtes

  private monsterHost() {
    const game = this;
    return {
      zone: this.zone,
      assets: this.assets,
      rng: this.rng,
      tick: this.tick,
      hero: { x: this.hero.x, y: this.hero.y },
      hurtHero: (damage: number) => game.hurtHero(damage),
      playSound: (id: number) => game.playSound(id),
    };
  }

  private scriptHost(): ScriptHost {
    const game = this;
    return {
      opcodes: this.variant.opcodes,
      zone: this.zone,
      get sector() {
        return game.sector;
      },
      hero: this.hero,
      goalItem: this.goalItem,
      get gameWon() {
        return game.gameWon;
      },
      gamesWon: this.settings.gamesWon ?? 0,
      bumped: this.bumped,
      placed: this.placed,
      itemName: (tile) => game.assets.tileName(tile),
      hasItem: (tile) => game.hasItem(tile),
      addItem: (tile) => game.addItem(tile),
      removeItem: (tile) => game.removeItem(tile),
      random: (n) => game.rng.mod(n),
      speak: (text, at) => game.presenter.speak(text, at),
      wait: (ticks) => game.waitTicks(ticks),
      playSound: (id) => game.playSound(id),
      stopSound: () => game.presenter.stopSound?.(),
      dropItem: (tile, at) => game.dropItem(tile, at),
      drawOverlay: (x, y, tile) => game.overlays.push({ x, y, tile }),
      clearOverlays: () => {
        game.overlays.length = 0;
      },
      moveHeroTo: (x, y) => {
        game.hero.x = x;
        game.hero.y = y;
      },
      markSolved: () => {
        const sector = game.sector;
        if (sector) sector.solved = true;
      },
      addHealth: (amount) => game.setHealth(game.hero.health + amount),
      win: () => game.win(),
      lose: () => game.killHero(),
      killHero: () => game.killHero(),
      changeZone: (zoneId, x, y) => game.requestZoneChange(zoneId, x, y, { type: "room" }),
    };
  }

  /** Attend `ticks` ticks de la boucle (animations scriptées). */
  waitTicks(ticks: number): Promise<void> {
    return new Promise((resolve) => this.tickWaiters.push({ remaining: ticks, resolve }));
  }

  private resolveTickWaiters(): void {
    const ready = this.tickWaiters.filter((w) => --w.remaining <= 0);
    this.tickWaiters = this.tickWaiters.filter((w) => w.remaining > 0);
    for (const w of ready) w.resolve();
  }

  private emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

export const SAVE_VERSION = 2;

/** État complet d'une partie, sérialisable en JSON. */
export interface GameSnapshot {
  version: number;
  story: Omit<Story, "hotspotArguments"> & { hotspotArguments: Array<[number, Array<[number, number]>]> };
  settings: GameSettings;
  zones: ZoneSnapshot[];
  zoneId: number;
  hero: HeroState;
  inventory: number[];
  weapon: number;
  gameWon: boolean;
  playedMs: number;
  difficultySum: number;
  difficultyCount: number;
}

/**
 * Relit une sauvegarde de n'importe quelle version connue, au format courant (null : version inconnue).
 * v1 → v2 : `puzzleCount` devient `pace` (les départs de voyage et barrages, inconnus, sont comptés pour 0 : W = puzzles + 1),
 * et la difficulté de la partie tient lieu de seule difficulté enregistrée (sinon le score retomberait au minimum).
 */
export function migrateSnapshot(raw: unknown): GameSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const snapshot = raw as GameSnapshot;
  if (snapshot.version === SAVE_VERSION) return snapshot;
  if (snapshot.version !== 1) return null;
  const { puzzleCount, ...story } = snapshot.story as GameSnapshot["story"] & { puzzleCount: number };
  return {
    ...snapshot,
    version: SAVE_VERSION,
    story: { ...story, pace: puzzleCount + 1 },
    difficultySum: snapshot.settings.difficulty,
    difficultyCount: 1,
  };
}

export function storyFromSnapshot(s: GameSnapshot): Story {
  return { ...s.story, hotspotArguments: new Map(s.story.hotspotArguments.map(([z, h]) => [z, new Map(h)])) };
}
