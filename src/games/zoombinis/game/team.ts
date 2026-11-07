import type { MsvcRandom } from "../../../engine/mohawk/rng";
import {
  type Attrs,
  type GameState,
  type GroupBuffer,
  type PoolEntry,
  type Reserve,
  type Session,
  type Zoombini,
  GROUP_CAPACITY,
  GROUP_SIZE,
  ZOOMBINI_TYPES,
  aliveCount,
  cloneGroup,
  emptyGroup,
  entryFromZoombini,
  isOccupied,
  isValidAttrs,
  makeZoombini,
  typeIndex,
  zoombiniFromEntry,
} from "./state";

/**
 * Règles des Zoombinis et de leurs groupes (`docs/zoombinis/screens.md` §2.2, §3.3, §3.4, §4) : choix, camps, ville. Fonctions pures sur
 * `GameState` ; tout le hasard passe par le `MsvcRandom` reçu. Aucun texte, aucun rendu.
 */

/** Copies d'un même type au plus (`1128:13a4` : le compteur doit être < 2). */
export const MAX_COPIES = 2;
/** Essais aléatoires du bouton « au hasard » (`1128:143a` : 63 tirages, le 64e passage est le balayage). */
export const RANDOM_TRIES = 0x40;

// --- Choix des Zoombinis (écran 3, `1128:*`) ---

/**
 * `1128:13a4` : le type sélectionné est-il encore disponible ? Faux tant qu'un des quatre attributs vaut 0 (non choisi) ; une valeur hors 0 à 5 est ramenée à 0.
 * Disponible quand moins de deux exemplaires ont été créés (`S+0xAB94`).
 */
export function isAvailable(game: GameState, selection: readonly number[]): boolean {
  if (selection.length !== 4) return false;
  if (!selection.every((a) => Number.isInteger(a) && a >= 1 && a <= 5)) return false;
  return game.typeCounts[typeIndex(selection)]! < MAX_COPIES;
}

export interface RandomPick {
  /** Les quatre valeurs (1 à 5) ; peut contenir des 0 si aucun type n'est disponible. */
  attrs: number[];
  /** `[8ce6]` : le type obtenu est disponible. */
  available: boolean;
  /** `param_1` final : toute la sélection a été retirée au sort (déclenche la phrase du guide `1168:1f84(10, …)`). */
  rerolled: boolean;
}

/**
 * `1128:143a` (bouton « au hasard ») : complète la sélection `selection` (0 = attribut non choisi ; `force` = tout retirer au sort).
 * Essais 1 à 63 : chaque attribut non choisi (ou tous si `force`) est tiré par `10a8:04e8(5, 1)` = `rng.range(1, 5)` ; tant que le type n'est pas disponible,
 * les essais suivants retirent les quatre. Au 64e passage : balayage des 625 types, la **dernière** combinaison disponible est retenue.
 */
export function pickRandomType(game: GameState, rng: MsvcRandom, selection: readonly number[], force = false): RandomPick {
  const sel = [0, 0, 0, 0].map((_, i) => {
    const v = selection[i] ?? 0;
    return Number.isInteger(v) && v >= 1 && v <= 5 ? v : 0;
  });
  let rerolled = force;
  let available = false;
  let tries = 0;
  while (!available && tries < RANDOM_TRIES) {
    tries += 1;
    if (tries < RANDOM_TRIES) {
      for (let i = 0; i < 4; i += 1) if (sel[i] === 0 || rerolled) sel[i] = rng.range(1, 5);
    } else {
      rerolled = true;
      for (let a = 0; a < 5; a += 1)
        for (let b = 0; b < 5; b += 1)
          for (let c = 0; c < 5; c += 1)
            for (let d = 0; d < 5; d += 1) {
              if (game.typeCounts[a * 125 + b * 25 + c * 5 + d]! < MAX_COPIES) {
                sel[0] = a + 1;
                sel[1] = b + 1;
                sel[2] = c + 1;
                sel[3] = d + 1;
              }
            }
    }
    available = isAvailable(game, sel);
    if (!available) rerolled = true;
  }
  return { attrs: sel, available, rerolled };
}

export interface AddedZoombini {
  zoombini: Zoombini;
  /** Octet tiré par `10a8:04e8(0x40, 0)` dans `1168:0755` (objet `+0xF8` : variante de voix / de pose ; absent de la fiche de 19 octets, donc non sauvegardé). */
  variant: number;
}

