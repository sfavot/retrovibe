import { describe, expect, it } from "vitest";
import { SoundDevice } from "../../../src/games/gk1/data/ids";
import type { SoundChannel } from "../../../src/games/gk1/data/sound";
import type { SoundDriver } from "../../../src/games/gk1/audio/gm-driver";
import { parseTrack, type SciSong } from "../../../src/games/gk1/audio/sci-song";
import { LOOP_FOREVER, type SampleOutput, SIGNAL_END, SoundManager, SoundStatus } from "../../../src/games/gk1/audio/sound-manager";

class FakeDriver implements SoundDriver {
  readonly device = SoundDevice.GeneralMidi;
  readonly firstChannel = 1;
  readonly lastChannel = 8;
  readonly polyphony = 32;
  masterVolume = 15;
  readonly sent: string[] = [];
  resets = 0;
  send(status: number, a: number, b: number, atMs?: number): void {
    this.sent.push(`${status.toString(16)} ${a} ${b}` + (atMs === undefined ? "" : ` @${Math.round(atMs)}`));
  }
  reset(): void {
    this.resets++;
  }
  take(): string[] {
    return this.sent.splice(0);
  }
  /** Notes et programmes seulement. */
  notes(): string[] {
    return this.take().filter((m) => /^[89c]/.test(m));
  }
}

function channel(number: number, data: number[], flags = 0, priority = 0): SoundChannel {
  return { offset: 0, size: data.length + 2, number, flags, voices: 1, priority, data: Uint8Array.from(data) };
}

function song(channels: SoundChannel[], priority?: number): SciSong {
  return parseTrack({ device: SoundDevice.GeneralMidi, channels }, priority);
}

/** Une note de 10 ticks au tick 5 sur le canal `number`, fin au tick 20. */
const note = (number: number, key = 60, priority = 0) => channel(number, [0, 0xc0 | number, 7, 5, 0x90 | number, key, 100, 10, key, 0, 5, 0xfc], 0, priority);

function world(songs: Record<number, SciSong>, extra: { clock?: () => number; samples?: SampleOutput } = {}) {
  const driver = new FakeDriver();
  const manager = new SoundManager({ driver, loadSong: (id) => songs[id], latencyMs: 40, ...extra });
  let ticks = 0;
  /** Avance tick par tick, comme la boucle du jeu (un saut plus long serait un rattrapage, sans notes). */
  const run = (count: number): void => {
    for (let i = 0; i < count; i++) manager.advanceTo(++ticks);
  };
  const start = (key: number, id: number, options: Partial<{ loop: number; priority: number; volume: number; playBed: boolean }> = {}) => {
    const slot = manager.init(key, id, { loop: 1, priority: 0, volume: 127 });
    manager.play(slot, { loop: 1, priority: 0, volume: 127, playBed: false, ...options });
    return slot;
  };
  return { driver, manager, run, start };
}

