/**
 * Introduction du CD de *Beneath a Steel Sky* : la séquence de commandes, son exécution tick par tick et le départ du jeu qui la suit.
 *
 * Référence : ScummVM engines/sky/intro.cpp (`Intro::doIntro`, `nextPart`, `escDelay`), sky.cpp (`SkyEngine::go` : l'introduction passe
 * avant la boucle de jeu ; `handleKey` : Échap), logic.cpp (`Logic::initScreen0`) et control.cpp (`Control::restartGame`), GPL v3 ou
 * ultérieure ; lu puis réécrit. Les commandes sont dans `intro-script.ts`, l'écran dans `intro-screen.ts`.
 *
 * **Horloge.** ScummVM règle toutes ses attentes sur `_relDelay`, une échéance absolue qui ne dérive pas : `escDelay(n)` ajoute `n` ms à
 * l'échéance puis attend, en interrogeant les événements et en faisant avancer la séquence « flirt » (`processSequence`) tous les 20 ms au
 * plus. Les fondus ont leur propre boucle (32 pas de 20 ms, sans événements ni `processSequence`) et ajoutent 640 ms à l'échéance, de
 * sorte que les attentes suivantes durent ce qu'elles disent. Ici l'unité est le tick de 20 ms de l'hôte (`TICK_MS`) ; `clock()` rend les
 * millisecondes écoulées (ticks x 20), l'échéance et les images des séquences (60 ms) sont calculées dessus. Toute attente est donc un
 * nombre entier de ticks, avec au plus 19 ms de retard sur celle de ScummVM, rattrapé à l'attente suivante (l'échéance est absolue).
 *
 * **Voix.** Les voix de l'introduction sont des PCM 8 bits non signés à 11 025 Hz dans `sky.dsk` (fichiers 59 494 à 59 672), jouées
 * directement par le mélangeur, pas par la banque de voix des répliques ; l'en-tête de 22 octets est remplacé par du silence (127), comme
 * dans ScummVM. `WAITVOICE` interroge l'état de la voix toutes les 50 ms. Les sons d'ambiance (`LOADBG`, `LOOPBG`, `PLAYBG`) sont des PCM
 * dont ScummVM saute 256 octets au début et 768 à la fin.
 *
 * **Saut.** Échap, un clic ou le bouton « Passer » (l'hôte appelle `BassIntro.skip`) abandonnent l'introduction entière à n'importe quel
 * point, y compris pendant un fondu (écart : ScummVM n'interroge les événements que dans `escDelay` ; l'état final est le même). Comme
 * `~Intro`, la séquence en cours et les sons d'ambiance sont arrêtés ; la voix est aussi arrêtée (ScummVM la coupe par le
 * `_mixer->stopAll()` de `Sound::loadSection`, premier geste de `restartGame`). Le jeu part alors par `Control::restartGame`
 * (`engine.startAfterIntro`), sans l'animation d'ouverture ; une introduction jouée jusqu'au bout part par `Logic::initScreen0`
 * (`fnEnterSection(0)`, musique 2), avec l'animation, et `pastIntro` reste faux (Échap la passe alors par `restartGame`).
 *
 * Écarts volontaires :
 * - l'introduction des disquettes (`alt_intro`) n'est pas portée (`plan.md` D8) : ni `SCROLLFLIRT`, ni `COMMANDFLIRT`, ni `WAITMUSIC` ;
 * - un fichier de voix ou d'ambiance absent est ignoré (ScummVM lirait un tampon nul) ; une image ou une palette absente lève une erreur ;
 * - le chargement des fichiers ne prend pas de temps (le disque est en mémoire) : l'échéance d'ScummVM, rattrapée, absorbait le sien ;
 * - `stopSequence` n'attend pas deux ticks de la machine (voir `intro-screen.ts`).
 */

import { SequenceRunner, skippable, wait } from "../../../../engine/sequence";
import type { Sequence } from "../../../../engine/sequence";
import { DATA_FILE_HEADER_SIZE } from "../../data/header";
import { FADE_STEPS } from "../../render/palette-fade";
import type { BassEngine } from "../game";
import { mcodeNumber } from "../mcodes";
import { CD_INTRO, type IntroCommand, MAIN_INTRO, Op } from "./intro-script";
import { IntroCanvas, type IntroCanvasOptions, type IntroScreen } from "./intro-screen";

