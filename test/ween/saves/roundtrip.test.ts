import { describe, expect, it } from "vitest";
import { HeadlessHost } from "../../../src/engine/coktel/host";
import { MemoryStorage } from "../../../src/engine/storage";
import type { SaveEnvironment } from "../../../src/engine/coktel/definition";
import { createSystem } from "../../../src/engine/coktel/system";
import { WEEN, WeenGame } from "../../../src/games/ween/engine/ween";
import { INDEX_SIZE, WeenSaves, slotKey } from "../../../src/games/ween/engine/saves";
import { hasOriginalFiles } from "../helpers";
import { readOriginalStk } from "../engine/bench";

const silent = { playSample() {}, stopSample() {}, queuePcm() {}, clearQueue() {} };

/** Joue Ween (Échap : protection d'intro.tot sautée, MENU, EMAJ1000) jusqu'au chargement de `stopTot` sur `store`. */
async function playTo(store: MemoryStorage, stopTot = "EMAJ1000.TOT") {
  const host = new HeadlessHost({ readFile: (n) => (n.toUpperCase() === "INTRO.STK" ? readOriginalStk() : undefined) });
  // Le branchement de `ween.ts` : createSaves: ({ gfx, store }) => new WeenSaves(gfx, store)
  const definition = { ...WEEN, createSaves: ({ gfx, store }: SaveEnvironment) => new WeenSaves(gfx, store) };
  const system = createSystem({ host, soundBackend: silent, store, definition });
  const game = new WeenGame(host, system.sys, { maxSteps: 50_000_000 });
  const stop = new Error("stop");
  host.onImage = (n) => {
    if (n === 20) host.input.pushKey(0x011b);
  };
  game.hooks.onLoadTot = (_g, tot) => {
    if (tot.toUpperCase() === stopTot) throw stop;
  };
  await expect(game.start()).rejects.toBe(stop);
  return { game, host, saves: system.saves };
}

describe.skipIf(!hasOriginalFiles)("Ween : sauvegarde et reprise par le gestionnaire du jeu", () => {
  it("à EMAJ1000, sauvegarde dans l'emplacement k puis recharge dans un nouveau jeu : variables identiques, VAR(212) comprise", async () => {
    const store = new MemoryStorage();
    const first = await playTo(store);
    const vars = first.game.vars;
    const varSize = vars.size;
    expect(varSize).toBe(15540);
    // Ce que fait le script : index (600 octets) à l'offset 0 depuis une variable, puis l'emplacement (taille nulle)
    const k = 6;
    const at = 0x44;
    const keep = vars.bytes.slice(at, at + INDEX_SIZE);
    const index = new Uint8Array(INDEX_SIZE);
    index.set(new TextEncoder().encode("Début de partie"), k * 40);
    vars.bytes.set(index, at);
    expect(first.saves.save("CAT.INF", at, INDEX_SIZE, 0)).toBe(true);
    vars.bytes.set(keep, at);
    const snapshot = vars.bytes.slice();
    expect(first.saves.save("CAT.INF", 0, 0, INDEX_SIZE + k * varSize)).toBe(true);
    expect(JSON.parse(store.get(slotKey(k))!).v).toBe(1);

    // Nouvelle partie, mêmes états de départ, variables abîmées : le chargement les restitue
    const second = await playTo(store);
    const v2 = second.game.vars;
    expect(second.game.vars).not.toBe(vars);
    v2.bytes.fill(0x5a);
    expect(second.saves.load("CAT.INF", 0, 0, INDEX_SIZE + k * varSize)).toBe(true);
    expect(v2.bytes).toEqual(snapshot);
    // Reprise : les variables de protection (210 à 214) reviennent telles qu'à la sauvegarde
    for (const n of [210, 211, 212, 213, 214]) expect(v2.readVar32(n)).toBe(vars.readVar32(n));

    // Index des noms, lu comme le fait le menu (variable 0x44, 600 octets, offset 0)
    expect(second.saves.load("CAT.INF", at, INDEX_SIZE, 0)).toBe(true);
    const row = v2.bytes.subarray(at + k * 40, at + (k + 1) * 40);
    expect(new TextDecoder().decode(row.subarray(0, row.indexOf(0)))).toBe("Début de partie");
    expect(v2.bytes.subarray(at, at + 40).every((b) => b === 0)).toBe(true);
    expect(second.saves.getSize("CAT.INF")).toBe((k + 1) * varSize + INDEX_SIZE);
  });

  it("le bloc-notes écrit pendant une partie est relu dans la suivante", async () => {
    const store = new MemoryStorage();
    const first = await playTo(store);
    first.game.vars.bytes.set(new TextEncoder().encode("code 4721"), 2000);
    expect(first.saves.save("BLOC.INF", 2000, 600, 0)).toBe(true);
    const second = await playTo(store);
    expect(second.saves.getSize("BLOC.INF")).toBe(600);
    expect(second.saves.load("BLOC.INF", 3000, 600, 0)).toBe(true);
    expect(new TextDecoder().decode(second.game.vars.bytes.subarray(3000, 3009))).toBe("code 4721");
  });
});
