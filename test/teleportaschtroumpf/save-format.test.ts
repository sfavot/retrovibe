import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../src/engine/infogrames/rng";
import { newGame } from "../../src/games/teleportaschtroumpf/game/rules";
import { Commentary } from "../../src/games/teleportaschtroumpf/scenes/grand-schtroumpf/commentary";
import { SAVE_KEY, SAVE_VERSION, captureSave, clearSave, parseSave, readSave, writeSave } from "../../src/games/teleportaschtroumpf/scenes/save";
import { MemoryStorage } from "./engine-test-host";

function sample() {
  const rng = new BorlandRandom(1234);
  const game = newGame({ players: [{ character: 0 }, { character: 3 }] }, rng);
  game.tick(42);
  const commentary = new Commentary();
  commentary.restore({ said: [3, 202], lastProgressRound: 6, lastCommentRound: 5 });
  return { rng, game, commentary };
}

describe("sauvegarde : format", () => {
  it("un aller-retour JSON redonne un état identique (partie, hasard, mémoire des répliques)", () => {
    const { rng, game, commentary } = sample();
    const save = captureSave(game, rng, { commentary: commentary.snapshot(), introShown: true, warning: 31 });
    const back = parseSave(JSON.parse(JSON.stringify(save)));
    expect(back).toEqual(save);
    expect(back!.state.elapsed).toBe(42);
    expect(back!.rng).toBe(rng.current);
  });

  it("la sauvegarde est une copie : la partie qui continue ne la modifie pas", () => {
    const { rng, game, commentary } = sample();
    const save = captureSave(game, rng, { commentary: commentary.snapshot(), introShown: false, warning: null });
    const before = JSON.stringify(save);
    game.tick(10);
    game.player.points = 5;
    expect(JSON.stringify(save)).toBe(before);
  });

  it("le générateur repart exactement où il était (graine d'un état lu), la mémoire des répliques aussi", () => {
    const { rng, commentary } = sample();
    rng.next();
    const state = rng.current;
    const expected = [rng.next(), rng.next(), rng.next()];
    const other = new BorlandRandom(99);
    other.seed(state);
    expect([other.next(), other.next(), other.next()]).toEqual(expected);
    const copy = new Commentary();
    copy.restore(JSON.parse(JSON.stringify(commentary.snapshot())));
    expect(copy.snapshot()).toEqual(commentary.snapshot());
  });

  it("écriture, lecture et effacement dans le stockage", () => {
    const storage = new MemoryStorage();
    const { rng, game, commentary } = sample();
    expect(readSave(storage)).toBeNull();
    const save = captureSave(game, rng, { commentary: commentary.snapshot(), introShown: true, warning: null });
    writeSave(storage, save);
    expect(readSave(storage)).toEqual(save);
    clearSave(storage);
    expect(readSave(storage)).toBeNull();
  });

  it("une sauvegarde illisible, d'une autre version ou incohérente est ignorée et effacée", () => {
    const { rng, game, commentary } = sample();
    const good = captureSave(game, rng, { commentary: commentary.snapshot(), introShown: true, warning: null });
    const bad: unknown[] = [
      "{pas du json",
      "[]",
      "null",
      JSON.stringify({ ...good, version: SAVE_VERSION + 1 }),
      JSON.stringify({ ...good, version: undefined }),
      JSON.stringify({ ...good, state: { ...good.state, players: [] } }),
      JSON.stringify({ ...good, state: { ...good.state, current: 5 } }),
      JSON.stringify({ ...good, state: { ...good.state, phase: "over" } }),
      JSON.stringify({ ...good, state: { ...good.state, players: [{ ...good.state.players[0], screen: 99 }] } }),
      JSON.stringify({ ...good, rng: "x" }),
      JSON.stringify({ ...good, commentary: null }),
      JSON.stringify({ ...good, warning: 9999 }),
      JSON.stringify({ ...good, warning: 30 }),
      JSON.stringify({ ...good, state: { ...good.state, paused: true } }),
      JSON.stringify({ ...good, state: { ...good.state, turn: { ...good.state.turn, inside: [1] } } }),
      JSON.stringify({ ...good, state: { ...good.state, turn: { ...good.state.turn, released: "x" } } }),
      JSON.stringify({ ...good, commentary: { ...good.commentary, said: [1e9] } }),
    ];
    for (const raw of bad) {
      const storage = new MemoryStorage();
      storage.set(SAVE_KEY, raw as string);
      expect(readSave(storage), String(raw)).toBeNull();
      expect(storage.get(SAVE_KEY)).toBeFalsy();
    }
  });

  it("n'en retient que les champs connus et accepte les vidéos d'avertissement 31 à 35", () => {
    const { rng, game, commentary } = sample();
    const good = captureSave(game, rng, { commentary: commentary.snapshot(), introShown: true, warning: 35 });
    const parsed = parseSave({ ...good, extra: "x" });
    expect(parsed).toEqual(good);
    expect(parsed && "extra" in parsed).toBe(false);
  });
});