describe("lecture d'un son", () => {
  it("passe d'initialisé à joué, pose ses canaux sur le pilote et joue ses évènements à leur tick", () => {
    const { driver, manager, run } = world({ 1: song([note(2), channel(9, [0, 0x99, 36, 90, 20, 0xfc], 2)], 80) });
    const slot = manager.init(0x10001, 1, { loop: 1, priority: 5, volume: 100 });
    expect([slot.status, slot.hasData, slot.priority, slot.volume]).toEqual([SoundStatus.Stopped, true, 5, 100]);
    expect(manager.slot(0x10001)).toBe(slot);
    expect([...manager.keys()]).toEqual([0x10001]);
    manager.play(slot, { loop: 1, priority: 5, volume: 127, playBed: false });
    // La priorité du son (80) l'emporte sur celle de l'objet.
    expect([slot.status, slot.priority, slot.volume, slot.signal]).toEqual([SoundStatus.Playing, 80, 127, 0]);
    // Canal réaffectable : le plus haut canal libre (8) ; batterie : son propre numéro.
    expect([manager.deviceChannel(slot, 2), manager.deviceChannel(slot, 9), manager.deviceChannel(slot, 5)]).toEqual([8, 9, -1]);
    // État de départ rendu à chaque canal : pédale, programme, volume, panoramique, modulation, pédale, molette.
    expect(driver.take()).toEqual([
      "b8 64 0", "c8 0 0", "b8 7 127", "b8 10 64", "b8 1 0", "b8 64 0", "e8 0 64",
      "b9 64 0", "c9 0 0", "b9 7 127", "b9 10 64", "b9 1 0", "b9 64 0", "e9 0 64",
    ]);
    run(1);
    expect(driver.take()).toEqual(["c8 7 0", "99 36 90"]);
    run(4);
    expect(driver.take()).toEqual([]);
    run(1);
    expect(driver.take()).toEqual(["98 60 100"]);
    expect(slot.ticker).toBe(5);
    run(10);
    expect(driver.take()).toEqual(["88 60 0"]);
    expect([slot.signal, slot.ended]).toEqual([0, false]);
    run(5);
    // Fin sans boucle : signal de fin, notes coupées (la percussion n'a jamais eu de note-off).
    expect([slot.signal, slot.ended, slot.status, slot.loop, slot.ticker]).toEqual([SIGNAL_END, true, SoundStatus.Playing, 0, 20]);
    expect(driver.take()).toEqual(["b8 64 0", "b8 123 0", "89 36 0", "b9 64 0", "b9 123 0"]);
    run(50);
    expect(slot.ticker).toBe(20);
    manager.stop(slot);
    expect([slot.status, slot.signal, slot.dataInc]).toEqual([SoundStatus.Stopped, SIGNAL_END, 0]);
    expect(manager.deviceChannel(slot, 2)).toBe(-1);
    manager.dispose(0x10001);
    expect(manager.slot(0x10001)).toBeUndefined();
    expect(manager.sounds()).toHaveLength(0);
  });

  it("rend signaux et repères, ignore un signal au tick 0", () => {
    const control = channel(15, [0, 0xcf, 9, 3, 0xcf, 10, 2, 0xbf, 0x60, 0, 0, 0x60, 0, 2, 0xcf, 20, 3, 0xfc]);
    const { manager, run, start } = world({ 1: song([control, note(1)]) });
    const slot = start(7, 1);
    run(1);
    expect(slot.signal).toBe(0);
    run(3);
    expect(slot.signal).toBe(10);
    slot.signal = 0;
    run(2);
    expect([slot.signal, slot.dataInc]).toEqual([0, 2]);
    run(2);
    expect(slot.signal).toBe(20);
    manager.stop(slot);
    expect(slot.dataInc).toBe(0);
  });

  it("boucle depuis le point de boucle tant que loop n'est pas épuisé", () => {
    const control = channel(15, [8, 0xcf, 127, 12, 0xfc]);
    const { driver, manager, run, start } = world({ 1: song([control, note(1)]) });
    const slot = start(7, 1, { loop: 3 });
    run(21);
    // Fin au tick 20 : loop 3 → 2, retour au tick 8 (la note du tick 5 n'est pas rejouée, son note-off du tick 15 si).
    expect([slot.loop, slot.ticker, slot.ended, slot.signal]).toEqual([2, 8, false, 0]);
    driver.take();
    run(12);
    expect(driver.notes()).toEqual(["88 60 0"]);
    expect([slot.loop, slot.ticker]).toEqual([1, 8]);
    run(13);
    expect([slot.loop, slot.ended, slot.signal]).toEqual([0, true, SIGNAL_END]);
    // Boucle sans fin : loop reste loin de zéro.
    const forever = start(8, 1, { loop: LOOP_FOREVER });
    run(200);
    expect([forever.ended, forever.loop]).toEqual([false, LOOP_FOREVER - 15]);
    manager.setLoop(forever, 1);
    run(13);
    expect(forever.ended).toBe(true);
  });

  it("ne se bloque pas sur une boucle vide", () => {
    const { run, start } = world({ 1: song([channel(15, [5, 0xcf, 127, 0, 0xfc])]) });
    const slot = start(7, 1, { loop: LOOP_FOREVER });
    run(100);
    expect([slot.ended, slot.ticker]).toEqual([false, 5]);
  });

  it("maintien : retour au point de boucle tant que la valeur est demandée, sans couper les notes", () => {
    const control = channel(15, [2, 0xcf, 127, 8, 0xbf, 0x52, 1, 20, 0xfc]);
    const { driver, manager, run, start } = world({ 1: song([control, channel(1, [0, 0x91, 60, 100, 30, 60, 0, 0, 0xfc])]) });
    const slot = start(7, 1);
    manager.setHold(slot, 1);
    driver.take();
    run(40);
    expect(driver.take()).toEqual(["98 60 100"]);
    expect(slot.ticker).toBeLessThanOrEqual(10);
    manager.setHold(slot, 0);
    run(31);
    expect(driver.take()).toContain("88 60 0");
    expect(slot.ended).toBe(true);
  });

  it("relance un son en lecture depuis le début", () => {
    const { driver, manager, run, start } = world({ 1: song([note(1)]) });
    const slot = start(7, 1);
    run(8);
    driver.take();
    manager.play(slot, { loop: 1, priority: 0, volume: 90, playBed: false });
    // La note tenue est coupée, l'état de départ est rendu au canal, au nouveau volume.
    expect(driver.take()).toEqual(["88 60 0", "b8 64 0", "b8 123 0", "b8 64 0", "c8 0 0", "b8 7 90", "b8 10 64", "b8 1 0", "b8 64 0", "e8 0 64"]);
    run(6);
    expect(driver.notes()).toEqual(["c8 7 0", "98 60 100"]);
  });
});

