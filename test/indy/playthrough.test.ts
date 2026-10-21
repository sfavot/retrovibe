import { describe, expect, it } from "vitest";
import { HotspotType, Layer } from "../../src/games/indy/data/types";
import { Assets, IndyIds } from "../../src/games/indy/engine/assets";
import { Game, type Presenter } from "../../src/games/indy/engine/game";
import { generateStory } from "../../src/games/indy/engine/generation/generator";
import { solve } from "../../src/games/indy/engine/generation/solver";
import type { Point } from "../../src/games/indy/engine/geometry";
import { type Sector, SectorKind, WORLD_SIZE, WorldSize } from "../../src/games/indy/engine/world";
import { hasOriginalFiles, loadGameData } from "./helpers";

/**
 * Robot joueur : suit la solution du solveur en jouant pour de vrai (entrées clavier simulées,
 * un tick à la fois). Il ne sait pas résoudre les énigmes internes des zones (labyrinthes,
 * interrupteurs…) : le test mesure jusqu'où il va et signale les blocages.
 */

const presenter: Presenter = {
  speak: async () => {},
  message: async () => {},
  pickup: async () => {},
  transition: async (_, apply) => apply(),
  playSound: () => {},
  ended: async () => {},
  chooseTeleport: async () => null,
};

class Bot {
  ticks = 0;
  readonly cheats: string[] = [];
  constructor(readonly game: Game) {}

  async tick(): Promise<void> {
    const game = this.game;
    let done = false;
    const pending = game.step().finally(() => (done = true));
    for (let guard = 0; guard < 3000 && !done; guard++) {
      await new Promise((r) => setImmediate(r));
      if (!done) void game.step();
    }
    await pending;
    this.ticks++;
  }

  private free(x: number, y: number): boolean {
    const z = this.game.zone;
    if (!z.inBounds(x, y)) return false;
    const t = z.getTile(x, y, Layer.Object);
    return t === -1;
  }

  dump(): string {
    const z = this.game.zone;
    const rows: string[] = [];
    for (let y = 0; y < z.height; y++) {
      let l = "";
      for (let x = 0; x < z.width; x++) {
        const t = z.getTile(x, y, Layer.Object);
        l += x === this.game.hero.x && y === this.game.hero.y ? "@" : z.monsterAt(x, y) ? "M" : t === -1 ? "." : this.pushable(x, y) ? "d" : "#";
      }
      rows.push(l);
    }
    return `${z.zone.name}\n${rows.join("\n")}`;
  }

  private pushable(x: number, y: number): boolean {
    const z = this.game.zone;
    return z.inBounds(x, y) && this.game.assets.isDraggable(z.getTile(x, y, Layer.Object));
  }

  /** Frappe les monstres au contact (fouet), en se tournant vers eux. */
  async fightAdjacent(): Promise<boolean> {
    const game = this.game;
    const m = game.zone.monsters.find((mo) => mo.enabled && mo.damageTaken < mo.character.health && Math.abs(mo.x - game.hero.x) + Math.abs(mo.y - game.hero.y) === 1);
    if (!m) return false;
    game.hero.facing = m.y < game.hero.y ? 0 : m.y > game.hero.y ? 1 : m.x < game.hero.x ? 2 : 3;
    game.requestAttack();
    for (let t = 0; t < 4; t++) await this.tick();
    return true;
  }

  /** Chemin (BFS, 8 directions) vers une des cases cibles. */
  private path(targets: (x: number, y: number) => boolean): Point[] | null {
    const z = this.game.zone;
    const start = { x: this.game.hero.x, y: this.game.hero.y };
    const key = (p: Point) => p.x + p.y * z.width;
    const prev = new Map<number, Point | null>([[key(start), null]]);
    const queue: Point[] = [start];
    while (queue.length) {
      const p = queue.shift()!;
      if (targets(p.x, p.y)) {
        const out: Point[] = [];
        for (let c: Point | null = p; c && key(c) !== key(start); c = prev.get(key(c)) ?? null) out.unshift(c);
        return out;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const n = { x: p.x + dx, y: p.y + dy };
        if (prev.has(key(n))) continue;
        // Une pierre déplaçable se pousse en ligne droite si la case suivante est libre.
        const pushable = !(dx && dy) && this.pushable(n.x, n.y) && this.free(n.x + dx, n.y + dy);
        if (!this.free(n.x, n.y) && !pushable) continue;
        if (dx && dy && !this.free(p.x + dx, p.y) && !this.free(p.x, p.y + dy)) continue;
        prev.set(key(n), p);
        queue.push(n);
      }
    }
    return null;
  }

