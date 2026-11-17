import { SQUARE_COUNT, type ExeTables } from "../data/exe";
import { MAX_SESTERCES, OBELIX, SQUARE, createPlayer, type GameState, type Player, type Session } from "./state";

/**
 * Règles du plateau d'Astérix (`docs/asterix/engine.md` §8 à §11), sans rendu : tirages, déplacements et tests, d'après
 * le désassemblage de `ASTERIX.EXE`. Chaque fonction cite l'adresse du code qu'elle reproduit.
 *
 * Aléatoire (`1a93:00cb`, §6) : `rnd()` rend un entier de 15 bits ; le jeu n'écrit que `rnd() % n` et `rnd() & masque`.
 * L'original mêle l'horloge à chaque tirage, donc aucune suite n'y est reproductible : seules les lois sont reprises, et
 * le générateur est injecté (graine fixe dans les tests).
 */
export type Rnd = () => number;

/** `pos ± 1` modulo 54. */
export function step(pos: number, delta: number): number {
  return (((pos + delta) % SQUARE_COUNT) + SQUARE_COUNT) % SQUARE_COUNT;
}

/**
 * `1abf:13e5` : remise à zéro du début de partie (§8.3). `replay` = REJOUER (`DS:64ad`). Sans partie préalable
 * (`DS:1a02`), la configuration devient un joueur, Astérix, niveaux moyens, et REJOUER la reprend avec la durée et les
 * objets de l'image (120 minutes, 9 objets).
 */
export function initGame(session: Session, rnd: Rnd, replay: boolean): GameState {
  let players: Player[] = [];
  if (session.noGameYet) {
    session.saved = {
      players: [{ character: 0, reflexion: 1, action: 1 }],
      duration: session.saved.duration,
      objectsRequired: session.saved.objectsRequired,
    };
    players = [createPlayer(0, 1, 1)];
  } else if (replay) {
    players = session.saved.players.map((p) => createPlayer(p.character, p.reflexion, p.action));
    session.duration = session.saved.duration;
    session.objectsRequired = session.saved.objectsRequired;
  }
  return {
    players,
    current: 0,
    round: 1,
    duration: session.duration,
    objectsRequired: session.objectsRequired,
    die: (rnd() % 6) + 1,
    elapsedRead: 0,
    topRow: 0,
    bettor: -1,
    bet: 0,
    winner: 0,
    abandoned: false,
    quit: false,
    victory: false,
    over: false,
    lastRound: false,
    beforeFirstRound: true,
    replay,
    intro: true,
  };
}

/** `1abf:2431` : la configuration est gardée pour REJOUER (hors démo et hors REJOUER), après les réglages. */
export function saveSetup(session: Session, state: GameState): void {
  session.saved = {
    players: state.players.map(({ character, reflexion, action }) => ({ character, reflexion, action })),
    duration: state.duration,
    objectsRequired: state.objectsRequired,
  };
}

/** `1abf:1f3e` : nombre d'objets proposé pour une durée (indices 0..3 de la table `DS:201a`). */
export function proposedObjects(tables: ExeTables, players: number, durationIndex: number): number {
  return tables.objectsByDuration[players - 1][durationIndex];
}

/**
 * `1abf:0cde` : le premier joueur (dans l'ordre des indices) qui a tous ses objets et se trouve sur la bande du village
 * (cases 1 à 3) gagne. Le test porte sur tous les joueurs, pas seulement le joueur courant.
 */
export function testVictory(state: GameState): boolean {
  for (let j = 0; j < state.players.length; j++) {
    const player = state.players[j];
    if (player.objectCount >= state.objectsRequired && Math.floor(player.pos / 3) === 0) {
      state.winner = j;
      state.victory = true;
      state.over = true;
      return true;
    }
  }
  return false;
}

/** `1d24:0912` : variation de sesterces bornée à 0..99 ; rend la variation réellement appliquée (un tintement par pièce). */
export function addSesterces(player: Player, delta: number): number {
  const applied = Math.max(-player.sesterces, Math.min(MAX_SESTERCES - player.sesterces, delta)) || 0;
  player.sesterces += applied;
  return applied;
}

/**
 * `1abf:0f99` : voix d'annonce du tour (`K61TE{v + 1}`), ou −1 quand il n'y en a pas (solo, ou prisonnier qui a une
 * gourde : la question de la prison vient tout de suite). Le tirage est refait tant que la voix est à moins de 6 de la
 * précédente (`DS:1ff4`).
 */
