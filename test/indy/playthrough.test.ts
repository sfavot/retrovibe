import { describe, expect, it } from "vitest";
import { indyVariant } from "../../src/games/indy/variant";
import { HotspotType } from "../../src/engine/desktop-adventures/data/types";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { IndyIds } from "../../src/games/indy/ids";
import { Game } from "../../src/engine/desktop-adventures/game";
import { generateStory } from "../../src/games/indy/generation/generator";
import { solve } from "../../src/games/indy/generation/solver";
import { SectorKind, WorldSize } from "../../src/engine/desktop-adventures/world";
import { DesktopBot, drive, silentPresenter } from "../support/desktop-bot";
import { hasOriginalFiles, loadGameData } from "./helpers";

/**
 * Robot joueur (test/support/desktop-bot.ts) : suit la solution du solveur en jouant pour de vrai (entrées clavier
 * simulées, un tick à la fois). Il ne sait pas résoudre les énigmes internes des zones (labyrinthes,
 * interrupteurs…) : le test mesure jusqu'où il va et signale les blocages.
 */

/** Règles d'Indy pour résoudre un secteur : objet requis sur le PNJ ou la serrure, puis objet à trouver. */
class IndyBot extends DesktopBot {
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
      // Hasard du jeu (monstres, dés des scripts) tiré de la graine : parties reproductibles.
      const random = Math.random;
      let state = seed * 7919;
      Math.random = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32);
      const game = new Game(indyVariant, assets, story, silentPresenter, { difficulty: 1 });
      Math.random = random;
      const bot = new IndyBot(game);
      await drive(game, game.start(IndyIds.townZone, { x: 11, y: 5 }));
      // Le robot ne fouille pas la maison de la ville : on lui remet le fouet qu'il y trouverait.
      game.addItem(IndyIds.whipTile);
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