/** Pas de l'hôte (ms) : le tick de 20 ms de `BassEngine` (`TICK_MS`). */
export const INTRO_TICK_MS = 20;
/** Pause du début (`doIntro` : `escDelay(3000)`). */
export const INTRO_START_DELAY_MS = 3000;
/** Attente avant une voix (`PLAYVOICE`) et pas d'interrogation (`WAITVOICE`, `DOFLIRT`, `WAITFLIRT`). */
export const VOICE_LEAD_MS = 200;
export const POLL_MS = 50;
/** Durée d'un fondu : 32 pas de 20 ms, ajoutés à l'échéance (`_relDelay += 32 * 20`). */
export const FADE_MS = FADE_STEPS * INTRO_TICK_MS;
/** Fréquence des voix et des sons d'ambiance (`makeRawStream(..., 11025, FLAG_UNSIGNED)`). */
export const INTRO_SAMPLE_RATE = 11025;
/** Silence des PCM 8 bits non signés (`memset(vData, 127, sizeof(DataFileHeader))`). */
export const SILENCE = 127;
/** Octets sautés au début et à la fin d'un son d'ambiance (`_bgBuf + 256`, `_bgSize - 768`). */
export const BG_HEAD_BYTES = 256;
export const BG_TRIM_BYTES = 768;
/** Écran de Virgin (`initVirgin`) : image 60110, palette 60111. */
export const VIRGIN_SCREEN = 60110;
export const VIRGIN_PALETTE = 60111;
/** Section chargée avant l'introduction (`loadSection(0)`) et morceau lancé par `STARTMUSIC`/`initScreen0`. */
export const INTRO_SECTION = 0;
export const GAME_START_MUSIC = 2;

/** Toute l'introduction du CD : `_mainIntroSeq` puis `_cdIntroSeq` (`doIntro`). */
export const INTRO_SCRIPT: readonly IntroCommand[] = [...MAIN_INTRO, ...CD_INTRO];

/** Voix en cours (`_voice` : `isSoundHandleActive`). */
export interface IntroVoice {
  readonly playing: boolean;
  stop(): void;
}

/** Ce que l'introduction demande au son. */
export interface IntroAudio {
  /** `_skyMusic->loadSection(0)` et `_skySound->loadSection(0)`. */
  loadSection(section: number): void;
  startMusic(song: number): void;
  /** Joue un PCM 8 bits non signé à 11 025 Hz (kSpeechSoundType) ; une seule voix à la fois. */
  playVoice(pcm: Uint8Array): IntroVoice;
  /** Son d'ambiance (kSFXSoundType) : remplace le précédent ; `loop` le rejoue en boucle. */
  playBackground(pcm: Uint8Array, loop: boolean): void;
  /** `_mixer->stopID(SOUND_BG)`. */
  stopBackground(): void;
}

/** Fichiers de `sky.dsk` lus par l'introduction. */
export interface IntroDisk {
  has(id: number): boolean;
  load(id: number): Uint8Array;
}

export interface IntroRunOptions {
  disk: IntroDisk;
  screen: IntroScreen;
  audio: IntroAudio;
  /** Millisecondes écoulées depuis le début de l'hôte (ticks x 20). */
  clock(): number;
  /** Journal (fichier de voix absent…). */
  log?(message: string): void;
  /** Commandes jouées après la pause de 3 s : `MAIN_INTRO` puis `CD_INTRO` par défaut (les tests y mettent leur propre liste). */
  script?: readonly IntroCommand[];
}

/** Fin de l'introduction : jouée jusqu'au bout, ou abandonnée (Échap, clic, « Passer »). */
export type IntroOutcome = "completed" | "skipped";

/** `Intro::escDelay` : attend `ms` ms de plus sur l'échéance absolue, en faisant avancer la séquence « flirt » tous les 20 ms. */
class Timeline {
  private due: number;

  constructor(private readonly options: IntroRunOptions) {
    this.due = options.clock();
  }

  /** `_relDelay += n` : les fondus bloquants comptent leur propre durée. */
  advance(ms: number): void {
    this.due += ms;
  }

  *delay(ms: number): Sequence {
    this.due += ms;
    const { clock, screen } = this.options;
    let step: number;
    do {
      step = Math.min(INTRO_TICK_MS, Math.max(0, this.due - clock()));
      if (step > 0) yield* wait(1);
      screen.processSequence(clock());
    } while (step === INTRO_TICK_MS);
  }
}

