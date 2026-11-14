import { describe, expect, it } from "vitest";
import { CompactField as F } from "../../../src/games/bass/data/compact-fields";
import { DATA_FILE_HEADER_SIZE } from "../../../src/games/bass/data/header";
import { SF, Var } from "../../../src/games/bass/engine/ids";
import { NullScreen } from "../../../src/games/bass/engine/services";
import { GRID_RECREATE } from "../../../src/games/bass/render/draw";
import { SCREEN_SIZE, SCREEN_WIDTH, TOP_LEFT_X, TOP_LEFT_Y } from "../../../src/games/bass/render/frame-buffer";
import { BassScreenRenderer, type ScreenSource } from "../../../src/games/bass/render/screen";

const COMPACT_WORDS = 64;

function spriteBytes(width: number, height: number, pixels: number[]): Uint8Array {
  const bytes = new Uint8Array(DATA_FILE_HEADER_SIZE + pixels.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  view.setUint16(10, width * height, true);
  view.setUint16(14, pixels.length / (width * height), true);
  bytes.set(pixels, DATA_FILE_HEADER_SIZE);
  return bytes;
}

/** Moteur factice : compacts par identifiant, variables, fichiers par emplacement. */
class FakeSource implements ScreenSource {
  readonly vars = new Uint32Array(838);
  readonly cpts = new Map<number, Uint16Array>();
  readonly files = new Map<number, Uint8Array>();
  readonly system = { systemFlags: 0 };
  readonly compacts = {
    require: (id: number): Uint16Array => {
      const cpt = this.cpts.get(id);
      if (!cpt) throw new Error(`compact ${id} absent`);
      return cpt;
    },
  };
  readonly items = { fetch: (n: number): Uint8Array | null => this.files.get(n) ?? null };

  /** Compact de sprite : fichier `file`, image `index`, à l'écran de jeu (`x`, `y`) = coordonnées de l'écran 320 x 200 + `TOP_LEFT`. */
  sprite(id: number, file: number, x: number, y: number, status: number, index = 0): Uint16Array {
    const cpt = new Uint16Array(COMPACT_WORDS);
    cpt[F.status] = status;
    cpt[F.screen] = this.vars[Var.SCREEN]!;
    cpt[F.xcood] = x + TOP_LEFT_X;
    cpt[F.ycood] = y + TOP_LEFT_Y;
    cpt[F.frame] = (file << 6) | index;
    this.cpts.set(id, cpt);
    return cpt;
  }

  /** Liste de dessin de compacts, terminée par 0 (ou chaînée par `0xFFFF`). */
  drawList(id: number, ids: number[], slot = 0): void {
    this.cpts.set(id, Uint16Array.from([...ids, 0, 0]));
    this.vars[Var.DRAW_LIST_NO + slot] = id;
  }

  background(color: number): void {
    this.vars[Var.LAYER_0_ID] = 900;
    this.files.set(900, new Uint8Array(61440).fill(color));
  }
}

function setup(): { src: FakeSource; screen: BassScreenRenderer } {
  const src = new FakeSource();
  src.vars[Var.SCREEN] = 3;
  const screen = new BassScreenRenderer().attach(src);
  return { src, screen };
}

const px = (screen: BassScreenRenderer, x: number, y: number): number => screen.frame.pixels[y * SCREEN_WIDTH + x]!;

describe("composition d'un tour (recreate, spriteEngine, flip)", () => {
  it("le décor est recopié au premier tour, puis seuls les blocs marqués sont refaits", () => {
    const { src, screen } = setup();
    src.background(5);
    screen.compose();
    expect([px(screen, 0, 0), px(screen, 319, 191), px(screen, 0, 192)]).toEqual([5, 5, 0]);
    // Le décor change : rien n'est recopié tant qu'aucun bloc n'est marqué.
    src.files.set(900, new Uint8Array(61440).fill(8));
    screen.compose();
    expect(px(screen, 10, 10)).toBe(5);
    screen.grid[0] = GRID_RECREATE;
    screen.compose();
    expect([px(screen, 10, 4), px(screen, 16, 4), px(screen, 10, 8)]).toEqual([8, 5, 5]);
  });

  it("sans décor (LAYER_0_ID nul) rien n'est dessiné ; un fichier de décor absent est une erreur", () => {
    const { src, screen } = setup();
    expect(() => screen.compose()).not.toThrow();
    src.vars[Var.LAYER_0_ID] = 77;
    expect(() => screen.compose()).toThrow(/LAYER_0_ID/);
  });

  it("ordre : arrière, puis sprites triés par le bas, puis avant ; hors écran courant ignoré", () => {
    const { src, screen } = setup();
    src.background(1);
    src.files.set(10, spriteBytes(4, 4, new Array(16).fill(2))); // fichier 10 : carré de 2
    src.files.set(11, spriteBytes(4, 4, new Array(16).fill(3)));
    src.files.set(12, spriteBytes(4, 4, new Array(16).fill(4)));
    src.sprite(100, 10, 50, 50, 1); // arrière
    src.sprite(101, 11, 50, 50, 2); // avant (dessiné après le tri)
    const low = src.sprite(102, 12, 61, 60, 4); // trié, plus bas : dessiné en dernier
    src.sprite(103, 11, 62, 59, 4); // trié, plus haut : dessiné avant 102
    const elsewhere = src.sprite(104, 12, 60, 60, 1);
    elsewhere[F.screen] = 9;
    src.drawList(200, [100, 101, 102, 103, 104]);
    screen.compose();
    expect(px(screen, 50, 50)).toBe(3); // l'avant recouvre l'arrière
    expect(px(screen, 62, 61)).toBe(4); // 102 (plus bas) recouvre 103
    expect(px(screen, 65, 59)).toBe(3);
    expect(px(screen, 60, 60)).toBe(1); // autre écran : pas dessiné
    expect(low[F.status]).toBe(4);
  });

  it("listes chaînées (0xFFFF) et plusieurs variables de liste", () => {
    const { src, screen } = setup();
    src.background(0);
    src.files.set(10, spriteBytes(2, 2, [6, 6, 6, 6]));
    src.sprite(100, 10, 10, 10, 1);
    src.sprite(101, 10, 20, 10, 1);
    src.sprite(102, 10, 30, 10, 1);
    src.cpts.set(300, Uint16Array.from([100, 0xffff, 301]));
    src.cpts.set(301, Uint16Array.from([101, 0]));
    src.vars[Var.DRAW_LIST_NO] = 300;
    src.drawList(302, [102], 1);
    screen.compose();
    expect([px(screen, 10, 10), px(screen, 20, 10), px(screen, 30, 10)]).toEqual([6, 6, 6]);
  });

  it("fichier de sprite absent : status mis à 0 ; image hors du fichier ignorée", () => {
    const { src, screen } = setup();
    src.background(0);
    src.files.set(10, spriteBytes(2, 2, [6, 6, 6, 6]));
    const missing = src.sprite(100, 99, 10, 10, 1);
    const badFrame = src.sprite(101, 10, 20, 10, 1, 5);
    src.drawList(200, [100, 101]);
    screen.compose();
    expect(missing[F.status]).toBe(0);
    expect(badFrame[F.status]).toBe(1);
    expect(px(screen, 20, 10)).toBe(0);
  });

  it("status & 8 force la recomposition du décor sous le sprite au tour suivant ; sinon le sprite reste dans le décor", () => {
    const { src, screen } = setup();
    src.background(1);
    src.files.set(10, spriteBytes(2, 2, [6, 6, 6, 6]));
    const moving = src.sprite(100, 10, 10, 10, 1 | 8);
    src.sprite(101, 10, 100, 10, 1);
    src.drawList(200, [100, 101]);
    screen.compose();
    expect([px(screen, 10, 10), px(screen, 100, 10)]).toEqual([6, 6]);
    moving[F.xcood] = 20 + TOP_LEFT_X;
    src.cpts.get(101)![F.status] = 0; // ce sprite n'est plus dessiné, mais son ancienne image reste : bloc non marqué `0x80`
    screen.compose();
    expect([px(screen, 10, 10), px(screen, 20, 10), px(screen, 100, 10)]).toEqual([1, 6, 6]);
  });

  it("sprite de texte : le fichier de `frame >> 6` vient des fichiers chargés (le moteur de texte y dépose son sprite)", () => {
    const { src, screen } = setup();
    src.background(0);
    src.files.set(274, spriteBytes(3, 2, [255, 255, 255, 0, 240, 240]));
    src.sprite(23, 274, 30, 20, 2);
    src.drawList(200, [23]);
    screen.compose();
    expect([px(screen, 30, 20), px(screen, 33, 20), px(screen, 30, 21), px(screen, 31, 21)]).toEqual([255, 0, 0, 240]);
  });

  it("compose exige attach(engine)", () => {
    expect(() => new BassScreenRenderer().compose()).toThrow(/attach/);
  });
});

/** Compact de palette : 768 octets VGA 6 bits en mots petit-boutistes. */
function paletteCompact(src: FakeSource, id: number, value: (index: number) => number): void {
  const words = new Uint16Array(384);
  for (let i = 0; i < 384; i++) words[i] = value(2 * i) | (value(2 * i + 1) << 8);
  src.cpts.set(id, words);
}

describe("palette, fondus et défilement", () => {
  it("setPalette : 240 couleurs de la palette VGA (6 bits -> 8 bits), les 16 dernières de la machine ne changent pas", () => {
    const { src, screen } = setup();
    paletteCompact(src, 500, () => 63);
    const top = screen.frame.palette.slice(720);
    screen.setPalette(500);
    expect(Array.from(screen.frame.palette.subarray(0, 3))).toEqual([255, 255, 255]);
    expect(screen.frame.palette.subarray(720)).toEqual(top);
    expect(Array.from(top.subarray(3, 6))).toEqual([38 * 4 + 2, 38 * 4 + 2, 38 * 4 + 2]);
  });

  it("fondu au noir : -8 par pas et par composante, cumulatif, 32 pas ; fondu en entrée : (cible * n) >> 5", () => {
    const { src, screen } = setup();
    paletteCompact(src, 500, (i) => (i * 7) % 64);
    screen.setPalette(500);
    const target = screen.frame.palette.slice(0, 720);
    screen.fadeDown(0);
    for (let step = 0; step < 32; step++) {
      screen.effectStep("fadeDown", step, 32);
      const expected = target.map((v) => Math.max(0, v - 8 * (step + 1)));
      expect(screen.frame.palette.subarray(0, 720)).toEqual(expected);
    }
    screen.fadeUp(500, 0);
    for (let step = 0; step < 32; step++) {
      screen.effectStep("fadeUp", step, 32);
      expect(screen.frame.palette.subarray(0, 720)).toEqual(target.map((v) => (v * (step + 1)) >> 5));
    }
    expect(screen.frame.palette.subarray(0, 720)).toEqual(target);
  });

  it("défilement : 19 images décalées de 16 pixels, puis l'image du nouveau décor ; SF_NO_SCROLL le remplace par un fondu", () => {
    const { src, screen } = setup();
    src.background(1);
    screen.compose();
    // Ancien décor : colonnes marquées par leur numéro de bloc.
    const old = screen.workScreen;
    for (let y = 0; y < 192; y++) for (let x = 0; x < 320; x++) old[y * 320 + x] = 1 + (x >> 4);
    screen.compose(); // rien à recopier
    screen.frame.pixels.set(old);
    screen.fadeDown(123);
    src.files.set(900, new Uint8Array(61440).fill(100));
    screen.drawNewScreen();
    paletteCompact(src, 500, () => 10);
    screen.fadeUp(500, 123);
    for (let step = 0; step < 19; step++) {
      screen.effectStep("scrollLeft", step, 19);
      const shift = (step + 1) * 16;
      expect([px(screen, 0, 5), px(screen, 320 - shift - 1, 5), px(screen, 320 - shift, 5)]).toEqual([1 + (shift >> 4), 20, 100]);
    }
    expect(px(screen, 319, 0)).toBe(100);
    screen.processSequence(0); // le tick suivant présente l'image finale
    expect(Array.from(screen.frame.pixels.subarray(0, 4))).toEqual([100, 100, 100, 100]);

    // SF_NO_SCROLL : fondu (la palette bouge, l'écran de travail n'est pas remplacé).
    src.system.systemFlags = SF.NO_SCROLL;
    const keep = screen.workScreen;
    screen.fadeDown(123);
    expect(screen.workScreen).toBe(keep);
  });

  it("fadeUp d'un défilement sans fadeDown est une erreur ; effet inconnu aussi", () => {
    const { src, screen } = setup();
    paletteCompact(src, 500, () => 10);
    expect(() => screen.fadeUp(500, 321)).toThrow(/défilement/);
    expect(() => screen.effectStep("tremblement", 0, 1)).toThrow(/inconnu/);
  });

  it("pause : la machine montre la moitié de la palette de travail, rétablie ensuite", () => {
    const { src, screen } = setup();
    paletteCompact(src, 500, () => 63);
    screen.setPalette(500);
    screen.halvePalette();
    expect(screen.frame.palette[0]).toBe(127);
    screen.resumePalette();
    expect(screen.frame.palette[0]).toBe(255);
  });

  it("clearScreen met tout à 0 (200 lignes)", () => {
    const { src, screen } = setup();
    src.background(9);
    screen.compose();
    screen.clearScreen();
    expect(screen.frame.pixels.every((v) => v === 0)).toBe(true);
  });
});

describe("séquences « swing »", () => {
  /** Séquence de `frames` images : saute `skip` pixels puis copie `color` sur 3 pixels, puis saute jusqu'à la fin de l'écran. */
  function sequence(frames: number, color: (frame: number) => number): Uint8Array {
    const out: number[] = [frames];
    for (let f = 0; f < frames; f++) {
      out.push(0, 3, color(f), color(f), color(f)); // copie 3 pixels en 0
      let rest = 320 * 192 - 3;
      while (rest > 0) {
        const skip = Math.min(rest, 0xfe);
        out.push(skip, 0); // saut puis copie vide
        rest -= skip;
      }
    }
    return Uint8Array.from(out);
  }

  it("une image toutes les 60 ms, n - 1 images, mêmes états que la souche NullScreen", () => {
    const { screen } = setup();
    const data = sequence(4, (f) => 10 + f);
    const reference = new NullScreen();
    screen.startSequence(85, data, 1000);
    reference.startSequence(85, data, 1000);
    expect(screen.sequenceRunning()).toBe(true);
    const seen: number[] = [];
    for (let now = 1000; now < 1400; now += 20) {
      screen.processSequence(now);
      reference.processSequence(now);
      expect(screen.sequenceRunning()).toBe(reference.sequenceRunning());
      if (screen.sequenceRunning()) seen.push(px(screen, 0, 0));
    }
    expect(screen.sequenceRunning()).toBe(false);
    expect(px(screen, 0, 0)).toBe(12); // 3 images (4 - 1) : 10, 11, 12
    expect(seen.length).toBeGreaterThan(0);
  });

  it("données absentes : pas de séquence", () => {
    const { screen } = setup();
    screen.startSequence(85, null, 0);
    expect(screen.sequenceRunning()).toBe(false);
  });
});

it("taille de l'écran affiché : 320 x 200", () => {
  expect(setup().screen.frame.pixels).toHaveLength(SCREEN_SIZE);
});
