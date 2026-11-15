import { HotspotType, Layer } from "../../src/engine/desktop-adventures/data/types";
import type { Game, Presenter } from "../../src/engine/desktop-adventures/game";
import type { Point } from "../../src/engine/desktop-adventures/geometry";
import { type Grid, type Sector, SectorKind, WORLD_SIZE } from "../../src/engine/desktop-adventures/world";
import type { Monster } from "../../src/engine/desktop-adventures/zone-state";

/**
 * Robot joueur commun aux jeux « Desktop Adventures » (Indy, Yoda) : il joue pour de vrai (entrées clavier simulées,
 * un tick à la fois). Il sait marcher dans une zone (chemin en 8 directions, en coupant les coins comme le moteur),
 * passer de secteur en secteur (en contournant un bord inaccessible) et en véhicule, entrer dans les pièces et en
 * sortir, combattre (y compris un monstre qui barre le chemin), ramasser un objet qui barre le chemin, cogner une case
 * ou y utiliser un objet, et résoudre les énigmes de blocs (poussées et tractions avec Maj, planifiées par une
 * recherche en largeur : `solveBlocks`). Quand une cible reste hors d'atteinte, il se place à côté si les aides sont
 * permises (`aids`) et le note dans `cheats`, sinon il échoue en le disant. Le plan (ordre des secteurs) et la façon
 * de résoudre un secteur sont propres à chaque jeu (voir test/indy et test/yoda).
 */

/** Interface muette : dialogues, transitions et sons instantanés ; pas de téléporteur. */
export const silentPresenter: Presenter = {
  speak: async () => {},
  message: async () => {},
  pickup: async () => {},
  transition: async (_, apply) => apply(),
  playSound: () => {},
  ended: async () => {},
  chooseTeleport: async () => null,
};

/** Fournit des ticks tant que l'opération (démarrage, scripts animés…) n'est pas terminée. */
export async function drive(game: Game, operation: Promise<void>): Promise<void> {
  let done = false;
  const finished = operation.finally(() => (done = true));
  for (let guard = 0; guard < 3000 && !done; guard++) {
    await new Promise((r) => setImmediate(r));
    if (!done) void game.step();
  }
  await finished;
}

/** Une case à atteindre dans une zone (ou l'une de ses pièces). */
export interface Target {
  room: number;
  at: Point;
  /** Case imposée au héros (condition « héros en (x, y) » d'un script), sinon n'importe quelle case voisine. */
  stand?: Point;
}

/** Geste sur un bloc : se tenir sur `stand`, puis avancer de `dir` avec Maj (pousse le bloc devant, ou tire celui de derrière). */
export interface BlockMove {
  stand: Point;
  dir: Point;
}

/** But d'une manœuvre de blocs : reçoit les cases accessibles au héros et la tuile de bloc posée sur chaque case (-1 sinon). */
export type BlockGoal = (reach: (x: number, y: number) => boolean, blockAt: (x: number, y: number) => number) => boolean;

