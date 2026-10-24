import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/games/mathemagique/data/mohawk";
import type { Shape } from "../../src/games/mathemagique/data/shap";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import {
  GadgetManager,
  HotspotTable,
  KEYBOARD_FLASH_TICKS,
  helpCursorAt,
  rectContains,
  rectFromEdges,
  type GadgetSpec,
} from "../../src/games/mathemagique/engine/gadgets";
import { Surface } from "../../src/games/mathemagique/engine/graphics/surface";
import { Input, type ButtonEvent, type KeyEvent, type MouseButton } from "../../src/games/mathemagique/engine/input";
import {
  CURS_BYTES,
  CursorController,
  PLAY_AREA,
  PointerService,
  clampToBounds,
  cssCursor,
  decodeCursor,
  encodePng,
  hitShapeAt,
  loadCursorImages,
  pickTopmost,
  type PickResult,
  type PointerMode,
} from "../../src/games/mathemagique/engine/pointer";
import { Archive } from "../../src/games/mathemagique/engine/resources";
import { SCR_FLAG, ScrPlayer, type ScrSoundPort } from "../../src/games/mathemagique/engine/scr-player";
import { SceneId, type Scene, type SceneContext } from "../../src/games/mathemagique/engine/scene";
import { GRAPHICS, installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import { SoundService, type PlaySoundOptions, type SoundHandle } from "../../src/games/mathemagique/engine/sound";
import { TestHost, runFor } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

// --- Archive synthétique -------------------------------------------------------------------------------------------------------

const TAG = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16le = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u16be = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const u32be = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

interface Res {
  tag: string;
  id: number;
  data: Uint8Array | number[];
}

/** Archive Mohawk minimale avec les ressources données (même format que les `.DAT`, voir formats.md). */
function buildMohawk(resources: Res[]): Uint8Array {
  const byTag = new Map<string, Res[]>();
  for (const r of resources) byTag.set(r.tag, [...(byTag.get(r.tag) ?? []), r]);
  const tags = [...byTag.keys()];
  const abs = 28;
  const typesSize = 4 + tags.length * 8;
  let tablesAt = typesSize;
  const tableOffsets = new Map<string, number>();
  for (const tag of tags) {
    tableOffsets.set(tag, tablesAt);
    tablesAt += 2 + byTag.get(tag)!.length * 4;
  }
  const fileTableOffset = tablesAt;
  const fileTableSize = 4 + resources.length * 10;
  const dataStart = abs + fileTableOffset + fileTableSize;
  const out: number[] = new Array(dataStart).fill(0);
  const put = (at: number, bytes: number[]) => bytes.forEach((b, i) => (out[at + i] = b));
  put(0, TAG("MHWK"));
  put(8, TAG("RSRC"));
  put(20, u32be(abs));
  put(24, u16be(fileTableOffset));
  put(abs + 2, u16be(tags.length));
  let index = 1;
  const files: { offset: number; size: number }[] = [];
  let cursor = dataStart;
  const body: number[] = [];
  tags.forEach((tag, t) => {
    const list = byTag.get(tag)!;
    put(abs + 4 + t * 8, [...TAG(tag), ...u16be(tableOffsets.get(tag)!), ...u16be(0)]);
    const table = abs + tableOffsets.get(tag)!;
    put(table, u16be(list.length));
    list.forEach((r, i) => {
      put(table + 2 + i * 4, [...u16be(r.id), ...u16be(index++)]);
      const bytes = [...r.data];
      files.push({ offset: cursor, size: bytes.length });
      body.push(...bytes);
      cursor += bytes.length;
    });
  });
  put(abs + fileTableOffset, u32be(files.length));
  files.forEach((f, i) => put(abs + fileTableOffset + 4 + i * 10, [...u32be(f.offset), ...u16be(f.size & 0xffff), (f.size >> 16) & 0xff, 0, 0, 0]));
  const bytes = Uint8Array.from([...out, ...body]);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8);
  return bytes;
}

/** SHAP 8 bits non compressée : `pixels` ligne par ligne, pas aligné sur 4. */
function shap(width: number, height: number, pixels: number[]): number[] {
  const pitch = (width + 3) & ~3;
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = pixels.slice(y * width, (y + 1) * width);
    while (row.length < pitch) row.push(0);
    rows.push(...row);
  }
  return [...u16be(width), ...u16be(height), ...u16be(pitch), ...u16be(2), ...rows];
}

const solid = (w: number, h: number, v: number) => shap(w, h, new Array(w * h).fill(v));
const shpl = (first: number, count: number) => [...u16be(first), ...u16be(count), ...u16be(0), ...u16be(0)];

/** WAVE Mohawk : 11025 Hz, 8 bits mono, `samples` échantillons (0,2 s pour 2205). */
function wave(samples: number): number[] {
  const data = [...u16be(11025), ...u32be(samples), 8, 1, ...u16be(0), ...u16be(0), ...u32be(0), ...u32be(0), ...new Array(samples).fill(0x90)];
  return [...TAG("MHWK"), ...u32be(8 + data.length), ...TAG("WAVE"), ...TAG("Data"), ...u32be(data.length), ...data];
}

const sndl = (...ids: number[]) => [...u16le(ids.length), ...ids.flatMap(u16le)];

const op = {
  frame: (count: number, delay: number) => [1, ...u16le(count), ...u16le(delay)],
  sound: (id: number) => [3, ...u16le(id)],
  render: () => [7],
  hook: (hook: number, arg: number) => [0x10 | hook, ...u16le(arg)],
  flags: (cell: number, mask: number, or: number) => [0x20 | cell, ...u16le(mask), ...u16le(or)],
  position: (cell: number, x: number, y: number) => [0x60 | cell, ...u16le(x & 0xffff), ...u16le(y & 0xffff)],
  shape: (cell: number, shape: number) => [0x80 | cell, ...u16le(shape), ...u16le(shape)],
};

/** Zone (haut 100, gauche 50, bas 200, droite 150) puis les opcodes et `END`. */
const script = (...ops: number[][]) => [...u16le(100), ...u16le(50), ...u16le(200), ...u16le(150), ...ops.flat(), 0];

/** Cellule 1 : forme 1 (carré 8×8 d'index 5) en (10, 20) pendant 14 ticks, puis en (30, 20) pendant 5 ticks. Durée 19. */
const mover = (...between: number[][]) =>
  script(op.shape(1, 1), op.position(1, 10, 20), op.flags(1, 0xfff0, 0xa), op.frame(2, 7), ...between, op.position(1, 30, 20), op.frame(1, 5));

function syntheticArchive(): Archive {
  const resources: Res[] = [
    { tag: "SHPL", id: 100, data: shpl(500, 3) },
    { tag: "SHPL", id: 200, data: shpl(501, 2) },
    { tag: "SHAP", id: 500, data: solid(8, 8, 5) },
    { tag: "SHAP", id: 501, data: solid(4, 4, 7) },
    // Forme 3 : 4×4, pixel (0,0) transparent, le reste 9.
    { tag: "SHAP", id: 502, data: shap(4, 4, [0, ...new Array(15).fill(9)]) },
    { tag: "\0SCR", id: 100, data: mover() },
    { tag: "\0SCR", id: 101, data: mover(op.render(), op.sound(900)) },
    { tag: "SNDL", id: 101, data: sndl(900) },
    { tag: "\0SND", id: 900, data: wave(2205) },
    // Même position, forme 2 (index 7) : sert au test de l'ordre z.
    { tag: "\0SCR", id: 102, data: script(op.shape(1, 2), op.position(1, 10, 20), op.flags(1, 0xfff0, 0xa), op.frame(1, 30)) },
    // Hooks : un après la première image, un après la seconde.
    { tag: "\0SCR", id: 103, data: script(op.frame(1, 5), op.hook(0, 7), op.frame(1, 5), op.hook(0, 8), op.frame(1, 5)) },
    // Trois images de 2, 3 et 4 ticks, une forme par image.
    {
      tag: "\0SCR",
      id: 104,
      data: script(
        op.shape(1, 1),
        op.position(1, 0, 0),
        op.flags(1, 0xfff0, 0xa),
        op.frame(2, 1),
        op.shape(1, 2),
        op.frame(3, 1),
        op.shape(1, 3),
        op.frame(4, 1),
      ),
    },
  ];
  return new Archive("SYNTH.DAT", MohawkArchive.parse(buildMohawk(resources)));
}

