import { describe, expect, it } from "vitest";
import { Action } from "../../../src/games/lure/data/ids";
import { gameTextToUnicode } from "../../../src/games/lure/data/charset";
import { captureSave, parseSave, restoreSave } from "../../../src/games/lure/engine/save";
import { CurrentAction, HotspotId, TickProc } from "../../../src/games/lure/engine/ids";
import { giveTellOrders, parseTellOrders } from "../../../src/games/lure/engine/tell";
import { isTalking, restoreTalkAsked, talkAskedKeys, talkSelectView } from "../../../src/games/lure/engine/talk";
import { TalkState } from "../../../src/games/lure/engine/world";
import { Driver, hasOriginalFiles, makeEngine, TeleportMovement } from "./test-host";
import { speakerOf, startConversation } from "./talk-helpers";

/** Premier dialogue dont l'écran de départ propose plusieurs options. */
function selectRecord(): number {
  const { engine, host } = makeEngine();
  const ids = engine.data.talk.records.map((r) => r.recordId);
  for (const id of ids) {
    const e = makeEngine();
    new Driver(e.engine, e.host).ticks(3);
    try {
      startConversation(e.engine, speakerOf(e.engine, id), id);
      for (let i = 0; i < 400 && !e.engine.busy && e.engine.world.talkState !== TalkState.SELECT && e.engine.world.activeTalkData; i++) e.engine.tick();
      if (e.engine.world.talkState === TalkState.SELECT) return id;
    } catch {
      /* dialogue sans option au début : suivant */
    }
  }
  void host;
  throw new Error("aucun dialogue à choix");
}

function started(recordId: number) {
  const { engine, host } = makeEngine();
  const d = new Driver(engine, host);
  d.ticks(3);
  startConversation(engine, speakerOf(engine, recordId), recordId);
  for (let i = 0; i < 400 && engine.world.talkState !== TalkState.SELECT; i++) engine.tick();
  return { engine, host, d };
}

describe("« Dis à » : ordres (sans fichiers du jeu)", () => {
  it("les paramètres d'une commande donnent un ordre par triplet", () => {
    expect(parseTellOrders([0x3e9, Action.GET, 0x40f, 0])).toEqual([{ action: Action.GET, param1: 0x40f, param2: 0 }]);
    expect(parseTellOrders([0x3e9, 22, 1, 0, 23, 0, 0])).toHaveLength(2);
    expect(parseTellOrders([0x3e9])).toEqual([]);
  });

  it("au plus 8 ordres", () => {
    const params = [0x3e9];
    for (let i = 0; i < 9; i++) params.push(Action.GET, 0x40f, 0);
    expect(() => parseTellOrders(params)).toThrow(/9 ordres/);
    expect(parseTellOrders(params.slice(0, 1 + 8 * 3))).toHaveLength(8);
  });
});

