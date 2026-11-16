import { describe, expect, it } from "vitest";
import { collectGarbage } from "../../../src/games/gk1/engine/gc";
import type { Reg } from "../../../src/games/gk1/engine/memory";
import { captureGame, restoreGame } from "../../../src/games/gk1/engine/save";
import { RunStatus } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { ShowStyle } from "../../../src/games/gk1/render/ids";
import { CelKind } from "../../../src/games/gk1/render/screen-item";
import { fnv1a, original } from "../data/real";
import { Scene } from "./scene";

const LOGO_PIC = 50;
const TITLE_PIC = 100;
/** Curseur de l'écran titre (`SetCursor(100, 4, 0)` dans les scripts). */
const CURSOR_VIEW = [100, 4, 0] as const;

/** Scène dont le plan montre le logo de Sierra, palette de l'écran à 100 %. */
function logoScene(): { scene: Scene; plane: Reg; full: Uint8Array } {
  const scene = new Scene();
  const plane = scene.plane(0, 0, 319, 199, { picture: LOGO_PIC });
  scene.frameout.frameOut();
  return { scene, plane, full: scene.frameout.palette.screen.slice() };
}

/** `SetShowStyle(type, plan, secondes, fond, priorité, animer, image de référence, étapes)`. */
function showStyle(scene: Scene, type: number, plane: Reg, back: number, options: { seconds?: number; animate?: number; divisions?: number } = {}): void {
  const args = [type, plane, options.seconds ?? 1, back & 0xffff, 200, options.animate ?? 0, 0, options.divisions ?? 20];
  scene.vm.kernel.call(scene.vm, scene.vm.kernel.indexOf("SetShowStyle"), Uint32Array.from(args));
}

/** Joue un `FrameOut` jusqu'à ce qu'il revienne ; rend, pour chaque tick, le rouge de la couleur `probe` à l'écran. */
function frameOutTicks(scene: Scene, sample: () => number): number[] {
  const samples: number[] = [];
  scene.kernel("FrameOut");
  samples.push(sample());
  for (;;) {
    scene.vm.ticks++;
    const result = scene.vm.run();
    if (result.status === RunStatus.Finished) return samples;
    expect(result).toEqual({ status: RunStatus.Suspended, reason: "FrameOut" });
    samples.push(sample());
  }
}

