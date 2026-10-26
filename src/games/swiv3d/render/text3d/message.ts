/**
 * Messages flottants 3D (`gm_message_pool_init` `00422f28`, `gm_message_spawn` `00422f8c`, `gm_effects_tick` `004234ec`,
 * `gm_title_release` `004235d8` ; `docs/swiv3d/rules.md` § 8). Un message est une chaîne du jeu, une teinte (ligne de la table de couleurs
 * du bloc 11003) et un type qui fixe sa trajectoire. Tout est en entiers du jeu : la position est en unités de texte × 16 (le rendu
 * décale de 4), les angles en 1/16 de pas (512 pas par tour).
 *
 * Le type 0 est un message de ramassage ou d'objectif : il arrive en vol (60 ticks de pré-simulation), vit 70 ticks et repart.
 * Les types 10 (« Game over », « Accompli ») et 11 (titre des menus : Pause) arrivent, puis restent figés (vie 1000) jusqu'à
 * `releaseTitles` (sortie du menu), qui les fait repartir. Les autres types ne sont jamais demandés par le jeu.
 */

/** Taille du pool de l'exécutable : les messages en trop sont perdus. */
export const MESSAGE_POOL_SIZE = 50;
/** Valeur de vie qui fige le message (ni décompte, ni déplacement). */
export const HOLD_LIFE = 1000;
/** Retrait de `gm_title_release` : fait passer un message figé (vie 1000 et plus) à 20 ticks de la fin. */
const RELEASE_DROP = 0x3d4;
/** Tant que la vie dépasse 10, le message tourne ; en dessous il ne fait plus que filer. */
const SPIN_LIFE = 10;

export type MessageType = 0 | 10 | 11;

export interface Message3D {
  /** Octets du texte (`|` sépare les lignes). */
  text: Uint8Array;
  /** Teinte : ligne × 256 de la table de couleurs (`0x1000` rouge, `0x400`, `0x100`, `0x1400`), à laquelle s'ajoute la lumière 0..127. */
  tint: number;
  /** Position `(+8, +0xc, +0x10)` ; vitesse `(+0x14, +0x18, +0x1c)`. */
  pos: [number, number, number];
  vel: [number, number, number];
  /** Angles `(+0x20, +0x24, +0x28)` et leur vitesse `(+0x2c, +0x30, +0x34)`. */
  rot: [number, number, number];
  rotVel: [number, number, number];
  /** Ticks restants (`+0x38`) : le message disparaît sous 0. */
  life: number;
  /** Décalage vertical en pixels (`+0x40`). */
  yOffset: number;
}

interface Trajectory {
  pos: [number, number, number];
  vel: [number, number, number];
  rot: [number, number, number];
  rotVel: [number, number, number];
  life: number;
  yOffset: number;
  /** Ticks reculés à la création : le message démarre déjà en vol. */
  presim: number;
}

/** Valeurs écrites par `gm_message_spawn` (`00422ff2`, `0042309d`, `0042313e`). */
const TRAJECTORIES: Record<MessageType, Trajectory> = {
  0: { pos: [0, -40000, 0], vel: [6400, -3000, 7000], rot: [-480, 240, 160], rotVel: [32, 63, 44], life: 70, yOffset: 0, presim: 60 },
  10: { pos: [0, 0, 0], vel: [-6400, -3000, 7000], rot: [300, 0, 0], rotVel: [0, 45, 0], life: 0x438, yOffset: -140, presim: 80 },
  11: { pos: [0, 0, 0], vel: [6400, -5000, 8000], rot: [300, 0, 0], rotVel: [0, 45, 0], life: 0x407, yOffset: -140, presim: 30 },
};

export class MessagePool {
  readonly active: Message3D[] = [];

  /** Ajoute un message ; `null` si le type n'existe pas dans le jeu ou si le pool de 50 est plein. */
  spawn(text: Uint8Array, tint: number, type: number): Message3D | null {
    const t = TRAJECTORIES[type as MessageType];
    if (!t || this.active.length >= MESSAGE_POOL_SIZE) return null;
    const m: Message3D = {
      text,
      tint,
      pos: [...t.pos],
      vel: [...t.vel],
      rot: [...t.rot],
      rotVel: [...t.rotVel],
      life: t.life,
      yOffset: t.yOffset,
    };
    for (let k = 0; k < t.presim; k++) {
      for (let a = 0; a < 3; a++) {
        m.rot[a]! -= m.rotVel[a]!;
        m.pos[a]! -= m.vel[a]!;
      }
    }
    this.active.push(m);
    return m;
  }

  /** Un tick logique (40 Hz) : décompte, rotation tant que la vie dépasse 10, déplacement sauf figé. */
  tick(): void {
    let kept = 0;
    for (const m of this.active) {
      if (m.life !== HOLD_LIFE) m.life--;
      if (m.life < 0) continue;
      this.active[kept++] = m;
      if (m.life > SPIN_LIFE) for (let a = 0; a < 3; a++) m.rot[a]! += m.rotVel[a]!;
      if (m.life !== HOLD_LIFE) for (let a = 0; a < 3; a++) m.pos[a]! += m.vel[a]!;
    }
    this.active.length = kept;
  }

  /** Fait repartir les messages figés (sortie d'un menu) : `gm_title_release`. */
  releaseTitles(): void {
    for (const m of this.active) if (m.life >= HOLD_LIFE) m.life -= RELEASE_DROP;
  }

  clear(): void {
    this.active.length = 0;
  }
}