  /** Marche case par case ; renvoie faux si bloqué. */
  async walk(targets: (x: number, y: number) => boolean, maxTicks = 400): Promise<boolean> {
    const zone = this.game.zone;
    for (let t = 0; t < maxTicks; t++) {
      if (this.game.zone !== zone) return true;
      if (targets(this.game.hero.x, this.game.hero.y)) return true;
      const route = this.path(targets);
      if (!route || !route.length) {
        if (await this.fightAdjacent()) continue;
        return false;
      }
      const next = route[0];
      this.game.input.move = { x: next.x - this.game.hero.x, y: next.y - this.game.hero.y };
      this.game.input.drag = this.pushable(next.x, next.y);
      await this.tick();
      this.game.input.move = { x: 0, y: 0 };
      this.game.input.drag = false;
    }
    return false;
  }

  /** Aller dans une zone donnée en passant par les pièces (portes). */
  async enterRoom(roomId: number): Promise<boolean> {
    const assets = this.game.assets;
    for (let guard = 0; guard < 6 && this.game.zone.id !== roomId; guard++) {
      const here = this.game.zone;
      // Porte menant (directement ou non) vers la pièce visée.
      const doors = here.hotspots.filter(
        (h) => h.enabled && h.type === HotspotType.DoorIn && h.argument >= 0 && [...assets.roomsOf(h.argument)].some((r) => r.id === roomId),
      );
      for (const door of doors) {
        const adjacent = (x: number, y: number) => Math.abs(x - door.x) + Math.abs(y - door.y) === 1;
        if (!(await this.walk(adjacent))) {
          const cell = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((p) => here.isFree(p.x, p.y));
          if (!cell) continue;
          this.cheats.push(`porte ${here.zone.name}`);
          this.game.hero.x = cell.x;
          this.game.hero.y = cell.y;
        }
        this.game.input.move = { x: door.x - this.game.hero.x, y: door.y - this.game.hero.y };
        await this.tick();
        this.game.input.move = { x: 0, y: 0 };
        if (this.game.zone !== here) break;
      }
      if (this.game.zone === here) return false;
    }
    return this.game.zone.id === roomId;
  }

  /** Ressortir des pièces jusqu'à la zone extérieure. */
  async leaveRooms(): Promise<boolean> {
    for (let guard = 0; guard < 6 && !this.game.world.isOverworld(this.game.zone.id); guard++) {
      const here = this.game.zone;
      const exit = here.hotspots.find((h) => h.type === HotspotType.DoorOut);
      if (!exit) return false;
      const ok = await this.walk((x, y) => Math.abs(x - exit.x) + Math.abs(y - exit.y) === 1);
      if (!ok) {
        const cell = [[0, -1], [1, 0], [-1, 0], [0, 1]].map(([dx, dy]) => ({ x: exit.x + dx, y: exit.y + dy })).find((p) => here.isFree(p.x, p.y));
        if (!cell) {
          if (process.env.PLAY_DEBUG) console.log("sortie", exit, this.dump());
          return false;
        }
        this.cheats.push(`sortie ${here.zone.name}`);
        this.game.hero.x = cell.x;
        this.game.hero.y = cell.y;
      }
      this.game.input.move = { x: exit.x - this.game.hero.x, y: exit.y - this.game.hero.y };
      await this.tick();
      this.game.input.move = { x: 0, y: 0 };
      if (this.game.zone === here) {
        if (process.env.PLAY_DEBUG) console.log("sortie refusée", exit, here.doorInLocation, this.dump());
        return false;
      }
    }
    return true;
  }