/**
 * Bouton « ajouter » (cas 1 de `1128:079c`) : `1128:16ac(1)` compte l'exemplaire, `S+0x48` augmente, `1168:0755` crée le personnage avec un octet
 * aléatoire. Refusé (null) si le type n'est pas disponible, si le groupe est plein (16) ou si les 625 sont créés.
 * `id` : identifiant de la fiche (`+4` ; son origine n'est pas établie, fourni par l'écran).
 */
export function addZoombini(game: GameState, attrs: readonly number[], rng: MsvcRandom, id = 0): AddedZoombini | null {
  if (!isValidAttrs(attrs) || !isAvailable(game, attrs)) return null;
  if (game.group.members.length >= GROUP_SIZE || game.counters.created >= ZOOMBINI_TYPES) return null;
  game.typeCounts[typeIndex(attrs)]! += 1;
  game.counters.created += 1;
  const variant = rng.range(0, 0x40);
  const zoombini = makeZoombini(attrs, id);
  game.group.members.push(zoombini);
  return { zoombini, variant };
}

/**
 * Retrait d'un Zoombini du groupe (cas 7 de `1128:079c`, `1128:16ac(0)`, `1168:170f`) : libère son exemplaire (`S+0xAB94`, jamais sous 0)
 * et `S+0x48 −= 1`. Renvoie la fiche retirée (l'écran remet ses valeurs dans les boutons), ou null.
 */
export function removeZoombini(game: GameState, index: number): Zoombini | null {
  const [z] = index >= 0 && index < game.group.members.length ? game.group.members.splice(index, 1) : [];
  if (!z) return null;
  const t = typeIndex(z.attrs);
  if (game.typeCounts[t]! > 0) game.typeCounts[t]! -= 1;
  game.counters.created = Math.max(0, game.counters.created - 1);
  return z;
}

/** `1128:1b20` : le groupe est complet quand il a 16 membres, ou quand les 625 sont créés (dernier groupe plus petit) ; jamais s'il est vide. */
export function groupComplete(game: GameState): boolean {
  const n = game.group.members.length;
  if (n === 0) return false;
  return !(n < GROUP_SIZE && game.counters.created < ZOOMBINI_TYPES);
}

/** Zoombinis restant à créer : `625 − (S+0x4A + S+0x4C + S+0x4E) − membres du groupe` (`1128:079c` cas 6 et `1128:006d`, **probable**). */
export function remainingToCreate(game: GameState): number {
  const c = game.counters;
  return ZOOMBINI_TYPES - (c.camp1 + c.camp2 + c.town) - game.group.members.length;
}

/** Groupe courant tel que 'laissé' par l'écran (`1168:36e1`, partie collecte) : présents d'abord, perdus ensuite, 32 au plus ; drapeaux remis à 0. */
export function collectGroup(game: GameState, party: readonly Zoombini[]): void {
  const alive = party.filter((z) => z.present);
  const lost = party.filter((z) => !z.present);
  game.group = { members: [...alive, ...lost].slice(0, GROUP_CAPACITY), flagA: false, flagB: false };
}

/**
 * Entrée de l'écran 3 (`1128:006d`) : le groupe de travail est recopié depuis la réserve `S+0xA1FC`, qui est vidée.
 * Renvoie les membres à afficher (copie).
 */
export function pickerEnter(game: GameState): Zoombini[] {
  game.group = cloneGroup(game.pickerGroup);
  game.pickerGroup.members = [];
  return game.group.members.map((m) => ({ ...m, attrs: [...m.attrs] as Attrs, state: m.state.slice() }));
}

/**
 * Sortie de l'écran 3 (`1128:049a`) avec le groupe `party` de la scène. Vers une épreuve : la réserve est vidée et le groupe part dans le tampon.
 * Vers la carte (bouton, `toMap`) ou à la fermeture : le groupe incomplet est gardé dans la réserve (`flagA` et `flagB` à 0) et le tampon est vidé.
 * Si la carte a déjà abandonné le groupe (`session.leftToMap`), rien n'est recopié (le groupe est perdu).
 */
