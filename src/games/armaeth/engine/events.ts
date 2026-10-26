import type { DeferredEvent } from "../data/world";

/**
 * File d'événements différés (`23a2:0002` / `23a2:0250`, `docs/armaeth/engine.md` § 9.3) : table de capacité fixe
 * d'entrées `{Typ, Num, Ser, événement, compteur, procédure}`. Le compteur décroît à chaque tic de monde ; quand il vaut 0 au
 * tic, l'entrée est retirée et son gestionnaire est appelé (clé de la famille 8 du moteur, laissée à l'appelant).
 */

/**
 * Clé de gestionnaire : champ « procédure » d'une entrée (`DeferredEvent.procedure`), qui n'est **pas un offset** mais la clé
 * de la famille de gestionnaires 8, résolue par `1ec8:000a` (`docs/armaeth/characters.md` § 13, `formats.md` : « table de
 * 12 octets »). 0 = aucun gestionnaire (simple drapeau, par exemple l'événement 12 « rassasié » de l'ours).
 */
export type HandlerKey = number;

/** Plafond du compteur (opération « ajouter »). */
export const MAX_COUNTER = 0xffff;

/** Opérations de `23a2:0002`. */
export const EventOp = {
  Remove: -1,
  /** Crée l'entrée si absente (compteur = valeur passée, `23a2:01a4..01aa`) et la lit ; une entrée existante n'est pas modifiée. */
  Get: 0,
  Add: 1,
  Subtract: 2,
  Set: 3,
  /** Non lue par le moteur connu : sans effet ici. */
  Other: 4,
} as const;
export type EventOpCode = (typeof EventOp)[keyof typeof EventOp];

/** Clé d'objet d'une entrée : `Typ`, `Num` et `Ser` de l'objet visé. */
export interface EventTarget {
  typ: number;
  num: number;
  serial: number;
}

export type EventFire = (entry: Readonly<DeferredEvent>) => void;

export class DeferredEventQueue {
  capacity: number;
  readonly entries: DeferredEvent[];

  constructor(capacity = 0, entries: readonly DeferredEvent[] = []) {
    this.capacity = capacity;
    this.entries = entries.map((e) => ({ ...e }));
  }

  get size(): number {
    return this.entries.length;
  }

  /** Entrée de l'objet pour cet événement, ou `undefined`. */
  find(target: EventTarget, event: number): DeferredEvent | undefined {
    return this.entries.find((e) => e.typ === target.typ && e.num === target.num && e.serial === target.serial && e.event === event);
  }

  /**
   * `23a2:0002(objet, événement, opération, valeur)`. Renvoie le compteur résultant, ou `undefined` si l'entrée n'existe pas
   * (et n'est pas créée) ou n'a pas pu l'être. `handlerKey` (champ `procedure` de l'entrée) n'est utilisée qu'à la création.
   * hypothèse (engine.md §9.3) : une file pleine refuse la création (le moteur ne documente pas ce cas).
   */
  operate(target: EventTarget, event: number, op: EventOpCode, value = 0, handlerKey: HandlerKey = 0): number | undefined {
    let entry = this.find(target, event);
    let created = false;
    if (op === EventOp.Remove) {
      if (entry) this.entries.splice(this.entries.indexOf(entry), 1);
      return undefined;
    }
    if (!entry) {
      if (op === EventOp.Subtract || op === EventOp.Other) return undefined;
      if (this.entries.length >= this.capacity) return undefined;
      entry = { typ: target.typ, num: target.num, serial: target.serial, event, counter: value & 0xffff, procedure: handlerKey };
      this.entries.push(entry);
      created = true; // `23a2:01a4` : toute création écrit la valeur passée comme compteur (et le rend), quelle que soit l'opération
    }
    if (created) return entry.counter;
    if (op === EventOp.Add) entry.counter = Math.min(MAX_COUNTER, entry.counter + value);
    else if (op === EventOp.Subtract) entry.counter = Math.max(0, entry.counter - value);
    else if (op === EventOp.Set) entry.counter = value & 0xffff;
    return entry.counter;
  }

  /**
   * `23a2:0250`, une fois par tic de monde : chaque entrée dont le compteur est 0 est retirée et déclenchée (si elle a un
   * gestionnaire), les autres perdent 1. Ordre : celui de la table. hypothèse (engine.md §9.3) : seules les entrées présentes au
   * début du tic sont traitées ; une entrée créée par un déclenchement attend le tic suivant.
   */
  tick(fire: EventFire): void {
    const pending = this.entries.slice();
    for (const entry of pending) {
      const index = this.entries.indexOf(entry);
      if (index < 0) continue; // supprimée par un déclenchement précédent
      if (entry.counter > 0) {
        entry.counter--;
        continue;
      }
      this.entries.splice(index, 1);
      if (entry.procedure !== 0) fire({ ...entry });
    }
  }
}
