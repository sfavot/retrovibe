import { messageClass, messageId } from "../data/text";

/**
 * File de messages à priorité (`1e58:000a`, `1e58:00d8`, `1e58:009e`, `docs/armaeth/parser.md` § 7.2) : les
 * gestionnaires de verbes y déposent leurs messages d'échec, seul le niveau de priorité le plus haut survit.
 */

/** Capacité de la file (`DGROUP:4eb4`, `4ebe`). */
export const MESSAGE_QUEUE_MAX = 10;

/** Message `S015` : incompréhension, repli quand rien n'est affiché. */
export const MESSAGE_NOT_UNDERSTOOD = messageId("S", 15);
/** Message `S045` : remplace un identifiant absent de `TMS` (`gm_get_message`, § 7.1). */
export const MESSAGE_LOST = messageId("S", 45);

export interface QueuedMessage {
  /** Classe numérique (`messageClass`). */
  cls: number;
  number: number;
  /** `cls * 1000 + number`. */
  id: number;
}

export class MessageQueue {
  private level = 0;
  private items: QueuedMessage[] = [];

  /** Niveau de priorité courant (`DGROUP:4ed2`). */
  get priority(): number {
    return this.level;
  }

  get length(): number {
    return this.items.length;
  }

  /** Remise à zéro au début de chaque commande (`1e58:00d8`). */
  reset(): void {
    this.level = 0;
    this.items = [];
  }

  /**
   * Dépose un message. Priorité inférieure au niveau : ignoré ; supérieure : la file est vidée et le niveau monte ;
   * un doublon (même classe, même numéro) n'est pas ajouté. File pleine : ignoré (hypothèse, parser.md § 7.2).
   */
  push(priority: number, cls: string | number, number: number): void {
    if (priority < this.level) return;
    if (priority > this.level) {
      this.items = [];
      this.level = priority;
    }
    const c = messageClass(cls);
    if (this.items.some((m) => m.cls === c && m.number === number)) return;
    if (this.items.length >= MESSAGE_QUEUE_MAX) return;
    this.items.push({ cls: c, number, id: c * 1000 + number });
  }

  /** Messages dans l'ordre d'ajout. */
  entries(): readonly QueuedMessage[] {
    return this.items;
  }

  /**
   * Identifiants à afficher en fin de commande (`1e58:009e`) : du dernier ajout au premier, et seulement si aucun
   * gestionnaire n'a réussi (`successes === 0`, sinon la file est perdue). Ne vide pas la file.
   */
  display(successes: number): number[] {
    if (successes > 0) return [];
    return this.items.map((m) => m.id).reverse();
  }

  /**
   * Fin de commande (`22fc:05e3..0634`) : les identifiants à afficher, ou le repli `S015` si aucun gestionnaire n'a
   * réussi et que la file est vide.
   */
  flush(successes: number): number[] {
    if (successes > 0) return [];
    const ids = this.display(successes);
    return ids.length > 0 ? ids : [MESSAGE_NOT_UNDERSTOOD];
  }
}

/** `gm_get_message` : l'identifiant s'il existe, sinon `S045`. */
export function existingMessageId(table: { has(id: number): boolean }, id: number): number {
  return table.has(id) ? id : MESSAGE_LOST;
}