export function announceVoice(state: GameState, session: Session, rnd: Rnd): number {
  const player = state.players[state.current];
  if (state.players.length < 2 || (player.inPrison && player.gourds !== 0)) return -1;
  let voice: number;
  do {
    if (state.round < 3) voice = player.character + 5 + (rnd() % 6) * 6;
    else if ((rnd() & 7) === 0) voice = rnd() % 5;
    else voice = player.character + 5 + (rnd() & 15) * 6;
  } while (Math.abs(voice - session.lastAnnounce) < 6);
  session.lastAnnounce = voice;
  return voice;
}

/** Pièges (`20fa:0f38`, table `20fa:1198`) : module de la vidéo et première position de l'intervalle de destination. */
const TRAPS: readonly { module: number; base: number; fixed?: boolean }[] = [
  { module: 15, base: 33, fixed: true },
  { module: 17, base: 21 },
  { module: 18, base: 6 },
  { module: 19, base: 12 },
  { module: 14, base: 45 },
  { module: 16, base: 33 },
];

/**
 * `20fa:0f38` : destination d'un piège. Le piège de la forêt mène toujours à la case 34 ; les autres tirent
 * `rnd() % 9 + base`, refait tant que la destination est elle-même un piège. `null` si `pos` n'est pas un piège.
 */
export function trapDestination(tables: ExeTables, pos: number, rnd: Rnd): { module: number; destination: number } | null {
  const trap = TRAPS[tables.trapPositions.indexOf(pos)];
  if (!trap) return null;
  if (trap.fixed) return { module: trap.module, destination: trap.base };
  let destination: number;
  do destination = (rnd() % 9) + trap.base;
  while (tables.board[destination] === SQUARE.trap);
  return { module: trap.module, destination };
}

/** Issue d'une case repos (`20fa:05e9`). */
export type RestOutcome = "halt" | "brigands" | "loserGame" | "winnerGame";

/**
 * `20fa:05e9` : un seul tirage, `rnd() % 5` en solo et `rnd() % 5 + 2` à plusieurs. 0 à 3 : halte ; 4 : halte puis
 * brigands (s'il y a au moins un sesterce à prendre) ; 5 : jeu « perdant », qui devient « gagnant » si quelqu'un est
 * déjà en prison ; 6 : jeu « gagnant ».
 */
export function restDraw(state: GameState, rnd: Rnd): RestOutcome {
  const t = state.players.length < 2 ? rnd() % 5 : (rnd() % 5) + 2;
  if (t < 4) return "halt";
  if (t === 4) return "brigands";
  if (t === 5 && !state.players.some((p) => p.inPrison)) return "loserGame";
  return "winnerGame";
}

/**
 * Recule case par case jusqu'à la première prison (jeu « perdant », Détritus) : les positions traversées, la dernière
 * étant la prison. Au moins un pas (`do … while` de `20fa:05e9` et `288f:000f`).
 */
export function pathToPrison(tables: ExeTables, pos: number): number[] {
  const path: number[] = [];
  do {
    pos = step(pos, -1);
    path.push(pos);
  } while (tables.board[pos] !== SQUARE.prison);
  return path;
}

/**
 * `288f:000f` : déplacement de 6 cases de Détritus, dans le sens `direction`, prolongé tant que la case d'arrivée est
 * un piège. Rend les positions traversées.
 */
export function detritusPath(tables: ExeTables, pos: number, direction: 1 | -1): number[] {
  const path: number[] = [];
  do {
    pos = step(pos, direction);
    path.push(pos);
  } while (path.length < 6 || tables.board[pos] === SQUARE.trap);
  return path;
}

/** Tours de Détritus : 0 potion, 1 prison, 2 recule de 6, 3 avance de 6. */
export interface DetritusDraw {
  /** Vrai : le joueur courant désigne une victime (3 ou 4 joueurs, hors surprise). */
  chooseVictim: boolean;
  trick: number;
}

/**
 * `288f:000f` : tirage du tour de Détritus. `rnd() & 3`, retiré tant qu'il égale le tour précédent (`DS:7592`), puis
 * substitutions selon le mode. C'est le tirage d'avant substitution qui est mémorisé.
 */