describe("volume, fondu, pause", () => {
  const withVolume = () => song([channel(1, [0, 0xb1, 7, 100, 0, 0x91, 60, 100, 0xf8, 0xf8, 0, 0xfc])]);

  it("applique le volume du son au contrôleur 7 de ses canaux", () => {
    const { driver, manager, run, start } = world({ 1: withVolume() });
    const slot = start(7, 1);
    run(1);
    expect(driver.take().slice(-2)).toEqual(["b8 7 100", "98 60 100"]);
    expect(manager.setVolume(slot, 64)).toBe(true);
    expect(manager.setVolume(slot, 64)).toBe(false);
    expect(driver.take()).toEqual(["b8 7 50"]);
    manager.setVolume(slot, 500);
    expect(slot.volume).toBe(127);
    manager.masterVolume = 9;
    expect([manager.masterVolume, driver.masterVolume]).toEqual([9, 9]);
  });

  it("fond par pas réguliers, signale la fin du fondu", () => {
    const { driver, manager, run, start } = world({ 1: withVolume() });
    const slot = start(7, 1);
    run(1);
    driver.take();
    // Déjà au volume visé, sans arrêt demandé : rien.
    manager.fade(slot, 127, 3, 10, false);
    expect(slot.fadeStep).toBe(0);
    manager.fade(slot, 100, 3, 10, true);
    expect([slot.fadeStep, slot.fadeTo, slot.stopAfterFading]).toEqual([-10, 100, true]);
    run(1);
    expect([slot.volume, driver.take()]).toEqual([117, ["b8 7 92"]]);
    run(3);
    expect(slot.volume).toBe(117);
    run(1);
    expect(slot.volume).toBe(107);
    run(4);
    // Dernier pas ramené au volume visé.
    expect([slot.volume, slot.fadeStep, slot.fadeCompleted, slot.status]).toEqual([100, 0, true, SoundStatus.Playing]);
    manager.fade(slot, 127, 0, 20, false);
    run(2);
    expect([slot.volume, slot.fadeCompleted]).toEqual([127, true]);
    // Un arrêt interrompt le fondu.
    manager.fade(slot, 0, 0, 1, true);
    manager.stop(slot);
    expect(slot.fadeStep).toBe(0);
  });

  it("met en pause en comptant les demandes, coupe les notes et libère les canaux", () => {
    const { driver, manager, run, start } = world({ 1: withVolume() });
    const slot = start(7, 1);
    run(3);
    driver.take();
    manager.pause(slot, true);
    expect([slot.status, slot.pauseCounter, manager.deviceChannel(slot, 1)]).toEqual([SoundStatus.Paused, 1, -1]);
    expect(driver.take().slice(0, 3)).toEqual(["88 60 0", "b8 64 0", "b8 123 0"]);
    manager.pause(undefined, true);
    expect(slot.pauseCounter).toBe(2);
    run(100);
    expect(slot.ticker).toBe(2);
    manager.pause(slot, false);
    expect(slot.status).toBe(SoundStatus.Paused);
    manager.pause(undefined, false);
    expect([slot.status, slot.pauseCounter, manager.deviceChannel(slot, 1)]).toEqual([SoundStatus.Playing, 0, 8]);
    // Le canal retrouve son volume.
    expect(driver.take()).toContain("b8 7 100");
    run(1);
    expect(slot.ticker).toBe(3);
    // Une reprise de trop ne compte pas ; la pause d'un son arrêté compte quand même.
    manager.pause(slot, false);
    expect(slot.pauseCounter).toBe(0);
    manager.stop(slot);
    manager.pause(slot, true);
    expect([slot.status, slot.pauseCounter]).toEqual([SoundStatus.Stopped, 1]);
  });
});

