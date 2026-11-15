import { DIRECTION_VECTORS, type Point, directionOf, directionTo } from "../../engine/desktop-adventures/geometry";
import {
  type MonsterHost,
  attackHero,
  distance,
  isOpenCell as isOpen,
  isDoorway,
  monsterTile,
  moveMonsterBy,
  randomDirection,
} from "../../engine/desktop-adventures/monsters";
import type { Rng } from "../../engine/desktop-adventures/rng";
import type { Monster } from "../../engine/desktop-adventures/zone-state";

/**
 * IA des ennemis de Yoda Stories, portée de WebFun (MIT, `engine/monster-move`).
 * Contrairement à Indy, les déplacements se font sur 8 directions (diagonales comprises).
 *
 * État réutilisé (champs génériques de `Monster`) :
 * - `phase` : mode « recul » (type 1), prochain point de passage (type 10), compteur d'attaque (type 6) ;
 * - `phaseFrames` : compteur de frames du mode (type 1), image d'animation 0 à 5 (type 12) ;
 * - `preferredDirection`, `cooldown` : comme dans l'original.
 */
export enum Movement {
  None = 0,
  /** Fonce sur le héros, recule après quelques coups ou au bout de 15 tours. */
  Charger = 1,
  /** Va tout droit, se tourne vers le héros quand il est à portée de main. */
  Prowler = 2,
  /** Erre au hasard, attaque au contact. */
  Wanderer = 3,
  /** Immobile, se tourne vers le héros. */
  Sit = 4,
  /** Propre à Indy : sans effet ici. */
  IndyOnly = 5,
  /** Suit ou fuit le héros un tour sur trois, par à-coups. */
  Erratic = 6,
  /** Comme Prowler, avec une pause plus longue après un obstacle. */
  Marcher = 7,
  /** Droïde : avance droit, dévie vers le héros ou au hasard de près. */
  Droid = 8,
  /** Avance tout droit un tour sur deux, change de direction contre un obstacle. */
  Walker = 9,
  /** Suit ses 4 points de passage en boucle. */
  Patrol = 10,
  /** Fuit le héros. */
  Scaredy = 11,
  /** Décor animé : ne bouge pas, cycle sur 6 images. */
  Animation = 12,
}

const NONE: Point = { x: 0, y: 0 };
const isNone = (v: Point) => v.x === 0 && v.y === 0;

/** Direction aléatoire sur 8 voisins (ou immobile), comme `randomDirection` de WebFun. */
function randomVector(rng: Rng): Point {
  const x = rng.mod(3) - 1;
  const y = rng.mod(3) - 1;
  return { x, y };
}

/** Direction préférée (cardinale) sous forme de vecteur. */
const preferred = (m: Monster): Point => DIRECTION_VECTORS[m.preferredDirection];

/** Vrai si le mouvement `v` mène à une case libre (un mouvement nul n'est jamais libre : la case est occupée par le monstre). */
const isFree = (m: Monster, v: Point, host: MonsterHost) => !isNone(v) && isOpen(host, m.x + v.x, m.y + v.y);

/**
 * Contourne un obstacle : si la case visée est prise, tente de glisser sur un côté ; sinon immobile.
 * L'ordre des essais alterne avec la parité du tick, comme l'original.
 */
function evade(m: Monster, v: Point, host: MonsterHost): Point {
  if (isNone(v)) return NONE;
  const tx = m.x + v.x;
  const ty = m.y + v.y;
  if (!host.zone.inBounds(tx, ty)) return NONE;
  if (isOpen(host, tx, ty)) return v;
  const s = host.tick % 2 === 0 ? 1 : -1;
  const tries: Point[] = v.x && !v.y ? [{ x: 0, y: -s }, { x: 0, y: s }] : !v.x && v.y ? [{ x: -s, y: 0 }, { x: s, y: 0 }] : [];
  if (v.x && v.y) {
    // Diagonale : retire une composante.
    tries.push({ x: -v.x, y: 0 }, { x: 0, y: -v.y });
  }
  for (const t of tries) {
    if (isOpen(host, tx + t.x, ty + t.y)) return { x: v.x + t.x, y: v.y + t.y };
  }
  return NONE;
}

