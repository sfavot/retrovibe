import { describe, expect, it } from "vitest";
import {
  MUSIC_CONTEXTS,
  MUSIC_PREFERENCES,
  MusicSystem,
  trackFile,
  trackFor,
  type MusicContext,
  type MusicPlayer,
  type MusicPreference,
} from "../../../src/games/swiv3d/audio/music";

/** screens.md §8.2 : [SWIV, Classique, Divers]. */
const EXPECTED: Record<Exclude<MusicContext, "silent">, [number, number, number]> = {
  menu: [2, 9, 3],
  "level:TERRAN00": [3, 9, 2],
  "level:TERRAN01": [4, 10, 10],
  "level:TERRAN02": [5, 9, 6],
  "level:TERRAN03": [6, 9, 3],
};

class FakePlayer implements MusicPlayer {
  calls: string[] = [];
  muted = false;
  play(url: string, o?: { loop?: boolean }): void {
    this.calls.push(`play ${url}${o?.loop ? " loop" : ""}`);
  }
  stop(): void {
    this.calls.push("stop");
  }
  suspend(): void {
    this.calls.push("suspend");
  }
  resume(): void {
    this.calls.push("resume");
  }
  unlock(): void {
    this.calls.push("unlock");
  }
}

describe("musique : table des pistes", () => {
  for (const context of MUSIC_CONTEXTS) {
    for (const [i, pref] of MUSIC_PREFERENCES.entries()) {
      it(`${context} / ${pref}`, () => {
        const expected = context === "silent" ? null : EXPECTED[context][i];
        expect(trackFor(context, pref)).toBe(expected);
      });
    }
  }

  it("nomme les fichiers MUSIC/TRACKnn.MP3", () => {
    expect(trackFile(2)).toBe("MUSIC/TRACK02.MP3");
    expect(trackFile(10)).toBe("MUSIC/TRACK10.MP3");
  });
});

describe("MusicSystem", () => {
  it("joue en boucle la piste du contexte, préférence SWIV par défaut", () => {
    const p = new FakePlayer();
    const m = new MusicSystem(p, "/swiv3d");
    m.setContext("menu");
    expect(p.calls).toEqual(["play /swiv3d/MUSIC/TRACK02.MP3 loop"]);
    expect(m.track).toBe(2);
    expect(m.preference).toBe("swiv");
  });

  it("ne relance pas dans le même contexte, relance au changement de contexte", () => {
    const p = new FakePlayer();
    const m = new MusicSystem(p);
    m.setContext("menu");
    m.setContext("menu");
    m.setContext("level:TERRAN01");
    expect(p.calls).toEqual(["play MUSIC/TRACK02.MP3 loop", "play MUSIC/TRACK04.MP3 loop"]);
    m.restart();
    expect(p.calls.at(-1)).toBe("play MUSIC/TRACK04.MP3 loop");
  });

  it("silent coupe (vidéos, crédits), le menu relance", () => {
    const p = new FakePlayer();
    const m = new MusicSystem(p);
    m.setContext("menu");
    m.setContext("silent");
    expect(m.track).toBeNull();
    m.setContext("menu");
    expect(p.calls).toEqual(["play MUSIC/TRACK02.MP3 loop", "stop", "play MUSIC/TRACK02.MP3 loop"]);
  });

  it("changer de préférence ne redémarre que si la piste diffère", () => {
    const p = new FakePlayer();
    const m = new MusicSystem(p);
    m.setContext("level:TERRAN02"); // swiv 5, classique 9, divers 6
    m.setPreference("classical");
    expect(m.track).toBe(9);
    m.setPreference("misc");
    expect(m.track).toBe(6);
    const n = p.calls.length;
    const same: MusicPreference = "misc";
    m.setPreference(same);
    expect(p.calls).toHaveLength(n);
    // TERRAN01 : classique et divers jouent tous deux la piste 10
    m.setContext("level:TERRAN01");
    const k = p.calls.length;
    m.setPreference("classical");
    expect(p.calls).toHaveLength(k);
  });

  it("mute, suspend, resume et unlock sont transmis", () => {
    const p = new FakePlayer();
    const m = new MusicSystem(p);
    m.muted = true;
    expect(p.muted).toBe(true);
    m.suspend();
    m.resume();
    m.unlock();
    expect(p.calls).toEqual(["suspend", "resume", "unlock"]);
  });

  it("stop remet le contexte en silence", () => {
    const p = new FakePlayer();
    const m = new MusicSystem(p);
    m.setContext("menu");
    m.stop();
    expect(m.context).toBe("silent");
    expect(p.calls.at(-1)).toBe("stop");
  });
});
