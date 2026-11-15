/**
 * Mode à deux joueurs (« Head to Head », « Duel » du menu principal, mode `[0x477988]` = 2), sans navigateur : réglages de la
 * fenêtre `HEDTOHED.ITF`, tours, chronomètre, manches, choix du puzzle. Lu dans TIMWIN.EXE (`docs/tim3/ui.md` § Deux joueurs).
 *
 * - **Réglages** (41d15c, boutons 41d4be) : nombre de parties `[0x477984]` 1 à 9 de 2 en 2 (3 par défaut), temps de chaque
 *   joueur `[0x47797c]` / `[0x477980]` de 10 à 90 s de 5 en 5 (45 s par défaut), gardés d'un match à l'autre (`0x472840`) ; noms
 *   de 10 caractères au plus (`0x47e6dc`, `0x47e6e7`), « Joueur 1 » et « Joueur 2 » (2100, 2101) au départ ; un nom vide est
 *   refusé par GENERIC 31179.
 * - **Tours** (4330d0, appelé par les boucles d'édition et de marche) : le joueur `[0x4815d4]` a jusqu'à l'échéance `[0x4815d8]`
 *   (son temps, compté depuis la fermeture du message « c'est votre tour ») ; « Terminer le Tour » (35022, 418e70) met l'échéance
 *   à maintenant. À l'échéance, hors marche, le tour passe : pièce tenue posée ou rendue au bac (4301f5), son 0xBF8, fond de l'aire
 *   12 (joueur 1) ou 9 (joueur 2), GENERIC 31116 « %s, c'est votre tour. », compteurs du tour remis à zéro. Le temps court aussi
 *   pendant la marche de la machine ; le tour ne passe qu'une fois la machine arrêtée.
 * - **Une pièce du bac par tour, une pièce de l'aire par tour** : `0x4815c0` = pièce du bac prise ce tour (417190), `0x4815b8` = la
 *   même une fois posée (41715f), `0x4815bc` = pièce de l'aire touchée ce tour (4301cb : saisie, rangée, retournée, étirée). Le bac
 *   refuse une seconde pièce une fois la première posée (41812b → 418207 : son 0xE24, GENERIC 31153) ; une autre pièce de l'aire
 *   n'est plus sélectionnable (43013e ; un appui donne 0xE24 et GENERIC 31152). La pièce du bac posée ce tour et la pièce touchée
 *   restent modifiables, ainsi que le partenaire (+0x94) d'une télécommande (0x16) ou d'explosifs (0x37).
 * - **Manche gagnée** (419803, 41993b) : le joueur du tour où la machine résout le puzzle gagne la manche. Match fini quand le
 *   total des manches atteint le nombre de parties ou qu'un joueur en a la majorité : GENERIC 31120 (Rejouer / Affronter) ; sinon
 *   le message de balle de match (41d827 : 2154 ou 2155) ou 31117 (Rejouer / Suivant). « Rejouer » relance la machine et repose la
 *   question ; « Suivant » note le puzzle résolu (42ccae) et ouvre le puzzle suivant (`nextDuelPuzzle`) ; le vainqueur de la
 *   manche commence la suivante ; « Affronter » rouvre la fenêtre des réglages.
 */
import type { Part } from "./part";
import type { PuzzleRef } from "./session";

// ------------------------------------------------------------------ réglages (HEDTOHED.ITF)

/** Parties : 1 à 9, de 2 en 2 (41d5fd, 41d62b), 3 au départ (41d18e). */
export const DUEL_GAMES = { min: 1, max: 9, step: 2, initial: 3 } as const;
/** Temps d'un tour, en millisecondes : 10 à 90 s, de 5 en 5 (41d659 … 41d6e6), 45 s au départ (0xAFC8). */
export const DUEL_TIME = { min: 10_000, max: 90_000, step: 5_000, initial: 45_000 } as const;
/** Noms : 10 caractères (416bb3 avec 0x0A, tampons de 11 octets). */
export const DUEL_NAME_MAX = 10;

export type Player = 0 | 1;

export interface DuelSettings {
  /** Nombre de parties du match (impair). */
  games: number;
  /** Temps de chaque joueur, en millisecondes. */
  times: [number, number];
  names: [string, string];
}

/** Réglages de départ : noms par défaut du jeu (2100, 2101 : « Joueur 1 », « Joueur 2 »). */
export function defaultDuelSettings(names: [string, string]): DuelSettings {
  return { games: DUEL_GAMES.initial, times: [DUEL_TIME.initial, DUEL_TIME.initial], names: [names[0].slice(0, DUEL_NAME_MAX), names[1].slice(0, DUEL_NAME_MAX)] };
}

/** Flèches « Parties » de la fenêtre (41d5fd : +2 jusqu'à 9, 41d62b : −2 jusqu'à 1). */
export function stepGames(games: number, direction: 1 | -1): number {
  return Math.max(DUEL_GAMES.min, Math.min(DUEL_GAMES.max, games + DUEL_GAMES.step * direction));
}

