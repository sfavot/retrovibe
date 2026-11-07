import { describe, expect, it } from "vitest";
import { AnimateDecoder, parseAnimate, playedFrameCount } from "../../../src/games/drascula/data/bin-animate";
import { SsnDecoder, parseSsn } from "../../../src/games/drascula/data/bin-ssn";
import { animate, playSsn } from "../../../src/games/drascula/cinematics";
import { scummvmRgb6 } from "../../../src/games/drascula/render/palette";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { Player } from "../engine/test-host";

/** Somme de contrôle d'une image (FNV-1a). */
function hash(pixels: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < pixels.length; i++) h = Math.imul(h ^ pixels[i], 16777619);
  return h >>> 0;
}

interface Shown {
  tick: number;
  hash: number;
}

/** Laisse jouer `sequence` en présentant l'image à chaque tick ; rend les changements d'image (tick relatif au départ, somme de contrôle). */
function watch(player: Player, sequence: Parameters<Player["perform"]>[0], max = 20_000): { shown: Shown[]; start: number; ticks: number } {
  const { engine } = player;
  const start = engine.ticks;
  const shown: Shown[] = [];
  let last = -1;
  engine.run(sequence);
  let ticks = 0;
  const look = (): void => {
    engine.render();
    const h = hash(player.host.screen!);
    if (h !== last) shown.push({ tick: engine.ticks - start, hash: h });
    last = h;
  };
  for (; ticks < max && engine.busy; ticks++) {
    look();
    player.run(1);
  }
  if (engine.busy) throw new Error("la séquence ne s'est pas terminée");
  look(); // l'image affichée au tick où la séquence s'est terminée
  return { shown, start, ticks };
}

describe.skipIf(!hasOriginalFiles)("lecteur SSN (images XOR, cadence)", () => {
  /** Images du fichier telles que l'écran les montre, avec le nombre de tours écoulés (images + blocs vides) à leur affichage. */
  function reference(name: string) {
    const decoder = new SsnDecoder(parseSsn(readOriginal(name)));
    const frames: { turns: number; hash: number }[] = [];
    let turns = 0;
    for (let chunk = decoder.step(); chunk; chunk = decoder.step()) {
      if (chunk.kind === "palette") continue;
      turns++;
      if (chunk.kind === "image") frames.push({ turns, hash: hash(decoder.screen) });
    }
    return { frames, turns };
  }

  it.each([
    ["LOGODDM.BIN", 9],
    ["QPC.BIN", 1],
  ])("%s : chaque image arrive à son tour, à la cadence donnée, et dans l'ordre", (name, speed) => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { frames, turns } = reference(name);
    const interval = Math.trunc(1000 / speed);
    const result = watch(player, playSsn(player.engine, name, speed));
    // L'image présentée change exactement aux images du fichier (hors le noir de départ).
    const seen = result.shown.filter((s) => s.hash !== hash(new Uint8Array(64000)));
    expect(seen.map((s) => s.hash)).toEqual(frames.map((f) => f.hash));
    // Image k au tour t : à `t x 1000 / vitesse` ms du départ, au tick près.
    seen.forEach((s, k) => expect(s.tick, `image ${k}`).toBeLessThanOrEqual(Math.ceil((frames[k].turns * interval) / 10) + 1));
    seen.forEach((s, k) => expect(s.tick, `image ${k}`).toBeGreaterThanOrEqual(Math.ceil((frames[k].turns * interval) / 10) - 1));
    // Le flux dure ses tours (images + blocs vides), le dernier compris.
    expect(result.ticks).toBeGreaterThanOrEqual(Math.ceil((turns * interval) / 10) - 1);
    expect(result.ticks).toBeLessThanOrEqual(Math.ceil((turns * interval) / 10) + 2);
  });

  it("le nombre d'images et de tours de LOGODDM et de QPC est celui du format", () => {
    expect(reference("LOGODDM.BIN")).toMatchObject({ turns: 51 });
    expect(reference("LOGODDM.BIN").frames).toHaveLength(47);
    expect(reference("QPC.BIN")).toMatchObject({ turns: 33 });
    expect(reference("QPC.BIN").frames).toHaveLength(9);
  });

  it("la palette du flux va à l'écran (6 bits x 4) sans toucher à la palette du jeu", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const game = player.engine.gfx.palette.game.slice();
    const file = parseSsn(readOriginal("LOGODDM.BIN"));
    const palette = file.chunks.find((c) => c.kind === "palette");
    if (palette?.kind !== "palette") throw new Error("pas de palette");
    player.engine.run(playSsn(player.engine, "LOGODDM.BIN", 9));
    player.run(2);
    expect(Array.from(player.engine.gfx.palette.shown)).toEqual(Array.from(scummvmRgb6(palette.palette)));
    expect(Array.from(player.engine.gfx.palette.game)).toEqual(Array.from(game));
  });

  it("Échap saute la vidéo et rend vrai ; la séquence englobante continue", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const log: string[] = [];
    player.engine.run(
      (function* () {
        log.push(`sauté : ${yield* playSsn(player.engine, "LOGODDM.BIN", 9)}`);
        log.push("suite");
      })(),
    );
    player.run(60);
    expect(log).toEqual([]);
    player.key("Escape");
    player.run(2);
    expect(log).toEqual(["sauté : true", "suite"]);
    expect(player.engine.busy).toBe(false);
  });

  it("jouée jusqu'au bout, la vidéo rend faux", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const log: boolean[] = [];
    player.engine.run(
      (function* () {
        log.push(yield* playSsn(player.engine, "LOGODDM.BIN", 9));
      })(),
    );
    player.run(700);
    expect(log).toEqual([false]);
  });
});

