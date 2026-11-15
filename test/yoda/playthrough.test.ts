import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { type Character, FrameEntry, HotspotType, TileFlag, ZoneType } from "../../src/engine/desktop-adventures/data/types";
import { readPeStrings } from "../../src/engine/desktop-adventures/data/pe-resources";
import { Game, type Presenter } from "../../src/engine/desktop-adventures/game";
import { opcodeOf } from "../../src/engine/desktop-adventures/script";
import { type Sector, SectorKind, WORLD_SIZE, WorldSize } from "../../src/engine/desktop-adventures/world";
import type { Monster } from "../../src/engine/desktop-adventures/zone-state";
import { type YodaStory, generateYodaStory } from "../../src/games/yoda/generation/world-generator";
import { DAGOBAH_CELLS, TileIds } from "../../src/games/yoda/ids";
import { YODA_OPCODES } from "../../src/games/yoda/opcodes";
import { createYodaVariant } from "../../src/games/yoda/variant";
import { DesktopBot, type Target, drive, silentPresenter } from "../support/desktop-bot";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

/**
 * Robot joueur de Yoda Stories (moteur commun : test/support/desktop-bot.ts). Il joue une partie complète pour de vrai :
 * Dagobah → parler à Yoda (mission et premier objet) → X-Wing vers la planète (script réel du secteur sud-ouest) →
 * secteurs de la planète dans l'ordre déduit de la `YodaStory` (`planYoda`) → objectif → victoire (`WinGame`).
 * Les blocages sont classés : « robot » (énigme interne de zone, labyrinthe… que le robot ne sait pas faire) ou
 * « moteur » (objet jamais donné, script qui ne se déclenche pas, secteur jamais résolu, exception…).
 */

const PLACED_ITEM_IS = opcodeOf(YODA_OPCODES.conditions, "PlacedItemIs");

/** Lieu du crash (vol interplanétaire par la zone 471) : une quête y précède le point chaud du vaisseau. */
const CRASH_SITE = 642;

const BLOCKED_DIRECTION: Partial<Record<ZoneType, [number, number]>> = {
  [ZoneType.BlockadeNorth]: [0, -1],
  [ZoneType.BlockadeSouth]: [0, 1],
  [ZoneType.BlockadeEast]: [1, 0],
  [ZoneType.BlockadeWest]: [-1, 0],
};

/** Objets à apporter pour résoudre le secteur (aucun pour un secteur « trouver »). */
function requiredItems(sector: Sector): number[] {
  if (sector.kind === SectorKind.Find) return [];
  return [sector.requiredItem, sector.additionalRequiredItem].filter((item) => item >= 0);
}

/**
 * Ordre de résolution des secteurs de la planète (inspiré du solveur d'Indy) : exploration depuis la ville, en ne
 * franchissant un barrage qu'une fois résolu et en ne prenant un véhicule de voyage qu'une fois le voyage résolu ;
 * chaque secteur accessible dont on a les objets est résolu et fournit son objet. L'inventaire de départ est l'objet
 * remis par Yoda. Les arrivées de voyage (îles) ne sont pas des étapes.
 */
export function planYoda(assets: Assets, story: YodaStory, internal = true): { steps: number[]; reason: string } {
  const sectors = story.sectors;
  // Objets que les scripts d'une zone exigent en plus de son objet requis (la Force sur un interrupteur…), quand un
  // autre secteur les fournit : la zone attend qu'on les ait. Sans ordre possible, on retente sans cette contrainte.
  const provided = new Set(sectors.flatMap((s) => (s && s.findItem >= 0 ? [s.findItem] : [])));
  const internalItems = (s: Sector) =>
    !internal
      ? []
      : [
          ...new Set(
            [...assets.roomsOf(s.zoneId)].flatMap((room) =>
              room.actions.flatMap((a) => a.conditions.filter((c) => c.opcode === PLACED_ITEM_IS && c.args[4] >= 0).map((c) => c.args[4])),
            ),
          ),
        ].filter((item) => provided.has(item) && item !== s.findItem && !requiredItems(s).includes(item));
  const inventory = new Set<number>(story.startItem >= 0 ? [story.startItem] : []);
  const solved = new Set<number>();
  const steps: number[] = [];
  const town = sectors.findIndex((s) => s?.kind === SectorKind.Town);
  const goal = sectors.findIndex((s) => s?.kind === SectorKind.Goal);
  if (town < 0 || goal < 0) return { steps, reason: "pas de ville ou pas d'objectif" };
  const isStep = (s: Sector) => {
    const type = assets.zone(s.zoneId).type;
    if (s.kind === SectorKind.Find) return s.findItem >= 0;
    if (s.kind === SectorKind.Travel) return type === ZoneType.TravelStart && s.requiredItem >= 0;
    return s.kind === SectorKind.Puzzle || s.kind === SectorKind.Blockade || s.kind === SectorKind.Goal;
  };
  const travelTarget = (index: number) => {
    const vehicle = assets.zone(sectors[index]!.zoneId).hotspots.find((h) => h.type === HotspotType.VehicleTo);
    return vehicle ? sectors.findIndex((s) => s?.zoneId === vehicle.argument) : -1;
  };
  for (let guard = 0; guard < 200; guard++) {
    let progress = false;
    for (const index of explore(assets, sectors, town, solved, travelTarget)) {
      const s = sectors[index]!;
      if (solved.has(index) || !isStep(s) || ![...requiredItems(s), ...internalItems(s)].every((item) => inventory.has(item))) continue;
      solved.add(index);
      steps.push(index);
      if (s.findItem >= 0) inventory.add(s.findItem);
      progress = true;
      if (index === goal) return { steps, reason: "" };
    }
    if (!progress) break;
  }
  if (internal) return planYoda(assets, story, false);
  return { steps, reason: `objectif inaccessible (objets ${requiredItems(sectors[goal]!).map((i) => assets.tileName(i)).join(", ")})` };
}

