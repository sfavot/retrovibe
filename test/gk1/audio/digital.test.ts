import { describe, expect, it } from "vitest";
import { DIGITAL_LOADING, DigitalAudio, LOAD_TIMEOUT_TICKS, NO_POSITION, volumeToGain } from "../../../src/games/gk1/audio/digital";
import { LipSync, SYNC_END, SYNC_STARTED } from "../../../src/games/gk1/audio/sync";
import { AUDIO_INDEX_PATH, parseDurationJson, parseSyncJson, readAudio36Map, readSfxMap, samplesToTicks, voiceClipName, voiceIndexPath, voicePath } from "../../../src/games/gk1/data/audio-index";
import { ResourceType, SFX_MAP_NUMBER } from "../../../src/games/gk1/data/ids";
import { mainIndex, original } from "../data/real";
import { diskFiles, fakeFiles, FakeOutput, settle } from "./digital-files";

const KEY = { module: 50, noun: 6, verb: 0, cond: 20, seq: 1 };
const VOICE = { voice: KEY };
const OTHER = { voice: { ...KEY, cond: 30 } };
/** 44 100 échantillons : 2 000 ms, soit 121 ticks ; 22 050 : 61 ticks. */
const TEXTS = { "voices/50/index.json": '{"6-0-20-1":44100,"6-0-30-1":22050}', [AUDIO_INDEX_PATH]: '{"12":22050,"13":44100}' };
const SOUNDS = ["voices/50/6-0-20-1.mp3", "voices/50/6-0-30-1.mp3", "audio/12.mp3", "audio/13.mp3"];

function world(delay = 0) {
  const clock = { now: 1000 };
  const digital = new DigitalAudio(() => clock.now);
  const files = fakeFiles(TEXTS, SOUNDS, delay);
  digital.files = files;
  const warnings: string[] = [];
  digital.warn = (message) => warnings.push(message);
  return { clock, digital, files, warnings };
}

