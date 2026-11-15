import { describe, expect, it, vi } from "vitest";
import { Opl2 } from "../../../src/audio/opl2";
import { AdlPlayer, parseAdl } from "../../../src/engine/coktel/audio/adlib/adl-player";
import { OplAdlibOutput } from "../../../src/engine/coktel/audio/adlib/output";
import { hasOriginalFiles, sha1 } from "../helpers";
import { referenceTrace, TRACE_RATE, tracePlayer, weenAdls } from "./adl-trace";

/**
 * Les six musiques AdLib de Ween (`ADL.EXT`, jouées par `ADL.TOT`) dans le lecteur commun (`AdlPlayer`, port de
 * `sound/adlplayer.cpp`). Le banc ScummVM n'a pas de trace OPL (voir `docs/ween/audio.md`) : à défaut, le format est relu
 * contre une seconde lecture de `adlplayer.cpp` faite dans le test (`referenceTrace`) et la sortie du lecteur est figée par
 * le hachage de ses écritures de registres OPL.
 */
describe.skipIf(!hasOriginalFiles)("musiques ADL de Ween", () => {
  const adls = hasOriginalFiles ? weenAdls() : [];

  it("six morceaux lisibles : mode, timbres, données et marqueur de fin", () => {
    expect(adls).toHaveLength(6);
    const info = adls.map((d) => {
      const adl = parseAdl(d)!;
      expect(adl).not.toBeNull();
      expect(adl.song[adl.songSize - 1]).toBe(0xff);
      return [d.length, adl.soundMode, adl.timbres.length, adl.songSize, sha1(d).slice(0, 12)];
    });
    expect(info).toEqual(EXPECTED.info);
  });

  it.each([0, 1, 2, 3, 4, 5])("morceau %i : mêmes commandes, mêmes ticks et même fin que la lecture de adlplayer.cpp", (i) => {
    const ref = referenceTrace(adls[i]);
    const run = tracePlayer(adls[i], 0, 5_000_000);
    expect(ref.events.length).toBeGreaterThan(100);
    expect(run.events).toEqual(ref.events);
    // Fin : au tick du marqueur, le lecteur s'arrête seul (une seule notification).
    expect(run.finishedAt).toEqual([ref.endTick]);
    expect(run.playing).toBe(false);
    expect([ref.endTick, ref.events.length]).toEqual(EXPECTED.ticks[i]);
  });

  it.each([0, 1, 2, 3, 4, 5])("morceau %i : hachage des écritures OPL d'un passage (non-régression)", (i) => {
    const run = tracePlayer(adls[i], 0, 5_000_000);
    expect([run.writes.length, sha1(new TextEncoder().encode(run.writes.join("\n"))).slice(0, 16)]).toEqual(EXPECTED.writes[i]);
  });

  it("répétitions : n passages durent n × (fin + 1) ticks (o1_playSound passe répétitions - 1)", () => {
    const end = referenceTrace(adls[4]).endTick;
    for (const repeat of [0, 1, 2]) {
      const run = tracePlayer(adls[4], repeat, 5_000_000);
      expect(run.finishedAt).toEqual([(repeat + 1) * (end + 1) - 1]);
    }
    // Boucle infinie (répétition négative, ADL.TOT et les salles) : toujours en train de jouer après 3 passages
    const loop = tracePlayer(adls[4], -1, 3 * (end + 1));
    expect(loop.playing).toBe(true);
    expect(loop.finishedAt).toEqual([]);
  });

  it.each([0, 1, 2, 3, 4, 5])(
    "morceau %i : la sortie du navigateur (OplAdlibOutput, horloge du jeu) fait les mêmes écritures OPL aux mêmes ticks",
    (i) => {
      const reference = tracePlayer(adls[i], 1, 5_000_000);
      // Écritures datées par `beginTick` : le tick 0 est celui des commandes (chargement, lecture), le n-ième `onTimer`
      // tombe au tick n ; `tracePlayer` compte -1 avant le premier `onTimer`.
      const writes: string[] = [];
      let tick = 0;
      let ms = 0;
      const out = new OplAdlibOutput({ beginTick: (n) => void (tick = n), write: (reg, val) => void writes.push(`${tick - 1} ${reg} ${val}`) }, () => ms);
      let finished = 0;
      out.onStopped = () => finished++;
      out.load(adls[i]);
      out.setRepeating(1);
      out.play();
      // images irrégulières, comme celles d'un navigateur
      for (let frame = 0; out.playing && ms < 1_000_000; frame++) {
        ms += [16, 17, 33, 7][frame % 4];
        out.update();
      }
      expect(finished).toBe(1);
      // la référence commence par la remise à zéro de l'émulateur lui-même (constructeur d'`Opl2`, dans le worklet ici)
      expect(writes).toEqual(reference.writes.slice(opl2ResetWrites()));
    },
  );

  it("le début de chaque morceau sonne (synthèse réelle, 3 s) sans valeur aberrante", () => {
    for (const [i, data] of adls.entries()) {
      const player = new AdlPlayer(TRACE_RATE);
      player.load(data);
      player.setRepeating(0);
      player.startPlay();
      const out = new Float32Array(TRACE_RATE * 3);
      player.render(out, 0, out.length);
      let sum = 0;
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
        sum += v * v;
      }
      expect(Math.sqrt(sum / out.length), `morceau ${i}`).toBeGreaterThan(0.001);
    }
    // 6 × 3 s de synthèse OPL réelle : plus de 5 s sur les machines de la CI.
  }, 60_000);
});

/** Nombre d'écritures de registres faites par le constructeur de l'émulateur (sa remise à zéro). */
function opl2ResetWrites(): number {
  const spy = vi.spyOn(Opl2.prototype, "writeReg");
  try {
    new Opl2(TRACE_RATE);
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

/** Mesures faites sur les fichiers d'origine (taille, mode, timbres, octets du morceau, sha1) ; (tick de fin, commandes) ; (écritures OPL, hachage). */
const EXPECTED = {
  info: [
    [5212, 0, 8, 4761, "1cd2f6673de7"],
    [22999, 0, 11, 22380, "ba6cb761a19b"],
    [13934, 0, 8, 13483, "ce536a18149b"],
    [4959, 0, 22, 3724, "669961540ada"],
    [5767, 0, 6, 5428, "9a4e709f1fc0"],
    [10940, 0, 20, 9817, "554e8d374aab"],
  ],
  ticks: [
    [55301, 2279],
    [210287, 9468],
    [180565, 6180],
    [16811, 1734],
    [65526, 2427],
    [109150, 4658],
  ],
  writes: [
    [5803, "916d15eff6e7dd44"],
    [19439, "d090ebe32e57cbe9"],
    [12352, "43752ee137360760"],
    [4800, "017a9a0713215357"],
    [5932, "08094f49ddefc4b9"],
    [9940, "63ee36128634a737"],
  ],
};
