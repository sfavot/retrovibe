import { messageId } from "../data/text";

/**
 * Codes de barrage des sorties : `1414:0006(code, mode, o)` (`docs/armaeth/movement.md` § 5). Fonctions pures sur une petite
 * interface (objet testé et monde) : le résultat dit si le passage est bloqué, quel message afficher et comment orienter
 * l'objet qui passe. `mode` : 0 = simple test (choix d'une sortie par un personnage), 1 = déplacement (`179d`), 2 = traversée
 * (`186d:000c`) ; les messages ne sont prévus que pour `mode != 0` et quand l'objet testé est le héros.
 */

/** L'objet testé. */
export interface BarrierSubject {
  /** `Num` (+0x00) : 1 = héros, 3 = pie, 4 = ours, 201 à 204 et 301 = nains, 303 = Minas. */
  num: number;
  /** `Txt` (+0x08) : 2 = immatériel (traverse la plupart des barrages). */
  txt: number;
  /** `Sol` (+0x5A) : type de case sous les pieds. */
  ground: number;
  /** `Dep` (+0x07) : 1 = volant. */
  dep: number;
  /** `Mob` (+0x06) : 2 = mobile. */
  mob: number;
  /** `P` (+0x58). */
  p: number;
  /** L'objet est l'objet contrôlé (`DGROUP:4bfe`). */
  isHero: boolean;
  /** L'objet est dans la salle courante. */
  inRoom: boolean;
  /** `21e7:0022` : l'objet porte (liste `Pos`) un objet de `Num` donné. */
  carries(num: number): boolean;
}

/** Ce que les prédicats lisent du monde. */
export interface BarrierWorld {
  /** `Ego` (+0x2D) du **premier** objet de type 2 de `Num` donné (`1a7b:03b0`) ; l'implémentation lève s'il n'existe pas. */
  ego(num: number): number;
  /** `P` du premier objet de type 2 de `Num` donné (code 102). */
  objectP(num: number): number;
  /** Identifiant de la salle courante (`DGROUP:4b84`). */
  currentRoom: number;
  /** `197e:0272` : niveau de lumière `< -40`. */
  isNight(): boolean;
  /** `1e08:0000` : tirage `rand() % n == 0` ; `n` n'est pas relevé (`movement.md` § 8, question 2). */
  chance(): boolean;
  /** `20b5:03bc` : état d'une entité de la table `DGROUP:0694` de clé 111, 309 ou 329 (non lu en entier, `movement.md` § 8, question 1). */
  guard(subject: BarrierSubject, key: 111 | 309 | 329): boolean;
}

export interface BarrierVerdict {
  /** Vrai = résultat 7 de `1414:0006` (bloqué), faux = 0 (libre). */
  blocked: boolean;
  /** Message de classe `C` (`messageId('C', n)` = 3000 + n) à afficher, ou null. */
  message: number | null;
  /** Orientation imposée à l'objet qui passe (`mode == 2`) : `Hor` et `Prf`. */
  orient: { speedX: number; speedP: number } | null;
}

/** Résultat numérique de `1414:0006`. */
export function barrierResult(verdict: BarrierVerdict): number {
  return verdict.blocked ? 7 : 0;
}

interface Outcome {
  blocked: boolean;
  /** Numéro du message `C` quand c'est ce test qui bloque. */
  message?: number;
  /** Orientation quand l'objet passe en `mode == 2`. */
  orient?: { speedX: number; speedP: number };
}

type Rule = (o: BarrierSubject, w: BarrierWorld) => Outcome;

const free: Outcome = { blocked: false };
const block = (message?: number): Outcome => ({ blocked: true, message });
const immaterial = (o: BarrierSubject): boolean => o.txt === 2;

// prédicats d'état (`movement.md` § 5) ; « Ego == 3 ou 4 = ouvert » est une hypothèse (§ 8, question 4)
const slabE = (w: BarrierWorld): boolean => w.ego(16) === 4; // 2500:0650 : dalle de la salle 5
const gateF = (w: BarrierWorld): boolean => w.ego(103) === 3; // 2846:04d6
const gateA = (w: BarrierWorld): boolean => w.ego(104) === 3; // 27ed:0251
const slabB = (w: BarrierWorld): boolean => w.ego(207) === 3; // 29fd:01d6
const portcullisC = (w: BarrierWorld): boolean => w.ego(317) === 3; // 2c4d:0312
const gateD = (w: BarrierWorld): boolean => w.ego(316) === 3; // 2c1e:02de

const inGround = (o: BarrierSubject, ...types: number[]): boolean => types.includes(o.ground);

const DWARVES = [201, 202, 203, 204, 301];

/** Un barrage dont l'ouverture dépend d'un état : bloque les objets matériels tant que `open` est faux. */
function stateGate(open: (w: BarrierWorld) => boolean, message?: number, orient?: { speedX: number; speedP: number }): Rule {
  return (o, w) => {
    if (immaterial(o) || open(w)) return orient ? { blocked: false, orient } : free;
    return block(message);
  };
}