// --- Aides ---------------------------------------------------------------------------------------------------------------------

/** Port sonore qui journalise (temps de l'animation à l'appel). */
class RecordingSound implements ScrSoundPort {
  readonly played: { id: number; options: PlaySoundOptions | undefined }[] = [];
  musicStops = 0;
  playSound(_archive: unknown, id: number, options?: PlaySoundOptions): SoundHandle | null {
    this.played.push({ id, options });
    return null;
  }
  isPlaying(): boolean {
    return false;
  }
  stop(): void {}
  stopMusic(): void {
    this.musicStops++;
  }
}

function setup(options: { sound?: ScrSoundPort } = {}) {
  const surface = new Surface();
  surface.fill(1);
  const dirty = { count: 0 };
  const player = new ScrPlayer({ surface, sound: options.sound, onDirty: () => dirty.count++ });
  return { surface, player, dirty, archive: syntheticArchive() };
}

function tick(player: ScrPlayer, n = 1, input?: Input): void {
  for (let i = 0; i < n; i++) player.tick(input);
}

/** Entrée dans l'état « un clic vient d'arriver ». */
function clickedInput(): Input {
  const input = new Input();
  input.moveMouse(5, 5);
  input.mouseDown("left");
  input.mouseUp("left");
  input.beginTick();
  return input;
}

function press(x: number, y: number, button: MouseButton = "left"): ButtonEvent {
  return { button, down: true, x, y, ctrl: false, shift: false, alt: false };
}

function release(x: number, y: number, button: MouseButton = "left"): ButtonEvent {
  return { button, down: false, x, y, ctrl: false, shift: false, alt: false };
}

function key(code: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { code, key: code, repeat: false, ctrl: false, shift: false, alt: false, ...mods };
}

// --- Lecteur de scripts SCR ----------------------------------------------------------------------------------------------------

describe("ScrPlayer (scripts synthétiques)", () => {
  it("présente l'image 0 au démarrage et change d'image au tick prévu, termine à la durée du script", () => {
    const { surface, player, archive } = setup();
    const anim = player.start(archive, 100, { flags: SCR_FLAG.saveBackground });
    expect(anim.duration).toBe(19);
    expect(surface.get(60, 120)).toBe(5);
    expect(surface.get(67, 127)).toBe(5);
    expect(surface.get(68, 128)).toBe(1);
    // Écrêtage à la zone : rien en dehors, même si la forme déborde.
    expect(surface.get(49, 120)).toBe(1);
    for (let t = 1; t <= 13; t++) {
      tick(player);
      expect(surface.get(60, 120), `tick ${t}`).toBe(5);
      expect(surface.get(80, 120), `tick ${t}`).toBe(1);
    }
    tick(player); // tick 14 : image 2, le fond est restauré avant de redessiner
    expect(surface.get(60, 120)).toBe(1);
    expect(surface.get(80, 120)).toBe(5);
    expect(anim.frameIndex).toBe(2);
    tick(player, 4); // ticks 15 à 18
    expect(anim.state).toBe("running");
    tick(player); // tick 19 : END
    expect(anim.state).toBe("done");
    expect(anim.done).toBe(true);
    expect(surface.get(80, 120)).toBe(5); // sans le drapeau 32, la dernière image reste
    expect(player.running).toHaveLength(0);
  });

  it("sans le drapeau 1, l'ancienne image n'est pas effacée", () => {
    const { surface, player, archive } = setup();
    player.start(archive, 100);
    tick(player, 14);
    expect(surface.get(60, 120)).toBe(5);
    expect(surface.get(80, 120)).toBe(5);
  });

  it("restaure le fond à la fin avec le drapeau 32", () => {
    const { surface, player, archive } = setup();
    const anim = player.start(archive, 100, { flags: SCR_FLAG.restoreBackground });
    expect(surface.get(60, 120)).toBe(5);
    tick(player, 19);
    expect(anim.state).toBe("done");
    expect(surface.get(60, 120)).toBe(1);
    expect(surface.get(80, 120)).toBe(1);
  });

  it("déclenche le son à l'image où il tombe (SND_PLAY après le render, attend la fin de l'image précédente)", () => {
    const sound = new RecordingSound();
    const { player, archive } = setup({ sound });
    const anim = player.start(archive, 101, { soundChannel: "voice", ambientSounds: true });
    const at: number[] = [];
    for (let t = 1; t <= 19; t++) {
      const before = sound.played.length;
      tick(player);
      if (sound.played.length > before) at.push(t);
    }
    expect(at).toEqual([14]);
    expect(sound.played).toEqual([{ id: 900, options: { channel: "voice", ambient: true } }]);
    expect(anim.state).toBe("done");
  });

  it("le drapeau 16 attend la fin des sons avant de terminer", () => {
    const host = new TestHost();
    host.audio.unlock();
    const sound = new SoundService(host.audio);
    const { surface, archive } = setup();
    const player = new ScrPlayer({ surface, sound });
    const anim = player.start(archive, 101, { flags: SCR_FLAG.waitSounds });
    // Un tick = 17 ms. Le son (0,2 s) part au tick 14 (238 ms) et finit à 438 ms, soit au tick 26.
    let doneAt = -1;
    for (let t = 1; t <= 40 && doneAt < 0; t++) {
      host.time = t * 17;
      player.tick();
      if (anim.done) doneAt = t;
    }
    expect(doneAt).toBe(26);
    expect(host.audio.waves).toHaveLength(1);
  });

  it("préchargement de la SNDL au départ et arrêt des sons à l'interruption", () => {
    const host = new TestHost();
    host.audio.unlock();
    const sound = new SoundService(host.audio);
    const { surface, archive } = setup();
    const player = new ScrPlayer({ surface, sound });
    const anim = player.start(archive, 101, { blocking: true, flags: SCR_FLAG.interruptible });
    expect(sound.preloadedSets).toBe(1);
    for (let t = 1; t <= 14; t++) {
      host.time = t * 17;
      player.tick();
    }
    expect(host.audio.waves).toHaveLength(1);
    tick(player, 1, clickedInput());
    expect(anim.state).toBe("interrupted");
    expect(host.audio.stopped).toEqual([host.audio.waves[0]!.handle]);
  });

  it("clic ou touche interrompt une animation bloquante interruptible, pas les autres", () => {
    const flags = SCR_FLAG.interruptible;
    {
      const { player, archive } = setup();
      const anim = player.start(archive, 100, { flags, blocking: true });
      tick(player, 2);
      expect(player.blocking).toBe(true);
      tick(player, 1, clickedInput());
      expect(anim.state).toBe("interrupted");
      expect(player.blocking).toBe(false);
    }
    {
      const { player, archive } = setup();
      const anim = player.start(archive, 100, { flags, blocking: true });
      const input = new Input();
      input.keyDown({ code: "KeyA" });
      input.beginTick();
      tick(player, 1, input);
      expect(anim.state).toBe("interrupted");
    }
    {
      const { player, archive } = setup();
      const withoutFlag = player.start(archive, 100, { blocking: true });
      const notBlocking = player.start(archive, 100, { flags });
      tick(player, 1, clickedInput());
      expect(withoutFlag.state).toBe("running");
      expect(notBlocking.state).toBe("running");
    }
  });

  it("flag 4 : l'interruption avance jusqu'à l'état final ; sans lui, l'image reste là où elle est", () => {
    for (const fast of [true, false]) {
      const { surface, player, archive } = setup();
      const flags = SCR_FLAG.interruptible | SCR_FLAG.saveBackground | (fast ? SCR_FLAG.fastForwardOnInterrupt : 0);
      const anim = player.start(archive, 100, { flags, blocking: true });
      tick(player, 3);
      tick(player, 1, clickedInput());
      expect(anim.state).toBe("interrupted");
      expect(surface.get(80, 120) === 5).toBe(fast);
      expect(surface.get(60, 120) === 5).toBe(!fast);
    }
  });

  it("une interruption restaure le fond avec le drapeau 32", () => {
    const { surface, player, archive } = setup();
    const flags = SCR_FLAG.interruptible | SCR_FLAG.restoreBackground | SCR_FLAG.fastForwardOnInterrupt;
    player.start(archive, 100, { flags, blocking: true });
    tick(player, 1, clickedInput());
    expect(surface.get(60, 120)).toBe(1);
    expect(surface.get(80, 120)).toBe(1);
  });

  it("le MIDI est coupé au départ d'une lecture bloquante sauf avec le drapeau 2", () => {
    const sound = new RecordingSound();
    const { player, archive } = setup({ sound });
    player.start(archive, 100, { blocking: true });
    expect(sound.musicStops).toBe(1);
    player.start(archive, 100, { blocking: true, flags: SCR_FLAG.keepMidi });
    player.start(archive, 100);
    expect(sound.musicStops).toBe(1);
  });

  it("gèle gadgets et pointeur (blockedThisTick) tant qu'une animation bloquante tourne", () => {
    const { player, archive } = setup();
    const anim = player.playBlocking(archive, 100, {}, () => {});
    tick(player);
    expect(player.blockedThisTick).toBe(true);
    tick(player, 18);
    expect(anim.done).toBe(true);
    tick(player);
    expect(player.blockedThisTick).toBe(false);
  });

  it("playBlocking appelle la suite du tick, une seule fois, à la fin", () => {
    const { player, archive } = setup();
    const ends: string[] = [];
    player.playBlocking(archive, 100, { onEnd: () => ends.push("onEnd") }, (a) => ends.push(`then ${a.state}`));
    tick(player, 18);
    expect(ends).toEqual([]);
    tick(player);
    tick(player, 5);
    expect(ends).toEqual(["onEnd", "then done"]);
  });

  it("dessine plusieurs animations dans l'ordre z, puis celui du démarrage", () => {
    const { surface, player, archive } = setup();
    player.start(archive, 100, { z: 5 }); // index 5 en (60,120)
    player.start(archive, 102, { z: 1 }); // index 7 au même endroit
    expect(surface.get(60, 120)).toBe(5);
    surface.fill(1);
    player.redraw();
    expect(surface.get(60, 120)).toBe(5);
    const second = setup();
    second.player.start(second.archive, 100);
    second.player.start(second.archive, 102);
    expect(second.surface.get(60, 120)).toBe(7);
  });

  it("restaure les fonds en ordre inverse quand deux animations se recouvrent", () => {
    const { surface, player, archive } = setup();
    const a = player.start(archive, 100, { flags: SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground });
    const b = player.start(archive, 102, { flags: SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground });
    expect(surface.get(60, 120)).toBe(7);
    b.fastForward();
    expect(b.state).toBe("done");
    expect(surface.get(60, 120)).toBe(5);
    a.interrupt();
    expect(surface.get(60, 120)).toBe(1);
  });

  it("appelle les hooks quand ils sont atteints, sans bloquer", () => {
    const { player, archive } = setup();
    const calls: [number, number, number][] = [];
    const anim = player.start(archive, 103, { onHook: (hook, arg, a) => calls.push([hook, arg, a.time]) });
    tick(player, 12);
    // Un hook part dès qu'il est atteint : le 1er juste après la présentation de l'image 0 (tick 0), le 2e avec l'image 1 (tick 5).
    expect(calls).toEqual([
      [0, 7, 0],
      [0, 8, 5],
    ]);
    expect(anim.duration).toBe(15);
  });

  it("boucle : recommence sans trou à la fin du script", () => {
    const { surface, player, archive } = setup();
    const anim = player.start(archive, 100, { loop: true, flags: SCR_FLAG.saveBackground });
    tick(player, 19);
    expect(anim.state).toBe("running");
    expect(anim.frameIndex).toBe(1);
    expect(surface.get(60, 120)).toBe(5);
    expect(surface.get(80, 120)).toBe(1);
    tick(player, 14);
    expect(surface.get(80, 120)).toBe(5);
  });

  it("rewind repart du début, fastForward saute à l'image voulue", () => {
    const { surface, player, archive } = setup();
    const anim = player.start(archive, 104, { flags: SCR_FLAG.saveBackground });
    expect(anim.logicalIndex).toBe(2);
    anim.fastForward(5); // logicalIndex de la 3e image = 2 + 3
    expect(anim.state).toBe("running");
    expect(anim.frameIndex).toBe(3);
    expect(surface.get(50, 100)).toBe(1); // forme 3 : pixel (0,0) transparent, le fond reste
    expect(surface.get(51, 100)).toBe(9);
    tick(player, 4);
    expect(anim.state).toBe("running");
    tick(player, 1);
    expect(anim.state).toBe("done");
    anim.rewind(true);
    expect(anim.state).toBe("running");
    expect(anim.frameIndex).toBe(1);
    expect(surface.get(50, 100)).toBe(5); // forme 1 (8×8, index 5) ; le fond a été rétabli avant
    expect(surface.get(51, 100)).toBe(5);
    tick(player, 8);
    expect(anim.state).toBe("running");
    tick(player, 1);
    expect(anim.state).toBe("done");
  });

  it("fastForward() sans argument termine l'animation sur la dernière image", () => {
    const { surface, player, archive } = setup();
    const anim = player.start(archive, 100);
    anim.fastForward();
    expect(anim.state).toBe("done");
    expect(surface.get(80, 120)).toBe(5);
  });

  it("applique décalages et zone de remplacement", () => {
    const shifted = setup();
    shifted.player.start(shifted.archive, 100, { offsetX: 3, offsetY: 40 });
    expect(shifted.surface.get(63, 160)).toBe(5);
    expect(shifted.surface.get(60, 120)).toBe(1);
    const replaced = setup();
    replaced.player.start(replaced.archive, 100, { clipOverride: { top: 0, left: 0, bottom: 50, right: 50 } });
    expect(replaced.surface.get(10, 20)).toBe(5);
    expect(replaced.surface.get(60, 120)).toBe(1);
  });

  it("stopAll arrête sans rappel et peut restaurer le fond", () => {
    const { surface, player, archive } = setup();
    let ended = false;
    const anim = player.start(archive, 100, { flags: SCR_FLAG.saveBackground, onEnd: () => (ended = true) });
    player.stopAll(true);
    expect(anim.state).toBe("interrupted");
    expect(ended).toBe(false);
    expect(surface.get(60, 120)).toBe(1);
  });

  it("shplOverride choisit la SHPL des formes (descripteur { id SHPL, décalage })", () => {
    const { surface, player, archive } = setup();
    player.start(archive, 100, { shplOverride: 200 }); // forme 1 = SHAP 501 (4×4, index 7)
    expect(surface.get(60, 120)).toBe(7);
    expect(surface.get(64, 120)).toBe(1);
  });
});

