import { describe, expect, it } from "vitest";
import { parseAlg } from "../../../src/games/drascula/data/alg";
import { CINEMATICS, castle, credits, ending, intro, introStory, logos } from "../../../src/games/drascula/cinematics";
import type { GameScript } from "../../../src/games/drascula/engine/script";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { Player } from "../engine/test-host";

const script: GameScript = { animations: CINEMATICS };

describe.skipIf(!hasOriginalFiles)("logos et introduction", () => {
  it("les logos jouent LOGODDM puis LOGOALC sur leurs thèmes, en ~17 secondes, et rendent faux", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const log: boolean[] = [];
    player.engine.run(
      (function* () {
        log.push(yield* logos(player.engine));
      })(),
    );
    const start = player.engine.ticks;
    while (player.engine.busy && player.engine.ticks - start < 5000) player.run(1);
    expect(log).toEqual([false]);
    expect(player.host.music.slice(-2)).toEqual([29, 26]);
    // 51 tours à 9 par seconde (5,7 s) + 1,2 s + 0,7 s + 1 s + 71 tours à 8 par seconde (8,9 s).
    const seconds = (player.engine.ticks - start) / 100;
    expect(seconds).toBeGreaterThan(16);
    expect(seconds).toBeLessThan(19);
  });

  it("Échap pendant le premier logo saute les logos (vrai)", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const log: boolean[] = [];
    player.engine.run(
      (function* () {
        log.push(yield* logos(player.engine));
      })(),
    );
    player.run(100);
    player.key("Escape");
    player.run(3);
    expect(log).toEqual([true]);
    expect(player.host.music.at(-1)).toBe(29);
  });

  it("le chapitre 1 commence par l'introduction : elle joue jusqu'au bout, puis l'auberge", () => {
    const player = new Player({ chapter: 1, script });
    // Pendant l'introduction : rien de la pièce, l'image est celle des cinématiques.
    player.run(10);
    expect(player.engine.busy).toBe(true);
    expect(player.engine.gfx.owner).toBe("canvas");
    expect(player.state.room).toBeNull();
    let ticks = 0;
    while (player.engine.busy && ticks < 60_000) {
      player.run(1);
      ticks++;
    }
    expect(player.engine.busy).toBe(false);
    // Six minutes environ : logos, histoire, scène du trône, plans, éclair, dialogue, INTRO.BIN (113 s).
    expect(ticks).toBeGreaterThan(25_000);
    expect(ticks).toBeLessThan(45_000);
    expect(player.host.music.slice(0, 6)).toEqual([29, 26, 4, 11, 23, 2]);
    expect(player.state.room?.number).toBe(62);
    expect(player.engine.gfx.owner).toBe("room");
    expect(player.state.inventory).toContain(28);
    // Les feuilles du héros sont remises (96.ALG de face).
    expect(Array.from(player.engine.gfx.front.pixels)).toEqual(Array.from(parseAlg(readOriginal("96.ALG")).pixels));
    expect(Array.from(player.engine.gfx.back.pixels)).toEqual(Array.from(parseAlg(readOriginal("99.ALG")).pixels));
    expect(Array.from(player.engine.gfx.draw2.pixels)).toEqual(Array.from(parseAlg(readOriginal("2AUX62.ALG")).pixels));
  });

  it("Échap pendant l'introduction l'abandonne à n'importe quel moment : l'auberge est chargée, les feuilles remises", () => {
    for (const at of [300, 1_500, 3_400, 6_000, 12_000, 20_000]) {
      const player = new Player({ chapter: 1, script });
      player.run(at);
      expect(player.engine.busy, `à ${at}`).toBe(true);
      // Échap saute la vidéo, la réplique ou l'attente en cours ; on insiste jusqu'à la fin de l'introduction.
      let presses = 0;
      while (player.state.room === null && presses < 80) {
        player.key("Escape");
        player.run(30);
        presses++;
      }
      expect(player.state.room?.number, `à ${at}`).toBe(62);
      player.settle();
      expect(player.engine.gfx.owner).toBe("room");
      expect(Array.from(player.engine.gfx.front.pixels)).toEqual(Array.from(parseAlg(readOriginal("96.ALG")).pixels));
    }
  });

  it("Échap pendant une réplique de l'introduction ne coupe que la réplique", () => {
    const player = new Player({ chapter: 1, script });
    // Avance jusqu'à la première réplique (Drascula, `talk_drascula_big`) : sa voix est d1.als.
    let guard = 0;
    while (!player.host.sounds.includes("d1.als") && guard++ < 40_000) player.run(1);
    expect(player.host.sounds.at(-1)).toBe("d1.als");
    player.run(20);
    expect(player.host.soundActive()).toBe(true);
    // Échap : `talk_drascula_big` en fait un saut de l'introduction, mais la voix va à son terme.
    player.key("Escape");
    expect(player.host.soundActive()).toBe(true);
  });

  it("l'histoire (ciel, titre, bande, deux animations) se joue jusqu'au fondu au noir", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const log: boolean[] = [];
    player.engine.run(
      (function* () {
        log.push(yield* introStory(player.engine));
      })(),
    );
    let ticks = 0;
    while (player.engine.busy && ticks < 8_000) {
      player.run(1);
      ticks++;
    }
    expect(log).toEqual([false]);
    // Fondu depuis le noir, le titre, scrollb (73 tours à 9), scr2 et scr3, fondu au noir.
    expect(ticks).toBeGreaterThan(2_500);
    expect(Array.from(player.engine.gfx.palette.shown).every((v) => v === 0)).toBe(true); // fondu au noir terminé
    expect(player.engine.gfx.owner).toBe("canvas");
  });
});

