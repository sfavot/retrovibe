/**
 * Choix du problème suivant (`1010:0f18`, screens/bowling.md §1.4 et §1.5) : sous-type (niveau ou bonus), indice dans l'espace
 * énuméré du sous-type avec historique anti-répétition, file de reprise des problèmes manqués.
 */
import type { MsvcRandom } from "../../engine/rng";
import type { EstimationTables } from "./estimation";
import { type BowlingQuestion, buildQuestion } from "./questions";
import { BONUS, ESTIMATION, PROBLEM_MAX, SUBTYPE_COUNTS } from "./tables";

/** Taille de l'historique `4b54` : les indices vont de 0 à 255. */
const HISTORY_SIZE = 256;
/** Compte à rebours d'un problème manqué : il revient quand il passe sous 4, avec une chance croissante, au plus tard à 0. */
export const RETRY_COUNTDOWN = 6;
/** Au plus 7 problèmes en attente (`4c5e[7]`) ; on n'en a jamais plus de 6 en pratique. */
export const RETRY_CAPACITY = 7;
/** Une reprise peut tomber quand le compte à rebours du plus ancien est < 4. */
const RETRY_WINDOW = 4;

interface RetryEntry {
  index: number;
  subType: number;
  /** Case cliquée à tort lors de la première pose. */
  wrongSlot: number;
  countdown: number;
}

/** Où en est la partie : opération, niveau (0 à 3, 4 = bonus) et sous-type plat du niveau (`4cb8[op]`, ignoré au bonus). */
export interface PickContext {
  operation: number;
  level: number;
  subType: number;
}

export interface BowlingPick {
  operation: number;
  subType: number;
  index: number;
  /** Problème manqué qui revient. */
  retry: boolean;
  /** Pour une reprise : case de la mauvaise réponse d'alors (la bonne réponse n'y sera pas). */
  avoidSlot: number | null;
}

export class QuestionPicker {
  private readonly history = new Uint8Array(HISTORY_SIZE);
  private drawn = 0;
  private queue: RetryEntry[] = [];
  /** Dernier problème posé ; `fresh` = neuf (une erreur le met en file), sinon repris. */
  private current: { index: number; subType: number; fresh: boolean } | null = null;

  /** `estimation` : tables des problèmes d'estimation (obligatoires pour jouer l'opération ≈). */
  constructor(private readonly estimation?: EstimationTables) {}

  /** `1010:0e23` : changement d'opération / de niveau / fin de niveau — file et historique vidés. GO, STOP et temps écoulé n'y touchent pas. */
  reset(): void {
    this.history.fill(0);
    this.drawn = 0;
    this.queue = [];
    this.current = null;
  }

  /** Nombre de problèmes manqués en attente. */
  get pending(): number {
    return this.queue.length;
  }

  /** Plus grand indice du sous-type (`CNT`) ; l'estimation vient des tables `UNIT`/`TARG`. */
  problemMax(operation: number, subType: number): number {
    if (operation === ESTIMATION) {
      if (!this.estimation) throw new Error("estimation : tables UNIT/TARG requises");
      return this.estimation.problemMax(subType);
    }
    return PROBLEM_MAX[operation]![subType]!;
  }

  /** Efface l'historique quand le sous-type courant est épuisé (`CNT < compte`), ou s'il n'y reste plus aucune place (écart : l'original bouclerait). */
  private makeRoom(max: number): void {
    let exhausted = max < this.drawn;
    if (!exhausted) {
      exhausted = true;
      for (let i = 0; i <= max; i++) {
        if (this.history[i] === 0) {
          exhausted = false;
          break;
        }
      }
    }
    if (exhausted) {
      this.history.fill(0);
      this.drawn = 0;
    }
  }

  /**
   * `1010:0f18` : problème suivant. Les comptes à rebours baissent d'un cran ; si le plus ancien est < 4, il revient avec la
   * probabilité `1/(compte + 1)` (certain à 0) et repart en fin de file à 6. Sinon problème neuf : sous-type du niveau (ou au
   * hasard parmi tous ceux de l'opération au bonus), indice tiré dans `0..CNT` hors de l'historique.
   */
  pick(context: PickContext, rng: MsvcRandom): BowlingPick {
    for (const entry of this.queue) entry.countdown--;
    const oldest = this.queue[0];
    if (oldest && oldest.countdown < RETRY_WINDOW && rng.rand(oldest.countdown) === 0) {
      this.queue.push({ ...this.queue.shift()!, countdown: RETRY_COUNTDOWN });
      this.history[oldest.index] = 1;
      this.current = { index: oldest.index, subType: oldest.subType, fresh: false };
      return { operation: context.operation, subType: oldest.subType, index: oldest.index, retry: true, avoidSlot: oldest.wrongSlot };
    }
    const subType = context.level === BONUS ? rng.rand1(SUBTYPE_COUNTS[context.operation]!) : context.subType;
    const max = this.problemMax(context.operation, subType);
    this.makeRoom(max);
    let index: number;
    do index = rng.rand(max);
    while (this.history[index] !== 0);
    this.drawn++;
    this.history[index] = 1;
    this.current = { index, subType, fresh: true };
    return { operation: context.operation, subType, index, retry: false, avoidSlot: null };
  }

  /** `pick` puis `buildQuestion` : le problème complet prêt à dessiner. */
  next(context: PickContext, rng: MsvcRandom): BowlingQuestion {
    const pick = this.pick(context, rng);
    const question = buildQuestion(pick.operation, pick.subType, pick.index, rng, { avoidSlot: pick.avoidSlot, estimation: this.estimation });
    question.retry = pick.retry;
    return question;
  }

  /**
   * Enregistre la réponse au dernier problème posé. Bonne réponse à une reprise : l'entrée (la dernière de la file) disparaît.
   * Mauvaise réponse à un problème neuf : il entre en file avec la case cliquée ; à une reprise : file inchangée.
   */
  answered(correct: boolean, clickedSlot: number): void {
    const current = this.current;
    if (!current) return;
    if (correct) {
      if (!current.fresh) this.queue.pop();
    } else if (current.fresh && this.queue.length < RETRY_CAPACITY) {
      this.queue.push({ index: current.index, subType: current.subType, wrongSlot: clickedSlot, countdown: RETRY_COUNTDOWN });
    }
    this.current = null;
  }
}
