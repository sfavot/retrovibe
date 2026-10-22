import { type Character, FrameEntry, HotspotType, Layer } from "../data/types";
import { type Assets, IndyIds, IndySounds } from "./assets";
import { DIRECTION_VECTORS, Direction, type Point, directionOf, samePoint } from "./geometry";
import { killMonster, moveMonsters, placeMonsters } from "./monsters";
import { Rng, randomSeed } from "./rng";
import { indyQuotient } from "./score";
import { Mode, type ScriptHost, ScriptOutcome, runScripts } from "./script";
import { type Sector, SectorKind, type Story, World } from "./world";
import { type ZoneSnapshot, ZoneState, isAlive, restoreZone, snapshotZone } from "./zone-state";

export const MAX_HEALTH = 300;
/** Distance maximale d'un projectile du héros (cases). */
const BULLET_RANGE = 4;

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
  ended(kind: "win" | "lose", score: number): Promise<void>;
  /** Choix d'un téléporteur de destination sur la carte (index de case), null = annuler. */
  chooseTeleport(destinations: number[]): Promise<number | null>;
}

export interface GameSettings {
  /** 0 (facile) à 100 (difficile). */
  difficulty: number;
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
  attack: AttackState | null = null;
  readonly overlays: Array<{ x: number; y: number; tile: number }> = [];
  readonly input: InputState = { move: { x: 0, y: 0 }, drag: false };
  gameWon = false;
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
  /** Difficultés enregistrées à chaque son 0 (DESKADV.EXE 3:e4af) : leur somme et leur nombre servent au score. */
  private difficultySum = 0;
  private difficultyCount = 0;

  constructor(
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
        if (h.type === HotspotType.Bonus) h.argument = IndyIds.bonusTile;
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
  }

  removeItem(tile: number): void {
    const index = this.inventory.indexOf(tile);
    if (index === -1) return;
    this.inventory.splice(index, 1);
    this.emit(GameEvent.Inventory);
    if (this.weapon && this.weaponTile(this.weapon) === tile && !this.inventory.includes(tile)) {
      this.weapon = null;
      this.emit(GameEvent.Weapon);
    }
  }

  weaponTile(weapon: Character): number {
    return weapon.frames[0][FrameEntry.ExtensionRight];
  }

  equip(tile: number): boolean {
    const weapon = this.assets.weaponForTile(tile);
    if (!weapon) return false;
    this.weapon = weapon;
    this.emit(GameEvent.Weapon);
    return true;
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
    this.setZone(startZone, at);
    const goal = this.assets.puzzle(this.story.goalPuzzle);
    if (goal?.texts[3]) await this.presenter.message(goal.texts[3]);
    if (this.story.startItem >= 0) await this.dropItem(this.story.startItem, { x: at.x, y: at.y });
    await this.enterCurrentZone(Mode.JustEntered);
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
    moveMonsters(this.monsterHost());
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
    const outcome = await runScripts(this.scriptHost(), mode, zone.zone.actions, (id) => this.assets.tileName(id));
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
      await this.presenter.transition(transition, () => this.setZone(zoneId, { x, y }));
      this.layDownHotspotItems(this.zone);
      const zone = this.zone;
      const outcome = await runScripts(this.scriptHost(), mode | Mode.JustEntered, zone.zone.actions, (id) =>
        this.assets.tileName(id),
      );
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
    if (tile === MARCUS_DESK) {
      // Dans la mission « Marcus enlevé », son bureau est vide : personne ne répond.
      if (this.goalItem === MARCUS_KIDNAPPED) return;
      const goal = assets.puzzle(this.story.goalPuzzle);
      const text = this.gameWon ? goal?.texts[1] : goal?.texts[2];
      if (text) await this.presenter.speak(text, { x: at.x, y: at.y - 1 });
      return;
    }
    const sector = this.sector;
    if (!sector || sector.npc !== tile) return;
    const puzzle = assets.puzzle(sector.puzzle);
    const offer = assets.puzzle(sector.offerPuzzle);
    const text = sector.solved
      ? puzzle?.texts[1]
      : [puzzle?.texts[0], offer?.texts[2]].filter((t) => t && t.trim()).join("\n\n");
    if (text) await this.presenter.speak(text, at);
  }

