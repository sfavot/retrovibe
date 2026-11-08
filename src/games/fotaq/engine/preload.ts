/**
 * Voix d'une scène (`docs/fotaq/talk.md`, § 6) : les noms de fichiers de voix à précharger en entrant dans une pièce, déduits des
 * dialogues (`.DOG`) et des cinématiques (`.CUT`) que ses commandes peuvent lancer, et des descriptions de Joe de ses commandes. Le
 * moteur les donne à l'hôte (`FotaqHost.preloadSpeech`) ; un nom sans fichier est ignoré par l'hôte.
 *
 * Les noms suivent `Talk::speak` : une voix par segment d'une réplique (les gestes `*GD` et `*GM` n'en ont pas), préfixe du dialogue
 * (`TTHHHHP` / `J`, `TTSSSSJ` et `TTXXXXJ` pour l'ouverture), de la cinématique (`findCdCut`) ou de Joe (`JOE%04i`).
 */

import { cutawayVoicePrefix, dialogOpeningVoicePrefix, dialogVoicePrefix, joeVoicePrefix } from "../data/files";
import { parseCutaway } from "../data/cut";
import { parseDog } from "../data/dog";
import { splitSpeech } from "../data/text";
import type { FotaqEngine } from "./loop";
import { isPerson } from "./room";
import { JOE_RESPONSE_MAX } from "./state";
import { speechFileName } from "./talk";

/**
 * Noms des voix d'une réplique de préfixe `prefix` : un par segment qui a du texte (un segment vide, ou un geste `*GD` / `*GM`, n'a
 * pas de fichier de voix). `*`, `0` (« rien à dire » d'un dialogue) et `#fichier` (générique) n'ont pas de voix.
 */
export function sentenceSpeechNames(sentence: string, prefix: string): string[] {
  if (!sentence || sentence === "*" || sentence === "0" || sentence.startsWith("#")) return [];
  return splitSpeech(sentence)
    .filter((segment) => segment.command.kind !== "grab" && segment.text !== "")
    .map((segment) => speechFileName(prefix, segment.index));
}

/** Voix d'un dialogue : toutes les répliques de Joe et de la personne, l'ouverture et les retrouvailles. */
export function dialogSpeechNames(bytes: Uint8Array): string[] {
  const dog = parseDog(bytes);
  const names: string[] = [];
  dog.joeSentences.forEach((sentence, i) => {
    const prefix = i === 0 && sentence.head === 0 ? dialogOpeningVoicePrefix(dog.talkKey, "SSSS", "J") : dialogVoicePrefix(dog.talkKey, sentence.head, "J");
    names.push(...sentenceSpeechNames(sentence.text, prefix));
  });
  // La première phrase de la personne (tête 0) n'est jamais dite : `Talk::talk` ne cherche que les têtes de l'arbre.
  for (const sentence of dog.personSentences) {
    if (sentence.head !== 0) names.push(...sentenceSpeechNames(sentence.text, dialogVoicePrefix(dog.talkKey, sentence.head, "P")));
  }
  names.push(...sentenceSpeechNames(dog.person2.greeting, dialogOpeningVoicePrefix(dog.talkKey, "XXXX", "P")));
  names.push(...sentenceSpeechNames(dog.person2.joe, dialogOpeningVoicePrefix(dog.talkKey, "XXXX", "J")));
  return names;
}

/** Voix d'une cinématique : une phrase par enregistrement (un texte dit n'a que sa première voix). */
export function cutawaySpeechNames(file: string, bytes: Uint8Array, isPerson: (object: number) => boolean): { names: string[]; dialogue: string } {
  const cut = parseCutaway(bytes, isPerson);
  const names: string[] = [];
  cut.objects.forEach((object, i) => {
    const prefix = cutawayVoicePrefix(file, i + 1);
    // Seuls les enregistrements « personne » (Joe compris) et les textes dits sont prononcés.
    if (object.kind === "textSpeak" || object.kind === "textDisplayAndSpeak") {
      if (object.sentence) names.push(`${prefix}1`.toUpperCase());
    } else if (object.kind === "person") {
      names.push(...sentenceSpeechNames(object.sentence, prefix));
    }
  });
  return { names, dialogue: /\.DOG$/i.test(cut.talkFile) ? cut.talkFile : "" };
}

const endsWith = (text: string, extension: string): boolean => text.length > 4 && text.slice(-4).toUpperCase() === extension;

/**
 * Voix de la pièce `room` : dialogues et cinématiques nommés par les descriptions des listes de commandes de ses objets (avec les
 * cinématiques que leurs dialogues enchaînent), et voix de Joe pour les autres descriptions. Sans doublons.
 */
export function roomSpeechNames(g: FotaqEngine, room: number): string[] {
  const { jas } = g.data;
  const first = jas.roomFirstObject[room];
  const last = jas.roomFirstObject[room + 1];
  const inRoom = (object: number): boolean => object > first && object <= last;
  const names = new Set<string>();
  const files = new Set<string>();

  const { lists, states } = jas.commands;
  const ids = new Set<number>();
  for (let id = 1; id < lists.length; id++) if (inRoom(lists[id].object1) || inRoom(lists[id].object2)) ids.add(id);
  for (let i = 1; i < states.length; i++) {
    const record = states[i];
    if (!ids.has(record.id) || record.speakValue <= 0) continue;
    const description = g.objectDescriptionText(record.speakValue);
    if (endsWith(description, ".CUT") || endsWith(description, ".DOG")) files.add(description.toUpperCase());
    else for (const name of sentenceSpeechNames(description, joeVoicePrefix(record.speakValue + JOE_RESPONSE_MAX))) names.add(name);
  }

  const done = new Set<string>();
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (done.has(file) || !g.host.fileExists(file)) continue;
    done.add(file);
    const bytes = g.host.readFile(file);
    if (file.endsWith(".DOG")) {
      for (const name of dialogSpeechNames(bytes)) names.add(name);
      const dog = parseDog(bytes);
      if (dog.cutaway.file) queue.push(dog.cutaway.file.toUpperCase());
    } else {
      const cut = cutawaySpeechNames(file, bytes, (object) => isPerson(g.state.objects[object]?.image ?? 0));
      for (const name of cut.names) names.add(name);
      if (cut.dialogue) queue.push(cut.dialogue.toUpperCase());
    }
  }
  return [...names];
}
