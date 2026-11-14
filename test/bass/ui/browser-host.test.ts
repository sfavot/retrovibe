import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { BrowserHost, type HostAudio } from "../../../src/games/bass/ui/browser-host";

function makeHost() {
  const calls: string[] = [];
  const audio: HostAudio = {
    update: () => calls.push("update"),
    unlock: () => calls.push("unlock"),
    suspend: () => calls.push("suspend"),
    resume: () => calls.push("resume"),
    close: () => calls.push("close"),
  };
  const options = {
    storage: new MemoryStorage(),
    onExit: vi.fn(),
    onSaveRequest: vi.fn(),
    onRestoreRequest: vi.fn(),
    onSettings: vi.fn(),
    onVolume: vi.fn(),
    onButtons: vi.fn(),
    onClose: vi.fn(),
    now: () => 42,
  };
  const host = new BrowserHost(options);
  host.bindAudio(audio);
  return { host, calls, options };
}

describe("BrowserHost", () => {
  it("l'horloge, le stockage des sauvegardes et la sortie sont ceux des options", () => {
    const { host, options } = makeHost();
    expect(host.now()).toBe(42);
    expect(host.storage).toBe(options.storage);
    host.exit();
    expect(options.onExit).toHaveBeenCalledOnce();
  });

  it("« Sauvegarder » et « Restituer » du panneau demandent la fenêtre des emplacements ; les réglages sont transmis", () => {
    const { host, options } = makeHost();
    host.requestSave();
    host.requestRestore();
    host.settingsChanged({ musicVolume: 10, gameSpeed: 80, fxOff: false, textMode: "both" });
    expect(options.onSaveRequest).toHaveBeenCalledOnce();
    expect(options.onRestoreRequest).toHaveBeenCalledOnce();
    expect(options.onSettings).toHaveBeenCalledWith({ musicVolume: 10, gameSpeed: 80, fxOff: false, textMode: "both" });
  });

  it("pollInput rend ce que la souris, le doigt et le clavier ont mis en file, puis vide ; les boutons tenus sont signalés", () => {
    const { host, options } = makeHost();
    host.input.move(3, 4);
    host.input.down(0, 3, 4);
    host.input.action("skip");
    expect(options.onButtons).toHaveBeenCalledWith(2);
    const polled = [];
    for (let i = 0; i < 10; i++) polled.push(...host.pollInput());
    expect(polled).toEqual([
      { type: "move", x: 3, y: 4 },
      { type: "click", x: 3, y: 4, button: 2 },
      { type: "action", action: "skip" },
    ]);
    expect(host.pollInput()).toEqual([]);
  });

  it("le volume de la joueuse est celui de la musique (retenu et transmis)", () => {
    const { host, options } = makeHost();
    expect(host.volume).toBe(1);
    host.setUserVolume(0.4);
    expect(host.volume).toBe(0.4);
    expect(options.onVolume).toHaveBeenCalledWith(0.4);
  });

  it("update, unlock et close sont transmis au son ; close prévient la page", () => {
    const { host, calls, options } = makeHost();
    host.update();
    host.unlock();
    host.close();
    expect(calls).toEqual(["update", "unlock", "close"]);
    expect(options.onClose).toHaveBeenCalledOnce();
  });

  it("pause : le son s'arrête, le bouton tenu est relâché et les entrées sont refusées ; reprise : le son repart, la file est vide", () => {
    const { host, calls, options } = makeHost();
    host.input.down(0, 5, 5);
    host.pollInput();
    host.setPaused(true);
    expect(calls).toEqual(["suspend"]);
    expect(options.onButtons).toHaveBeenLastCalledWith(0);
    host.input.move(9, 9);
    host.input.action("pause");
    host.setPaused(false);
    expect(calls).toEqual(["suspend", "resume"]);
    expect(host.pollInput()).toEqual([]);
  });

  it("sans son lié (avant la création du moteur), rien ne plante", () => {
    const host = new BrowserHost({
      storage: new MemoryStorage(),
      onExit() {},
      onSaveRequest() {},
      onRestoreRequest() {},
      onSettings() {},
      onVolume() {},
      onButtons() {},
    });
    expect(() => {
      host.update();
      host.unlock();
      host.setPaused(true);
      host.close();
    }).not.toThrow();
  });
});
