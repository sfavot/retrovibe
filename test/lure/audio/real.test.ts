import { describe, expect, it } from "vitest";
import { SoundManager } from "../../../src/games/lure/audio/sound";
import { LureAudio, type MusicOutput } from "../../../src/games/lure/audio/audio";
import { isNoteOn } from "../../../src/audio/smf";
import { parseSound, readSoundSections, soundDescTarget, type SoundSectionName } from "../../../src/games/lure/data/sound";
import { hasOriginalFiles } from "../data/helpers";
import { lureData } from "../data/catalog-helper";
import { RecordingSink } from "./scenario";

/** Registres d'écriture d'un OPL2 : test (01), minuteries (02 à 04), sélection de note (08), puis opérateurs, voix, BD. */
function isOpl2Register(reg: number): boolean {
  if (reg === 0x01 || reg === 0x02 || reg === 0x03 || reg === 0x04 || reg === 0x08 || reg === 0xbd) return true;
  const operator = (base: number) => reg >= base && reg <= base + 0x15 && (reg & 0x07) < 6 && ((reg - base) & 0x0f) < 0x16 && (reg - base) % 8 < 6;
  if ([0x20, 0x40, 0x60, 0x80, 0xe0].some(operator)) return true;
  return [0xa0, 0xb0, 0xc0].some((base) => reg >= base && reg <= base + 8);
}

describe.skipIf(!hasOriginalFiles)("les 78 sons du jeu", () => {
  const data = hasOriginalFiles ? lureData() : undefined;
  const sections = hasOriginalFiles ? readSoundSections(data!.resources) : undefined;
  const cases = sections ? (Object.entries(sections) as [SoundSectionName, (typeof sections)["main"]][]).flatMap(([name, section]) => section.sounds.map((s) => [name, s.index] as const)) : [];

  it("sont 73 + 4 + 1", () => {
    expect(cases).toHaveLength(78);
    const silent = cases.filter(([name, index]) => !parseSound(sections![name].sounds[index]!).events.some((e) => e.kind === "midi" && isNoteOn(e.bytes)));
    expect(silent).toHaveLength(14);
  });

  it.each(cases)("%s %i joue jusqu'au bout : que des registres de l'OPL2, la source est rendue, les voix sont coupées", (name, index) => {
    const sink = new RecordingSink();
    const sound = new SoundManager({ sections: sections!, descs: data!.soundDescs, sink });
    sound.loadSection(name);
    // Un son sans boucle, lancé comme un bruitage (source 1) ; le bit 7 est retiré : la boucle n'est pas testée ici.
    sound.playMusic(index, false);
    let ticks = 0;
    // Au plus 20 minutes de musique.
    while (sound.playing.length > 0 && ticks < 250 * 1200) {
      sound.tick();
      ticks++;
    }
    expect(sound.playing).toEqual([]);
    // Un son lancé directement (`playMusic`) rend sa source au prochain `tidy` de ScummVM (ici l'arrêt d'un son).
    sound.killSound(index);
    expect(sound.sourcesInUse.some(Boolean)).toBe(false);
    for (const w of sink.writes) {
      expect(Number.isInteger(w.value) && w.value >= 0 && w.value <= 0xff).toBe(true);
      expect(isOpl2Register(w.reg), `registre ${w.reg.toString(16)}`).toBe(true);
    }
    // Aucune voix ne reste allumée : le dernier Bx écrit de chaque voix n'a pas le bit de mise en marche.
    const lastB = new Map<number, number>();
    for (const w of sink.writes) if (w.reg >= 0xb0 && w.reg <= 0xb8) lastB.set(w.reg, w.value);
    for (const [reg, value] of lastB) expect(value & 0x20, `voix ${reg - 0xb0}`).toBe(0);
    // Le morceau a joué ses notes (14 sons de la section principale sont des coquilles vides : aucune note, que les deux `FF 7F` de réglage).
    const hasNotes = parseSound(sections![name].sounds[index]!).events.some((e) => e.kind === "midi" && isNoteOn(e.bytes));
    expect(sink.writes.some((w) => w.reg >= 0xb0 && w.reg <= 0xb8 && (w.value & 0x20) !== 0)).toBe(hasNotes);
  });

  it("les sons en boucle des descriptions tournent sans fin, jusqu'à ce qu'on les coupe", () => {
    const looping = data!.soundDescs.map((d, i) => ({ d, i })).filter(({ d }) => soundDescTarget(d).loop);
    expect(looping.length).toBe(12);
    const sink = new RecordingSink();
    const sound = new SoundManager({ sections: sections!, descs: data!.soundDescs, sink });
    sound.loadSection("main");
    const first = looping[0]!;
    sound.addSound(first.i);
    for (let i = 0; i < 250 * 600; i++) sound.tick();
    expect(sound.isSoundActive(first.d.soundNumber)).toBe(true);
    sound.killSound(first.d.soundNumber);
    expect(sound.isSoundActive(first.d.soundNumber)).toBe(false);
  });
});

