import type { BorlandRandom } from "../../engine/rng";
import type { Game } from "../../game/rules";
import { hasIngredient, popcount } from "../../game/state";

/**
 * Commentaires du Grand Schtroumpf pendant la partie : `26ee:0f17` (avancement général, avant l'affichage du plateau) et
 * `26ee:027e` (réplique après l'annonce du personnage). Logique pure : elle renvoie un **code** (0 = rien) et l'appelant
 * (`scenes/game.ts`) le joue (`createGrandSchtroumpfScene({ kind: "progress" | "comment", code })`). Détail et confiance :
 * `docs/teleportaschtroumpf/screens-grand-schtroumpf.md`.
 *
 * Chaque code n'est dit qu'une fois par partie (tableau `DS:75B9`, indexé par le code) ; `Commentary` en est la mémoire, à
 * créer à chaque partie (l'original ne réinitialise jamais ses drapeaux d'une partie à l'autre : probable, voir la doc).
 */

/** Codes 1..5, 11..15… : voix `s42vNNNt.voc`. Les autres (liste ci-dessous) sont des vidéos `s42aNNN.mux`. */
const VIDEO_RANGES: readonly (readonly [number, number])[] = [
  [31, 35], // avertissements de temps
  [41, 76], // fin du temps
  [131, 138], // ingrédient manquant (jeu en prison ou au siphon)
  [171, 175], // joueur prisonnier
  [181, 181],
  [193, 196],
  [201, 204], // 0f17 : en retard
  [211, 215], // 0f17 : en avance
];

/** Le code désigne une vidéo `s42aNNN.mux` (`291e:0401` : plages 0x1f..0x23, 0x29..0x4c, 0x83..0x8a, 0xab..0xaf, 0xb5, 0xc1..0xc4). */
export function isCommentVideo(code: number): boolean {
  return VIDEO_RANGES.some(([from, to]) => code >= from && code <= to);
}

/** Ordre des ingrédients pour les répliques « il te manque » : ingrédient k → code 0x82 + `DS:27A2[k]`. */
const MISSING_VIDEO_OFFSET = [6, 2, 4, 1, 3, 8, 5, 7];
/** Ingrédient k → code 100 + `DS:2792[k]` (voix « personne ne l'a »). */
const NOBODY_VOICE_OFFSET = [0, 5, 3, 6, 2, 7, 8, 1];

/** Voix propres à chaque personnage (table `CS:26ee:0f0b` / `0eff`, indexée par le personnage) : code de base. */
const AHEAD_BASE = [0x8d, 0x9c, 0x95, 0xa0, 0x91, 0x98];
const BEHIND_BASE = [0x8f, 0x9e, 0x97, 0xa2, 0x93, 0x9a];
/** Pour ce personnage (Grognon), la réplique « en retard » n'a qu'une variante. */
const BEHIND_SINGLE = 0x97;

/** « Il manque k ingrédients » (`CS:26ee:0edb` / `0ef3`) : codes possibles pour k = 1..6, flag = premier code. */
const MISSING_COUNT_CODES: Readonly<Record<number, readonly number[]>> = {
  1: [0x74, 0x76, 0x79, 0x7f],
  2: [0x75, 0x78, 0x7e],
  3: [0x77, 0x7d],
  5: [0x73, 0x7b],
  6: [0x72, 0x7a],
};

/** Part du temps (exclue) à partir de laquelle le Grand Schtroumpf cite un ingrédient manquant (`0x14`). */
const MISSING_VIDEO_MIN_PERCENT = 0x14;

/** Avancement de chaque joueur (`26ee:027e` / `0f17`) : part d'ingrédients de l'objectif et de points, en pourcentage. */
interface Measure {
  /** Ingrédients de l'objectif possédés, par joueur. */
  owned: number[];
  points: number[];
  /** Ingrédients demandés × nombre de joueurs (l'original cumule sur tous les joueurs : défaut probable). */
  total: number;
  progress: number[];
  best: number;
}

function measure(game: Game): Measure {
  const { players, goal } = game.state;
  const required = popcount(goal.ingredients);
  const total = required * players.length;
  const owned = players.map((p) => popcount(goal.ingredients & p.ingredients));
  const points = players.map((p) => p.points);
  const progress = players.map((_, i) => (Math.floor((owned[i] * 100) / total) + Math.floor((points[i] * 100) / goal.points)) >> 1);
  return { owned, points, total, progress, best: Math.max(...progress) };
}

/**
 * Part du temps écoulé, en pour cent (`1f33:019a(0) × 100 / DS:6EA4`). L'original calcule `secondes × 100` sur 16 bits
 * (`IMUL AX,AX,0x64`), qui déborde dès 656 s de jeu et fait retomber la part : défaut corrigé ici (calcul sans
 * troncature), à la demande.
 */
export function elapsedPercent(game: Game): number {
  const { elapsed, durationSeconds } = game.state;
  return Math.floor((Math.floor(elapsed) * 100) / durationSeconds);
}

