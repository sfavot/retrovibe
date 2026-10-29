import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import type { Shape } from "../../src/data/mohawk/shap";
import { drawShape } from "../../src/engine/mohawk/graphics/blit";
import { Surface } from "../../src/engine/mohawk/graphics/surface";
import { Archive } from "../../src/engine/mohawk/resources";
import { MsvcRandom } from "../../src/engine/mohawk/rng";
import { parseScrb, type Script } from "../../src/games/zoombinis/data/script";
import {
  FEATURE_END,
  Feature,
  FeatureFlag,
  Features,
  resolveImageIndex,
  type FeatureOptions,
  type FeaturePart,
  type Sheet,
} from "../../src/games/zoombinis/engine/features";
import { originalFiles } from "../support/original";

const original = originalFiles("zoombinis", "files.json");

// --- Scripts synthétiques -------------------------------------------------------------------------------------------------

type Cell = [w: number, x: number, y: number];
/** Image : cases `[w, x, y]`, puis terminateur (`0xff00 | événement`, ou `0xfe00 | événement` suivi d'un id de son) ; `null` : pas de terminateur. */
type Img = { cells: Cell[]; end?: number | null; sound?: number };

function scrbBytes(images: Img[]): Uint8Array {
  const words: number[] = [images.length];
  for (const image of images) {
    for (const [w, x, y] of image.cells)
      words.push(w & 0xffff, x & 0xffff, y & 0xffff);
    if (image.end !== null) {
      if (image.sound !== undefined)
        words.push(0xfe00 | (image.end ?? 0), image.sound);
      else words.push(0xff00 | (image.end ?? 0));
    }
  }
  const bytes = new Uint8Array(words.length * 2);
  words.forEach((word, i) => {
    bytes[i * 2] = word >> 8;
    bytes[i * 2 + 1] = word & 0xff;
  });
  return bytes;
}

function script(images: Img[]): Script {
  return parseScrb(scrbBytes(images));
}

/** Forme unie de `w × h` pixels d'index `color`. */
function block(w: number, h: number, color: number): Shape {
  return {
    width: w,
    height: h,
    pitch: w,
    flags: 0,
    bitsPerPixel: 8,
    pixels: new Uint8Array(w * h).fill(color),
    consumed: w * h,
    declaredEnd: w * h,
  };
}

/** Planche de 8 formes 4 × 4 dont la couleur est l'indice 1-based. */
function sheet(anchors?: Sheet["anchors"]): Sheet {
  const images = Array.from({ length: 8 }, (_, i) => block(4, 4, i + 1));
  return anchors ? { images, anchors } : { images };
}

class Harness {
  ticks = 0;
  presents = 0;
  queued: number[] = [];
  readonly screen = new Surface(32, 32);
  readonly rng: MsvcRandom;
  readonly features: Features;

  constructor(seed = 1, withSound = true) {
    this.rng = new MsvcRandom(seed);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const owner = this;
    this.features = new Features({
      screen: this.screen,
      clock: {
        get ticks() {
          return owner.ticks;
        },
      },
      rng: this.rng,
      sound: withSound
        ? () => ({ queue: (id) => void this.queued.push(id) })
        : undefined,
      requestPresent: () => void this.presents++,
    });
  }

  /** Avance d'un tick complet (le crochet du service). */
  tick(): void {
    this.features.tick();
    this.ticks++;
  }

  /** Avance de `n` ticks et note `read(feature)` avant chacun. */
  trace<T>(n: number, read: () => T): T[] {
    const out: T[] = [];
    for (let i = 0; i < n; i++) {
      this.tick();
      out.push(read());
    }
    return out;
  }

  spawn(images: Img[], options: Partial<FeatureOptions> = {}): Feature {
    const s = script(images);
    return this.features.create({
      delay: 1,
      script: 1,
      source: (id) => (id === 1 ? { script: s } : undefined),
      ...options,
    });
  }
}
function pixelAt(h: Harness, x: number, y: number): number {
  return h.screen.get(x, y);
}

