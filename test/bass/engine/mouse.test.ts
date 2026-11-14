import { describe, expect, it } from "vitest";
import { CompactField as F } from "../../../src/games/bass/data/compact-fields";
import type { Compacts } from "../../../src/games/bass/engine/compacts";
import { MouseButton } from "../../../src/games/bass/engine/host";
import { Cursor, SF, Script, Var } from "../../../src/games/bass/engine/ids";
import { findMouseCursor, Mouse, type MouseHost } from "../../../src/games/bass/engine/mouse";
import { createScriptVars } from "../../../src/games/bass/engine/vars";
import { TraceRecorder } from "../../../src/games/bass/engine/trace";
import type { BassEngine } from "../../../src/games/bass/engine/game";
import { mcodeNumber } from "../../../src/games/bass/engine/mcodes";
import { BassScreenRenderer } from "../../../src/games/bass/render/screen";
import { readReferenceFrame } from "../render/harness";
import { hasOriginalFiles, lineCycle, makeEngine, readFixture } from "./helpers";

/** Premier objet de l'inventaire (`o0`, variable 69 : `fnStartMenu` reçoit 276 = 69 x 4). */
const O0 = 69;

/** Compact synthétique : tableau de mots indexé par `CompactField`. */
function zone(fields: Partial<Record<keyof typeof F, number>>): Uint16Array {
  const cpt = new Uint16Array(111);
  for (const [name, value] of Object.entries(fields)) cpt[F[name as keyof typeof F] as number] = value as number;
  return cpt;
}

/** Souris sur des compacts synthétiques : une liste de souris (compact 100) et deux zones qui se recouvrent. */
function syntheticMouse() {
  const vars = createScriptVars();
  const cpts = new Map<number, Uint16Array>();
  // Liste 100 : zone 1 puis zone 2 (la première touchée gagne), fin de liste (0).
  cpts.set(100, Uint16Array.from([1, 2, 0]));
  cpts.set(1, zone({ screen: 7, status: 16, xcood: 140, ycood: 140, mouseSizeX: 20, mouseSizeY: 20, mouseOn: 5, mouseOff: 6, mouseClick: 9 }));
  cpts.set(2, zone({ screen: 7, status: 16, xcood: 140, ycood: 140, mouseSizeX: 60, mouseSizeY: 60, mouseOn: 7, mouseOff: 8, mouseClick: 10 }));
  vars[Var.MOUSE_LIST_NO] = 100;
  vars[Var.SCREEN] = 7;
  vars[Var.MOUSE_STATUS] = 6;
  const calls: string[] = [];
  const host: MouseHost = {
    vars,
    compacts: { require: (id: number) => cpts.get(id) ?? new Uint16Array(111) } as unknown as Compacts,
    systemFlags: 0,
    mouseScript: (scr, item) => (calls.push(`mouse ${scr} @${item}`), 0),
    script: (no, off) => (calls.push(`script ${no}+${off}`), 0),
  };
  return { mouse: new Mouse(host), vars, calls, host, cpts };
}

