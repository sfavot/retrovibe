/**
 * Interaction sur la vraie première pièce (tour 3600), pour les chemins que les scénarios du banc n'atteignent pas si tôt dans le jeu :
 * - verbe à deux objets (bandeau « Objet:Verbe », second objet à l'écran ou dans l'inventaire), avec une relation ajoutée à `INVENT` ;
 * - « Parler de » (`Op_DialogOn` simulé), avec des thèmes connus et des relations ajoutées ;
 * - crochets « Sauvegarder », « Charger » et « Quitter » du menu joueur, pause terminée par une touche.
 * Les relations ajoutées reprennent la forme de celles du jeu (`MsgRelHeader`, type 50 = message) ; les menus sont lus dans
 * `menuTable` pour viser leurs entrées, comme un joueur.
 */
import { describe, expect, it } from "vitest";
import type { MsgRelHeader } from "../../../src/games/croisiere/data/overlay";
import { TestHost } from "../../../src/games/croisiere/engine/host";
import { ObjType } from "../../../src/games/croisiere/engine/ids";
import { Cursor } from "../../../src/games/croisiere/engine/input";
import { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { getObjectName, objInit } from "../../../src/games/croisiere/engine/objects";
import { TraceRecorder } from "../../../src/games/croisiere/engine/trace";
import { gameFilesWithLooseFiles, hasOriginalFiles } from "./support";

const INVENT = 13;
const S33 = 14;

class HookHost extends TestHost {
  saves = 0;
  loads = 0;
  onSaveRequest(): void {
    this.saves++;
  }
  onLoadRequest(): void {
    this.loads++;
  }
}

function setup() {
  const host = new HookHost();
  const recorder = new TraceRecorder(1, false);
  const engine = new CroisiereEngine(host, { files: gameFilesWithLooseFiles(), seed: 1, trace: recorder });
  const e = engine.state;
  let level = { x: 0, y: 0, b: 0 };
  engine.onTickStart = () => engine.applyInputLevel(level.x, level.y, level.b);
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) engine.runFrame();
  };
  ticks(3600);
  expect(e.overlays.entries[INVENT]!.name).toBe("INVENT");
  expect(e.overlays.entries[S33]!.name).toBe("S33");
  /** Souris en (x, y), appui d'un tour (bouton `b` ; un appui plus long fermerait aussitôt un message), relâchement, `after` tours. */
  const click = (x: number, y: number, b = 1, after = 2) => {
    level = { x, y, b: 0 };
    ticks(2);
    level = { x, y, b };
    ticks(1);
    level = { x, y, b: 0 };
    ticks(after);
  };
  const named = (ovl: number, kind: "objectNames" | "verbNames", name: string) => {
    const blob = e.overlays.entries[ovl]!.data![kind];
    for (let i = 0; i < 200; i++) if (getObjectName(blob, i) === name) return i;
    throw new Error(`${name} introuvable`);
  };
  /** Centre de l'entrée `text` du menu `m`. */
  const entry = (m: number, text: string) => {
    const el = e.menuTable[m]!.elements.find((x) => x.string === text);
    if (!el) throw new Error(`entrée ${text} absente : ${e.menuTable[m]!.elements.map((x) => x.string).join(", ")}`);
    return [el.x + 40, el.y + 7] as const;
  };
  const addRelation = (ovl: number, fields: Partial<MsgRelHeader>) => {
    const h: MsgRelHeader = {
      type: 50, id: 0, offsetVerbeName: 0, verbOverlay: 0, verbNumber: -1, obj1Overlay: 0, obj1Number: -1, obj2Overlay: 0, obj2Number: -1,
      trackX: -1, trackY: -1, obj1NewState: -1, obj2NewState: -1, obj1OldState: -1, obj2OldState: -1, trackDirection: -1, dialog: 0,
      ...fields,
    };
    e.overlays.entries[ovl]!.data!.msgRelHeaders.push(h);
  };
  const message = () => [...e.cells].find((c) => c.type === ObjType.MESSAGE) ?? null;
  return { engine, e, host, recorder, ticks, click, named, entry, addRelation, message };
}

