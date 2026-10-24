/**
 * Progression du Bowling d'un joueur (screens/bowling.md §1.9, §2) et minuteur de partie (§1.3).
 *
 * `BowlingProgress` tient les variables de scène du roster (`4cb8` sous-type par opération, `4cc4` niveau par opération, `4cd0` strikes
 * par niveau, masque `5ba8`) ainsi que l'opération choisie (`4b52`) et les bonnes réponses de la partie (`4c98`). Il ne touche au
 * roster que dans `load` et `save`.
 */
import { DEFAULT_BOWLING_TICKS, type Roster, achievementBit, gradeOfMask, maskHas } from "../../engine/roster";
import type { MsvcRandom } from "../../engine/rng";
import { BONUS, CORRECT_PER_STRIKE, LEVEL_COUNT, STRIKES_PER_LEVEL, STRIKE_THRESHOLDS, SUBTYPE_COUNTS } from "./tables";

const OPERATIONS = SUBTYPE_COUNTS.length;
const LEVELS = LEVEL_COUNT + 1;
/** Strikes (3, 6, 10) qui déclenchent une animation « spéciale » (table `1108:0974`, entrées 49 à 68). */
const SPECIAL_STRIKES: readonly number[] = [3, 6, 10];
export const COMMON_STRIKE_ANIMATIONS = 49;
export const SPECIAL_STRIKE_ANIMATIONS = 20;
export const PIN_SETS = 30;
export const GUS_CHEERS = 31;

export interface StrikeResult {
  /** Strikes du niveau après celui-ci (1 à 10). */
  strikes: number;
  /** Animation de strike : indice dans la table de 70 scripts `SCR` (`1108:0974`) ; 0 à 48 courantes, 49 à 68 spéciales. */
  animation: number;
  /** Le sous-type a avancé (seuil atteint). */
  subTypeAdvanced: boolean;
  /** 10 strikes : niveau terminé. */
  levelCompleted: boolean;
  /** Niveau terminé (0 à 3, 4 = bonus) ; `null` sinon. */
  completedLevel: number | null;
  /** Bit posé dans le masque (`5 × opération + niveau`) ; `null` sinon. */
  maskBit: number | null;
  /** Niveau courant de l'opération après le strike (changé seulement si le niveau est terminé). */
  level: number;
  /** Réaction de Gus (0 à 30) une fois sur trois quand le niveau n'est pas terminé ; `null` sinon. */
  gusCheer: number | null;
}

export class BowlingProgress {
  /** Opération courante `4b52` (0 à 5). */
  operation = 0;
  /** Bonnes réponses de la partie en cours `4c98` (0 à 9 ; 10 déclenche le strike). */
  roundCorrect = 0;

  private constructor(
    /** `4cb8` : index plat du sous-type par opération. */
    private readonly subTypes: number[],
    /** `4cc4` : niveau par opération (0 à 4). */
    private readonly levels: number[],
    /** `4cd0` : strikes (0 à 9) du niveau `5 × opération + niveau`. */
    private readonly strikes: number[],
    /** `5ba8` : masque de réussites. */
    public mask: number,
  ) {}

  /** Progression vierge (nouveau joueur). */
  static empty(): BowlingProgress {
    return new BowlingProgress(new Array<number>(OPERATIONS).fill(0), new Array<number>(OPERATIONS).fill(0), new Array<number>(OPERATIONS * LEVELS).fill(0), 0);
  }

  /** Lit les variables du joueur `playerId` (1 à 40). Le sous-type est recalculé comme à l'entrée (`1010:2aef`), jamais pris tel quel. */
  static load(roster: Roster, playerId: number): BowlingProgress {
    const progress = new BowlingProgress(
      roster.getVarArray(playerId, "bowlingSubtype"),
      roster.getVarArray(playerId, "bowlingLevel").map((level) => (level < LEVELS ? level : 0)),
      roster.getVarArray(playerId, "bowlingStrikes").map((strikes) => Math.min(strikes, STRIKES_PER_LEVEL - 1)),
      roster.getMask(playerId),
    );
    for (let op = 0; op < OPERATIONS; op++) progress.recomputeSubType(op);
    return progress;
  }

  /** Écrit les variables et le masque dans le roster (l'hôte enregistre ensuite le roster). */
  save(roster: Roster, playerId: number): void {
    this.subTypes.forEach((value, op) => roster.setVar(playerId, "bowlingSubtype", value, op));
    this.levels.forEach((value, op) => roster.setVar(playerId, "bowlingLevel", value, op));
    this.strikes.forEach((value, i) => roster.setVar(playerId, "bowlingStrikes", value, i));
    roster.setMask(playerId, this.mask);
  }

