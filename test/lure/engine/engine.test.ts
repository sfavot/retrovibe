import { describe, expect, it } from "vitest";
import { Action } from "../../../src/games/lure/data/ids";
import { HANDLER_CATALOG, handlerInfo } from "../../../src/games/lure/engine/handlers/catalog";
import { HandlerTable } from "../../../src/games/lure/engine/handlers/index";
import { CurrentAction, Cursor, Field, GameState, HotspotId, STARTUP_SCRIPT } from "../../../src/games/lure/engine/ids";
import { METHOD_CATALOG } from "../../../src/games/lure/engine/methods/catalog";
import { MethodTable } from "../../../src/games/lure/engine/methods/index";
import { Driver, hasOriginalFiles, makeEngine } from "./test-host";

describe("catalogues", () => {
  it("67 méthodes natives (0 à 66), les génériques L1 portées, les autres en souches", () => {
    expect(METHOD_CATALOG.map((m) => m.index)).toEqual([...Array(67).keys()]);
    const journal: string[] = [];
    const ctx = { journal: { log: (m: string) => journal.push(m) } } as never;
    const table = new MethodTable(ctx);
    const l1 = METHOD_CATALOG.filter((m) => m.group === "L1").map((m) => m.index);
    // Les groupes F (combats) et Q (séquences plein écran) sont portés à part (`fights/`, `sequences/`).
    // Tous les groupes de la vague L sont portés : plus aucune souche.
    expect(table.stubs).toEqual([]);
    expect(l1.every((i) => !table.isStub(i))).toBe(true);
    table.call(99, 0, 0, 0);
    expect(journal).toEqual(["méthode de script 99 non définie"]);
  });

  it("refuse une méthode fournie par deux groupes", () => {
    const fn = () => {};
    expect(() => new MethodTable({} as never, [{ 3: fn }, { 3: fn }])).toThrow(/deux fois/);
  });

  it("les 39 numéros de gestionnaires désignent 32 fonctions ; un numéro inconnu est refusé", () => {
    for (let id = 1; id <= 39; id++) expect(handlerInfo(id), `gestionnaire ${id}`).toBeDefined();
    expect(handlerInfo(0)).toBeUndefined();
    expect(handlerInfo(40)).toBeUndefined();
    expect(HANDLER_CATALOG).toHaveLength(32);
    const table = new HandlerTable({ journal: { log: () => {} } } as never);
    expect(() => table.check(40)).toThrow(/inconnu/);
    expect(table.stubs).not.toContain("standardAnimHandler");
    expect(table.stubs).not.toContain("playerAnimHandler");
    expect(table.stubs).not.toContain("standardCharacterAnimHandler");
    expect(table.stubs).not.toContain("followerAnimHandler");
    expect(table.stubs).not.toContain("jailorAnimHandler");
  });
});

describe.skipIf(!hasOriginalFiles)("moteur sur les vrais fichiers", () => {
  it("démarre : script 0x23FC, pièce 1, Diermot et la cellule actifs", () => {
    const { engine } = makeEngine();
    engine.tick();
    expect(engine.script.trace[0]).toBe(STARTUP_SCRIPT);
    expect(engine.room.roomNumber).toBe(1);
    expect(engine.world.fields.get(Field.ROOM_NUMBER)).toBe(1);
    const active = engine.world.activeHotspots.map((h) => h.hotspotId);
    expect(active).toContain(HotspotId.PLAYER);
    expect(active).toContain(HotspotId.SKORL);
    expect(active).toContain(0x2711); // porte de la cellule
    expect(active).toContain(0x40f); // torche
    expect(engine.room.layers.length).toBe(engine.world.requireRoom(1).data.numLayers);
    expect(engine.busy).toBe(false);
  });

  it("les 45 pièces se chargent (séquence d'entrée, hotspots, ticks)", () => {
    const { engine, data } = makeEngine();
    engine.tick();
    expect(data.rooms).toHaveLength(45);
    for (const room of data.rooms) {
      engine.room.setRoomNumber(room.roomNumber);
      expect(engine.room.roomNumber).toBe(room.roomNumber);
      for (let i = 0; i < 5; i++) engine.tick();
      for (const h of engine.world.activeHotspots) {
        if (h.roomNumber === room.roomNumber && h.data && h.hotspotId < 0x7530) expect(engine.world.hotspot(h.hotspotId)).toBe(h.data);
      }
    }
  });

  it("le tick suit l'ordre de la liste et renseigne CHARACTER_HOTSPOT_ID", () => {
    const { engine } = makeEngine();
    engine.tick();
    const seen: number[] = [];
    for (const h of engine.world.activeHotspots) {
      const tick = h.tick.bind(h);
      h.tick = () => {
        seen.push(engine.world.fields.get(Field.CHARACTER_HOTSPOT_ID));
        tick();
      };
    }
    engine.tick();
    expect(seen).toEqual(engine.world.activeHotspots.map((h) => h.hotspotId));
  });
});

