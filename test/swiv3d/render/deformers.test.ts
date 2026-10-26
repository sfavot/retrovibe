import { describe, expect, it } from "vitest";
import { parseBd } from "../../../src/games/swiv3d/data/bd";
import { parseGlobal } from "../../../src/games/swiv3d/data/global";
import { parseLevel } from "../../../src/games/swiv3d/data/level";
import { listModels, parseModel } from "../../../src/games/swiv3d/data/model";
import { createRenderAssets } from "../../../src/games/swiv3d/render/assets";
import { applyDeformers, type DeformedVertex } from "../../../src/games/swiv3d/render/deformers";
import { createRenderer } from "../../../src/games/swiv3d/render/renderer";
import { placeLevelObjects } from "../../../src/games/swiv3d/render/static-scene";
import { COS, SIN } from "../../../src/games/swiv3d/render/tables";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type RenderDeformer, type RenderView } from "../../../src/games/swiv3d/render/view";
import { hasOriginalFiles, readOriginal } from "../helpers";

const vertex = (x: number, y: number, z: number, light = 50, colour = 7): DeformedVertex => ({ x, y, z, light, colour });
const node = (type: number, life: number, x = 0, y = 0, z = 0): RenderDeformer => ({ x, y, z, life, type });

describe("gm_deformers_apply (`004232ac`)", () => {
  it("onde de choc : abaisse le sommet de sin(u) · durée / 32 et ajoute sin(u / 2) à la lumière", () => {
    // durée 20 : u = (dx² + dz²) >> 9 = 102 400 >> 9 = 200
    const p = vertex(320, 0, 0);
    applyDeformers([node(0, 20)], p);
    expect(SIN[200]).toBe(162);
    expect(p.y).toBe(-((162 * 20) >> 5));
    expect(p.light).toBe(50 + SIN[100]!);
    expect(p.colour).toBe(7);
    // durée 40 : décalage de (40 - 20) · 64 = 1 280, hors de ]0, 512[ : rien
    const q = vertex(320, 0, 0);
    applyDeformers([node(0, 40)], q);
    expect(q).toEqual(vertex(320, 0, 0));
  });

  it("dôme : relève le sommet à 2 sin(k) - 300 + y du nœud (seul dx compte), plein feu et couleur 0", () => {
    // durée 30, dx = 0 : k = 128, sin = 256 → 512 - 300 + 100 = 312, quel que soit dz
    const p = vertex(0, 50, 5000);
    applyDeformers([node(1, 30, 0, 100, 0)], p);
    expect(p).toEqual(vertex(0, 312, 5000, 1000, 0));
    // déjà plus haut : inchangé
    const q = vertex(0, 400, 0);
    applyDeformers([node(1, 30, 0, 100, 0)], q);
    expect(q).toEqual(vertex(0, 400, 0));
  });

  it("anneau lumineux : n'ajoute que de la lumière, sin(u) · durée / 32", () => {
    // durée 25 : u = 409 600 >> 11 = 200
    const p = vertex(640, 10, 0);
    applyDeformers([node(2, 25)], p);
    expect(p).toEqual(vertex(640, 10, 0, 50 + ((SIN[200]! * 25) >> 5), 7));
    const far = vertex(1024, 10, 0); // u = 512 : hors plage
    applyDeformers([node(2, 25)], far);
    expect(far.light).toBe(50);
  });

  it("applique les nœuds dans l'ordre de la liste (le dôme écrase l'onde qui le précède, pas celle qui le suit)", () => {
    const wave = node(0, 20, -320, 0, 0);
    const dome = node(1, 30, 0, 100, 0);
    const a = vertex(0, 50, 0);
    applyDeformers([wave, dome], a);
    expect(a.y).toBe(312);
    const b = vertex(0, 50, 0);
    applyDeformers([dome, wave], b);
    expect(b.y).toBe(312 - ((SIN[200]! * 20) >> 5));
  });
});

const SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;

describe.skipIf(!hasOriginalFiles)("déformations dans le rendu (fichiers du jeu)", () => {
  it("déforme l'image autour du nœud, et rien en son absence ou hors de portée", () => {
    const bytes = readOriginal("TERRAN00.SLV");
    const level = parseLevel(bytes, "TERRAN00");
    const bd = parseBd(bytes, "TERRAN00");
    const models = listModels(bd).map((id) => parseModel(bd.get(id), id));
    const global = parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
    const renderer = createRenderer(createRenderAssets({ level, models, global }));
    const scene = placeLevelObjects(level, models);
    const p = scene.player!;
    const yaw = 248;
    const horizontal = (COS[30]! * 550) >> 8;
    const camera = {
      x: p.x + (SIN[yaw]! >> 1) - ((SIN[yaw]! * horizontal) >> 8),
      y: p.y + ((SIN[30]! * 550) >> 8),
      z: p.z + (COS[yaw]! >> 1) - ((COS[yaw]! * horizontal) >> 8),
      yaw,
      pitch: 30,
    };
    const view: RenderView = { camera, objects: scene.objects, sprites: [], time: 5 };
    const plain = new Uint8Array(SIZE);
    renderer.render(view, plain);
    const empty = new Uint8Array(SIZE);
    renderer.render({ ...view, deformers: [] }, empty);
    expect(empty).toEqual(plain);

    // Onde de choc à 300 unités devant le joueur, à mi-course.
    const cx = Math.trunc(p.x + (SIN[yaw]! * 300) / 256);
    const cz = Math.trunc(p.z + (COS[yaw]! * 300) / 256);
    const waved = new Uint8Array(SIZE);
    renderer.render({ ...view, deformers: [node(0, 12, cx, 0, cz)] }, waved);
    let changed = 0;
    for (let i = 0; i < SIZE; i++) if (waved[i] !== plain[i]) changed++;
    expect(changed).toBeGreaterThan(2000);
    // Une onde hors de portée (6 000 unités derrière la caméra) ne change aucun pixel.
    const away = new Uint8Array(SIZE);
    const bx = Math.trunc(p.x - (SIN[yaw]! * 6000) / 256);
    const bz = Math.trunc(p.z - (COS[yaw]! * 6000) / 256);
    renderer.render({ ...view, deformers: [node(0, 12, bx, 0, bz)] }, away);
    expect(away).toEqual(plain);
  });
});
