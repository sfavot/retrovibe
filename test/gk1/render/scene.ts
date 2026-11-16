import { fromInt, type Reg, toSint16 } from "../../../src/games/gk1/engine/memory";
import { readSelector, writeSelector } from "../../../src/games/gk1/engine/object";
import { Vm } from "../../../src/games/gk1/engine/vm";
import { type Frameout, frameoutOf } from "../../../src/games/gk1/render/frameout";
import { SCREEN_WIDTH } from "../../../src/games/gk1/render/ids";
import { mainIndex } from "../data/real";

/** Machine virtuelle sur les scripts réels, sans lancer le jeu : les objets graphiques sont des clones des classes du système. */
export class Scene {
  readonly vm = new Vm(mainIndex());
  readonly frameout: Frameout;

  constructor() {
    this.vm.useGlobals(this.vm.scripts.instantiate(0).localsSegment);
    this.frameout = frameoutOf(this.vm);
  }

  /** Appelle une fonction du noyau par son nom. */
  kernel(name: string, ...args: number[]): Reg {
    return this.vm.kernel.call(this.vm, this.vm.kernel.indexOf(name), Uint32Array.from(args, fromInt));
  }

  /** Appelle une fonction du noyau dont les arguments sont des références. */
  kernelOn(name: string, ...args: Reg[]): Reg {
    return this.vm.kernel.call(this.vm, this.vm.kernel.indexOf(name), Uint32Array.from(args));
  }

  classNamed(name: string): Reg {
    for (let species = 0; species < this.vm.scripts.classCount; species++) {
      const address = this.vm.scripts.classAddress(species, 0);
      if (this.vm.nameOf(address) === name) return address;
    }
    throw new Error(`classe ${name} introuvable`);
  }

  /** Clone d'une classe, avec ces propriétés. */
  make(className: string, properties: Record<string, number>): Reg {
    const object = this.kernelOn("Clone", this.classNamed(className));
    this.set(object, properties);
    return object;
  }

  set(object: Reg, properties: Record<string, number>): void {
    for (const [name, value] of Object.entries(properties)) writeSelector(this.vm.memory, object, this.vm.selectors.id(name), value >= 0x10000 ? value : fromInt(value));
  }

  get(object: Reg, name: string): number {
    return toSint16(readSelector(this.vm.memory, object, this.vm.selectors.id(name)));
  }

  /** Plan couvrant ce rectangle (bords compris), ajouté au compositeur. */
  plane(left: number, top: number, right: number, bottom: number, properties: Record<string, number> = {}): Reg {
    const plane = this.make("Plane", { inLeft: left, inTop: top, inRight: right, inBottom: bottom, priority: 1, picture: -1, ...properties });
    this.kernelOn("AddPlane", plane);
    return plane;
  }

  /** Vue ajoutée à un plan. */
  view(plane: Reg, properties: Record<string, number>): Reg {
    const view = this.make("View", { plane, ...properties });
    this.kernelOn("AddScreenItem", view);
    return view;
  }

  nowSeen(object: Reg): number[] {
    this.kernelOn("SetNowSeen", object);
    return ["nsLeft", "nsTop", "nsRight", "nsBottom"].map((name) => this.get(object, name));
  }

  onMe(object: Reg, x: number, y: number, checkPixel: boolean): boolean {
    return this.vm.kernel.call(this.vm, this.vm.kernel.indexOf("OnMe"), Uint32Array.of(fromInt(x), fromInt(y), object, checkPixel ? 1 : 0)) !== 0;
  }

  pixel(x: number, y: number): number {
    return this.frameout.screen[y * SCREEN_WIDTH + x];
  }
}
