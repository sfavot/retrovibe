import type { MsvcRandom } from "../../../engine/mohawk/rng";
import { ScreenId } from "../engine/scene";
import {
  type GameDate,
  type BridgeRuleMemory,
  type GameState,
  type GroupBuffer,
  type Monument,
  type Session,
  type Zoombini,
  DIALOG_SCREENS,
  GROUP_CAPACITY,
  MAX_LEVEL,
  aliveCount,
  emptyGroup,
  newGame,
} from "./state";
import { collectGroup, trainingGroup } from "./team";

/**
 * Règles du parcours hors épreuves (`docs/zoombinis/screens.md` §1.2, §1.3, §1.5, §1.6, §3.1 à §3.4 ; `engine.md` §2.2, §2.4) : changement d'écran,
 * transitions, progression des étapes, sortie d'épreuve, carte, entraînement. Fonctions pures sur `GameState` et `Session`, sans rendu ni hasard
 * (sauf `leaveMap` en entraînement, qui reçoit son `MsvcRandom`). Aucun texte.
 */

const S = ScreenId;

/** Premier et dernier écran d'épreuve (`1108:02f9` : `6 < écran < 0x13`). */
export const FIRST_PUZZLE = 7;
export const LAST_PUZZLE = 18;
/** Dernières épreuves d'étape. */
export const STAGE_FINALS: readonly number[] = [S.pizza, S.slides, S.net, S.maze2];

export function isPuzzleScreen(screen: number): boolean {
  return screen >= FIRST_PUZZLE && screen <= LAST_PUZZLE;
}

/**
 * `1108:02f9` : étape (1 à 4) d'un écran d'épreuve, `((écran − 7) / 3 & 3) + 1` ; `last` pour 9, 12, 15 et 18. Étape 0 hors épreuve.
 * (Dans la partie, l'étape 2 est le chemin A du camp 1 au camp 2 : bac, têtards, fosse ; l'étape 3 le chemin B : nizibooms, hôtel, muraille.)
 */
export function stageOf(screen: number): { stage: number; last: boolean } {
  if (!isPuzzleScreen(screen)) return { stage: 0, last: false };
  return { stage: (Math.trunc((screen - FIRST_PUZZLE) / 3) & 3) + 1, last: STAGE_FINALS.includes(screen) };
}

/**
 * `1168:515d` : niveau courant (0 à 3). En entraînement, `[96f2] − 1`. En aventure, le niveau de l'étape de l'écran (`S+0xC2 + 2 × (étape − 1)`).
 * Hors épreuve (carte, camps, ville, `XFER`…) le jeu appelle un rappel par écran (table `DS:5206`, non extraite) : renvoie 0 ici, **point ouvert**. `XFER` appelle ce niveau avec l'écran de destination (`11b0:00c4`).
 */
export function currentLevel(game: GameState, session: Session, screen: number = session.screen): number {
  if (session.training >= 1 && session.training <= 4) return session.training - 1;
  const { stage } = stageOf(screen);
  return stage === 0 ? 0 : game.levels[stage - 1]!;
}

/** Index de l'écran dans la mémoire de dialogue (`S+0x28 + 2 × k`), −1 s'il n'en a pas. */
export function dialogMemoryIndex(screen: number): number {
  return DIALOG_SCREENS.indexOf(screen);
}

// --- Transitions (`XFER`) ---

/** Les 16 trajets (`engine.md` §2.4) : `[départ, arrivée]`, numéro = indice + 1. */
export const TRANSFER_ROUTES: readonly (readonly [number, number])[] = [
  [S.picker, S.bridge],
  [S.bridge, S.tunnels],
  [S.tunnels, S.pizza],
  [S.pizza, S.baseCamp],
  [S.baseCamp, S.ferry],
  [S.ferry, S.lilly],
  [S.lilly, S.slides],
  [S.slides, S.bcTwo],
  [S.baseCamp, S.fleens],
  [S.fleens, S.hotel],
  [S.hotel, S.net],
  [S.net, S.bcTwo],
  [S.bcTwo, S.caves],
  [S.caves, S.smoke],
  [S.smoke, S.maze2],
  [S.maze2, S.town],
];

/** Jeu de décors de chaque trajet (`DS:ad26`, 0 à 5 : début, étape 1, 2, 3, 4, ville), `engine.md` §2.4. */
export const TRANSFER_REGION: readonly number[] = [0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5];

