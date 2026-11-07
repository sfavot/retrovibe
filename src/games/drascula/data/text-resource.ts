import { decodeCp850 } from "../../../data/cp850";

/**
 * Lecteur des fichiers texte du jeu (`.ALD`, `.CAL`) : chaque octet est inversé (`~octet`), puis le texte
 * est en CP850, une valeur par ligne.
 *
 * Comportement tiré de `TextResourceParser` (engines/drascula/resource.cpp, ScummVM) : les `\r` sont
 * ignorés, les lignes vides sautées, et une chaîne est le premier mot de la ligne. Écart : une fin de
 * fichier ou un entier mal formé lance une erreur (ScummVM rend 0 ou une chaîne vide), ce qui permet de
 * détecter une mauvaise disposition de fichier.
 */
export class TextResource {
  private readonly lines: string[];
  private next = 0;

  constructor(bytes: Uint8Array, private readonly label = "fichier texte") {
    const inverted = Uint8Array.from(bytes, (byte) => byte ^ 0xff);
    this.lines = decodeCp850(inverted)
      .split("\n")
      .map((line) => line.replaceAll("\r", ""))
      .filter((line) => line !== "");
  }

  private line(): string {
    if (this.next >= this.lines.length) throw new Error(`${this.label} : fin de fichier inattendue`);
    return this.lines[this.next++];
  }

  /** Entier décimal, avec ou sans espaces autour. */
  int(): number {
    const text = this.line();
    if (!/^\s*[+-]?\d+\s*$/.test(text)) throw new Error(`${this.label} : entier attendu, lu « ${text} »`);
    return Number.parseInt(text, 10);
  }

  /** Premier mot de la ligne (les espaces de part et d'autre sont ignorés). */
  word(): string {
    return this.line().trim().split(/\s+/)[0];
  }

  /** Lignes non lues (ScummVM ne les lit jamais). */
  unread(): string[] {
    return this.lines.slice(this.next).map((line) => line.trim());
  }
}
