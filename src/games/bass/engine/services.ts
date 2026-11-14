/**
 * Services du moteur fournis par les vagues suivantes, avec leurs souches de la vague C.
 *
 * Références (ScummVM engines/sky/, GPL v3 ou ultérieure) : screen.cpp (`Screen` : palettes, fondus, défilement, séquences « swing »),
 * sound.cpp et music/musicbase.cpp (`Sound`, `MusicBase`), text.cpp (`Text`), grid.cpp (`Grid`), autoroute.cpp (`AutoRoute`).
 *
 * La logique n'attend d'eux que des réponses simples (une voix est-elle finie ? un texte a-t-il été formé ? une route existe-t-elle ?) ; le
 * reste est de l'image ou du son. Les souches répondent comme ScummVM sans image ni son : pas de voix (`startSpeech` faux, `speechFinished`
 * vrai), pas de séquence en cours, pas de texte formé (`lowTextManager` rend `null` : les mcodes de texte journalisent et ne font que leur
 * partie logique, voir `mcodes/text.ts`), grille sans effet, route « déjà sur place ». Ce sont des services de test : par défaut le moteur
 * utilise `BassTextManager`, `Grid` et `AutoRoute` (`engine.md` § 16).
 */

import type { CompactView } from "./compacts";

/** Écran (vague R) : appelé par les mcodes et par les effets bloquants (`effects.ts`). */
export interface BassScreen {
  /** `setPaletteEndian` d'un compact de palette (`fnSetPalette`, retour du panneau). */
  setPalette(paletteCpt: number): void;
  /** `fnFadeDown(scroll)` commence : fondu au noir (32 pas) ou, pour `scroll` 123 / 321, préparation d'un défilement. */
  fadeDown(scroll: number): void;
  /** Nouveau décor dessiné entre les deux fondus de `fnDrawScreen` (`forceRefresh`, `recreate`, `spriteEngine`, `flip`). */
  drawNewScreen(): void;
  /** `fnFadeUp(palette, scroll)` commence : fondu depuis le noir ou défilement. */
  fadeUp(paletteCpt: number, scroll: number): void;
  /** `recreate`, `spriteEngine`, `flip` : composition de l'image d'un tour (`SkyEngine::go`, après `processSequence`) et de `fnLookAt`. */
  compose(): void;
  /** `Control::restartGame` : grille à recopier en entier (`forceRefresh`), écrans de travail et affiché remis à 0 (avant `setPalette`). */
  reset(): void;
  /** Pas de 20 ms d'un effet bloquant en cours (`step` de 0 à `total - 1`). */
  effectStep(name: string, step: number, total: number): void;
  /** `clearScreen` (`fnBlankScreen`). */
  clearScreen(): void;
  /** `startSequenceItem` (`fnNewSwingSeq`) : séquence d'images déjà chargée (`fetchItem`) ; `now` en ms du moteur. */
  startSequence(item: number, data: Uint8Array | null, now: number): void;
  /** Vrai tant qu'une séquence tourne (`_seqInfo.running`). */
  sequenceRunning(): boolean;
  /** `processSequence` : une image toutes les 60 ms ; `now` en ms du moteur. */
  processSequence(now: number): void;
  /** Rectangle d'intérêt (`setFocusRectangle`, accessibilité de ScummVM) : centre du personnage qui parle. */
  setFocus?(x: number, y: number): void;
}

/** Son, musique et voix (vague A). */
export interface BassSound {
  /** `fnEnterSection` : charge la musique et les effets de la section `section + 1` (1 à 7) ; `gameRestored` (`SF_GAME_RESTORED`) garde les effets à relancer. */
  loadSection(section: number, gameRestored?: boolean): void;
  startMusic(music: number): void;
  /** `fnStartFx(sound, channel)` ; `volume` vient d'un programme d'animation (`LF_START_FX`), ignoré par ScummVM. */
  startFx(sound: number, channel: number): void;
  stopFx(): void;
  pauseFx(): void;
  unPauseFx(): void;
  /** `checkFxQueue` : effets différés, au début de chaque tour. */
  checkFxQueue(): void;
  /** `startSpeech(textNum)` : vrai si la voix existe et part. */
  startSpeech(textNum: number): boolean;
  speechFinished(): boolean;
  stopSpeech(): void;
}

/** Texte formé par `Text::lowTextManager` : compact de texte utilisé (`CPT_TEXT_n`) et nombre de lettres (durée sans voix). */
export interface DisplayedText {
  readonly compactNum: number;
  readonly numLetters: number;
  /** Largeur et hauteur du sprite de texte. */
  readonly width: number;
  readonly height: number;
  /** Sprite du texte (en-tête `DataFileHeader` compris), modifiable (trame de `fnChooser`). */
  readonly sprite?: Uint8Array;
}

