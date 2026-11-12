/**
 * « Dis à » : les ordres que le joueur donne à un personnage. Le joueur compose jusqu'à `MAX_TELL_COMMANDS` (8) ordres (verbe, un ou deux
 * paramètres, « et puis » / « fin ») dans `LureEngine.getTellActions` (menus surgissants) ; `doTell` les exécute : le personnage dit
 * qu'il va s'en occuper (`converse` du message 0x7C), puis, si la séquence `TELL` de son hotspot l'accepte (valeur 0), on lui **remplace** sa
 * pile d'actions par les ordres, dans l'ordre, qu'il exécute de lui-même (gestionnaire de tick, `Hotspot::doAction`) avant de reprendre
 * son emploi du temps.
 *
 * Les paramètres d'une commande « Dis à » (`CharacterScheduleEntry`, action `TELL`) sont : le personnage visé, puis des triplets
 * `(verbe, paramètre 1, paramètre 2)` (`numParams = 3 * n + 1`) ; la donnée est modifiable, comme `setDetails2`, voir `engine.md` § 9.
 *
 * Source (ScummVM, GPL v3+) : `Hotspot::doTell` (engines/lure/hotspots.cpp), `Game::GetTellActions` (game.cpp).
 *
 * Écarts : aucun sur la file ; la validation (au plus 8 ordres, un verbe par ordre) est ajoutée car ScummVM ne vérifie rien.
 */

import { MAX_TELL_COMMANDS } from "./ids";
import type { Hotspot } from "./hotspot";

/** Un ordre : verbe et ses deux paramètres (hotspots ou objets, 0 si absent). */
export interface TellOrder {
  action: number;
  param1: number;
  param2: number;
}

/** Paramètres d'une commande « Dis à » en ordres : `params[0]` est le personnage, puis un triplet par ordre. */
export function parseTellOrders(params: readonly number[]): TellOrder[] {
  const orders: TellOrder[] = [];
  for (let index = 1; index + 2 < params.length; index += 3) {
    orders.push({ action: params[index]!, param1: params[index + 1]!, param2: params[index + 2]! });
  }
  if (orders.length > MAX_TELL_COMMANDS) throw new RangeError(`« Dis à » : ${orders.length} ordres (au plus ${MAX_TELL_COMMANDS})`);
  return orders;
}

/**
 * `doTell`, fin : le personnage oublie ce qu'il faisait (pièce de départ = sa pièce, pile vidée, plus bloqué) et reçoit les ordres à la
 * suite les uns des autres.
 */
export function giveTellOrders(character: Hotspot, params: readonly number[]): void {
  const orders = parseTellOrders(params);
  character.startRoomNumber = character.roomNumber;
  character.currentActions.clear();
  character.blockedFlag = false;
  for (const order of orders) character.currentActions.addBackAction(order.action, 0, order.param1, order.param2);
}
