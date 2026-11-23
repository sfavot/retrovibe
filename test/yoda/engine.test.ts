import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { HotspotType, Layer } from "../../src/engine/desktop-adventures/data/types";
import { Game, type GameSnapshot, MAX_HEALTH, type Presenter } from "../../src/engine/desktop-adventures/game";
import { parseSnapshot } from "../../src/engine/desktop-adventures/snapshot";
import { readPeStrings } from "../../src/engine/desktop-adventures/data/pe-resources";
import { Rng } from "../../src/engine/desktop-adventures/rng";
import { WorldSize } from "../../src/engine/desktop-adventures/world";
import { generateYodaStory } from "../../src/games/yoda/generation/world-generator";
import { TileIds, ZoneIds } from "../../src/games/yoda/ids";
import { YodaSounds } from "../../src/games/yoda/sounds";
import { createYodaVariant } from "../../src/games/yoda/variant";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

class FakePresenter implements Presenter {
  speeches: string[] = [];
  sounds: number[] = [];
  endings: string[] = [];
  async speak(text: string) {
    this.speeches.push(text);
  }
  async message(text: string) {
    this.speeches.push(text);
  }
  async pickup() {}
  async transition(_: unknown, apply: () => void) {
    apply();
  }
  playSound(id: number) {
    this.sounds.push(id);
  }
  async ended(kind: "win" | "lose") {
    this.endings.push(kind);
  }
  async chooseTeleport(destinations: number[]) {
    return destinations[0] ?? null;
  }
}

/** Fournit des ticks tant que l'opération (scripts animés, détonateur…) n'est pas terminée. */
async function drive(game: Game, operation: Promise<void>): Promise<void> {
  let done = false;
  const finished = operation.finally(() => (done = true));
  for (let guard = 0; guard < 3000 && !done; guard++) {
    await new Promise((r) => setImmediate(r));
    if (!done) void game.step();
  }
  if (!done) throw new Error(`zone ${game.zone.id} : le jeu reste bloqué`);
  await finished;
}

async function newGame(seed = 7, size = WorldSize.Small) {
  const assets = new Assets(loadGameData());
  const story = generateYodaStory(assets, seed, size);
  const presenter = new FakePresenter();
  const game = new Game(createYodaVariant(readPeStrings(loadExe())), assets, story, presenter);
  await drive(game, game.start(story.startZone, story.startPosition));
  return { assets, story, presenter, game };
}

/** Case du hotspot dont l'objet est posé, ou la case de Yoda dans la zone. */
function yodaSpot(game: Game) {
  for (let y = 0; y < game.zone.height; y++) {
    for (let x = 0; x < game.zone.width; x++) if (game.zone.getTile(x, y, Layer.Object) === TileIds.Yoda) return { x, y };
  }
  return null;
}

/** Zone du lieu de crash, étape du vol interplanétaire. */
const CRASH_SITE = 642;

