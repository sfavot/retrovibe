/**
 * Frontière entre le moteur des *Voyageurs du temps* et son environnement (navigateur ou test), sur le modèle de `BassHost`.
 *
 * Le moteur n'attend jamais : l'hôte appelle `VoyageursEngine.step()` toutes les 10 ms (`STEP_MS`, le pas d'attente de `manageEvents` dans
 * ScummVM) ; un tick de jeu (≈ 110 ms) dure 11 à 12 pas, plus les fondus et les attentes de clic. Les entrées reçues par `pollInput` sont
 * traitées au pas suivant, dans l'ordre, comme les événements que `manageEvents` dépile.
 *
 * Module pur : aucune dépendance au navigateur. `TestHost` sert aux tests (fichiers en mémoire, entrées en file, journal gardé).
 */

import type { BaseHost } from "../../../engine/host";
import { MemoryStorage } from "../../../engine/storage";
import type { VoyageursFiles } from "./part";
import type { VoyageursAudio } from "./services";

/** Bouton de souris : `both` = bouton du milieu ou deux boutons ensemble (menu système). */
export type MouseButton = "left" | "right" | "both";

/**
 * Actions du clavier (`metaengine.cpp`) : F1 à F6 (verbes), F9 (menu des verbes), F10 (menu système), molette ou flèches dans un menu
 * (`menuUp`, `menuDown`). Entrée et Échap sont des clics (`down` / `up`) que l'hôte envoie lui-même.
 */
export type VoyageursAction = "examine" | "take" | "inventory" | "use" | "activate" | "speak" | "actionMenu" | "systemMenu" | "menuUp" | "menuDown";

/**
 * Entrée de l'utilisateur, en coordonnées de l'écran 320 × 200. `walk` : déplacement au clavier (pavé numérique), `dx` / `dy` dans -1, 0,
 * 1 (0, 0 = arrêt) ; `dy` > 0 vers le haut, comme `moveUsingKeyboard`.
 */
export type VoyageursInput =
  | { type: "move"; x: number; y: number }
  | { type: "down"; button: MouseButton; x?: number; y?: number }
  | { type: "up"; button: MouseButton; x?: number; y?: number }
  | { type: "action"; action: VoyageursAction }
  | { type: "walk"; dx: number; dy: number };

export interface VoyageursHost extends BaseHost {
  /** Fichiers du jeu (`PART01`… `PART04B`, `AUTO00.PRC`). */
  readonly files: VoyageursFiles;
  /** Son (vague A) ; silence si absent. */
  readonly audio?: VoyageursAudio;
  /** Entrées reçues depuis l'appel précédent (la file est vidée). */
  pollInput(): readonly VoyageursInput[];
  log?(message: string): void;
  /** « Sauver la partie » du menu système : l'hôte ouvre le dialogue commun du site (D9, vague S). */
  requestSave?(): void;
  /** « Charger une partie » : dialogue commun de chargement. */
  requestLoad?(): void;
}

/** Hôte de test : fichiers en mémoire, temps compté par le moteur, entrées en file, journal en mémoire. */
export class TestHost implements VoyageursHost {
  readonly storage = new MemoryStorage();
  readonly lines: string[] = [];
  saveRequests = 0;
  loadRequests = 0;
  exited = false;
  private queue: VoyageursInput[] = [];
  private time = 0;

  constructor(
    readonly files: VoyageursFiles,
    readonly audio?: VoyageursAudio,
  ) {}

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }

  exit(): void {
    this.exited = true;
  }

  push(...inputs: VoyageursInput[]): void {
    this.queue.push(...inputs);
  }

  pollInput(): readonly VoyageursInput[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  log(message: string): void {
    this.lines.push(message);
  }

  requestSave(): void {
    this.saveRequests++;
  }

  requestLoad(): void {
    this.loadRequests++;
  }
}
