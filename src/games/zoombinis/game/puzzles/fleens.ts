import { type MsvcRandom, NoRepeatPool } from "../../../../engine/mohawk/rng";
import type { Attrs, Zoombini } from "../state";

/**
 * Règles des nizibooms (`FLEENS.MHK`, écran 13 ; `docs/zoombinis/puzzles/fleens.md`). Fonctions pures sans rendu : fabrication des nizibooms de l'écran
 * (`10e0:1b29`), niveaux, essais, cocons, succès, Zoombinis perdus, robot. Tout le hasard passe par le `MsvcRandom` reçu, dans l'ordre des tirages de l'original.
 *
 * Ce que voit le joueur (étude §0 et §2.1, manuel p. 35) : ses Zoombinis, avec leurs vrais attributs, et des **nizibooms** (leurs cousins mutants), dessinés avec la
 * planche `tBMP` 4000 : un par membre du groupe, trois sur la branche (les cousins des trois Zoombinis « spéciaux »), les autres sur la terrasse. Le cousin d'un
 * Zoombini a ses attributs transformés par une règle cachée (décalage de chaque attribut, et aux niveaux 2 et 3 permutation des quatre attributs). Le joueur dépose
 * des Zoombinis sur le chemin : un essai « juste » est celui d'un Zoombini dont le cousin est sur la branche ; trois essais justes (3 cocons) font déguerpir les nizibooms.
 * Les Zoombinis du groupe ne sont jamais transformés : leurs attributs sortent inchangés (étude §2.2).
 */

/** Niveaux de difficulté (`[7370]`, 0 à 3). */
export const FLEENS_LEVELS = 4;
/** Cocons à remplir (`[7324] == 3`) : le nombre de spéciaux est `min(n, 3)`, les cocons manquants sont remplis d'avance (`10e0:1b29`). */
export const FLEENS_COCOONS = 3;
/** Essais mémorisés sur le chemin (`[7350]`, `[735e]` : 7 ; le plus ancien sort quand le 7e est présent). */
export const FLEENS_QUEUE = 7;
/** Octets de la règle cachée dans le tampon de partie : `S[0x0C..0x0F]` décalages, `S[0x10..0x13]` permutation (étude §2.1). */
export const FLEENS_RULE_BYTES = 8;

/** Points de la branche (`REGS 5000`, 3 points) : positions 17 à 19 des spéciaux. */
export const FLEENS_BRANCH_POINTS: readonly (readonly [number, number])[] = [
  [407, 62],
  [441, 63],
  [473, 61],
];
/** Points de la terrasse (`REGS 5001`, 17 points) : positions 0 à 16 des autres. */
export const FLEENS_TERRACE_POINTS: readonly (readonly [number, number])[] = [
  [618, 65],
  [591, 64],
  [562, 62],
  [536, 68],
  [616, 126],
  [587, 125],
  [537, 131],
  [603, 155],
  [552, 151],
  [573, 157],
  [516, 150],
  [490, 142],
  [541, 222],
  [490, 214],
  [449, 206],
  [512, 226],
  [467, 220],
];

/** Table de mots `DS:1202` lue par la permutation : `[1, 2, 3, 4]` (valeur = tirage + 1). */
const POSITION_TABLE = [1, 2, 3, 4] as const;

/** Règle cachée : `S[0x0C..0x13]` (8 octets). Octets 0 à 3 : décalages (1 à 5) ; octets 4 à 7 : position du nizibooms de chaque attribut (1 à 4), 0 = pas de permutation. */
export type FleensRule = Uint8Array;

export function newFleensRule(): FleensRule {
  return new Uint8Array(FLEENS_RULE_BYTES);
}

/**
 * Attributs affichés d'un cousin (`10e0:1b29`, boucle des membres) : `T_j = ((a_j + S[0x0C + j] − 2) mod 5) + 1`, rangé à la position `S[0x10 + j]` (si non nulle, sinon
 * `j + 1`). Le résultat est dans l'ordre des octets de l'objet (cheveux, yeux, nez, pieds).
 */
