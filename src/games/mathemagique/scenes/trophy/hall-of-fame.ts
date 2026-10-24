/**
 * Modèle du Hall of Fame (scène 10, `docs/mathemagique/screens/common.md` §6) : pagination, lignes, cellules, rubans et sélection.
 * Pur : aucun dessin, aucun accès au moteur. La scène (`trophy-scene.ts`) le dessine et le branche aux gadgets.
 */
import { LEVELS_PER_OPERATION, OPERATION_COUNT, gradeOfMask, type PlayerInfo } from "../../engine/roster";
import { buildCertificateData, type CertificateData } from "../certificate/certificate-data";

/** Joueurs par page (`1078:0860`, boucle `iVar8 < 8`). */
export const PLAYERS_PER_PAGE = 8;

// --- Géométrie de l'écran (576×432) ---

export const ROW_TOP = 75;
export const ROW_PITCH = 37;
export const ROW_HEIGHT = 30;
export const CELL_LEFT = 172;
export const CELL_PITCH = 60;
export const CELL_WIDTH = 51;
/** Ruban `i` d'une cellule : `gauche + 9 × i + 2`, `haut + 2` (`1078:0b48`). */
export const RIBBON_STEP = 9;
export const RIBBON_OFFSET = 2;
/** Nom du joueur : abscisse 48, ligne de base `87 + 37 × r` ; rang : ligne de base `101 + 37 × r` (`1078:0860`). */
export const NAME_X = 48;
export const NAME_BASELINE = 87;
export const RANK_BASELINE = 101;
export const RANK_PREFIX = "Rank: ";

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function cellRect(row: number, operation: number): CellRect {
  return { x: CELL_LEFT + CELL_PITCH * operation, y: ROW_TOP + ROW_PITCH * row, w: CELL_WIDTH, h: ROW_HEIGHT };
}

// --- Pages ---

/** Indice de la dernière page : `(joueurs - 1) / 8` en division entière de C (0 sans joueur). */
export function lastPageIndex(playerCount: number): number {
  return playerCount <= 0 ? 0 : Math.floor((playerCount - 1) / PLAYERS_PER_PAGE);
}

export function clampPage(page: number, playerCount: number): number {
  return Math.max(0, Math.min(page, lastPageIndex(playerCount)));
}

export interface HallCell {
  /** Colonne 0 à 5 (+ − × ÷ = ≈). */
  operation: number;
  /** Quintet de l'opération (`masque >> 5 × opération`, 5 bits). */
  quintet: number;
  /** Au moins un niveau réussi (`quintet ≠ 0`) : sinon la cellule est inactive. */
  active: boolean;
  /** Niveaux réussis 0 à 3 (LEVEL 1 à 4) et 4 (BONUS) : un ruban chacun. */
  levels: readonly boolean[];
}

export interface HallRow {
  player: PlayerInfo;
  /** Rang global 1 à 25. */
  grade: number;
  /** Nom du rang (`STRL 5000`). */
  rank: string;
  cells: readonly HallCell[];
}

export function buildCell(mask: number, operation: number): HallCell {
  const quintet = (mask >>> (LEVELS_PER_OPERATION * operation)) & ((1 << LEVELS_PER_OPERATION) - 1);
  return {
    operation,
    quintet,
    active: quintet !== 0,
    levels: Array.from({ length: LEVELS_PER_OPERATION }, (_, level) => ((quintet >> level) & 1) !== 0),
  };
}

export function buildRow(player: PlayerInfo, ranks: readonly string[]): HallRow {
  const grade = gradeOfMask(player.mask);
  return {
    player,
    grade,
    rank: ranks[grade - 1] ?? "",
    cells: Array.from({ length: OPERATION_COUNT }, (_, operation) => buildCell(player.mask, operation)),
  };
}

/** Les 8 lignes d'une page : `null` pour une ligne sans joueur. `players` est déjà dans l'ordre alphabétique du moniteur. */
export function buildPage(players: readonly PlayerInfo[], page: number, ranks: readonly string[]): (HallRow | null)[] {
  const start = clampPage(page, players.length) * PLAYERS_PER_PAGE;
  return Array.from({ length: PLAYERS_PER_PAGE }, (_, r) => {
    const player = players[start + r];
    return player ? buildRow(player, ranks) : null;
  });
}

export interface CellRef {
  row: number;
  operation: number;
}

/** Première cellule active en lisant ligne par ligne (présélectionnée à chaque affichage de page, `1078:0860`). */
export function firstActiveCell(rows: readonly (HallRow | null)[]): CellRef | null {
  for (let row = 0; row < rows.length; row++) {
    const cells = rows[row]?.cells;
    if (!cells) continue;
    const cell = cells.find((c) => c.active);
    if (cell) return { row, operation: cell.operation };
  }
  return null;
}

/** État du Hall of Fame : page affichée, lignes, cellule sélectionnée. */
export class HallOfFameModel {
  private playerList: readonly PlayerInfo[] = [];
  private pageIndex = 0;
  private rowList: (HallRow | null)[] = [];
  private selected: CellRef | null = null;

  constructor(private readonly ranks: readonly string[]) {}

  /** Charge les joueurs (ordre alphabétique) et revient à `page` (ramenée dans les limites), sélection sur la première cellule active. */
  setPlayers(players: readonly PlayerInfo[], page = this.pageIndex): void {
    this.playerList = players;
    this.show(page);
  }

  get page(): number {
    return this.pageIndex;
  }

  get pageCount(): number {
    return lastPageIndex(this.playerList.length) + 1;
  }

  get rows(): readonly (HallRow | null)[] {
    return this.rowList;
  }

  get selection(): CellRef | null {
    return this.selected;
  }

  /** Change de page (`delta` -1 ou +1, bornée : pas de rebouclage, `1078:0a9f`). Renvoie vrai si la page a changé. */
  movePage(delta: number): boolean {
    const target = clampPage(this.pageIndex + delta, this.playerList.length);
    if (target === this.pageIndex) return false;
    this.show(target);
    return true;
  }

  /** Sélectionne une cellule active ; faux (sélection inchangée) si la ligne est vide ou la cellule inactive. */
  selectCell(row: number, operation: number): boolean {
    const cell = this.rowList[row]?.cells[operation];
    if (!cell?.active) return false;
    this.selected = { row, operation };
    return true;
  }

  /** Données du certificat de la cellule sélectionnée ; `null` sans sélection (le bouton d'impression ne fait alors rien). */
  selectedCertificate(): CertificateData | null {
    if (!this.selected) return null;
    const row = this.rowList[this.selected.row];
    if (!row) return null;
    return buildCertificateData({ playerName: row.player.name, mask: row.player.mask, operation: this.selected.operation, ranks: this.ranks });
  }

  private show(page: number): void {
    this.pageIndex = clampPage(page, this.playerList.length);
    this.rowList = buildPage(this.playerList, this.pageIndex, this.ranks);
    this.selected = firstActiveCell(this.rowList);
  }
}
