import { describe, expect, it } from "vitest";
import { parseBd } from "../../src/games/swiv3d/data/bd";
import {
  argb4444,
  DIGIT_HEIGHT,
  DIGIT_WIDTH,
  GAUGE_HEIGHT,
  GAUGE_WIDTH,
  GLOBAL_FLAGS,
  hudIconRect,
  parseDigitSprites,
  parseGauge,
  parseHardwareHud,
  parseRowRleSprites,
  parseGlobal,
  parseScreen,
  SCREEN_HEIGHT,
  SCREEN_IDS,
  SCREEN_WIDTH,
} from "../../src/games/swiv3d/data/global";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("lecteurs synthétiques", () => {
  it("rejette un écran de mauvaise taille", () => {
    expect(() => parseScreen(new Uint8Array(10))).toThrow(/écran/);
  });

  it("range les 4 plans de la jauge en lignes de 20 pixels", () => {
    const frame = new Uint8Array(4 * GAUGE_HEIGHT * 5);
    frame[0] = 1; // plan 0, ligne 0, octet 0 -> pixel (0, 0)
    frame[GAUGE_HEIGHT * 5 + 1] = 2; // plan 1, ligne 0, octet 1 -> pixel (5, 0)
    frame[GAUGE_HEIGHT * 5 * 3 + 5 * 2 + 4] = 3; // plan 3, ligne 2, octet 4 -> pixel (19, 2)
    const [image] = parseGauge(frame);
    expect([image![0], image![5], image![2 * GAUGE_WIDTH + 19]]).toEqual([1, 2, 3]);
  });

  it("range les 4 plans des chiffres en lignes de 12 pixels", () => {
    const frame = new Uint8Array(4 * DIGIT_HEIGHT * 3);
    frame[2] = 7; // plan 0, ligne 0, octet 2 -> pixel (8, 0)
    frame[DIGIT_HEIGHT * 3 * 2 + 3 * 13 + 1] = 9; // plan 2, ligne 13, octet 1 -> pixel (6, 13)
    const [digit] = parseDigitSprites(frame);
    expect([digit![8], digit![13 * DIGIT_WIDTH + 6]]).toEqual([7, 9]);
    expect(() => parseDigitSprites(new Uint8Array(100))).toThrow(/chiffres/);
  });

  it("décode les sprites à lignes compressées (sauts, plages, littéraux, lignes vides)", () => {
    // Offsets (2 sprites : 8 puis 20), puis flux : saut 2 · plage de 3 × 0x88 · littéraux 1 2 · fin de ligne · ligne vide · fin.
    const bytes = Uint8Array.from([
      8, 0, 0, 0, 20, 0, 0, 0,
      0x42, 0x83, 0x88, 0xc2, 1, 2, 0xfe, 0x04, 0x00, 0xfe, 0xff, 0,
      0x00, 0x05, 0x81, 0x07, 0xfe, 0xff,
    ]);
    const [a, b] = parseRowRleSprites(bytes);
    expect(a).toMatchObject({ width: 7, height: 2 });
    expect([...a!.pixels.subarray(0, 7)]).toEqual([0, 0, 0x88, 0x88, 0x88, 1, 2]);
    expect([...a!.covered.subarray(0, 7)]).toEqual([0, 0, 1, 1, 1, 1, 1]);
    expect(a!.covered.subarray(7).every((v) => v === 0)).toBe(true);
    // Saut long de 5 pixels (14 bits), puis un pixel de valeur 7.
    expect(b).toMatchObject({ width: 6, height: 1 });
    expect(b!.pixels[5]).toBe(7);
    expect(() => parseRowRleSprites(Uint8Array.from([4, 0, 0, 0, 0x41]))).toThrow(/non terminé/);
  });

  it("découpe l'atlas du HUD accéléré en trois textures et adresse les icônes par cellules de 51", () => {
    expect(() => parseHardwareHud(new Uint8Array(10))).toThrow(/atlas/);
    const hud = parseHardwareHud(new Uint8Array(98304));
    expect([hud.icons.width, hud.radar[0].width, hud.radar[1].height]).toEqual([256, 128, 128]);
    expect(hudIconRect(0)).toEqual({ x: 0, y: 0, size: 51 });
    expect(hudIconRect(21)).toEqual({ x: 51, y: 204, size: 51 });
  });

  it("décompose un u16 ARGB 4-4-4-4", () => {
    expect(argb4444(0xf000)).toEqual([0, 0, 0, 255]);
    expect(argb4444(0x0fff)).toEqual([255, 255, 255, 0]);
    expect(argb4444(0x8321)).toEqual([51, 34, 17, 136]);
  });
});