describe("ScrPlayer (données du jeu)", () => {
  it.skipIf(!hasOriginalFiles)("MAINSCRN 1000 : 13 images, terminée au tick 98, dessin dans la zone", () => {
    const archive = new Archive("MAINSCRN.DAT", MohawkArchive.parse(readOriginal("MAINSCRN.DAT")));
    const surface = new Surface();
    surface.fill(2);
    const player = new ScrPlayer({ surface });
    const script = archive.scr(1000);
    expect(script.frames).toHaveLength(13);
    expect(script.duration).toBe(98);
    const anim = player.start(archive, 1000, { flags: SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.restoreBackground });
    let changed = 0;
    for (let t = 1; t < 98; t++) {
      tick(player);
      expect(anim.state, `tick ${t}`).toBe("running");
      changed = surface.pixels.some((v) => v !== 2) ? changed + 1 : changed;
    }
    expect(changed).toBeGreaterThan(50);
    expect(anim.frameIndex).toBe(13);
    // Écrêtage : tout pixel modifié est dans la zone (287,244)-(387,331).
    tick(player);
    expect(anim.state).toBe("done");
    expect(surface.pixels.every((v) => v === 2)).toBe(true); // drapeau 32 : fond rétabli
  });

  it.skipIf(!hasOriginalFiles)("BOWLING 1200 : le son 14300 part au tick 14 par le vrai service sonore", () => {
    const archive = new Archive("BOWLING.DAT", MohawkArchive.parse(readOriginal("BOWLING.DAT")));
    const host = new TestHost();
    host.audio.unlock();
    const sound = new SoundService(host.audio);
    const surface = new Surface();
    const player = new ScrPlayer({ surface, sound });
    const anim = player.start(archive, 1200);
    let startedAt = -1;
    for (let t = 1; t <= archive.scr(1200).duration + 1; t++) {
      host.time = t * 17;
      player.tick();
      if (startedAt < 0 && host.audio.waves.length > 0) startedAt = t;
    }
    expect(startedAt).toBe(14);
    expect(host.audio.waves).toHaveLength(1);
    expect(host.audio.waves[0]!.sound.samples.length).toBe(archive.wave(14300).samples.length);
    expect(anim.done).toBe(true);
  });

  it.skipIf(!hasOriginalFiles)("BOWLING 1203 : SNDL de la dizaine (1200) préchargée", () => {
    const archive = new Archive("BOWLING.DAT", MohawkArchive.parse(readOriginal("BOWLING.DAT")));
    const host = new TestHost();
    const sound = new SoundService(host.audio);
    const player = new ScrPlayer({ surface: new Surface(), sound });
    player.start(archive, 1203);
    expect(sound.preloadedSets).toBe(1);
  });
});