describe.skipIf(!hasOriginalFiles)("la cellule du début, sans rendu", () => {
  function start() {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    return { engine, host, d };
  }

  it("le pointeur sur la torche montre son nom et la croix", () => {
    const { engine, d } = start();
    const p = d.centerOf(0x40f);
    d.hover(p.x, p.y);
    expect(engine.room.hotspotId).toBe(0x40f);
    expect(engine.room.cursor).toBe(Cursor.CROSS);
    expect(d.engine.room.hotspotName).not.toBe("");
  });

  it("clic droit hors hotspot : Regarde décrit la cellule", () => {
    const { d } = start();
    d.click(30, 60, "right");
    expect(d.popupEntries()).toEqual(["Regarde", "Statut"]);
    d.choose("Regarde");
    expect(d.statusLine()).toBe("Regarde ");
    expect(d.untilDialog()).toMatch(/^LA CELLULE\. Une puanteur/);
    d.dismiss();
    expect(d.engine.busy).toBe(false);
  });

  it("clic gauche sur la torche : Observe la torche (ligne d'état, boîte de description)", () => {
    const { d } = start();
    const p = d.centerOf(0x40f);
    d.hover(p.x, p.y);
    d.click(p.x, p.y);
    expect(d.statusLine()).toBe("Observe Torche");
    expect(d.untilDialog()).toBe("La torche nauséabonde fournit peu de lumière mais beaucoup de fumée âcre.");
  });

  it("le monde est figé tant qu'une boîte est ouverte", () => {
    const { engine, d } = start();
    const p = d.centerOf(0x40f);
    d.hover(p.x, p.y);
    d.click(p.x, p.y);
    d.untilDialog();
    const ticks = engine.world.state.delayList.map((e) => e.timeoutCtr);
    const before = JSON.stringify(engine.world.activeHotspots.map((h) => [h.hotspotId, h.x, h.y, h.frameNumber, h.frameCtr]));
    d.ticks(10);
    expect(JSON.stringify(engine.world.activeHotspots.map((h) => [h.hotspotId, h.x, h.y, h.frameNumber, h.frameCtr]))).toBe(before);
    expect(engine.world.state.delayList.map((e) => e.timeoutCtr)).toEqual(ticks);
  });

  it("Ouvre la porte de la cellule : elle est verrouillée", () => {
    const { d } = start();
    const p = d.centerOf(0x2711);
    d.hover(p.x, p.y);
    d.click(p.x, p.y, "right");
    expect(d.popupEntries()).toContain("Ouvre");
    d.choose("Ouvre");
    expect(d.statusLine()).toBe("Ouvre Porte de la cellule");
    expect(d.untilDialog()).toBe("La porte est verrouillée.");
    expect(d.engine.world.getExitJoin(0x2711)!.blocked).toBe(1);
  });

  it("Prends la torche : elle glisse et tombe sur la paille, puis le feu prend (groupe L2)", () => {
    const { engine, d } = start();
    const p = d.centerOf(0x40f);
    d.hover(p.x, p.y);
    d.click(p.x, p.y, "right");
    d.choose("Prends");
    expect(d.untilDialog()).toBe("Vous tendez une main tâtonnante. La torche glisse et tombe sur votre lit précieux.");
    d.dismiss();
    d.ticks(2);
    const ids = engine.world.activeHotspots.map((h) => h.hotspotId);
    expect(ids).not.toContain(0x40f);
    expect(ids).toContain(0x40e); // la torche qui tombe (gestionnaire 14, groupe L2)
    expect(engine.world.fields.get(Field.TORCH_HIDE)).toBe(1);
    // Fin de la chute : la torche part, le feu prend (`droppingTorchAnimHandler`).
    for (let i = 0; i < 300 && engine.world.getActiveHotspot(0x40e); i++) engine.tick();
    expect(engine.world.getActiveHotspot(0x40e)).toBeNull();
    expect(engine.world.getActiveHotspot(0x418)).not.toBeNull();
  });

  it("Statut : la pièce et l'inventaire vide", () => {
    const { d } = start();
    d.click(30, 60, "right");
    d.choose("Statut");
    expect(d.untilDialog()).toBe("La Cellule\n\nVous avez rien");
  });

  it("Regarde par la fissure : vue à distance de la pièce voisine, un clic ramène dans la cellule", () => {
    const { engine, d } = start();
    const p = d.centerOf(0x755e);
    d.hover(p.x, p.y);
    d.click(p.x, p.y, "right");
    expect(d.popupEntries()).toEqual(["Regarde par"]);
    d.choose("Regarde par");
    d.untilDialog();
    d.dismiss();
    d.ticks(2);
    expect(engine.room.roomNumber).toBe(4);
    expect(engine.world.fields.get(Field.OLD_ROOM_NUMBER)).toBe(1);
    expect(engine.world.requireActiveHotspot(HotspotId.PLAYER).tickProcId).toBe(1);
    expect(engine.isMenuAvailable).toBe(false);
    d.click(160, 100);
    d.ticks(1);
    expect(engine.room.roomNumber).toBe(1);
    expect(engine.world.fields.get(Field.OLD_ROOM_NUMBER)).toBe(0);
    expect(engine.world.requireActiveHotspot(HotspotId.PLAYER).tickProcId).toBe(3);
  });

  it("un clic droit ferme le menu surgissant sans rien faire", () => {
    const { engine, d } = start();
    d.click(30, 60, "right");
    d.click(30, 60, "right");
    expect(engine.menuView).toBeNull();
    expect(d.statusLine()).toBe("");
    expect(engine.world.requireActiveHotspot(HotspotId.PLAYER).currentActions.isEmpty()).toBe(true);
  });

  it("la commande devient l'action en tête de la pile du joueur (Utilise : paramètres inversés)", () => {
    const { engine } = start();
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    engine.doAction(Action.USE, 0x2711, 0x40f);
    expect(player.currentActions.top()).toEqual({
      action: CurrentAction.DISPATCH_ACTION,
      support: { kind: "dynamic", action: Action.USE, params: [0x40f, 0x2711] },
      roomNumber: 1,
    });
  });
});

