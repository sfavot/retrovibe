import { describe, expect, it } from "vitest";
import { Menu, paletteHighlight, type MenuEvent, type MenuItem } from "../../src/games/teleportaschtroumpf/engine/menu";
import { Input } from "../../src/games/teleportaschtroumpf/engine/input";
import { Palette } from "../../src/games/teleportaschtroumpf/engine/palette";
import type { SceneContext } from "../../src/games/teleportaschtroumpf/engine/scene";

const HOVER = [0x10, 0xa4, 0xcc] as const;

/** Trois éléments, voix d'aide sur les deux premiers. */
const ITEMS: MenuItem[] = [{ voice: "a.voc" }, { voice: "b.voc" }, {}];

interface Harness {
  ctx: SceneContext;
  menu: Menu;
  palette: Palette;
  input: Input;
  voices: string[];
  /** Bruitages mélangés lancés (`playEffect`) et état « un bruitage sonne ». */
  effects: string[];
  busy: { effect: boolean };
  /** Un pas de scène : met à jour le menu puis oublie les appuis récents (comme le gestionnaire de scènes). */
  step(): MenuEvent | null;
  /** Éléments dont la couleur est en surbrillance. */
  lit(): number[];
}

async function harness(axis: "vertical" | "horizontal" | "none", options: { wrap?: boolean; initial?: number; changeSound?: string; changeSoundIfIdle?: boolean } = {}): Promise<Harness> {
  const input = new Input();
  const palette = new Palette();
  for (let i = 0; i < 3; i++) palette.setColor(120 + i, 83, 23, 23);
  const voices: string[] = [];
  const effects: string[] = [];
  const busy = { effect: false };
  const ctx = {
    input,
    palette,
    voice: {
      play: (v: { name: string }) => voices.push(v.name),
      playEffect: (v: { name: string }) => effects.push(v.name),
      get effectPlaying() {
        return busy.effect;
      },
    },
    resources: { voc: async (name: string) => ({ name }) },
  } as unknown as SceneContext;
  const menu = new Menu({ items: ITEMS, axis, highlight: paletteHighlight(120, HOVER), ...options });
  await menu.load(ctx);
  menu.enter(ctx);
  return {
    ctx,
    menu,
    palette,
    input,
    voices,
    effects,
    busy,
    step() {
      const event = menu.update(ctx);
      input.endUpdate();
      return event;
    },
    lit: () => [0, 1, 2].filter((i) => palette.colors[(120 + i) * 3] === HOVER[0]),
  };
}

