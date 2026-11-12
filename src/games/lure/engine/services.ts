/**
 * Services du moteur que d'autres vagues fournissent, avec leurs versions minimales (comme `services.ts` de FOTAQ) : le son
 * (`SoundManager`, vague A), le mouvement (`PathFinder`, marche : `movement.ts`, G2), le bar (`BarmanLists`, vague L3) et les combats
 * (`FightsManager`, `fights/`, vague F). Le moteur ne dépend que de ces interfaces.
 *
 * Les versions minimales **journalisent** ce qu'elles ne font pas (`Journal`), pour qu'un test voie ce qui manque.
 */

import type { Hotspot } from "./hotspot";

/** Journal du moteur : dernières lignes, et relais vers l'hôte (`LureHost.log`). */
export class Journal {
  readonly lines: string[] = [];

  constructor(
    private readonly sink?: (message: string) => void,
    private readonly limit = 500,
  ) {}

  log(message: string): void {
    this.lines.push(message);
    if (this.lines.length > this.limit) this.lines.shift();
    this.sink?.(message);
  }

  clear(): void {
    this.lines.length = 0;
  }
}

/** Sous-ensemble de `SoundManager` (sound.cpp) appelé par la logique du jeu. */
export interface LureSound {
  /** `addSound(index, tidy)` : son de la table `0x3F18` d'indice `index`. */
  addSound(soundIndex: number, tidy?: boolean): void;
  /** `addSound2(index)` : comme `addSound`, sauf si le son joue déjà. */
  addSound2(soundIndex: number): void;
  /** `stopSound(index)`. */
  stopSound(soundIndex: number): void;
  /** `musicInterface_Stop(soundNumber)` (méthode 9 « KILL SOUND »). */
  killSound(soundNumber: number): void;
  /** `killSounds()` : coupe tout. */
  killSounds(): void;
  /** `removeSounds()` : retire les sons qui ne doivent pas survivre à un changement de pièce. */
  removeSounds(): void;
  /** `tidySounds()` puis `findSound(soundNumber) != null` (méthode 66). */
  isSoundActive(soundNumber: number): boolean;
  /** `musicInterface_Play(soundNumber, isMusic)`. */
  playMusic(soundNumber: number, isMusic: boolean): void;
  /** `musicInterface_TrashReverb()`. */
  trashReverb(): void;
  /** `musicInterface_ContinuePlaying()` : une fois par image. */
  continuePlaying(): void;
  pause(): void;
  resume(): void;
  /** Sauvegarde (`SoundManager::saveToStream`) : numéros des sons actifs, dans l'ordre où ils ont été lancés. Facultatif (son muet). */
  activeSoundNumbers?(): number[];
  /** Chargement (`SoundManager::loadFromStream`) : coupe tout, relance ceux des sons dont la description porte `SF_RESTORE`. */
  restoreSounds?(soundNumbers: readonly number[]): void;
  /**
   * Séquences plein écran (vague Q, facultatif : son muet) : `loadSection` (introduction, jeu, fin) ; fondu de 3 s de la musique de
   * l'introduction (`Sound.fadeOut` : `startFadeOut`, attendre `fading === false`, `finishFadeOut`).
   */
  loadSection?(section: "main" | "intro" | "ending"): void;
  startFadeOut?(): void;
  readonly fading?: boolean;
  finishFadeOut?(aborted?: boolean): void;
}

/** Son muet : retient les appels (tests), ne joue rien ; aucun son n'est jamais « en cours ». */
export class SilentSound implements LureSound {
  readonly calls: string[] = [];

  private record(call: string): void {
    this.calls.push(call);
    if (this.calls.length > 500) this.calls.shift();
  }

  addSound(soundIndex: number): void {
    this.record(`addSound ${soundIndex}`);
  }
  addSound2(soundIndex: number): void {
    this.record(`addSound2 ${soundIndex}`);
  }
  stopSound(soundIndex: number): void {
    this.record(`stopSound ${soundIndex}`);
  }
  killSound(soundNumber: number): void {
    this.record(`killSound ${soundNumber}`);
  }
  killSounds(): void {
    this.record("killSounds");
  }
  removeSounds(): void {
    this.record("removeSounds");
  }
  isSoundActive(): boolean {
    return false;
  }
  playMusic(soundNumber: number, isMusic: boolean): void {
    this.record(`playMusic ${soundNumber} ${isMusic}`);
  }
  trashReverb(): void {}
  continuePlaying(): void {}
  pause(): void {}
  resume(): void {}
}

/**
 * Mouvement d'un personnage : les actions `START_WALKING`, `PROCESSING_PATH` et `WALKING` de sa pile. Les gestionnaires de tick
 * l'appellent quand l'action en tête est l'une de ces trois ; il fait une étape (recherche de chemin, un pas, sortie franchie) et met à
 * jour la pile. Implémentation : `LureMovement` (`movement.ts`) ; les tests peuvent le remplacer (téléportation).
 */
export interface Movement {
  /** Budget d'un appel de la recherche de chemin (`PATHFIND_COUNTDOWN`) : 0, recherche d'un trait comme ScummVM. */
  readonly pathfindCountdown: number;
  /** Marche du joueur (cas de marche de `playerAnimHandler`) ; `impinging` : personnages qui le touchent. */
  walkPlayer(h: Hotspot, impinging: readonly number[]): void;
  /** Marche d'un PNJ (cas de marche de `standardCharacterAnimHandler`). */
  walkCharacter(h: Hotspot, impinging: readonly number[], bumpedPlayer: boolean): void;
  /** `PathFinder::clear()` (méthode 7 « RESET PATHFINDER », attentes). */
  clearPath(h: Hotspot): void;
}

/** Résultat de `Hotspot::getBarPlace` (`BarPlaceResult`). */
export type BarPlace = "keepTrying" | "gotThere" | "fail";

/** Le bar (vague L3) : place d'un client au comptoir (`getBarPlace`), service (`barmanServe`). */
export interface Bar {
  getBarPlace(h: Hotspot): BarPlace;
  /** État à sauvegarder (JSON, listes de `BarmanLists`), `undefined` s'il n'y en a pas ; repris par `restoreState` (vague S). */
  saveState?(): unknown;
  restoreState?(state: unknown): void;
  /** Redémarrage de la partie : listes de clients vides. */
  reset?(): void;
}

export class StubBar implements Bar {
  constructor(private readonly journal: Journal) {}

  getBarPlace(h: Hotspot): BarPlace {
    this.journal.log(`bar non porté (L3) : getBarPlace ${h.hotspotId.toString(16)}`);
    return "gotThere";
  }
}

/**
 * Combats (vague F) : `FightsManager` (`fights/manager.ts`). `isFighting` reste vrai pendant tout le combat ; `fightLoop()` fait une image
 * du combat (événements, tick des hotspots et de la liste des séquences différées), appelée à chaque image tant que `isFighting`.
 */
export interface Fights {
  readonly isFighting: boolean;
  fightLoop(): void;
  reset(): void;
  /** État à sauvegarder (JSON, les trois `FighterRecord`), `undefined` s'il n'y en a pas ; repris par `restoreState` (vague S). */
  saveState?(): unknown;
  restoreState?(state: unknown): void;
}
