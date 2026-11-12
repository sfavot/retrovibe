import { describe, expect, it } from "vitest";
import { parseBank } from "../../../src/games/fotaq/data/bank";
import { parseRoomLight } from "../../../src/games/fotaq/data/dynalum";
import { roomImageFile, roomLightFile, roomMaskFile } from "../../../src/games/fotaq/data/files";
import { decodePcx } from "../../../src/games/fotaq/data/pcx";
import { GameStage } from "../../../src/games/fotaq/engine/stage";
import { Outfit } from "../../../src/games/fotaq/engine/services";
import { FADE_TICKS, colorsForRoom, fadingDisabled } from "../../../src/games/fotaq/render/palette";
import { COMMAND_Y_POS, Ink, SCREEN_W, centerText } from "../../../src/games/fotaq/render/display";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { Player, gameData } from "../engine/test-host";

const W = SCREEN_W;

function enter(room: number, options: { cursor?: boolean } = {}) {
  const stage = new GameStage({ render: { cursor: options.cursor ?? false } });
  const player = new Player({ room, stage });
  player.settle();
  return { player, stage, engine: player.engine, bobs: stage.bobs, host: player.host };
}
type Entered = ReturnType<typeof enter>;

/** Présente une image et la rend (copie). */
function shot(e: Entered): { pixels: Uint8Array; palette: Uint8Array } {
  e.engine.render();
  const last = e.host.frames[e.host.frames.length - 1];
  return { pixels: last.pixels, palette: last.palette };
}

const pcxOf = (name: string) => decodePcx(readOriginal(name));
const roomPcx = (room: number) => pcxOf(roomImageFile(gameData().texts.roomNames[room]));

/** Part des pixels de l'écran de jeu (150 lignes) égale à ceux du décor décalé de `scroll`. */
function matchRatio(pixels: Uint8Array, backdrop: { width: number; pixels: Uint8Array }, scroll: number, rows = 150): number {
  let same = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) if (pixels[y * W + x] === backdrop.pixels[y * backdrop.width + x + scroll]) same++;
  return same / (rows * W);
}

