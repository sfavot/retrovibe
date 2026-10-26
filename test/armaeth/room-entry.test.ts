import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "./helpers";
import { Player } from "./player";

/**
 * Effets d'entrée dans la salle de garde 305 (`147f:000a`, `147f:016a..025a`, `docs/armaeth/characters.md` § 7.3) : à chaque entrée du
 * héros, et avec une chance sur 2 pour chacune des deux places, un soldat `Ego 0` s'endort : `Ego 8` (écroulé dans son assiette,
 * `Fig 2`, `(X 0x44, Y 0x50, P 0x48)`, réveil après 120 tics, événement 4) puis `Ego 7` (dort sur sa chaise, `Fig 1`,
 * `(0x24, 0x50, 0x3A)`, 60 tics, événement 3).
 */
describe.skipIf(!hasOriginalFiles)("salle de garde 305 : soldats endormis à l'entrée du héros", () => {
  function enter(seed: number) {
    const p = new Player({ seed });
    p.skipIntro();
    p.engine.sendToRoom(305, true);
    for (let i = 0; i < 60 && p.state.loadedRoom?.id !== 305; i++) {
      p.run(2);
      p.drain(3);
    }
    expect(p.state.loadedRoom?.id).toBe(305);
    const soldiers = p.state.objects.filter((o) => o.num === 301);
    return { p, soldiers };
  }

  it("les places endormies sont celles de l'original, avec le réveil différé armé ; les gardes ne bougent pas d'état", () => {
    const seen = { none: 0, chair: 0, plate: 0, both: 0 };
    for (let seed = 1; seed <= 24; seed++) {
      const { p, soldiers } = enter(seed);
      const plate = soldiers.filter((o) => o.ego === 8);
      const chair = soldiers.filter((o) => o.ego === 7);
      expect(plate.length).toBeLessThanOrEqual(1);
      expect(chair.length).toBeLessThanOrEqual(1);
      const armed = (o: (typeof soldiers)[number], event: number) => p.state.events.entries.some((e) => e.num === 301 && e.serial === o.serial && e.event === event && e.counter > 0);
      for (const o of plate) {
        expect([o.x, o.y, o.p, o.fig]).toEqual([0x44, 0x50, 0x48, 2]);
        expect(armed(o, 4)).toBe(true);
      }
      for (const o of chair) {
        expect([o.x, o.y, o.p, o.fig]).toEqual([0x24, 0x50, 0x3a, 1]);
        expect(armed(o, 3)).toBe(true);
      }
      // seuls les soldats `Ego 0` s'endorment : ni le garde du cellier (série 80) ni celui du passage nord (81)
      expect(plate.concat(chair).map((o) => o.serial).every((serial) => serial === 58 || serial === 82)).toBe(true);
      if (plate.length && chair.length) seen.both++;
      else if (plate.length) seen.plate++;
      else if (chair.length) seen.chair++;
      else seen.none++;
    }
    // chaque issue (1/4 chacune) se produit sur 24 graines
    expect(seen.none).toBeGreaterThan(0);
    expect(seen.plate).toBeGreaterThan(0);
    expect(seen.chair).toBeGreaterThan(0);
    expect(seen.both).toBeGreaterThan(0);
  });

  it("le soldat endormi se réveille à l'échéance (`2a44:12fc`, événements 3 et 4)", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const { p, soldiers } = enter(seed);
      const sleeper = soldiers.find((o) => o.ego === 7);
      if (!sleeper) continue;
      // 60 tics de monde = 420 images ; on attend le double (les fenêtres de message qui s'ouvrent arrêtent le monde : on les ferme)
      for (let i = 0; i < 90 && sleeper.ego === 7; i++) {
        p.run(10);
        p.drain(2);
      }
      expect(sleeper.ego).not.toBe(7);
      return;
    }
    throw new Error("aucune graine n'endort un soldat sur la chaise");
  });
});