describe("Mouse : zones, survol et clics (compacts synthétiques)", () => {
  it("la première zone active de la liste sous le pointeur gagne ; mouseOn à l'entrée, mouseOff de la précédente à la sortie", () => {
    const { mouse, vars, calls } = syntheticMouse();
    mouse.moved(20, 10); // coordonnées de jeu 148, 146 : dans les deux zones
    mouse.engine();
    expect(vars[Var.SPECIAL_ITEM]).toBe(1);
    expect(calls).toEqual(["mouse 5 @1"]);
    expect(vars[Var.GET_OFF]).toBe(6);
    mouse.engine(); // toujours sur la même zone : rien
    expect(calls).toHaveLength(1);
    // Hors de la petite zone mais dans la grande (x de jeu 178) : mouseOff de la première, mouseOn de la seconde.
    mouse.moved(50, 10);
    mouse.engine();
    expect(vars[Var.SPECIAL_ITEM]).toBe(2);
    expect(calls.slice(1)).toEqual(["mouse 6 @2", "mouse 7 @2"]);
    // Hors de toute zone : le get-off s'exécute comme un script ordinaire (compact courant de la logique).
    mouse.moved(0, 0);
    mouse.engine();
    expect(vars[Var.SPECIAL_ITEM]).toBe(0);
    expect(calls.at(-1)).toBe("script 8+0");
    expect(vars[Var.GET_OFF]).toBe(0);
  });

  it("une zone d'un autre écran, ou sans le bit 16 (ST_MOUSE), n'est jamais touchée", () => {
    const { mouse, vars, cpts } = syntheticMouse();
    cpts.get(1)![F.screen] = 3;
    cpts.get(2)![F.status] = 0;
    mouse.moved(20, 10);
    mouse.engine();
    expect(vars[Var.SPECIAL_ITEM]).toBe(0);
  });

  it("MOUSE_STATUS : bit 2 = pointeur, bit 4 = boutons ; MOUSE_STOP coupe tout", () => {
    const { mouse, vars, calls } = syntheticMouse();
    mouse.moved(20, 10);
    // Pointeur seul : survol sans clic.
    vars[Var.MOUSE_STATUS] = 2;
    mouse.pressed(MouseButton.Left);
    mouse.engine();
    expect(calls).toEqual(["mouse 5 @1"]);
    expect(vars[Var.BUTTON]).toBe(0);
    // Boutons : le clic lance mouseClick de la zone survolée et pose BUTTON (2 = gauche).
    vars[Var.MOUSE_STATUS] = 6;
    mouse.pressed(MouseButton.Left);
    mouse.engine();
    expect(calls.at(-1)).toBe("mouse 9 @1");
    expect(vars[Var.BUTTON]).toBe(2);
    // Un bouton n'est lu qu'une fois (`_mouseB = 0`).
    mouse.engine();
    expect(calls.filter((c) => c === "mouse 9 @1")).toHaveLength(1);
    // Clic droit = 1.
    mouse.pressed(MouseButton.Right);
    mouse.engine();
    expect(vars[Var.BUTTON]).toBe(1);
    // MOUSE_STOP : plus rien, mais le bouton est jeté.
    vars[Var.MOUSE_STOP] = 1;
    const before = calls.length;
    mouse.pressed(MouseButton.Left);
    mouse.engine();
    expect(calls).toHaveLength(before);
    expect(mouse.button).toBe(0);
  });

  it("logicClick : un clic reste disponible pour la logique pendant un tour (wasClicked le consomme), même sans pointeur actif", () => {
    const { mouse, vars } = syntheticMouse();
    vars[Var.MOUSE_STATUS] = 0;
    mouse.pressed(MouseButton.Left);
    mouse.engine();
    expect(mouse.wasClicked()).toBe(true);
    expect(mouse.wasClicked()).toBe(false);
    mouse.engine();
    expect(mouse.logicClick).toBe(false);
  });

  it("fnAddHuman : active pointeur et boutons, remonte le pointeur sous la ligne du haut, force un get-off et ramène le pointeur de la machine", () => {
    const { mouse, vars, calls } = syntheticMouse();
    vars[Var.MOUSE_STATUS] = 1;
    vars[Var.GET_OFF] = 6;
    mouse.y = 0;
    mouse.pointerX = 300;
    mouse.pointerY = 150;
    expect(mouse.addHuman()).toBe(true);
    expect(vars[Var.MOUSE_STATUS]).toBe(7);
    expect(mouse.y).toBe(2);
    expect([mouse.pointerX, mouse.pointerY]).toEqual([mouse.x, 2]); // `warpMouse`
    expect(calls).toEqual(["script 6+0"]);
    expect(vars[Var.SPECIAL_ITEM]).toBe(0xffffffff);
    expect(vars[Var.GET_OFF]).toBe(Script.RESET_MOUSE);
    // MOUSE_STOP : sans effet.
    vars[Var.MOUSE_STOP] = 1;
    vars[Var.MOUSE_STATUS] = 0;
    mouse.addHuman();
    expect(vars[Var.MOUSE_STATUS]).toBe(0);
  });

  it("curseur : spriteMouse, main ouverte ou fermée, objet tenu (rang dans la planche : 2 x rang + ouvert)", () => {
    const { mouse, vars, host } = syntheticMouse();
    mouse.sprite(Cursor.CROSS, 4, 4);
    expect([mouse.cursor, mouse.cursorHotspot]).toEqual([Cursor.CROSS, [4, 4]]);
    // Sans objet tenu, main fermée : curseur normal.
    mouse.openCloseHand(false);
    expect(mouse.cursor).toBe(Cursor.NORMAL);
    // Objet tenu : l'image 0 devient l'image de l'objet, point chaud (5, 5).
    vars[Var.OBJECT_HELD] = 9; // deuxième de `_mouseMainObjects`
    mouse.objectCursorFile = 60302;
    mouse.openCloseHand(true);
    expect([mouse.cursor, mouse.cursorHotspot, mouse.objectCursor, mouse.heldCursorFile]).toEqual([Cursor.OBJECT, [5, 5], 3, 60302]);
    mouse.openCloseHand(false);
    expect(mouse.objectCursor).toBe(2);
    // Le fichier de l'image copiée ne change pas avec la section.
    mouse.objectCursorFile = 60301;
    expect(mouse.heldCursorFile).toBe(60302);
    mouse.sprite(Cursor.NORMAL, 0, 0);
    expect(mouse.objectCursor).toBe(-1);
    expect(host.systemFlags).toBe(0);
    expect([findMouseCursor(65), findMouseCursor(24649), findMouseCursor(1)]).toEqual([0, 1, 0]);
  });

  it("lock / unlock : SF_MOUSE_LOCKED", () => {
    const { mouse, host } = syntheticMouse();
    mouse.lock();
    expect(host.systemFlags & SF.MOUSE_LOCKED).toBe(SF.MOUSE_LOCKED);
    mouse.unlock();
    expect(host.systemFlags & SF.MOUSE_LOCKED).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("API d'entrée du moteur (pointerMove, pointerDown, pointerUp, key)", () => {
  function started() {
    const { engine, host } = makeEngine();
    engine.startAfterIntro();
    engine.runCycles(2);
    return { engine, host };
  }

  it("un déplacement est lu au tour suivant ; le pointeur de la machine, lui, le suit tout de suite et reste dans l'écran", () => {
    const { engine } = started();
    engine.pointerMove(200, 150);
    expect(engine.pointer).toEqual({ x: 200, y: 150 });
    expect([engine.mouse.x, engine.mouse.y]).toEqual([160, 96]);
    engine.runCycles(1);
    expect([engine.mouse.x, engine.mouse.y]).toEqual([200, 150]);
    engine.pointerMove(-20, 999);
    expect(engine.pointer).toEqual({ x: 0, y: 199 });
    engine.pointerMove(12.6, 3.4);
    expect(engine.pointer).toEqual({ x: 13, y: 3 });
  });

  it("pointerDown : gauche = bouton 2, droit = bouton 1, à la position du pointeur ; pointerUp relâche", () => {
    const { engine } = started();
    engine.pointerMove(40, 12);
    engine.pointerDown("left");
    expect(engine.mouse.held).toBe(MouseButton.Left);
    engine.pointerDown("right");
    expect(engine.mouse.held).toBe(MouseButton.Left | MouseButton.Right);
    engine.pointerUp("left");
    expect(engine.mouse.held).toBe(MouseButton.Right);
    engine.pointerUp("right");
    expect(engine.mouse.held).toBe(0);
    engine.runCycles(1); // le dernier bouton lu (droit) est consommé par `mouseEngine`
    expect([engine.mouse.x, engine.mouse.y]).toEqual([40, 12]);
    expect(engine.vars[Var.BUTTON] === 1 || engine.mouse.button === 0).toBe(true);
  });

  it("souris verrouillée : le jeu garde sa position, le pointeur de la machine suit ; fnAddHuman l'y ramène", () => {
    const { engine } = started();
    engine.pointerMove(100, 100);
    engine.runCycles(1);
    engine.system.systemFlags |= SF.MOUSE_LOCKED;
    engine.pointerMove(250, 40);
    engine.runCycles(1);
    expect([engine.mouse.x, engine.mouse.y]).toEqual([100, 100]);
    expect(engine.pointer).toEqual({ x: 250, y: 40 });
    engine.system.systemFlags &= ~SF.MOUSE_LOCKED;
    engine.mouse.addHuman();
    expect(engine.pointer).toEqual({ x: 100, y: 100 });
  });

  it("key : « . » donne un clic à la logique pour un tour, Échap lance la partie, les autres touches sont refusées", () => {
    const { engine } = started();
    expect(engine.key("F6")).toBe(false); // F5 ouvre le panneau (GameControl)
    expect(engine.key("a")).toBe(false);
    expect(engine.key(".")).toBe(true);
    // `handleKey` pose `logicClick` après `mouseEngine` : lisible par la logique du même tour.
    let seen = false;
    const original = engine.mouse.wasClicked.bind(engine.mouse);
    engine.mouse.wasClicked = () => {
      const r = original();
      seen ||= r;
      return r;
    };
    engine.runCycles(1);
    expect(engine.mouse.logicClick || seen).toBe(true);
    engine.runCycles(1);
    expect(engine.mouse.logicClick).toBe(false);

    const fresh = makeEngine();
    expect(fresh.engine.system.pastIntro).toBe(false);
    expect(fresh.engine.key("Escape")).toBe(true);
    fresh.engine.runCycles(1);
    expect(fresh.engine.system.pastIntro).toBe(true);
    expect(fresh.engine.key("p")).toBe(true);
  });

  it("les entrées de BassHost.pollInput suivent le même chemin (pointeur de la machine et jeu)", () => {
    const { engine, host } = started();
    host.push({ type: "move", x: 77, y: 55 });
    engine.runCycles(1);
    expect(engine.pointer).toEqual({ x: 77, y: 55 });
    expect([engine.mouse.x, engine.mouse.y]).toEqual([77, 55]);
  });
});

/** Première ligne différente (rang), ou -1 si `actual` reprend tout `expected`. */
function firstDivergence(expected: readonly string[], actual: readonly string[]): number {
  for (let i = 0; i < expected.length; i++) if (expected[i] !== actual[i]) return i;
  return -1;
}

function expectSameTrace(expected: readonly string[], actual: readonly string[]): void {
  const at = firstDivergence(expected, actual);
  expect(at === -1 ? "aucune" : `ligne ${at} (tour ${lineCycle(expected[at]!)}) : ${expected[at]} / ${actual[at]}`).toBe("aucune");
  expect(actual).toHaveLength(expected.length);
}

/** Entrées du scénario, appliquées avant le tour qui suit le tour `at` (le tour des lignes `MC at` du banc). */
type Step = [at: number, run: (engine: BassEngine) => void];

function play(engine: BassEngine, steps: readonly Step[], cycles: number): void {
  for (const [at, run] of steps) {
    engine.runCycles(at - engine.completedCycles);
    run(engine);
  }
  engine.runCycles(cycles - engine.completedCycles);
}

describe.skipIf(!hasOriginalFiles)("souris et interface comparées au banc ScummVM", () => {
  it("barre d'inventaire : survol de la ligne du haut, icône, clic droit (objet tenu), survol et clic droit sur une zone : 143 tours (b-inv)", () => {
    const expected = readFixture("inventory.trace");
    const trace = new TraceRecorder(1);
    const { engine } = makeEngine({ trace });
    engine.startAfterIntro();
    engine.pointerMove(160, 100);
    engine.vars[O0] = 65; // `scriptvar o0 65`, `o1 9` du scénario : deux objets dans l'inventaire
    engine.vars[O0 + 1] = 9;
    play(
      engine,
      [
        [36, (e) => e.pointerMove(160, 0)], // la barre s'ouvre : fn_start_menu
        [51, (e) => e.pointerMove(40, 12)], // première icône
        [62, (e) => (e.pointerMove(40, 12), e.pointerDown("right"), e.pointerUp("right"))], // objet tenu (sans mcode)
        [74, (e) => e.pointerMove(36, 72)], // zone survolée avec un objet en main : main ouverte
        [85, (e) => (e.pointerMove(36, 72), e.pointerDown("right"), e.pointerUp("right"))], // utiliser : fn_save_coods, fn_get_to…
      ],
      143,
    );
    expect(expected.filter((l) => l.startsWith("CY"))).toHaveLength(143);
    expect(expected).toContain("MC 36 id=23 fn_start_menu 276 0 0");
    expect(expected).toContain("MC 74 id=23 fn_close_hand 0 65 0");
    expect(expected).toContain("MC 85 id=23 fn_save_coods 0 1 0");
    // Identique, tour pour tour, jusqu'à la fin de l'utilisation (tour 131). Ensuite le banc diffère sur un point : `fnAddHuman` appelle
    // `warpMouse`, qui déplace le pointeur de la fenêtre factice du banc ; ScummVM ne relance donc pas le survol de la zone, le portage
    // (pointeur resté dessus) le relance (`fn_cross_mouse`, `fn_pointer_text`) comme dans une vraie partie.
    const hover = /fn_(cross_mouse|pointer_text)/;
    const head = (lines: readonly string[]) => lines.filter((l) => lineCycle(l) < 131);
    const tail = (lines: readonly string[]) => lines.filter((l) => lineCycle(l) >= 131 && !hover.test(l));
    expectSameTrace(head(expected), head(trace.lines));
    expectSameTrace(tail(expected), tail(trace.lines));
  });

  it("choix de dialogue : lignes posées, survol (fn_highlight), clic sur la 2e ligne, THE_CHOSEN_ONE, fin du choix : 123 tours (b-choose)", () => {
    const expected = readFixture("chooser.trace");
    class ExecTrace extends TraceRecorder {
      engine!: BassEngine;
      override cycle(n: number, vars: Parameters<TraceRecorder["cycle"]>[1], compacts: Parameters<TraceRecorder["cycle"]>[2]): void {
        super.cycle(n, vars, compacts);
        // `SKY_EXEC=45:fn_chooser:0:0:0` : `Logic::fnExec` au début de `Logic::engine` du tour 45 (le banc ne journalise pas cet appel).
        if (n === 45) {
          const before = this.lines.length;
          this.engine.logic.mcode(mcodeNumber("fn_chooser"), 0, 0, 0);
          this.lines.splice(before, 1);
        }
      }
    }
    const trace = new ExecTrace(1);
    const { engine } = makeEngine({ trace });
    trace.engine = engine;
    engine.startAfterIntro();
    engine.pointerMove(160, 100);
    // `scriptvar text1 16953 / anim1 9 / text2 16591 / anim2 9`.
    engine.vars.set([16953, 9, 16591, 9], Var.TEXT1);
    let choosing = false;
    play(
      engine,
      [
        [52, (e) => e.pointerMove(20, 18)],
        [61, (e) => e.pointerMove(20, 5)],
        [70, (e) => e.pointerMove(20, 18)],
        [71, (e) => ((choosing = (e.system.systemFlags & SF.CHOOSING) !== 0), e.pointerDown("left"), e.pointerUp("left"))],
      ],
      123,
    );
    expect(expected.filter((l) => l.startsWith("CY"))).toHaveLength(123);
    expect(expected).toContain("MC 71 id=23 fn_text_kill 0 9 0");
    expectSameTrace(expected, trace.lines);
    expect(choosing).toBe(true); // `SF_CHOOSING` : pas de sauvegarde pendant le choix
    expect(engine.vars[Var.THE_CHOSEN_ONE]).toBe(16591); // le texte de la 2e ligne
  });

  it("choix de dialogue : images du banc (tours 60 et 66, ", () => {
    // Banc : `SKY_SHOT_CYCLES=60,66`, même scénario que ci-dessus (b-choose).
    const renderer = new BassScreenRenderer();
    const { engine } = makeEngine({ screen: (e) => renderer.attach(e) });
    engine.startAfterIntro();
    engine.pointerMove(160, 100);
    engine.vars.set([16953, 9, 16591, 9], Var.TEXT1);
    const compare = (name: string) => {
      const ref = readReferenceFrame(name);
      let different = 0;
      for (let i = 0; i < 64000; i++) if (ref.pixels[i] !== renderer.frame.pixels[i]) different++;
      expect(different).toBe(0);
      expect(renderer.frame.palette.subarray(0, 720)).toEqual(ref.palette.subarray(0, 720));
    };
    play(
      engine,
      [
        [44, (e) => e.logic.mcode(mcodeNumber("fn_chooser"), 0, 0, 0)], // `SKY_EXEC=45:fn_chooser` : au début du tour 45
        [52, (e) => e.pointerMove(20, 18)],
      ],
      60,
    );
    compare("choose-0060"); // 2e ligne survolée
    engine.pointerMove(20, 5); // tour 61 : 1re ligne
    engine.runCycles(6);
    compare("choose-0066");
  });
});
