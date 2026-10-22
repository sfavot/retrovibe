import { DEFAULT_OPTIONS, gameSeconds, type ParentOptions } from "../engine/options";
import type { BorlandRandom } from "../engine/rng";
import { arrival, doorAt, doorClassAt, resolveEdges, settleX } from "./board";
import {
  type GameResult,
  type GameState,
  type MinigameOutcome,
  type MinigameRequest,
  type Player,
  type TurnState,
  hasIngredient,
  popcount,
} from "./state";
import {
  ALL_INGREDIENTS,
  BESPECTACLED_DESTINATIONS,
  BIRD_HINT_SCENES,
  CHARACTER_COUNT,
  DEFAULT_LEVEL,
  DWELL_SECONDS,
  GOAL_TABLE,
  HAZARDS,
  HINT_WINDOWS,
  INGREDIENT_COUNT,
  JUMP_STEP,
  LEVEL_COUNT,
  MAGICIAN_HAT_CHOICE,
  MAGICIAN_PRICE,
  MAP_LOCATIONS,
  MAX_POINTS,
  RUN_STEP,
  START_X,
  TURN_AUTO_SECONDS,
  WALK_STEP,
  WARNING_10_MIN_SECONDS,
  WARNING_5_MIN_SECONDS,
  WISH_DESTINATIONS,
  minigameInfo,
  type Hazard,
  type Position,
} from "./tables";

export interface PlayerSetup {
  /** Personnage 0..5, un par joueur (S08). */
  character: number;
  /** Niveau 0..2 (défaut 1, valeur initiale du sélecteur de S08). */
  level?: number;
}

export interface GameSetup {
  /** 1 à 4 joueurs, dans l'ordre de jeu (S09 puis S08). */
  players: PlayerSetup[];
  /** Options parents (durée de la partie, message de fin). */
  options?: ParentOptions;
}

/** Mode de déclenchement d'un appui : bouton gauche, ou action automatique à 36 s (multijoueur). */
export type PressSource = "button" | "timeout";

export type GameEvent =
  /** Début d'un tour jouable. */
  | { type: "turn"; player: number; round: number; wellOpen: boolean }
  /** Tour passé : le joueur est prisonnier de Gargamel (S20) ou pris au Turlusiphon (S21). */
  | { type: "skip"; player: number; reason: "jail" | "turlusiphon" }
  /** Le joueur est libéré au début de son tour (animation de sortie). */
  | { type: "release"; player: number; from: "jail" | "turlusiphon" }
  /** Le pion change d'écran ou de rangée (marche au bord, piège, puits, vœu, Schtroumpf à lunettes). */
  | { type: "moved"; player: number; from: Position; to: Position; cause: "edge" | "hazard" | "wish" | "bespectacled" }
  /** Animation d'événement du plateau (S13 à S21). */
  | { type: "hazard"; player: number; kind: Hazard["kind"]; scene: number }
  /** Sortie du plateau : vidéo `s01b` (gauche) ou `s01c` (droite), le tour se termine. */
  | { type: "exit"; player: number; side: "left" | "right"; video: "s01b" | "s01c" }
  /** Un mini-jeu (ou S13, S38, S39, S41) est lancé : `resolveMinigame` doit suivre. */
  | { type: "minigame"; request: MinigameRequest }
  /** Appui ou fin de tour sans effet (zone sans porte, porte du puits fermée…). */
  | { type: "nothing"; player: number }
  /** Gain ou perte. `required` : l'ingrédient fait partie de l'objectif ; `already` : possédé auparavant. */
  | { type: "gain"; player: number; ingredient?: number; points?: number; required?: boolean; already?: boolean }
  | { type: "lose"; player: number; ingredient?: number; points?: number }
  /** Résultat du Schtroumpf à lunettes (S38). */
  | { type: "bespectacled"; player: number; result: "nothing" | "ingredientLost" | "pointLost" | "pointsMoved" | "ingredientMoved"; video?: number; from?: number; to?: number; ingredient?: number }
  /** L'oiseau (S39) désigne la scène `scene` : bonus à la prochaine partie de cette scène. */
  | { type: "bird"; scene: number }
  /** Avertissement vocal ou vidéo du Grand Schtroumpf (`s42a031..035`). */
  | { type: "announce"; kind: "timeWarning"; video: number }
  /** Indice vocal d'inactivité (1 : après 12 s, 2 : après 24 s). */
  | { type: "hint"; player: number; n: 1 | 2 }
  | { type: "over"; result: GameResult };

