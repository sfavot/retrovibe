import { describe, expect, it } from "vitest";
import {
  MESSAGE_LOST,
  MESSAGE_NOT_UNDERSTOOD,
  MESSAGE_QUEUE_MAX,
  MessageQueue,
  existingMessageId,
} from "../../src/games/armaeth/engine/messages";
import { messageId } from "../../src/games/armaeth/data/text";

describe("file de messages à priorité", () => {
  it("identifiants S015 et S045", () => {
    expect(MESSAGE_NOT_UNDERSTOOD).toBe(19015);
    expect(MESSAGE_LOST).toBe(19045);
  });

  it("ignore une priorité inférieure, vide la file pour une supérieure", () => {
    const q = new MessageQueue();
    q.push(3, "V", 8);
    q.push(1, "V", 29);
    expect(q.entries().map((m) => m.id)).toEqual([messageId("V", 8)]);
    q.push(4, "V", 21);
    expect(q.priority).toBe(4);
    expect(q.entries().map((m) => m.id)).toEqual([messageId("V", 21)]);
  });

  it("garde les messages de même priorité et refuse les doublons", () => {
    const q = new MessageQueue();
    q.push(0, "V", 23);
    q.push(0, "V", 29);
    q.push(0, "V", 23);
    expect(q.length).toBe(2);
  });

  it("affiche du dernier au premier, seulement sans succès", () => {
    const q = new MessageQueue();
    q.push(10, 0, 6);
    q.push(10, 0, 108);
    expect(q.display(0)).toEqual([30108, 30006]);
    expect(q.display(1)).toEqual([]);
  });

  it("repli S015 quand rien n'est en file et qu'aucun gestionnaire n'a réussi", () => {
    const q = new MessageQueue();
    expect(q.flush(0)).toEqual([MESSAGE_NOT_UNDERSTOOD]);
    expect(q.flush(2)).toEqual([]);
    q.push(2, "V", 20);
    expect(q.flush(0)).toEqual([messageId("V", 20)]);
  });

  it("reset remet le niveau et le contenu à zéro", () => {
    const q = new MessageQueue();
    q.push(8, "I", 3);
    q.reset();
    expect(q).toMatchObject({ priority: 0, length: 0 });
    q.push(0, "V", 29);
    expect(q.length).toBe(1);
  });

  it("limite la file à 10 messages", () => {
    const q = new MessageQueue();
    for (let i = 1; i <= 15; i++) q.push(0, "V", i);
    expect(q.length).toBe(MESSAGE_QUEUE_MAX);
  });

  it("les classes numériques 0 à 8 donnent les descriptions d'objets (classes 30 à 38)", () => {
    const q = new MessageQueue();
    q.push(10, 2, 5);
    expect(q.entries()[0].id).toBe(32005);
  });

  it("un identifiant absent est remplacé par S045", () => {
    const table = { has: (id: number) => id === 22015 };
    expect(existingMessageId(table, 22015)).toBe(22015);
    expect(existingMessageId(table, 22999)).toBe(MESSAGE_LOST);
  });
});
