import type { Voc } from "../data/voc";
import { TICKS_PER_SECOND } from "../engine/clock";
import { musicName } from "../engine/paths";
import { saveOptions } from "../engine/options";
import type { Scene, SceneContext } from "../engine/scene";
import { VideoScene } from "../engine/video";
import { zoneIndex } from "../game/board";
import { Game, newGame, type GameEvent, type GameSetup } from "../game/rules";
import type { GameResult, MinigameOutcome, MinigameRequest } from "../game/state";
import type { Position } from "../game/tables";
import { GameClock } from "./board/clock";
import { VoiceLine, hintVoice, introVoice, zoneHelpVoice, type VoiceFile } from "./board/voices";
import { approachX, createBoardEventScene, createWellScene } from "./events";
import { Commentary, createGrandSchtroumpfScene, isCommentVideo, type GrandSchtroumpfRequest } from "./grand-schtroumpf";
import { createMinigame, createMinigameAftermath } from "./minigames";
import { createMapScene } from "./s02-map";
import { Board, loadBoardResources, type BoardLook, type BoardResources } from "./s01-board";
import { createHelpScene } from "./s45-help";
import { createAbandonScene } from "./s46-abandon";
import { createPauseScene, type PauseChoice } from "./s48-pause";
import { captureSave, clearSave, writeSave, type GameSave } from "./save";

/**
 * Partie (engine.md §1.4, `28a3:00ad`) : enchaîne les tours des joueurs sur le plateau S01 (`s01-board.ts`) et aiguille vers
 * tout ce qui se déclenche depuis lui.
 *
 * - reçoit : `setup`, les joueurs choisis à S09 / S08 et les options parents (`newGame(setup, ctx.rng)`) ;
 * - rend : `onDone(ctx)` à la fin de la partie (victoire, temps écoulé ou abandon général), après la vidéo de fin et
 *   l'enregistrement de l'heure (`lastGameMinutes`, verrou parental, `21ee:1c92`) ;
 * - écran suivant (décidé par `flow.ts`) : menu S07 ;
 * - fonds, sprites, voix : voir `s01-board.ts` ; la partie reste en mémoire sous chaque scène qu'elle empile.
 *
 * Déroulé d'un tour (`291e:0401`) : commentaire d'avancement du Grand Schtroumpf (`26ee:0f17`), fondu, plateau du joueur, S19 au
 * tout premier tour, annonce vocale du personnage (`s01v`), avertissement de temps (S42) ou réplique du Grand Schtroumpf
 * (`26ee:027e`), puis jeu à la main jusqu'à une porte, une sortie de plateau ou un piège. Les
 * événements de `game/` sont présentés dans l'ordre : mini-jeu (voix d'accroche puis `minigames.ts`, issue appliquée par
 * `Game.resolveMinigame`), événements du plateau (`events.ts`), vidéos de sortie `s01b` / `s01c`, indices vocaux. Pause (P) :
 * S48 empilée, qui mène à la reprise, à l'abandon (S46, rappelée tant qu'il reste des joueurs), à la carte S02 ou à l'aide S45.
 *
 * Sauvegarde (`save.ts`) : au début de chaque tour (`beginTurn`), avant toute présentation, la partie est écrite dans le stockage
 * local ; elle est effacée au lancement d'une nouvelle partie et dès que la fin de partie est connue. `resumeGameScene` reprend
 * une sauvegarde : même état, même suite de tirages, directement sur l'annonce du tour sauvegardé (sans introduction S19
 * si elle avait été dite).
 *
 * Les chronos (`Game.tick`) suivent l'horloge de jeu en secondes entières ; ils sont gelés (tour seulement) pendant la pause,
 * les voix et l'annonce de début de tour ; la partie compte le temps des mini-jeux et des vidéos.
 */
export function createGameScene(setup: GameSetup, onDone: (ctx: SceneContext) => void): GameScene {
  return new GameScene({ setup }, onDone);
}

/** Reprend une partie sauvegardée (`readSave`) au début de son tour ; mêmes rappels que `createGameScene`. */
export function resumeGameScene(save: GameSave, onDone: (ctx: SceneContext) => void): GameScene {
  return new GameScene({ save }, onDone);
}