/** Joueur le mieux placé : indices du progrès `progress()` (extension, absente de l'original). */
export interface Standing {
  player: number;
  progress: number;
}

function validate(setup: GameSetup): void {
  const n = setup.players.length;
  if (n < 1 || n > 4) throw new RangeError("1 à 4 joueurs");
  const seen = new Set<number>();
  for (const p of setup.players) {
    if (!Number.isInteger(p.character) || p.character < 0 || p.character >= CHARACTER_COUNT) throw new RangeError(`personnage invalide : ${p.character}`);
    if (seen.has(p.character)) throw new RangeError(`personnage déjà pris : ${p.character}`);
    seen.add(p.character);
    const level = p.level ?? DEFAULT_LEVEL;
    if (!Number.isInteger(level) || level < 0 || level >= LEVEL_COUNT) throw new RangeError(`niveau invalide : ${level}`);
  }
}

function newPlayer(setup: PlayerSetup): Player {
  return {
    character: setup.character,
    level: setup.level ?? DEFAULT_LEVEL,
    x: START_X,
    row: "top",
    screen: 1,
    ingredients: 0,
    ingredientCount: 0,
    points: 0,
    status: 0,
    facingRight: true,
  };
}

function freshTurn(): TurnState {
  return { elapsed: 0, wellOpen: false, acted: false, hint1Done: false, hint2Done: false, inside: [] };
}

const inRange = (x: number, r: readonly [number, number] | undefined): boolean => r !== undefined && x >= r[0] && x <= r[1];

/**
 * Règles du plateau du Téléportaschtroumpf : logique pure, sans rendu ni horloge. Les entrées sont des actions du
 * joueur (`walk`, `jump`, `press`), le temps (`tick`) et les résultats des mini-jeux (`resolveMinigame`) ; les
 * sorties sont l'état (`state`, sérialisable en JSON) et des `GameEvent`. Le hasard est celui de `BorlandRandom`.
 *
 * Déroulé d'un tour (`28a3:00ad`, `291e:0401`) : le joueur marche jusqu'à une porte et appuie ; la porte lance un
 * mini-jeu, un événement ou rien. À la fin du tour, victoire du joueur si son objectif est atteint, sinon joueur
 * suivant ; la partie se termine aussi à la fin du temps.
 */
export class Game {
  readonly state: GameState;
  private readonly rng: BorlandRandom;
  private events: GameEvent[] = [];

  private constructor(state: GameState, rng: BorlandRandom) {
    this.state = state;
    this.rng = rng;
  }

  /** Nouvelle partie (`28a3:00ad`, début) : joueurs au départ, objectif tiré, premier tour commencé. */
  static create(setup: GameSetup, rng: BorlandRandom): Game {
    validate(setup);
    const options = setup.options ?? DEFAULT_OPTIONS;
    const players = setup.players.map(newPlayer);
    const state: GameState = {
      durationSeconds: gameSeconds(options),
      messageIndex: options.messageIndex,
      players,
      current: 0,
      round: 1,
      elapsed: 0,
      goal: { ingredients: 0, points: 0 },
      phase: "turn",
      turn: freshTurn(),
      pending: null,
      bonusTag: 0,
      iceCrossings: 0,
      bridgeCrossings: 0,
      warned10: false,
      warned5: false,
      paused: false,
      result: null,
    };
    const game = new Game(state, rng);
    game.pickGoal(options.durationIndex);
    game.beginTurn();
    return game;
  }

  /** Reprend une partie sérialisée (`JSON.parse(JSON.stringify(game.state))`) avec un générateur fourni. */
  static restore(state: GameState, rng: BorlandRandom): Game {
    return new Game(structuredClone(state), rng);
  }

  /** Événements produits depuis le dernier appel (ceux de `create` y compris). */
  takeEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  // --- Lecture ----------------------------------------------------------------------------------

  get player(): Player {
    return this.state.players[this.state.current];
  }

  isOver(): boolean {
    return this.state.phase === "over";
  }

  /** Indice du vainqueur (objectif atteint), `null` s'il n'y en a pas (temps écoulé, abandon, partie en cours). */
  winner(): number | null {
    const r = this.state.result;
    return r?.kind === "victory" ? r.winner : null;
  }

