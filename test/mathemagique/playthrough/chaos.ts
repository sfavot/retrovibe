import { SceneId } from "../../../src/games/mathemagique/engine/scene";
import { helpSession } from "./help";
import type { Robot } from "./robot";

/** Zone à éviter : centre et rayon (le bouton de sortie, que le singe ne doit pas presser par hasard). */
export type Avoid = readonly [x: number, y: number, radius: number];

const KEYS: readonly (readonly [code: string, key: string])[] = [
  ["Space", " "],
  ["Enter", "Enter"],
  ["Tab", "Tab"],
  ["Escape", "Escape"],
  ["Backspace", "Backspace"],
  ["ArrowLeft", "ArrowLeft"],
  ["ArrowDown", "ArrowDown"],
  ["KeyA", "a"],
  ["KeyX", "x"],
  ["KeyZ", "z"],
  ["Digit1", "1"],
  ["Digit4", "4"],
  ["Digit9", "9"],
];

/**
 * « Singe » : pendant `ms` millisecondes simulées, des clics gauches, droits, des déplacements, des doubles clics, des touches et des
 * appuis tenus à des endroits au hasard (hors des zones à éviter). Les invariants du robot continuent de veiller.
 */
export async function monkey(r: Robot, ms: number, avoid: readonly Avoid[] = []): Promise<void> {
  const end = r.host.time + ms;
  while (r.host.time < end && !r.host.exited) {
    const x = r.rng.below(576);
    const y = r.rng.below(432);
    if (avoid.some(([ax, ay, radius]) => Math.hypot(x - ax, y - ay) < radius)) continue;
    const roll = r.rng.next();
    if (roll < 0.45) {
      r.host.click(x, y);
    } else if (roll < 0.55) {
      r.host.click(x, y, "right");
    } else if (roll < 0.65) {
      r.host.click(x, y);
      r.host.click(x, y);
    } else if (roll < 0.75) {
      // Appui tenu, déplacé, relâché ailleurs (un glissé).
      r.host.input.moveMouse(x, y);
      r.host.input.mouseDown("left");
      await r.run(60);
      const x2 = r.rng.below(576);
      const y2 = r.rng.below(432);
      if (!avoid.some(([ax, ay, radius]) => Math.hypot(x2 - ax, y2 - ay) < radius)) r.host.input.moveMouse(x2, y2);
      await r.run(60);
      r.host.input.mouseUp("left");
    } else if (roll < 0.85) {
      r.host.input.moveMouse(x, y);
    } else {
      const [code, key] = r.rng.pick(KEYS);
      r.host.press(code, { key });
    }
    await r.run(30 + r.rng.below(250));
  }
}

/**
 * Tournée du singe : depuis le hub, des clics au hasard partout (ils lancent des activités, ouvrent le moniteur, l'aide…), puis la demande
 * de sortie du moteur (`requestExit`, fermeture de l'onglet) ramène au hub, où le robot reprend la main.
 */
export async function monkeyTour(r: Robot, rounds: number): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await monkey(r, 5000 + r.rng.below(6000));
    if (await quitByMonkey(r)) return;
    if (!(await settleHub(r))) {
      r.problem("bloqué", `tournée du singe : la demande de sortie du moteur ne ramène pas au hub après 4 min simulées (${r.stateSummary()})`);
      r.engine.scenes.request(SceneId.hub);
      await r.tryUntil(() => r.currentId === SceneId.hub, 60_000);
    }
    r.note(`singe : tour ${round + 1}`);
    // Le singe a peut-être ouvert le moniteur du hub (connexion, trivia) ou l'aide : OK le referme, un clic sur Poly ferme l'aide.
    for (let attempt = 0; attempt < 5 && r.currentId === SceneId.hub && r.hub.monitorOpen; attempt++) {
      await r.click(278, 284, 2000);
    }
    if (r.currentId === SceneId.hub && r.hub.monitorOpen) r.problem("bloqué", "tournée du singe : le moniteur du hub ne se ferme pas avec OK");
    if (r.currentId === SceneId.hub && r.hub.helpMode) await helpSession(r, "Hub (singe)", [210, 362], () => r.hub.helpMode, [102, 359], []);
  }
}

/** Le singe a pu cliquer Quit puis le sifflet : le jeu se ferme (`host.exit()`), comme l'onglet se fermerait. */
async function quitByMonkey(r: Robot): Promise<boolean> {
  if (!r.host.exited) {
    // La sortie par le sifflet met quelques secondes (animations bloquantes) : si l'invite est en route, on la laisse finir.
    if (r.currentId !== SceneId.hub || r.hub.quitPhase !== "leaving") return false;
    await r.tryUntil(() => r.host.exited, 30_000);
    if (!r.host.exited) return false;
  }
  r.note("singe : le sifflet a fermé le jeu (host.exit)");
  return true;
}

/** Ramène au hub par la demande de sortie du moteur, et attend qu'aucune bascule ne soit en route (4 s de hub stable). */
async function settleHub(r: Robot): Promise<boolean> {
  let stableSince: number | null = null;
  for (let step = 0; step < 60; step++) {
    const settled = r.currentId === SceneId.hub && r.engine.scenes.pending === null && !r.engine.scenes.isLoading;
    if (settled) {
      stableSince ??= r.host.time;
      if (r.host.time - stableSince >= 4000) return true;
      await r.run(1000);
      continue;
    }
    stableSince = null;
    await r.closeMonitor();
    r.engine.requestExit();
    await r.run(4000);
  }
  return false;
}