/** Origine d'une partie : une nouvelle (réglages des joueurs) ou une sauvegarde. */
type Start = { setup: GameSetup } | { save: GameSave };

/** Étapes d'un script de scène : `frame` = reprendre à la prochaine image, `resume` = reprendre au retour d'une scène empilée. */
type Wait = "frame" | "resume";
type Script = Generator<Wait, void, undefined>;

/** Pause après l'annonce du personnage (`1f33:00fc(0x32)`, 50 centièmes de seconde). */
const ANNOUNCE_PAUSE_TICKS = TICKS_PER_SECOND / 2;
/** Numéro de voix `26ee:006a` de l'annonce du personnage, du prisonnier et du siphon, « rien ici ». */
const VOICE_ANNOUNCE = 12;
const VOICE_JAIL = 0;
const VOICE_SIPHON = 16;
const VOICE_NOTHING = 6;

export class GameScene implements Scene {
  readonly step = 4;
  private resources!: BoardResources;
  private musics: Voc[] = [];
  /** La partie et le plateau, lisibles (jamais à modifier) par les tests et les écrans qui les montrent. */
  game!: Game;
  board!: Board;
  private clock!: GameClock;
  /** Événements de `game/` pas encore présentés. */
  private readonly queue: GameEvent[] = [];
  private script: Script | null = null;
  private waitingResume = false;
  private resumed = false;
  private finished = false;
  /** S19 (ingrédients) n'est dit qu'au premier tour. */
  private introShown = false;
  /** Mémoire des répliques du Grand Schtroumpf (`26ee:0f17`, `26ee:027e`), propre à la partie. */
  private readonly commentary = new Commentary();
  private shownOnce = false;
  /** Avertissement de temps annoncé (`announce`), joué après l'annonce du personnage. */
  private warning: number | null = null;
  private result: GameResult | null = null;

  constructor(
    private readonly start: Start,
    private readonly onDone: (ctx: SceneContext) => void,
  ) {}

  async load(ctx: SceneContext): Promise<void> {
    [this.resources, this.musics] = await Promise.all([loadBoardResources(ctx), Promise.all([1, 2, 3].map((n) => ctx.resources.voc(musicName(n))))]);
  }

  enter(ctx: SceneContext): void {
    if ("save" in this.start) this.restoreSave(ctx, this.start.save);
    else {
      // Une nouvelle partie remplace la sauvegarde de la précédente.
      clearSave(ctx.host.storage);
      this.game = newGame(this.start.setup, ctx.rng);
      this.queue.push(...this.game.takeEvents());
    }
    this.board = new Board(this.resources);
    this.clock = new GameClock(ctx);
    this.script = this.run(ctx);
    ctx.fade.blackout();
  }

  /** Reprend `save` : état, générateur, mémoire des répliques, puis le début du tour sauvegardé (annonce du personnage). */
  private restoreSave(ctx: SceneContext, save: GameSave): void {
    ctx.rng.seed(save.rng);
    this.game = Game.restore(save.state, ctx.rng);
    this.commentary.restore(save.commentary);
    this.introShown = save.introShown;
    this.warning = save.warning;
    const { current, round, turn } = this.game.state;
    this.queue.push({ type: "turn", player: current, round, wellOpen: turn.wellOpen });
  }

  /** Écrit la partie telle qu'elle est au début du tour (appelé avant que le tour ne consomme du hasard). */
  private save(ctx: SceneContext): void {
    if (this.game.isOver()) return;
    writeSave(ctx.host.storage, captureSave(this.game, ctx.rng, { commentary: this.commentary.snapshot(), introShown: this.introShown, warning: this.warning }));
  }

  update(): void {
    if (this.finished || !this.script) return;
    if (this.waitingResume) {
      if (!this.resumed) return;
      this.waitingResume = false;
      this.resumed = false;
    }
    const step = this.script.next();
    if (step.done) this.finished = true;
    else if (step.value === "resume") this.waitingResume = true;
  }

  render(ctx: SceneContext): void {
    this.board.render(ctx);
  }