  /** Le héros se tient sur une case : véhicules. */
  private async standHotspots(): Promise<boolean> {
    const here = { x: this.hero.x, y: this.hero.y };
    if (this.standLock) {
      if (samePoint(this.standLock, here)) return false;
      this.standLock = null;
    }
    const h = this.zone.hotspots.find(
      (hs) =>
        hs.enabled &&
        hs.x === here.x &&
        hs.y === here.y &&
        (hs.type === HotspotType.VehicleTo || hs.type === HotspotType.VehicleBack),
    );
    if (!h || h.argument < 0) return false;
    const counterpart = h.type === HotspotType.VehicleTo ? HotspotType.VehicleBack : HotspotType.VehicleTo;
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
      this.playSound(IndySounds.Door);
      this.requestZoneChange(room.id, exit.x, exit.y, { type: "room" });
      await this.performPendingZoneChange();
      return true;
    }
    if (h.type === HotspotType.Teleporter) return this.teleport();
    if (h.type === HotspotType.DoorOut && h.argument >= 0 && zone.doorInLocation) {
      this.playSound(IndySounds.Door);
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
    this.playSound(IndySounds.Flourish);
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
    if (p.x === hero.x && p.y === hero.y) {
      if (assets.isWeaponTile(p.tile)) this.equip(p.tile);
      else if (!(await this.consume(p.tile))) this.playSound(IndySounds.NoGo);
      return false;
    }
    if (Math.max(Math.abs(p.x - hero.x), Math.abs(p.y - hero.y)) > 1 || !this.zone.inBounds(p.x, p.y)) return false;

    let handled = false;
    const sector = this.sector;
    const zone = this.zone;
    const lock = zone.hotspotAt(p.x, p.y, HotspotType.Lock);
    if (sector && lock?.enabled && p.tile === sector.requiredItem) {
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
    }

    this.placed = p;
    const before = this.zone;
    const outcome = await runScripts(this.scriptHost(), Mode.PlaceItem, zone.zone.actions, (id) => assets.tileName(id));
    this.placed = null;
    if (outcome === ScriptOutcome.ZoneChanged || this.pendingZone) {
      await this.performPendingZoneChange();
      return true;
    }
    if (!handled && outcome === ScriptOutcome.Idle) this.playSound(IndySounds.NoGo);
    return this.zone !== before;
  }

