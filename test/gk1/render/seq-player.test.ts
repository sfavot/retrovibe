import { describe, expect, it } from "vitest";
import { decodeSeqFrames, readSeq } from "../../../src/games/gk1/data/seq";
import { eventsOf, MouseButton } from "../../../src/games/gk1/engine/events";
import { SUSPEND_SHOW_MOVIE } from "../../../src/games/gk1/engine/kernel/movie";
import { currentRoom, runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { SCREEN_WIDTH } from "../../../src/games/gk1/render/ids";
import { MOVIE_LOADING, seqPlayerOf } from "../../../src/games/gk1/render/seq-player";
import { fnv1a, mainIndex, original } from "../data/real";
import { Scene } from "./scene";

const INTRO_MOVIE = "1.SEQ";
/** Durée d'une image dans les appels des scripts (`ShowMovie(nom, 7, …)`). */
const TICKS_PER_FRAME = 7;
const TITLE_ROOM = 375;
const INTRO_ROOM = 190;
const AFTER_INTRO_ROOM = 180;

const movie = (name: string): Uint8Array => original.read(`SEQ/${name}`);

/** Sommes de contrôle des images d'un SEQ, décodées sans le lecteur. */
function referenceFrames(name: string): number[] {
  return Array.from(decodeSeqFrames(readSeq(movie(name))), (canvas) => fnv1a(canvas));
}

/** Scène avec une image du jeu à l'écran (plan rouge) et un lecteur branché sur les fichiers réels. */
function stage() {
  const scene = new Scene();
  scene.plane(0, 0, 319, 199, { back: 12 });
  scene.frameout.frameOut();
  const player = seqPlayerOf(scene.vm);
  player.source = movie;
  return { scene, player, screen: scene.frameout.screen, palette: scene.frameout.palette.screen };
}

describe.skipIf(!original.has)("lecteur de cinématiques SEQ", () => {
  it("joue 1.SEQ dans le tampon du compositeur : une image tous les 7 ticks, palette du fichier, puis écran et palette rendus", () => {
    const { scene, player, screen, palette } = stage();
    const gamePalette = palette.slice();
    const gameScreen = fnv1a(screen);
    const seq = readSeq(movie(INTRO_MOVIE));
    const reference = referenceFrames(INTRO_MOVIE);
    expect(reference).toHaveLength(seq.frames.length);
    expect(gamePalette).not.toEqual(seq.palette.rgb);

    player.play("1.seq", TICKS_PER_FRAME, 0, 0);
    expect([player.playing, player.current, player.frameIndex]).toEqual([true, INTRO_MOVIE, -1]);
    const start = 1000;
    const changes: number[] = [];
    let tick = start;
    for (let shown = -1; !player.advance(tick); tick++) {
      if (player.frameIndex !== shown) changes.push(tick - start);
      shown = player.frameIndex;
      expect(shown).toBe(Math.floor((tick - start) / TICKS_PER_FRAME));
      expect(fnv1a(screen), `image ${shown}`).toBe(reference[shown]);
      expect(palette).toEqual(seq.palette.rgb);
    }
    expect(changes).toEqual(seq.frames.map((_, index) => index * TICKS_PER_FRAME));
    expect(tick - start).toBe(seq.frames.length * TICKS_PER_FRAME);
    expect([seq.frames.length, reference[0].toString(16), reference[1].toString(16), reference.at(-1)!.toString(16), fnv1a(new Uint8Array(Uint32Array.from(reference).buffer)).toString(16)]).toMatchInlineSnapshot(`
      [
        48,
        "38c165c5",
        "675ddd68",
        "38c165c5",
        "8f33d1da",
      ]
    `);

    // Fin : écran noir, palette de l'écran d'avant ; le `FrameOut` suivant redonne l'image du jeu, palette source intacte.
    expect(player.playing).toBe(false);
    expect(screen.every((color) => color === 0)).toBe(true);
    expect(palette).toEqual(gamePalette);
    scene.frameout.frameOut();
    expect(fnv1a(screen)).toBe(gameScreen);
    expect(palette).toEqual(gamePalette);
    expect(scene.vm.warnings.size).toBe(0);
  });

  it("cadence : 8 ticks par image quand l'appel le demande", () => {
    const { player } = stage();
    const frames = readSeq(movie("MAP.SEQ")).frames.length;
    player.play("MAP.SEQ", 8, 0, 0);
    let ticks = 0;
    while (!player.advance(ticks)) ticks++;
    expect(ticks).toBe(frames * 8);
  });

  it("pose la toile en (x, y) et coupe ce qui sort de l'écran", () => {
    const { scene, player, screen } = stage();
    const first = decodeSeqFrames(readSeq(movie(INTRO_MOVIE))).next().value!.slice();
    player.play(INTRO_MOVIE, TICKS_PER_FRAME, 150, 135);
    expect(player.advance(0)).toBe(false);
    expect(scene.pixel(150, 135)).toBe(first[0]);
    expect(scene.pixel(319, 199)).toBe(first[64 * SCREEN_WIDTH + 169]);
    // Hors de la toile, l'image du jeu reste.
    expect([scene.pixel(149, 135), scene.pixel(150, 134)]).toEqual([12, 12]);
    expect(Array.from(screen.subarray(135 * SCREEN_WIDTH + 150, 136 * SCREEN_WIDTH))).toEqual(Array.from(first.subarray(0, 170)));
  });

  it("skip arrête la lecture au tick suivant et rend l'écran", () => {
    const { player, screen, palette } = stage();
    const gamePalette = palette.slice();
    expect(player.skip()).toBe(false);
    player.play(INTRO_MOVIE, TICKS_PER_FRAME, 0, 0);
    expect(player.advance(0)).toBe(false);
    expect(player.advance(1)).toBe(false);
    expect(player.skip()).toBe(true);
    expect(player.advance(2)).toBe(true);
    expect(player.playing).toBe(false);
    expect(screen.every((color) => color === 0)).toBe(true);
    expect(palette).toEqual(gamePalette);
    // La demande ne déborde pas sur la cinématique suivante.
    player.play(INTRO_MOVIE, TICKS_PER_FRAME, 0, 0);
    expect(player.advance(3)).toBe(false);
  });

  it("attend un fichier en cours de chargement : l'horloge ne part qu'à son arrivée ; un fichier absent est signalé", () => {
    const { scene, player, screen } = stage();
    const game = fnv1a(screen);
    const reference = referenceFrames(INTRO_MOVIE);
    let ready = false;
    const asked: string[] = [];
    player.source = (name) => {
      asked.push(name);
      return ready ? movie(name) : MOVIE_LOADING;
    };
    player.play(INTRO_MOVIE, TICKS_PER_FRAME, 0, 0);
    for (let tick = 0; tick < 50; tick++) expect(player.advance(tick)).toBe(false);
    expect([player.playing, player.frameIndex, fnv1a(screen)]).toEqual([true, -1, game]);
    ready = true;
    expect(player.advance(50)).toBe(false);
    expect([player.frameIndex, fnv1a(screen)]).toEqual([0, reference[0]]);
    expect(player.advance(50 + TICKS_PER_FRAME)).toBe(false);
    expect([player.frameIndex, fnv1a(screen)]).toEqual([1, reference[1]]);
    expect(asked).toHaveLength(51);
    expect(new Set(asked)).toEqual(new Set([INTRO_MOVIE]));

    const missing = stage();
    missing.player.source = () => undefined;
    missing.player.play("RIEN.SEQ", TICKS_PER_FRAME, 0, 0);
    expect(missing.player.advance(0)).toBe(true);
    expect(missing.player.playing).toBe(false);
    expect([...missing.scene.vm.warnings.keys()]).toEqual(["cinématique RIEN.SEQ absente"]);
    expect(fnv1a(missing.screen)).toBe(game);
    expect(scene.vm.warnings.size).toBe(0);
  });

  it("ShowMovie, forme Windows : signalée, sans effet", () => {
    const { scene, player } = stage();
    scene.vm.acc = 1234;
    expect(scene.kernel("ShowMovie", 0, 0)).toBe(1234);
    expect(player.playing).toBe(false);
    expect([...scene.vm.warnings.keys()]).toEqual(["ShowMovie : forme Windows (0) non portée"]);
    expect(scene.vm.kernel.isImplemented("ShowMovie")).toBe(true);
  });
});

describe.skipIf(!original.has)("introduction sans tête", () => {
  it("du titre, un clic sur INTRO fait jouer par ShowMovie les dix cinématiques de l'introduction, dans l'ordre", () => {
    const vm = new Vm(mainIndex());
    useGameClock(vm);
    vm.boot();
    const frameout = frameoutOf(vm);
    const player = seqPlayerOf(vm);
    const asked: string[] = [];
    player.source = (name) => {
      asked.push(name);
      return movie(name);
    };

    let frames = 0;
    const play = (until: () => boolean, limit: number): void => {
      for (const end = frames + limit; !until(); frames++) {
        if (frames >= end) throw new Error(`attendu avant l'image ${end}`);
        const result = runFrame(vm);
        expect(result).toEqual({ status: RunStatus.Suspended, reason: player.playing ? SUSPEND_SHOW_MOVIE : "FrameOut" });
      }
    };
    const introButton = () => frameout.planes.flatMap((plane) => plane.items).find((item) => vm.nameOf(item.object) === "introButt");
    play(() => currentRoom(vm) === TITLE_ROOM && introButton() !== undefined, 2000);
    // L'écran titre arrive en fondu (vague G2) : les scripts ne reprennent, et ne voient le clic, qu'une fois le fondu fini.
    play(() => frameout.transitions.showStyles.length === 0, 100);
    const rect = introButton()!.screenRect;
    const events = eventsOf(vm);
    const [x, y] = [rect.left + 5, rect.top + 3];
    events.move(x, y);
    const hovered = frames + 3;
    play(() => frames === hovered, 3);
    events.down(MouseButton.Left, x, y);
    events.up(MouseButton.Left, x, y);
    // Le titre part en fondu (soixante ticks) avant le changement de pièce.
    play(() => currentRoom(vm) === INTRO_ROOM, 80);

    // Chaque cinématique : première image à l'écran avec la palette du fichier, durée = images × 7 ticks ; PAN1 est coupée.
    const SKIPPED = "PAN1.SEQ";
    const SKIP_AFTER = 20;
    const log: [string, number][] = [];
    while (currentRoom(vm) === INTRO_ROOM) {
      play(() => player.playing || currentRoom(vm) !== INTRO_ROOM, 1000);
      if (!player.playing) break;
      const name = player.current!;
      const seq = readSeq(movie(name));
      expect(player.frameIndex).toBe(0);
      expect(fnv1a(frameout.screen), name).toBe(fnv1a(decodeSeqFrames(seq).next().value!));
      expect(frameout.palette.screen).toEqual(seq.palette.rgb);
      const start = vm.ticks;
      if (name === SKIPPED) {
        play(() => vm.ticks === start + SKIP_AFTER, SKIP_AFTER);
        expect(player.skip()).toBe(true);
      }
      play(() => player.current !== name, 1000);
      log.push([name, vm.ticks - start]);
      expect(vm.ticks - start, name).toBe(name === SKIPPED ? SKIP_AFTER + 1 : seq.frames.length * TICKS_PER_FRAME);
    }
    expect(currentRoom(vm)).toBe(AFTER_INTRO_ROOM);
    expect(asked).toEqual(log.map(([name]) => name));
    expect(log).toMatchInlineSnapshot(`
      [
        [
          "1.SEQ",
          336,
        ],
        [
          "2.SEQ",
          336,
        ],
        [
          "MORPH.SEQ",
          182,
        ],
        [
          "OLDTALIS.SEQ",
          336,
        ],
        [
          "BLOOD.SEQ",
          182,
        ],
        [
          "PAN1.SEQ",
          21,
        ],
        [
          "SNAKE.SEQ",
          133,
        ],
        [
          "PAN2.SEQ",
          217,
        ],
        [
          "HANG.SEQ",
          294,
        ],
        [
          "WAKE.SEQ",
          77,
        ],
      ]
    `);
    expect(vm.kernel.journal.stubs.has("ShowMovie")).toBe(false);
    expect(vm.kernel.journal.counts[vm.kernel.indexOf("ShowMovie")]).toBe(10);
    expect([...vm.warnings.keys()].filter((warning) => /ShowMovie|cinématique/.test(warning))).toEqual([]);
  });
});
