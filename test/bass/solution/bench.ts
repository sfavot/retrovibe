/**
 * Format commun à l'enregistrement de la partie complète (`bench-record.test.ts`) et à sa comparaison au banc ScummVM
 * (`scummvm-replay.test.ts`) : entrées par tour (`SKY_INPUT` du banc) et empreinte des variables (`SKY_VARHASH`). Voir `docs/bass/engine.md` § 20.
 */

import type { BassInput } from "../../../src/games/bass/engine/host";

/** Une entrée appliquée au début du tour `n` (avant `mouseEngine`). */
export interface TimedInput {
  n: number;
  event: BassInput;
}

/** Ligne d'entrée : `n m x y` (déplacement), `n c x y b` (clic, bouton 2 gauche, 1 droit), `n r x y` (relâchement), `n a action`. */
export function inputLine(n: number, event: BassInput): string {
  switch (event.type) {
    case "move":
      return `${n} m ${event.x} ${event.y}`;
    case "click":
      return `${n} c ${event.x} ${event.y} ${event.button}`;
    case "release":
      return `${n} r ${event.x} ${event.y}`;
    case "action":
      return `${n} a ${event.action}`;
  }
}

/** Inverse de `inputLine`. */
export function parseInputLine(line: string): TimedInput {
  const [n, op, a, b, c] = line.trim().split(/\s+/);
  const x = Number(a), y = Number(b);
  switch (op) {
    case "m":
      return { n: Number(n), event: { type: "move", x, y } };
    case "c":
      return { n: Number(n), event: { type: "click", x, y, button: Number(c) as 1 | 2 } };
    case "r":
      return { n: Number(n), event: { type: "release", x, y } };
    case "a":
      return { n: Number(n), event: { type: "action", action: a as Extract<BassInput, { type: "action" }>["action"] } };
    default:
      throw new Error(`entrée illisible : ${line}`);
  }
}

/** Empreinte FNV-1a des variables du jeu (octets de poids faible d'abord), comme la ligne `VH n h` du banc (`SKY_VARHASH=1`). */
export function varHash(vars: ArrayLike<number>): number {
  let h = 2166136261;
  for (let i = 0; i < vars.length; i++) {
    for (let k = 0; k < 4; k++) {
      h ^= (vars[i]! >>> (8 * k)) & 0xff;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h;
}
