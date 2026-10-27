import { describe, expect, it } from "vitest";
import type { BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { NpcKit } from "../../src/games/armaeth/game/npc-kit";
import { hasOriginalFiles } from "./helpers";
import { Player } from "./player";

/**
 * `228e:0000` pour les personnages (`NpcKit.leaveRoom` -> `ArmaethEngine.walkToExit`, décompilé) : côté permuté de la scène, barrage
 * évalué (`1414:0006` mode 0), sortie immédiate hors salle chargée seulement par le haut et le bas.
 */
describe.skipIf(!hasOriginalFiles)("228e:0000 : un personnage quitte sa salle", () => {
  function inLair(doorEgo: number): { p: Player; ctx: BehaviorContext; prytwen: GameObject } {
    const p = new Player();
    p.skipIntro();
    p.engine.sendToRoom(105, true);
    p.run(60);
    p.drain(5);
    const prytwen = p.state.findByNum(101)!;
    p.state.moveToRoom(prytwen, p.state.loadedRoom!);
    Object.assign(prytwen, { x: 60, p: 100, ego: 0 });
    p.engine.place(prytwen, 1);
    p.state.findByNum(111)!.ego = doorEgo;
    return { p, ctx: (p.engine as unknown as { services: BehaviorContext }).services, prytwen };
  }

  it("Prytwen part vers le fond de son antre, où est la sortie vers la salle 104 (emplacement 2, côté permuté), si la porte 111 est ouverte", () => {
    const { ctx, prytwen } = inLair(2);
    expect(new NpcKit().leaveRoom(ctx, prytwen)).toBe(true);
    expect(prytwen.path.defined).toBe(true);
    expect(prytwen.path.target!.p).toBeLessThan(0); // le fond (P -1000), pas l'avant (P +1000) de l'emplacement 2 non permuté
  });

  it("porte 111 fermée à clef et Prytwen sans sa clef : le barrage 103 lui ferme la sortie (`DX = 7`)", () => {
    const { p, ctx, prytwen } = inLair(0);
    for (const item of [...prytwen.contents]) p.state.moveToRoom(item, p.state.roomById(1)!);
    expect(new NpcKit().leaveRoom(ctx, prytwen)).toBe(false);
    expect(prytwen.path.defined).toBe(false);
  });
});