describe.skipIf(!hasOriginalFiles)("GLOBAL.BD (fichier du jeu)", () => {
  const bd = parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD");
  const global = parseGlobal(bd);

  it("lit l'en-tête et les drapeaux", () => {
    expect(global.header.options).toEqual(["CUTDOWN", "USENGLISH", "INTERPLAY", "IPLOGOISANIM"]);
    expect(global.header.flags).toBe(0xb2);
    expect(global.header.flags & GLOBAL_FLAGS.extraScreens).toBe(GLOBAL_FLAGS.extraScreens);
    expect(global.header.flags & GLOBAL_FLAGS.demo).toBe(0);
  });

  it("décode les cinq écrans en 320x400 avec une palette 6 bits", () => {
    for (const id of SCREEN_IDS) {
      const screen = global.screen(id);
      expect(screen.pixels).toHaveLength(SCREEN_WIDTH * SCREEN_HEIGHT);
      expect(screen.palette6).toHaveLength(768);
      expect(Math.max(...screen.palette6)).toBeLessThanOrEqual(63);
      expect(screen.table).toHaveLength(8192);
    }
    expect(() => global.screen(1000)).toThrow(/pas un écran/);
    // 1001 (mentions légales) et 1002 (crédits) partagent palette et table ; 1003 à 1005 ont les leurs.
    expect(global.screen(1001).palette6).toEqual(global.screen(1002).palette6);
    expect(global.screen(1001).palette6).not.toEqual(global.screen(1003).palette6);
  });

  it("lit la police vectorielle : 158 glyphes dont les lettres et les accents", () => {
    const { glyphs, normals } = global.vectorFont;
    expect(glyphs.size).toBe(158);
    expect(normals).toHaveLength(23 * 3);
    expect([...normals.slice(0, 3)]).toEqual([0, 0, -256]);
    const a = glyphs.get(65)!;
    expect(a.width).toBe(124);
    expect(a.vertices).toHaveLength(30 * 3);
    expect(a.triangles).toHaveLength(52 * 4);
    expect(glyphs.has(0x82)).toBe(true);
    for (const glyph of glyphs.values()) {
      for (let t = 0; t < glyph.triangles.length; t += 4) {
        expect(Math.max(glyph.triangles[t]!, glyph.triangles[t + 1]!, glyph.triangles[t + 2]!)).toBeLessThan(glyph.vertices.length / 3);
        expect(glyph.triangles[t + 3]!).toBeLessThan(23);
      }
    }
  });

  it("lit les profils de cratère (3 tailles x 16 phases x 16 profondeurs)", () => {
    expect(global.craters).toHaveLength(3);
    expect(global.craters.every((size) => size.length === 16 && size.every((p) => p.length === 16))).toBe(true);
    expect([...global.craters[0]![0]!]).toEqual([0, 1, 0, 0, 1, 11, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(Math.max(...global.craters[2]![0]!)).toBe(18);
  });

  it("compte les images des planches de sprites", () => {
    expect(global.weaponIcons).toHaveLength(22);
    expect(global.weaponIcons[0]).toMatchObject({ width: 24, height: 38 });
    expect([global.radar.frames510.length, global.radar.frames511.length, global.radar.frames512.length]).toEqual([32, 128, 128]);
    expect(global.gauge).toHaveLength(44);
    expect(global.gauge[0]).toHaveLength(GAUGE_WIDTH * GAUGE_HEIGHT);
    expect(global.textures).toHaveLength(56);
    expect(global.sprites21x35).toHaveLength(96);
    expect(global.sprites29x40).toHaveLength(32);
  });

  it("fournit la table de mélange 256x256 (ligne 0xf0 = identité) et la rampe de 256 couleurs", () => {
    expect(global.blendTable).toHaveLength(65536);
    expect(Array.from(global.blendTable.subarray(0xf000, 0xf100))).toEqual(Array.from({ length: 256 }, (_, i) => i));
    expect(global.colorRamp).toHaveLength(256);
    expect(global.colorRamp[0]).toBe(0xf000);
    expect(global.colorRamp[255]).toBe(0x0fff);
  });

  it("lit les chiffres du bloc 502 : 11 images 12×14 en traits sombres sur fond transparent", () => {
    expect(global.digits).toHaveLength(11);
    for (const digit of global.digits) {
      expect(digit).toHaveLength(DIGIT_WIDTH * DIGIT_HEIGHT);
      expect(Math.min(...digit)).toBeGreaterThanOrEqual(0xf0);
      expect(digit.some((v) => v >= 0xfc)).toBe(true);
    }
    // Le « 1 » est étroit : pas de trait sombre dans les trois premières colonnes (le « 0 » en a).
    const strokes = (digit: Uint8Array, columns: number[]) => columns.some((x) => digit.some((v, i) => i % DIGIT_WIDTH === x && v >= 0xfc));
    expect(strokes(global.digits[1]!, [0, 1, 2])).toBe(false);
    expect(strokes(global.digits[0]!, [2, 3])).toBe(true);
  });

  it("lit la police accélérée (bloc 450) : mêmes 384 glyphes que la police 2D, indexés pareil", () => {
    const { font } = global.hardware;
    expect(font).toHaveLength(384);
    const a = font[65]!;
    expect(a.height).toBe(16);
    expect(a.width).toBeLessThanOrEqual(20);
    expect(a.covered.some((v) => v === 1)).toBe(true);
    expect(font[0]!.covered.every((v) => v === 0)).toBe(true);
    expect(font[32]!.covered.every((v) => v === 0)).toBe(true);
  });

  it("lit la jauge accélérée (bloc 452) : 44 images de 38 colonnes (la version agrandie de 503)", () => {
    const { gauge } = global.hardware;
    expect(gauge).toHaveLength(44);
    for (const frame of gauge) {
      expect(frame.width).toBe(38);
      expect(frame.height).toBeGreaterThanOrEqual(GAUGE_HEIGHT - 8);
      expect(frame.height).toBeLessThanOrEqual(99);
      expect(frame.covered.some((v) => v === 1)).toBe(true);
    }
  });

  it("lit l'atlas du HUD accéléré (bloc 451) : icônes en grille 5×5, deux textures de radar", () => {
    const { hud } = global.hardware;
    expect([hud.icons.data.length, hud.radar[0].data.length, hud.radar[1].data.length]).toEqual([65536, 16384, 16384]);
    // La capsule vide (cellule 0) est opaque (quartet d'alpha) ; la cellule 22, hors des 22 icônes, est transparente.
    const alphaSum = (index: number) => {
      const { x, y, size } = hudIconRect(index);
      let sum = 0;
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) sum += hud.icons.data[(y + j) * 256 + x + i]! >> 4;
      return sum;
    };
    expect(alphaSum(0)).toBeGreaterThan(0);
    expect(alphaSum(22)).toBe(0);
  });

  it("lit les sept textures de particules du bloc 500, dont les indices existent dans la rampe 509", () => {
    const { particles } = global.hardware;
    expect(particles).toHaveLength(7);
    for (const texture of particles) {
      expect(texture).toHaveLength(64 * 64);
      expect(Math.max(...texture)).toBeLessThan(global.colorRamp.length);
    }
    // Seuls les 128 premiers indices de la rampe servent ; le texel 0 d'une rampe est le noir opaque, le dernier d'une rampe est clair.
    expect(particles.every((t) => Math.max(...t) < 128 && Math.max(...t) % 16 === 15)).toBe(true);
    expect(argb4444(global.colorRamp[0]!)).toEqual([0, 0, 0, 255]);
  });

  it("assemble les chaînes, la police et les missions", () => {
    expect(global.strings.get(1, 1, 10)).toBe("Commencer le jeu");
    expect(global.font.glyphs).toHaveLength(384);
    expect(global.missions.missions).toHaveLength(17);
  });
});
