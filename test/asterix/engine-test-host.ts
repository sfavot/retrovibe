import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameFiles, type GameFileEntry } from "../../src/data/game-files";
import { resolveGameFile } from "../../src/games/asterix/engine/paths";
import { TestHost } from "../teleportaschtroumpf/engine-test-host";

export { runFor, runUntil } from "../teleportaschtroumpf/engine-test-host";

const ORIGINAL = resolve(import.meta.dirname, "../../original/asterix");

/** Hôte de test du moteur commun (temps simulé, sons et présentations enregistrés) sur les fichiers de `original/asterix/`. */
export class AsterixTestHost extends TestHost {
  private asterixFiles: GameFiles | null = null;

  override filePath(name: string): string | undefined {
    this.asterixFiles ??= new GameFiles(JSON.parse(readFileSync(resolve(ORIGINAL, "files.json"), "utf8")) as GameFileEntry[]);
    return resolveGameFile(this.asterixFiles, name);
  }

  override async loadFile(name: string): Promise<Uint8Array> {
    const path = this.filePath(name);
    if (!path) throw new Error(`fichier introuvable : ${name}`);
    this.loaded.push(path);
    return new Uint8Array(readFileSync(resolve(ORIGINAL, path)));
  }
}
