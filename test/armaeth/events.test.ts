import { describe, expect, it } from "vitest";
import { EventOp, DeferredEventQueue } from "../../src/games/armaeth/engine/events";

const a = { typ: 2, num: 301, serial: 10 };
const b = { typ: 2, num: 302, serial: 11 };

describe("file d'événements différés", () => {
  it("crée à la demande (sauf retrancher), plafonne et plancher le compteur", () => {
    const q = new DeferredEventQueue(4);
    expect(q.operate(a, 1, EventOp.Subtract, 1)).toBeUndefined();
    expect(q.operate(a, 1, EventOp.Other)).toBeUndefined();
    expect(q.size).toBe(0);
    expect(q.operate(a, 1, EventOp.Get, 0, 5)).toBe(0);
    expect(q.operate(a, 2, EventOp.Get, 9, 5)).toBe(9); // `23a2:01a4` : la création écrit la valeur passée, même pour la lecture
    expect(q.operate(a, 2, EventOp.Get, 4, 5)).toBe(9); // une entrée existante n'est pas modifiée
    q.operate(a, 2, EventOp.Remove);
    expect(q.operate(a, 1, EventOp.Add, 3)).toBe(3);
    expect(q.operate(a, 1, EventOp.Add, 0xffff)).toBe(0xffff);
    expect(q.operate(a, 1, EventOp.Subtract, 0xfffff)).toBe(0);
    expect(q.operate(a, 1, EventOp.Set, 7)).toBe(7);
    expect(q.size).toBe(1);
    expect(q.entries[0]).toMatchObject({ ...a, event: 1, procedure: 5 });
  });

  it("refuse de créer quand la file est pleine et supprime avec -1", () => {
    const q = new DeferredEventQueue(1);
    q.operate(a, 1, EventOp.Set, 2, 1);
    expect(q.operate(b, 1, EventOp.Set, 2, 1)).toBeUndefined();
    expect(q.size).toBe(1);
    q.operate(a, 1, EventOp.Remove);
    expect(q.size).toBe(0);
    expect(q.operate(b, 1, EventOp.Set, 2, 1)).toBe(2);
  });

  it("distingue les événements d'un même objet", () => {
    const q = new DeferredEventQueue(4);
    q.operate(a, 1, EventOp.Set, 1, 1);
    q.operate(a, 2, EventOp.Set, 9, 1);
    expect(q.find(a, 1)?.counter).toBe(1);
    expect(q.find(a, 2)?.counter).toBe(9);
  });

  it("décrémente à chaque tic et déclenche à 0 dans l'ordre de la table", () => {
    const q = new DeferredEventQueue(4);
    q.operate(a, 1, EventOp.Set, 2, 101);
    q.operate(b, 1, EventOp.Set, 0, 103);
    const fired: number[] = [];
    const fire = (e: { procedure: number }) => fired.push(e.procedure);
    q.tick(fire);
    expect(fired).toEqual([103]);
    expect(q.size).toBe(1);
    q.tick(fire);
    q.tick(fire);
    expect(fired).toEqual([103, 101]);
    expect(q.size).toBe(0);
  });

  it("une entrée sans procédure est retirée sans appel", () => {
    const q = new DeferredEventQueue(2);
    q.operate(a, 1, EventOp.Get);
    const fired: unknown[] = [];
    q.tick((e) => fired.push(e));
    expect(fired).toEqual([]);
    expect(q.size).toBe(0);
  });

  it("un déclenchement peut supprimer ou créer des entrées", () => {
    const q = new DeferredEventQueue(4);
    q.operate(a, 1, EventOp.Set, 0, 1);
    q.operate(b, 1, EventOp.Set, 0, 2);
    const fired: number[] = [];
    q.tick((e) => {
      fired.push(e.procedure);
      if (e.procedure === 1) {
        q.operate(b, 1, EventOp.Remove);
        q.operate(a, 9, EventOp.Set, 0, 7);
      }
    });
    expect(fired).toEqual([1]);
    expect(q.size).toBe(1);
    q.tick((e) => fired.push(e.procedure));
    expect(fired).toEqual([1, 7]);
  });
});
