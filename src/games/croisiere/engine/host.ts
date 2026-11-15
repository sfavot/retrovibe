/**
 * Frontière entre le moteur de Croisière pour un cadavre et son environnement (navigateur ou test), sur le modèle de `BassHost`.
 *
 * Le moteur n'attend jamais : l'hôte appelle `CroisiereEngine.step()` toutes les 10 ms (`LOOP_DELAY_MS`, l'attente active de
 * `mainLoop`), et le moteur lance un tour tous les `gameSpeed` ms (50 pendant l'intro, 100 ensuite). Les événements sont lus pendant
 * l'attente, au plus un changement de bouton par tour (`manageEvents`).
 *
 * Module pur : aucune dépendance au navigateur. `TestHost` sert aux tests.
 */
import type { BaseHost } from "../../../engine/host";
import { MemoryStorage } from "../../../engine/storage";

/** Actions du clavier (`CruiseAction` de metaengine.cpp). */
export type CroisiereAction =
  | "escape"
  | "endUserWaiting"
  | "playerMenu"
  | "pause"
  | "exit"
  | "inventory"
  | "increaseGameSpeed"
  | "decreaseGameSpeed"
  | "fastMode";

/** Événement d'entrée (coordonnées dans l'écran de 320 × 200 ; `button` : 1 gauche, 2 droit). */
export type CroisiereInput =
  | { type: "move"; x: number; y: number }
  | { type: "down"; button: 1 | 2 }
  | { type: "up"; button: 1 | 2 }
  | { type: "actionStart"; action: CroisiereAction }
  | { type: "actionEnd"; action: CroisiereAction }
  | { type: "key" }
  | { type: "quit" };

export interface CroisiereHost extends BaseHost {
  /** Événements reçus depuis l'appel précédent (la file est vidée). */
  pollInput(): readonly CroisiereInput[];
  /** Journal du moteur (avertissements, commentaires du jeu). */
  log?(message: string): void;
  /** « Sauvegarder » choisi dans le menu joueur du jeu (dialogue commun du site, vague J). */
  onSaveRequest?(): void;
  /** « Charger » choisi dans le menu joueur du jeu. */
  onLoadRequest?(): void;
}

/** Hôte de test : entrées en file, journal en mémoire. */
export class TestHost implements CroisiereHost {
  readonly storage = new MemoryStorage();
  readonly lines: string[] = [];
  exited = false;
  private queue: CroisiereInput[] = [];
  private time = 0;

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }

  exit(): void {
    this.exited = true;
  }

  push(...inputs: CroisiereInput[]): void {
    this.queue.push(...inputs);
  }

  pollInput(): readonly CroisiereInput[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  log(message: string): void {
    this.lines.push(message);
  }
}