function explore(assets: Assets, sectors: readonly (Sector | null)[], start: number, solved: Set<number>, travelTarget: (i: number) => number): number[] {
  const seen = new Set<number>([start]);
  const queue = [start];
  const blockedDirection = (index: number) => {
    const s = sectors[index]!;
    return s.kind === SectorKind.Blockade && !solved.has(index) ? BLOCKED_DIRECTION[assets.zone(s.zoneId).type] : undefined;
  };
  while (queue.length) {
    const index = queue.shift()!;
    const x = index % WORLD_SIZE;
    const y = Math.floor(index / WORLD_SIZE);
    const blocked = blockedDirection(index);
    const next: number[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (x + dx < 0 || y + dy < 0 || x + dx >= WORLD_SIZE || y + dy >= WORLD_SIZE) continue;
      if (blocked && blocked[0] === dx && blocked[1] === dy) continue;
      const n = x + dx + (y + dy) * WORLD_SIZE;
      if (!sectors[n]) continue;
      const nb = blockedDirection(n);
      if (nb && nb[0] === -dx && nb[1] === -dy) continue;
      next.push(n);
    }
    if (sectors[index]!.kind === SectorKind.Travel && solved.has(index)) {
      const target = travelTarget(index);
      if (target >= 0) next.push(target);
    }
    for (const n of next) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return [...seen];
}

/** Règles de Yoda pour le robot : Yoda, X-Wing, objets posés sur les PNJ, serrures ou cases attendues par les scripts. */
class YodaBot extends DesktopBot {
  // À l'atterrissage, le héros reste entouré de cases bloquées jusqu'au script du tick suivant.
  protected override patience = 3;
  /** Remettre l'objet d'une zone « trouver » que le robot n'obtient pas (énigme interne), pour continuer la partie. */
  giveUnreachable = process.env.PLAY_GIVE !== "0";
  /** Sans aide (PLAY_GIVE=0) : ni objet remis, ni héros placé d'office. */
  override aids = this.giveUnreachable;
  /** Blocages contournés par une aide. */
  readonly blockers: string[] = [];
  /** Objet recherché : l'exploration des énigmes s'arrête dès qu'il est obtenu. */
  private wanted = -1;

  /** Un véhicule sert dès que son point chaud est actif (les scripts l'activent une fois le voyage résolu). */
  protected override vehicleUsable(sector: Sector): boolean {
    return this.game.zoneState(sector.zoneId).hotspots.some((h) => h.enabled && (h.type === HotspotType.VehicleTo || h.type === HotspotType.VehicleBack));
  }

  /** Les véhicules de Yoda partent souvent par script (cogner l'appareil) plutôt que par leur point chaud. */
  protected override async rideVehicle(): Promise<boolean> {
    if (await super.rideVehicle()) return true;
    const start = this.here;
    for (const room of [...this.game.assets.roomsOf(this.game.zone.id)]) {
      if (this.game.zone.id !== room.id && !(await this.enterRoom(room.id))) continue;
      const zone = this.game.zone;
      await this.pokeAround(() => this.game.zone !== zone);
      if (this.here !== start) return true;
    }
    return false;
  }

  /** Ne pas remonter par mégarde dans le X-Wing posé : case dont le script de la zone réactive son départ vers Dagobah. */
  protected override avoid(x: number, y: number): boolean {
    const zone = this.game.zone;
    const ops = YODA_OPCODES;
    return zone.zone.actions.some(
      (action, index) =>
        zone.actionEnabled[index] &&
        action.conditions.some((c) => ops.conditions[c.opcode] === "StandingOn" && c.args[0] === x && c.args[1] === y) &&
        action.instructions.some((i) => ops.instructions[i.opcode] === "EnableHotspot" && zone.hotspots[i.args[0]]?.type === HotspotType.ShipFromPlanet),
    );
  }

  /** Portes qu'il faut d'abord cogner pour les ouvrir, passages ouverts par script : on sollicite la zone, puis on réessaie. */
  override async enterRoom(roomId: number): Promise<boolean> {
    let stuck = 0;
    for (let attempt = 0; attempt < 8 && stuck < 2; attempt++) {
      if (await super.enterRoom(roomId)) return true;
      const here = this.game.zone;
      await this.pokeAround(() => this.game.zone !== here);
      if (this.game.zone.id === roomId) return true;
      if (this.game.zone === here) stuck++;
    }
    return this.game.zone.id === roomId;
  }

  /** Parle à Yoda sur Dagobah : mission et premier objet de la chaîne. */
  async meetYoda(): Promise<string | null> {
    const game = this.game;
    const dagobah = game.story.dagobah!;
    const index = dagobah.findIndex((s) => s?.npc === TileIds.Yoda);
    if (index < 0) return null; // « Sauver Yoda » : seul son siège est sur Dagobah
    const err = await this.travelTo(index);
    if (err) return `Dagobah : ${err}`;
    const target = this.locateTile(dagobah[index]!, TileIds.Yoda);
    if (!target) return "Dagobah : Yoda introuvable";
    const e = await this.interact(target);
    if (e) return `Dagobah : ${e}`;
    if (game.story.startItem >= 0 && !game.hasItem(game.story.startItem)) return `Yoda n'a pas remis ${game.assets.tileName(game.story.startItem)}`;
    return null;
  }

  /** Décolle de Dagobah : le héros se place sous le X-Wing (6, 12) du secteur sud-ouest et le cogne. */
  async flyToPlanet(): Promise<string | null> {
    const game = this.game;
    const onPlanet = () => game.world.gridOf(game.zone.id) === 0;
    const err = await this.travelTo(DAGOBAH_CELLS.southWest);
    if (err) return `Dagobah : ${err}`;
    if (!(await this.walk((x, y) => x === 6 && y === 12))) return `X-Wing inaccessible : ${this.dump()}`;
    await this.step(0, -1);
    for (let t = 0; t < 60 && !onPlanet() && game.zone.id !== CRASH_SITE; t++) await this.tick();
    if (game.zone.id === CRASH_SITE) {
      // Vol interplanétaire : réveil au lieu du crash, le droïde médical, puis le vaisseau (point chaud vers la planète).
      for (let t = 0; t < 10; t++) await this.tick();
      await this.pokeAround(onPlanet);
      for (let t = 0; t < 60 && !onPlanet(); t++) await this.tick();
      if (!onPlanet()) return `vol interplanétaire : bloqué au lieu du crash (zone ${game.zone.id}) ${this.dump()}`;
    }
    if (!onPlanet()) return `le X-Wing ne décolle pas (zone ${game.zone.id}, compteur ${game.zone.counter})`;
    return null;
  }

  /** Cases où utiliser `item` dans le secteur : PNJ du secteur, serrures actives, cases des scripts « objet posé ». */
  useTargets(sector: Sector, item: number): Target[] {
    // Par ordre de préférence : cases où un script actif attend l'objet (ses autres conditions remplies), PNJ, serrures,
    // puis les autres cases de scripts. Une serrure peut consommer l'objet sans rien donner quand la zone attend
    // qu'on l'utilise ailleurs (compteur partagé du secteur).
    const live: Target[] = [];
    const later: Target[] = [];
    const out: Target[] = [];
    if (sector.npc >= 0) {
      const npc = this.locateTile(sector, sector.npc);
      if (npc) out.push(npc);
    }
    for (const room of this.game.assets.roomsOf(sector.zoneId)) {
      const state = this.game.zoneState(room.id);
      const locks = state.hotspots.filter((h) => h.enabled && h.type === HotspotType.Lock);
      for (const h of locks.sort((a, b) => Number(b.argument === item) - Number(a.argument === item))) out.push({ room: room.id, at: { x: h.x, y: h.y } });
      room.actions.forEach((action, index) => {
        if (!state.actionEnabled[index]) return;
        for (const c of action.conditions) {
          if (c.opcode !== PLACED_ITEM_IS) continue;
          const [x, y, , , wanted] = c.args;
          if (wanted === item || (wanted < 0 && requiredItems(sector).includes(item))) (this.otherConditionsHold(action, state) ? live : later).push({ room: room.id, at: { x, y } });
        }
      });
    }
    out.unshift(...live);
    out.push(...later);
    return out.filter((t, i) => out.findIndex((o) => o.room === t.room && o.at.x === t.at.x && o.at.y === t.at.y) === i);
  }

  /** Énigmes de zone : explore les scripts de cognement jusqu'à ce que `targets` devienne accessible. */
  protected override async unblock(targets: (x: number, y: number) => boolean): Promise<boolean> {
    if (await super.unblock(targets)) return true;
    if (await this.pokeAround(() => this.reachable(targets) || this.game.hasItem(this.wanted))) return true;
    return super.unblock(targets);
  }

  /** Objets que les scripts actifs de la zone attendent (objet posé, objet détenu) et que le héros n'a pas. */
  private neededItems(zones = [this.game.zone]): Set<number> {
    const ops = YODA_OPCODES;
    const out = new Set<number>(this.wanted >= 0 ? [this.wanted] : []);
    for (const zone of zones) {
      zone.zone.actions.forEach((action, index) => {
        if (!zone.actionEnabled[index]) return;
        for (const c of action.conditions) {
          const op = ops.conditions[c.opcode];
          if (op === "PlacedItemIs" && c.args[4] >= 0) out.add(c.args[4]);
          if (op === "HasItem" && c.args[0] >= 0) out.add(c.args[0]);
        }
      });
    }
    for (const item of out) if (this.game.hasItem(item)) out.delete(item);
    return out;
  }

  /** Va chercher les objets (clés…) que les scripts du secteur attendent et qui traînent dans ses pièces. */
  async fetchKeys(sector: Sector): Promise<void> {
    const rooms = [...this.game.assets.roomsOf(sector.zoneId)].map((room) => this.game.zoneState(room.id));
    for (const item of this.neededItems(rooms)) {
      const at = this.locateTile(sector, item);
      if (at && !this.game.over) await this.interact(at);
    }
  }

  /** Objet que lâchera le monstre à sa mort (`dropLoot` du moteur), -1 s'il n'en lâche pas. */
  private lootOf(m: Monster): number {
    const placement = this.game.zone.zone.monsters[m.index];
    if (!placement?.dropsLoot) return -1;
    if (placement.loot > 0) return placement.loot - 1;
    return this.game.zone.hotspots.find((h) => h.type === HotspotType.DropQuestItem && h.argument > 0)?.argument ?? -1;
  }

  /** Tue les monstres porteurs d'un objet attendu par la zone, puis ramasse leur butin. */
  async huntLoot(): Promise<boolean> {
    const game = this.game;
    const zone = game.zone;
    let got = false;
    for (let guard = 0; guard < 6 && game.zone === zone && !game.over; guard++) {
      const needed = this.neededItems();
      const m = zone.monsters.find((mo) => mo.enabled && mo.damageTaken < mo.character.health && needed.has(this.lootOf(mo)));
      if (!m) break;
      const item = this.lootOf(m);
      if (!(await this.killMonster(m))) break;
      const at = { x: m.x, y: m.y };
      for (let t = 0; t < 3; t++) await this.tick();
      if (zone.getTile(at.x, at.y, 1) === item) await this.interact({ room: zone.id, at });
      got ||= game.hasItem(item);
    }
    return got;
  }

  /** Arme à projectile dont `item` est la tuile d'inventaire (la Force, le blaster…), sinon null. */
  private projectileOf(item: number): Character | null {
    const weapon = this.game.assets.data.characters.find((c) => c && c.frames[0][FrameEntry.ExtensionRight] === item && c.frames[0][FrameEntry.Left] >= 0);
    return this.game.assets.isWeaponTile(item) && weapon ? weapon : null;
  }

  /**
   * Un tir depuis (hx, hy) atteint-il (x, y) ? En ligne droite, à 1, 2 ou 3 cases, sans objet transparent (sprite) en
   * travers : les objets opaques laissent passer le tir (règle `bulletAlongPath` du moteur).
   */
  private canShoot(hx: number, hy: number, x: number, y: number): boolean {
    const zone = this.game.zone;
    if (!zone.isFree(hx, hy) || (hx !== x && hy !== y) || (hx === x && hy === y)) return false;
    const distance = Math.abs(x - hx) + Math.abs(y - hy);
    if (distance > 3) return false;
    for (let k = 1; k < distance; k++) {
      const t = zone.getTile(hx + Math.sign(x - hx) * k, hy + Math.sign(y - hy) * k, 1);
      if (t !== -1 && this.game.assets.hasFlag(t, TileFlag.Transparent)) return false;
    }
    return true;
  }

  /** Équipe l'arme `item`, tire vers (x, y), puis reprend l'arme d'avant. */
  private async shoot(item: number, x: number, y: number): Promise<void> {
    const game = this.game;
    const previous = game.weapon ? game.weaponTile(game.weapon) : -1;
    game.requestPlacement(item, game.hero.x, game.hero.y);
    await this.tick();
    game.hero.facing = y < game.hero.y ? 0 : y > game.hero.y ? 1 : x < game.hero.x ? 2 : 3;
    game.requestAttack();
    for (let t = 0; t < 6; t++) await this.tick();
    if (previous >= 0 && previous !== item && game.hasItem(previous)) {
      game.requestPlacement(previous, game.hero.x, game.hero.y);
      await this.tick();
    }
  }

  /** Cases où un script attend un bloc déplaçable précis (conditions « tuile en (x, y) » du plan des objets). */
  private blockGoals(action: (typeof this.game.zone.zone.actions)[number]): Array<{ tile: number; x: number; y: number }> {
    const ops = YODA_OPCODES;
    // Bloc attendu sur une case, ou case à vider d'un bloc (`TileAtIs(-1, …)`).
    return action.conditions
      .filter((c) => ops.conditions[c.opcode] === "TileAtIs" && c.args[3] === 1 && (this.game.assets.isDraggable(c.args[0]) || (c.args[0] === -1 && this.pushable(c.args[1], c.args[2]))))
      .map((c) => ({ tile: c.args[0], x: c.args[1], y: c.args[2] }));
  }

  /** Les autres conditions de l'action (hasard tiré, compteur, tuiles hors plan des objets) sont-elles déjà remplies ? */
  private otherConditionsHold(action: (typeof this.game.zone.zone.actions)[number], zone = this.game.zone): boolean {
    const ops = YODA_OPCODES;
    // Zone pas encore visitée : hasard et compteur inconnus. Le compteur partagé suit le héros de pièce en pièce.
    const known = zone.initialized;
    const shared = zone === this.game.zone ? zone.sectorCounter : this.game.zone.sectorCounter;
    return action.conditions.every((c) => {
      const a = c.args;
      switch (ops.conditions[c.opcode]) {
        case "RandomIs":
          return !known || zone.random === a[0];
        case "RandomIsNot":
          return !known || zone.random !== a[0];
        case "CounterIs":
          return !known || zone.counter === a[0];
        case "CounterIsNot":
          return !known || zone.counter !== a[0];
        case "SectorCounterIs":
          return shared === a[0];
        case "SectorCounterIsNot":
          return shared !== a[0];
        case "SectorCounterIsLessThan":
          return shared < a[0];
        case "SectorCounterIsGreaterThan":
          return shared > a[0];
        case "TileAtIs":
          return a[3] === 1 || zone.getTile(a[1], a[2], a[3]) === a[0];
        case "HasItem":
          return a[0] < 0 || this.game.hasItem(a[0]);
        case "ZoneNotInitialized":
          return false;
        default:
          return true;
      }
    });
  }

  /**
   * Cogne tour à tour, une fois chacune, les cases que les scripts de la zone courante attendent (condition « Bump »
   * d'une action active, tuile en place, case imposée au héros s'il y en a) jusqu'à ce que `stop` soit vrai.
   */
  async pokeAround(stop: () => boolean): Promise<boolean> {
    const game = this.game;
    const zone = game.zone;
    const ops = YODA_OPCODES;
    const tried = new Set<string>();
    for (let round = 0; round < 20 && game.zone === zone && !game.over; round++) {
      if (stop()) return true;
      if (await this.huntLoot()) continue;
      const candidates = zone.zone.actions.flatMap((action, index) => {
        if (!zone.actionEnabled[index] || !this.otherConditionsHold(action)) return [];
        // Case à cogner, ou case où poser un objet précis de l'inventaire (interrupteur à actionner avec la Force…).
        const bump = action.conditions.find((c) => ops.conditions[c.opcode] === "Bump");
        const place = action.conditions.find((c) => ops.conditions[c.opcode] === "PlacedItemIs" && c.args[4] >= 0 && game.hasItem(c.args[4]));
        let x: number, y: number, item: number | undefined;
        // Bloc déplaçable attendu sur la case à cogner : il faut d'abord l'y amener.
        let block = -1;
        if (bump) {
          [x, y] = bump.args;
          if (![0, 1, 2].some((l) => zone.getTile(x, y, l) === bump.args[2])) {
            if (!game.assets.isDraggable(bump.args[2])) return [];
            block = bump.args[2];
          }
        } else if (place) {
          [x, y] = place.args;
          if (zone.getTile(x, y, place.args[2]) !== place.args[3]) return [];
          item = place.args[4];
        } else {
          // Case où se tenir (dalle d'interrupteur…), éventuellement couverte d'un bloc à déplacer.
          const on = action.conditions.find((c) => ops.conditions[c.opcode] === "StandingOn");
          if (!on || action.conditions.some((c) => ops.conditions[c.opcode] === "ZoneEntered")) return [];
          [x, y] = on.args;
          if (zone.getTile(x, y, 0) !== on.args[2] || this.avoid(x, y)) return [];
          const key = `sur ${x},${y}`;
          if (tried.has(key)) return [];
          const near = (hx: number, hy: number) => hx === x && hy === y;
          return [{ key, x, y, near, item: undefined, block: this.pushable(x, y) ? -2 : -1, stand: true }];
        }
        const at = action.conditions.find((c) => ops.conditions[c.opcode] === "HeroIsAt");
        const stand = at ? { x: at.args[0], y: at.args[1] } : null;
        // La tuile attendue fait partie de la clé : une même case peut changer (eau, puis radeau à cogner).
        const key = `${block >= 0 ? "bloc " : ""}${x},${y},${stand?.x},${stand?.y},${item},${bump?.args[2]}`;
        if (tried.has(key)) return [];
        // Objet posé à côté de la case ; une arme à projectile (la Force, le blaster) peut aussi l'atteindre en tirant.
        const shot = item !== undefined && this.projectileOf(item) ? (hx: number, hy: number) => this.canShoot(hx, hy, x, y) : () => false;
        const near = stand
          ? (hx: number, hy: number) => hx === stand.x && hy === stand.y
          : (hx: number, hy: number) =>
              item === undefined ? Math.abs(hx - x) + Math.abs(hy - y) === 1 : Math.max(Math.abs(hx - x), Math.abs(hy - y)) === 1 || shot(hx, hy);
        if (block >= 0) return [{ key, x, y, near, item, block, stand: false }];
        return this.reachable(near) ? [{ key, x, y, near, item, block, stand: false }] : [];
      });
      // Les manœuvres de blocs en dernier : elles coûtent cher et déplacent le décor.
      const next = candidates.find((c) => c.block < 0) ?? candidates[0];
      if (!next) {
        // Énigme de blocs : amener les blocs déplaçables là où un script actif les attend.
        const puzzle = zone.zone.actions.findIndex((action, index) => {
          const goals = this.blockGoals(action);
          return (
            zone.actionEnabled[index] &&
            goals.length &&
            !tried.has(`blocs ${index}`) &&
            goals.some((g) => zone.getTile(g.x, g.y, 1) !== g.tile) &&
            this.otherConditionsHold(action)
          );
        });
        if (puzzle < 0) break;
        tried.add(`blocs ${puzzle}`);
        const goals = this.blockGoals(zone.zone.actions[puzzle]);
        if (await this.solveBlocks(`blocs ${puzzle}`, (_, blockAt) => goals.every((g) => blockAt(g.x, g.y) === g.tile))) for (let t = 0; t < 5; t++) await this.tick();
        continue;
      }
      tried.add(next.key);
      const { x, y, near, block } = next;
      if (block >= 0 && !(await this.solveBlocks(next.key, (reach, blockAt) => blockAt(x, y) === block && this.anyReached(reach, near)))) continue;
      if (block === -2 && !(await this.solveBlocks(`sur ${x},${y}`, (reach) => reach(x, y)))) continue;
      if (!(await this.walk(next.near))) continue;
      if (next.stand) {
        for (let t = 0; t < 5; t++) await this.tick();
        continue;
      }
      if (next.item !== undefined && Math.max(Math.abs(next.x - game.hero.x), Math.abs(next.y - game.hero.y)) > 1) {
        await this.shoot(next.item, next.x, next.y);
        continue;
      }
      if (next.item !== undefined) game.requestPlacement(next.item, next.x, next.y);
      else game.input.move = { x: Math.sign(next.x - game.hero.x), y: Math.sign(next.y - game.hero.y) };
      await this.tick();
      game.input.move = { x: 0, y: 0 };
      for (let t = 0; t < 5; t++) await this.tick();
    }
    return stop();
  }

  /**
   * Cases à cogner pour obtenir `item` : conditions « Bump » des scripts du secteur dont l'action donne l'objet
   * (DropItem / AddItem de l'objet, ou de l'objet à trouver du secteur avec -1), avec la case imposée au héros s'il y en a.
   */
  bumpTargets(sector: Sector, item: number): Target[] {
    const out: Target[] = [];
    const ops = YODA_OPCODES;
    for (const room of this.game.assets.roomsOf(sector.zoneId)) {
      for (const action of room.actions) {
        const gives = action.instructions.some((i) => {
          const op = ops.instructions[i.opcode];
          return (op === "DropItem" || op === "AddItem") && (i.args[0] === item || (i.args[0] < 0 && op === "DropItem" && sector.findItem === item));
        });
        const bump = action.conditions.find((c) => ops.conditions[c.opcode] === "Bump");
        if (!gives || !bump) continue;
        const at = action.conditions.find((c) => ops.conditions[c.opcode] === "HeroIsAt");
        out.push({ room: room.id, at: { x: bump.args[0], y: bump.args[1] }, stand: at ? { x: at.args[0], y: at.args[1] } : undefined });
      }
    }
    return out;
  }

  async solveSector(index: number): Promise<string | null> {
    const game = this.game;
    const sector = game.story.sectors[index]!;
    const name = `zone ${sector.zoneId}`;
    const err = await this.travelTo(index);
    if (err) return err;
    for (const item of requiredItems(sector)) {
      if (!game.hasItem(item)) return `objet requis absent : ${game.assets.tileName(item)} (${name})`;
      if (!this.useTargets(sector, item).length) return `pas de cible pour ${game.assets.tileName(item)} dans ${name}`;
      let error: string | null = null;
      for (let attempt = 0; attempt < 3 && game.hasItem(item) && !game.gameWon && !game.over; attempt++) {
        // Après un premier essai, on sollicite la zone (PNJ à aborder, rocher à cogner…) avant de recommencer.
        if (attempt > 0) {
          for (const room of new Set(this.useTargets(sector, item).map((t) => t.room))) {
            if (game.zone.id !== room && !(await this.enterRoom(room))) continue;
            await this.clearMonsters(); // un monstre peut lâcher l'objet qu'attend la zone
            await this.pokeAround(() => !game.hasItem(item));
          }
          await this.fetchKeys(sector);
        }
        for (const target of this.useTargets(sector, item)) {
          error = await this.interact(target, item);
          if (!game.hasItem(item) || game.gameWon) break;
        }
      }
      if (game.hasItem(item) && error) return error;
      if (game.hasItem(item) && !game.gameWon) return `${game.assets.tileName(item)} refusé dans ${name}`;
    }
    const want = sector.findItem;
    if (want >= 0 && !game.hasItem(want) && !game.gameWon) {
      this.wanted = want;
      let error: string | null = null;
      for (let attempt = 0; attempt < 4 && !game.hasItem(want) && !game.over; attempt++) {
        if (attempt > 0) await this.fetchKeys(sector);
        if (game.zone.id === sector.zoneId || [...game.assets.roomsOf(sector.zoneId)].some((r) => r.id === game.zone.id)) await this.huntLoot();
        if (game.hasItem(want)) break;
        const located = this.locateTile(sector, want);
        for (const target of [...(located ? [located] : []), ...this.bumpTargets(sector, want)]) {
          if (game.hasItem(want)) break;
          error = await this.interact(target);
        }
        if (game.hasItem(want)) break;
        await this.clearMonsters();
        for (const npc of this.npcsOf(sector)) {
          if (game.hasItem(want)) break;
          await this.interact(npc);
        }
        // Énigmes des pièces du secteur (cases à cogner, interrupteurs, blocs) : l'objet peut apparaître ensuite.
        for (const room of [...game.assets.roomsOf(sector.zoneId)]) {
          if (game.hasItem(want) || game.over) break;
          if (game.zone.id !== room.id && !(await this.enterRoom(room.id))) continue;
          await this.pokeAround(() => game.hasItem(want));
        }
      }
      this.wanted = -1;
      if (!game.hasItem(want)) {
        const why = `objet ${game.assets.tileName(want)} non obtenu dans ${name}${error ? ` (${error})` : ""}`;
        if (process.env.PLAY_DEBUG) console.log(why, this.dump(), JSON.stringify(game.zone.hotspots));
        if (!this.giveUnreachable || sector.kind !== SectorKind.Find || game.over) return why;
        // Objet d'une zone « trouver » gardé par une énigme interne : on le remet (aide) pour tester la suite de la chaîne.
        this.blockers.push(why);
        this.cheats.push(`objet ${want} remis`);
        await game.dropItem(want, { x: game.hero.x, y: game.hero.y });
      }
    }
    if (sector.kind === SectorKind.Goal) {
      for (let t = 0; t < 30 && !game.gameWon; t++) await this.tick();
      if (!game.gameWon) return `objectif ${name} résolu sans victoire`;
    }
    return null;
  }
}

class RecordingPresenter implements Presenter {
  endings: string[] = [];
  speak: Presenter["speak"] = silentPresenter.speak;
  message = silentPresenter.message;
  pickup = silentPresenter.pickup;
  transition = silentPresenter.transition;
  playSound = silentPresenter.playSound;
  chooseTeleport = silentPresenter.chooseTeleport;
  async ended(kind: "win" | "lose") {
    this.endings.push(kind);
  }
}

/** Joue une partie ; renvoie la ligne de rapport. */
async function play(assets: Assets, strings: ReadonlyMap<number, string>, seed: number, size: WorldSize): Promise<{ line: string; won: boolean }> {
  const story = generateYodaStory(assets, seed, size);
  const presenter = new RecordingPresenter();
  // Hasard du jeu (monstres, dés des scripts) tiré de la graine : parties reproductibles.
  const random = Math.random;
  let state = seed * 7919 + size;
  Math.random = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const game = new Game(createYodaVariant(strings), assets, story, presenter, { difficulty: 1 });
  Math.random = random;
  const bot = new YodaBot(game);
  if (process.env.PLAY_TRACE) {
    // Journal : zones traversées, inventaire, dialogues.
    game.addEventListener("zone", () => console.log("TRACE zone", game.zone.id, game.hero.x, game.hero.y));
    game.addEventListener("inventory", () => console.log("TRACE inventaire", game.inventory.join(",")));
    presenter.speak = async (text) => console.log("TRACE dit", text.slice(0, 80).replace(/\s+/g, " "));
  }
  const plan = planYoda(assets, story);
  const describe = (s: Sector) =>
    `${s.kind} zone ${s.zoneId} (type ${assets.zone(s.zoneId).type})${requiredItems(s).length ? ` demande ${requiredItems(s).join("+")}` : ""}${s.findItem >= 0 ? ` donne ${s.findItem}` : ""}${s.npc >= 0 ? ` pnj ${s.npc}` : ""}`;
  const goalName = story.goalPuzzle;
  if (process.env.PLAY_TRACE) for (const i of plan.steps) console.log("TRACE plan", i, describe(story.sectors[i]!));
  let failure: string | null = null;
  let done = 0;
  try {
    await drive(game, game.start(story.startZone, story.startPosition));
    failure = plan.reason ? `plan : ${plan.reason}` : await bot.meetYoda();
    failure ??= await bot.flyToPlanet();
    while (!failure && done < plan.steps.length && !game.gameWon) {
      failure = await bot.solveSector(plan.steps[done]);
      if (game.over && !game.gameWon) failure ??= "héros mort";
      if (!failure) done++;
    }
  } catch (error) {
    failure = `exception : ${(error as Error).stack?.split("\n").slice(0, 3).join(" | ")}`;
  }
  const won = game.gameWon && presenter.endings.includes("win");
  const stepSector = story.sectors[plan.steps[done] ?? -1];
  const where = done < plan.steps.length ? ` à l'étape ${done + 1}/${plan.steps.length} [${describe(stepSector!)}]` : "";
  const skipped = bot.blockers.length ? ` ; contournés : ${bot.blockers.join(" ; ")}` : "";
  const line = `graine ${seed} taille ${size} (planète ${story.planet}, mission ${goalName}) : ${won ? "GAGNÉE" : `bloquée${where} — ${failure ?? "fin du plan sans victoire"}`} [${bot.ticks} ticks, aides : ${bot.cheats.join(", ") || "aucune"}${skipped}]`;
  return { line, won };
}

// Diagnostic long, activé avec PLAY=1 (PLAY_SEEDS=« 1,2,3 », PLAY_SIZES=« 1,2 », PLAY_DEBUG=1 pour les plans des zones,
// PLAY_TRACE=1 pour le journal de la partie, PLAY_GIVE=0 pour jouer sans aide : ni objet remis, ni héros placé d'office).
describe.skipIf(!hasOriginalFiles || !process.env.PLAY)("parties de Yoda jouées par un robot", () => {
  it("joue des missions complètes et signale où elles bloquent", { timeout: 900_000 }, async () => {
    const assets = new Assets(loadGameData());
    const strings = readPeStrings(loadExe());
    const seeds = (process.env.PLAY_SEEDS ?? "1,2,3,4,5,6,7,8,9,10").split(",").map(Number);
    const sizes = (process.env.PLAY_SIZES ?? "1").split(",").map(Number) as WorldSize[];
    const report: string[] = [];
    let won = 0;
    for (const size of sizes) {
      for (const seed of seeds) {
        const result = await play(assets, strings, seed, size);
        if (process.env.PLAY_DEBUG || process.env.PLAY_TRACE) console.log(result.line);
        report.push(result.line);
        if (result.won) won++;
      }
    }
    console.log(`${report.join("\n")}\n${won}/${report.length} parties gagnées`);
    expect(report.length).toBeGreaterThan(0);
  });
});