describe("audio numérique sans sortie (horloge du jeu seule)", () => {
  it("Play rend la durée en ticks, Position avance avec l'horloge puis rend −1 quand le clip est fini", () => {
    const { clock, digital } = world();
    expect(digital.position(VOICE)).toBe(NO_POSITION);
    expect(digital.position()).toBe(NO_POSITION);
    expect(digital.play(VOICE)).toBe(121);
    expect([digital.activeCount, digital.position(VOICE), digital.position()]).toEqual([1, 0, 0]);
    clock.now += 50;
    expect([digital.position(VOICE), digital.position(), digital.position(OTHER)]).toEqual([50, 50, NO_POSITION]);
    clock.now += 70;
    expect(digital.position(VOICE)).toBe(120);
    clock.now += 1;
    expect([digital.position(VOICE), digital.position(), digital.activeCount]).toEqual([NO_POSITION, NO_POSITION, 0]);
  });

  it("une ressource absente rend 0 et ne crée pas de canal ; un index illisible est signalé une fois", () => {
    const { digital, warnings } = world();
    expect(digital.play({ voice: { ...KEY, seq: 9 } })).toBe(0);
    expect(digital.play({ sound: 99 })).toBe(0);
    expect(digital.activeCount).toBe(0);
    expect(warnings).toEqual([]);
    const broken = new DigitalAudio(() => 0);
    broken.files = fakeFiles({ "voices/50/index.json": "[1]" }, SOUNDS);
    broken.warn = (message) => warnings.push(message);
    expect([broken.play(VOICE), broken.play(OTHER), broken.play({ sound: 12 })]).toEqual([0, 0, 0]);
    expect(warnings).toEqual(["audio : voices/50/index.json illisible", "audio : audio/index.json introuvable"]);
    // Sans fichiers du tout : rien n'existe.
    expect(new DigitalAudio(() => 0).play(VOICE)).toBe(0);
  });

  it("Stop rend le nombre de canaux d'avant, 0 pour un canal qui n'existe pas ; sans ressource, tout s'arrête", () => {
    const { clock, digital } = world();
    expect(digital.stop()).toBe(0);
    digital.play(VOICE);
    clock.now += 10;
    digital.play({ sound: 13 });
    expect(digital.stop(OTHER)).toBe(0);
    expect(digital.stop(VOICE)).toBe(2);
    expect([digital.position(VOICE), digital.position({ sound: 13 }), digital.activeCount]).toEqual([NO_POSITION, 0, 1]);
    // La position commune reste comptée depuis le premier son lancé quand rien ne jouait.
    expect(digital.position()).toBe(10);
    digital.play(OTHER);
    expect(digital.stop()).toBe(2);
    expect([digital.activeCount, digital.position()]).toEqual([0, NO_POSITION]);
  });

  it("rejouer une ressource en cours ne la relance pas ; une boucle ne finit pas ; le volume est borné", () => {
    const { clock, digital } = world();
    digital.play(VOICE, { volume: 300 });
    expect(digital.volume(VOICE)).toBe(127);
    clock.now += 40;
    expect(digital.play(VOICE, { volume: 10 })).toBe(121);
    expect([digital.position(VOICE), digital.activeCount, digital.volume(VOICE)]).toEqual([40, 1, 127]);
    expect(digital.setVolume(60, VOICE)).toBe(true);
    expect(digital.setVolume(60, OTHER)).toBe(false);
    expect(digital.volume(VOICE)).toBe(60);
    digital.play({ sound: 12 }, { loop: true });
    clock.now += 100000;
    expect([digital.position(VOICE), digital.position({ sound: 12 })]).toEqual([NO_POSITION, 65534]);
  });

  it("pause et reprise d'un canal ou de tous : le temps du canal s'arrête", () => {
    const { clock, digital } = world();
    digital.play(VOICE);
    digital.play(OTHER);
    clock.now += 10;
    digital.pause(true, VOICE);
    clock.now += 30;
    expect([digital.position(VOICE), digital.position(OTHER)]).toEqual([10, 40]);
    // Rejouer un canal en pause le relance.
    digital.play(VOICE);
    clock.now += 5;
    expect(digital.position(VOICE)).toBe(15);
    digital.pause(true);
    clock.now += 500;
    expect([digital.position(VOICE), digital.position(OTHER), digital.activeCount]).toEqual([15, 45, 2]);
    digital.pause(false);
    clock.now += 15;
    expect([digital.position(VOICE), digital.position(OTHER)]).toEqual([30, 60]);
    clock.now += 1;
    expect(digital.position(OTHER)).toBe(NO_POSITION);
  });

  it("un index encore en route : la durée répond « en route », Play compte le clip comme absent", () => {
    const { digital } = world(2);
    expect(digital.duration(VOICE)).toBe(DIGITAL_LOADING);
    expect(digital.play(VOICE)).toBe(0);
    expect(digital.duration(VOICE)).toBe(121);
    expect(digital.play(VOICE)).toBe(121);
  });

  it("sons de DoSound : un canal par objet, fini quand sa durée est passée", () => {
    const { clock, digital } = world();
    const out = digital.soundOutput;
    expect([out.has(12), out.has(99), out.finished(7)]).toEqual([true, false, true]);
    out.play(7, 12, false, 100);
    out.play(8, 12, true, 50);
    expect([digital.activeCount, out.finished(7), out.finished(8)]).toEqual([2, false, false]);
    expect([digital.volume({ sound: 12 }, 7), digital.volume({ sound: 12 }, 8)]).toEqual([100, 50]);
    out.setVolume(8, 20);
    expect(digital.volume({ sound: 12 }, 8)).toBe(20);
    clock.now += 30;
    out.pause(7, true);
    clock.now += 100;
    expect(out.finished(7)).toBe(false);
    out.pause(7, false);
    clock.now += 31;
    expect([out.finished(7), out.finished(8)]).toEqual([true, false]);
    out.stop(8);
    expect([out.finished(8), digital.activeCount]).toEqual([true, 0]);
  });
});