/** Textes (vague M3, sur `data/text.ts`). */
export interface BassText {
  /** `lowTextManager(textNum, width, logicNum, color, center)` ; `null` avec `NullText` (aucun texte formé). */
  lowTextManager(textNum: number, width: number, logicNum: number, color: number, center: boolean): DisplayedText | null;
  /** `fnTextModule(textInfoId, textNo)`. */
  textModule(textInfoId: number, textNo: number): void;
  /** `fnPointerText(pointedId, mouseX, mouseY)`. */
  pointerText(pointedId: number, mouseX: number, mouseY: number): void;
  /** `logicCursor(textCompact, mouseX, mouseY)` (logique `L_CURSOR`). */
  logicCursor(cpt: CompactView, mouseX: number, mouseY: number): void;
  setFont(font: number): void;
  /** `changeTextSpriteColor` (`fnHighlight`). */
  changeTextSpriteColor(sprite: Uint8Array | null, pen: number): void;
}

/** Grilles de collision (vague E). */
export interface WalkGrid {
  /** `loadGrids` (`fnEnterSection`). */
  loadGrids(): void;
  removeObjectFromWalk(cpt: CompactView): void;
  objectToWalk(cpt: CompactView): void;
  plotGrid(x: number, y: number, width: number, cpt: CompactView): void;
  removeGrid(x: number, y: number, width: number, cpt: CompactView): void;
}

/** Résultat de `AutoRoute::autoRoute` : 0 route trouvée, 1 inaccessible, 2 déjà sur place. */
export type RouteResult = 0 | 1 | 2;

/** Cheminement (vague E) : écrit la route dans le tampon `animScratchId` du compact. */
export interface Router {
  autoRoute(cpt: CompactView): RouteResult;
}

/**
 * Ce que les mcodes demandent au panneau de contrôle et aux parties (vague S). `GameControl` (`control/control.ts`) l'implémente ;
 * le moteur n'en garde qu'une souche de journal tant qu'il n'est pas branché (`engine.md` § 19).
 */
export interface BassControl {
  /** `doLoadSavePanel` (`fnRestoreGame`) : l'hôte ouvre la restitution et le jeu attend sa réponse. */
  restoreGame(): void;
  /** `restartGame` (`fnRestartGame`). */
  restartGame(): void;
  /** `fnQuitToDos` : retour à l'écran titre (`BaseHost.exit`). */
  quit(): void;
}

/** Écran sans image : retient seulement l'état dont la logique a besoin (séquence en cours, `_seqInfo`). */
export class NullScreen implements BassScreen {
  private running = false;
  private framesLeft = 0;
  private nextFrame = 0;

  setPalette(_paletteCpt: number): void {}
  fadeDown(_scroll: number): void {}
  drawNewScreen(): void {}
  fadeUp(_paletteCpt: number, _scroll: number): void {}
  effectStep(_name: string, _step: number, _total: number): void {}
  clearScreen(): void {}
  compose(): void {}
  reset(): void {}

  startSequence(_item: number, data: Uint8Array | null, now: number): void {
    if (!data || !data.length) {
      this.running = false;
      return;
    }
    this.framesLeft = data[0]! - 1;
    this.nextFrame = now + 60;
    this.running = true;
  }

  sequenceRunning(): boolean {
    return this.running;
  }

  processSequence(now: number): void {
    if (!this.running || now < this.nextFrame) return;
    this.nextFrame += 60;
    this.framesLeft--;
    if (this.framesLeft === 0) this.running = false;
  }
}

/** Son muet : aucune voix (le texte reste affiché, sa durée vient du nombre de lettres). */
export class SilentSound implements BassSound {
  loadSection(): void {}
  startMusic(): void {}
  startFx(): void {}
  stopFx(): void {}
  pauseFx(): void {}
  unPauseFx(): void {}
  checkFxQueue(): void {}
  startSpeech(): boolean {
    return false;
  }
  speechFinished(): boolean {
    return true;
  }
  stopSpeech(): void {}
}

/** Textes absents : aucun texte formé (tests de logique pure sans données de texte ; le moteur utilise `BassTextManager` par défaut). */
export class NullText implements BassText {
  lowTextManager(): DisplayedText | null {
    return null;
  }
  textModule(): void {}
  pointerText(): void {}
  logicCursor(): void {}
  setFont(): void {}
  changeTextSpriteColor(): void {}
}

/** Grille sans effet (tests de logique sans fichiers ; le moteur utilise `Grid` par défaut). */
export class NullGrid implements WalkGrid {
  loadGrids(): void {}
  removeObjectFromWalk(): void {}
  objectToWalk(): void {}
  plotGrid(): void {}
  removeGrid(): void {}
}

/** Cheminement absent : toujours « déjà sur place » (avec une grille injectée ; le moteur utilise `AutoRoute` par défaut). */
export class StubRouter implements Router {
  autoRoute(): RouteResult {
    return 2;
  }
}
