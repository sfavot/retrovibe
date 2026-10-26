import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseBd } from "../../../../src/games/swiv3d/data/bd";
import { parseGlobal } from "../../../../src/games/swiv3d/data/global";
import { parseLevel } from "../../../../src/games/swiv3d/data/level";
import { createHud, formatAmmo, formatScore, gaugeHidden, gaugeTarget, LAYOUT, radarColorTable } from "../../../../src/games/swiv3d/render/hud";
import { blipColorIndex, radarOffset, stepPointer } from "../../../../src/games/swiv3d/render/hud/radar";
import type { HudState } from "../../../../src/games/swiv3d/render/hud/state";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../../src/games/swiv3d/render/view";
import { hasOriginalFiles, readOriginal } from "../../helpers";

const SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;
const hash = (pixels: Uint8Array): string => createHash("sha1").update(pixels).digest("hex");

describe("formats du HUD", () => {
  it("score sur 7 chiffres comme %07d", () => {
    expect(formatScore(0)).toBe("0000000");
    expect(formatScore(12340)).toBe("0012340");
    expect(formatScore(9999999)).toBe("9999999");
    expect(formatScore(12345678)).toBe("12345678");
    expect(formatScore(-12)).toBe("-000012");
  });

  it("munitions comme x%02d", () => {
    expect(formatAmmo(4)).toBe("x04");
    expect(formatAmmo(25)).toBe("x25");
    expect(formatAmmo(100)).toBe("x100");
  });
});

describe("jauge d'énergie", () => {
  it("image visée : 0 à 15 sous 512, 28 à 43 au-delà, bornée", () => {
    expect([0, 31, 32, 495, 496, 511].map(gaugeTarget)).toEqual([0, 0, 1, 15, 15, 15]);
    expect([512, 544, 992, 1023, 5000, -50].map(gaugeTarget)).toEqual([28, 29, 43, 43, 43, 0]);
  });

  it("clignote sous 100 : visible 20 ticks sur 32", () => {
    const visible = (energy: number) => Array.from({ length: 64 }, (_, tick) => !gaugeHidden(energy, tick));
    const low = visible(99);
    expect(low.slice(0, 20).every(Boolean)).toBe(true);
    expect(low.slice(20, 32).some(Boolean)).toBe(false);
    expect(low.slice(32, 52).every(Boolean)).toBe(true);
    expect(visible(100).every(Boolean)).toBe(true);
  });
});

describe("radar", () => {
  it("1 pixel = 128 unités en largeur, tourné avec le cap du joueur", () => {
    expect(radarOffset(1000, 1000, 0, 1000 + 1280, 1000)).toMatchObject({ dx: 10, dy: 0, inRange: true });
    // Cap 128 (un quart de tour) : l'axe +x du monde, à droite à cap 0, passe vers le haut de l'écran (devant).
    const turned = radarOffset(1000, 1000, 128, 1000 + 1280, 1000);
    expect(turned.dx).toBe(0);
    expect(turned.dy).toBe(10);
    // Devant (+z à cap 0) = vers le haut : dy positif, étiré de 0x1ab / 256.
    const ahead = radarOffset(1000, 1000, 0, 1000, 1000 + 1280);
    expect(ahead).toMatchObject({ dx: 0, dy: 10, dyScaled: 16 });
  });

  it("n'accepte que les points à moins de ~24,5 pixels, et replie le monde torique", () => {
    expect(radarOffset(0, 0, 0, 24 * 128, 0).inRange).toBe(true);
    expect(radarOffset(0, 0, 0, 25 * 128, 0).inRange).toBe(false);
    expect(radarOffset(100, 0, 0, 32768 + 228, 0)).toMatchObject({ dx: 1, inRange: true });
  });

  it("couleurs par classe d'objet (masque 0x787f)", () => {
    expect(blipColorIndex(0x001, 0)).toBe(0x147f);
    expect(blipColorIndex(0x87, 0)).toBe(0x047f);
    expect(blipColorIndex(0x1003, 0)).toBe(0x107f);
    expect(blipColorIndex(0x041, 0)).toBe(0x017f);
    expect(blipColorIndex(0x041, 3)).toBe(0);
    expect(blipColorIndex(0x1002, 0)).toBe(-1);
    expect(blipColorIndex(0x0200, 0)).toBe(-1);
  });

  it("pointeur : tourne de 8 sans objectif, suit l'objectif de 8 pas par tick au plus", () => {
    const radar: HudState["radar"] = { playerX: 0, playerZ: 0, playerYaw: 0, blips: [] };
    expect(stepPointer(0, radar)).toBe(8);
    const east = { ...radar, objectives: [{ x: 5000, z: 0, current: true }] };
    let pointer = 0;
    for (let i = 0; i < 40; i++) pointer = stepPointer(pointer, east);
    // Les ±4 d'un essai à l'autre s'arrêtent dès que le produit scalaire plafonne (tables arrondies à 256) : plateau autour de 128.
    expect(Math.abs(pointer - 128)).toBeLessThanOrEqual(8);
    expect(Math.abs(stepPointer(0, east))).toBeLessThanOrEqual(8);
  });
});