describe("audio numérique avec une sortie", () => {
  it("le temps du canal commence à l'arrivée du son ; il est arrêté à la fin de sa durée", async () => {
    const { clock, digital, files } = world();
    const output = new FakeOutput();
    output.held = true;
    digital.attach(output);
    expect(digital.play(VOICE, { volume: 127 })).toBe(121);
    clock.now += 20;
    // Le fichier n'est pas encore décodé : le canal existe, sa position ne bouge pas.
    expect([digital.position(VOICE), digital.position(), digital.activeCount, output.log]).toEqual([0, 0, 1, []]);
    await settle();
    output.release();
    await settle();
    expect(files.loads).toEqual(["voices/50/6-0-20-1.mp3"]);
    expect(output.log).toEqual(["play 0 loop=false gain=1.000"]);
    clock.now += 120;
    expect(digital.position(VOICE)).toBe(120);
    clock.now += 1;
    expect(digital.position(VOICE)).toBe(NO_POSITION);
    expect(output.log).toEqual(["play 0 loop=false gain=1.000", "stop 0"]);
    // Le son décodé est gardé : la deuxième lecture part aussitôt, sans nouveau téléchargement.
    digital.play(VOICE, { volume: 50, loop: true });
    expect(files.loads).toHaveLength(1);
    expect(output.log[2]).toBe("play 1 loop=true gain=0.244");
    digital.setVolume(127, VOICE);
    digital.pause(true, VOICE);
    digital.pause(false, VOICE);
    digital.stop();
    expect(output.log.slice(3)).toEqual(["gain 1 1.000", "pause 1 true", "pause 1 false", "stop 1"]);
  });

  it("un son arrêté avant son arrivée n'est pas joué ; un décodage raté ou trop lent vaut un silence commencé à la demande", async () => {
    const { clock, digital } = world();
    const output = new FakeOutput();
    output.held = true;
    digital.attach(output);
    digital.play(VOICE);
    digital.stop(VOICE);
    output.release();
    await settle();
    output.release();
    await settle();
    expect(output.log).toEqual([]);

    // Trop lent : passé le délai, le clip compte depuis la demande, donc il est fini ; le son qui arrive ensuite est ignoré.
    digital.play(OTHER);
    clock.now += LOAD_TIMEOUT_TICKS - 1;
    expect(digital.position(OTHER)).toBe(0);
    clock.now += 1;
    expect(digital.position(OTHER)).toBe(NO_POSITION);
    await settle();
    output.release();
    await settle();
    expect(output.log).toEqual([]);

    output.held = false;
    output.broken = true;
    digital.play({ sound: 13 });
    clock.now += 30;
    await settle();
    expect(digital.position({ sound: 13 })).toBe(30);
    clock.now += 91;
    expect(digital.position({ sound: 13 })).toBe(NO_POSITION);
    expect(output.log).toEqual([]);
  });

  it("volume : les cinq niveaux de SCI2", () => {
    expect([0, 1, 42, 43, 84, 85, 126, 127, 500, -3].map((volume) => Math.round(volumeToGain(volume) * 127))).toEqual([0, 15, 15, 31, 31, 63, 63, 127, 127, 0]);
  });
});