  /** Objectif atteint par le joueur `i` : tous les ingrédients requis et assez de points (`28a3:00ad`). */
  goalReached(i: number): boolean {
    const p = this.state.players[i];
    const g = this.state.goal;
    return ((g.ingredients ^ p.ingredients) & g.ingredients) === 0 && g.points <= p.points;
  }

  /**
   * Avancement 0..100 du joueur : moyenne des parts d'ingrédients requis et de points (`26ee:0f17` / `027e`).
   * L'original divise par le nombre de joueurs × ingrédients requis (défaut probable) ; ici la part est exacte.
   */
  progress(i: number): number {
    const p = this.state.players[i];
    const g = this.state.goal;
    const required = popcount(g.ingredients);
    const owned = popcount(g.ingredients & p.ingredients);
    const a = required === 0 ? 100 : Math.floor((owned * 100) / required);
    const b = g.points === 0 ? 100 : Math.floor((Math.min(p.points, g.points) * 100) / g.points);
    return Math.floor((a + b) / 2);
  }

  /** Classement par avancement décroissant (extension : l'original n'a aucun classement). */
  standings(): Standing[] {
    return this.state.players
      .map((_, player) => ({ player, progress: this.progress(player) }))
      .sort((a, b) => b.progress - a.progress || a.player - b.player);
  }

  /** Le magicien (S41) accepte l'échange : au moins 3 points et pas tous les ingrédients (`2143:0009`). */
  canTrade(i: number): boolean {
    const p = this.state.players[i];
    return p.points >= MAGICIAN_PRICE && p.ingredients !== ALL_INGREDIENTS;
  }

  /** Tirage de réussite de S32 (Chez Gargamel) selon la demande en cours : `rand × b / 0x8000 == 0`. */
  rollChezGargamel(): boolean {
    const chance = this.state.pending?.successChance ?? 0.5;
    return this.rng.below(Math.round(1 / chance)) === 0;
  }

  // --- Actions du tour ----------------------------------------------------------------------------

  /** Une image de marche (4 px) ou de course (8 px) vers la droite (`1`) ou la gauche (`-1`). */
  walk(dir: -1 | 1, run = false): GameEvent[] {
    this.assertTurn();
    this.step(dir, dir * (run ? RUN_STEP : WALK_STEP));
    return this.takeEvents();
  }

  /** Saut latéral de 68 px (poses 4 et 5) : franchit un piège sans le déclencher. */
  jump(dir: -1 | 1): GameEvent[] {
    this.assertTurn();
    this.step(dir, dir * JUMP_STEP);
    return this.takeEvents();
  }

  /** Bouton gauche (ou action automatique) : entrer dans la porte devant le pion, ou déclencher l'événement. */
  press(source: PressSource = "button"): GameEvent[] {
    this.assertTurn();
    this.doPress(source);
    return this.takeEvents();
  }

  /** Avance les horloges de `seconds` secondes (chrono global, chrono du tour, indices, pièges d'attente, fin du temps). */
  tick(seconds: number): GameEvent[] {
    const s = this.state;
    if (s.phase === "over" || seconds <= 0) return this.takeEvents();
    s.elapsed += seconds;
    if (s.phase === "turn") {
      if (!s.paused) {
        s.turn.elapsed += seconds;
        this.checkHints();
      }
      if (s.elapsed >= s.durationSeconds) {
        // Le tour s'arrête au temps écoulé (`291e:0401`), puis `28a3:00ad` termine la partie.
        this.completeTurn();
      } else if (!s.paused) {
        this.runHazards("frame");
        if (this.state.phase === "turn" && s.players.length > 1 && Math.floor(s.turn.elapsed) >= TURN_AUTO_SECONDS) {
          this.doPress("timeout");
        }
      }
    }
    return this.takeEvents();
  }

  /** Pause (S48) : le chrono du tour est gelé ; le chrono global continue (hypothèse). */
  setPaused(paused: boolean): void {
    this.state.paused = paused;
  }

