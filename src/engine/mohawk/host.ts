import type { BaseHost } from "../host";
import type { AudioSink } from "./audio/sink";
import type { Frame } from "./graphics/frame";
import type { Input } from "./input";

/**
 * Frontière unique entre le moteur Mohawk et l'extérieur : fichiers, temps, entrées, son, stockage, affichage et curseur.
 * Le moteur ne touche ni au DOM, ni à `fetch`, ni à `Date`, ni à `localStorage`.
 *
 * Implémentations : l'hôte navigateur (`src/ui/mohawk/browser-host.ts`) et les hôtes de test de chaque jeu.
 */

/** Stockage clé/valeur persistant (défini dans `src/engine/storage.ts`, réexporté ici pour les hôtes des jeux). */
export type { HostStorage } from "../storage";

/**
 * Police demandée à l'hôte : famille et hauteur au sens du `LOGFONT` de GDI. `height` négative = hauteur de caractère (em),
 * positive = hauteur de cellule (ascendante + descendante), comme `lfHeight`.
 */
export interface HostFontSpec {
  family: string;
  height: number;
}

/** Métriques d'une police, en pixels entiers : `lineHeight = ascent + descent` (pas d'interligne externe). */
export interface HostTextMetrics {
  ascent: number;
  descent: number;
  lineHeight: number;
}

/**
 * Chaîne rastérisée sans lissage : `bits` contient `width × height` octets valant 0 ou 1 (1 = pixel d'encre). La première ligne est le
 * haut de la cellule ; la ligne de base est à `ascent` (donc `height = lineHeight`).
 */
export interface TextMask {
  width: number;
  height: number;
  ascent: number;
  bits: Uint8Array;
}

/**
 * Texte vectoriel mis à disposition du moteur (jeux qui écrivent avec une police TrueType, comme Zoombinis). Synchrone : la police
 * est chargée avant le démarrage du jeu. Facultatif : Mathémagique a son propre texte bitmap et n'en a pas besoin.
 */
export interface HostText {
  metrics(font: HostFontSpec): HostTextMetrics;
  /** Largeur en pixels (entière) d'une ligne, sans retour à la ligne. */
  measure(font: HostFontSpec, text: string): number;
  rasterize(font: HostFontSpec, text: string): TextMask;
}

/**
 * Hôte d'un jeu Mohawk. `Cursor` est l'ensemble des curseurs que le jeu demande (par exemple `arrow`, `busy`, `help`, `hidden`) :
 * chaque jeu fixe le sien.
 */
export interface MohawkHost<Cursor extends string> extends BaseHost {
  /**
   * Charge un fichier du jeu. `path` est relatif au dossier `original/<jeu>/` ; la résolution est insensible à la casse
   * (`GameFiles.resolve`) car les exécutables demandent des noms dans une casse quelconque. Rejette si le fichier manque.
   */
  loadFile(path: string): Promise<Uint8Array>;
  /** Millisecondes Unix (horloge murale) : source de la graine du hasard. */
  unixMillis(): number;
  /** Entrées de bas niveau ; l'hôte les alimente depuis souris et clavier, le moteur les lit. */
  readonly input: Input;
  readonly audio: AudioSink;
  /** Texte TrueType, pour les jeux qui en ont besoin (Zoombinis) ; absent sinon. */
  readonly text?: HostText;
  /**
   * Affiche une image. `frame.pixels` et `frame.palette` sont réutilisés d'une image à l'autre : les copier pour les garder.
   * Appelé seulement quand une scène a marqué l'image comme modifiée (`requestPresent`).
   */
  present(frame: Frame): void;
  /** Change le curseur affiché au-dessus de la zone de jeu. */
  setCursor(cursor: Cursor): void;
  /**
   * Sort du jeu (Ctrl+Q, sifflet du hub). Navigateur : retour à l'accueil du site. Les scènes ne doivent rien faire d'autre après cet appel.
   */
  exit(): void;
}