describe.skipIf(!hasOriginalFiles)("moteur Yoda Stories", () => {
  it("démarre sur Dagobah, sans briefing imposé", async () => {
    const { game, presenter, story } = await newGame();
    // Le texte d'atterrissage vient des scripts « marche » du tick suivant.
    await drive(game, game.step());
    expect(game.zone.id).toBe(ZoneIds.DagobahSouthWest);
    expect(game.hero.health).toBe(MAX_HEALTH);
    expect(story.dagobah).toBeDefined();
    expect(game.world.gridOf(game.zone.id)).toBe(1);
    // Seul le texte d'atterrissage de l'intro : la mission, elle, vient de Yoda.
    expect(presenter.speeches).toHaveLength(1);
    expect(presenter.speeches[0]).toContain("Dagobah");
  });

  it("parler à Yoda donne la mission puis le premier objet ; ensuite il la rappelle", async () => {
    for (const seed of [1, 7, 19, 42]) {
      const { game, presenter, story } = await newGame(seed);
      // Yoda est dans l'une des zones de Dagobah ou dans sa cabane.
      const zones = [ZoneIds.DagobahSouthWest, ZoneIds.DagobahNorthWest, ZoneIds.DagobahNorthEast, ZoneIds.DagobahSouthEast, ZoneIds.YodasHut];
      let spot = null;
      for (const zone of zones) {
        await drive(game, game.debugTeleport(zone, 0, 0));
        spot = yodaSpot(game);
        if (spot) break;
      }
      if (!spot) continue; // mission « Sauver Yoda » : seul son siège est là
      const side = [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }].find((d) => game.zone.isFree(spot.x + d.x, spot.y + d.y))!;
      game.hero.x = spot.x + side.x;
      game.hero.y = spot.y + side.y;
      game.input.move = { x: -side.x, y: -side.y };
      await drive(game, game.step());
      game.input.move = { x: 0, y: 0 };
      const goal = game.assets.puzzle(story.goalPuzzle)!;
      expect(presenter.speeches).toContain(goal.texts[3]);
      if (story.startItem >= 0) expect(game.inventory).toContain(story.startItem);
    }
  });

  /** Fait un pas dans une direction (le jeu avance d'un tick, scripts animés compris). */
  async function walk(game: Game, dx: number, dy: number) {
    game.input.move = { x: dx, y: dy };
    await drive(game, game.step());
    game.input.move = { x: 0, y: 0 };
  }

  // Mission « direct » (la ville s'atteint par le seul point chaud du X-Wing), puis mission à vol interplanétaire.
  it.each([
    { name: "vol direct (ville 2)", seed: 1 },
    { name: "vol direct (ville 151)", seed: 11 },
    { name: "vol par la zone 471 (ville 476)", seed: 7 },
  ])("le X-Wing relie Dagobah et la ville de la planète : $name", async ({ seed }) => {
    const { game, story } = await newGame(seed);
    // L'intro de la zone de chargement se termine par l'atterrissage du X-Wing à côté de Dagobah.
    expect(game.zone.id).toBe(ZoneIds.DagobahSouthWest);
    expect(game.world.gridOf(game.zone.id)).toBe(1);
    expect(game.zone.counter).toBe(0);
    // Le vol interplanétaire exige l'objet remis par Yoda.
    if (story.startItem >= 0) game.addItem(story.startItem);

    // Aller : le héros se place sous le X-Wing puis cogne l'une de ses parties.
    game.hero.x = 6;
    game.hero.y = 12;
    for (let i = 0; i < 40 && game.world.gridOf(game.zone.id) !== 0 && game.zone.id !== CRASH_SITE; i++) {
      await walk(game, 0, i === 0 ? -1 : 0);
    }
    const flight = game.zone.id === CRASH_SITE;
    if (flight) {
      // Vol : Dagobah -> zone 471 -> lieu du crash, où une quête précède le point chaud du vaisseau (hors de ce test).
      const ship = game.zone.hotspots.find((h) => h.type === HotspotType.ShipToPlanet)!;
      game.hero.x = ship.x;
      game.hero.y = ship.y;
      await walk(game, 0, 0);
    }
    expect(game.world.gridOf(game.zone.id)).toBe(0);
    expect(game.assets.zone(game.zone.id).planet).toBe(story.planet);
    const town = game.zone.id;
    // Le retour d'un vol interplanétaire dépend des quêtes de la ville (scripts de la zone 476) : hors de ce test.
    if (flight) return;
    const pad = game.zone.hotspots.find((h) => h.type === HotspotType.ShipFromPlanet)!;

    // Retour : le héros rejoint le vaisseau à pied ; les scripts de la ville le font décoller, puis le X-Wing se repose.
    for (let i = 0; i < 60 && game.zone.id === town; i++) {
      const dx = Math.sign(pad.x - game.hero.x);
      const dy = Math.sign(pad.y - game.hero.y);
      const horizontal = Math.abs(pad.x - game.hero.x) > Math.abs(pad.y - game.hero.y);
      await walk(game, horizontal ? dx : 0, horizontal ? 0 : dy);
    }
    expect(game.zone.id).not.toBe(town);
    expect(game.zone.id).toBe(ZoneIds.DagobahSouthWest);
    expect(game.world.gridOf(game.zone.id)).toBe(1);
    expect(game.zone.counter).toBe(0);
    expect(game.hero.y).toBe(13);
  });

  it("le détonateur s'anime puis blesse les monstres autour", async () => {
    const { game, presenter } = await newGame(3);
    const zone = game.assets.data.zones.find((z) => z.planet === 1 && z.monsters.length > 0)!;
    await drive(game, game.debugTeleport(zone.id, 0, 0));
    const monster = game.zone.monsters.find((m) => m.enabled)!;
    const before = monster.damageTaken;
    game.addItem(TileIds.ThermalDetonator);
    game.requestPlacement(TileIds.ThermalDetonator, monster.x, monster.y);
    // L'objet doit être adjacent au héros.
    game.hero.x = Math.max(0, monster.x - 1);
    game.hero.y = monster.y;
    await drive(game, game.step());
    expect(game.inventory).not.toContain(TileIds.ThermalDetonator);
    expect(monster.damageTaken).toBeGreaterThan(before);
    expect(presenter.sounds).toContain(YodaSounds.BangLarge);
  });

  it("les munitions s'épuisent : l'exemplaire du blaster disparaît", async () => {
    const { game } = await newGame(5);
    game.addItem(TileIds.Blaster);
    game.equip(TileIds.Blaster);
    expect(game.weapon?.frames[0][7]).toBe(TileIds.Blaster);
    expect(game.ammo).toBe(30);
    for (let i = 0; i < 30; i++) {
      game.requestAttack();
      await drive(game, game.step());
      for (let k = 0; k < 5; k++) await drive(game, game.step());
    }
    expect(game.inventory).not.toContain(TileIds.Blaster);
    expect(game.weapon?.frames[0][7]).not.toBe(TileIds.Blaster);
  });

  it("une partie au hasard ne plante pas (déplacements, attaques, objets)", { timeout: 60_000 }, async () => {
    const { game } = await newGame(23, WorldSize.Medium);
    const rng = new Rng(9);
    const moves = [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 1 }];
    game.addItem(TileIds.Blaster);
    for (let i = 0; i < 1500 && !game.over; i++) {
      game.input.move = moves[rng.mod(moves.length)];
      if (rng.mod(10) === 0) game.requestAttack();
      if (rng.mod(50) === 0 && game.inventory.length) game.useInFront(game.inventory[rng.mod(game.inventory.length)]);
      await drive(game, game.step());
    }
    expect(game.zone).toBeDefined();
  });
});

describe.skipIf(!hasOriginalFiles)("sauvegardes Yoda Stories", () => {
  // Les mondes sont tirés au hasard : la validation des sauvegardes doit accepter toute partie réelle, quelle que soit la graine.
  it("accepte telle quelle la sauvegarde de mondes générés de toutes tailles", async () => {
    for (const size of [WorldSize.Small, WorldSize.Medium, WorldSize.Large]) {
      for (let seed = 1; seed <= 12; seed++) {
        const { game, assets } = await newGame(seed, size);
        for (let i = 0; i < 20; i++) await drive(game, game.step());
        const snapshot = JSON.parse(JSON.stringify(game.snapshot())) as GameSnapshot;
        expect(parseSnapshot(snapshot, assets), `graine ${seed}, taille ${size}`).toEqual(snapshot);
      }
    }
  });
});
