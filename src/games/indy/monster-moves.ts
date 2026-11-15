import {
  type MonsterHost,
  attackHero,
  awayFromHero,
  distance,
  randomDirection,
  step,
  towardHero,
} from "../../engine/desktop-adventures/monsters";
import type { Monster } from "../../engine/desktop-adventures/zone-state";

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


/** Un tick d'IA d'un ennemi d'Indy selon son type de déplacement. */
export function moveIndyMonster(m: Monster, host: MonsterHost): void {
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