/** Numéro de trajet (1 à 16, `DS:4180`) de `(départ, arrivée)`, ou null s'il n'y en a pas. */
export function transferId(from: number, to: number): number | null {
  const i = TRANSFER_ROUTES.findIndex(([a, b]) => a === from && b === to);
  return i < 0 ? null : i + 1;
}

// --- Changement d'écran (`1108:0000`) ---

export interface ScreenChange {
  /** Écran à initialiser (`[8552]` : `XFER` quand une transition est intercalée). */
  screen: number;
  /** Destination réelle derrière `XFER` (`[8558]`), sinon null. */
  target: number | null;
  /** Numéro de trajet de `XFER` (1 à 16) quand une transition est intercalée. */
  transfer: number | null;
}

/**
 * `1108:0000` : l'écran `requested` est demandé depuis `session.screen`.
 *  1. aventure : à la sortie de 9, 12, 15 ou 18 vers 4, 5, 5 ou 6, le bit `1 << niveau` du masque d'étape est posé (le niveau de `1168:515d`, moins 1 si `session.levelRaised`) ;
 *  2. transition : intercalée si l'écran quitté est 3, 4, 5 ou 7 à 18 et que la destination n'est pas la carte, sauf si les transitions sont désactivées (`S+0x0A`) ou pendant une reprise
 *     (`session.resuming`). Entraînement : jamais de transition, et toute destination autre que 3 et 0 devient la carte (sauf depuis la carte) ;
 *  3. `S+0xCA` reçoit l'écran quitté, `S+0xCC` la destination (sauf 0 et 2) ;
 *  4. aventure : `S+0x54 = 1` à l'entrée de 7, 10, 13 et 16 ; entraînement : `S+0x54 = 0`.
 * Écart : sans trajet défini pour la paire (`TRANSFER_ROUTES`), aucune transition n'est intercalée (le jeu en insérerait une quand même, cas jamais atteint).
 */
export function changeScreen(game: GameState, session: Session, requested: number): ScreenChange {
  const from = session.screen;
  let to = requested;
  let transition = false;

  if (session.training === 0) {
    let level = currentLevel(game, session, from);
    if (session.levelRaised && level !== 0) level -= 1;
    const bit = 1 << (level & 3);
    if (from === S.pizza && to === S.baseCamp) {
      session.lastFinal = from;
      game.masks.stage1 |= bit;
    } else if (from === S.slides && to === S.bcTwo) {
      session.lastFinal = from;
      game.masks.stage2 |= bit;
    } else if (from === S.net && to === S.bcTwo) {
      session.lastFinal = from;
      game.masks.stage3 |= bit;
    } else if (from === S.maze2 && to === S.town) {
      session.lastFinal = from;
      game.masks.stage4 |= bit;
    }
    if (from !== S.map && from !== S.xfer && from !== S.town && to !== S.map) {
      transition = from === S.picker || from === S.baseCamp || from === S.bcTwo || isPuzzleScreen(from);
    }
  } else if (from !== S.map && to !== S.picker && to !== S.logo) {
    to = S.map;
  }

  game.previousScreen = from;
  if (to !== S.logo && to !== S.xfer) game.resumeScreen = to;
  session.previous = from;
  if (session.resuming || game.options.transitionsOff) transition = false;
  const transfer = transition ? transferId(from, to) : null;
  if (transfer === null) transition = false;

  session.screen = transition ? S.xfer : to;
  session.finalTarget = transition ? to : -1;
  session.leftToMap = false;
  // `[970a]` est consommé par l'initialisation de l'écran d'arrivée (`1168:2505`, `1128:006d`, `1188:0128`) ; la carte et le logo ne le consomment pas.
  if (session.screen !== S.map && session.screen !== S.logo) session.resuming = false;
  if (session.training === 0) {
    if (session.screen === S.bridge || session.screen === S.ferry || session.screen === S.fleens || session.screen === S.caves) game.stageUnbroken = true;
  } else {
    game.stageUnbroken = false;
  }
  return { screen: session.screen, target: transition ? to : null, transfer };
}

/**
 * Écran de reprise après le logo (`1160:0521`) : `S+0xCC` s'il vaut 1, 3, 4, 5 ou 6, ou si c'est une épreuve (7 à 18) et que le groupe courant n'est pas vide
 * (`session.resuming` est alors levé, comme `[970a]`) ; sinon 3 (choix des Zoombinis). Une partie neuve (`S+0xCC = −1`) arrive donc au choix.
 */
