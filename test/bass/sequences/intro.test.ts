import { describe, expect, it } from "vitest";
import {
  BG_HEAD_BYTES,
  BG_TRIM_BYTES,
  INTRO_SCRIPT,
  INTRO_START_DELAY_MS,
  SILENCE,
  VIRGIN_PALETTE,
  VIRGIN_SCREEN,
} from "../../../src/games/bass/engine/sequences/intro";
import { CD_INTRO, MAIN_INTRO, Op } from "../../../src/games/bass/engine/sequences/intro-script";
import type { IntroCommand } from "../../../src/games/bass/engine/sequences/intro-script";
import { SCREEN_WIDTH } from "../../../src/games/bass/render/frame-buffer";
import { FakeDisk, harness } from "./support";

const virgin = (): FakeDisk => new FakeDisk().virgin();
/** Temps de la première attente : la pause de 3 s de `doIntro`. */
const T0 = INTRO_START_DELAY_MS;

describe("introduction : liste de commandes (intro.cpp)", () => {
  it("_mainIntroSeq : Revolution et Gibbo, sans voix", () => {
    expect(MAIN_INTRO).toEqual([
      [Op.Delay, 3000],
      [Op.FadeDown],
      [Op.ShowScreen, 60112, false],
      [Op.FadeUp, 60113],
      [Op.Delay, 8000],
      [Op.FadeDown],
      [Op.ShowScreen, 60114, false],
      [Op.FadeUp, 60115],
      [Op.Delay, 2000],
      [Op.FadeDown],
    ]);
  });

  it("_cdIntroSeq : début, fin et nombre de commandes", () => {
    expect(CD_INTRO.slice(0, 12)).toEqual([
      [Op.PlayVoice, 59500],
      [Op.LoadBg, 59499],
      [Op.LoopBg],
      [Op.WaitVoice],
      [Op.PlayVoice, 59504],
      [Op.ShowScreen, 59502, false],
      [Op.FadeUp, 59501],
      [Op.BgFlirt, 59503],
      [Op.WaitVoice],
      [Op.PlayVoice, 59505],
      [Op.WaitVoice],
      [Op.StopFlirt],
    ]);
    expect(CD_INTRO.slice(-6)).toEqual([
      [Op.StartMusic, 2],
      [Op.FadeDown],
      [Op.ShowScreen, 60096, true],
      [Op.FadeUp, 60095],
      [Op.DoFlirt, 60097],
      [Op.DoFlirt, 60098],
    ]);
    const count = (op: number): number => CD_INTRO.filter((c) => c[0] === op).length;
    expect({ voices: count(Op.PlayVoice), flirts: count(Op.DoFlirt) + count(Op.BgFlirt), screens: count(Op.ShowScreen), fadeUps: count(Op.FadeUp) }).toEqual({
      voices: 86,
      flirts: 24,
      screens: 28,
      fadeUps: 25,
    });
    expect(CD_INTRO.filter((c) => c[0] === Op.Delay).map((c) => c[1])).toEqual([2000, 1600, 2000]);
    expect(CD_INTRO.filter((c) => c[0] === Op.ShowScreen && c[2]).length).toBe(14);
  });

  it("les 24 séquences sont celles de graphics.md ; toutes les voix sont dans 59 494 à 59 672", () => {
    const flirts = CD_INTRO.filter((c) => c[0] === Op.DoFlirt || c[0] === Op.BgFlirt).map((c) => c[1]);
    expect(new Set(flirts)).toEqual(
      new Set([59503, 59506, 59509, 59512, 59516, 59519, 59524, 59533, 59557, 59569, 59575, 59589, 59595, 59605, 59609, 59611, 59623, 59643, 60087, 60099, 60091, 60094, 60097, 60098]),
    );
    for (const c of CD_INTRO) {
      if (c[0] === Op.PlayVoice) expect(c[1]).toBeGreaterThanOrEqual(59500);
      if (c[0] === Op.PlayVoice) expect(c[1]).toBeLessThanOrEqual(59672);
      if (c[0] === Op.LoadBg) expect(c[1]).toBeGreaterThanOrEqual(59494);
    }
  });

  it("pas de commande des disquettes (SCROLLFLIRT 5, COMMANDFLIRT 6, WAITMUSIC 11)", () => {
    for (const c of INTRO_SCRIPT) expect([5, 6, 11]).not.toContain(c[0]);
  });
});

