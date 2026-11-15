import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AdlPlayer, parseAdl } from "../../src/engine/coktel/audio/adlib/adl-player";
import { OplAdlibOutput } from "../../src/engine/coktel/audio/adlib/output";
import { Opl2 } from "../../src/audio/opl2";
import type { SoundBackend } from "../../src/engine/coktel/audio/backend";
import { SoundEngine } from "../../src/engine/coktel/audio/sound";
import { hasOriginalFiles, loadArchive } from "./helpers";

const RATE = 44100;

function rms(buf: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function hash(buf: Int16Array | Float32Array): string {
  return createHash("sha1").update(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)).digest("hex").slice(0, 12);
}

/** Note de 440 Hz sur le canal 0 : modulateur + porteuse, enveloppes rapides, tenue. */
function playA440(opl: Opl2): void {
  opl.writeReg(0x20, 0x01);
  opl.writeReg(0x40, 0x3f); // modulateur quasi muet : sinus pur
  opl.writeReg(0x60, 0xf0);
  opl.writeReg(0x80, 0x77);
  opl.writeReg(0x23, 0x01);
  opl.writeReg(0x43, 0x00);
  opl.writeReg(0x63, 0xf0);
  opl.writeReg(0x83, 0x77);
  opl.writeReg(0xc0, 0x00);
  opl.writeReg(0xa0, 0x41);
  opl.writeReg(0xb0, 0x32); // key on, block 4, fnum 0x241 (~ 440 Hz)
}

describe("OPL2 (port de mame.cpp)", () => {
  it("reste muet sans note", () => {
    const buf = new Int16Array(2000);
    new Opl2(RATE).generate(buf, 0, buf.length);
    expect(rms(buf)).toBe(0);
  });

  it("produit un son non nul et déterministe", () => {
    const run = (): Int16Array => {
      const opl = new Opl2(RATE);
      playA440(opl);
      const buf = new Int16Array(RATE / 2);
      opl.generate(buf, 0, buf.length);
      return buf;
    };
    const a = run();
    const b = run();
    expect(rms(a)).toBeGreaterThan(500);
    expect(a.reduce((m, v) => Math.max(m, v), 0)).toBeGreaterThan(1000);
    expect(hash(a)).toBe(hash(b));
    expect(hash(a)).toMatchInlineSnapshot(`"53c4ad7de2b9"`);
  });

  it("la fréquence suit le registre : ~440 Hz", () => {
    const opl = new Opl2(RATE);
    playA440(opl);
    const buf = new Int16Array(RATE);
    opl.generate(buf, 0, buf.length);
    let crossings = 0;
    for (let i = RATE / 4 + 1; i < RATE; i++) if (buf[i - 1] < 0 && buf[i] >= 0) crossings++;
    const hz = crossings / 0.75;
    expect(hz).toBeGreaterThan(400);
    expect(hz).toBeLessThan(480);
  });

  it("la coupure de note fait décroître le son", () => {
    const opl = new Opl2(RATE);
    playA440(opl);
    const sound = new Int16Array(RATE / 4);
    opl.generate(sound, 0, sound.length);
    opl.writeReg(0xb0, 0x12); // key off
    opl.writeReg(0x83, 0x7f);
    opl.writeReg(0x63, 0xff);
    opl.generate(sound, 0, sound.length);
    const tail = new Int16Array(RATE / 4);
    opl.generate(tail, 0, tail.length);
    expect(rms(tail)).toBeLessThan(rms(sound) / 4);
  });

  it("le mode rythme fait du bruit", () => {
    const opl = new Opl2(RATE);
    playA440(opl);
    opl.writeReg(0xbd, 0x20 | 0x10 | 0x08);
    const buf = new Int16Array(4000);
    opl.generate(buf, 0, buf.length);
    expect(rms(buf)).toBeGreaterThan(0);
  });
});

