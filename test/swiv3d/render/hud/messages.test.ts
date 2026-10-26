import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseBd } from "../../../../src/games/swiv3d/data/bd";
import { parseGlobal } from "../../../../src/games/swiv3d/data/global";
import { parseLevel } from "../../../../src/games/swiv3d/data/level";
import { createHud, LAYOUT, radarColorTable } from "../../../../src/games/swiv3d/render/hud";
import { TITLE_TINT } from "../../../../src/games/swiv3d/render/text3d";
import { pauseMenuLines, PAUSE_MENU_Y } from "../../../../src/games/swiv3d/render/hud/pause";
import type { HudMessage, HudState } from "../../../../src/games/swiv3d/render/hud/state";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../../src/games/swiv3d/render/view";
import { hasOriginalFiles, readOriginal } from "../../helpers";

const SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;
const hash = (pixels: Uint8Array): string => createHash("sha1").update(pixels).digest("hex");

describe("écran de pause : menu", () => {
  it("menu de pause : espaceur de 4 px, une ligne de texte, espaceur", () => {
    expect(pauseMenuLines("N'importe quelle touche")).toEqual([
      { type: "spacer", height: 4, row: 0x76 },
      { type: "choice", id: 1, text: "N'importe quelle touche" },
      { type: "spacer", height: 4, row: 0x76 },
    ]);
    expect(pauseMenuLines("a|b").filter((l) => l.type === "choice")).toHaveLength(2);
    expect(TITLE_TINT).toBe(0x400);
  });
});