describe.skipIf(!original.has)("SetShowStyle : fondus", () => {
  it("fondu d'entrée : vingt étapes de trois ticks, de 0 à 100 %, pendant lesquelles FrameOut ne revient pas", () => {
    const { scene, plane, full } = logoScene();
    const { frameout } = scene;
    // Couleur la plus claire du logo : son rouge à l'écran donne le pourcentage du fondu.
    let probe = 0;
    for (let i = 0; i < 255; i++) if (full[3 * i] > full[3 * probe]) probe = i;
    const checksums: string[] = [];
    showStyle(scene, ShowStyle.FadeIn, plane, -1);
    expect(frameout.transitions.showStyles).toHaveLength(1);
    const reds = frameOutTicks(scene, () => {
      checksums.push(fnv1a(frameout.palette.screen).toString(16));
      return frameout.palette.screen[3 * probe];
    });
    // Étape n : n × 100 / 19 %, division entière ; chaque étape dure 3 ticks ; un dernier passage constate la fin.
    const expected = Array.from({ length: 20 }, (_, step) => Math.trunc((full[3 * probe] * Math.trunc((step * 100) / 19)) / 100));
    expect(reds).toEqual([...expected.flatMap((red) => [red, red, red]), full[3 * probe]]);
    expect(reds).toHaveLength(61);
    expect(frameout.transitions.showStyles).toHaveLength(0);
    expect(frameout.palette.screen).toEqual(full);
    // Étape 10 (52 %) : palette de référence, calculée ici et figée par sa somme de contrôle.
    const step10 = full.map((value, index) => (index < 765 ? Math.trunc((value * 52) / 100) : 255));
    expect(checksums[30]).toBe(fnv1a(step10).toString(16));
    expect(checksums[30]).toMatchInlineSnapshot(`"f1529b8"`);
    // L'image, elle, ne change pas pendant le fondu : seule la palette bouge.
    expect(fnv1a(frameout.screen).toString(16)).toMatchInlineSnapshot(`"6c15d166"`);
  });

  it("fondu de sortie : reste en place à 0 %, puis est réutilisé par le fondu d'entrée suivant", () => {
    const { scene, plane, full } = logoScene();
    const { frameout } = scene;
    const lit = full.findIndex((value) => value > 100);
    showStyle(scene, ShowStyle.FadeOut, plane, 0);
    const reds = frameOutTicks(scene, () => frameout.palette.screen[lit]);
    expect([reds[0], reds[reds.length - 1], reds.length]).toEqual([full[lit], 0, 61]);
    expect([...reds].sort((a, b) => b - a)).toEqual(reds);
    expect(frameout.transitions.showStyles).toMatchObject([{ type: ShowStyle.FadeOut, processed: false, currentStep: 20, fadeUp: false, color: 0 }]);
    // Tant qu'il est là, chaque FrameOut compose une image noire et revient tout de suite.
    expect(frameOutTicks(scene, () => frameout.palette.screen[lit])).toEqual([0]);
    expect(collectGarbage(scene.vm).clones).toBe(0);

    showStyle(scene, ShowStyle.FadeIn, plane, -1);
    expect(frameout.transitions.showStyles).toMatchObject([{ type: ShowStyle.FadeIn, currentStep: 0, fadeUp: true }]);
    const back = frameOutTicks(scene, () => frameout.palette.screen[lit]);
    expect([back[0], back[back.length - 1]]).toEqual([0, full[lit]]);
    expect(frameout.transitions.showStyles).toHaveLength(0);
  });

  it("durée et nombre d'étapes ; type 0 ; fondu animé ; types non portés", () => {
    const { scene, plane, full } = logoScene();
    const { frameout, vm } = scene;
    const lit = full.findIndex((value) => value > 100);
    // 2 secondes en 5 étapes : 24 ticks par étape, pourcentages 0, 25, 50, 75, 100.
    showStyle(scene, ShowStyle.FadeIn, plane, -1, { seconds: 2, divisions: 5 });
    const reds = frameOutTicks(scene, () => frameout.palette.screen[lit]);
    expect(reds).toHaveLength(5 * 24 + 1);
    expect([0, 24, 48, 72, 96].map((tick) => reds[tick])).toEqual([0, 25, 50, 75, 100].map((percent) => Math.trunc((full[lit] * percent) / 100)));

    // Type 0 : retire la transition du plan sans toucher à la palette.
    showStyle(scene, ShowStyle.FadeOut, plane, 0);
    showStyle(scene, ShowStyle.None, plane, -1);
    expect(frameout.transitions.showStyles).toHaveLength(0);

    // Animé : FrameOut revient à chaque image, la transition avance quand son heure est passée.
    showStyle(scene, ShowStyle.FadeOut, plane, 0, { animate: 1, divisions: 3 });
    const steps: number[] = [];
    for (let tick = 0; tick < 50; tick++) {
      expect(frameOutTicks(scene, () => frameout.palette.screen[lit])).toHaveLength(1);
      steps.push(frameout.transitions.showStyles[0].currentStep);
    }
    expect([steps[0], steps[1], steps[21], steps[41], steps[49]]).toEqual([0, 1, 2, 3, 3]);
    expect(frameout.palette.screen[lit]).toBe(0);

    // Volets, iris, dissolutions : jamais demandés par le jeu (`script-usage.test.ts`), remplacés par une coupe, avec un avertissement.
    showStyle(scene, ShowStyle.IrisIn, plane, -1);
    expect(frameOutTicks(scene, () => frameout.palette.screen[lit])).toEqual([full[lit]]);
    expect(frameout.transitions.showStyles).toHaveLength(0);
    showStyle(scene, 15, plane, -1);
    expect([...vm.warnings.keys()]).toEqual(["SetShowStyle : transition 10 jamais demandée par le jeu, non portée : coupe franche", "SetShowStyle : type 15 inconnu"]);
  });
});

