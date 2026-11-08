import { describe, expect, it } from "vitest";
import { roomFiles } from "../../../src/games/fotaq/engine/room";
import { hasOriginalFiles } from "../helpers";
import { Player, gameData } from "./test-host";

describe.skipIf(!hasOriginalFiles)("fichiers du décor d'une pièce (roomFilesReady)", () => {
  it("le décor, plus le masque et la table de lumière quand la pièce en a", () => {
    const data = gameData();
    expect(roomFiles(data, 1, () => false)).toEqual(["C1.PCX"]);
    expect(roomFiles(data, 1, () => true)).toEqual(["C1.PCX", "C1.MSK", "C1.LUM"]);
    // Un masque sans table de lumière : pas de lumière dynamique, donc rien à attendre de plus.
    expect(roomFiles(data, 1, (name) => name === "C1.MSK")).toEqual(["C1.PCX"]);
  });

  it("le moteur attend que l'hôte ait les fichiers de la pièce avant de l'afficher, sans toucher à la pièce quittée", () => {
    const player = new Player({ room: 1 });
    const asked: string[][] = [];
    let ready = false;
    player.host.roomFilesReady = (files) => {
      asked.push([...files]);
      return ready;
    };
    player.run(30);
    // Rien n'est affiché : le moteur attend, un tick à la fois.
    expect(player.engine.busy).toBe(true);
    expect(asked.length).toBeGreaterThan(10);
    expect(asked[0][0]).toBe("C1.PCX");
    ready = true;
    player.settle();
    expect(player.state.room).toBe(1);
    expect(player.engine.busy).toBe(false);
  });
});