// --- Service sonore -----------------------------------------------------------------------------------------------------------

describe("SoundService", () => {
  function sounds(options?: ConstructorParameters<typeof SoundService>[1]) {
    const host = new TestHost();
    host.audio.unlock();
    return { host, sound: new SoundService(host.audio, options), archive: syntheticArchive() };
  }

  /** Archive avec un MIDI minimal (une note de 100 ms) en `\0SND` 950. */
  function midiArchive(): Archive {
    const bytes = (...values: number[]): number[] => values;
    const header = bytes(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0);
    const events = bytes(0, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0);
    const track = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, events.length, ...events];
    const body = [0x4d, 0x49, 0x44, 0x49, ...header, ...track]; // « MIDI » + SMF
    const size = body.length;
    const data = [0x4d, 0x48, 0x57, 0x4b, (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...body];
    return new Archive("MIDI.DAT", MohawkArchive.parse(buildMohawk([{ tag: "\0SND", id: 950, data }])));
  }

  it("restartMusic rejoue la musique demandée avant que le synthétiseur soit prêt, une seule fois, avec la même poignée", () => {
    const { host, sound } = sounds();
    const archive = midiArchive();
    const handle = sound.playMusic(archive, 950, { loop: true })!;
    host.audio.midi.messages.length = 0;
    sound.restartMusic();
    sound.tick();
    expect(host.audio.midi.messages.length).toBeGreaterThan(0);
    expect(sound.musicPlaying).toBe(true);
    expect(sound.isPlaying(handle)).toBe(true);
  });

  it("restartMusic ne fait rien après stopMusic, releaseAll ou la fin de la musique", () => {
    const { host, sound } = sounds();
    const archive = midiArchive();
    sound.playMusic(archive, 950, { loop: true });
    sound.stopMusic();
    host.audio.midi.messages.length = 0;
    sound.restartMusic();
    sound.tick();
    expect(host.audio.midi.messages).toHaveLength(0);
    sound.playMusic(archive, 950);
    sound.releaseAll();
    host.audio.midi.messages.length = 0;
    sound.restartMusic();
    sound.tick();
    expect(host.audio.midi.messages).toHaveLength(0);
    expect(sound.musicPlaying).toBe(false);
  });

  it("joue un WAVE avec handle, isPlaying suit la durée, stop coupe", () => {
    const { host, sound, archive } = sounds();
    const handle = sound.playWave(archive, 900)!;
    expect(sound.isPlaying(handle)).toBe(true);
    host.time = 100;
    expect(sound.isPlaying(handle)).toBe(true);
    host.time = 250;
    expect(sound.isPlaying(handle)).toBe(false);
    const again = sound.playWave(archive, 900)!;
    sound.stop(again);
    expect(host.audio.stopped).toContain(again.wave);
    expect(sound.isPlaying(again)).toBe(false);
  });

  it("canal voix : la nouvelle voix remplace la précédente, les effets se superposent", () => {
    const { host, sound, archive } = sounds();
    const first = sound.playWave(archive, 900, { channel: "voice" })!;
    expect(sound.voicePlaying).toBe(true);
    const effect = sound.playWave(archive, 900)!;
    const second = sound.playWave(archive, 900, { channel: "voice" })!;
    expect(host.audio.stopped).toEqual([first.wave]);
    expect(first.stopped).toBe(true);
    expect(sound.isPlaying(effect)).toBe(true);
    expect(sound.isPlaying(second)).toBe(true);
    sound.stopVoice();
    expect(sound.voicePlaying).toBe(false);
    expect(sound.isPlaying(effect)).toBe(true);
    sound.stopAll();
    expect(sound.isPlaying(effect)).toBe(false);
  });

  it("sons d'ambiance : ignorés quand « Ambient Sounds » est coupé, coupés par stopAmbient", () => {
    let ambient = true;
    const { host, sound, archive } = sounds({ ambientEnabled: () => ambient });
    const on = sound.playWave(archive, 900, { ambient: true })!;
    expect(on).not.toBeNull();
    const plain = sound.playWave(archive, 900)!;
    ambient = false;
    expect(sound.playWave(archive, 900, { ambient: true })).toBeNull();
    expect(sound.playSound(archive, 900, { ambient: true })).toBeNull();
    expect(host.audio.waves).toHaveLength(2);
    sound.stopAmbient();
    expect(sound.isPlaying(on)).toBe(false);
    expect(sound.isPlaying(plain)).toBe(true);
  });

  it("précharge et libère par liste", () => {
    const { sound, archive } = sounds();
    const set = sound.preload(archive, [900, 12345]);
    expect(set.ids).toEqual([900]);
    expect(sound.preloadedSets).toBe(1);
    set.release();
    expect(sound.preloadedSets).toBe(0);
    sound.preload(archive, [900]);
    sound.releaseAll();
    expect(sound.preloadedSets).toBe(0);
  });

  it.skipIf(!hasOriginalFiles)("musique MIDI : lecture bouclée, remplacement, arrêt, ambiance", () => {
    let ambient = true;
    const host = new TestHost();
    host.audio.unlock();
    const sound = new SoundService(host.audio, { ambientEnabled: () => ambient });
    const system = new Archive("MILKYWAY.DAT", MohawkArchive.parse(readOriginal("MILKYWAY.DAT")));
    sound.loadMidiMap(new Archive("MIDIMAP.DAT", MohawkArchive.parse(readOriginal("MIDIMAP.DAT"))));
    const music = sound.playSound(system, 65000, { loop: true, ambient: true })!;
    expect(music.kind).toBe("midi");
    expect(sound.musicPlaying).toBe(true);
    host.time = 500;
    sound.tick();
    expect(host.audio.midi.messages.length).toBeGreaterThan(64); // initialisation MIDIMAP puis les notes
    const resets = host.audio.midi.resets;
    const next = sound.playMusic(system, 65001, { loop: true })!;
    expect(music.stopped).toBe(true);
    expect(sound.musicPlaying).toBe(true);
    sound.stopMusic();
    expect(sound.musicPlaying).toBe(false);
    expect(host.audio.midi.resets).toBeGreaterThan(resets);
    expect(next.stopped).toBe(true);
    ambient = false;
    expect(sound.playMusic(system, 65000, { ambient: true })).toBeNull();
  });
});

// --- Gadgets -------------------------------------------------------------------------------------------------------------------

describe("HotspotTable", () => {
  // Table de survol du hub `DS:1050` (screens/common.md §2.4.4).
  const hub = HotspotTable.fromEdges([
    [73, 245, 131, 321],
    [56, 321, 149, 398],
    [160, 345, 195, 379],
    [194, 345, 229, 379],
    [229, 345, 264, 379],
    [94, 0, 488, 25],
    [106, 25, 475, 50],
    [129, 50, 452, 75],
    [174, 75, 404, 96],
    [78, 62, 141, 187],
    [233, 111, 369, 204],
    [371, 80, 490, 192],
    [156, 214, 235, 293],
    [270, 209, 406, 341],
    [459, 225, 560, 383],
  ]);

  it("renvoie l'indice 1-based de la première zone touchée, 0 sinon, bords [gauche, droite[", () => {
    expect(hub.length).toBe(15);
    expect(hub.hit(100, 300)).toBe(1);
    expect(hub.hit(100, 330)).toBe(2);
    expect(hub.hit(73, 245)).toBe(1);
    expect(hub.hit(131, 300)).toBe(0);
    expect(hub.hit(200, 10)).toBe(6);
    expect(hub.hit(200, 30)).toBe(7);
    expect(hub.hit(300, 250)).toBe(14);
    expect(hub.hit(1, 1)).toBe(0);
    expect(hub.rect(1)).toEqual({ x: 73, y: 245, w: 58, h: 76 });
    expect(() => hub.rect(16)).toThrow(RangeError);
  });

  it("curseur d'aide : « ? » à partir de la zone 3 seulement", () => {
    expect(helpCursorAt(hub, 100, 300)).toBe("arrow");
    expect(helpCursorAt(hub, 170, 360)).toBe("help");
    expect(helpCursorAt(hub, 300, 250)).toBe("help");
    expect(helpCursorAt(hub, 2, 2)).toBe("arrow");
  });

  it("rectFromEdges et rectContains", () => {
    const r = rectFromEdges(10, 20, 30, 50);
    expect(r).toEqual({ x: 10, y: 20, w: 20, h: 30 });
    expect(rectContains(r, 29, 49)).toBe(true);
    expect(rectContains(r, 30, 49)).toBe(false);
  });
});

