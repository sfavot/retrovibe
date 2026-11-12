import { describe, expect, it } from "vitest";
import { Field, HotspotId, RoomNum, TickProc } from "../../../../src/games/lure/engine/ids";
import { hasOriginalFiles, makeEngine } from "../test-host";
import { barOf, enterRoom, started } from "./helpers";

const call = (engine: ReturnType<typeof makeEngine>["engine"], index: number): void => engine.methods.call(index, 0, 0, 0);

describe.skipIf(!hasOriginalFiles)("méthodes du groupe L3", () => {
  it("aucune des cinq n'est une souche", () => {
    const { engine } = makeEngine();
    for (const index of [33, 39, 46, 54, 56]) expect(engine.methods.isStub(index)).toBe(false);
  });

  it("33 cutSack : le sac tombe à y = 138, aussi bien actif qu'inactif", () => {
    const { engine } = makeEngine();
    started(engine);
    const data = engine.world.requireHotspot(HotspotId.SACK);
    expect(data.startY).not.toBe(138);
    call(engine, 33);
    expect(data.startY).toBe(138);

    // Actif : sa position suit.
    const other = started(makeEngine().engine);
    const active = other.world.activateHotspot(HotspotId.SACK)!;
    const x = active.x;
    call(other, 33);
    expect(active.y).toBe(138);
    expect(active.x).toBe(x);
  });

  it("39 townHallClose : la porte de la mairie (0x2719, pièce 14) est marquée à fermer", () => {
    const { engine } = makeEngine();
    started(engine);
    const join = engine.world.getExitJoin(0x2719)!;
    join.blocked = 0;
    call(engine, 39);
    expect(join.blocked).toBe(1);
  });

  describe("46 checkWakeBrenda", () => {
    const setup = () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, RoomNum.DINING_HALL, 150, 80);
      engine.world.fields.set(Field.TALK_INDEX, 1);
      engine.world.fields.set(67, 0);
      // La séquence ne réveille Brenda que si c'est le joueur qui parle (`CHARACTER_HOTSPOT_ID` = joueur).
      engine.world.fields.set(Field.CHARACTER_HOTSPOT_ID, HotspotId.PLAYER);
      return engine;
    };

    it("salle à manger, sujet < 3, Brenda endormie : la séquence 0x1E15 la réveille (champ 67 = 1, sujet 3)", () => {
      const engine = setup();
      call(engine, 46);
      expect(engine.world.fields.get(67)).toBe(1);
      expect(engine.world.fields.get(Field.TALK_INDEX)).toBe(3);
    });

    it("sujet 3 ou plus : rien", () => {
      const engine = setup();
      engine.world.fields.set(Field.TALK_INDEX, 3);
      call(engine, 46);
      expect(engine.world.fields.get(67)).toBe(0);
    });

    it("Brenda déjà réveillée : rien", () => {
      const engine = setup();
      engine.world.fields.set(67, 1);
      call(engine, 46);
      expect(engine.world.fields.get(Field.TALK_INDEX)).toBe(1);
    });

    it("ailleurs que dans la salle à manger : rien", () => {
      const engine = setup();
      enterRoom(engine, 29, 100, 60);
      engine.world.fields.set(Field.TALK_INDEX, 1);
      call(engine, 46);
      expect(engine.world.fields.get(67)).toBe(0);
    });
  });

  it("54 setVillageSkorlTickProc : Wayne prend le gestionnaire du geôlier (9) ; erreur s'il n'est pas actif", () => {
    const { engine } = makeEngine();
    started(engine);
    expect(() => call(engine, 54)).toThrow();
    const wayne = engine.world.activateHotspot(HotspotId.WAYNE)!;
    call(engine, 54);
    expect(wayne.tickProcId).toBe(TickProc.JAILOR);
    expect(wayne.res.tickProcId).toBe(TickProc.JAILOR);
  });

  describe("56 barmanServe", () => {
    it("le joueur est client : ses drapeaux gagnent 5 (servir) ; les autres clients ne bougent pas", () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, 29, 100, 60);
      const entry = barOf(engine).getDetails(29);
      entry.customers[0] = { hotspotId: HotspotId.GWEN, serveFlags: 0x82 };
      entry.customers[2] = { hotspotId: HotspotId.PLAYER, serveFlags: 0 };
      call(engine, 56);
      expect(entry.customers[2]!.serveFlags).toBe(5);
      expect(entry.customers[0]!.serveFlags).toBe(0x82);
    });

    it("le joueur n'est pas client : aucun effet ; le bar est celui de la pièce du joueur", () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, 32, 100, 60);
      barOf(engine).getDetails(29).customers[0] = { hotspotId: HotspotId.PLAYER, serveFlags: 0 };
      call(engine, 56);
      expect(barOf(engine).getDetails(29).customers[0]!.serveFlags).toBe(0);
      expect(barOf(engine).getDetails(32).customers.every((c) => c.serveFlags === 0)).toBe(true);
    });

    it("dans une pièce sans bar : erreur, comme ScummVM", () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, 30, 100, 60);
      expect(() => call(engine, 56)).toThrow();
    });
  });
});
