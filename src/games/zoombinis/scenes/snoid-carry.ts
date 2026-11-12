/**
 * Protocole de transport d'un personnage par le pointeur, commun au kit des épreuves (`puzzle-kit.ts`) et à Zoombiniville (`town.ts`) :
 * `1168:1742` (prise et suivi du pointeur) et `1168:58c7` (fin du transport). Chaque écran garde ce qui lui est propre (cibles de dépôt,
 * décision, retour) ; ce module ne porte que la boucle.
 *
 *  - **Suivi** : la position est celle du pointeur moins l'écart pris à la saisie (`local_6`, `local_8`), retenue dans le rectangle de zone
 *    (`DS:6092` par défaut, l'écran entier ; une épreuve peut donner le sien : `S14:13d8 + 8·falaise` aux véhibules). Le sens du pointeur
 *    depuis le tour précédent tourne le personnage (`+0xf2`).
 *  - **Fin** (`1168:58c7`) : relâcher le bouton dépose ; avec « souris aimantée » le transport est collé (relâcher ne dépose pas, le clic
 *    suivant dépose) ; avec « auto-aimantation » un appui plus court que `GameState.unknown02` (`[a438]`, 0 par défaut donc jamais) devient collé.
 *    Au doigt, un toucher sans glissement prend le personnage en main : le toucher suivant le dépose (extension tactile du port).
 *  - **Curseur** masqué pendant le transport si `hideCursorWhileCarrying` (`11e8:77bc`), rendu à la fin.
 *  - **Fin forcée** (`DS:96f4`) : `force()` dépose là où est le personnage, quel que soit le bouton.
 *  - **Garde** : `keep()` garde le personnage en main, collé ; le clic suivant décide de nouveau.
 */
import type { Input } from "../../../engine/mohawk/input";
import type { CursorKind } from "../engine/host";
import type { SceneContext } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/services";
import { ZOOMBINIS_GAME } from "../engine/game";
import type { Point } from "../data/zoombini";
import type { Rect } from "./puzzle-kit";
import type { Snoid } from "./snoid";

/** Délai entre deux images d'un Zoombini transporté (`+0x28 = 3`). */
export const CARRY_DELAY = 3;
/** Profondeur d'un Zoombini transporté (l'original le met devant tout : id `0xfffd`). */
export const CARRY_DEPTH = 1000;
/** Script d'animation de transport : `145 + pieds` (état 5, `146…150`). */
export const CARRY_SCRIPT_BASE = 145;

/** Zone où un Zoombini transporté peut aller (`DS:6092` par défaut dans l'original) : l'écran entier. */
export const SCREEN_BOUNDS: Readonly<Rect> = { left: 0, top: 0, right: SCREEN_WIDTH - 1, bottom: SCREEN_HEIGHT - 1 };

/** Écart (pixels de l'écran) en deçà duquel un doigt relâché n'a pas glissé : c'est un toucher (prise en main). */
export const TAP_SLOP = 4;

/** Curseur masqué pendant le transport (`11e8:77bc`) : `hidden` de `CursorKind`, associé à `none` par l'hôte du navigateur. */
export const HIDDEN_CURSOR: CursorKind = "hidden";

/** Ce qu'un tour de transport apprend à l'écran. */
export interface CarryStep {
  /** Position du personnage (pieds) : pointeur moins l'écart de saisie, retenu dans la zone. */
  position: Point;
  /** Sens du pointeur depuis le tour précédent (−1 gauche, 1 droite, 0). */
  direction: -1 | 0 | 1;
  /** Point du doigt quand le dernier appui vient d'un doigt, sinon null (souris : la règle de l'original seule). */
  finger: Point | null;
  /** Le transport est fini : l'écran dépose (ou garde, voir `keep`). */
  done: boolean;
}

export interface SnoidCarryInit {
  /** Pieds à la prise (retour par défaut). */
  origin: Point;
  /** Écart entre le pointeur et les pieds à la prise (défaut 0, 0). */
  grab?: Point;
  /** Abscisse du pointeur à la prise. */
  pointerX: number;
  /** Curseur masqué pendant le transport (défaut : l'option `hideCursorWhileCarrying`). */
  hideCursor?: boolean;
}