/**
 * L'introduction (`Intro::doIntro`) : pause de 3 s, écrans de Revolution (`_mainIntroSeq`), puis narration du CD (`_cdIntroSeq`).
 * Rend `"skipped"` si le saut a été demandé (Échap, clic, « Passer » : `skip` du `SequenceRunner`), `"completed"` sinon.
 */
export function* runIntro(options: IntroRunOptions): Sequence<IntroOutcome> {
  const { disk, screen, audio } = options;
  const state: { voice: IntroVoice | null; background: Uint8Array | null } = { voice: null, background: null };

  const file = (id: number): Uint8Array => {
    if (!disk.has(id)) throw new Error(`introduction : fichier ${id} absent de sky.dnr`);
    return disk.load(id);
  };

  /** `Screen::fnFadeDown(0)` : 32 pas de 20 ms. */
  function* fadeDown(timeline: Timeline): Sequence {
    for (let i = 0; i < FADE_STEPS; i++) {
      screen.fadeDownStep();
      yield* wait(1);
    }
    timeline.advance(FADE_MS);
  }

  /** `Screen::paletteFadeUp(fichier)` : 32 pas de 20 ms vers la palette du fichier. */
  function* fadeUp(timeline: Timeline, palette: number): Sequence {
    screen.beginFadeUp(file(palette));
    for (let step = 1; step <= FADE_STEPS; step++) {
      screen.fadeUpStep(step);
      yield* wait(1);
    }
    timeline.advance(FADE_MS);
  }

  /** `nextPart` : une commande. */
  function* command(timeline: Timeline, cmd: IntroCommand): Sequence {
    switch (cmd[0]) {
      case Op.ShowScreen:
        screen.showScreen(file(cmd[1]), cmd[2]);
        return;
      case Op.FadeUp:
        yield* fadeUp(timeline, cmd[1]);
        return;
      case Op.FadeDown:
        yield* fadeDown(timeline);
        return;
      case Op.Delay:
        yield* timeline.delay(cmd[1]);
        return;
      case Op.DoFlirt:
      case Op.WaitFlirt:
        if (cmd[0] === Op.DoFlirt) screen.startSequence(file(cmd[1]), options.clock());
        while (screen.sequenceRunning()) yield* timeline.delay(POLL_MS);
        return;
      case Op.BgFlirt:
        screen.startSequence(file(cmd[1]), options.clock());
        return;
      case Op.StopFlirt:
        screen.stopSequence();
        return;
      case Op.StartMusic:
        audio.startMusic(cmd[1]);
        return;
      case Op.PlayVoice: {
        yield* timeline.delay(VOICE_LEAD_MS);
        if (!disk.has(cmd[1])) {
          options.log?.(`introduction : voix ${cmd[1]} absente de sky.dnr`);
          return;
        }
        const pcm = disk.load(cmd[1]);
        pcm.fill(SILENCE, 0, Math.min(DATA_FILE_HEADER_SIZE, pcm.length));
        state.voice = audio.playVoice(pcm);
        return;
      }
      case Op.WaitVoice:
        while (state.voice?.playing) yield* timeline.delay(POLL_MS);
        return;
      case Op.LoadBg:
        audio.stopBackground();
        state.background = disk.has(cmd[1]) ? disk.load(cmd[1]) : null;
        if (!state.background) options.log?.(`introduction : son d'ambiance ${cmd[1]} absent de sky.dnr`);
        return;
      case Op.LoopBg:
      case Op.PlayBg:
        audio.stopBackground();
        if (state.background && state.background.length > BG_HEAD_BYTES + BG_TRIM_BYTES) {
          audio.playBackground(state.background.subarray(BG_HEAD_BYTES, state.background.length - BG_TRIM_BYTES), cmd[0] === Op.LoopBg);
        }
        return;
      case Op.StopBg:
        audio.stopBackground();
        return;
      case Op.ClearBottom:
        screen.clearBottom();
        return;
    }
  }

  function* body(): Sequence<IntroOutcome> {
    // `SkyEngine::initVirgin` (avant `go`) : l'écran de Virgin, montré pendant les 6 premières secondes.
    screen.setPalette(file(VIRGIN_PALETTE));
    screen.showScreen(file(VIRGIN_SCREEN), false);
    audio.loadSection(INTRO_SECTION);
    const timeline = new Timeline(options);
    yield* timeline.delay(INTRO_START_DELAY_MS);
    for (const cmd of options.script ?? INTRO_SCRIPT) yield* command(timeline, cmd);
    return "completed";
  }

  try {
    return (yield* skippable(body())) ?? "skipped";
  } finally {
    // `~Intro` : séquence arrêtée, sons d'ambiance coupés ; la voix suit (voir l'en-tête).
    screen.stopSequence();
    audio.stopBackground();
    state.voice?.stop();
  }
}

