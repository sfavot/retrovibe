import { describe, expect, it } from "vitest";
import { OBJECT_PROPERTY } from "../../../src/games/gk1/data/script";
import { collectGarbage } from "../../../src/games/gk1/engine/gc";
import { INFO_VIEW_INSERTED, INFO_VIEW_VISIBLE } from "../../../src/games/gk1/engine/ids";
import { SciError } from "../../../src/games/gk1/engine/memory";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../src/games/gk1/render/ids";
import { fnv1a, original } from "../data/real";
import { Scene } from "./scene";

/** Pic 350 : un fond de 320×146 et quatre avant-plans, de priorités 74, 95, 169 et 180. */
const PIC = 350;
const FOREGROUND_CEL = 3;
/** Marche de Gabriel : cels de 43×56 ancrés en bas au milieu ; la boucle 1 est le miroir de la boucle 0. */
const EGO_VIEW = 0;

describe.skipIf(!original.has)("compositeur sur les ressources réelles", () => {
  function garden(): { scene: Scene; plane: number; behind: number; mirrored: number; small: number; front: number; big: number } {
    const scene = new Scene();
    const plane = scene.plane(0, 10, 319, 199, { priority: 2, picture: PIC });
    return {
      scene,
      plane,
      behind: scene.view(plane, { view: EGO_VIEW, loop: 0, cel: 0, x: 120, y: 140 }),
      mirrored: scene.view(plane, { view: EGO_VIEW, loop: 1, cel: 0, x: 200, y: 120 }),
      small: scene.view(plane, { view: EGO_VIEW, loop: 0, cel: 2, x: 60, y: 130, scaleSignal: 1, scaleX: 64, scaleY: 64 }),
      front: scene.view(plane, { view: EGO_VIEW, loop: 2, cel: 0, x: 250, y: 140, fixPriority: 1, priority: 200 }),
      big: scene.view(plane, { view: EGO_VIEW, loop: 0, cel: 4, x: 30, y: 140, scaleSignal: 1, scaleX: 192, scaleY: 192 }),
    };
  }

  it("compose un décor, ses avant-plans et des vues : image de référence", () => {
    const { scene } = garden();
    scene.kernel("FrameOut");
    expect(scene.frameout.frameCount).toBe(1);
    expect([fnv1a(scene.frameout.screen).toString(16), fnv1a(scene.frameout.palette.screen).toString(16)]).toMatchInlineSnapshot(`
      [
        "1988b961",
        "ce328e9c",
      ]
    `);
    // Au-dessus du plan (lignes 0 à 9) : le fond noir de l'interpréteur.
    expect(scene.frameout.screen.subarray(0, 10 * SCREEN_WIDTH).every((pixel) => pixel === 0)).toBe(true);
    expect(scene.vm.warnings.size).toBe(0);
  });

  it("un avant-plan masque la vue de priorité plus petite, pas celle de priorité plus grande", () => {
    const { scene, mirrored, front } = garden();
    scene.kernel("FrameOut");
    const full = scene.frameout.screen.slice();
    const foreground = scene.frameout.cels.pic(PIC)![FOREGROUND_CEL];
    expect(foreground.priority).toBe(169);
    /** Pixels changés par le retrait de `object`, répartis selon que l'avant-plan y est opaque ou non. */
    const removed = (object: number): { masked: number; open: number } => {
      scene.kernelOn("DeleteScreenItem", object);
      scene.kernel("FrameOut");
      const count = { masked: 0, open: 0 };
      for (let y = 0; y < SCREEN_HEIGHT; y++) {
        for (let x = 0; x < SCREEN_WIDTH; x++) {
          if (scene.pixel(x, y) === full[y * SCREEN_WIDTH + x]) continue;
          const fx = x - foreground.x;
          const fy = y - 10 - foreground.y;
          const opaque = fx >= 0 && fy >= 0 && fx < foreground.width && fy < foreground.height && foreground.pixels[fy * foreground.width + fx] !== foreground.skipColor;
          count[opaque ? "masked" : "open"]++;
        }
      }
      scene.kernelOn("AddScreenItem", object);
      return count;
    };
    // Priorité 120 (son y) : visible seulement là où l'avant-plan de priorité 169 est transparent.
    const low = removed(mirrored);
    expect(low.masked).toBe(0);
    expect(low.open).toBeGreaterThan(300);
    // Priorité fixe 200 : dessinée par-dessus l'avant-plan.
    expect(removed(front).masked).toBeGreaterThan(300);
  });

  it("SetNowSeen : rectangle dans le plan, ancrage en bas au milieu, miroir, échelle", () => {
    const { scene, behind, mirrored, small, big } = garden();
    // 43×56, ancrage (19, 55) : x − 19 … x + 23, y − 55 … y.
    expect(scene.nowSeen(behind)).toEqual([101, 85, 143, 140]);
    // Boucle miroir : ancrage x = 43 − 19 − 1 = 23.
    expect(scene.nowSeen(mirrored)).toEqual([177, 65, 219, 120]);
    // Moitié : 22×28, ancrage (9, 27). Une fois et demie : 64×83, ancrage (28, 82).
    expect(scene.nowSeen(small)).toEqual([51, 103, 72, 130]);
    expect(scene.nowSeen(big)).toEqual([2, 58, 65, 140]);
    // Rectangle intérieur : seule cette partie du cel compte.
    scene.set(behind, { useInsetRect: 1, inLeft: 10, inTop: 20, inRight: 19, inBottom: 29 });
    scene.kernelOn("UpdateScreenItem", behind);
    expect(scene.nowSeen(behind)).toEqual([111, 105, 120, 114]);
    // Sans élément d'écran : rien n'est écrit.
    scene.kernelOn("DeleteScreenItem", mirrored);
    expect(scene.nowSeen(mirrored)).toEqual([177, 65, 219, 120]);
    expect([...scene.vm.warnings.keys()].some((warning) => warning.startsWith("SetNowSeen"))).toBe(true);
  });

  it("OnMe : rectangle de l'élément dans le repère du plan, puis pixel non transparent", () => {
    const { scene, behind, mirrored, small } = garden();
    // Coin haut gauche du cel : dans le rectangle, mais transparent.
    expect(scene.onMe(behind, 101, 85, false)).toBe(true);
    expect(scene.onMe(behind, 101, 85, true)).toBe(false);
    expect(scene.onMe(behind, 100, 85, false)).toBe(false);
    expect(scene.onMe(behind, 143, 140, false)).toBe(true);
    expect(scene.onMe(behind, 144, 140, false)).toBe(false);
    // Le manteau, au milieu du cel.
    expect(scene.onMe(behind, 120, 115, true)).toBe(true);
    // Le cel retourné se teste retourné : mêmes réponses de part et d'autre de l'axe.
    const cel = scene.frameout.cels.viewCel(EGO_VIEW, 0, 0)!;
    for (let x = 0; x < cel.width; x += 3) {
      const opaque = cel.pixels[30 * cel.width + x] !== cel.skipColor;
      expect(scene.onMe(behind, 101 + x, 85 + 30, true)).toBe(opaque);
      expect(scene.onMe(mirrored, 219 - x, 65 + 30, true)).toBe(opaque);
    }
    // À l'échelle : le point du plan est ramené dans le cel.
    expect(scene.onMe(small, 51, 103, false)).toBe(true);
    expect(scene.onMe(small, 73, 103, false)).toBe(false);
    expect(scene.onMe(small, 61, 117, true)).toBe(scene.frameout.cels.viewCel(EGO_VIEW, 0, 2)!.pixels[28 * 43 + 20] !== cel.skipColor);
    // Un objet sans élément d'écran n'est jamais touché.
    scene.kernelOn("DeleteScreenItem", small);
    expect(scene.onMe(small, 61, 117, false)).toBe(false);
  });

  it("plans : ordre par priorité, plan caché, plan recouvert, fond transparent, suppression", () => {
    const scene = new Scene();
    const low = scene.plane(0, 0, 99, 99, { priority: 1, back: 5 });
    const high = scene.plane(50, 50, 149, 149, { priority: 3, back: 7 });
    const hidden = scene.plane(0, 0, 319, 199, { priority: -1, back: 9 });
    scene.view(hidden, { view: EGO_VIEW, x: 100, y: 100 });
    scene.kernel("FrameOut");
    expect([scene.pixel(10, 10), scene.pixel(60, 60), scene.pixel(149, 149), scene.pixel(150, 150)]).toEqual([5, 7, 7, 0]);
    expect(scene.kernel("GetHighPlanePri")).toBe(3);
    expect(scene.frameout.visiblePlanes().map((plane) => plane.object)).toEqual([low, high]);

    // Le plan caché passe devant : il recouvre tout, les deux autres ne sont plus dessinés.
    scene.set(hidden, { priority: 10 });
    scene.kernelOn("UpdatePlane", hidden);
    scene.kernel("FrameOut");
    expect(scene.frameout.visiblePlanes().map((plane) => plane.object)).toEqual([hidden]);
    expect([scene.pixel(10, 10), scene.pixel(60, 60), scene.pixel(319, 199)]).toEqual([9, 9, 9]);
    expect(scene.kernel("GetHighPlanePri")).toBe(10);

    // Transparent (picture −2) : seuls ses éléments se dessinent par-dessus les plans de dessous.
    scene.set(hidden, { picture: -2 });
    scene.kernelOn("UpdatePlane", hidden);
    scene.kernel("FrameOut");
    expect([scene.pixel(10, 10), scene.pixel(60, 60), scene.pixel(319, 199)]).toEqual([5, 7, 0]);
    expect(scene.pixel(100, 80)).not.toBe(7);

    // Un plan de priorité 10 000 ou plus est à l'interpréteur : `GetHighPlanePri` l'ignore.
    scene.set(high, { priority: 10000 });
    scene.kernelOn("UpdatePlane", high);
    expect(scene.kernel("GetHighPlanePri")).toBe(10);

    scene.kernelOn("DeletePlane", hidden);
    scene.kernelOn("DeletePlane", high);
    scene.kernel("FrameOut");
    expect([scene.pixel(10, 10), scene.pixel(60, 60), scene.pixel(100, 80)]).toEqual([5, 5, 0]);
    expect(() => scene.kernelOn("DeletePlane", hidden)).toThrow(SciError);
    expect(() => scene.kernelOn("UpdatePlane", high)).toThrow(SciError);
  });

  it("changer le pic d'un plan remplace ses cels et garde ses vues", () => {
    const { scene, plane } = garden();
    const items = (): number => scene.frameout.findPlane(plane)!.items.length;
    expect(items()).toBe(5 + 5);
    scene.set(plane, { picture: 100 });
    scene.kernelOn("UpdatePlane", plane);
    expect(items()).toBe(1 + 5);
    scene.set(plane, { picture: -1 });
    scene.kernelOn("UpdatePlane", plane);
    expect(items()).toBe(5);
    scene.set(plane, { picture: 12345 });
    scene.kernelOn("UpdatePlane", plane);
    expect(items()).toBe(5);
    expect([...scene.vm.warnings.keys()]).toEqual([expect.stringContaining("pic 12345 absent")]);
  });

  it("AddScreenItem et UpdateScreenItem baissent le bit « à redessiner », ramènent boucle et cel dans la vue et fixent la priorité", () => {
    const scene = new Scene();
    const plane = scene.plane(0, 0, 319, 199);
    const info = (object: number): number => scene.vm.memory.getObject(object)!.vars[OBJECT_PROPERTY.Info];
    const view = scene.make("View", { plane, view: EGO_VIEW, loop: 99, cel: 99, x: 50, y: 90, z: 20 });
    expect(info(view) & INFO_VIEW_VISIBLE).not.toBe(0);
    scene.kernelOn("AddScreenItem", view);
    expect(info(view) & (INFO_VIEW_VISIBLE | INFO_VIEW_INSERTED)).toBe(INFO_VIEW_INSERTED);
    const loops = scene.kernelOn("NumLoops", view);
    expect(scene.get(view, "loop")).toBe(loops - 1);
    expect(scene.get(view, "cel")).toBe(scene.kernelOn("NumCels", view) - 1);
    // Sans priorité fixe, `priority` reçoit y ; z remonte l'image sans changer la priorité.
    expect(scene.get(view, "priority")).toBe(90);
    const item = scene.frameout.locate(view)!.item;
    expect([item.y, item.z]).toEqual([70, 20]);
    scene.kernel("FrameOut");
    expect(item.priority).toBe(90);

    scene.set(view, { x: 51, loop: 0, cel: 0, fixPriority: 1, priority: 7 });
    expect(info(view) & INFO_VIEW_VISIBLE).not.toBe(0);
    scene.kernelOn("UpdateScreenItem", view);
    expect(info(view) & INFO_VIEW_VISIBLE).toBe(0);
    expect([item.x, item.loop, item.priority]).toEqual([51, 0, 7]);
    // Une propriété hors de la plage 26 à 44 ne marque pas l'objet.
    scene.set(view, { signal: 1, scaleSignal: 1 });
    expect(info(view) & INFO_VIEW_VISIBLE).toBe(0);

    // Ajouter deux fois le même objet ne crée qu'un élément ; le retirer baisse le bit « à l'écran ».
    scene.kernelOn("AddScreenItem", view);
    expect(scene.frameout.findPlane(plane)!.items).toHaveLength(1);
    scene.kernelOn("DeleteScreenItem", view);
    expect(info(view) & INFO_VIEW_INSERTED).toBe(0);
    expect(scene.frameout.findPlane(plane)!.items).toHaveLength(0);
    scene.kernelOn("DeleteScreenItem", view);
    expect(() => scene.kernelOn("UpdateScreenItem", view)).toThrow(SciError);
    expect(scene.vm.warnings.size).toBe(0);
  });

  it("à priorité et y égaux, les éléments se dessinent dans l'ordre de leur création", () => {
    const scene = new Scene();
    const plane = scene.plane(0, 0, 319, 199);
    const first = scene.view(plane, { view: EGO_VIEW, loop: 0, x: 100, y: 100 });
    scene.kernel("FrameOut");
    const alone = scene.frameout.screen.slice();
    const second = scene.view(plane, { view: EGO_VIEW, loop: 2, x: 100, y: 100 });
    scene.kernel("FrameOut");
    const both = fnv1a(scene.frameout.screen);
    expect(both).not.toBe(fnv1a(alone));
    // Relire le premier ne le fait pas passer devant.
    scene.kernelOn("UpdateScreenItem", first);
    scene.kernel("FrameOut");
    expect(fnv1a(scene.frameout.screen)).toBe(both);
    // Le second, plus haut de 1, passe derrière.
    scene.set(second, { y: 99 });
    scene.kernelOn("UpdateScreenItem", second);
    scene.kernel("FrameOut");
    expect(fnv1a(scene.frameout.screen)).not.toBe(both);
  });

  it("CelWide, CelHigh, IsHiRes, Graph, Palette", () => {
    const scene = new Scene();
    expect([scene.kernel("CelWide", EGO_VIEW, 0, 0), scene.kernel("CelHigh", EGO_VIEW, 0, 0)]).toEqual([43, 56]);
    expect([scene.kernel("CelWide", 100, 4, 0), scene.kernel("CelHigh", 100, 4, 0)]).toEqual([13, 10]);
    // Boucle et cel trop grands : les derniers.
    expect(scene.kernel("CelWide", 100, 99, 99)).toBe(13);
    expect(scene.kernel("CelWide", 12345, 0, 0)).toBe(0);
    expect(scene.kernel("CelWide")).toBe(0);
    expect([scene.kernel("IsHiRes"), scene.kernel("Graph", 1)]).toEqual([0, 256]);

    // La palette 999 est chargée au démarrage et atteint l'écran au premier FrameOut ; un fondu à 0 % noircit la plage, bornes comprises.
    const palette = scene.frameout.palette;
    scene.kernel("FrameOut");
    const lit = palette.screen.slice();
    expect(lit.some((value) => value !== 0 && value !== 255)).toBe(true);
    scene.kernel("Palette", 2, 1, 254, 0);
    scene.kernel("FrameOut");
    expect(palette.screen.subarray(3, 255 * 3).every((value) => value === 0)).toBe(true);
    expect([...palette.screen.subarray(0, 3)]).toEqual([...lit.subarray(0, 3)]);
    scene.kernel("Palette", 2, 0, 255, 100);
    scene.kernel("FrameOut");
    expect([...palette.screen]).toEqual([...lit]);
    const found = scene.kernel("Palette", 3, lit[30], lit[31], lit[32]);
    expect([...lit.subarray(3 * found, 3 * found + 3)]).toEqual([...lit.subarray(30, 33)]);
    expect([...scene.vm.warnings.keys()]).toEqual([expect.stringContaining("vue 12345")]);
  });

  it("le ramasse-miettes garde les objets des plans et des éléments d'écran", () => {
    const scene = new Scene();
    const plane = scene.plane(0, 0, 319, 199);
    const view = scene.view(plane, { view: EGO_VIEW, x: 100, y: 100 });
    expect(collectGarbage(scene.vm).clones).toBe(0);
    scene.kernelOn("DeleteScreenItem", view);
    expect(collectGarbage(scene.vm).clones).toBe(1);
    expect(scene.vm.memory.getObject(view)).toBeUndefined();
    expect(scene.vm.memory.getObject(plane)).toBeDefined();
    scene.kernelOn("DeletePlane", plane);
    expect(collectGarbage(scene.vm).clones).toBe(1);
  });
});
