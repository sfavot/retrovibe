import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseBd } from "../../../src/games/swiv3d/data/bd";
import { parseGlobal } from "../../../src/games/swiv3d/data/global";
import { parseLevel } from "../../../src/games/swiv3d/data/level";
import { listModels, parseModel } from "../../../src/games/swiv3d/data/model";
import { createRenderAssets } from "../../../src/games/swiv3d/render/assets";
import { createRenderer } from "../../../src/games/swiv3d/render/renderer";
import { placeLevelObjects } from "../../../src/games/swiv3d/render/static-scene";
import { COS, SIN } from "../../../src/games/swiv3d/render/tables";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type RenderSprite, type RenderView } from "../../../src/games/swiv3d/render/view";
import { hasOriginalFiles, readOriginal } from "../helpers";

const SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;
const hash = (pixels: Uint8Array): string => createHash("sha1").update(pixels).digest("hex");

function load(name: string) {
  const bytes = readOriginal(`${name}.SLV`);
  const level = parseLevel(bytes, name);
  const bd = parseBd(bytes, name);
  const models = listModels(bd).map((id) => parseModel(bd.get(id), id));
  const global = parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
  const assets = createRenderAssets({ level, models, global });
  return { level, models, assets, renderer: createRenderer(assets), scene: placeLevelObjects(level, models) };
}

/** Caméra de poursuite du jeu autour du joueur : cible 128 unités devant lui, élévation et distance données. */
function chase(player: { x: number; y: number; z: number }, yaw: number, elevation = 30, distance = 550) {
  const horizontal = (COS[elevation]! * distance) >> 8;
  const tx = player.x + (SIN[yaw]! >> 1);
  const tz = player.z + (COS[yaw]! >> 1);
  return {
    x: tx - ((SIN[yaw]! * horizontal) >> 8),
    y: player.y + ((SIN[elevation]! * distance) >> 8),
    z: tz - ((COS[yaw]! * horizontal) >> 8),
    yaw,
    pitch: elevation,
  };
}