  /** Abandon (S46) d'un joueur ou de tous. Un joueur qui part compacte la liste ; plus personne : fin sans vidéo. */
  abandon(player: number | "all"): GameEvent[] {
    this.assertTurn();
    const s = this.state;
    if (player === "all" || s.players.length === 1) {
      this.finish({ kind: "abandoned" });
      return this.takeEvents();
    }
    if (player < 0 || player >= s.players.length) throw new RangeError("joueur inconnu");
    const removedCurrent = player === s.current;
    s.players.splice(player, 1);
    if (player < s.current) s.current -= 1;
    if (removedCurrent) {
      // La liste est compactée : le joueur suivant prend l'indice courant et commence son tour.
      if (s.current >= s.players.length) {
        s.current = 0;
        s.round += 1;
      }
      this.beginTurn();
    }
    return this.takeEvents();
  }

  /**
   * Résultat d'un mini-jeu lancé par un événement `minigame` : applique les gains puis termine le tour
   * (victoire, joueur suivant, fin du temps). Lève une erreur si le type de résultat ne correspond pas à la scène.
   */
  resolveMinigame(outcome: MinigameOutcome): GameEvent[] {
    const s = this.state;
    const request = s.pending;
    if (s.phase !== "minigame" || !request) throw new Error("aucun mini-jeu en cours");
    const info = minigameInfo(request.scene);
    if (!info) throw new Error(`scène inconnue : ${request.scene}`);
    const expected = { ingredient: "ingredient", points: "points", well: "well", trade: "magician", steal: "none", bird: "none" }[info.kind];
    if (outcome.kind !== expected) throw new TypeError(`la scène ${request.scene} attend un résultat « ${expected} », reçu « ${outcome.kind} »`);

    const i = request.player;
    switch (outcome.kind) {
      case "ingredient":
        if (outcome.success && info.ingredient !== undefined) this.gainIngredient(i, info.ingredient);
        break;
      case "points":
        if (!Number.isFinite(outcome.points) || outcome.points < 0) throw new RangeError("points négatifs");
        this.addPoints(i, Math.trunc(outcome.points));
        break;
      case "well":
        this.resolveWell(request, outcome);
        break;
      case "magician":
        this.resolveMagician(i, outcome.choice);
        break;
      case "none":
        if (info.kind === "steal") this.resolveBespectacled(i);
        else this.resolveBird();
        break;
    }
    s.pending = null;
    s.phase = "turn";
    this.completeTurn();
    return this.takeEvents();
  }

  // --- Mise en place ------------------------------------------------------------------------------

  /** Objectif : nombre d'ingrédients et de points selon la durée et le nombre de joueurs, ingrédients tirés (`1e52:0271`). */
  private pickGoal(durationIndex: number): void {
    const s = this.state;
    const goal = GOAL_TABLE[durationIndex]?.[s.players.length - 1];
    if (!goal) throw new RangeError(`durée invalide : ${durationIndex}`);
    let mask = 0;
    for (let k = 0; k < goal.ingredients; k++) {
      let r = this.rng.below(INGREDIENT_COUNT);
      for (let tries = 0; tries < INGREDIENT_COUNT && mask & (1 << r); tries++) r = (r + 1) % INGREDIENT_COUNT;
      mask |= 1 << r;
    }
    s.goal = { ingredients: mask, points: goal.points };
  }

  // --- Cycle d'un tour ----------------------------------------------------------------------------

  private assertTurn(): void {
    if (this.state.phase !== "turn") throw new Error(`action impossible en phase « ${this.state.phase} »`);
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }

  /** Puits ouvert ce tour (`2daf:0adc`) : 33 % seul ; à plusieurs, 67 % × (en retard de plus de 5 points, ou 15 %). */
  private rollWellOpen(): boolean {
    const s = this.state;
    if (s.players.length === 1) return this.rng.below(100) < 33;
    if (this.rng.below(100) <= 32) return false;
    const best = Math.max(...s.players.map((p) => p.points));
    if (this.player.points < best - 5) return true;
    return this.rng.below(100) < 15;
  }

