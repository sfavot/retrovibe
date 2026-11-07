import type { MsvcRandom } from "../../../../engine/mohawk/rng";
import type { ScriptCell } from "../../data/script";
import type { Attrs } from "../state";

/**
 * Règles du bac du père mathieu (`FERRY.MHK`, écran 10 ; `docs/zoombinis/puzzles/ferry.md`). Fonctions pures, sans rendu, sans service et sans texte.
 *
 * Le joueur pose les Zoombinis du ponton sur les tabourets d'un radeau (16 à 20 tabourets, 4 formes selon le niveau). Un Zoombini est accepté sur un
 * tabouret libre si, avec **chacun** de ses voisins déjà assis, il a au moins un attribut identique (`10d8:0984`, code 3) ; sinon la grenouille
 * l'éjecte et il retourne sur le ponton. Aucune limite d'erreurs, aucun tirage de règle : le bouton « go » est actif dès qu'un Zoombini est assis
 * (`72e0 ≠ 0`) et seuls les assis traversent.
 *
 * Adresses : `10d8:*` est le segment de code de l'écran, `DS:` le segment de données (`1530`). Ghidra inverse l'ordre des arguments pascal
 * (`docs/zoombinis/engine.md` §0) : `10a8:04e8(min, max)` = `rng.range(min, max)`.
 *
 * Écart avec l'original (décidé, `ferry.md` §7 point 1) : à la reprise d'un Zoombini sur un tabouret, `10d8:0984` met son drapeau d'assis à 0, puis,
 * s'il est lâché dans le rectangle du ponton, le restitue (`[BP − 0x22]`, ancien `+0x127`, écrit en `10d8:0dd4`) : il reste compté assis alors qu'il n'est
 * plus sur un tabouret. Ici `pickUp` libère le tabouret et un Zoombini lâché ailleurs que sur un tabouret n'est **pas** assis (`FerryPlay.seatOf` est
 * la seule source). Le comportement d'origine n'est pas reproduit.
 *
 * Autres écarts : le signalement des traits communs de l'entraînement (`DS:730a`, `+0x125`) est calculé (`DropResult.common`) mais l'écran ne l'affiche
 * pas ; le temps (animations, répliques) est laissé à l'écran.
 */

// --- Radeau ---

/** Nombre de tabourets : un par Zoombini du groupe, de 16 à 20 (`10d8:1861`). */
export const MIN_SEATS = 16;
export const MAX_SEATS = 20;
export const FERRY_LEVELS = 4;
/** Taille d'un tabouret (rectangle de voisinage, `10d8:18d6`) et demi-hauteur moins 2 (`h = 36 / 2 − 2`). */
export const SEAT_WIDTH = 44;
export const SEAT_HEIGHT = 36;
export const NEIGHBOR_REACH = SEAT_HEIGHT / 2 - 2;
/** Au plus 8 voisins gardés par tabouret (`DS:7300`, 8 octets par tabouret). */
export const MAX_NEIGHBORS = 8;
/** Point d'ancrage du Zoombini assis : `(x + 22, y − 7)` du tabouret (`1520:00fc + 4i`). */
export const SEAT_ANCHOR = { x: 22, y: -7 } as const;
/** `SCRB` de la première forme (niveau 0, 16 tabourets) et des tabourets (1500 à 1502) / décors (1503 à 1509). */
export const LAYOUT_SCRIPT_FIRST = 1510;
export const SEAT_SCRIPT_FIRST = 1500;
export const DECOR_SCRIPT_FIRST = 1503;

/** Nombre de tabourets du radeau pour un groupe de `groupSize` Zoombinis : hors de 16 à 20, 16 (`10d8:1861` ; `DS:72bc` vaut toujours 0). */
export function seatCount(groupSize: number): number {
  return groupSize < MIN_SEATS || groupSize > MAX_SEATS ? MIN_SEATS : groupSize;
}

/** `SCRB` de la forme du radeau : `1510 + 5 × niveau + (N − 16)`. */
export function layoutScriptId(level: number, size: number): number {
  return LAYOUT_SCRIPT_FIRST + 5 * level + (size - MIN_SEATS);
}

