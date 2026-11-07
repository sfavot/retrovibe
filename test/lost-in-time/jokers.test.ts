import { describe, expect, it } from "vitest";
import { Archive } from "../../src/games/lost-in-time/data/archive";
import { GameSaves, INDEX_SIZE, MemoryStore, PROPS_SIZE, SHOT_INDEX_SIZE, SHOT_SIZE, slotKey } from "../../src/games/lost-in-time/engine/saves";
import { disassemble } from "../../src/games/lost-in-time/engine/opcodes";
import { loadResources } from "../../src/games/lost-in-time/engine/resources";
import { Script } from "../../src/games/lost-in-time/engine/script";
import { Variables } from "../../src/games/lost-in-time/engine/variables";
import type { VmContext } from "../../src/games/lost-in-time/engine/host";
import { drive, makeFullGame, type Step } from "./full";
import { hasOriginalFiles, ITK_FILES, loadArchive } from "./helpers";

/**
 * Jokers : la logique est dans les scripts d'origine (MENU.TOT, JOKER.TOT), le port les interprète.
 *
 * Ce que les scripts font (désassemblage de MENU.TOT et JOKER.TOT) :
 * - variable 32 bits 715 : compteur de jokers, 3 au départ d'une partie (MENU @19572) ; JOKER.TOT y ajoute
 *   1000 à l'ouverture de la boîte, retire 1001 si l'on confirme et 1000 si l'on annule (@527 et @544) ;
 *   l'octet 8327 en est la copie, rangée dans les propriétés globales (bloc de 40 octets à 8288, décalage 160) ;
 * - variable 16 bits 10393 (octet 20786) : « joker autorisé ici », recalculée par le sous-programme @20799 de
 *   MENU.TOT à partir des deux derniers chiffres du nom de scène (chaîne à l'octet 4532) : 13 scènes, certaines
 *   sous condition d'état ; la fonction d'entrée 5 de MENU (@7281) en tire la variable 714 (77 + 2 * autorisé,
 *   +32 pour quelques scènes) dont le bit 1 commande la boîte du joker (@5680 : refus « pas droit » si absent,
 *   « plus de joker » si le compteur est à 0) ;
 * - JOKER.TOT : 13 textes (JOKER.DAT est son fichier de langue français), un par scène autorisée.
 */
const SCENES_WITH_HINT = [2, 3, 5, 8, 13, 15, 17, 19, 20, 22, 24, 26, 32];

const COUNTER_VAR = 715;
const COUNTER_BYTE = 8327;
const ALLOWED_WORD = 20786; // variable 16 bits 10393
const SCENE_NAME = 4532;
const VAR_COUNT = 5470;
const NO_MORE_JOKER = 81;
const NOT_HERE = 82;

// --- Banc : exécute un sous-programme de MENU.TOT sans affichage -------------------------------

async function menuBench() {
  const ctx = makeFullGame();
  const { game } = ctx;
  await game.files.openArchive("INTRO.STK", true);
  game.inter.allocateVars(VAR_COUNT);
  const res = loadResources(game.files, "MENU", "fr")!;
  game.script.load("MENU.TOT", res.tot.script, res.tot.header);
  game.resources = res;
  game.curTotFile = "MENU.TOT";
  const vars = game.inter.vars;

  const run = async (offset: number): Promise<void> => {
    game.script.finished = false;
    await game.inter.runFunction(offset);
  };

  /** Autorisation calculée pour une scène (sous-programme @20799), avec un état de variables donné. */
  const allowed = async (scene: string, state: Record<number, number> = {}, fill = 0): Promise<boolean> => {
    vars.bytes.fill(fill);
    for (const [offset, value] of Object.entries(state)) vars.writeOff8(Number(offset), value);
    vars.writeString(SCENE_NAME, scene);
    await run(20799);
    return vars.readOff16(ALLOWED_WORD) === 1;
  };

  /** Variable 714 que la fonction d'entrée 5 en déduit (variable 61 à -1 comme en jeu). */
  const flag714 = async (scene: string, allowedWord: number): Promise<number> => {
    vars.bytes.fill(0);
    vars.writeString(SCENE_NAME, scene);
    vars.writeOff16(ALLOWED_WORD, allowedWord);
    vars.writeVar32(61, 0xffffffff);
    await run(7281);
    return vars.readVar32(714);
  };

  return { allowed, flag714 };
}

const sceneName = (n: number): string => `EMAM10${String(n).padStart(2, "0")}`;

