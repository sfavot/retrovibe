import { describe, expect, it } from "vitest";
import { readLev } from "../../../src/games/tim3/data/lev";
import { Editor, Zone, createPart } from "../../../src/games/tim3/engine/editor";
import { cloneWorld, labLevel, DEFAULT_LAB, Tim3Session } from "../../../src/games/tim3/engine/session";
import type { Part } from "../../../src/games/tim3/engine/part";
import { realTypes } from "../engine/helpers";
import { frenchIndex, original } from "../data/real";

function session(name: string): Tim3Session {
  return new Tim3Session(realTypes(), readLev(frenchIndex().get(`${name}.LEV`)));
}

const placed = (s: Tim3Session): Part[] => [...s.world.staticThenMobile()];

/** Pose une pièce du bac de ce type au point donné ; rend la pièce et le résultat. */
function drop(s: Tim3Session, type: number, x: number, y: number) {
  const p = s.editor.binParts().find((q) => q.type === type)!;
  s.editor.takeFromBin(p);
  return { p, result: s.editor.click(x, y) };
}

describe.skipIf(!original.has)("éditeur (42e660, 42f24a…)", () => {
  it("pose une pièce du bac sur la grille de 16 (décalée de 8) et la range dans les mobiles", () => {
    const s = session("TLEV1");
    const { p, result } = drop(s, 0, 100, 100);
    expect(result).toBe("placed");
    expect(s.editor.held).toBeNull();
    if (p.flags14 & 8) expect([p.px, p.py]).toEqual([100 - (p.frameW >> 1), 100 - (p.frameH >> 1)]);
    else expect([(p.px - 8) & 15, (p.py - 8) & 15]).toEqual([0, 0]);
    expect([...s.world.mobiles].includes(p)).toBe(true);
    expect(s.editor.binParts().includes(p)).toBe(false);
    expect([p.editX, p.editY]).toEqual([p.px, p.py]);
  });

  it("refuse une pose qui chevauche une autre pièce (437208) et garde la pièce en main", () => {
    const s = session("TLEV1");
    const { p, result } = drop(s, 0, 445 + 16, 330); // sur le sol en brique
    expect(result).toBe("refused");
    expect(s.editor.held).toBe(p);
    expect(s.editor.hover(100, 100).valid).toBe(true);
    expect(s.editor.hover(461, 330).valid).toBe(false);
  });

  it("les pièces verrouillées ne bougent pas", () => {
    const s = session("TLEV1");
    const wall = placed(s).find((p) => p.type === 1)!;
    expect(s.editor.isMovable(wall)).toBe(false);
    s.editor.grab(wall, wall.px, wall.py);
    expect(s.editor.held).toBeNull();
    expect(s.editor.zoneAt(wall, wall.px + 2, wall.py + 2)).toBe(Zone.None);
  });

  it("saisir une pièce posée la remet au bac le temps qu'on la tient, puis la repose ailleurs", () => {
    const s = session("TLEV1");
    const { p } = drop(s, 0, 100, 100);
    expect(s.editor.zoneAt(p, p.px + 4, p.py + 4)).toBe(Zone.Body);
    s.editor.grab(p, p.px + 4, p.py + 4);
    expect(s.editor.held).toBe(p);
    expect([...s.world.bin]).toContain(p);
    expect(s.editor.click(200, 100)).toBe("placed");
    expect(p.px).toBeGreaterThan(150);
  });

  it("poignée « retirer » (coin haut gauche) : la pièce retourne au bac", () => {
    const s = session("TLEV1");
    const { p } = drop(s, 0, 100, 100);
    expect(s.editor.zoneAt(p, p.px - 10, p.py - 10)).toBe(Zone.Remove);
    s.editor.removeToBin(p);
    expect(placed(s)).not.toContain(p);
    expect(s.editor.binParts()).toContain(p);
  });

  it("Échap pendant qu'on tient une pièce : retour au bac", () => {
    const s = session("TLEV1");
    const p = s.editor.binParts()[0]!;
    s.editor.takeFromBin(p);
    s.editor.returnHeld();
    expect(s.editor.held).toBeNull();
    expect(s.editor.binParts()).toContain(p);
  });

  it("retourner (X) et taille (+/−) dans les bornes du type", () => {
    const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });
    // Pente en bois (2) : retournable en X, étirable.
    const slope = s.editor.takeNew(2);
    expect(s.editor.click(200, 200)).toBe("placed");
    const flags = slope.flags10;
    expect(s.editor.flip(slope, "x")).toBe(true);
    expect(slope.flags10 ^ flags).toBe(0x10);
    expect(slope.editFlags10).toBe(slope.flags10);
    const w = slope.boxW;
    const d = s.types.get(2);
    if (w < d.f3C) {
      expect(s.editor.resize(slope, 1)).toBe(true);
      expect(slope.boxW).toBe(w + 16);
    }
    for (let i = 0; i < 20 && s.editor.resize(slope, -1); i++);
    expect(slope.boxW).toBeLessThanOrEqual(d.f44);
    expect(s.editor.resize(slope, -1)).toBe(false);
    // Pente : l'inclinaison suit la largeur (43c5f6).
    expect(slope.frame).toBe(Math.trunc(slope.boxW / 16) - 1);
  });

  it("une pièce sans retournement ne se retourne pas", () => {
    const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });
    const ball = s.editor.takeNew(0);
    s.editor.click(100, 100);
    if (!(ball.flags0C & 0x600)) expect(s.editor.flip(ball, "x")).toBe(false);
  });

  it("courroie en deux appuis entre deux pièces qui l'acceptent, à moins de 140 px", () => {
    const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });
    // Moteur électrique (50) et générateur à hamster (26) / roue : on cherche deux types qui acceptent une courroie.
    const beltable = Editor.labTypes(s.world).filter((t) => {
      const q = createPart(s.world, t);
      s.world.bin.remove(q);
      return (q.flags10 & 1) !== 0 && t !== 8;
    });
    expect(beltable.length).toBeGreaterThan(1);
    const a = s.editor.takeNew(beltable[0]!);
    expect(s.editor.click(100, 100)).toBe("placed");
    const b = s.editor.takeNew(beltable[0]!);
    expect(s.editor.click(200, 100)).toBe("placed");
    const belt = s.editor.takeNew(8);
    const ra = s.editor.partRect(a);
    const rb = s.editor.partRect(b);
    s.editor.hover(ra.x + (ra.w >> 1), ra.y + (ra.h >> 1));
    expect(s.editor.click(ra.x + (ra.w >> 1), ra.y + (ra.h >> 1))).toBe("linking");
    s.editor.hover(rb.x + (rb.w >> 1), rb.y + (rb.h >> 1));
    expect(s.editor.click(rb.x + (rb.w >> 1), rb.y + (rb.h >> 1))).toBe("linked");
    expect(belt.belt?.end1).toBe(a);
    expect(belt.belt?.end2).toBe(b);
    expect(placed(s)).toContain(belt);
    // Retirer une des pièces : la courroie part au bac sans ses bouts (liens orphelins supprimés).
    s.editor.removeToBin(a);
    expect(belt.belt?.end1 ?? null).toBeNull();
    expect(belt.belt?.end2 ?? null).toBeNull();
    expect(placed(s)).not.toContain(belt);
    expect(b.belt).toBeNull();
  });

  it("corde en deux appuis entre deux pièces qui l'acceptent ; la retirer libère les deux bouts", () => {
    const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });
    const ropeable = Editor.labTypes(s.world).filter((t) => {
      const q = createPart(s.world, t);
      s.world.bin.remove(q);
      return (q.flags10 & 4) !== 0 && t !== 7 && !(q.flags10 & 8);
    });
    expect(ropeable.length).toBeGreaterThan(0);
    const a = s.editor.takeNew(ropeable[0]!);
    expect(s.editor.click(80, 100)).toBe("placed");
    const b = s.editor.takeNew(ropeable[0]!);
    expect(s.editor.click(300, 100)).toBe("placed");
    const rope = s.editor.takeNew(10);
    const at = (p: Part) => {
      const r = s.editor.partRect(p);
      return [r.x + (r.w >> 1), r.y + (r.h >> 1)] as const;
    };
    expect(s.editor.click(...at(a))).toBe("linking");
    expect(s.editor.click(...at(a))).toBe("refused");
    expect(s.editor.click(...at(b))).toBe("linked");
    const data = rope.ropes[0]!;
    expect([data.end1, data.end2]).toEqual([a, b]);
    expect(a.ropes[0]).toBe(data);
    s.editor.removeToBin(rope);
    expect(a.ropes[0]).toBeNull();
    expect(b.ropes[0]).toBeNull();
  });

  it("« Dégager la zone de jeu » rend au bac toutes les pièces non verrouillées", () => {
    const s = session("TLEV1");
    drop(s, 0, 100, 100);
    drop(s, 9, 200, 100);
    const before = s.editor.binParts().length;
    s.editor.clearField();
    expect(s.editor.binParts().length).toBe(before + 2);
    expect(placed(s).every((p) => !s.editor.isMovable(p))).toBe(true);
  });
});

