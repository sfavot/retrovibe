import { describe, expect, it } from "vitest";
import { HotspotType, Layer } from "../../src/games/indy/data/types";
import { Assets, IndyIds } from "../../src/games/indy/engine/assets";
import { Game, type GameSnapshot, type Presenter, storyFromSnapshot } from "../../src/games/indy/engine/game";
import { generateStory } from "../../src/games/indy/engine/generation/generator";
import { Direction } from "../../src/games/indy/engine/geometry";
import { SectorKind, WorldSize, emptySector } from "../../src/games/indy/engine/world";
import { hasOriginalFiles, loadGameData } from "./helpers";

class FakePresenter implements Presenter {
  speeches: string[] = [];
  pickups: number[] = [];
  sounds: number[] = [];
  endings: string[] = [];
  async speak(text: string) {
    this.speeches.push(text);
  }
  async message(text: string) {
    this.speeches.push(text);
  }
  async pickup(tile: number) {
    this.pickups.push(tile);
  }
  async transition(_: unknown, apply: () => void) {
    apply();
  }
  playSound(id: number) {
    this.sounds.push(id);
  }
  async ended(kind: "win" | "lose") {
    this.endings.push(kind);
  }
  teleportChoices: number[][] = [];
  async chooseTeleport(destinations: number[]) {
    this.teleportChoices.push(destinations);
    return destinations[0] ?? null;
  }
}

async function newGame(seed = 7) {
  const assets = new Assets(loadGameData());
  const story = generateStory(assets, seed, WorldSize.Medium);
  const presenter = new FakePresenter();
  const game = new Game(assets, story, presenter);
  await game.start(IndyIds.townZone, { x: 11, y: 5 });
  return { assets, story, presenter, game };
}

/** Partie dont la case à l'ouest de la ville est remplacée par la zone voulue. */
async function gameWithSector(zoneId: number, kind: SectorKind, requiredItem = -1, findItem = -1) {
  const assets = new Assets(loadGameData());
  const story = generateStory(assets, 7, WorldSize.Medium);
  const town = story.sectors.findIndex((s) => s?.kind === SectorKind.Town);
  story.sectors[town - 1] = { ...emptySector(zoneId, kind), requiredItem, findItem };
  const presenter = new FakePresenter();
  const game = new Game(assets, story, presenter);
  await game.start(IndyIds.townZone, { x: 11, y: 5 });
  await game.debugTeleport(zoneId, 0, 0);
  return { assets, story, presenter, game, sector: story.sectors[town - 1]! };
}

/** Avance de `n` ticks ; tant qu'un script attend (animation), les ticks continuent d'être fournis. */
async function steps(game: Game, n: number) {
  for (let i = 0; i < n; i++) {
    const pending = game.step();
    for (let guard = 0; guard < 2000 && game.busy; guard++) {
      await new Promise((r) => setTimeout(r, 0));
      if (game.busy) void game.step();
    }
    if (game.busy) throw new Error("le jeu reste bloqué");
    await pending;
  }
}