export function pickerLeave(game: GameState, session: Session, party: readonly Zoombini[], toMap: boolean): void {
  collectGroup(game, party);
  if (session.leftToMap) return;
  if (!session.quitting && !toMap) {
    game.pickerGroup.members = [];
  } else {
    game.pickerGroup = cloneGroup(game.group);
    game.group.members = [];
  }
}

// --- Réserves (camps et population) ---

/** `10b0:17b1` : un de plus que l'indice de la dernière entrée occupée (0 si la réserve est vide). */
export function reserveEnd(reserve: Reserve): number {
  for (let i = ZOOMBINI_TYPES - 1; i >= 0; i -= 1) if (isOccupied(reserve.entries[i]!)) return i + 1;
  return 0;
}

function recount(reserve: Reserve): void {
  reserve.count = reserve.entries.reduce((n, e) => n + (isOccupied(e) ? 1 : 0), 0);
}

/** Lignes du présentoir : 625 entrées par pages de 5 (`6ddc` supposé égal à 125, **hypothèse**). */
export const SHELF_ROWS = ZOOMBINI_TYPES / 5;

/**
 * `10b0:1ac9` : verse les membres (les vivants d'un groupe, dans l'ordre) dans la réserve. Contigu à la suite des occupés s'il reste de la place
 * (renvoie vrai : l'écran recale alors le défilement, voir `shelfScrollAfterDeposit`) ; sinon dans les premiers emplacements libres (renvoie faux).
 */
export function depositToReserve(reserve: Reserve, members: readonly Zoombini[]): boolean {
  const end = reserveEnd(reserve);
  let contiguous = false;
  if (end + members.length < ZOOMBINI_TYPES) {
    members.forEach((z, i) => {
      reserve.entries[end + i] = entryFromZoombini(z);
    });
    contiguous = true;
  } else {
    let placed = 0;
    for (let i = 0; placed < members.length && i < ZOOMBINI_TYPES; i += 1) {
      if (!isOccupied(reserve.entries[i]!)) {
        reserve.entries[i] = entryFromZoombini(members[placed]!);
        placed += 1;
      }
    }
  }
  recount(reserve);
  return contiguous;
}

/** Défilement du présentoir après un versement contigu (`10b0:0027`) : `((fin avant versement + 1) / 5) % lignes`. */
export function shelfScrollAfterDeposit(endBeforeDeposit: number): number {
  return Math.trunc((endBeforeDeposit + 1) / 5) % SHELF_ROWS;
}

/** Rectangle `[gauche, haut, droite, bas]`. */
export type Rect = readonly [number, number, number, number];

/** Lit l'emplacement d'une entrée comme un rectangle de quatre mots 16 bits signés (**probable**). */
export function slotRect(entry: PoolEntry): Rect {
  const v = new DataView(entry.slot.buffer, entry.slot.byteOffset, entry.slot.byteLength);
  return [v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true), v.getInt16(6, true)];
}

export function setSlotRect(entry: PoolEntry, rect: Rect): void {
  const v = new DataView(entry.slot.buffer, entry.slot.byteOffset, entry.slot.byteLength);
  rect.forEach((n, i) => v.setInt16(i * 2, n, true));
}

/** Cellules du présentoir : 25 rectangles (5 × 5) dans l'ordre des entrées affichées, fournis par l'écran (coordonnées de `DS:063a` / `DS:0658`). */
export type ShelfCells = readonly Rect[];

/**
 * `10b0:1217` : cherche une entrée du présentoir à partir de la ligne `scroll` (25 cellules, entrée = `(5 × scroll + k) % 625`).
 *  - `mode "occupied"` : l'entrée occupée dont le rectangle contient le point `(x, y)` (prendre un Zoombini) ; renvoie son indice ;
 *  - `mode "free"` : l'emplacement libre dont la cellule recouvre le plus le rectangle `drop` (reposer un Zoombini, « le plus proche ») ; recouvrement supérieur à 625 points², le premier de
 *    plus grande surface l'emporte. Renvoie −1 si aucun.
 */
