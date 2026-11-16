import { describe, expect, it } from "vitest";
import { eventsOf, MouseButton, SciKey } from "../../../src/games/gk1/engine/events";
import { currentRoom, runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { type Reg, toSint16 } from "../../../src/games/gk1/engine/memory";
import { readSelector } from "../../../src/games/gk1/engine/object";
import { findPath, type Point, type PolygonInput } from "../../../src/games/gk1/engine/polygons";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { mainIndex, original } from "../data/real";

const TITLE_ROOM = 375;
/** La librairie de Gabriel, première pièce du jeu. */
const BOOKSHOP = 210;
/** Vue de Gabriel quand il marche : il ne l'a qu'une fois la scène d'ouverture finie. */
const WALK_VIEW = 901;
/** Variables globales de la bibliothèque de Sierra : le héros, la pièce, la barre d'icônes, l'objet `User`. */
const GLOBAL_EGO = 0;
const GLOBAL_ROOM = 2;
const GLOBAL_ICON_BAR = 69;
const GLOBAL_USER = 80;
const MAX_FRAMES = 30000;

describe.skipIf(!original.has)("parcours sans tête : du titre à la librairie, puis marcher", () => {
  it("clic sur JOUER, scène d'ouverture, puis Gabriel contourne le mur pour aller au fond de la boutique", { timeout: 120_000 }, () => {
    const vm = new Vm(mainIndex());
    useGameClock(vm);
    vm.boot();
    const frameout = frameoutOf(vm);
    const events = eventsOf(vm);
    let frames = 0;
    const step = (count = 1): void => {
      for (let i = 0; i < count; i++) {
        if (++frames > MAX_FRAMES) throw new Error(`parcours trop long (pièce ${currentRoom(vm)})`);
        expect(runFrame(vm).status).toBe(RunStatus.Suspended);
      }
    };
    const until = (done: () => boolean, each = 1, between?: () => void): void => {
      while (!done()) {
        between?.();
        step(each);
      }
    };
    const globals = (): Uint32Array => vm.memory.localsSegment(vm.scripts.loaded(0)!.localsSegment)!.values;
    const property = (object: Reg, name: string): Reg => readSelector(vm.memory, object, vm.selectors.id(name));
    const value = (object: Reg, name: string): number => toSint16(property(object, name));
    const item = (name: string) => frameout.planes.flatMap((plane) => plane.items).find((candidate) => candidate.object !== 0 && vm.nameOf(candidate.object) === name);
    const click = (x: number, y: number, button: number = MouseButton.Left): void => {
      events.move(x, y);
      step(3);
      events.down(button, x, y);
      events.up(button, x, y);
      step(2);
    };

    // Écran titre : attendre les boutons (et la fin d'un éventuel fondu), puis cliquer sur JOUER.
    until(() => currentRoom(vm) === TITLE_ROOM && item("playButt") !== undefined);
    step(120);
    const play = item("playButt")!.screenRect;
    until(() => currentRoom(vm) !== TITLE_ROOM, 20, () => click(play.left + 5, play.top + 3));

    // « Jour 1 », la scène devant la boutique, puis le dialogue d'ouverture : Entrée ferme chaque fenêtre de texte.
    // Le jeu rend la main quand Gabriel a sa vue de marche et que `User` accepte les entrées.
    const user = globals()[GLOBAL_USER];
    const inControl = (): boolean => currentRoom(vm) === BOOKSHOP && item("GKEgo")?.view === WALK_VIEW && value(user, "input") !== 0 && value(user, "controls") !== 0;
    until(inControl, 60, () => events.keyDown(SciKey.Enter));
    expect(currentRoom(vm)).toBe(BOOKSHOP);
    step(60);

    const ego = globals()[GLOBAL_EGO];
    const position = (): Point => ({ x: value(ego, "x"), y: value(ego, "y") });
    const walking = (): boolean => property(ego, "mover") !== 0;

    // Bouton droit : curseur suivant, jusqu'à celui de la marche (D7).
    const iconBar = globals()[GLOBAL_ICON_BAR];
    const walkIcon = property(iconBar, "walkIconItem");
    let cycles = 0;
    until(
      () => property(iconBar, "curIcon") === walkIcon,
      5,
      () => {
        expect(++cycles).toBeLessThan(15);
        click(150, 120, MouseButton.Right);
      },
    );
    expect(walking()).toBe(false);

    // Polygones de la pièce, tels que les scripts les donnent au noyau.
    const obstacles = property(globals()[GLOBAL_ROOM], "obstacles");
    const polygons: PolygonInput[] = [];
    for (let at = vm.memory.list(property(obstacles, "elements")).first; at !== 0; at = vm.memory.node(at)!.succ) {
      const polygon = vm.memory.node(at)!.value;
      const data = vm.memory.array(property(property(polygon, "points"), "data"));
      const points: Point[] = [];
      for (let i = 0; i < value(polygon, "size"); i++) points.push({ x: toSint16(data.get(i * 2)), y: toSint16(data.get(i * 2 + 1)) });
      polygons.push({ type: value(polygon, "type"), points });
    }
    expect(polygons.map((polygon) => [polygon.type, polygon.points.length])).toEqual([[3, 25], [2, 5], [2, 6]]);

    /**
     * Clique en (x, y) de l'écran et suit Gabriel jusqu'à l'arrêt : les points où il est passé. Il s'arrête un instant à
     * chaque coin pour se tourner (son mouvement est alors mis de côté) : l'arrêt est une demi-seconde sans bouger.
     */
    const walkTo = (x: number, y: number): Point[] => {
      const trace: Point[] = [position()];
      click(x, y);
      until(walking);
      for (let still = 0; still < 30; still++) {
        step();
        const at = position();
        const last = trace[trace.length - 1];
        if (at.x === last.x && at.y === last.y) continue;
        trace.push(at);
        still = 0;
      }
      expect(walking()).toBe(false);
      return trace;
    };
    /** Le plan du jeu commence à la ligne 10 de l'écran : un clic en (x, y) vise (x, y − 10) dans la pièce. */
    const PLANE_TOP = 10;
    const visits = (trace: readonly Point[], points: readonly Point[]): boolean => {
      let from = 0;
      return points.every((point) => (from = trace.findIndex((at, index) => index >= from && at.x === point.x && at.y === point.y) + 1) > 0);
    };

    // 1. Vers la droite de la boutique.
    const first = walkTo(280, 140);
    expect(position()).toEqual({ x: 280, y: 130 });
    expect(visits(first, findPath(first[0], { x: 280, y: 140 - PLANE_TOP }, polygons, { width: 320, height: 190 }))).toBe(true);

    // 2. Vers le fond à gauche : le mur fait un coin, la ligne droite est barrée. Gabriel passe par les trois sommets du coin
    // et s'arrête au bord du plancher (le point visé, (150, 90), est dans le mur du fond).
    const calls = vm.kernel.journal.counts[vm.kernel.indexOf("AvoidPath")];
    const second = walkTo(150, 100);
    const expected = findPath({ x: 280, y: 130 }, { x: 150, y: 100 - PLANE_TOP }, polygons, { width: 320, height: 190 });
    expect(expected).toEqual([{ x: 280, y: 130 }, { x: 228, y: 131 }, { x: 194, y: 128 }, { x: 182, y: 119 }, { x: 150, y: 94 }]);
    expect(visits(second, expected)).toBe(true);
    expect(position()).toEqual({ x: 150, y: 94 });
    expect(currentRoom(vm)).toBe(BOOKSHOP);
    expect(vm.kernel.journal.counts[vm.kernel.indexOf("AvoidPath")]).toBeGreaterThan(calls);
    // Il a marché, pas sauté : jamais plus de son pas (plus un pixel de correction) entre deux images.
    for (let i = 1; i < second.length; i++) {
      expect(Math.abs(second[i].x - second[i - 1].x)).toBeLessThanOrEqual(value(ego, "xStep") + 1);
      expect(Math.abs(second[i].y - second[i - 1].y)).toBeLessThanOrEqual(value(ego, "yStep") + 1);
    }

    for (const ported of ["GetEvent", "GlobalToLocal", "BaseSetter", "DirLoop", "InitBresen", "DoBresen", "CantBeHere", "AvoidPath"]) {
      expect(vm.kernel.journal.stubs.has(ported), ported).toBe(false);
      expect(vm.kernel.journal.counts[vm.kernel.indexOf(ported)], ported).toBeGreaterThan(0);
    }
  });
});