  /** Rejoint la case `target` de la carte du monde, secteur par secteur. */
  async travelTo(target: number): Promise<string | null> {
    if (!(await this.leaveRooms())) return "impossible de sortir des pièces";
    const world = this.game.world;
    for (let guard = 0; guard < 40; guard++) {
      const here = world.locate(this.game.zone.id)!;
      const hereIndex = here.x + here.y * WORLD_SIZE;
      if (hereIndex === target) return null;
      // Voyage en véhicule vers une île.
      const route = this.sectorRoute(hereIndex, target);
      if (!route) return `pas de chemin sur la carte vers ${target}`;
      const next = route[0];
      if (next.vehicle) {
        const vehicle = this.game.zone.hotspots.find((h) => h.type === HotspotType.VehicleTo || h.type === HotspotType.VehicleBack)!;
        const ok = await this.walk((x, y) => x === vehicle.x && y === vehicle.y);
        if (!ok) return `véhicule inaccessible dans ${this.game.zone.zone.name}`;
        for (let t = 0; t < 60 && world.locate(this.game.zone.id)!.x + world.locate(this.game.zone.id)!.y * WORLD_SIZE === hereIndex; t++) await this.tick();
        continue;
      }
      const dx = (next.index % WORLD_SIZE) - here.x;
      const dy = Math.floor(next.index / WORLD_SIZE) - here.y;
      const zone = this.game.zone;
      const destination = this.game.zoneState(world.at(here.x + dx, here.y + dy)!.zoneId);
      const edge = (x: number, y: number) => {
        if (dx === 1 && x !== zone.width - 1) return false;
        if (dx === -1 && x !== 0) return false;
        if (dy === 1 && y !== zone.height - 1) return false;
        if (dy === -1 && y !== 0) return false;
        const nx = dx === 0 ? x : dx > 0 ? 0 : destination.width - 1;
        const ny = dy === 0 ? y : dy > 0 ? 0 : destination.height - 1;
        return destination.isFree(nx, ny);
      };
      if (!(await this.walk(edge))) {
        // Zone non traversable à pied pour le robot : on passe directement au bord.
        const cell = [...Array(zone.width).keys()]
          .map((k) => (dx ? { x: dx > 0 ? zone.width - 1 : 0, y: k } : { x: k, y: dy > 0 ? zone.height - 1 : 0 }))
          .find((p) => zone.isFree(p.x, p.y) && edge(p.x, p.y));
        if (!cell) return `bord ${dx},${dy} fermé dans ${zone.zone.name} (${zone.id})`;
        this.cheats.push(`traversée ${zone.zone.name}`);
        this.game.hero.x = cell.x;
        this.game.hero.y = cell.y;
      }
      if (this.game.zone !== zone) continue;
      this.game.input.move = { x: dx, y: dy };
      await this.tick();
      this.game.input.move = { x: 0, y: 0 };
      if (this.game.zone === zone) return `passage ${dx},${dy} refusé depuis ${zone.zone.name}`;
    }
    return "trop d'étapes";
  }

