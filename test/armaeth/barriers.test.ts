import { describe, expect, it } from "vitest";
import { messageId } from "../../src/games/armaeth/data/text";
import { parseWorld } from "../../src/games/armaeth/data/world";
import {
  BARRIER_CODES,
  BARRIER_MESSAGES,
  barrierResult,
  checkBarrier,
  type BarrierSubject,
  type BarrierWorld,
} from "../../src/games/armaeth/engine/barriers";
import { hasOriginalFiles, readOriginal } from "./helpers";

function subject(extra: Partial<BarrierSubject> & { carried?: number[] } = {}): BarrierSubject {
  const { carried = [], ...rest } = extra;
  return { num: 1, txt: 0, ground: 2, dep: 0, mob: 2, p: 50, isHero: true, inRoom: true, carries: (n) => carried.includes(n), ...rest };
}

interface WorldOptions {
  ego?: Record<number, number>;
  night?: boolean;
  chance?: boolean;
  room?: number;
  guard?: Partial<Record<309 | 329, boolean>>;
  doorP?: number;
}

function worldOf(options: WorldOptions = {}): BarrierWorld & { draws: number } {
  const state = { draws: 0 };
  return {
    get draws() {
      return state.draws;
    },
    ego: (num) => {
      const value = options.ego?.[num];
      if (value === undefined) throw new Error(`objet ${num} absent`);
      return value;
    },
    objectP: () => options.doorP ?? 100,
    currentRoom: options.room ?? 1,
    isNight: () => options.night ?? false,
    chance: () => {
      state.draws++;
      return options.chance ?? false;
    },
    guard: (_o, key) => options.guard?.[key] ?? false,
  };
}

const blocked = (code: number, o: BarrierSubject, w = worldOf(), mode = 1) => checkBarrier(code, mode, o, w).blocked;