export function resumeScreen(game: GameState, session: Session): number {
  const r = game.resumeScreen;
  const direct = r === S.map || r === S.picker || r === S.baseCamp || r === S.bcTwo || r === S.town;
  if (direct || (isPuzzleScreen(r) && game.group.members.length > 0)) {
    session.resuming = true;
    return r;
  }
  return S.picker;
}

/**
 * « Nouvelle partie » en cours de jeu (`11a0:425e` → `11a0:416c`) : renvoie une partie neuve, `S+0xCA = 3`, la partie courante redevient anonyme (`ZBUser`), l'entraînement s'arrête,
 * pas de transition (`[970a] = 1`). Destination : la carte si on y était, sinon le choix des Zoombinis. Le nouvel état remplace l'ancien (l'appelant le range).
 */
export function newGameInPlay(session: Session): { game: GameState; screen: number } {
  const game = newGame();
  game.resumeScreen = session.screen;
  game.previousScreen = S.picker;
  session.name = null;
  session.training = 0;
  session.levelRaised = false;
  session.leftToMap = false;
  session.resuming = true;
  return { game, screen: session.screen === S.map ? S.map : S.picker };
}

// --- Suites d'épreuves (`[8556]`) ---

export type Outcome = "success" | "failure";

const PUZZLE_NEXT: Readonly<Record<number, number>> = {
  [S.bridge]: S.tunnels,
  [S.tunnels]: S.pizza,
  [S.pizza]: S.baseCamp,
  [S.ferry]: S.lilly,
  [S.lilly]: S.slides,
  [S.slides]: S.bcTwo,
  [S.fleens]: S.hotel,
  [S.hotel]: S.net,
  [S.net]: S.bcTwo,
  [S.caves]: S.smoke,
  [S.smoke]: S.maze2,
  [S.maze2]: S.town,
};

/**
 * Écran suivant demandé par un écran du parcours (`[8556]`, `screens.md` §3.1) : l'écran suivant de la chaîne en cas de réussite, la carte (1) en cas d'échec ou d'abandon.
 * Choix des Zoombinis (3) → 7 ; camp 1 (4) → 10 (chemin A) ou 13 (chemin B) ; camp 2 (5) → 16 ; Zoombiniville (6) → carte. `path` est obligatoire au camp 1.
 */
export function nextScreen(screen: number, outcome: Outcome, path?: "A" | "B"): number {
  if (outcome === "failure") return S.map;
  if (screen === S.picker) return S.bridge;
  if (screen === S.baseCamp) {
    if (!path) throw new Error("nextScreen : le camp 1 mène à deux chemins, `path` est requis");
    return path === "A" ? S.ferry : S.fleens;
  }
  if (screen === S.bcTwo) return S.caves;
  if (screen === S.town) return S.map;
  const next = PUZZLE_NEXT[screen];
  if (next === undefined) throw new Error(`nextScreen : écran ${screen} sans suite`);
  return next;
}

// --- Sortie d'épreuve (`1168:36e1`) ---

export interface PuzzleExit {
  /** Étape de l'épreuve (0 hors épreuve). */
  stage: number;
  /** Survivants et perdus. */
  survivors: number;
  lost: number;
  /** Monument ajouté (null si aucun). */
  monument: Monument | null;
  /** Le niveau de l'étape a augmenté (`[9700]`). */
  levelRaised: boolean;
}

/**
 * `1168:36e1(0, toMap)` : sortie d'un écran avec le groupe `party` de la scène (`present` faux = perdu pendant l'épreuve). Ne fait rien si `session.leftToMap` (`[a406]`).
 *  - le groupe est recopié dans le tampon, survivants d'abord (`collectGroup`) ;
 *  - épreuve (7 à 18) : le bit `1 << niveau` est posé dans `successes[écran − 7]` (le niveau de l'étape, `S+0xC2`, même en entraînement) ;
 *  - aucun perdu, étape faite d'une traite (`S+0x54`) : bit `0x10 << niveau` ; dernière épreuve de l'étape : monument (étape, niveau + 1) avec la date fournie, sauf s'il existe déjà,
 *    puis niveau de l'étape + 1 (3 au plus) et `session.levelRaised` ;
 *  - perdus : rendus au dernier arrêt de l'étape (étape 1 : réserve du choix ; 2 et 3 : camp 1, `S+0x4A` augmente ; 4 : camp 2, `S+0x4C` augmente) ; la réserve est d'abord purgée de
 *    ses membres présents si son drapeau le demande, les perdus y sont ajoutés (présents) ; `S+0x54` est effacé ; le groupe courant ne garde que les survivants ;
 *  - `toMap` (retour à la carte) en entraînement : le groupe est simplement vidé.
 * Écart : le garde-fou `[22e8]` de l'original est `session.quitting`. Les identifiants de fiche ne sont pas recopiés dans les réserves (comme l'original).
 */
