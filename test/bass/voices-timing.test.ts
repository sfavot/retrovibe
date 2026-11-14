/**
 * Partie complète de *Beneath a Steel Sky* avec des voix qui durent (`speechOn`) : le service son est simulé, `startSpeech` rend vrai pour
 * chaque réplique qui a un MP3 dans `original/bass/voices` et `speechFinished` reste faux pendant **la durée réelle du MP3** (en-tête Xing,
 * sinon débit), comptée sur l'horloge du moteur comme `SampleChannel` (`audio/speech.ts` : « la durée suit l'horloge du jeu »). Une réplique
 * dure donc la voix, puis les 10 tours de `stdSpeak` (`spTime`), au lieu de « lettres + 5 tours » (`SilentSound`).
 *
 * La solution (`solution/walkthrough.ts`, lue seule) est celle de `full-game.test.ts`. Elle a été mise au point sans voix : le minutage
 * des personnages qui se promènent (Joey, Mme Piermont) en dépend. Deux niveaux de contrôle :
 * - **phase par phase** : un joueur sans voix amène la partie à la frontière de chaque phase, une sauvegarde est reprise dans un moteur à voix
 *   qui joue la phase ; 12 phases sur 13 vont au bout. La phase « 6. le parc » échoue : Mme Piermont s'arrête dans l'écran 31 (et non 32 comme
 *   sans voix) et la solution cherche le bouton de sa porte sans changer d'écran (défaut de la solution, pas du moteur) ;
 * - **partie d'une traite avec voix** (`it.fails`) : la solution s'arrête à l'étape 53 de la phase 3 (« Belle Vue ») : Joey ne monte pas dans
 *   l'ascenseur de l'écran 7 avec Foster. Son script (8249, `fnGetTo` de l'ascenseur, 3 essais) échoue en 3 tours : `AutoRoute` rend 1 (aucune
 *   route) depuis (344, 240) alors que sans voix Joey part de (352, 280) et arrive. Joey reste caché dans l'écran 7 pour toujours (script 44
 *   en pause), la partie ne peut plus continuer. Défaut de minutage de la solution, pas du portage : ScummVM, chargé avec le même état
 *   et les mêmes entrées, bloque Joey au même endroit (520 tours identiques). Voir `docs/bass/engine.md` § 20.
 *
 * Durée (vitest) : environ 3 s. `BASS_FULL_GAME=0` les passe.
 */

import { describe, expect, it } from "vitest";
import { speechFileOfText } from "../../src/games/bass/data/speech";
import type { BassEngine } from "../../src/games/bass/engine/game";
import { Var } from "../../src/games/bass/engine/ids";
import { parseSave } from "../../src/games/bass/engine/save";
import type { BassSound } from "../../src/games/bass/engine/services";
import { originalFiles } from "../support/original";
import { hasOriginalFiles, makeEngine } from "./engine/helpers";
import { Driver } from "./solution/driver";
import { PHASES } from "./solution/walkthrough";

const enabled = hasOriginalFiles && process.env.BASS_FULL_GAME !== "0";
const original = originalFiles("bass", "sky.dnr");

// --- Durée des MP3 --------------------------------------------------------------------------------------------------------

const MPEG1_L3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Durée en secondes d'un MP3 Layer III : nombre de trames de l'en-tête Xing / Info, sinon taille et débit de la première trame. */
export function mp3Seconds(bytes: Uint8Array): number {
  let pos = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) pos = 10 + (((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f));
  while (pos + 4 < bytes.length && !(bytes[pos] === 0xff && (bytes[pos + 1]! & 0xe0) === 0xe0)) pos++;
  const b1 = bytes[pos + 1]!;
  const b2 = bytes[pos + 2]!;
  const version = (b1 >> 3) & 3; // 3 : MPEG-1, 2 : MPEG-2, 0 : MPEG-2.5
  const rate = SAMPLE_RATES[version]?.[(b2 >> 2) & 3];
  if (!rate) throw new Error("MP3 : en-tête illisible");
  const samplesPerFrame = version === 3 ? 1152 : 576;
  const head = Buffer.from(bytes.subarray(pos, pos + 64)).toString("latin1");
  const xing = Math.max(head.indexOf("Xing"), head.indexOf("Info"));
  if (xing >= 0 && bytes[pos + xing + 7]! & 1) {
    const at = pos + xing + 8;
    const frames = ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    return (frames * samplesPerFrame) / rate;
  }
  const kbps = (version === 3 ? MPEG1_L3_KBPS : MPEG2_L3_KBPS)[b2 >> 4];
  if (!kbps) throw new Error("MP3 : débit inconnu");
  return ((bytes.length - pos) * 8) / (kbps * 1000);
}