describe.skipIf(!hasOriginalFiles)("talkAnimHandler", () => {
  it("le choix : lignes du haut de l'écran, survol, clic gauche", () => {
    const id = selectRecord();
    const { engine, d } = started(id);
    const view = talkSelectView(engine)!;
    expect(view.lines.length).toBeGreaterThanOrEqual(2);
    expect(view.lines.length).toBeLessThanOrEqual(4);
    expect(view.lines.every((l) => gameTextToUnicode(l).length > 0)).toBe(true);
    expect(view.entries).toHaveLength(view.lines.length);
    expect(isTalking(engine)).toBe(true);

    // Le survol suit la ligne sous le pointeur (8 pixels par ligne, la première sous la barre de menus) ; hors des lignes : aucune.
    d.hover(100, 3);
    expect(talkSelectView(engine)!.selected).toBe(0);
    d.hover(100, 8 + 1);
    expect(talkSelectView(engine)!.selected).toBe(1);
    d.hover(100, 16 + 7);
    expect(talkSelectView(engine)!.selected).toBe(2);
    d.hover(100, 8 * (view.lines.length + 1) + 2);
    expect(talkSelectView(engine)!.selected).toBe(0);
    d.hover(100, 150);
    expect(talkSelectView(engine)!.selected).toBe(0);

    // Un clic hors des lignes ne choisit rien.
    d.click(100, 150);
    expect(engine.world.talkState).toBe(TalkState.SELECT);

    // Le clic gauche sur la 2e ligne : option 2, la conversation continue.
    const second = view.entries[1]!;
    d.click(100, 16 + 2);
    expect(engine.world.talkSelection).toBe(2);
    expect(talkSelectView(engine)).toBeNull();
    // L'option est posée quand le joueur la dit (image suivante).
    d.ticks(1);
    const record = engine.world.activeTalkData!;
    expect(talkAskedKeys(engine)).toContain(record.recordId * 1024 + second);
  });

  it("un clic droit abandonne la conversation : le joueur reprend la main, le personnage est libéré", () => {
    const id = selectRecord();
    const { engine, d } = started(id);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    const speaker = engine.world.requireActiveHotspot(speakerOf(engine, id));
    expect(player.tickProcId).toBe(TickProc.TALK);
    d.click(100, 10, "right");
    expect(engine.world.talkState).toBe(TalkState.NONE);
    expect(engine.world.activeTalkData).toBeNull();
    expect(player.tickProcId).toBe(TickProc.PLAYER);
    expect(player.res.talkDestCharacterId).toBe(0);
    expect(speaker.res.talkerId).toBe(0);
    expect(isTalking(engine)).toBe(false);
  });

  it("un choix rapide (appui et relâchement dans la même image) est pris en compte", () => {
    const id = selectRecord();
    const { engine, host } = started(id);
    host.push({ type: "pointer", x: 100, y: 10, buttons: 0 });
    engine.tick();
    host.push({ type: "pointer", x: 100, y: 10, buttons: 1 }, { type: "pointer", x: 100, y: 10, buttons: 0 });
    engine.tick();
    expect(engine.world.talkSelection).toBe(1);
    expect(engine.world.talkState).not.toBe(TalkState.SELECT);
  });

  it("une option à usage unique (bit 15) montrée une fois n'est plus montrée une fois posée ; les données partagées restent intactes", () => {
    const { engine: probe } = makeEngine();
    let tested = 0;
    for (const record of probe.data.talk.records) {
      const index = record.entries.findIndex((x) => (x.descId & 0xc000) === 0x8000);
      if (index < 0) continue;
      const shownWith = (keys: number[]): boolean => {
        const { engine, host } = makeEngine();
        new Driver(engine, host).ticks(3);
        restoreTalkAsked(engine, keys);
        try {
          startConversation(engine, speakerOf(engine, record.recordId), record.recordId);
          for (let i = 0; i < 400 && engine.world.talkState !== TalkState.SELECT && engine.world.activeTalkData; i++) engine.tick();
        } catch {
          return false;
        }
        return talkSelectView(engine)?.entries.includes(index) ?? false;
      };
      if (!shownWith([])) continue;
      expect(shownWith([record.recordId * 1024 + index]), `dialogue ${record.recordId.toString(16)} entrée ${index}`).toBe(false);
      expect(record.entries[index]!.descId & 0x4000).toBe(0);
      tested++;
    }
    expect(tested).toBeGreaterThan(5);
  });

  it("les drapeaux « posé » se rétablissent à l'identique (sauvegarde) et repartent de zéro avec un nouvel état", () => {
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(3);
    restoreTalkAsked(engine, [3 * 1024 + 1, 1024 + 2]);
    expect(talkAskedKeys(engine)).toEqual([1024 + 2, 3 * 1024 + 1]);
    engine.world.reset();
    expect(talkAskedKeys(engine)).toEqual([]);
  });

  it("les options choisies sont sauvegardées, relues dans un moteur neuf et recapturées à l'identique", () => {
    const a = makeEngine();
    new Driver(a.engine, a.host).ticks(3);
    restoreTalkAsked(a.engine, [3 * 1024 + 1, 1024 + 2]);
    const save = captureSave(a.engine)!;
    expect(save.talkAsked).toEqual([1024 + 2, 3 * 1024 + 1]);
    const loaded = parseSave(JSON.parse(JSON.stringify(save)))!;
    expect(loaded.talkAsked).toEqual(save.talkAsked);
    const b = makeEngine();
    new Driver(b.engine, b.host).ticks(3);
    expect(talkAskedKeys(b.engine)).toEqual([]);
    expect(restoreSave(b.engine, loaded)).toBe(true);
    expect(talkAskedKeys(b.engine)).toEqual([1024 + 2, 3 * 1024 + 1]);
    expect(captureSave(b.engine)!.talkAsked).toEqual(save.talkAsked);
    // Une sauvegarde sans le champ (ancienne) est lue avec aucune option choisie.
    const { talkAsked: _omit, ...old } = JSON.parse(JSON.stringify(save));
    expect(parseSave(old)).not.toBeNull();
  });

  it("« Parle à » : doTalkTo lance le dialogue du personnage, la fin rend la main au joueur", () => {
    const { engine, host } = makeEngine({ movement: (ctx) => new TeleportMovement(ctx) });
    const d = new Driver(engine, host);
    d.ticks(2);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    player.roomNumber = 5;
    engine.room.setRoomNumber(5);
    d.ticks(3);
    engine.world.requireActiveHotspot(HotspotId.RATPOUCH).setTickProc(TickProc.STANDARD_CHARACTER);
    engine.doAction(Action.TALK_TO, HotspotId.RATPOUCH, 0xffff);
    let sawTalk = false;
    for (let i = 0; i < 3000; i++) {
      if (engine.dialogText !== null) d.dismiss();
      else if (engine.world.talkState === TalkState.SELECT) d.click(100, 10);
      else d.ticks(1);
      if (engine.world.activeTalkData) sawTalk = true;
      if (sawTalk && !engine.world.activeTalkData && player.tickProcId === TickProc.PLAYER) break;
    }
    expect(sawTalk).toBe(true);
    expect(engine.world.talkState).toBe(TalkState.NONE);
    expect(player.tickProcId).toBe(TickProc.PLAYER);
    expect(engine.world.currentAction).toBe(Action.NONE);
  });

  it("la sauvegarde est refusée pendant un dialogue (choix, bulles), permise ensuite", () => {
    const id = selectRecord();
    const { engine, host, d } = started(id);
    expect(captureSave(engine)).toBeNull();
    d.action("saveGame");
    expect(host.saveDialogs).toEqual([]);
    d.click(100, 10);
    for (let i = 0; i < 3; i++) {
      expect(captureSave(engine)).toBeNull();
      d.ticks(1);
    }
    // Fin du dialogue : abandon.
    const again = started(id);
    again.d.click(100, 10, "right");
    again.d.ticks(2);
    expect(captureSave(again.engine)).not.toBeNull();
    again.d.action("saveGame");
    expect(again.host.saveDialogs).toEqual([true]);
  });
});

