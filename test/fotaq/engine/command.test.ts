import { describe, expect, it } from "vitest";
import type { Sequence } from "../../../src/engine/sequence";
import type { JasCommand } from "../../../src/games/fotaq/data/jas";
import { roomObjects } from "../../../src/games/fotaq/engine/room";
import { GameVar, Item, Verb, cloneState, stateOn } from "../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../helpers";
import { Player, gameData } from "./test-host";

/** Pièce qui contient l'objet du jeu `object` (plage d'objets de `QUEEN.JAS`). */
function roomOf(object: number): number {
  const data = gameData();
  for (let room = 1; room <= data.jas.roomCount; room++) {
    const { first, count } = roomObjects(data, room);
    if (object > first && object <= first + count) return room;
  }
  throw new Error(`objet ${object} sans pièce`);
}

/** Contexte d'une liste : la pièce de son premier objet du jeu, et la commande comme si le joueur l'avait construite. */
function playerFor(id: number): { player: Player; list: JasCommand } {
  const data = gameData();
  const list = data.jas.commands.lists[id];
  const anchor = list.object1 > 0 ? list.object1 : list.object2 > 0 ? list.object2 : 0;
  const room = anchor > 0 ? roomOf(anchor) : 1;
  const player = new Player({ room });
  player.settle();
  const { command } = player.engine;
  command.selAction = list.verb;
  command.subject = [list.object1, list.object2];
  command.selNoun = list.object1 > 0 ? list.object1 - data.jas.roomFirstObject[room] : 0;
  return { player, list };
}

/** États testés par la liste (numéro > 0) : `null` si deux valeurs différentes sont exigées pour un même état. */
function requiredStates(id: number): Map<number, number> | null {
  const required = new Map<number, number>();
  for (const record of gameData().jas.commands.states.slice(1)) {
    if (record.id !== id || record.slot <= 0) continue;
    if (required.has(record.slot) && required.get(record.slot) !== record.value) return null;
    required.set(record.slot, record.value);
  }
  return required;
}

/** Exécute la liste comme `executeCurrentAction` l'aurait choisie : conditions, puis effets ; rend la valeur de `setConditions`. */
function runList(player: Player, id: number, list: JasCommand): number {
  const { command } = player.engine;
  let cond = Number.NaN;
  player.perform(
    (function* (): Sequence {
      cond = list.setConditions ? yield* command.setConditions(id, true) : 0;
      if (cond >= 0) yield* command.executeCommand(id, cond);
    })(),
  );
  return cond;
}