describe("partage des canaux du pilote", () => {
  const long = (number: number, priority = 0, flags = 0) => channel(number, [0, 0xc0 | number, number, 0xf8, 0, 0xfc], flags, priority);

  it("donne les canaux aux sons par priorité : un bruitage prioritaire prend la place d'un canal facultatif", () => {
    // Musique : 6 canaux indispensables et 3 facultatifs (priorités 1, 2 et 3).
    const music = song([1, 2, 3, 4, 5, 6].map((n) => long(n)).concat([long(7, 1), long(8, 2), long(10, 3)]), 50);
    const effect = song([long(1), long(2)], 100);
    const { driver, manager, run, start } = world({ 1: music, 2: effect });
    const a = start(1, 1);
    run(1);
    // 8 canaux pour 9 : le moins important (priorité 3) n'a pas de place.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => manager.deviceChannel(a, n))).toEqual([8, 7, 6, 5, 4, 3, 2, 1, -1]);
    driver.take();
    const b = start(2, 2);
    expect(manager.sounds().map((s) => s.key)).toEqual([2, 1]);
    // Le bruitage passe d'abord (2 canaux) ; la musique garde ses 6 canaux indispensables là où ils étaient, et perd les facultatifs…
    expect([1, 2].map((n) => manager.deviceChannel(b, n))).toEqual([2, 1]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => manager.deviceChannel(a, n))).toEqual([8, 7, 6, 5, 4, 3, -1, -1, -1]);
    manager.stop(b);
    // …puis les retrouve.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => manager.deviceChannel(a, n))).toEqual([8, 7, 6, 5, 4, 3, 2, 1, -1]);
    // Un canal qui retrouve une place y retrouve son programme.
    expect(driver.take()).toContain("c2 7 0");
  });

  it("un canal indispensable déloge un canal facultatif, même d'un son plus prioritaire", () => {
    const music = song([1, 2, 3, 4, 5, 6, 7].map((n) => long(n)).concat([long(8, 3)]), 100);
    const effect = song([long(1)], 50);
    const { manager, start } = world({ 1: music, 2: effect });
    const a = start(1, 1);
    const b = start(2, 2);
    expect(manager.deviceChannel(a, 8)).toBe(-1);
    expect(manager.deviceChannel(b, 1)).toBe(1);
  });

  it("un son privé d'un canal indispensable ne reçoit aucun canal", () => {
    const music = song([1, 2, 3, 4, 5, 6, 7].map((n) => long(n)), 100);
    const effect = song([long(1), long(2)], 50);
    const { manager, start } = world({ 1: music, 2: effect });
    const a = start(1, 1);
    const b = start(2, 2);
    expect([1, 2].map((n) => manager.deviceChannel(b, n))).toEqual([-1, -1]);
    // Ses évènements sont suivis quand même : il prend ses canaux dès qu'ils se libèrent.
    manager.stop(a);
    expect([1, 2].map((n) => manager.deviceChannel(b, n))).toEqual([8, 7]);
  });

  it("la batterie garde le canal 9 ; deux batteries : la plus prioritaire", () => {
    const drums = (priority: number) => song([long(9, 0, 2), long(1)], priority);
    const { manager, start } = world({ 1: drums(50), 2: drums(60) });
    const a = start(1, 1);
    expect(manager.deviceChannel(a, 9)).toBe(9);
    const b = start(2, 2);
    expect([manager.deviceChannel(b, 9), manager.deviceChannel(b, 1)]).toEqual([9, 8]);
    // La première perd un canal indispensable : elle se tait en entier.
    expect([manager.deviceChannel(a, 9), manager.deviceChannel(a, 1)]).toEqual([-1, -1]);
    // Fond sonore (`playBed`) : tous les canaux gardent leur numéro.
    const c = start(3, 1, { playBed: true, priority: 99 });
    expect(c.priority).toBe(50);
    manager.stop(a);
    manager.stop(b);
    expect([manager.deviceChannel(c, 9), manager.deviceChannel(c, 1)]).toEqual([9, 1]);
  });

  it("priorité fixée par le script, puis rendue au son", () => {
    const { manager, start } = world({ 1: song([long(1)], 50), 2: song([long(1)], 60) });
    const a = start(1, 1);
    const b = start(2, 2);
    expect(manager.sounds().map((s) => s.key)).toEqual([2, 1]);
    manager.setPriority(a, 90);
    expect([a.priority, a.overridePriority, manager.sounds().map((s) => s.key)]).toEqual([90, true, [1, 2]]);
    // Fixée : la priorité de l'objet l'emporte au lancement suivant.
    manager.play(a, { loop: 1, priority: 70, volume: 127, playBed: false });
    expect(a.priority).toBe(70);
    manager.setPriority(a, undefined);
    expect([a.priority, a.overridePriority]).toEqual([0, false]);
    manager.play(a, { loop: 1, priority: 70, volume: 127, playBed: false });
    expect(a.priority).toBe(50);
    expect(b.priority).toBe(60);
  });

  it("coupures de canal : par le morceau (0x4E) et par les scripts, qui se comptent", () => {
    const muting = song([channel(1, [0, 0xc1, 5, 4, 0xb1, 0x4e, 1, 4, 0xb1, 0x4e, 0, 0xf8, 0, 0xfc]), long(2)]);
    const { driver, manager, run, start } = world({ 1: muting });
    const slot = start(1, 1);
    expect(manager.deviceChannel(slot, 1)).toBe(8);
    run(5);
    expect(manager.deviceChannel(slot, 1)).toBe(-1);
    run(4);
    expect(manager.deviceChannel(slot, 1)).toBe(8);
    manager.sendMidi(slot, 1, 0xb0, 0x4e, 1);
    manager.sendMidi(slot, 1, 0xb0, 0x4e, 1);
    expect([manager.deviceChannel(slot, 1), manager.deviceChannel(slot, 2)]).toEqual([-1, 7]);
    manager.sendMidi(slot, 1, 0xb0, 0x4e, 0);
    expect(manager.deviceChannel(slot, 1)).toBe(-1);
    manager.sendMidi(slot, 1, 0xb0, 0x4e, 0);
    expect(manager.deviceChannel(slot, 1)).toBe(8);
    // Autres messages des scripts : vers le canal du pilote, volume mis à l'échelle ; canal inconnu : ignoré.
    driver.take();
    manager.setVolume(slot, 64);
    driver.take();
    manager.sendMidi(slot, 1, 0xb0, 7, 100);
    manager.sendMidi(slot, 1, 0xe0, 0, 80);
    manager.sendMidi(slot, 5, 0xb0, 7, 100);
    expect(driver.take()).toEqual(["b8 7 50", "e8 0 80"]);
  });
});