  private sectorRoute(from: number, to: number): Array<{ index: number; vehicle: boolean }> | null {
    const sectors = this.game.story.sectors;
    const assets = this.game.assets;
    const prev = new Map<number, { from: number; vehicle: boolean }>([[from, { from: -1, vehicle: false }]]);
    const queue = [from];
    while (queue.length) {
      const i = queue.shift()!;
      if (i === to) break;
      const s = sectors[i]!;
      const x = i % WORLD_SIZE;
      const y = Math.floor(i / WORLD_SIZE);
      const next: Array<[number, boolean]> = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= WORLD_SIZE || y + dy >= WORLD_SIZE) continue;
        const n = i + dx + dy * WORLD_SIZE;
        if (sectors[n] && (sectors[n]!.kind !== SectorKind.Blockade || sectors[n]!.solved || n === to) && (s.kind !== SectorKind.Blockade || s.solved)) {
          next.push([n, false]);
        } else if (sectors[n]?.kind === SectorKind.Blockade && n !== to) {
          // un barrage non résolu se traverse si on ne le franchit pas : on l'évite.
        }
      }
      const vehicle = assets.zone(s.zoneId).hotspots.find((h) => h.type === HotspotType.VehicleTo || h.type === HotspotType.VehicleBack);
      if (vehicle && (s.kind !== SectorKind.Travel || s.solved)) {
        const dest = sectors.findIndex((o) => o && [...assets.roomsOf(o.zoneId)].some((r) => r.id === vehicle.argument));
        if (dest >= 0) next.push([dest, true]);
      }
      for (const [n, v] of next) {
        if (prev.has(n)) continue;
        prev.set(n, { from: i, vehicle: v });
        queue.push(n);
      }
    }
    if (!prev.has(to)) return null;
    const out: Array<{ index: number; vehicle: boolean }> = [];
    for (let c = to; c !== from; c = prev.get(c)!.from) out.unshift({ index: c, vehicle: prev.get(c)!.vehicle });
    return out;
  }

  /** Trouve dans la zone du secteur (ou ses pièces) une case objets contenant `tile`. */
  private locateTile(sector: Sector, tile: number): { room: number; at: Point } | null {
    for (const room of this.game.assets.roomsOf(sector.zoneId)) {
      const z = this.game.zoneState(room.id);
      for (let y = 0; y < z.height; y++) for (let x = 0; x < z.width; x++) if (z.getTile(x, y, Layer.Object) === tile) return { room: room.id, at: { x, y } };
      const h = z.hotspots.find((hs) => hs.argument === tile && hs.enabled);
      if (h) return { room: room.id, at: { x: h.x, y: h.y } };
    }
    return null;
  }

  /** Aide : place le héros sur une case libre voisine de la cible (dégage un bloc si besoin). */
  cheatNear(tx: number, ty: number, label: string): boolean {
    const z = this.game.zone;
    const around = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => ({ x: tx + dx, y: ty + dy }));
    let spot = around.find((p) => z.isFree(p.x, p.y));
    if (!spot) {
      const block = around.slice(0, 4).find((p) => this.pushable(p.x, p.y));
      if (!block) return false;
      for (let i = 0; i < z.width * z.height; i++) {
        const x = i % z.width;
        const y = Math.floor(i / z.width);
        if (z.isFree(x, y) && !z.hotspotAt(x, y)) {
          z.setTile(x, y, Layer.Object, z.getTile(block.x, block.y, Layer.Object));
          z.setTile(block.x, block.y, Layer.Object, -1);
          spot = block;
          break;
        }
      }
      if (!spot) return false;
    }
    this.cheats.push(label);
    this.game.hero.x = spot.x;
    this.game.hero.y = spot.y;
    return true;
  }

  /** Va combattre chaque ennemi actif de la zone courante. */
  async clearMonsters(): Promise<void> {
    const z = this.game.zone;
    for (let guard = 0; guard < 20; guard++) {
      const m = z.monsters.find((mo) => mo.enabled && mo.damageTaken < mo.character.health);
      if (!m || this.game.zone !== z) return;
      const near = (x: number, y: number) => Math.abs(x - m.x) + Math.abs(y - m.y) === 1;
      if (!(await this.walk(near, 150))) return;
      await this.fightAdjacent();
    }
  }

  private npcsOf(sector: Sector): Array<{ room: number; at: Point }> {
    const out: Array<{ room: number; at: Point }> = [];
    for (const room of this.game.assets.roomsOf(sector.zoneId)) {
      const z = this.game.zoneState(room.id);
      for (let y = 0; y < z.height; y++)
        for (let x = 0; x < z.width; x++) {
          const t = z.getTile(x, y, Layer.Object);
          if (t >= 0 && this.game.assets.hasFlag(t, 1 << 8) && !z.monsterAt(x, y)) out.push({ room: room.id, at: { x, y } });
        }
    }
    return out;
  }

  private locateHotspot(sector: Sector, type: HotspotType): { room: number; at: Point } | null {
    for (const room of this.game.assets.roomsOf(sector.zoneId)) {
      const h = this.game.zoneState(room.id).hotspots.find((hs) => hs.type === type && hs.enabled);
      if (h) return { room: room.id, at: { x: h.x, y: h.y } };
    }
    return null;
  }

  /** Va à côté de `at` dans `room` et agit : cogner ou utiliser un objet. */
  async interact(target: { room: number; at: Point }, item?: number): Promise<string | null> {
    if (this.game.zone.id !== target.room && !(await this.enterRoom(target.room))) return `pièce ${target.room} inaccessible`;
    const { x: tx, y: ty } = target.at;
    const near = (x: number, y: number) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 1;
    if (!(await this.walk(near))) {
      if (process.env.PLAY_DEBUG) console.log(this.dump());
      // Énigme interne (blocs à tirer, labyrinthe…) : on se place à côté de la cible et on le note.
      const z = this.game.zone;
      if (!this.cheatNear(tx, ty, z.zone.name)) return `cible (${tx},${ty}) enfermée dans ${z.zone.name} (${z.id})`;
    }
    // Un ennemi posté sur la cible : on le combat d'abord.
    for (let t = 0; t < 30 && this.game.zone.monsterAt(tx, ty); t++) {
      const game = this.game;
      game.hero.facing = ty < game.hero.y ? 0 : ty > game.hero.y ? 1 : tx < game.hero.x ? 2 : 3;
      game.requestAttack();
      for (let k = 0; k < 4; k++) await this.tick();
    }
    if (item !== undefined) this.game.requestPlacement(item, tx, ty);
    else this.game.input.move = { x: tx - this.game.hero.x, y: ty - this.game.hero.y };
    await this.tick();
    this.game.input.move = { x: 0, y: 0 };
    for (let t = 0; t < 5; t++) await this.tick();
    return null;
  }

  async solveSector(index: number): Promise<string | null> {
    const game = this.game;
    const sector = game.story.sectors[index]!;
    const err = await this.travelTo(index);
    if (err) return err;
    const want = sector.findItem;
    if (sector.requiredItem >= 0 && sector.kind !== SectorKind.Find) {
      const target =
        sector.kind === SectorKind.Puzzle && sector.npc >= 0 ? this.locateTile(sector, sector.npc) : this.locateHotspot(sector, HotspotType.Lock);
      if (!target) return `pas de cible pour ${sector.kind} ${game.assets.zone(sector.zoneId).name}`;
      if (!game.hasItem(sector.requiredItem)) return `objet requis absent : ${game.assets.tileName(sector.requiredItem)}`;
      const e = await this.interact(target, sector.requiredItem);
      if (e) return e;
      if (game.hasItem(sector.requiredItem) && !sector.solved) return `objet refusé dans ${game.assets.zone(sector.zoneId).name}`;
    }
    if (want >= 0 && !game.hasItem(want)) {
      const target = this.locateTile(sector, want);
      if (!target) return `objet ${game.assets.tileName(want)} introuvable dans ${game.assets.zone(sector.zoneId).name}`;
      const e = await this.interact(target);
      if (e) return e;
      // Nouvelles tentatives : éliminer les ennemis, recogner la cible, aborder les PNJ.
      for (let attempt = 0; attempt < 3 && !game.hasItem(want); attempt++) {
        await this.clearMonsters();
        const again = this.locateTile(sector, want) ?? target;
        await this.interact(again);
        for (const npc of this.npcsOf(sector)) {
          if (game.hasItem(want)) break;
          await this.interact(npc);
        }
      }
      if (!game.hasItem(want)) {
        if (process.env.PLAY_DEBUG) console.log("non ramassé", target, this.locateTile(sector, want), game.zone.hotspots, this.dump());
        return `objet ${game.assets.tileName(want)} non ramassé dans ${game.assets.zone(target.room).name}`;
      }
    }
    return null;
  }
}