function shapeOf(w: number, h: number, v: number): Shape {
  return { width: w, height: h, pitch: w, flags: 2, bitsPerPixel: 8, pixels: new Uint8Array(w * h).fill(v), consumed: 0, declaredEnd: 0 };
}

describe("GadgetManager", () => {
  const A: GadgetSpec = { rect: { x: 10, y: 10, w: 20, h: 10 } };
  const B: GadgetSpec = { rect: { x: 40, y: 10, w: 20, h: 10 } };
  const C: GadgetSpec = { rect: { x: 70, y: 10, w: 20, h: 10 }, disabled: true };

  function build(specs: GadgetSpec[] = [A, B, C], extra: Partial<Parameters<GadgetManager["addGroup"]>[0]> = {}) {
    const manager = new GadgetManager();
    const calls: { index: number; source: string; button?: string }[] = [];
    const group = manager.addGroup({
      records: specs,
      onActivate: (index, _record, activation) => calls.push({ index, source: activation.source, button: activation.button }),
      ...extra,
    });
    return { manager, group, calls };
  }

  it("survol, appui et relâchement sur le même bouton déclenchent le rappel avec l'indice 1..n", () => {
    const { manager, group, calls } = build();
    manager.updatePointer(15, 12);
    expect(manager.hovered).toBe(group.record(1));
    expect(manager.visualOf(group.record(1))).toBe("hover");
    expect(manager.handleButton(press(15, 12))).toBe(true);
    expect(manager.visualOf(group.record(1))).toBe("pressed");
    expect(calls).toEqual([]);
    expect(manager.handleButton(release(15, 12))).toBe(true);
    expect(calls).toEqual([{ index: 1, source: "pointer", button: "left" }]);
    manager.updatePointer(45, 12);
    manager.handleButton(press(45, 12, "right"));
    manager.handleButton(release(45, 12, "right"));
    manager.handleButton(press(45, 12, "middle"));
    manager.handleButton(release(45, 12, "middle"));
    expect(calls.map((c) => `${c.index}${c.button}`)).toEqual(["1left", "2right", "2middle"]);
  });

  it("un relâchement ailleurs, sur un autre bouton ou avec un autre bouton de souris n'active rien", () => {
    const { manager, calls } = build();
    manager.updatePointer(15, 12);
    manager.handleButton(press(15, 12));
    manager.updatePointer(100, 100);
    expect(manager.handleButton(release(100, 100))).toBe(true);
    manager.handleButton(press(15, 12));
    expect(manager.handleButton(release(45, 12))).toBe(true); // relâché sur B
    manager.handleButton(press(15, 12));
    expect(manager.handleButton(release(15, 12, "right"))).toBe(false); // autre bouton : ignoré
    expect(calls).toEqual([]);
    expect(manager.pressed).not.toBeNull();
  });

  it("un appui dans le vide n'est pas pris ; un clic plus court qu'un tick est traité dans l'ordre", () => {
    const { manager, calls } = build();
    expect(manager.handleButton(press(300, 300))).toBe(false);
    for (const event of [press(15, 12), release(15, 12), press(45, 12), release(45, 12)]) manager.handleButton(event);
    expect(calls.map((c) => c.index)).toEqual([1, 2]);
  });

  it("ordre de test : le premier touché gagne ; masqué, désactivé et groupe inactif sont transparents", () => {
    const manager = new GadgetManager();
    const calls: string[] = [];
    const decor = manager.addGroup({
      id: "decor",
      records: [{ rect: { x: 0, y: 0, w: 100, h: 100 } }, { rect: { x: 0, y: 0, w: 576, h: 432 }, disabled: true }],
      onActivate: (i) => calls.push(`decor${i}`),
    });
    const top = manager.addGroup({ id: "top", records: [{ rect: { x: 0, y: 0, w: 200, h: 200 } }], onActivate: (i) => calls.push(`top${i}`) });
    expect(manager.hitRecord(50, 50)).toBe(decor.record(1));
    expect(manager.hitRecord(150, 150)).toBe(top.record(1)); // le plein écran désactivé ne bloque pas
    decor.record(1).hidden = true;
    expect(manager.hitRecord(50, 50)).toBe(top.record(1));
    top.active = false;
    expect(manager.hitRecord(50, 50)).toBeNull();
    decor.record(2).disabled = false;
    expect(manager.hitRecord(50, 50)).toBe(decor.record(2));
    manager.handleButton(press(50, 50));
    manager.handleButton(release(50, 50));
    expect(calls).toEqual(["decor2"]);
  });

  it("test au pixel facultatif après le rectangle", () => {
    const { manager, group } = build([{ rect: { x: 0, y: 0, w: 10, h: 10 }, hit: (x) => x < 5 }]);
    expect(manager.hitRecord(2, 2)).toBe(group.record(1));
    expect(manager.hitRecord(7, 2)).toBeNull();
  });

  it("son d'appui à l'appui (fixe ou tiré)", () => {
    const played: number[] = [];
    const manager = new GadgetManager({ playSound: (id) => played.push(id) });
    let n = 0;
    manager.addGroup({
      records: [
        { rect: { x: 0, y: 0, w: 10, h: 10 }, pressSound: 3057 },
        { rect: { x: 20, y: 0, w: 10, h: 10 }, pressSound: () => (n++ % 2 === 0 ? 3012 : 3013) },
        { rect: { x: 40, y: 0, w: 10, h: 10 } },
      ],
    });
    manager.handleButton(press(5, 5));
    manager.handleButton(release(5, 5));
    manager.handleButton(press(25, 5));
    manager.handleButton(release(25, 5));
    manager.handleButton(press(25, 5));
    manager.handleButton(press(45, 5));
    expect(played).toEqual([3057, 3012, 3013]);
  });

  it("activateOn press déclenche à l'appui ; toggle et exclusive gèrent la sélection", () => {
    const pressMode = build([A], { activateOn: "press" });
    pressMode.manager.handleButton(press(15, 12));
    expect(pressMode.calls).toHaveLength(1);

    const toggle = build([{ ...A, toggle: true }]);
    toggle.manager.handleButton(press(15, 12));
    toggle.manager.handleButton(release(15, 12));
    expect(toggle.group.record(1).selected).toBe(true);
    toggle.manager.handleButton(press(15, 12));
    toggle.manager.handleButton(release(15, 12));
    expect(toggle.group.record(1).selected).toBe(false);

    const radio = build([A, B], { exclusive: true });
    for (const x of [15, 45, 15]) {
      radio.manager.handleButton(press(x, 12));
      radio.manager.handleButton(release(x, 12));
    }
    expect(radio.group.records.map((r) => r.selected)).toEqual([true, false]);
  });

  it("clavier : Tab / Maj+Tab parcourent les boutons actifs, Entrée active le survol ou le focus", () => {
    const { manager, group, calls } = build();
    expect(manager.handleKey(key("Tab"))).toBe(true);
    expect(manager.focused).toBe(group.record(1));
    expect(manager.visualOf(group.record(1))).toBe("hover");
    manager.handleKey(key("Tab"));
    expect(manager.focused).toBe(group.record(2));
    manager.handleKey(key("Tab")); // C est désactivé : retour au premier
    expect(manager.focused).toBe(group.record(1));
    manager.handleKey(key("Tab", { shift: true }));
    expect(manager.focused).toBe(group.record(2));
    manager.handleKey(key("Tab", { shift: true }));
    manager.handleKey(key("Tab", { shift: true }));
    expect(manager.focused).toBe(group.record(2));

    expect(manager.handleKey(key("Enter"))).toBe(true);
    expect(calls).toEqual([{ index: 2, source: "keyboard", button: undefined }]);
    expect(manager.visualOf(group.record(2))).toBe("pressed");
    for (let i = 0; i < KEYBOARD_FLASH_TICKS; i++) manager.tick();
    expect(manager.visualOf(group.record(2))).toBe("hover");

    manager.updatePointer(15, 12); // le survol passe avant le focus
    manager.handleKey(key("Enter"));
    expect(calls.map((c) => c.index)).toEqual([2, 1]);
  });

  it("clavier : sans bouton actif, Tab et Entrée ne sont pas consommées ; Ctrl+Tab non plus", () => {
    const empty = new GadgetManager();
    expect(empty.handleKey(key("Tab"))).toBe(false);
    expect(empty.handleKey(key("Enter"))).toBe(false);
    const { manager } = build();
    expect(manager.handleKey(key("Tab", { ctrl: true }))).toBe(false);
    expect(manager.handleKey(key("Enter"))).toBe(false); // ni survol ni focus
    expect(manager.handleKey(key("KeyA"))).toBe(false);
  });

  it("limite de 10 groupes", () => {
    const manager = new GadgetManager();
    for (let i = 0; i < 10; i++) manager.addGroup({ records: [] });
    expect(() => manager.addGroup({ records: [] })).toThrow(/too many graphic button groups/);
  });

  it("états visuels : désactivé > pressé > sélectionné > survol > clignotement, avec repli des formes", () => {
    const { manager, group } = build([{ ...A, shapes: { hover: 1, pressed: 2 } }, { ...B, shapes: { normal: 7, selected: 8 } }, C]);
    const [a, b] = [group.record(1), group.record(2)];
    expect(manager.visualOf(a)).toBe("normal");
    manager.updatePointer(15, 12);
    expect(manager.visualOf(a)).toBe("hover");
    manager.handleButton(press(15, 12));
    expect(manager.visualOf(a)).toBe("pressed");
    manager.updatePointer(100, 100); // sorti : plus enfoncé visuellement
    expect(manager.visualOf(a)).toBe("normal");
    manager.handleButton(release(100, 100));
    expect(manager.shapeIdFor(a, "pressed")).toBe(2);
    expect(manager.shapeIdFor(a, "selected")).toBe(2); // selected → pressed
    expect(manager.shapeIdFor(a, "disabled")).toBeUndefined();
    expect(manager.shapeIdFor(b, "hover")).toBe(7); // hover → normal
    expect(manager.shapeIdFor(b, "pressed")).toBe(8); // pressed → selected
    b.selected = true;
    expect(manager.visualOf(b)).toBe("selected");
    b.disabled = true;
    expect(manager.visualOf(b)).toBe("disabled");
    b.hidden = true;
    expect(manager.visualOf(b)).toBe("hidden");
    const blink = build([{ ...A, blinkPeriod: 10 }]);
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      blink.manager.tick();
      seen.push(blink.manager.visualOf(blink.group.record(1)));
    }
    expect(seen.slice(0, 9).every((v) => v === "normal")).toBe(true);
    expect(seen.slice(9, 19).every((v) => v === "hover")).toBe(true);
    expect(seen.slice(19, 29).every((v) => v === "normal")).toBe(true);
  });

  it("dessin : pose la forme de l'état et restaure le fond quand l'état change", () => {
    const shapes = new Map([
      [1, shapeOf(6, 6, 4)],
      [2, shapeOf(8, 8, 6)],
    ]);
    const manager = new GadgetManager({ shape: (id) => shapes.get(id) });
    const group = manager.addGroup({ records: [{ rect: { x: 20, y: 20, w: 8, h: 8 }, shapes: { hover: 1, pressed: 2 } }] });
    const surface = new Surface();
    surface.fill(3);
    manager.captureBackground(surface);
    expect(manager.draw(surface)).toBe(false); // normal, rien à poser, rien n'a changé
    expect(surface.get(20, 20)).toBe(3);
    manager.updatePointer(22, 22);
    expect(manager.draw(surface)).toBe(true);
    expect(surface.get(20, 20)).toBe(4);
    expect(surface.get(26, 26)).toBe(3); // forme 6×6
    expect(manager.draw(surface)).toBe(false);
    manager.handleButton(press(22, 22));
    expect(manager.draw(surface)).toBe(true);
    expect(surface.get(27, 27)).toBe(6);
    manager.handleButton(release(22, 22));
    manager.updatePointer(200, 200);
    expect(manager.draw(surface)).toBe(true);
    expect(surface.get(20, 20)).toBe(3);
    expect(surface.get(27, 27)).toBe(3);
    group.record(1).hidden = true;
    expect(manager.draw(surface)).toBe(true);
    manager.invalidate();
    expect(manager.draw(surface)).toBe(true);
  });

  it("clear et removeGroup oublient survol, appui et focus", () => {
    const { manager, group } = build();
    manager.updatePointer(15, 12);
    manager.handleButton(press(15, 12));
    manager.handleKey(key("Tab"));
    manager.removeGroup(group);
    expect(manager.hovered).toBeNull();
    expect(manager.pressed).toBeNull();
    expect(manager.focused).toBeNull();
    expect(manager.hitRecord(15, 12)).toBeNull();
  });
});