describe("horloge", () => {
  it("date les messages sur l'horloge audio, avec une avance fixe, et se recale après un retard", () => {
    let now = 1000;
    const { driver, manager, run, start } = world({ 1: song([channel(1, [0, 0x91, 60, 1, 6, 61, 1, 6, 62, 1, 60, 0xfc])]) }, { clock: () => now });
    start(1, 1);
    expect(driver.take().every((m) => m.endsWith("@1040"))).toBe(true);
    run(1);
    expect(driver.take()).toEqual(["98 60 1 @1057"]);
    now = 1010;
    run(6);
    expect(driver.take()).toEqual(["98 61 1 @1157"]);
    // Retard : la date d'un tick ne peut pas être passée.
    now = 5000;
    run(6);
    expect(driver.take()).toEqual(["98 62 1 @5123"]);
    // Une coupure ne part jamais avant ce qui est déjà planifié.
    manager.silence();
    expect(driver.take().slice(0, 3)).toEqual(["88 60 0 @5123", "88 61 0 @5123", "88 62 0 @5123"]);
    // Horloge débranchée : plus de date.
    manager.clock = undefined;
    manager.silence();
    expect(driver.take().every((m) => !m.includes("@"))).toBe(true);
  });

  it("rattrape un long retard sans jouer les notes passées, et recule sans rien jouer", () => {
    const { driver, manager, start } = world({ 1: song([channel(1, [0, 0xc1, 4, 10, 0x91, 60, 1, 10, 60, 0, 0xf8, 0, 0x91, 62, 1, 0xf8, 0, 0xfc])]) });
    const slot = start(1, 1);
    driver.take();
    manager.advanceTo(270);
    expect(driver.take()).toEqual(["c8 4 0", "88 60 0", "98 62 1"]);
    expect(slot.ticker).toBe(269);
    // Un saut de 270 ticks : la note du tick 10 est passée, celle du tick 260 est jouée.
    manager.advanceTo(100);
    manager.advanceTo(101);
    expect(slot.ticker).toBe(270);
  });
});