describe.skipIf(!hasOriginalFiles)("HUD : messages 3D et écran de pause (fichiers du jeu)", () => {
  const global = parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
  const bytes = readOriginal("TERRAN00.SLV");
  const level = parseLevel(bytes, "TERRAN00");
  const radarColors = radarColorTable(parseBd(bytes, "TERRAN00").get(11003));
  const hudWith = (now = () => 0) => createHud({ global, blendTable: level.fadeTable, table109: level.lightTable109, colorMap: level.colorMap, radarColors }, { now });
  const base: HudState = {
    energy: 496, maxEnergy: 496, shield: 0, score: 0, cannonPower: 0, special: -1, specialAmmo: Array(20).fill(0), specialArmed: false,
    missionName: "", language: "fr", messages: [], tick: 0, paused: false, inMenu: false,
    radar: { playerX: 20000, playerZ: 20000, playerYaw: 0, blips: [] },
  };
  /**
   * Deux HUD nourris des mêmes ticks : `draw` rend l'état demandé sur le premier et, sur le second, le même état sans message ni pause.
   * `extra` est le nombre de pixels que le texte 3D ou l'écran de pause ajoutent au HUD seul.
   */
  function rig(now = () => 0) {
    const shown = hudWith(now);
    const plain = hudWith(now);
    return {
      draw(state: Partial<HudState>) {
        const fb = new Uint8Array(SIZE);
        const reference = new Uint8Array(SIZE);
        shown.draw(fb, { ...base, ...state });
        plain.draw(reference, { ...base, ...state, messages: [], paused: false });
        return { fb, extra: fb.reduce((n, v, i) => n + (v !== reference[i] ? 1 : 0), 0) };
      },
    };
  }
  /** Messages du monde : un ramassage (type 0) et « Game over ! » (type 10, figé). */
  const pickup: HudMessage = { serial: 1, textTable: 100, textId: 1, tint: 0x1000, type: 0 };
  const gameOver: HudMessage = { serial: 2, textTable: 20, textId: 10, tint: 0x1000, type: 10 };
  const gauge = (fb: Uint8Array) => fb.subarray(LAYOUT.gauge.y * SCREEN_WIDTH, (LAYOUT.gauge.y + 80) * SCREEN_WIDTH).some((v) => v !== 0);
  /** Pixels allumés dans la moitié haute de l'écran : en pause, seul le titre 3D y est dessiné. */
  const top = (fb: Uint8Array) => fb.subarray(0, 200 * SCREEN_WIDTH).reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);

  it("un message du monde devient un texte 3D qui vit 71 ticks (et non les 100 de la liste du monde)", () => {
    const r = rig();
    expect(r.draw({ tick: 0 }).extra).toBe(0);
    const visible: boolean[] = [];
    for (let tick = 1; tick <= 100; tick++) visible.push(r.draw({ tick, messages: [pickup] }).extra > 0);
    // Créé au tick 1 avec une vie de 70, décomptée à chaque tick : dernière image au tick 70, retiré au tick 71 (vie -1).
    expect(visible.slice(0, 70).filter(Boolean).length).toBeGreaterThan(40);
    expect(visible[69]).toBe(true);
    expect(visible.slice(70).some(Boolean)).toBe(false);
  });

  it("le même message n'est pas recréé à chaque image, et la trajectoire ne dépend que des ticks du monde", () => {
    const state = (tick: number): Partial<HudState> => ({ tick, messages: [gameOver] });
    const every = rig();
    let last = every.draw(state(1)).fb;
    for (let tick = 2; tick <= 40; tick++) last = every.draw(state(tick)).fb;
    // Même parcours en ne dessinant qu'un tick sur trois : « Game over ! » est au même endroit au tick 40.
    const sparse = rig();
    let other = sparse.draw(state(1)).fb;
    for (let tick = 4; tick <= 40; tick += 3) other = sparse.draw(state(tick)).fb;
    expect(hash(other.subarray(100 * SCREEN_WIDTH, 300 * SCREEN_WIDTH))).toBe(hash(last.subarray(100 * SCREEN_WIDTH, 300 * SCREEN_WIDTH)));
    expect(every.draw(state(40)).extra).toBeGreaterThan(0);
  });

  it("la pause remplace le HUD : ni jauge, ni score ; titre 3D animé et menu à Y = 260 ; la sortie le fait repartir", () => {
    let clock = 0;
    const r = rig(() => clock);
    expect(gauge(r.draw({ tick: 1 }).fb)).toBe(true);

    const first = r.draw({ tick: 2, paused: true }).fb;
    expect(gauge(first)).toBe(false);
    // Le menu : bandeau de 4 + 19 + 4 px à partir de Y = 260, centré.
    const row = (fb: Uint8Array, y: number) => fb.subarray(y * SCREEN_WIDTH, (y + 1) * SCREEN_WIDTH).filter((v) => v !== 0).length;
    expect(row(first, PAUSE_MENU_Y + 10)).toBeGreaterThan(100);
    expect(row(first, PAUSE_MENU_Y - 5)).toBe(0);
    expect(row(first, PAUSE_MENU_Y + 40)).toBe(0);

    // Le titre arrive en 31 ticks (25 ms chacun) puis tourne sur place : l'image change avec l'horloge.
    const advance = (ms: number): Uint8Array => {
      let fb = first;
      for (let t = 0; t < ms; t += 25) {
        clock += 25;
        fb = r.draw({ tick: 2, paused: true }).fb;
      }
      return fb;
    };
    const arriving = advance(400);
    const held = advance(500);
    const spun = advance(75);
    expect(new Set([hash(first), hash(arriving), hash(held), hash(spun)]).size).toBe(4);
    expect(top(held)).toBeGreaterThan(300);

    // Fermeture : le titre repart (21 ticks) et l'écran retrouve le HUD.
    const resumed = r.draw({ tick: 2 });
    expect(gauge(resumed.fb)).toBe(true);
    expect(resumed.extra).toBeGreaterThan(0);
    for (let i = 1; i <= 22; i++) r.draw({ tick: 2 + i });
    expect(r.draw({ tick: 30 }).extra).toBe(0);
  });

  it("la pause ne rejoue pas plus de 800 ms de retard", () => {
    let clock = 0;
    const r = rig(() => clock);
    const first = r.draw({ paused: true }).fb;
    clock += 60_000;
    expect(hash(r.draw({ paused: true }).fb)).toBe(hash(first));
  });

  it("un nouveau niveau (tick qui recule) vide les messages en cours", () => {
    const r = rig();
    r.draw({ tick: 500, messages: [gameOver] });
    for (let tick = 501; tick < 600; tick++) r.draw({ tick });
    expect(r.draw({ tick: 600 }).extra).toBeGreaterThan(0); // « Game over ! » reste figé tant que rien ne le libère
    expect(r.draw({ tick: 0 }).extra).toBe(0);
  });

  it("choisit la langue de l'écran de pause", () => {
    const fr = new Uint8Array(SIZE);
    const en = new Uint8Array(SIZE);
    hudWith().draw(fr, { ...base, paused: true, language: "fr" });
    hudWith().draw(en, { ...base, paused: true, language: "en" });
    expect(hash(fr)).not.toBe(hash(en));
  });
});
