import { describe, expect, it } from "vitest";
import { TICK_MS } from "../../../src/games/lure/engine/cadence";
import { MouseButton } from "../../../src/games/lure/engine/host";
import { Field, HotspotId } from "../../../src/games/lure/engine/ids";
import { barrelSequence, captureSequence, chuteSequence } from "../../../src/games/lure/engine/sequences/index";
import { SilentSound } from "../../../src/games/lure/engine/services";
import type { LureEngine } from "../../../src/games/lure/engine/game";
import { hasOriginalFiles, makeEngine, type TestHost } from "./test-host";

/** Son muet qui retient aussi les appels propres aux séquences (sections, fondu de la musique). */
class RecordingSound extends SilentSound {
  readonly events: string[] = [];
  fading = false;
  private fadeEnd = 0;
  now = 0;

  override playMusic(n: number, music: boolean): void {
    this.events.push(`play ${n} ${music}`);
    super.playMusic(n, music);
  }
  override killSounds(): void {
    this.events.push("kill");
    super.killSounds();
  }
  loadSection(section: string): void {
    this.events.push(`section ${section}`);
  }
  startFadeOut(): void {
    this.events.push("fadeOut");
    this.fading = true;
    this.fadeEnd = this.now + 3000;
  }
  finishFadeOut(aborted?: boolean): void {
    this.events.push(aborted ? "fadeOut aborted" : "fadeOut done");
    this.fading = false;
  }
  advance(ms: number): void {
    this.now += ms;
    if (this.fading && this.now >= this.fadeEnd) this.fading = false;
  }
}

/** Fait tourner le moteur tant qu'une séquence est en cours ; rend le nombre de ticks. */
function runBusy(engine: LureEngine, host: TestHost, sound?: RecordingSound, max = 10_000): number {
  let ticks = 0;
  do {
    engine.tick();
    host.clock += TICK_MS;
    sound?.advance(TICK_MS);
    ticks++;
  } while (engine.busy && ticks < max);
  return ticks;
}

function pressEscape(host: TestHost): void {
  host.push({ type: "action", action: "escape" });
}

describe.skipIf(!hasOriginalFiles)("introduction", () => {
  it("se déroule jusqu'à la cellule : durée, écrans, musique, puis le jeu démarre", () => {
    const sound = new RecordingSound();
    const { engine, host } = makeEngine({ intro: true, sound });
    const seen = new Set<number>();
    let ticks = 0;
    do {
      engine.tick();
      host.clock += TICK_MS;
      sound.advance(TICK_MS);
      ticks++;
      if (engine.sequenceScreen) seen.add(engine.sequenceScreen.pixels[160 + 100 * 320]!);
    } while (engine.busy && ticks < 6000);

    // 244 s environ : 4 écrans fixes, 5 animations, les images de la bataille, l'écran final (hors fondus bloquants de ScummVM).
    expect((ticks * TICK_MS) / 1000).toBeGreaterThan(235);
    expect((ticks * TICK_MS) / 1000).toBeLessThan(255);
    expect(engine.sequenceScreen).toBeNull();
    expect(seen.size).toBeGreaterThan(3);

    // La musique : sections introduction puis jeu, morceaux 0 (fondu, 3 s) puis 1, 2, 3.
    expect(sound.events.filter((e) => e.startsWith("play"))).toEqual(["play 0 true", "play 1 true", "play 2 true", "play 3 true"]);
    expect(sound.events[0]).toBe("section intro");
    expect(sound.events.at(-1)).toBe("section main");
    expect(sound.events).toContain("fadeOut");
    expect(sound.events).toContain("fadeOut done");

    // Puis la partie : le jeu démarre dans la cellule (pièce 1) sans fondu ni rendu.
    for (let i = 0; i < 4; i++) engine.tick();
    expect(engine.room.roomNumber).toBe(1);
    expect(engine.busy).toBe(false);
  });

  it("Échap l'abandonne tout de suite, à n'importe quel moment", () => {
    // (pas avant la fin du premier fondu : comme dans ScummVM, les touches pendant un fondu sont perdues)
    for (const at of [20, 40, 300, 900, 2000]) {
      const sound = new RecordingSound();
      const { engine, host } = makeEngine({ intro: true, sound });
      let ticks = 0;
      while (ticks < at) {
        engine.tick();
        host.clock += TICK_MS;
        sound.advance(TICK_MS);
        ticks++;
      }
      expect(engine.busy, `au tick ${at}`).toBe(true);
      pressEscape(host);
      const more = runBusy(engine, host, sound);
      // (les écrans fixes se fondent d'abord au noir, comme dans ScummVM : 1,1 s)
      expect(more, `au tick ${at}`).toBeLessThan(20);
      expect(engine.sequenceScreen).toBeNull();
      engine.tick();
      engine.tick();
      expect(engine.room.roomNumber).toBe(1);
      expect(sound.events.at(-1)).toBe("section main");
    }
  });

  it("un clic passe l'écran ou l'attente en cours, sans abandonner l'introduction", () => {
    const { engine, host } = makeEngine({ intro: true });
    // Écran de la société : 5 s d'attente passées par un clic.
    for (let i = 0; i < 20; i++) engine.tick();
    const before = engine.sequenceScreen!.pixels.slice();
    host.push({ type: "pointer", x: 100, y: 100, buttons: MouseButton.Left });
    host.push({ type: "pointer", x: 100, y: 100, buttons: 0 });
    // fondu sortant (1,1 s) puis l'écran suivant
    for (let i = 0; i < 40; i++) engine.tick();
    expect(engine.busy).toBe(true);
    expect(engine.sequenceScreen!.pixels.some((v, i) => v !== before[i])).toBe(true);
    // la suite dure encore : l'introduction n'est pas finie
    for (let i = 0; i < 100; i++) engine.tick();
    expect(engine.busy).toBe(true);
  });

  it("des clics répétés la font défiler beaucoup plus vite, Échap l'arrête", () => {
    const sound = new RecordingSound();
    const { engine, host } = makeEngine({ intro: true, sound });
    let ticks = 0;
    while (engine.busy && ticks < 6000) {
      if (ticks % 10 === 0) {
        host.push({ type: "pointer", x: 10, y: 10, buttons: MouseButton.Left });
        host.push({ type: "pointer", x: 10, y: 10, buttons: 0 });
      }
      engine.tick();
      host.clock += TICK_MS;
      sound.advance(TICK_MS);
      ticks++;
    }
    expect(engine.busy).toBe(false);
    expect((ticks * TICK_MS) / 1000).toBeLessThan(120);
  });
});