export function findShelfEntry(
  reserve: Reserve,
  scroll: number,
  cells: ShelfCells,
  query: { mode: "occupied"; x: number; y: number } | { mode: "free"; drop: Rect },
): number {
  const start = (scroll % SHELF_ROWS) * 5;
  let best = -1;
  let bestArea = 0;
  for (let k = 0; k < Math.min(25, cells.length); k += 1) {
    const index = (start + k) % ZOOMBINI_TYPES;
    const entry = reserve.entries[index] ?? null;
    if (query.mode === "occupied") {
      if (!isOccupied(entry)) continue;
      const [l, t, r, b] = slotRect(entry);
      if (query.x >= l && query.x < r && query.y >= t && query.y < b) return index;
    } else if (!isOccupied(entry)) {
      const [cl, ct, cr, cb] = cells[k]!;
      const [dl, dt, dr, db] = query.drop;
      const w = Math.min(cr, dr) - Math.max(cl, dl);
      const h = Math.min(cb, db) - Math.max(ct, dt);
      const area = w > 0 && h > 0 ? w * h : 0;
      if (area > 0x271 && area > bestArea) {
        bestArea = area;
        best = index;
      }
    }
  }
  return best;
}

// --- Camps (écrans 4 et 5, `10b0:*` / `10b8:*`) ---

export type Camp = 1 | 2;

export function campReserve(game: GameState, camp: Camp): Reserve {
  return camp === 1 ? game.camp1 : game.camp2;
}

export function campGroupReserve(game: GameState, camp: Camp): GroupBuffer {
  return camp === 1 ? game.camp1Group : game.camp2Group;
}

function campCount(game: GameState, camp: Camp): number {
  return camp === 1 ? game.counters.camp1 : game.counters.camp2;
}

function addCampCount(game: GameState, camp: Camp, delta: number): void {
  if (camp === 1) game.counters.camp1 += delta;
  else game.counters.camp2 += delta;
}

export interface CampArrival {
  /** Le groupe debout dans le camp (objets de la scène) : les survivants qui arrivent, ou le groupe restitué en revenant de la carte. */
  party: Zoombini[];
  /** Zoombinis versés sur le présentoir à l'arrivée (les perdus des étapes précédentes). */
  deposited: number;
  /** Défilement du présentoir à appliquer (`reserve.scroll` est déjà mis à jour). */
  scroll: number;
}

/**
 * Arrivée dans un camp (`10b0:0027`, `10b8:0030`, **probable** pour le détail) :
 *  - les survivants du tampon de groupe sont comptés (`S+0x4A` / `S+0x4C` += survivants) et forment le groupe debout ;
 *  - le tampon est remplacé par la réserve de groupe du camp (les perdus rendus par `exitPuzzle`, ou le groupe laissé en retournant à la carte), qui est vidée (drapeaux à 1) ;
 *  - sans survivant (retour de la carte) : le groupe restitué redevient le groupe debout (aucun versement) ;
 *  - sinon, si les perdus n'ont pas encore été versés et qu'il y en a, ils sont versés sur le présentoir (`10b0:1ac9`).
 */
export function campArrive(game: GameState, camp: Camp): CampArrival {
  const survivors = game.group.members.filter((m) => m.present);
  addCampCount(game, camp, survivors.length);
  const reserve = campReserve(game, camp);
  const endBefore = reserveEnd(reserve);
  const source = campGroupReserve(game, camp);
  game.group = cloneGroup(source);
  source.members = [];
  source.flagA = true;
  source.flagB = true;
  let party = survivors;
  let deposited = 0;
  if (survivors.length === 0) {
    // `[970a] = 1` dans l'original, aussitôt consommé par `1168:2505` : aucun effet sur la suite, donc non reproduit.
    party = game.group.members.filter((m) => m.present);
  } else if (!game.group.flagA && aliveCount(game.group) > 0) {
    const lost = game.group.members.filter((m) => m.present);
    const contiguous = depositToReserve(reserve, lost);
    deposited = lost.length;
    if (contiguous) reserve.scroll = shelfScrollAfterDeposit(endBefore);
    game.group.flagA = true;
  }
  return { party, deposited, scroll: reserve.scroll };
}

/**
 * Sortie d'un camp avec le groupe debout `party` (`10b0:0620`, `10b8:0654`). Vers un écran suivant : le groupe part dans le tampon, une copie est rangée dans la réserve
 * de groupe du camp (`flagA` à 1 : elle sera purgée quand les perdus reviendront) et `S+0x4A` / `S+0x4C` diminue du nombre de partants.
 * Vers la carte (ou à la fermeture) : la copie est rangée avec les drapeaux à 0 et le tampon est vidé ; le groupe est restitué à la prochaine arrivée, sans perte de compteur.
 */