describe("codes de barrage : prédicats", () => {
  it("0, 8, 105, 205 à 209, 7 et les codes inconnus : jamais bloqués", () => {
    for (const code of [0, 7, 8, 105, 205, 206, 207, 208, 209, 999]) expect(blocked(code, subject({ num: 3 }))).toBe(false);
  });

  it("1 : la pie ; 2 : tous sauf héros et ours ; 3 : tous sauf héros et pie", () => {
    expect([1, 3, 4, 201].map((num) => blocked(1, subject({ num })))).toEqual([false, true, false, false]);
    expect([1, 4, 3].map((num) => blocked(2, subject({ num })))).toEqual([false, false, true]);
    expect([1, 3, 4].map((num) => blocked(3, subject({ num })))).toEqual([false, false, true]);
  });

  it("4 : bloque sauf les volants et les objets immatériels", () => {
    expect(blocked(4, subject())).toBe(true);
    expect(blocked(4, subject({ dep: 1 }))).toBe(false);
    expect(blocked(4, subject({ txt: 2 }))).toBe(false);
  });

  it("5 : tout sauf la pie ; la pie passe la nuit ou sur un tirage ; 6 : la pie passe sur un tirage", () => {
    expect(blocked(5, subject({ num: 1 }))).toBe(true);
    expect(blocked(5, subject({ num: 3 }), worldOf({ night: true }))).toBe(false);
    expect(blocked(5, subject({ num: 3 }), worldOf({ chance: true }))).toBe(false);
    expect(blocked(5, subject({ num: 3 }), worldOf({ chance: false }))).toBe(true);
    expect(blocked(6, subject({ num: 3 }), worldOf({ chance: true }))).toBe(false);
    expect(blocked(6, subject({ num: 3 }), worldOf({ night: true }))).toBe(true);
    expect(blocked(6, subject({ num: 4 }), worldOf({ chance: true }))).toBe(true);
  });

  it("5 ne tire au sort que si nécessaire (nuit ou autre créature : aucun tirage)", () => {
    const w = worldOf({ night: true });
    blocked(5, subject({ num: 3 }), w);
    blocked(5, subject({ num: 1 }), w);
    expect(w.draws).toBe(0);
  });

  it("101 et 104 : la dalle de granite (Ego du Num 16 = 4) ; la pie et l'ours ne passent jamais en 101", () => {
    const closed = worldOf({ ego: { 16: 6 } });
    const open = worldOf({ ego: { 16: 4 } });
    expect(blocked(101, subject(), closed)).toBe(true);
    expect(blocked(101, subject(), open)).toBe(false);
    expect(blocked(101, subject({ num: 4 }), open)).toBe(true);
    expect(blocked(101, subject({ txt: 2 }), closed)).toBe(false);
    expect(blocked(104, subject(), closed)).toBe(true);
    expect(blocked(104, subject({ num: 4 }), open)).toBe(false);
  });

  it("102 : seul le héros passe, sauf la porte ouverte, sauf un objet de la salle 110 devant la porte", () => {
    expect(blocked(102, subject({ isHero: true }), worldOf({ ego: { 103: 0 } }))).toBe(false);
    expect(blocked(102, subject({ isHero: false, num: 4 }), worldOf({ ego: { 103: 0 } }))).toBe(true);
    expect(blocked(102, subject({ isHero: false }), worldOf({ ego: { 103: 3 } }))).toBe(false);
    expect(blocked(102, subject({ isHero: false, txt: 2 }), worldOf({ ego: { 103: 0 } }))).toBe(false);
    const inFront = worldOf({ ego: { 103: 0 }, room: 110, doorP: 100 });
    expect(blocked(102, subject({ isHero: false, p: 80 }), inFront)).toBe(false);
    expect(blocked(102, subject({ isHero: false, p: 120 }), inFront)).toBe(true);
  });

  it("103 : bloque si l'entité 329 n'est pas dans l'état voulu", () => {
    expect(blocked(103, subject(), worldOf({ guard: { 329: false } }))).toBe(true);
    expect(blocked(103, subject(), worldOf({ guard: { 329: true } }))).toBe(false);
    expect(blocked(103, subject({ txt: 2 }), worldOf())).toBe(false);
  });

  it("201 et 204 : la lourde dalle (Num 104 à l'état 3) ; 202 : seul le héros (Num 1) ; 203 : aucun mobile sauf le héros", () => {
    const closed = worldOf({ ego: { 104: 0 } });
    const open = worldOf({ ego: { 104: 3 } });
    expect([201, 204].map((code) => blocked(code, subject(), closed))).toEqual([true, true]);
    expect([201, 204].map((code) => blocked(code, subject(), open))).toEqual([false, false]);
    expect(blocked(202, subject({ num: 1 }))).toBe(false);
    expect(blocked(202, subject({ num: 201 }))).toBe(true);
    expect(blocked(203, subject({ isHero: false, mob: 2 }))).toBe(true);
    expect(blocked(203, subject({ isHero: false, mob: 0 }))).toBe(false);
    expect(blocked(203, subject({ isHero: true }))).toBe(false);
  });

  it("301 et 302 : la herse (Num 207 à l'état 3) ; 302 bloque aussi le nain 301 et les cases 64 / 91 sans l'entité 309", () => {
    const closed = worldOf({ ego: { 207: 0 } });
    const open = worldOf({ ego: { 207: 3 } });
    expect(blocked(301, subject(), closed)).toBe(true);
    expect(blocked(301, subject(), open)).toBe(false);
    expect(blocked(302, subject({ num: 301 }), open)).toBe(true);
    expect(blocked(302, subject({ ground: 64 }), worldOf({ ego: { 207: 3 } }))).toBe(true);
    expect(blocked(302, subject({ ground: 64 }), worldOf({ ego: { 207: 3 }, guard: { 309: true } }))).toBe(false);
    expect(blocked(302, subject({ ground: 64, txt: 2 }), open)).toBe(false);
  });

  it("303 à 306 : nains, Minas sans l'objet 320, cases 64 / 91", () => {
    expect(blocked(303, subject({ num: 301 }))).toBe(true);
    expect(blocked(303, subject({ ground: 91 }), worldOf({ guard: { 309: true } }))).toBe(false);
    expect([201, 202, 203, 204, 301, 1].map((num) => blocked(304, subject({ num })))).toEqual([true, true, true, true, true, false]);
    expect(blocked(305, subject({ num: 303 }))).toBe(true);
    expect(blocked(305, subject({ num: 303, carried: [320] }))).toBe(false);
    expect(blocked(305, subject({ num: 1 }))).toBe(false);
    expect(blocked(306, subject({ num: 301 }), worldOf({ guard: { 329: true } }))).toBe(true);
    expect(blocked(306, subject(), worldOf({ guard: { 329: true } }))).toBe(false);
    expect(blocked(306, subject(), worldOf({ guard: { 329: false } }))).toBe(true);
    expect(blocked(306, subject({ ground: 64 }), worldOf({ guard: { 329: true, 309: false } }))).toBe(true);
  });

  it("307 : par type de case (57 / 113 ; 56 / 114 avec l'entité 316 ; autre) et l'entité 329", () => {
    const good = worldOf({ ego: { 316: 3 }, guard: { 329: true } });
    expect(blocked(307, subject({ ground: 57 }), good)).toBe(true);
    expect(blocked(307, subject({ ground: 113 }), good)).toBe(true);
    expect(blocked(307, subject({ ground: 56 }), good)).toBe(false);
    expect(blocked(307, subject({ ground: 114 }), worldOf({ ego: { 316: 0 }, guard: { 329: true } }))).toBe(true);
    expect(blocked(307, subject({ ground: 2 }), good)).toBe(false);
    expect(blocked(307, subject({ ground: 2 }), worldOf({ ego: { 316: 3 }, guard: { 329: false } }))).toBe(true);
    expect(blocked(307, subject({ ground: 57, txt: 2 }), good)).toBe(false);
  });

  it("308 : types 58 / 112 selon 316, 57 / 113 inverse, sinon la herse 317 ; 309 : la herse 317", () => {
    const d = (ego316: number, ego317 = 0) => worldOf({ ego: { 316: ego316, 317: ego317 } });
    expect(blocked(308, subject({ ground: 58 }), d(0))).toBe(true);
    expect(blocked(308, subject({ ground: 112 }), d(3))).toBe(false);
    expect(blocked(308, subject({ ground: 57 }), d(3))).toBe(true);
    expect(blocked(308, subject({ ground: 113 }), d(0))).toBe(false);
    expect(blocked(308, subject({ ground: 2 }), d(0, 3))).toBe(false);
    expect(blocked(308, subject({ ground: 2 }), d(0, 0))).toBe(true);
    expect(blocked(309, subject(), d(0, 0))).toBe(true);
    expect(blocked(309, subject(), d(0, 3))).toBe(false);
    expect(blocked(309, subject({ txt: 2 }), d(0, 0))).toBe(false);
  });
});

