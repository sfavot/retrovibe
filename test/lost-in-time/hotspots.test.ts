import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Game } from "../../src/games/lost-in-time/engine/game";
import {
  HeadlessHost,
  MOUSE_LEFT,
  MOUSE_NONE,
  MOUSE_RIGHT,
  NullSubsystems,
  type HotspotBlock,
  type HotspotContext,
  type HotspotDef,
  type VmContext,
} from "../../src/games/lost-in-time/engine/host";
import { Hotspots } from "../../src/games/lost-in-time/engine/hotspots";
import { KEY_BACKSPACE, KEY_ESCAPE, KEY_LEFT, KEY_RETURN, KEY_SPACE } from "../../src/games/lost-in-time/engine/input";
import { Variables } from "../../src/games/lost-in-time/engine/variables";
import { hasOriginalFiles } from "./helpers";

/** Garde-fou : un test qui n'avance plus échoue au lieu de tourner indéfiniment. */
function guard(host: HeadlessHost, limit = 5000): void {
  const next = host.nextFrame.bind(host);
  host.nextFrame = () => {
    if (host.frames > limit) throw new Error("test bloqué : trop d'images");
    return next();
  };
}

// --- Machine virtuelle factice pour tester les zones seules -------------------------------

function setup() {
  const host = new HeadlessHost({ readFile: () => undefined });
  guard(host);
  const sys = new NullSubsystems();
  const hs = new Hotspots(sys);
  const called: number[] = [];
  const vars = new Variables(128);
  const vm = {
    host,
    vars,
    terminate: 0,
    quit: false,
    mouseX: 152,
    mouseY: 92,
    mouseButtons: MOUSE_NONE,
    handleMouse: 1,
    animDataSize: 40,
    async runFunction(offset: number) {
      called.push(offset);
    },
    checkKeys(_h: number, sync = true) {
      const input = host.input;
      if (sync) {
        vm.mouseX = input.mouseX;
        vm.mouseY = input.mouseY;
        vm.mouseButtons = input.mouseButtons === 3 ? 0 : input.mouseButtons;
      }
      return input.popKey();
    },
    storeMouse() {},
    animPalette() {},
    evalCoords: () => [0, 0, 0, 0],
    sleep: async () => host.nextFrame(),
  };
  hs.attach(vm as unknown as VmContext);
  const ctx: HotspotContext = { call: async () => {}, storeMouse() {}, isTerminated: () => false, vars };
  return { host, sys, hs, vm, vars, called, ctx };
}

function clickDef(index: number, over: Partial<HotspotDef> = {}): HotspotDef {
  return {
    index, type: 2, windowNum: 0, left: 0, top: 0, width: 320, height: 200, funcPos: 0, key: 0, id: index + 1,
    flags: 2, funcEnter: 0, funcLeave: 100 + index, input: null, enable: null, ...over,
  };
}

function blockOf(hotspots: HotspotDef[], over: Partial<HotspotBlock> = {}): HotspotBlock {
  return { handleMouse: 1, duration: 0, leaveWindowIndex: 0, hotspotIndex1: 0, hotspotIndex2: 0, needRecalc: false, hotspots, ...over };
}

/** Pousse une touche à l'image `frame` (evaluate vide d'abord le tampon de touches). */
function pressAt(host: HeadlessHost, frame: number, key: number): void {
  const next = host.nextFrame.bind(host);
  host.nextFrame = () => {
    if (host.frames === frame) host.input.pushKey(key);
    return next();
  };
}

/** Appuie sur le bouton gauche après `delay` images puis le relâche. */
function clickAfter(host: HeadlessHost, frames: number, x: number, y: number, button = MOUSE_LEFT): void {
  const next = host.nextFrame.bind(host);
  let n = 0;
  host.nextFrame = () => {
    n++;
    if (n === frames) {
      host.input.setMousePos(x, y);
      host.input.mouseButtons = button;
    }
    if (n === frames + 3) host.input.mouseButtons = MOUSE_NONE;
    return next();
  };
}