describe.skipIf(!hasOriginalFiles)("rendu : les 126 pièces et la composition", () => {
  it("les 126 pièces se composent, avec la palette de la pièce et une image non vide", () => {
    const data = gameData();
    for (let room = 1; room <= data.jas.roomCount; room++) {
      const e = enter(room);
      const { pixels, palette } = shot(e);
      expect(pixels.length, `pièce ${room}`).toBe(64_000);
      expect(palette.length).toBe(768);
      let lit = 0;
      for (const value of pixels) if (value !== 0) lit++;
      expect(lit, `pièce ${room} : pixels non noirs`).toBeGreaterThan(2_000);
      // Le fondu d'entrée est fini : la palette montrée est celle de l'écran.
      expect(Array.from(palette), `pièce ${room} : palette`).toEqual(Array.from(e.stage.display.palette.screen));
    }
  }, 120_000);

  it("décor : l'écran reprend le décor au défilement du moteur, hors bobs ; un décor de 640 pixels défile", () => {
    for (const [room, wide] of [
      [1, false],
      [7, true],
    ] as const) {
      const e = enter(room);
      const backdrop = roomPcx(room);
      expect(backdrop.width === 640).toBe(wide);
      e.engine.horizontalScroll = 0;
      const first = shot(e).pixels.slice();
      expect(matchRatio(first, backdrop, 0), `pièce ${room}, défilement 0`).toBeGreaterThan(0.9);
      if (wide) {
        e.engine.horizontalScroll = 320;
        const second = shot(e).pixels;
        expect(matchRatio(second, backdrop, 320)).toBeGreaterThan(0.9);
        expect(matchRatio(second, backdrop, 0)).toBeLessThan(0.5);
        e.engine.horizontalScroll = 123;
        expect(matchRatio(shot(e).pixels, backdrop, 123)).toBeGreaterThan(0.9);
      }
    }
  });

  it("panneau : 150 lignes de jeu puis PANEL.PCX (320 x 40) sous la ligne de commande noire ; les cases d'inventaire ; palette 144 à 255 du panneau", () => {
    const e = enter(1);
    const { pixels, palette } = shot(e);
    const panel = pcxOf("PANEL.PCX");
    expect([panel.width, panel.height]).toEqual([320, 40]);
    for (let y = 0; y < 10; y++) for (let x = 0; x < W; x++) expect(pixels[(150 + y) * W + x], `ligne de commande ${x},${y}`).toBe(0);
    // À gauche de l'inventaire (verbes, flèches) : identique à l'image du panneau.
    for (let y = 0; y < 40; y++) for (let x = 0; x < 180; x++) expect(pixels[(160 + y) * W + x]).toBe(panel.pixels[y * 320 + x]);
    // Le panneau et l'inventaire utilisent les couleurs 144 à 255 : en dehors de Joe (144 à 159), celles du fichier du panneau.
    for (let c = 160; c < 256; c++) expect(Array.from(palette.subarray(c * 3, c * 3 + 3)), `couleur ${c}`).toEqual(Array.from(panel.palette.subarray(c * 3, c * 3 + 3)));
    // Inventaire : la batte (case 1), le journal (case 2), deux cases vides à la couleur du fond.
    const objects = parseBank(readOriginal("OBJECTS.BBK"));
    const state = e.engine.state;
    expect(state.inventory.slice(0, 2)).not.toContain(0);
    for (let slot = 0; slot < 4; slot++) {
      const item = state.inventory[slot];
      for (const [dx, dy] of [[0, 0], [5, 7], [31, 31], [16, 20]]) {
        const x = 182 + 35 * slot + dx;
        const y = 150 + 14 + dy;
        if (item === 0) expect(pixels[y * W + x], `case ${slot} vide`).toBe(Ink.BgPanel);
        else {
          const frame = objects.frame(state.items[item].frame);
          if (dx < frame.width && dy < frame.height) expect(pixels[y * W + x], `case ${slot} (${dx},${dy})`).toBe(frame.pixels[dy * frame.width + dx]);
        }
      }
    }
  });

  it("ligne de commande : texte centré, couleur d'encre, à l'ordonnée 151, sans contour", () => {
    const e = enter(1);
    const before = shot(e).pixels.slice();
    e.engine.command.line = { text: "Examiner la porte", ink: "normal" };
    const after = shot(e).pixels;
    const lit: number[] = [];
    for (let y = COMMAND_Y_POS; y < COMMAND_Y_POS + 8; y++) for (let x = 0; x < W; x++) if (after[y * W + x] !== before[y * W + x]) lit.push(x);
    expect(lit.length).toBeGreaterThan(30);
    expect(Math.min(...lit)).toBeGreaterThanOrEqual(centerText("Examiner la porte").x);
    expect(Math.min(...lit)).toBeLessThan(centerText("Examiner la porte").x + 8);
    expect(new Set(Array.from({ length: 8 * W }, (_, i) => after[COMMAND_Y_POS * W + i]).filter((v) => v !== 0))).toEqual(new Set([Ink.CmdNormal]));
    e.engine.command.line = { text: "Ouvrir", ink: "select" };
    expect(shot(e).pixels[(COMMAND_Y_POS + 1) * W + centerText("Ouvrir").x + 1]).toBeDefined();
    expect(new Set(Array.from({ length: 8 * W }, (_, i) => shot(e).pixels[COMMAND_Y_POS * W + i]).filter((v) => v !== 0))).toEqual(new Set([Ink.CmdSelect]));
  });

  it("texte au-dessus de Joe : écrit dans l'image avec la couleur donnée et un contour ; effacé par clearTexts", () => {
    const e = enter(7);
    const clean = shot(e).pixels.slice();
    e.stage.display.clearTexts(0, 199);
    e.stage.setBobText(e.engine, 0, "Où est l'été ? Çà et là", 14);
    const said = shot(e).pixels;
    const counts = new Map<number, number>();
    for (let i = 0; i < 150 * W; i++) if (said[i] !== clean[i]) counts.set(said[i], (counts.get(said[i]) ?? 0) + 1);
    expect([...counts.keys()].sort((a, b) => a - b)).toContain(14);
    expect([...counts.keys()]).toContain(Ink.OutlinedText);
    e.stage.display.clearTexts(0, 199);
    expect(Array.from(shot(e).pixels)).toEqual(Array.from(clean));
  });

  it("curseur : dessiné à la position de la souris, hotspot (1, 1), couleur 0 transparente ; `cursor: false` le laisse à l'hôte", () => {
    const e = enter(1, { cursor: true });
    e.player.move(100, 100);
    e.player.run(1);
    const withCursor = shot(e).pixels.slice();
    e.stage.display.cursorVisible = false;
    const without = shot(e).pixels.slice();
    e.stage.display.cursorVisible = true;
    const cursor = parseBank(readOriginal("CONTROL.BBK")).frame(1);
    let diff = 0;
    for (let i = 0; i < withCursor.length; i++) if (withCursor[i] !== without[i]) diff++;
    expect(diff).toBeGreaterThan(10);
    // Le coin haut gauche de l'image du curseur est à (x - 1, y - 1) ; les pixels 0 de l'image ne sont pas dessinés.
    let drawn = 0;
    for (let dy = 0; dy < cursor.height; dy++) {
      for (let dx = 0; dx < cursor.width; dx++) {
        const value = cursor.pixels[dy * cursor.width + dx];
        const where = (99 + dy) * W + 99 + dx;
        if (value !== 0) {
          expect(withCursor[where]).toBe(value);
          drawn++;
        } else expect(withCursor[where]).toBe(without[where]);
      }
    }
    expect(drawn).toBeGreaterThan(10);
    // Sans l'option, l'image présentée est celle de la scène : le curseur reste au système.
    const system = enter(1, { cursor: false });
    system.player.move(100, 100);
    system.player.run(1);
    const presented = shot(system).pixels;
    expect(Array.from(presented)).toEqual(Array.from(system.stage.display.screen.pixels));
  });

  it("plein écran : le décor prend 200 lignes sans panneau ; un décor de 150 lignes est noir dessous ; les bobs sont rognés à 150 lignes avec le panneau", () => {
    const data = gameData();
    const full = (() => {
      for (let room = 1; room <= 75; room++) if (roomPcx(room).height === 200) return room;
      throw new Error("aucune pièce de jeu de 200 lignes");
    })();
    const short = (() => {
      for (let room = 1; room <= 75; room++) if (roomPcx(room).height === 150) return room;
      throw new Error("aucune pièce de jeu de 150 lignes");
    })();
    expect(data.jas.roomCount).toBe(126);
    const tall = enter(full);
    const backdrop = roomPcx(full);
    expect(tall.stage.display.fullscreen).toBe(false);
    tall.stage.display.fullscreen = true;
    const fullShot = shot(tall).pixels;
    let same = 0;
    for (let y = 150; y < 200; y++) for (let x = 0; x < W; x++) if (fullShot[y * W + x] === backdrop.pixels[y * backdrop.width + x + tall.engine.horizontalScroll]) same++;
    expect(same / (50 * W)).toBeGreaterThan(0.9);
    // En panneau, les lignes 150 à 199 sont celles du panneau.
    tall.stage.display.fullscreen = false;
    const panelShot = shot(tall).pixels;
    expect(panelShot[170 * W + 10]).toBe(pcxOf("PANEL.PCX").pixels[10 * 320 + 10]);

    const flat = enter(short);
    for (const bob of flat.bobs.slots) bob.active = false;
    flat.stage.display.fullscreen = true;
    const flatShot = shot(flat).pixels;
    for (let y = 150; y < 200; y += 7) for (let x = 0; x < W; x += 13) expect(flatShot[y * W + x], `${short} ${x},${y}`).toBe(0);
    // Un bob sous la ligne 150 : visible en plein écran, rogné avec le panneau.
    flat.bobs.bob(0).active = true;
    flat.bobs.bob(0).curPos(100, 190);
    flat.bobs.bob(0).scale = 100;
    const joeFull = shot(flat).pixels.slice();
    expect(joeFull.slice(170 * W, 190 * W).some((v) => v !== 0)).toBe(true);
    flat.stage.display.fullscreen = false;
    const joePanel = shot(flat).pixels;
    const panel = pcxOf("PANEL.PCX");
    for (let y = 0; y < 40; y++) for (let x = 0; x < 160; x++) expect(joePanel[(160 + y) * W + x]).toBe(panel.pixels[y * 320 + x]);
  });
});