describe("features : lecteur de scripts (scripts synthétiques)", () => {
  it("pose les parties aux bonnes positions, sans dessiner les cases vides, et recompose le fond", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const bg = new Surface(32, 32);
    bg.fill(9);
    h.features.setBackground(bg);
    h.spawn([
      {
        cells: [
          [2, 5, 6],
          [0, 0, 0],
          [3, 20, 20],
        ],
      },
    ]);
    h.tick();
    expect(h.presents).toBe(1);
    expect(pixelAt(h, 5, 6)).toBe(2);
    expect(pixelAt(h, 8, 9)).toBe(2);
    expect(pixelAt(h, 9, 10)).toBe(9);
    expect(pixelAt(h, 0, 0)).toBe(9);
    // La case vide interrompt la lecture du tampon (`w = 0` termine la liste) : la partie qui la suit n'est pas dessinée.
    expect(pixelAt(h, 20, 20)).toBe(9);
  });

  it("dessine par profondeur croissante et, à égalité, par ordre de création", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    h.spawn([{ cells: [[1, 0, 0]] }], { depth: 1 });
    h.spawn([{ cells: [[2, 0, 0]] }], { depth: 0 });
    h.spawn([{ cells: [[3, 0, 0]] }], { depth: 1 });
    h.tick();
    expect(pixelAt(h, 0, 0)).toBe(3);
    expect(h.features.features.map((f) => f.depth)).toEqual([0, 1, 1]);
  });

  it("restack réinsère la feature à sa nouvelle profondeur sans réinitialiser son animation", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const front = h.spawn([{ cells: [[1, 0, 0]] }, { cells: [[2, 0, 0]] }, { cells: [[3, 0, 0]] }], { depth: 5, delay: 2 });
    h.spawn([{ cells: [[4, 0, 0]] }], { depth: 1 });
    const back = h.spawn([{ cells: [[5, 0, 0]] }], { depth: 0 });
    h.trace(3, () => 0);
    const image = front.image;
    h.features.restack(front, 0.5);
    expect(h.features.features.map((f) => f.depth)).toEqual([0, 0.5, 1]);
    expect(h.features.features[0]).toBe(back);
    expect(front.image).toBe(image);
    expect(front.active).toBe(true);
    h.features.restack(front, 9);
    expect(h.features.features[2]).toBe(front);
  });

  it("joue une image par échéance et reboucle sur l'image 0", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const f = h.spawn(
      [{ cells: [[1, 0, 0]] }, { cells: [[2, 0, 0]] }, { cells: [[3, 0, 0]] }],
      { delay: 2 },
    );
    expect(h.trace(8, () => pixelAt(h, 0, 0))).toEqual([
      1, 1, 2, 2, 3, 3, 1, 1,
    ]);
    expect(f.active).toBe(true);
  });

  it("n'avance pas avant l'échéance : le délai est en ticks", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const f = h.spawn([{ cells: [[1, 0, 0]] }, { cells: [[2, 0, 0]] }], {
      delay: 3,
    });
    expect(h.trace(7, () => f.image)).toEqual([0, 0, 0, 1, 1, 1, 0]);
  });

  it("s'arrête à la fin avec stopAtEnd, appelle le rappel avec 0xffff une seule fois et garde la dernière image", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const events: [number, number][] = [];
    const f = h.spawn([{ cells: [[1, 0, 0]] }, { cells: [[2, 0, 0]] }], {
      flags: FeatureFlag.stopAtEnd,
      onEvent: (image, n) => void events.push([image, n]),
    });
    h.trace(6, () => 0);
    expect(f.active).toBe(false);
    expect(events).toEqual([[1, FEATURE_END]]);
    expect(pixelAt(h, 0, 0)).toBe(2);
    expect(f.onEvent).toBeUndefined();
  });

  it("n'appelle pas 0xffff si notifyEnd est faux", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const events: number[] = [];
    h.spawn([{ cells: [[1, 0, 0]] }, { cells: [[2, 0, 0]] }], {
      flags: FeatureFlag.stopAtEnd,
      notifyEnd: false,
      onEvent: (_i, n) => void events.push(n),
    });
    h.trace(6, () => 0);
    expect(events).toEqual([]);
  });

  it("appelle le rappel d'événement avec (image, octet bas − 1) et ignore le numéro 0", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const events: [number, number][] = [];
    h.spawn(
      [
        { cells: [[1, 0, 0]], end: 0 },
        { cells: [[2, 0, 0]], end: 3 },
        { cells: [[3, 0, 0]], end: 0x3e, sound: 1000 },
      ],
      {
        onEvent: (image, n) => void events.push([image, n]),
      },
    );
    h.trace(3, () => 0);
    expect(events).toEqual([
      [1, 2],
      [2, 0x3d],
    ]);
  });

  it("met en file le son du terminateur (id non nul) et rien à la création d'une image fixe", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    h.spawn([
      { cells: [[1, 0, 0]], sound: 1200 },
      { cells: [[2, 0, 0]], sound: 0 },
      { cells: [[3, 0, 0]], sound: 1300 },
    ]);
    h.trace(3, () => 0);
    expect(h.queued).toEqual([1200, 1300]);

    const quiet = new Harness();
    quiet.features.setGroup(0, sheet());
    quiet.spawn([{ cells: [[1, 0, 0]], sound: 1200 }, { cells: [[2, 0, 0]] }], {
      flags: FeatureFlag.staticFirst,
    });
    quiet.trace(4, () => 0);
    expect(quiet.queued).toEqual([]);
  });

  it("ne met aucun son en file sans service de son", () => {
    const h = new Harness(1, false);
    h.features.setGroup(0, sheet());
    h.spawn([{ cells: [[1, 0, 0]], sound: 1200 }]);
    expect(() => h.trace(2, () => 0)).not.toThrow();
  });

  it("lecture aléatoire : suite reproductible à graine fixe, tirée par rng.range(0, dernière)", () => {
    const run = (seed: number) => {
      const h = new Harness(seed);
      h.features.setGroup(0, sheet());
      const f = h.spawn(
        Array.from({ length: 6 }, (_, i) => ({
          cells: [[i + 1, 0, 0]] as Cell[],
        })),
        { flags: FeatureFlag.random },
      );
      return h.trace(20, () => f.image);
    };
    const a = run(42);
    expect(run(42)).toEqual(a);
    expect(run(43)).not.toEqual(a);
    // Même suite que le générateur seul : image 0 à la création, puis un tirage par échéance.
    const rng = new MsvcRandom(42);
    // Sur la dernière image (5), l'échéance suivante reboucle à 0 sans tirage.
    const expected = [0];
    while (expected.length < 20)
      expected.push(expected[expected.length - 1] === 5 ? 0 : rng.range(0, 5));
    expect(a).toEqual(expected);
  });

  it("file de script : le script remplacé est repris à la fin du nouveau (queueScript)", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const scripts: Record<number, Script> = {
      1: script([
        { cells: [[1, 0, 0]] },
        { cells: [[2, 0, 0]] },
        { cells: [[3, 0, 0]] },
      ]),
      2: script([
        { cells: [[4, 0, 0]] },
        { cells: [[5, 0, 0]] },
        { cells: [[6, 0, 0]] },
      ]),
    };
    h.features.setScripts(1, 2);
    const f = h.features.create({
      delay: 1,
      script: 1,
      flags: FeatureFlag.queueScript,
      source: (id) => (scripts[id] ? { script: scripts[id]! } : undefined),
    });
    h.tick();
    h.features.setScript(f, 2);
    expect(f.queued).toBe(1);
    expect(f.scriptId).toBe(2);
    const colors = h.trace(8, () => pixelAt(h, 0, 0));
    // 2 : 4, 5, 6 ; retour à 1 : l'image 0 est lue deux fois (le drapeau « première image » posé par le changement de script reste), puis 2, 3, et le script reboucle.
    expect(colors).toEqual([4, 5, 6, 1, 1, 2, 3, 1]);
    expect(f.scriptId).toBe(1);
    expect(f.queued).toBe(0);
  });

  it("un script déjà en file ignore un nouveau changement", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const scripts: Record<number, Script> = {
      1: script([{ cells: [[1, 0, 0]] }]),
      2: script([{ cells: [[2, 0, 0]] }]),
      3: script([{ cells: [[3, 0, 0]] }]),
    };
    const f = h.features.create({
      delay: 1,
      script: 1,
      flags: FeatureFlag.queueScript,
      source: (id) => ({ script: scripts[id]! }),
    });
    h.tick();
    h.features.setScript(f, 2);
    h.features.setScript(f, 3);
    expect(f.scriptId).toBe(2);
  });

  it("une feature aléatoire en file se remet en mode aléatoire à la reprise", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const scripts: Record<number, Script> = {
      1: script(
        Array.from({ length: 4 }, (_, i) => ({
          cells: [[i + 1, 0, 0]] as Cell[],
        })),
      ),
      2: script([
        { cells: [[5, 0, 0]] },
        { cells: [[6, 0, 0]] },
        { cells: [[7, 0, 0]] },
      ]),
    };
    const f = h.features.create({
      delay: 1,
      script: 1,
      flags: FeatureFlag.queueScript | FeatureFlag.random,
      source: (id) => ({ script: scripts[id]! }),
    });
    h.tick();
    h.features.setScript(f, 2);
    expect(f.hasFlag(FeatureFlag.random)).toBe(false);
    expect(f.queued).toBe(-1);
    h.trace(6, () => 0);
    expect(f.scriptId).toBe(1);
    expect(f.hasFlag(FeatureFlag.random)).toBe(true);
  });

  it("firstImage joue la première image dès la création ; staticFirst s'arrête après elle", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const f = h.spawn([{ cells: [[1, 7, 7]] }, { cells: [[2, 7, 7]] }], {
      flags: FeatureFlag.firstImage | FeatureFlag.staticFirst,
    });
    expect(f.parts).toEqual([{ w: 1, x: 7, y: 7 }]);
    expect(f.active).toBe(false);
    h.trace(5, () => 0);
    expect(f.image).toBe(0);
  });

  it("noDraw joue sans dessiner ; noReplay, stopEachImage et resetOnce arrêtent la lecture", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const hidden = h.spawn([{ cells: [[1, 0, 0]] }], {
      flags: FeatureFlag.noDraw,
    });
    h.tick();
    expect(hidden.parts).toHaveLength(1);
    expect(pixelAt(h, 0, 0)).toBe(0);

    const once = h.spawn([{ cells: [[1, 0, 0]] }, { cells: [[2, 0, 0]] }], {
      flags: FeatureFlag.noReplay,
    });
    const each = h.spawn(
      [{ cells: [[1, 0, 0]] }, { cells: [[2, 0, 0]] }, { cells: [[3, 0, 0]] }],
      { flags: FeatureFlag.stopEachImage },
    );
    h.trace(3, () => 0);
    expect(once.active).toBe(false);
    expect(each.active).toBe(false);
    expect(each.image).toBe(0);

    // resetOnce : à la prochaine échéance, retour à l'image 0 et arrêt, le bit est effacé.
    const reset = h.spawn([
      { cells: [[1, 0, 0]] },
      { cells: [[2, 0, 0]] },
      { cells: [[3, 0, 0]] },
    ]);
    h.trace(2, () => 0);
    expect(reset.image).toBe(1);
    reset.flags |= FeatureFlag.resetOnce;
    h.tick();
    expect(reset.image).toBe(0);
    expect(reset.active).toBe(false);
    expect(reset.hasFlag(FeatureFlag.resetOnce)).toBe(false);
  });

  it("position relative : décale les parties de la position moins la première case de l'image 0", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const f = h.spawn(
      [
        {
          cells: [
            [1, 10, 10],
            [2, 14, 10],
          ],
        },
      ],
      { flags: FeatureFlag.relative, position: { x: 3, y: 5 } },
    );
    h.tick();
    expect(f.reference).toEqual({ x: 10, y: 10 });
    expect(f.parts.map((p) => [p.x, p.y])).toEqual([
      [3, 5],
      [7, 5],
    ]);
  });

  it("soustrait les ancres REGS du groupe (x − X[w], y − Y[w]) et calcule le rectangle", () => {
    const h = new Harness();
    h.features.setGroup(
      0,
      sheet({
        x: Int16Array.from([0, 1, 2, 0, 0, 0, 0, 0, 0]),
        y: Int16Array.from([0, 3, 4, 0, 0, 0, 0, 0, 0]),
      }),
    );
    const f = h.spawn([
      {
        cells: [
          [1, 10, 10],
          [2, 20, 12],
        ],
      },
    ]);
    h.tick();
    expect(f.parts.map((p) => [p.x, p.y])).toEqual([
      [9, 7],
      [18, 8],
    ]);
    expect(f.rect).toEqual({ left: 9, top: 7, right: 22, bottom: 12 });
    expect(pixelAt(h, 9, 7)).toBe(1);
  });

  it("rappel d'image : remplace les parties, y compris par celles d'une autre planche et ses propres ancres", () => {
    const h = new Harness();
    h.features.setGroup(
      0,
      sheet({ x: new Int16Array(9).fill(100), y: new Int16Array(9).fill(100) }),
    );
    const other: Sheet = {
      images: [block(2, 2, 77)],
      anchors: { x: Int16Array.from([0, 1]), y: Int16Array.from([0, 1]) },
    };
    const seen: FeaturePart[][] = [];
    const f = h.spawn([{ cells: [[5, 8, 8]] }], {
      onImage: (_feature, parts) => {
        seen.push(parts.map((p) => ({ ...p })));
        return parts.map((p) => ({ w: 1, x: p.x, y: p.y, sheet: other }));
      },
    });
    h.tick();
    expect(seen).toEqual([[{ w: 5, x: 8, y: 8 }]]);
    expect(f.parts).toEqual([{ w: 1, x: 7, y: 7, sheet: other }]);
    expect(pixelAt(h, 7, 7)).toBe(77);
  });

  it("n'appelle pas le rappel d'image quand la première case est vide", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    let calls = 0;
    h.spawn(
      [
        {
          cells: [
            [0, 0, 0],
            [1, 5, 5],
          ],
        },
      ],
      { onImage: () => void calls++ },
    );
    h.tick();
    expect(calls).toBe(0);
  });

  it("appelle les rappels avant et après le dessin avec la surface", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const log: string[] = [];
    h.spawn([{ cells: [[1, 0, 0]] }], {
      onBeforeDraw: (_f, screen) => void log.push(`avant ${screen.get(0, 0)}`),
      onAfterDraw: (_f, screen) => void log.push(`après ${screen.get(0, 0)}`),
    });
    h.tick();
    expect(log).toEqual(["avant 0", "après 1"]);
  });

  it("image de 24 cases : le terminateur est relu comme une image sans case, qui garde les parties", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const full: Cell[] = Array.from({ length: 24 }, (_, i) => [
      (i % 8) + 1,
      i,
      i,
    ]);
    const events: [number, number][] = [];
    // image 0 : 24 cases sans terminateur (le mot 0xff05 est lu à l'image 1) ; image 2 : normale.
    const s = script([
      { cells: full, end: null },
      { cells: [], end: 5 },
      { cells: [[1, 0, 0]] },
    ]);
    expect(s.images[0]!.terminated).toBe(false);
    const f = h.features.create({
      delay: 1,
      script: 1,
      source: () => ({ script: s }),
      onEvent: (image, n) => void events.push([image, n]),
    });
    h.tick();
    expect(f.parts).toHaveLength(24);
    expect(events).toEqual([]);
    h.tick();
    expect(events).toEqual([[1, 4]]);
    expect(f.parts).toHaveLength(24);
    h.tick();
    expect(f.parts).toEqual([{ w: 1, x: 0, y: 0 }]);
  });

  it("changement de script inconnu : la feature s'arrête sans parties", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const bg = new Surface(32, 32);
    bg.fill(9);
    h.features.setBackground(bg);
    const f = h.spawn([{ cells: [[1, 0, 0]] }]);
    h.tick();
    expect(pixelAt(h, 0, 0)).toBe(1);
    h.features.setScript(f, 99);
    h.tick();
    expect(f.active).toBe(false);
    expect(f.parts).toEqual([]);
    expect(pixelAt(h, 0, 0)).toBe(9);
  });

  it("clear détruit les features, les groupes et recompose rien", () => {
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const f = h.spawn([{ cells: [[1, 0, 0]] }]);
    h.features.clear();
    expect(f.destroyed).toBe(true);
    expect(h.features.features).toHaveLength(0);
    expect(h.features.group(0)).toBeUndefined();
    const presents = h.presents;
    h.tick();
    expect(h.presents).toBe(presents);
    expect(() => h.features.setGroup(0, sheet())).not.toThrow();
  });

  it("groupes : bornes et réutilisation", () => {
    const h = new Harness();
    expect(() => h.features.setGroup(8, sheet())).toThrow("out of range");
    h.features.setGroup(7, sheet());
    expect(() => h.features.setGroup(7, sheet())).toThrow("already used");
    expect(() => h.features.defineGroup(0, 1100)).toThrow("archive");
  });

  it("plages de scripts : groupe = rang de la plage, id hors plage inconnu, au plus 8 plages et 300 emplacements", () => {
    const h = new Harness();
    h.features.setScripts(1100, 16);
    h.features.addScripts(1200, 16);
    expect(h.features.groupOf(1100)).toBe(0);
    expect(h.features.groupOf(1115)).toBe(0);
    expect(h.features.groupOf(1116)).toBeUndefined();
    expect(h.features.groupOf(1200)).toBe(1);
    expect(() => h.features.setScripts(1, 301)).toThrow(
      "Too many main-feature",
    );
    h.features.setScripts(1, 290);
    expect(() => h.features.addScripts(5000, 20)).toThrow(
      "Too many next-group-feature",
    );
    h.features.setScripts(1, 10);
    for (let i = 0; i < 10; i++) h.features.addScripts(1000 + i * 10, 5);
    expect(h.features.groupOf(1000 + 6 * 10)).toBe(7);
    expect(h.features.groupOf(1000 + 7 * 10)).toBeUndefined();
  });

  it("accès aléatoire : indice borné à [−n, n − 1], négatif depuis la fin", () => {
    expect(resolveImageIndex(5, 2)).toBe(2);
    expect(resolveImageIndex(5, 9)).toBe(4);
    expect(resolveImageIndex(5, -1)).toBe(4);
    expect(resolveImageIndex(5, -9)).toBe(0);
    const h = new Harness();
    h.features.setGroup(0, sheet());
    const f = h.spawn(
      [{ cells: [[1, 0, 0]] }, { cells: [[2, 0, 0]] }, { cells: [[3, 0, 0]] }],
      { delay: 5 },
    );
    h.tick();
    h.features.seek(f, -1);
    h.tick();
    expect(f.image).toBe(2);
    expect(pixelAt(h, 0, 0)).toBe(3);
    h.features.seek(f, 0);
    h.tick();
    expect(f.image).toBe(0);
  });
});