describe("introduction : durées en ticks de 20 ms (commande par commande)", () => {
  const run = (script: IntroCommand[], disk = virgin()) => {
    const h = harness(disk, script);
    const end = h.runToEnd();
    return { ...h, end, disk };
  };

  it("sans commande : écran de Virgin au premier tick, section 0, fin après la pause de 3 s (150 ticks)", () => {
    const h = run([]);
    expect(h.log.slice(0, 3)).toEqual([
      { ms: 0, what: "setPalette" },
      { ms: 0, what: "showScreen 7 false" },
      { ms: 0, what: "loadSection 0" },
    ]);
    expect(h.disk.loads).toEqual([VIRGIN_PALETTE, VIRGIN_SCREEN]);
    expect(h.end).toBe(T0);
    expect(h.intro.outcome).toBe("completed");
    expect(h.intro.running).toBe(false);
  });

  it("DELAY : la durée demandée, en ticks", () => {
    expect(run([[Op.Delay, 1000]]).end).toBe(T0 + 1000);
    expect(run([[Op.Delay, 1000], [Op.Delay, 1600]]).end).toBe(T0 + 2600);
  });

  it("FADEDOWN : 32 pas de 20 ms, palette à zéro ; FADEUP : 32 pas vers la palette du fichier (640 ms)", () => {
    const down = run([[Op.FadeDown]]);
    expect(down.end).toBe(T0 + 640);
    expect(down.at("fadeDownStep", 0)).toBe(T0);
    expect(down.at("fadeDownStep", 31)).toBe(T0 + 620);
    expect(down.log.filter((e) => e.what === "fadeDownStep")).toHaveLength(32);
    expect([...down.canvas.workPalette.subarray(0, 720)].every((v) => v === 0)).toBe(true);

    const disk = virgin().palette(60113, 32);
    const up = run([[Op.FadeUp, 60113]], disk);
    expect(up.end).toBe(T0 + 640);
    expect(up.at("fadeUpStep 1")).toBe(T0);
    expect(up.at("fadeUpStep 32")).toBe(T0 + 620);
    // 32 (VGA 6 bits) -> 130, au pas 32 : exactement la cible.
    expect(up.canvas.workPalette[0]).toBe(130);
    expect(disk.loads).toContain(60113);
  });

  it("un fondu ajoute sa durée à l'échéance : la pause qui suit dure ce qu'elle dit", () => {
    expect(run([[Op.FadeDown], [Op.Delay, 100]]).end).toBe(T0 + 640 + 100);
  });

  it("DOFLIRT : attend la fin de la séquence (5 images, une toutes les 60 ms : 300 ms)", () => {
    const h = run([[Op.DoFlirt, 59503]], virgin().flirt(59503, 5));
    expect(h.at("startSequence 5")).toBe(T0);
    expect(h.end).toBe(T0 + 300);
    expect(h.canvas.sequenceRunning()).toBe(false);
  });

  it("BGFLIRT : rend la main tout de suite ; WAITFLIRT attend la fin", () => {
    const disk = virgin().flirt(59503, 5);
    expect(run([[Op.BgFlirt, 59503]], disk).at("startSequence 5")).toBe(T0);
    expect(run([[Op.BgFlirt, 59503], [Op.WaitFlirt]], disk).end).toBe(T0 + 300);
    // La séquence avance pendant une autre attente.
    const h = run([[Op.BgFlirt, 59503], [Op.Delay, 120]], disk);
    expect(h.end).toBe(T0 + 120);
    expect(h.canvas.sequenceFramesLeft()).toBe(0); // arrêtée par `~Intro` (voir le test suivant) : pas de reste
  });

  it("STOPFLIRT coupe la séquence sans attendre", () => {
    const h = run([[Op.BgFlirt, 59503], [Op.StopFlirt]], virgin().flirt(59503, 5));
    expect(h.end).toBe(T0);
    expect(h.at("stopSequence", 0)).toBe(T0);
    expect(h.canvas.sequenceRunning()).toBe(false);
  });

  it("PLAYVOICE : 200 ms d'attente puis la voix, en-tête de 22 octets remplacé par du silence ; WAITVOICE interroge toutes les 50 ms", () => {
    const disk = virgin().voice(59500, 1000);
    const h = run([[Op.PlayVoice, 59500], [Op.WaitVoice]], disk);
    expect(h.at(/^playVoice/)).toBe(T0 + 200);
    expect(h.end).toBe(T0 + 200 + 1000);
    const pcm = h.voices[0]!.pcm;
    expect([...pcm.subarray(0, 22)].every((v) => v === SILENCE)).toBe(true);
    expect(pcm[22]).toBe(200);
    expect(pcm.length).toBe(Math.round(11025));
  });

  it("l'échéance est absolue : une voix de 1 030 ms finit à la 4260 ms (sondage à 4250), la pause suivante ne dérive pas", () => {
    const disk = virgin().voice(59500, 1030);
    expect(run([[Op.PlayVoice, 59500], [Op.WaitVoice]], disk).end).toBe(T0 + 200 + 1060); // 4250 -> tick de 4260
    expect(run([[Op.PlayVoice, 59500], [Op.WaitVoice], [Op.Delay, 100]], disk).end).toBe(T0 + 200 + 1050 + 100 + 10); // 4350 -> tick de 4360
  });

  it("WAITVOICE sans voix en cours : aucune attente", () => {
    expect(run([[Op.WaitVoice]]).end).toBe(T0);
  });

  it("une voix absente de sky.dnr est ignorée (journalisée)", () => {
    const messages: string[] = [];
    const h = harness(virgin(), [[Op.PlayVoice, 59500], [Op.WaitVoice]], { log: (m) => messages.push(m) });
    expect(h.runToEnd()).toBe(T0 + 200);
    expect(h.voices).toHaveLength(0);
    expect(messages).toEqual(["introduction : voix 59500 absente de sky.dnr"]);
  });

  it("LOADBG / LOOPBG / PLAYBG / STOPBG : on saute 256 octets au début et 768 à la fin ; boucle seulement avec LOOPBG", () => {
    const disk = virgin().background(59499, 5000);
    const h = run([[Op.LoadBg, 59499], [Op.LoopBg], [Op.PlayBg], [Op.StopBg]], disk);
    expect(h.audio.background.map((b) => [b.pcm.length, b.loop])).toEqual([
      [5000, true],
      [5000, false],
    ]);
    expect(BG_HEAD_BYTES + BG_TRIM_BYTES).toBe(1024);
    expect(h.audio.background[0]!.pcm[0]).toBe(150);
    expect(h.log.filter((e) => e.what === "stopBackground").length).toBeGreaterThanOrEqual(5); // LOAD, LOOP, PLAY, STOP, fin
  });

  it("LOOPBG sans LOADBG : rien ne joue", () => {
    expect(run([[Op.LoopBg]]).audio.background).toEqual([]);
  });

  it("STARTMUSIC : le morceau demandé", () => {
    expect(run([[Op.StartMusic, 2]]).at("startMusic 2")).toBe(T0);
  });

  it("SHOWSCREEN : 192 lignes hors plein écran, 200 en plein écran ; CLEARBOTTOM efface les 8 dernières", () => {
    const disk = virgin().image(59502, 9).image(59532, 9);
    const row = (h: ReturnType<typeof run>, y: number): number => h.canvas.frame.pixels[y * SCREEN_WIDTH]!;

    const normal = run([[Op.ShowScreen, 59502, false]], disk);
    expect([row(normal, 0), row(normal, 191), row(normal, 192), row(normal, 199)]).toEqual([9, 9, 0, 0]);

    const full = run([[Op.ShowScreen, 59532, true]], disk);
    expect([row(full, 191), row(full, 192), row(full, 199)]).toEqual([9, 9, 9]);

    const cleared = run([[Op.ShowScreen, 59532, true], [Op.ClearBottom]], disk);
    expect([row(cleared, 191), row(cleared, 192), row(cleared, 199)]).toEqual([9, 0, 0]);
    expect(cleared.canvas.workScreen[199 * SCREEN_WIDTH]).toBe(0);
  });

  it("une image absente de sky.dnr est une erreur", () => {
    expect(() => run([[Op.ShowScreen, 12345, false]])).toThrow(/12345/);
  });
});