export class Commentary {
  private readonly said = new Set<number>();
  /** Tour de plateau de la dernière réplique d'avancement (`DS:28AE`) et du dernier passage dans le bloc de réplique (`DS:28B0`). */
  private lastProgressRound = 0;
  private lastCommentRound = 0;

  /**
   * `291e:0401`, début du tour, avant l'affichage : commentaire d'avancement (`26ee:0f17`) si plus de 4 tours se sont écoulés
   * depuis le dernier et que la partie en est au tour 6 au moins. L'appelant ne l'appelle pas pour un tour passé (joueur en
   * prison ou sous le siphon). Renvoie un code 201..204 ou 211..215, ou 0.
   */
  beforeTurn(game: Game, rng: BorlandRandom): number {
    const round = game.state.round;
    if (round - this.lastProgressRound <= 4 || round <= 5) return 0;
    const code = this.progressComment(game, rng);
    if (code !== 0) this.lastProgressRound = round;
    return code;
  }

  /**
   * `291e:0401`, après l'annonce du personnage : réplique du Grand Schtroumpf (`26ee:027e`). `warned` : un avertissement de
   * temps vient d'être dit (pas de réplique). `skipped` : tour passé (prison, siphon), où la réplique est toujours tentée.
   *
   * L'original ne compare le tour qu'au tour du **dernier passage** dans ce bloc (`DS:28B0`, mis à jour à chaque tour) : hors
   * tour passé, l'écart n'atteint jamais 3 et la réplique de la partie normale n'est donc pas atteignable (voir la doc).
   * Elle est reproduite quand même, telle quelle.
   */
  afterAnnouncement(game: Game, rng: BorlandRandom, options: { warned: boolean; skipped: boolean }): number {
    const round = game.state.round;
    let code = 0;
    if (options.skipped || (!options.warned && round - this.lastCommentRound > 2 && round > 4)) code = this.turnComment(game, rng, options.skipped);
    this.lastCommentRound = round;
    return code;
  }

  // --- 26ee:0f17 ---------------------------------------------------------------------------------

  /** `26ee:0f17` : 5 fois sur 6, un commentaire selon l'avance ou le retard sur le temps écoulé. */
  progressComment(game: Game, rng: BorlandRandom): number {
    if (rng.below(6) === 2) return 0;
    const { best } = measure(game);
    const percent = elapsedPercent(game);
    if (best < Math.floor((percent * 10) / 15)) return this.pick(0xc9, 4, rng);
    if (percent < best) return this.pick(0xd3, 5, rng);
    return 0;
  }

  // --- 26ee:027e ---------------------------------------------------------------------------------

  /**
   * `26ee:027e` : réplique du Grand Schtroumpf. `jailed` : le joueur vient d'être pris (prison ou siphon), `DS:274E == 2`
   * (une chance sur deux de parler) ; sinon une chance sur trois. Renvoie un code (voix ou vidéo, `isCommentVideo`) ou 0.
   */
  turnComment(game: Game, rng: BorlandRandom, jailed: boolean): number {
    if (rng.below(jailed ? 2 : 3) !== 0) return 0;
    const percent = elapsedPercent(game);
    return jailed ? this.jailedComment(game, rng, percent) : this.normalComment(game, rng, percent);
  }

  /** Prisonnier : `0xab..0xaf`, puis (après la moitié du temps) `0xb5..0xb7`, `0xc1..0xc4`, 0x82, puis l'ingrédient manquant. */
  private jailedComment(game: Game, rng: BorlandRandom, percent: number): number {
    const code = this.prisonerComment(rng, percent);
    if (code !== 0) return code;
    if (this.mark(0x82)) return 0x82;
    return this.missingIngredient(game);
  }

  /** Partie normale, dans l'ordre de `26ee:027e` (les cinq premières répliques 0x15..0x19 dépendent de drapeaux jamais levés). */
  private normalComment(game: Game, rng: BorlandRandom, percent: number): number {
    const { players, current } = game.state;
    const m = measure(game);
    const multiplayer = players.length > 1;
    const me = players[current];
    let code = 0;

    if (multiplayer) {
      if (m.best > percent) {
        // L'original ne regarde que le **dernier** joueur (`SI` réécrit à chaque tour de boucle) : reproduit.
        const someone = m.owned[players.length - 1] !== 0;
        if (someone && this.mark(1)) return 1;
        if (someone && this.mark(2)) return 2;
      }
      if (this.closeRace(m) && this.mark(3)) return 3;
      if (percent >> 1 >= m.best) {
        if (this.mark(4)) return 4;
        if (this.mark(5)) return 5;
      }
    }

    if (m.progress[current] > percent) {
      if (this.mark(0xb)) return 0xb;
      if (this.mark(0xc)) return 0xc;
      code = this.characterVoice(AHEAD_BASE[me.character], rng, false);
      if (code !== 0) return code;
    }
    if (percent >> 1 > m.progress[current]) {
      if (this.mark(0xd)) return 0xd;
      if (this.mark(0xe)) return 0xe;
      if (this.mark(0xf)) return 0xf;
      code = this.characterVoice(BEHIND_BASE[me.character], rng, BEHIND_BASE[me.character] === BEHIND_SINGLE);
      if (code !== 0) return code;
    }

    if (multiplayer && percent >= 0x1e) {
      code = this.nobodyHas(game, m);
      if (code !== 0) return code;
    }
    if (multiplayer && Math.floor((percent * 10) / 15) >= m.best) {
      if (this.mark(0x6f)) return 0x6f;
      if (this.mark(0x70)) return 0x70;
    }
    if (percent >= 0x1e) {
      if (m.owned.every((n, i) => n === 0 && m.points[i] === 0) && this.mark(0x71)) return 0x71;
      code = this.missingCount(m.total - m.owned[current], rng);
      if (code !== 0) return code;
    }
    if (percent > MISSING_VIDEO_MIN_PERCENT) {
      code = this.missingIngredient(game);
      if (code !== 0) return code;
    }
    if (game.state.round <= 5) return 0;
    code = this.prisonerComment(rng, percent);
    if (code !== 0) return code;
    return this.mark(0x82) ? 0x82 : 0;
  }