// --- Pointeur ------------------------------------------------------------------------------------------------------------------

class FakePointerInput {
  mouseX = 0;
  mouseY = 0;
  readonly down = new Set<MouseButton>();
  isButtonDown(button: MouseButton): boolean {
    return this.down.has(button);
  }
  move(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
  }
}

describe("PointerService", () => {
  const piece = { x: 50, y: 50, w: 20, h: 20 };
  const piece2: PickResult<string> = { item: "p", x: 50, y: 50, width: 20, height: 20 };

  function pointer(mode: PointerMode) {
    const log: string[] = [];
    const cursors: string[] = [];
    const p = new PointerService<string>({ mode: () => mode, setCursor: (c) => cursors.push(c) });
    p.source = { pick: (x, y) => (rectContains(piece, x, y) ? piece2 : null) };
    p.listener = {
      onPick: (c) => log.push(`pick ${c.x},${c.y}`),
      onMove: (c) => log.push(`move ${c.x},${c.y}`),
      onDrop: (c, e) => log.push(`drop ${c.x},${c.y} ${e ? e.button + (e.down ? "↓" : "↑") : "-"}`),
    };
    return { p, log, cursors, input: new FakePointerInput() };
  }

  it("cliquer-poser : le clic prend, la pièce suit sans bouton tenu, le clic suivant n'importe où dépose (n'importe quel bouton)", () => {
    const { p, log, input } = pointer("clickAndStick");
    expect(p.handleButton(press(100, 100))).toBe(false); // à côté : rien à prendre
    expect(p.handleButton(press(55, 55))).toBe(true);
    expect(p.carried?.item).toBe("p");
    expect(p.capturesClicks).toBe(true);
    expect(p.handleButton(release(55, 55))).toBe(true); // le relâchement du clic de prise est ignoré
    expect(p.carried).not.toBeNull();
    input.move(200, 120);
    p.tick(input);
    expect(log).toEqual(["pick 50,50", "move 195,115"]); // décalage de prise (5,5) conservé
    input.move(210, 130);
    p.tick(input);
    expect(p.handleButton(press(300, 300, "right"))).toBe(true);
    expect(p.carried).toBeNull();
    expect(log.at(-1)).toBe("drop 295,295 right↓");
    // Plus rien n'est capté ensuite.
    expect(p.handleButton(release(300, 300, "right"))).toBe(false);
    expect(p.capturesClicks).toBe(false);
  });

  it("cliquer-poser : un clic qui prend ne dépose pas dans le même événement, les trois boutons prennent", () => {
    for (const button of ["left", "right", "middle"] as const) {
      const { p } = pointer("clickAndStick");
      p.handleButton(press(55, 55, button));
      expect(p.carried?.button).toBe(button);
    }
  });

  it("glisser : le bouton qui a pris doit rester enfoncé, le relâchement dépose, les autres boutons sont sans effet", () => {
    const { p, log, input } = pointer("drag");
    input.down.add("right");
    expect(p.handleButton(press(55, 55, "right"))).toBe(true);
    input.move(120, 90);
    p.tick(input);
    expect(p.handleButton(press(120, 90, "left"))).toBe(true); // capté, sans dépose
    expect(p.handleButton(release(120, 90, "left"))).toBe(true);
    expect(p.carried).not.toBeNull();
    input.move(130, 95);
    p.tick(input);
    input.down.delete("right");
    expect(p.handleButton(release(130, 95, "right"))).toBe(true);
    expect(p.carried).toBeNull();
    expect(log).toEqual(["pick 50,50", "move 115,85", "move 125,90", "drop 125,90 right↑"]);
  });

  it("glisser : un bouton perdu sans événement (perte du focus) dépose sur place au tick suivant", () => {
    const { p, log, input } = pointer("drag");
    input.down.add("left");
    p.handleButton(press(55, 55));
    input.move(80, 80);
    p.tick(input);
    input.down.delete("left");
    input.move(90, 90);
    p.tick(input);
    expect(p.carried).toBeNull();
    expect(log.at(-1)).toBe("drop 85,85 -");
  });

  it("glisser : appui et relâchement dans le même tick = prise puis dépose sur place", () => {
    const { p, log, input } = pointer("drag");
    input.down.add("left");
    p.handleButton(press(55, 55));
    p.handleButton(release(55, 55));
    expect(log).toEqual(["pick 50,50", "drop 50,50 left↑"]);
    expect(p.carried).toBeNull();
  });

  it("le mode est celui de la prise ; changer la préférence en cours de port n'affecte pas la pièce portée", () => {
    let mode: PointerMode = "clickAndStick";
    const p = new PointerService<string>({ mode: () => mode });
    p.source = { pick: () => piece2 };
    p.handleButton(press(55, 55));
    mode = "drag";
    expect(p.carried?.mode).toBe("clickAndStick");
    p.handleButton(release(55, 55));
    expect(p.carried).not.toBeNull();
  });

  it("garde la pièce dans la zone, ou au centre sur le curseur", () => {
    expect(clampToBounds(-30, 1000, 20, 20, PLAY_AREA)).toEqual({ x: 0, y: 412 });
    expect(clampToBounds(600, -5, 20, 20, PLAY_AREA)).toEqual({ x: 556, y: 0 });
    expect(clampToBounds(10, 10, 700, 20, PLAY_AREA).x).toBe(0);
    const { p, input } = pointer("clickAndStick");
    p.source = { pick: () => ({ ...piece2, grab: "center" }) };
    p.handleButton(press(55, 55));
    expect(p.carried).toMatchObject({ x: 45, y: 45 });
    input.move(-100, 1000);
    p.tick(input);
    expect(p.carried).toMatchObject({ x: 0, y: 412 });
    p.bounds = { x: 100, y: 100, w: 100, h: 100 };
    input.move(150, 150);
    p.tick(input);
    expect(p.carried).toMatchObject({ x: 140, y: 140 });
    input.move(0, 0);
    p.tick(input);
    expect(p.carried).toMatchObject({ x: 100, y: 100 });
  });

  it("carry programmatique, drop, cancel et reset", () => {
    const { p, log, input } = pointer("drag");
    const carried = p.carry({ item: "q", x: 10, y: 10, width: 10, height: 10, grab: { x: 2, y: 3 } }, "left", 12, 13);
    expect(carried).toMatchObject({ x: 10, y: 10, tracksButton: false });
    input.move(60, 60);
    p.tick(input); // pas de bouton tenu mais la prise n'est pas liée à un événement : pas de dépose
    expect(p.carried).toMatchObject({ x: 58, y: 57 });
    p.drop();
    expect(log.at(-1)).toBe("drop 58,57 -");
    p.carry({ item: "r", x: 0, y: 0, width: 5, height: 5 }, "left", 0, 0);
    p.cancel();
    expect(p.carried).toBeNull();
    expect(log.filter((l) => l.startsWith("drop"))).toHaveLength(1);
    p.carry({ item: "s", x: 0, y: 0, width: 5, height: 5 }, "left", 0, 0);
    p.reset();
    expect(p.carried).toBeNull();
    expect(p.source).toBeNull();
  });

  it("curseur caché pendant le port, « ? » au survol d'aide, flèche sinon", () => {
    const { p, cursors } = pointer("clickAndStick");
    p.cursor.setHelpHover(true);
    p.cursor.setHelpHover(true);
    p.cursor.setHelpHover(false);
    p.cursor.hideWhileCarrying = true;
    p.handleButton(press(55, 55));
    p.handleButton(press(10, 10));
    p.cursor.setBase("hidden");
    expect(cursors).toEqual(["help", "arrow", "hidden", "arrow", "hidden"]);
    const controller = new CursorController(() => {});
    controller.setCarrying(true);
    expect(controller.current).toBe("arrow");
  });

  it("aides de test de prise : rectangle, pixel, dessus d'abord", () => {
    const mask = shapeOf(4, 4, 0);
    mask.pixels[1 * 4 + 2] = 1;
    expect(hitShapeAt(mask, 100, 200, 102, 201)).toBe(true);
    expect(hitShapeAt(mask, 100, 200, 101, 201)).toBe(false);
    expect(hitShapeAt(mask, 100, 200, 99, 201)).toBe(false);
    const items = [{ id: "dessus", r: { x: 0, y: 0, w: 10, h: 10 } }, { id: "dessous", r: { x: 0, y: 0, w: 20, h: 20 } }];
    expect(pickTopmost(items, (i) => rectContains(i.r, 5, 5))?.id).toBe("dessus");
    expect(pickTopmost(items, (i) => rectContains(i.r, 15, 15))?.id).toBe("dessous");
    expect(pickTopmost(items, (i) => rectContains(i.r, 50, 50))).toBeUndefined();
  });
});