/** Flèches « Durée » d'un joueur (5 s, entre 10 et 90 s). */
export function stepTime(time: number, direction: 1 | -1): number {
  return Math.max(DUEL_TIME.min, Math.min(DUEL_TIME.max, time + DUEL_TIME.step * direction));
}

/** Chiffres des dizaines et des unités de secondes (41d716 : t / 10000, (t / 1000) % 10). */
export function timeDigits(ms: number): [number, number] {
  return [Math.trunc(ms / 10_000) % 10, Math.trunc(ms / 1_000) % 10];
}

/** Chiffres du chronomètre du tableau (41495b) : dizaines, unités de secondes, dixièmes. */
export function clockDigits(ms: number): [number, number, number] {
  const t = Math.max(0, Math.trunc(ms));
  return [Math.trunc(t / 10_000) % 10, Math.trunc(t / 1_000) % 10, Math.trunc(t / 100) % 10];
}

// ------------------------------------------------------------------ règle du tour (garde de l'éditeur)

/**
 * Ce que l'éditeur demande avant d'agir et signale après (TIMWIN.EXE n'agit ainsi qu'en mode 2). Sans garde, tout est permis.
 */
export interface EditGuard {
  /** Le bac donne-t-il encore une pièce (418207 : non si une pièce du bac a été posée ce tour) ? */
  mayTakeFromBin(): boolean;
  /** Une pièce de l'aire peut-elle être sélectionnée et modifiée (43013e) ? */
  mayTouch(part: Part): boolean;
  /** Pièce prise dans le bac (417190). */
  taken(part: Part): void;
  /** Pièce tenue posée (41715f). */
  placed(part: Part): void;
  /** Pièce tenue rendue au bac (42ebba). */
  returned(part: Part): void;
  /** Pièce posée saisie, rangée, retournée ou étirée (4301cb). */
  touched(part: Part): void;
  /** Arrêter la machine remplace les pièces par leur copie d'avant « Démarrer » : les références suivent. */
  remap?(map: ReadonlyMap<Part, Part>): void;
}

/** Télécommande (0x16) et explosifs (0x37) vont par deux (+0x94, `links[1]`). */
function partnerOf(p: Part): Part | null {
  return (p.type === 0x16 || p.type === 0x37) && p.links[1] ? p.links[1] : null;
}

/** Les compteurs d'un tour (`0x4815c0`, `0x4815b8`, `0x4815bc`). */
export class DuelTurn implements EditGuard {
  /** `0x4815c0` : pièce prise dans le bac ce tour, pas encore posée. */
  binTaken: Part | null = null;
  /** `0x4815b8` : pièce du bac posée ce tour. */
  binPlaced: Part | null = null;
  /** `0x4815bc` : pièce de l'aire touchée ce tour. */
  fieldTouched: Part | null = null;

  reset(): void {
    this.binTaken = this.binPlaced = this.fieldTouched = null;
  }

  mayTakeFromBin(): boolean {
    return this.binPlaced === null;
  }

  /** 43013e : rien touché ce tour, ou la pièce touchée, ou la pièce du bac posée ce tour (télécommande : son partenaire aussi). */
  mayTouch(part: Part): boolean {
    const partner = partnerOf(part);
    if (this.fieldTouched === null || part === this.fieldTouched || (partner !== null && partner === this.fieldTouched)) return true;
    if (this.binPlaced === null) return false;
    return part === this.binPlaced || (partner !== null && partner === this.binPlaced);
  }

  /** 417190 : la première pièce prise dans le bac ce tour. */
  taken(part: Part): void {
    if (this.binTaken === null) this.binTaken = part;
  }

  /** 41715f : la pièce prise dans le bac est posée ; le bac est fermé jusqu'au tour suivant. */
  placed(part: Part): void {
    if (this.binPlaced === null && part === this.binTaken) {
      this.binPlaced = part;
      this.binTaken = null;
    }
  }

  /** 42ebba : la pièce prise dans le bac y retourne sans avoir été posée. */
  returned(part: Part): void {
    if (part === this.binTaken) this.binTaken = null;
  }

  /** 4301cb : la première pièce de l'aire touchée ce tour (sauf la pièce du bac posée ce tour). */
  touched(part: Part): void {
    if (this.fieldTouched === null && part !== this.binPlaced) this.fieldTouched = part;
  }

  remap(map: ReadonlyMap<Part, Part>): void {
    const to = (p: Part | null): Part | null => (p ? (map.get(p) ?? p) : null);
    this.binTaken = to(this.binTaken);
    this.binPlaced = to(this.binPlaced);
    this.fieldTouched = to(this.fieldTouched);
  }
}

// ------------------------------------------------------------------ match