describe.skipIf(!hasOriginalFiles)("moteur de jeu", () => {
  it("démarre en ville avec le fouet, le briefing et l'objet de Marcus", async () => {
    const { game, presenter, story } = await newGame();
    expect(game.zone.id).toBe(IndyIds.townZone);
    expect(game.inventory).toContain(IndyIds.whipTile);
    expect(game.weapon?.name).toBe("WhipWeapon");
    expect(presenter.speeches[0]).toMatch(/Indy/);
    if (story.startItem >= 0) expect(game.inventory).toContain(story.startItem);
  });

  it("entre dans le bureau de Marcus par la porte et en ressort", async () => {
    const { game } = await newGame();
    game.input.move = { x: 0, y: -1 };
    await steps(game, 2);
    expect(game.zone.id).toBe(108);
    game.input.move = { x: 0, y: 0 };
    await steps(game, 1);
    const exit = game.zone.hotspots.find((h) => h.type === HotspotType.DoorOut)!;
    game.hero.x = exit.x;
    game.hero.y = exit.y - 1;
    game.input.move = { x: 0, y: 1 };
    await steps(game, 1);
    expect(game.zone.id).toBe(IndyIds.townZone);
    expect([game.hero.x, game.hero.y]).toEqual([11, 4]);
  });

  it("passe dans le secteur voisin en sortant par le bord", async () => {
    const { game } = await newGame();
    const here = game.world.locate(game.zone.id)!;
    const dirs = [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ];
    const dir = dirs.find((d) => game.world.at(here.x + d.x, here.y + d.y))!;
    // Place le héros sur une case libre du bord correspondant.
    const zone = game.zone;
    for (let i = 0; i < zone.width; i++) {
      const x = dir.x < 0 ? 0 : dir.x > 0 ? zone.width - 1 : i;
      const y = dir.y < 0 ? 0 : dir.y > 0 ? zone.height - 1 : i;
      const next = game.zoneState(game.world.at(here.x + dir.x, here.y + dir.y)!.zoneId);
      const nx = dir.x === 0 ? x : dir.x < 0 ? next.width - 1 : 0;
      const ny = dir.y === 0 ? y : dir.y < 0 ? next.height - 1 : 0;
      if (zone.isFree(x, y) && next.isFree(nx, ny)) {
        game.hero.x = x;
        game.hero.y = y;
        break;
      }
    }
    game.input.move = dir;
    await steps(game, 1);
    expect(game.world.locate(game.zone.id)).toEqual({ x: here.x + dir.x, y: here.y + dir.y });
  });

  it("frappe un monstre au fouet jusqu'à le tuer", async () => {
    const { game } = await newGame();
    const zoneId = game.assets.data.zones.find((z) => z.monsters.some((m) => game.assets.character(m.character)?.name === "Snake"))!.id;
    await game.debugTeleport(zoneId, 0, 0);
    const zone = game.zone;
    const snake = zone.monsters.find((m) => m.character.name === "Snake")!;
    // Fige les autres monstres pour un test déterministe.
    for (const m of zone.monsters) if (m !== snake) m.enabled = false;
    const tries = [
      { dx: 0, dy: -1, facing: Direction.Down },
      { dx: 0, dy: 1, facing: Direction.Up },
      { dx: -1, dy: 0, facing: Direction.Right },
      { dx: 1, dy: 0, facing: Direction.Left },
    ];
    let killed = false;
    for (let round = 0; round < 20 && !killed; round++) {
      const spot = tries.find((t) => zone.isFree(snake.x + t.dx, snake.y + t.dy));
      if (!spot) break;
      game.hero.x = snake.x + spot.dx;
      game.hero.y = snake.y + spot.dy;
      game.hero.facing = spot.facing;
      snake.cooldown = 5;
      game.requestAttack();
      await steps(game, 4);
      killed = !snake.enabled;
    }
    expect(snake.damageTaken).toBeGreaterThan(0);
    expect(killed).toBe(true);
    expect(zone.getTile(snake.x, snake.y, Layer.Object)).not.toBe(snake.character.frames[0][1]);
  });

  it("subit des dégâts et perd la partie à 0 PV", async () => {
    const { game, presenter } = await newGame();
    game.hurtHero(10_000);
    expect(game.hero.health).toBe(0);
    await Promise.resolve();
    expect(presenter.endings).toContain("lose");
  });

  it("consomme un objet de soin", async () => {
    const { game } = await newGame();
    game.hurtHero(200);
    const before = game.hero.health;
    game.addItem(1133); // Bananas
    game.requestPlacement(1133, game.hero.x, game.hero.y);
    await steps(game, 1);
    expect(game.hero.health).toBeGreaterThan(before);
    expect(game.inventory).not.toContain(1133);
  });

  it("barrage : donner l'objet demandé au PNJ le fait s'écarter", async () => {
    const required = 440; // Goddess Mask, dans la liste de BlockLeft1
    const { game, presenter, sector } = await gameWithSector(4, SectorKind.Blockade, required);
    expect(game.zone.getTile(3, 7, Layer.Object)).toBe(541);
    game.hero.x = 4;
    game.hero.y = 7;
    game.addItem(required);
    game.requestPlacement(required, 3, 7);
    await steps(game, 1);
    expect(game.zone.getTile(4, 6, Layer.Object)).toBe(541);
    expect(sector.solved).toBe(true);
    expect(game.inventory).not.toContain(required);
    expect(presenter.speeches.at(-1)).toMatch(/road is yours/);
  });

  it("barrage : le PNJ réclame l'objet par son nom (¢)", async () => {
    const { game, presenter } = await gameWithSector(4, SectorKind.Blockade, 440);
    game.hero.x = 4;
    game.hero.y = 7;
    game.input.move = { x: -1, y: 0 };
    await steps(game, 1);
    expect(presenter.speeches.at(-1)).toMatch(/Give me a Goddess Mask/);
  });

  it("mauvais objet : son « impossible » et rien ne change", async () => {
    const { game, presenter, sector } = await gameWithSector(4, SectorKind.Blockade, 440);
    game.hero.x = 4;
    game.hero.y = 7;
    game.addItem(441);
    game.requestPlacement(441, 3, 7);
    await steps(game, 1);
    expect(sector.solved).toBe(false);
    expect(game.inventory).toContain(441);
    expect(presenter.sounds).toContain(8);
  });

  it("voyage : la pagaie sur la barque lance la traversée vers l'autre rive", async () => {
    const { game } = await gameWithSector(2, SectorKind.Travel, 1075);
    game.hero.x = 7;
    game.hero.y = 9;
    game.addItem(1075);
    game.requestPlacement(1075, 7, 8);
    await steps(game, 3);
    expect(game.zone.id).toBe(3);
    await steps(game, 40);
    expect(game.hero.visible).toBe(true);
  });

  it("puzzle à serrure : la clé ouvre la grille et l'objet se ramasse", async () => {
    const { game, presenter, sector, story } = await gameWithSector(7, SectorKind.Puzzle, 897, 649);
    story.hotspotArguments.set(7, new Map([[1, 649]]));
    // La zone a déjà été créée par la téléportation : on y retourne avec l'argument appliqué.
    (game as unknown as { zones: Map<number, unknown> }).zones.delete(7);
    await game.debugTeleport(7, 15, 5);
    expect(game.zone.getTile(15, 4, Layer.Object)).toBe(856);
    game.addItem(897);
    game.requestPlacement(897, 15, 4);
    await steps(game, 1);
    expect(game.zone.getTile(15, 4, Layer.Object)).toBe(-1);
    expect(game.inventory).not.toContain(897);
    await steps(game, 1);
    expect(game.zone.getTile(9, 11, Layer.Object)).toBe(649);
    game.hero.x = 9;
    game.hero.y = 12;
    game.input.move = { x: 0, y: -1 };
    await steps(game, 1);
    expect(game.inventory).toContain(649);
    expect(presenter.pickups).toContain(649);
    expect(sector.solved).toBe(true);
  });

  it("objectif : ramasser le pendentif termine la mission", async () => {
    const { game, presenter, story } = await gameWithSector(57, SectorKind.Goal, 649, 100);
    story.hotspotArguments.set(59, new Map([[1, 100]]));
    await game.debugTeleport(59, 6, 3);
    for (const m of game.zone.monsters) m.enabled = false;
    // Échanger le sac de sable contre l'idole du piédestal ouvre le coffre.
    const spot = [
      [10, 1],
      [9, 0],
      [11, 0],
      [9, 1],
      [11, 1],
    ].find(([x, y]) => game.zone.isFree(x, y))!;
    game.hero.x = spot[0];
    game.hero.y = spot[1];
    game.addItem(649);
    game.requestPlacement(649, 10, 0);
    await steps(game, 2);
    expect(game.inventory).toContain(1106);
    expect(game.zone.getTile(6, 1, Layer.Object)).toBe(100);
    game.hero.x = 6;
    game.hero.y = 2;
    game.input.move = { x: 0, y: -1 };
    await steps(game, 1);
    game.input.move = { x: 0, y: 0 };
    expect(game.inventory).toContain(100);
    await steps(game, 30);
    expect(presenter.endings).toContain("win");
    expect(game.gameWon).toBe(true);
    expect(presenter.speeches.join(" ")).toMatch(/Snake Pendant/);
  });

  it("téléporteur : avec la carte, rejoint un autre téléporteur visité", async () => {
    const { game, presenter, story } = await gameWithSector(6, SectorKind.Empty);
    const town = story.sectors.findIndex((s) => s?.kind === SectorKind.Town);
    story.sectors[town + 1] = { ...emptySector(14, SectorKind.Empty), visited: true };
    // Recrée le monde pour qu'il connaisse la nouvelle case.
    const fresh = new Game(game.assets, story, presenter);
    await fresh.start(IndyIds.townZone, { x: 11, y: 5 });
    await fresh.debugTeleport(14, 1, 1);
    fresh.zone.hotspots.forEach((h) => h.type === HotspotType.Teleporter && (h.enabled = true));
    await fresh.debugTeleport(6, 8, 7);
    const pad = fresh.zone.hotspots.find((h) => h.type === HotspotType.Teleporter)!;
    pad.enabled = true;
    fresh.addItem(IndyIds.mapTile);
    for (const m of fresh.zone.monsters) m.enabled = false;
    fresh.hero.x = pad.x;
    fresh.hero.y = pad.y - 1;
    fresh.zone.setTile(pad.x, pad.y, Layer.Object, -1);
    fresh.input.move = { x: 0, y: 1 };
    await steps(fresh, 1);
    expect(presenter.teleportChoices.at(-1)).toEqual([town + 1]);
    expect(fresh.zone.id).toBe(14);
  });

  it("sauvegarde puis reprend une partie à l'identique (via JSON)", async () => {
    const { game, assets } = await gameWithSector(4, SectorKind.Blockade, 440);
    game.hero.x = 4;
    game.hero.y = 7;
    game.addItem(440);
    game.requestPlacement(440, 3, 7);
    await steps(game, 1);
    game.hurtHero(40);
    const snapshot = JSON.parse(JSON.stringify(game.snapshot())) as GameSnapshot;
    const presenter = new FakePresenter();
    const resumed = new Game(assets, storyFromSnapshot(snapshot), presenter, snapshot.settings);
    await resumed.resume(snapshot);
    expect(resumed.zone.id).toBe(4);
    expect([resumed.hero.x, resumed.hero.y]).toEqual([game.hero.x, game.hero.y]);
    expect(resumed.hero.health).toBe(game.hero.health);
    expect(resumed.inventory).toEqual(game.inventory);
    expect(resumed.weapon?.id).toBe(game.weapon?.id);
    expect(resumed.zone.getTile(4, 6, Layer.Object)).toBe(541);
    expect(resumed.sector?.solved).toBe(true);
    expect(resumed.story.hotspotArguments).toEqual(game.story.hotspotArguments);
  });

  it("un objet se ramasse même quand un script réagit au contact (fanfare de la carte)", async () => {
    const { game, presenter, story } = await gameWithSector(33, SectorKind.Find, -1, IndyIds.mapTile);
    story.hotspotArguments.set(33, new Map([[0, IndyIds.mapTile]]));
    (game as unknown as { zones: Map<number, unknown> }).zones.delete(33);
    await game.debugTeleport(33, 5, 4);
    for (const m of game.zone.monsters) m.enabled = false;
    await steps(game, 1);
    expect(game.zone.getTile(5, 3, Layer.Object)).toBe(IndyIds.mapTile);
    game.input.move = { x: 0, y: -1 };
    await steps(game, 1);
    expect(presenter.sounds).toContain(14);
    expect(game.inventory).toContain(IndyIds.mapTile);
  });
});
