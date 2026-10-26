import { expect } from "vitest";
import type { MusicContext, MusicPreference } from "../../../src/games/swiv3d/audio";
import type { ControllerType } from "../../../src/games/swiv3d/screens/controllers";
import type { Flow, FlowHost, LevelRequest, UiInput, UiKey } from "../../../src/games/swiv3d/screens/flow";
import type { Pilot, Volumes } from "../../../src/games/swiv3d/screens/pilots";

/** Hôte du flux qui note ce qu'on lui demande (tests des écrans). */
export class FakeHost implements FlowHost {
  sounds: number[] = [];
  contexts: MusicContext[] = [];
  preferences: MusicPreference[] = [];
  volumeCalls: Volumes[] = [];
  levels: LevelRequest[] = [];
  ended = 0;
  paused: boolean[] = [];
  left = 0;
  existing = new Set(["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03"]);
  gammas: number[] = [];
  devices = new Set<ControllerType>([1]);
  cheats: ({ pickup: number } | { form: number })[] = [];
  /** Profils rechargés à la sortie du Setup ouvert en jeu (noms des pilotes). */
  loadedControls: string[] = [];
  sound(n: number): void {
    this.sounds.push(n);
  }
  music(c: MusicContext): void {
    this.contexts.push(c);
  }
  musicPreference(p: MusicPreference): void {
    this.preferences.push(p);
  }
  volumes(v: Volumes): void {
    this.volumeCalls.push({ ...v });
  }
  startLevel(r: LevelRequest): void {
    this.levels.push(r);
  }
  endLevel(): void {
    this.ended++;
  }
  pauseLevel(p: boolean): void {
    this.paused.push(p);
  }
  hasLevel(name: string): boolean {
    return this.existing.has(name);
  }
  leave(): void {
    this.left++;
  }
  gamma(level: number): void {
    this.gammas.push(level);
  }
  hasController(type: ControllerType): boolean {
    return this.devices.has(type);
  }
  loadControls(pilot: Pilot): void {
    this.loadedControls.push(pilot.name);
  }
  cheat(effect: { pickup: number } | { form: number }): void {
    this.cheats.push(effect);
  }
}

export const NONE: UiInput = { keys: [], typed: [], taps: [], pressed: false, scans: [] };

/** Pilote le flux image par image comme l'application : touches, saisie, choix d'un id. */
export class Driver {
  now = 1000;
  constructor(readonly flow: Flow) {}
  /** `n` images sans entrée (16 ms chacune). */
  idle(n = 6): void {
    for (let i = 0; i < n; i++) {
      this.now += 16;
      this.flow.update(this.now, NONE);
    }
  }
  /** Laisse passer la garde d'Entrée, appuie, laisse passer une image. */
  press(...keys: UiKey[]): void {
    this.idle();
    this.now += 16;
    this.flow.update(this.now, { ...NONE, keys, typed: [...keys], pressed: keys.length > 0 });
    this.idle(1);
  }
  type(text: string): void {
    this.idle();
    this.now += 16;
    this.flow.update(this.now, { ...NONE, typed: [...text].map((char) => ({ char })), pressed: true });
  }
  /** Touche ou bouton de code `scan` (capture d'une touche). */
  scan(scan: number): void {
    this.now += 16;
    this.flow.update(this.now, { ...NONE, scans: [scan], pressed: true });
    this.idle(1);
  }
  anyKey(): void {
    this.now += 16;
    this.flow.update(this.now, { ...NONE, pressed: true });
  }
  wait(ms: number): void {
    this.now += ms;
    this.flow.update(this.now, NONE);
  }
  get ids(): number[] {
    const v = this.flow.view;
    return v.kind === "menu" ? v.menu.ids() : [];
  }
  get selected(): number {
    const v = this.flow.view;
    return v.kind === "menu" ? v.menu.selected : -1;
  }
  /** Choisit l'élément `id` du menu courant : descend jusqu'à lui puis valide. */
  choose(id: number): void {
    const v = this.flow.view;
    if (v.kind !== "menu") throw new Error("pas de menu");
    for (let i = 0; i < 20 && this.selected !== id; i++) this.press("down");
    expect(this.selected).toBe(id);
    this.press("enter");
  }
}