export function cousinAttrs(attrs: readonly number[], rule: FleensRule): Attrs {
  const out: Attrs = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) {
    const shifted = ((attrs[j]! + rule[j]! - 2) % 5) + 1;
    const position = rule[4 + j]! === 0 ? j + 1 : rule[4 + j]!;
    out[position - 1] = shifted;
  }
  return out;
}

/** Un nizibooms de l'écran : le cousin du membre `member`. */
export interface Cousin {
  /** Rang 0-based dans le tampon du groupe (rang 1-based de l'original : `member + 1`). */
  member: number;
  /** Attributs affichés (planche 4000). */
  attrs: Attrs;
  /** Sur la branche (position 17 à 19) : son Zoombini est l'un des trois spéciaux. */
  special: boolean;
  /** Position 0 à 16 (terrasse, `REGS 5001`) ou 17 à 19 (branche, `REGS 5000`), `+0x120`. */
  position: number;
  /** Point de départ (écran 640 × 480). */
  origin: readonly [number, number];
  /** Compteur d'attente initial (`+0x128`), 0 à 80. */
  idle: number;
}

export interface FleensTrial {
  member: number;
  /** Le Zoombini est un des spéciaux encore non trouvés : un cocon se remplit. */
  special: boolean;
}

export interface FleensState {
  level: number;
  /** `n` : membres vivants (`[749e]`). */
  count: number;
  /** Règle en vigueur (copie : le tampon de la partie est mis à jour par `prepareFleens`). */
  rule: Uint8Array;
  /** Les nizibooms, dans l'ordre des membres vivants. */
  cousins: Cousin[];
  /** Rangs 0-based des spéciaux, dans l'ordre du tirage (`[733a]`, `[733c]`, `[733e]`). */
  specials: number[];
  /** Spéciaux trouvés. */
  found: number[];
  /** `[7324]` : cocons remplis (0 à 3). */
  cocoons: number;
  /** `[7334]` : un seul Zoombini (le cocon est une variante d'animation, voir `vanished`). */
  single: boolean;
  /** `[734c]` : les derniers essais sur le chemin, du plus ancien au plus récent (7 au plus, 6 après la sortie du plus ancien). */
  queue: number[];
  /** Historique de tous les essais, dans l'ordre. */
  trials: FleensTrial[];
  /** `[7380]` : séquence de clôture terminée (le bouton « Go » est autorisé avec les trois cocons). */
  closed: boolean;
  /** Membres disparus pendant l'animation (événement 137 : `+0xE0 = 0`), perdus à la sortie. */
  vanished: number[];
}

/**
 * Fabrique l'écran : `10e0:1b29`, dans l'ordre des tirages de l'original.
 *  1. rang du premier spécial `rand(1..n)` ; puis (n ≥ 2) le deuxième, tiré jusqu'à être différent ; puis (n ≥ 3) le troisième ;
 *  2. règle : si `S[0x0C] == 0` ou niveau 1 ou 3, quatre décalages `rand(1..5)` ;
 *  3. permutation : niveaux 0 et 1, aucune (`S[0x10..0x13] = 0`) ; niveaux 2 et 3, si `S[0x10] == 0` ou niveau 3 : `k = rand(2..4)`, puis trois tirages sans remise
 *     (`1098:0098`, masque `1 << (k − 1)`) pour `S[0x11..0x13]` ;
 *  4. pour chaque membre vivant, dans l'ordre : `rand(0..80)` (compteur d'attente).
 * `rule` est le tampon `S[0x0C..0x13]` de la partie : lu et **mis à jour sur place** (les niveaux 0 et 2 conservent la règle d'une entrée à l'autre).
 * Quirk de l'original conservé : `n` est le nombre de membres vivants, mais la boucle lit les `n` premières fiches du tampon (un tampon sans trou donne le même résultat).
 */
