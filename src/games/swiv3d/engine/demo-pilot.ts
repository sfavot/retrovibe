/**
 * Pilote de démonstration (forme `0x2a`, type de départ 1001 : `DEMO.SLV`, décor animé des menus) : physique `00449af8`
 * (docs/swiv3d/player.md §3.2). Le joueur n'a pas de pilote (`gm_pilot_none`) : sa physique est celle d'un avion sur les nœuds
 * aériens. Il réserve le nœud aérien libre le plus proche, vole à 80 unités au-dessus du relief (`gm_heli_physics`), vire vers le
 * nœud (`gm_aircraft_turn_to_point`, bascule bornée à 25) et, à moins de 100 unités (`d² < 10000`), passe au nœud suivant sans
 * jamais revenir en arrière (`FUN_00442c90`, `NodeNet.advanceAir`).
 */
import { aircraftTurn } from "./combat";
import { HELI_ALTITUDE, heliPhysics, type Player, type PlayerContext } from "./player";

/** Bascule maximale du virage (`EDX = 0x19`). */
const TURN_LIMIT = 0x19;
/** Distance² au nœud (unités²) à partir de laquelle on prend le suivant. */
const ARRIVAL_D2 = 10000;

/** Comportement `player_demo` (`+0x68` de la forme 0x2a). */
export function demoPilotUpdate(p: Player, ctx: PlayerContext): void {
  const o = p.obj;
  if (o.node === -1) ctx.nodes.claim("air", o);
  if (heliPhysics(o, ctx.terrain, HELI_ALTITUDE, ctx.emit)) ctx.emit({ kind: "playerDamaged", amount: 10, source: "ground" });
  // sans nœud libre, l'exe lit la table avant son début : ici l'appareil reste en vol stationnaire
  if (o.node < 0) return;
  const nx = ctx.nodes.x[o.node]!;
  const nz = ctx.nodes.z[o.node]!;
  aircraftTurn(o, nx, nz, TURN_LIMIT);
  const dx = nx - (o.x >> 8);
  const dz = nz - (o.z >> 8);
  if (dx * dx + dz * dz < ARRIVAL_D2) ctx.nodes.advanceAir(o);
}