export function campLeave(game: GameState, session: Session, camp: Camp, party: readonly Zoombini[], toMap: boolean): void {
  collectGroup(game, party);
  if (session.leftToMap) return;
  const target = camp === 1 ? "camp1Group" : "camp2Group";
  if (!session.quitting && !toMap) {
    game.group.flagA = true;
    game.group.flagB = false;
    game[target] = cloneGroup(game.group);
    game.group.flagA = false;
    game.group.flagB = true;
    addCampCount(game, camp, -aliveCount(game.group));
  } else {
    game[target] = cloneGroup(game.group);
    game.group.members = [];
  }
}

/**
 * Sortie autorisée d'un camp vers l'étape suivante (`6df6` / `6e00`, `10b0:0027`, `10b0:0a2a`) : groupe de 16 membres au moins ; en fin de jeu (tous créés et au plus 15 Zoombinis
 * restants, `S+0x4A [+ S+0x4C] + réserve du choix`), le groupe doit contenir tous les restants.
 * `size` : taille du groupe debout (`1168:02cc`).
 */
export function campExitAllowed(game: GameState, camp: Camp, size: number): boolean {
  const c = game.counters;
  const remaining = (camp === 1 ? c.camp1 : c.camp1 + c.camp2) + game.pickerGroup.members.length;
  const endGame = c.created >= ZOOMBINI_TYPES && remaining <= 15;
  if (!endGame) return size > 15;
  return size !== 0 && size >= remaining;
}

/** Fin de jeu côté camp (`6e00`) : tous les Zoombinis sont créés et il n'en reste pas de quoi faire un groupe de 16. */
export function campEndGame(game: GameState, camp: Camp): boolean {
  const c = game.counters;
  const remaining = (camp === 1 ? c.camp1 : c.camp1 + c.camp2) + game.pickerGroup.members.length;
  return c.created >= ZOOMBINI_TYPES && remaining <= 15;
}

/** Prendre un Zoombini du présentoir pour le mettre dans le groupe (`10b0:0a2a` cas 1) : l'entrée est libérée. Les compteurs de camp ne changent pas (il est toujours au camp). */
export function takeFromShelf(game: GameState, camp: Camp, index: number, id = 0): Zoombini | null {
  const reserve = campReserve(game, camp);
  const entry = reserve.entries[index] ?? null;
  if (!isOccupied(entry)) return null;
  reserve.entries[index] = null;
  recount(reserve);
  return zoombiniFromEntry(entry, id);
}

/** Reposer un membre du groupe sur le présentoir (`10b0:0a2a` cas 2) à l'emplacement libre `index` ; renvoie faux s'il est occupé. `slot` : rectangle de la cellule. */
export function putOnShelf(game: GameState, camp: Camp, z: Zoombini, index: number, slot?: Rect): boolean {
  const reserve = campReserve(game, camp);
  if (index < 0 || index >= ZOOMBINI_TYPES || isOccupied(reserve.entries[index] ?? null)) return false;
  const entry = entryFromZoombini(z);
  if (slot) setSlotRect(entry, slot);
  reserve.entries[index] = entry;
  recount(reserve);
  return true;
}

/** Nombre de Zoombinis au camp (présentoir + groupe debout), `S+0x4A` / `S+0x4C`. */
export function atCamp(game: GameState, camp: Camp): number {
  return campCount(game, camp);
}

// --- Zoombiniville (écran 6, `1188:*`) ---

/** `[9fe2]` : le jeu est fini quand `S+0x4E` dépasse 0x270. */
export function isGameOver(game: GameState): boolean {
  return game.counters.town > ZOOMBINI_TYPES - 1;
}

export interface TownArrival {
  /** Survivants versés dans la population. */
  arrived: number;
  gameOver: boolean;
}

/**
 * Arrivée à Zoombiniville (`1188:0128`, `1188:1bf5`) : `S+0x4E += survivants` ; ils sont versés dans les premiers emplacements libres de la population
 * (arrêt dès que la population dépasse 624) ; le tampon de groupe est vidé.
 */
