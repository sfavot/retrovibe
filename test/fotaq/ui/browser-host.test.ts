import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { FileStore } from "../../../src/ui/file-store";
import type { FotaqAudio } from "../../../src/games/fotaq/audio/audio";
import { GameFiles } from "../../../src/games/fotaq/data/files";
import { BrowserHost, createSoundFiles } from "../../../src/games/fotaq/ui/browser-host";
import { RoomFiles } from "../../../src/games/fotaq/ui/preload";

const files = new GameFiles([
  { path: "B1.PCX", size: 3 },
  { path: "B1.MSK", size: 3 },
  { path: "voices/020001P2.mp3", size: 3 },
]);

/** Son enregistré : les appels que l'hôte lui fait. */
function fakeAudio() {
  const calls: string[] = [];
  const state = { speechOn: true, speechFound: true, speechActive: false, lastSong: 7, volume: 1 };
  const audio = {
    playSong: (n: number) => calls.push(`song ${n}`),
    playSfx: (n: number) => calls.push(`sfx ${n}`),
    playSpeech: (name: string) => calls.push(`speech ${name}`),
    stopSpeech: () => calls.push("stopSpeech"),
    stopSfx: () => calls.push("stopSfx"),
    preload: (names: readonly string[]) => (calls.push(`preload ${names.join(",")}`), Promise.resolve(names.length)),
    update: () => calls.push("update"),
    unlock: () => calls.push("unlock"),
    suspend: () => calls.push("suspend"),
    resume: () => calls.push("resume"),
    close: () => calls.push("close"),
    get speechOn() {
      return state.speechOn;
    },
    get speechFound() {
      return state.speechFound;
    },
    get speechActive() {
      return state.speechActive;
    },
    get lastSong() {
      return state.lastSong;
    },
    get volume() {
      return state.volume;
    },
    set volume(v: number) {
      state.volume = v;
    },
  };
  return { audio: audio as unknown as FotaqAudio, calls, state };
}

function makeHost() {
  const store = new FileStore();
  store.set("QUEEN.JAS", new Uint8Array([1, 2]));
  const { audio, calls, state } = fakeAudio();
  const fetcher = vi.fn(async (path: string) => new TextEncoder().encode(path));
  const rooms = new RoomFiles(store, files, fetcher);
  const present = vi.fn();
  const onExit = vi.fn();
  const onJournal = vi.fn();
  const host = new BrowserHost({ files: store, gameFiles: files, rooms, audio, storage: new MemoryStorage(), present, onExit, onJournal, now: () => 42 });
  return { host, calls, state, present, onExit, onJournal, store, rooms, fetcher };
}

describe("BrowserHost", () => {
  it("lit les fichiers préchargés (casse indifférente) et lève sur un fichier absent", () => {
    const { host } = makeHost();
    expect(host.readFile("queen.jas")).toEqual(new Uint8Array([1, 2]));
    expect(() => host.readFile("B1.PCX")).toThrow("introuvable");
    expect(host.fileExists("b1.msk")).toBe(true);
    expect(host.fileExists("B2.LUM")).toBe(false);
    expect(host.now()).toBe(42);
  });

  it("roomFilesReady : non tant que le décor n'est pas chargé (pastille), puis oui", async () => {
    const { host, fetcher } = makeHost();
    expect(host.roomFilesReady(["B1.PCX"])).toBe(false);
    expect(host.waitingForRoom).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.waitingForRoom = false;
    expect(host.roomFilesReady(["B1.PCX"])).toBe(true);
    expect(host.waitingForRoom).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("transmet l'image, le journal et la sortie", () => {
    const { host, present, onJournal, onExit } = makeHost();
    const pixels = new Uint8Array(1);
    host.present(pixels, new Uint8Array(1));
    expect(present).toHaveBeenCalledWith(pixels, expect.any(Uint8Array));
    host.openJournal();
    host.exit();
    expect(onJournal).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("son : morceaux, voix (vrai seulement si les voix sont actives et trouvées), préchargement, dernier morceau", () => {
    const { host, calls, state } = makeHost();
    host.playSong(12);
    host.playSfx(3);
    expect(host.playSpeech("020001P2")).toBe(true);
    state.speechFound = false;
    expect(host.playSpeech("NOPE")).toBe(false);
    state.speechFound = true;
    state.speechOn = false;
    expect(host.playSpeech("020001P2")).toBe(false);
    host.stopSpeech();
    host.stopSfx();
    host.preloadSpeech(["A", "B"]);
    expect(host.lastSong()).toBe(7);
    expect(calls).toEqual(["song 12", "sfx 3", "speech 020001P2", "speech NOPE", "speech 020001P2", "stopSpeech", "stopSfx", "preload A,B"]);
  });

  it("volume de la joueuse, mise à jour par image, pause (coupe le son et relâche les boutons), reprise", () => {
    const { host, calls, state } = makeHost();
    host.setUserVolume(0.4);
    expect(state.volume).toBe(0.4);
    expect(host.volume).toBe(0.4);
    host.update();
    host.unlock();
    host.input.down(0, 5, 6);
    host.setPaused(true);
    host.setPaused(false);
    host.close();
    expect(calls).toEqual(["update", "unlock", "suspend", "resume", "close"]);
    // Les boutons tenus ont été relâchés par la pause.
    const events = host.pollInput();
    expect(events.at(-1)).toMatchObject({ type: "pointer", buttons: 0 });
  });

  it("entrées : le pointeur est un état, une touche une action nommée", () => {
    const { host } = makeHost();
    host.input.move(5, 6);
    host.input.action("look");
    expect(host.pollInput()).toEqual([
      { type: "pointer", x: 5, y: 6, buttons: 0 },
      { type: "action", action: "look" },
    ]);
  });
});

describe("createSoundFiles : voix lues à la demande", () => {
  it("`has` ne dépend que de la liste des fichiers ; `load` garde ce qu'il a lu", async () => {
    const fetcher = vi.fn(async (path: string) => new TextEncoder().encode(path));
    const sounds = createSoundFiles(files, fetcher);
    expect(sounds.has("020001P2")).toBe(true);
    expect(sounds.has("020001P3")).toBe(false);
    const first = await sounds.load("020001P2");
    expect(first).toEqual(new TextEncoder().encode("voices/020001P2.mp3"));
    expect(await sounds.load("020001P2")).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("un son absent ou une erreur réseau sont rejetés (la voie sera libérée)", async () => {
    const sounds = createSoundFiles(files, async () => {
      throw new Error("HTTP 500");
    });
    await expect(sounds.load("NOPE0000")).rejects.toThrow("introuvable");
    await expect(sounds.load("020001P2")).rejects.toThrow("HTTP 500");
  });
});