const RULES: Record<number, Rule> = {
  0: () => free,
  1: (o) => ({ blocked: o.num === 3 }),
  2: (o) => ({ blocked: o.num !== 1 && o.num !== 4 }),
  3: (o) => ({ blocked: o.num !== 1 && o.num !== 3 }),
  4: (o) => ({ blocked: o.dep !== 1 && !immaterial(o) }),
  // codes à tirage au sort : deux tirages indépendants entre `179d` et `186d:000c`
  5: (o, w) => ({ blocked: o.num !== 3 || (!w.isNight() && !w.chance()) }),
  6: (o, w) => ({ blocked: o.num !== 3 || !w.chance() }),
  7: () => free, // hypothèse (movement.md § 5) : non lu en entier, aucun usage
  8: () => free,
  101: (o, w) => {
    if (o.num === 3 || o.num === 4) return block();
    return stateGate(slabE, 101, { speedX: 1, speedP: 0 })(o, w);
  },
  102: (o, w) => {
    if (o.isHero || immaterial(o) || gateF(w)) return free;
    if (w.currentRoom === 110 && o.inRoom && o.p < w.objectP(103)) return free;
    return block();
  },
  // `1414:0284..0297` : la porte 111 (entre les salles 104 et 105, `AX = 0x6F`), et non la 329
  103: (o, w) => (!immaterial(o) && !w.guard(o, 111) ? block() : free),
  104: stateGate(slabE, 101, { speedX: -1, speedP: 0 }),
  105: () => free,
  201: stateGate(gateA, 201, { speedX: 1, speedP: 0 }),
  202: (o) => ({ blocked: o.num !== 1 }),
  203: (o) => ({ blocked: !o.isHero && o.mob === 2 }),
  204: stateGate(gateA, 201, { speedX: 0, speedP: 1 }),
  205: () => free,
  206: () => free,
  207: () => free,
  208: () => free,
  209: () => free,
  301: stateGate(slabB, 301),
  302: (o, w) => {
    if (o.num === 301) return block();
    if (inGround(o, 64, 91) && !w.guard(o, 309) && !immaterial(o)) return block();
    return stateGate(slabB, 301)(o, w);
  },
  303: (o, w) => ({ blocked: o.num === 301 || (inGround(o, 64, 91) && !w.guard(o, 309) && !immaterial(o)) }),
  304: (o) => ({ blocked: DWARVES.includes(o.num) }),
  305: (o) => ({ blocked: o.num === 303 && !o.carries(320) }),
  306: (o, w) => ({
    blocked: o.num === 301 || (!immaterial(o) && ((inGround(o, 64, 91) && !w.guard(o, 309)) || !w.guard(o, 329))),
  }),
  307: (o, w) => {
    if (immaterial(o)) return free;
    if (inGround(o, 57, 113)) return block();
    if (inGround(o, 56, 114)) return { blocked: !gateD(w) || !w.guard(o, 329) };
    return { blocked: !w.guard(o, 329) };
  },
  308: (o, w) => {
    if (immaterial(o)) return free;
    if (inGround(o, 58, 112)) return { blocked: !gateD(w) };
    if (inGround(o, 57, 113)) return { blocked: gateD(w) };
    return stateGate(portcullisC, 302)(o, w); // « sinon » : le test du code 309 (message C302)
  },
  309: stateGate(portcullisC, 302),
};
// hypothèse (movement.md § 5) : le message de chaque code est celui de la branche qui teste l'état d'une porte

/** Tous les codes de barrage connus ; tout autre code est libre (« autres : jamais »). */
export const BARRIER_CODES: readonly number[] = Object.keys(RULES).map(Number);

/** Messages de classe `C` associés aux codes de barrage (`movement.md` § 5). */
export const BARRIER_MESSAGES: Readonly<Record<number, number>> = {
  101: 101,
  104: 101,
  201: 201,
  204: 201,
  301: 301,
  302: 301,
  308: 302,
  309: 302,
};

/**
 * `1414:0006(code, mode, o)`. Le message n'est rendu que pour `mode != 0`, objet testé = héros et barrage bloquant
 * (hypothèse : l'étude ne dit pas si le message accompagne aussi un passage libre) ; l'orientation de l'objet n'est rendue que
 * pour `mode == 2` et un passage libre.
 */
export function checkBarrier(code: number, mode: number, subject: BarrierSubject, world: BarrierWorld): BarrierVerdict {
  const outcome = (RULES[code] ?? RULES[0]!)(subject, world);
  const message = outcome.blocked && outcome.message !== undefined && mode !== 0 && subject.isHero ? messageId("C", outcome.message) : null;
  const orient = !outcome.blocked && outcome.orient && mode === 2 ? outcome.orient : null;
  return { blocked: outcome.blocked, message, orient };
}