  resume(ctx: SceneContext): void {
    this.resumed = true;
    // Les scènes empilées (mini-jeux, vidéos) ont pris l'écran : le plateau le reprend.
    this.board.redraw(ctx);
  }

  // --- script de la partie ----------------------------------------------------------------------

  /** `28a3:00ad` : présenter les événements, jouer un tour, recommencer jusqu'à la fin. */
  private *run(ctx: SceneContext): Script {
    for (;;) {
      yield* this.drain(ctx);
      if (this.game.isOver()) break;
      yield* this.playTurn(ctx);
    }
    yield* this.finish(ctx);
  }

  /** Le joueur joue : une image du plateau par mise à jour, jusqu'à ce que `game/` produise des événements. */
  private *playTurn(ctx: SceneContext): Script {
    this.board.setPlaying(true);
    for (;;) {
      yield "frame";
      const seconds = this.clock.take(ctx);
      if (seconds > 0) {
        this.queue.push(...this.game.tick(seconds));
        if (this.queue.length > 0) break;
      }
      const out = this.board.step(ctx);
      if (!out) continue;
      if (out.kind === "events") {
        this.queue.push(...out.events);
        break;
      }
      if (out.kind === "pause") yield* this.pause(ctx);
      else yield* this.help(ctx);
      if (this.queue.length > 0) break;
    }
    this.board.setPlaying(false);
  }

  private *drain(ctx: SceneContext): Script {
    while (this.queue.length > 0) yield* this.handle(ctx, this.queue.shift()!);
  }

  private *handle(ctx: SceneContext, event: GameEvent): Script {
    switch (event.type) {
      case "turn":
        yield* this.beginTurn(ctx, event.player, event.wellOpen);
        break;
      case "announce":
        this.warning = event.video;
        break;
      case "skip":
        yield* this.skipTurn(ctx, event.player, event.reason);
        break;
      case "release":
        yield* this.release(ctx, event.player, event);
        break;
      case "hazard":
        yield* this.hazard(ctx, event);
        break;
      case "exit":
        yield* this.exitBoard(ctx, event.video);
        break;
      case "minigame":
        yield* this.minigame(ctx, event.request);
        break;
      case "nothing":
        if (this.game.state.players.length > 1) yield* this.speak(ctx, hintVoice(VOICE_NOTHING, 0, ctx.rng));
        break;
      case "hint":
        yield* this.hint(ctx, event.player, event.n);
        break;
      case "over":
        this.result = event.result;
        // La partie est jouée : plus rien à reprendre, même si l'onglet se ferme pendant la vidéo de fin.
        clearSave(ctx.host.storage);
        break;
      // Déplacements de bord : déjà suivis par le plateau (`Board.step`). Gains, pertes, Schtroumpf à lunettes, oiseau : montrés
      // par le mini-jeu lui-même (`createMinigameAftermath` pour S38 et S39).
      case "moved":
      case "gain":
      case "lose":
      case "bird":
      case "bespectacled":
        break;
    }
  }

  // --- tours --------------------------------------------------------------------------------------