describe.skipIf(!original.has)("session : Démarrer / Arrêter", () => {
  it("Arrêter restaure exactement l'état d'édition", () => {
    const s = session("TLEV1");
    drop(s, 59, 456, 249); // balle magique (placement libre, +0x14 & 8) en (444, 237)
    const snap = (w = s.world) =>
      [...w.staticThenMobile()].map((p) => [p.type, p.levIndex, p.px, p.py, p.fx, p.fy, p.vx, p.vy, p.frame, p.flags0C, p.flags10, p.flags14].join(","));
    const binBefore = s.editor.binParts().map((p) => p.levIndex);
    const before = snap();
    s.start();
    for (let i = 0; i < 40; i++) s.tick();
    expect(snap()).not.toEqual(before);
    s.stop();
    expect(snap()).toEqual(before);
    expect(s.editor.binParts().map((p) => p.levIndex)).toEqual(binBefore);
    expect(s.mode).toBe("edit");
  });

  it("puzzle réussi : la machine s'arrête d'elle-même et revient en édition", () => {
    const s = session("TLEV1");
    drop(s, 59, 456, 249); // balle magique (placement libre, +0x14 & 8) en (444, 237)
    s.start();
    let solvedAt = -1;
    for (let i = 1; i <= 200 && solvedAt < 0; i++) if (s.tick().solved) solvedAt = i;
    expect(solvedAt).toBe(63 + 30);
    expect(s.running).toBe(false);
  });

  it("copie du monde : références entre pièces conservées, polygones des types partagés", () => {
    const s = session("TLEV3");
    const copy = cloneWorld(s.world);
    const a = [...s.world.staticThenMobile()];
    const b = [...copy.staticThenMobile()];
    expect(b.length).toBe(a.length);
    const problems: string[] = [];
    b.forEach((p, i) => {
      const o = a[i]!;
      if (p === o) problems.push(`${i} : même objet`);
      if (o.poly && s.types.get(o.type).polygons?.includes(o.poly) && p.poly !== o.poly) problems.push(`${i} : polygone copié`);
      for (const r of p.ropes) if (r && a.includes(r.ropePart)) problems.push(`${i} : corde de l'original`);
    });
    expect(problems).toEqual([]);
    expect(copy.types === s.world.types).toBe(true);
  });

  it("sons : commandes des images qui changent", () => {
    const s = session("TLEV1");
    drop(s, 59, 456, 249); // balle magique (placement libre, +0x14 & 8) en (444, 237)
    s.start();
    for (let i = 0; i < 100; i++) s.tick();
    expect(Array.isArray(s.drainEffects())).toBe(true);
    expect(s.drainEffects()).toEqual([]);
  });

  it("sons des handlers (World.sound / stopSound) : relevés en marche seulement, file du pas vidée", () => {
    const s = session("TLEV1");
    const part = s.editor.binParts()[0]!;
    s.world.sound(0xbcd, part, 2, 1);
    expect(s.drainEffects()).toEqual([]);
    s.start();
    s.world.sound(0xbcd, part, 2, 1);
    s.world.stopSound(0xbcd);
    s.tick();
    const fx = s.drainEffects();
    expect(fx.slice(0, 2)).toEqual([
      { id: 0xbcd, priority: 2, flags: 1 },
      { id: 0xbcd, priority: 0, flags: 0, stop: true },
    ]);
    expect(s.world.sounds).toEqual([]);
    // Après Arrêter, le monde restauré garde ses crochets.
    s.stop();
    s.start();
    s.world.sound(0xc40, part);
    expect(s.drainEffects()).toEqual([{ id: 0xc40, priority: 0, flags: 0 }]);
  });
});