describe.skipIf(!hasOriginalFiles)("HUD (fichiers du jeu)", () => {
  const global = parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
  const bytes = readOriginal("TERRAN00.SLV");
  const level = parseLevel(bytes, "TERRAN00");
  const radarColors = radarColorTable(parseBd(bytes, "TERRAN00").get(11003));
  const gaugeBox = (fb: Uint8Array): Uint8Array => {
    const out: number[] = [];
    for (let y = LAYOUT.gauge.y; y < LAYOUT.gauge.y + 81; y++) out.push(...fb.subarray(y * SCREEN_WIDTH + LAYOUT.gauge.x, y * SCREEN_WIDTH + LAYOUT.gauge.x + 20));
    return Uint8Array.from(out);
  };
  const make = () => createHud({ global, blendTable: level.fadeTable, table109: level.lightTable109, colorMap: level.colorMap, radarColors });
  const ammo = Array(20).fill(0);
  [0, 1, 2, 4, 5, 6, 8, 9].forEach((slot, i) => (ammo[slot] = 3 + i));
  const base: HudState = {
    energy: 496, maxEnergy: 496, shield: 0, score: 12340, cannonPower: 0, special: 1, specialAmmo: ammo, specialArmed: false,
    missionName: "Fastoche", language: "fr", messages: [], tick: 3, paused: false,
    radar: {
      playerX: 20000, playerZ: 20000, playerYaw: 64,
      blips: [{ x: 20500, z: 20300, kind: 0x1001 }, { x: 19400, z: 20100, kind: 0x41 }, { x: 20000, z: 21500, kind: 0x7 }, { x: 90000, z: 0, kind: 0x1001 }],
    },
    crosshair: { yellow: { x: 160, y: 140, frame: 3 }, red: { x: 160, y: 140, frame: 3 } },
  };

  it("dessine un HUD fixe avec une somme de contrôle stable", () => {
    const fb = new Uint8Array(SIZE);
    make().draw(fb, base);
    expect(hash(fb)).toBe("1a8fd8e74e60a13940325b09c66e1b5c4d098b68");
  });

  it("est déterministe et ne touche que les zones du HUD", () => {
    const a = new Uint8Array(SIZE);
    const b = new Uint8Array(SIZE);
    make().draw(a, base);
    make().draw(b, base);
    expect(hash(a)).toBe(hash(b));
    // Milieu de l'écran (hors viseur, messages) : rien. Bas droit sous le score aussi.
    expect(a.subarray(200 * SCREEN_WIDTH + 100, 200 * SCREEN_WIDTH + 220).every((v) => v === 0)).toBe(true);
  });

  it("la jauge change avec l'énergie et le bloc 503", () => {
    const gaugeAt = (energy: number) => {
      const fb = new Uint8Array(SIZE);
      make().draw(fb, { ...base, energy, missionName: "" });
      return hash(gaugeBox(fb));
    };
    const hashes = new Set([0, 200, 496, 700, 992].map(gaugeAt));
    expect(hashes.size).toBe(5);
  });

  it("sous 100 d'énergie, la jauge disparaît 12 ticks sur 32", () => {
    const hud = make();
    const at = (tick: number) => {
      const fb = new Uint8Array(SIZE);
      hud.draw(fb, { ...base, energy: 50, tick, missionName: "" });
      return gaugeBox(fb).some((v) => v !== 0);
    };
    expect(at(0) && at(19)).toBe(true);
    expect(at(20) || at(31)).toBe(false);
  });

  it("l'image de la jauge avance d'un cran tous les 2 ticks vers sa cible", () => {
    const hud = make();
    const frameAt = (tick: number, energy: number) => {
      const fb = new Uint8Array(SIZE);
      hud.draw(fb, { ...base, energy, tick, missionName: "", crosshair: undefined });
      return hash(gaugeBox(fb));
    };
    const start = frameAt(0, 496);
    const one = frameAt(1, 992);
    const two = frameAt(2, 992);
    const four = frameAt(4, 992);
    expect(one).toBe(start);
    expect(new Set([start, two, four]).size).toBe(3);
  });

  it("n'écrit jamais hors de l'image avec des valeurs extrêmes", () => {
    const guard = 4096;
    const buffer = new Uint8Array(SIZE + guard).fill(0xaa);
    const fb = buffer.subarray(0, SIZE);
    fb.fill(0);
    const extreme: HudState = {
      ...base,
      energy: -1e9, score: 1e15, special: 19, specialAmmo: Array(20).fill(1e9), tick: 1e9,
      missionName: "X".repeat(500), messages: [{ textTable: 100, textId: 3, ticksLeft: 5 }, { textTable: 99999, textId: 1, ticksLeft: 5 }],
      radar: {
        playerX: -1e9, playerZ: 1e9, playerYaw: -12345,
        blips: Array.from({ length: 50 }, (_, i) => ({ x: i * 1e8 - 1e9, z: -i * 1e8, kind: 0x1001 })),
        objectives: [{ x: -1e7, z: 1e7, current: true }],
      },
      crosshair: { yellow: { x: -1e6, y: 1e6, frame: 99 }, red: { x: 1e6, y: -1e6, frame: -7 } },
      paused: true,
    };
    const hud = make();
    hud.draw(fb, extreme);
    hud.draw(fb, { ...extreme, tick: extreme.tick + 5, energy: 1e9, crosshair: { yellow: { x: 3, y: 2, frame: 0 }, red: null } });
    expect(buffer.subarray(SIZE).every((v) => v === 0xaa)).toBe(true);
  });

  it("un viseur au bord gauche ne déborde pas sur le bord droit", () => {
    const fb = new Uint8Array(SIZE);
    make().draw(fb, { ...base, crosshair: { yellow: { x: 2, y: 200, frame: 3 }, red: { x: 2, y: 200, frame: 3 } } });
    for (let y = 170; y < 230; y++) expect(fb.subarray(y * SCREEN_WIDTH + 300, y * SCREEN_WIDTH + 320).every((v) => v === 0)).toBe(true);
  });

  it("choisit la langue des chaînes (nom d'arme, pause)", () => {
    const fr = new Uint8Array(SIZE);
    const en = new Uint8Array(SIZE);
    make().draw(fr, { ...base, language: "fr", paused: true });
    make().draw(en, { ...base, language: "en", paused: true });
    expect(hash(fr)).not.toBe(hash(en));
  });
});
