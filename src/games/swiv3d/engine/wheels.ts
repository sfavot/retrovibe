/**
 * Roues enfants des véhicules 1 (buggy) et 2 (motoneige) du joueur (`+0x1a8` à `+0x1b4`, docs/swiv3d/player.md §3.6) : décor sans
 * effet sur la physique, porté de `gm_player_set_form` (`0043de0c`), `gm_wheel_update` (`004446a0`) et de ses appelants.
 *
 * - Création (`0043de0c`) : objets du pool clonés sur le joueur (classe `0x40`, pv 0, comportement vide `004450a8`). Forme 1 : quatre
 *   roues `0x3d4` aux emplacements 0 à 3 de la table `00484324` (monde `004841b0` < 2) ou 7 à 10 (Lune, Mars : voie plus large) ;
 *   forme 2 : deux roues `0x3d4` (4, 5) et le ski `0x3d7` (6). L'emplacement est rangé dans `+0x50` de la roue. Au changement de
 *   forme suivant, les roues de la forme 1 ou 2 quittée sont effacées (`+4 = 0`).
 * - Mise à jour (`004446a0`), à la fin de la fonction pilote : vitesse, roulis et cap recopiés du joueur, position à l'emplacement
 *   dans le repère du joueur (`FUN_004418b0` : même calcul que `gm_attach_offset`) relevée à `sol + 2 000` si elle est à moins de
 *   `sol + 4 000` ; puis selon le mode (voir `wheelUpdate`).
 * - Pilotes : forme 1 (`0043a174`) modes 3, 3, 4, 4 ; forme 2 (`0043a760`) modes 1, 1, 2 ; amarrage au sol et Super Ressort des
 *   formes 1 et 2 (`00438694`, installé par `004482dc` et `0045e128`) : braquage vers la cible par pas de 8, modes 3, 3, 4, 4.
 *   La forme 1 donne en plus un coup de rotation aux roues arrière à chaque pas de poussée (`vehicle.ts`, `kickRearWheels`).
 * - Mort (`gm_player_die` `0043b4f4`) : les roues deviennent des gros éclats (`0044412c`) lancés par la table pseudo-aléatoire × 9.
 *
 * - Fin de niveau (`00438ec8` forme 1, `00438fb8` forme 2) : braquage vers la cible par pas de 8 comme `00438694`, modes 3, 3, 4, 4
 *   (buggy) ou 1, 1, 2 (motoneige) ; le coup de −13 sur les roues arrière est dans `vehicleVictoryPilot` (`vehicle.ts`).
 *
 * Écarts : sous `00438694` la motoneige n'a que trois roues et l'exe met à jour un quatrième pointeur `+0x1b4` resté de la forme 1
 * (ou nul) : ignoré ici ; la variante `00438c68` (modes 1, 1, 2, installée par les plates-formes 7012/7013 `004495f8`, absentes des
 * niveaux livrés) n'est pas portée ; le monde `004841b0` est déduit du nom du niveau.
 */
import { attachTo } from "./attach";
import { cloneObject, nextRandom } from "./combat";
import { peekRandomX } from "./debris";
import { COS, SIN, wrapQ8 } from "./fixed";
import type { GameObject } from "./objects";
import type { Player, PlayerContext } from "./player";
import { FORM_BUGGY, FORM_SNOWMOBILE, sampleGround } from "./vehicle";
import type { World } from "./world";

/** Modèles : roue (`0x3d4`), roue dans l'eau (`0x3d6`), ski de la motoneige (`0x3d7`). */
export const WHEEL_MODEL = 0x3d4;
export const WHEEL_WATER_MODEL = 0x3d6;
export const SKI_MODEL = 0x3d7;

/** Comportement des roues (`+0x68 = 004450a8`, fonction vide : tout est fait par le pilote du joueur). */
export const UPDATE_PLAYER_WHEEL = "player_wheel";

