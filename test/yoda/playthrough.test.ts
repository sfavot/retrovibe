import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { HotspotType, ZoneType } from "../../src/engine/desktop-adventures/data/types";
import { readPeStrings } from "../../src/engine/desktop-adventures/data/pe-resources";
import { Game, type Presenter } from "../../src/engine/desktop-adventures/game";
import { opcodeOf } from "../../src/engine/desktop-adventures/script";
import { type Sector, SectorKind, WORLD_SIZE, WorldSize } from "../../src/engine/desktop-adventures/world";
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
export function planYoda(assets: Assets, story: YodaStory): { steps: number[]; reason: string } {
  const sectors = story.sectors;
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
      if (solved.has(index) || !isStep(s) || !requiredItems(s).every((item) => inventory.has(item))) continue;
      solved.add(index);
      steps.push(index);
      if (s.findItem >= 0) inventory.add(s.findItem);
      progress = true;
      if (index === goal) return { steps, reason: "" };
    }
    if (!progress) break;
  }
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

const PLACED_ITEM_IS = opcodeOf(YODA_OPCODES.conditions, "PlacedItemIs");

/** Règles de Yoda pour le robot : Yoda, X-Wing, objets posés sur les PNJ, serrures ou cases attendues par les scripts. */
class YodaBot extends DesktopBot {
  // À l'atterrissage, le héros reste entouré de cases bloquées jusqu'au script du tick suivant.
  protected override patience = 3;
  /** Remettre l'objet d'une zone « trouver » que le robot n'obtient pas (énigme interne), pour continuer la partie. */
  giveUnreachable = process.env.PLAY_GIVE !== "0";
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
    const out: Target[] = [];
    if (sector.npc >= 0) {
      const npc = this.locateTile(sector, sector.npc);
      if (npc) out.push(npc);
    }
    for (const room of this.game.assets.roomsOf(sector.zoneId)) {
      const state = this.game.zoneState(room.id);
      const locks = state.hotspots.filter((h) => h.enabled && h.type === HotspotType.Lock);
      for (const h of locks.sort((a, b) => Number(b.argument === item) - Number(a.argument === item))) out.push({ room: room.id, at: { x: h.x, y: h.y } });
      for (const action of room.actions) {
        for (const c of action.conditions) {
          if (c.opcode !== PLACED_ITEM_IS) continue;
          const [x, y, , , wanted] = c.args;
          if (wanted === item || (wanted < 0 && requiredItems(sector).includes(item))) out.push({ room: room.id, at: { x, y } });
        }
      }
    }
    return out.filter((t, i) => out.findIndex((o) => o.room === t.room && o.at.x === t.at.x && o.at.y === t.at.y) === i);
  }

  /** Énigmes de zone : explore les scripts de cognement jusqu'à ce que `targets` devienne accessible. */
  protected override async unblock(targets: (x: number, y: number) => boolean): Promise<boolean> {
    return this.pokeAround(() => this.reachable(targets) || this.game.hasItem(this.wanted));
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
      const candidates = zone.zone.actions.flatMap((action, index) => {
        if (!zone.actionEnabled[index]) return [];
        // Case à cogner, ou case où poser un objet précis de l'inventaire (interrupteur à actionner avec la Force…).
        const bump = action.conditions.find((c) => ops.conditions[c.opcode] === "Bump");
        const place = action.conditions.find((c) => ops.conditions[c.opcode] === "PlacedItemIs" && c.args[4] >= 0 && game.hasItem(c.args[4]));
        let x: number, y: number, item: number | undefined;
        if (bump) {
          [x, y] = bump.args;
          if (![0, 1, 2].some((l) => zone.getTile(x, y, l) === bump.args[2])) return [];
        } else if (place) {
          [x, y] = place.args;
          if (zone.getTile(x, y, place.args[2]) !== place.args[3]) return [];
          item = place.args[4];
        } else return [];
        const at = action.conditions.find((c) => ops.conditions[c.opcode] === "HeroIsAt");
        const stand = at ? { x: at.args[0], y: at.args[1] } : null;
        const key = `${x},${y},${stand?.x},${stand?.y},${item}`;
        if (tried.has(key)) return [];
        const near = stand
          ? (hx: number, hy: number) => hx === stand.x && hy === stand.y
          : (hx: number, hy: number) => (item === undefined ? Math.abs(hx - x) + Math.abs(hy - y) === 1 : Math.max(Math.abs(hx - x), Math.abs(hy - y)) === 1);
        return this.reachable(near) ? [{ key, x, y, near, item }] : [];
      });
      const next = candidates[0];
      if (!next) break;
      tried.add(next.key);
      if (!(await this.walk(next.near))) continue;
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
      }
      this.wanted = -1;
      if (!game.hasItem(want)) {
        const why = `objet ${game.assets.tileName(want)} non obtenu dans ${name}${error ? ` (${error})` : ""}`;
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
// PLAY_TRACE=1 pour le journal de la partie, PLAY_GIVE=0 pour s’arrêter au premier objet « trouver » non obtenu).
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
        report.push(result.line);
        if (result.won) won++;
      }
    }
    console.log(`${report.join("\n")}\n${won}/${report.length} parties gagnées`);
    expect(report.length).toBeGreaterThan(0);
  });
});