export function townArrive(game: GameState): TownArrival {
  const survivors = game.group.members.filter((m) => m.present);
  game.counters.town += survivors.length;
  const pop = game.population;
  let placed = 0;
  for (let i = 0; placed < survivors.length && i < ZOOMBINI_TYPES; i += 1) {
    if (pop.count > ZOOMBINI_TYPES - 1) break;
    if (!isOccupied(pop.entries[i]!)) {
      pop.entries[i] = entryFromZoombini(survivors[placed]!);
      pop.count += 1;
      placed += 1;
    }
  }
  game.group.members = [];
  return { arrived: survivors.length, gameOver: isGameOver(game) };
}

/** Nombre de bâtiments : `min(16, (S+0x4E − 20) / 37)` avec `S+0x4E − 20` borné de 0 à 0x25D (`1188:0128`). */
export function townBuildingCount(population: number): number {
  const n = Math.min(Math.max(population - 20, 0), 0x25d);
  return Math.min(16, Math.trunc(n / 37));
}

/**
 * Objets décoratifs aléatoires à produire (`[a026]`, `1188:0128` fin) : 1, 2 supplémentaires, 3, 4 puis 5 quand la population dépasse 100, 200, 300, 400, 500 (donc 1, 3, 6, 10, 15 en tout) ;
 * 0x14 si le jeu est fini. `endGameBurst` (0x28) est la valeur reprise par `1188:0ce5` quand la phrase finale est lancée.
 */
export function townDecorCount(population: number, gameOver: boolean): number {
  if (gameOver) return 0x14;
  let n = 0;
  [100, 200, 300, 400, 500].forEach((threshold, i) => {
    if (population > threshold) n += i + 1;
  });
  return n;
}

export const TOWN_END_GAME_DECOR_BURST = 0x28;
/** Habitants visibles au plus (`iVar6 < 0x14`). */
export const TOWN_VISIBLE_RESIDENTS = 20;
/** Largeur du décor (1 600 points visibles + 320 de bouclage) et pas de défilement. */
export const TOWN_SCROLL_STEP = 320;
export const TOWN_SCROLL_POSITIONS = 6;

/** Habitants affichés : les 20 plus récents au plus, de la fin vers le début (`1188:0128`, **sûr**), à partir de l'entrée qui précède le premier emplacement libre. */
export function townResidents(game: GameState): PoolEntry[] {
  const pop = game.population;
  let first = pop.entries.findIndex((e) => !isOccupied(e));
  if (first < 0) first = 0;
  const out: PoolEntry[] = [];
  for (let i = first - 1; i >= 0 && out.length < TOWN_VISIBLE_RESIDENTS && out.length < game.counters.town; i -= 1) {
    const e = pop.entries[i];
    if (isOccupied(e ?? null)) out.push(e!);
  }
  return out;
}

/** Position de départ d'un habitant : `x = 10a8:04e8(0x63f, −320)`, `y = 10a8:04e8(0x1db, 0x19a)`. */
export function townResidentPosition(rng: MsvcRandom): { x: number; y: number } {
  return { x: rng.range(-320, 0x63f), y: rng.range(0x19a, 0x1db) };
}

/**
 * Clic de défilement (`1188:1071`) : −1 (gauche, x < 0x50), +1 (droite, x ≥ 0x231) ou 0 si le clic est hors de la bande (30 < y < 450, 3 < x < 637) ou au milieu.
 */
export function townScrollDirection(x: number, y: number): -1 | 0 | 1 {
  if (!(y > 0x1e && y < 0x1c2 && x > 3 && x < 0x27d)) return 0;
  if (x < 0x50) return -1;
  if (x >= 0x231) return 1;
  return 0;
}

/** Applique le défilement (`S+0x1E`, 6 positions bouclées) et renvoie la nouvelle position. */
export function townScrollBy(game: GameState, direction: -1 | 1): number {
  game.townScroll = (game.townScroll + direction + TOWN_SCROLL_POSITIONS) % TOWN_SCROLL_POSITIONS;
  return game.townScroll;
}

// --- Entraînement ---

/** Groupe de l'entraînement (`1110:03b8`) : `size` (16) Zoombinis aux attributs tirés par `10a8:04e8(5, 1)`, tous présents, état à zéro. */
export function trainingGroup(rng: MsvcRandom, size = GROUP_SIZE): GroupBuffer {
  const g = emptyGroup();
  for (let i = 0; i < size; i += 1) {
    const attrs: Attrs = [rng.range(1, 5), rng.range(1, 5), rng.range(1, 5), rng.range(1, 5)];
    g.members.push(makeZoombini(attrs, i + 1));
  }
  return g;
}