export class SnoidCarry {
  /** Pieds à la prise et écart pointeur / pieds à la prise (`local_6`, `local_8`). */
  readonly origin: Point;
  readonly grab: Point;
  /** Fin demandée par l'écran (`DS:96f4`). */
  forced = false;

  private readonly ctx: SceneContext;
  private readonly hidden: boolean;
  private readonly startedAt: number;
  private lastX: number;
  /** Transport collé (`DS:9b40`) et bouton tenu depuis la prise (`DS:9b3e`). */
  private sticky: boolean;
  private held = true;

  constructor(ctx: SceneContext, init: SnoidCarryInit) {
    this.ctx = ctx;
    this.origin = { ...init.origin };
    this.grab = { x: init.grab?.x ?? 0, y: init.grab?.y ?? 0 };
    this.lastX = init.pointerX;
    this.sticky = ctx.prefs.magneticMouse;
    this.startedAt = ctx.clock.ticks;
    this.hidden = init.hideCursor ?? ctx.prefs.hideCursorWhileCarrying;
    if (this.hidden) ctx.setCursor(HIDDEN_CURSOR);
  }

  /**
   * Un tour de `1168:1742` / `1168:58c7`. `pressed` : un appui est arrivé pendant ce tick (le transport collé le prend pour un clic de dépôt,
   * même si le bouton n'est plus tenu à la fin du tick).
   */
  step(bounds: Readonly<Rect>, pressed: boolean): CarryStep {
    const { input } = this.ctx;
    const position = {
      x: Math.max(bounds.left, Math.min(bounds.right, input.mouseX - this.grab.x)),
      y: Math.max(bounds.top, Math.min(bounds.bottom, input.mouseY - this.grab.y)),
    };
    const direction = input.mouseX < this.lastX ? -1 : input.mouseX > this.lastX ? 1 : 0;
    this.lastX = input.mouseX;
    const finger = this.touchPoint(input);
    let down = input.isButtonDown("left");
    let done = this.forced;
    if (!this.sticky) {
      if (!down) {
        const { game } = this.ctx.services.get(ZOOMBINIS_GAME);
        const quick = game.options.autoMagnet && this.ctx.clock.ticks - this.startedAt < game.unknown02;
        // Au doigt, un toucher sans glissement prend le personnage en main : le toucher suivant le dépose (prise puis toucher de la cible).
        const tapped = finger !== null && Math.abs(finger.x - this.origin.x - this.grab.x) <= TAP_SLOP && Math.abs(finger.y - this.origin.y - this.grab.y) <= TAP_SLOP;
        if (quick || tapped) this.keep();
        else done = true;
      }
    } else {
      if (pressed) down = true;
      if (this.held && !down) this.held = false;
      if (!this.held && down) done = true;
    }
    return { position, direction, finger, done };
  }

  /** Garde le personnage en main, collé : le clic suivant décide de nouveau (`"keep"`, auto-aimantation, toucher). */
  keep(): void {
    this.sticky = true;
    this.held = false;
  }

  /** Fin demandée par l'écran (`DS:96f4 = 1`) : le personnage est déposé là où il est. */
  force(): void {
    this.forced = true;
  }

  /** Rend le curseur (fin du transport, abandon ou sortie de l'écran). */
  release(): void {
    if (this.hidden) this.ctx.setCursor("system");
  }

  private touchPoint(input: Input): Point | null {
    return this.ctx.host.pointerIsTouch ? { x: input.mouseX, y: input.mouseY } : null;
  }
}

/** Pose de transport d'un personnage pris : délai 3 et animation `145 + pieds` (état 5). La profondeur est à l'écran (`CARRY_DEPTH`). */
export function poseCarried(snoid: Snoid): void {
  snoid.delay = CARRY_DELAY;
  snoid.play(CARRY_SCRIPT_BASE + snoid.traits.feet);
}

/** Tourne le personnage du côté où va le pointeur (`+0xf2`) ; sans mouvement, il garde son sens. */
export function faceDirection(snoid: Snoid, direction: -1 | 0 | 1): void {
  if (direction < 0) snoid.setFacing(1);
  else if (direction > 0) snoid.setFacing(0);
}