export interface Seat {
  /** Numéro 0-based (l'original numérote de 1 à N : ordre des cases non vides de l'image 0). */
  index: number;
  /** Coin haut-gauche de l'image du tabouret. */
  x: number;
  y: number;
  /** Variante graphique 1 à 3 (`SCRB` 1500 à 1502), sans effet sur la règle. */
  variant: number;
  /** Ancre du Zoombini assis. */
  anchor: { x: number; y: number };
  /** Numéros (0-based, croissants) des tabourets voisins. */
  neighbors: number[];
}

export interface RaftDecor {
  /** `SCRB` du décor (1503 à 1509). */
  script: number;
  x: number;
  y: number;
}

export interface Raft {
  level: number;
  size: number;
  seats: Seat[];
  decor: RaftDecor[];
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Intersection à bords exclus (`max(gauches) < min(droites)` et `max(hauts) < min(bas)`). */
function overlaps(a: Box, b: Box): boolean {
  return Math.max(a.left, b.left) < Math.min(a.right, b.right) && Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
}

/**
 * `10d8:18d6` : le tabouret `i` est voisin de `j` si son rectangle coupe l'une des zones autour de `j` : (1) la colonne étroite
 * `(x + h, y − h, x + 44 − h, y + 36 + h)`, (2) la bande large `(x − h, y + h, x + 44 + h, y + 36 − h)`, (3) au niveau 3 seulement,
 * `(x, y − h, x + 44, y + 36 + h)`. Les tests sont symétriques (vérifié sur les 20 formes).
 */
export function seatNeighbors(level: number, positions: readonly { x: number; y: number }[]): number[][] {
  const h = NEIGHBOR_REACH;
  const box = (p: { x: number; y: number }): Box => ({ left: p.x, top: p.y, right: p.x + SEAT_WIDTH, bottom: p.y + SEAT_HEIGHT });
  return positions.map((pi, i) => {
    const mine = box(pi);
    const list: number[] = [];
    positions.forEach((pj, j) => {
      if (i === j || list.length >= MAX_NEIGHBORS) return;
      const { x, y } = pj;
      const zones: Box[] = [
        { left: x + h, top: y - h, right: x + SEAT_WIDTH - h, bottom: y + SEAT_HEIGHT + h },
        { left: x - h, top: y + h, right: x + SEAT_WIDTH + h, bottom: y + SEAT_HEIGHT - h },
      ];
      if (level === 3) zones.push({ left: x, top: y - h, right: x + SEAT_WIDTH, bottom: y + SEAT_HEIGHT + h });
      if (zones.some((zone) => overlaps(mine, zone))) list.push(j);
    });
    return list;
  });
}

/**
 * Radeau d'un niveau (0 à 3) pour `size` tabourets, d'après les images 0 (tabourets : `w` de 1 à 3, `w = 0` vide) et 1 (décors : `w` de 4 à 10)
 * du `SCRB` de forme (`layoutScriptId`). Les 24 premières cases seulement sont lues (voir `data/script.ts`). Lève une erreur si le nombre de
 * tabourets n'est pas `size`.
 */
export function buildRaft(level: number, size: number, seatCells: readonly ScriptCell[], decorCells: readonly ScriptCell[]): Raft {
  if (!Number.isInteger(level) || level < 0 || level >= FERRY_LEVELS) throw new RangeError(`Niveau ${level} hors de 0 à ${FERRY_LEVELS - 1}`);
  if (size < MIN_SEATS || size > MAX_SEATS) throw new RangeError(`${size} tabourets hors de ${MIN_SEATS} à ${MAX_SEATS}`);
  const found = seatCells.filter((cell) => cell.w >= 1 && cell.w <= 3);
  if (found.length !== size) throw new Error(`Radeau ${level} / ${size} : ${found.length} tabourets lus`);
  const neighbors = seatNeighbors(level, found);
  const seats = found.map(
    (cell, index): Seat => ({
      index,
      x: cell.x,
      y: cell.y,
      variant: cell.w,
      anchor: { x: cell.x + SEAT_ANCHOR.x, y: cell.y + SEAT_ANCHOR.y },
      neighbors: neighbors[index]!,
    }),
  );
  const decor = decorCells.filter((cell) => cell.w >= 4).map((cell): RaftDecor => ({ script: SEAT_SCRIPT_FIRST - 1 + cell.w, x: cell.x, y: cell.y }));
  return { level, size, seats, decor };
}

/** Nombre d'arêtes du graphe de voisinage (chaque paire comptée une fois). */
export function edgeCount(raft: Raft): number {
  return raft.seats.reduce((sum, seat) => sum + seat.neighbors.length, 0) / 2;
}

// --- Règle d'acceptation ---

/** Deux Zoombinis ont-ils au moins une valeur égale parmi leurs 4 attributs ? Masque des attributs communs (bit `1 << k`). */
export function commonMask(a: Attrs, b: Attrs): number {
  let mask = 0;
  for (let k = 0; k < 4; k++) if (a[k] === b[k]) mask |= 1 << k;
  return mask;
}

export interface DropResult {
  accepted: boolean;
  /** Union des attributs communs avec les voisins examinés (`DS:730a`, l'aide de l'entraînement). Les voisins après un refus ne sont pas examinés. */
  common: number;
}

/**
 * `10d8:0984` code 3 : le Zoombini de traits `traits` posé sur le tabouret `seat` est accepté si **chaque** voisin occupé (`occupants[v]` = traits de
 * l'occupant, null = libre) a au moins un attribut identique avec lui ; le test s'arrête au premier voisin sans trait commun. Sans voisin occupé :
 * accepté.
 */
export function testSeat(raft: Raft, occupants: readonly (Attrs | null)[], seat: number, traits: Attrs): DropResult {
  let common = 0;
  for (const v of raft.seats[seat]!.neighbors) {
    const other = occupants[v];
    if (!other) continue;
    const mask = commonMask(traits, other);
    if (mask === 0) return { accepted: false, common };
    common |= mask;
  }
  return { accepted: true, common };
}

// --- Partie ---

export interface FerryPlay {
  raft: Raft;
  /** Traits de chaque Zoombini du groupe (l'indice est le numéro du membre). */
  members: readonly Attrs[];
  /** Tabouret de chaque membre (null : sur le ponton ou en main). */
  seatOf: (number | null)[];
  /** Membre assis sur chaque tabouret (null : libre). */
  occupant: (number | null)[];
  /** Dépôts refusés depuis le début, pour les statistiques. */
  refusals: number;
}

export function createPlay(raft: Raft, members: readonly Attrs[]): FerryPlay {
  return { raft, members, seatOf: members.map(() => null), occupant: raft.seats.map(() => null), refusals: 0 };
}

function traitsAt(play: FerryPlay): (Attrs | null)[] {
  return play.occupant.map((m) => (m === null ? null : play.members[m]!));
}

/** Reprise d'un Zoombini (`10d8:0984` : `+0x127 = 0`, tabouret libéré) : il n'est plus assis, qu'il soit déposé ensuite ou non. */
export function pickUp(play: FerryPlay, member: number): void {
  const seat = play.seatOf[member];
  if (seat !== null && seat !== undefined) play.occupant[seat] = null;
  play.seatOf[member] = null;
}

/**
 * Dépôt du membre `member` sur le tabouret libre `seat` (le membre n'est plus assis nulle part : `pickUp` d'abord s'il l'était). Accepté, il s'assoit ;
 * refusé, il reste hors du radeau (la grenouille l'éjecte).
 */
export function dropOn(play: FerryPlay, member: number, seat: number): DropResult {
  if (play.seatOf[member] !== null) throw new Error(`dropOn : le membre ${member} est déjà assis`);
  if (play.occupant[seat] !== null) throw new Error(`dropOn : le tabouret ${seat} est occupé`);
  const result = testSeat(play.raft, traitsAt(play), seat, play.members[member]!);
  if (result.accepted) {
    play.seatOf[member] = seat;
    play.occupant[seat] = member;
  } else {
    play.refusals += 1;
  }
  return result;
}

/** Nombre d'assis (`1168:02cc`). */
export function seatedCount(play: FerryPlay): number {
  return play.seatOf.filter((s) => s !== null).length;
}

/** Le bouton « go » est actif dès qu'un Zoombini est assis (`72e0 ≠ 0`). */
export function goEnabled(play: FerryPlay): boolean {
  return seatedCount(play) > 0;
}

/** Membres sauvés : les assis au départ ; tous les autres sont perdus. */
export function savedMembers(play: FerryPlay): number[] {
  return play.seatOf.flatMap((s, member) => (s === null ? [] : [member]));
}

/** Tous les voisins occupés partagent-ils un attribut avec leur voisin ? (invariant de l'arrangement). */
export function arrangementValid(play: FerryPlay): boolean {
  const occupants = traitsAt(play);
  return play.raft.seats.every((seat) => {
    const mine = occupants[seat.index];
    return !mine || seat.neighbors.every((v) => !occupants[v] || commonMask(mine, occupants[v]!) !== 0);
  });
}

// --- Ponton ---

/** Les 20 places du ponton (`DS:1082`) : le Zoombini `i` du groupe attend sur la place `i`. Paires : arrière ; impaires : avant. */
export const DOCK_PLACES: readonly { x: number; y: number }[] = [
  { x: 370, y: 160 },
  { x: 395, y: 196 },
  { x: 332, y: 156 },
  { x: 348, y: 196 },
  { x: 294, y: 168 },
  { x: 316, y: 196 },
  { x: 253, y: 166 },
  { x: 276, y: 196 },
  { x: 214, y: 157 },
  { x: 237, y: 196 },
  { x: 175, y: 160 },
  { x: 196, y: 190 },
  { x: 135, y: 152 },
  { x: 150, y: 191 },
  { x: 94, y: 145 },
  { x: 110, y: 186 },
  { x: 57, y: 146 },
  { x: 71, y: 182 },
  { x: 25, y: 145 },
  { x: 27, y: 183 },
];

/** Rectangle du ponton `DS:10e0 = (0, 130)–(469, 240)` : un Zoombini lâché dedans y reste où il est. */
export const DOCK_RECT = { left: 0, top: 130, right: 469, bottom: 240 } as const;

export function inDock(x: number, y: number): boolean {
  return x >= DOCK_RECT.left && x <= DOCK_RECT.right && y >= DOCK_RECT.top && y <= DOCK_RECT.bottom;
}

/** Carré de la distance en dessous de laquelle un Zoombini occupe une place du ponton (`1168:53c9(…, 500, …)` : `dx² + dy² < 500`). */
export const DOCK_OCCUPANCY = 500;

/**
 * Occupation des 20 places (`10d8:1b71`, `DS:9714`) : un Zoombini au repos à moins de √500 d'une place l'occupe ; un Zoombini ne compte que pour la
 * première place libre de son voisinage (le test de l'original évite de compter deux fois le même, à l'intérieur des places précédentes).
 * `resting` : positions (pieds) des Zoombinis au repos sur le ponton ou près de lui, avec leur numéro de membre. Renvoie le membre de chaque place
 * (null = libre).
 */
export function dockOccupancy(resting: readonly { member: number; x: number; y: number }[]): (number | null)[] {
  const result: (number | null)[] = [];
  DOCK_PLACES.forEach((place, i) => {
    const near = resting.filter((r) => (place.x - r.x) ** 2 + (place.y - r.y) ** 2 < DOCK_OCCUPANCY).map((r) => r.member);
    // Premier voisin pas déjà pris par une place précédente (boucle de `10d8:1b71`).
    result[i] = near.find((m) => !result.includes(m)) ?? null;
  });
  return result;
}

/**
 * `10d8:1b71` : place libre du ponton où renvoyer un Zoombini. Une fois sur deux (`rand(1, 100) < 51`) on parcourt les places paires (arrière) de la 18 à
 * la 0, sinon de la 0 à la 18 ; si aucune n'est libre, nouveau tirage sur les places impaires (de la 19 à la 1, ou de la 1 à la 19) ; sinon la place 0.
 */
export function pickDockPlace(occupancy: readonly (number | null)[], rng: Pick<MsvcRandom, "range">): number {
  const free = (k: number): boolean => occupancy[k] === null || occupancy[k] === undefined;
  let found = -1;
  if (rng.range(1, 100) < 0x33) {
    for (let k = 0x12; found === -1 && k >= 0; k -= 2) if (free(k)) found = k;
  } else {
    for (let k = 0; found === -1 && k < 0x13; k += 2) if (free(k)) found = k;
  }
  if (found === -1) {
    if (rng.range(1, 100) < 0x33) {
      for (let k = 0x13; found === -1 && k > 0; k -= 2) if (free(k)) found = k;
    } else {
      for (let k = 1; found === -1 && k < 0x14; k += 2) if (free(k)) found = k;
    }
  }
  return found === -1 ? 0 : found;
}

// --- Tirages sans répétition (`1098:0098`) ---

/** Historique d'un tirage `1098:0098` (masque `DS:0fc6…`) : chaque valeur sort une fois, puis le masque est remis à zéro. */
export interface Bag {
  mask: number;
}

export function createBag(): Bag {
  return { mask: 0 };
}

/**
 * `1098:0098(0, n, &masque)` : `v = rand(0 .. n − 1)`, puis première valeur dont le bit est libre à partir de `v` (circulaire) ; quand toutes sont sorties le
 * masque est remis à zéro. Pour `n = 1` : toujours 0.
 */
export function drawFromBag(bag: Bag, n: number, rng: Pick<MsvcRandom, "range">): number {
  const start = rng.range(0, n - 1);
  let v = start;
  while ((bag.mask & (1 << v)) !== 0) {
    v += 1;
    if (v === n) v = 0;
    if (v === start) bag.mask = 0;
  }
  bag.mask |= 1 << v;
  return v;
}

// --- Répliques du père mathieu (`SCRB` 1800 à 1832) ---

/** Remarque après un refus : 1804 à 1814 (11, tirage sans répétition `DS:0fd2`) ; remarque spéciale 1815 (`0x717`). */
export const REFUSAL_REMARKS: readonly number[] = [1804, 1805, 1806, 1807, 1808, 1809, 1810, 1811, 1812, 1813, 1814];
export const REFUSAL_SPECIAL = 1815;
/** Encouragements : première 1816 (`0x718`), puis 1817 ou 1818 (tirage `DS:0fce`). */
export const ENCOURAGE_FIRST = 1816;
export const ENCOURAGE_NEXT: readonly number[] = [1817, 1818];
/** « C'est à côté » : 1820 à 1822 (`DS:0fda`) ; inactivité : 1823 à 1827 (`DS:0fca`) ; après la baignade : 1828 à 1832 (`DS:0fd6`). */
export const NEAR_REMARKS: readonly number[] = [1820, 1821, 1822];
export const IDLE_REMARKS: readonly number[] = [1823, 1824, 1825, 1826, 1827];
export const BATH_REMARKS: readonly number[] = [1828, 1829, 1830, 1831, 1832];
/** Animations de repos de l'entrée (tirage `DS:0fc6`) ; 1803 est l'introduction de la première visite du programme. */
export const REST_ANIMATIONS: readonly number[] = [1800, 1801, 1802, 1803];
/** Seuil d'inactivité avant une réplique spontanée : tirage `[5400, 10800]` ticks (`DS:72b8`). */
export const IDLE_RANGE = { min: 5400, max: 10800 } as const;

/** Compteurs de répliques de l'écran (`DS:7310`, `730e`, `7312`, `7316`) et historiques des tirages sans répétition. */
export interface Chatter {
  /** `7310` : refus consécutifs. */
  refusals: number;
  /** `730e` : dépôts neufs acceptés consécutifs. */
  accepted: number;
  /** `7312` : seuil de la prochaine réplique d'encouragement (1 au départ). */
  threshold: number;
  /** `7316` : première réplique d'encouragement dite. */
  encouraged: boolean;
  bags: { refusal: Bag; encourage: Bag; near: Bag; idle: Bag; bath: Bag; rest: Bag; variant: Bag };
}

export function createChatter(): Chatter {
  return {
    refusals: 0,
    accepted: 0,
    threshold: 1,
    encouraged: false,
    bags: { refusal: createBag(), encourage: createBag(), near: createBag(), idle: createBag(), bath: createBag(), rest: createBag(), variant: createBag() },
  };
}

/**
 * Dépôt refusé (`10d8:0984`) : `7310 += 1`, `730e = 0`, `7312 = 1` ; la remarque est 1815 quand `rand(3, 5)` égale `7310` (et `7310` passe alors à 5),
 * sinon l'une des 11 autres. Renvoie le `SCRB` de la remarque.
 */
export function onRefusal(chatter: Chatter, rng: Pick<MsvcRandom, "range">): number {
  chatter.refusals += 1;
  chatter.accepted = 0;
  chatter.threshold = 1;
  if (rng.range(3, 5) === chatter.refusals) {
    chatter.refusals = 5;
    return REFUSAL_SPECIAL;
  }
  return REFUSAL_REMARKS[drawFromBag(chatter.bags.refusal, REFUSAL_REMARKS.length, rng)]!;
}

/**
 * Dépôt accepté : `7310 = 0` ; `730e += 1` si le Zoombini vient du ponton (`fromDock`) ; si c'est le dernier du groupe (`seatedBefore + 1 == groupSize`)
 * ou si `730e` atteint `7312`, le seuil monte de `rand(3, 5)` et la grenouille encourage (1816 la première fois, 1817 ou 1818 ensuite). Renvoie le `SCRB`
 * de la réplique ou null.
 */
export function onAcceptance(chatter: Chatter, rng: Pick<MsvcRandom, "range">, fromDock: boolean, seatedBefore: number, groupSize: number): number | null {
  chatter.refusals = 0;
  if (fromDock) chatter.accepted += 1;
  if (seatedBefore + 1 !== groupSize && chatter.accepted !== chatter.threshold) return null;
  chatter.threshold += rng.range(3, 5);
  if (!chatter.encouraged) {
    chatter.encouraged = true;
    return ENCOURAGE_FIRST;
  }
  return ENCOURAGE_NEXT[drawFromBag(chatter.bags.encourage, ENCOURAGE_NEXT.length, rng)]!;
}

// --- Variantes du refus (`10d8:0615`, `10d8:1614`) ---

export const REJECT_VARIANTS = 10;
/** `SCRB` de l'animation du tabouret (`DS:3c`) et `SCRS` d'envol du Zoombini (`DS:50`), d'arrivée (`DS:64`), par variante. */
export const SEAT_EJECT_SCRIPTS: readonly number[] = [1701, 1700, 1700, 1702, 1702, 1703, 1703, 1700, 1702, 1703];
export const EJECT_FLIGHTS: readonly number[] = [1902, 1900, 1900, 1904, 1904, 1906, 1906, 1900, 1904, 1906];
export const EJECT_ARRIVALS: readonly number[] = [1903, 1901, 1905, 1901, 1905, 1901, 1905, 1907, 1907, 1907];
/** `SCRB` de l'action du père mathieu : variante 0 → 1605, 1 à 6 → 1604 ou 1606 (50 %), 7 à 9 → 1607. */
export const FROG_ACTIONS = { far: 1605, short: 1604, shortAlt: 1606, splash: 1607 } as const;
/** Position d'arrivée de la variante 0 (`72c6 = 0xa4007a`) et position intermédiaire de la baignade (`0x1da00ec`) ; le Zoombini nage ensuite de (93, 408). */
export const FAR_ARRIVAL = { x: 122, y: 164 } as const;
export const SPLASH_ENTRY = { x: 236, y: 474 } as const;
export const SWIM_START = { x: 93, y: 408 } as const;

export function isSplash(variant: number): boolean {
  return variant >= 7 && variant <= 9;
}

/**
 * Tirage de la variante du refus et de la place du ponton où retourne le Zoombini (`10d8:0615`, étape « refus en attente »). `occupancy` est celle de
 * `dockOccupancy` (le Zoombini refusé n'en fait pas partie). Variante 0 : refusée si les places 12 ou 14 sont occupées ; variantes 7 à 9 : la place est
 * la première des impaires 19, 17, … 11 qui est libre avec ses places `k − 1` et `k − 3` libres ; si une impaire est occupée avant d'en trouver une, ou
 * s'il n'y en a pas, on tire à nouveau. Les autres variantes gardent la place de `pickDockPlace`.
 */
export function drawRejection(chatter: Chatter, occupancy: readonly (number | null)[], rng: Pick<MsvcRandom, "range">): { variant: number; place: number } {
  const free = (k: number): boolean => occupancy[k] === null || occupancy[k] === undefined;
  let place = pickDockPlace(occupancy, rng);
  for (;;) {
    const variant = drawFromBag(chatter.bags.variant, REJECT_VARIANTS, rng);
    if (variant === 0) {
      if (free(12) && free(14)) return { variant, place };
    } else if (isSplash(variant)) {
      for (let k = 0x13; k > 10; k -= 2) {
        if (!free(k)) break;
        if (free(k - 1) && free(k - 3)) return { variant, place: k };
      }
    } else {
      return { variant, place };
    }
  }
}

/** `SCRB` de l'action du père mathieu pour la variante (le 50/50 des variantes 1 à 6 est tiré ici : `rand(1, 100) < 51`). */
export function frogAction(variant: number, rng: Pick<MsvcRandom, "range">): number {
  if (variant === 0 || variant > 9) return FROG_ACTIONS.far;
  if (isSplash(variant)) return FROG_ACTIONS.splash;
  return rng.range(1, 100) < 0x33 ? FROG_ACTIONS.short : FROG_ACTIONS.shortAlt;
}

/** Départ : `SCRB` 1608 ou 1609 (`rand(1608, 1609)`). */
export function departureScript(rng: Pick<MsvcRandom, "range">): number {
  return rng.range(1608, 1609);
}

// --- Robot ---

export interface RobotMove {
  member: number;
  seat: number;
}

export interface RobotResult {
  /** Dépôts à jouer dans l'ordre : chacun est accepté si les précédents l'ont été. */
  moves: RobotMove[];
  /** Vrai si la recherche a été menée à bout (le résultat est un maximum) ; faux si le budget de nœuds est épuisé. */
  optimal: boolean;
  nodes: number;
}

/** Ordre de parcours en largeur des tabourets à partir du 0 (le graphe est connexe), les éventuels isolés à la fin. */
function seatOrder(raft: Raft): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  for (let start = 0; start < raft.seats.length; start++) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    while (queue.length > 0) {
      const s = queue.shift()!;
      order.push(s);
      for (const v of raft.seats[s]!.neighbors) {
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
  }
  return order;
}

/**
 * Robot : place le plus de Zoombinis possible. Recherche en profondeur sur les tabourets dans l'ordre du parcours en largeur : pour chacun, essayer chaque
 * Zoombini libre qui partage un attribut avec tous ses voisins déjà placés, puis le laisser vide ; coupe quand le meilleur possible
 * (`placés + min(tabourets restants, Zoombinis restants)`) ne dépasse pas le meilleur trouvé ; arrêt dès que tout le monde est assis. `budget` : nombre de
 * nœuds au plus (`optimal` faux si dépassé). Les dépôts rendus se rejouent dans l'ordre (chaque arrangement partiel est valide).
 */
export function robot(raft: Raft, members: readonly Attrs[], budget = 300_000): RobotResult {
  const order = seatOrder(raft);
  const target = Math.min(members.length, raft.seats.length);
  const used = new Array<boolean>(members.length).fill(false);
  const placed: (number | null)[] = raft.seats.map(() => null);
  let best: RobotMove[] = [];
  let nodes = 0;
  let exhausted = false;

  const current: RobotMove[] = [];
  const search = (depth: number, count: number): void => {
    if (count > best.length) best = current.slice();
    if (best.length >= target || depth === order.length || exhausted) return;
    if (count + Math.min(order.length - depth, members.length - count) <= best.length) return;
    if (++nodes > budget) {
      exhausted = true;
      return;
    }
    const seat = order[depth]!;
    const candidates: number[] = [];
    for (let m = 0; m < members.length; m++) {
      if (used[m]) continue;
      const ok = raft.seats[seat]!.neighbors.every((v) => placed[v] === null || commonMask(members[m]!, members[placed[v]!]!) !== 0);
      if (ok) candidates.push(m);
    }
    for (const m of candidates) {
      used[m] = true;
      placed[seat] = m;
      current.push({ member: m, seat });
      search(depth + 1, count + 1);
      current.pop();
      placed[seat] = null;
      used[m] = false;
      if (best.length >= target || exhausted) return;
    }
    search(depth + 1, count);
  };
  search(0, 0);
  return { moves: best, optimal: !exhausted, nodes };
}
