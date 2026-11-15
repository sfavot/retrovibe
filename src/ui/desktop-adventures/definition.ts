import type { Assets } from "../../engine/desktop-adventures/assets";
import type { SoundCatalog } from "../../engine/desktop-adventures/audio/audio";
import type { Palette } from "../../engine/desktop-adventures/data/palette";
import type { Bitmap, Cursor, Icon } from "../../engine/desktop-adventures/data/resources";
import type { GameData } from "../../engine/desktop-adventures/data/types";
import type { Point } from "../../engine/desktop-adventures/geometry";
import type { DesktopVariant } from "../../engine/desktop-adventures/variant";
import type { Story, WorldSize } from "../../engine/desktop-adventures/world";
import type { Progress, ProgressRules } from "./progress";

/** Textes de l'interface commune (chaque jeu fournit les siens, voir `src/games/<jeu>/copy.ts`). */
export interface DesktopCopy {
  newGame: string;
  worldSize: string;
  sizes: Record<number, string>;
  difficulty: string;
  difficulties: Record<number, string>;
  gameSpeed: string;
  speeds: Record<number, string>;
  speedButton(label: string): string;
  start: string;
  replayStory: string;
  noStoryToReplay: string;
  generating: string;
  inventory: string;
  weapon: string;
  noWeapon: string;
  /** Jauge de munitions à côté de la case d'arme (jeux à munitions). */
  ammo?: string;
  health: string;
  healthPercent(percent: number): string;
  compassOpen(directions: string): string;
  compassClosed: string;
  directions: { up: string; down: string; left: string; right: string };
  map: string;
  sound: string;
  music: string;
  pause: string;
  resume: string;
  resumeGame: string;
  resumeHint: string;
  paused: string;
  manual: string;
  manualBack: string;
  manualContents: string;
  manualNote: string;
  manualLoading: string;
  manualUnavailable: string;
  help: string;
  helpText: string[];
  continueHint: string;
  continueTouchHint: string;
  scrollUp: string;
  scrollDown: string;
  found(name: string): string;
  winTitle: string;
  score(n: number): string;
  /** Meilleur score retenu, affiché sur l'écran titre. */
  bestScore(n: number): string;
  keepPlaying: string;
  loseTitle: string;
  tryAgain: string;
  briefing: string;
  gameView: string;
  attack: string;
  use: string;
  useItem: string;
  teleportTitle: string;
  teleportTo(x: number, y: number): string;
  close: string;
  clueRequires(item: string): string;
  clueFind(item: string): string;
  clueOpen: string;
  clueSolved: string;
  clueItem: Record<"weapon" | "map" | "tool" | "part" | "valuable" | "key" | "useful" | "unknown", string>;
  clueLabel(x: number, y: number): string;
}

/** Tuiles du localisateur (carte du monde) : [non résolu, résolu] pour les secteurs à deux états. */
export interface LocatorTiles {
  unvisited: number;
  here: number;
  empty: number;
  town: number;
  goal: [number, number];
  travel: [number, number];
  puzzle: [number, number];
  /** Case vide à téléporteur : tuiles superposées. */
  teleporter: number[];
  /** Barrages, par type de zone (BlockadeNorth…). */
  blockade: Record<number, [number, number]>;
  /** Fond de la carte, en 0xAABBGGRR. */
  background: number;
}

/** Ressources lues dans les fichiers du jeu au démarrage. */
export interface DesktopResources {
  data: GameData;
  palette: Palette;
  loadManual(): Promise<ArrayBuffer>;
  /** Sommaire d'origine de l'aide (fichier .CNT, Yoda), facultatif. */
  loadManualContents?(): Promise<ArrayBuffer>;
  cursors: Map<number, Cursor>;
  icons: Map<number, Icon>;
  bitmaps: Map<string, Bitmap>;
}

/** Nouvelle partie : histoire générée et case de départ du héros. */
export interface NewStory {
  story: Story;
  start: { zone: number; at: Point };
}

/** Un jeu du moteur « Desktop Adventures » tel que l'interface commune le présente. */
export interface DesktopAdventure {
  /** Préfixe des clés de stockage local et nom de l'accès de débogage (`__<key>`). */
  readonly key: string;
  readonly variant: DesktopVariant;
  readonly copy: DesktopCopy;
  /** Sons du jeu (noms de fichiers, musiques, sons de l'exécutable). */
  readonly sounds: SoundCatalog;
  /** Musique jouée au début d'une partie. */
  readonly theme: number;
  /** Touche (KeyboardEvent.code) qui ouvre la carte. */
  readonly mapKey: string;
  /** Sons d'ouverture et de fermeture de la carte (Yoda : LOCATOR.WAV, MAPCLS.WAV), facultatifs. */
  readonly mapSounds?: { open: number; close: number };
  readonly locator: LocatorTiles;
  /** Zones dont l'image illustre la fenêtre de fin (Indy). Sans elles, la scène de fin se joue dans la vue (`DesktopVariant.endZones`). */
  readonly endPictures?: { win: number; lose: number };
  /** Icônes de la boussole dans l'exécutable : flèche éteinte puis allumée, par direction. */
  readonly compassIcons: Record<"up" | "down" | "left" | "right", { off: number; on: number }>;
  /** Curseur CURSOR de la flèche ←, première des huit flèches de marche à la souris. */
  readonly walkCursorFirstId: number;
  /** Règles de la progression (historique des objectifs, plafond des victoires). */
  readonly progress: ProgressRules;
  /** Génère une histoire ; `goal` impose l'objectif (« rejouer »). */
  newStory(assets: Assets, seed: number, size: WorldSize, progress: Progress, goal?: number): NewStory;
  /** Ce que la progression retient d'une histoire qui démarre (Yoda : sa planète, exclue de la suivante). */
  lastWorldOf?(story: Story): number;
}