/** États qui autorisent la scène (octets de variables 8 bits, décalages en octets) ; vide = sans condition. */
const GRANTING: Record<number, Record<number, number>> = {
  3: { 12744: 12 },
  15: { 20821: 1 },
  22: { 7063: 1, 6543: 1 },
  32: { 7703: 1, 12727: 0 },
};

/** États complets qui refusent une scène (octets non cités à 0). */
const REFUSING: [number, Record<number, number>][] = [
  [3, {}],
  [15, {}],
  [17, { 12637: 255 }],
  [19, { 12665: 1 }],
  [20, { 20832: 1 }],
  [22, { 7063: 1 }],
  [22, { 6543: 1 }],
  [24, { 12685: 2, 12693: 3 }],
  [32, { 7703: 0, 12727: 0 }],
  [32, { 7703: 1, 12727: 1 }],
];

describe.skipIf(!hasOriginalFiles)("jokers : disponibilité par scène", () => {
  it("JOKER.TOT et MENU.TOT portent la même table de 13 scènes ; un texte d'indice par scène", () => {
    const archive = loadArchive("INTRO.STK");
    const cases = (name: string, switchOffset: number) => {
      const res = loadResources(archive, name, "fr")!;
      const script = new Script(name, res.tot.script, res.tot.header);
      disassemble(script, res, []);
      const ins = script.decoded.get(switchOffset) as { name: string; args: { cases: { exprs: { value: number }[] }[] } };
      expect(ins.name).toBe("o1_switch");
      return { res, script, values: ins.args.cases.map((c) => c.exprs[0].value) };
    };
    const joker = cases("JOKER", 132);
    const menu = cases("MENU", 20813);
    expect([...joker.values].sort((a, b) => a - b)).toEqual(SCENES_WITH_HINT);
    expect([...menu.values].sort((a, b) => a - b)).toEqual(SCENES_WITH_HINT);
    expect(joker.values).toEqual(menu.values);

    // le i-ème cas de JOKER.TOT affiche le texte i ; JOKER.DAT (français) les contient, tous non vides
    for (let i = 0; i < 13; i++) expect(joker.res.getTextItem(i)?.length ?? 0, `texte ${i}`).toBeGreaterThan(20);
    const printed = [...joker.script.decoded.values()]
      .map((i) => i as { at: number; name: string; args: { id: number } })
      .filter((i) => i.name === "o1_printTotText" && i.at < 280)
      .sort((a, b) => a.at - b.at)
      .map((i) => i.args.id);
    expect(printed).toEqual(Array.from({ length: 13 }, (_, i) => i));
  });

  it("les textes 81 et 82 de MENU sont bien « plus de joker » et « pas droit à un joker ici »", () => {
    const res = loadResources(loadArchive("INTRO.STK"), "MENU", "fr")!;
    const text = (id: number) => Buffer.from(res.getTextItem(id)!).toString("latin1");
    expect(text(NO_MORE_JOKER)).toContain("n'ai plus de joker");
    expect(text(NOT_HERE)).toContain("n'ai pas droit");
  });

  it("le sous-programme d'autorisation accorde exactement les 13 scènes, avec leurs conditions d'état", async () => {
    const { allowed } = await menuBench();
    for (const n of SCENES_WITH_HINT) {
      expect(await allowed(sceneName(n), GRANTING[n] ?? {}), `scène ${n}`).toBe(true);
    }
    for (const [n, state] of REFUSING) {
      expect(await allowed(sceneName(n), state), `scène ${n} refusée avec ${JSON.stringify(state)}`).toBe(false);
    }
    // veto global (octet 13433 à 3) : plus aucune scène n'accorde de joker
    for (const n of SCENES_WITH_HINT) expect(await allowed(sceneName(n), { ...(GRANTING[n] ?? {}), 13433: 3 }), `veto ${n}`).toBe(false);
  });

  it("aucune autre scène 10xx n'en accorde, quel que soit l'état (jardin et salon du manoir compris)", async () => {
    const { allowed } = await menuBench();
    for (let n = 0; n < 100; n++) {
      if (SCENES_WITH_HINT.includes(n)) continue;
      for (const fill of [0, 1, 2, 3, 4, 12, 255]) {
        expect(await allowed(sceneName(n), {}, fill), `scène ${n}, état ${fill}`).toBe(false);
      }
    }
  });

  it("la fonction d'entrée 5 de MENU traduit l'autorisation dans le bit 1 de la variable 714", async () => {
    const { flag714 } = await menuBench();
    expect((await flag714("EMAM1000", 0)) & 2).toBe(0);
    expect((await flag714("EMAM1000", 1)) & 2).toBe(2);
    expect(await flag714("EMAM1026", 1)).toBe(79);
  });
});

