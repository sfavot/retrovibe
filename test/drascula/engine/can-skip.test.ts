import { describe, expect, it } from "vitest";
import { wait } from "../../../src/engine/sequence";
import { CINEMATICS } from "../../../src/games/drascula/cinematics";
import { hasOriginalFiles } from "../helpers";
import { Player } from "./test-host";

describe.skipIf(!hasOriginalFiles)("DrasculaEngine.canSkip", () => {
  it("jeu libre : non", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    expect(player.engine.canSkip).toBe(false);
  });

  it("introduction : oui (Échap la saute), puis non une fois arrivé dans la pièce", () => {
    const player = new Player({ chapter: 1, script: { animations: CINEMATICS } });
    player.run(10);
    expect(player.engine.busy).toBe(true);
    expect(player.engine.canSkip).toBe(true);
    player.key("Escape");
    player.settle(60_000);
    expect(player.engine.canSkip).toBe(false);
  });

  it("réplique en cours : oui (toute touche la coupe), puis non", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    player.engine.run(player.engine.talk(1));
    player.run(3);
    expect(player.engine.subtitle).not.toBeNull();
    expect(player.engine.canSkip).toBe(true);
    player.settle();
    expect(player.engine.canSkip).toBe(false);
  });

  it("séquence non sautable sans réplique : non", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    player.engine.run(wait(100));
    player.run(3);
    expect(player.engine.busy).toBe(true);
    expect(player.engine.canSkip).toBe(false);
  });
});
