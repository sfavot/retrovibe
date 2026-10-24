import type { AudioSink } from "../audio/sink";
import type { Frame } from "./graphics/frame";
import type { Input } from "./input";

/**
 * Frontière unique entre le moteur et l'extérieur : fichiers, temps, entrées, son, stockage, affichage et curseur.
 * Le moteur ne touche ni au DOM, ni à `fetch`, ni à `Date`, ni à `localStorage`.
 *
 * Implémentations : l'hôte navigateur (vague G2) et l'hôte de test (`test/mathemagique/engine-test-host.ts`).
 */

/** Stockage clé/valeur persistant ; les erreurs (quota, mode privé) sont avalées par l'implémentation. */
export interface HostStorage {
  get(key: string): string | null;
  /** Renvoie faux si l'écriture a échoué. */
  set(key: string, value: string): boolean;
  /** Efface la clé. */
  remove(key: string): void;
}

/**
 * Curseur demandé par le moteur (engine.md §1.3, §4.5). `arrow` = curseur système, `busy` = sablier (`CURS` 1 de `MILKYWAY.DAT`),
 * `help` = point d'interrogation (`CURS` 2), `hidden` = aucun (pièce portée, scènes qui dessinent leur propre pointeur).
 */
export type CursorKind = "arrow" | "busy" | "help" | "hidden";

export interface Host {
  /**
   * Charge un fichier du jeu. `path` est relatif à `original/mathemagique/` (`BOWLING.DAT`, `MPC/PVG.MHK`) ; la résolution est
   * insensible à la casse (`GameFiles.resolve`) car l'EXE demande `nim.DAT`, `PatFill.DAT`, `milkyway.dat`. Rejette si le fichier manque.
   */
  loadFile(path: string): Promise<Uint8Array>;
  /** Millisecondes monotones (`performance.now()`). */
  now(): number;
  /** Millisecondes Unix (horloge murale) : source de la graine du hasard. */
  unixMillis(): number;
  /** Entrées de bas niveau ; l'hôte les alimente depuis souris et clavier, le moteur les lit. */
  readonly input: Input;
  readonly audio: AudioSink;
  readonly storage: HostStorage;
  /**
   * Affiche une image. `frame.pixels` et `frame.palette` sont réutilisés d'une image à l'autre : les copier pour les garder.
   * Appelé seulement quand une scène a marqué l'image comme modifiée (`requestPresent`).
   */
  present(frame: Frame): void;
  /** Change le curseur affiché au-dessus de la zone de jeu. */
  setCursor(cursor: CursorKind): void;
  /**
   * Sort du jeu (Ctrl+Q, sifflet du hub). Navigateur : retour à l'accueil du site. Les scènes ne doivent rien faire d'autre après cet appel.
   */
  exit(): void;
}
