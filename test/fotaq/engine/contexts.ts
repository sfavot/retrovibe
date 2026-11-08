import { dataFiles } from "../helpers";
import { parseCutaway } from "../../../src/games/fotaq/data/cut";
import { parseDog } from "../../../src/games/fotaq/data/dog";
import { roomObjects } from "../../../src/games/fotaq/engine/room";
import { Verb } from "../../../src/games/fotaq/engine/state";
import { gameData } from "./test-host";
import { readOriginal } from "../helpers";

/** Pièce qui contient l'objet du jeu `object` (plage d'objets de `QUEEN.JAS`). */
export function roomOf(object: number): number {
  const data = gameData();
  for (let room = 1; room <= data.jas.roomCount; room++) {
    const { first, count } = roomObjects(data, room);
    if (object > first && object <= first + count) return room;
  }
  throw new Error(`objet ${object} sans pièce`);
}

/** États exigés par la liste `id` (numéro > 0 : valeur à avoir). */
export function requiredStates(id: number): [number, number][] {
  const out = new Map<number, number>();
  for (const record of gameData().jas.commands.states.slice(1)) if (record.id === id && record.slot > 0) out.set(record.slot, record.value);
  return [...out];
}

export interface Usage {
  /** Fichier nommé (`C21A.CUT`, `CHIEF1.DOG`). */
  file: string;
  /** Liste de commandes qui le lance (0 : aucune connue). */
  list: number;
  verb: number;
  /** Objet du jeu visé par la commande. */
  object: number;
  room: number;
}

const endsWith = (text: string, extension: string): boolean => text.length > 4 && text.slice(-4).toUpperCase() === extension;

/** Cinématiques et dialogues nommés par les descriptions des listes de commandes (`states.speakValue`), avec leur contexte. */
export function commandUsages(): Usage[] {
  const data = gameData();
  const { lists, states } = data.jas.commands;
  const out: Usage[] = [];
  for (let i = 1; i < states.length; i++) {
    const record = states[i];
    if (record.speakValue <= 0) continue;
    const text = data.texts.objectDescriptions[record.speakValue];
    if (!text || !(endsWith(text, ".CUT") || endsWith(text, ".DOG"))) continue;
    const list = lists[record.id];
    const object = list.object1 > 0 ? list.object1 : list.object2 > 0 ? list.object2 : 0;
    out.push({ file: text.toUpperCase(), list: record.id, verb: list.verb, object, room: object > 0 ? roomOf(object) : 1 });
  }
  return out;
}

/** Fichiers `.DOG` / `.CUT` cités dans les descriptions d'objets et les réponses (hors listes). */
export function allNamedFiles(): string[] {
  const data = gameData();
  return [...data.texts.objectDescriptions, ...data.texts.joeResponses].filter((t) => t && (endsWith(t, ".CUT") || endsWith(t, ".DOG"))).map((t) => t.toUpperCase());
}

/** Dialogues que lancent les cinématiques (`talkFile`, `talkTo`) et cinématiques que lancent les dialogues. */
export function cutawayLinks(): { cutaways: Map<string, { dialogue: string; talkTo: number }>; dialogs: Map<string, string> } {
  const cutaways = new Map<string, { dialogue: string; talkTo: number }>();
  for (const path of dataFiles("CUT")) {
    const cut = parseCutaway(readOriginal(path), () => false);
    cutaways.set(path.toUpperCase(), { dialogue: /\.DOG$/i.test(cut.talkFile) ? cut.talkFile.toUpperCase() : "", talkTo: cut.talkTo });
  }
  const dialogs = new Map<string, string>();
  for (const path of dataFiles("DOG")) {
    const dog = parseDog(readOriginal(path));
    dialogs.set(path.toUpperCase(), dog.cutaway.file ? dog.cutaway.file.toUpperCase() : "");
  }
  return { cutaways, dialogs };
}

export { Verb };

import type { Sequence } from "../../../src/engine/sequence";
import { GridScreen } from "../../../src/games/fotaq/engine/grid";
import type { Player } from "./test-host";

/** Un menu de dialogue à l'écran : les options (numéro de zone du panneau, texte de leur première ligne). */
export function dialogueMenu(player: Player): { zone: number; text: string; x: number; y: number }[] | null {
  const { grid } = player.engine;
  // Les flèches du menu (zone 5 du panneau à partir de x = 303) n'existent que pendant un choix.
  if (grid.zone(GridScreen.Panel, 5)?.x1 !== 303) return null;
  const stage = player.engine.stage as import("../../../src/games/fotaq/engine/stage").GameStage;
  const out: { zone: number; text: string; x: number; y: number }[] = [];
  for (let zone = 1; zone <= 4; zone++) {
    const box = grid.zone(GridScreen.Panel, zone);
    if (!box) continue;
    const y = 150 + box.y1;
    const text = stage.display.textAt(y + 4 > 199 ? 199 : y).text;
    if (text) out.push({ zone, text, x: 10, y: y + 3 });
  }
  return out.length ? out : null;
}