// Diagnostic long, activé avec PLAY=1 (PLAY_SEEDS=n, PLAY_DEBUG=1 pour les plans des zones).
describe.skipIf(!hasOriginalFiles || !process.env.PLAY)("parties jouées par un robot", () => {
  it("suit la solution aussi loin que possible", { timeout: 600_000 }, async () => {
    const assets = new Assets(loadGameData());
    const report: string[] = [];
    let completed = 0;
    let progress = 0;
    const seeds = Number(process.env.PLAY_SEEDS ?? 10);
    for (let seed = 1; seed <= seeds; seed++) {
      const story = generateStory(assets, seed * 7, WorldSize.Small);
      const game = new Game(assets, story, presenter, { difficulty: 1 });
      const bot = new Bot(game);
      let done = false;
      const start = game.start(IndyIds.townZone, { x: 11, y: 5 }).finally(() => (done = true));
      while (!done) {
        await new Promise((r) => setImmediate(r));
        if (!done) void game.step();
      }
      await start;
      const steps = solve(assets, story).steps;
      let failure: string | null = null;
      let index = 0;
      for (; index < steps.length; index++) {
        const s = story.sectors[steps[index]]!;
        if (s.kind === SectorKind.Goal) break;
        failure = await bot.solveSector(steps[index]);
        if (failure) break;
      }
      if (!failure) {
        const goal = story.sectors[steps[steps.length - 1]]!;
        failure = (await bot.travelTo(steps[steps.length - 1])) ?? `objectif atteint (${assets.zone(goal.zoneId).name})`;
        completed++;
      }
      progress += index;
      report.push(
        `graine ${seed * 7} : ${index}/${steps.length - 1} étapes — ${failure} [${bot.ticks} ticks, aides : ${bot.cheats.join(", ") || "aucune"}]`,
      );
    }
    console.log(report.join("\n"));
    // Diagnostic : le robot ne résout pas les énigmes internes des zones, on vérifie surtout
    // qu'il progresse dans la chaîne sans erreur du moteur.
    void completed;
    expect(progress).toBeGreaterThan(0);
  });
});