describe.skipIf(!hasOriginalFiles)("rendu : Joe (échelle, miroir, position)", () => {
  /** Pixels de l'image qui diffèrent de la même pièce sans Joe : boîte englobante et ensemble. */
  function joeDiff(room: number, setup: (e: Entered) => void) {
    const e = enter(room);
    e.engine.horizontalScroll = 0;
    e.stage.display.clearTexts(0, 199);
    // Seul Joe reste : les autres bobs le masqueraient en partie, et pas de la même façon de chaque côté.
    for (const other of e.bobs.slots) other.active = false;
    const bob = e.bobs.bob(0);
    const without = shot(e).pixels.slice();
    bob.active = true;
    setup(e);
    const withJoe = shot(e).pixels;
    const points: [number, number, number][] = [];
    for (let y = 0; y < 150; y++) for (let x = 0; x < W; x++) if (withJoe[y * W + x] !== without[y * W + x]) points.push([x, y, withJoe[y * W + x]]);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return { points, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), e };
  }

  it("Joe est dessiné à sa position : les pieds au point (x, y), centré sur x", () => {
    const { left, right, bottom, top } = joeDiff(1, (e) => {
      e.bobs.bob(0).curPos(120, 130);
      e.bobs.bob(0).scale = 100;
    });
    expect(bottom).toBeGreaterThanOrEqual(128);
    expect(bottom).toBeLessThanOrEqual(131);
    expect(130 - top).toBeGreaterThan(30);
    expect(120).toBeGreaterThan(left);
    expect(120).toBeLessThan(right);
  });

  it("à l'échelle 50 %, Joe fait la moitié de la hauteur (arrondie) et reste planté sur ses pieds", () => {
    const full = joeDiff(1, (e) => {
      e.bobs.bob(0).curPos(120, 130);
      e.bobs.bob(0).scale = 100;
    });
    const half = joeDiff(1, (e) => {
      e.bobs.bob(0).curPos(120, 130);
      e.bobs.bob(0).scale = 50;
    });
    const quarter = joeDiff(1, (e) => {
      e.bobs.bob(0).curPos(120, 130);
      e.bobs.bob(0).scale = 25;
    });
    const height = (d: { top: number; bottom: number }) => d.bottom - d.top + 1;
    expect(Math.abs(height(half) - height(full) / 2)).toBeLessThanOrEqual(3);
    expect(Math.abs(height(quarter) - height(full) / 4)).toBeLessThanOrEqual(3);
    expect(Math.abs(half.bottom - full.bottom)).toBeLessThanOrEqual(2);
    expect(Math.abs(quarter.bottom - full.bottom)).toBeLessThanOrEqual(2);
    expect(half.points.length).toBeLessThan(full.points.length * 0.45);
  });

  it("retourné, Joe est le miroir de lui-même autour de son point d'ancrage", () => {
    const normal = joeDiff(1, (e) => {
      e.bobs.bob(0).curPos(120, 130);
      e.bobs.bob(0).xflip = false;
    });
    const flipped = joeDiff(1, (e) => {
      e.bobs.bob(0).curPos(120, 130);
      e.bobs.bob(0).xflip = true;
    });
    const mirror = new Map(flipped.points.map(([x, y, v]) => [`${x},${y}`, v]));
    let matching = 0;
    for (const [x, y, v] of normal.points) if (mirror.get(`${2 * 120 - 1 - x},${y}`) === v) matching++;
    // Les points ne diffèrent que si Joe change un pixel du décor : on compare ceux qui sont dans les deux jeux.
    expect(matching / normal.points.length).toBeGreaterThan(0.95);
    expect(flipped.points.length).toBeGreaterThan(200);
  });

  it("dans un décor défilant, la position de Joe est relative au défilement", () => {
    const e = enter(7);
    e.engine.horizontalScroll = 320;
    e.bobs.bob(0).curPos(500, 130);
    e.bobs.bob(0).scale = 100;
    const a = shot(e).pixels.slice();
    e.bobs.bob(0).curPos(560, 130);
    e.engine.horizontalScroll = 380;
    const b = shot(e).pixels;
    // Même position écran : mêmes pixels de Joe (le décor derrière change).
    const joe = parseBank(readOriginal("JOE_B.BBK"));
    expect(joe.frameCount).toBeGreaterThan(0);
    let same = 0;
    for (let x = 160; x < 200; x++) for (let y = 100; y < 130; y++) if (a[y * W + x] === b[y * W + x]) same++;
    expect(same).toBeGreaterThan(40 * 30 * 0.2);
  });

  it("un point d'ancrage de 32 768 ou plus est négatif (calcul en 16 bits de ScummVM) : la baignoire de Sparky (x4b.SAM) s'affiche", () => {
    // Image 20 de x4b.SAM : 88 x 110, ancrage (65 496, 65 504), soit (-40, -32) ; CDINT la pose en (49, 0) dans la pièce 118.
    const sparky = parseBank(readOriginal("X4B.SAM")).frame(20);
    expect([sparky.hotspotX, sparky.hotspotY]).toEqual([65_496, 65_504]);
    const { left, top, right, bottom } = joeDiff(1, (e) => {
      e.bobs.frames.load("x4b.SAM", 8);
      e.bobs.frames.unpack(20, 100, 8);
      const bob = e.bobs.bob(0);
      bob.frameNum = 100;
      bob.scale = 100;
      bob.xflip = false;
      bob.curPos(49, 0);
    });
    expect(left).toBeGreaterThanOrEqual(89);
    expect(right).toBeLessThanOrEqual(89 + 88 - 1);
    expect(top).toBeGreaterThanOrEqual(32);
    expect(bottom).toBeLessThanOrEqual(32 + 110 - 1);
    expect(right - left).toBeGreaterThan(60);
  });

  it("l'ordre de dessin suit l'ordonnée des pieds : le plus bas est devant", () => {
    const e = enter(1);
    e.bobs.bob(0).active = true;
    e.bobs.bob(0).curPos(100, 120);
    e.bobs.sortBobs();
    const order = e.bobs.sorted.map((bob) => bob.y);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(shot(e).pixels.length).toBe(64_000);
  });
});