describe("codes de barrage : messages, orientation et résultat", () => {
  const closed = worldOf({ ego: { 16: 6, 104: 0, 207: 0, 317: 0 } });

  it("message de classe C seulement pour mode != 0, objet héros et barrage bloquant", () => {
    expect(checkBarrier(101, 1, subject(), closed).message).toBe(messageId("C", 101));
    expect(checkBarrier(101, 2, subject(), closed).message).toBe(messageId("C", 101));
    expect(checkBarrier(101, 0, subject(), closed).message).toBeNull();
    expect(checkBarrier(101, 1, subject({ isHero: false }), closed).message).toBeNull();
    expect(checkBarrier(101, 1, subject({ txt: 2 }), closed).message).toBeNull();
    expect(checkBarrier(201, 1, subject(), closed).message).toBe(messageId("C", 201));
    expect(checkBarrier(204, 1, subject(), closed).message).toBe(messageId("C", 201));
    expect(checkBarrier(301, 1, subject(), closed).message).toBe(messageId("C", 301));
    expect(checkBarrier(302, 1, subject(), closed).message).toBe(messageId("C", 301));
    expect(checkBarrier(309, 1, subject(), closed).message).toBe(messageId("C", 302));
    expect(checkBarrier(308, 1, subject(), worldOf({ ego: { 316: 0, 317: 0 } })).message).toBe(messageId("C", 302));
    expect(checkBarrier(2, 1, subject({ num: 3, isHero: true }), closed).message).toBeNull();
  });

  it("chaque message de BARRIER_MESSAGES correspond à un code connu", () => {
    for (const code of Object.keys(BARRIER_MESSAGES).map(Number)) expect(BARRIER_CODES).toContain(code);
    expect(Object.values(BARRIER_MESSAGES).sort()).toEqual([101, 101, 201, 201, 301, 302, 302, 301].sort());
  });

  it("orientation de l'objet qui passe, seulement en mode 2 : 101 (+1, 0), 104 (-1, 0), 201 (+1, 0), 204 (0, +1)", () => {
    const open = worldOf({ ego: { 16: 4, 104: 3 } });
    expect(checkBarrier(101, 2, subject(), open).orient).toEqual({ speedX: 1, speedP: 0 });
    expect(checkBarrier(104, 2, subject(), open).orient).toEqual({ speedX: -1, speedP: 0 });
    expect(checkBarrier(201, 2, subject(), open).orient).toEqual({ speedX: 1, speedP: 0 });
    expect(checkBarrier(204, 2, subject(), open).orient).toEqual({ speedX: 0, speedP: 1 });
    expect(checkBarrier(101, 1, subject(), open).orient).toBeNull();
    expect(checkBarrier(101, 2, subject(), closed).orient).toBeNull();
    expect(checkBarrier(2, 2, subject(), open).orient).toBeNull();
  });

  it("résultat numérique : 7 = bloqué, 0 = libre", () => {
    expect(barrierResult(checkBarrier(101, 1, subject(), closed))).toBe(7);
    expect(barrierResult(checkBarrier(0, 1, subject(), closed))).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("codes de barrage de CFG", () => {
  const world = parseWorld(readOriginal("A1FCFG.SYS"));
  const counts = new Map<number, number>();
  for (const room of world.rooms) for (const code of room.barriers) if (code !== 0) counts.set(code, (counts.get(code) ?? 0) + 1);

  it("39 emplacements ont un barrage : 17 (codes 1 à 6 et 8), 6 (101 à 104), 7 (201 à 204), 9 (301 à 309)", () => {
    const sum = (match: (code: number) => boolean) => [...counts].reduce((n, [code, count]) => n + (match(code) ? count : 0), 0);
    expect(sum(() => true)).toBe(39);
    expect(sum((c) => (c >= 1 && c <= 6) || c === 8)).toBe(17);
    expect(sum((c) => c >= 101 && c <= 104)).toBe(6);
    expect(sum((c) => c >= 201 && c <= 204)).toBe(7);
    expect(sum((c) => c >= 301 && c <= 309)).toBe(9);
  });

  it("la table couvre tous les codes de CFG et les plages documentées (0 à 8, 101 à 105, 201 à 209, 301 à 309)", () => {
    for (const code of counts.keys()) expect(BARRIER_CODES).toContain(code);
    const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 101, 102, 103, 104, 105, ...[201, 202, 203, 204, 205, 206, 207, 208, 209], ...[301, 302, 303, 304, 305, 306, 307, 308, 309]];
    expect([...BARRIER_CODES].sort((a, b) => a - b)).toEqual(expected);
  });
});
