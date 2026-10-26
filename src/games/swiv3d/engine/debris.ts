/**
 * Table de débris (bloc `11004` des niveaux, 3 540 octets, identique dans les 5 niveaux) et création des épaves et éclats à la
 * destruction d'un objet (`gm_object_debris`, `004442ec` ; docs/swiv3d/objects.md §10.4, models.md).
 *
 * Format (offsets relatifs au début du bloc, relocalisés par `gm_slv_reloc_list` `00454524`) : liste chaînée de nœuds de 12 octets
 * `(suivant, sous-liste, clé)` ; la clé est un emplacement de modèle (`+0x10000` : gros éclats, `+0x20000` : petits éclats) ; une
 * sous-liste est circulaire, ses nœuds sont `(?, suivant, modèle)`.
 */
import { parseBd } from "../data/bd";
import { nextRandom, cloneObject, spawnOnGround } from "./combat";
import type { GameObject } from "./objects";
import { radius2 } from "./objects";
import type { World } from "./world";

export interface DebrisList {
  /** Modèles de la sous-liste circulaire, dans l'ordre. */
  models: number[];
  /** Position courante de la tête de la sous-liste (tourne à chaque épave créée). */
  head: number;
}

export class DebrisTable {
  readonly lists = new Map<number, DebrisList>();

  /** Lit le bloc 11004 d'un `.SLV`. */
  static fromSlv(slvBytes: Uint8Array, name = "SLV"): DebrisTable {
    const bd = parseBd(slvBytes, name);
    return DebrisTable.parse(bd.get(11004));
  }

  static parse(block: Uint8Array): DebrisTable {
    const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
    const table = new DebrisTable();
    const i32 = (off: number): number => dv.getInt32(off, true);
    let node = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const next = i32(node);
      if (next === 0) break; // dernier nœud : terminateur sans données (`gm_slv_reloc_list` s'arrête dessus)
      const sub = i32(node + 4);
      const key = i32(node + 8);
      const models: number[] = [];
      if (sub !== 0) {
        let s = sub;
        do {
          models.push(i32(s + 8));
          s = i32(s + 4);
        } while (s !== sub && models.length < 64);
      }
      table.lists.set(key, { models, head: 0 });
      node = next;
    }
    return table;
  }

  /** Copie indépendante (la tête de chaque sous-liste est un état de partie). */
  clone(): DebrisTable {
    const t = new DebrisTable();
    for (const [k, v] of this.lists)
      t.lists.set(k, { models: v.models.slice(), head: v.head });
    return t;
  }
}

const r = { x: 0, y: 0, z: 0 };

/** Nombre de pièces selon le rayon² du modèle : 3 (< 1 000), 5 (< 5 000), 8 (sinon). */
export function debrisCount(world: World, model: number): number {
  const r2 = radius2(world.models, model);
  return r2 < 1000 ? 3 : r2 < 5000 ? 5 : 8;
}

/**
 * `gm_object_debris` (`004442ec`) : épave persistante (clé = modèle), gros éclats (`+0x10000`) et petits éclats (`+0x20000`) ;
 * les éclats sont lancés avec les vitesses de la table pseudo-aléatoire × le nombre de pièces. Sans table, aucun effet.
 */
export function spawnDebris(world: World, o: GameObject): void {
  const table = world.debris;
  if (!table) return;
  const wreck = table.lists.get(o.model);
  if (wreck && wreck.models.length > 0) {
    const m = wreck.models[wreck.head]!;
    wreck.head = (wreck.head + 1) % wreck.models.length;
    const w = spawnOnGround(world, {
      x: o.x,
      z: o.z,
      yaw: o.yaw,
      classe: 0x4041,
      hp: 3000,
      model: m,
      update: "fx_wreck",
    });
    if (w) w.yaw = o.yaw;
  }
  let n = debrisCount(world, o.model);
  const count = n;
  const big = table.lists.get(o.model + 0x10000);
  if (big) {
    for (const m of big.models) {
      const p = cloneObject(world, o, {
        classe: 0xc03b,
        hp: 20,
        model: m,
        update: "fx_debris",
      });
      if (!p) break;
      nextRandom(world, r);
      p.vx = r.x * n;
      p.vy = Math.abs(r.y) * n;
      p.vz = r.z * n;
      p.yaw = peekRandomX(world);
    }
  }
  n = (n + 1) >> 1;
  const small = table.lists.get(o.model + 0x20000);
  if (small && small.models.length > 0) {
    let k = 0;
    for (let i = count; i > 0; i--) {
      const m = small.models[k % small.models.length]!;
      k++;
      const p = cloneObject(world, o, {
        classe: 0xc03b,
        hp: 20,
        model: m,
        update: "fx_debris_small",
      });
      if (!p) break;
      nextRandom(world, r);
      p.vx = r.x * n;
      p.vy = Math.abs(r.y) * n;
      p.vz = r.z * n;
    }
  }
}

/** Cap aléatoire d'un éclat : `x` du triplet suivant (l'index a déjà avancé). */
function peekRandomX(world: World): number {
  const t = { x: 0, y: 0, z: 0 };
  const saved = world.game.randomIndex;
  nextRandom(world, t);
  world.game.randomIndex = saved;
  return t.x;
}
