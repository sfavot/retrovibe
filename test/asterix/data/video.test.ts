import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VideoDecoder, type VideoFrame } from "../../../src/games/asterix/data/video";
import { fromBase64, hasOriginalFiles, listOriginal, readOriginal, withSuffix } from "../helpers";
import { VIDEO_VECTOR } from "./lzma-vectors";

const PIXELS = 64000;

/**
 * SHA-1 de toutes les images décodées à la suite (64 000 octets chacune), et nombre d'images. Valeurs de référence
 * obtenues sur les fichiers d'origine (non versionnés) par un décodeur indépendant du script d'extraction : le
 * `MuxDecoder` TypeScript des Schtroumpfs pour les MUX (même code machine dans les deux jeux), son `MuxVideoDecoder`
 * appliqué aux enregistrements pour les MUK. Le conteneur, lui, est produit par le décodeur Python du script : l'égalité
 * prouve que le réencodage est sans perte, pixel à pixel.
 */
const REFERENCE: Record<string, { frames: number; sha1: string }> = {
  "MDF/06/M06AAA.MUX.vid": { frames: 290, sha1: "a2cd0ed39649ab7a5a4ed3e51f98a5da6887ed8d" },
  "MDF/06/M06AB.MUX.vid": { frames: 36, sha1: "8c7415090b191491a629b69ddaac6bda3de0fb8a" },
  "MDF/06/M06AC.MUX.vid": { frames: 444, sha1: "de2e826a6374dca14774feec4d6f906d4c00bf90" },
  "MDF/08/M08AA.MUX.vid": { frames: 66, sha1: "c56d71dccad015b48603b5f3c28084a5b59840e4" },
  "MDF/11/M11AA.MUX.vid": { frames: 66, sha1: "6c2aebb289e284bc7dd16e88ffa7af2df43e6915" },
  "MDF/21/M21AM.MUX.vid": { frames: 91, sha1: "0bd4434d5b79d8d34c8bf515ec6eff6beff4c027" },
  "MDF/23/M23AA.MUX.vid": { frames: 7, sha1: "bbce4e2e5f8496c953a795a5a5bf765af68b3b8a" },
  "MDF/27/M27AH.MUX.vid": { frames: 63, sha1: "0c59ff8d98daf6f11ce3a47cfc922e5fca8ccb60" },
  "MDF/36/M36A.MUX.vid": { frames: 390, sha1: "79ed34aba218e1b73d65b96e5b63055a0ba3f4e4" },
  "MDF/39/M39AA.MUX.vid": { frames: 105, sha1: "ed2a97e6cfb8be699f8a78b0d86f00b15db54fe9" },
  "MDF/40/M40AA.MUX.vid": { frames: 126, sha1: "181d4de8d2bd54e9d615fb82ec55f087d4cb5a2a" },
  "MDF/52/M52A.MUX.vid": { frames: 161, sha1: "446fa25b4a557d6ec512cdacdd99e2f2a6256849" },
};

/** SHA-1 (8 premiers caractères) des images des MUK, même méthode. */
const REFERENCE_MUK: Record<string, { frames: number; sha1: string }> = {
  "MDF/26/M26DA000.MUK.vid": { frames: 16, sha1: "c3837169" },
  "MDF/26/M26DE002.MUK.vid": { frames: 16, sha1: "a48aac7c" },
  "MDF/34/M34AG.MUK.vid": { frames: 50, sha1: "8f76833d" },
};

function hashFrames(decoder: VideoDecoder): { frames: number; sha1: string } {
  const hash = createHash("sha1");
  let frames = 0;
  while (decoder.nextFrame()) {
    hash.update(decoder.pixels);
    frames++;
  }
  return { frames, sha1: hash.digest("hex") };
}