describe.skipIf(!hasOriginalFiles)("« Statut »", () => {
  it("la boîte de statut est centrée en hauteur, « Regarde » ne l'est pas", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    d.hover(160, 160);
    d.click(160, 160, "right");
    d.choose("Statut");
    d.untilDialog();
    expect(engine.dialogCentered).toBe(true);
    d.dismiss();
    expect(engine.dialogCentered).toBe(false);
    d.click(160, 160, "right");
    d.choose("Regarde");
    d.untilDialog();
    expect(engine.dialogCentered).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("« Dis à Ratpouch » : plusieurs ordres", () => {
  function tellRatpouch() {
    const { engine, host } = makeEngine({ movement: (ctx) => new TeleportMovement(ctx) });
    const d = new Driver(engine, host);
    d.ticks(2);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    player.roomNumber = 5;
    engine.room.setRoomNumber(5);
    d.ticks(3);
    const p = d.centerOf(HotspotId.RATPOUCH);
    d.hover(p.x, p.y);
    d.click(p.x, p.y, "right");
    d.choose("Dis à");
    // Ordre 1 : Va à La Cellule ; ordre 2 : Reviens ; fin.
    d.choose("Va à");
    d.choose("La Cellule");
    d.chooseIndex(0);
    d.choose("Reviens");
    d.chooseIndex(1);
    return { engine, d, player };
  }

  it("le menu compose deux ordres, la commande les garde dans l'ordre", () => {
    const { engine, player } = tellRatpouch();
    expect(engine.busy).toBe(false);
    expect(player.currentActions.top().support).toEqual({ kind: "dynamic", action: Action.TELL, params: [HotspotId.RATPOUCH, Action.GO_TO, 1, 0, Action.RETURN, 0, 0] });
  });

  it("Ratpouch reçoit les ordres à la place de ce qu'il faisait et les exécute l'un après l'autre", () => {
    const { engine, d } = tellRatpouch();
    const ratpouch = engine.world.requireActiveHotspot(HotspotId.RATPOUCH);
    const seen: number[] = [];
    let gaveOrders = false;
    for (let i = 0; i < 400; i++) {
      d.ticks(1);
      if (engine.dialogText !== null) d.dismiss();
      const entries = ratpouch.currentActions;
      let support: { kind: string; action?: number } | null;
      try {
        support = entries.top().support;
      } catch {
        support = null;
      }
      if (support !== null && support.kind === "dynamic" && support.action !== undefined) {
        gaveOrders = true;
        if (seen[seen.length - 1] !== support.action) seen.push(support.action);
      }
    }
    expect(gaveOrders).toBe(true);
    expect(seen).toEqual([Action.GO_TO, Action.RETURN]);
    expect(ratpouch.currentActions.action()).not.toBe(CurrentAction.DISPATCH_ACTION);
  });

  it("giveTellOrders remplace la pile du personnage et le débloque", () => {
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(3);
    const ratpouch = engine.world.activateHotspot(HotspotId.RATPOUCH)!;
    ratpouch.blockedFlag = true;
    giveTellOrders(ratpouch, [HotspotId.RATPOUCH, Action.GO_TO, 1, 0, Action.RETURN, 0, 0]);
    expect(ratpouch.blockedFlag).toBe(false);
    expect(ratpouch.startRoomNumber).toBe(ratpouch.roomNumber);
    expect(ratpouch.currentActions.top().support).toEqual({ kind: "dynamic", action: Action.GO_TO, params: [1, 0] });
  });
});

describe.skipIf(!hasOriginalFiles)("bulle d'un personnage retiré (Room::isDialogShowing)", () => {
  it("la bulle ne compte plus quand celui qui parle n'est plus actif : la conversation suivante peut commencer", () => {
    // Vu en jouant le village : le Skorl de la place (0x427) dit « Holà, Séléna! » au moment où le joueur entre à la mairie ; il est
    // retiré (non persistant) avec sa bulle encore ouverte, et « Parle à » le garde de la mairie attendait sans fin (état NONE).
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(2);
    const room = engine.room;
    const prisoner = engine.world.activateHotspot(0x412)!;
    prisoner.roomNumber = room.roomNumber;
    room.setTalkDialog(0x412, 0, 0, 0x75);
    expect(room.isDialogActive()).toBe(true);
    expect(room.isDialogShowing()).toBe(true);
    engine.world.deactivateHotspot(0x412);
    expect(room.isDialogActive()).toBe(true);
    expect(room.isDialogShowing()).toBe(false);
  });
});
