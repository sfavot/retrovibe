/**
 * Musique au fil d'un parcours, comme l'enchaîne `ui/app.ts` : lancement → titre → menu → fiche du puzzle (voix du but) → puzzle →
 * aide du professeur → victoire → puzzle suivant → Labo → menu. Chaque départ du début d'un morceau et chaque coupure sont journalisés,
 * et comparés à l'original (TIMWIN.EXE, `docs/tim3/audio.md` § Enchaînement) :
 * - `PlaySound(music, 0, 1)` (41126d) ne relance pas un morceau qui joue ;
 * - la fiche (425edc … 425efa) arrête et relance le morceau du puzzle : il repart du début, même s'il n'a pas changé ;
 * - la voix du professeur (424684) arrête la musique ; elle repart du début à la fin de la voix (424622) ou à la fermeture (423f9d, 425d6f) ;
 *   sur la fiche, seulement à la fermeture.
 */
import { describe, expect, it, vi } from "vitest";
import { FakeAudioContext } from "../../support/fake-audio-context";
import { goalVoice, helpVoice, musicFileName } from "../../../src/games/tim3/audio/ids";
import type { GmPort } from "../../../src/games/tim3/audio/music";

vi.mock("spessasynth_lib/dist/spessasynth_processor.min.js?url", () => ({ default: "processor.js" }));
vi.mock("spessasynth_lib", () => ({ WorkletSynthesizer: class {} }));

const { WebTim3Audio } = await import("../../../src/games/tim3/audio/audio");

/** Morceau HMI : introduction (note `intro` au tick 0), puis boucle de 60 à 240 (note `intro + 1`). */
function song(intro: number): Uint8Array {
  const head = new Array(0x60).fill(0);
  [..."HMI-MIDITRACK"].forEach((c, i) => (head[i] = c.charCodeAt(0)));
  head[0x57] = 0x60;
  const events = [
    ...[0x00, 0x90, intro, 0x7f, 0x10],
    ...[0x3c, 0xfe, 0x14, 0xff, 0xff],
    ...[0x00, 0x90, intro + 1, 0x7f, 0x10],
    ...[0x81, 0x34, 0xfe, 0x15, 0x80, 0x01, 0, 0, 0, 0],
    ...[0x00, 0xff, 0x2f, 0x00],
  ];
  const track = [...head, ...events];
  const out = new Uint8Array(0x172 + 4 + track.length);
  [..."HMI-MIDISONG061595"].forEach((c, i) => (out[i] = c.charCodeAt(0)));
  const view = new DataView(out.buffer);
  view.setUint16(0xd4, 120, true);
  view.setUint32(0xe4, 1, true);
  view.setUint32(0xe8, 0x172, true);
  view.setUint32(0x172, 0x176, true);
  out.set(track, 0x176);
  return out;
}

/** Note d'introduction de chaque morceau : l'entendre, c'est un départ du début. */
const INTRO: Record<number, number> = { 1000: 0x30, 1001: 0x40, 1002: 0x50 };
const songOfIntro = new Map(Object.entries(INTRO).map(([n, key]) => [key, Number(n)]));

function rig() {
  const ctx = new FakeAudioContext(false);
  const clock = { now: 0 };
  const log: string[] = [];
  const resources = Object.fromEntries(Object.entries(INTRO).map(([n, key]) => [musicFileName(Number(n)), song(key)]));
  let playing = false;
  const audio = new WebTim3Audio({
    now: () => clock.now,
    resources: { has: (n) => n in resources, get: (n) => resources[n] },
    voices: { has: () => true, load: async () => new Uint8Array([1, 2, 3]) },
    storage: { get: () => null, set: () => {} },
    soundfontUrl: "sf.sf2",
    createContext: () => ctx.asContext(),
    createGmPort: () =>
      ({
        ready: true,
        now: () => clock.now,
        send: (m: Uint8Array) => {
          const n = songOfIntro.get(m[1]);
          if (m[0] === 0x90 && n !== undefined) log.push(`début ${n}`);
          if (m[0] === 0x90) playing = true;
        },
        reset: () => {
          if (playing) log.push("coupe");
          playing = false;
        },
        load: async () => {},
        close: () => {},
      }) satisfies GmPort & { load(): Promise<void>; close(): void },
  });
  audio.unlock();
  ctx.decoded = { sampleRate: 11025, length: 11025 * 2, channels: 1 }; // voix de 2 s
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** `ms` millisecondes de jeu, une image toutes les 50 ms. */
  const wait = (ms: number): void => {
    for (const end = clock.now + ms; clock.now < end; ) {
      clock.now += 50;
      audio.update();
    }
  };
  /** Ce qui s'est passé depuis le dernier appel. */
  const take = (): string[] => log.splice(0);
  return { audio, wait, flush, take };
}