/**
 * Table `00484324` (16 octets par emplacement : latéral, vertical, avant en Q8 ; le 4ᵉ champ, 1 pour la motoneige, n'est pas lu),
 * indexée par `+0x50` de la roue. 0-3 : buggy (AG, AD, ArG, ArD) ; 4-5 : roues arrière de la motoneige ; 6 : son ski ;
 * 7-10 : buggy sur la Lune et Mars.
 */
export const WHEEL_MOUNTS: readonly (readonly [number, number, number])[] = [
  [-4800, -1500, 3000],
  [4800, -1500, 3000],
  [-4800, -1500, -3000],
  [4800, -1500, -3000],
  [-4800, -1500, -3000],
  [4800, -1500, -3000],
  [0, -1500, 6000],
  [-5000, -1500, 6000],
  [5000, -1500, 6000],
  [-6200, -1500, -4000],
  [6200, -1500, -4000],
];

/** Modes de `gm_wheel_update` par emplacement `+0x1a8…` : forme 1, forme 2, pilote d'amarrage `00438694`. */
const MODES_BUGGY: readonly number[] = [3, 3, 4, 4];
const MODES_SNOWMOBILE: readonly number[] = [1, 1, 2];
const MODES_AUTOPILOT: readonly number[] = [3, 3, 4, 4];

/** Types de sol sous la roue : en dessous, c'est de l'eau (`00577664 < 4`). */
const WATER_GROUND = 4;

/** Monde de la mission (`004841b0`) : 0 Terre, 1 Arctique, 2 Lune, 3 Mars, déduit du nom du niveau (`TERRAN00`, `LUNAR01`…). */
export function planetOf(levelName: string): number {
  const n = levelName.toUpperCase();
  return n.startsWith("ARCTIC") ? 1 : n.startsWith("LUNAR") ? 2 : n.startsWith("MARS") ? 3 : 0;
}

/** `gm_player_set_form`, partie roues : efface celles de la forme quittée et crée celles de la nouvelle (formes 1 et 2). */
export function setPlayerWheels(world: World, p: Player): void {
  for (const w of p.wheels) w.classe = 0;
  p.wheels = [];
  let mounts: readonly number[];
  if (p.form === FORM_BUGGY) mounts = planetOf(world.level.name) < 2 ? [0, 1, 2, 3] : [7, 8, 9, 10];
  else if (p.form === FORM_SNOWMOBILE) mounts = [4, 5, 6];
  else return;
  for (const mount of mounts) {
    const w = cloneObject(world, p.obj, {
      classe: 0x40,
      hp: 0,
      model: mount === 6 ? SKI_MODEL : WHEEL_MODEL,
      update: UPDATE_PLAYER_WHEEL,
    });
    if (!w) continue;
    w.state = mount;
    p.wheels.push(w);
  }
}

const ground = { height: 0, type: 0 };

/**
 * `gm_wheel_update` (`004446a0`) : `steer` est le braquage du tick (`004841bc = +0xb0`). Modes :
 * - 0, 3, 4 : roue motrice : tourne de `-(SIN[cap]·vx + COS[cap]·vz) >> 13` par tick ; 3 : cap + braquage (avant) ; 4 : cap −
 *   braquage/2 (arrière, mais + braquage dans l'eau) ; dans l'eau (sol < 4 et roue à moins de 2 000 au-dessus de `sol + 1 500`) : posée sur l'eau, modèle
 *   `0x3d6`, tangage 0 ;
 * - 1 : roue de motoneige : tangage du joueur (pas de rotation), même cas d'eau ;
 * - 2 : ski : tangage du joueur, cap + braquage, toujours modèle `0x3d7`.
 *
 * Hors de l'eau, la roue descend de 1 500 (son moyeu) ; l'exe compare pour cela la hauteur à `(cap & 511) + 1 500` au lieu du sol (la
 * variable du sol est réutilisée pour le cap) : reproduit tel quel, sans effet visible au-dessus du niveau 0.
 */