/** Sortie de musique de test : garde ce qu'on lui écrit, comme `WebOpl` sans le contexte audio. */
class FakeOutput extends RecordingSink implements MusicOutput {
  muted = false;
  level = 1;
  unlocked = 0;
  suspended = 0;
  closed = false;
  unlock(): void {
    this.unlocked++;
  }
  suspend(): void {
    this.suspended++;
  }
  resume(): void {}
  close(): void {
    this.closed = true;
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
  setVolume(level: number): void {
    this.level = level;
  }
}

describe.skipIf(!hasOriginalFiles)("LureAudio : l'hôte", () => {
  function setup() {
    const data = lureData();
    const sections = readSoundSections(data.resources);
    const output = new FakeOutput();
    const clock = { now: 1000 };
    const audio = new LureAudio({ now: () => clock.now, music: output, sections, descs: data.soundDescs });
    audio.sound.loadSection("main");
    return { audio, output, clock, data };
  }

  /** Joue le son de la description 0 pendant 5 s par pas de 16,7 ms ; rend, à chaque pas, s'il est encore actif. */
  function timeline(configure: (s: ReturnType<typeof setup>) => void): { active: boolean[]; writes: string[] } {
    const env = setup();
    configure(env);
    env.audio.sound.addSound(0);
    const active: boolean[] = [];
    for (let i = 0; i < 300; i++) {
      env.clock.now += 16.7;
      env.audio.update();
      active.push(env.audio.sound.isSoundActive(env.data.soundDescs[0]!.soundNumber));
    }
    return { active, writes: env.output.toLines() };
  }

  it("un son coupé (préférence « Son ») ne décale ni la durée des sons ni les écritures de registres", () => {
    const loud = timeline(() => {});
    const muted = timeline(({ audio }) => audio.setMuted(true));
    expect(muted.active).toEqual(loud.active);
    expect(muted.writes).toEqual(loud.writes);
    expect(loud.active.some(Boolean)).toBe(true);
  });

  it("la coupure ne fait que passer par la sortie ; le volume règle la sortie", () => {
    const { audio, output } = setup();
    audio.setMuted(true);
    expect(output.muted).toBe(true);
    audio.volume = 0.25;
    expect(output.level).toBe(0.25);
    audio.volume = 4;
    expect(audio.volume).toBe(1);
    audio.unlock();
    expect(output.unlocked).toBe(1);
  });

  it("onglet masqué : le son n'avance pas, au retour il reprend sans rattraper le temps perdu", () => {
    const { audio, clock } = setup();
    audio.sound.addSound(0);
    clock.now += 100;
    audio.update();
    const ticks = audio.sound.tickCount;
    audio.suspend();
    clock.now += 60_000;
    audio.update();
    expect(audio.sound.tickCount).toBe(ticks);
    audio.resume();
    clock.now += 40;
    audio.update();
    expect(audio.sound.tickCount).toBe(ticks + 10);
  });

  it("close coupe les sons et libère la sortie", () => {
    const { audio, output } = setup();
    audio.sound.addSound(0);
    audio.close();
    expect(audio.sound.playing).toEqual([]);
    expect(output.closed).toBe(true);
  });
});