export function exitPuzzle(game: GameState, session: Session, screen: number, party: readonly Zoombini[], date: GameDate, toMap = false): PuzzleExit {
  const result: PuzzleExit = { stage: 0, survivors: 0, lost: 0, monument: null, levelRaised: false };
  if (session.leftToMap) return result;
  if (session.training !== 0 && toMap) {
    game.group = emptyGroup(true, true);
    return result;
  }
  collectGroup(game, party);
  session.levelRaised = false;
  const alive = aliveCount(game.group);
  const lost = game.group.members.length - alive;
  result.survivors = alive;
  result.lost = lost;
  const { stage, last } = stageOf(screen);
  result.stage = stage;
  if (stage === 0) return result;

  const level = game.levels[stage - 1]!;
  game.successes[screen - FIRST_PUZZLE]! |= 1 << level;
  if (lost === 0) {
    if (game.stageUnbroken && !session.quitting) {
      game.successes[screen - FIRST_PUZZLE]! |= 0x10 << level;
      const exists = game.monuments.some((m) => m !== null && m.stage === stage && m.level === level + 1);
      if (last && !exists) {
        const slot = game.monuments.findIndex((m) => m === null);
        if (slot >= 0) {
          const monument: Monument = { stage, level: level + 1, year: date.year, month: date.month, day: date.day };
          game.monuments[slot] = monument;
          result.monument = monument;
        }
      }
      if (last && level < MAX_LEVEL) {
        game.levels[stage - 1] = level + 1;
        session.levelRaised = true;
        result.levelRaised = true;
      }
    }
    return result;
  }

  let reserve: GroupBuffer;
  if (stage === 1) reserve = game.pickerGroup;
  else if (stage === 4) {
    reserve = game.camp2Group;
    game.counters.camp2 += lost;
  } else {
    reserve = game.camp1Group;
    game.counters.camp1 += lost;
  }
  if (reserve.flagA) reserve.members = reserve.members.filter((m) => !m.present);
  reserve.flagA = false;
  reserve.flagB = false;
  let pos = reserve.members.findIndex((m) => !m.present);
  if (pos < 0) pos = reserve.members.length;
  for (const z of game.group.members.slice(alive, alive + lost)) {
    if (reserve.members.length >= GROUP_CAPACITY || pos >= GROUP_CAPACITY) break;
    reserve.members[pos] = { attrs: [...z.attrs], id: 0, present: true, state: z.state.slice() };
    pos += 1;
  }
  game.stageUnbroken = false;
  game.group.members = game.group.members.slice(0, alive);
  return result;
}

// --- Carte (écran 1, `1110:*`) ---

/** Écran de chacun des 16 lieux (numéro de lieu 1 à 16, `1110:0819`) : Zoombinîle, 3 épreuves, camp 1, 3 épreuves, 3 épreuves, camp 2, 3 épreuves, Zoombiniville. */
export const MAP_PLACE_SCREEN: readonly number[] = [3, 7, 8, 9, 4, 10, 11, 12, 13, 14, 15, 5, 16, 17, 18, 6];

/**
 * `1110:1c75` : activation et variante d'icône des lieux (17 octets ; 0 = lieu non affiché, sinon `valeur − 1` = variante d'icône, `1110:1601`).
 * Indice 0 à 15 = lieu − 1 ; l'indice 16 est la valeur supplémentaire de l'étape 3 (camp 2 par le chemin B, `(S+0x52 & 0xF0) >> 4`).
 * Entraînement : tout vaut `[96f2]`. Aventure : par étape, au niveau 0 le masque de ses niveaux réussis (épreuves : 4 bits bas de `S+0x56…`, arrivée : masque d'étape),
 * à partir du niveau 1 tout vaut niveau + 1.
 */
export function placeActivation(game: GameState, session: Session): number[] {
  if (session.training !== 0) return new Array<number>(17).fill(session.training);
  const a = new Array<number>(17).fill(0);
  a[0] = 1;
  const stages: { places: number[]; first: number; arrival: number; mask: number }[] = [
    { places: [1, 2, 3], first: 0, arrival: 4, mask: game.masks.stage1 },
    { places: [5, 6, 7], first: 3, arrival: 11, mask: game.masks.stage2 },
    { places: [8, 9, 10], first: 6, arrival: 16, mask: game.masks.stage3 },
    { places: [12, 13, 14], first: 9, arrival: 15, mask: game.masks.stage4 },
  ];
  stages.forEach((st, i) => {
    const level = game.levels[i]!;
    if (level === 0) {
      st.places.forEach((p, k) => {
        a[p] = game.successes[st.first + k]! & 0xf;
      });
      a[st.arrival] = st.mask & 0xf;
    } else {
      for (const p of st.places) a[p] = level + 1;
      a[st.arrival] = level + 1;
    }
  });
  return a;
}

