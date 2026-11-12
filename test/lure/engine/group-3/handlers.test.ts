import { describe, expect, it } from "vitest";
import type { LureEngine } from "../../../../src/games/lure/engine/game";
import type { Hotspot } from "../../../../src/games/lure/engine/hotspot";
import { CharacterMode, Field, HotspotId, TickProc } from "../../../../src/games/lure/engine/ids";
import { GROUP_1_METHODS } from "../../../../src/games/lure/engine/methods/group-1/index";
import { GROUP_3_METHODS } from "../../../../src/games/lure/engine/methods/group-3/index";
import { hasOriginalFiles, makeEngine } from "../test-host";
import { barOf, enterRoom, stand, started } from "./helpers";

const run = (engine: LureEngine, name: string, h: Hotspot): void => engine.handlers.call(name, h);
const SID = HotspotId.SID;
/** Pied d'un client au comptoir de Sid (au-dessus de 128) et loin du comptoir. */
const AT_BAR = 100;
const AWAY = 150;

describe.skipIf(!hasOriginalFiles)("gestionnaires du groupe L3", () => {
  it("aucun des cinq n'est une souche", () => {
    const { engine } = makeEngine();
    for (const name of ["teaAnimHandler", "grubAnimHandler", "barmanAnimHandler", "skorlAnimHandler", "goewinShopAnimHandler"]) {
      expect(engine.handlers.stubs).not.toContain(name);
    }
  });

  describe("18 teaAnimHandler", () => {
    it("attend frameCtr images, puis joue son script ; à la fin : script « fini » (0xB82) et champ 27 à 1", () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, 30, 100, 60);
      const tea = engine.world.activateHotspot(0x423)!;
      expect(tea.tickProcId).toBe(18);
      tea.frameCtr = 3;
      run(engine, "teaAnimHandler", tea);
      expect(tea.frameCtr).toBe(2);
      tea.frameCtr = 0;
      // Le script du thé boucle sur une image (il n'a pas de fin) ; la séquence qui sert le thé le remplace par un script qui finit
      // (rang 5 de `0x3F0E`, 6 instructions, `UNLOAD`) : c'est sa fin que le gestionnaire signale.
      tea.setHotspotScript(engine.world.getHotspotScript(5));
      engine.world.fields.set(27, 0);
      let ticks = 0;
      while (engine.world.fields.get(27) === 0 && ticks++ < 3000) run(engine, "teaAnimHandler", tea);
      expect(engine.world.fields.get(27)).toBe(1);
      expect(tea.hotspotScript).toBe(0xb82);
    });
  });

  describe("23 grubAnimHandler", () => {
    const setup = () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, 12, 100, 60);
      const grub = engine.world.activateHotspot(0x422)!;
      const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
      return { engine, grub, player };
    };

    it("tourne la tête vers le joueur : image 0 (x < 72), 1 (x < 172), 2 ; actionCtr la suit", () => {
      const { engine, grub, player } = setup();
      for (const [x, frame] of [[40, 0], [71, 0], [72, 1], [171, 1], [172, 2], [250, 2]] as const) {
        player.setPosition(x, 100);
        run(engine, "grubAnimHandler", grub);
        expect(grub.frameNumber).toBe(frame);
        expect(grub.actionCtr).toBe(frame);
      }
    });

    it("le joueur derrière Grub (y < 79) : Ratpouch, s'il est dans la pièce, est regardé à sa place", () => {
      const { engine, grub, player } = setup();
      player.setPosition(40, 60);
      const ratpouch = stand(engine, HotspotId.RATPOUCH, 12, 220, 120);
      ratpouch.setPosition(220, 100);
      run(engine, "grubAnimHandler", grub);
      expect(grub.frameNumber).toBe(2);
      // Ratpouch ailleurs : c'est le joueur.
      ratpouch.roomNumber = 10;
      run(engine, "grubAnimHandler", grub);
      expect(grub.frameNumber).toBe(0);
    });
  });

  describe("25 skorlAnimHandler", () => {
    it("l'image est actionCtr", () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, 31, 100, 60);
      const skorl = engine.world.activateHotspot(0x426)!;
      expect(skorl.tickProcId).toBe(25);
      expect(skorl.numFrames).toBeGreaterThan(1);
      for (const frame of [0, 1]) {
        skorl.actionCtr = frame;
        run(engine, "skorlAnimHandler", skorl);
        expect(skorl.frameNumber).toBe(frame);
      }
    });
  });

  describe("27 goewinShopAnimHandler", () => {
    const setup = () => {
      const spy: number[] = [];
      const { engine } = makeEngine({ methodGroups: [GROUP_1_METHODS, GROUP_3_METHODS, { 60: () => void spy.push(1) }] });
      started(engine);
      enterRoom(engine, 31, 100, 60);
      const goewin = engine.world.activateHotspot(HotspotId.GOEWIN)!;
      goewin.setTickProc(TickProc.GOEWIN_SHOP);
      goewin.frameCtr = 0;
      return { engine, goewin, spy };
    };

    it("attend le joueur : plus d'interlocuteur d'action, mode « attend l'interaction » ; frameCtr décompté de 2", () => {
      const { engine, goewin } = setup();
      goewin.res.actionHotspotId = 0x1234;
      goewin.frameCtr = 5;
      run(engine, "goewinShopAnimHandler", goewin);
      expect(goewin.res.actionHotspotId).toBe(0);
      expect(goewin.characterMode).toBe(CharacterMode.WAIT_FOR_INTERACT);
      expect(goewin.frameCtr).toBe(3);
    });

    it("délai écoulé : normalGoewin (méthode 60), sauf sujets 12 à 14 ou joueur dans la boutique (pièce 34) : 1500", () => {
      const { engine, goewin, spy } = setup();
      const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);

      goewin.delayCtr = 1;
      goewin.frameCtr = 0;
      engine.world.fields.set(Field.TALK_INDEX, 5);
      run(engine, "goewinShopAnimHandler", goewin);
      expect(spy).toHaveLength(1);

      for (const talk of [12, 13, 14]) {
        goewin.delayCtr = 1;
        goewin.frameCtr = 0;
        engine.world.fields.set(Field.TALK_INDEX, talk);
        run(engine, "goewinShopAnimHandler", goewin);
        expect(goewin.delayCtr).toBe(1500);
      }
      expect(spy).toHaveLength(1);

      engine.world.fields.set(Field.TALK_INDEX, 5);
      player.roomNumber = 34;
      goewin.delayCtr = 1;
      goewin.frameCtr = 0;
      run(engine, "goewinShopAnimHandler", goewin);
      expect(goewin.delayCtr).toBe(1500);
      expect(spy).toHaveLength(1);
    });
  });

  describe("24 barmanAnimHandler", () => {
    const setup = (id: number = SID, room = 29) => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, room, 200, 60);
      const barman = engine.world.requireActiveHotspot(id);
      barman.frameCtr = 0;
      barman.delayCtr = 0;
      barman.actionCtr = 12;
      return { engine, barman, entry: barOf(engine).getDetails(room) };
    };

    it("délai en cours : décompté, rien d'autre", () => {
      const { engine, barman } = setup();
      barman.delayCtr = 3;
      run(engine, "barmanAnimHandler", barman);
      expect(barman.delayCtr).toBe(2);
      expect(barman.frameCtr).toBe(0);
    });

    it("sans client : liste vidée, puis action au hasard : flâner (0x83 : en marche), polir (0x42 : commencé) ou attendre (s'arrête aussitôt)", () => {
      const { engine, barman, entry } = setup();
      entry.customers[2] = { hotspotId: 0x500, serveFlags: 0x01 };
      const seen = new Set<number>();
      for (let i = 0; i < 60; i++) {
        barman.frameCtr = 0;
        run(engine, "barmanAnimHandler", barman);
        seen.add(barman.frameCtr);
        expect(entry.customers.every((c) => c.hotspotId === 0 && c.serveFlags === 0)).toBe(true);
      }
      expect([...seen].sort((a, b) => a - b)).toEqual([0, 0x42, 0x83]);
    });

    it("un client attend (0x80) : le barman marche vers son x (2 pixels par tick, images de marche à gauche 6 à 11), puis s'arrête (image 12)", () => {
      const { engine, barman, entry } = setup();
      const client = stand(engine, HotspotId.GWEN, 29, 100, AT_BAR);
      entry.customers[1] = { hotspotId: HotspotId.GWEN, serveFlags: 0x82 };
      barman.setPosition(140, barman.y);
      run(engine, "barmanAnimHandler", barman);
      expect(entry.currentCustomer).toBe(1);
      expect(entry.customers[1]!.serveFlags).toBe(0);
      expect(barman.frameCtr).toBe(0x80);
      expect(barman.supportValue).toBe(client.x);

      const xs: number[] = [barman.x];
      const frames = new Set<number>();
      for (let i = 0; i < 200 && (barman.frameCtr & 0x80) !== 0; i++) {
        run(engine, "barmanAnimHandler", barman);
        xs.push(barman.x);
        if ((barman.frameCtr & 0x80) !== 0) frames.add(barman.frameNumber);
      }
      expect(barman.x).toBeGreaterThanOrEqual(client.x - 1);
      expect(barman.x).toBeLessThanOrEqual(client.x + 1);
      expect(xs.every((x, i) => i === 0 || xs[i - 1]! - x === 2 || x === xs[i - 1])).toBe(true);
      expect([...frames].every((f) => f >= 6 && f <= 11)).toBe(true);
      expect(barman.frameCtr).toBe(0);
      expect(barman.frameNumber).toBe(12);
    });

    it("marche vers la droite : images 0 à 5", () => {
      const { engine, barman, entry } = setup();
      stand(engine, HotspotId.GWEN, 29, 200, AT_BAR);
      entry.customers[0] = { hotspotId: HotspotId.GWEN, serveFlags: 0x82 };
      barman.setPosition(140, barman.y);
      run(engine, "barmanAnimHandler", barman);
      const frames = new Set<number>();
      for (let i = 0; i < 20; i++) {
        run(engine, "barmanAnimHandler", barman);
        frames.add(barman.frameNumber);
      }
      expect(barman.x).toBeGreaterThan(140);
      expect([...frames].every((f) => f >= 0 && f <= 5)).toBe(true);
    });

    it("client PNJ arrivé : servi (drapeaux 0), il garde la main jusqu'à ce qu'il parte ; parti, son entrée est libérée", () => {
      const { engine, barman, entry } = setup();
      const client = stand(engine, HotspotId.GWEN, 29, 100, AT_BAR);
      entry.customers[0] = { hotspotId: HotspotId.GWEN, serveFlags: 0x82 };
      entry.currentCustomer = 0;
      run(engine, "barmanAnimHandler", barman);
      expect(entry.customers[0]).toEqual({ hotspotId: HotspotId.GWEN, serveFlags: 0 });
      expect(entry.currentCustomer).toBe(0);
      expect(barman.frameCtr).toBe(0);
      client.setPosition(client.x, AWAY - client.heightCopy);
      run(engine, "barmanAnimHandler", barman);
      expect(entry.customers[0]).toEqual({ hotspotId: 0, serveFlags: 0 });
      expect(entry.currentCustomer).toBeNull();
    });

    it("client joueur : drapeaux 5 (servir) -> frameCtr 5 et drapeaux effacés ; sans drapeau et sans conversation -> il est libéré et le barman polit (2)", () => {
      const { engine, barman, entry } = setup();
      const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
      player.setPosition(150, AT_BAR - player.heightCopy);
      entry.customers[0] = { hotspotId: HotspotId.PLAYER, serveFlags: 5 };
      entry.currentCustomer = 0;
      run(engine, "barmanAnimHandler", barman);
      expect(barman.frameCtr).toBe(5);
      expect(entry.customers[0]!.serveFlags).toBe(0);

      barman.frameCtr = 0;
      barman.res.talkerId = HotspotId.PLAYER;
      run(engine, "barmanAnimHandler", barman);
      expect(entry.currentCustomer).toBe(0); // on lui parle : il attend

      barman.res.talkerId = 0;
      run(engine, "barmanAnimHandler", barman);
      expect(entry.currentCustomer).toBeNull();
      expect(entry.customers[0]!.hotspotId).toBe(0);
      expect(barman.frameCtr).toBe(2);
    });

    it("servir une bière (5) : des images de la liste, puis arrêt avec un délai de 10 ; polir (2) de même", () => {
      for (const action of [5, 2]) {
        const { engine, barman } = setup();
        barman.frameCtr = action;
        const frames: number[] = [];
        let guard = 0;
        while (guard++ < 200) {
          run(engine, "barmanAnimHandler", barman);
          if (barman.frameCtr === 0) break;
          frames.push(barman.frameNumber);
          expect(barman.frameCtr & 0x40).toBe(0x40);
        }
        expect(frames.length).toBeGreaterThan(5);
        expect(frames.every((f) => f !== 0)).toBe(true);
        expect(barman.delayCtr).toBe(10);
        expect(barman.actionCtr).toBe(12);
        expect(barman.frameNumber).toBe(12);
      }
    });

    it("flâner (1) : destination dans le bar (x de 117 à 202 pour Sid), puis marche", () => {
      const { engine, barman } = setup();
      for (let i = 0; i < 30; i++) {
        barman.frameCtr = 1;
        run(engine, "barmanAnimHandler", barman);
        expect(barman.frameCtr).toBe(0x83);
        expect(barman.supportValue).toBeGreaterThanOrEqual(117);
        expect(barman.supportValue).toBeLessThanOrEqual(202);
      }
    });

    it("attendre (3) : s'arrête aussitôt avec un délai de 10", () => {
      const { engine, barman } = setup();
      barman.frameCtr = 3;
      run(engine, "barmanAnimHandler", barman);
      expect(barman.frameCtr).toBe(0);
      expect(barman.delayCtr).toBe(10);
    });

    it("attendre la fin d'un dialogue (4) : fige l'image tant qu'une bulle est affichée, puis s'arrête sans délai", () => {
      const { engine, barman } = setup();
      barman.frameCtr = 4;
      barman.actionCtr = 7;
      barman.converse(HotspotId.NOONE, 0x890);
      for (let i = 0; i < 5; i++) run(engine, "barmanAnimHandler", barman);
      expect(engine.room.isDialogShowing()).toBe(true);
      expect(barman.frameNumber).toBe(7);
      expect(barman.frameCtr).toBe(4);
      engine.room.setTalkDialog(0, 0, 0, 0);
      barman.res.talkCountdown = 0;
      run(engine, "barmanAnimHandler", barman);
      expect(barman.frameCtr).toBe(0);
      expect(barman.delayCtr).toBe(0);
    });

    it("Nellie (32) et Ewan (35) : chacun son bar ; Ewan flâne entre 94 et 145", () => {
      const nellie = setup(HotspotId.NELLIE, 32);
      for (let i = 0; i < 30; i++) {
        nellie.barman.frameCtr = 1;
        run(nellie.engine, "barmanAnimHandler", nellie.barman);
        expect(nellie.barman.supportValue).toBeGreaterThanOrEqual(117);
      }
      const { engine } = makeEngine();
      started(engine);
      const ewan = engine.world.activateHotspot(HotspotId.EWAN)!;
      for (let i = 0; i < 30; i++) {
        ewan.frameCtr = 1;
        run(engine, "barmanAnimHandler", ewan);
        expect(ewan.supportValue).toBeGreaterThanOrEqual(94);
        expect(ewan.supportValue).toBeLessThanOrEqual(145);
      }
    });

    it("Ewan polit parfois avec l'animation alternative : 32 de large, décalé de 8 pixels, puis tout est remis", () => {
      const { engine } = makeEngine();
      started(engine);
      const ewan = engine.world.activateHotspot(HotspotId.EWAN)!;
      const bar = barOf(engine);
      ewan.frameCtr = 0;
      const x0 = ewan.x;
      let alt = 0;
      let extra1 = 0;
      for (let i = 0; i < 12000 && alt < 2; i++) {
        run(engine, "barmanAnimHandler", ewan);
        if (bar.ewanXOffset) {
          expect(ewan.width).toBe(32);
          // On le fige pour comparer : à la fin de l'animation, 8 pixels sont rendus.
          const xAlt = ewan.x;
          let guard = 0;
          while (bar.ewanXOffset && guard++ < 200) run(engine, "barmanAnimHandler", ewan);
          expect(bar.ewanXOffset).toBe(false);
          expect(ewan.width).toBe(16);
          expect(ewan.x).toBe(xAlt + 8);
          alt++;
        } else if ((ewan.supportValue >> 8) === 2) extra1++;
        // Il reste au même endroit entre les actions : on le remet pour ne pas dériver.
        if (ewan.frameCtr === 0 && !bar.ewanXOffset) ewan.setPosition(x0, ewan.y);
      }
      expect(alt).toBe(2);
      expect(extra1).toBeGreaterThan(0);
    });

    it("Ewan : pas d'animation alternative quand le joueur est dans la pièce 35", () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, 35, 100, 60);
      const ewan = engine.world.requireActiveHotspot(HotspotId.EWAN);
      const bar = barOf(engine);
      for (let i = 0; i < 3000; i++) {
        run(engine, "barmanAnimHandler", ewan);
        expect(bar.ewanXOffset).toBe(false);
      }
    });
  });

  describe("règle de la vague T : handleTalkDialog en tête", () => {
    it.each([
      ["grub", 12, 0x422, 23],
      ["Skorl", 31, 0x426, 25],
      ["Sid", 29, HotspotId.SID, 24],
      ["Nellie", 32, HotspotId.NELLIE, 24],
      ["Ewan", 35, HotspotId.EWAN, 24],
    ])("%s : la bulle s'affiche puis se compte à rebours jusqu'à sa fermeture", (_name, room, id, procId) => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, room, 100, 60);
      const h = engine.world.requireActiveHotspot(id);
      expect(h.tickProcId).toBe(procId);
      h.converse(HotspotId.NOONE, 0x890);
      let shown = false;
      for (let i = 0; i < 120; i++) {
        engine.tick();
        if (engine.room.isDialogShowing()) shown = true;
      }
      expect(shown).toBe(true);
      expect(h.res.talkCountdown).toBe(0);
      expect(engine.room.isDialogShowing()).toBe(false);
    });

    it("Goewin à la boutique de même", () => {
      const { engine } = makeEngine();
      started(engine);
      enterRoom(engine, 31, 100, 60);
      const goewin = engine.world.activateHotspot(HotspotId.GOEWIN)!;
      goewin.setTickProc(TickProc.GOEWIN_SHOP);
      goewin.frameCtr = 0;
      goewin.converse(HotspotId.NOONE, 0x890);
      let shown = false;
      for (let i = 0; i < 120; i++) {
        engine.tick();
        if (engine.room.isDialogShowing()) shown = true;
      }
      expect(shown).toBe(true);
      expect(goewin.res.talkCountdown).toBe(0);
    });
  });
});