export function detritusDraw(state: GameState, session: Session, rnd: Rnd, onSelf: boolean): DetritusDraw {
  const player = state.players[state.current];
  const chooseVictim = state.players.length > 2 && !onSelf;
  let drawn: number;
  do drawn = rnd() & 3;
  while (drawn === session.lastDetritus);
  session.lastDetritus = drawn;
  let trick = drawn;
  if (chooseVictim) {
    if (trick === 0) {
      const othersDry = state.players.some((p, j) => j !== state.current && p.gourds === 0);
      if (player.character === OBELIX || player.gourds === 5 || othersDry) trick = 1;
    }
    if (trick === 1) {
      // Un tirage par joueur en prison (boucle de `288f:03ba`) : le dernier l'emporte.
      for (const p of state.players) if (p.inPrison) trick = (rnd() & 1) + 2;
    }
  } else {
    if (trick === 0 && (player.gourds === 0 || player.character === OBELIX)) trick = 1;
    if (trick === 1 && player.inPrison) trick = (rnd() & 1) + 2;
  }
  return { chooseVictim, trick };
}

/** Tirage de la surprise acceptée (`20fa:231b`). */
export type SurpriseOutcome = "detritus" | "gourd" | "sesterces" | "spy";

/**
 * `20fa:231b` : une fois sur deux Détritus « sur soi » ; sinon `rnd() % 3` : gourde (si moins de 5 et pas Obélix, sinon
 * sesterces), sesterces (si moins de 97, sinon espion), espion.
 */
export function surpriseDraw(player: Player, rnd: Rnd): SurpriseOutcome {
  if ((rnd() & 1) === 0) return "detritus";
  const t = rnd() % 3;
  if (t === 2) return "spy";
  if (t === 0 && player.gourds < 5 && player.character !== OBELIX) return "gourd";
  return player.sesterces > 0x60 ? "spy" : "sesterces";
}

/** Bornes des numéros de question par niveau Réflexion (`25f1:0046`) : premier numéro et nombre. */
const QUIZ_RANGES: readonly (readonly [number, number])[] = [
  [1, 30],
  [31, 40],
  [71, 29],
];

/**
 * `25f1:0046` : numéro de la question (1..99) pour un niveau et un pays, retiré tant qu'il égale la dernière question
 * tirée pour ce pays et ce niveau (`DS:7182`, commune à tous les joueurs).
 */
export function quizNumber(session: Session, level: number, country: number, rnd: Rnd): number {
  const [first, count] = QUIZ_RANGES[level];
  const slot = country * 3 + level;
  let n: number;
  do n = (rnd() % count) + first;
  while (session.lastQuestion[slot] === n);
  session.lastQuestion[slot] = n;
  return n;
}

/** `25f1:042d` : ordre des trois réponses, une permutation tirée par rejets successifs. */
export function quizOrder(rnd: Rnd): [number, number, number] {
  const a = rnd() % 3;
  let b: number;
  do b = rnd() % 3;
  while (b === a);
  let c: number;
  do c = rnd() % 3;
  while (c === a || c === b);
  return [a, b, c];
}

/** `25f1:042d` : voix d'accueil du quiz (`K60TE{n + 1}`) selon l'objet du pays, le compte d'objets et le dernier tour. */
export function quizWelcomeVoice(state: GameState, country: number, rnd: Rnd): number {
  const player = state.players[state.current];
  const missing = !player.objects[country];
  if (missing && player.objectCount === state.objectsRequired - 1 && (!state.lastRound || country === 0)) return 0x33;
  if (missing && player.objectCount < state.objectsRequired && rnd() % 3 === 0 && !state.lastRound) return (rnd() & 1) + 0x31;
  if ((rnd() & 1) === 0) {
    const base = country * 2 + 0x34;
    return base + (rnd() & 1);
  }
  return (missing ? rnd() & 3 : (rnd() & 1) << 1) + 0x2d;
}

/** Commentaire de Panoramix sur l'écran de score : une voix `K63TE{voice + 1}` ou une vidéo `M42A{'A' + video}`. */
export interface ScoreComment {
  voice: number;
  video: number;
}

/**
 * `1d24:112b` : choix du commentaire de l'écran de score (§9.11), −1 quand il n'y en a pas. `elapsed` : secondes de
 * partie écoulées (chrono 1), rangées dans `DS:6491`.
 */
