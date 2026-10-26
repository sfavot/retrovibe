import { describe, expect, it } from "vitest";
import type { RiffWave } from "../../../src/data/riff-wave";
import { SOUND_CATALOG } from "../../../src/games/swiv3d/audio/catalog";
import {
  SoundSystem,
  centibelToGain,
  directSoundPanToStereo,
  spatialize,
  type PlayOptions,
  type SoundSink,
} from "../../../src/games/swiv3d/audio/sounds";
import type { Listener } from "../../../src/games/swiv3d/audio/events";
import { parseSoundBank, type SoundBank } from "../../../src/games/swiv3d/data/sounds";
import { hasOriginalFiles, readOriginal } from "../helpers";

class FakeSink implements SoundSink {
  log: string[] = [];
  voices = new Map<number, PlayOptions & { buffer: number }>();
  private next = 1;
  createBuffer(wave: RiffWave): number {
    this.log.push(`buffer ${wave.data.length}`);
    return this.next++ + 1000;
  }
  play(buffer: number, o: PlayOptions): number {
    const id = this.next++;
    this.voices.set(id, { ...o, buffer });
    this.log.push(`play ${id} b${buffer}${o.loop ? " loop" : ""} g${o.gain.toFixed(3)} p${o.pan.toFixed(3)}`);
    return id;
  }
  setGain(v: number, g: number): void {
    this.voices.get(v)!.gain = g;
    this.log.push(`gain ${v} ${g.toFixed(3)}`);
  }
  setPan(v: number, p: number): void {
    this.voices.get(v)!.pan = p;
    this.log.push(`pan ${v} ${p.toFixed(3)}`);
  }
  setRate(v: number, r: number): void {
    this.voices.get(v)!.rate = r;
    this.log.push(`rate ${v} ${r.toFixed(3)}`);
  }
  stop(v: number): void {
    this.voices.delete(v);
    this.log.push(`stop ${v}`);
  }
  setMuted(m: boolean): void {
    this.log.push(`muted ${m}`);
  }
  /** Fin naturelle d'un son. */
  finish(v: number): void {
    const o = this.voices.get(v)!;
    this.voices.delete(v);
    o.onEnded();
  }
}

function fakeBank(ids: number[]): SoundBank {
  const sounds = ids.map((id) => ({
    id,
    offset: 0,
    wave: { format: 1, channels: 1, sampleRate: 11025, bitsPerSample: 8, data: new Uint8Array(10) },
  }));
  return { sounds, get: (id) => sounds.find((s) => s.id === id) };
}

const origin: Listener = { x: 0, y: 0, z: 0, yaw: 0 };

