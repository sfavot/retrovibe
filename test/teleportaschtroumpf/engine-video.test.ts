import { describe, expect, it } from "vitest";
import { MuxDecoder } from "../../src/games/teleportaschtroumpf/data/mux";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { Palette } from "../../src/games/teleportaschtroumpf/engine/palette";
import { VideoPlayer, VideoScene, scanMux } from "../../src/games/teleportaschtroumpf/engine/video";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readData } from "./helpers";

const LOGO = "S52/S52D/S52D0.MUX"; // 80 images à 7 images/s, son 19 230 Hz

/** Image `n` d'une vidéo, décodée indépendamment du moteur. */
function referenceFrame(bytes: Uint8Array, n: number): { pixels: Uint8Array; palette: Uint8Array } {
  const decoder = new MuxDecoder(bytes);
  for (let i = 0; i <= n; i++) decoder.nextFrame();
  return { pixels: decoder.pixels.slice(), palette: decoder.palette.slice() };
}

describe.skipIf(!hasOriginalFiles)("lecture MUX", () => {
  it("scanMux : piste son complète et nombre d'images", () => {
    const bytes = new Uint8Array(readData(LOGO));
    const decoder = new MuxDecoder(bytes);
    let frames = 0;
    let audio = 0;
    for (let f = decoder.nextFrame(); f; f = decoder.nextFrame()) {
      frames++;
      for (const chunk of f.audio) audio += chunk.length;
    }
    const scan = scanMux(bytes, decoder.header.firstChunkOffset);
    expect(scan.frameCount).toBe(frames);
    // La piste complète contient aussi le son qui suit la dernière image.
    expect(scan.audio!.length).toBeGreaterThanOrEqual(audio);
    const check = new MuxDecoder(bytes);
    let offset = 0;
    for (let f = check.nextFrame(); f; f = check.nextFrame()) {
      for (const chunk of f.audio) {
        expect(scan.audio!.subarray(offset, offset + chunk.length)).toEqual(chunk);
        offset += chunk.length;
      }
    }
    expect(offset).toBe(audio);
  });

  it("VideoPlayer : image = floor(temps × cadence), décodage dans l'ordre", () => {
    const bytes = new Uint8Array(readData(LOGO));
    const player = new VideoPlayer(bytes);
    expect(player.fps).toBeCloseTo(7, 1);
    expect(player.sampleRate).toBe(19230);
    expect(player.frameCount).toBe(80);
    expect(player.frameAt(1)).toBe(7);
    expect(player.frameAt(0.99)).toBe(6);
    expect(player.endedAt(player.duration - 0.01)).toBe(false);
    expect(player.endedAt(player.duration + 0.01)).toBe(true);
    expect(player.seek(0)).toBe(true);
    expect(player.seek(0)).toBe(false);
    expect(player.seek(20)).toBe(true);
    expect(player.shown).toBe(20);
    expect(player.pixels).toEqual(referenceFrame(bytes, 20).pixels);
    expect(player.seek(5)).toBe(false); // pas de retour en arrière
    player.seek(10_000);
    expect(player.shown).toBe(79);
  });

  it("VideoScene : l'image affichée suit la position audio ; fin → onEnd", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 1 });
    const bytes = new Uint8Array(readData(LOGO));
    let ended = false;
    engine.ctx.scenes.replace(new VideoScene({ file: "s52d0.mux", onEnd: () => (ended = true) }));
    await runFor(engine, host, 1500);
    // Le son de la vidéo est sur la voie unique, une seule fois, et la musique est retenue.
    expect(host.audio.plays).toHaveLength(1);
    expect(host.audio.plays[0].sound.sampleRate).toBe(19230);
    expect(host.audio.plays[0].loop).toBe(false);
    const start = host.audio.plays[0].at;
    const shown = host.lastPresentation;
    const frame = Math.floor(((shown.at - start) / 1000) * 7.0003);
    expect(frame).toBeGreaterThanOrEqual(9);
    const expected = referenceFrame(bytes, frame);
    expect(shown.surface).toEqual(expected.pixels);
    const palette = new Palette();
    palette.load(expected.palette);
    expect(shown.palette).toEqual(palette.display());

    // Le temps audio fait foi : si la position audio avance de 2 s d'un coup, l'image saute en conséquence.
    host.audio.plays[0].at -= 2000;
    await runFor(engine, host, 100);
    const jumped = host.lastPresentation;
    const frame2 = Math.floor(((jumped.at - host.audio.plays[0].at) / 1000) * 7.0003);
    expect(frame2).toBeGreaterThan(frame + 10);
    expect(jumped.surface).toEqual(referenceFrame(bytes, frame2).pixels);

    expect(ended).toBe(false);
    await runUntil(engine, host, () => ended);
    // La fin attend la fin du son (230 760 échantillons à 19 230 Hz = 12 s), un peu après la dernière image (11,4 s).
    const audioSeconds = host.audio.plays[0].sound.samples.length / 19230;
    expect((host.time - start) / 1000).toBeGreaterThan(audioSeconds - 2.2);
    expect((host.time - start) / 1000).toBeLessThan(audioSeconds + 0.2);
  });

  it("sans son (sortie verrouillée) : cadence de l'horloge", async () => {
    const host = new TestHost();
    host.audio.enabled = false;
    const engine = new Engine(host, { seed: 1 });
    const bytes = new Uint8Array(readData(LOGO));
    engine.ctx.scenes.replace(new VideoScene({ file: "s52d0.mux", onEnd: () => {} }));
    await runFor(engine, host, 1000);
    const shown = host.lastPresentation;
    const frame = Math.floor((shown.at / 1000) * 7.0003);
    // Tolérance d'une image sur le décalage de démarrage de la scène (quelques ms).
    const candidates = [frame - 1, frame].map((n) => referenceFrame(bytes, n).pixels);
    expect(candidates.some((pixels) => Buffer.from(pixels).equals(shown.surface))).toBe(true);
  });

  it("son débloqué en cours de lecture : la piste repart à la position de la vidéo", async () => {
    const host = new TestHost();
    host.audio.enabled = false;
    const engine = new Engine(host, { seed: 1 });
    engine.ctx.scenes.replace(new VideoScene({ file: "s52d0.mux", onEnd: () => {} }));
    await runFor(engine, host, 2000);
    expect(host.audio.plays).toHaveLength(0);

    host.audio.enabled = true;
    await runFor(engine, host, 100);
    expect(host.audio.plays).toHaveLength(1);
    const played = host.audio.plays[0];
    // La piste jouée est la fin de la piste complète (230 760 échantillons) : environ 2 s ont été sautées.
    const skipped = 230760 - played.sound.samples.length;
    expect(skipped / 19230).toBeGreaterThan(1.9);
    expect(skipped / 19230).toBeLessThan(2.2);
    // Et l'image suit le temps vidéo, pas le temps écoulé depuis le début du son.
    const frame = Math.floor((skipped / 19230 + (host.lastPresentation.at - played.at) / 1000) * 7.0003);
    const bytes = new Uint8Array(readData(LOGO));
    const candidates = [frame - 1, frame].map((n) => referenceFrame(bytes, n).pixels);
    expect(candidates.some((pixels) => Buffer.from(pixels).equals(host.lastPresentation.surface))).toBe(true);
  });

  it("passable par Échap (si autorisé) : coupe le son et appelle onEnd", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 1 });
    let ended = false;
    engine.ctx.scenes.replace(new VideoScene({ file: "s52d0.mux", onEnd: () => (ended = true) }));
    await runFor(engine, host, 800);
    expect(ended).toBe(false);
    host.input.keyDown("Escape");
    await runFor(engine, host, 100);
    expect(ended).toBe(true);
    host.input.keyUp("Escape");
  });

  it("non passable : Échap n'a aucun effet", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 1 });
    let ended = false;
    engine.ctx.scenes.replace(new VideoScene({ file: "s52d0.mux", skippable: false, onEnd: () => (ended = true) }));
    await runFor(engine, host, 500);
    host.input.keyDown("Escape");
    host.input.keyUp("Escape");
    await runFor(engine, host, 500);
    expect(ended).toBe(false);
  });

  it("fadeOutAtEnd : fondu au noir avant onEnd", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 1 });
    let blackAtEnd: boolean | null = null;
    engine.ctx.scenes.replace(
      new VideoScene({ file: "s52d0.mux", fadeOutAtEnd: true, onEnd: (ctx) => (blackAtEnd = ctx.palette.black) }),
    );
    await runFor(engine, host, 500);
    host.input.keyDown("Escape");
    await runFor(engine, host, 1000);
    expect(blackAtEnd).toBe(true);
  });
});