/** Un disque où existent tous les fichiers de la vraie liste (voix de 1 s, séquences de 5 images). */
function fullDisk(): FakeDisk {
  const disk = virgin();
  for (const c of INTRO_SCRIPT) {
    if (c[0] === Op.ShowScreen) disk.image(c[1]);
    else if (c[0] === Op.FadeUp) disk.palette(c[1]);
    else if (c[0] === Op.DoFlirt || c[0] === Op.BgFlirt) disk.flirt(c[1]);
    else if (c[0] === Op.PlayVoice) disk.voice(c[1]);
    else if (c[0] === Op.LoadBg) disk.background(c[1]);
  }
  return disk;
}

describe("introduction complète sur des fichiers synthétiques", () => {
  it("ordre des commandes, fichiers chargés, début de la chronologie", () => {
    const disk = fullDisk();
    const h = harness(disk, INTRO_SCRIPT);
    const end = h.runToEnd();
    expect(h.intro.outcome).toBe("completed");
    expect(end).toBeGreaterThan(100_000);

    // Fichiers lus, dans l'ordre des commandes (Virgin d'abord).
    expect(disk.loads.slice(0, 14)).toEqual([60111, 60110, 60112, 60113, 60114, 60115, 59500, 59499, 59504, 59502, 59501, 59503, 59505, 59506]);

    // 3 s de Virgin + 3 s + fondu, Revolution, 8 s, fondu, Gibbo, 2 s, fondu : première voix à 19 400 ms (chronologie vérifiée au banc).
    expect(h.at("showScreen 7 false", 1)).toBe(6000 + 640);
    expect(h.at("fadeUpStep 32", 0)).toBe(6000 + 640 + 620);
    expect(h.at("showScreen 7 false", 2)).toBe(6000 + 640 + 640 + 8000 + 640);
    expect(h.at(/^playVoice/)).toBe(19_400);
    expect(h.at(/^playBackground/)).toBe(19_400);

    const count = (re: RegExp): number => h.log.filter((e) => re.test(e.what)).length;
    const ops = (op: number): number => INTRO_SCRIPT.filter((c) => c[0] === op).length;
    expect(count(/^fadeDownStep/)).toBe(32 * ops(Op.FadeDown));
    expect(count(/^fadeUpStep 1$/)).toBe(ops(Op.FadeUp));
    expect(count(/^playVoice/)).toBe(ops(Op.PlayVoice));
    expect(count(/^startSequence/)).toBe(ops(Op.DoFlirt) + ops(Op.BgFlirt));
    expect(count(/^startMusic 2$/)).toBe(1);
    expect(count(/^clearBottom$/)).toBe(ops(Op.ClearBottom));
    expect(count(/^showScreen/)).toBe(ops(Op.ShowScreen) + 1);
    // La musique 2 part juste avant les deux dernières séquences.
    expect(h.at("startMusic 2")).toBeGreaterThan(end - 60_000);
  });
});