describe("spatialize (gm_sounds_update_3d)", () => {
  it("devant, centré : pan 0, volume -(profondeur)", () => {
    expect(spatialize(origin, 0, 0, 100)).toEqual({ pan: 0, volume: -100 });
  });

  it("devant et à droite : pan = 256·dx / (profondeur/32 + 80)", () => {
    // depth = 256·200 = 51200 ; prof = 51200 >> 13 = 6 ; pan = trunc(25600 / 86) = 297
    expect(spatialize(origin, 100, 0, 200)).toEqual({ pan: 297, volume: -200 });
    expect(spatialize(origin, -100, 0, 200)).toEqual({ pan: -297, volume: -200 });
  });

  it("derrière la caméra : volume maximal (comportement d'origine)", () => {
    expect(spatialize(origin, 0, 0, -100).volume).toBe(0);
  });

  it("borne le volume à -10000 et le pan à ±10000", () => {
    expect(spatialize(origin, 0, 0, 9000).volume).toBe(-9000);
    expect(spatialize(origin, 0, 0, 20000).volume).toBe(-10000);
    expect(spatialize(origin, 9999, 0, 0).pan).toBe(10000); // 256·9999/85 > 10000
  });

  it("le cap tourne la base : à yaw = π/2 l'avant est +x et la droite est -z", () => {
    const l: Listener = { x: 0, y: 0, z: 0, yaw: Math.PI / 2 };
    expect(spatialize(l, 100, 0, 0).volume).toBe(-100);
    expect(spatialize(l, 0, 0, -100).pan).toBeGreaterThan(0);
  });

  it("utilise la position entière de la caméra (tronquée) et celle de la source (plancher)", () => {
    const l: Listener = { x: 10.9, y: 0, z: 0, yaw: 0 };
    expect(spatialize(l, 10.5, 0, 100)).toEqual({ pan: 0, volume: -100 });
  });

  it("corrige les distances à la couture du tore (x : ±0x8000, z négatif : +0x7ff6)", () => {
    const l: Listener = { x: 100, y: 0, z: 0, yaw: 0 };
    // dx = 32700 - 100 = 32600 > 10000 → -168 ; devant = 0 → prof 5 ; pan = trunc(-168·256 / 85)
    expect(spatialize(l, 32700, 0, 0)).toEqual({ pan: Math.trunc((-168 * 256) / 85), volume: 0 });
    // dz = 100 - 32700 → -32600 < -10000 → +0x7ff6 = 32758 → 158 devant : volume -158
    expect(spatialize({ x: 0, y: 0, z: 32700, yaw: 0 }, 0, 0, 100).volume).toBe(-158);
  });

  it("accepte une base de caméra explicite (tangage)", () => {
    const l: Listener = { ...origin, forward: [0, 1, 0], right: [1, 0, 0] };
    expect(spatialize(l, 0, 50, 0)).toEqual({ pan: 0, volume: -50 });
  });
});

