/**
 * Inventaire (`docs/fotaq/engine.md`, § 7) : objets possédés et les quatre cases visibles du panneau. Réécriture des fonctions
 * d'inventaire de `Logic` (engines/queen/logic.cpp : `inventorySetup`, `findInventoryItem`, `inventoryInsertItem`,
 * `inventoryDeleteItem`, `inventoryScroll`, `previousInventoryItem`, `nextInventoryItem`, `removeDuplicateItems`,
 * `numItemsInventory`, `removeHotelItemsFromInventory`, ScummVM).
 *
 * Un objet d'inventaire est possédé quand son nom est positif (`items[n].name > 0`). Les cases visibles (`state.inventory`) sont
 * une fenêtre de quatre objets possédés qui se suivent dans l'ordre des numéros, en boucle ; ajouter un objet le met dans la
 * première case. Le dessin des cases (`inventoryRefresh`) est celui du rendu (vague R), qui lit `state.inventory`.
 *
 * Particularité reproduite : `nextInventoryItem` et `numItemsInventory` de ScummVM s'arrêtent avant le dernier objet (100, « B.D »,
 * même nom que l'objet 10) ; `previousInventoryItem` le voit. Les copies d'objets (`setItems`) ne le touchent pas dans le jeu.
 */

import { GameVar, INVENTORY_SLOTS, Item, type World } from "./state";

/** Objets retirés en arrivant dans la jungle (pièce 1) après l'hôtel (`removeHotelItemsFromInventory`). */
const HOTEL_ITEMS = [Item.Crowbar, Item.Dress, Item.Clothes, Item.Hay, Item.Oil, Item.Chicken];
const JUNGLE_ROOM = 1;

export class Inventory {
  constructor(private readonly world: World) {}

  private get items() {
    return this.world.state.items;
  }

  private get slots(): number[] {
    return this.world.state.inventory;
  }

  /** Nombre d'objets du jeu (`_numItems`). */
  private get count(): number {
    return this.items.length - 1;
  }

  /** Inventaire de départ : la batte et le journal (`inventorySetup`). */
  setup(): void {
    this.slots.splice(0, INVENTORY_SLOTS, Item.Bat, Item.Journal, Item.None, Item.None);
  }

  /** Objet de la case `slot` (0 à 3) ; 0 si la case est vide ou hors limites (`findInventoryItem`). */
  find(slot: number): number {
    return slot >= 0 && slot < INVENTORY_SLOTS ? this.slots[slot] : 0;
  }

  /** L'objet est possédé. */
  has(item: number): boolean {
    return (this.items[item]?.name ?? 0) > 0;
  }

  /** Objets possédés (`numItemsInventory`, sans le dernier objet : voir l'en-tête). */
  owned(): number {
    let n = 0;
    for (let i = 1; i < this.count; i++) if (this.items[i].name > 0) n++;
    return n;
  }

  /** Objet possédé précédent, en boucle ; 0 s'il n'y en a pas (`previousInventoryItem`). */
  previous(first: number): number {
    for (let i = first - 1; i >= 1; i--) if (this.items[i].name > 0) return i;
    for (let i = this.count; i > first; i--) if (this.items[i].name > 0) return i;
    return 0;
  }

  /** Objet possédé suivant, en boucle ; 0 s'il n'y en a pas (`nextInventoryItem`). */
  next(first: number): number {
    for (let i = first + 1; i < this.count; i++) if (this.items[i].name > 0) return i;
    for (let i = 1; i < first; i++) if (this.items[i].name > 0) return i;
    return 0;
  }

  /** Ajoute l'objet et le met dans la première case, les suivants derrière (`inventoryInsertItem`). */
  insert(item: number): void {
    const items = this.items;
    items[item].name = Math.abs(items[item].name);
    this.slots[0] = item;
    let current = item;
    for (let i = 1; i < INVENTORY_SLOTS; i++) {
      current = this.next(current);
      this.slots[i] = current;
      this.removeDuplicates();
    }
  }

  /** Retire l'objet ; les cases montrent les objets qui le suivent (`inventoryDeleteItem`). */
  remove(item: number): void {
    const items = this.items;
    items[item].name = -Math.abs(items[item].name);
    let current = item;
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      current = this.next(current);
      this.slots[i] = current;
      this.removeDuplicates();
    }
  }

  /** Fait défiler les cases de `count` objets, s'il y a plus de quatre objets (`inventoryScroll`). */
  scroll(count: number, up: boolean): void {
    if (this.owned() <= INVENTORY_SLOTS) return;
    const slots = this.slots;
    for (let step = 0; step < count; step++) {
      if (up) {
        for (let i = INVENTORY_SLOTS - 1; i > 0; i--) slots[i] = slots[i - 1];
        slots[0] = this.previous(slots[0]);
      } else {
        for (let i = 0; i < INVENTORY_SLOTS - 1; i++) slots[i] = slots[i + 1];
        slots[INVENTORY_SLOTS - 1] = this.next(slots[INVENTORY_SLOTS - 1]);
      }
    }
  }

  /**
   * Retire les objets de l'hôtel la première fois que Joe est dans la pièce 1 (`removeHotelItemsFromInventory`, appelé à la fin
   * d'une cinématique : vague C).
   */
  removeHotelItems(): void {
    const state = this.world.state;
    if (state.room !== JUNGLE_ROOM || state.gameStates[GameVar.HotelItemsRemoved] !== 0) return;
    for (const item of HOTEL_ITEMS) this.remove(item);
    state.gameStates[GameVar.HotelItemsRemoved] = 1;
  }

  /** Une case qui répète une case précédente est vidée (`removeDuplicateItems`). */
  private removeDuplicates(): void {
    const slots = this.slots;
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      for (let j = i + 1; j < INVENTORY_SLOTS; j++) if (slots[i] === slots[j]) slots[j] = Item.None;
    }
  }
}