  /**
   * Mange / boit un objet (4:3f99 de l'original). Renvoie faux s'il ne se consomme pas, ou si le héros est en pleine
   * forme (l'original refuse alors de manger, avec le son NoGo, mais pas de boire).
   */
  async consume(tile: number): Promise<boolean> {
    const assets = this.assets;
    if (assets.isEdible(tile)) {
      if (this.hero.health >= MAX_HEALTH) return false;
      if (tile === IndyIds.bananasTile && this.zone.id === IndyIds.easterEggZone && this.hero.x === IndyIds.easterEggSpot.x && this.hero.y === IndyIds.easterEggSpot.y) {
        this.playSound(IndySounds.TooMuchFruit);
        await this.presenter.speak(TOO_MUCH_FRUIT, null);
      }
      this.removeItem(tile);
      this.setHealth(this.hero.health + (HEALTH_BONUS[tile] ?? 0));
      this.playSound(IndySounds.Eat);
      return true;
    }
    if (assets.isDrink(tile)) {
      this.removeItem(tile);
      this.playSound(IndySounds.Hurt);
      this.setHealth(this.hero.health - this.scaleDamage(DRINK_DAMAGE));
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- santé

  private setHealth(value: number): void {
    this.hero.health = Math.max(0, Math.min(MAX_HEALTH, value));
    this.emit(GameEvent.Health);
    if (this.hero.health <= 0 && !this.over) void this.lose();
  }

  /** Barème de l'original : les dégâts sont divisés par 100 / difficulté (÷2 à difficulté normale), avec un minimum de 1. */
  private scaleDamage(damage: number): number {
    const divisor = Math.max(1, Math.floor(100 / Math.max(1, this.settings.difficulty)));
    return Math.max(1, Math.floor(damage / divisor));
  }

  hurtHero(damage: number): void {
    if (this.over || damage <= 0) return;
    this.playSound(IndySounds.Hurt);
    this.setHealth(this.hero.health - this.scaleDamage(damage));
  }

  /** Mort scriptée (opcode KillHero) : même défaite qu'une santé tombée à 0. */
  private killHero(): void {
    if (!this.over) this.setHealth(0);
  }

  private async lose(): Promise<void> {
    this.over = true;
    this.playSound(IndySounds.Defeat);
    await this.presenter.ended("lose", 0);
  }

  private async win(): Promise<void> {
    if (this.gameWon) return;
    this.gameWon = true;
    this.emit(GameEvent.Won);
    this.playSound(IndySounds.Victory);
    await this.presenter.ended("win", this.score());
  }

  /** Tous les sons passent ici : l'original enregistre la difficulté à chaque son 0 (manger), entendu ou non. */
  private playSound(id: number): void {
    if (id === 0) {
      this.difficultySum += this.settings.difficulty;
      this.difficultyCount++;
    }
    this.presenter.playSound(id);
  }

  /** « Indy Quotient » : formule de l'original (voir `indyQuotient`), sur le temps de jeu écoulé. */
  score(): number {
    const seconds = Math.floor((this.playedMs + Date.now() - this.startedAt) / 1000);
    return indyQuotient(seconds, this.story.pace, this.difficultySum, this.difficultyCount);
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
        this.damageMonster(target.index, attack.weapon.damage);
        this.attack = null;
        return false;
      }
      if (!zone.inBounds(next.x, next.y) || attack.frame > BULLET_RANGE) {
        this.attack = null;
        return false;
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
    const weapon = this.weapon ?? this.assets.character(IndyIds.fistWeapon) ?? null;
    if (!weapon) return false;
    const v = DIRECTION_VECTORS[this.hero.facing];
    const target = { x: this.hero.x + v.x, y: this.hero.y + v.y };
    const projectile = weapon.frames[0][FrameEntry.Left] >= 0;
    this.attack = { weapon, frame: 0, projectile, bullet: projectile ? { x: this.hero.x, y: this.hero.y } : null };
    if (weapon.reference >= 0) this.playSound(weapon.reference);
    if (projectile) return false;
    const monster = this.zone.monsterAt(target.x, target.y);
    if (monster) {
      this.damageMonster(monster.index, weapon.damage);
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
    const outcome = await runScripts(this.scriptHost(), Mode.PlaceItem, this.zone.zone.actions, (id) =>
      this.assets.tileName(id),
    );
    this.placed = null;
    if (outcome === ScriptOutcome.ZoneChanged || this.pendingZone) {
      await this.performPendingZoneChange();
      return true;
    }
    return false;
  }

  private damageMonster(index: number, damage: number): void {
    const m = this.zone.monsters.find((monster) => monster.index === index);
    if (!m) return;
    m.damageTaken += Math.max(1, damage);
    m.cooldown = 1;
    if (!isAlive(m)) {
      killMonster(m, this.zone);
      this.playSound(IndySounds.MonsterDeath);
    }
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
        // Les scripts passent avant les hotspots : certains PNJ « objets de mission » (Pacal…)
        // doivent parler au lieu d'être ramassés.
        this.bumped = target;
        const before = this.zone;
        const outcome = await runScripts(this.scriptHost(), Mode.Bump, before.zone.actions, (id) => this.assets.tileName(id));
        this.bumped = null;
        if (outcome === ScriptOutcome.ZoneChanged || this.pendingZone) {
          await this.performPendingZoneChange();
          return;
        }
        // Puis les hotspots : un objet se ramasse même si un script a réagi (fanfare…),
        // mais un PNJ ne répète pas son texte générique si un script l'a déjà fait parler.
        if (await this.bumpHotspots(target, outcome !== ScriptOutcome.Ran)) return;
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
    return this.doMove(move, this.input.drag && (move.x === 0 || move.y === 0));
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
    this.playSound(IndySounds.Push);
    return true;
  }

  private async trySectorTransition(move: Point): Promise<void> {
    const zone = this.zone;
    const here = this.world.locate(zone.id);
    if (!here || !this.world.isOverworld(zone.id)) return;
    const dx = this.hero.x + move.x < 0 ? -1 : this.hero.x + move.x >= zone.width ? 1 : 0;
    const dy = this.hero.y + move.y < 0 ? -1 : this.hero.y + move.y >= zone.height ? 1 : 0;
    if (dx !== 0 && dy !== 0) return;
    const next = this.world.at(here.x + dx, here.y + dy);
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
      zone: this.zone,
      get sector() {
        return game.sector;
      },
      hero: this.hero,
      goalItem: this.goalItem,
      get gameWon() {
        return game.gameWon;
      },
      bumped: this.bumped,
      placed: this.placed,
      hasItem: (tile) => game.hasItem(tile),
      addItem: (tile) => game.addItem(tile),
      removeItem: (tile) => game.removeItem(tile),
      random: (n) => game.rng.mod(n),
      speak: (text, at) => game.presenter.speak(text, at),
      wait: (ticks) => game.waitTicks(ticks),
      playSound: (id) => game.playSound(id),
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
      win: () => game.win(),
      killHero: () => game.killHero(),
      changeZone: (zoneId, x, y) => game.requestZoneChange(zoneId, x, y, { type: "room" }),
    };
  }

  /** Attend `ticks` ticks de la boucle (animations scriptées). */
  private waitTicks(ticks: number): Promise<void> {
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

/** Bureau de Marcus (zone 108) : lui parler rappelle la mission. */
const MARCUS_DESK = 794;
/** Objet de la mission où Marcus est enlevé (MarcusGO). */
const MARCUS_KIDNAPPED = 1048;

/**
 * Soins des objets comestibles (DESKADV.EXE 4:3f99). L'original compte la santé en dégâts cumulés
 * (compteurs de 1 à 100 et de 1 à 3, mort à (100, 3)), soit 3 × 100 = 300 points : exactement MAX_HEALTH,
 * donc les valeurs sont reprises telles quelles (un soin n'est pas mis à l'échelle de la difficulté).
 * Les autres comestibles ne soignent pas mais sont consommés.
 */
const HEALTH_BONUS: Record<number, number> = {
  [IndyIds.bananasTile]: 25, // Bananas
  1085: 75, // First Aid Kit
  696: 50, // Yerba Buena
};

/** Dégâts d'une boisson (Tequila), mis à l'échelle de la difficulté comme n'importe quel dégât. */
const DRINK_DAMAGE = 35;

/** Texte d'origine (anglais, comme les dialogues du jeu). */
const TOO_MUCH_FRUIT = "Ugh. Too much fruit!";