describe("conversions", () => {
  it("centibels → gain", () => {
    expect(centibelToGain(0)).toBe(1);
    expect(centibelToGain(-2000)).toBeCloseTo(0.1);
    expect(centibelToGain(-10000)).toBe(0);
  });

  it("pan DirectSound → StereoPanner", () => {
    expect(directSoundPanToStereo(0)).toBe(0);
    expect(directSoundPanToStereo(10000)).toBeCloseTo(1, 4);
    expect(directSoundPanToStereo(-10000)).toBeCloseTo(-1, 4);
    // une atténuation modérée donne un décalage intermédiaire
    const p = directSoundPanToStereo(600);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
});

describe("SoundSystem", () => {
  it("décode id = numéro × 100 + instances", () => {
    const sys = new SoundSystem(fakeBank([100004, 300202, 500103, 600405]), new FakeSink());
    expect(sys.sounds).toEqual([1000, 3002, 5001, 6004]);
    expect([1000, 3002, 5001, 6004].map((n) => sys.maxInstances(n))).toEqual([4, 2, 3, 5]);
    expect(sys.maxInstances(1234)).toBe(0);
  });

  it("une ressource sans instance (id % 100 = 0) garde une instance", () => {
    expect(new SoundSystem(fakeBank([700000]), new FakeSink()).maxInstances(7000)).toBe(1);
  });

  it("ignore la demande quand toutes les instances sont prises (pas de vol de voix)", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(fakeBank([300002]), sink);
    const req = { sound: 3000, x: 0, y: 0, z: 100 };
    expect(sys.play(req)).toBe(true);
    expect(sys.play(req)).toBe(true);
    expect(sys.play(req)).toBe(false);
    expect(sys.activeCount(3000)).toBe(2);
    expect(sink.voices.size).toBe(2);
    expect(sys.play({ sound: 9999, x: 0, y: 0, z: 0 })).toBe(false);
  });

  it("libère l'instance à la fin du son", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(fakeBank([300101]), sink);
    sys.play({ sound: 3001, x: 0, y: 0, z: 0 });
    expect(sys.play({ sound: 3001, x: 0, y: 0, z: 0 })).toBe(false);
    sink.finish([...sink.voices.keys()][0]);
    expect(sys.play({ sound: 3001, x: 0, y: 0, z: 0 })).toBe(true);
  });

  it("applique pan et volume au démarrage puis à chaque update, sans appels redondants", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(fakeBank([100004]), sink);
    sys.setListener(origin);
    sys.play({ sound: 1000, x: 100, y: 0, z: 200 });
    expect(sink.log.at(-1)).toMatch(/^play \d+ b\d+ g0\.794 p0\.\d+$/);
    const n = sink.log.length;
    sys.update();
    expect(sink.log).toHaveLength(n); // rien n'a bougé
    sys.setListener({ x: 0, y: 0, z: 100, yaw: 0 });
    sys.update();
    expect(sink.log.slice(n).map((l) => l.split(" ")[0])).toEqual(["gain", "pan"]);
  });

  it("une source suivie par un résolveur d'émetteurs se déplace ; objet disparu : dernière position", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(fakeBank([100004]), sink);
    const pos = { x: 0, y: 0, z: 100 } as { x: number; y: number; z: number } | undefined;
    sys.setEmitterResolver(() => pos);
    sys.play({ sound: 1000, x: 0, y: 0, z: 100, objectId: 7 });
    const voice = [...sink.voices.values()][0];
    pos!.z = 500;
    sys.update();
    expect(voice.gain).toBeCloseTo(centibelToGain(-500));
    const g = voice.gain;
    sys.setEmitterResolver(() => undefined);
    sys.update();
    expect(voice.gain).toBe(g);
  });

  it("sons d'interface (spatial: false) : gain 1, centre", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(fakeBank([600002]), sink);
    sys.play({ sound: 6000, x: 9999, y: 0, z: 9999, spatial: false });
    const v = [...sink.voices.values()][0];
    expect(v.gain).toBe(1);
    expect(v.pan).toBe(0);
  });

  it("boucles : fréquence suivie, arrêt par émetteur, stopAll", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(fakeBank([500003]), sink);
    let freq = 11000;
    sys.setEmitterResolver(() => ({ x: 0, y: 0, z: 0, frequency: freq }));
    expect(sys.startLoop({ sound: 5000, x: 0, y: 0, z: 0, objectId: 1 }, 11000)).toBe(true);
    const v = [...sink.voices.values()][0];
    expect(v.loop).toBe(true);
    expect(v.rate).toBeCloseTo(1);
    freq = 5512.5;
    sys.update();
    expect(v.rate).toBeCloseTo(0.5);
    sys.stopLoop(5000, 2); // autre émetteur : sans effet
    expect(sys.activeVoices).toBe(1);
    sys.stopLoop(5000, 1);
    expect(sys.activeVoices).toBe(0);
    sys.startLoop({ sound: 5000, x: 0, y: 0, z: 0, objectId: 1 });
    sys.play({ sound: 5000, x: 0, y: 0, z: 0 });
    sys.stopAll();
    expect(sys.activeVoices).toBe(0);
    expect(sink.voices.size).toBe(0);
  });

  it("transmet le mute général", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(fakeBank([100004]), sink);
    sys.muted = true;
    expect(sys.muted).toBe(true);
    expect(sink.log.at(-1)).toBe("muted true");
  });
});

describe.skipIf(!hasOriginalFiles)("SOUNDS.BD réel", () => {
  const bank = parseSoundBank(readOriginal("SOUNDS.BD"));

  it("construit les 26 sons, tous décrits dans le catalogue", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(bank, sink);
    expect(sys.sounds).toHaveLength(26);
    expect(sink.log.filter((l) => l.startsWith("buffer"))).toHaveLength(26);
    expect(sys.sounds.sort()).toEqual(Object.keys(SOUND_CATALOG).map(Number).sort());
    for (const s of bank.sounds) expect(sys.maxInstances(Math.floor(s.id / 100))).toBe(s.id % 100);
  });

  it("respecte le nombre d'instances de chaque son", () => {
    const sink = new FakeSink();
    const sys = new SoundSystem(bank, sink);
    for (const n of sys.sounds) {
      const max = sys.maxInstances(n);
      for (let i = 0; i < max; i++) expect(sys.play({ sound: n, x: 0, y: 0, z: 10 })).toBe(true);
      expect(sys.play({ sound: n, x: 0, y: 0, z: 10 })).toBe(false);
    }
  });
});