describe("Menu", () => {
  it("met le premier élément en surbrillance à l'entrée, ou l'élément initial", async () => {
    expect((await harness("vertical")).lit()).toEqual([0]);
    expect((await harness("vertical", { initial: 2 })).lit()).toEqual([2]);
  });

  it("navigue sur l'axe vertical, avec rebouclage dans les deux sens, et restaure l'ancienne couleur", async () => {
    const h = await harness("vertical");
    h.input.keyDown("ArrowDown");
    h.step();
    expect(h.menu.index).toBe(1);
    expect(h.lit()).toEqual([1]);
    expect([...h.palette.colors.subarray(120 * 3, 120 * 3 + 3)]).toEqual([83, 23, 23]);
    h.input.keyUp("ArrowDown");
    for (const expected of [2, 0]) {
      h.input.keyDown("KeyA"); // A = bas
      h.step();
      h.input.keyUp("KeyA");
      expect(h.menu.index).toBe(expected);
    }
    h.input.keyDown("ArrowUp");
    h.step();
    expect(h.menu.index).toBe(2);
    expect(h.lit()).toEqual([2]);
  });

  it("ignore l'autre axe et navigue par gauche/droite sur l'axe horizontal", async () => {
    const vertical = await harness("vertical");
    vertical.input.keyDown("ArrowRight");
    vertical.step();
    expect(vertical.menu.index).toBe(0);

    const horizontal = await harness("horizontal");
    horizontal.input.keyDown("ArrowDown");
    horizontal.step();
    expect(horizontal.menu.index).toBe(0);
    horizontal.input.keyUp("ArrowDown");
    horizontal.input.keyDown("ArrowLeft");
    horizontal.step();
    expect(horizontal.menu.index).toBe(2);
  });

  it("garde un appui plus court que le pas de la scène", async () => {
    const h = await harness("vertical");
    h.input.keyDown("ArrowDown");
    h.input.keyUp("ArrowDown");
    h.step();
    expect(h.menu.index).toBe(1);
  });

  it("sans rebouclage (wrap: false), l'index est borné aux deux extrémités", async () => {
    const h = await harness("vertical", { wrap: false });
    h.input.keyDown("ArrowUp");
    h.step();
    expect(h.menu.index).toBe(0);
    h.input.keyUp("ArrowUp");
    for (let i = 0; i < 4; i++) {
      h.input.keyDown("ArrowDown");
      h.step();
      h.input.keyUp("ArrowDown");
    }
    expect(h.menu.index).toBe(2);
    expect(h.lit()).toEqual([2]);
    h.input.keyDown("ArrowUp");
    h.step();
    expect(h.menu.index).toBe(1);
  });

  it("axe « none » : les touches ne déplacent rien, la scène utilise select()", async () => {
    const h = await harness("none");
    h.input.keyDown("ArrowDown");
    h.step();
    h.input.keyUp("ArrowDown");
    h.input.keyDown("ArrowRight");
    h.step();
    expect(h.menu.index).toBe(0);
  });

  it("joue le bip de navigation (bruitage mélangé) à chaque changement par touche, pas à l'entrée ni via select()", async () => {
    const h = await harness("vertical", { changeSound: "bip.voc" });
    expect(h.effects).toEqual([]);
    h.input.keyDown("ArrowDown");
    h.step();
    h.input.keyUp("ArrowDown");
    expect(h.effects).toEqual(["bip.voc"]);
    h.menu.select(h.ctx, 2);
    expect(h.effects).toEqual(["bip.voc"]);
    expect(h.voices).toEqual([]); // la voie n'est pas touchée
    // Sans changement (borné) : pas de bip.
    const b = await harness("vertical", { wrap: false, changeSound: "bip.voc" });
    b.input.keyDown("ArrowUp");
    b.step();
    expect(b.effects).toEqual([]);
  });

  it("changeSoundIfIdle : le bip n'est lancé que si aucun bruitage ne sonne ; sinon il remplace le bruitage", async () => {
    const idle = await harness("vertical", { changeSound: "bip.voc", changeSoundIfIdle: true });
    idle.busy.effect = true;
    idle.input.keyDown("ArrowDown");
    idle.step();
    idle.input.keyUp("ArrowDown");
    expect(idle.effects).toEqual([]);
    idle.busy.effect = false;
    idle.input.keyDown("ArrowDown");
    idle.step();
    expect(idle.effects).toEqual(["bip.voc"]);

    const replace = await harness("vertical", { changeSound: "bip.voc" });
    replace.busy.effect = true;
    replace.input.keyDown("ArrowDown");
    replace.step();
    expect(replace.effects).toEqual(["bip.voc"]);
  });

  it("valide à Espace et au clic gauche, sans tenir compte de la position du pointeur", async () => {
    const h = await harness("vertical");
    h.input.keyDown("Space");
    expect(h.step()).toEqual({ kind: "validate", index: 0 });
    h.input.keyUp("Space");

    h.input.mouseMove(150, 70);
    h.step();
    expect(h.menu.index).toBe(0); // le survol ne sélectionne rien
    h.input.mouseDown(0);
    expect(h.step()).toEqual({ kind: "validate", index: 0 });
  });

  it("joue la voix d'aide au clic droit / Entrée, jamais à la simple sélection", async () => {
    const h = await harness("vertical");
    h.input.keyDown("ArrowDown");
    h.step();
    expect(h.voices).toEqual([]);
    h.input.keyUp("ArrowDown");
    h.input.keyDown("Enter");
    expect(h.step()).toEqual({ kind: "help", index: 1 });
    expect(h.voices).toEqual(["b.voc"]);
    h.input.keyUp("Enter");
    // Clic droit sur un élément sans voix : l'événement est renvoyé, rien ne joue.
    h.input.keyDown("ArrowDown");
    h.step();
    h.input.keyUp("ArrowDown");
    h.input.mouseDown(2);
    expect(h.step()).toEqual({ kind: "help", index: 2 });
    expect(h.voices).toEqual(["b.voc"]);
  });

  it("select() change l'élément courant et sa surbrillance", async () => {
    const h = await harness("vertical");
    h.menu.select(h.ctx, 2);
    expect(h.menu.index).toBe(2);
    expect(h.lit()).toEqual([2]);
    h.menu.exit(h.ctx);
    expect(h.lit()).toEqual([]);
  });
});