describe.skipIf(!hasOriginalFiles)("chapitres et fin", () => {
  it("le château du chapitre 4 montre cinq vues sur un coup de tonnerre, puis remet les feuilles en état", () => {
    const player = new Player({ chapter: 4, script });
    const shown: number[] = [];
    let last = -1;
    let ticks = 0;
    while (player.engine.busy && ticks < 4000) {
      player.engine.render();
      const h = player.engine.gfx.canvas.pixels.reduce((a, b) => (a * 31 + b) | 0, 7);
      if (player.engine.gfx.owner === "canvas" && h !== last) shown.push(h);
      last = h;
      player.run(1);
      ticks++;
    }
    expect(player.state.room?.number).toBe(21);
    expect(player.host.sounds).toContain("s5.als");
    // Sept affichages, dont 2 identiques (ANR_3 revient) : front, extra, back, bg, back, draw3, front.
    expect(shown.length).toBeGreaterThanOrEqual(6);
    // Les feuilles du héros sont celles du chapitre.
    expect(Array.from(player.engine.gfx.front.pixels)).toEqual(Array.from(parseAlg(readOriginal("96.ALG")).pixels));
    expect(Array.from(player.engine.gfx.extra.pixels)).toEqual(Array.from(parseAlg(readOriginal("97.ALG")).pixels));
    expect(Array.from(player.engine.gfx.back.pixels)).toEqual(Array.from(parseAlg(readOriginal("99.ALG")).pixels));
  });

  it("le générique joue QPC puis CRD sur le thème 3 et arrête la musique", () => {
    const player = new Player({ chapter: 6 });
    player.settle();
    player.host.music.length = 0;
    player.engine.run(credits(player.engine));
    const start = player.engine.ticks;
    while (player.engine.busy && player.engine.ticks - start < 30_000) player.run(1);
    expect(player.engine.busy).toBe(false);
    expect(player.host.music).toEqual([3]);
    expect(player.host.musicPlaying()).toBe(false);
    // QPC : 33 tours à 1 par seconde ; CRD : 136 tours ; fondu et pauses entre les deux.
    const seconds = (player.engine.ticks - start) / 100;
    expect(seconds).toBeGreaterThan(169);
    expect(seconds).toBeLessThan(175);
  });

  it("le fondu de la musique baisse le volume pas à pas jusqu'à zéro, arrête la piste, puis remet le volume", () => {
    const player = new Player({ chapter: 6 });
    player.settle();
    player.host.playMusic(3);
    player.host.volumes.length = 0;
    player.engine.run(player.engine.musicFadeout());
    const start = player.engine.ticks;
    while (player.engine.busy) player.run(1);
    const volumes = player.host.volumes;
    expect(volumes[0]).toBeCloseTo(182 / 192);
    expect(volumes.at(-2)).toBe(0);
    expect(volumes.at(-1)).toBe(1);
    for (let i = 1; i < volumes.length - 1; i++) expect(volumes[i]).toBeLessThan(volumes[i - 1]);
    expect(player.host.musicPlaying()).toBe(false);
    // 19 pas de 50 ms + 100 ms.
    expect(player.engine.ticks - start).toBe(19 * 5 + 10);
  });

  it("la fin du jeu : FIN et DRF, la chambre de B.J., la lettre, le héros, le générique", () => {
    const player = new Player({ chapter: 6 });
    player.settle();
    player.host.music.length = 0;
    player.host.sounds.length = 0;
    player.engine.run(ending(player.engine));
    let ticks = 0;
    // Le héros doit arriver à (116, 178) : la marche est une séquence du moteur.
    while (player.engine.busy && ticks < 60_000) {
      player.run(1);
      ticks++;
    }
    expect(player.engine.busy).toBe(false);
    // 13 pendant FIN/DRF, la piste de la pièce 59 à l'entrée, 9 pour la lettre, 17 puis 3 pour le générique.
    expect(player.host.music).toEqual([13, player.state.roomMusic, 9, 17, 3]);
    expect(player.state.flags[5]).toBe(1);
    expect(player.state.room?.number).toBe(59);
    expect(player.engine.gfx.roomSprites).toBe(false);
    // Les cinq voix de la lettre (B.J.), puis les cinq répliques du héros.
    const voices = player.host.sounds.filter((s) => s.startsWith("bj"));
    expect(voices).toEqual(["bj24.als", "bj25.als", "bj26.als", "bj27.als", "bj28.als"]);
    expect(player.host.sounds).toEqual(expect.arrayContaining(["296.als", "297.als", "298.als", "299.als", "300.als", "s15.als", "301.als"]));
  });

  it("le début du chapitre 6 : dialogue de Drascula, choix, puis le héros ligoté sous le pendule dans la pièce 102", () => {
    const player = new Player({ chapter: 6, script });
    let ticks = 0;
    while (!player.engine.choices && ticks < 20_000) {
      player.run(1);
      ticks++;
    }
    expect(player.engine.choices).not.toBeNull();
    expect(player.engine.choices!.phrases).toEqual(player.engine.dialogs.choices(11).phrases);
    // Quatrième choix : quitte le dialogue.
    const bottoms = player.engine.dialogs.bottoms(player.engine.choices!.phrases);
    player.move(100, bottoms[2] + 2);
    player.run(2);
    player.move(100, bottoms[2] + 2, 1);
    player.move(100, bottoms[2] + 2, 0);
    ticks = 0;
    while (player.engine.busy && ticks < 60_000) {
      // Les choix reviennent tant que le dialogue n'est pas fini.
      if (player.engine.choices) {
        const y = bottoms[2] + 2;
        player.move(100, y);
        player.run(2);
        player.move(100, y, 1);
        player.move(100, y, 0);
      }
      player.run(1);
      ticks++;
    }
    expect(player.engine.busy).toBe(false);
    expect(player.state.room?.number).toBe(102);
    expect(player.state.flags[1]).toBe(2);
    expect(player.state.flags[3]).toBe(1);
    expect(player.state.hero.visible).toBe(false);
  });

  it("les cinématiques du jeu sont nommées comme celles de ScummVM", () => {
    expect(Object.keys(CINEMATICS).sort()).toEqual(["1_1", "1_6", "5_6", "9_6", "castle"]);
    expect(CINEMATICS["1_1"]).toBe(intro);
    expect(CINEMATICS.castle).toBe(castle);
  });
});
