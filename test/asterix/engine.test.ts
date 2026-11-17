import { describe, expect, it } from "vitest";
import { parseAudioIndex } from "../../src/engine/infogrames/data/audio-index";
import { HY8_PART_RECT, parseHy8 } from "../../src/engine/infogrames/data/hy8";
import { parseMcc } from "../../src/engine/infogrames/data/mcc";
import { VidDecoder } from "../../src/engine/infogrames/data/vid";
import { Engine } from "../../src/engine/infogrames/engine";
import { Palette } from "../../src/engine/infogrames/palette";
import { PictureScene } from "../../src/engine/infogrames/picture";
import { Surface } from "../../src/engine/infogrames/surface";
import { VideoBackdrop, VideoPlayer, VideoScene, markerValue } from "../../src/engine/infogrames/video";
import { expandName } from "../../src/games/asterix/engine/paths";
import { AsterixTestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

/** Le moteur n'a rien de propre à Astérix à précharger ici. */
const CONFIG = { beepFiles: [] };

/** Image `n` d'un conteneur, décodée indépendamment du moteur. */
function referenceFrame(path: string, n: number): VidDecoder {
  const decoder = new VidDecoder(readOriginal(path));
  for (let i = 0; i <= n; i++) decoder.nextFrame();
  return decoder;
}

describe("chemins d'Astérix (13ef:011b)", () => {
  it("range un nom nu dans le dossier de son module et remplace le premier tiret", () => {
    expect(expandName("M21AA.MUX")).toBe("MDF/21/M21AA.MUX");
    expect(expandName("b01-01b.voc")).toBe("MDF/01/B01_01B.VOC");
    expect(expandName("m06ab.mux.vid")).toBe("MDF/06/M06AB.MUX.VID");
    expect(expandName("md?\\22\\b34-01b.voc")).toBe("MDF/22/B34_01B.VOC");
    expect(expandName("audio.json")).toBe("MDF/UD/AUDIO.JSON");
  });

  it.skipIf(!hasOriginalFiles)("résout les fichiers convertis et ceux de la racine", () => {
    const host = new AsterixTestHost();
    expect(host.filePath("m06ab.mux")).toBeUndefined();
    expect(host.filePath("m06ab.mux.vid")).toBe("MDF/06/M06AB.MUX.vid");
    expect(host.filePath("b01-01b.voc.mp3")).toBe("MDF/01/B01_01B.VOC.mp3");
    expect(host.filePath("md?\\22\\b34-01b.voc.mp3")).toBe("MDF/22/B34_01B.VOC.mp3");
    expect(host.filePath("b34-01b.voc.mp3")).toBe("MDF/34/B34_01B.VOC.mp3");
    expect(host.filePath("audio.json")).toBe("audio.json");
  });
});

describe("markerValue (atoi du marqueur 08)", () => {
  it("lit un entier décimal signé", () => {
    const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    expect(["1", "10", "-1", " 7", "+3", "4x", "", "x"].map((s) => markerValue(text(s)))).toEqual([1, 10, -1, 7, 3, 4, 0, 0]);
    expect(markerValue(Uint8Array.of(0x32, 0))).toBe(2);
  });
});

describe.skipIf(!hasOriginalFiles)("moteur commun sur les fichiers d'Astérix", () => {
  const index = () => parseAudioIndex(new TextDecoder().decode(readOriginal("audio.json")));

  it("HY8 : la partie de type 5 de 32/M32SA000.HY8 est un rectangle noir opaque de 60 × 100", () => {
    const hy8 = parseHy8(readOriginal("MDF/32/M32SA000.HY8"));
    expect(hy8.sprites).toHaveLength(61);
    expect(hy8.sprites[60]).toEqual({
      mode: 0x10,
      parts: [{ kind: HY8_PART_RECT, target: 0, flags: 0, points: [{ x: 0, y: 0 }, { x: 59, y: 99 }], rect: { fill: 0, outline: null } }],
    });
    const surface = new Surface();
    surface.work.fill(200);
    surface.drawSprite(hy8, 60, 100, 50);
    const at = (x: number, y: number) => surface.work[y * 320 + x];
    expect([at(100, 50), at(159, 149), at(99, 50), at(160, 149), at(100, 49), at(159, 150)]).toEqual([0, 0, 200, 200, 200, 200]);
    expect(surface.work.filter((p) => p === 0).length).toBe(6000);
  });

  it("Resources.video : un .mux d'Astérix vient de son conteneur, avec le son du MP3 voisin et sa durée exacte", async () => {
    const host = new AsterixTestHost();
    const { resources } = new Engine(host, CONFIG, { seed: 1 }).ctx;
    const clip = await resources.video("m06ab.mux");
    expect(host.loaded.sort()).toEqual(["MDF/06/M06AB.MUX.mp3", "MDF/06/M06AB.MUX.vid", "audio.json"]);
    const entry = index().get("MDF/06/M06AB.MUX.mp3")!;
    expect(clip.audio).toMatchObject({ format: "mp3", sampleCount: entry.samples, sampleRate: entry.sampleRate });
    expect(clip.source.frameCount).toBe(36);
    const player = new VideoPlayer(clip);
    expect(player.sampleRate).toBe(entry.sampleRate);
    expect(player.fps).toBeCloseTo(1193182 / new VidDecoder(readOriginal("MDF/06/M06AB.MUX.vid")).header.frameDivisor / 12, 6);
    player.seek(20);
    const expected = referenceFrame("MDF/06/M06AB.MUX.vid", 20);
    expect(player.pixels).toEqual(expected.pixels);
    expect(player.palette).toEqual(expected.palette);
    // Une vidéo n'est pas gardée : un second appel repart de la première image.
    expect(new VideoPlayer(await resources.video("m06ab.mux")).shown).toBe(-1);
  });

  it("Resources.video : vidéo muette (23/M23AA) et MUK (34/M34AG) sans son", async () => {
    const host = new AsterixTestHost();
    const { resources } = new Engine(host, CONFIG, { seed: 1 }).ctx;
    const silent = await resources.video("m23aa.mux");
    expect([silent.audio, silent.source.frameCount]).toEqual([null, 7]);
    const muk = await resources.video("m34ag.muk");
    expect([muk.audio, muk.source.frameCount, muk.source.framesPerSecond]).toEqual([null, 50, 0]);
    // La première image du MUK est partielle : posée sur un fond, elle n'en recouvre qu'une partie.
    const target = new Uint8Array(64000).fill(0xee);
    muk.source.nextFrame();
    muk.source.compose(target);
    const kept = target.filter((p) => p === 0xee).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(64000);
  });

  it("VideoScene : l'image d'un conteneur suit la position du son MP3 ; son débloqué en route : reprise au bon endroit", async () => {
    const host = new AsterixTestHost();
    const engine = new Engine(host, CONFIG, { seed: 1 });
    const path = "MDF/06/M06AAA.MUX.vid";
    const { header } = new VidDecoder(readOriginal(path));
    let ended = false;
    engine.ctx.scenes.replace(new VideoScene({ file: "m06aaa.mux", onEnd: () => (ended = true) }));
    await runFor(engine, host, 1500);
    expect(host.audio.plays).toHaveLength(1);
    const played = host.audio.plays[0];
    expect(played.sound).toMatchObject({ format: "mp3", sampleCount: header.audioSamples, sampleRate: header.audioFrequency });
    const frame = Math.floor(((host.lastPresentation.at - played.at) / 1000) * header.framesPerSecond);
    expect(frame).toBeGreaterThanOrEqual(10);
    const expected = referenceFrame(path, frame);
    expect(host.lastPresentation.surface).toEqual(expected.pixels);
    const palette = new Palette();
    palette.load(expected.palette);
    expect(host.lastPresentation.palette).toEqual(palette.display());
    // Le temps du son fait foi.
    played.at -= 2000;
    await runFor(engine, host, 100);
    const frame2 = Math.floor(((host.lastPresentation.at - played.at) / 1000) * header.framesPerSecond);
    expect(frame2).toBeGreaterThan(frame + 15);
    expect(host.lastPresentation.surface).toEqual(referenceFrame(path, frame2).pixels);
    await runUntil(engine, host, () => ended);
    expect((host.time - played.at) / 1000).toBeGreaterThan(header.audioSamples / header.audioFrequency - 0.1);

    const late = new AsterixTestHost();
    late.audio.enabled = false;
    const engine2 = new Engine(late, CONFIG, { seed: 1 });
    engine2.ctx.scenes.replace(new VideoScene({ file: "m06aaa.mux", onEnd: () => {} }));
    await runFor(engine2, late, 2000);
    expect(late.audio.plays).toHaveLength(0);
    late.audio.enabled = true;
    await runFor(engine2, late, 100);
    const resumed = late.audio.plays[0].sound;
    // Même MP3, repris environ 2 s plus loin : la durée restante est celle du son d'origine moins ce qui est sauté.
    expect(resumed.format).toBe("mp3");
    expect(resumed.skipSamples! / resumed.sampleRate).toBeGreaterThan(1.9);
    expect(resumed.skipSamples! / resumed.sampleRate).toBeLessThan(2.2);
    expect(resumed.sampleCount + resumed.skipSamples!).toBe(header.audioSamples);
  });

  it("marqueurs 08 : `marker` vaut atoi du dernier marqueur lu, et le module peut le remettre à -1 (06/M06AC)", async () => {
    const host = new AsterixTestHost();
    const { resources } = new Engine(host, CONFIG, { seed: 1 }).ctx;
    const player = new VideoPlayer(await resources.video("m06ac.mux"));
    const reference = new VidDecoder(readOriginal("MDF/06/M06AC.MUX.vid"));
    expect(player.marker).toBe(0);
    player.marker = -1;
    const seen: number[] = [];
    for (let frame = 0; frame < player.frameCount; frame++) {
      const expected = reference.nextFrame()!;
      player.seek(frame, (_, markers) => {
        expect(markers).toEqual(expected.markers);
      });
      if (expected.markers.length > 0) {
        expect(player.marker).toBe(Number(String.fromCharCode(...expected.markers[expected.markers.length - 1])));
        seen.push(player.marker);
        player.marker = -1;
      } else expect(player.marker).toBe(-1);
    }
    // Les dix plans de l'introduction (engine.md §4.6), dans l'ordre du fichier.
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("surimpression (0x1000) : seuls les pixels écrits par l'image courante recouvrent le fond", async () => {
    const host = new AsterixTestHost();
    const engine = new Engine(host, CONFIG, { seed: 1 });
    const { ctx } = engine;
    ctx.surface.work.fill(5);
    const backdrop = new VideoBackdrop();
    backdrop.capture(ctx);
    const path = "MDF/21/M21AM.MUX.vid";
    const overlay = new VideoPlayer(await ctx.resources.video("m21am.mux"), backdrop);
    const plain = new VideoPlayer(await ctx.resources.video("m21am.mux"));
    for (const frame of [0, 30, 90]) {
      overlay.seek(frame);
      plain.seek(frame);
      const reference = referenceFrame(path, frame);
      const expected = new Uint8Array(64000).fill(0x85);
      reference.compose(expected);
      expect(overlay.pixels).toEqual(expected);
      expect(plain.pixels).toEqual(reference.pixels);
      if (frame > 0) {
        // Une image inter laisse voir le fond ; sans fond, les images s'accumulent.
        expect(overlay.pixels.filter((p) => p === 0x85).length).toBeGreaterThan(0);
        expect(plain.pixels.includes(0x85)).toBe(false);
      }
    }
  });

  it("rappel d'image (0x80, 0x4) : `draw` compose lui-même sur son décor, la palette courante reste", async () => {
    const host = new AsterixTestHost();
    const engine = new Engine(host, CONFIG, { seed: 1 });
    const decor = new Uint8Array(64000).fill(0x42);
    engine.ctx.palette.setColor(0x42, 10, 20, 30);
    const before = engine.ctx.palette.colors.slice();
    let draws = 0;
    let shown = -1;
    engine.ctx.scenes.replace(
      new VideoScene({
        file: "m34ag.muk",
        keepPalette: true,
        onEnd: () => {},
        draw(ctx, video) {
          draws++;
          shown = video.shown;
          ctx.surface.work.set(decor);
          video.compose(ctx.surface.work);
        },
      }),
    );
    await runFor(engine, host, 1000);
    expect(draws).toBeGreaterThan(0);
    expect(shown).toBeGreaterThanOrEqual(9);
    const expected = decor.slice();
    referenceFrame("MDF/34/M34AG.MUK.vid", shown).compose(expected);
    expect(host.lastPresentation.surface).toEqual(expected);
    expect(expected.includes(0x42)).toBe(true);
    expect(engine.ctx.palette.colors).toEqual(before);
  });

  it("MCC : chargé et affiché comme un MCG (Resources.picture, PictureScene)", async () => {
    const host = new AsterixTestHost();
    const engine = new Engine(host, CONFIG, { seed: 1 });
    const expected = parseMcc(readOriginal("MDF/49/M49DA005.MCC"));
    const picture = await engine.ctx.resources.picture("m49da005.mcc");
    expect(picture.pixels).toEqual(expected.pixels);
    expect(await engine.ctx.resources.picture("m49da005.mcc")).toBe(picture);
    expect((await engine.ctx.resources.picture("m06dc001.mcg")).pixels).toEqual(Uint8Array.from(readOriginal("MDF/06/M06DC001.MCG").subarray(770)));
    engine.ctx.scenes.replace(new PictureScene({ mcg: "m49da005.mcc" }));
    await runFor(engine, host, 200);
    expect(host.lastPresentation.surface).toEqual(expected.pixels);
    expect(engine.ctx.palette.colors).toEqual(new Uint8Array(expected.palette));
    expect(engine.ctx.surface.background).toEqual(expected.pixels);
  });
});