  // --- Lecture ---

  /** Niveau courant de l'opération courante (`4d0c`) : 0 à 3, 4 = bonus. */
  get level(): number {
    return this.levels[this.operation]!;
  }

  /** Strikes du niveau courant (`4d0e`), 0 à 9. */
  get currentStrikes(): number {
    return this.strikesOf(this.operation, this.level);
  }

  /** Sous-type plat du niveau courant (`4cb8[op]`) ; au bonus la scène tire au hasard (voir `QuestionPicker`). */
  get subType(): number {
    return this.subTypes[this.operation]!;
  }

  strikesOf(operation: number, level: number): number {
    return this.strikes[achievementBit(operation, level)]!;
  }

  levelOf(operation: number): number {
    return this.levels[operation]!;
  }

  /** Niveau terminé (bit posé) ; le bonus est le niveau 4. */
  isDone(operation: number, level: number): boolean {
    return maskHas(this.mask, operation, level);
  }

  /** Le bonus n'est jouable que si les 4 niveaux de l'opération sont terminés (`1010:0ea1`). */
  bonusUnlocked(operation: number): boolean {
    return ((this.mask >>> (operation * (LEVEL_COUNT + 1))) & 0xf) === 0xf;
  }

  /** Rang 1 à 25 (`STRL 5000`) : 1 + niveaux terminés, bonus exclus (`1018:0518`). */
  get rank(): number {
    return gradeOfMask(this.mask);
  }

  // --- Sélection (boutons) ---

  /** `1010:0959` : change d'opération. L'appelant vide le `QuestionPicker` (`reset`). */
  selectOperation(operation: number): void {
    if (!Number.isInteger(operation) || operation < 0 || operation >= OPERATIONS) throw new RangeError(`opération ${operation} hors de 0 à 5`);
    this.operation = operation;
  }

  /** `1010:0b5d` : change de niveau (0 à 3, 4 = bonus). Refuse le bonus tant que les 4 niveaux ne sont pas faits. Renvoie vrai si pris. */
  selectLevel(level: number): boolean {
    if (!Number.isInteger(level) || level < 0 || level >= LEVELS) return false;
    if (level === BONUS && !this.bonusUnlocked(this.operation)) return false;
    this.levels[this.operation] = level;
    this.recomputeSubType(this.operation);
    return true;
  }

  /** `1010:2aef` : sous-type de l'opération pour son niveau et ses strikes (saute les niveaux inférieurs, puis avance jusqu'au seuil non atteint). */
  recomputeSubType(operation: number): number {
    const thresholds = STRIKE_THRESHOLDS[operation]!;
    const level = this.levels[operation]!;
    const strikes = this.strikesOf(operation, level);
    let sub = 0;
    for (let done = 0; done < level; ) {
      if (thresholds[sub] === STRIKES_PER_LEVEL) done++;
      sub++;
    }
    while (thresholds[sub]! <= strikes) sub++;
    this.subTypes[operation] = sub;
    return sub;
  }

  // --- Partie ---

  /** GO! (`1010:0a70`) : `4c98 = 0`. */
  startRound(): void {
    this.roundCorrect = 0;
  }

  /** Bonne réponse : compte (`4c98++`). Vrai au 10e : c'est un strike, l'appelant appelle `strike`. */
  correctAnswer(): boolean {
    this.roundCorrect++;
    return this.roundCorrect >= CORRECT_PER_STRIKE;
  }

  /**
   * `1010:28b9` + `1010:29b1` : un strike de plus. Avance le sous-type au seuil ; au 10e strike le niveau est terminé : bit du masque
   * posé, compteur remis à 0, niveau suivant (le bonus n'est atteint que si les 4 niveaux sont faits, sinon retour au niveau 1 ;
   * après le bonus, niveau 1). `rng` choisit l'animation et la réaction de Gus.
   */
  strike(rng: MsvcRandom): StrikeResult {
    const operation = this.operation;
    const level = this.level;
    const slot = achievementBit(operation, level);
    const strikes = this.strikes[slot]! + 1;
    this.strikes[slot] = strikes;
    this.roundCorrect = 0;
    const animation = SPECIAL_STRIKES.includes(strikes) ? COMMON_STRIKE_ANIMATIONS + rng.rand1(SPECIAL_STRIKE_ANIMATIONS) : rng.rand1(COMMON_STRIKE_ANIMATIONS);
    let subTypeAdvanced = false;
    if (STRIKE_THRESHOLDS[operation]![this.subTypes[operation]!] === strikes) {
      this.subTypes[operation] = this.subTypes[operation]! + 1;
      subTypeAdvanced = true;
    }
    if (strikes < STRIKES_PER_LEVEL) {
      const gusCheer = rng.rand1(3) === 0 ? rng.rand1(GUS_CHEERS) : null;
      return { strikes, animation, subTypeAdvanced, levelCompleted: false, completedLevel: null, maskBit: null, level, gusCheer };
    }
    this.mask = (this.mask | (1 << slot)) >>> 0;
    this.strikes[slot] = 0;
    let next = level + 1;
    if ((next === BONUS && !this.bonusUnlocked(operation)) || next > BONUS) next = 0;
    this.levels[operation] = next;
    this.recomputeSubType(operation);
    return { strikes, animation, subTypeAdvanced, levelCompleted: true, completedLevel: level, maskBit: slot, level: next, gusCheer: null };
  }
}