export function scoreComment(state: GameState, session: Session, rnd: Rnd, elapsed: number): ScoreComment {
  const comment: ScoreComment = { voice: -1, video: -1 };
  const count = state.players.length;
  state.elapsedRead = elapsed;
  if (state.intro && state.round === 1 && state.current === 0) {
    // Présentation de début de partie, une seule fois.
    state.intro = false;
    if (!session.noGameYet && state.replay) {
      if (state.beforeFirstRound) comment.voice = count === 1 ? 0xc : (rnd() % 3) + 0xd;
    } else {
      // Table `1d24:150d` : une vidéo par durée.
      const byDuration: Record<number, number> = { 1800: 1, 3600: 2, 5400: 3, 7200: count < 2 ? 10 : 4 };
      comment.video = byDuration[state.duration] ?? -1;
    }
    return comment;
  }
  if (state.lastRound && state.current === 0) {
    comment.video = (rnd() % 3) + 7;
    return comment;
  }
  if (elapsed - session.lastComment <= 0x168) return comment;
  const remaining = state.duration - elapsed;
  if (state.duration >= 0x709 && remaining <= 0x77f && remaining >= 0x691) {
    comment.video = 5;
  } else if (remaining < 0x3fc && remaining > 0x30c) {
    comment.video = 6;
  } else if ((rnd() & 1) === 0 && count !== 1) {
    // Remarque sur le classement : meneur `leader` et dernier `last` par nombre d'objets, avec leurs ex æquo.
    const required = state.objectsRequired;
    const players = state.players;
    let leader = 0;
    let last = 0;
    let leaders = 0;
    let lasts = 0;
    let allEqual = true;
    for (let i = 0; i < count; i++) {
      const objects = players[i].objectCount;
      if (objects === players[leader].objectCount || objects >= required) {
        leaders++;
        if (players[i].gourds !== players[leader].gourds || players[i].sesterces !== players[leader].sesterces) allEqual = false;
      }
      if (players[leader].objectCount < objects && players[leader].objectCount < required) {
        leaders = 1;
        leader = i;
      }
      if (objects === players[last].objectCount && objects < required) lasts++;
      if (objects < players[last].objectCount && objects < required) {
        lasts = 1;
        last = i;
      }
    }
    if ((rnd() & 1) === 0 && lasts === 1) comment.voice = players[last].character + 0x19;
    else if (leaders === 1) comment.voice = players[leader].character + 0x10;
    else if (leaders === count && allEqual) comment.voice = 0x17;
    else comment.voice = (rnd() & 1) * 2 + 0x16;
  } else {
    const voice = (state.current === 0 ? rnd() & 3 : (rnd() & 1) << 1) + 0x1f;
    // Après 600 s de jeu, deux des quatre remarques sont écartées.
    comment.voice = elapsed > 600 && (voice === 0x1f || voice === 0x21) ? -1 : voice;
  }
  return comment;
}

/**
 * `1d24:161b` : remarque d'entrée du marbre de route (`K62TE{n + 1}`), le dernier test vrai l'emporte ; −1 sans
 * remarque. « Plus de 600 s » lit `DS:6491`, la dernière valeur lue des secondes, pas l'horloge.
 */
export function marbleRemark(state: GameState): number {
  const player = state.players[state.current];
  let remark = -1;
  if (player.objectCount === 0 && state.elapsedRead > 600) remark = 1;
  if (player.objectCount === 1) remark = 2;
  if (player.objectCount === state.objectsRequired - 1) remark = 0;
  if (player.gourds === 0 && player.character !== OBELIX) remark = 3;
  if (player.sesterces > 2) remark = 4;
  if (player.objectCount === state.objectsRequired) remark = 5;
  if (player.objectCount > state.objectsRequired) remark = 6;
  return remark;
}

/**
 * `1d24:0be9` : retire le joueur courant (abandon). Le pari du devin est annulé si le joueur retiré est le parieur, et
 * l'indice du parieur suit le tassement. Le joueur courant recule d'un cran, pour que l'incrément de fin de tour tombe
 * sur celui qui suivait.
 */
export function removeCurrentPlayer(state: GameState): void {
  if (state.bettor !== -1) {
    if (state.bettor === state.current) state.bettor = -1;
    else if (state.current < state.bettor) state.bettor--;
  }
  const count = state.players.length;
  state.players.splice(state.current, 1);
  state.abandoned = true;
  state.current--;
  if (state.current < 0) state.current = count - 2;
}

/** `20fa:09c7` : case interdite à l'espion (les quatre cases espion ; les cases 2 et 3 quand le joueur a tous ses objets). */
export function spyForbidden(tables: ExeTables, state: GameState, pos: number): boolean {
  if (tables.board[pos] === SQUARE.spy) return true;
  return state.players[state.current].objectCount >= state.objectsRequired && (pos === 1 || pos === 2);
}

/**
 * `20fa:09c7` : un pas du curseur de l'espion pour les directions tenues (bits 1 haut, 2 bas, 4 gauche, 8 droite). Le
 * quartet bas de `DS:2a3a[pos]` avance, le quartet haut recule, en sautant les cases interdites ; les deux tests
 * s'enchaînent comme dans l'original. Rend vrai si le pion a bougé.
 */
