import type { BaseHost } from "../host";
import type { AudioBackend } from "./audio/backend";
import type { Input } from "./input";

/**
 * Frontière unique entre le moteur et l'extérieur : fichiers, temps, entrées, son, stockage et affichage.
 * Le moteur ne touche ni au DOM, ni à `fetch`, ni à `Date`, ni à `localStorage`.
 *
 * Implémentations : `ui/browser-host.ts` (navigateur) et les hôtes de test des jeux (par ex. `test/teleportaschtroumpf/engine-test-host.ts`).
 */

/** Stockage clé/valeur persistant (défini dans `src/engine/storage.ts`, réexporté ici pour les hôtes du jeu). */
export type { HostStorage } from "../storage";

export interface Host extends BaseHost {
  /**
   * Charge un fichier du jeu, demandé par son nom d'origine (`s22a001d.mcg`) ou par un chemin. Le nom est traduit en
   * chemin par le résolveur du jeu, que l'hôte reçoit à sa construction. Rejette si le fichier n'existe pas.
   */
  loadFile(name: string): Promise<Uint8Array>;
  /**
   * Chemin, dans le dossier du jeu, du fichier que `loadFile(name)` lirait (par ex. `DATA/S07/S07A/S07A001B.VOC.mp3`) :
   * c'est la clé des index rangés par chemin (`audio.json`). `undefined` si le fichier n'existe pas.
   */
  filePath(name: string): string | undefined;
  /** Secondes Unix (horloge murale) : graine du hasard, et ce que le jeu en fait (verrou parental…). */
  unixSeconds(): number;
  /** Entrées abstraites ; l'hôte les alimente depuis clavier / souris, le moteur les lit. */
  readonly input: Input;
  readonly audio: AudioBackend;
  /**
   * Affiche une image : `surface` = 320×200 indices de palette (tampon de travail A),
   * `palette` = 768 octets RVB 8 bits déjà prêts pour l'écran (fondu, couleur 0 noire et quantification VGA appliqués).
   * Les deux tampons sont réutilisés d'une image à l'autre : les copier si on les garde.
   */
  present(surface: Uint8Array, palette: Uint8Array): void;
  /**
   * Sort du jeu (« Quitter », après le générique). Navigateur : retour à l'accueil du site, ou redémarrage sur la
   * page de dev. Les scènes ne doivent rien faire d'autre après cet appel.
   */
  exit(): void;
}