describe.skipIf(!hasOriginalFiles)("rendu : images collées, palette, lumière dynamique, fondus", () => {
  it("les images collées sont écrites dans le décor, une seule fois, dans l'ordre", () => {
    const data = gameData();
    let found = 0;
    for (let room = 1; room <= data.jas.roomCount && found < 3; room++) {
      const e = enter(room);
      const pastes = e.stage.rooms.pasteDowns;
      if (pastes.length === 0) continue;
      found++;
      shot(e);
      shot(e);
      const backdrop = e.stage.display.backdrop;
      const last = pastes[pastes.length - 1];
      const frame = parseBank(readOriginal(last.frame.bank)).frame(last.frame.image);
      let checked = 0;
      for (let dy = 0; dy < frame.height; dy++) {
        for (let dx = 0; dx < frame.width; dx++) {
          const value = frame.pixels[dy * frame.width + dx];
          const x = last.x + dx;
          const y = last.y + dy;
          if (value === 0 || x >= 640 || y >= 200) continue;
          // Un collage plus tardif peut recouvrir celui-ci : on ne teste que le dernier de la liste.
          expect(backdrop.pixels[y * 640 + x], `pièce ${room} collage en ${x},${y}`).toBe(value);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
    expect(found).toBeGreaterThan(0);
  });

  it("un collage ajouté après l'entrée dans la pièce est écrit à l'image suivante", () => {
    const e = enter(1);
    shot(e);
    const bank = parseBank(readOriginal("OBJECTS.BBK"));
    e.stage.rooms.pasteDowns.push({ x: 20, y: 30, frame: { bank: "OBJECTS.BBK", image: 1 } });
    shot(e);
    const frame = bank.frame(1);
    const index = frame.pixels.findIndex((v) => v !== 0);
    expect(e.stage.display.backdrop.pixels[(30 + Math.trunc(index / frame.width)) * 640 + 20 + (index % frame.width)]).toBe(frame.pixels[index]);
  });

  it("tenues : la palette de Joe (couleurs 144 à 159) suit `setOutfit`, robe puis vêtements normaux", () => {
    const e = enter(1);
    const screen = e.stage.display.palette.screen;
    const dress = [0x00, 0x00, 0x00, 0x50, 0x50, 0x50];
    e.stage.setOutfit(e.engine, Outfit.Dress);
    expect(Array.from(shot(e).palette.subarray(144 * 3, 144 * 3 + 6))).toEqual(dress);
    expect(Array.from(screen.subarray(150 * 3, 150 * 3 + 3))).toEqual([0x30, 0x30, 0x90]);
    e.stage.setOutfit(e.engine, Outfit.Normal);
    expect(Array.from(shot(e).palette.subarray(145 * 3, 145 * 3 + 3))).toEqual([0x60, 0x60, 0x60]);
    e.stage.setOutfit(e.engine, Outfit.Underwear);
    expect(Array.from(shot(e).palette.subarray(145 * 3, 145 * 3 + 3))).toEqual([0x60, 0x60, 0x60]);
  });

  it("lumière dynamique : la palette de Joe suit sa position selon le masque et la table de la pièce", () => {
    const data = gameData();
    let tested = 0;
    for (let room = 1; room <= 75 && tested < 4; room++) {
      const name = data.texts.roomNames[room];
      let mask: Uint8Array;
      let table: Uint8Array;
      try {
        mask = readOriginal(roomMaskFile(name));
        table = readOriginal(roomLightFile(name));
      } catch {
        continue;
      }
      const light = parseRoomLight(mask, table);
      const e = enter(room);
      expect(e.stage.display.palette.hasLight, `pièce ${room}`).toBe(true);
      const roomPalette = e.stage.display.palette.room;
      // Deux positions de Joe dont la ligne de la table diffère.
      const rows = new Set<number>();
      const positions: [number, number, number][] = [];
      for (let y = 0; y < 150 && positions.length < 2; y += 8) {
        for (let x = 0; x < e.stage.backdropWidth && positions.length < 2; x += 8) {
          const row = light.mask[Math.trunc(y / 4) * 160 + Math.trunc(x / 4)];
          if (row < 8 && !rows.has(row)) {
            rows.add(row);
            positions.push([x, y, row]);
          }
        }
      }
      for (const [x, y, row] of positions) {
        e.bobs.bob(0).curPos(x, y);
        e.stage.frame(e.engine);
        const { palette } = shot(e);
        for (let c = 144; c < 160; c++) {
          for (let k = 0; k < 3; k++) {
            const expected = Math.min(255, Math.max(0, roomPalette[c * 3 + k] + new Int8Array(table.buffer, table.byteOffset, 24)[row * 3 + k] * 4));
            expect(palette[c * 3 + k], `pièce ${room}, Joe en ${x},${y}, couleur ${c}`).toBe(expected);
          }
        }
      }
      tested++;
    }
    expect(tested).toBeGreaterThan(0);
  }, 60_000);

  it("couleurs qui tournent : la palette de la pièce 25 change à chaque image, celle de la pièce 1 non", () => {
    const e = enter(25);
    const before = shot(e).palette.slice();
    e.stage.frame(e.engine);
    const after = shot(e).palette.slice();
    expect(Array.from(after.subarray(116 * 3, 124 * 3))).not.toEqual(Array.from(before.subarray(116 * 3, 124 * 3)));
    expect(Array.from(after.subarray(0, 100 * 3))).toEqual(Array.from(before.subarray(0, 100 * 3)));
    const still = enter(1);
    const a = shot(still).palette.slice();
    still.stage.frame(still.engine);
    still.stage.frame(still.engine);
    expect(Array.from(shot(still).palette.subarray(0, 144 * 3))).toEqual(Array.from(a.subarray(0, 144 * 3)));
  });

  it("fondu de sortie : l'image reste figée (même table d'images vidée) et la palette descend à zéro en FADE_TICKS images", () => {
    const e = enter(1);
    const picture = shot(e);
    const fullPalette = picture.palette.slice();
    e.stage.eraseRoom();
    expect(e.stage.display.frozen).toBe(true);
    expect(e.bobs.frames.highestFrame).toBeLessThan(38); // la table d'images de la pièce est vide (comme dans ScummVM, avant le fondu)
    expect(Array.from(shot(e).pixels)).toEqual(Array.from(picture.pixels));
    e.engine.run(e.stage.fadeOut(e.engine));
    const levels: number[] = [];
    let ticks = 0;
    while (e.engine.busy) {
      e.player.run(1);
      ticks++;
      levels.push(shot(e).palette[100 * 3]);
    }
    expect(ticks).toBe(FADE_TICKS);
    expect(levels[0]).toBeLessThan(fullPalette[100 * 3]);
    expect(levels[levels.length - 1]).toBe(0);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(Array.from(shot(e).pixels)).toEqual(Array.from(picture.pixels));
    // Les 32 dernières couleurs (texte du panneau) ne sont pas dans le fondu.
    expect(Array.from(shot(e).palette.subarray(230 * 3, 256 * 3))).toEqual(Array.from(fullPalette.subarray(230 * 3, 256 * 3)));
  });

  it("changer de pièce : fondu de sortie, nouveau décor sous une palette noire, fondu d'entrée ; l'image est dégelée", () => {
    const e = enter(1);
    const first = shot(e);
    e.engine.state.newRoom = 7;
    e.engine.state.room = 7;
    e.player.run(1);
    let sawBlack = false;
    let sawNew = false;
    for (let i = 0; i < 40 && (e.engine.busy || e.engine.state.newRoom !== 0); i++) {
      const frame = shot(e);
      if (frame.palette.subarray(0, 224 * 3).every((v) => v === 0)) {
        sawBlack = true;
        if (e.stage.display.bdWidth === 640) sawNew = true;
      }
      e.player.run(1);
    }
    expect(sawBlack).toBe(true);
    expect(sawNew).toBe(true);
    const done = shot(e);
    expect(e.stage.display.bdWidth).toBe(640);
    expect(e.stage.display.frozen).toBe(false);
    expect(Array.from(done.pixels)).not.toEqual(Array.from(first.pixels));
    expect(Array.from(done.palette.subarray(0, 100 * 3))).not.toEqual(Array.from(first.palette.subarray(0, 100 * 3)));
  });

  it("fondu d'entrée : FADE_TICKS images, de noir à la palette de la pièce ; aucun fondu dans les pièces d'introduction", () => {
    const e = enter(1);
    e.stage.eraseRoom();
    e.engine.run(e.stage.fadeOut(e.engine));
    while (e.engine.busy) e.player.run(1);
    e.stage.setupRoom(e.engine, 1, 1, false, []);
    expect(e.stage.display.palette.shown.subarray(0, 224 * 3).every((v) => v === 0)).toBe(true);
    e.engine.run(e.stage.fadeIn(e.engine));
    const seen: number[] = [];
    let ticks = 0;
    while (e.engine.busy) {
      e.player.run(1);
      ticks++;
      seen.push(shot(e).palette[100 * 3]);
    }
    expect(ticks).toBe(FADE_TICKS);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(e.stage.display.palette.room[100 * 3]);

    for (const room of [91, 116]) {
      expect(fadingDisabled(room)).toBe(true);
      const intro = enter(room);
      intro.stage.eraseRoom();
      intro.engine.run(intro.stage.fadeOut(intro.engine));
      expect(intro.engine.busy).toBe(false);
      expect(shot(intro).palette.subarray(0, colorsForRoom(room) * 3).every((v) => v === 0)).toBe(true);
    }
  });

  it("le panneau est reprenable tel quel : `PANEL.PCX` décodé une seule fois (la lecture des banques est mise en cache)", () => {
    const reads: string[] = [];
    const stage = new GameStage();
    const player = new Player({ room: 1, stage });
    const original = player.host.readFile.bind(player.host);
    player.host.readFile = (name: string) => {
      reads.push(name.toUpperCase());
      return original(name);
    };
    player.settle();
    player.engine.render();
    const afterFirst = reads.length;
    player.engine.render();
    player.engine.render();
    expect(reads.length).toBe(afterFirst);
    expect(reads.filter((n) => n === "PANEL.PCX").length).toBe(1);
  });
});
