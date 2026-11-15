import { describe, expect, it } from "vitest";
import { SoundService } from "../../../src/games/croisiere/engine/sound-service";
import { EngineState } from "../../../src/games/croisiere/engine/state";
import { gameFiles, hasOriginalFiles } from "./support";

const nullSink = { write() {} };

describe("SoundService : cadence de 20 ms virtuelles", () => {
  it("rattrape les multiples de 20 ms franchis, quelle que soit la taille des attentes", () => {
    const s = new SoundService(nullSink, () => undefined);
    s.elapse(10);
    expect(s.ticks).toBe(0);
    s.elapse(10);
    expect(s.ticks).toBe(1);
    s.elapse(180);
    expect(s.ticks).toBe(10);
    for (let i = 0; i < 5; i++) s.elapse(10);
    expect(s.ticks).toBe(12); // 250 ms
    s.elapse(50);
    expect(s.ticks).toBe(15); // 300 ms
  });
});

describe.skipIf(!hasOriginalFiles)("SoundService : morceaux du jeu", () => {
  const files = gameFiles();
  const loadFile = (n: string) => (files.has(n) ? files.readFile(n) : undefined);
  const musics = ["CORP1", "CORP2", "CORP3", "CORP4", "CORP5", "CORP6"].filter((n) => files.has(n));

  it("un fondu en cours : LoadSong l'attend en 50 ms et fait avancer l'horloge du moteur", () => {
    expect(musics.length).toBeGreaterThan(1);
    const sound = new SoundService(nullSink, loadFile);
    const e = new EngineState({ files, sound });
    const wait = (ms: number) => e.delay(ms);
    sound.loadMusic(musics[0]!, wait);
    sound.playMusic();
    expect(sound.isPlaying()).toBe(true);
    e.delay(20);
    sound.fadeSong();
    expect(sound.songPlayed()).toBe(false);
    const start = e.virtualTime;
    sound.loadMusic(musics[1]!, wait);
    // fondu : 50 pas de 1 ligne ; le lecteur n'avance que tous les (eventsDelay + 1) ticks, l'attente est un multiple de 50 ms
    expect((e.virtualTime - start) % 50).toBe(0);
    expect(e.virtualTime - start).toBeGreaterThanOrEqual(50);
    expect(sound.songPlayed()).toBe(false); // le nouveau chargement remet l'indicateur à faux
    expect(sound.musicName()).toBe(musics[1]);
  });

  it("SongPlayed devient vrai à la fin du fondu", () => {
    const sound = new SoundService(nullSink, loadFile);
    sound.loadMusic(musics[0]!, (ms) => sound.elapse(ms));
    sound.playMusic();
    sound.fadeSong();
    let ms = 0;
    while (!sound.songPlayed() && ms < 20000) {
      sound.elapse(10);
      ms += 10;
    }
    expect(sound.songPlayed()).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(10);
  });
});