describe.skipIf(!hasOriginalFiles)("lecteur d'animations (images XOR)", () => {
  const NAME = "LEV.BIN";
  const FPS = 15;

  function reference() {
    const file = parseAnimate(readOriginal(NAME));
    const decoder = new AnimateDecoder(file);
    const hashes: number[] = [];
    for (let n = 0; n < playedFrameCount(file); n++) {
      decoder.step();
      hashes.push(hash(decoder.screen));
    }
    return { hashes, palette: decoder.palette, count: file.frames.length };
  }

  it("joue toutes les images sauf la dernière, une toutes les 1000 / ips ms, la première tout de suite", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const ref = reference();
    expect(ref.hashes).toHaveLength(ref.count - 1);
    const result = watch(player, animate(player.engine, NAME, FPS));
    const seen = result.shown;
    expect(seen.map((s) => s.hash)).toEqual(ref.hashes);
    const interval = Math.trunc(1000 / FPS);
    seen.forEach((s, k) => {
      const expected = Math.ceil((k * interval) / 10);
      expect(Math.abs(s.tick - expected), `image ${k}`).toBeLessThanOrEqual(1);
    });
    expect(seen[0].tick).toBe(0);
    expect(result.ticks).toBeGreaterThanOrEqual(Math.ceil(((ref.count - 1) * interval) / 10) - 1);
  });

  it("seule la palette de la première image est appliquée, à l'écran et pas dans la palette du jeu", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const ref = reference();
    const game = player.engine.gfx.palette.game.slice();
    player.engine.run(animate(player.engine, NAME, FPS));
    player.run(2);
    expect(Array.from(player.engine.gfx.palette.shown)).toEqual(Array.from(scummvmRgb6(ref.palette!)));
    expect(Array.from(player.engine.gfx.palette.game)).toEqual(Array.from(game));
  });

  it("Échap la saute (vrai), une autre touche la coupe sans la compter comme un saut (faux)", () => {
    for (const [key, expected] of [["Escape", true], [" ", false]] as const) {
      const player = new Player({ chapter: 1 });
      player.settle();
      const result: boolean[] = [];
      player.engine.run(
        (function* () {
          result.push(yield* animate(player.engine, NAME, FPS));
        })(),
      );
      player.run(20);
      expect(result).toEqual([]);
      player.key(key);
      player.run(15);
      expect(result, key).toEqual([expected]);
    }
  });

  it("un fichier d'animation s'enchaîne sur le précédent (XOR contre l'écran) : deux lectures donnent la même suite", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const first = watch(player, animate(player.engine, NAME, FPS)).shown.map((s) => s.hash);
    const second = watch(player, animate(player.engine, NAME, FPS)).shown.map((s) => s.hash);
    expect(second).toEqual(first);
  });
});