const canMelee = (m: Monster, v: Point, host: MonsterHost) => m.x + v.x === host.hero.x && m.y + v.y === host.hero.y;

/** Attaque au corps à corps seulement pour les ennemis sans arme (les armés tirent). */
function meleeIfUnarmed(m: Monster, hit: boolean, host: MonsterHost): void {
  if (m.character.reference < 0 && hit) attackHero(m, host);
}

/** Oriente le monstre vers le héros s'il est aligné (sinon garde son regard). */
function faceHero(m: Monster, host: MonsterHost): void {
  const d = directionTo(m, host.hero);
  if (d.x === 0 || d.y === 0) m.facing = directionOf(d, m.facing);
}

/** Applique le déplacement `v` : ignoré si la case est occupée, hors zone ou une porte. Sans mouvement, regarde le héros. */
function perform(m: Monster, v: Point, host: MonsterHost): void {
  if (!moveMonsterBy(m, v, host)) faceHero(m, host);
}

/** Pause et nouvelle direction préférée après un obstacle. */
function bump(m: Monster, cooldown: number, rng: Rng): void {
  m.cooldown = cooldown;
  m.preferredDirection = randomDirection(rng);
}

/** Un tick d'IA d'un ennemi de Yoda selon son type de déplacement. */
/**
 * Tuile d'un monstre de Yoda : le type « animation » fait défiler les 6 premières entrées de sa frame
 * (`updateFaceAndRedraw` de WebFun) ; les autres sont tournés dans la direction de leur regard.
 */
export function yodaMonsterTile(m: Monster): number {
  const frame = m.character.frames[0];
  if (m.character.movementType === Movement.Animation && frame[m.phaseFrames] >= 0) return frame[m.phaseFrames];
  return monsterTile(m.character, m.facing);
}