  /**
   * Début d'un tour (`291e:0401`) : commentaire d'avancement, plateau du joueur, S19, annonce du personnage, avertissement de
   * temps ou réplique du Grand Schtroumpf.
   */
  private *beginTurn(ctx: SceneContext, player: number, wellOpen: boolean): Script {
    // Le chrono du tour ne court pas pendant l'annonce (`1f33:0181(1)` n'est relancé qu'après).
    this.freeze(ctx);
    // Le temps de la partie est à jour (`freeze`) et rien n'a encore tiré au hasard : c'est le point de reprise du tour.
    this.save(ctx);
    ctx.voice.setMusic(this.musics[ctx.rng.below(this.musics.length)]);
    // `26ee:0f17`, avant l'affichage du plateau du joueur (jamais pour un tour passé : voir `skipTurn`).
    const progress = this.commentary.beforeTurn(this.game, ctx.rng);
    if (progress !== 0) {
      yield* this.grandSchtroumpf(ctx, { kind: "progress", code: progress }, true);
      ctx.fade.blackout();
    }
    // Avant S19, le bandeau n'a que le portrait : S19 y ajoute l'objectif.
    if (!this.introShown) this.board.setGoalHidden(true);
    yield* this.showPlayer(ctx, player, "normal", wellOpen);
    if (!this.introShown) {
      this.introShown = true;
      yield* this.grandSchtroumpf(ctx, { kind: "ingredients", game: this.game }, false);
    }
    yield* this.speak(ctx, hintVoice(VOICE_ANNOUNCE, this.game.state.players[player].character, ctx.rng));
    yield* this.wait(ctx, ANNOUNCE_PAUSE_TICKS);
    const warned = this.warning !== null;
    if (this.warning !== null) {
      const video = this.warning;
      this.warning = null;
      yield* this.grandSchtroumpf(ctx, { kind: "timeWarning", video }, true);
      yield* this.backToBoard(ctx);
    }
    yield* this.comment(ctx, this.commentary.afterAnnouncement(this.game, ctx.rng, { warned, skipped: false }));
    this.unfreeze(ctx);
  }

  /** Tour passé : le joueur est dans sa cage ou sous le siphon (`291e:0401`, états 2 et 4). */
  private *skipTurn(ctx: SceneContext, player: number, reason: "jail" | "turlusiphon"): Script {
    const character = this.game.state.players[player].character;
    yield* this.showPlayer(ctx, player, reason === "jail" ? "jail" : "siphon", false);
    yield* this.speak(ctx, hintVoice(VOICE_ANNOUNCE, character, ctx.rng));
    yield* this.wait(ctx, ANNOUNCE_PAUSE_TICKS);
    yield* this.speak(ctx, hintVoice(reason === "jail" ? VOICE_JAIL : VOICE_SIPHON, character, ctx.rng));
    // Le joueur vient d'être pris : le Grand Schtroumpf commente (`26ee:027e`, `DS:274E == 2`).
    yield* this.comment(ctx, this.commentary.afterAnnouncement(this.game, ctx.rng, { warned: false, skipped: true }));
  }

  /** Libération au début du tour (animations de S20 et S21). */
  private *release(ctx: SceneContext, player: number, event: Extract<GameEvent, { type: "release" }>): Script {
    yield* this.showPlayer(ctx, player, event.from === "jail" ? "jail" : "siphon", false);
    const p = this.game.state.players[player];
    const at: Position = { screen: p.screen, row: p.row, x: p.x };
    yield* this.overlay(ctx, createBoardEventScene({ game: this.game, event, before: at, after: at }, (c) => c.scenes.pop()), false);
  }

  /** Piège, lac, pont, fusée, puits, prison, siphon : animation (`events.ts`), puis le pion arrive où `game/` l'a placé. */
  private *hazard(ctx: SceneContext, event: Extract<GameEvent, { type: "hazard" }>): Script {
    const { from, to } = event;
    if (this.board.position.screen !== from.screen || this.board.position.row !== from.row || this.board.position.x !== from.x) this.board.moveTo(ctx, from);
    // Le pion marche jusqu'au point de déclenchement de la vidéo (fusée, libérations : pas de marche).
    const target = approachX(event, from, to);
    if (target !== null) {
      this.board.setPlaying(false);
      while (!this.board.walkToward(ctx, target)) yield "frame";
    }
    yield* this.overlay(ctx, createBoardEventScene({ game: this.game, event, before: from, after: to }, (c) => c.scenes.pop()), false);
    const teleported = to.screen !== from.screen || to.row !== from.row;
    this.board.moveTo(ctx, to, { arrival: teleported && event.kind !== "jail" && event.kind !== "turlusiphon" });
  }

  /** Sortie du plateau par un bord : vidéo `s01b` (gauche) ou `s01c` (droite), le tour est perdu (codes 100 et 101). */
  private *exitBoard(ctx: SceneContext, video: "s01b" | "s01c"): Script {
    yield* this.overlay(ctx, new VideoScene({ file: `${video}.mux`, fadeOutAtEnd: true, onEnd: (c) => c.scenes.pop() }), true);
    ctx.fade.blackout();
  }