/** Morceau minimal : un timbre, note 60 au volume max sur la voix 0, 100 ms, fin. */
function miniSong(): Uint8Array {
  const header = [0, 0, 0];
  const timbre = new Uint16Array(28);
  // modulateur puis porteuse : attaque 15, sustain, forme sinus, FM
  const op = (level: number) => [0, 1, 0, 15, 7, 1, 0, 4, level, 0, 0, 0, 1];
  timbre.set([...op(63), ...op(0)], 0);
  const bytes = [...header, ...new Uint8Array(timbre.buffer)];
  const song = [
    0x00, // premier délai ignoré
    0x00, 60, 127, 100, // note on voix 0, puis 100 ticks
    0x80, 100, // note off, 100 ticks
    0xff,
  ];
  const out = new Uint8Array(bytes.length + song.length + 40);
  out.set(bytes);
  out.set(song, bytes.length);
  return out;
}

describe("ADL", () => {
  it("refuse un fichier de moins de 60 octets", () => {
    expect(parseAdl(new Uint8Array(59))).toBeNull();
    expect(parseAdl(miniSong())).not.toBeNull();
  });

  it("accepte un fichier tronqué comme ADLPlayer::load (seul err() compte) : mots manquants à 0, morceau vide, fin au premier tick", () => {
    const data = new Uint8Array(60);
    data.set([0, 2, 0]); // trois timbres annoncés (171 octets), 57 présents
    data.fill(0x11, 3);
    const adl = parseAdl(data)!;
    expect(adl).not.toBeNull();
    expect(adl.timbres).toHaveLength(3);
    expect(adl.timbres[0][27]).toBe(0x1111);
    expect(adl.timbres[1][0]).toBe(0x11); // mot coupé : octet de poids fort manquant
    expect(adl.timbres[1][1]).toBe(0);
    expect(Array.from(adl.timbres[2]).every((w) => w === 0)).toBe(true);
    expect(adl.songSize).toBe(0);

    let ms = 0;
    const out = new OplAdlibOutput({ write: () => {} }, () => ms);
    let stopped = 0;
    out.onStopped = () => stopped++;
    out.load(data);
    out.play();
    ms = 1;
    out.update();
    expect(out.playing).toBe(false);
    expect(stopped).toBe(1);
  });

  /** Lecteur rendu par son émulateur (`render`), comme dans le script d'écoute. */
  function player(data: Uint8Array, repeat: number): AdlPlayer {
    const p = new AdlPlayer(RATE);
    p.load(data);
    p.setRepeating(repeat);
    p.startPlay();
    return p;
  }
  const render = (p: AdlPlayer, buf: Float32Array) => p.render(buf, 0, buf.length);

  it("joue un morceau minimal puis s'arrête (délais en ms)", () => {
    const p = player(miniSong(), 0);
    let stopped = 0;
    p.onFinished = () => stopped++;
    expect(p.isPlaying()).toBe(true);
    const buf = new Float32Array(RATE / 10); // 100 ms : la note sonne
    render(p, buf);
    expect(rms(buf)).toBeGreaterThan(0.01);
    expect(p.isPlaying()).toBe(true);
    render(p, new Float32Array(RATE / 4));
    expect(p.isPlaying()).toBe(false);
    expect(stopped).toBe(1);
  });

  it("boucle selon le compteur de répétitions", () => {
    const p = player(miniSong(), 2); // trois passages au total
    const buf = new Float32Array(RATE / 100);
    let ms = 0;
    for (; p.isPlaying() && ms < 5000; ms += 10) render(p, buf);
    expect(ms).toBeGreaterThan(3 * 200 - 20);
    expect(ms).toBeLessThan(3 * 200 + 60);
    expect(p.getRepeating()).toBe(0);
  });

  it("boucle infinie tant qu'on ne l'arrête pas", () => {
    const p = player(miniSong(), -1);
    const buf = new Float32Array(RATE);
    for (let i = 0; i < 3; i++) render(p, buf);
    expect(p.isPlaying()).toBe(true);
    p.stopPlay();
    expect(p.isPlaying()).toBe(false);
  });

  it("se tait complètement bien après l'arrêt", () => {
    const p = player(miniSong(), 0);
    const buf = new Float32Array(RATE);
    for (let i = 0; i < 4; i++) render(p, buf);
    expect(p.isPlaying()).toBe(false);
    expect(rms(buf)).toBe(0);
  });

  it("une puce externe ne se rend pas ici", () => {
    const p = new AdlPlayer({ write: () => {} });
    expect(() => p.render(new Float32Array(10), 0, 10)).toThrow();
  });
});