describe("sons sans morceau, sons numérisés", () => {
  it("un son sans morceau pour ce pilote se lance sans rien jouer", () => {
    const { driver, manager, run } = world({});
    const slot = manager.init(1, 215, { loop: 1, priority: 0, volume: 127 });
    expect(slot.hasData).toBe(false);
    manager.play(slot, { loop: 1, priority: 3, volume: 127, playBed: false });
    run(10);
    expect([slot.status, slot.priority, slot.signal, driver.take()]).toEqual([SoundStatus.Playing, 3, 0, []]);
    // Numéro 0 : jamais de son.
    expect(manager.init(2, 0, { loop: 1, priority: 0, volume: 127 }).hasData).toBe(false);
  });

  it("relaie un son numérisé vers sa sortie", () => {
    const calls: string[] = [];
    const samples: SampleOutput = {
      has: (id) => id === 2017,
      play: (key, id, loop, volume) => calls.push(`play ${key} ${id} ${loop} ${volume}`),
      stop: (key) => calls.push(`stop ${key}`),
      pause: (key, paused) => calls.push(`pause ${key} ${paused}`),
      setVolume: (key, volume) => calls.push(`volume ${key} ${volume}`),
      finished: () => false,
    };
    const { driver, manager, run } = world({ 2017: song([note(1)]) }, { samples });
    const slot = manager.init(5, 2017, { loop: 1, priority: 0, volume: 127 });
    expect([slot.isSample, slot.hasData]).toEqual([true, true]);
    manager.play(slot, { loop: LOOP_FOREVER, priority: 0, volume: 80, playBed: false });
    run(30);
    manager.setVolume(slot, 60);
    manager.pause(slot, true);
    manager.pause(slot, false);
    manager.stop(slot);
    expect(calls).toEqual(["play 5 2017 true 80", "volume 5 60", "pause 5 true", "pause 5 false", "stop 5"]);
    expect(driver.take()).toEqual([]);
  });
});