const DIRECTIONS_8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export class DesktopBot {
  ticks = 0;
  readonly cheats: string[] = [];
  /** Aides permises (se placer d'office à côté d'une cible hors d'atteinte) ; sans elles, le robot échoue et le dit. */
  aids = true;
  /** Ticks d'attente quand aucun chemin n'existe (un script peut libérer le passage), avant d'abandonner. */
  protected patience = 0;
  constructor(readonly game: Game) {}

  /** Avance d'un tick ; si un script anime la scène, fournit les ticks dont il a besoin. */
  async tick(): Promise<void> {
    await drive(this.game, this.game.step());
    this.ticks++;
  }

  protected free(x: number, y: number): boolean {
    const z = this.game.zone;
    if (!z.inBounds(x, y)) return false;
    const t = z.getTile(x, y, Layer.Object);
    return t === -1;
  }

  /** Plan de la zone courante (@ héros, M monstre, d bloc déplaçable, # obstacle), pour le débogage. */
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
    return `${z.zone.name} (${z.id})\n${rows.join("\n")}`;
  }

  /** Objet à ramasser posé sur la case (butin, objet lâché) : le cogner le ramasse et libère le passage. */
  protected pickup(x: number, y: number): boolean {
    const z = this.game.zone;
    const drops = [HotspotType.DropItem, HotspotType.DropMap, HotspotType.DropQuestItem, HotspotType.DropUniqueWeapon, HotspotType.DropWeapon, HotspotType.Bonus];
    return z.inBounds(x, y) && z.hotspots.some((h) => h.enabled && h.x === x && h.y === y && drops.includes(h.type) && h.argument >= 0 && h.argument === z.getTile(x, y, Layer.Object));
  }

  protected pushable(x: number, y: number): boolean {
    const z = this.game.zone;
    return z.inBounds(x, y) && this.game.assets.isDraggable(z.getTile(x, y, Layer.Object));
  }

  /** Frappe les monstres au contact (arme équipée), en se tournant vers eux. */
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
  /** Case à ne pas traverser (sauf si c'est la destination) ; par défaut, aucune. */
  protected avoid(_x: number, _y: number): boolean {
    return false;
  }

  /** Une case de `targets` est-elle accessible à pied depuis le héros ? */
  reachable(targets: (x: number, y: number) => boolean): boolean {
    return this.path(targets) !== null;
  }

  protected path(targets: (x: number, y: number) => boolean, throughMonsters = false): Point[] | null {
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
        // Au besoin, on passe aussi par les monstres (à combattre) et les objets posés (à ramasser).
        const passable = this.free(n.x, n.y) || (throughMonsters && (!!z.monsterAt(n.x, n.y) || this.pickup(n.x, n.y)));
        // Les portes et véhicules font changer de zone : on ne les foule que s'ils sont la destination.
        if (!passable || ((this.avoid(n.x, n.y) || this.isTransitHotspot(n.x, n.y)) && !targets(n.x, n.y))) continue;
        prev.set(key(n), p);
        queue.push(n);
      }
    }
    return null;
  }

  /**
   * Marche case par case ; renvoie faux si bloqué. Les blocs ne bougent pas en chemin (une poussée irréfléchie peut les
   * coincer) : seul `solveBlocks` les manœuvre, avec un plan.
   */
  async walk(targets: (x: number, y: number) => boolean, maxTicks = 400): Promise<boolean> {
    const zone = this.game.zone;
    let waited = 0;
    for (let t = 0; t < maxTicks; t++) {
      if (this.game.over) return false;
      if (this.game.zone !== zone) return true;
      if (targets(this.game.hero.x, this.game.hero.y)) return true;
      let route = this.path(targets);
      if (!route || !route.length) {
        if (await this.fightAdjacent()) continue;
        // Chemin barré par des monstres : on avance jusqu'au premier pour le combattre (ou on attend qu'il bouge).
        const via = this.path(targets, true);
        const blocker = via?.length ? this.game.zone.monsterAt(via[0].x, via[0].y) : undefined;
        if (via?.length && !blocker) route = via;
        else if (blocker && waited++ < 20) {
          // Monstre en diagonale : on se place à côté de lui (en ligne droite) pour pouvoir le frapper.
          const beside = this.path((x, y) => Math.abs(x - blocker.x) + Math.abs(y - blocker.y) === 1);
          if (beside?.length) route = beside;
          else {
            await this.tick();
            continue;
          }
        } else if (waited++ < this.patience) {
          await this.tick();
          continue;
        } else return false;
      }
      const next = route[0];
      this.game.input.move = { x: next.x - this.game.hero.x, y: next.y - this.game.hero.y };
      await this.tick();
      this.game.input.move = { x: 0, y: 0 };
    }
    return false;
  }

  /** Points chauds à ne pas fouler en manœuvrant des blocs (ils font changer de zone). */
  protected isTransitHotspot(x: number, y: number): boolean {
    const transit = [HotspotType.DoorIn, HotspotType.DoorOut, HotspotType.Teleporter, HotspotType.VehicleTo, HotspotType.VehicleBack, HotspotType.ShipToPlanet, HotspotType.ShipFromPlanet];
    return this.game.zone.hotspots.some((h) => h.enabled && h.x === x && h.y === y && transit.includes(h.type));
  }

  /**
   * Énigme de blocs (« sokoban ») : cherche une suite de poussées et de tractions (Maj) des blocs déplaçables de la zone
   * qui rende `goal` vrai. `goal` reçoit les cases accessibles à pied et le bloc posé sur chaque case (tuile, -1 sinon).
   * Recherche en largeur sur (position des blocs, région du héros) ; renvoie les gestes (case où se tenir, direction).
   * `movable` restreint les blocs qu'on s'autorise à bouger (les autres font office de murs).
   */
  protected planBlocks(goal: BlockGoal, limit = 40000, movable?: (x: number, y: number) => boolean): BlockMove[] | null {
    const z = this.game.zone;
    const W = z.width;
    const N = W * z.height;
    const wall = new Uint8Array(N);
    const start = new Int16Array(N).fill(-1);
    // Blocs qu'on ne bouge pas : des murs pour la recherche, mais toujours des blocs pour le but.
    const fixed = new Int16Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      // Les monstres bougent : on planifie comme si leur case était libre (l'exécution les combat ou replanifie).
      const t = z.monsterAt(x, y) ? -1 : z.getTile(x, y, Layer.Object);
      const draggable = t !== -1 && this.game.assets.isDraggable(t);
      if (draggable && (!movable || movable(x, y))) start[i] = t;
      else if (t !== -1) wall[i] = 1;
      if (draggable && wall[i]) fixed[i] = t;
      else if (this.isTransitHotspot(x, y)) wall[i] = 2; // un bloc peut y aller, pas le héros
    }
    if (!start.some((t) => t >= 0)) return null;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < z.height;
    const walkable = (blocks: Int16Array, x: number, y: number) => inside(x, y) && !wall[x + y * W] && blocks[x + y * W] < 0;
    const region = (blocks: Int16Array, from: number) => {
      const seen = new Uint8Array(N);
      seen[from] = 1;
      const queue = [from];
      for (let q = 0; q < queue.length; q++) {
        const px = queue[q] % W;
        const py = Math.floor(queue[q] / W);
        for (const [dx, dy] of DIRECTIONS_8) {
          const nx = px + dx;
          const ny = py + dy;
          if (!walkable(blocks, nx, ny) || seen[nx + ny * W]) continue;
          seen[nx + ny * W] = 1;
          queue.push(nx + ny * W);
        }
      }
      return { seen, cells: queue };
    };
    interface Node {
      blocks: Int16Array;
      hero: number;
      parent: Node | null;
      move: BlockMove | null;
    }
    const hero = this.game.hero.x + this.game.hero.y * W;
    const visited = new Set<string>();
    const queue: Node[] = [{ blocks: start, hero, parent: null, move: null }];
    for (let q = 0; q < queue.length && q < limit; q++) {
      const node = queue[q];
      const { seen, cells } = region(node.blocks, node.hero);
      const key = `${Math.min(...cells)}|${node.blocks.join(",")}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (goal((x, y) => inside(x, y) && seen[x + y * W] === 1, (x, y) => (!inside(x, y) ? -1 : node.blocks[x + y * W] >= 0 ? node.blocks[x + y * W] : fixed[x + y * W]))) {
        const moves: BlockMove[] = [];
        for (let n: Node | null = node; n?.move; n = n.parent) moves.unshift(n.move);
        return moves;
      }
      for (const h of cells) {
        const hx = h % W;
        const hy = Math.floor(h / W);
        for (const [dx, dy] of DIRECTIONS_8.slice(0, 4)) {
          const ahead = { x: hx + dx, y: hy + dy };
          const blocks = node.blocks.slice();
          let to: number;
          if (inside(ahead.x, ahead.y) && node.blocks[ahead.x + ahead.y * W] >= 0) {
            // Poussée : la case derrière le bloc doit être libre (un bloc peut couvrir un point chaud).
            const bx = ahead.x + dx;
            const by = ahead.y + dy;
            if (!inside(bx, by) || wall[bx + by * W] === 1 || node.blocks[bx + by * W] >= 0) continue;
            blocks[bx + by * W] = blocks[ahead.x + ahead.y * W];
            blocks[ahead.x + ahead.y * W] = -1;
            to = ahead.x + ahead.y * W;
          } else {
            // Traction : le bloc est derrière le héros, qui avance sur une case libre.
            const back = { x: hx - dx, y: hy - dy };
            if (!walkable(node.blocks, ahead.x, ahead.y) || !inside(back.x, back.y) || node.blocks[back.x + back.y * W] < 0) continue;
            blocks[h] = blocks[back.x + back.y * W];
            blocks[back.x + back.y * W] = -1;
            to = ahead.x + ahead.y * W;
          }
          queue.push({ blocks, hero: to, parent: node, move: { stand: { x: hx, y: hy }, dir: { x: dx, y: dy } } });
        }
      }
    }
    return null;
  }

  /**
   * Cherche d'abord en ne bougeant qu'un seul bloc (les autres fixes : espace d'états minuscule), puis tous les blocs.
   * Le plan le plus court l'emporte.
   */
  protected planBlocksBySize(goal: BlockGoal): BlockMove[] | null {
    const z = this.game.zone;
    let best: BlockMove[] | null = null;
    for (let y = 0; y < z.height; y++)
      for (let x = 0; x < z.width; x++) {
        if (!this.pushable(x, y)) continue;
        const moves = this.planBlocks(goal, 5000, (bx, by) => bx === x && by === y);
        if (moves && (!best || moves.length < best.length)) best = moves;
      }
    return best ?? this.planBlocks(goal);
  }

  /** Exécute les gestes d'un plan de blocs ; renvoie faux si l'un échoue (monstre en travers, script…). */
  protected async moveBlocks(moves: BlockMove[]): Promise<boolean> {
    const zone = this.game.zone;
    for (const { stand, dir } of moves) {
      if (!(await this.walk((x, y) => x === stand.x && y === stand.y, 200)) || this.game.zone !== zone) return false;
      this.game.input.drag = true;
      await this.step(dir.x, dir.y);
      this.game.input.drag = false;
      if (this.game.hero.x !== stand.x + dir.x || this.game.hero.y !== stand.y + dir.y) return false;
    }
    return true;
  }

  /** Recherches de blocs sans solution (clé du but, zone, plan des objets, héros) : inutile de les refaire. */
  private readonly hopeless = new Set<string>();

  /** Déplace les blocs de la zone pour rendre `goal` (décrit par `key`) vrai (voir `planBlocks`). */
  async solveBlocks(key: string, goal: BlockGoal): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const z = this.game.zone;
      const layout = Array.from({ length: z.width * z.height }, (_, i) => z.getTile(i % z.width, Math.floor(i / z.width), Layer.Object)).join(",");
      const memo = `${key}|${z.id}|${this.game.hero.x},${this.game.hero.y}|${layout}`;
      if (this.hopeless.has(memo)) return false;
      const moves = this.planBlocksBySize(goal);
      if (!moves) {
        this.hopeless.add(memo);
        return false;
      }
      if (await this.moveBlocks(moves)) return true;
    }
    return false;
  }

  /** Un pas dans une direction (un tick). */
  async step(dx: number, dy: number): Promise<void> {
    this.game.input.move = { x: dx, y: dy };
    await this.tick();
    this.game.input.move = { x: 0, y: 0 };
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
      // Pièce voisine (pas derrière une porte d'ici) : on ressort d'abord.
      if (!doors.length && !this.game.world.isOverworld(here.id)) {
        if (!(await this.leaveRooms())) return false;
        continue;
      }
      for (const door of doors) {
        // Le moteur permet d'entrer en diagonale : toute case voisine (hors autre porte) convient.
        const adjacent = (x: number, y: number) => Math.max(Math.abs(x - door.x), Math.abs(y - door.y)) === 1 && !this.isTransitHotspot(x, y);
        // Porte couverte d'un bloc, ou hors d'atteinte derrière des blocs : on les déplace.
        if (this.pushable(door.x, door.y) || !this.reachable(adjacent)) {
          await this.solveBlocks(`porte ${door.x},${door.y}`, (reach, blockAt) => blockAt(door.x, door.y) < 0 && this.anyReached(reach, adjacent));
        }
        if (!(await this.walk(adjacent)) && !((await this.unblock(adjacent)) && (await this.walk(adjacent)))) {
          if (this.game.zone !== here) break;
          const cell = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((p) => here.isFree(p.x, p.y));
          if (!cell || !this.teleport(cell, `porte ${here.zone.name || `zone ${here.id}`}`)) continue;
        }
        await this.step(door.x - this.game.hero.x, door.y - this.game.hero.y);
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
      const near = (x: number, y: number) => Math.max(Math.abs(x - exit.x), Math.abs(y - exit.y)) === 1 && !this.isTransitHotspot(x, y);
      const ok = (await this.walk(near)) || ((await this.unblock(near)) && (await this.walk(near)));
      if (this.game.zone !== here) continue;
      if (!ok) {
        const cell = [[0, -1], [1, 0], [-1, 0], [0, 1]].map(([dx, dy]) => ({ x: exit.x + dx, y: exit.y + dy })).find((p) => here.isFree(p.x, p.y));
        if (!cell || !this.teleport(cell, `sortie ${here.zone.name || `zone ${here.id}`}`)) {
          if (process.env.PLAY_DEBUG) console.log("sortie", exit, this.dump());
          return false;
        }
      }
      await this.step(exit.x - this.game.hero.x, exit.y - this.game.hero.y);
      if (this.game.zone === here) {
        if (process.env.PLAY_DEBUG) console.log("sortie refusée", exit, here.doorInLocation, this.dump());
        return false;
      }
    }
    return true;
  }

  /** Carte du monde où se trouve le héros (0 : principale, 1 : Dagobah). */
  get grid(): Grid {
    return this.game.world.gridOf(this.game.zone.id) ?? 0;
  }

  /** Cases de la carte `grid`. */
  sectorsOf(grid: Grid): (Sector | null)[] {
    return (grid === 1 ? this.game.story.dagobah : this.game.story.sectors) ?? [];
  }

  /** Index de case du secteur où se trouve le héros, sur sa carte. */
  get here(): number {
    const p = this.game.world.locate(this.game.zone.id);
    return p ? p.x + p.y * WORLD_SIZE : -1;
  }

  /** Rejoint la case `target` de la carte du héros, secteur par secteur. */
  async travelTo(target: number): Promise<string | null> {
    if (!(await this.leaveRooms())) return "impossible de sortir des pièces";
    const world = this.game.world;
    const grid = this.grid;
    // Passages d'un secteur à l'autre trouvés fermés (bord inaccessible depuis l'endroit où l'on est) : on les contourne.
    const closed = new Set<string>();
    for (let guard = 0; guard < 40; guard++) {
      if (this.game.over) return "héros mort";
      // Zone hors carte (trajet animé d'un véhicule…) : on laisse les scripts l'achever.
      for (let t = 0; t < 60 && !world.locate(this.game.zone.id); t++) await this.tick();
      if (!world.locate(this.game.zone.id)) return `zone ${this.game.zone.id} hors de la carte`;
      // Un véhicule ou un script a pu déposer le héros dans une pièce.
      if (!world.isOverworld(this.game.zone.id) && !(await this.leaveRooms())) return "impossible de sortir des pièces";
      const here = world.locate(this.game.zone.id)!;
      const hereIndex = here.x + here.y * WORLD_SIZE;
      if (hereIndex === target) return null;
      // Voyage en véhicule vers une île.
      const route = this.sectorRoute(hereIndex, target, grid, closed);
      if (!route) return `pas de chemin sur la carte vers ${target}${closed.size ? ` (bords fermés : ${[...closed].join(" ")})` : ""}`;
      const next = route[0];
      if (next.vehicle) {
        if (!(await this.rideVehicle())) return `véhicule inaccessible dans ${this.game.zone.zone.name || `zone ${this.game.zone.id}`}`;
        for (let t = 0; t < 60 && this.here === hereIndex; t++) await this.tick();
        continue;
      }
      const dx = (next.index % WORLD_SIZE) - here.x;
      const dy = Math.floor(next.index / WORLD_SIZE) - here.y;
      const zone = this.game.zone;
      const destination = this.game.zoneState(world.at(here.x + dx, here.y + dy, grid)!.zoneId);
      const edge = (x: number, y: number) => {
        if (dx === 1 && x !== zone.width - 1) return false;
        if (dx === -1 && x !== 0) return false;
        if (dy === 1 && y !== zone.height - 1) return false;
        if (dy === -1 && y !== 0) return false;
        const nx = dx === 0 ? x : dx > 0 ? 0 : destination.width - 1;
        const ny = dy === 0 ? y : dy > 0 ? 0 : destination.height - 1;
        return destination.isFree(nx, ny);
      };
      if (!(await this.walk(edge)) && !((await this.unblock(edge)) && (await this.walk(edge))) && this.game.zone === zone) {
        // Bord hors d'atteinte : un autre itinéraire de secteurs peut l'éviter.
        const link = `${hereIndex}>${next.index}`;
        closed.add(link);
        if (this.sectorRoute(hereIndex, target, grid, closed)) continue;
        closed.delete(link);
        // Zone non traversable à pied pour le robot : on passe directement au bord.
        const cell = [...Array(zone.width).keys()]
          .map((k) => (dx ? { x: dx > 0 ? zone.width - 1 : 0, y: k } : { x: k, y: dy > 0 ? zone.height - 1 : 0 }))
          .find((p) => zone.isFree(p.x, p.y) && edge(p.x, p.y));
        if (!cell) return `bord ${dx},${dy} fermé dans ${zone.zone.name || "zone"} (${zone.id})`;
        if (!this.teleport(cell, `traversée ${zone.zone.name || `zone ${zone.id}`}`)) {
          if (process.env.PLAY_DEBUG) console.log("traversée", dx, dy, this.dump());
          return `traversée ${dx},${dy} impossible dans ${zone.zone.name || "zone"} (${zone.id})`;
        }
      }
      if (this.game.zone !== zone) continue;
      await this.step(dx, dy);
      if (this.game.zone === zone) return `passage ${dx},${dy} refusé depuis ${zone.zone.name}`;
    }
    return "trop d'étapes";
  }

  /** Monte dans le véhicule de la zone (point chaud « véhicule ») ; renvoie faux s'il est hors d'atteinte. */
  protected async rideVehicle(): Promise<boolean> {
    const vehicle = this.game.zone.hotspots.find((h) => h.type === HotspotType.VehicleTo || h.type === HotspotType.VehicleBack)!;
    return this.walk((x, y) => x === vehicle.x && y === vehicle.y);
  }

  /** Le véhicule du secteur est-il utilisable ? Par défaut : hors secteur de voyage, ou voyage résolu. */
  protected vehicleUsable(sector: Sector): boolean {
    return sector.kind !== SectorKind.Travel || sector.solved;
  }

  protected sectorRoute(from: number, to: number, grid: Grid, closed = new Set<string>()): Array<{ index: number; vehicle: boolean }> | null {
    const sectors = this.sectorsOf(grid);
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
        // Un barrage non résolu ne se franchit pas : on l'évite (sauf s'il est la destination).
        if (closed.has(`${i}>${n}`)) continue;
        if (sectors[n] && (sectors[n]!.kind !== SectorKind.Blockade || sectors[n]!.solved || n === to) && (s.kind !== SectorKind.Blockade || s.solved)) {
          next.push([n, false]);
        }
      }
      const vehicle = assets.zone(s.zoneId).hotspots.find((h) => h.type === HotspotType.VehicleTo || h.type === HotspotType.VehicleBack);
      if (vehicle && this.vehicleUsable(s)) {
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
  locateTile(sector: Sector, tile: number): Target | null {
    for (const room of this.game.assets.roomsOf(sector.zoneId)) {
      const z = this.game.zoneState(room.id);
      for (let y = 0; y < z.height; y++) for (let x = 0; x < z.width; x++) if (z.getTile(x, y, Layer.Object) === tile) return { room: room.id, at: { x, y } };
      const h = z.hotspots.find((hs) => hs.argument === tile && hs.enabled);
      if (h) return { room: room.id, at: { x: h.x, y: h.y } };
    }
    return null;
  }

  /** Une des cases `targets` est-elle dans la région accessible `reach` ? */
  protected anyReached(reach: (x: number, y: number) => boolean, targets: (x: number, y: number) => boolean): boolean {
    const z = this.game.zone;
    for (let y = 0; y < z.height; y++) for (let x = 0; x < z.width; x++) if (reach(x, y) && targets(x, y)) return true;
    return false;
  }

  /** Tente de rendre `targets` accessible (énigmes de zone) avant de recourir à une aide : déplacer des blocs. */
  protected async unblock(targets: (x: number, y: number) => boolean): Promise<boolean> {
    const z = this.game.zone;
    const cells = Array.from({ length: z.width * z.height }, (_, i) => i).filter((i) => targets(i % z.width, Math.floor(i / z.width)));
    return this.solveBlocks(`accès ${cells.join(",")}`, (reach) => this.anyReached(reach, targets));
  }

  /** Aide (si permise) : place le héros sur `at` et le note. */
  protected teleport(at: Point, label: string): boolean {
    if (!this.aids) return false;
    this.cheats.push(label);
    this.game.hero.x = at.x;
    this.game.hero.y = at.y;
    return true;
  }

  /** Aide : place le héros sur la case `at` si elle est libre. */
  cheatAt(at: Point, label: string): boolean {
    if (!this.game.zone.isFree(at.x, at.y)) return false;
    return this.teleport(at, label);
  }

  /** Aide : place le héros sur une case libre voisine de la cible (dégage un bloc si besoin). */
  cheatNear(tx: number, ty: number, label: string): boolean {
    if (!this.aids) return false;
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
    return this.teleport(spot, label);
  }

  /** Poursuit et combat le monstre `m` jusqu'à sa mort ; renvoie vrai s'il est mort. */
  async killMonster(m: Monster): Promise<boolean> {
    const z = this.game.zone;
    const alive = () => m.enabled && m.damageTaken < m.character.health;
    for (let guard = 0; guard < 30 && alive() && this.game.zone === z && !this.game.over; guard++) {
      if (Math.abs(m.x - this.game.hero.x) + Math.abs(m.y - this.game.hero.y) !== 1) {
        await this.walk((x, y) => Math.abs(x - m.x) + Math.abs(y - m.y) === 1, 20);
        continue;
      }
      await this.fightAdjacent();
    }
    return !alive();
  }

  /** Va combattre chaque ennemi actif de la zone courante. */
  async clearMonsters(): Promise<void> {
    const z = this.game.zone;
    for (let guard = 0; guard < 20; guard++) {
      const m = z.monsters.find((mo) => mo.enabled && mo.damageTaken < mo.character.health);
      if (!m || this.game.zone !== z || this.game.over) return;
      const near = (x: number, y: number) => Math.abs(x - m.x) + Math.abs(y - m.y) === 1;
      if (!(await this.walk(near, 150))) return;
      await this.fightAdjacent();
    }
  }

  /** PNJ (tuiles « personnage PNJ ») de la zone du secteur et de ses pièces. */
  npcsOf(sector: Sector): Target[] {
    const out: Target[] = [];
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

  locateHotspot(sector: Sector, type: HotspotType): Target | null {
    for (const room of this.game.assets.roomsOf(sector.zoneId)) {
      const h = this.game.zoneState(room.id).hotspots.find((hs) => hs.type === type && hs.enabled);
      if (h) return { room: room.id, at: { x: h.x, y: h.y } };
    }
    return null;
  }

  /** Va à côté de `at` dans `room` et agit : cogner ou utiliser un objet. */
  async interact(target: Target, item?: number): Promise<string | null> {
    if (this.game.zone.id !== target.room && !(await this.enterRoom(target.room))) return `pièce ${target.room} inaccessible`;
    const { x: tx, y: ty } = target.at;
    const stand = target.stand;
    const near = stand
      ? (x: number, y: number) => x === stand.x && y === stand.y
      : (x: number, y: number) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 1 && !this.isTransitHotspot(x, y);
    // Objet caché sous un bloc : il n'apparaît (point chaud) qu'une fois la case dégagée.
    const zone = this.game.zone;
    if (this.pushable(tx, ty) && zone.hotspots.some((h) => h.enabled && h.x === tx && h.y === ty && h.argument >= 0 && h.argument !== zone.getTile(tx, ty, Layer.Object))) {
      if (await this.solveBlocks(`dégager ${tx},${ty}`, (reach, blockAt) => blockAt(tx, ty) < 0 && this.anyReached(reach, near))) await this.tick();
    }
    if (!(await this.walk(near)) && !((await this.unblock(near)) && (await this.walk(near)))) {
      if (this.game.over) return "héros mort";
      if (process.env.PLAY_DEBUG) console.log("aide vers", tx, ty, stand, this.dump());
      // Énigme interne (blocs à tirer, labyrinthe…) : on se place à côté de la cible et on le note.
      const z = this.game.zone;
      const label = z.zone.name || `zone ${z.id}`;
      if (!(stand ? this.cheatAt(stand, label) : this.cheatNear(tx, ty, label))) return `cible (${tx},${ty}) enfermée dans ${z.zone.name} (${z.id})`;
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
}