export function wheelUpdate(ctx: PlayerContext, w: GameObject, mode: number, steer: number): void {
  const b = w.owner;
  w.vx = b.vx;
  w.vy = b.vy;
  w.vz = b.vz;
  const [lat, vert, fwd] = WHEEL_MOUNTS[w.state] ?? WHEEL_MOUNTS[0]!;
  attachTo(b, w, lat, vert, fwd);
  w.x = wrapQ8(w.x);
  w.z = wrapQ8(w.z);
  sampleGround(ctx, w.x, w.z, ground);
  if (ground.height + 4000 >= w.y) w.y = ground.height + 2000;
  const h = ground.height;
  w.yaw = b.yaw;
  w.roll = b.roll;
  if (mode === 2) {
    w.pitch = b.pitch;
    w.yaw = b.yaw + steer;
    w.model = SKI_MODEL;
    return;
  }
  if (ground.type < WATER_GROUND && w.y - (h + 1500) < 2000) {
    w.y = h;
    w.model = WHEEL_WATER_MODEL;
    w.pitch = 0;
    // dans l'eau, l'arrière (mode 4) braque comme l'avant
    if (mode === 3 || mode === 4) w.yaw = b.yaw + steer;
    return;
  }
  const yaw = w.yaw & 0x1ff;
  if (mode === 1) w.pitch = b.pitch;
  else w.pitch -= (SIN[yaw]! * w.vx + w.vz * COS[yaw]!) >> 13;
  w.y = yaw + 1500 < w.y ? w.y - 1500 : yaw;
  w.model = WHEEL_MODEL;
  if (mode === 3) w.yaw = b.yaw + steer;
  else if (mode === 4) w.yaw = b.yaw - (steer >> 1);
}

/**
 * Fin de la fonction pilote (`+0xa8`) pour les roues : pilote normal des formes 1 et 2 (braquage déjà avancé de 4 par `vehiclePilot`),
 * pilote d'amarrage `00438694` quand le pilote est coupé (`autopilot` : plate-forme au sol, Super Ressort) ou pilote de fin de niveau
 * (`victory` : `00438ec8`, `00438fb8`) ; ces deux derniers avancent le braquage de 8 vers sa cible.
 */
export function playerWheelsTick(p: Player, ctx: PlayerContext): void {
  if (p.wheels.length === 0 || p.dead) return;
  const own = p.form === FORM_BUGGY ? MODES_BUGGY : MODES_SNOWMOBILE;
  let modes: readonly number[] = own;
  if (p.autopilot || p.victory) {
    if (p.steer < p.steerTarget) p.steer += 8;
    if (p.steerTarget < p.steer) p.steer -= 8;
    if (p.autopilot) modes = MODES_AUTOPILOT;
  }
  p.wheels.forEach((w, i) => wheelUpdate(ctx, w, modes[i]!, p.steer));
}

const rnd = { x: 0, y: 0, z: 0 };

/**
 * `gm_player_die` : l'objet accroché au joueur devient un gros éclat (`0044412c`) lancé par la table pseudo-aléatoire × 9 (vitesse
 * verticale positive), cap = x de l'entrée suivante.
 */
export function flingAttached(world: World, o: GameObject): void {
  o.update = "fx_debris";
  nextRandom(world, rnd);
  o.vx = rnd.x * 9;
  o.vy = Math.abs(rnd.y) * 9;
  o.vz = rnd.z * 9;
  o.yaw = peekRandomX(world);
}

/** `gm_player_die`, formes 1 et 2 : chaque roue devient un gros éclat (`flingAttached`) de modèle `0x3d4`. */
export function flingPlayerWheels(world: World, p: Player): void {
  for (const w of p.wheels) {
    flingAttached(world, w);
    w.model = WHEEL_MODEL;
  }
  p.wheels = [];
}
