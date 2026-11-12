import { describe, expect, it } from "vitest";
import { Action, Direction } from "../../../../src/games/lure/data/ids";
import { CharacterMode, CurrentAction, Field, HotspotId, RoomNum, SupportId, TickProc } from "../../../../src/games/lure/engine/ids";
import { METHOD_CATALOG } from "../../../../src/games/lure/engine/methods/catalog";
import { GOEWIN_FREED_ACTIONS } from "../../../../src/games/lure/engine/methods/group-4/ids";
import { captureSave, parseSave, restoreSave } from "../../../../src/games/lure/engine/save";
import { callMethod, enter, field, freeGoewinAndWait, give, hasOriginalFiles, setField, start } from "./helpers";

const GOEWIN = HotspotId.GOEWIN;
const TELL_BIT = 1 << (Action.TELL - 1);

describe.skipIf(!hasOriginalFiles)("méthodes du groupe L4", () => {
  it("les neuf numéros du groupe L4 ne sont plus des souches", () => {
    const { engine } = start();
    const l4 = METHOD_CATALOG.filter((m) => m.group === "L4").map((m) => m.index);
    expect(l4).toEqual([37, 38, 41, 43, 52, 55, 58, 59, 60]);
    for (const i of l4) expect(engine.methods.isStub(i), `méthode ${i}`).toBe(false);
  });

  it("37 startOilBurner : le brûleur est placé à x = 152 et prend le gestionnaire d'animation", () => {
    const { engine } = start();
    enter(engine, 30);
    const burner = engine.world.requireActiveHotspot(HotspotId.OIL_BURNER);
    const y = burner.y;
    callMethod(engine, 37);
    expect(burner.x).toBe(152);
    expect(burner.y).toBe(y);
    expect(burner.tickProcId).toBe(TickProc.STANDARD_ANIM);
    expect(engine.world.requireHotspot(HotspotId.OIL_BURNER).tickProcId).toBe(TickProc.STANDARD_ANIM);
  });

  it("37 startOilBurner : brûleur inactif, la méthode lève comme l'assert de ScummVM", () => {
    const { engine } = start();
    expect(engine.world.getActiveHotspot(HotspotId.OIL_BURNER)).toBeNull();
    expect(() => callMethod(engine, 37)).toThrow();
  });

  it("38 transformPlayer : les étincelles apparaissent à (x - 14, y - 10) du joueur, script 0x630, actionCtr 0", () => {
    const { engine } = start();
    enter(engine, 15);
    const player = engine.world.requireHotspot(HotspotId.PLAYER);
    callMethod(engine, 38);
    const sparkles = engine.world.requireActiveHotspot(HotspotId.TRANSFORM);
    const data = engine.world.requireHotspot(HotspotId.TRANSFORM);
    expect(data.roomNumber).toBe(15);
    expect(data.startX).toBe(player.startX - 14);
    expect(data.startY).toBe(player.startY - 10);
    expect(sparkles.hotspotScript).toBe(0x630);
    expect(sparkles.actionCtr).toBe(0);
    expect(sparkles.tickProcId).toBe(17);
  });

  describe("Goewin", () => {
    function withGoewin() {
      // Goewin est déjà active quand le joueur arrive dans les grottes (elle l'a été à son passage dans la pièce 31) : sans cela la
      // séquence d'entrée de la pièce 38 (`makeGoewinFollow`) planterait, comme dans ScummVM.
      const s = start();
      freeGoewinAndWait(s.engine);
      enter(s.engine, RoomNum.CAVE);
      s.engine.world.requireHotspot(GOEWIN).roomNumber = RoomNum.CAVE;
      return s;
    }

    it("41 makeGoewinFollow : gestionnaire 8, emploi du temps des grottes (0x1800), « Dis à » permis", () => {
      const { engine } = withGoewin();
      const goewin = engine.world.requireActiveHotspot(GOEWIN);
      goewin.delayCtr = 50;
      goewin.actionCtr = 3;
      goewin.characterMode = CharacterMode.PAUSED;
      callMethod(engine, 41);
      expect(goewin.tickProcId).toBe(TickProc.FOLLOWER_2);
      const stack = goewin.currentActions;
      expect(stack.entries).toHaveLength(1);
      expect(stack.top()).toMatchObject({ action: CurrentAction.DISPATCH_ACTION, roomNumber: RoomNum.CAVE });
      expect(stack.top().support).toEqual({ kind: "schedule", id: engine.schedules.resolve(SupportId.GOEWIN_CAVE) });
      expect(goewin.res.actions & TELL_BIT).toBe(TELL_BIT);
      expect([goewin.actionCtr, goewin.delayCtr, goewin.characterMode]).toEqual([0, 0, CharacterMode.NONE]);
    });

    it("43 fixGoewin : gestionnaire standard, emploi du temps standard (0x1C00) dans sa pièce, « Dis à » retiré", () => {
      const { engine } = withGoewin();
      callMethod(engine, 41);
      const goewin = engine.world.requireActiveHotspot(GOEWIN);
      goewin.delayCtr = 9;
      callMethod(engine, 43);
      expect(goewin.tickProcId).toBe(TickProc.STANDARD_CHARACTER);
      expect(goewin.currentActions.entries).toHaveLength(1);
      expect(goewin.currentActions.top()).toMatchObject({ action: CurrentAction.DISPATCH_ACTION, roomNumber: goewin.roomNumber });
      expect(goewin.currentActions.top().support).toEqual({ kind: "schedule", id: engine.schedules.resolve(SupportId.GOEWIN_STANDARD) });
      expect(goewin.res.actions & TELL_BIT).toBe(0);
      expect([goewin.actionCtr, goewin.delayCtr, goewin.characterMode]).toEqual([0, 0, CharacterMode.NONE]);
    });

    it("52 makeGoewinWork : script de travail 0x616, attente 1500, gestionnaire de boutique, point d'accès (179, 138)", () => {
      const { engine } = withGoewin();
      const goewin = engine.world.requireActiveHotspot(GOEWIN);
      callMethod(engine, 52);
      expect(goewin.hotspotScript).toBe(0x616);
      expect(goewin.delayCtr).toBe(1500);
      expect(goewin.tickProcId).toBe(TickProc.GOEWIN_SHOP);
      expect(goewin.currentActions.entries.at(-1)).toMatchObject({ action: CurrentAction.EXEC_HOTSPOT_SCRIPT, roomNumber: 34 });
      expect([goewin.res.walkX, goewin.res.walkY]).toEqual([179, 138]);
    });

    it("55 freeGoewin : verbes « Parle à », « Donne », « Corromps », « Demande » (0x820C00), actionCtr 1, même inactive", () => {
      const { engine } = start();
      expect(engine.world.getActiveHotspot(GOEWIN)).toBeNull();
      callMethod(engine, 55);
      const data = engine.world.requireHotspot(GOEWIN);
      expect(data.actions).toBe(GOEWIN_FREED_ACTIONS);
      expect(data.actionCtr).toBe(1);
    });

    it("60 normalGoewin : l'action en tête redevient DISPATCH_ACTION, elle regarde vers le haut, plus de point d'accès", () => {
      const { engine } = withGoewin();
      const goewin = engine.world.requireActiveHotspot(GOEWIN);
      goewin.currentActions.clear();
      goewin.currentActions.addFront(CurrentAction.EXEC_HOTSPOT_SCRIPT, RoomNum.CAVE);
      goewin.characterMode = CharacterMode.IDLE;
      goewin.setDirection(Direction.DOWN);
      goewin.res.walkX = 179;
      goewin.res.walkY = 138;
      callMethod(engine, 60);
      expect(goewin.currentActions.top().action).toBe(CurrentAction.DISPATCH_ACTION);
      expect(goewin.characterMode).toBe(CharacterMode.NONE);
      expect(goewin.direction).toBe(Direction.UP);
      expect(goewin.tickProcId).toBe(TickProc.STANDARD_CHARACTER);
      expect([goewin.res.walkX, goewin.res.walkY]).toEqual([0, 0]);
    });

    it("60 normalGoewin : pile vide, rien n'est empilé", () => {
      const { engine } = withGoewin();
      const goewin = engine.world.requireActiveHotspot(GOEWIN);
      goewin.currentActions.clear();
      callMethod(engine, 60);
      expect(goewin.currentActions.isEmpty()).toBe(true);
    });

    it("la séquence d'entrée de la pièce 38 appelle makeGoewinFollow (une seule fois : champ 47)", () => {
      const { engine } = withGoewin();
      const goewin = engine.world.requireActiveHotspot(GOEWIN);
      expect(goewin.tickProcId).toBe(TickProc.FOLLOWER_2);
      expect(field(engine, 47)).toBe(1);
    });

    it("41, 43, 52, 60 : Goewin inactive, la méthode lève (assert de ScummVM)", () => {
      const { engine } = start();
      for (const i of [41, 43, 52, 60]) expect(() => callMethod(engine, i), `méthode ${i}`).toThrow();
    });
  });

  it("58 checkHasBook : SEQUENCE_RESULT vaut 1 si le livre est dans l'inventaire du joueur, 0 sinon", () => {
    const { engine } = start();
    callMethod(engine, 58);
    expect(field(engine, Field.SEQUENCE_RESULT)).toBe(0);
    give(engine, HotspotId.BOOK);
    callMethod(engine, 58);
    expect(field(engine, Field.SEQUENCE_RESULT)).toBe(1);
    give(engine, HotspotId.BOOK, HotspotId.RATPOUCH);
    setField(engine, Field.SEQUENCE_RESULT, 7);
    callMethod(engine, 58);
    expect(field(engine, Field.SEQUENCE_RESULT)).toBe(0);
  });

  it("59 enableGargoylesTalk : les deux gargouilles n'ont plus que « Parle à »", () => {
    const { engine } = start();
    callMethod(engine, 59);
    const talkOnly = 1 << (Action.TALK_TO - 1);
    expect(engine.world.requireHotspot(0x42c).actions).toBe(talkOnly);
    expect(engine.world.requireHotspot(0x42d).actions).toBe(talkOnly);
  });

  it("l'état posé par L4 (verbes, point d'accès, gestionnaire, pile de Goewin) survit à une sauvegarde puis une reprise", () => {
    const a = start();
    freeGoewinAndWait(a.engine);
    enter(a.engine, RoomNum.CAVE);
    callMethod(a.engine, 52);
    callMethod(a.engine, 59);
    const save = captureSave(a.engine);
    expect(save).not.toBeNull();
    const b = start();
    expect(restoreSave(b.engine, parseSave(JSON.parse(JSON.stringify(save)))!)).toBe(true);
    const g = b.engine.world.requireActiveHotspot(GOEWIN);
    expect([g.tickProcId, g.hotspotScript, g.res.walkX, g.res.walkY]).toEqual([TickProc.GOEWIN_SHOP, 0x616, 179, 138]);
    expect(b.engine.world.requireHotspot(0x42c).actions).toBe(1 << (Action.TALK_TO - 1));
  });
});
