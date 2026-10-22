import { describe, expect, it } from "vitest";
import { parseLic } from "../../src/games/lost-in-time/data/lic";
import type { CdBackend, SoundBackend, SoundSource } from "../../src/games/lost-in-time/engine/audio/backend";
import { CdAudio } from "../../src/games/lost-in-time/engine/audio/cd";
import { SoundEngine } from "../../src/games/lost-in-time/engine/audio/sound";
import { hasOriginalFiles, readOriginal } from "./helpers";

/** Horloge simulée : nextFrame avance de 16 ms. */
class Clock {
  time = 0;
  now = (): number => this.time;
  nextFrame = async (): Promise<void> => {
    this.time += 16;
  };
}

class FakeCd implements CdBackend {
  calls: string[] = [];
  playing = false;
  /** Vrai : le flux « sort » vraiment du son et currentTime fait foi. */
  streaming = false;
  currentTime = 0;
  range: [number, number] | null = null;
  play(start: number, end: number): void {
    this.calls.push(`play ${start.toFixed(3)} ${end.toFixed(3)}`);
    this.range = [start, end];
    this.playing = this.streaming;
    this.currentTime = start;
  }
  stop(): void {
    this.calls.push("stop");
    this.playing = false;
  }
}

class FakeSound implements SoundBackend {
  calls: string[] = [];
  playSample(pcm: Int8Array, rate: number, passes: number): void {
    this.calls.push(`play ${pcm.length}@${rate} x${passes}`);
  }
  stopSample(fade: number): void {
    this.calls.push(`stop ${fade}`);
  }
  queuePcm(pcm: Int8Array, rate: number): void {
    this.calls.push(`queue ${pcm.length}@${rate} first=${pcm[0]}`);
  }
  clearQueue(): void {
    this.calls.push("clear");
  }
}

/** Fichier SND : taille u32 BE, fréquence u16 BE, puis `size` octets. */
function snd(size: number, frequency: number): Uint8Array {
  const out = new Uint8Array(6 + size);
  new DataView(out.buffer).setUint32(0, size, false);
  new DataView(out.buffer).setUint16(4, frequency, false);
  return out;
}

describe.skipIf(!hasOriginalFiles)("CD (LOST.LIC)", () => {
  const lic = readOriginal("LOST.LIC");
  const tracks = parseLic(lic);

  function setup() {
    const clock = new Clock();
    const backend = new FakeCd();
    const cd = new CdAudio({ backend, now: clock.now, getFile: (n) => (n === "LOST.LIC" ? lic : undefined) });
    cd.loadLic("LOST.LIC");
    return { clock, backend, cd };
  }

  it("retrouve les plages sans tenir compte de la casse", () => {
    const { cd } = setup();
    expect(cd.find("pla001")).toMatchObject({ name: "PLA001", startSector: 50, endSector: 562 });
    expect(cd.find("nope")).toBeNull();
    expect(tracks.length).toBe(348);
  });

  it("convertit les secteurs en secondes du fichier (relatif à la piste, 75/s)", () => {
    const { cd, backend } = setup();
    cd.play("pla002");
    expect(backend.range![0]).toBeCloseTo(620 / 75, 6);
    expect(backend.range![1]).toBeCloseTo(999 / 75, 6);
    expect(cd.getCurrentTrack()).toBe("PLA002");
  });

  it("ignore une plage inconnue sans toucher à la lecture", () => {
    const { cd, backend } = setup();
    cd.play("PLA001");
    cd.play("INCONNUE");
    expect(cd.getCurrentTrack()).toBe("PLA001");
    expect(backend.calls).toEqual(["stop", "play 0.667 7.507"]);
  });

  it("position : horloge sans flux audio, puis -1 deux secondes après la fin", () => {
    const { cd, clock } = setup();
    expect(cd.getTrackPos()).toBe(-1);
    cd.play("PLA001"); // 513 secteurs = 6840 ms
    clock.time = 1000;
    expect(cd.getTrackPos()).toBe(75);
    clock.time = 6840 + 1999;
    expect(cd.getTrackPos()).toBeGreaterThan(513);
    clock.time = 6840 + 2000;
    expect(cd.getTrackPos()).toBe(-1);
  });

  it("position : suit currentTime du flux quand il joue", () => {
    const { cd, backend, clock } = setup();
    backend.streaming = true;
    cd.play("PLA001");
    clock.time = 5000;
    backend.currentTime = backend.range![0] + 2; // le flux n'a avancé que de 2 s
    expect(cd.getTrackPos()).toBe(150);
  });

  it("plage-clé : -2 avant, position pendant, -1 après (relatif au début de la plage jouée)", () => {
    const { cd, clock } = setup();
    const outer = tracks.find((t) => t.name === "FIN8")!; // 2..5954
    const key = tracks.find((t) => t.startSector > outer.startSector + 400 && t.endSector < outer.endSector - 400 && t.name !== "FIN8")!;
    expect(key).toBeDefined();
    cd.play("FIN8");
    const keyStart = key.startSector - outer.startSector;
    const keyEnd = key.endSector - outer.startSector;
    clock.time = 0;
    expect(cd.getTrackPos(key.name)).toBe(-2);
    clock.time = Math.ceil(((keyStart + 1) * 40) / 3);
    expect(cd.getTrackPos(key.name)).toBeGreaterThanOrEqual(keyStart);
    expect(cd.getTrackPos(key.name)).toBeLessThanOrEqual(keyEnd);
    clock.time = Math.ceil(((keyEnd + 5) * 40) / 3);
    expect(cd.getTrackPos(key.name)).toBe(-1);
    // plage-clé = plage jouée, ou hors de la plage jouée : position brute
    expect(cd.getTrackPos("FIN8")).toBeGreaterThan(keyEnd);
    expect(cd.getTrackPos("PLA007")).toBeGreaterThan(keyEnd);
    expect(cd.getTrackPos("INCONNUE")).toBeGreaterThan(keyEnd);
  });

  it("stop, freeLIC et relecture du LIC", () => {
    const { cd } = setup();
    cd.play("PLA001");
    cd.stop();
    expect(cd.getTrackPos()).toBe(-1);
    expect(cd.getCurrentTrack()).toBe("PLA001");
    cd.loadLic("LOST.LIC");
    expect(cd.getCurrentTrack()).toBe("");
    cd.unloadLic();
    cd.play("PLA001");
    expect(cd.getTrackPos()).toBe(-1);
  });
});