describe("SoundEngine + AdLib", () => {
  function setup(adl: Uint8Array) {
    let ms = 0;
    const out = new OplAdlibOutput({ write: () => {} }, () => ms);
    const backend: SoundBackend = {
      adlib: out,
      playSample: () => {},
      stopSample: () => {},
      queuePcm: () => {},
      clearQueue: () => {},
    };
    const sound = new SoundEngine({
      backend,
      host: { now: () => ms, nextFrame: async () => {} },
      source: { getFile: () => undefined, getResource: () => adl },
    });
    sound.load({ slot: 1, adlib: true, id: 1, name: null });
    /** Avance l'horloge du jeu, comme une image de l'hôte. */
    const advance = (dt: number) => {
      ms += dt;
      out.update();
    };
    return { sound, out, advance, time: () => ms };
  }

  it("suit la fin réelle du morceau et la répétition demandée", () => {
    const { sound, advance, time } = setup(miniSong());
    sound.play(1, 2, 0); // deux passages : une répétition
    expect(sound.adlibPlaying).toBe(true);
    while (sound.adlibPlaying && time() < 5000) advance(10);
    expect(time()).toBeGreaterThan(2 * 200 - 20);
    expect(time()).toBeLessThan(2 * 200 + 40);
  });

  it("stopAdlib coupe, un fichier trop petit ne se charge pas", () => {
    const { sound, out, advance } = setup(miniSong());
    sound.play(1, 0, 0); // répétition 0 = boucle infinie
    advance(1000);
    expect(sound.adlibPlaying).toBe(true); // boucle infinie
    sound.stopAdlib();
    expect(sound.adlibPlaying).toBe(false);
    expect(out.playing).toBe(false);

    const small = setup(new Uint8Array(40).fill(1));
    small.sound.play(1, 1, 0);
    expect(small.sound.adlibPlaying).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("ADL du jeu (INTRO.STK)", () => {
  const archive = loadArchive("INTRO.STK");
  const adls = archive.entries.filter((e) => /^DORA.*\.ADL$/i.test(e.name));

  it("contient des DORA*.ADL, tous lisibles", () => {
    expect(adls.length).toBeGreaterThan(0);
    for (const entry of adls) {
      const adl = parseAdl(archive.extract(entry));
      expect(adl, entry.name).not.toBeNull();
      expect(adl!.timbres.length).toBeGreaterThan(0);
      expect(adl!.songSize).toBeGreaterThan(0);
      expect(adl!.song[adl!.songSize - 1], entry.name).toBe(0xff); // marqueur de fin
    }
  });

  it("chaque morceau se joue jusqu'au bout sans erreur", () => {
    for (const entry of adls) {
      const player = new AdlPlayer(RATE);
      player.load(archive.extract(entry));
      player.setRepeating(0);
      player.startPlay();
      const buf = new Float32Array(RATE / 10);
      let seconds = 0;
      for (; player.isPlaying() && seconds < 600; seconds += 0.1) player.render(buf, 0, buf.length);
      expect(player.isPlaying(), entry.name).toBe(false);
      expect(seconds, entry.name).toBeGreaterThan(0.5);
    }
    // Rend en entier les 14 morceaux (plusieurs minutes de musique) : délai large quand la suite tourne en parallèle.
  }, 60_000);

  it("DORA10 : 10 s de rendu sonore, déterministe", () => {
    const entry = archive.entries.find((e) => /^DORA10\.ADL$/i.test(e.name));
    expect(entry).toBeDefined();
    const render = (): Float32Array => {
      const player = new AdlPlayer(RATE);
      player.load(archive.extract(entry!));
      player.setRepeating(-1);
      player.startPlay();
      const out = new Float32Array(RATE * 10);
      for (let i = 0; i < out.length; i += 1000) player.render(out, i, Math.min(1000, out.length - i));
      return out;
    };
    const a = render();
    const level = rms(a);
    expect(level).toBeGreaterThan(0.01);
    expect(level).toBeLessThan(0.5);
    expect(a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(1);
    expect(hash(render())).toBe(hash(a));
  });
});