  /** Début du tour du joueur courant (`291e:0401`) : états du pion, puits, avertissements, indices. */
  private beginTurn(): void {
    const s = this.state;
    const p = this.player;
    s.turn = freshTurn();
    s.turn.wellOpen = this.rollWellOpen();

    // États 2 → 1 → 3 (prison) et 4 → 6 → 5 (Turlusiphon) : le tour est passé aux étapes 2 → 1 et 4 → 6.
    let frozen: "jail" | "turlusiphon" | null = null;
    if (p.status === 1) p.status = 3;
    else if (p.status === 2) {
      p.status = 1;
      frozen = "jail";
    } else if (p.status === 6) p.status = 5;
    else if (p.status === 4) {
      p.status = 6;
      frozen = "turlusiphon";
    }
    if (frozen) {
      this.emit({ type: "skip", player: s.current, reason: frozen });
      this.completeTurn();
      return;
    }
    // États 3 et 5 : libération dès la première image (animations S20 puis S21).
    if (p.status === 3) {
      p.status = 0;
      this.emit({ type: "release", player: s.current, from: "jail" });
    } else if (p.status === 5) {
      p.status = 0;
      p.x += p.facingRight ? -0x14 : 0x14;
      this.emit({ type: "release", player: s.current, from: "turlusiphon" });
    }

    const remaining = s.durationSeconds - Math.floor(s.elapsed);
    let video = 0;
    if (!s.warned5 && remaining < WARNING_5_MIN_SECONDS) {
      s.warned5 = true;
      video = 34 + this.rng.below(2);
    }
    if (!s.warned10 && remaining < WARNING_10_MIN_SECONDS) {
      s.warned10 = true;
      video = 31 + this.rng.below(3);
    }
    if (video) this.emit({ type: "announce", kind: "timeWarning", video });
    this.emit({ type: "turn", player: s.current, round: s.round, wellOpen: s.turn.wellOpen });
  }

  /**
   * Fin d'un tour (`28a3:00ad`, après l'action) : victoire du joueur courant, sinon joueur suivant ; puis fin du temps.
   * Les mini-jeux jouent pendant que le temps passe : le gain est appliqué avant ce contrôle.
   */
  private completeTurn(): void {
    const s = this.state;
    if (this.goalReached(s.current)) {
      this.finish({ kind: "victory", winner: s.current });
      return;
    }
    s.current += 1;
    if (s.current >= s.players.length) {
      s.current = 0;
      s.round += 1;
    }
    if (s.elapsed >= s.durationSeconds) {
      // Vidéo `s42a0NN` : `0x29 + message + 9 × (rand × 4 / 0x8000)`.
      const video = 0x29 + s.messageIndex + 9 * this.rng.below(4);
      this.finish({ kind: "timeout", video });
      return;
    }
    this.beginTurn();
  }

  private finish(result: GameResult): void {
    const s = this.state;
    s.result = result;
    s.phase = "over";
    s.pending = null;
    this.emit({ type: "over", result });
  }

  private checkHints(): void {
    const s = this.state;
    const t = Math.floor(s.turn.elapsed);
    if (s.turn.acted) return;
    const [[a1, b1], [a2, b2]] = HINT_WINDOWS;
    if (!s.turn.hint1Done && t >= a1 && t <= b1) {
      s.turn.hint1Done = true;
      this.emit({ type: "hint", player: s.current, n: 1 });
    }
    if (!s.turn.hint2Done && t >= a2 && t <= b2) {
      s.turn.hint2Done = true;
      this.emit({ type: "hint", player: s.current, n: 2 });
      if (s.players.length === 1) s.turn.elapsed = 0;
    }
  }

  // --- Déplacement ------------------------------------------------------------------------------

  private setPosition(pos: Position, cause: "edge" | "hazard" | "wish" | "bespectacled"): void {
    const p = this.player;
    const from: Position = { screen: p.screen, row: p.row, x: p.x };
    p.screen = pos.screen;
    p.row = pos.row;
    p.x = pos.x;
    this.state.turn.inside = [];
    if (from.screen !== pos.screen || from.row !== pos.row) this.emit({ type: "moved", player: this.state.current, from, to: { ...pos }, cause });
  }

  private step(dir: -1 | 1, delta: number): void {
    const s = this.state;
    const p = this.player;
    s.turn.acted = true;
    p.facingRight = dir === 1;
    const next = resolveEdges({ screen: p.screen, row: p.row, x: p.x + delta });
    if (next.exit) {
      const side = next.exit;
      this.emit({ type: "exit", player: s.current, side, video: side === "left" ? "s01b" : "s01c" });
      p.screen = next.position.screen;
      p.row = next.position.row;
      p.x = next.position.x;
      p.facingRight = side === "left";
      this.completeTurn();
      return;
    }
    if (next.crossed) this.setPosition(next.position, "edge");
    else p.x = next.position.x;
    this.runHazards("frame");
  }