// --- Curseurs CURS ------------------------------------------------------------------------------------------------------------

describe("CURS", () => {
  /** Curseur synthétique : pixel (0,0) noir opaque, (1,0) blanc opaque, (2,0) transparent, point chaud (3, 4). */
  function synthetic(): Uint8Array {
    const bytes = new Uint8Array(CURS_BYTES);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0b1000_0000_0000_0000);
    view.setUint16(32, 0b1100_0000_0000_0000);
    view.setUint16(64, 3);
    view.setUint16(66, 4);
    return bytes;
  }

  it("décode image (1 = noir), masque (1 = opaque) et point chaud", () => {
    const c = decodeCursor(synthetic());
    expect([c.width, c.height, c.hotspotX, c.hotspotY]).toEqual([16, 16, 3, 4]);
    expect([...c.rgba.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...c.rgba.subarray(4, 8)]).toEqual([255, 255, 255, 255]);
    expect([...c.rgba.subarray(8, 12)]).toEqual([0, 0, 0, 0]);
    expect(() => decodeCursor(new Uint8Array(10))).toThrow(/CURS/);
  });

  it("PNG valide : signature, IHDR, IDAT décompressable vers les lignes filtrées", () => {
    const c = decodeCursor(synthetic());
    const png = encodePng(c.width, c.height, c.rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
    expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([16, 16, 8, 6]);
    const idatLength = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe("IDAT");
    const raw = inflateSync(Buffer.from(png.subarray(41, 41 + idatLength)));
    expect(raw.length).toBe(16 * (1 + 64));
    expect(raw[0]).toBe(0); // filtre « aucun »
    expect([...raw.subarray(1, 5)]).toEqual([0, 0, 0, 255]);
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
  });

  it("PNG plus grand que 65535 octets : plusieurs blocs stockés", () => {
    const w = 200;
    const h = 100;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 7) & 0xff);
    const png = encodePng(w, h, rgba);
    const view = new DataView(png.buffer, png.byteOffset);
    const idatLength = view.getUint32(33);
    const raw = inflateSync(Buffer.from(png.subarray(41, 41 + idatLength)));
    expect(raw.length).toBe(h * (1 + w * 4));
    expect([...raw.subarray(1, 9)]).toEqual([...rgba.subarray(0, 8)]);
  });

  it.skipIf(!hasOriginalFiles)("CURS 1 (montre) et 2 (point d'interrogation) de MILKYWAY.DAT", () => {
    const archive = new Archive("MILKYWAY.DAT", MohawkArchive.parse(readOriginal("MILKYWAY.DAT")));
    const busy = decodeCursor(archive.raw("CURS", 1));
    const help = decodeCursor(archive.raw("CURS", 2));
    expect([busy.hotspotX, busy.hotspotY]).toEqual([8, 6]);
    expect([help.hotspotX, help.hotspotY]).toEqual([5, 6]);
    const opaque = (c: typeof busy) => c.rgba.filter((_, i) => i % 4 === 3 && c.rgba[i] === 255).length;
    expect(opaque(busy)).toBeGreaterThan(80);
    expect(opaque(help)).toBeGreaterThan(40);
    const images = loadCursorImages(archive);
    expect(images.busy.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(cssCursor(images.help, "help")).toMatch(/^url\("data:image\/png;base64,.+"\) 5 6, help$/);
  });
});

