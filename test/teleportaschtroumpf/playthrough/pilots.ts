import type { Scene } from "../../../src/games/teleportaschtroumpf/engine/scene";
import { BlackSmurfsScene, TARGETS, TARGET_UP } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s28-black-smurfs";
import { BirthdayScene, CANDLE_LIT } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s29-birthday";
import { BridgeScene } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s30-bridge";
import { DragonScene } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s22-dragon";
import { MusicianScene } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s23-musician";
import { MineScene } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s36-mine";
import { LANE_CENTER, LANE_LEFT, hasObstacle, hasSwitch } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s36/run";
import type { RobotHost } from "./host";

/**
 * Pilotes automatiques des mini-jeux, repris de ceux des tests de `minigames/` (qui les gardent dans leurs fichiers de test) :
 * ils lisent l'état public de la scène et tiennent les touches comme un joueur. Un pilote est appelé à chaque image simulée ;
 * `release` relâche tout ce qu'il tient. Les mini-jeux sans pilote sont joués au hasard (`random.ts`).
 */
export interface Pilot {
  step(): void;
  release(): void;
}

/** Touches tenues par un pilote : seules les transitions arrivent à l'hôte. */
export class Keys {
  private readonly held = new Set<string>();
  constructor(private readonly host: RobotHost) {}

  set(code: string, down: boolean): void {
    if (down === this.held.has(code)) return;
    if (down) {
      this.held.add(code);
      this.host.input.keyDown(code);
    } else {
      this.held.delete(code);
      this.host.input.keyUp(code);
    }
  }

  releaseAll(): void {
    for (const code of [...this.held]) this.set(code, false);
  }
}

/** Fabrique le pilote du mini-jeu `id`, ou `null` s'il n'en existe pas. */
export function pilotFor(id: number, scene: Scene, host: RobotHost): Pilot | null {
  const keys = new Keys(host);
  switch (id) {
    case 22:
      return dragon(scene as DragonScene, keys);
    case 23:
      return musician(scene as MusicianScene, keys);
    case 28:
      return blackSmurfs(scene as BlackSmurfsScene, keys);
    case 29:
      return birthday(scene as BirthdayScene, keys);
    case 30:
      return bridge(scene as BridgeScene, keys);
    case 36:
      return mine(scene as MineScene, keys);
    default:
      return null;
  }
}

/** S22 : la pose qui esquive la voie du dragon qui approche (haut pour la voie basse, bas pour la médiane, rien pour la haute). */
function dragon(scene: DragonScene, keys: Keys): Pilot {
  return {
    step() {
      const { course } = scene;
      const want =
        scene.stage === "play" && course.approaching && course.x < 504 && course.x > 330
          ? course.lane === 2
            ? "ArrowUp"
            : course.lane === 1
              ? "ArrowDown"
              : null
          : null;
      keys.set("ArrowUp", want === "ArrowUp");
      keys.set("ArrowDown", want === "ArrowDown");
    },
    release: () => keys.releaseAll(),
  };
}

/** S23 : une touche par note attendue, tenue 3 images. La vidéo d'introduction est passée par Échap. */
function musician(scene: MusicianScene, keys: Keys): Pilot {
  const codes = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];
  let down: string | null = null;
  let frames = 0;
  let skip = 0;
  return {
    step() {
      if (down && ++frames >= 3) {
        keys.set(down, false);
        down = null;
      }
      if (scene.stage !== "listen") {
        // Vidéos d'introduction et de fin : Échap, relâché une image sur deux.
        keys.set("Escape", ++skip % 20 < 10);
        return;
      }
      keys.set("Escape", false);
      if (down) return;
      down = codes[scene.sequence[scene.progress]];
      frames = 0;
      keys.set(down, true);
    },
    release: () => keys.releaseAll(),
  };
}