  // --- Événements du plateau ----------------------------------------------------------------------

  private hazardConditions(h: Hazard): boolean {
    return (!h.needsWell || this.state.turn.wellOpen) && (!h.needsFree || this.player.status === 0);
  }

  /** Cherche un événement à déclencher à la position du pion ; renvoie `true` si un événement a été joué. */
  private runHazards(trigger: "frame" | "press" | "timeout"): boolean {
    let played = false;
    for (let guard = 0; guard < 8 && this.state.phase === "turn"; guard++) {
      const h = this.findHazard(trigger);
      if (!h) break;
      this.applyHazard(h);
      played = true;
    }
    return played;
  }

  private findHazard(trigger: "frame" | "press" | "timeout"): Hazard | undefined {
    const s = this.state;
    const p = this.player;
    let found: Hazard | undefined;
    for (const h of HAZARDS) {
      if (h.screen !== p.screen || h.row !== p.row) continue;
      if (h.counted) {
        // Compte les entrées (lac, pont) sur « frame » seulement ; se déclenche à la 5ᵉ.
        if (trigger !== "frame") continue;
        const key = `${h.screen}:${h.row}:${h.kind}`;
        const inside = inRange(p.x, h.counted);
        const was = s.turn.inside.includes(key);
        if (inside && !was) {
          s.turn.inside.push(key);
          if (h.kind === "ice") s.iceCrossings += 1;
          else s.bridgeCrossings += 1;
        } else if (!inside && was) s.turn.inside = s.turn.inside.filter((k) => k !== key);
        const count = h.kind === "ice" ? s.iceCrossings : s.bridgeCrossings;
        if (inside && count > 4 && !found) found = h;
        continue;
      }
      if (!this.hazardConditions(h)) continue;
      if (found) continue;
      if (trigger === "frame") {
        if (inRange(p.x, h.walk)) found = h;
        else if (inRange(p.x, h.dwell) && Math.floor(s.turn.elapsed) >= DWELL_SECONDS) found = h;
      } else {
        // L'appui du Turlusiphon ne répond qu'au bouton ; les autres répondent aussi à l'action automatique.
        const pressRange = h.kind === "turlusiphon" && trigger === "timeout" ? undefined : h.press;
        if (inRange(p.x, pressRange) || inRange(p.x, h.dwell)) found = h;
      }
    }
    return found;
  }

  private applyHazard(h: Hazard): void {
    const s = this.state;
    const p = this.player;
    const e = h.effect;
    this.emit({ type: "hazard", player: s.current, kind: h.kind, scene: h.scene });
    switch (e.kind) {
      case "teleport":
        this.setPosition(e.to, "hazard");
        break;
      case "randomTeleport": {
        const screen = e.screens[this.rng.below(e.screens.length)];
        if (e.counter === "ice") s.iceCrossings = this.rng.below(4);
        if (e.counter === "bridge") s.bridgeCrossings = this.rng.below(4);
        this.setPosition(arrival(screen, this.rng), "hazard");
        break;
      }
      case "jail":
        p.x = e.x;
        p.status = 2;
        this.completeTurn();
        break;
      case "turlusiphon":
        p.x = e.x;
        p.status = 4;
        this.completeTurn();
        break;
      case "well":
        p.x = e.x;
        this.startMinigame(14);
        break;
    }
  }

  // --- Bouton ----------------------------------------------------------------------------------

  private doPress(source: PressSource): void {
    const s = this.state;
    const p = this.player;
    p.x = settleX(p.x, p.facingRight);
    if (this.runHazards(source === "button" ? "press" : "timeout")) return;
    const door = doorAt(p.screen, p.row, p.x);
    if (source === "button") {
      // Les zones « sans porte » ou fermées ignorent le bouton : le tour continue (`291e:11f4`).
      const cls = doorClassAt(p.screen, p.row, p.x);
      if (cls === "none") return;
      if (cls === "well" && !s.turn.wellOpen) return;
      if (cls === "state" && p.status === 0) return;
      if (cls === "notFull" && p.ingredients === ALL_INGREDIENTS) return;
    }
    if (door === null || (door === 14 && !s.turn.wellOpen)) {
      this.emit({ type: "nothing", player: s.current });
      this.completeTurn();
      return;
    }
    if (minigameInfo(door)) this.startMinigame(door);
    else {
      // Codes 15 à 21 et 37 : événements du plateau sans mini-jeu (déjà gérés par les pièges) → rien.
      this.emit({ type: "nothing", player: s.current });
      this.completeTurn();
    }
  }