/** Ce que dit la fin d'une manche (419803 en mode 2). */
export type DuelOutcome =
  /** Match gagné par `winner` : 31120, Rejouer / Affronter. */
  | { kind: "match"; winner: Player }
  /** Balle de match (41d827) : `leader` n'a plus besoin que d'une victoire (2154, adressé à l'autre), ou égalité (`null`, 2155). */
  | { kind: "matchPoint"; winner: Player; leader: Player | null }
  /** Manche gagnée : 31117, Rejouer / Suivant. */
  | { kind: "game"; winner: Player };

/** Fond de l'aire pendant le tour d'un joueur (4331a9 : `[0x481394]` = 12 pour le joueur 1, 9 pour le joueur 2). */
export const TURN_BACKGROUND: readonly [number, number] = [12, 9];

export class Duel {
  readonly settings: DuelSettings;
  /** `[0x4815d4]` : joueur dont c'est le tour. */
  turn: Player = 0;
  /** `[0x4815c8]`, `[0x4815cc]` : manches gagnées. */
  readonly wins: [number, number] = [0, 0];
  /** Temps restant du tour, en millisecondes (`[0x4815d8]` − maintenant). */
  remaining: number;
  /** Le tour a commencé (message « c'est votre tour » fermé) ; avant, le temps ne court pas. */
  started = false;
  readonly round = new DuelTurn();

  constructor(settings: DuelSettings) {
    this.settings = { games: settings.games, times: [settings.times[0], settings.times[1]], names: [settings.names[0], settings.names[1]] };
    this.remaining = this.settings.times[0];
  }

  name(player: Player = this.turn): string {
    return this.settings.names[player];
  }

  /** Manches qu'il faut pour gagner le match. */
  get needed(): number {
    return (this.settings.games >> 1) + 1;
  }

  /** Le temps du tour est écoulé (4330d0 : maintenant ≥ échéance). */
  get expired(): boolean {
    return this.started && this.remaining <= 0;
  }

  /** Le temps passe (`ms` écoulées) ; borné à 0 comme l'affichage (414a1a). */
  advance(ms: number): void {
    if (!this.started || ms <= 0) return;
    this.remaining = Math.max(0, this.remaining - ms);
  }

  /** « Terminer le Tour » (418e70) : l'échéance est maintenant. */
  endTurnNow(): void {
    if (this.started) this.remaining = 0;
  }

  /** Le tour passe à l'autre joueur (4331a9 … 433188) ; il commencera à la fermeture du message. */
  switchTurn(): void {
    this.turn = this.turn === 0 ? 1 : 0;
    this.prepareTurn();
  }

  /** Tour préparé pour le joueur courant (nouvelle manche, ou après `switchTurn`) : compteurs à zéro, temps plein, à l'arrêt. */
  prepareTurn(): void {
    this.round.reset();
    this.remaining = this.settings.times[this.turn];
    this.started = false;
  }

  /** Message fermé : le temps du joueur repart de son plein (433208 : échéance recalculée après GENERIC). */
  startTurn(): void {
    this.remaining = this.settings.times[this.turn];
    this.started = true;
  }

  /** La machine a résolu le puzzle pendant le tour de `turn` (41993b) : manche comptée, ce qu'il faut dire. */
  solved(): DuelOutcome {
    const winner = this.turn;
    this.wins[winner]++;
    this.started = false;
    const [a, b] = this.wins;
    const need = this.needed;
    if (a + b >= this.settings.games || a >= need || b >= need) {
      // 419a8c : le vainqueur du match devient le joueur courant (son nom va dans 31120).
      this.turn = b > a ? 1 : 0;
      return { kind: "match", winner: this.turn };
    }
    // 41d827(1) puis 41d827(0) : égalité (2155) ou un joueur à une victoire du match (2154, adressé à l'autre).
    if (a + 1 === need) return { kind: "matchPoint", winner, leader: a === b ? null : 0 };
    if (b + 1 === need) return { kind: "matchPoint", winner, leader: a === b ? null : 1 };
    return { kind: "game", winner };
  }

  get over(): boolean {
    const [a, b] = this.wins;
    return a + b >= this.settings.games || a >= this.needed || b >= this.needed;
  }
}

// ------------------------------------------------------------------ puzzles

/**
 * 42cbad(5) : puzzle de la manche suivante. À partir du puzzle en cours (le premier puzzle à deux joueurs s'il n'en est pas un), le
 * premier non résolu jusqu'à la fin de la catégorie, puis depuis son début ; tous résolus : un puzzle tiré au hasard (`random`
 * entier, 4520a4), autre que celui en cours (4231bc, 419b3f).
 */
export function nextDuelPuzzle(list: readonly PuzzleRef[], current: PuzzleRef | null, isSolved: (name: string) => boolean, random: () => number): PuzzleRef {
  const at = current ? list.findIndex((p) => p.name === current.name) : -1;
  const from = Math.max(0, at);
  const ordered = [...list.slice(from), ...list.slice(0, from)];
  const open = ordered.find((p) => !isSolved(p.name));
  if (open) return open;
  if (list.length < 2) return list[0]!;
  for (;;) {
    const i = Math.abs(Math.trunc(random())) % list.length;
    if (i !== at) return list[i]!;
  }
}
