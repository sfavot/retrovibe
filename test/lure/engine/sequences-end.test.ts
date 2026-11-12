import { describe, expect, it } from "vitest";
import { TICK_MS } from "../../../src/games/lure/engine/cadence";
import { MouseButton } from "../../../src/games/lure/engine/host";
import { METHOD_CATALOG } from "../../../src/games/lure/engine/methods/catalog";
import { ENDGAME_SOUNDS } from "../../../src/games/lure/engine/sequences/ids";
import { SEQUENCE_METHODS } from "../../../src/games/lure/engine/sequences/index";
import { SilentSound } from "../../../src/games/lure/engine/services";
import { hasOriginalFiles, makeEngine } from "./test-host";

class EndSound extends SilentSound {
  readonly events: string[] = [];
  override playMusic(n: number, music: boolean): void {
    this.events.push(`play ${n} ${music}`);
  }
  override killSounds(): void {
    this.events.push("kill");
  }
  loadSection(section: string): void {
    this.events.push(`section ${section}`);
  }
}

describe("méthode 14 endgameSequence", () => {
  it("est la seule méthode du groupe Q", () => {
    expect(METHOD_CATALOG.filter((m) => m.group === "Q").map((m) => m.index)).toEqual([14]);
    expect(Object.keys(SEQUENCE_METHODS)).toEqual(["14"]);
  });

  it("les sons de l'animation suivent la liste de ScummVM", () => {
    expect(ENDGAME_SOUNDS.map((s) => s.numFrames)).toEqual([9, 27, 24, 24, 3, 3, 3, 3, 4, 7, 31]);
    expect(ENDGAME_SOUNDS.map((s) => s.adlibSoundId)).toEqual([0xff, 0x45, 0x48, 0x46, 0x37, 0x37, 0x37, 0x37, 0x37, 0x37, 0x47]);
  });
});

describe.skipIf(!hasOriginalFiles)("la fin du jeu", () => {
  it("joue l'animation, le défilé et l'écran final, attend une touche, puis termine la partie par l'hôte", () => {
    const sound = new EndSound();
    const { engine, host } = makeEngine({ sound });
    engine.tick();
    engine.methods.call(14, 0, 0, 0);
    let ticks = 0;
    const stages = new Set<number>();
    // Sans entrée, la séquence attend la touche de l'écran final : la partie n'est pas finie.
    while (ticks < 4000) {
      engine.tick();
      host.clock += TICK_MS;
      ticks++;
      if (engine.sequenceScreen) stages.add(engine.sequenceScreen.pixels[160 + 100 * 320]!);
    }
    expect(host.exits).toBe(0);
    expect(engine.busy).toBe(true);
    // L'écran final reste affiché jusqu'à la touche (ni noir ni fondu).
    expect(engine.sequenceScreen!.pixels.some((v) => v !== 0)).toBe(true);

    host.push({ type: "pointer", x: 5, y: 5, buttons: MouseButton.Left });
    host.push({ type: "pointer", x: 5, y: 5, buttons: 0 });
    for (let i = 0; i < 60; i++) {
      engine.tick();
      host.clock += TICK_MS;
    }
    expect(host.exits).toBe(1);
    // L'écran est noir et le moteur figé jusqu'à ce que l'hôte ferme la partie.
    expect(engine.sequenceScreen!.palette.subarray(0, 660).every((v) => v === 0)).toBe(true);
    const room = engine.room.roomNumber;
    for (let i = 0; i < 30; i++) engine.tick();
    expect(engine.room.roomNumber).toBe(room);
    expect(host.exits).toBe(1);

    // La musique : l'animation, la musique de fin, la section « fin », le morceau 0.
    expect(sound.events).toContain("play 69 true");
    expect(sound.events).toContain("play 40 false");
    expect(sound.events.indexOf("section ending")).toBeGreaterThan(sound.events.indexOf("play 40 false"));
    expect(sound.events.at(-1)).not.toBe("section main");
    expect(sound.events.filter((e) => e === "play 0 true")).toHaveLength(1);
  });

  it("une touche ou un clic passe l'animation et les attentes (la partie se termine plus tôt)", () => {
    const { engine, host } = makeEngine();
    engine.tick();
    engine.methods.call(14, 0, 0, 0);
    let ticks = 0;
    while (host.exits === 0 && ticks < 4000) {
      if (ticks % 20 === 0) host.push({ type: "action", action: "indexSelect" });
      engine.tick();
      host.clock += TICK_MS;
      ticks++;
    }
    expect(host.exits).toBe(1);
    expect(ticks * TICK_MS).toBeLessThan(120_000);
  });
});
