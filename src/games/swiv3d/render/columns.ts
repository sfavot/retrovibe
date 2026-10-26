/**
 * Enregistrements de colonne d'écran (321 × 0x48 octets à `0052d2e8`, `render.md` §6.5) : état de la bande de terrain et lignes
 * d'horizon consultées par tous les rastériseurs d'objets pour masquer ce qui est derrière un relief plus proche.
 */
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./view";

export const COLUMN_COUNT = SCREEN_WIDTH + 1;
const NODE_CAPACITY = 1 << 15;

export class Columns {
  /** Première ligne non dessinée (le terrain se remplit de bas en haut). */
  readonly top = new Int32Array(COLUMN_COUNT);
  readonly flag = new Int32Array(COLUMN_COUNT);
  readonly prevY = new Int32Array(COLUMN_COUNT);
  readonly curY = new Int32Array(COLUMN_COUNT);
  /** États `[u, v, lumière, couleur]` (16 bits) courant et précédent, 4 mots par colonne. */
  readonly state = new Int32Array(COLUMN_COUNT * 4);
  readonly prevState = new Int32Array(COLUMN_COUNT * 4);
  /** Listes d'horizon : tête par colonne et nœuds `(z, y, suivant)` ; le dernier ajouté est en tête. */
  readonly head = new Int32Array(COLUMN_COUNT);
  readonly nodeZ = new Int32Array(NODE_CAPACITY);
  readonly nodeY = new Int32Array(NODE_CAPACITY);
  readonly nodeNext = new Int32Array(NODE_CAPACITY);
  private nodeCount = 0;

  /** Remise à zéro de début d'image (le jeu laisse traîner l'image précédente : non reproduit, pour un rendu déterministe). */
  reset(): void {
    this.top.fill(SCREEN_HEIGHT - 1);
    this.flag.fill(0);
    this.prevY.fill(99999);
    this.curY.fill(99999);
    this.state.fill(0);
    this.prevState.fill(0);
    this.head.fill(-1);
    this.nodeCount = 0;
  }

  /** « Un relief plus proche que `z` cache tout ce qui est sous la ligne `y` » : ajouté en tête de la colonne. */
  addHorizon(x: number, z: number, y: number): void {
    if (this.nodeCount >= NODE_CAPACITY) return;
    const n = this.nodeCount++;
    this.nodeZ[n] = z;
    this.nodeY[n] = y;
    this.nodeNext[n] = this.head[x]!;
    this.head[x] = n;
  }

  /**
   * Découpe l'intervalle de lignes `[y0, y0 + count)` d'un objet de profondeur `key` par les lignes d'horizon de la colonne `x`
   * (`render.md` §6.5) : renvoie le nombre de lignes restant à tracer à partir de `y0` (les lignes tracées sont `y0 .. y0 + n - 1`).
   */
  clipByHorizon(x: number, key: number, y0: number, y1: number, count: number): number {
    for (let n = this.head[x]!; n >= 0; n = this.nodeNext[n]!) {
      if (this.nodeZ[n]! >= key) continue;
      const y = this.nodeY[n]!;
      if (y < y0) return 0;
      if (y < y1) {
        count -= y1 - y;
        y1 = y;
      }
    }
    return count;
  }
}
