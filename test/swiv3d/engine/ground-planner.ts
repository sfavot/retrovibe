/**
 * Planificateur de trajet d'un véhicule au sol pour le robot de campagne : champ de coût (Dijkstra sur la carte 512 × 512, 8
 * voisins) depuis la case de la cible. Aucun pas n'est interdit, mais les pentes se paient très cher (le buggy ralentit nettement dès
 * 0,4 et cale vers 0,6 : player.md §3.6) et l'eau aussi (carte 102 < 4 : coque abîmée et poussée divisée par 4) : le robot descend le
 * champ et ne franchit un mur que s'il n'y a pas d'autre chemin (par exemple pour sortir d'une cuvette).
 */
import { MAP_SIZE, type Level } from "../../../src/games/swiv3d/data/level";

const MASK = MAP_SIZE - 1;
/** Un octet de hauteur = 4 unités ; une case = 64 unités. */
const UNITS_PER_BYTE = 4;
const CELL_UNITS = 64;
/** Surcoût d'un pas dans l'eau (par unité de longueur). */
const WATER_COST = 40;
/** Rayon (cases) par défaut autour de la cible dont toutes les cases valent « arrivé » (≈ 580 unités, sous la portée de tir de 640). */
const SEED_RADIUS = 9;

const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Coût d'un pas de `len` cases sur une pente `slope` (le plus raide du pas lui-même et de la case d'arrivée, pour ne pas longer un mur) : le temps qu'y met un buggy (vitesse mesurée
 * sur rampe : 100 % à plat, 40 % à 0,38, 22 % à 0,5, quasi nulle à 0,6), plus une pénalité qui décourage au-delà de 0,35 (en conduite réelle, avec les virages, le buggy cale plus tôt que sur la rampe droite de la mesure) et devient prohibitive au-delà de 0,6.
 */
function stepCost(slope: number, len: number, water: boolean): number {
  let c = 1 + 14 * slope * slope;
  if (slope > 0.35) c += (slope - 0.35) * 200;
  if (slope > 0.6) c += (slope - 0.6) * 10000;
  return len * (c + (water ? WATER_COST : 0));
}

export class GroundField {
  /** Coût restant jusqu'à la cible. */
  readonly dist = new Float64Array(MAP_SIZE * MAP_SIZE).fill(Infinity);
  private readonly hm: Uint8Array;
  private readonly gm: Uint8Array;
  /** Pente (norme du gradient) de chaque case. */
  private readonly steep: Float32Array;

  /** `seedRadius` : rayon (cases) autour de la cible dont toutes les cases valent « arrivé ». */
  constructor(level: Pick<Level, "heightmap" | "groundMap">, goalX: number, goalZ: number, seedRadius = SEED_RADIUS) {
    const hm = (this.hm = level.heightmap);
    const gm = (this.gm = level.groundMap);
    const steep = (this.steep = new Float32Array(MAP_SIZE * MAP_SIZE));
    for (let c = 0; c < steep.length; c++) {
      // gradient du relief (différences centrées sur une case) : un couloir praticable entre deux murs n'est pas « raide »
      const cx = c & MASK;
      const cz = c >> 9;
      const at = (x: number, z: number): number => hm[(z & MASK) * MAP_SIZE + (x & MASK)]!;
      const gx = ((at(cx + 1, cz) - at(cx - 1, cz)) * UNITS_PER_BYTE) / (2 * CELL_UNITS);
      const gz = ((at(cx, cz + 1) - at(cx, cz - 1)) * UNITS_PER_BYTE) / (2 * CELL_UNITS);
      steep[c] = Math.hypot(gx, gz);
    }
    const heap = new MinHeap();
    // la cible peut être sur une paroi : toutes les cases à moins de SEED_RADIUS cases comptent comme arrivée (portée de tir)
    const gx = goalX >> 6;
    const gz = goalZ >> 6;
    for (let dz = -seedRadius; dz <= seedRadius; dz++) {
      for (let dx = -seedRadius; dx <= seedRadius; dx++) {
        if (dx * dx + dz * dz > seedRadius * seedRadius) continue;
        const c = ((gz + dz) & MASK) * MAP_SIZE + ((gx + dx) & MASK);
        this.dist[c] = 0;
        heap.push(0, c);
      }
    }
    for (let top = heap.pop(); top !== null; top = heap.pop()) {
      const [d, c] = top;
      if (d > this.dist[c]!) continue;
      const cx = c & MASK;
      const cz = c >> 9;
      for (const [dx, dz, len] of NEIGHBOURS) {
        const n = ((cz + dz) & MASK) * MAP_SIZE + ((cx + dx) & MASK);
        const nd = d + stepCost(Math.max((Math.abs(hm[n]! - hm[c]!) * UNITS_PER_BYTE) / (len * CELL_UNITS), steep[n]!), len, gm[n]! < 4);
        if (nd < this.dist[n]!) {
          this.dist[n] = nd;
          heap.push(nd, n);
        }
      }
    }
  }

  /**
   * Point (x, z en unités, non replié) atteint en suivant le champ de `steps` cases depuis (x, z) en unités : à chaque case, le
   * voisin qui minimise coût du pas + coût restant.
   */
  waypoint(x: number, z: number, steps: number): { x: number; z: number } {
    let cx = (x / CELL_UNITS) | 0;
    let cz = (z / CELL_UNITS) | 0;
    for (let k = 0; k < steps; k++) {
      const c = (cz & MASK) * MAP_SIZE + (cx & MASK);
      let best = Infinity;
      let bx = cx;
      let bz = cz;
      for (const [dx, dz, len] of NEIGHBOURS) {
        const n = ((cz + dz) & MASK) * MAP_SIZE + ((cx + dx) & MASK);
        const total = this.dist[n]! + stepCost(Math.max((Math.abs(this.hm[n]! - this.hm[c]!) * UNITS_PER_BYTE) / (len * CELL_UNITS), this.steep[n]!), len, this.gm[n]! < 4);
        if (this.dist[n]! < this.dist[c]! && total < best) {
          best = total;
          bx = cx + dx;
          bz = cz + dz;
        }
      }
      if (bx === cx && bz === cz) break;
      cx = bx;
      cz = bz;
    }
    return { x: (cx + 0.5) * CELL_UNITS, z: (cz + 0.5) * CELL_UNITS };
  }
}

/** Tas binaire (priorité, valeur). */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];

  push(key: number, val: number): void {
    let i = this.keys.length;
    this.keys.push(key);
    this.vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.keys[i] = this.keys[p]!;
      this.vals[i] = this.vals[p]!;
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  pop(): [number, number] | null {
    const n = this.keys.length;
    if (n === 0) return null;
    const topK = this.keys[0]!;
    const topV = this.vals[0]!;
    const lastK = this.keys.pop()!;
    const lastV = this.vals.pop()!;
    if (n > 1) {
      let i = 0;
      const m = n - 1;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= m) break;
        if (c + 1 < m && this.keys[c + 1]! < this.keys[c]!) c++;
        if (this.keys[c]! >= lastK) break;
        this.keys[i] = this.keys[c]!;
        this.vals[i] = this.vals[c]!;
        i = c;
      }
      this.keys[i] = lastK;
      this.vals[i] = lastV;
    }
    return [topK, topV];
  }
}
