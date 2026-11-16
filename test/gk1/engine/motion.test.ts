import { describe, expect, it } from "vitest";
import { baseRect, basesCollide, initBresenham, jumpSteps, loopForHeading, SIGNAL_DOESNT_TURN, SIGNAL_HIDDEN, SIGNAL_IGNORE_ACTOR, stepBresenham } from "../../../src/games/gk1/engine/motion";
import { original } from "../data/real";
import { Scene } from "../render/scene";

/** Positions successives d'un acteur de pas (`xStep`, `yStep`) jusqu'à sa cible. */
function walk(fromX: number, fromY: number, toX: number, toY: number, xStep: number, yStep: number): [number, number][] {
  const line = initBresenham(fromX, fromY, toX, toY, xStep, yStep);
  const trace: [number, number][] = [];
  let x = fromX;
  let y = fromY;
  for (let i = 0; i < 1000; i++) {
    const step = stepBresenham(line, x, y, toX, toY);
    ({ x, y } = step);
    line.di = step.di;
    trace.push([x, y]);
    if (x === toX && y === toY) return trace;
  }
  throw new Error("cible jamais atteinte");
}

describe("ligne de Bresenham", () => {
  it("avance du pas entier sur l'axe long, et répartit l'autre axe", () => {
    expect(initBresenham(0, 0, 30, 10, 3, 2)).toEqual({ dx: 3, dy: 1, i1: 0, i2: -60, di: -30, incr: 1, xAxis: true });
    expect(walk(0, 0, 30, 10, 3, 2)).toEqual([[3, 1], [6, 2], [9, 3], [12, 4], [15, 5], [18, 6], [21, 7], [24, 8], [27, 9], [30, 10]]);
    // Pente non entière : l'erreur ajoute un pixel de temps en temps.
    expect(walk(0, 0, 20, 5, 4, 2)).toEqual([[4, 1], [8, 2], [12, 3], [16, 4], [20, 5]]);
    expect(walk(0, 0, 21, 4, 3, 2)).toEqual([[3, 1], [6, 1], [9, 2], [12, 2], [15, 3], [18, 3], [21, 4]]);
  });

  it("marche dans les huit directions et se pose exactement sur la cible", () => {
    for (const [toX, toY] of [[50, 0], [-50, 0], [0, 40], [0, -40], [37, 23], [-37, 23], [37, -23], [-37, -23], [5, 60], [-5, -60], [1, 0], [0, 0]]) {
      const trace = walk(0, 0, toX, toY, 3, 2);
      expect(trace[trace.length - 1], `${toX},${toY}`).toEqual([toX, toY]);
      // Jamais plus d'un pas (plus un pixel de correction) par image.
      let [x, y] = [0, 0];
      for (const [nx, ny] of trace) {
        expect(Math.abs(nx - x)).toBeLessThanOrEqual(4);
        expect(Math.abs(ny - y)).toBeLessThanOrEqual(3);
        [x, y] = [nx, ny];
      }
    }
  });

  it("ligne plutôt verticale : l'axe des y mène", () => {
    const line = initBresenham(10, 10, 14, 50, 3, 2);
    expect(line).toMatchObject({ dx: 0, dy: 2, xAxis: false, incr: 1 });
    const trace = walk(10, 10, 14, 50, 3, 2);
    expect(trace).toHaveLength(20);
    expect(trace.map(([, y]) => y)).toEqual(Array.from({ length: 20 }, (_, i) => 12 + 2 * i));
    expect(new Set(trace.map(([x]) => x))).toEqual(new Set([10, 11, 12, 13, 14]));
  });

  it("réduit le pas horizontal quand la pente dépasserait le pas vertical", () => {
    // Pas de 10 × 1 sur une pente de 1/2 : il faudrait descendre de 5 par pas.
    const line = initBresenham(0, 0, 100, 50, 10, 1);
    expect(line.xAxis).toBe(true);
    expect(Math.abs(line.dy + line.incr)).toBeLessThanOrEqual(1);
    expect(line.dx).toBeLessThan(10);
  });

  it("applique le facteur de pas", () => {
    expect(initBresenham(0, 0, 60, 0, 3, 2, 2)).toMatchObject({ dx: 6, dy: 0 });
  });
});

