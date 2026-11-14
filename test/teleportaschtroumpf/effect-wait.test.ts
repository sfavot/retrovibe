import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { EffectWait } from "../../src/games/teleportaschtroumpf/engine/effect-wait";
import type { SceneContext } from "../../src/games/teleportaschtroumpf/engine/scene";
import { MagicianScene, ZONES } from "../../src/games/teleportaschtroumpf/scenes/minigames/s41-magician";
import { MapScene } from "../../src/games/teleportaschtroumpf/scenes/s02-map";
import { TestHost } from "./engine-test-host";
import { advance } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";
import { launchMinigame, type LaunchedMinigame } from "./minigames/harness";

/**
 * Attente de fin de bruitage des boucles de saisie de l'original (`while (348d:0b42(1, 0)) 1764:018a`, avant le test de sortie) :
 * le menu a ses tests dans `menu.test.ts` ; ici l'utilitaire partagé, la carte S02 (`1a3c:0bee`) et le choix du magicien S41
 * (`2143:0659`). Le bip de navigation `s07a001b` dure 0,26 s.
 */

describe("EffectWait (pur)", () => {
  const busy = { effect: false };
  const ctx = {
    voice: {
      get effectPlaying() {
        return busy.effect;
      },
    },
  } as unknown as SceneContext;

  it("sans bruitage, rend le résultat de l'itération tout de suite", () => {
    busy.effect = false;
    expect(new EffectWait<number>().step(ctx, () => 3)).toBe(3);
  });

  it("retient le résultat tant que le bruitage sonne, sans relire, puis le rend une seule fois", () => {
    const wait = new EffectWait<number>();
    let reads = 0;
    const read = () => (++reads, 0);
    busy.effect = true;
    expect(wait.step(ctx, read)).toBeNull();
    expect(wait.step(ctx, read)).toBeNull();
    expect(reads).toBe(1);
    busy.effect = false;
    expect(wait.step(ctx, read)).toBe(0);
    expect(wait.step(ctx, read)).toBe(0); // itération suivante : lecture normale
    expect(reads).toBe(2);
  });

  it("une itération sans résultat retenue ne rend rien, et reset abandonne l'attente", () => {
    const wait = new EffectWait<number>();
    busy.effect = true;
    wait.step(ctx, () => 5);
    wait.reset();
    busy.effect = false;
    expect(wait.step(ctx, () => null)).toBeNull();
  });
});

describe.skipIf(!hasOriginalFiles)("carte S02 : attente de fin de bruitage (`1a3c:0bee`)", () => {
  async function launchMap(results: number[]) {
    const host = new TestHost();
    host.audio.enabled = true;
    const engine = new Engine(host, { seed: 7 });
    const map = new MapScene({ mode: "free" }, (_c, k) => results.push(k));
    await engine.start(map);
    await advance(engine, host, 600);
    while (engine.loading || engine.ctx.fade.active) await advance(engine, host, 50);
    return { host, engine, map };
  }

  it("la sortie décidée pendant le bip du changement de lieu est retenue, puis rendue une seule fois", async () => {
    const results: number[] = [];
    const { host, engine, map } = await launchMap(results);
    // Haut et Espace dans la même itération : le lieu change (bip), la sortie attend la fin du bip.
    host.input.keyDown("ArrowUp");
    host.input.keyDown("Space");
    await advance(engine, host, 100);
    host.input.keyUp("ArrowUp");
    host.input.keyUp("Space");
    expect(map.selection).toBe(2);
    expect(engine.ctx.voice.effectPlaying).toBe(true);
    expect(results).toEqual([]);
    await advance(engine, host, 400);
    expect(results).toEqual([2]);
    await advance(engine, host, 500);
    expect(results).toEqual([2]);
  }, 60_000);

  it("les touches appuyées pendant le bip sont perdues, la sélection ne bouge qu'ensuite", async () => {
    const results: number[] = [];
    const { host, engine, map } = await launchMap(results);
    host.input.keyDown("ArrowUp");
    await advance(engine, host, 60);
    host.input.keyUp("ArrowUp");
    expect(map.selection).toBe(2);
    expect(engine.ctx.voice.effectPlaying).toBe(true);
    host.input.keyDown("ArrowUp");
    await advance(engine, host, 60);
    host.input.keyUp("ArrowUp");
    expect(map.selection).toBe(2);
    await advance(engine, host, 400);
    host.input.keyDown("ArrowUp");
    await advance(engine, host, 60);
    host.input.keyUp("ArrowUp");
    expect(map.selection).toBe(3);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S41 : attente de fin de bruitage du choix (`2143:0659`)", () => {
  async function reachChoice(run: LaunchedMinigame, scene: MagicianScene): Promise<void> {
    for (let i = 0; scene.stage !== "choice"; i++) {
      if (i > 4000) throw new Error(`choix non atteint (phase ${scene.stage})`);
      if (scene.stage === "video") await run.tap("Escape", 60);
      else if (scene.stage === "question") await run.tap("Space", 80);
      else await run.run(100);
    }
  }

  it("un clic dans la zone qu'on vient de toucher est retenu pendant le bip d'entrée de zone, puis rendu une seule fois", async () => {
    const run = await launchMinigame(41, {
      seed: 5,
      audio: true,
      setup: (game) => {
        const p = game.state.players[0];
        p.points = 6;
        p.ingredients = 0;
        p.ingredientCount = 0;
      },
    });
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    await run.run(600); // le bip de la question a fini
    const zone = ZONES.find((z) => z.choice === 4)!;
    run.host.input.mouseMove((zone.x1 + zone.x2) >> 1, (zone.y1 + zone.y2) >> 1);
    run.host.input.mouseDown(0);
    await run.run(60);
    run.host.input.mouseUp(0);
    expect(scene.hoveredZone).toBe(4);
    expect(run.ctx.voice.effectPlaying).toBe(true);
    expect(scene.chosen).toBeNull();
    expect(scene.stage).toBe("choice");
    await run.run(400);
    expect(scene.chosen).toBe(4);
    expect(scene.stage).not.toBe("choice");
    // Rendu une seule fois : le choix suit son cours (voix d'accroche), sans revenir à l'écran de choix.
    await run.run(100);
    expect(scene.chosen).toBe(4);
    expect(scene.stage).not.toBe("choice");
  }, 120_000);
});
