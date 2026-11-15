import { describe, expect, it } from "vitest";
import { readAnm } from "../../../src/games/tim3/data/anm";
import { parseLines } from "../../../src/games/tim3/data/text";
import { stateImage } from "../../../src/games/tim3/render";
import type { Part } from "../../../src/games/tim3/engine/part";
import { BALL_STEPS, PROGRAM_TYPES, parseProgramRows, type ProgramRow } from "../../../src/games/tim3/engine/program";
import { DEFAULT_LAB, Tim3Session, labLevel } from "../../../src/games/tim3/engine/session";
import { baseIndex, frenchIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";

let cache: ProgramRow[] | undefined;
const rows = (): ProgramRow[] => (cache ??= parseProgramRows(parseLines(baseIndex().get("PROGPART.RES"))));

/** Labo vide avec une pièce de ce type posée en (x, y). */
function lab(type: number, x = 200, y = 150): { s: Tim3Session; p: Part } {
  const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: { ...DEFAULT_LAB } });
  const p = s.editor.takeNew(type);
  expect(s.editor.click(x, y)).toBe("placed");
  return { s, p };
}

describe("PROGPART.RES (425147)", () => {
  it("colonnes lues par atoi aux octets 0, 4, 8 ; en-tête et lignes vides ignorés", () => {
    const r = parseProgramRows(["> Resource file", "", "  4   2   59   Helium Filled", "137  34   66   Timer 0"]);
    expect(r).toEqual([
      { type: 4, state: 2, preview: 59, text: "Helium Filled" },
      { type: 137, state: 34, preview: 66, text: "Timer 0" },
    ]);
  });
});

describe.skipIf(!original.has)("fenêtre « programmer » (4249f8)", () => {
  it("les types à écran PROG<type>.ITF, et eux seuls, ouvrent la fenêtre", () => {
    const opened = PROGRAM_TYPES.filter((t) => {
      const { s, p } = lab(t, 120, 120);
      return s.editor.program(p, rows()) !== null;
    });
    expect(opened).toEqual([...PROGRAM_TYPES]);
    const { s, p } = lab(0);
    expect(s.editor.program(p, rows())).toBeNull();
  });

  it("minuteur 137 : flèches avec bouclage, image appliquée à « Terminé » seulement", () => {
    const { s, p } = lab(137);
    const prog = s.editor.program(p, rows())!;
    expect(prog.kind).toBe("choices");
    expect(prog.choices.length).toBe(8);
    const before = p.frame;
    prog.up(); // du premier au dernier
    expect(prog.index).toBe(prog.choices.length - 1);
    expect(p.frame).toBe(before);
    prog.down(); // du dernier au premier
    expect(prog.index).toBe(0);
    prog.down();
    expect(prog.done()).toBe(true);
    expect([p.frame, p.editFrame]).toEqual([prog.choices[1]!.frame, prog.choices[1]!.frame]);
    // Réouverture : le choix courant est celui de l'image d'édition.
    expect(s.editor.program(p, rows())!.index).toBe(1);
  });

  it("pistolet laser 27 : compteur +0xFC de 0 à 99", () => {
    const { s, p } = lab(27);
    const prog = s.editor.program(p, rows())!;
    expect(prog.kind).toBe("counter");
    prog.down();
    expect(prog.counter).toBe(0);
    for (let i = 0; i < 120; i++) prog.up();
    expect(prog.counter).toBe(99);
    prog.done();
    expect(p.fFC).toBe(99);
  });

  it("balle programmable 87 : réglettes (paliers de l'exe) appliquées à la masse et aux réglages", () => {
    const { s, p } = lab(87);
    const prog = s.editor.program(p, rows())!;
    expect(prog.kind).toBe("ball");
    prog.setBall("mass", 10);
    prog.setBall("density", 3);
    prog.setBall("elasticity", 12);
    prog.setBall("friction", -1);
    prog.done();
    expect([p.mass, p.prog![0], p.prog![1], p.prog![2]]).toEqual([28000, BALL_STEPS.density[3], 396, 0]);
    const again = s.editor.program(p, rows())!;
    expect(again.ball).toEqual({ mass: 10, density: 3, elasticity: 10, friction: 0 });
    // La masse réglée survit à Démarrer (43ada7 garde celle du type 0x57).
    s.start();
    expect(s.world.mobiles.toArray().find((q) => q.type === 87)!.mass).toBe(28000);
  });

  it("seau troué 108 : réglette 0 … 5, choix = 5 − réglette", () => {
    const { s, p } = lab(108);
    const prog = s.editor.program(p, rows())!;
    expect(prog.kind).toBe("bucket");
    prog.setBucket(5);
    expect(prog.index).toBe(0);
    prog.setBucket(9);
    expect(prog.bucket).toBe(5);
    prog.setBucket(0);
    expect(prog.index).toBe(5);
    prog.done();
    expect(p.editFrame).toBe(prog.choices[5]!.frame);
  });

  it("boîtes 71 : appliquées tout de suite, « Terminé » refusé si elles chevauchent ; Échap les remet", () => {
    const { s, p } = lab(71, 100, 300);
    // Les boîtes grandissent vers le bas : un mur 48 px sous le coin chevauche la plus haute (64 px).
    const wall = s.editor.takeNew(1);
    expect(s.editor.click(p.px + 8, p.py + 48)).toBe("placed");
    expect(wall.py).toBe(p.py + 48);
    const prog = s.editor.program(p, rows())!;
    const start = p.frame;
    let refused = false;
    for (let i = 0; i < prog.choices.length; i++) {
      prog.down();
      expect(p.frame).toBe(prog.choice!.frame);
      if (!prog.fits) {
        refused = true;
        expect(prog.refusal).toBe("box");
        expect(prog.done()).toBe(false);
        break;
      }
    }
    expect(refused).toBe(true);
    prog.cancel();
    expect(p.frame).toBe(start);
  });

  it("tuyau 97 étiré en hauteur : largeur 38, hauteur sur la grille de 16 (44750d)", () => {
    const { s, p } = lab(97, 200, 100);
    expect([p.boxW, p.boxH]).toEqual([48, 38]);
    expect(s.editor.resizeEdge(p, 6, p.px, p.py + 229)).toBe(true);
    expect([p.boxW, p.boxH]).toEqual([38, 224]);
    expect(s.world.resizeHandle).toBe(0);
  });
});

describe.skipIf(!original.has)("aperçus de la fenêtre « programmer »", () => {
  it("chaque ligne de PROGPART.RES désigne un état de PROGPART.ANM et un état de l'ANM de la pièce", () => {
    const anm = readAnm(frenchIndex().get("PROGPART.ANM"));
    const types = realTypes();
    const missing = rows().filter((r) => stateImage(anm, r.preview) < 0 || !types.anims[r.type]?.anm.states.some((s) => s.state === r.state));
    expect(missing).toEqual([]);
  });
});
