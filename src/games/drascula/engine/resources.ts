import { type AldRoom, parseAld } from "../data/ald";
import { type DatTextName, type DrasculaDat, parseDat } from "../data/dat";
import { roomFile } from "../data/files";

/**
 * Données du jeu lues par le moteur : `drascula.dat` (textes français, tables) une fois, puis les fiches de pièces `.ALD` à la
 * demande. Le code ne contient aucune donnée du jeu (`plan.md`, « Décisions ») : tout vient des fichiers, par l'hôte.
 */
export class DrasculaData {
  readonly dat: DrasculaDat;
  private readonly rooms = new Map<string, AldRoom>();

  constructor(private readonly readFile: (name: string) => Uint8Array) {
    this.dat = parseDat(readFile("drascula.dat"), { languages: ["fr"] });
  }

  /** Ligne `index` d'une section de textes, en français (chaîne vide hors du tableau, comme une ligne vide). */
  text(section: DatTextName, index: number): string {
    return this.dat.texts[section].fr?.[index] ?? "";
  }

  /**
   * Fiche de la pièce `room` lue dans la disposition du chapitre `chapter` (`parseAld`) ; mise en cache. Lève si la fiche
   * n'existe pas ou ne se lit pas dans cette disposition (pièce d'un autre chapitre).
   */
  room(room: number, chapter: number): AldRoom {
    const layout = chapter === 2 ? 2 : 0;
    const key = `${room}:${layout}`;
    let ald = this.rooms.get(key);
    if (!ald) {
      ald = parseAld(this.readFile(roomFile(room)), chapter);
      if (ald.number !== room) throw new Error(`${roomFile(room)} : la fiche porte le numéro ${ald.number}`);
      this.rooms.set(key, ald);
    }
    return ald;
  }
}
