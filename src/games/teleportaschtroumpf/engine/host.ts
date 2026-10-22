import type { AudioBackend } from "../audio/backend";
import type { Input } from "./input";

/**
 * Frontière unique entre le moteur et l'extérieur : fichiers, temps, entrées, son, stockage et affichage.
 * Le moteur ne touche ni au DOM, ni à `fetch`, ni à `Date`, ni à `localStorage`.
 *
 * Implémentations : `ui/browser-host.ts` (navigateur) et l'hôte de test (`test/teleportaschtroumpf/engine-test-host.ts`).
 */

/** Stockage clé/valeur persistant ; les erreurs (quota, mode privé) sont avalées par l'implémentation. */
export interface HostStorage {
  get(key: string): string | null;
  /** Renvoie faux si l'écriture a échoué. */
  set(key: string, value: string): boolean;
}

export interface Host {
  /**
   * Charge un fichier du jeu : nom d'origine en minuscules (`s22a001d.mcg`, `s52d0.mux`) ou chemin
   * `DATA/...`. La résolution passe par `resolveGameFile` (`engine/paths.ts`). Rejette si le fichier n'existe pas.
   */
  loadFile(name: string): Promise<Uint8Array>;
  /** Millisecondes monotones. */
  now(): number;
  /** Secondes Unix (horloge murale) : graine du hasard et verrou parental. */
  unixSeconds(): number;
  /** Entrées abstraites ; l'hôte les alimente depuis clavier / souris, le moteur les lit. */
  readonly input: Input;
  readonly audio: AudioBackend;
  readonly storage: HostStorage;
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