describe("VideoDecoder (conteneur de 4 images produit par Python)", () => {
  const open = () => new VideoDecoder(fromBase64(VIDEO_VECTOR));

  it("lit l'en-tête", () => {
    expect(open().header).toEqual({
      source: "muk",
      width: 320,
      height: 200,
      frameDivisor: 9039,
      framesPerSecond: 1193182 / 9039 / 12,
      audioFrequency: 18867,
      audioSamples: 13720,
      frameCount: 4,
    });
  });

  it("décode les images, les palettes, les marqueurs et le masque", () => {
    const video = open();
    const first = video.nextFrame() as VideoFrame;
    expect(first).toEqual({
      index: 0,
      audioEnd: 6860,
      paletteChanged: true,
      changed: true,
      coverage: "all",
      markers: [new TextEncoder().encode("1"), new TextEncoder().encode("-1")],
      values: [],
      mukField: null,
    });
    expect(video.pixels.every((p, i) => p === i % 251)).toBe(true);
    expect(video.palette.every((c, i) => c === i % 256)).toBe(true);
    expect(video.written.every((w) => w === 1)).toBe(true);

    const second = video.nextFrame() as VideoFrame;
    expect(second).toMatchObject({ index: 1, audioEnd: 13720, paletteChanged: false, changed: false, coverage: "none" });
    expect(video.written.every((w) => w === 0)).toBe(true);
    expect(video.pixels.every((p, i) => p === i % 251)).toBe(true);

    const third = video.nextFrame() as VideoFrame;
    expect(third).toMatchObject({ index: 2, changed: true, coverage: "partial", values: [0x1234, 7], mukField: 0xdeadbeef });
    expect(video.pixels.every((p, i) => p === (i >= 3200 && i < 3520 ? 200 : i % 251))).toBe(true);
    expect(video.written.every((w, i) => w === (i === 7 || (i >= 3200 && i < 3520) ? 1 : 0))).toBe(true);

    // Surimpression : seuls les pixels écrits recouvrent le fond.
    const backdrop = new Uint8Array(PIXELS).fill(99);
    video.compose(backdrop);
    expect(backdrop.every((p, i) => p === (i === 7 ? 7 : i >= 3200 && i < 3520 ? 200 : 99))).toBe(true);

    const fourth = video.nextFrame() as VideoFrame;
    expect(fourth).toMatchObject({ index: 770, paletteChanged: true, changed: false, coverage: "partial" });
    expect(video.written.every((w) => w === 0)).toBe(true);
    expect(video.palette.every((c, i) => c === 255 - (i % 256))).toBe(true);

    expect(video.nextFrame()).toBeNull();
    expect(video.nextFrame()).toBeNull();
  });

  it("recommence au début après reset", () => {
    const video = open();
    const once = hashFrames(video);
    video.reset();
    expect(video.pixels.every((p) => p === 0)).toBe(true);
    expect(hashFrames(video)).toEqual(once);
    expect(once.frames).toBe(4);
  });

  it("refuse un fichier qui n'est pas un conteneur ou qui est tronqué", () => {
    const bytes = fromBase64(VIDEO_VECTOR);
    expect(() => hashFrames(new VideoDecoder(bytes.subarray(0, bytes.length - 20)))).toThrow();
    expect(() => new VideoDecoder(new Uint8Array(64))).toThrow();
  });
});

describe.skipIf(!hasOriginalFiles)("VideoDecoder (original/asterix)", () => {
  const files = () => listOriginal(withSuffix(".vid"));

  it("retrouve, pixel à pixel, les images décodées des MUX et des MUK d'origine", { timeout: 120_000 }, () => {
    for (const [path, expected] of Object.entries({ ...REFERENCE, ...REFERENCE_MUK })) {
      const got = hashFrames(new VideoDecoder(readOriginal(path)));
      expect({ path, frames: got.frames, sha1: got.sha1.slice(0, expected.sha1.length) }).toEqual({ path, ...expected });
    }
  });

  it("lit les 148 conteneurs jusqu'au dernier octet", { timeout: 600_000 }, () => {
    const list = files();
    expect(list.filter(withSuffix(".MUX.vid")).length).toBe(117);
    expect(list.filter(withSuffix(".MUK.vid")).length).toBe(31);
    let frames = 0;
    let markers = 0;
    let lastAudio = 0;
    for (const path of list) {
      const video = new VideoDecoder(readOriginal(path));
      const isMux = path.endsWith(".MUX.vid");
      expect(video.header.source, path).toBe(isMux ? "mux" : "muk");
      expect([video.header.width, video.header.height], path).toEqual([320, 200]);
      let count = 0;
      lastAudio = 0;
      // nextFrame lève une erreur si le flux est tronqué, et, après la dernière image, s'il reste des octets.
      for (let frame = video.nextFrame(); frame; frame = video.nextFrame()) {
        expect(frame.index, `${path} image ${count}`).toBe(count);
        expect(frame.audioEnd).toBeGreaterThanOrEqual(lastAudio);
        lastAudio = frame.audioEnd;
        if (!isMux) expect(frame.mukField, path).not.toBeNull();
        markers += frame.markers.length;
        count++;
      }
      expect(count, path).toBe(video.header.frameCount);
      expect(lastAudio, path).toBeLessThanOrEqual(video.header.audioSamples);
      frames += count;
    }
    expect(frames).toBe(18983);
    expect(markers).toBe(202);
  });
});