export function prepareFleens(members: readonly Zoombini[], level: number, rule: FleensRule, rng: MsvcRandom): FleensState {
  if (!Number.isInteger(level) || level < 0 || level >= FLEENS_LEVELS) throw new RangeError(`Niveau ${level} hors de 0 à 3`);
  if (rule.length !== FLEENS_RULE_BYTES) throw new RangeError(`Règle de ${rule.length} octets (${FLEENS_RULE_BYTES} attendus)`);
  const n = members.filter((m) => m.present).length;
  const state: FleensState = {
    level,
    count: n,
    rule,
    cousins: [],
    specials: [],
    found: [],
    cocoons: n === 1 ? 2 : n === 2 ? 1 : 0,
    single: n === 1,
    queue: [],
    trials: [],
    closed: false,
    vanished: [],
  };
  if (n === 0) return state;

  // Spéciaux : rangs 1-based dans [1, n], distincts.
  const first = rng.range(1, n);
  const picked = [first];
  if (n >= 2) {
    let second = first;
    while (second === first) second = rng.range(1, n);
    picked.push(second);
  }
  if (n >= 3) {
    let third = first;
    while (third === first || third === picked[1]) third = rng.range(1, n);
    picked.push(third);
  }

  // Règle cachée.
  if (rule[0] === 0 || level === 1 || level === 3) {
    for (let j = 0; j < 4; j++) rule[j] = rng.range(1, 5);
  }
  if (level < 2) {
    for (let j = 4; j < 8; j++) rule[j] = 0;
  } else if (rule[4] === 0 || level === 3) {
    rule[4] = rng.range(2, 4);
    const pool = new NoRepeatPool(4, 0);
    pool.state = 1 << (rule[4] - 1);
    for (let j = 5; j < 8; j++) rule[j] = POSITION_TABLE[pool.pick(rng)]!;
  }

  // Les nizibooms.
  let branchUsed = 0;
  let terraceUsed = 0;
  for (let i = 0; i < n; i++) {
    const member = members[i];
    if (!member || !member.present) continue;
    const special = picked.includes(i + 1);
    let position: number;
    let origin: readonly [number, number];
    if (special) {
      if (branchUsed >= FLEENS_BRANCH_POINTS.length) throw new RangeError("Plus de point sur la branche");
      position = FLEENS_TERRACE_POINTS.length + branchUsed;
      origin = FLEENS_BRANCH_POINTS[branchUsed]!;
      branchUsed++;
    } else {
      if (terraceUsed >= FLEENS_TERRACE_POINTS.length) throw new RangeError("Plus de point sur la terrasse");
      position = terraceUsed;
      origin = FLEENS_TERRACE_POINTS[terraceUsed]!;
      terraceUsed++;
    }
    state.cousins.push({ member: i, attrs: cousinAttrs(member.attrs, rule), special, position, origin, idle: rng.range(0, 80) });
  }
  state.specials = picked.map((rank) => rank - 1);
  return state;
}

/** Vrai tant que le joueur peut déposer un Zoombini (`10e0:0ae5` : moins de 3 cocons). */
export function canTry(state: FleensState): boolean {
  return state.cocoons < FLEENS_COCOONS;
}

export interface FleensTryResult {
  /** Cocon rempli par cet essai (cousin tombé de la branche). */
  special: boolean;
  cocoons: number;
  /** Les trois cocons sont pleins : la séquence de clôture commence. */
  done: boolean;
  /** Membre sorti de la file (le plus ancien, quand le 7e essai est présent), ou null. */
  ejected: number | null;
}

/**
 * Un essai (dépose du membre `member` sur le chemin, `10e0:06a8` puis événements 6 et 132 de `10e0:227e`). Renvoie null si l'essai est refusé : écran terminé
 * (3 cocons), membre inconnu ou disparu.
 *  - spécial (rang tiré, pas encore trouvé) : `[7324]++`, le cocon se remplit, le spécial sort de la liste (un spécial trouvé ne compte pas deux fois : événement 6, **probable**) ;
 *  - sinon : sans effet sur les compteurs. **Aucune limite d'essais ni pénalité** (étude §2.5) : on peut déposer le même Zoombini autant de fois qu'on veut.
 *  - l'essai entre dans la file ; quand elle contient 7 essais, le plus ancien sort (événement 132) ;
 *  - un seul Zoombini (`n = 1`) : l'animation du cocon le fait disparaître (événement 137), il sera perdu (**probable**, étude §2.5).
 */
