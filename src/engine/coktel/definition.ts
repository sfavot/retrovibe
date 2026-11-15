/**
 * Descripteur d'un jeu sur le moteur Coktel : ce que ScummVM choisit par le type de jeu (`gob.cpp:558-633` :
 * classes Inter, SaveLoad… instanciées ; `getGameType()` testé dans les rustines). Le moteur
 * (`src/engine/coktel/`) ne connaît aucun jeu : tout ce qui est propre à l'un passe par ici.
 */
import type { HostStorage } from "../storage";
import type { CdBackend } from "./audio/backend";
import type { Game } from "./game";
import type { GraphicsSystems } from "./graphics";
import type { CdSystem, SaveSystem, VmContext } from "./host";
import type { Instr } from "./opcodes";

/** Version de l'interpréteur : Inter_v2 (Ween, Gobliins 2) ou Inter_v3 (Lost in Time, Goblins 3). */
export type InterpreterVersion = 2 | 3;

/** Ce dont dispose la fabrique des sauvegardes. */
export interface SaveEnvironment {
  gfx: GraphicsSystems;
  store: HostStorage;
}

/** Sauvegardes d'un jeu (SaveLoad_v2, SaveLoad_v3…), reliées à la machine virtuelle à sa construction. */
export type GameSaveSystem = SaveSystem & { attach?(vm: VmContext): void };

/** Ce dont dispose la fabrique du CD. */
export interface CdEnvironment {
  backend: CdBackend;
  now(): number;
  /** Fichier des archives ouvertes, ou fichier ordinaire déjà chargé par l'hôte. */
  getFile(name: string): Uint8Array | undefined;
}

/**
 * Crochets d'un jeu dans l'interpréteur. Tous facultatifs ; `true` renvoyé par un crochet « before »
 * remplace le comportement du moteur (l'appel est sauté).
 */
export interface GameHooks {
  /** Avant chaque commande, opérandes non encore évalués (rustines « par position » de ScummVM). */
  beforeOpcode?(game: Game, ins: Instr): boolean | void;
  /**
   * o1_keyFunc, après animPalette, blitInvalidated et handleBusyWait, avant la commande (`inter_v1.cpp:1366-1381` :
   * rustine VAR(59) de Ween).
   */
  onKeyFunc?(game: Game, ins: Instr): void;
  /** o1_callSub vers `offset` (après le refus des offsets de l'en-tête) ; true : l'appel est sauté (protection de copie). */
  beforeCallSub?(game: Game, offset: number): boolean | void;
  /** o2_totSub vers `totFile` (sans extension) ; true : le crochet a pris l'appel en charge. */
  beforeTotSub?(game: Game, totFile: string): boolean | void;
  /** o2_checkData d'un fichier ordinaire : true le fait voir absent. */
  hidesFile?(game: Game, file: string): boolean;
  /**
   * o2_readData a rempli les variables : depuis une sauvegarde (`fromSave`, `dataVar` et `size` tels que
   * demandés, 0 = toutes les variables) ou depuis un fichier (`size` 0 déjà ramené à `dataVar` 0).
   */
  afterReadData?(game: Game, read: { file: string; fromSave: boolean; dataVar: number; size: number }): void;
  /** playTot va charger ce TOT (`loadTot` comme `totSub`), qu'il existe ou non (traces des tests). */
  onLoadTot?(game: Game, totFile: string): void;
  /** TOT introuvable : le moteur arrête le jeu (`terminate = 2`, `game.cpp:612-616`) ; le crochet est prévenu avant. */
  onMissingTot?(game: Game, totFile: string): void;
}

export interface CoktelGameDefinition {
  /** Identifiant court (messages, préfixes). */
  readonly id: string;
  readonly version: InterpreterVersion;
  /** Archive et script de départ (`intro.stk` / `intro.tot` par défaut dans ScummVM). */
  readonly startArchive: string;
  readonly startTot: string;
  /**
   * Vidéos qui gardent le curseur affiché (VideoPlayer::openVideo, `videoplayer.cpp:207-226` : listes de
   * Lost in Time et de Goblins 3), noms sans extension en majuscules.
   */
  readonly videosWithCursor?: readonly string[];
  /**
   * Ne recopier de la palette d'un film que les index qu'il dessine (écart volontaire de Lost in Time, voir
   * `VideoPlayer.copyPalette`). Absent : toute la plage, comme ScummVM.
   */
  readonly restrictVideoPalette?: boolean;
  /** Sauvegardes du jeu (SaveLoad_vN). */
  readonly createSaves: (env: SaveEnvironment) => GameSaveSystem;
  /** Musique du CD ; sans elle, les commandes du CD ne font rien (pas de CD, comme ScummVM sans lecteur). */
  readonly createCd?: (env: CdEnvironment) => CdSystem;
  /** Crochets sans état ; un jeu qui en a besoin d'un par partie les passe à la construction de `Game`. */
  readonly hooks?: GameHooks;
}