describe.skipIf(!original.has)("features : décor animé de BASECAMP", () => {
  function setup() {
    const h = new Harness();
    const archive = new Archive(
      "BASECAMP.MHK",
      MohawkArchive.parse(original.read("BASECAMP.MHK")),
    );
    const background = new Surface(640, 480);
    drawShape(background, archive.tbmp(1000), 0, 0, 0);
    const screen = new Surface(640, 480);
    const features = new Features({
      screen,
      clock: {
        get ticks() {
          return h.ticks;
        },
      },
      rng: new MsvcRandom(7),
      sound: () => ({ queue: (id) => void h.queued.push(id) }),
      requestPresent: () => void h.presents++,
    });
    features.setArchive(archive);
    features.setBackground(background);
    features.defineGroup(0, 1100);
    features.defineGroup(1, 1200);
    features.setScripts(1100, 16);
    features.addScripts(1200, 16);
    const tick = () => {
      features.tick();
      h.ticks++;
    };
    return { h, archive, background, screen, features, tick };
  }

  /** Composition de référence (`engine.md` §3.2) : fond, puis parties de l'image 0 de chaque script, `w = 0` non dessiné. */
  function reference(
    archive: Archive,
    background: Surface,
    ids: number[],
  ): Surface {
    const out = new Surface(640, 480);
    out.copyFrom(background);
    for (const id of ids) {
      const script = parseScrb(archive.raw("SCRB", id));
      const images = archive.tbmpImages(id < 1200 ? 1100 : 1200);
      for (const cell of script.images[0]!.cells) {
        if (cell.w === 0) break;
        drawShape(out, images[cell.w - 1]!, cell.x, cell.y, 8);
      }
    }
    return out;
  }

  it("compose les premières images des 32 SCRB 1100–1115 et 1200–1215 comme la vérification de engine.md §3.2", () => {
    const { h, archive, background, screen, features, tick } = setup();
    const ids = [
      ...Array.from({ length: 16 }, (_, i) => 1100 + i),
      ...Array.from({ length: 16 }, (_, i) => 1200 + i),
    ];
    for (const id of ids)
      features.create({
        delay: 1000,
        script: id,
        flags: FeatureFlag.staticFirst,
      });
    tick();
    const expected = reference(archive, background, ids);
    expect(
      Buffer.from(screen.pixels).equals(Buffer.from(expected.pixels)),
    ).toBe(true);
    // Le décor n'est pas le fond seul.
    expect(
      Buffer.from(screen.pixels).equals(Buffer.from(background.pixels)),
    ).toBe(false);
    expect(h.presents).toBe(1);
  });

  it("les parties du SCRB 1105 sont aux positions du script (partie 5 en (411, 214))", () => {
    const { features, tick } = setup();
    const f = features.create({ delay: 6, script: 1105 });
    tick();
    expect(f.parts[0]).toMatchObject({ w: 5, x: 411, y: 214 });
    expect(f.parts[1]).toMatchObject({ w: 6, x: 435, y: 263 });
    expect(f.group).toBe(0);
    expect(f.rect!.left).toBeLessThanOrEqual(411);
  });

  it("joue le SCRB 1105 en entier, reboucle, et met ses sons en file dans l'ordre du script", () => {
    const { h, archive, features, tick } = setup();
    const script = parseScrb(archive.raw("SCRB", 1105));
    const f = features.create({ delay: 1, script: 1105 });
    const images: number[] = [];
    for (let i = 0; i < script.imageCount + 2; i++) {
      tick();
      images.push(f.image);
    }
    expect(images.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(images.slice(-2)).toEqual([0, 1]);
    const sounds = script.images
      .filter((image) => image.soundId)
      .map((image) => image.soundId!);
    expect(sounds.length).toBeGreaterThan(0);
    expect(h.queued.slice(0, sounds.length)).toEqual(sounds);
  });

  it("une feature de BASECAMP en arrêt à la fin s'arrête sur sa dernière image avec 0xffff", () => {
    const { archive, features, tick } = setup();
    const script = parseScrb(archive.raw("SCRB", 1108));
    const events: number[] = [];
    const f = features.create({
      delay: 1,
      script: 1108,
      flags: FeatureFlag.stopAtEnd,
      onEvent: (_i, n) => void events.push(n),
    });
    for (let i = 0; i < script.imageCount + 5; i++) tick();
    expect(f.active).toBe(false);
    expect(f.image).toBe(script.imageCount - 1);
    expect(events).toEqual([FEATURE_END]);
  });
});
