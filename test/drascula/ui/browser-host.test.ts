import { describe, expect, it, vi } from "vitest";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import type { DrasculaAudio } from "../../../src/games/drascula/audio/audio";
import { GameFiles } from "../../../src/games/drascula/data/files";
import { drasculaScript } from "../../../src/games/drascula/engine/rooms";
import { BrowserHost, createSoundFiles } from "../../../src/games/drascula/ui/browser-host";
import { FileStore } from "../../../src/ui/file-store";
import { describeSave, roomName, SAVE_PREFIX, createSaveSlots } from "../../../src/games/drascula/ui/saves";
import { parseVolume, slotLabel, slotSelectable, volumeKey } from "../../../src/ui/point-click-dialogs";
import { copy } from "../../../src/games/drascula/copy";
import { hasOriginalFiles, listOriginal, byExtension } from "../helpers";
import { Player } from "../engine/test-host";
import { startInTavern } from "../rooms/chapter-6/start";

/** Son enregistré : les appels que l'hôte lui fait. */
function fakeAudio() {
  const calls: string[] = [];
  const audio = {
    playSound: (name: string) => (calls.push(`sound:${name}`), true),
    stopSound: () => void calls.push("stopSound"),
    soundActive: () => false,
    playMusic: (track: number) => void calls.push(`music:${track}`),
    stopMusic: () => void calls.push("stopMusic"),
    musicPlaying: () => true,
    setMusicVolume: (level: number) => void calls.push(`volume:${level}`),
    unlock: () => void calls.push("unlock"),
    suspend: () => void calls.push("suspend"),
    resume: () => void calls.push("resume"),
    close: () => void calls.push("close"),
  };
  return { audio: audio as unknown as DrasculaAudio, calls };
}

function makeHost() {
  const store = new FileStore();
  store.set("96.ALG", new Uint8Array([9]));
  const { audio, calls } = fakeAudio();
  const presented: Uint8Array[] = [];
  const exits: number[] = [];
  const host = new BrowserHost({
    files: store,
    audio,
    storage: prefixedStorage(new MemoryStorage(), SAVE_PREFIX),
    present: (pixels) => presented.push(pixels),
    onExit: () => exits.push(1),
    now: () => 1234,
  });
  return { host, calls, presented, exits };
}

describe("BrowserHost", () => {
  it("lit les fichiers préchargés (casse indifférente) et lève pour un fichier absent", () => {
    const { host } = makeHost();
    expect(host.readFile("96.alg")).toEqual(new Uint8Array([9]));
    expect(() => host.readFile("97.alg")).toThrow("Fichier du jeu introuvable : 97.alg");
  });

  it("horloge, sortie, image et son sont délégués", () => {
    const { host, calls, presented, exits } = makeHost();
    expect(host.now()).toBe(1234);
    host.exit();
    expect(exits).toHaveLength(1);
    host.present(new Uint8Array(3), new Uint8Array(768));
    expect(presented).toHaveLength(1);
    expect(host.playSound("214.als")).toBe(true);
    host.playMusic(7);
    host.stopSound();
    host.stopMusic();
    expect(calls).toEqual(["sound:214.als", "music:7", "stopSound", "stopMusic"]);
    expect(host.musicPlaying()).toBe(true);
    expect(host.soundActive()).toBe(false);
  });

  it("le volume de la musique est le fondu du moteur multiplié par le choix de la joueuse", () => {
    const { host, calls } = makeHost();
    host.setUserVolume(0.5);
    host.setMusicVolume(0.4);
    host.setMusicVolume(1);
    host.setUserVolume(2);
    host.setUserVolume(-1);
    expect(calls).toEqual(["volume:0.5", "volume:0.2", "volume:0.5", "volume:1", "volume:0"]);
    expect(host.volume).toBe(0);
  });

  it("la pause coupe le son et relâche les boutons ; la reprise relance le son ; fermer ferme l'audio", () => {
    const { host, calls } = makeHost();
    host.input.down(0, 10, 10);
    host.pollInput();
    host.setPaused(true);
    expect(host.pollInput()).toEqual([{ type: "pointer", x: 10, y: 10, buttons: 0 }]);
    host.setPaused(false);
    host.unlock();
    host.close();
    expect(calls).toEqual(["suspend", "resume", "unlock", "close"]);
  });

  it("les entrées passent par la file : un clic bref reste vu du moteur", () => {
    const { host } = makeHost();
    host.input.move(5, 6);
    host.input.key("F1");
    expect(host.pollInput()).toEqual([
      { type: "pointer", x: 5, y: 6, buttons: 0 },
      { type: "key", key: "F1" },
    ]);
  });
});

