import { describe, expect, it } from "vitest";
import { HANDLER_CATALOG } from "../../../../src/games/lure/engine/handlers/catalog";
import { Field, HotspotFlag, HotspotId, TickProc } from "../../../../src/games/lure/engine/ids";
import { CONVERSE_COUNTDOWN_SIZE } from "../../../../src/games/lure/engine/ids";
import { enter, freeGoewinAndWait, hasOriginalFiles, start } from "./helpers";

const CASTLE_SKORL_GUARD = 0x437;
const DOORS = { sw: 0x272a, se: 0x272c, def: 0x272e };

describe.skipIf(!hasOriginalFiles)("gestionnaires du groupe L4", () => {
  it("les huit fonctions du groupe L4 (douze numéros) ne sont plus des souches", () => {
    const { engine } = start();
    const l4 = HANDLER_CATALOG.filter((h) => h.group === "L4");
    expect(l4.map((h) => h.name)).toEqual([
      "goewinCaptiveAnimHandler",
      "catrionaAnimHandler",
      "morkusAnimHandler",
      "gargoyleAnimHandler",
      "skullAnimHandler",
      "dragonFireAnimHandler",
      "castleSkorlAnimHandler",
      "rackSerfAnimHandler",
    ]);
    expect(l4.flatMap((h) => h.ids)).toEqual([19, 21, 22, 26, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    for (const h of l4) expect(engine.handlers.stubs, h.name).not.toContain(h.name);
  });

  describe("19 goewinCaptiveAnimHandler", () => {
    it("tant que actionCtr vaut 0, Goewin captive ne joue rien (ni script, ni image)", () => {
      const { engine, driver } = start();
      engine.world.activateHotspot(HotspotId.GOEWIN);
      const goewin = engine.world.requireActiveHotspot(HotspotId.GOEWIN);
      expect(goewin.tickProcId).toBe(19);
      const script = goewin.hotspotScript;
      driver.ticks(30);
      expect(goewin.tickProcId).toBe(19);
      expect(goewin.hotspotScript).toBe(script);
      expect(goewin.numFrames).toBe(5);
      expect(goewin.frameNumber).toBe(0);
    });

    it("après freeGoewin (actionCtr 1), le script joue ; à sa fin elle change d'animation et prend le gestionnaire standard", () => {
      const { engine } = start();
      const ticks = freeGoewinAndWait(engine);
      const goewin = engine.world.requireActiveHotspot(HotspotId.GOEWIN);
      expect(ticks).toBeGreaterThan(0);
      expect(goewin.tickProcId).toBe(TickProc.STANDARD_CHARACTER);
      expect(goewin.actionCtr).toBe(0);
      // L'animation captive n'a que 5 images : celle d'après a les images des quatre directions (l'image 22 de « face » existe).
      expect(goewin.numFrames).toBeGreaterThan(22);
    });
  });

  describe("21 catrionaAnimHandler", () => {
    function catriona() {
      const s = start();
      enter(s.engine, 28);
      return { ...s, h: s.engine.world.requireActiveHotspot(0x41f) };
    }

    it("attend frameCtr images, puis exécute son script et attend 5 images (actionCtr 0) ou actionCtr images", () => {
      const { engine, h } = catriona();
      expect(h.tickProcId).toBe(21);
      h.frameCtr = 3;
      const script = h.hotspotScript;
      engine.tick();
      expect(h.frameCtr).toBe(2);
      expect(h.hotspotScript).toBe(script);
      h.frameCtr = 0;
      h.actionCtr = 0;
      engine.tick();
      expect(h.frameCtr).toBe(5);
      expect(h.hotspotScript).not.toBe(script);
      h.frameCtr = 0;
      h.actionCtr = 9;
      engine.tick();
      expect(h.frameCtr).toBe(9);
    });

    it("compte sa bulle à rebours (handleTalkDialog)", () => {
      const { engine, h } = catriona();
      h.res.talkCountdown = 5;
      engine.tick();
      expect(h.res.talkCountdown).toBe(4);
      expect(CONVERSE_COUNTDOWN_SIZE).toBe(40);
    });
  });

  describe("22 morkusAnimHandler", () => {
    it("à la fin de son script : le suivant est 0x54 ou 0 (au hasard), puis attente de 20 à 83 images (20 + 0..63) ; sa bulle est comptée", () => {
      const outcomes = new Set<number>();
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { engine } = start({ seed });
        enter(engine, 32);
        const h = engine.world.requireActiveHotspot(0x421);
        expect(h.tickProcId).toBe(22);
        let last = h.frameCtr;
        let changes = 0;
        for (let i = 0; i < 1500 && changes < 3; i++) {
          engine.tick();
          // Un compte à rebours de 20 images ou plus n'apparaît qu'à la fin d'un script (ses propres attentes sont plus courtes).
          if (h.frameCtr >= 20 && last < 20) {
            changes++;
            expect([0x54, 0]).toContain(h.hotspotScript);
            expect(h.frameCtr).toBeLessThanOrEqual(83);
            outcomes.add(h.hotspotScript);
          }
          last = h.frameCtr;
        }
        expect(changes, `graine ${seed}`).toBeGreaterThan(0);
      }
      expect([...outcomes].sort()).toEqual([0, 0x54]);
    });

    it("compte sa bulle à rebours et attend frameCtr avant le script", () => {
      const { engine } = start();
      enter(engine, 32);
      const h = engine.world.requireActiveHotspot(0x421);
      h.frameCtr = 5;
      h.res.talkCountdown = 3;
      const script = h.hotspotScript;
      engine.tick();
      expect([h.frameCtr, h.res.talkCountdown, h.hotspotScript]).toEqual([4, 2, script]);
    });
  });

  it("26 gargoyleAnimHandler : seulement la bulle (les deux gargouilles de la pièce 15)", () => {
    const { engine } = start();
    enter(engine, 15);
    for (const id of [0x42c, 0x42d]) {
      const h = engine.world.requireActiveHotspot(id);
      expect(h.tickProcId).toBe(26);
      const frame = h.frameNumber;
      h.res.talkCountdown = 6;
      engine.tick();
      expect(h.res.talkCountdown).toBe(5);
      expect(h.frameNumber).toBe(frame);
    }
  });

  describe("28 à 33 skullAnimHandler", () => {
    // [pièce, crâne, gestionnaire, porte, image quand la porte est bloquée, image quand elle est ouverte]
    const SKULLS: Array<[number, number, number, number, number, number]> = [
      [38, 0x42e, 28, DOORS.sw, 0, 1],
      [38, 0x42f, 29, DOORS.se, 0, 1],
      [39, 0x430, 31, DOORS.def, 1, 0],
      [39, 0x431, 30, DOORS.sw, 1, 0],
      [40, 0x432, 33, DOORS.sw, 1, 0],
      [40, 0x433, 32, DOORS.se, 1, 0],
    ];
    for (const [room, id, tick, door, blockedFrame, openFrame] of SKULLS) {
      it(`crâne ${id.toString(16)} (gestionnaire ${tick}) : image ${blockedFrame} porte ${door.toString(16)} bloquée, ${openFrame} ouverte`, () => {
        const { engine } = start();
        // Goewin est libérée avant d'arriver dans les grottes (la séquence d'entrée de la pièce 38 la fait suivre le joueur).
        freeGoewinAndWait(engine);
        enter(engine, room);
        const h = engine.world.requireActiveHotspot(id);
        expect(h.tickProcId).toBe(tick);
        const join = engine.world.getExitJoin(door)!;
        for (const [blocked, expected] of [
          [1, blockedFrame],
          [0, openFrame],
          [1, blockedFrame],
        ] as const) {
          join.blocked = blocked;
          engine.tick();
          expect(h.frameNumber).toBe(expected);
        }
      });
    }
  });

  it("34 dragonFireAnimHandler : le feu joue son script ; à sa fin le joueur est mort (GS_RESTORE_RESTART)", () => {
    const { engine, host } = start();
    enter(engine, 41);
    const asked: number[] = [];
    (host as unknown as { restartOrRestore: () => boolean }).restartOrRestore = () => {
      asked.push(1);
      return false;
    };
    const fire = engine.world.addHotspot(0x435);
    expect(fire.tickProcId).toBe(34);
    let ticks = 0;
    while (asked.length === 0 && ticks < 2000) {
      engine.tick();
      ticks++;
    }
    expect(asked).toHaveLength(1);
    expect(ticks).toBeGreaterThan(5);
    // Le restaurateur refuse (false) : le jeu continue sans état particulier.
    expect(engine.gameState).toBe(0);
  });

  describe("35 castleSkorlAnimHandler", () => {
    it("à la fin de son script, le Skorl 437 s'efface (pièce 0xFFFF, calque 255, hors des menus) et 3F3 apparaît en pièce 45", () => {
      const { engine } = start();
      enter(engine, 45);
      const guard = engine.world.requireActiveHotspot(CASTLE_SKORL_GUARD);
      expect(guard.tickProcId).toBe(35);
      expect(engine.world.getActiveHotspot(HotspotId.CASTLE_SKORL)).toBeNull();
      // Son script d'attente boucle ; c'est le script 3 (`0x1DFF`, emploi du temps 11) qui le termine.
      guard.setHotspotScript(engine.world.getHotspotScript(3));
      let ticks = 0;
      while (engine.world.getActiveHotspot(CASTLE_SKORL_GUARD) && ticks < 3000) {
        engine.tick();
        ticks++;
      }
      expect(ticks).toBeGreaterThan(0);
      const data = engine.world.requireHotspot(CASTLE_SKORL_GUARD);
      expect(data.roomNumber).toBe(0xffff);
      expect(data.layer).toBe(255);
      expect(data.talkCountdown).toBe(0);
      expect(data.flags & HotspotFlag.MENU_EXCLUSION).toBe(HotspotFlag.MENU_EXCLUSION);
      const next = engine.world.requireActiveHotspot(HotspotId.CASTLE_SKORL);
      expect(next.roomNumber).toBe(45);
      expect(next.tickProcId).toBe(10);
    });

    it("compte la bulle à rebours et attend frameCtr", () => {
      const { engine } = start();
      enter(engine, 45);
      const guard = engine.world.requireActiveHotspot(CASTLE_SKORL_GUARD);
      guard.frameCtr = 4;
      guard.res.talkCountdown = 7;
      engine.tick();
      expect([guard.frameCtr, guard.res.talkCountdown]).toEqual([3, 6]);
    });
  });

  describe("36 rackSerfAnimHandler", () => {
    function serf() {
      const s = start();
      enter(s.engine, 4);
      return { ...s, h: s.engine.world.requireActiveHotspot(HotspotId.RACK_SERF) };
    }

    it("actionCtr 0 : le serf ne fait rien ; 1 : script 0x35C (actionCtr 2), puis retour à 0 à sa fin", () => {
      const { engine, h } = serf();
      expect(h.tickProcId).toBe(36);
      h.actionCtr = 0;
      engine.tick();
      expect(h.hotspotScript).not.toBe(0x35c);
      h.actionCtr = 1;
      h.frameCtr = 0;
      engine.tick();
      expect(h.hotspotScript).toBe(0x35c);
      expect(h.actionCtr).toBe(2);
      let ticks = 0;
      while (h.actionCtr === 2 && ticks < 2000) {
        engine.tick();
        ticks++;
      }
      expect(h.actionCtr).toBe(0);
      expect(engine.world.getActiveHotspot(HotspotId.RACK_SERF)).toBe(h);
    });

    it("actionCtr 3 : s'échappe (script 0x384, calque 2) ; à la fin il disparaît et Ratpouch arrive en pièce 4 et parle au joueur (0x9C)", () => {
      const { engine, h } = serf();
      expect(engine.world.getActiveHotspot(HotspotId.RATPOUCH)).toBeNull();
      h.actionCtr = 3;
      h.frameCtr = 0;
      engine.tick();
      // Le cas 3 enchaîne sur le cas 4 : le script a déjà avancé d'une instruction.
      expect(h.hotspotScript).toBeGreaterThanOrEqual(0x384);
      expect(h.hotspotScript).toBeLessThan(0x384 + 0x40);
      expect(h.actionCtr).toBe(4);
      expect(h.layer).toBe(2);
      let ticks = 0;
      while (engine.world.getActiveHotspot(HotspotId.RACK_SERF) && ticks < 2000) {
        engine.tick();
        ticks++;
      }
      expect(engine.world.getActiveHotspot(HotspotId.RACK_SERF)).toBeNull();
      expect(engine.world.requireHotspot(HotspotId.RACK_SERF).layer).toBe(255);
      const ratpouch = engine.world.requireActiveHotspot(HotspotId.RATPOUCH);
      expect(ratpouch.roomNumber).toBe(4);
      expect(ratpouch.res.talkMessageId).toBe(0x9c);
      expect(ratpouch.res.talkDestCharacterId).toBe(HotspotId.PLAYER);
    });

    it("compte la bulle à rebours et attend frameCtr", () => {
      const { engine, h } = serf();
      h.frameCtr = 3;
      h.res.talkCountdown = 9;
      h.actionCtr = 1;
      engine.tick();
      expect([h.frameCtr, h.res.talkCountdown, h.actionCtr]).toEqual([2, 8, 1]);
      expect(engine.world.fields.get(Field.ROOM_NUMBER)).toBe(4);
    });
  });
});