describe.skipIf(!original.has)("SetShowStyle : dissolution (type 12, pièce 471)", () => {
  /** Priorité du bitmap de dissolution (propriété `priority` de `Styler`). */
  const STYLER_PRIORITY = 200;
  const PLANE_PIXELS = 320 * 200;
  /** Pixels par étape : (pixels + étapes) / étapes, pour 20 étapes. */
  const PER_STEP = Math.trunc((PLANE_PIXELS + 20) / 20);
  /** Couleur de fond des essais « vers une couleur ». */
  const BACK = 251;

  /** Le plan du logo passe au pic du titre, comme `Plane::drawPic` : `UpdatePlane` puis `SetShowStyle(12, …)`. */
  function dissolveScene(back = -1): { scene: Scene; plane: Reg; old: Uint8Array; bitmap: () => Uint8Array | undefined } {
    const { scene, plane } = logoScene();
    const old = scene.frameout.screen.slice();
    // Le logo n'a pas la couleur de fond des essais : chaque pixel écrit se voit.
    expect(old.includes(BACK)).toBe(false);
    scene.set(plane, { picture: TITLE_PIC });
    scene.kernelOn("UpdatePlane", plane);
    showStyle(scene, ShowStyle.Dissolve, plane, back);
    const bitmap = () => scene.frameout.capturePixels(scene.frameout.transitions.showStyles[0]?.bitmap ?? 0);
    return { scene, plane, old, bitmap };
  }

  function titleScreen(): Uint8Array {
    const direct = new Scene();
    direct.plane(0, 0, 319, 199, { picture: TITLE_PIC });
    direct.frameout.frameOut();
    return direct.frameout.screen;
  }

  it("l'ancienne image, copiée sur le plan, noircit pixel par pixel en vingt étapes, puis le bitmap part et le nouveau pic apparaît", () => {
    const { scene, plane, old, bitmap } = dissolveScene();
    const { frameout, vm } = scene;
    // Le bitmap : l'image composée avant l'appel, posée sur le plan à la priorité du `Styler`.
    expect(bitmap()).toEqual(old);
    const item = frameout.findPlane(plane)!.items.find((candidate) => candidate.kind === CelKind.Bitmap)!;
    expect([item.object, item.x, item.y, item.priority, item.fixedPriority]).toEqual([0, 0, 0, STYLER_PRIORITY, true]);
    expect(vm.memory.bitmaps.size).toBe(1);

    const changed: number[] = [];
    const checksums: string[] = [];
    frameOutTicks(scene, () => {
      const pixels = bitmap();
      changed.push(pixels ? pixels.reduce((count, pixel, index) => count + (pixel !== old[index] ? 1 : 0), 0) : -1);
      checksums.push(fnv1a(frameout.screen).toString(16));
      // Tant que le bitmap est là, l'écran le montre tel quel : le nouveau pic reste caché dessous.
      if (pixels) expect(fnv1a(frameout.screen)).toBe(fnv1a(pixels));
      return 0;
    });
    // Vingt étapes de trois ticks, puis le passage qui constate la fin et retire le bitmap.
    expect(changed).toHaveLength(61);
    expect(changed[60]).toBe(-1);
    const steps = changed.filter((_, tick) => tick % 3 === 0).slice(0, 20);
    const blackAlready = old.reduce((count, pixel) => count + (pixel === 0 ? 1 : 0), 0);
    // Chaque étape noircit 3 201 pixels distincts (moins ceux qui étaient déjà noirs) ; la dernière remplit le reste.
    for (let step = 0; step < 19; step++) {
      expect(steps[step]).toBeLessThanOrEqual((step + 1) * PER_STEP);
      expect(steps[step]).toBeGreaterThan(step === 0 ? 0 : steps[step - 1]);
    }
    expect(steps[19]).toBe(PLANE_PIXELS - blackAlready);
    expect(changed.slice(0, 60)).toEqual(steps.flatMap((count) => [count, count, count]));
    // Étapes 1, 10 et 20 (toute noire), figées par leur somme de contrôle.
    expect([checksums[0], checksums[27], checksums[57]]).toMatchInlineSnapshot(`
      [
        "6872818a",
        "ce8e91cb",
        "38c165c5",
      ]
    `);
    expect(checksums[57]).toBe(fnv1a(new Uint8Array(PLANE_PIXELS)).toString(16));

    // Fin : plus de transition, plus de bitmap ni d'élément, et le nouveau pic à l'écran.
    expect(frameout.transitions.showStyles).toHaveLength(0);
    expect(vm.memory.bitmaps.size).toBe(0);
    expect(frameout.findPlane(plane)!.items.some((candidate) => candidate.kind === CelKind.Bitmap)).toBe(false);
    expect(fnv1a(frameout.screen)).toBe(fnv1a(titleScreen()));
    expect(vm.warnings.size).toBe(0);
  });

  it("l'ordre des pixels est celui du registre à décalage : 53 427 d'abord, chaque pixel une seule fois", () => {
    const { scene, old, bitmap } = dissolveScene(BACK);
    scene.kernel("FrameOut");
    const first = bitmap()!;
    const written = [...first.keys()].filter((index) => first[index] !== old[index]);
    expect(written).toHaveLength(PER_STEP);
    // 53 427 ; impair : (i >> 1) ^ 0xB400 ; pair : i >> 1 ; les termes au-delà du bitmap sont sautés.
    const expected: number[] = [];
    for (let index = 53427; expected.length < PER_STEP; ) {
      expected.push(index);
      do index = index & 1 ? (index >> 1) ^ 0xb400 : index >> 1;
      while (index >= PLANE_PIXELS);
    }
    expect(written).toEqual(expected.sort((a, b) => a - b));
  });

  it("vers une couleur : reste en place, bitmap plein, à l'abri du ramasse-miettes ; réutilisée ou retirée par l'appel suivant", () => {
    const { scene, plane, bitmap } = dissolveScene(BACK);
    const { frameout, vm } = scene;
    expect(frameOutTicks(scene, () => 0)).toHaveLength(61);
    expect(frameout.transitions.showStyles).toMatchObject([{ type: ShowStyle.Dissolve, processed: false, currentStep: 20, fadeUp: false, color: BACK }]);
    expect(bitmap()!.every((pixel) => pixel === BACK)).toBe(true);
    expect(frameout.screen.every((pixel) => pixel === BACK)).toBe(true);
    expect(frameOutTicks(scene, () => 0)).toHaveLength(1);
    expect(collectGarbage(vm).bitmaps).toBe(0);
    expect(bitmap()).toBeDefined();

    // Même plan, même nombre d'étapes : la transition est réutilisée avec son bitmap, sans nouvelle capture, vers le noir cette fois.
    const kept = frameout.transitions.showStyles[0].bitmap;
    showStyle(scene, ShowStyle.Dissolve, plane, -1);
    expect(frameout.transitions.showStyles).toMatchObject([{ currentStep: 0, fadeUp: true, color: 0, bitmap: kept }]);
    expect(vm.memory.bitmaps.size).toBe(1);
    expect(frameOutTicks(scene, () => 0)).toHaveLength(61);
    expect(frameout.transitions.showStyles).toHaveLength(0);
    expect(vm.memory.bitmaps.size).toBe(0);
    expect(fnv1a(frameout.screen)).toBe(fnv1a(titleScreen()));

    // Type 0, autre nombre d'étapes, plan supprimé : le bitmap est libéré avec la transition.
    showStyle(scene, ShowStyle.Dissolve, plane, BACK);
    showStyle(scene, ShowStyle.None, plane, -1);
    expect([frameout.transitions.showStyles.length, vm.memory.bitmaps.size, frameout.findPlane(plane)!.items.filter((candidate) => candidate.kind === CelKind.Bitmap).length]).toEqual([0, 0, 0]);
    showStyle(scene, ShowStyle.Dissolve, plane, BACK);
    showStyle(scene, ShowStyle.Dissolve, plane, BACK, { divisions: 5 });
    expect([frameout.transitions.showStyles.length, vm.memory.bitmaps.size]).toEqual([1, 1]);
    scene.kernelOn("DeletePlane", plane);
    expect(frameOutTicks(scene, () => 0)).toHaveLength(1);
    expect([frameout.transitions.showStyles.length, vm.memory.bitmaps.size]).toEqual([0, 0]);
    expect(vm.warnings.size).toBe(0);
  });

  it("image de référence : composée avant la capture, c'est la nouvelle image qui se dissout", () => {
    const { scene, plane } = logoScene();
    scene.set(plane, { picture: TITLE_PIC });
    scene.kernelOn("UpdatePlane", plane);
    const args = [ShowStyle.Dissolve, plane, 1, 0xffff, STYLER_PRIORITY, 0, 1, 20];
    scene.vm.kernel.call(scene.vm, scene.vm.kernel.indexOf("SetShowStyle"), Uint32Array.from(args));
    expect(fnv1a(scene.frameout.capturePixels(scene.frameout.transitions.showStyles[0].bitmap)!)).toBe(fnv1a(titleScreen()));
  });

  it("une partie sauvegardée au milieu d'une dissolution reprend au même pixel", () => {
    const { scene } = dissolveScene();
    const { vm, frameout } = scene;
    scene.kernel("FrameOut");
    for (let tick = 0; tick < 25; tick++) {
      vm.ticks++;
      vm.run();
    }
    const image = structuredClone(captureGame(vm));
    const resumed = new Scene();
    restoreGame(resumed.vm, image);
    const finish = (target: Scene): string[] => {
      const checksums: string[] = [];
      for (;;) {
        target.vm.ticks++;
        const result = target.vm.run();
        checksums.push(fnv1a(frameoutOf(target.vm).screen).toString(16));
        if (result.status === RunStatus.Finished) return checksums;
      }
    };
    const expected = finish(scene);
    expect(expected).toHaveLength(36);
    // L'écran repris est noir jusqu'au premier `FrameOut` (l'image composée n'est pas sauvegardée) : ici un tick d'attente.
    expect(finish(resumed).slice(1)).toEqual(expected.slice(1));
    expect(frameoutOf(resumed.vm).transitions.showStyles).toHaveLength(0);
    expect(resumed.vm.memory.bitmaps.size).toBe(0);
    expect(fnv1a(frameoutOf(resumed.vm).screen)).toBe(fnv1a(frameout.screen));
  });
});

