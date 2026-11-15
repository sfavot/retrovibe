import { describe, expect, it } from "vitest";
import { BG_CD_TRACKS, CdMusic, MUSIC_CD_TRACKS, trackFile, type MusicRequest, type MusicSink } from "../../../src/games/voyageurs/audio/cd-music";

type Command = string;

/** Enregistre les ordres sous forme de texte (`play track19`, `stop`, `fade track20`). */
function recorder(): { sink: MusicSink; log: Command[] } {
  const log: Command[] = [];
  const name = (file: string): string => file.replace(/^music\//, "").replace(/\.mp3$/, "");
  const sink: MusicSink = {
    play: (file, loop) => log.push(`play ${name(file)}${loop ? " loop" : ""}`),
    stop: () => log.push("stop"),
    fade: (next: MusicRequest | null) => log.push(next ? `fade ${name(next.file)}` : "fade -"),
  };
  return { sink, log };
}

function make(): { cd: CdMusic; log: Command[] } {
  const { sink, log } = recorder();
  return { cd: new CdMusic(sink), log };
}

describe("tables", () => {
  it("numérote les fichiers piste - 1 (D3)", () => {
    expect(trackFile(20)).toBe("music/track19.mp3");
    expect(trackFile(30)).toBe("music/track29.mp3");
  });

  it("n'utilise que les pistes 19 à 29", () => {
    for (const track of [...Object.values(MUSIC_CD_TRACKS), ...BG_CD_TRACKS.filter(Boolean)]) {
      expect(track).toBeGreaterThanOrEqual(20);
      expect(track).toBeLessThanOrEqual(30);
    }
    expect(Object.keys(MUSIC_CD_TRACKS)).toHaveLength(11);
    expect(BG_CD_TRACKS).toHaveLength(49);
  });
});

describe("loadMusic / playMusic", () => {
  it("charge sans jouer, puis joue en boucle la piste - 1", () => {
    const { cd, log } = make();
    cd.loadMusic("FWARS.DAT");
    expect(log).toEqual([]);
    expect(cd.traceField()).toBe("22,22,0");
    cd.playMusic();
    expect(log).toEqual(["play track21 loop"]);
  });

  it("FWARS et TELESONG partagent la piste 22 ; ALIENS = 30", () => {
    const { cd } = make();
    cd.loadMusic("TELESONG.DAT");
    expect(cd.current).toBe(22);
    cd.loadMusic("ALIENS");
    expect(cd.current).toBe(30);
  });

  it("nom inconnu : piste 0, rien de joué", () => {
    const { cd, log } = make();
    cd.loadMusic("DUGGER.DAT");
    cd.loadMusic("INCONNU");
    expect(cd.traceField()).toBe("0,0,0");
    cd.playMusic();
    expect(log).toEqual(["stop"]);
    cd.loadMusic("constructor");
    expect(cd.current).toBe(0);
  });
});

describe("setBgMusic", () => {
  it("le fond 1 relance toujours, même si un script a de la musique", () => {
    const { cd, log } = make();
    cd.loadMusic("DUGGER.DAT");
    cd.setBgMusic(1);
    expect(log).toEqual(["play track20 loop"]);
    cd.setBgMusic(1);
    expect(log).toEqual(["play track20 loop", "play track20 loop"]);
  });

  it("un autre fond ne remplace pas la musique d'un script", () => {
    const { cd, log } = make();
    cd.loadMusic("DUGGER.DAT");
    cd.setBgMusic(3);
    expect(log).toEqual([]);
    expect(cd.traceField()).toBe("20,20,3");
  });

  it("sans musique de script : joue si la piste change, pas si c'est la même", () => {
    const { cd, log } = make();
    cd.setBgMusic(3);
    expect(log).toEqual(["play track22 loop"]);
    cd.setBgMusic(35); // même piste 23
    expect(log).toEqual(["play track22 loop"]);
    cd.setBgMusic(11);
    expect(log).toEqual(["play track22 loop", "play track26 loop"]);
  });

  it("fond sans piste ou hors table : ignoré, le numéro est retenu", () => {
    const { cd, log } = make();
    cd.setBgMusic(2);
    log.length = 0;
    cd.setBgMusic(4);
    cd.setBgMusic(49);
    cd.setBgMusic(200);
    cd.setBgMusic(-1);
    expect(log).toEqual([]);
    expect(cd.slot).toBe(-1);
  });

  it("le fond 5 joue la piste 29 (fichier track28)", () => {
    const { cd, log } = make();
    cd.setBgMusic(5);
    expect(log).toEqual(["play track28 loop"]);
  });
});

describe("stopMusic", () => {
  it("coupe, sauf sur le fond 1", () => {
    const { cd, log } = make();
    cd.setBgMusic(3);
    log.length = 0;
    cd.stopMusic();
    expect(log).toEqual(["stop"]);
    cd.setBgMusic(1);
    log.length = 0;
    cd.stopMusic();
    expect(log).toEqual([]);
  });

  it("ne touche pas à l'état (comme ScummVM)", () => {
    const { cd } = make();
    cd.loadMusic("MOINES.DAT");
    cd.stopMusic();
    expect(cd.traceField()).toBe("26,26,0");
  });
});

describe("fadeOut (D8)", () => {
  it("rien à faire sans musique de script", () => {
    const { cd, log } = make();
    cd.setBgMusic(3);
    log.length = 0;
    cd.fadeOut();
    expect(log).toEqual([]);
  });

  it("revient à la piste du décor bgCDTracks[slot], pas au n° de décor", () => {
    const { cd, log } = make();
    cd.setBgMusic(11); // piste 27
    cd.loadMusic("DUGGER.DAT");
    cd.playMusic();
    log.length = 0;
    cd.fadeOut();
    expect(log).toEqual(["fade track26"]); // ScummVM jouerait la piste 10
    expect(cd.traceField()).toBe("0,0,11");
  });

  it("décor sans musique : fondu vers le silence", () => {
    const { cd, log } = make();
    cd.setBgMusic(2); // piste 21
    cd.setBgMusic(4);
    cd.loadMusic("SUITE22.DAT");
    cd.playMusic();
    log.length = 0;
    cd.fadeOut();
    expect(log).toEqual(["fade -"]);
  });

  it("fond 1 : seul le statut tombe à 0, la piste du fond continue", () => {
    const { cd, log } = make();
    cd.loadMusic("DUGGER.DAT");
    cd.setBgMusic(1);
    log.length = 0;
    cd.fadeOut();
    expect(log).toEqual([]);
    expect(cd.traceField()).toBe("21,0,1");
  });

  it("après le fondu, le même fond relance sa piste (current = 0)", () => {
    const { cd, log } = make();
    cd.setBgMusic(3);
    cd.loadMusic("ESCAL");
    cd.fadeOut();
    log.length = 0;
    cd.setBgMusic(3);
    expect(log).toEqual(["play track22 loop"]);
  });
});

describe("séquence du banc (intro, trace intro-first-scene)", () => {
  it("piste 20 au tick 5, piste 21 au tick 312 (mus=20,20,0 puis 21,20,1)", () => {
    const { cd, log } = make();
    expect(cd.traceField()).toBe("0,0,0"); // ticks 1-4
    cd.loadMusic("DUGGER.DAT");
    cd.playMusic(); // tick 5, SND 5 play 20
    expect(cd.traceField()).toBe("20,20,0");
    expect(log).toEqual(["play track19 loop"]);
    cd.setBgMusic(1); // tick 312, SND 312 bg 21 slot 1
    expect(cd.traceField()).toBe("21,20,1");
    expect(log).toEqual(["play track19 loop", "play track20 loop"]);
  });

  it("verbs : mus=21,0,1 après un fondu sur le fond 1", () => {
    const { cd } = make();
    cd.loadMusic("DUGGER.DAT");
    cd.playMusic();
    cd.setBgMusic(1);
    cd.fadeOut();
    expect(cd.traceField()).toBe("21,0,1");
  });
});
