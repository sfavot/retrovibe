/**
 * Conditions de victoire d'un puzzle : traduction de 436dc6 (test de but), appelé par la boucle « machine en marche »
 * (4359a4) après chaque pas, et de la fin de puzzle qu'elle en tire.
 *
 * Table des conditions (428b08, lue par le chargeur 431d3f) en 0x47fe30 : un mot « actif » (`unknown00` du LEV, 1 dans
 * les 206 puzzles), puis 8 × 32 octets {pièce, état1, état2, nombre, x, y, l, h}, puis le délai (+0x104). 436d7c(pièce)
 * rend le rang (base 1) de la première condition qui vise cette pièce, en s'arrêtant au premier emplacement libre.
 *
 * 436dc6 rend 0 (pas de condition active), 1 (pas encore) ou 2 (réussi) :
 * - une pièce visée encore dans le bac → 1 ;
 * - mobiles puis statiques : chaque pièce visée (même type que la pièce de sa condition) est testée ; la zone (centre de la
 *   boîte de collision strictement dedans, ou hors de l'écran 640 × 400 si la zone vaut −1) n'est testée que pour les
 *   mobiles, l'état (+0x18 dans [état1, état2]) sinon ;
 * - condition « nombre » : on repart du début de la liste et on compte les pièces du même type qui satisfont le test, jusqu'à
 *   en avoir `nombre` ; la liste épuisée avant → échec ;
 * - un échec (résultat interne 3) rend 1 ; un succès sans échec rend 2, mais 1 tant que le compteur d'appels (0x477934, remis
 *   à 0 au démarrage par 436dbe) n'a pas atteint le délai.
 * Ensuite 4359a4 continue 30 images après le premier 2 (le compte, une fois lancé, ne s'arrête plus, même si le but redevient
 * faux), puis arrête la machine en « puzzle résolu » (0x4815b0 = 0x200).
 */
import { levelParts, type Level } from "../data/lev";
import type { Part } from "./part";
import type { World } from "./world";

/** Images jouées après le premier test réussi avant la fin du puzzle (4359a4 : `cmp bl, 0x1e`). */
export const SOLVED_COUNTDOWN = 30;

/** Écran du test « hors de l'écran » (436f1a : 0x280 × 0x190). */
const SCREEN_W = 0x280;
const SCREEN_H = 0x190;

export const GOAL_NONE = 0;
export const GOAL_PENDING = 1;
export const GOAL_MET = 2;
export type GoalResult = typeof GOAL_NONE | typeof GOAL_PENDING | typeof GOAL_MET;

