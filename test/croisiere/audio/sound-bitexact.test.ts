import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CroisiereSound } from "../../../src/games/croisiere/audio/sound";
import { ADL_SIZE, parseAdlInstrument, parseMusicModule } from "../../../src/games/croisiere/data/music";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";
import { LogSink } from "./log-sink";

/**
 * Journaux d'écritures OPL de `sound.cpp` (ScummVM), produits par un banc C++ autonome (le vrai `sound.cpp` compilé avec des stubs et un
 * faux OPL), rejoués ici : mêmes scénarios, même condensé FNV-1a (tick, registre, valeur) et même tick de fin de morceau.
 */
interface Row {
  writes: number;
  fnv: string;
  playedAt?: number;
  adl?: string;
}
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/opl-writes.json", import.meta.url), "utf8")) as {
  modules: Record<string, Row>;
  sfx: Record<string, Row>;
  mixed: Record<string, Row>;
};

const original = originalFiles("croisiere", "VOL.CNF");
const REQUIRED = ["VOL.CNF", "D1", "D2", "D3", "D4", "D5"];
const hasOriginalFiles = original.has && REQUIRED.every((name) => original.list((n) => n === name).length === 1);

describe.skipIf(!hasOriginalFiles)("son : fichiers originaux", () => {
  const volumes = CruiseVolumes.open((name) => original.read(name));
  const loadFile = (name: string) => (volumes.has(name) ? volumes.readFile(name) : undefined);
  const modules = [...new Set(volumes.entries.filter((e) => /^CORP\d+$/.test(e.name)).map((e) => e.name))].sort();
  const adls = [...new Set(volumes.entries.filter((e) => e.name.endsWith(".ADL")).map((e) => e.name))].sort();

  /** `fade` : après `ticks` ticks, fondu puis 3 000 ticks ; rend le tick (1 = le suivant) où `SongPlayed` devient vrai. */
  function playModule(sound: CroisiereSound, name: string, steps: (() => void)[] = []): number {
    sound.loadSong(name);
    sound.playSong();
    for (const step of steps) step();
    sound.fadeSong();
    let playedAt = -1;
    for (let i = 1; i <= 3000; i++) {
      sound.tick();
      if (playedAt < 0 && sound.songPlayed()) playedAt = i;
    }
    return playedAt;
  }

  it("les 12 modules et 49 instruments existent et se lisent", () => {
    expect(modules).toHaveLength(12);
    expect(adls).toHaveLength(49);
    for (const name of adls) expect(parseAdlInstrument(volumes.readFile(name)).mode, name).toBeGreaterThanOrEqual(0);
    for (const name of modules) expect(parseMusicModule(volumes.readFile(name)).numOrders, name).toBeGreaterThan(0);
  });

  it.each(modules)("%s : 2 000 ticks puis fondu, écritures identiques à ScummVM", (name) => {
    const sink = new LogSink();
    const sound = new CroisiereSound(sink, loadFile);
    const playedAt = playModule(sound, name, [() => sound.tick(2000)]);
    const expected = fixtures.modules[name]!;
    expect(sink.writes.length).toBe(expected.writes);
    expect(sink.fnv()).toBe(expected.fnv);
    expect(playedAt).toBe(expected.playedAt);
    expect(sound.songLoaded).toBe(false);
  });

  it.each(adls)("%s : bruitage sur la voix 4, écritures identiques à ScummVM", (name) => {
    const sink = new LogSink();
    const sound = new CroisiereSound(sink, loadFile);
    const bytes = volumes.readFile(name);
    expect(bytes.length).toBe(ADL_SIZE);
    sound.playFX(bytes);
    sound.tick(5);
    sound.stopFX(4);
    sound.tick(2);
    const expected = fixtures.sfx[name]!;
    expect(sink.writes.length).toBe(expected.writes);
    expect(sink.fnv()).toBe(expected.fnv);
  });

  it.each(modules)("%s : musique, bruitage et coupures mêlés, écritures identiques à ScummVM", (name) => {
    const expected = fixtures.mixed[name]!;
    const sink = new LogSink();
    const sound = new CroisiereSound(sink, loadFile);
    const fx = volumes.readFile(expected.adl!);
    const playedAt = playModule(sound, name, [
      () => sound.tick(500),
      () => sound.playFX(fx),
      () => sound.tick(500),
      () => sound.stopFX(4),
      () => sound.tick(300),
      () => sound.stopFX(-1),
      () => sound.tick(700),
    ]);
    expect(sink.writes.length).toBe(expected.writes);
    expect(sink.fnv()).toBe(expected.fnv);
    expect(playedAt).toBe(expected.playedAt);
  });

  it("chaque module joue 2 000 ticks sans erreur et sans s arrêter", () => {
    for (const name of modules) {
      const sink = new LogSink();
      const sound = new CroisiereSound(sink, loadFile);
      sound.loadSong(name);
      sound.playSong();
      sound.tick(2000);
      expect(sound.isPlaying, name).toBe(true);
      expect(sink.writes.length, name).toBeGreaterThan(112);
    }
  });
});