export function tryMember(state: FleensState, member: number): FleensTryResult | null {
  if (!canTry(state)) return null;
  if (!state.cousins.some((c) => c.member === member) || state.vanished.includes(member)) return null;
  const special = state.specials.includes(member) && !state.found.includes(member);
  if (special) {
    state.found.push(member);
    state.cocoons++;
  }
  state.trials.push({ member, special });
  state.queue.push(member);
  let ejected: number | null = null;
  if (state.queue.length === FLEENS_QUEUE) ejected = state.queue.shift()!;
  if (special && state.single) state.vanished.push(member);
  return { special, cocoons: state.cocoons, done: state.cocoons >= FLEENS_COCOONS, ejected };
}

/** Succès : les trois cocons sont pleins (`[737e]`). */
export function isSolved(state: FleensState): boolean {
  return state.cocoons >= FLEENS_COCOONS;
}

/** Fin de la séquence de clôture (`10e0:2f0d`, événement −1 : `[7380] = 1`). Sans effet avant le succès. */
export function endClosure(state: FleensState): void {
  if (isSolved(state)) state.closed = true;
}

/** Le bouton « Go » (flèche) est actif (`10e0:0ae5` région 2 : `[737e]` et `[7380]`). */
export function canGo(state: FleensState): boolean {
  return isSolved(state) && state.closed;
}

export interface FleensExit {
  /** Rangs 0-based des Zoombinis perdus. */
  lost: number[];
  /** Tous sains et saufs (clôture atteinte et aucun disparu). */
  clean: boolean;
}

/**
 * Sortie par « Go » (`1168:3dd0(0, 1)`, `1168:36e1`) : tous les Zoombinis actifs sont sauvés (`+0x127 = 1`), sauf ceux qui ont disparu (`+0xE0 = 0`).
 * Renvoie null tant que « Go » n'est pas actif. Les attributs du groupe ne changent pas.
 */
export function goExit(state: FleensState): FleensExit | null {
  if (!canGo(state)) return null;
  const lost = [...state.vanished].sort((a, b) => a - b);
  return { lost, clean: lost.length === 0 };
}

/** Sortie par le bouton « carte » : l'épreuve est abandonnée (règle générale du parcours, `screens.md` §3.4), tout le groupe est perdu. */
export function mapExit(state: FleensState): FleensExit {
  return { lost: state.cousins.map((c) => c.member), clean: false };
}

/** Le groupe à la sortie : mêmes Zoombinis, mêmes attributs, `present` faux pour les perdus. */
export function groupAfterExit(members: readonly Zoombini[], exit: FleensExit): Zoombini[] {
  return members.map((m, i) => ({ ...m, attrs: [...m.attrs] as Attrs, state: m.state.slice(), present: m.present && !exit.lost.includes(i) }));
}

// --- Robot ---

/** Ce que voit le joueur. */
export interface FleensView {
  level: number;
  /** Attributs des Zoombinis du groupe, dans l'ordre (vrais attributs). */
  members: Attrs[];
  /** Attributs des nizibooms de la branche (les trois cousins spéciaux). */
  branch: Attrs[];
  /** Attributs des nizibooms de la terrasse. */
  terrace: Attrs[];
  /** Essais faits et leur résultat visible (un cocon se remplit ou non). */
  tried: FleensTrial[];
  /** Cocons remplis d'avance (`n < 3`). */
  cocoons: number;
}

export function fleensView(state: FleensState, members: readonly Zoombini[]): FleensView {
  const alive = members.filter((m) => m.present);
  return {
    level: state.level,
    members: alive.map((m) => [...m.attrs] as Attrs),
    branch: state.cousins.filter((c) => c.special).map((c) => [...c.attrs] as Attrs),
    terrace: state.cousins.filter((c) => !c.special).map((c) => [...c.attrs] as Attrs),
    tried: state.trials.map((t) => ({ ...t })),
    cocoons: state.single ? 2 : state.count === 2 ? 1 : 0,
  };
}

function key(attrs: readonly number[]): string {
  return attrs.join(",");
}