/** Une condition de la table 0x47fe30, sa pièce résolue (4316e1 : index du LEV → pièce, `null` pour −1). */
export interface GoalSlot {
  part: Part | null;
  state1: number;
  state2: number;
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class GoalTest {
  /** 0x477934 : appels depuis le démarrage. */
  calls = 0;

  constructor(
    /** Les 8 emplacements, dans l'ordre du LEV. */
    readonly slots: readonly GoalSlot[],
    /** [0x47fe30] : 0 = aucun but (436dc6 rend 0). */
    readonly active: number,
    /** [0x47ff34] : appels à attendre avant de rendre 2. */
    readonly delay: number,
  ) {}

  /** Conditions d'un niveau, rapportées aux pièces du monde (par leur index dans le LEV, `Part.levIndex`). */
  static fromLevel(level: Level, world: World): GoalTest {
    const byIndex = new Map<number, Part>();
    for (const list of [world.statics, world.mobiles, world.bin]) for (const p of list) if (p.levIndex >= 0) byIndex.set(p.levIndex, p);
    const count = levelParts(level).length;
    const slots = level.solution.conditions.map((c) => ({
      part: c.partIndex >= 0 && c.partIndex < count ? (byIndex.get(c.partIndex) ?? null) : null,
      state1: c.state1,
      state2: c.state2,
      count: c.count,
      x: c.rectX,
      y: c.rectY,
      w: c.rectWidth,
      h: c.rectHeight,
    }));
    return new GoalTest(slots, level.solution.unknown00 & 0xffff, level.solution.delay & 0xffff);
  }

  /** 436dbe : remise à zéro au démarrage de la machine. */
  reset(): void {
    this.calls = 0;
  }

  /** 436d7c : rang (base 1) de la condition qui vise `part`, 0 si aucune. */
  slotOf(part: Part): number {
    for (let i = 0; i < this.slots.length; i++) {
      const p = this.slots[i]!.part;
      if (!p) return 0;
      if (p === part) return i + 1;
    }
    return 0;
  }

  /** 436dc6 : test de but après un pas. */
  check(world: World): GoalResult {
    if (this.active === 0) return GOAL_NONE;
    for (const p of world.bin) if (this.slotOf(p)) return GOAL_PENDING;
    let result = 1;
    let counted = 0;
    const lists = [world.mobiles, world.statics];
    for (let listIndex = 0; listIndex < 2 && result !== 3; listIndex++) {
      const list = lists[listIndex]!;
      // [ebp-0x1c] : type du groupe « nombre » en cours (−1 : aucun) ; [ebp-0x24] : pièce où reprendre après le groupe.
      let groupType = -1;
      let resume: Part | null = null;
      let slot = 0;
      let p: Part | null = list.head;
      const success = (c: GoalSlot): boolean => {
        // Rend vrai quand le groupe est complet et qu'on reprend après lui.
        counted++;
        if (c.count === 0) {
          groupType = -1;
          result = 2;
          counted = 0;
          return false;
        }
        if (c.count !== counted) return false;
        groupType = -1;
        result = 2;
        counted = 0;
        return true;
      };
      while (p) {
        if (groupType === -1) slot = this.slotOf(p);
        let next: Part | null = p.next;
        let jumped = false;
        const c = slot ? this.slots[slot - 1]! : null;
        if (c && c.part!.type === p.type) {
          if (c.count !== 0 && groupType === -1) {
            // Condition « nombre » : on recompte depuis le début de la liste courante.
            resume = p.next;
            groupType = p.type;
            next = list.head;
          } else if (c.w !== 0 && listIndex === 0) {
            const cx = ((p.boxW >> 1) + p.px) | 0;
            const cy = ((p.boxH >> 1) + p.py) | 0;
            const hit =
              c.w === -1 ? cx < 0 || cx > SCREEN_W || cy > SCREEN_H || cy < 0 : cx > c.x && cx < ((c.x + c.w) | 0) && cy > c.y && cy < ((c.y + c.h) | 0);
            if (hit) {
              if (success(c)) {
                next = resume;
                resume = null;
                jumped = true;
              }
            } else if (c.count === 0) {
              result = 3;
              break;
            }
          } else if (c.state1 <= p.frame && c.state2 >= p.frame) {
            if (success(c)) {
              next = resume;
              resume = null;
              jumped = true;
            }
          } else if (c.count === 0) {
            result = 3;
            counted = 0;
            break;
          }
        }
        p = next;
        if (!jumped && !p && resume) {
          // Liste épuisée avant d'avoir compté assez de pièces.
          result = 3;
          break;
        }
      }
    }
    if (result === 3) result = 1;
    this.calls++;
    if (result === 2 && this.calls < this.delay) result = 1;
    return result as GoalResult;
  }
}

/**
 * Fin de puzzle telle que 4359a4 la mène : premier 2 → compte à rebours de `SOLVED_COUNTDOWN` images (il continue même si le
 * but redevient faux), puis puzzle résolu. `update` rend vrai à l'image où le puzzle est résolu.
 */
export class SolvedCountdown {
  /** Registre `bl` de 4359a4. */
  frames = 0;
  solved = false;

  reset(): void {
    this.frames = 0;
    this.solved = false;
  }

  /** Résultat du test de but d'une image ; vrai quand la machine doit s'arrêter en « puzzle résolu ». */
  update(result: GoalResult): boolean {
    if (this.solved || result === GOAL_NONE) return false;
    if (result !== GOAL_MET && this.frames === 0) return false;
    if (this.frames < SOLVED_COUNTDOWN) {
      this.frames++;
      return false;
    }
    this.solved = true;
    return true;
  }

  /** Le but a été atteint (compte à rebours lancé). */
  get started(): boolean {
    return this.frames > 0;
  }
}