describe.skipIf(!original.has)("ShakeScreen, SetScroll, SetCursor", () => {
  it("ShakeScreen : l'image présentée descend de 4 pixels pendant 3 ticks, puis revient 3 ticks, par secousse", () => {
    const { scene } = logoScene();
    const { frameout, vm } = scene;
    const row = (image: Uint8Array, y: number): string => fnv1a(image.subarray(y * 320, (y + 1) * 320)).toString(16);
    const still = frameout.present().slice();
    scene.kernel("ShakeScreen", 2, 1);
    const offsets: number[] = [];
    for (;;) {
      offsets.push(frameout.shakeY);
      const shown = frameout.present();
      expect(row(shown, 100 + frameout.shakeY)).toBe(row(still, 100));
      if (frameout.shakeY > 0) expect(shown.subarray(0, 4 * 320).every((pixel) => pixel === 0)).toBe(true);
      vm.ticks++;
      const result = vm.run();
      if (result.status === RunStatus.Finished) break;
      expect(result).toEqual({ status: RunStatus.Suspended, reason: "ShakeScreen" });
    }
    expect(offsets).toEqual([4, 4, 4, 0, 0, 0, 4, 4, 4, 0, 0, 0]);
    expect([frameout.shakeX, frameout.shakeY]).toEqual([0, 0]);
    expect(frameout.present()).toEqual(still);
    // Horizontalement : décalage vers la droite.
    scene.kernel("ShakeScreen", 1, 2);
    expect([frameout.shakeX, frameout.shakeY]).toEqual([4, 0]);
    expect([...frameout.present().subarray(100 * 320 + 4, 101 * 320)]).toEqual([...still.subarray(100 * 320, 101 * 320 - 4)]);
  });

  it("SetScroll : le nouveau pic entre par la gauche, pas à pas, puis remplace l'ancien", () => {
    const { scene, plane } = logoScene();
    const { frameout, vm } = scene;
    const picItems = (): [number, number][] => frameout.findPlane(plane)!.items.filter((item) => item.kind === CelKind.Pic).map((item) => [item.picture, item.x]);
    vm.kernel.call(vm, vm.kernel.indexOf("SetScroll"), Uint32Array.of(plane, 100, 0, TITLE_PIC, 0, 0));
    const positions: number[] = [];
    for (;;) {
      positions.push(picItems().find(([picture]) => picture === TITLE_PIC)![1]);
      vm.ticks++;
      if (vm.run().status === RunStatus.Finished) break;
    }
    // Départ à −320, un pas de 100 tous les deux ticks, le dernier ramené à 0.
    expect([...new Set(positions)]).toEqual([-320, -220, -120, -20, 0]);
    expect(picItems().every(([picture]) => picture === TITLE_PIC)).toBe(true);
    expect(frameout.findPlane(plane)!.pictureId).toBe(TITLE_PIC);
    // Même image que le pic 100 posé directement.
    const direct = new Scene();
    direct.plane(0, 0, 319, 199, { picture: TITLE_PIC });
    direct.frameout.frameOut();
    expect(fnv1a(frameout.screen)).toBe(fnv1a(direct.frameout.screen));
    expect(vm.warnings.size).toBe(0);
  });

  it("SetCursor : image posée par son ancrage, cachée ou montrée, bornée à sa zone", () => {
    const { scene } = logoScene();
    const { frameout, vm } = scene;
    const cursor = frameout.cursor;
    const differing = (): number => frameout.present().reduce((count, pixel, index) => count + (pixel !== frameout.screen[index] ? 1 : 0), 0);
    vm.acc = 9;
    expect(differing()).toBe(0);
    expect(scene.kernel("SetCursor", ...CURSOR_VIEW)).toBe(9);
    scene.kernel("SetCursor", 160, 100);
    expect([cursor.x, cursor.y, cursor.visible]).toEqual([160, 100, true]);
    const cel = frameout.cels.viewCel(...CURSOR_VIEW)!;
    const opaque = cel.pixels.filter((pixel) => pixel !== cel.skipColor && pixel !== 255).length;
    expect(opaque).toBeGreaterThan(0);
    // Le curseur ne touche pas à l'image composée ; à la présentation, ses pixels opaques la recouvrent.
    const shown = frameout.present();
    let drawn = 0;
    for (let y = 0; y < cel.height; y++) {
      for (let x = 0; x < cel.width; x++) {
        const pixel = cel.pixels[y * cel.width + x];
        if (pixel === cel.skipColor || pixel === 255) continue;
        expect(shown[(100 - cel.originY + y) * 320 + 160 - cel.originX + x]).toBe(pixel);
        drawn++;
      }
    }
    expect(drawn).toBe(opaque);
    expect(differing()).toBeLessThanOrEqual(opaque);

    // SetCursor(0) s'empile, toute autre valeur montre d'un coup.
    scene.kernel("SetCursor", 0);
    scene.kernel("SetCursor", 0);
    expect([cursor.visible, differing()]).toEqual([false, 0]);
    scene.kernel("SetCursor", 1);
    expect(cursor.visible).toBe(true);

    // Zone de déplacement, bords compris ; −2 la lève.
    scene.kernel("SetCursor", 0, 0, 319, 155);
    expect(cursor.deviceMoved(400, 190)).toBe(true);
    expect([cursor.x, cursor.y]).toEqual([319, 155]);
    scene.kernel("SetCursor", 10, 20, 30, 40);
    expect([cursor.x, cursor.y]).toEqual([30, 40]);
    scene.kernel("SetCursor", -2);
    expect(cursor.deviceMoved(300, 199)).toBe(false);
    expect([cursor.x, cursor.y]).toEqual([300, 199]);
    // Au bord de l'écran, le curseur est rogné sans erreur.
    cursor.deviceMoved(0, 0);
    frameout.present();
    scene.kernel("SetCursor", 1, 2, 3, 4, 5);
    scene.kernel("SetCursor", 64000, 0, 0);
    expect([...vm.warnings.keys()]).toEqual(["SetCursor : 5 arguments non gérés", "SetCursor : vue 64000 absente ou vide"]);
    expect(differing()).toBe(0);
  });
});