/** Chemins (relatifs à `original/bass`) des MP3 présents. */
const VOICE_FILES = new Set(original.list((name) => /^\d+\.mp3$/.test(name)));

// --- Service son avec des voix qui durent ---------------------------------------------------------------------------------

/** Voix à durée réelle : `startSpeech` vrai si le MP3 existe, `speechFinished` vrai une fois sa durée écoulée sur l'horloge du moteur. */
class TimedSpeechSound implements BassSound {
  /** Réglage « voix » du panneau (`BassAudio.speechOn`) : le panneau le détecte par sa forme. */
  speechOn = true;
  now: () => number = () => 0;
  // Le reste du son (musique, effets) est muet.
  loadSection(): void {}
  startMusic(): void {}
  startFx(): void {}
  stopFx(): void {}
  pauseFx(): void {}
  unPauseFx(): void {}
  checkFxQueue(): void {}
  private endsAt = 0;
  private readonly durations = new Map<number, number>();
  started = 0;
  stopped = 0;
  /** Durée cumulée des voix lancées (ms). */
  spokenMs = 0;
  longestMs = 0;
  /** Numéros de texte des voix lancées, dans l'ordre. */
  readonly spoken: number[] = [];

  /** Durée du MP3 de `file` en ms, ou `undefined` s'il n'existe pas (environ 1 700 répliques n'ont pas de voix). */
  private duration(file: number): number | undefined {
    if (!this.durations.has(file)) {
      const path = `voices/${file}.mp3`;
      this.durations.set(file, VOICE_FILES.has(path) ? Math.round(mp3Seconds(original.read(path)) * 1000) : -1);
    }
    const ms = this.durations.get(file)!;
    return ms < 0 ? undefined : ms;
  }

  startSpeech(textNum: number): boolean {
    if (!this.speechOn) return false;
    const file = speechFileOfText(textNum & 0xffff);
    const ms = file === undefined ? undefined : this.duration(file);
    if (ms === undefined) return false;
    this.endsAt = this.now() + ms;
    this.started++;
    this.spokenMs += ms;
    this.longestMs = Math.max(this.longestMs, ms);
    this.spoken.push(textNum & 0xffff);
    return true;
  }

  speechFinished(): boolean {
    return this.now() >= this.endsAt;
  }

  stopSpeech(): void {
    if (!this.speechFinished()) this.stopped++;
    this.endsAt = 0;
  }
}

/** Index des durées de toutes les voix de `original/bass/voices` (pour les contrôles de vraisemblance). */
function allVoiceSeconds(): number[] {
  return [...VOICE_FILES].map((path) => mp3Seconds(original.read(path)));
}

// --- Partie ---------------------------------------------------------------------------------------------------------------

function startVoiced(): { driver: Driver; sound: TimedSpeechSound } {
  const sound = new TimedSpeechSound();
  const { engine, host } = makeEngine({ sound });
  sound.now = () => engine.timeMs;
  engine.startAfterIntro();
  const driver = new Driver(engine, host);
  driver.cycle(3);
  return { driver, sound };
}

function startSilent(): Driver {
  const { engine, host } = makeEngine();
  engine.startAfterIntro();
  const driver = new Driver(engine, host);
  driver.cycle(3);
  return driver;
}

/** Joue les étapes de `phases` ; rend le nombre d'étapes jouées et les écrans relevés. */
function play(driver: Driver, phases = PHASES): { steps: number; sections: Set<number>; screens: Set<number> } {
  const out = { steps: 0, sections: new Set<number>(), screens: new Set<number>() };
  for (const phase of phases) {
    for (const [index, step] of phase.steps.entries()) {
      try {
        driver.run(step);
      } catch (e) {
        throw new Error(`« ${phase.name} », étape ${index} (${JSON.stringify(step).slice(0, 100)}) : ${(e as Error).message}`);
      }
      out.steps++;
      out.sections.add(driver.engine.vars[Var.CUR_SECTION]!);
      out.screens.add(driver.screen);
    }
  }
  return out;
}

function stubLines(engine: BassEngine): string[] {
  return engine.journal.filter((line) => /souche|non port|non formé|inconnu/i.test(line));
}

describe.skipIf(!hasOriginalFiles)("durée des voix (MP3 d'origine)", () => {
  it("les 3 491 MP3 ont une durée lisible et vraisemblable (de 0,1 s à 30 s, 2 à 4 s en moyenne)", () => {
    const seconds = allVoiceSeconds();
    expect(seconds.length).toBeGreaterThan(3000);
    expect(Math.min(...seconds)).toBeGreaterThan(0.1);
    expect(Math.max(...seconds)).toBeLessThan(30);
    const mean = seconds.reduce((a, b) => a + b, 0) / seconds.length;
    expect(mean).toBeGreaterThan(1.5);
    expect(mean).toBeLessThan(5);
  });

  it("50007.mp3 : 46 trames MPEG-2 à 22 050 Hz, soit 1,2 s", () => {
    expect(mp3Seconds(original.read("voices/50007.mp3"))).toBeCloseTo(1.2, 1);
  });
});