export function spyMove(tables: ExeTables, state: GameState, directions: number): boolean {
  const player = state.players[state.current];
  if ((directions & 0xf) === 0) return false;
  const mask = tables.spyDirections[player.pos];
  let moved = false;
  if ((directions & mask & 0xf) !== 0) {
    do player.pos = step(player.pos, 1);
    while (spyForbidden(tables, state, player.pos));
    moved = true;
  }
  if ((directions & ((mask & 0xf0) >> 4)) !== 0) {
    do player.pos = step(player.pos, -1);
    while (spyForbidden(tables, state, player.pos));
    moved = true;
  }
  return moved;
}

/** `1d24:09b9` : la position est dans les trois rangées affichées à partir de `topRow` (avec bouclage). */
export function squareVisible(topRow: number, pos: number): boolean {
  if (pos < 0) pos += SQUARE_COUNT;
  const row = Math.floor(pos / 3);
  if (row < topRow) return Math.floor((pos + SQUARE_COUNT) / 3) <= topRow + 2;
  return row <= topRow + 2;
}

/** `1d24:0a02` : rang à l'écran (0, 1 ou 2) d'une position, −1 si elle n'est pas affichée. */
export function screenRank(topRow: number, pos: number): number {
  if (!squareVisible(topRow, pos)) return -1;
  if (Math.floor((pos + SQUARE_COUNT) / 3) < topRow + 3) pos += SQUARE_COUNT;
  return Math.floor(pos / 3) - topRow;
}

/** Table `20fa:146d` : les quinze mini-jeux dans l'ordre de la table des positions (annonce, module, entrée de la vague E). */
export interface MinigameEntry {
  /** Indice de l'annonce `20fa:130f(i)` (voix `K60TE{3i + 1}` à `{3i + 3}`). */
  announce: number;
  /** Numéro du module (M22 à M36). */
  module: number;
  /** Fonction d'entrée dans `ASTERIX.EXE` et son argument éventuel. */
  entry: string;
  argument?: number;
  name: string;
}

export const MINIGAMES: readonly MinigameEntry[] = [
  { announce: 0, module: 22, entry: "2580:03b3", name: "Des poissons pas très frais" },
  { announce: 1, module: 23, entry: "275a:0052", name: "Non, tu ne chanteras pas" },
  { announce: 2, module: 24, entry: "207c:000c", name: "Des détails à la loupe" },
  { announce: 4, module: 26, entry: "1f31:0294", name: "Le brouillard" },
  { announce: 5, module: 27, entry: "2840:023a", name: "Tempête en mer du Nord" },
  { announce: 6, module: 28, entry: "24e3:0406", argument: 0, name: "Les sangliers" },
  { announce: 14, module: 36, entry: "1f84:040a", name: "Le ciel sur la tête" },
  { announce: 13, module: 35, entry: "1fe6:0043", name: "Coloriages" },
  { announce: 8, module: 30, entry: "24a1:027a", name: "Les jeux olympiques" },
  { announce: 9, module: 31, entry: "27ba:0561", name: "Le fakir" },
  { announce: 3, module: 25, entry: "1f01:0008", name: "Anachronismes" },
  { announce: 10, module: 32, entry: "26a6:0804", name: "Bagarre avec les Romains" },
  { announce: 11, module: 33, entry: "2353:0005", name: "Les hiéroglyphes de Cléopâtre" },
  { announce: 12, module: 34, entry: "23d1:09c1", argument: 1, name: "Idéfix dans la pyramide" },
  { announce: 7, module: 29, entry: "24e3:0406", argument: 1, name: "Pirates à bâbord" },
];

/** `20fa:135a` : le mini-jeu d'une position, d'après la table des positions lue dans l'exécutable. */
export function minigameAt(tables: ExeTables, pos: number): MinigameEntry | null {
  return MINIGAMES[tables.minigamePositions.indexOf(pos)] ?? null;
}

/**
 * `20fa:130f` : variante de l'annonce d'un mini-jeu (0, 1 ou 2). La première n'est entendue qu'une fois par jeu ;
 * ensuite les variantes 1 et 2 alternent (`DS:2aa6`, jamais remise à zéro).
 */
export function announceVariant(session: Session, announce: number, rnd: Rnd): number {
  const variant = session.announceVariant[announce];
  session.announceVariant[announce] = variant === 0 ? (rnd() & 1) + 1 : 3 - variant;
  return variant;
}