describe("musique au fil d'un parcours", () => {
  it("suit l'enchaînement de l'original", async () => {
    const { audio, wait, flush, take } = rig();

    // Titre (42a60a) puis fin de l'intro (43b19e) : 1000, qui continue ; crédits et menu principal n'y touchent pas.
    audio.playMusic(1000);
    wait(500);
    audio.playMusic(1000);
    wait(2000);
    expect(take()).toEqual(["début 1000"]);

    // Jeu : chargement du puzzle (`enterPuzzle` → `PlaySound(1001, 0, 1)`), puis la fiche relance du début.
    audio.enterPuzzle(1001);
    audio.restartMusic();
    wait(100);
    expect(take()).toEqual(["coupe", "début 1001", "coupe", "début 1001"]);

    // 18 passes plus tard, la voix du but : la musique s'arrête et ne reprend pas avant OK, même la voix finie.
    wait(850);
    expect(audio.playVoice(goalVoice(3), false)).toBe(true);
    await flush();
    wait(3000);
    expect(audio.voiceActive).toBe(false);
    expect(take()).toEqual(["coupe"]);
    expect(audio.musicNumber).toBe(1001);
    // OK : voix coupée, musique relancée du début.
    audio.stopVoice();
    audio.resumeMusic();
    wait(100);
    expect(take()).toEqual(["début 1001"]);

    // Aide du professeur : musique arrêtée pendant la voix, relancée du début à sa fin (424622).
    expect(audio.playVoice(helpVoice(1))).toBe(true);
    await flush();
    wait(1000);
    expect(take()).toEqual(["coupe"]);
    wait(1500);
    expect(take()).toEqual(["début 1001"]);
    // Voix coupée par la fermeture de la fenêtre (423f9d) : relancée aussi.
    audio.playVoice(helpVoice(1));
    await flush();
    wait(500);
    audio.stopVoice();
    wait(100);
    expect(take()).toEqual(["coupe", "début 1001"]);
    // Une voix qui en remplace une autre dans la même image ne laisse pas repartir la musique.
    audio.playVoice(helpVoice(1));
    audio.stopVoice();
    audio.playVoice(helpVoice(1));
    await flush();
    wait(500);
    expect(take()).toEqual(["coupe"]);
    wait(2000);
    take();

    // Victoire (PUZZSOLV) : rien. Puzzle suivant, même morceau : la fiche le relance quand même du début.
    wait(1000);
    audio.enterPuzzle(1001);
    expect(take()).toEqual([]);
    audio.restartMusic();
    wait(100);
    expect(take()).toEqual(["coupe", "début 1001"]);
    audio.stopVoice();
    audio.resumeMusic(); // OK avant la voix : la musique continue
    wait(100);
    expect(take()).toEqual([]);

    // Labo (pas de fiche) : sa musique, qui continue si c'est la même ; essai et retour au Labo : rien ne change.
    audio.enterPuzzle(1002);
    wait(100);
    audio.enterPuzzle(1002);
    wait(100);
    expect(take()).toEqual(["coupe", "début 1002"]);

    // Menu principal : la musique continue ; Quitter : tout s'arrête.
    wait(1000);
    audio.stopAll();
    expect(take()).toEqual(["coupe"]);
    expect(audio.musicNumber).toBe(0);
  });

  it("un morceau demandé pendant la voix attend la fin de la voix", async () => {
    const { audio, wait, flush, take } = rig();
    audio.playMusic(1000);
    wait(100);
    audio.playVoice(helpVoice(1));
    await flush();
    audio.playMusic(1001);
    wait(500);
    expect(take()).toEqual(["début 1000", "coupe"]);
    expect(audio.musicNumber).toBe(1001);
    wait(2000);
    expect(take()).toEqual(["début 1001"]);
  });

  it("voix désactivées : la musique n'est jamais coupée", () => {
    const { audio, wait, take } = rig();
    audio.voicesEnabled = false;
    audio.playMusic(1000);
    wait(100);
    expect(audio.playVoice(goalVoice(3), false)).toBe(false);
    wait(1000);
    expect(take()).toEqual(["début 1000"]);
  });
});