describe("sons (emplacements et canal)", () => {
  function setup(files: Record<string, Uint8Array> = {}, resources: Record<number, Uint8Array> = {}) {
    const clock = new Clock();
    const backend = new FakeSound();
    const source: SoundSource = {
      getFile: (n) => files[n.toUpperCase()],
      getResource: (id) => resources[id] ?? null,
    };
    const sound = new SoundEngine({ backend, host: clock, source });
    return { clock, backend, sound };
  }

  it("charge depuis une ressource ou un fichier, libère", () => {
    const { sound } = setup({ "BOUM.SND": snd(1000, 8000) }, { 7: snd(500, 5000) });
    sound.load({ slot: 3, adlib: false, id: 7, name: null });
    sound.load({ slot: 4, adlib: false, id: -1, name: "boum" });
    sound.load({ slot: 5, adlib: false, id: 99, name: null });
    expect(sound.isSlotEmpty(3)).toBe(false);
    expect(sound.isSlotEmpty(4)).toBe(false);
    expect(sound.isSlotEmpty(5)).toBe(true);
    expect(sound.findSlotById(7)).toBe(3);
    sound.freeSlot(3);
    expect(sound.isSlotEmpty(3)).toBe(true);
    expect(sound.play(3, 1, 0)).toBeNull();
  });

  it("joue une fois : isPlaying vrai pendant taille / fréquence, puis faux", () => {
    const { sound, clock, backend } = setup({}, { 1: snd(8000, 8000) });
    sound.load({ slot: 0, adlib: false, id: 1, name: null });
    expect(sound.play(0, 1, 0)).toBeNull();
    expect(backend.calls).toEqual(["play 8000@8000 x1"]);
    clock.time = 999;
    expect(sound.isPlaying()).toBe(true);
    clock.time = 1000;
    expect(sound.isPlaying()).toBe(false);
  });

  it("répétitions : n répétitions donnent max(1, n-1) passes ; 0 boucle", () => {
    const { sound, clock } = setup({}, { 1: snd(1000, 4800) });
    sound.load({ slot: 0, adlib: false, id: 1, name: null });
    const dur = 1000 / 4.8; // ms par passe
    for (const [rep, passes] of [[1, 1], [2, 1], [3, 2], [5, 4]] as const) {
      clock.time = 0;
      sound.stop(0);
      sound.play(0, rep, 0);
      clock.time = dur * passes - 1;
      expect(sound.isPlaying(), `rep ${rep}`).toBe(true);
      clock.time = dur * passes + 1;
      expect(sound.isPlaying(), `rep ${rep}`).toBe(false);
    }
    sound.play(0, 0, 0);
    clock.time = 1e7;
    expect(sound.isPlaying()).toBe(true);
    sound.stop(0);
    expect(sound.isPlaying()).toBe(false);
  });

  it("répétition négative : délai avant arrêt et durée du fondu comme ScummVM", () => {
    const { sound } = setup({}, { 1: snd(10000, 5000) });
    sound.load({ slot: 0, adlib: false, id: 1, name: null });
    // endRep = max(4-1,1) = 3 ; (10000*3 - 5000) * 1000 / 5000 = 5000 ms ; fondu 10*5000/5000 = 10
    expect(sound.play(0, -4, 0)).toEqual({ endMs: 5000, fadeOut: 10 });
    expect(sound.play(0, -1, 0)).toEqual({ endMs: 1000, fadeOut: 10 });
  });

  it("la fréquence demandée remplace celle du son, durablement", () => {
    const { sound, clock, backend } = setup({}, { 1: snd(1000, 5000) });
    sound.load({ slot: 0, adlib: false, id: 1, name: null });
    sound.play(0, 1, 10000);
    sound.stop(0);
    sound.play(0, 1, 0);
    expect(backend.calls.filter((c) => c.startsWith("play"))).toEqual(["play 1000@10000 x1", "play 1000@10000 x1"]);
    clock.time = 99;
    expect(sound.isPlaying()).toBe(true);
    clock.time = 101;
    expect(sound.isPlaying()).toBe(false);
  });

  it("stop avec fondu : joue jusqu'à la fin du fondu ; freeSlot arrête le son courant", () => {
    const { sound, clock, backend } = setup({}, { 1: snd(100000, 5000), 2: snd(100000, 5000) });
    sound.load({ slot: 0, adlib: false, id: 1, name: null });
    sound.load({ slot: 1, adlib: false, id: 2, name: null });
    sound.play(0, 1, 0);
    sound.stop(5); // 0,5 s
    expect(backend.calls.at(-1)).toBe("stop 0.5");
    clock.time = 499;
    expect(sound.isPlaying()).toBe(true);
    clock.time = 500;
    expect(sound.isPlaying()).toBe(false);
    clock.time = 0;
    sound.play(0, 1, 0);
    sound.freeSlot(1); // pas le son courant
    expect(sound.isPlaying()).toBe(true);
    sound.freeSlot(0);
    expect(sound.isPlaying()).toBe(false);
  });

  it("freeLoadedSamples libère les SND mais pas les ADL ; recharger un ADL joué l'arrête", () => {
    const { sound } = setup({}, { 1: snd(100, 5000), 2: new Uint8Array(100).fill(1) });
    sound.load({ slot: 0, adlib: false, id: 1, name: null });
    sound.load({ slot: 1, adlib: true, id: 2, name: null });
    sound.play(1, 1, 0);
    expect(sound.adlibPlaying).toBe(true);
    sound.freeLoadedSamples();
    expect(sound.isSlotEmpty(0)).toBe(true);
    expect(sound.isSlotEmpty(1)).toBe(false);
    expect(sound.isPlaying()).toBe(false); // l'ADL n'alimente pas la variable 1
    sound.load({ slot: 1, adlib: true, id: 2, name: null });
    expect(sound.adlibPlaying).toBe(false);
    sound.play(1, 1, 0);
    sound.stopAdlib();
    expect(sound.adlibPlaying).toBe(false);
  });

  it("composition : enchaîne les SND sans trou et saute les emplacements vides", async () => {
    const { sound, clock, backend } = setup({}, { 1: snd(1000, 5000), 2: snd(500, 5000) });
    sound.load({ slot: 0, adlib: false, id: 1, name: null });
    sound.load({ slot: 2, adlib: false, id: 2, name: null });
    await sound.playComposition([0, 1, 2, -1], 0);
    expect(sound.playingSlot).toBe(0);
    clock.time = 199;
    expect(sound.isPlaying()).toBe(true);
    clock.time = 201; // 200 ms : début du suivant (slot 2, 100 ms)
    expect(sound.isPlaying()).toBe(true);
    expect(sound.playingSlot).toBe(2);
    clock.time = 299;
    expect(sound.isPlaying()).toBe(true);
    clock.time = 301;
    expect(sound.isPlaying()).toBe(false);
    expect(backend.calls.filter((c) => c.startsWith("play")).length).toBe(2);
  });

  it("waitEndPlay attend la fin du canal", async () => {
    const { sound, clock } = setup({}, { 1: snd(5000, 5000) });
    sound.load({ slot: 0, adlib: false, id: 1, name: null });
    sound.play(0, 1, 0);
    await sound.waitEndPlay();
    expect(clock.time).toBeGreaterThanOrEqual(1000);
    expect(sound.isPlaying()).toBe(false);
  });

  it("sauvegarde / restauration des emplacements 0..9", () => {
    const { sound } = setup({}, { 1: snd(100, 5000) });
    sound.load({ slot: 2, adlib: false, id: 1, name: null });
    sound.backupSlots(0);
    expect(sound.isSlotEmpty(2)).toBe(true);
    sound.load({ slot: 2, adlib: false, id: 1, name: null });
    sound.restoreSlots(0);
    expect(sound.isSlotEmpty(2)).toBe(false);
  });

  it("son des vidéos IMD : file non signée -> signée, isPlaying jusqu'à la dernière tranche", () => {
    const { sound, clock, backend } = setup();
    sound.queueImdSlice(new Uint8Array(1000).fill(0x80), 10000); // 100 ms
    sound.queueImdSlice(new Uint8Array(1000).fill(0xff), 10000);
    expect(backend.calls).toEqual(["queue 1000@10000 first=0", "queue 1000@10000 first=127"]);
    clock.time = 199;
    expect(sound.isPlaying()).toBe(true);
    clock.time = 200;
    expect(sound.isPlaying()).toBe(false);
    sound.queueImdSlice(new Uint8Array(10), 10000);
    sound.stopImdAudio();
    expect(sound.isPlaying()).toBe(false);
  });
});