describe.skipIf(!hasOriginalFiles)("séquences plein écran de la partie", () => {
  it("la chute : trois animations, la musique 0x40, puis la pièce suivante", () => {
    const sound = new RecordingSound();
    const { engine, host } = makeEngine({ sound });
    engine.tick();
    engine.block(chuteSequence(engine));
    const ticks = runBusy(engine, host, sound);
    expect(ticks * TICK_MS).toBeGreaterThan(8_000);
    expect(sound.events).toContain("play 64 true");
    expect(sound.events.at(-1)).toBe("kill");
    expect(engine.sequenceScreen).toBeNull();
  });

  it("le tonneau et la capture se jouent jusqu'au bout", () => {
    for (const [name, make, music] of [
      ["tonneau", barrelSequence, "play 59 true"],
      ["capture", captureSequence, "play 41 false"],
    ] as const) {
      const sound = new RecordingSound();
      const { engine, host } = makeEngine({ sound });
      engine.tick();
      engine.block(make(engine));
      const ticks = runBusy(engine, host, sound);
      expect(ticks, name).toBeGreaterThan(30);
      expect(sound.events, name).toContain(music);
      expect(engine.sequenceScreen, name).toBeNull();
    }
  });

  it("la chute change de pièce à la fin, avec les effets de ScummVM (zone, ambiance)", () => {
    const sound = new RecordingSound();
    const { engine, host } = makeEngine({ sound });
    engine.tick();
    const fields = engine.world.fields;
    fields.set(Field.ROOM_EXIT_ANIMATION, 1);
    fields.playerNewPos.roomNumber = 14;
    fields.playerNewPos.x = 100;
    fields.playerNewPos.y = 100;
    engine.tick();
    expect(engine.busy).toBe(true);
    expect(engine.sequenceScreen).not.toBeNull();
    expect(engine.room.roomNumber, "la pièce d'avant reste la pièce courante pendant l'animation").toBe(1);
    runBusy(engine, host, sound);
    expect(engine.room.roomNumber).toBe(14);
    expect(fields.get(Field.AREA_FLAG)).toBe(1);
    expect(fields.get(Field.ROOM_EXIT_ANIMATION)).toBe(0);
    expect(engine.world.requireActiveHotspot(HotspotId.PLAYER).roomNumber).toBe(14);
  });

  it("le tonneau retire les personnages du village", () => {
    const { engine, host } = makeEngine();
    engine.tick();
    const fields = engine.world.fields;
    fields.set(Field.ROOM_EXIT_ANIMATION, 2);
    fields.playerNewPos.roomNumber = 14;
    engine.tick();
    runBusy(engine, host);
    expect(engine.room.roomNumber).toBe(14);
    expect(engine.world.getActiveHotspot(HotspotId.BLACKSMITH)).toBeNull();
  });

  it("une chute s'abrège : un clic passe à l'animation suivante, Échap quitte toute la séquence", () => {
    const full = (() => {
      const { engine, host } = makeEngine();
      engine.tick();
      engine.block(chuteSequence(engine));
      return runBusy(engine, host);
    })();
    const { engine, host } = makeEngine();
    engine.tick();
    engine.block(chuteSequence(engine));
    for (let i = 0; i < 60; i++) engine.tick();
    pressEscape(host);
    const ticks = 60 + runBusy(engine, host);
    expect(ticks).toBeLessThan(full / 2);
    expect(engine.sequenceScreen).toBeNull();
  });

  it("pendant une séquence : sauvegarde refusée, entrées ignorées, monde figé", () => {
    const { engine, host } = makeEngine();
    engine.tick();
    engine.block(barrelSequence(engine));
    engine.tick();
    expect(engine.isMenuAvailable).toBe(false);
    const ticksBefore = engine.world.activeHotspots.length;
    host.push({ type: "action", action: "saveGame" });
    engine.tick();
    expect(host.saveDialogs).toEqual([]);
    expect(engine.world.activeHotspots.length).toBe(ticksBefore);
  });
});
