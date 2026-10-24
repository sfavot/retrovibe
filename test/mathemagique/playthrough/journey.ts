import { SceneId } from "../../../src/games/mathemagique/engine/scene";
import { playBowling, playBowlingTimeout, playPatternWindows, playRhythm, playRockets } from "./activities";
import { monkeyTour } from "./chaos";
import { bootToHub, createPlayer, hubHelp, hubRest, quit, setPreferences } from "./hub";
import { playHidden, playPatterns, playSticklers } from "./puzzles";
import { Abort, type Robot } from "./robot";

export type ActivityName = "hidden" | "patterns" | "sticklers" | "rockets" | "bowling" | "rhythm" | "patternWindows";

export interface SeedReport {
  seed: number;
  path: string[];
  violations: Robot["violations"];
  simSeconds: number;
  realSeconds: number;
  frames: number;
  /** Activités terminées (retour au hub). */
  visited: string[];
  completed: boolean;
  certificates: number;
  /** Maxima audio : WAVE simultanés, handles ouverts, boucles ; WAVE lancés au total, notes MIDI. */
  audio: { live: number; open: number; loops: number; waves: number; notes: number; resets: number };
}

/** Remet le robot au hub si une activité est restée en route : Exit du moteur, puis scène demandée en dernier recours. */
async function recover(r: Robot, name: string): Promise<void> {
  if (r.currentId === SceneId.hub) return;
  r.engine.requestExit();
  if (await r.tryUntil(() => r.currentId === SceneId.hub, 60_000)) return;
  r.note(`${name} : sortie forcée vers le hub`);
  r.engine.scenes.request(SceneId.hub);
  await r.tryUntil(() => r.currentId === SceneId.hub, 60_000);
}

async function guarded(r: Robot, name: string, visited: string[], body: () => Promise<void>): Promise<void> {
  const before = r.violations.length;
  try {
    await body();
  } catch (error) {
    if (error instanceof Abort) throw error;
    r.problem("robot", `${name} : ${error instanceof Error ? (error.stack?.split("\n").slice(0, 3).join(" | ") ?? error.message) : String(error)}`);
  }
  await recover(r, name);
  if (r.currentId === SceneId.hub) {
    visited.push(name);
    await r.run(500);
    r.checkRoster(`retour au hub après ${name}`, true);
  }
  void before;
}

/** Une graine complète : titre → hub → joueur → toutes les activités → préférences → sifflet. */
export async function playSeed(r: Robot): Promise<SeedReport> {
  const visited: string[] = [];
  let completed = false;
  try {
    if (await bootToHub(r)) {
      await createPlayer(r);
      // Préférences : une première bascule de l'ambiance (musique) au hasard.
      await setPreferences(r, { ambient: r.rng.chance(0.7) });
      const order: ActivityName[] = r.rng.shuffle(["hidden", "patterns", "sticklers", "rockets", "bowling", "rhythm", "patternWindows"] as const);
      const helpIn = new Set<ActivityName>(r.rng.shuffle(["hidden", "rockets", "bowling", "rhythm", "patternWindows"] as const).slice(0, 2 + r.rng.below(2)));
      let modeFlip = r.rng.chance(0.5);
      for (const name of order) {
        // Le mode du pointeur alterne d'une activité à l'autre (réglé par les préférences, comme le ferait un joueur).
        const wantClickAndStick = modeFlip;
        modeFlip = !modeFlip;
        if (r.engine.ctx.roster.roster.clickAndStick !== wantClickAndStick) await setPreferences(r, { clickAndStick: wantClickAndStick });
        const drag = !r.engine.ctx.roster.roster.clickAndStick;
        const withHelp = helpIn.has(name);
        await guarded(r, name, visited, async () => {
          switch (name) {
            case "hidden":
              return playHidden(r, drag, withHelp);
            case "patterns":
              return playPatterns(r, drag);
            case "sticklers":
              return playSticklers(r, drag);
            case "rockets":
              return playRockets(r, withHelp);
            case "bowling":
              return playBowling(r, withHelp, true, r.rng.chance(0.4));
            case "rhythm":
              return playRhythm(r, drag, withHelp);
            case "patternWindows":
              return playPatternWindows(r, drag, withHelp);
          }
        });
        if (r.hub && r.rng.chance(0.3) && r.currentId === SceneId.hub) await hubHelp(r);
      }
      // Tournée du singe : clics et touches au hasard depuis le hub, sortie du moteur à chaque tour.
      await hubRest(r);
      await monkeyTour(r, 3);
      if (r.host.exited) {
        // Le singe a fermé le jeu par le sifflet : la partie est finie.
        r.checkRoster("après la sortie du singe", false);
        completed = true;
        r.finish();
        return report(r, visited, completed);
      }
      // Bowling chronométré : 2 s dans les préférences, une partie, puis retour à 180 s.
      await setPreferences(r, { bowlingSeconds: 2 });
      await guarded(r, "bowling (temps écoulé)", visited, () => playBowlingTimeout(r));
      await setPreferences(r, { bowlingSeconds: 180 });
      await hubRest(r);
      r.checkRoster("avant de quitter", true);
      completed = await quit(r);
      r.checkRoster("après le sifflet", false);
    }
  } catch (error) {
    if (!(error instanceof Abort)) r.problem("robot", `${error instanceof Error ? (error.stack?.split("\n").slice(0, 3).join(" | ") ?? error.message) : String(error)}`);
  }
  r.finish();
  return report(r, visited, completed);
}

function report(r: Robot, visited: string[], completed: boolean): SeedReport {
  return {
    seed: r.options.seed,
    path: r.path,
    violations: r.violations,
    simSeconds: r.simSeconds,
    realSeconds: r.realSeconds,
    frames: r.frames,
    visited,
    completed,
    certificates: r.certificates.files.length,
    audio: { ...r.peaks, waves: r.host.audio.started, notes: r.host.audio.midi.noteOns, resets: r.host.audio.midi.resets },
  };
}