/** S28 : vise le centre de la zone de la cible sortie aux flèches, puis tire. */
function blackSmurfs(scene: BlackSmurfsScene, keys: Keys): Pilot {
  let shot = 0;
  return {
    step() {
      if (shot > 0 && --shot === 0) keys.set("Space", false);
      const aiming = scene.targetState === TARGET_UP && scene.targetIndex >= 0;
      let tx = scene.cursor.x;
      let ty = scene.cursor.y;
      if (aiming) {
        const { zone } = TARGETS[scene.targetIndex];
        tx = (zone.left + zone.right) / 2;
        ty = (zone.top + scene.margin + zone.bottom - scene.margin) / 2;
      }
      const { x, y } = scene.cursor;
      keys.set("ArrowLeft", aiming && tx - x < -3);
      keys.set("ArrowRight", aiming && tx - x > 3);
      keys.set("ArrowUp", aiming && ty - y < -3);
      keys.set("ArrowDown", aiming && ty - y > 3);
      if (aiming && Math.abs(tx - x) <= 3 && Math.abs(ty - y) <= 3 && scene.canHit && shot === 0) {
        keys.set("Space", true);
        shot = 3;
      }
      // Hors partie : vidéo de fin, passable.
      if (scene.stage !== "play" && shot === 0) keys.set("Escape", true);
    },
    release: () => keys.releaseAll(),
  };
}

/** S29 : souffle la bougie visée si elle est allumée, sinon va vers l'allumée la plus proche. Décision à chaque itération de la boucle. */
function birthday(scene: BirthdayScene, keys: Keys): Pilot {
  let seen = 0;
  let down: string | null = null;
  return {
    step() {
      if (down) {
        keys.set(down, false);
        down = null;
      }
      if (scene.stage !== "play") {
        keys.set("Escape", true);
        return;
      }
      keys.set("Escape", false);
      if (scene.iterations === seen) return;
      seen = scene.iterations;
      const states = scene.states;
      const at = scene.position - 1;
      if (states[at] === CANDLE_LIT) down = "Space";
      else {
        let target = -1;
        for (let i = 0; i < states.length; i++) if (states[i] === CANDLE_LIT && (target < 0 || Math.abs(i - at) < Math.abs(target - at))) target = i;
        if (target >= 0) down = target > at ? "ArrowRight" : "ArrowLeft";
      }
      if (down) keys.set(down, true);
    },
    release: () => keys.releaseAll(),
  };
}

/** S30 : un clic à la dernière image de la fenêtre (3 points). */
function bridge(scene: BridgeScene, keys: Keys): Pilot {
  let clicked = false;
  return {
    step() {
      if (scene.stage === "video" && !clicked && scene.currentFrame >= 0x3e - 1) {
        clicked = true;
        keys.set("Space", true);
      } else if (scene.stage !== "video") keys.set("Space", false);
    },
    release: () => keys.releaseAll(),
  };
}

/** S36 : prend l'aiguillage qui évite l'obstacle de la voie, ou qui ramène vers le centre. */
function mine(scene: MineScene, keys: Keys): Pilot {
  return {
    step() {
      const run = scene.course;
      if (scene.stage !== "run" || run.switching) {
        keys.set("ArrowLeft", false);
        keys.set("ArrowRight", false);
        // Vidéo de fin : passable.
        keys.set("Escape", scene.stage !== "run");
        return;
      }
      const { flags, ref } = run.peek();
      const obstacle = hasObstacle(flags, run.x);
      let want: "left" | "right" | null = null;
      for (const direction of ["left", "right"] as const) {
        if (!hasSwitch(flags, run.x, direction)) continue;
        const towardCenter = (direction === "right") === (run.x === LANE_LEFT) && run.x !== LANE_CENTER;
        const window = direction === "right" ? 0x14 : 10;
        if ((obstacle || towardCenter) && run.y >= ref && run.y <= ref + window) {
          want = direction;
          break;
        }
      }
      keys.set("ArrowLeft", want === "left");
      keys.set("ArrowRight", want === "right");
    },
    release: () => keys.releaseAll(),
  };
}
