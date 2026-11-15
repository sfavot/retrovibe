import { type Character, FrameEntry, Layer, TileFlag } from "./data/types";
import type { Assets } from "./assets";
import { DIRECTION_VECTORS, Direction, type Point, directionOf, directionTo } from "./geometry";
import type { Rng } from "./rng";
import { type Monster, type ZoneState, isAlive } from "./zone-state";

const FACING_ENTRY: Record<Direction, FrameEntry> = {
  [Direction.Up]: FrameEntry.Up,
  [Direction.Down]: FrameEntry.Down,
  [Direction.Left]: FrameEntry.Left,
  [Direction.Right]: FrameEntry.Right,
};

export function monsterTile(character: Character, facing: Direction): number {
  const frame = character.frames[0];
  const tile = frame[FACING_ENTRY[facing]];
  return tile >= 0 ? tile : frame[FrameEntry.Down];
}

export interface MonsterHost {
  readonly zone: ZoneState;
  readonly assets: Assets;
  readonly rng: Rng;
  readonly tick: number;
  readonly hero: Point;
  /** Inflige des dégâts au héros (barème de difficulté appliqué par le jeu). */
  hurtHero(damage: number): void;
  playSound(id: number): void;
}

/** Pose les monstres actifs dans la couche objets à l'entrée initiale de la zone. */
export function placeMonsters(zone: ZoneState): void {
  for (const m of zone.monsters) {
    if (!m.enabled || zone.getTile(m.x, m.y, Layer.Object) !== -1) continue;
    zone.setTile(m.x, m.y, Layer.Object, monsterTile(m.character, m.facing));
  }
}

export const randomDirection = (rng: Rng): Direction => rng.mod(4) as Direction;

export function attackHero(m: Monster, host: MonsterHost): void {
  if (m.character.damage > 0) host.hurtHero(m.character.damage);
}

/** Case dans la zone et sans objet (les monstres eux-mêmes sont dans la couche objets). */
export function isOpenCell(host: MonsterHost, x: number, y: number): boolean {
  return host.zone.inBounds(x, y) && host.zone.getTile(x, y, Layer.Object) === -1;
}

/** Les monstres ne franchissent pas les portes. */
export function isDoorway(host: MonsterHost, x: number, y: number): boolean {
  return host.assets.hasFlag(host.zone.getTile(x, y, Layer.Floor), TileFlag.Floor | TileFlag.Doorway);
}

/**
 * Déplace le monstre selon `v` (une des 8 directions) si la case visée est libre, hors porte et hors héros ;
 * sa tuile quitte l'ancienne case (elle est redessinée à la nouvelle par `moveMonsters`). Renvoie vrai s'il a bougé.
 */
export function moveMonsterBy(m: Monster, v: Point, host: MonsterHost): boolean {
  const tx = m.x + v.x;
  const ty = m.y + v.y;
  if ((v.x === 0 && v.y === 0) || (tx === host.hero.x && ty === host.hero.y)) return false;
  if (!isOpenCell(host, tx, ty) || isDoorway(host, tx, ty)) return false;
  if (isMonsterTileAt(m, host.zone)) host.zone.setTile(m.x, m.y, Layer.Object, -1);
  m.x = tx;
  m.y = ty;
  m.facing = directionOf(v, m.facing);
  return true;
}

/** Pas cardinal : le monstre se tourne vers `dir`, frappe le héros s'il est sur le chemin, sinon avance si possible. */
export function step(m: Monster, dir: Direction, host: MonsterHost): "moved" | "attacked" | "blocked" {
  const v = DIRECTION_VECTORS[dir];
  m.facing = dir;
  if (m.x + v.x === host.hero.x && m.y + v.y === host.hero.y) {
    attackHero(m, host);
    return "attacked";
  }
  return moveMonsterBy(m, v, host) ? "moved" : "blocked";
}

function isMonsterTileAt(m: Monster, zone: ZoneState): boolean {
  const tile = zone.getTile(m.x, m.y, Layer.Object);
  return m.character.frames[0].includes(tile);
}

export function towardHero(m: Monster, hero: Point, rng: Rng): Direction {
  const d = directionTo(m, hero);
  if (d.x !== 0 && d.y !== 0) return rng.mod(2) ? directionOf({ x: d.x, y: 0 }) : directionOf({ x: 0, y: d.y });
  return directionOf(d, m.facing);
}

export function awayFromHero(m: Monster, hero: Point, rng: Rng): Direction {
  const d = directionTo(hero, m);
  if (d.x === 0 && d.y === 0) return randomDirection(rng);
  return towardHero(m, { x: m.x + d.x, y: m.y + d.y }, rng);
}

export const distance = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Tir des ennemis armés : un projectile en ligne droite quand le héros est aligné et proche. */
function updateBullet(m: Monster, host: MonsterHost): boolean {
  const weapon = host.assets.character(m.character.reference);
  if (!weapon || weapon.frames[0][FrameEntry.Left] < 0) return false;
  if (m.bullet) {
    const b = m.bullet;
    const nx = b.x + b.dx;
    const ny = b.y + b.dy;
    if (nx === host.hero.x && ny === host.hero.y) {
      attackHero(m, host);
      m.bullet = null;
      return true;
    }
    if (!host.zone.isFree(nx, ny) || b.travelled >= 4) {
      m.bullet = null;
      return false;
    }
    b.x = nx;
    b.y = ny;
    b.travelled++;
    return true;
  }
  const dx = host.hero.x - m.x;
  const dy = host.hero.y - m.y;
  const aligned = (dx === 0) !== (dy === 0);
  if (!aligned || Math.abs(dx) > 4 || Math.abs(dy) > 4 || host.rng.mod(7) !== 3) return false;
  const dir = { x: Math.sign(dx), y: Math.sign(dy) };
  m.facing = directionOf(dir);
  m.bullet = { x: m.x, y: m.y, dx: dir.x, dy: dir.y, travelled: 0 };
  if (weapon.reference >= 0) host.playSound(weapon.reference);
  return updateBullet(m, host);
}

/**
 * Un tick d'IA pour tous les monstres actifs de la zone : `act` décide du mouvement, `tileOf` de la tuile affichée
 * (par défaut, l'image tournée dans la direction du regard).
 */
export function moveMonsters(
  host: MonsterHost,
  act: (m: Monster, host: MonsterHost) => void,
  tileOf: (m: Monster) => number = (m) => monsterTile(m.character, m.facing),
): void {
  const zone = host.zone;
  for (const m of zone.monsters) {
    if (!m.enabled || !isAlive(m)) {
      m.bullet = null;
      continue;
    }
    if (!updateBullet(m, host)) act(m, host);
    // Redessine le monstre à sa position (le moteur original les stocke dans la couche objets).
    const current = zone.getTile(m.x, m.y, Layer.Object);
    if (current === -1 || m.character.frames[0].includes(current)) {
      zone.setTile(m.x, m.y, Layer.Object, tileOf(m));
    }
  }
}

/** Le monstre meurt : sa tuile disparaît et il ne bouge plus. */
export function killMonster(m: Monster, zone: ZoneState): void {
  if (isMonsterTileAt(m, zone)) zone.setTile(m.x, m.y, Layer.Object, -1);
  m.enabled = false;
  m.bullet = null;
}
