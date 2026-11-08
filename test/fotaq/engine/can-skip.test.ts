import { describe, expect, it } from "vitest";
import { parseCutaway } from "../../../src/games/fotaq/data/cut";
import { Input } from "../../../src/games/fotaq/engine/input";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { cutawayContext, enableActors, perform, requiredStates } from "./contexts";
import { realPlayer } from "./test-host";

describe("Input.canSkip : ce qu'Échap peut faire", () => {
  it("jeu libre : non", () => {
    expect(new Input().canSkip).toBe(false);
  });

  it("cinématique en cours : seulement si elle est sautable", () => {
    const input = new Input();
    input.cutawayRunning = true;
    input.canQuit = false;
    expect(input.canSkip).toBe(false);
    input.canQuit = true;
    expect(input.canSkip).toBe(true);
  });

  it("dialogue ou réplique en cours : seulement si on peut le quitter", () => {
    const input = new Input();
    input.dialogueRunning = true;
    input.canQuit = false;
    expect(input.canSkip).toBe(false);
    input.canQuit = true;
    expect(input.canSkip).toBe(true);
  });

  it("canQuit resté levé après la scène ne suffit pas", () => {
    const input = new Input();
    input.canQuit = true;
    expect(input.canSkip).toBe(false);
  });
});

/** Joue une cinématique et note `canSkip` à chaque tick (sans appuyer sur Échap). */
function sampleCanSkip(file: string): boolean[] {
  const context = cutawayContext(file);
  const { player, engine } = realPlayer({ room: context.room });
  player.settle();
  for (const [slot, value] of requiredStates(context.list)) engine.state.gameStates[slot] = value;
  enableActors(engine, context.room);
  const samples: boolean[] = [];
  perform(player, engine.playCutaway(file), { onTick: () => samples.push(engine.canSkip) });
  return samples;
}

describe.skipIf(!hasOriginalFiles)("FotaqEngine.canSkip", () => {
  it("jeu libre : non, avant comme après une cinématique", () => {
    const { player, engine } = realPlayer({ room: 1 });
    player.settle();
    expect(engine.canSkip).toBe(false);
    perform(player, engine.playCutaway("C39A.CUT"));
    expect(engine.canSkip).toBe(false);
  });

  it("une cinématique sautable (C73E) est passable pendant qu'elle joue", () => {
    expect(parseCutaway(readOriginal("C73E.CUT"), () => false).skippable).toBe(true);
    expect(sampleCanSkip("C73E.CUT").some(Boolean)).toBe(true);
  });

  it("une cinématique non sautable (C39A) ne l'est jamais", () => {
    expect(parseCutaway(readOriginal("C39A.CUT"), () => false).skippable).toBe(false);
    expect(sampleCanSkip("C39A.CUT").some(Boolean)).toBe(false);
  });
});