export interface BassIntroOptions {
  disk: IntroDisk;
  audio: IntroAudio;
  /** Entrées de l'hôte lues à chaque tick : vrai si Échap ou un clic est arrivé (équivalent de `skip`). */
  pollSkip?: () => boolean;
  log?: (message: string) => void;
  /** Écran de l'introduction (`IntroCanvas` par défaut ; les tests y mettent un espion). */
  screen?: IntroScreen;
  /** Options de l'`IntroCanvas` par défaut. */
  canvas?: IntroCanvasOptions;
  script?: readonly IntroCommand[];
}

/**
 * L'introduction vue de l'hôte. Elle tourne avant la boucle de jeu : l'hôte appelle `tick()` toutes les 20 ms tant que `running`, affiche
 * `canvas.frame` (redessin quand `canvas.presented` change), puis passe la main au moteur par `startGameAfterIntro(engine, intro.outcome)`.
 */
export class BassIntro {
  /** Écran de l'introduction (l'hôte lit `canvas.frame`), ou le service fourni. */
  readonly canvas: IntroCanvas | null;
  private readonly runner: SequenceRunner;
  private ticks = 0;
  private skipRequested = false;
  private result: IntroOutcome | null = null;

  constructor(private readonly options: BassIntroOptions) {
    this.canvas = options.screen ? null : new IntroCanvas(options.canvas);
    this.runner = new SequenceRunner({
      now: () => this.ticks,
      takeSkip: () => this.takeSkip(),
      interrupted: () => false,
    });
  }

  /** Millisecondes écoulées depuis `start` (ticks x 20). */
  get clockMs(): number {
    return this.ticks * INTRO_TICK_MS;
  }

  get running(): boolean {
    return this.runner.active;
  }

  /** Issue de l'introduction, une fois finie ; `null` tant qu'elle tourne (ou avant `start`). */
  get outcome(): IntroOutcome | null {
    return this.result;
  }

  /** Lance l'introduction : la première attente est posée dans cet appel. */
  start(): void {
    this.runner.start(this.play());
  }

  private *play(): Sequence {
    this.result = yield* runIntro({
      disk: this.options.disk,
      screen: this.options.screen ?? this.canvas!,
      audio: this.options.audio,
      clock: () => this.clockMs,
      log: this.options.log,
      script: this.options.script,
    });
  }

  /** Échap, clic ou bouton « Passer » : l'introduction s'arrête à son attente en cours. */
  skip(): void {
    this.skipRequested = true;
  }

  /** Un pas de 20 ms. */
  tick(): void {
    if (this.runner.active) {
      if (this.options.pollSkip?.()) this.skipRequested = true;
      this.runner.step();
    }
    this.ticks++;
  }

  /** Abandon sans issue (page quittée) : les blocs `finally` de la séquence s'exécutent. */
  abort(): void {
    this.runner.abort();
  }

  private takeSkip(): boolean {
    const requested = this.skipRequested;
    this.skipRequested = false;
    return requested;
  }
}

/**
 * Départ du jeu après l'introduction (`SkyEngine::go`) : `clearScreen`, puis `restartGame` si elle a été passée (Foster sur la passerelle,
 * sans l'animation d'ouverture), `Logic::initScreen0` sinon (`fnEnterSection(0)`, musique 2 : le script de l'écran 0 joue l'animation).
 */
export function startGameAfterIntro(engine: BassEngine, outcome: IntroOutcome): void {
  if (outcome === "skipped") {
    engine.startAfterIntro();
    return;
  }
  engine.screen.clearScreen();
  engine.logic.mcode(mcodeNumber("fn_enter_section"), 0, 0, 0);
  engine.sound.startMusic(GAME_START_MUSIC);
  engine.system.currentMusic = GAME_START_MUSIC;
}