export function moveYodaMonster(m: Monster, host: MonsterHost): void {
  const { rng, hero } = host;
  const type = m.character.movementType as Movement;
  if (type === Movement.None || type === Movement.IndyOnly) return;

  const toHero = directionTo(m, hero);
  const awayFromHero = directionTo(hero, m);
  const close = distance(m, hero) < 2;
  const idle = () => perform(m, NONE, host);

  // Types sans pause de recharge (le droïde la consulte plus loin, après avoir lu la position du héros).
  switch (type) {
    case Movement.Sit:
      return faceHero(m, host);
    case Movement.Animation:
      m.phaseFrames = (m.phaseFrames + 1) % 6;
      return faceHero(m, host);
    case Movement.Scaredy: {
      let dir = distance(m, hero) < 6 ? awayFromHero : randomVector(rng);
      for (let attempt = 0; attempt < 8; attempt++) {
        dir = evade(m, dir, host);
        if (canMelee(m, dir, host)) {
          attackHero(m, host);
          return idle();
        }
        if (isNone(dir)) return idle();
        const tx = m.x + dir.x;
        const ty = m.y + dir.y;
        if (!isDoorway(host, tx, ty)) return perform(m, dir, host);
        dir = randomVector(rng);
      }
      return idle();
    }
  }

  if (m.cooldown > 0) {
    m.cooldown--;
    return idle();
  }

  switch (type) {
    case Movement.Charger: {
      if (!rng.mod(2)) return idle();
      const retreating = () => m.phase > 0;
      let dir: Point;
      if (retreating()) {
        dir = rng.mod(2) ? randomVector(rng) : awayFromHero;
        if (++m.phaseFrames > 3) {
          m.phase = 0;
          m.phaseFrames = 0;
        }
      } else {
        dir = toHero;
      }
      dir = evade(m, dir, host);
      if (canMelee(m, dir, host)) {
        dir = NONE;
        attackHero(m, host);
        if (++m.phaseFrames > 1) {
          m.phase = 1;
          m.phaseFrames = 0;
        }
      }
      if (!retreating() && ++m.phaseFrames >= 15) {
        m.phase = 1;
        m.phaseFrames = 0;
      }
      return perform(m, dir, host);
    }
    case Movement.Prowler: {
      if (!rng.mod(2)) return idle();
      let dir: Point;
      if (!close) dir = preferred(m);
      else if (rng.mod(2)) dir = evade(m, toHero, host);
      else dir = randomVector(rng);
      if (!isFree(m, dir, host)) {
        dir = NONE;
        bump(m, rng.mod(3), rng);
      }
      if (canMelee(m, dir, host)) {
        attackHero(m, host);
        return idle();
      }
      return perform(m, dir, host);
    }
    case Movement.Wanderer: {
      if (!rng.mod(2)) return idle();
      let dir = close && rng.mod(2) ? toHero : randomVector(rng);
      dir = evade(m, dir, host);
      if (canMelee(m, dir, host)) {
        meleeIfUnarmed(m, true, host);
        return idle();
      }
      return perform(m, dir, host);
    }
    case Movement.Erratic: {
      if (host.tick % 3) return idle();
      if (!m.phase) m.phase = host.tick % 10 ? 0 : 1;
      let dir = m.phase ? toHero : awayFromHero;
      if (distance(m, hero) < 6) dir = randomVector(rng);
      dir = evade(m, dir, host);
      if (canMelee(m, dir, host)) {
        meleeIfUnarmed(m, true, host);
        m.phase = (m.phase + 1) % 5;
        return idle();
      }
      return perform(m, dir, host);
    }
    case Movement.Marcher: {
      if (!rng.mod(2)) return idle();
      let dir: Point;
      if (!close) {
        dir = preferred(m);
        if (!isFree(m, dir, host)) {
          dir = NONE;
          bump(m, rng.mod(8), rng);
        }
      } else {
        dir = evade(m, toHero, host);
      }
      if (canMelee(m, dir, host)) {
        attackHero(m, host);
        return idle();
      }
      return perform(m, dir, host);
    }
    case Movement.Droid: {
      let dir: Point;
      let canEvade: boolean;
      if (!close) {
        if (rng.mod(3)) {
          canEvade = false;
          dir = preferred(m);
        } else {
          canEvade = true;
          dir = randomVector(rng);
        }
      } else {
        canEvade = true;
        dir = rng.mod(2) ? toHero : randomVector(rng);
      }
      if (canEvade) dir = evade(m, dir, host);
      else if (!isFree(m, dir, host)) {
        dir = NONE;
        bump(m, rng.mod(10), rng);
      }
      if (canMelee(m, dir, host)) {
        meleeIfUnarmed(m, !rng.mod(2), host);
        return idle();
      }
      return perform(m, dir, host);
    }
    case Movement.Walker: {
      if (host.tick % 2 === 0) return idle();
      let dir = preferred(m);
      if (!isFree(m, dir, host)) {
        dir = NONE;
        bump(m, rng.mod(3), rng);
      }
      if (canMelee(m, dir, host)) {
        meleeIfUnarmed(m, true, host);
        return idle();
      }
      return perform(m, dir, host);
    }
    case Movement.Patrol: {
      if (host.tick % 2 === 0) return idle();
      const w = host.zone.zone.monsters[m.index]?.waypoints;
      if (!w || w.length < 8) return idle();
      const i = m.phase & 3;
      const dir = directionTo(m, { x: w[2 * i], y: w[2 * i + 1] });
      if (isNone(dir)) m.phase = (i + 1) & 3;
      if (canMelee(m, dir, host)) {
        attackHero(m, host);
        return idle();
      }
      return perform(m, dir, host);
    }
  }
}
