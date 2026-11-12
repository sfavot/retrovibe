/**
 * Vue à distance prolongée, jouée par de vrais clics (`solution/runner.ts`) : la partie, de la cellule à la fenêtre de la boutique d'Ewan
 * (« Regarde par » `0x754C`, pièce 19), puis plusieurs minutes de vue jusqu'à la conversation du Skorl, et le clic qui ramène le joueur.
 * Au retour, la pièce 19 rattrape le temps écoulé (`Room::setRoomNumber`, 220 ticks) avec Ratpouch, suiveur, oisif dans la pièce ; graine
 * 256 : un villageois le heurte pendant ce rattrapage.
 * Dans ScummVM, un personnage heurté pendant ce rattrapage y reste figé et Ratpouch empile des actions jusqu'à l'arrêt « too many
 * actions » (c'était l'échec de la partie complète, graine 1, avant l'écart) ; le portage décompte les attentes pendant le rattrapage (écart,
 * `docs/lure/engine.md` § 10) : le joueur peut regarder aussi longtemps qu'il veut.
 */
import { describe, expect, it } from "vitest";
import { HotspotId } from "../../src/games/lure/engine/ids";
import { hasOriginalFiles, makeEngine } from "./engine/test-host";
import { Play, type Step } from "./solution/runner";
import { ZONE_CAVES_PHASES } from "./solution/zone-caves";
import { ZONE_CELL_STEPS } from "./solution/zone-cell";
import { VILLAGE_FROM_SQUARE } from "./solution/zone-village";

describe.skipIf(!hasOriginalFiles)("vue à distance prolongée avec Ratpouch oisif", () => {
  it("le retour rattrape plusieurs minutes, Ratpouch heurté pendant le rattrapage n'empile pas d'actions", () => {
    const { engine, host } = makeEngine({ seed: 256 });
    const play = new Play(engine, host);
    const caves = ZONE_CAVES_PHASES.findIndex((p) => p.name === "la conversation du Skorl et d'Ewan");
    const phases: { steps: readonly Step[]; retry?: { until: (e: typeof engine) => boolean; max: number } }[] = [
      { steps: ZONE_CELL_STEPS },
      { steps: VILLAGE_FROM_SQUARE },
      ...ZONE_CAVES_PHASES.slice(0, caves + 1),
    ];
    for (const phase of phases) {
      for (let attempt = 1; attempt <= (phase.retry?.max ?? 1); attempt++) {
        try {
          play.run(phase.steps);
        } catch (e) {
          if (!phase.retry || attempt === phase.retry.max) throw e;
        }
        if (!phase.retry || phase.retry.until(engine)) break;
      }
    }
    expect(engine.room.roomNumber).toBe(35);
    const ratpouch = engine.world.requireActiveHotspot(HotspotId.RATPOUCH);
    expect(ratpouch.roomNumber).toBe(19);
    const entered = engine.world.requireRoom(19).exitTime;
    expect(engine.room.clockMs() - entered).toBeGreaterThan(180_000);

    let catchUp = 0;
    let bumped = 0;
    let maxStack = 0;
    const tick = engine.tickHotspots.bind(engine);
    engine.tickHotspots = () => {
      tick();
      if (!engine.preloadFlag) return;
      catchUp++;
      if (ratpouch.pauseCtr > 1) bumped++;
      maxStack = Math.max(maxStack, ratpouch.currentActions.size);
    };
    play.run([{ wait: 10 }, { walk: [160, 100] }]);
    expect(engine.room.roomNumber).toBe(19);
    expect(catchUp).toBeGreaterThan(180);
    // Heurté (attente `pauseCtr` > 1), mais pas figé jusqu'au bout : l'attente se décompte.
    expect(bumped).toBeGreaterThan(0);
    expect(bumped).toBeLessThan(catchUp / 2);
    expect(maxStack).toBeLessThanOrEqual(3);
  });
});