describe.skipIf(!hasOriginalFiles)("Dis à (GetTellActions)", () => {
  it("construit un ordre (Prends la torche, fin) donné à Ratpouch", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    // Seuls les objets « trouvés » (`HOTSPOTFLAG_FOUND`, posé quand le pointeur passe dessus) et non propres à une autre pièce sont
    // proposés : la torche de la cellule l'est, pour l'essai.
    engine.world.requireHotspot(0x40f).flags = 0x80;
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    player.roomNumber = 5;
    engine.room.setRoomNumber(5);
    engine.world.requireHotspot(HotspotId.RATPOUCH).actions |= 1 << (Action.TELL - 1);
    const p = d.centerOf(HotspotId.RATPOUCH);
    d.hover(p.x, p.y);
    expect(engine.room.hotspotId).toBe(HotspotId.RATPOUCH);
    d.click(p.x, p.y, "right");
    d.choose("Dis à");
    expect(d.popupEntries()).toContain("Prends");
    d.choose("Prends");
    expect(d.popupEntries()).toEqual(["Torche"]);
    d.choose("Torche");
    expect(d.popupEntries()).toHaveLength(2);
    d.chooseIndex(1);
    expect(engine.busy).toBe(false);
    expect(d.statusLine()).toBe("Dis à Ratpouch à ..");
    expect(player.currentActions.top().support).toEqual({ kind: "dynamic", action: Action.TELL, params: [HotspotId.RATPOUCH, Action.GET, 0x40f, 0] });
  });

  it("un clic droit sur le premier verbe abandonne l'ordre et rouvre le menu des verbes", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    player.roomNumber = 5;
    engine.room.setRoomNumber(5);
    engine.world.requireHotspot(HotspotId.RATPOUCH).actions |= 1 << (Action.TELL - 1);
    const p = d.centerOf(HotspotId.RATPOUCH);
    d.hover(p.x, p.y);
    d.click(p.x, p.y, "right");
    d.choose("Dis à");
    d.click(p.x, p.y, "right");
    expect(d.popupEntries()).toContain("Dis à");
    expect(d.statusLine()).toBe("");
  });
});