describe.skipIf(!hasOriginalFiles)("listes de commandes de QUEEN.JAS (command.cpp)", () => {
  it("chaque liste s'exécute dans son contexte et produit les effets qu'elle décrit", () => {
    const data = gameData();
    const { commands } = data.jas;
    const lastBy = <T, K>(records: T[], id: number, own: (r: T) => number, key: (r: T) => K) => {
      const out = new Map<K, T>();
      for (const record of records.slice(1)) if (own(record) === id) out.set(key(record), record);
      return out;
    };
    let executed = 0;
    const impossible: number[] = [];
    for (let id = 1; id < commands.lists.length; id++) {
      const required = requiredStates(id);
      if (!required) {
        impossible.push(id);
        continue;
      }
      const { player, list } = playerFor(id);
      const { state } = player.engine;
      for (const [slot, value] of required) state.gameStates[slot] = value;
      const subject = list.object1 > 0 ? state.objects[list.object1] : null;
      const wasOn = subject ? stateOn(subject.state) : false;
      const cond = runList(player, id, list);
      expect(cond, `liste ${id}`).toBeGreaterThanOrEqual(0);
      executed++;

      const special = list.specialSection === 2 || list.specialSection === 3 || list.specialSection === 4;
      // Chaque sous-liste n'est appliquée que si la liste le demande (des enregistrements existent sans leur drapeau, ex. liste 203).
      // États posés : le dernier enregistrement de chaque état l'emporte.
      for (const [slot, record] of lastBy(commands.states, id, (r) => r.id, (r) => Math.abs(r.slot))) {
        if (!list.setConditions || record.slot > 0 || (special && slot === GameVar.JoeDressingMode)) continue;
        expect(state.gameStates[slot], `liste ${id}, état ${slot}`).toBe(record.value);
      }
      // Zones allumées ou éteintes.
      for (const record of lastBy(commands.areas, id, (r) => (list.setAreas ? r.id : -1), (r) => `${r.room}/${Math.abs(r.area)}`).values()) {
        const neighbors = state.areas[record.room][Math.abs(record.area)].mapNeighbors;
        expect(record.area > 0 ? neighbors >= 0 : neighbors <= 0, `liste ${id}, zone ${record.room}/${record.area}`).toBe(true);
      }
      // Objets montrés, cachés, supprimés, copiés (sauf ceux qui servent aussi de modèle dans la liste).
      const sources = new Set(commands.objects.slice(1).filter((r) => r.id === id && r.source > 0).map((r) => r.source));
      for (const [destination, record] of lastBy(commands.objects, id, (r) => (list.setObjects ? r.id : -1), (r) => Math.abs(r.destination))) {
        if (sources.has(destination)) continue;
        const name = state.objects[destination].name;
        if (record.destination < 0) expect(name, `liste ${id}, objet ${destination} caché`).toBeLessThanOrEqual(0);
        else if (record.source === -1) expect(name, `liste ${id}, objet ${destination} supprimé`).toBe(0);
        else expect(name, `liste ${id}, objet ${destination} montré`).toBeGreaterThanOrEqual(0);
      }
      // Objets d'inventaire.
      for (const [item, record] of lastBy(commands.inventory, id, (r) => (list.setItems ? r.id : -1), (r) => Math.abs(r.destination))) {
        if (special && (item === Item.Dress || item === Item.Clothes)) continue;
        const name = state.items[item].name;
        if (record.destination > 0) expect(name, `liste ${id}, objet d'inventaire ${item} ajouté`).toBeGreaterThanOrEqual(0);
        else expect(name, `liste ${id}, objet d'inventaire ${item} retiré`).toBeLessThanOrEqual(0);
      }
      // Image du sujet, morceau joué avant l'action, porte ouverte.
      if (subject && list.imageOrder > 0) expect(subject.image, `liste ${id}, image`).toBe(list.imageOrder);
      if (subject && list.imageOrder < 0) expect(subject.image, `liste ${id}, image éteinte`).toBeLessThanOrEqual(0);
      if (list.song > 0 && list.verb !== Verb.Open && list.verb !== Verb.Close && list.verb !== Verb.None) {
        expect(player.host.songs, `liste ${id}, morceau`).toContain(list.song);
      }
      const cutawayPlayed = player.cutaways.played.length > 0;
      if (subject && list.verb === Verb.Open && !cutawayPlayed && wasOn) expect(stateOn(subject.state), `liste ${id}, ouvert`).toBe(false);
      if (subject && list.verb === Verb.Close && !cutawayPlayed && !wasOn) expect(stateOn(subject.state), `liste ${id}, fermé`).toBe(true);
      // L'état reste sérialisable (vague S).
      expect(JSON.parse(JSON.stringify(state)), `liste ${id}, JSON`).toEqual(cloneState(state));
    }
    expect(executed + impossible.length).toBe(866);
    expect(impossible).toEqual([]);
 }, 60_000);

  it("une condition manquée ne change rien à l'état ; Joe dit la réplique de la condition (ou rien : -1)", () => {
    const { commands } = gameData().jas;
    let checked = 0;
    for (let id = 1; id < commands.lists.length; id++) {
      const tested = commands.states.slice(1).find((r) => r.id === id && r.slot > 0);
      if (!tested || !requiredStates(id) || !commands.lists[id].setConditions) continue;
      const { player, list } = playerFor(id);
      const { state } = player.engine;
      for (const [slot, value] of requiredStates(id)!) state.gameStates[slot] = value;
      state.gameStates[tested.slot] = tested.value + 1;
      const before = cloneState(state);
      const said = player.talk.lines.length;
      const cond = runList(player, id, list);
      const speaks = commands.states.slice(1).find((r) => r.id === id && r.slot > 0 && state.gameStates[r.slot] !== r.value)!;
      expect(cond, `liste ${id}`).toBe(speaks.speakValue > 0 ? -2 : -1);
      if (speaks.speakValue > 0 && !/\.(CUT|DOG)$/i.test(player.engine.objectDescriptionText(speaks.speakValue))) {
        expect(player.talk.lines.length, `liste ${id}`).toBe(said + 1);
      }
      expect(state, `liste ${id}`).toEqual(before);
      checked++;
    }
    expect(checked).toBe(455);
 }, 60_000);

  it("aller-retour : les effets d'une liste rejoués sur l'état restauré donnent le même état", () => {
    // Pièce 1 : ouvrir le sac marin (liste 1) puis l'examiner (liste 6) donne le briquet et le couteau.
    const first = playerFor(1).player;
    const saved = cloneState(first.engine.state);
    runList(first, 1, gameData().jas.commands.lists[1]);
    const opened = cloneState(first.engine.state);
    const second = playerFor(1).player;
    second.engine.state = cloneState(saved);
    runList(second, 1, gameData().jas.commands.lists[1]);
    expect(second.engine.state).toEqual(opened);
    expect(opened.gameStates[1]).toBe(1);
    expect(opened.objects[1].image).toBe(4);
  });
});