describe("createSoundFiles : voix lues à la demande", () => {
  const files = new GameFiles([{ path: "214.ALS", size: 100 }, { path: "S3.ALS", size: 50 }]);

  it("`has` ne dépend que de la liste des fichiers ; `load` garde ce qu'il a lu", async () => {
    const fetcher = vi.fn(async (path: string) => new TextEncoder().encode(path));
    const sounds = createSoundFiles(files, fetcher);
    expect(sounds.has("214.als")).toBe(true);
    expect(sounds.has("215.als")).toBe(false);
    const first = await sounds.load("214.als");
    expect(first).toEqual(new TextEncoder().encode("214.ALS"));
    const second = sounds.load("214.als");
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("un fichier absent ou une erreur réseau sont rejetés (la voie sera libérée)", async () => {
    const sounds = createSoundFiles(files, async () => {
      throw new Error("HTTP 500");
    });
    await expect(sounds.load("999.als")).rejects.toThrow("introuvable");
    await expect(sounds.load("S3.ALS")).rejects.toThrow("HTTP 500");
  });
});

describe("volume mémorisé", () => {
  it("lit un pourcentage, 100 % par défaut, borné", () => {
    expect(parseVolume(null)).toBe(1);
    expect(parseVolume("40")).toBe(0.4);
    expect(parseVolume("250")).toBe(1);
    expect(parseVolume("-5")).toBe(0);
    expect(parseVolume("abc")).toBe(1);
    expect(volumeKey("drascula")).toBe("retrovibe:drascula:music-volume");
  });
});

describe("sauvegardes : noms de lieux et sélecteur", () => {
  it("un nom pour chaque pièce du jeu, « Pièce N » pour les autres", () => {
    expect(roomName(62)).toBe("L'auberge de Transylvanie");
    expect(roomName(999)).toBe("Pièce 999");
  });

  it.skipIf(!hasOriginalFiles)("toutes les fiches .ALD du jeu ont un nom de lieu", () => {
    const rooms = listOriginal(byExtension("ALD")).map((name) => Number.parseInt(name, 10));
    expect(rooms).toHaveLength(57);
    for (const room of rooms) expect(copy.roomNames[room], `pièce ${room}`).toBeTruthy();
  });

  it("les noms de lieux sont tous différents", () => {
    const names = Object.values(copy.roomNames);
    expect(new Set(names).size).toBe(names.length);
  });

  it.skipIf(!hasOriginalFiles)("une sauvegarde de la taverne se décrit par son lieu", () => {
    const w = startInTavern();
    const save = w.engine.saveGame()!;
    const storage = new MemoryStorage();
    const slots = createSaveSlots(prefixedStorage(storage, SAVE_PREFIX));
    expect(slots.write(3, save, Date.UTC(2026, 10, 7, 15, 5))).toBe(true);
    expect(describeSave(slots.read(3)!)).toMatch(/^Chapitre 6 – La taverne de Drascula – .*2026/);
  });

  it("« Continuer » reprend la sauvegarde la plus récente ; aucune : null", () => {
    const slots = createSaveSlots(prefixedStorage(new MemoryStorage(), SAVE_PREFIX));
    expect(slots.latest()).toBeNull();
  });

  it.skipIf(!hasOriginalFiles)("la plus récente par date, pas par numéro d'emplacement", () => {
    const p = new Player();
    p.settle();
    const save = p.engine.saveGame()!;
    const slots = createSaveSlots(prefixedStorage(new MemoryStorage(), SAVE_PREFIX));
    slots.write(2, save, 3000);
    slots.write(5, save, 1000);
    slots.write(9, save, 2000);
    expect(slots.latest()?.savedAt).toBe(3000);
  });

  it("charger : un emplacement vide n'est pas choisissable ; sauvegarder : tous le sont", () => {
    const empty = { slot: 4, empty: true, description: copy.saveSlot(4), savedAt: null };
    const full = { slot: 5, empty: false, description: "Chapitre 1 – L'auberge – 7 nov.", savedAt: 1 };
    expect(slotSelectable("load", empty)).toBe(false);
    expect(slotSelectable("load", full)).toBe(true);
    expect(slotSelectable("save", empty)).toBe(true);
    expect(slotLabel(copy, empty)).toBe("Emplacement 4 : emplacement vide");
    expect(slotLabel(copy, full)).toBe("Emplacement 5 : Chapitre 1 – L'auberge – 7 nov.");
  });
});

describe.skipIf(!hasOriginalFiles)("sous-titres masquables (touche T)", () => {
  it("la réplique se joue (voix, durée) sans que son texte soit dessiné", () => {
    const shown = new Player({ script: { ...drasculaScript, animations: {} } });
    shown.settle();
    shown.engine.run(shown.engine.talk(214));
    shown.run(20);
    expect(shown.engine.subtitle).not.toBeNull();
    shown.engine.render();
    const withText = Uint8Array.from(shown.host.screen!);
    shown.engine.subtitlesEnabled = false;
    shown.engine.render();
    const without = Uint8Array.from(shown.host.screen!);
    expect(shown.engine.subtitle).not.toBeNull();
    expect(without).not.toEqual(withText);
    shown.engine.subtitlesEnabled = true;
    shown.engine.render();
    expect(Uint8Array.from(shown.host.screen!)).toEqual(withText);
  });
});
