/**
 * Réseau de chemins (bloc 107) : réservation de nœuds par classe de véhicule, choix du nœud suivant en patrouille ou en
 * poursuite (`gm_node_claim_*` `004262a4`/`004263bc`/`004264d4`, `gm_node_patrol_*`, `gm_node_chase_*`, `gm_node_distance_*`).
 * Voir `docs/swiv3d/objects.md` §9. Les compteurs de capacité des nœuds sont modifiés en cours de jeu.
 */
import type { Level } from "../data/level";
import type { GameObject } from "./objects";

/** Classe de véhicule : terrestre (`+0x20`), navire (`+0x18`), aéronef (`+0x1c`). */
export type NodeClass = "ground" | "ship" | "air";

export class NodeNet {
  readonly count: number;
  readonly x: Int32Array;
  readonly z: Int32Array;
  readonly links: Int32Array;
  /** Capacités par classe (copie des compteurs du bloc 107). */
  private readonly cap: Record<NodeClass, Int32Array>;

  constructor(level: Pick<Level, "waypoints">) {
    const w = level.waypoints;
    this.count = w.length;
    this.x = new Int32Array(w.length);
    this.z = new Int32Array(w.length);
    this.links = new Int32Array(w.length * 4);
    this.cap = {
      ground: new Int32Array(w.length),
      ship: new Int32Array(w.length),
      air: new Int32Array(w.length),
    };
    w.forEach((n, i) => {
      this.x[i] = n.x;
      this.z[i] = n.z;
      for (let k = 0; k < 4; k++) this.links[i * 4 + k] = n.links[k]!;
      this.cap.ground[i] = n.capacity.ground;
      this.cap.ship[i] = n.capacity.ships;
      this.cap.air[i] = n.capacity.aircraft;
    });
  }

  capacity(kind: NodeClass, node: number): number {
    return this.cap[kind][node]!;
  }

  /** Rend le nœud courant de `o` (arrivée d'un véhicule qui meurt ou est dépeuplé). */
  release(kind: NodeClass, o: GameObject): void {
    if (o.node >= 0) this.cap[kind][o.node]!++;
  }

  /**
   * `gm_node_claim_*` : libère le nœud courant puis réserve le nœud de capacité > 0 le plus proche (distance² en unités, balayage
   * de tous les nœuds). Retourne l'indice réservé, -1 s'il n'y en a aucun.
   */
  claim(kind: NodeClass, o: GameObject): number {
    const cap = this.cap[kind];
    if (o.node >= 0) cap[o.node]!++;
    let best = -1;
    let bestD = 999999999;
    const ox = o.x >> 8;
    const oz = o.z >> 8;
    for (let i = 0; i < this.count; i++) {
      if (cap[i]! <= 0) continue;
      const dx = this.x[i]! - ox;
      const dz = this.z[i]! - oz;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) cap[best]!--;
    o.node = best;
    return best;
  }

  /** Distance² (unités) du nœud courant de `o` à (x, z) en unités, -1 sans nœud. */
  distanceTo(o: GameObject, x: number, z: number): number {
    if (o.node < 0) return 0;
    const dx = this.x[o.node]! - x;
    const dz = this.z[o.node]! - z;
    return dx * dx + dz * dz;
  }

  /**
   * `gm_node_patrol_*` : nœud voisin libre suivant, à tour de rôle (`(âge + k) & 3`) ; reste sur place si les trois premiers
   * essais ne donnent rien.
   */
  patrol(kind: NodeClass, o: GameObject): void {
    if (o.node < 0) return;
    const cap = this.cap[kind];
    let k = o.age;
    let tries = 0;
    for (;;) {
      const cand = this.links[o.node * 4 + (k & 3)]!;
      tries++;
      k++;
      if (tries < 4 && cand === -1) continue;
      if (tries > 3 || cap[cand]! > 0) {
        if (tries !== 4) {
          cap[o.node]!++;
          cap[cand]!--;
          o.node = cand;
        }
        return;
      }
    }
  }

  /**
   * `FUN_00442c90` (pilote de démonstration) : avance sur le chemin sans jamais revenir. Prend le dernier lien utilisé du nœud
   * courant (le dernier des 4 qui n'est pas -1, sinon le nœud lui-même), efface dans ce nœud les liens qui reviennent vers l'ancien,
   * rend l'ancien à la classe aérienne et réserve le nouveau.
   */
  advanceAir(o: GameObject): void {
    const cur = o.node;
    if (cur < 0) return;
    let next = cur;
    for (let k = 0; k < 4; k++) {
      const l = this.links[cur * 4 + k]!;
      if (l !== -1) next = l;
    }
    for (let k = 0; k < 4; k++) if (this.links[next * 4 + k] === cur) this.links[next * 4 + k] = -1;
    this.cap.air[cur]!++;
    this.cap.air[next]!--;
    o.node = next;
  }

  /** `gm_node_distance_*` : D² au point (tx, tz) en unités avec exploration de 4 niveaux de voisins libres. */
  private distance(
    node: number,
    from: number,
    depth: number,
    tx: number,
    tz: number,
    cap: Int32Array,
  ): number {
    const dx = this.x[node]! - tx;
    const dz = this.z[node]! - tz;
    let best = dx * dx + dz * dz;
    if (depth < 5) {
      for (let k = 0; k < 4; k++) {
        const l = this.links[node * 4 + k]!;
        if (l === -1 || l === from || cap[l]! <= 0) continue;
        const d = this.distance(l, node, depth + 1, tx, tz, cap);
        if (d < best) best = d;
      }
    }
    return best + depth;
  }

  /**
   * `gm_node_chase_*` : parmi les voisins libres du nœud courant, celui dont la distance approchée à la cible est la plus petite
   * (le nœud courant si aucun ne rapproche). Libère l'ancien nœud, réserve le nouveau.
   */
  chase(kind: NodeClass, o: GameObject, target: GameObject): void {
    if (o.node < 0) return;
    const cap = this.cap[kind];
    const cur = o.node;
    cap[cur]!++;
    const tx = target.x >> 8;
    const tz = target.z >> 8;
    const dx = this.x[cur]! - tx;
    const dz = this.z[cur]! - tz;
    let bestD = dx * dx + dz * dz;
    let best = cur;
    for (let k = 0; k < 4; k++) {
      const l = this.links[cur * 4 + k]!;
      if (l === -1 || cap[l]! <= 0) continue;
      const d = this.distance(l, cur, 1, tx, tz, cap);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    o.node = best;
    cap[best]!--;
  }
}