/** Toutes les règles possibles au niveau donné : décalages 1 à 5 par attribut, permutation (niveaux 2 et 3) : l'attribut 0 en position 2 à 4, les autres dans les trois positions restantes. */
function* hypotheses(level: number): Generator<Uint8Array> {
  const perms: number[][] = [];
  if (level < 2) perms.push([0, 0, 0, 0]);
  else {
    for (let k = 2; k <= 4; k++) {
      const rest = [1, 2, 3, 4].filter((p) => p !== k);
      const orders = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ];
      for (const o of orders) perms.push([k, rest[o[0]!]!, rest[o[1]!]!, rest[o[2]!]!]);
    }
  }
  for (let s = 0; s < 625; s++) {
    const shifts = [(s % 5) + 1, (Math.trunc(s / 5) % 5) + 1, (Math.trunc(s / 25) % 5) + 1, (Math.trunc(s / 125) % 5) + 1];
    for (const p of perms) yield Uint8Array.from([...shifts, ...p]);
  }
}

/**
 * Ensembles de Zoombinis spéciaux compatibles avec ce que voit le joueur : pour chaque règle dont les cousins du groupe sont exactement les nizibooms de l'écran
 * (branche et terrasse), les spéciaux sont les Zoombinis dont le cousin est sur la branche (si deux Zoombinis ont le même cousin, chaque choix est un cas).
 */
export function possibleSpecials(view: FleensView): number[][] {
  const seen = view.branch.length + view.terrace.length;
  const target = [...view.branch, ...view.terrace].map(key).sort();
  const branchKeys = view.branch.map(key);
  const worlds = new Map<string, number[]>();
  if (view.members.length !== seen) return [];
  for (const rule of hypotheses(view.level)) {
    const cousins = view.members.map((m) => key(cousinAttrs(m, rule)));
    const sorted = [...cousins].sort();
    if (sorted.some((k, i) => k !== target[i])) continue;
    // Affecte à chaque nizibooms de la branche un membre distinct dont le cousin lui ressemble (tous les choix).
    const assign = (index: number, used: number[]): void => {
      if (index === branchKeys.length) {
        const set = [...used].sort((a, b) => a - b);
        worlds.set(set.join(","), set);
        return;
      }
      for (let m = 0; m < cousins.length; m++) {
        if (cousins[m] === branchKeys[index] && !used.includes(m)) assign(index + 1, [...used, m]);
      }
    };
    assign(0, []);
  }
  return [...worlds.values()];
}

/**
 * Prochain Zoombini que le robot dépose, ou null si l'épreuve est finie. Il garde les ensembles de spéciaux compatibles avec la vue et les essais déjà faits, et
 * choisit le Zoombini présent dans le plus grand nombre d'ensembles (le plus petit rang en cas d'égalité). Quand la vue détermine les spéciaux (cas courant : les
 * Zoombinis du groupe sont tous distincts), tous les essais sont justes : 3 essais pour `n ≥ 3`, `min(n, 3)` en général.
 */
export function robotChoice(view: FleensView): number | null {
  const worlds = possibleSpecials(view).filter((w) =>
    view.tried.every((t) => (t.special ? w.includes(t.member) : !w.includes(t.member))),
  );
  const done = new Set(view.tried.filter((t) => t.special).map((t) => t.member));
  const tried = new Set(view.tried.map((t) => t.member));
  const count = new Map<number, number>();
  for (const w of worlds) for (const m of w) if (!tried.has(m)) count.set(m, (count.get(m) ?? 0) + 1);
  let best: number | null = null;
  for (const [m, c] of [...count].sort((a, b) => a[0] - b[0])) if (best === null || c > count.get(best)!) best = m;
  if (best !== null) return best;
  // Aucun cas ne reste (vue incohérente) : essaie les Zoombinis non essayés dans l'ordre.
  for (let m = 0; m < view.members.length; m++) if (!tried.has(m) && !done.has(m)) return m;
  return null;
}

/** Joue le robot jusqu'au succès (au plus `n × 3` essais) ; renvoie le nombre d'essais, ou null s'il ne réussit pas. */
export function runRobot(state: FleensState, members: readonly Zoombini[]): number | null {
  const limit = Math.max(1, state.count) * 3;
  for (let i = 0; i < limit && !isSolved(state); i++) {
    const m = robotChoice(fleensView(state, members));
    if (m === null) return null;
    tryMember(state, m);
  }
  return isSolved(state) ? state.trials.length : null;
}