describe.skipIf(!hasOriginalFiles)("durée des voix (MP3 d'origine)", () => {
  it("les MP3 ont une durée lisible et vraisemblable (de 0,1 s à 30 s, 1,5 à 5 s en moyenne)", () => {
    const seconds = allVoiceSeconds();
    expect(seconds.length).toBeGreaterThan(3000);
    expect(Math.min(...seconds)).toBeGreaterThan(0.1);
    expect(Math.max(...seconds)).toBeLessThan(30);
    const mean = seconds.reduce((a, b) => a + b, 0) / seconds.length;
    expect(mean).toBeGreaterThan(1.5);
    expect(mean).toBeLessThan(5);
  });

  it("50007.mp3 : 46 trames MPEG-2 à 22 050 Hz, soit 1,2 s", () => {
    expect(mp3Seconds(original.read("voices/50007.mp3"))).toBeCloseTo(1.2, 1);
  });
});

describe.skipIf(!enabled)("partie complète avec des voix qui durent", () => {
  it("phase par phase : chaque phase jouée avec les voix va au bout (sauf « 6. le parc », minutage de Mme Piermont)", () => {
    const silent = startSilent();
    const failed: string[] = [];
    let voicedCycles = 0;
    let silentCycles = 0;
    let started = 0;
    let stopped = 0;
    for (const phase of PHASES) {
      // Frontière de la phase : sauvegarde, vrai JSON, reprise dans un moteur à voix.
      const save = silent.engine.control.capture();
      expect(typeof save, `« ${phase.name} » : sauvegarde refusée à la frontière`).not.toBe("string");
      const parsed = parseSave(JSON.parse(JSON.stringify(save)));
      expect(parsed).not.toBeNull();
      const sound = new TimedSpeechSound();
      const { engine, host } = makeEngine({ sound });
      sound.now = () => engine.timeMs;
      engine.startAfterIntro();
      expect(engine.control.load(parsed!)).toBe(true);
      engine.mouse.pointerX = silent.engine.mouse.pointerX;
      engine.mouse.pointerY = silent.engine.mouse.pointerY;
      const voiced = new Driver(engine, host);
      const before = engine.cycleCount;
      try {
        play(voiced, [phase]);
        voicedCycles += engine.cycleCount - before;
        started += sound.started;
        stopped += sound.stopped;
        expect(stubLines(engine)).toEqual([]);
      } catch (e) {
        failed.push(`${phase.name} : ${(e as Error).message.slice(0, 120)}`);
      }
      const silentBefore = silent.engine.cycleCount;
      play(silent, [phase]);
      silentCycles += silent.engine.cycleCount - silentBefore;
    }
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("6. le parc");
    expect(failed[0]).toContain("sc32_buzzer");
    // Les voix ont joué (plus de 800 répliques), des clics en ont coupé, et le minutage n'est plus celui de « lettres + 5 tours » (`SilentSound`).
    expect(started).toBeGreaterThan(800);
    expect(stopped).toBeGreaterThan(0);
    expect(voicedCycles).not.toBe(silentCycles);
  }, 300_000);

  it("les trois premières phases d'une traite, avec les voix, vont au bout", () => {
    const { driver, sound } = startVoiced();
    // La phase 3 (« Belle Vue ») est jouée jusqu'à l'étape 52 : voir l'étape 53 plus bas.
    play(driver, [PHASES[0]!, PHASES[1]!, { ...PHASES[2]!, steps: PHASES[2]!.steps.slice(0, 53) }]);
    expect(sound.started).toBeGreaterThan(300);
    expect(driver.texts.join("\n")).toContain("J'ai l'impression que Reich a eu le souffle COUPE!");
  }, 120_000);

  // Voir l'en-tête : Joey ne monte pas dans l'ascenseur de l'écran 7 (autoroute 1 depuis (344, 240)), la solution ne peut plus continuer.
  it.fails("d'une traite avec les voix : la solution arrive au générique (échoue : Joey reste dans l'écran 7, phase 3, étape 53)", () => {
    const { driver } = startVoiced();
    play(driver);
    expect(driver.screen).toBe(85);
    expect(driver.texts.join("\n")).toContain("Copyright 1994 Revolution Software Limited");
  }, 300_000);
});