describe("synchronisation des lèvres", () => {
  it("sert les repères un par un, puis la fin une fois ; un clip sans repères rend −1", () => {
    const files = fakeFiles({ "voices/50/sync.json": '{"6-0-20-1":[0,10,3,4],"6-0-30-1":[]}' }, []);
    const sync = new LipSync(() => files);
    expect(sync.start({ ...KEY, cond: 99 })).toBe(SYNC_END);
    expect([sync.active, sync.next()]).toEqual([false, undefined]);
    expect(sync.start({ ...KEY, module: 51 })).toBe(SYNC_END);
    expect(sync.start(KEY)).toBe(SYNC_STARTED);
    expect([sync.next(), sync.next(), sync.next(), sync.next()]).toEqual([{ time: 0, cue: 10 }, { time: 3, cue: 4 }, { time: SYNC_END, cue: SYNC_END }, undefined]);
    expect(sync.start({ ...KEY, cond: 30 })).toBe(SYNC_STARTED);
    expect([sync.next(), sync.next()]).toEqual([{ time: SYNC_END, cue: SYNC_END }, undefined]);
    sync.stop();
    expect(sync.active).toBe(false);
  });

  it("un fichier en route n'est pas tenu pour absent ; un fichier illisible est signalé", () => {
    const files = fakeFiles({ "voices/50/sync.json": '{"6-0-20-1":[0,10]}', "voices/51/sync.json": "{" }, [], 1);
    const warnings: string[] = [];
    const sync = new LipSync(
      () => files,
      (message) => warnings.push(message),
    );
    expect(sync.cuesOf(KEY)).toBe(DIGITAL_LOADING);
    expect(sync.cuesOf(KEY)).toEqual([{ tick: 0, cue: 10 }]);
    expect(sync.cuesOf({ ...KEY, module: 51 })).toBe(DIGITAL_LOADING);
    expect(sync.cuesOf({ ...KEY, module: 51 })).toBeUndefined();
    expect(warnings).toEqual(["synchro : voices/51/sync.json illisible"]);
  });
});

describe.skipIf(!original.has)("audio numérique sur les fichiers réels", () => {
  it("les 7 469 clips et les 231 sons : clé → fichier, durée de l'index, repères de synchro", () => {
    const resources = mainIndex();
    const files = diskFiles();
    const digital = new DigitalAudio(() => 0);
    digital.files = files;
    const sync = new LipSync(() => files);
    const decoder = new TextDecoder();
    let clips = 0;
    let totalTicks = 0;
    let synced = 0;
    for (const module of resources.numbers(ResourceType.Map).filter((number) => number !== SFX_MAP_NUMBER)) {
      const durations = parseDurationJson(decoder.decode(original.read(voiceIndexPath(module))));
      for (const entry of readAudio36Map(resources.get(ResourceType.Map, module))) {
        const key = { module, ...entry };
        clips++;
        expect(files.has(voicePath(key))).toBe(true);
        const ticks = digital.duration({ voice: key });
        expect(ticks).toBe(samplesToTicks(durations.get(voiceClipName(key))!));
        totalTicks += ticks as number;
        const cues = sync.cuesOf(key);
        if (entry.hasSync) expect(cues).toBeDefined();
        if (cues !== undefined) synced++;
      }
    }
    expect(clips).toBe(7469);
    expect(synced).toBe(1785);
    // 8 h 54 min 35 s de voix : chaque clip compte un tick de plus que sa durée tronquée.
    expect(Math.round(totalTicks / 60)).toBeGreaterThanOrEqual(32075);
    expect(Math.round(totalTicks / 60)).toBeLessThanOrEqual(32075 + Math.ceil(7469 / 60));

    const sounds = parseDurationJson(decoder.decode(original.read(AUDIO_INDEX_PATH)));
    expect(sounds.size).toBe(231);
    for (const number of readSfxMap(resources.get(ResourceType.Map, SFX_MAP_NUMBER))) expect(digital.has({ sound: number })).toBe(true);
    for (const [number, samples] of sounds) expect(digital.duration({ sound: Number(number) })).toBe(samplesToTicks(samples));
    expect(digital.duration({ sound: 1 })).toBe(0);
    expect(digital.duration({ voice: { module: 210, noun: 250, verb: 0, cond: 0, seq: 1 } })).toBe(0);
    // Un vrai clip : 6-0-20-1 du module 50, 59 094 échantillons = 2 680 ms = 161 ticks ; ses repères commencent à 0.
    expect(digital.duration({ voice: { module: 50, noun: 6, verb: 0, cond: 20, seq: 1 } })).toBe(161);
    const cues = parseSyncJson(decoder.decode(original.read("voices/50/sync.json"))).get("6-0-20-1")!;
    expect(sync.cuesOf({ module: 50, noun: 6, verb: 0, cond: 20, seq: 1 })).toEqual(cues);
    expect(cues.slice(0, 3)).toEqual([{ tick: 0, cue: 10 }, { tick: 1, cue: 5 }, { tick: 3, cue: 4 }]);
  });
});