describe("saut, orientation, base", () => {
  it("SetJump : vitesses d'une parabole, toujours vers le haut", () => {
    expect(jumpSteps(0, -20, 3)).toEqual({ xStep: 0, yStep: -11 });
    expect(jumpSteps(40, 0, 3)).toEqual({ xStep: 7, yStep: -7 });
    expect(jumpSteps(-40, 0, 3)).toEqual({ xStep: -7, yStep: -7 });
    expect(jumpSteps(10, -60, 3)).toEqual({ xStep: 1, yStep: -12 });
    expect(jumpSteps(0, 0, 3)).toEqual({ xStep: 0, yStep: -0 });
  });

  it("DirLoop : boucle selon le cap", () => {
    const loops = (count: number): (number | undefined)[] => [0, 44, 45, 90, 135, 136, 180, 224, 225, 270, 315, 316, 359].map((heading) => loopForHeading(heading, count));
    expect(loops(8)).toEqual([3, 3, 0, 0, 0, 2, 2, 2, 1, 1, 1, 3, 3]);
    // Moins de quatre boucles : ni face ni dos, la boucle courante est gardée.
    expect(loops(2)).toEqual([undefined, undefined, 0, 0, 0, undefined, undefined, undefined, 1, 1, 1, undefined, undefined]);
  });

  it("BaseSetter : la largeur du cel, yStep lignes aux pieds ; collisions strictes", () => {
    expect(baseRect(100, 150, 2, 43, 21, false)).toEqual({ left: 79, top: 149, right: 121, bottom: 151 });
    expect(baseRect(100, 150, 2, 43, 21, true)).toEqual({ left: 78, top: 149, right: 120, bottom: 151 });
    const base = { left: 10, top: 10, right: 20, bottom: 12 };
    expect(basesCollide(base, { left: 19, top: 11, right: 30, bottom: 13 })).toBe(true);
    expect(basesCollide(base, { left: 20, top: 10, right: 30, bottom: 12 })).toBe(false);
    expect(basesCollide(base, { left: 12, top: 12, right: 18, bottom: 14 })).toBe(false);
  });
});

describe.skipIf(!original.has)("noyau du déplacement, sur les classes du jeu", () => {
  /** Vue 901 : la marche de Gabriel (43×56 au premier cel de la boucle 0, ancré en bas au milieu). */
  const WALK_VIEW = 901;

  it("InitBresen écrit la ligne dans le mouvement", () => {
    const scene = new Scene();
    const actor = scene.make("Actor", { x: 100, y: 100, xStep: 3, yStep: 2 });
    const motion = scene.make("Motion", { client: actor, x: 130, y: 110 });
    scene.kernelOn("InitBresen", motion);
    expect(["dx", "dy", "b-i1", "b-i2", "b-di", "b-incr", "b-xAxis"].map((name) => scene.get(motion, name))).toEqual([3, 1, 0, -60, -30, 1, 1]);
  });

  it("SetJump, DirLoop et BaseSetter écrivent les propriétés de l'acteur", () => {
    const scene = new Scene();
    const actor = scene.make("Actor", { view: WALK_VIEW, loop: 0, cel: 0, x: 100, y: 150, yStep: 2 });
    scene.vm.kernel.call(scene.vm, scene.vm.kernel.indexOf("SetJump"), Uint32Array.of(actor, 40, 0, 3));
    expect([scene.get(actor, "xStep"), scene.get(actor, "yStep")]).toEqual([7, -7]);

    const turn = (heading: number): number => {
      scene.vm.kernel.call(scene.vm, scene.vm.kernel.indexOf("DirLoop"), Uint32Array.of(actor, heading));
      return scene.get(actor, "loop");
    };
    expect([turn(0), turn(90), turn(180), turn(270)]).toEqual([3, 0, 2, 1]);
    scene.set(actor, { signal: SIGNAL_DOESNT_TURN });
    expect(turn(0)).toBe(1);

    scene.set(actor, { loop: 0, yStep: 2 });
    scene.kernelOn("BaseSetter", actor);
    const cel = scene.frameout.cels.viewCel(WALK_VIEW, 0, 0)!;
    const base = ["brLeft", "brTop", "brRight", "brBottom"].map((name) => scene.get(actor, name));
    expect(base).toEqual([100 - cel.originX, 149, 100 - cel.originX + cel.width - 1, 151]);
    expect(scene.vm.warnings.size).toBe(0);
  });

  it("CantBeHere : gêné par la base d'un autre acteur de la liste, sauf caché ou ignoré", () => {
    const scene = new Scene();
    const base = (left: number, top: number, right: number, bottom: number) => ({ brLeft: left, brTop: top, brRight: right, brBottom: bottom });
    const actor = scene.make("Actor", base(10, 10, 20, 12));
    const other = scene.make("Actor", base(15, 11, 30, 13));
    const far = scene.make("Actor", base(100, 100, 120, 102));
    const list = scene.kernel("NewList");
    for (const member of [actor, far, other]) scene.kernelOn("AddToEnd", list, scene.kernelOn("NewNode", member, member));
    const blocked = (): number => scene.kernelOn("CantBeHere", actor, list);
    expect(blocked()).toBe(1);
    scene.set(other, { signal: SIGNAL_HIDDEN });
    expect(blocked()).toBe(0);
    scene.set(other, { signal: 0 });
    scene.set(actor, { signal: SIGNAL_IGNORE_ACTOR });
    expect(blocked()).toBe(0);
    scene.set(actor, { signal: 0, ...base(40, 10, 50, 12) });
    expect(blocked()).toBe(0);
    for (const name of ["InitBresen", "DoBresen", "SetJump", "DirLoop", "BaseSetter", "CantBeHere"]) expect(scene.vm.kernel.isImplemented(name), name).toBe(true);
  });
});