  /** Porte d'un mini-jeu (`28a3:00ad`) : voix d'accroche, mini-jeu, issue appliquée à la partie. */
  private *minigame(ctx: SceneContext, request: MinigameRequest): Script {
    yield* this.speak(ctx, introVoice(request.scene, ctx.rng));
    const box: { outcome?: MinigameOutcome } = {};
    const done = (c: SceneContext, outcome: MinigameOutcome) => {
      box.outcome = outcome;
      c.scenes.pop({ fade: true });
    };
    const scene = request.scene === 14 ? createWellScene(this.game, done) : createMinigame(request.scene, this.game, done);
    // Le puits ne fond qu'après la voix d'accroche (c'est lui qui lance son fondu) ; les autres mini-jeux fondent à l'entrée.
    yield* this.overlay(ctx, scene, request.scene !== 14);
    ctx.fade.blackout();
    // Le chrono de la partie n'est pas gelé pendant un mini-jeu : le temps passé compte avant le contrôle de fin.
    this.syncClock(ctx);
    const events = this.game.resolveMinigame(box.outcome!);
    this.queue.push(...events);
    const aftermath = createMinigameAftermath(request.scene, this.game, events, (c) => c.scenes.pop());
    if (aftermath) {
      yield* this.overlay(ctx, aftermath, true);
      ctx.fade.blackout();
    }
  }

  /** Indice vocal d'inactivité (12 s, 24 s) : le chrono du tour est gelé pendant la voix. */
  private *hint(ctx: SceneContext, player: number, n: 1 | 2): Script {
    this.freeze(ctx);
    yield* this.speak(ctx, hintVoice(n, this.game.state.players[player].character, ctx.rng));
    this.unfreeze(ctx);
  }

  /** Clic droit : voix de la zone du pion (`s45v`), chrono du tour gelé. */
  private *help(ctx: SceneContext): Script {
    const { screen, row, x } = this.board.shown;
    this.freeze(ctx);
    yield* this.speak(ctx, zoneHelpVoice(screen, row, x));
    this.unfreeze(ctx);
  }

  /** Touche P : pause S48 empilée ; sa suite (reprise, abandon, carte, aide) se règle dans les rappels des écrans empilés. */
  private *pause(ctx: SceneContext): Script {
    this.freeze(ctx);
    ctx.scenes.push(createPauseScene((c, choice) => this.onPauseChoice(c, choice)), { fade: true });
    yield "resume";
    this.unfreeze(ctx);
    // Un joueur qui précède le joueur courant a pu partir : les indices ont changé.
    if (!this.game.isOver()) this.board.retarget(ctx, this.game.state.current);
  }

  private onPauseChoice(ctx: SceneContext, choice: PauseChoice): void {
    const back = (c: SceneContext) => c.scenes.pop({ fade: true });
    switch (choice) {
      case "resume":
        back(ctx);
        break;
      case "abandon":
        ctx.scenes.replace(this.abandonScene(), { fade: true });
        break;
      case "map": {
        const { screen, row, x } = this.board.shown;
        ctx.scenes.replace(createMapScene({ mode: "consult", zone: zoneIndex(screen, row, x) }, back), { fade: true });
        break;
      }
      case "help":
        ctx.scenes.replace(createHelpScene(this.game, back), { fade: true });
        break;
    }
  }

  /** S46 avec les joueurs restants : un joueur parti, l'écran revient tant qu'il en reste (`1823:0415`). */
  private abandonScene(): Scene {
    return createAbandonScene(
      this.game.state.players.map((p) => p.character),
      (ctx, result) => {
        if (result.kind === "cancel") return void ctx.scenes.pop({ fade: true });
        this.queue.push(...this.game.abandon(result.kind === "all" ? "all" : result.index));
        if (result.kind === "player" && !this.game.isOver()) ctx.scenes.replace(this.abandonScene(), { fade: true });
        else ctx.scenes.pop({ fade: true });
      },
    );
  }