// --- Intégration moteur --------------------------------------------------------------------------------------------------------

describe("installServices (moteur complet)", () => {
  class ProbeScene implements Scene {
    readonly log: string[] = [];
    constructor(
      private readonly services: () => MathServices,
      private readonly archive: Archive,
      private readonly onEnter: (scene: ProbeScene, services: MathServices) => void,
    ) {}
    enter(): void {
      const services = this.services();
      services.useArchive(this.archive);
      this.onEnter(this, services);
    }
    leave(): void {
      this.services().endScene();
      this.log.push("leave");
    }
    tick(_ctx: SceneContext): void {}
  }

  async function boot(onEnter: (scene: ProbeScene, services: MathServices) => void) {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 1 });
    const services = installServices(engine);
    const archive = syntheticArchive();
    const scene = new ProbeScene(() => services, archive, onEnter);
    engine.register(SceneId.hub, () => scene);
    engine.start(SceneId.hub);
    await runFor(engine, host, 100);
    return { host, engine, services, scene, archive };
  }

  it("fournit les services, présente la surface avec la palette, et l'animation SCR arrive à l'écran", async () => {
    const { host, engine, services } = await boot((_scene, s) => {
      s.graphics.screen.fill(1);
      s.scr.start(syntheticArchive(), 100);
    });
    expect(engine.services.get(GRAPHICS)).toBe(services.graphics);
    const last = host.frames.at(-1)!;
    expect(last.pixels).toHaveLength(576 * 432);
    expect(last.palette).toHaveLength(768);
    expect(last.pixels[120 * 576 + 60]).toBe(5);
  });

  it("gadgets : un clic de la souris déclenche le rappel une fois", async () => {
    const calls: number[] = [];
    const { host, engine } = await boot((_scene, s) => {
      s.gadgets.addGroup({ records: [{ rect: { x: 100, y: 100, w: 30, h: 30 } }, { rect: { x: 200, y: 100, w: 30, h: 30 } }], onActivate: (i) => calls.push(i) });
    });
    host.click(210, 110);
    await runFor(engine, host, 100);
    host.click(5, 5);
    await runFor(engine, host, 100);
    host.click(110, 110, "right");
    await runFor(engine, host, 100);
    expect(calls).toEqual([2, 1]);
  });

  it("clavier : Tab puis Entrée activent un gadget", async () => {
    const calls: number[] = [];
    const { host, engine } = await boot((_scene, s) => {
      s.gadgets.addGroup({ records: [{ rect: { x: 100, y: 100, w: 30, h: 30 } }, { rect: { x: 200, y: 100, w: 30, h: 30 } }], onActivate: (i) => calls.push(i) });
    });
    host.press("Tab");
    host.press("Tab");
    host.press("Enter");
    await runFor(engine, host, 100);
    expect(calls).toEqual([2]);
  });

  it("cliquer-poser : la pièce portée capte les clics, y compris sur un gadget", async () => {
    const calls: number[] = [];
    const events: string[] = [];
    const { host, engine, services } = await boot((_scene, s) => {
      s.gadgets.addGroup({ records: [{ rect: { x: 300, y: 300, w: 50, h: 50 } }], onActivate: (i) => calls.push(i) });
      s.pointer.source = { pick: (x, y) => (rectContains({ x: 50, y: 50, w: 20, h: 20 }, x, y) ? { item: "piece", x: 50, y: 50, width: 20, height: 20 } : null) };
      s.pointer.listener = { onPick: () => events.push("pick"), onMove: (c) => events.push(`move ${c.x},${c.y}`), onDrop: (c) => events.push(`drop ${c.x},${c.y}`) };
    });
    expect(services.pointer.mode).toBe("clickAndStick");
    host.click(55, 55);
    await runFor(engine, host, 50);
    host.input.moveMouse(320, 320);
    await runFor(engine, host, 50);
    host.click(320, 320); // dépose sur le gadget : il ne doit pas réagir
    await runFor(engine, host, 50);
    expect(events).toEqual(["pick", "move 315,315", "drop 315,315"]);
    expect(calls).toEqual([]);
    host.click(320, 320);
    await runFor(engine, host, 50);
    expect(calls).toEqual([1]);
  });

  it("glisser (préférence du roster) : relâcher dépose, le bouton qui a pris doit rester tenu", async () => {
    const events: string[] = [];
    const { host, engine, services } = await boot((_scene, s) => {
      s.pointer.source = { pick: () => ({ item: "piece", x: 50, y: 50, width: 20, height: 20 }) };
      s.pointer.listener = { onPick: () => events.push("pick"), onMove: (c) => events.push(`move ${c.x},${c.y}`), onDrop: (c) => events.push(`drop ${c.x},${c.y}`) };
    });
    engine.ctx.roster.roster.clickAndStick = false;
    expect(services.pointer.mode).toBe("drag");
    host.input.moveMouse(55, 55);
    host.input.mouseDown("middle");
    await runFor(engine, host, 50);
    host.input.moveMouse(100, 100);
    await runFor(engine, host, 50);
    host.input.mouseUp("middle");
    host.input.moveMouse(150, 150); // le relâchement se produit à (100,100) : position de l'événement
    await runFor(engine, host, 50);
    expect(events).toEqual(["pick", "move 95,95", "drop 95,95"]);
  });

  it("animation bloquante : gadgets gelés pendant la lecture, clic qui interrompt n'atteint pas les gadgets", async () => {
    const calls: number[] = [];
    const ends: string[] = [];
    const { host, engine } = await boot((_scene, s) => {
      s.gadgets.addGroup({ records: [{ rect: { x: 0, y: 0, w: 576, h: 432 } }], onActivate: (i) => calls.push(i) });
      s.scr.playBlocking(syntheticArchive(), 100, { flags: SCR_FLAG.interruptible }, (a) => ends.push(a.state));
    });
    expect(ends).toEqual([]);
    host.click(300, 300); // interrompt la lecture
    await runFor(engine, host, 50);
    expect(ends).toEqual(["interrupted"]);
    expect(calls).toEqual([]);
    host.click(300, 300);
    await runFor(engine, host, 50);
    expect(calls).toEqual([1]);
  });

  it("endScene : animations, gadgets, pièce portée et sons sont oubliés ; la scène suivante repart de zéro", async () => {
    const { host, engine, services, scene } = await boot((_s, s) => {
      s.gadgets.addGroup({ records: [{ rect: { x: 0, y: 0, w: 10, h: 10 }, shapes: { hover: 1 } }] });
      s.scr.start(syntheticArchive(), 100, { loop: true });
      s.pointer.carry({ item: 1, x: 0, y: 0, width: 5, height: 5 }, "left", 0, 0);
    });
    host.audio.unlock();
    services.sound.playWave(syntheticArchive(), 900, { channel: "voice" });
    expect(services.scr.running).toHaveLength(1);
    expect(services.pointer.carried).not.toBeNull();
    expect(services.sound.voicePlaying).toBe(true);
    scene.leave();
    expect(services.scr.running).toHaveLength(0);
    expect(services.pointer.carried).toBeNull();
    expect(services.gadgets.hitRecord(5, 5)).toBeNull();
    expect(services.sound.voicePlaying).toBe(false);
    host.click(5, 5);
    await runFor(engine, host, 100);
  });

  it("une palette qui change (fondu) provoque une présentation même sans redessin", async () => {
    const { host, engine, services } = await boot(() => {});
    const before = host.frames.length;
    await runFor(engine, host, 100);
    expect(host.frames.length).toBe(before);
    services.graphics.palette.setColor(10, 200, 100, 50);
    await runFor(engine, host, 100);
    expect(host.frames.length).toBe(before + 1);
    expect([...host.frames.at(-1)!.palette.subarray(30, 33)]).toEqual([200, 100, 50]);
  });
});