  private startMinigame(scene: number): void {
    const s = this.state;
    const p = this.player;
    const info = minigameInfo(scene);
    if (!info) throw new Error(`scène sans mini-jeu : ${scene}`);
    const bonus = info.bonusTag !== undefined && s.bonusTag === info.bonusTag;
    if (bonus) s.bonusTag = 0;
    const request: MinigameRequest = { scene, player: s.current, character: p.character, level: p.level, bonus };
    if (scene === 32) request.successChance = 1 / (bonus ? 1 : p.level + 2);
    if (scene === 14) request.wellMode = p.ingredients === ALL_INGREDIENTS ? "travel" : this.rng.below(2) === 0 ? "travel" : "ingredient";
    s.pending = request;
    s.phase = "minigame";
    this.emit({ type: "minigame", request });
  }

  // --- Gains ---------------------------------------------------------------------------------------

  /** Donne l'ingrédient `ing` (`1e52:0053` + compteur `+0xC`) ; sans effet si le joueur l'a déjà. */
  private gainIngredient(i: number, ing: number): void {
    const p = this.state.players[i];
    const already = hasIngredient(p, ing);
    if (!already) {
      p.ingredients |= 1 << ing;
      p.ingredientCount += 1;
    }
    this.emit({ type: "gain", player: i, ingredient: ing, required: (this.state.goal.ingredients & (1 << ing)) !== 0, already });
  }

  private loseIngredient(i: number, ing: number): void {
    const p = this.state.players[i];
    if (!hasIngredient(p, ing)) return;
    p.ingredients &= ~(1 << ing);
    p.ingredientCount -= 1;
    this.emit({ type: "lose", player: i, ingredient: ing });
  }

  /** Ajoute `delta` points en bornant à 0..60 (`1e52:00ad`). */
  private addPoints(i: number, delta: number): number {
    const p = this.state.players[i];
    const next = Math.min(MAX_POINTS, Math.max(0, p.points + delta));
    const applied = next - p.points;
    p.points = next;
    if (applied > 0) this.emit({ type: "gain", player: i, points: applied });
    else if (applied < 0) this.emit({ type: "lose", player: i, points: -applied });
    return applied;
  }

  private resolveWell(request: MinigameRequest, outcome: Extract<MinigameOutcome, { kind: "well" }>): void {
    const i = request.player;
    if (request.wellMode === "ingredient") {
      const ing = outcome.ingredient;
      if (ing !== undefined && ing !== null && ing >= 0 && ing < INGREDIENT_COUNT && !hasIngredient(this.state.players[i], ing)) this.gainIngredient(i, ing);
      return;
    }
    const k = outcome.destination;
    if (k === undefined || k === null) return;
    const location = MAP_LOCATIONS.find((m) => m.k === k);
    if (!location) return;
    this.setPosition(WISH_DESTINATIONS[k - 2], "wish");
    this.state.players[i].facingRight = true;
  }

  private resolveMagician(i: number, choice: number | null): void {
    if (choice === null || !this.canTrade(i)) return;
    const p = this.state.players[i];
    if (choice >= 0 && choice < INGREDIENT_COUNT && p.points >= MAGICIAN_PRICE && !hasIngredient(p, choice)) {
      this.gainIngredient(i, choice);
      this.addPoints(i, -MAGICIAN_PRICE);
    } else if (choice === MAGICIAN_HAT_CHOICE) {
      this.addPoints(i, -MAGICIAN_PRICE);
    }
  }

  private resolveBird(): void {
    const scene = BIRD_HINT_SCENES[this.rng.below(BIRD_HINT_SCENES.length)];
    this.state.bonusTag = scene;
    this.emit({ type: "bird", scene });
  }

  // --- Schtroumpf à lunettes (S38) -------------------------------------------------------------------