describe.skipIf(!original.has)("Labo", () => {
  it("palette des types, pièces sans limite, réglages de gravité et pression, pas de but", () => {
    const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: { ...DEFAULT_LAB } });
    const types = Editor.labTypes(s.world);
    expect(types.length).toBeGreaterThan(80);
    expect(types).not.toContain(0x37); // explosifs : créés par la télécommande (42f57b)
    const a = s.editor.takeNew(0);
    expect(s.editor.click(100, 100)).toBe("placed");
    const b = s.editor.takeNew(0);
    expect(s.editor.click(200, 100)).toBe("placed");
    expect(a).not.toBe(b);
    // Une pièce du Labo rangée disparaît (pas de bac à remplir).
    s.editor.removeToBin(b);
    expect(s.editor.binParts()).not.toContain(b);
    s.setLab({ gravity: 100, pressure: 10 });
    expect([s.world.gravity, s.world.pressure]).toEqual([100, 10]);
    s.start();
    expect(s.tick()).toEqual({ goal: 0, solved: false });
    s.stop();
    s.setLab(DEFAULT_LAB);
  });

  it("taille par défaut d'une pièce neuve : boîte du type, sinon forme du PAR", () => {
    const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: { ...DEFAULT_LAB } });
    const wall = createPart(s.world, 1);
    const lamp = createPart(s.world, 25);
    expect([wall.boxW, wall.boxH]).toEqual([32, 16]);
    expect([lamp.boxW, lamp.boxH]).toEqual([46, 21]);
  });
});