describe("introduction : saut (Échap, clic, « Passer »)", () => {
  /** Lance l'introduction, la saute au tick `tick` ; rend ce qui reste de l'état. */
  function skipAt(tick: number) {
    const h = harness(fullDisk(), INTRO_SCRIPT);
    h.intro.start();
    for (let t = 0; t < tick; t++) h.intro.tick();
    const before = h.log.length;
    h.intro.skip();
    h.intro.tick();
    return { ...h, before, tick };
  }

  it.each([0, 10, 149, 160, 310, 970, 975, 1500, 2500, 3000])("saut au tick %i : fini dans le tick, séquence et ambiances coupées, rien après", (tick) => {
    const h = skipAt(tick);
    expect(h.intro.running).toBe(false);
    expect(h.intro.outcome).toBe("skipped");
    expect(h.canvas.sequenceRunning()).toBe(false);
    const tail = h.log.slice(h.before);
    expect(tail.map((e) => e.what)).toEqual(expect.arrayContaining(["stopSequence", "stopBackground"]));
    // Tout ce qui suit le saut date du tick du saut.
    for (const e of tail) expect(e.ms).toBe(tick * 20);
    // Plus rien ne se passe ensuite.
    const total = h.log.length;
    for (let t = 0; t < 50; t++) h.intro.tick();
    expect(h.log).toHaveLength(total);
  });

  it("une voix en cours est coupée par le saut", () => {
    const h = skipAt(975); // pendant la première voix (19 400 ms = tick 970)
    expect(h.log.slice(h.before).map((e) => e.what)).toContain("voice stopped");
    expect(h.voices[0]!.stopped).toBe(true);
  });

  it("une demande de saut faite avant le premier tick est prise à la première attente", () => {
    const h = harness(fullDisk(), INTRO_SCRIPT);
    h.intro.start();
    h.intro.skip();
    h.intro.tick();
    expect(h.intro.outcome).toBe("skipped");
  });

  it("pollSkip (entrées de l'hôte) a le même effet que skip()", () => {
    let pressed = false;
    const h = harness(fullDisk(), INTRO_SCRIPT, { pollSkip: () => pressed });
    h.intro.start();
    for (let t = 0; t < 400; t++) h.intro.tick();
    expect(h.intro.running).toBe(true);
    pressed = true;
    h.intro.tick();
    expect(h.intro.outcome).toBe("skipped");
  });

  it("abort() (page quittée) exécute les mêmes arrêts, sans issue", () => {
    const h = harness(fullDisk(), INTRO_SCRIPT);
    h.intro.start();
    for (let t = 0; t < 1000; t++) h.intro.tick();
    h.intro.abort();
    expect(h.intro.running).toBe(false);
    expect(h.intro.outcome).toBeNull();
    expect(h.log.map((e) => e.what)).toContain("stopSequence");
  });
});
