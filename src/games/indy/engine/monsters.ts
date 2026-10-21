import { type Character, FrameEntry, Layer, TileFlag } from "../data/types";
import type { Assets } from "./assets";
import { DIRECTION_VECTORS, Direction, type Point, directionOf, directionTo } from "./geometry";
import type { Rng } from "./rng";
import { type Monster, type ZoneState, isAlive } from "./zone-state";

/** Types de déplacement des ennemis d'Indy (champ `movementType` des personnages). */
export enum Movement {
  None = 0,
  /** Fonce sur le héros, recule un peu après avoir frappé (bandits, Nacom, SS). */
  Aggressive = 1,
  /** Patrouille dans une direction, charge quand le héros est proche (jaguar, nazis, démon). */
  Prowler = 2,
  /** Erre au hasard, attaque au contact (serpents, araignées, guerriers…). */
  Wanderer = 3,
  /** Reste sur place, se tourne vers le héros et tire s'il est armé. */
  Sentry = 4,
  /** Roule en ligne droite et rebondit sur les obstacles (rocher). */
  Roller = 5,
}

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

const randomDirection = (rng: Rng): Direction => rng.mod(4) as Direction;

function attackHero(m: Monster, host: MonsterHost): void {
  if (m.character.damage > 0) host.hurtHero(m.character.damage);
}

/** Déplace le monstre d'une case si possible ; frappe le héros s'il est sur le chemin. */
function step(m: Monster, dir: Direction, host: MonsterHost): "moved" | "attacked" | "blocked" {
  const v = DIRECTION_VECTORS[dir];
  const tx = m.x + v.x;
  const ty = m.y + v.y;
  m.facing = dir;
  if (tx === host.hero.x && ty === host.hero.y) {
    attackHero(m, host);
    return "attacked";
  }
  const zone = host.zone;
  if (!zone.inBounds(tx, ty) || zone.getTile(tx, ty, Layer.Object) !== -1) return "blocked";
  // Les monstres ne franchissent pas les portes.
  if (host.assets.hasFlag(zone.getTile(tx, ty, Layer.Floor), TileFlag.Floor | TileFlag.Doorway)) return "blocked";
  if (isMonsterTileAt(m, zone)) {
    zone.setTile(m.x, m.y, Layer.Object, -1);
  }
  m.x = tx;
  m.y = ty;
  return "moved";
}

function isMonsterTileAt(m: Monster, zone: ZoneState): boolean {
  const tile = zone.getTile(m.x, m.y, Layer.Object);
  return m.character.frames[0].includes(tile);
}

function towardHero(m: Monster, hero: Point, rng: Rng): Direction {
  const d = directionTo(m, hero);
  if (d.x !== 0 && d.y !== 0) return rng.mod(2) ? directionOf({ x: d.x, y: 0 }) : directionOf({ x: 0, y: d.y });
  return directionOf(d, m.facing);
}

function awayFromHero(m: Monster, hero: Point, rng: Rng): Direction {
  const d = directionTo(hero, m);
  if (d.x === 0 && d.y === 0) return randomDirection(rng);
  return towardHero(m, { x: m.x + d.x, y: m.y + d.y }, rng);
}

const distance = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

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

function act(m: Monster, host: MonsterHost): void {
  const { rng, hero } = host;
  if (m.cooldown > 0) {
    m.cooldown--;
    m.facing = towardHero(m, hero, rng);
    return;
  }
  switch (m.character.movementType as Movement) {
    case Movement.Aggressive: {
      if (rng.mod(2)) return;
      if (m.phase > 0) {
        m.phase--;
        step(m, rng.mod(2) ? awayFromHero(m, hero, rng) : randomDirection(rng), host);
        return;
      }
      if (step(m, towardHero(m, hero, rng), host) === "attacked") m.phase = 3;
      return;
    }
    case Movement.Prowler: {
      if (rng.mod(2)) return;
      const dir = distance(m, hero) < 2 || (distance(m, hero) < 5 && rng.mod(2)) ? towardHero(m, hero, rng) : m.preferredDirection;
      if (step(m, dir, host) === "blocked") {
        m.cooldown = rng.mod(3);
        m.preferredDirection = randomDirection(rng);
      }
      return;
    }
    case Movement.Wanderer: {
      if (rng.mod(2)) return;
      const dir = distance(m, hero) < 2 && rng.mod(2) ? towardHero(m, hero, rng) : randomDirection(rng);
      step(m, dir, host);
      return;
    }
    case Movement.Sentry: {
      m.facing = towardHero(m, hero, rng);
      if (distance(m, hero) === 1 && (m.x === hero.x || m.y === hero.y) && rng.mod(3) === 0) attackHero(m, host);
      return;
    }
    case Movement.Roller: {
      if (host.tick % 2) return;
      if (step(m, m.preferredDirection, host) === "blocked") {
        m.preferredDirection = randomDirection(rng);
      }
      return;
    }
    default:
      return;
  }
}

/** Un tick d'IA pour tous les monstres actifs de la zone. */
export function moveMonsters(host: MonsterHost): void {
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
      zone.setTile(m.x, m.y, Layer.Object, monsterTile(m.character, m.facing));
    }
  }
}

/** Le monstre meurt : sa tuile disparaît et il ne bouge plus. */
export function killMonster(m: Monster, zone: ZoneState): void {
  if (isMonsterTileAt(m, zone)) zone.setTile(m.x, m.y, Layer.Object, -1);
  m.enabled = false;
  m.bullet = null;
}