describe.skipIf(!hasOriginalFiles)("barre de menus et redémarrage", () => {
  it("Crédits : générique jusqu'au clic, puis la pièce est rechargée", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    d.click(60, 3);
    expect(engine.menuView).toEqual({ kind: "bar", menu: 0, index: 0 });
    d.click(60, 22);
    expect(engine.showingCredits).toBe(true);
    d.click(100, 100);
    expect(engine.showingCredits).toBe(false);
    expect(engine.busy).toBe(false);
  });

  it("Texte rapide / lent et Avec / Sans son changent le texte de l'entrée", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    const before = engine.menuBar.menus[2]!.entries.slice();
    d.click(250, 3);
    d.click(250, 8 + 12 + 8 + 2);
    expect(engine.fastTextFlag).toBe(true);
    expect(engine.menuBar.menus[2]!.entries[1]).not.toBe(before[1]);
    d.click(250, 3);
    d.click(250, 8 + 12 + 16 + 2);
    expect(engine.soundFlag).toBe(false);
  });

  it("Recommencer : confirmation, puis remise à zéro complète", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    const torch = d.centerOf(0x40f);
    d.hover(torch.x, torch.y);
    d.click(torch.x, torch.y, "right");
    d.choose("Prends");
    d.untilDialog();
    d.dismiss();
    d.ticks(2);
    expect(engine.world.fields.get(Field.TORCH_HIDE)).toBe(1);

    d.click(150, 3);
    d.click(150, 8 + 12 + 2);
    expect(engine.confirmText).not.toBeNull();
    d.action("yes");
    d.ticks(2);
    expect(engine.world.fields.get(Field.TORCH_HIDE)).toBe(0);
    expect(engine.room.roomNumber).toBe(1);
    expect(engine.world.activeHotspots.map((h) => h.hotspotId)).toContain(0x40f);
    expect(engine.script.trace.filter((s) => s === STARTUP_SCRIPT)).toHaveLength(2);
  });

  it("killPlayer : fin de partie, l'hôte choisit de recommencer", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    engine.methods.call(61, 0, 0, 0);
    expect(engine.gameState).toBe(GameState.RESTORE_RESTART);
    d.ticks(2);
    expect(engine.gameState).toBe(0);
    expect(engine.script.trace.filter((s) => s === STARTUP_SCRIPT)).toHaveLength(2);
  });

  it("Échap demande de quitter ; oui fait sortir", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    d.action("escape");
    expect(engine.confirmText).not.toBeNull();
    d.click(10, 100, "right");
    expect(host.exits).toBe(0);
    d.action("escape");
    d.click(10, 100);
    expect(host.exits).toBe(1);
  });
});
