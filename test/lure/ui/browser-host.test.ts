import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import type { LureAudio } from "../../../src/games/lure/audio/audio";
import { BrowserHost } from "../../../src/games/lure/ui/browser-host";

/** Son enregistré : les appels que l'hôte lui fait. */
function fakeAudio() {
  const calls: string[] = [];
  const state = { volume: 1 };
  const audio = {
    update: () => calls.push("update"),
    unlock: () => calls.push("unlock"),
    suspend: () => calls.push("suspend"),
    resume: () => calls.push("resume"),
    close: () => calls.push("close"),
    get volume() {
      return state.volume;
    },
    set volume(v: number) {
      state.volume = v;
    },
  };
  return { audio: audio as unknown as LureAudio, calls, state };
}

function makeHost() {
  const { audio, calls, state } = fakeAudio();
  const onExit = vi.fn();
  const onSaveDialog = vi.fn();
  const onRestartRestore = vi.fn();
  const storage = new MemoryStorage();
  const host = new BrowserHost({ audio, storage, onExit, onSaveDialog, onRestartRestore, now: () => 42 });
  return { host, calls, state, onExit, onSaveDialog, onRestartRestore, storage };
}

describe("BrowserHost", () => {
  it("l'horloge, le stockage des sauvegardes et la sortie sont ceux des options", () => {
    const { host, onExit, storage } = makeHost();
    expect(host.now()).toBe(42);
    expect(host.storage).toBe(storage);
    host.exit();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("« Sauvegarder » et « Restituer » de la barre de menus demandent la fenêtre des emplacements", () => {
    const { host, onSaveDialog } = makeHost();
    host.openSaveDialog(true);
    host.openSaveDialog(false);
    expect(onSaveDialog.mock.calls).toEqual([[true], [false]]);
  });

  it("la fin de partie (recommencer ou restituer) est posée à l'hôte, qui répond plus tard", () => {
    const { host, onRestartRestore } = makeHost();
    const answer = vi.fn();
    host.chooseRestartRestore(answer);
    expect(onRestartRestore).toHaveBeenCalledWith(answer);
  });

  it("pollInput rend ce que la souris, le doigt et le clavier ont mis en file, puis vide", () => {
    const { host } = makeHost();
    host.input.move(3, 4);
    host.input.action("escape");
    host.input.wheel(1);
    expect(host.pollInput()).toEqual([
      { type: "pointer", x: 3, y: 4, buttons: 0 },
      { type: "action", action: "escape" },
      { type: "wheel", delta: 1 },
    ]);
    expect(host.pollInput()).toEqual([]);
  });

  it("le volume de la joueuse passe au son", () => {
    const { host, state } = makeHost();
    host.setUserVolume(0.4);
    expect(state.volume).toBe(0.4);
    expect(host.volume).toBe(0.4);
  });

  it("update, unlock et close sont transmis au son", () => {
    const { host, calls } = makeHost();
    host.update();
    host.unlock();
    host.close();
    expect(calls).toEqual(["update", "unlock", "close"]);
  });

  it("pause : le son s'arrête et plus aucun bouton ni touche de combat n'est tenu ; reprise : le son repart", () => {
    const { host, calls } = makeHost();
    host.input.down(0, 5, 5);
    host.input.action("fightMoveLeft");
    host.pollInput();
    host.setPaused(true);
    expect(calls).toEqual(["suspend"]);
    expect(host.pollInput()).toEqual([
      { type: "pointer", x: 5, y: 5, buttons: 0 },
      { type: "actionEnd", action: "fightMoveLeft" },
    ]);
    host.setPaused(false);
    expect(calls).toEqual(["suspend", "resume"]);
  });
});