export interface MapClick {
  /** Écran demandé. */
  screen: number;
  /** L'entraînement s'arrête (`1110:0dd4`) : à appliquer par `leaveTraining`. */
  leaveTraining: boolean;
}

/**
 * Clic sur le lieu `place` (1 à 16, `1110:0819`). Aventure : seuls Zoombinîle (1), l'abri du rocher (5, étape 1 terminée), l'aire de grozarbre (12, étape 2 ou 3 terminée) et
 * Zoombiniville (16, étape 4 terminée) répondent. Entraînement : tous les lieux d'épreuve répondent ; Zoombinîle quitte l'entraînement ; les camps et la ville quittent l'entraînement
 * s'ils sont atteints dans la partie, sinon rien. Les lieux 8 et 9 mènent aux écrans cachés 20 / 19 derrière un code secret : non portés (toujours 12 et 13).
 */
export function mapClick(game: GameState, session: Session, place: number): MapClick | null {
  const screen = MAP_PLACE_SCREEN[place - 1];
  if (screen === undefined) return null;
  const training = session.training !== 0;
  if (place === 1) return { screen, leaveTraining: training };
  let reached: number | null = null;
  if (place === 5) reached = game.masks.stage1 & 0xf;
  else if (place === 12) reached = game.masks.stage2 | (game.masks.stage3 << 4);
  else if (place === 16) reached = game.masks.stage4 & 0xf;
  if (reached !== null) return reached !== 0 ? { screen, leaveTraining: training } : null;
  return training ? { screen, leaveTraining: false } : null;
}

/** Entrée en entraînement au niveau 0 à 3 (`Maj` = niveau 0, touches `1` à `4`, `1110:0ab4`) : `[96f2] = niveau + 1`. */
export function enterTraining(session: Session, level: number): void {
  if (!Number.isInteger(level) || level < 0 || level > 3) throw new RangeError(`enterTraining : niveau ${level} hors de 0 à 3`);
  session.training = level + 1;
}

/*
 * Règle des gorges laissée pour les grottes (`DS:96ec` candidate, `DS:96f0` effectif) : variables du programme, hors du tampon de partie `S` (adresses
 * de la zone de données, jamais écrites par la sauvegarde) ; gardées dans la session (`session.bridgeRule`).
 */

/** Écrit la mémoire du niveau 0 : `10c0:131a` la remet à 0 à chaque tirage puis la renseigne au niveau 0 si une seule candidate avait l'effectif retenu (`null` sinon). */
export function setBridgeMemory(session: Session, memory: BridgeRuleMemory | null): void {
  session.bridgeRule = memory;
}

/**
 * Effectif à éviter au niveau 0 des grottes (`avoidCount` de `drawRules`, `1190:2748`) : `DS:96f0` quand `DS:96ec` et `DS:96f0` sont non nuls, sinon 0.
 * `1190:0000` remet les deux à 0 en entraînement (`DS:96f2 ≠ 0`) : la mémoire est alors effacée et rien n'est évité.
 */
export function bridgeAvoidCount(session: Session): number {
  if (session.training !== 0) session.bridgeRule = null;
  const memory = session.bridgeRule;
  return memory && memory.candidate !== 0 && memory.count !== 0 ? memory.count : 0;
}

/** `1110:0dd4` : retour en aventure. */
export function leaveTraining(session: Session): void {
  session.training = 0;
}

/**
 * Sortie de la carte (`1110:03b8`). Aventure : le groupe courant est abandonné (« ce groupe de zoombinis sera perdu si tu retournes à la carte ») et les sorties d'écran
 * ne le recopient plus (`session.leftToMap`). Entraînement : un groupe de 16 Zoombinis aux attributs tirés au hasard est créé (rien n'est écrit dans la partie).
 */
export function leaveMap(game: GameState, session: Session, rng: MsvcRandom): void {
  if (session.training === 0) {
    if (!session.leftToMap) {
      session.leftToMap = true;
      game.group = emptyGroup(true, true);
    }
  } else {
    game.group = trainingGroup(rng);
  }
}