describe.skipIf(!hasOriginalFiles)("interaction (première pièce)", () => {
  it("verbe à deux objets : bandeau, second objet à l'écran puis dans l'inventaire", () => {
    const { e, click, named, entry, addRelation, message } = setup();
    const carte = named(INVENT, "objectNames", "Carte");
    const heure = named(INVENT, "objectNames", "Heure");
    const montrer = named(INVENT, "verbNames", "Montrer");
    const requin = named(S33, "objectNames", "Requin");
    addRelation(INVENT, { id: 8, verbNumber: montrer, obj1Number: carte, obj2Overlay: S33, obj2Number: requin });
    addRelation(INVENT, { id: 2, verbNumber: montrer, obj1Number: carte, obj2Number: heure });

    const chooseMontrer = () => {
      click(200, 60, 2);
      expect(e.currentActiveMenu).toBe(1);
      click(...entry(1, "Carte"));
      expect(e.menuTable[0]!.stringPtr).toBe("Carte");
      expect(e.menuTable[0]!.elements.find((x) => x.string === "Montrer")!.subs).toHaveLength(2);
      click(...entry(0, "Montrer"));
      expect(e.linkedRelation).toHaveLength(2);
      expect(e.linkedMsgList).not.toBeNull();
      // Le curseur croix est aussitôt remplacé par celui du survol, comme dans ScummVM (la souris n'a pas été vue hors menu).
      expect(e.cursor).toBe(Cursor.WALK);
      expect(e.currentActiveMenu).toBe(-1);
      expect(e.currentMenuElement!.element.string).toBe("Montrer");
    };

    chooseMontrer();
    click(304, 60); // Requin
    expect(e.linkedRelation).toBeNull();
    expect(e.linkedMsgList).toBeNull();
    expect(e.menuTable[0]).toBeNull();
    expect(e.userWait).toBe(true);
    expect(message()).toMatchObject({ overlay: INVENT, idx: 8 });
    click(100, 100); // ferme le message
    expect(e.userWait).toBe(false);

    chooseMontrer();
    click(200, 60, 2); // clic droit pendant la relation liée : inventaire, menu d'objet gardé
    expect(e.currentActiveMenu).toBe(1);
    expect(e.menuDown).toBe(1);
    expect(e.linkedRelation).not.toBeNull();
    click(...entry(1, "Heure"));
    expect(e.menuTable[0]).toBeNull();
    expect(e.menuTable[1]).toBeNull();
    expect(e.linkedRelation).toBeNull();
    expect(message()).toMatchObject({ overlay: INVENT, idx: 2 });
  });

  it("« Parler de » : thèmes connus, thème déjà évoqué en subColor, relation lancée au clic", () => {
    const { e, ticks, click, named, entry, addRelation, message } = setup();
    const parler = named(INVENT, "verbNames", "En parler");
    const requin = named(S33, "objectNames", "Requin");
    const fabiani = named(INVENT, "objectNames", "Fabiani");
    const julio = named(INVENT, "objectNames", "Julio");
    objInit(e, INVENT, fabiani, -2);
    objInit(e, INVENT, julio, -3);
    addRelation(INVENT, { id: 8, verbNumber: parler, obj1Number: fabiani, obj2Overlay: S33, obj2Number: requin });
    addRelation(INVENT, { id: 2, verbNumber: parler, obj1Number: julio, obj2Overlay: S33, obj2Number: requin });
    // Op_DialogOn(S33, Requin), Op_SetXDial(100)
    e.dialogueEnabled = true;
    e.dialogueOvl = S33;
    e.dialogueObj = requin;
    e.xdial = 100;
    ticks(2);
    const menu = e.menuTable[0]!;
    expect(menu.stringPtr).toBe("Parler de...");
    expect(menu.x).toBe(20);
    expect(menu.elements.map((x) => [x.string, x.color])).toEqual([
      ["Fabiani", e.display.subColor],
      ["Julio", -1],
    ]);
    expect(e.currentActiveMenu).toBe(0);
    click(...entry(0, "Julio"));
    expect(message()).toMatchObject({ overlay: INVENT, idx: 2 });
    expect(e.userWait).toBe(true);
    click(100, 100);
    ticks(2);
    expect(e.menuTable[0]!.stringPtr).toBe("Parler de...");
  });

  it("menu joueur : crochets Sauvegarder / Charger, pause terminée par une touche, Quitter", () => {
    const { engine, e, host, recorder, ticks, click, entry } = setup();
    const f10 = () => {
      engine.input.action = "playerMenu";
      ticks(1);
      expect(e.menuTable[0]!.stringPtr).toBe("Menu Joueur");
    };
    f10();
    click(...entry(0, "Sauvegarde"));
    expect(host.saves).toBe(1);
    expect(e.menuTable[0]).toBeNull();
    f10();
    click(...entry(0, "Chargement"));
    expect(host.loads).toBe(1);

    const before = engine.frameNumber;
    engine.input.action = "pause";
    ticks(5);
    expect(recorder.lines.filter((l) => l.startsWith("MF ")).slice(-4).every((l) => l.includes(" pause "))).toBe(true);
    engine.applyKey("SPACE");
    ticks(2);
    expect(engine.frameNumber).toBe(before + 7);
    expect(recorder.lines.at(-1)).toMatch(/^FR /);

    f10();
    click(...entry(0, "Quitter"));
    expect(engine.stopped).toBe(true);
    expect(host.exited).toBe(true);
  });
});