describe.skipIf(!hasOriginalFiles)("rendu logiciel (fichiers du jeu)", () => {
  const t00 = load("TERRAN00");
  const player = t00.scene.player!;
  const sprites: RenderSprite[] = [
    { setId: 505, frame: 0, x: player.x + 300, y: player.y, z: player.z + 300 },
    { setId: 504, frame: 10, x: player.x + 100, y: player.y + 30, z: player.z + 200, size: 23 },
  ];
  const fixed: RenderView = { camera: chase(player, 248), objects: t00.scene.objects, sprites, time: 5 };

  it("fournit la palette d'exécution du niveau (768 octets, indice 0 noir)", () => {
    expect(t00.renderer.palette.length).toBe(768);
    expect([...t00.renderer.palette.subarray(0, 3)]).toEqual([0, 0, 0]);
  });

  it("rend une vue fixe avec une somme de contrôle stable", () => {
    const fb = new Uint8Array(SIZE);
    t00.renderer.render(fixed, fb);
    expect(hash(fb)).toBe("2cd8ca23c0481397599511a3e7325b4e2b9d4d35");
  });

  it("est déterministe : deux rendus de la même vue, même image", () => {
    const a = new Uint8Array(SIZE);
    const b = new Uint8Array(SIZE);
    t00.renderer.render(fixed, a);
    t00.renderer.render({ ...fixed, camera: chase(player, 100) }, b); // un autre rendu entre les deux
    t00.renderer.render(fixed, b);
    expect(hash(a)).toBe(hash(b));
  });

  it("dessine le ciel noir, un terrain éclairé et des objets visibles", () => {
    const fb = new Uint8Array(SIZE);
    t00.renderer.render(fixed, fb);
    const used = new Set(fb);
    expect(used.size).toBeGreaterThan(30);
    expect(fb.subarray(0, 60 * SCREEN_WIDTH).includes(0)).toBe(true);
    // Le bas de l'écran est entièrement du terrain : aucun pixel de ciel.
    expect(fb.subarray(SIZE - 40 * SCREEN_WIDTH).includes(0)).toBe(false);
    const without = new Uint8Array(SIZE);
    t00.renderer.render({ ...fixed, objects: [], sprites: [] }, without);
    expect(hash(without)).not.toBe(hash(fb));
    expect(t00.renderer.stats.queued).toBe(0);
  });

  it("anime l'eau et les vagues avec le temps", () => {
    // Vue sur la rivière de TERRAN00.
    const camera = { x: 8448, y: 0, z: 24500, yaw: 256, pitch: 30 };
    camera.y = 401;
    const a = new Uint8Array(SIZE);
    const b = new Uint8Array(SIZE);
    t00.renderer.render({ camera, objects: [], sprites: [], time: 0 }, a);
    t00.renderer.render({ camera, objects: [], sprites: [], time: 9 }, b);
    expect(hash(a)).not.toBe(hash(b));
  });

  it("éclaircit le terrain sous les éclairs au sol (`005624c8`), dans la borne de lumière [15, 110]", () => {
    const pal = t00.renderer.palette;
    const luminance = (fb: Uint8Array): number => {
      let sum = 0;
      for (const i of fb) sum += pal[i * 3]! + pal[i * 3 + 1]! + pal[i * 3 + 2]!;
      return sum;
    };
    const plain = new Uint8Array(SIZE);
    t00.renderer.render({ ...fixed, objects: [], sprites: [] }, plain);
    const zero = new Uint8Array(SIZE);
    t00.renderer.render({ ...fixed, objects: [], sprites: [], groundFlash: new Int32Array(4096) }, zero);
    expect(hash(zero)).toBe(hash(plain));

    const lit = new Uint8Array(SIZE);
    t00.renderer.render({ ...fixed, objects: [], sprites: [], groundFlash: new Int32Array(4096).fill(0x40) }, lit);
    expect(luminance(lit)).toBeGreaterThan(luminance(plain));
    // Ciel intact : seuls les pixels du terrain changent.
    for (let i = 0; i < SIZE; i++) if (plain[i] === 0) expect(lit[i]).toBe(0);

    // Au-delà de la borne 110, un éclair plus fort ne change plus rien.
    const strong = new Uint8Array(SIZE);
    const stronger = new Uint8Array(SIZE);
    t00.renderer.render({ ...fixed, objects: [], sprites: [], groundFlash: new Int32Array(4096).fill(0x100) }, strong);
    t00.renderer.render({ ...fixed, objects: [], sprites: [], groundFlash: new Int32Array(4096).fill(0x4000) }, stronger);
    expect(hash(stronger)).toBe(hash(strong));
  });

  it("n'écrit jamais hors de l'image, quelle que soit la vue", () => {
    // L'image est suivie d'une zone témoin : une écriture au-delà de la dernière ligne la modifierait (les écritures avant la première
    // ligne sont exclues par la découpe à la ligne 0 ; un index négatif serait ignoré par le tableau typé, donc invisible ici).
    const GUARD = 8192;
    const big = new Uint8Array(SIZE + GUARD).fill(0xa5);
    const fb = big;
    const views: RenderView[] = [];
    for (let yaw = 0; yaw < 512; yaw += 37) {
      views.push({ ...fixed, camera: chase(player, yaw, 15 + (yaw % 85), 200 + (yaw % 600)), time: yaw });
    }
    // Cas limites : à ras du sol, à la verticale, très haut, caméra au milieu des objets, sprites collés à la caméra.
    const near = t00.scene.objects[0]!;
    const crowd = { x: near.x, y: near.y + 20, z: near.z };
    for (const pitch of [0, 100, 127, 400, -50]) views.push({ ...fixed, camera: { ...crowd, yaw: 77, pitch } });
    views.push({ ...fixed, camera: { x: player.x, y: 6000, z: player.z, yaw: 0, pitch: 127 } });
    views.push({ ...fixed, camera: { x: 50000, y: 300, z: -20000, yaw: 511, pitch: 30, roll: 0.5 } });
    const close: RenderSprite[] = [
      { setId: 504, frame: 0, x: crowd.x, y: crowd.y, z: crowd.z + 20, size: 160 },
      { setId: 505, frame: 5, x: crowd.x + 5, y: crowd.y, z: crowd.z + 10 },
    ];
    views.push({ ...fixed, camera: { ...crowd, yaw: 0, pitch: 0 }, sprites: close });
    for (const view of views) {
      t00.renderer.render(view, fb);
      expect(big.subarray(SIZE).every((v) => v === 0xa5)).toBe(true);
    }
  });

  it("rend une image en moins de 50 ms", () => {
    const fb = new Uint8Array(SIZE);
    t00.renderer.render(fixed, fb); // échauffement
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      t00.renderer.render({ ...fixed, camera: chase(player, 248 + i * 20), time: i }, fb);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[4]!).toBeLessThan(50);
  });

  it("rend les quatre autres niveaux sans erreur", () => {
    for (const name of ["TERRAN01", "TERRAN02", "TERRAN03", "DEMO"]) {
      const l = load(name);
      const p = l.scene.player!;
      const fb = new Uint8Array(SIZE);
      l.renderer.render({ camera: chase(p, p.yaw & 511), objects: l.scene.objects, sprites: [], time: 3 }, fb);
      expect(new Set(fb).size).toBeGreaterThan(20);
    }
  });
});