// --- Boîte du joker et compteur, dans le jeu réel (partie 2, jardin du manoir) -----------------

const openBar: Step[] = [{ move: [160, 0] }, { wait: 30 }];
const JOKER_ICON: [number, number] = [78, 10];
const CONFIRM: [number, number] = [135, 56];
const CANCEL: [number, number] = [120, 68];

interface Outcome {
  counter: number;
  counterByte: number;
  loaded: string[];
  /** Identifiants des textes de MENU.TOT affichés (81 : plus de joker, 82 : pas droit à un joker ici). */
  texts: number[];
}

/**
 * Démarre la partie 2 (PARTIE1.ITK masqué), pose le compteur et l'autorisation (variable 714 que MENU déduirait
 * de la scène : 77 au jardin, 79 si la scène accorde un joker ; variable 82 = numéro de scène lu par JOKER.TOT),
 * puis joue `steps` et relève l'état.
 */
async function playJoker(opts: { counter?: number; v714: number; scene?: number; steps: Step[] }): Promise<Outcome> {
  const ctx = makeFullGame(["PARTIE1.ITK"]);
  const loaded: string[] = [];
  const get = ctx.game.files.get.bind(ctx.game.files);
  ctx.game.files.get = (name: string) => {
    if (/^JOKER\.TOT$/i.test(name)) loaded.push(name.toUpperCase());
    return get(name);
  };
  const texts: number[] = [];
  const draw = ctx.system.sys.draw;
  const printTotText = draw.printTotText.bind(draw);
  draw.printTotText = (id) => {
    texts.push(id);
    return printTotText(id);
  };
  const vars = () => ctx.game.inter.variables!;
  await drive(ctx, {
    skipUntilFrame: 9000,
    steps: [
      {
        run: () => {
          if (opts.counter !== undefined) {
            vars().writeVar32(COUNTER_VAR, opts.counter);
            vars().writeOff8(COUNTER_BYTE, opts.counter);
          }
          texts.length = 0;
        },
      },
      ...openBar,
      { run: () => { vars().writeVar32(714, opts.v714); vars().writeVar32(82, opts.scene ?? 26); } },
      ...opts.steps,
      { run: () => void 0 },
    ],
  });
  return { counter: vars().readVar32(COUNTER_VAR), counterByte: vars().readOff8(COUNTER_BYTE), loaded, texts };
}

const useJoker: Step[] = [
  { click: JOKER_ICON },
  { wait: 60 },
  { click: CONFIRM },
  { wait: 90 },
  { click: [160, 100] }, // quitte la page d'indice
  { wait: 600 },
  { key: 0x1c0d },
  { wait: 600 },
];

describe.skipIf(!hasOriginalFiles)("jokers : compteur dans le jeu", { timeout: 60_000 }, () => {
  it("départ à 3 ; « UTILISER UN JOKER / JE CONFIRME » : le compteur baisse de 1 et l'indice s'affiche", async () => {
    const out = await playJoker({ v714: 79, steps: useJoker });
    expect(out.loaded).toContain("JOKER.TOT");
    expect(out.counter).toBe(2);
    expect(out.counterByte).toBe(2);
  });

  it("« J'ANNULE » ne consomme rien et ne charge pas JOKER.TOT", async () => {
    const out = await playJoker({ v714: 79, steps: [{ click: JOKER_ICON }, { wait: 60 }, { click: CANCEL }, { wait: 90 }] });
    expect(out.loaded).toEqual([]);
    expect(out.counter).toBe(3);
    expect(out.counterByte).toBe(3);
  });

  it("à 0, aucun joker n'est accordé : message « plus de joker », compteur inchangé", async () => {
    const out = await playJoker({ counter: 0, v714: 79, steps: [{ click: JOKER_ICON }, { wait: 90 }] });
    expect(out.loaded).toEqual([]);
    expect(out.counter).toBe(0);
    expect(out.texts.includes(NO_MORE_JOKER)).toBe(true);
  });

  it("dernier joker : le compteur passe de 1 à 0, puis un nouvel essai est refusé", async () => {
    const out = await playJoker({
      counter: 1,
      v714: 79,
      steps: [...useJoker, ...openBar, { click: JOKER_ICON }, { wait: 90 }],
    });
    expect(out.loaded).toEqual(["JOKER.TOT"]);
    expect(out.counter).toBe(0);
    expect(out.texts.includes(NO_MORE_JOKER)).toBe(true);
  });

  it("scène non autorisée (jardin) : « pas droit à un joker ici », compteur et JOKER.TOT intacts", async () => {
    const out = await playJoker({ v714: 77, steps: [{ click: JOKER_ICON }, { wait: 90 }] });
    expect(out.loaded).toEqual([]);
    expect(out.counter).toBe(3);
    expect(out.texts.includes(NOT_HERE)).toBe(true);
  });
});

