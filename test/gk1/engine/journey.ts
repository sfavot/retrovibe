import { expect } from "vitest";
import { eventsOf, MouseButton, SciKey } from "../../../src/games/gk1/engine/events";
import { soundManagerOf } from "../../../src/games/gk1/engine/kernel/sound";
import { currentRoom, runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { toSint16 } from "../../../src/games/gk1/engine/memory";
import { readSelector } from "../../../src/games/gk1/engine/object";
import type { GameFixes } from "../../../src/games/gk1/engine/patches";
import { type RunResult, RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { mainIndex } from "../data/real";

/** Parcours sans tête partagés par les tests du moteur : du démarrage à la librairie, clics et images. */

const TITLE_ROOM = 375;
export const BOOKSHOP = 210;
const WALK_VIEW = 901;
const GLOBAL_USER = 80;

/** Joue `count` images comme la page (une image du jeu, puis le son jusqu'à l'horloge du jeu) ; rend le dernier résultat. */
export function step(vm: Vm, count = 1): RunResult {
  let result: RunResult = { status: RunStatus.Suspended };
  for (let i = 0; i < count; i++) {
    result = runFrame(vm);
    expect(result.status).toBe(RunStatus.Suspended);
    soundManagerOf(vm).advanceTo(vm.ticks);
  }
  return result;
}

/** Élément d'écran de l'objet de ce nom. */
export function item(vm: Vm, name: string) {
  return frameoutOf(vm)
    .planes.flatMap((plane) => plane.items)
    .find((candidate) => candidate.object !== 0 && vm.nameOf(candidate.object) === name);
}

export function center(vm: Vm, name: string): { x: number; y: number } {
  const rect = item(vm, name)!.screenRect;
  return { x: (rect.left + rect.right) >> 1, y: (rect.top + rect.bottom) >> 1 };
}

/** Amène le pointeur en (x, y), puis clic gauche ; les évènements restent en file pour les images suivantes. */
export function click(vm: Vm, x: number, y: number): void {
  const events = eventsOf(vm);
  events.move(x, y);
  step(vm, 3);
  events.down(MouseButton.Left, x, y);
  events.up(MouseButton.Left, x, y);
}

/** Du démarrage à la librairie, le joueur a la main. `fixes` : correctifs du jeu (ceux de GK1 par défaut). */
export function bookshop(fixes?: GameFixes): Vm {
  const vm = new Vm(mainIndex(), fixes);
  useGameClock(vm);
  vm.boot();
  for (let frames = 0; !(currentRoom(vm) === TITLE_ROOM && item(vm, "playButt")); frames++) {
    if (frames > 5000) throw new Error("écran titre introuvable");
    step(vm);
  }
  step(vm, 120);
  const play = item(vm, "playButt")!.screenRect;
  while (currentRoom(vm) === TITLE_ROOM) {
    click(vm, play.left + 5, play.top + 3);
    step(vm, 20);
  }
  const user = vm.memory.localsSegment(vm.scripts.loaded(0)!.localsSegment)!.values[GLOBAL_USER];
  const value = (name: string): number => toSint16(readSelector(vm.memory, user, vm.selectors.id(name)));
  for (let tries = 0; !(currentRoom(vm) === BOOKSHOP && item(vm, "GKEgo")?.view === WALK_VIEW && value("input") !== 0 && value("controls") !== 0); tries++) {
    if (tries > 500) throw new Error("librairie introuvable");
    eventsOf(vm).keyDown(SciKey.Enter);
    step(vm, 60);
  }
  step(vm, 60);
  return vm;
}