  /** Vidéo de promenade 9..24 (`9 + rand × 17 / 0x8000`, 25 refusé) et destination du joueur. */
  private bespectacledWalk(i: number): void {
    let di = 9 + this.rng.below(17);
    while (di === 25) di = 9 + this.rng.below(17);
    const to = BESPECTACLED_DESTINATIONS[di - 9];
    this.emit({ type: "bespectacled", player: i, result: "nothing", video: di });
    this.setPosition(to, "bespectacled");
    this.state.players[i].facingRight = true;
  }

  private randomOtherPlayer(i: number): number {
    const n = this.state.players.length;
    let j = this.rng.below(n);
    while (j === i) j = this.rng.below(n);
    return j;
  }

  private movePoint(from: number, to: number): void {
    this.addPoints(to, 1);
    this.addPoints(from, -1);
    this.emit({ type: "bespectacled", player: this.state.current, result: "pointsMoved", from, to });
  }

  private moveIngredient(from: number, to: number): boolean {
    const a = this.state.players[from];
    const b = this.state.players[to];
    for (let ing = 0; ing < INGREDIENT_COUNT; ing++) {
      if (hasIngredient(a, ing) && !hasIngredient(b, ing)) {
        this.gainIngredient(to, ing);
        this.loseIngredient(from, ing);
        this.emit({ type: "bespectacled", player: this.state.current, result: "ingredientMoved", from, to, ingredient: ing });
        return true;
      }
    }
    return false;
  }

  /**
   * S38 (`1fc6:0008`). Seul : une fois sur deux (si le joueur a quelque chose) il perd un ingrédient au hasard, ou un point
   * s'il n'a pas d'ingrédient ; sinon rien. À plusieurs : une fois sur deux, le Schtroumpf à lunettes prend au plus riche pour
   * donner au plus pauvre (points ou ingrédients). Quand rien n'est perdu, une promenade téléporte le joueur devant un jeu.
   */
  private resolveBespectacled(i: number): void {
    const s = this.state;
    const p = s.players[i];
    const n = s.players.length;
    if (n === 1) {
      if ((p.ingredientCount === 0 && p.points === 0) || this.rng.below(2) !== 0) {
        this.bespectacledWalk(i);
        return;
      }
      if (p.ingredientCount !== 0) {
        let ing = this.rng.below(INGREDIENT_COUNT);
        while (!hasIngredient(p, ing)) ing = this.rng.below(INGREDIENT_COUNT);
        this.emit({ type: "bespectacled", player: i, result: "ingredientLost", ingredient: ing });
        this.loseIngredient(i, ing);
      } else {
        this.emit({ type: "bespectacled", player: i, result: "pointLost" });
        this.addPoints(i, -1);
      }
      return;
    }
    if (this.rng.below(2) !== 0) {
      this.bespectacledWalk(i);
      return;
    }
    // Plus pauvres et plus riches : premier indice des extrêmes (comparaisons strictes de l'original).
    let minCount = 0;
    let maxCount = 0;
    let minPts = 0;
    let maxPts = 0;
    for (let k = 1; k < n; k++) {
      if (s.players[k].ingredientCount < s.players[minCount].ingredientCount) minCount = k;
      if (s.players[k].ingredientCount > s.players[maxCount].ingredientCount) maxCount = k;
      if (s.players[k].points < s.players[minPts].points) minPts = k;
      if (s.players[k].points > s.players[maxPts].points) maxPts = k;
    }
    const mostCount = s.players[maxCount].ingredientCount;
    const mostPts = s.players[maxPts].points;
    const transferPoints = () => {
      if (s.players[maxPts].points === s.players[minPts].points) this.movePoint(i, this.randomOtherPlayer(i));
      else this.movePoint(maxPts, minPts);
    };
    if (mostPts === 0 && mostCount === 0) {
      this.bespectacledWalk(i);
    } else if (mostCount === 0) {
      transferPoints();
    } else if (mostPts === 0) {
      if (!this.moveIngredient(maxCount, minCount)) this.bespectacledWalk(i);
    } else if (Math.trunc(mostPts / 2) <= mostCount) {
      if (!this.moveIngredient(maxCount, minCount)) transferPoints();
    } else {
      transferPoints();
    }
  }
}

/** Crée une partie (`newGame(setup)` de la feuille de route) : alias de `Game.create`. */
export function newGame(setup: GameSetup, rng: BorlandRandom): Game {
  return Game.create(setup, rng);
}
