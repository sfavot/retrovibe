/**
 * Registre des handlers de types de pièces. Les descripteurs de l'exe désignent leurs handlers par adresse (8 slots,
 * `docs/tim3/engine.md` § 2) ; chaque famille de `engine/parts/<famille>/` enregistre ses traductions par adresse, sans
 * toucher au noyau (vague Φ2). Une adresse non portée passe par une souche qui journalise son premier appel et ne fait
 * rien (slot 0 : rend 1 comme 434bf0 ; slot 5 : rend 0 comme 434cbd).
 *
 * Slots : 0 activation / acceptation d'un contact (appelé avec la pièce qui touche), 1 « run » à chaque pas, 2
 * réinitialisation, 3 édition (retournement…), 4 secondaire, 5 réaction à une collision, 6 dessin, 7 liens et
 * initialisation du type (argument `null`).
 */
import type { Part } from "../part";
import type { World } from "../world";

/**
 * Handler de slot. `arg` : pièce touchante (slot 0), action (slot 3)… ; `more` : arguments supplémentaires du slot 5
 * appelé par la tension des cordes (`World.pull` : `part` = pièce tirée, du type du handler, `arg` = pièce qui tire,
 * `more` = [emplacement, flags, masse, effort]).
 */
export type Handler = (world: World, part: Part, arg?: number | Part | null, ...more: number[]) => number | void;

export interface HandlerEntry {
  /** Adresse dans TIMWIN.EXE. */
  readonly address: number;
  /** Nom court, pour les journaux et la carte du code. */
  readonly name: string;
  readonly fn: Handler;
}

/** Souches d'exécution : handlers spéciaux appelés par le pas (cordes, seaux, lasers…), aussi désignés par adresse. */
export type Special = (world: World, part: Part, arg?: unknown) => number | void;

export class HandlerRegistry {
  private readonly entries = new Map<number, HandlerEntry>();
  private readonly specials = new Map<number, { name: string; fn: Special }>();

  register(address: number, name: string, fn: Handler): this {
    if (this.entries.has(address)) throw new Error(`TIM3 : handler ${address.toString(16)} enregistré deux fois`);
    this.entries.set(address, { address, name, fn });
    return this;
  }

  registerSpecial(address: number, name: string, fn: Special): this {
    if (this.specials.has(address)) throw new Error(`TIM3 : fonction ${address.toString(16)} enregistrée deux fois`);
    this.specials.set(address, { name, fn });
    return this;
  }

  get(address: number): HandlerEntry | undefined {
    return this.entries.get(address);
  }

  getSpecial(address: number): { name: string; fn: Special } | undefined {
    return this.specials.get(address);
  }

  has(address: number): boolean {
    return this.entries.has(address) || this.specials.has(address);
  }

  addresses(): number[] {
    return [...this.entries.keys(), ...this.specials.keys()];
  }
}

/** Valeur rendue par une souche de slot (défauts communs de l'exe). */
export function stubResult(slot: number): number {
  return slot === 0 ? 1 : 0;
}