// --- Sauvegarde et rechargement du compteur ---------------------------------------------------

function savesFor(store: MemoryStore) {
  const vars = new Variables(VAR_COUNT);
  const sprites: ({ width: number; height: number; pixels: Uint8Array } | null)[] = new Array(100).fill(null);
  sprites[20] = { width: 16, height: 8, pixels: new Uint8Array(128) };
  sprites[21] = { width: 16, height: 8, pixels: new Uint8Array(128) };
  const saves = new GameSaves(
    { core: { wanted: new Uint8Array(768), setFullPalette() {}, touch() {} }, draw: { sprites, forceBlit() {} } },
    store,
  );
  saves.attach({ vars } as unknown as VmContext);
  return { saves, vars };
}

const SIZE = VAR_COUNT * 4;
const SLOT0 = PROPS_SIZE + INDEX_SIZE;

describe("jokers : compteur sauvé et rechargé (saves.ts)", () => {
  it("l'emplacement de sauvegarde conserve la variable 715 d'une session à l'autre", () => {
    const store = new MemoryStore();
    const first = savesFor(store);
    first.saves.getSize("cat.inf");
    const index = new Uint8Array(INDEX_SIZE);
    index.set(Uint8Array.from("Joker", (c) => c.charCodeAt(0)), 2 * 40);
    first.vars.copyFrom(0, index);
    expect(first.saves.save("cat.inf", 0, INDEX_SIZE, PROPS_SIZE)).toBe(true);
    first.vars.copyFrom(0, new Uint8Array(SIZE));
    first.vars.writeVar32(COUNTER_VAR, 2);
    first.vars.writeOff8(COUNTER_BYTE, 2);
    expect(first.saves.save("ima.inf", 0, -21, SHOT_INDEX_SIZE + 2 * SHOT_SIZE)).toBe(true);
    expect(first.saves.save("cat.inf", 0, SIZE, SLOT0 + 2 * SIZE)).toBe(true);

    const second = savesFor(store);
    expect(second.saves.getSize("cat.inf")).toBe(-1);
    expect(second.saves.getSize("cat.inf")).toBe(3 * SIZE + SLOT0);
    expect(second.vars.readVar32(COUNTER_VAR)).toBe(0);
    expect(second.saves.load("cat.inf", 0, SIZE, SLOT0 + 2 * SIZE)).toBe(true);
    expect(second.vars.readVar32(COUNTER_VAR)).toBe(2);
    expect(second.vars.readOff8(COUNTER_BYTE)).toBe(2);
  });

  it("le bloc de propriétés globales (octets 8288 à 8327, décalage 160) porte l'octet du compteur", () => {
    const { saves, vars } = savesFor(new MemoryStore());
    vars.writeOff8(COUNTER_BYTE, 2);
    expect(saves.save("cat.inf", 8288, 40, 160)).toBe(true);
    vars.writeOff8(COUNTER_BYTE, 0);
    expect(saves.load("cat.inf", 8288, 40, 160)).toBe(true);
    expect(vars.readOff8(COUNTER_BYTE)).toBe(2);
  });

  it.skipIf(!hasOriginalFiles)("bout en bout : un joker utilisé, puis « Sauver » via le menu : l'emplacement stocké contient 2", { timeout: 60_000 }, async () => {
    const store = new MemoryStore();
    const ctx = makeFullGame(["PARTIE1.ITK"], store);
    const vars = () => ctx.game.inter.variables!;
    await drive(ctx, {
      skipUntilFrame: 9000,
      steps: [
        ...openBar,
        { run: () => { vars().writeVar32(714, 79); vars().writeVar32(82, 26); } },
        ...useJoker,
        ...openBar,
        { click: [33, 10] }, // icône Sauver
        { wait: 60 },
        { click: [60, 16] }, // SAUVER
        { wait: 60 },
        { click: [80, 90] }, // emplacement : saisie du nom (prérempli)
        { wait: 40 },
        { click: [120, 146] }, // valide le nom
        { wait: 60 },
        { click: [120, 146] }, // JE CONFIRME
        { wait: 300 },
      ],
    });
    const slot = Array.from({ length: 20 }, (_, i) => i).find((i) => store.get(slotKey(i)) !== null);
    expect(slot).toBeDefined();

    const fresh = savesFor(store);
    fresh.saves.getSize("cat.inf");
    expect(fresh.saves.getSize("cat.inf")).toBeGreaterThan(0);
    expect(fresh.saves.load("cat.inf", 0, SIZE, SLOT0 + slot! * SIZE)).toBe(true);
    expect(fresh.vars.readVar32(COUNTER_VAR)).toBe(2);
    expect(fresh.vars.readOff8(COUNTER_BYTE)).toBe(2);
  });
});

