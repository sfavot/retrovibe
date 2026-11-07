import { TextResource } from "./text-resource";

/**
 * Choix de dialogue `.CAL` (`OP_<n>.CAL`) : les quatre répliques proposées au joueur, le fichier de voix de
 * chacune, puis le numéro de réponse des trois premières.
 *
 * Disposition tirée de `converse` (engines/drascula/converse.cpp, ScummVM). Les espaces des répliques sont
 * codés par l'octet `0xA7` (`º` en CP850), car une chaîne du fichier est lue jusqu'au premier espace ;
 * `cleanupString` de ScummVM les remplace après lecture, comme ici. Les remplacements de réplique selon les
 * drapeaux du jeu (`OP_5` et `OP_12`) relèvent du moteur, pas de ce lecteur.
 */

export interface CalChoice {
  /** Réplique affichée. */
  text: string;
  /** Fichier de voix (`357.als`). */
  voice: string;
}

export interface CalDialog {
  /** Les quatre choix, dans l'ordre d'affichage ; le quatrième est la sortie du dialogue. */
  choices: [CalChoice, CalChoice, CalChoice, CalChoice];
  /** Numéro de réponse (`response(n)`) des trois premiers choix. */
  answers: [number, number, number];
  /** Lignes que ScummVM ne lit pas. */
  unread: string[];
}

export function parseCal(bytes: Uint8Array): CalDialog {
  const text = new TextResource(bytes, "CAL invalide");
  const phrases = [text.word(), text.word(), text.word(), text.word()].map((phrase) => phrase.replaceAll("º", " "));
  const voices = [text.word(), text.word(), text.word(), text.word()];
  const answers: [number, number, number] = [text.int(), text.int(), text.int()];
  const choices = phrases.map((phrase, i) => ({ text: phrase, voice: voices[i] })) as CalDialog["choices"];
  return { choices, answers, unread: text.unread() };
}
