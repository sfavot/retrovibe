import { describe, expect, it } from "vitest";
import { drive, makeFullGame, type Step } from "./full";
import { hasOriginalFiles, readOriginal } from "./helpers";

/**
 * Parties jouées de bout en bout (sous-systèmes réels, entrées simulées) : démarrage sur la partie 4
 * (PARTIE1..3.ITK masqués, comme le fait INTRO.TOT), puis scénario image par image.
 */
const SKIP_FRAMES = 9000;

async function play(steps: (ctx: ReturnType<typeof makeFullGame>) => Step[]): Promise<ReturnType<typeof makeFullGame>> {
  const ctx = makeFullGame(["PARTIE1.ITK", "PARTIE2.ITK", "PARTIE3.ITK"]);
  await drive(ctx, { skipUntilFrame: SKIP_FRAMES, steps: steps(ctx) });
  return ctx;
}

const dropObject: Step[] = [{ click: [160, 100], right: true }, { wait: 30 }];
const openBar: Step[] = [{ move: [160, 0] }, { wait: 30 }];

// Parties simulées de bout en bout : lentes sur la CI, d'où un délai large.
describe.skipIf(!hasOriginalFiles)("scènes jouées (partie 4)", { timeout: 60_000 }, () => {
  it("saisie du nom de sauvegarde : effacer le nom ne dessine rien hors du champ", async () => {
    // Régression : un cercle (DRAW_INVALIDATE) était tracé à chaque redessin du champ, d'où des traits
    // verticaux jaunes à droite de la boîte une fois le nom effacé.
    const region = (f: Uint8ClampedArray): number[] => {
      const out: number[] = [];
      for (let y = 96; y < 130; y++) for (let x = 250; x < 320; x++) out.push(f[(y * 320 + x) * 4], f[(y * 320 + x) * 4 + 1], f[(y * 320 + x) * 4 + 2]);
      return out;
    };
    let before: number[] = [];
    let after: number[] = [];
    const backspaces: Step[] = Array.from({ length: 7 }, () => [{ key: 0x0e08 }, { wait: 6 }] as Step[]).flat();
    await play((c) => [
      ...dropObject,
      ...openBar,
      { move: [33, 10] },
      { wait: 20 },
      { click: [33, 10] }, // icône Sauver
      { wait: 60 },
      { click: [60, 16] }, // SAUVER
      { wait: 60 },
      { click: [80, 90] }, // premier emplacement : nom prérempli
      { wait: 40 },
      { run: () => (before = region(c.frame().rgba)) },
      ...backspaces,
      { run: () => (after = region(c.frame().rgba)) },
    ]);
    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it("perçage du coco au tire-bouchon : texte, animation avec son et changement de zone", async () => {
    // Le script (EMAM1035, objet 10 sur la zone 13) affiche le texte 117, joue l'animation (son compris)
    // puis remplace la zone « coco frais » par « coco percé ».
    const shown: number[] = [];
    let samplesBefore = 0;
    let zones: number[] = [];
    const ctx = await play((c) => [
      {
        run: () => {
          const g = c.game;
          g.inter.vars.writeString(4532, "EMAM1035");
          g.totToLoad = "EMAM1035.tot";
          g.inter.terminate = 1;
        },
      },
      { move: [200, 100] },
      { wait: 1800 },
      {
        run: () => {
          const draw = c.system.sys.draw;
          const original = draw.printTotText.bind(draw);
          draw.printTotText = (id: number) => {
            shown.push(id);
            return original(id);
          };
          samplesBefore = c.samples.length;
          c.game.inter.vars.writeOff32(244, 10); // tire-bouchon en main
        },
      },
      { move: [136, 141] },
      { wait: 20 },
      { click: [136, 141] },
      { wait: 400 },
      { run: () => (zones = [18068, 18076].map((o) => c.game.inter.vars.readOff16(o))) },
    ]);
    expect(shown).toContain(117);
    expect(ctx.samples.length).toBeGreaterThan(samplesBefore);
    // zone du coco frais déplacée hors écran (1000), zone du coco percé visible (x = 125)
    expect(zones).toEqual([1000, 125]);
  });

  it("barre d'icônes : objet en main, le script n'active que la mallette (Sauver ignoré)", async () => {
    // MENU.TOT (barre du haut) : « if (var32_244 != -1) var32_2856 = 8 » ; les clics sur les autres icônes
    // testent ce masque (bit 1 : Sauver, bit 32 : carte…) et ne font rien.
    const mask = (c: ReturnType<typeof makeFullGame>) => c.game.inter.vars.readOff32(2856);
    const masks: number[] = [];
    const changed: number[] = [];
    let beachFrame: Uint8ClampedArray | null = null;
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
      return n;
    };
    await play((c) => [
      ...openBar,
      { move: [33, 10] },
      { wait: 20 },
      { run: () => masks.push(mask(c)) },
      { run: () => (beachFrame = c.frame().rgba.slice()) },
      { click: [33, 10] }, // Sauver, holocom en main
      { wait: 90 },
      { run: () => changed.push(diff(beachFrame!, c.frame().rgba)) },
      ...dropObject,
      ...openBar,
      { move: [33, 10] },
      { wait: 20 },
      { run: () => masks.push(mask(c)) },
      { run: () => (beachFrame = c.frame().rgba.slice()) },
      { click: [33, 10] }, // Sauver, mains vides : le menu s'ouvre
      { wait: 90 },
      { run: () => changed.push(diff(beachFrame!, c.frame().rgba)) },
    ]);
    expect(masks[0]).toBe(8);
    expect(masks[1]).not.toBe(8);
    expect(masks[1] & 1).toBe(1);
    expect(changed[0]).toBeLessThan(1000);
    expect(changed[1]).toBeGreaterThan(3000);
  });
});

describe.skipIf(!hasOriginalFiles)("enchaînement des parties", { timeout: 120_000 }, () => {
  it("fin de la partie 2 : la partie 3 repart de l'état CAT3.INF (MENU neuf), pas des variables de la partie 2", async () => {
    // Partie 2 (PARTIE1.ITK masqué), puis la cinématique de fin (EMAM1102) enchaîne seule sur EMAM1104.
    // MENU.TOT ne lit CAT3.INF qu'à son démarrage : sans redémarrage, v8[8256] (choix de PARTIE1/3.ITK) et
    // v8[12666] (pince sur le taquet, EMAM1019) gardent leurs valeurs de la partie 2.
    const ctx = makeFullGame(["PARTIE1.ITK"]);
    const v = () => ctx.game.inter.vars;
    const before: number[] = [];
    const esc: Step[] = Array.from({ length: 12 }, () => [{ key: 0x011b }, { wait: 150 }] as Step[]).flat();
    await drive(ctx, {
      skipUntilFrame: SKIP_FRAMES,
      steps: [
        { wait: 200 },
        {
          run: () => {
            before.push(v().readOff8(8256), v().readOff8(12666), v().readOff8(13433));
            v().writeString(4532, "EMAM1102");
            ctx.game.totToLoad = "EMAM1102.tot";
            ctx.game.inter.terminate = 1;
          },
        },
        ...esc,
        { wait: 600 },
      ],
    });
    expect(before).toEqual([0, 1, 1]); // état CAT2.INF
    expect([v().readOff8(8256), v().readOff8(12666), v().readOff8(13433)]).toEqual([1, 255, 2]); // état CAT3.INF
    expect(ctx.game.sessionPart).toBe("CAT3.INF");
    expect(ctx.game.files.archiveNames).toContain("PARTIE3.ITK");
    expect(ctx.game.files.archiveNames).not.toContain("PARTIE1.ITK");
  });
});

describe.skipIf(!hasOriginalFiles)("gros plan d'EMAM1023 (constat 13 du rapport QA)", { timeout: 120_000 }, () => {
  it("l'encart MAGNA ne recopie pas sa plage 16..127 (filler) sur la palette de Melkior", async () => {
    // Partie 3 directement (CAT3.INF), scène du salon, puis clic sur le parquet : MAGNA.IMD est jouée par une clé
    // IMD du mult (palStart 16, palEnd -1) alors que ses images n'utilisent que les index >= 128.
    const ctx = makeFullGame(["PARTIE1.ITK", "PARTIE2.ITK"]);
    const g = ctx.game;
    const wanted = ctx.system.gfx.core.wanted;
    const video = ctx.system.sys.video as unknown as { openVideo: (p: boolean, f: string, props: object) => number };
    const open = video.openVideo.bind(video);
    let magna = 0;
    video.openVideo = (p, f, props) => {
      if (f.toUpperCase().startsWith("MAGNA")) magna++;
      return open(p, f, props);
    };
    let before: Uint8Array | null = null;
    let during: Uint8Array | null = null;
    let upper: Uint8Array | null = null;
    await drive(ctx, {
      skipUntilFrame: SKIP_FRAMES,
      steps: [
        {
          run: () => {
            g.inter.vars.copyFrom(0, new Uint8Array(readOriginal("CAT3.INF")));
            g.inter.vars.writeString(4532, "EMAM1023");
            g.inter.vars.writeOff8(13435, 0);
            g.totToLoad = "EMAM1023.tot";
            g.inter.terminate = 1;
          },
        },
        { wait: 2500 },
        { run: () => (before = wanted.slice(16 * 3, 128 * 3)) },
        { click: [200, 140] },
        { wait: 15 },
        { run: () => (during = wanted.slice(16 * 3, 128 * 3)) },
        { run: () => (upper = wanted.slice(128 * 3)) },
      ],
    });
    expect(magna).toBeGreaterThan(0);
    // Avant correction, la plage blanche (63,63,63) de MAGNA écrasait la palette de Melkior.
    expect(during).toEqual(before);
    expect(upper!.some((v) => v > 0)).toBe(true); // les index >= 128 de l'encart sont bien recopiés
  });
});