// --- Fin de partie et « Rejouer » ---------------------------------------------------------------

describe.skipIf(!hasOriginalFiles)("fin de partie : écran « La partie est terminée » et « Rejouer »", () => {
  it("MENU.TOT ne termine le jeu que par loadTot(\"END\"), deux fois, avec le même nettoyage ; END.TOT n'existe nulle part", () => {
    for (const name of ["INTRO.STK", ...ITK_FILES]) {
      const archive: Archive = loadArchive(name);
      expect(archive.entries.filter((e) => /^END\./i.test(e.name))).toEqual([]);
    }
    const archive = loadArchive("INTRO.STK");
    const res = loadResources(archive, "MENU", "fr")!;
    const script = new Script("MENU", res.tot.script, res.tot.header);
    disassemble(script, res, []);
    const ops = [...script.decoded.entries()]
      .filter(([k]) => k >= 0)
      .sort(([a], [b]) => a - b)
      .map(([, i]) => i as { at: number; name: string; args: { name?: string | null } });
    const ends = ops.map((o, i) => ({ o, i })).filter(({ o }) => o.name === "o1_loadTot" && o.args.name === "END");
    // abandon par QUITTER (@16788) et fin du jeu après la dernière scène (@25978, scènes 24 à 27 : générique)
    expect(ends.map(({ o }) => o.at)).toEqual([16788, 25978]);
    const cleanup = (i: number) => ops.slice(i - 11, i).map((o) => o.name);
    expect(cleanup(ends[0].i)).toEqual(cleanup(ends[1].i));
    expect(cleanup(ends[0].i)).toEqual([
      ...Array(4).fill("o2_closeItk"),
      ...Array(4).fill("o1_manageDataFile"),
      "o2_stopSound",
      "o1_keyFunc",
      "o1_freeSoundSlot",
    ]);
  });

  it("QUITTER mène à loadTot(\"END\") sans TOT : la partie se termine (Game.start résout, terminate = 2)", { timeout: 60_000 }, async () => {
    const ctx = makeFullGame(["PARTIE1.ITK"]);
    let reached = false;
    await drive(ctx, {
      skipUntilFrame: 9000,
      steps: [
        ...openBar,
        { click: [33, 10] },
        { wait: 60 },
        { click: [60, 40] }, // QUITTER
        { wait: 60 },
        { click: [110, 146] }, // JE CONFIRME
        { wait: 600 },
        { run: () => (reached = true) }, // jamais atteint : le jeu s'est terminé avant
      ],
    });
    expect(reached).toBe(false);
    expect(ctx.game.inter.terminate).toBe(2);
    expect(ctx.game.quit).toBe(false);
  });

  it("une nouvelle session avec des sauvegardes existantes repart d'une partie neuve (rechargement de la page)", { timeout: 60_000 }, async () => {
    const store = new MemoryStore();
    store.set(slotKey(1), "{}"); // reste d'une partie précédente dans le stockage persistant
    const ctx = makeFullGame([], store);
    let state: { counter: number; tot: string } | null = null;
    await drive(ctx, {
      skipUntilFrame: 9000,
      steps: [{ run: () => (state = { counter: ctx.game.inter.variables!.readVar32(COUNTER_VAR), tot: ctx.game.curTotFile }) }],
    });
    expect(state).toEqual({ counter: 3, tot: "EMAM1017.TOT" });
  });
});
