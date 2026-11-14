/**
 * Frontière entre le moteur de *Beneath a Steel Sky* et son environnement (navigateur ou test), sur le modèle de `LureHost`.
 *
 * Le moteur n'attend jamais : l'hôte appelle `BassEngine.tick()` toutes les 20 ms (`TICK_MS`, le pas des fondus et des attentes de
 * ScummVM) ; le moteur cumule le temps et lance un tour de jeu tous les `gameSpeed` ms (80 par défaut). Les entrées sont lues au début de
 * chaque tour, comme les événements que `SkyEngine::delay` transmet à la souris à la fin du tour précédent.
 *
 * Vague C : entrées (souris, actions), journal, sortie. Image (vague R) et son (vague A) passent par les services de `services.ts`.
 * Vague S : touches du panneau de contrôle (F5) et de la pause, relâchement du bouton (curseurs du panneau), demandes de sauvegarde et de
 * restitution (dialogues communs du site, D5), réglages du panneau à mémoriser.
 *
 * Module pur : aucune dépendance au navigateur. `TestHost` sert aux tests (entrées en file, journal gardé).
 */

import type { BaseHost } from "../../../engine/host";
import { MemoryStorage } from "../../../engine/storage";
import type { TextVoiceMode } from "./text";

/** Boutons tels que `Mouse::buttonPressed` les reçoit : 2 = gauche (`EVENT_LBUTTONDOWN`), 1 = droit (`EVENT_RBUTTONDOWN`). */
export const MouseButton = { Left: 2, Right: 1 } as const;

/**
 * Actions du clavier (`SkyAction` de metaengine.cpp) : Échap (`skip`), passer une réplique (`.`), pause (`p`), panneau de contrôle (F5,
 * `panel`). `key` : toute autre touche, que le jeu n'utilise pas mais qui reprend le jeu en pause (`_keyPressed.keycode`) et abandonne le
 * panneau d'une restitution.
 */
export type BassAction = "skip" | "skipLine" | "pause" | "panel" | "key";

/**
 * Entrée de l'utilisateur. Coordonnées dans l'écran de 320 × 200 (celles des événements de ScummVM, avant `TOP_LEFT_X/Y`).
 * `move` déplace le pointeur ; `click` le déplace puis appuie (comme `EVENT_LBUTTONDOWN` / `EVENT_RBUTTONDOWN`) ; `release` relâche le bouton
 * (`EVENT_LBUTTONUP`) : seul le panneau de contrôle s'en sert (glisser les curseurs de volume et de vitesse), le jeu lit des clics.
 */
export type BassInput =
  | { type: "move"; x: number; y: number }
  | { type: "click"; x: number; y: number; button: (typeof MouseButton)[keyof typeof MouseButton] }
  | { type: "release"; x: number; y: number }
  | { type: "action"; action: BassAction };

/** Réglages du panneau de contrôle que l'hôte peut mémoriser (`ConfMan` de ScummVM : `music_volume`, `sfx_mute`, `subtitles`, `speech_mute`). */
export interface BassSettings {
  /** Volume de la musique, de 0 à 127. */
  musicVolume: number;
  /** Millisecondes par tour de jeu (curseur de vitesse, 2 à 134 ; 80 par défaut). */
  gameSpeed: number;
  fxOff: boolean;
  textMode: TextVoiceMode;
}

export interface BassHost extends BaseHost {
  /** Entrées reçues depuis l'appel précédent (la file est vidée). */
  pollInput(): readonly BassInput[];
  /** Journal du moteur (mcodes en souche, avertissements de ScummVM). Facultatif : le moteur garde aussi les dernières lignes. */
  log?(message: string): void;
  /**
   * Bouton « Sauvegarder » du panneau, ou menu du site : l'hôte ouvre le dialogue des emplacements (`ui/saves.ts`) puis rend la main par
   * `GameControl.finishDialog`. Sans méthode, le bouton est sans effet.
   */
  requestSave?(): void;
  /** Bouton « Restituer » du panneau, ou `fnRestoreGame` (fin de partie) : même chose pour le dialogue de restitution. */
  requestRestore?(): void;
  /** Un réglage du panneau a changé (relâchement d'un curseur, effets, texte / voix) : à mémoriser. */
  settingsChanged?(settings: BassSettings): void;
}

/** Hôte de test : temps compté par le moteur, entrées en file, journal en mémoire. */
export class TestHost implements BassHost {
  readonly storage = new MemoryStorage();
  readonly lines: string[] = [];
  /** Demandes de sauvegarde et de restitution reçues (`requestSave`, `requestRestore`) et réglages notifiés. */
  saveRequests = 0;
  restoreRequests = 0;
  readonly settings: BassSettings[] = [];
  exited = false;
  private queue: BassInput[] = [];
  private time = 0;

  now(): number {
    return this.time;
  }

  /** Avance l'horloge de l'hôte (le moteur, lui, compte ses ticks). */
  advance(ms: number): void {
    this.time += ms;
  }

  exit(): void {
    this.exited = true;
  }

  /** Ajoute une entrée, lue au prochain tour de jeu. */
  push(...inputs: BassInput[]): void {
    this.queue.push(...inputs);
  }

  pollInput(): readonly BassInput[] {
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

  requestRestore(): void {
    this.restoreRequests++;
  }

  settingsChanged(settings: BassSettings): void {
    this.settings.push({ ...settings });
  }
}
