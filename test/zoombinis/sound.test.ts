import { describe, expect, it } from "vitest";
import { MohawkArchive, TAG_SND } from "../../src/data/mohawk/mohawk";
import type { AudioSink, MidiSink, PcmSound } from "../../src/engine/mohawk/audio/sink";
import { TAG_SYSX, TAG_TMID } from "../../src/games/zoombinis/data/archives";
import { QUEUE_SIZE, soundIdForSnoid, ZOOMBINIS_SOUND, ZoombinisSound } from "../../src/games/zoombinis/engine/sound";
import { originalFiles } from "../support/original";

// --- Données synthétiques ---

const text = (s: string) => [...new TextEncoder().encode(s)];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];

/** `\0SND` WAVE ; `loopCount` 0xffff = boucle. `marker` rend les échantillons distinguables. */
function wave(marker: number, loopCount = 0): Uint8Array {
  const data = [...be16(11025), ...be32(2), 8, 1, ...be16(0), ...be16(loopCount), ...be32(0), ...be32(0), marker, marker];
  const body = [...text("WAVE"), ...text("Data"), ...be32(data.length), ...data];
  return Uint8Array.from([...text("MHWK"), ...be32(body.length), ...body]);
}

/** `tMID` : une note (do central) puis la fin, 480 ticks par noire. */
function midi(): Uint8Array {
  const track = [0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
  const body = [...text("MThd"), ...be32(6), ...be16(0), ...be16(1), ...be16(480), ...text("Prg#"), ...be32(2), 0, 0, ...text("MTrk"), ...be32(track.length), ...track];
  return Uint8Array.from([...text("MHWK"), ...be32(body.length + 4), ...text("MIDI"), ...body]);
}

/** Archive factice : `resources[tag][id]`. */
function archive(resources: Record<string, Record<number, Uint8Array>>): MohawkArchive {
  const find = (tag: string, id: number) => resources[tag]?.[id];
  return { find, get: (tag: string, id: number) => find(tag, id)!, has: (tag: string, id: number) => !!find(tag, id) } as unknown as MohawkArchive;
}

interface Played {
  handle: number;
  sound: PcmSound;
  loop: boolean;
  stopped: boolean;
}

class FakeSink implements AudioSink, MidiSink {
  played: Played[] = [];
  sent: number[][] = [];
  resets = 0;
  time = 1000;
  readonly midi = this;
  unlock(): void {}
  now(): number {
    return this.time;
  }
  playWave(sound: PcmSound, loop: boolean): number {
    this.played.push({ handle: this.played.length, sound, loop, stopped: false });
    return this.played.length - 1;
  }
  stopWave(handle: number): void {
    this.played[handle]!.stopped = true;
  }
  isWavePlaying(handle: number): boolean {
    return !this.played[handle]!.stopped;
  }
  send(message: Uint8Array): void {
    this.sent.push([...message]);
  }
  reset(): void {
    this.resets++;
  }
  setMuted(): void {}
  suspend(): void {}
  resume(): void {}
  /** Premier échantillon de chaque son joué (le `marker` de `wave`), pour identifier la ressource. */
  get markers(): number[] {
    return this.played.map((p) => Math.round(p.sound.samples[0]! * 128 + 128));
  }
  notesOn(): number {
    return this.sent.filter((m) => (m[0]! & 0xf0) === 0x90 && m[2]! > 0).length;
  }
}

const OTHER_MARKER = 0x90;

function setup() {
  const sink = new FakeSink();
  const zoombini = archive({
    [TAG_SND]: { 150: wave(0x81), 905: wave(0x82), 999: wave(0x83, 0xffff), 20010: wave(0x84), 1500: wave(OTHER_MARKER + 9) },
  });
  const midimpc = archive({ [TAG_TMID]: { 30000: midi(), 30001: midi() } });
  const screen = archive({ [TAG_SND]: { 1500: wave(0x85), 19999: wave(0x86) } });
  const sound = new ZoombinisSound(sink, { zoombini, midimpc });
  sound.setScreenArchive(screen);
  return { sink, sound };
}

describe("ZoombinisSound : routage et files", () => {
  it("expose une clé de service", () => {
    expect(ZOOMBINIS_SOUND.name).toBe("zoombinis-sound");
  });

  it("route les ids par plage : < 1000 et ≥ 20000 vers ZOOMBINI, 1000…19999 vers l'écran", () => {
    const { sink, sound } = setup();
    for (const id of [150, 1500, 19999, 20010, 905]) {
      sound.queue(id);
      expect(sink.played).toHaveLength(sink.markers.length);
      sound.tick();
    }
    expect(sink.markers).toEqual([0x81, 0x85, 0x86, 0x84, 0x82]);
  });

  it("ignore un id absent de l'archive visée, ou sans archive d'écran", () => {
    const { sink, sound } = setup();
    sound.queue(123);
    sound.setScreenArchive(null);
    sound.queue(1500);
    sound.tick();
    expect(sink.played).toHaveLength(0);
    sound.setScreenArchive(archive({ [TAG_SND]: { 1500: wave(0x85) } }));
    sound.queue(1500);
    sound.tick();
    expect(sink.markers).toEqual([0x85]);
  });

  it("joue la musique depuis MIDIMPC.MHK (ids ≥ 30000) et envoie les notes", () => {
    const { sink, sound } = setup();
    sound.queue(30000);
    sound.tick();
    expect(sound.musicPlaying).toBe(true);
    expect(sound.lastMusicId).toBe(30000);
    sink.time += 200;
    sound.tick();
    expect(sink.notesOn()).toBeGreaterThan(0);
    expect(sink.played).toHaveLength(0);
  });

  it("une file de 32 places : le 33e id est perdu, chaque file séparément", () => {
    const { sink, sound } = setup();
    for (let i = 0; i < QUEUE_SIZE + 5; i++) sound.queue(150);
    sound.queue(30000);
    expect(sound.pending).toEqual({ effects: QUEUE_SIZE, musics: 1 });
    sound.tick();
    expect(sink.played).toHaveLength(1);
    expect(sound.pending).toEqual({ effects: 0, musics: 0 });
    for (let i = 0; i < QUEUE_SIZE + 5; i++) sound.queue(30001);
    expect(sound.pending.musics).toBe(QUEUE_SIZE);
  });

  it("un seul canal : à priorité égale le plus récent l'emporte, les autres ids en file sont perdus, le son en cours est coupé", () => {
    const { sink, sound } = setup();
    sound.queue(905);
    sound.queue(150);
    sound.tick();
    expect(sink.markers).toEqual([0x81]);
    expect(sound.effectsPlaying).toBe(1);
    expect(sound.currentEffect).toBe(150);
    sound.queue(1500);
    sound.tick();
    expect(sink.markers).toEqual([0x81, 0x85]);
    expect(sink.played[0]!.stopped).toBe(true);
    expect(sound.effectsPlaying).toBe(1);
    expect(sound.currentEffect).toBe(1500);
  });

  it("priorités de l'écran (`11a8:313a` / `317c`) : un son plus prioritaire n'est pas coupé et l'emporte dans la file", () => {
    const { sink, sound } = setup();
    // Table de base : 996…997 seulement, priorité 32 ; tout le reste vaut 0.
    expect(sound.priorityOf(999)).toBe(0);
    expect(sound.priorityOf(996)).toBe(32);
    sound.setScreenArchive(Object.assign(archive({ [TAG_SND]: { 1500: wave(0x85), 19999: wave(0x86) } }), { name: "TUNNELS.MHK" }));
    // Grottes (`1190:0107`) : base, puis 20000…29999 (31), 4000…4699 (30) … 8500…8599 (23).
    expect([sound.priorityOf(996), sound.priorityOf(20010), sound.priorityOf(4000), sound.priorityOf(8503), sound.priorityOf(1500)]).toEqual([32, 31, 30, 23, 0]);
    sound.queue(20010);
    sound.queue(150);
    sound.tick();
    expect(sink.markers).toEqual([0x84]);
    // La voix (31) joue : un son de priorité 0 est perdu, elle continue.
    sound.queue(1500);
    sound.tick();
    expect(sink.markers).toEqual([0x84]);
    expect(sink.played[0]!.stopped).toBe(false);
    expect(sound.pending.effects).toBe(0);
    // Elle finit : le suivant passe.
    sink.played[0]!.stopped = true;
    sound.queue(1500);
    sound.tick();
    expect(sink.markers).toEqual([0x84, 0x85]);
  });

  it("la ville et le bac vident la table avant d'y poser leurs plages ; un écran inconnu garde la table de base", () => {
    const { sound } = setup();
    const named = (name: string) => Object.assign(archive({}), { name });
    sound.setScreenArchive(named("TOWN.MHK"));
    expect([sound.priorityOf(3000), sound.priorityOf(20000), sound.priorityOf(996)]).toEqual([32, 31, 30]);
    sound.setScreenArchive(named("original/zoombinis/bridge.mhk"));
    expect([sound.priorityOf(996), sound.priorityOf(20000), sound.priorityOf(175)]).toEqual([32, 31, 25]);
    sound.setScreenArchive(named("LOGO.MHK"));
    expect([sound.priorityOf(996), sound.priorityOf(20000)]).toEqual([32, 0]);
    sound.setScreenArchive(null);
    expect(sound.priorityOf(997)).toBe(32);
  });

  it("un son en boucle (pas d'un Zoombini) est coupé par le son suivant : jamais deux boucles en même temps", () => {
    const { sink, sound } = setup();
    for (let i = 0; i < 6; i++) {
      sound.queue(999);
      sound.tick();
    }
    expect(sink.played.filter((p) => p.loop && !p.stopped)).toHaveLength(1);
    sound.queue(150);
    sound.tick();
    expect(sink.played.filter((p) => p.loop && !p.stopped)).toHaveLength(0);
    expect(sound.effectsPlaying).toBe(1);
  });

  it("id 0 sur la file musique : rejoue la dernière musique ; sans musique, ne fait rien", () => {
    const { sink, sound } = setup();
    sound.queue(0);
    sound.tick();
    expect(sound.musicPlaying).toBe(false);
    sound.queue(30001);
    sound.tick();
    sound.stopMusic();
    expect(sound.musicPlaying).toBe(false);
    const resets = sink.resets;
    sound.queue(0);
    sound.tick();
    expect(sound.musicPlaying).toBe(true);
    expect(sound.lastMusicId).toBe(30001);
    expect(sink.resets).toBeGreaterThan(resets);
  });
});

describe("ZoombinisSound : isPlaying(id)", () => {
  it("un effet est « en cours » dès la file, tant qu'une de ses lectures n'est pas finie, puis plus", () => {
    const { sink, sound } = setup();
    expect(sound.isPlaying(150)).toBe(false);
    sound.queue(150);
    expect(sound.isPlaying(150)).toBe(true);
    sound.tick();
    expect(sound.isPlaying(150)).toBe(true);
    expect(sound.isPlaying(999)).toBe(false);
    // Le son 150 finit tout seul.
    sink.played[0]!.stopped = true;
    expect(sound.isPlaying(150)).toBe(false);
    sound.queue(905);
    sound.tick();
    expect(sound.isPlaying(905)).toBe(true);
    sound.stopEffects();
    expect(sound.isPlaying(905)).toBe(false);
  });

  it("les ids de l'écran et des voix se distinguent ; un son coupé par le suivant n'est plus en cours", () => {
    const { sound } = setup();
    sound.queue(1500);
    sound.tick();
    expect(sound.isPlaying(1500)).toBe(true);
    sound.queue(20010);
    sound.tick();
    expect(sound.isPlaying(1500)).toBe(false);
    expect(sound.isPlaying(20010)).toBe(true);
  });

  it("effets coupés : un id refusé par la file n'est pas en cours", () => {
    const { sound } = setup();
    sound.effectsEnabled = false;
    sound.queue(150);
    expect(sound.isPlaying(150)).toBe(false);
  });

  it("musique : en file, en cours (seulement la dernière), arrêtée ; l'id 0 jamais", () => {
    const { sound } = setup();
    expect(sound.isPlaying(30000)).toBe(false);
    sound.queue(30000);
    expect(sound.isPlaying(30000)).toBe(true);
    sound.tick();
    expect(sound.isPlaying(30000)).toBe(true);
    expect(sound.isPlaying(30001)).toBe(false);
    expect(sound.isPlaying(0)).toBe(false);
    sound.stopMusic();
    expect(sound.isPlaying(30000)).toBe(false);
  });
});

describe("ZoombinisSound : drapeaux et arrêts", () => {
  it("effets coupés : les ids < 30000 sont ignorés, la musique passe", () => {
    const { sink, sound } = setup();
    sound.effectsEnabled = false;
    sound.queue(150);
    sound.queue(30000);
    expect(sound.pending).toEqual({ effects: 0, musics: 1 });
    sound.tick();
    expect(sink.played).toHaveLength(0);
    expect(sound.musicPlaying).toBe(true);
    sound.effectsEnabled = true;
    sound.queue(150);
    sound.tick();
    expect(sink.played).toHaveLength(1);
  });

  it("musique coupée : ignore les ids ≥ 30000 et 0, arrête la musique, ne reprend pas en la rallumant", () => {
    const { sink, sound } = setup();
    sound.queue(30000);
    sound.tick();
    expect(sound.musicPlaying).toBe(true);
    sound.musicEnabled = false;
    expect(sound.musicPlaying).toBe(false);
    sound.queue(30001);
    sound.queue(0);
    sound.queue(150);
    expect(sound.pending).toEqual({ effects: 1, musics: 0 });
    sound.musicEnabled = true;
    sound.tick();
    expect(sound.musicPlaying).toBe(false);
    sound.queue(0);
    sound.tick();
    expect(sound.musicPlaying).toBe(true);
    expect(sound.lastMusicId).toBe(30000);
    expect(sink.played).toHaveLength(1);
  });

  it("boucle un WAVE de répétition 0xffff, pas les autres", () => {
    const { sink, sound } = setup();
    sound.queue(999);
    sound.tick();
    sound.queue(150);
    sound.tick();
    expect(sink.played.map((p) => p.loop)).toEqual([true, false]);
  });

  it("stopEffects coupe les WAVE et vide leur file ; stopAll coupe aussi la musique", () => {
    const { sink, sound } = setup();
    sound.queue(150);
    sound.queue(30000);
    sound.tick();
    sound.queue(905);
    sound.stopEffects();
    expect(sink.played[0]!.stopped).toBe(true);
    expect(sound.pending.effects).toBe(0);
    expect(sound.musicPlaying).toBe(true);
    sound.queue(30001);
    sound.stopAll();
    expect(sound.musicPlaying).toBe(false);
    expect(sound.pending).toEqual({ effects: 0, musics: 0 });
  });

  it("oublie les effets terminés", () => {
    const { sink, sound } = setup();
    sound.queue(150);
    sound.tick();
    expect(sound.effectsPlaying).toBe(1);
    sink.played[0]!.stopped = true;
    expect(sound.effectsPlaying).toBe(0);
  });
});

describe("soundIdForSnoid (probable, engine.md §3.7)", () => {
  const rng = () => 0;
  it("base 100 + 25 × code, puis décalage de voix et variante - 1", () => {
    const bases = [100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 475, 450, 425];
    bases.forEach((base, code) => expect(soundIdForSnoid(code, 1, 1, rng)).toBe(base));
    expect(soundIdForSnoid(0, 2, 1, rng)).toBe(105);
    expect(soundIdForSnoid(0, 3, 1, rng)).toBe(120);
    expect(soundIdForSnoid(0, 4, 1, rng)).toBe(115);
    expect(soundIdForSnoid(0, 5, 1, rng)).toBe(110);
    expect(soundIdForSnoid(8, 1, 3, rng)).toBe(302);
    expect(soundIdForSnoid(12, 3, 2, rng)).toBe(421);
  });

  it("le code 16 tire dans 1800…1814 avec le hasard injecté", () => {
    const asked: number[] = [];
    expect(soundIdForSnoid(16, 2, 4, (max) => (asked.push(max), 7))).toBe(1807);
    expect(asked).toEqual([14]);
    expect(soundIdForSnoid(16, 1, 1, () => 0)).toBe(1800);
    expect(soundIdForSnoid(16, 1, 1, () => 14)).toBe(1814);
  });

  it("refuse un code ou un type de voix hors table", () => {
    expect(soundIdForSnoid(17, 1, 1, rng)).toBeUndefined();
    expect(soundIdForSnoid(0, 0, 1, rng)).toBeUndefined();
    expect(soundIdForSnoid(0, 6, 1, rng)).toBeUndefined();
  });
});

// --- Fichiers originaux ---

const original = originalFiles("zoombinis", "files.json");

describe.runIf(original.has)("ZoombinisSound sur les fichiers originaux", () => {
  const open = (name: string) => MohawkArchive.parse(original.read(name));
  const make = () => {
    const sink = new FakeSink();
    const zoombini = open("ZOOMBINI.MHK");
    const midimap = open("MIDIMAP.DAT");
    const sound = new ZoombinisSound(sink, { zoombini, midimpc: open("MIDIMPC.MHK") }, { sysx: midimap.get(TAG_SYSX, 1) });
    return { sink, sound, zoombini };
  };

  it("joue la musique 30000 et envoie les 64 messages SYSX avant les notes", () => {
    const { sink, sound } = make();
    sound.queue(30000);
    sound.tick();
    expect(sound.musicPlaying).toBe(true);
    const init = sink.sent.filter((m) => (m[0]! & 0xf0) === 0xb0 && m.length === 3);
    expect(init.length).toBeGreaterThanOrEqual(64);
    expect(init.slice(0, 4).map((m) => m.slice(1))).toEqual([[0x79, 0], [0x79, 0], [0x79, 0], [0x79, 0]]);
    sound.queue(0);
    sound.tick();
    expect(sound.lastMusicId).toBe(30000);
  });

  it("joue un \\0SND de ZOOMBINI.MHK (99…499)", () => {
    const { sink, sound, zoombini } = make();
    const id = zoombini.ids(TAG_SND).find((n) => n >= 99 && n <= 499)!;
    expect(id).toBeDefined();
    sound.queue(id);
    sound.tick();
    expect(sink.played).toHaveLength(1);
    expect(sink.played[0]!.sound.samples.length).toBeGreaterThan(0);
  });

  it("joue un \\0SND d'écran de BASECAMP.MHK (1000+) et un son ≥ 20000 de ZOOMBINI.MHK", () => {
    const { sink, sound, zoombini } = make();
    const basecamp = open("BASECAMP.MHK");
    sound.setScreenArchive(basecamp);
    const id = basecamp.ids(TAG_SND).find((n) => n >= 1000 && n <= 19999)!;
    expect(id).toBeDefined();
    const voice = zoombini.ids(TAG_SND).find((n) => n >= 20000 && n < 30000)!;
    sound.queue(id);
    sound.tick();
    sound.queue(voice);
    sound.tick();
    expect(sink.played).toHaveLength(2);
  });
});

describe.skipIf(!originalFiles("zoombinis", "files.json").has)("ZoombinisSound dans le moteur : ordre du tick (`11a8:04b9`)", () => {
  it("un son posé sur une image de script part dans le tick où l'image est lue, pas au suivant (voix des trolls de la hutte)", async () => {
    const { createZoombinisEngine } = await import("../../src/games/zoombinis/engine/engine");
    const { installServices } = await import("../../src/games/zoombinis/engine/services");
    const { FEATURES } = await import("../../src/games/zoombinis/engine/features");
    const { ScreenId } = await import("../../src/games/zoombinis/engine/scene");
    const { TestHost, runFor } = await import("./engine-test-host");
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 1 });
    await installServices(engine);
    let imageReadAt = -1;
    let troll: { image: number } | undefined;
    for (const id of Object.values(ScreenId)) {
      engine.register(id, () => ({
        async load(ctx) {
          const archive = await ctx.resources.open("PIZZA.MHK");
          ctx.services.get(ZOOMBINIS_SOUND).setScreenArchive(archive);
          const features = ctx.services.get(FEATURES);
          features.setArchive(archive);
          features.defineGroup(0, 8000);
          features.setScripts(8000, 36);
          // Réplique d'Arno (`SCRB` 8006) : le son 8000 est sur l'image 3.
          const feature = features.create({ script: 8006, delay: 6, flags: 0 });
          troll = feature;
          const onImage = feature.onImage;
          feature.onImage = (f, parts) => {
            if (f.image === 3 && imageReadAt < 0) imageReadAt = engine.ctx.clock.ticks;
            return onImage ? onImage(f, parts) : parts;
          };
        },
        enter() {},
        leave() {},
        tick() {},
      }));
    }
    const played: number[] = [];
    const playWave = host.audio.playWave.bind(host.audio);
    host.audio.playWave = (sound, loop) => {
      played.push(engine.ctx.clock.ticks);
      return playWave(sound, loop);
    };
    engine.start(ScreenId.pizza);
    await runFor(engine, host, 17 * 60);
    expect(troll).toBeDefined();
    expect(imageReadAt).toBeGreaterThanOrEqual(0);
    expect(played[0]).toBe(imageReadAt);
  });
});