export interface RunOptions {
  /** Désigne l'option d'un menu de dialogue (indice dans la liste, 0 par défaut). */
  choose?: (menu: { zone: number; text: string }[], menuIndex: number) => number;
  /** Appelée après chaque tick, avec le numéro du tick (à partir de 1). */
  onTick?: (tick: number) => void;
  max?: number;
}

/**
 * Fait tourner le moteur jusqu'à la fin de la séquence en cours, en cliquant sur les menus de dialogue qui s'affichent. Rend le
 * nombre de ticks ; lève au-delà de `max` ticks.
 */
export function runToEnd(player: Player, options: RunOptions = {}): number {
  const { choose = () => 0, onTick, max = 60_000 } = options;
  let ticks = 0;
  let menus = 0;
  let lastSignature = "";
  let lastClick = -10;
  while (player.engine.busy || player.state.newRoom > 0) {
    if (ticks++ > max) throw new Error(`pas fini après ${max} ticks`);
    player.run(1);
    onTick?.(ticks);
    const menu = dialogueMenu(player);
    if (!menu) {
      lastSignature = "";
      continue;
    }
    // Un nouveau menu (ou le même, si le clic n'a pas été pris) : on choisit.
    const signature = menu.map((option) => option.text).join("|");
    if (signature === lastSignature && ticks - lastClick < 6) continue;
    const pick = menu[Math.min(choose(menu, menus++), menu.length - 1)];
    player.move(pick.x, pick.y);
    player.run(1);
    player.move(pick.x, pick.y, 1);
    player.move(pick.x, pick.y, 0);
    lastSignature = signature;
    lastClick = ticks;
  }
  return ticks;
}

/** Lance une séquence et attend sa fin (voir `runToEnd`). */
export function perform(player: Player, sequence: Sequence<unknown>, options: RunOptions = {}): number {
  player.engine.run(sequence);
  return runToEnd(player, options);
}

import type { FotaqEngine } from "../../../src/games/fotaq/engine/loop";

/** Rend valide un acteur par personne de la pièce (le premier de chaque numéro de bob) : les états de l'acteur sont posés. */
export function enableActors(engine: FotaqEngine, room: number): void {
  const seen = new Set<number>();
  for (const actor of engine.data.jas.actors.slice(1)) {
    if (actor.room !== room || seen.has(actor.bobNumber)) continue;
    seen.add(actor.bobNumber);
    engine.state.gameStates[actor.stateSlot] = actor.stateValue;
  }
}

/** Pièce d'une cinématique, d'après les listes qui la lancent, sinon d'après son nom (`C73D` : pièce 73), sinon la pièce 1. */
export function cutawayContext(file: string): { room: number; list: number } {
  const usage = commandUsages().find((u) => u.file === file);
  if (usage) return { room: usage.room, list: usage.list };
  const named = /^C(\d+)[A-Z]/.exec(file);
  const room = named ? Number(named[1]) : 1;
  return { room: room >= 1 && room <= gameData().jas.roomCount ? room : 1, list: 0 };
}

/** Contexte d'un dialogue : la pièce et le numéro dans la pièce de la personne, d'après les listes de commandes ou les cinématiques qui le lancent. */
export function dialogContext(file: string): { room: number; noun: number; list: number } {
  const data = gameData();
  const usages = commandUsages().filter((u) => u.file === file && u.object > 0);
  const usage = usages.find((u) => u.verb === Verb.TalkTo) ?? usages[0];
  if (usage) return { room: usage.room, noun: usage.object - data.jas.roomFirstObject[usage.room], list: usage.list };
  for (const [cut, link] of cutawayLinks().cutaways) {
    if (link.dialogue === file && link.talkTo > 0) {
      const room = roomOf(link.talkTo);
      void cut;
      return { room, noun: link.talkTo - data.jas.roomFirstObject[room], list: 0 };
    }
  }
  throw new Error(`dialogue ${file} sans contexte`);
}

/** Clic (gauche par défaut) au point d'écran sans attendre la fin de l'action : deux ticks laissent la commande démarrer. */
export function clickAt(player: Player, x: number, y: number, button = 1): void {
  player.move(x, y);
  player.run(1);
  player.move(x, y, button);
  player.move(x, y, 0);
  player.run(2);
}

/** Le texte affiché à l'écran (premier non vide, du bas vers le haut), ou `null`. */
export function screenText(player: Player): string | null {
  const stage = player.engine.stage as import("../../../src/games/fotaq/engine/stage").GameStage;
  for (let y = 199; y > 0; y--) {
    const slot = stage.display.textAt(y);
    if (slot.text) return slot.text;
  }
  return null;
}