  /** Répliques sur les prisonniers : `0xab..0xaf`, puis `0xb5..0xb7` (plus de la moitié du temps), puis `0xc1..0xc4`. */
  private prisonerComment(rng: BorlandRandom, percent: number): number {
    let code = this.pick(0xab, 5, rng);
    if (code === 0 && percent > 0x32) code = this.pick(0xb5, 3, rng);
    if (code === 0) code = this.pick(0xc1, 4, rng);
    return code;
  }

  /** Deux joueurs (au moins) à 5 points d'avancement ou moins l'un de l'autre, le premier ayant plus de 15. */
  private closeRace(m: Measure): boolean {
    let close = false;
    for (let k = 0; k < m.progress.length - 1; k++) {
      if (m.progress[k] <= 0xf) continue;
      for (let j = k + 1; j < m.progress.length; j++) if (Math.abs(m.progress[k] - m.progress[j]) <= 5) close = true;
    }
    return close;
  }

  /** Voix propre au personnage : le drapeau est celui du code de base ; deux variantes sauf pour `single`. */
  private characterVoice(base: number, rng: BorlandRandom, single: boolean): number {
    if (!this.mark(base)) return 0;
    return single ? base : base + rng.below(2);
  }

  /** Un ingrédient demandé que personne n'a (`codes 100..108`). Reproduit la boucle d'origine, indices compris. */
  private nobodyHas(game: Game, m: Measure): number {
    const { players, goal } = game.state;
    let chosen = 0;
    for (let k = 1; k < 8; k++) {
      if (!this.said.has(100 + NOBODY_VOICE_OFFSET[chosen]) && (goal.ingredients & (1 << k)) !== 0) {
        chosen = k;
        if (players.some((p) => hasIngredient(p, k))) chosen = 0;
        // Sortie de boucle de l'original : `k = (octet) total` puis `k++`.
        if (chosen !== 0) k = m.total & 0xff;
      }
    }
    if (chosen === 0 || this.said.has(100 + NOBODY_VOICE_OFFSET[chosen])) return 0;
    this.said.add(100 + NOBODY_VOICE_OFFSET[chosen]);
    return 100 + NOBODY_VOICE_OFFSET[chosen];
  }

  /** « Il te manque k ingrédients » : `k = ingrédients demandés × joueurs − ceux du joueur` (défaut d'origine : multiplié). */
  private missingCount(missing: number, rng: BorlandRandom): number {
    if (missing === 4) {
      if (this.mark(0x7c)) return 0x7c;
      return this.missingCount(5, rng);
    }
    const codes = MISSING_COUNT_CODES[missing];
    if (!codes || !this.mark(codes[0])) return 0;
    return codes[rng.below(codes.length)];
  }

  /** Vidéo de l'ingrédient demandé que le joueur n'a pas encore et dont on n'a pas encore parlé (`0x83..0x8a`). */
  private missingIngredient(game: Game): number {
    const { players, current, goal } = game.state;
    for (let k = 0; k < 8; k++) {
      const code = 0x82 + MISSING_VIDEO_OFFSET[k];
      if (!this.said.has(code) && (goal.ingredients & (1 << k)) !== 0 && !hasIngredient(players[current], k)) {
        this.said.add(code);
        return code;
      }
    }
    return 0;
  }

  /** Tire `base + rand × n` ; renvoie le code s'il n'a pas encore été dit (et le note), 0 sinon. */
  private pick(base: number, n: number, rng: BorlandRandom): number {
    const code = base + rng.below(n);
    return this.mark(code) ? code : 0;
  }

  /** Note `code` comme dit ; faux s'il l'était déjà. */
  private mark(code: number): boolean {
    if (this.said.has(code)) return false;
    this.said.add(code);
    return true;
  }
}