/** Musique de fond MIDI (`DS:0338`) : `2000 + niveau`, au bonus `2000 + rand(0..3)`. */
export function backgroundMusicId(level: number, rng: MsvcRandom): number {
  return 2000 + (level === BONUS ? rng.rand(3) : level);
}

/** `1010:3adc(0)` : jeu d'animations de quilles `k` (0 à 29) tiré pour la partie ; la bonne réponse n° `i` joue le script `1200 + 100·⌊k/10⌋ + 10·(k mod 10) + i`. */
export function pickPinSet(rng: MsvcRandom): number {
  return rng.rand1(PIN_SETS);
}

/** Id du script `SCR` de l'animation de quilles de la bonne réponse n° `answerNumber` (0 à 9) du jeu `pinSet`. */
export function pinAnimationId(pinSet: number, answerNumber: number): number {
  return 1200 + 100 * Math.floor(pinSet / 10) + 10 * (pinSet % 10) + answerNumber;
}

/** Réaction de Gus au temps écoulé : `GUS.DAT` n° `31 + rand(0..7)` (`1010:2a83`). */
export function gusTimeUpReaction(rng: MsvcRandom): number {
  return GUS_CHEERS + rng.rand(7);
}

/**
 * Minuteur de partie en ticks de 17 ms (`DS:0332`, défaut 10 800 ≈ 183,6 s ; le roster stocke secondes × 60).
 * L'échéance se fixe au GO! (`4ca8 = tick + 0332`). Pendant le traitement d'une bonne réponse le test de temps est suspendu
 * (`4d32`) sans arrêter l'horloge : à la reprise, une échéance dépassée est constatée tout de suite.
 */
export const BAR_HALF_WIDTH = 121;

export class GameTimer {
  private deadline: number | null = null;
  /** Test de temps suspendu (`4d32`). */
  suspended = false;

  constructor(readonly totalTicks: number = DEFAULT_BOWLING_TICKS) {
    if (!Number.isInteger(totalTicks) || totalTicks < 1) throw new RangeError(`durée de partie ${totalTicks} ticks`);
  }

  /** Durée du roster (en-tête, `bowlingTicks`) ; défaut si le champ est vide. */
  static fromRoster(roster: Roster): GameTimer {
    return new GameTimer(roster.bowlingTicks >= 1 ? roster.bowlingTicks : DEFAULT_BOWLING_TICKS);
  }

  get running(): boolean {
    return this.deadline !== null;
  }

  /** GO! : la partie dure `totalTicks` à partir de `now`. */
  start(now: number): void {
    this.deadline = now + this.totalTicks;
    this.suspended = false;
  }

  stop(): void {
    this.deadline = null;
    this.suspended = false;
  }

  /** Ticks restants (0 à `totalTicks`) ; `totalTicks` si la partie ne tourne pas. */
  remaining(now: number): number {
    if (this.deadline === null) return this.totalTicks;
    return Math.min(Math.max(this.deadline - now, 0), this.totalTicks);
  }

  /** Temps écoulé : vrai quand la partie tourne, que le test n'est pas suspendu et que l'échéance est atteinte (`échéance ≤ tick`). */
  expired(now: number): boolean {
    return this.deadline !== null && !this.suspended && this.deadline <= now;
  }

  /** Demi-largeur de la partie masquée de la barre de temps : `121 − 121 × restant / total` (division entière), de 0 au GO! à 121 à l'échéance. */
  barHalfWidth(now: number): number {
    return BAR_HALF_WIDTH - Math.floor((BAR_HALF_WIDTH * this.remaining(now)) / this.totalTicks);
  }
}
