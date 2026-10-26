import { describe, expect, it } from "vitest";
import {
  KEY_ROWS,
  KEY_SLOTS,
  clampAxes,
  codeOfScan,
  cycleAxis,
  defaultProfile,
  motionOnKeys,
  padButtonOfScan,
  parseProfile,
  scanOfCode,
  scanOfMouseButton,
} from "../../../src/games/swiv3d/screens/controllers";

describe("profil de contrôleur", () => {
  it("touches et axes par défaut posés au changement de type (`004171b4`)", () => {
    expect(defaultProfile(1)).toEqual({ type: 1, keys: [0xcb, 0xcd, 0xc8, 0xd0, 0x33, 0x34, 0x39, 0x32, 0xc9, 0xd1, 0x1d], axes: [1, 2, 0], clip: 1 });
    // souris : tir sur les boutons gauche / droit, latéral sur les flèches, X tourne
    expect(defaultProfile(2)).toMatchObject({ keys: [0xcb, 0xcd, 0xc8, 0xd0, 0xcb, 0xcd, 0x90, 0x91, 0xc9, 0xd1, 0x1d], axes: [1, 0, 0] });
    // manette : boutons 1, 2 (tir), 3 (frein), sélection sur les flèches haut / bas
    expect(defaultProfile(3)).toMatchObject({ keys: [0xcb, 0xcd, 0xc8, 0xd0, 0xcb, 0xcd, 0x93, 0x94, 0xc8, 0xd0, 0x95], axes: [1, 2, 0] });
    expect(defaultProfile(1)).not.toBe(defaultProfile(1));
  });

  it("lignes du menu -> rang de la touche (`+0x10`..`+0x38`), « Freiner » en dernier", () => {
    expect(KEY_SLOTS[KEY_ROWS[28]!]).toBe("brake");
    expect(KEY_SLOTS[KEY_ROWS[29]!]).toBe("firePrimary");
    expect(KEY_SLOTS[KEY_ROWS[32]!]).toBe("weaponPrev");
  });

  it("axes : suivant puis retour au clavier selon le nombre d'axes du type ; les touches d'un mouvement lié disparaissent", () => {
    const mouse = defaultProfile(2);
    cycleAxis(mouse, 0);
    expect(mouse.axes[0]).toBe(2);
    cycleAxis(mouse, 0);
    expect(mouse.axes[0]).toBe(0);
    const pad = defaultProfile(3);
    expect(motionOnKeys(pad, 0)).toBe(false);
    expect(motionOnKeys(pad, 2)).toBe(true);
    expect(motionOnKeys(defaultProfile(1), 0)).toBe(true); // clavier : axes ignorés
    const odd = { ...defaultProfile(2), axes: [3, 1, 2] as [number, number, number] };
    clampAxes(odd);
    expect(odd.axes).toEqual([0, 1, 2]);
  });

  it("codes de balayage <-> touches physiques, boutons de souris et de manette", () => {
    expect(codeOfScan(0x1e)).toBe("KeyA");
    expect(codeOfScan(0xc8)).toBe("ArrowUp");
    expect(codeOfScan(0x45)).toBe("Pause");
    expect(scanOfCode("ControlRight")).toBe(0x9d);
    expect(scanOfCode("NumpadEnter")).toBe(0x9c);
    expect(scanOfCode("MetaLeft")).toBeUndefined();
    for (let scan = 1; scan < 256; scan++) {
      const code = codeOfScan(scan);
      if (code) expect(scanOfCode(code)).toBe(scan);
    }
    expect([0, 2, 1, 3].map(scanOfMouseButton)).toEqual([0x90, 0x91, 0x92, undefined]);
    expect([0x92, 0x93, 0x9a, 0x9b].map(padButtonOfScan)).toEqual([undefined, 0, 7, undefined]);
  });

  it("relit la sauvegarde : type absent = non configuré, champs invalides remplacés par les défauts", () => {
    expect(parseProfile(undefined)).toBeNull();
    expect(parseProfile({ type: 4 })).toBeNull();
    expect(parseProfile({ type: 3, keys: [0x1e, "x", -1], axes: [9, 3], clip: 0 })).toEqual({
      type: 3,
      keys: [0x1e, 0xcd, 0xc8, 0xd0, 0xcb, 0xcd, 0x93, 0x94, 0xc8, 0xd0, 0x95],
      axes: [1, 3, 0],
      clip: 0,
    });
  });
});