  /** Fin de partie : vidéo de victoire (S11) ou de fin du temps (S42), heure de fin enregistrée, retour au menu. */
  private *finish(ctx: SceneContext): Script {
    const result = this.result;
    clearSave(ctx.host.storage);
    if (result?.kind === "victory") yield* this.grandSchtroumpf(ctx, { kind: "victory", winner: result.winner }, true);
    else if (result?.kind === "timeout") yield* this.grandSchtroumpf(ctx, { kind: "timeout", video: result.video }, true);
    // `21ee:1c92` : l'heure de fin sert au verrou parental (pause entre deux parties).
    ctx.options.lastGameMinutes = Math.floor(ctx.host.unixSeconds() / 60);
    saveOptions(ctx.host.storage, ctx.options);
    ctx.voice.stop();
    ctx.voice.setMusic(null);
    this.onDone(ctx);
  }

  // --- pièces communes -------------------------------------------------------------------------------

  /** Empile `scene` et attend son retrait (c'est son rappel qui appelle `ctx.scenes.pop`). */
  private *overlay(ctx: SceneContext, scene: Scene, fade: boolean): Script {
    ctx.scenes.push(scene, { fade });
    yield "resume";
  }

  private *grandSchtroumpf(ctx: SceneContext, request: GrandSchtroumpfRequest, fade: boolean): Script {
    const done = (c: SceneContext) => {
      // Le bandeau reprend son objectif avant que le plateau ne se redessine (`resume`).
      this.board.setGoalHidden(false);
      c.scenes.pop();
    };
    yield* this.overlay(ctx, createGrandSchtroumpfScene(request, done), fade);
  }

  /** Réplique du Grand Schtroumpf (`code` de `Commentary`, 0 = rien) : voix par-dessus le plateau ou vidéo plein écran. */
  private *comment(ctx: SceneContext, code: number): Script {
    if (code === 0) return;
    const video = isCommentVideo(code);
    yield* this.grandSchtroumpf(ctx, { kind: "comment", code }, video);
    if (video) yield* this.backToBoard(ctx);
  }

  /** Après une vidéo plein écran : le plateau revient en fondu. */
  private *backToBoard(ctx: SceneContext): Script {
    ctx.fade.blackout();
    this.board.redraw(ctx);
    ctx.fade.in();
    while (ctx.fade.active) yield "frame";
  }

  /** Affiche le plateau d'un joueur : fondu au noir de l'écran précédent, nouvel écran, fondu d'entrée. */
  private *showPlayer(ctx: SceneContext, player: number, look: BoardLook, wellOpen: boolean): Script {
    while (ctx.fade.active) yield "frame";
    if (this.shownOnce && !ctx.palette.black) {
      ctx.fade.out();
      while (ctx.fade.active) yield "frame";
    }
    const p = this.game.state.players[player];
    this.board.show(ctx, this.game, { player, screen: p.screen, row: p.row, x: p.x, facingRight: p.facingRight, look, wellOpen }, true);
    this.shownOnce = true;
    while (ctx.fade.active) yield "frame";
  }

  /** Dit une voix jusqu'au bout ; Espace la coupe. Sans fichier, rien. */
  private *speak(ctx: SceneContext, file: VoiceFile | null): Script {
    if (file === null) return;
    const line = new VoiceLine(ctx, file);
    while (!line.update(ctx, ctx.input.justPressed("validate"))) yield "frame";
  }

  private *wait(ctx: SceneContext, ticks: number): Script {
    const start = ctx.clock.ticks;
    while (ctx.clock.ticks - start < ticks) yield "frame";
  }

  /** Applique à la partie les secondes écoulées depuis le dernier appel (leurs événements vont dans la file). */
  private syncClock(ctx: SceneContext): void {
    const seconds = this.clock.take(ctx);
    if (seconds > 0) this.queue.push(...this.game.tick(seconds));
  }

  /** Gèle le chrono du tour (le chrono de la partie continue) : pause, voix, annonce. */
  private freeze(ctx: SceneContext): void {
    this.game.setPaused(true);
    this.syncClock(ctx);
  }

  private unfreeze(ctx: SceneContext): void {
    this.syncClock(ctx);
    this.game.setPaused(false);
  }
}