describe("zones : test de position et filtrage", () => {
  it("clic gauche dans une zone retourne sa clé, la première zone gagne", async () => {
    const { host, hs } = setup();
    hs.add({ id: 0x8001, left: 10, top: 10, right: 50, bottom: 50, flags: 2, key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    hs.add({ id: 0x8002, left: 0, top: 0, right: 100, bottom: 100, flags: 2, key: 9, funcEnter: 0, funcLeave: 2, funcPos: 0 });
    clickAfter(host, 3, 20, 20);
    expect(await hs.check(1, 0)).toBe(7);
  });

  it("bords inclus, hors zone : rien (gauche) ou Échap (bouton droit)", async () => {
    const a = setup();
    a.hs.add({ id: 0x8001, left: 10, top: 10, right: 50, bottom: 50, flags: 2, key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    clickAfter(a.host, 3, 50, 50);
    expect(await a.hs.check(1, 0)).toBe(7);

    const b = setup();
    b.hs.add({ id: 0x8001, left: 10, top: 10, right: 50, bottom: 50, flags: 2, key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    clickAfter(b.host, 3, 51, 50, MOUSE_RIGHT);
    expect(await b.hs.check(1, 0)).toBe(KEY_ESCAPE);

    const c = setup();
    c.hs.add({ id: 0x8001, left: 10, top: 10, right: 50, bottom: 50, flags: 2, key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    clickAfter(c.host, 3, 51, 50);
    // un clic gauche hors zone ne donne rien : seul le délai y met fin
    expect(await c.hs.check(1, -200)).toBe(0);
  });

  it("le bouton demandé par la zone doit correspondre, les zones désactivées sont ignorées", async () => {
    const { host, hs } = setup();
    // bits 4..5 des drapeaux : 1 = bouton droit seulement
    hs.add({ id: 0x8001, left: 0, top: 0, right: 100, bottom: 100, flags: 2 | (1 << 4), key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    hs.add({ id: 0xc002, left: 0, top: 0, right: 100, bottom: 100, flags: 2, key: 8, funcEnter: 0, funcLeave: 2, funcPos: 0 });
    clickAfter(host, 3, 20, 20, MOUSE_RIGHT);
    expect(await hs.check(1, 0)).toBe(7);

    const other = setup();
    other.hs.add({ id: 0xc002, left: 0, top: 0, right: 100, bottom: 100, flags: 2, key: 8, funcEnter: 0, funcLeave: 2, funcPos: 0 });
    clickAfter(other.host, 3, 20, 20);
    expect(await other.hs.check(1, -200)).toBe(0);
  });

  it("coordonnées négatives (zone désactivée par le script) : jamais touchée", async () => {
    const { host, hs } = setup();
    hs.add({ id: 0x8001, left: 0xff9c, top: 0, right: 0xffa0, bottom: 100, flags: 2, key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    clickAfter(host, 3, 0, 20);
    expect(await hs.check(1, -200)).toBe(0);
  });

  it("push / pop mettent les zones locales de côté et les rétablissent", async () => {
    const a = setup();
    a.hs.add({ id: 0x8021, left: 0, top: 0, right: 100, bottom: 100, flags: 2, key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    a.hs.push(0, true);
    clickAfter(a.host, 3, 20, 20);
    expect(await a.hs.check(1, -200)).toBe(0); // plus aucune zone

    const b = setup();
    b.hs.add({ id: 0x8021, left: 0, top: 0, right: 100, bottom: 100, flags: 2, key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    b.hs.push(0, true);
    b.hs.pop();
    clickAfter(b.host, 3, 20, 20);
    expect(await b.hs.check(1, 0)).toBe(7);
  });

  it("removeState et remove retirent les zones", async () => {
    const { host, hs } = setup();
    hs.add({ id: 0xe001, left: 0, top: 0, right: 100, bottom: 100, flags: 2, key: 7, funcEnter: 0, funcLeave: 1, funcPos: 0 });
    hs.removeState(0xe);
    clickAfter(host, 3, 20, 20);
    expect(await hs.check(1, -200)).toBe(0);
  });
});

describe("zones : évaluation d'un bloc", () => {
  it("attend sans occuper le processeur : chaque tour passe par nextFrame", async () => {
    const { host, hs, ctx } = setup();
    clickAfter(host, 30, 10, 10);
    const leave = await hs.evaluate(blockOf([clickDef(0)]), ctx);
    expect(leave).toBe(100);
    expect(host.frames).toBeGreaterThanOrEqual(30);
  });

  it("une touche déclenche la zone de même clé (insensible à la casse)", async () => {
    const a = setup();
    pressAt(a.host, 3, KEY_SPACE);
    expect(await a.hs.evaluate(blockOf([clickDef(0, { left: 300, width: 1, height: 1, key: KEY_SPACE }), clickDef(1, { left: 301, width: 1, height: 1, key: 0x41 })]), a.ctx)).toBe(100);

    const b = setup();
    pressAt(b.host, 3, 0x61); // 'a' pour une zone 'A'
    expect(await b.hs.evaluate(blockOf([clickDef(0, { left: 300, width: 1, height: 1, key: 0x41 }), clickDef(1, { key: 0 })]), b.ctx)).toBe(100);
  });

  it("le délai écoulé entre dans la première zone et rend son « leave »", async () => {
    const { host, hs, ctx } = setup();
    const leave = await hs.evaluate(blockOf([clickDef(0, { left: 320, top: 199, width: 1, height: 1 }), clickDef(1)], { duration: 2 }), ctx);
    expect(leave).toBe(100);
    expect(host.now()).toBeGreaterThanOrEqual(2000);
  });

  it("survol : entrée puis sortie, identifiant écrit dans les variables 16 et 17", async () => {
    const { host, hs, ctx, vars, called } = setup();
    const move = (i: number, left: number, enter: number): HotspotDef =>
      clickDef(i, { type: 1, flags: 1, left, width: 50, height: 50, key: i + 0xa000, id: 5 + i, funcEnter: enter, funcLeave: 200 + i });
    // survol de la zone 0, puis clic dessus
    const next = host.nextFrame.bind(host);
    let n = 0;
    host.nextFrame = () => {
      n++;
      if (n === 5) host.input.setMousePos(10, 10);
      if (n === 15) host.input.mouseButtons = MOUSE_LEFT;
      if (n === 18) host.input.mouseButtons = MOUSE_NONE;
      return next();
    };
    const leave = await hs.evaluate(blockOf([move(0, 0, 300), move(1, 100, 301)]), ctx);
    expect(called).toEqual([300]); // la fonction d'entrée de la zone 0 a tourné une fois
    expect(leave).toBe(200);
    expect(vars.readVar32(16)).toBe(5); // identifiant du script de la zone cliquée
  });
});

describe("zones : saisie de texte (type 4)", () => {
  function inputDef(): HotspotDef {
    return clickDef(0, {
      type: 4, flags: 4, left: 20, top: 50, width: 10, height: 12, key: 0, id: 0, funcEnter: 0, funcLeave: 555,
      input: { keyVar: 300, fontIndex: 1, backColor: 0, frontColor: 15, length: 0, str: null },
    });
  }
  const press = (host: HeadlessHost, ...keys: number[]): void => {
    let n = 0;
    const next = host.nextFrame.bind(host);
    host.nextFrame = () => {
      n++;
      if (n % 10 === 0 && keys.length > 0) host.input.pushKey(keys.shift()!);
      return next();
    };
  };

  it("tape, efface, déplace le curseur et valide avec Entrée", async () => {
    const { host, hs, ctx, vars, sys } = setup();
    vars.writeString(300, "");
    press(host, 0x61, 0x62, 0x63, KEY_BACKSPACE, KEY_LEFT, 0x7a, KEY_RETURN);
    const leave = await hs.evaluate(blockOf([inputDef()]), ctx);
    expect(leave).toBe(555);
    // a b c -> « ab » après effacement, curseur entre a et b, « z » inséré -> « azb »
    expect(vars.readString(300)).toBe("azb");
    expect(vars.readVar32(56)).toBe(2);
    expect(sys.count("draw", "printText")).toBeGreaterThan(3);
    expect(sys.count("draw", "fillRect")).toBeGreaterThan(3);
  });

  it("reprend le texte déjà présent dans la variable et respecte la largeur du champ", async () => {
    const { host, hs, ctx, vars } = setup();
    vars.writeString(300, "xy");
    // police de repli : 8 pixels, champ de 10 caractères
    press(host, ...Array.from("123456789012").map((c) => c.charCodeAt(0)), KEY_RETURN);
    await hs.evaluate(blockOf([inputDef()]), ctx);
    const text = vars.readString(300);
    // champ de 10 caractères : les suivants écrasent le dernier
    expect(text).toBe("xy12345672");
  });
});

// --- Avec le jeu réel, sous-systèmes factices ----------------------------------------------

const ORIGINAL = resolve(import.meta.dirname, "../../original/lost-in-time");

function realGame() {
  const host = new HeadlessHost({
    readFile: (name) => {
      const path = resolve(ORIGINAL, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
  });
  const sys = new NullSubsystems();
  const hs = new Hotspots(sys);
  sys.hotspots = hs;
  const attach = sys.attach.bind(sys);
  sys.attach = (vm) => {
    attach(vm);
    hs.attach(vm);
  };
  const game = new Game(host, sys, { maxSteps: 3_000_000 });
  const evaluated: { frame: number; leave: number | null }[] = [];
  const evaluate = hs.evaluate.bind(hs);
  hs.evaluate = async (block, ctx) => {
    const leave = await evaluate(block, ctx);
    evaluated.push({ frame: host.frames, leave });
    return leave;
  };
  /** Exécute `frames` images d'horloge puis arrête le jeu ; `script` reçoit le numéro d'image. */
  let tot = "";
  const play = async (frames: number, script: (frame: number) => void): Promise<void> => {
    const next = host.nextFrame.bind(host);
    host.nextFrame = () => {
      if (game.curTotFile) tot = game.curTotFile;
      script(host.frames);
      if (host.frames > frames) game.abort();
      return next();
    };
    await game.start();
  };
  return { host, sys, game, evaluated, play, tot: () => tot };
}

describe.skipIf(!hasOriginalFiles)("zones : partie réelle (EMAM1017, après INTRO et MENU)", () => {
  // Le jeu arrive au bloc de zones de la scène vers l'image 380 ; la souris y est survolée au départ.
  it("sans entrée, le jeu reste dans le bloc et rejoue la zone n°1 toutes les 80 ms", async () => {
    const { tot, evaluated, play, sys } = realGame();
    await play(700, () => {});
    expect(tot()).toBe("EMAM1017.TOT");
    // le seul retour de evaluate est celui de l'arrêt demandé par le test (null)
    expect(evaluated.filter((e) => e.leave !== null)).toEqual([]);
    expect(sys.count("mult", "animate")).toBeGreaterThan(20);
  });

  it("un clic sur une zone fait avancer le script (affichage propre à la zone cliquée)", async () => {
    const results: string[] = [];
    for (const [x, y] of [[190, 110], [70, 75]]) {
      const { host, sys, play, evaluated } = realGame();
      await play(500, (frame) => {
        if (frame === 410) host.input.setMousePos(x, y);
        if (frame === 420) host.input.mouseButtons = MOUSE_LEFT;
        if (frame === 425) host.input.mouseButtons = MOUSE_NONE;
      });
      expect(evaluated.length).toBeGreaterThan(0);
      expect(evaluated.some((e) => e.leave !== null && e.frame >= 420)).toBe(true);
      const sprite = sys.calls.find((c) => c.system === "draw" && c.method === "loadSprite" && c.args[0] === 3);
      expect(sprite, "la zone survolée doit afficher son sprite").toBeDefined();
      results.push(JSON.stringify(sprite!.args));
    }
    // deux zones différentes -> deux affichages différents
    expect(results[0]).not.toBe(results[1]);
  });
});
