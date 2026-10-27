import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import { parseMidi } from "../../src/data/mohawk/midi";
import { keepFirstMeasure } from "../../src/games/mathemagique/audio/rhythm-rewrite";
import { MidiPlayer, parsePrograms, parseSysx } from "../../src/engine/mohawk/audio/sequencer";
import type { MidiSink } from "../../src/engine/mohawk/audio/sink";
import { type MarkerEvent, type Song, parseSong } from "../../src/engine/mohawk/audio/smf";
import { MsvcRandom } from "../../src/games/mathemagique/engine/rng";
import {
  LEVEL_COUNT,
  PLST_SIZE,
  SONGS_PER_LEVEL,
  SONG_COUNT,
  buildSongList,
  loadPlst,
  loadSongList,
  parsePlst,
  parseStlv,
  songIndex,
  toolOf,
  variantCounterIndex,
  variantTools,
  type Plst,
  type PlstVariant,
} from "../../src/games/mathemagique/game/rhythm/data";
import { ALGEBIRD_CLICK_LINES, ERROR_LINES, ErrorLines, FINAL_ANIMATIONS, sizeRatio, tooSmallLine } from "../../src/games/mathemagique/game/rhythm/errors";
import {
  RHYTHM_HELP_EDGES,
  RHYTHM_HELP_EXIT_LINES,
  RHYTHM_HELP_ZONES,
  RHYTHM_POLY,
  ALGEBIRD_HELP_SCR,
} from "../../src/games/mathemagique/game/rhythm/help-config";
import {
  RhythmBoard,
  checkCut,
  currentVariant,
  evaluateTool,
  filledSlots,
  isPatternComplete,
  meldOverflow,
  nextVariant,
  recipe,
  recipeTexts,
} from "../../src/games/mathemagique/game/rhythm/logic";
import {
  MEASURE,
  PIECE_SIZES,
  type Tool,
  ghostShapeId,
  ghostSpriteIndex,
  isValidSize,
  pieceIndexAt,
  pieceShapeId,
  pieceSpan,
  reduceFraction,
  spriteIndex,
  unitAt,
} from "../../src/games/mathemagique/game/rhythm/pieces";
import {
  cueOf,
  danceStepsPerMeasure,
  partsTimeline,
  playRhythmSong,
  rhythmPlayOptions,
  songBeats,
  songBpm,
  ticksPerBeat,
  ticksPerMeasure,
  ticksPerSixteenth,
} from "../../src/games/mathemagique/game/rhythm/song";
import { PolyHelper, type PolyAnimation, type PolyPorts } from "../../src/games/mathemagique/game/poly";
import { POLY_ZONE, polyScriptIds } from "../../src/games/mathemagique/game/poly-config";
import { hasOriginalFiles, readOriginal } from "./helpers";

const cut = (n: number): Tool => ({ kind: "cut", n });
const glue = (size: number): Tool => ({ kind: "glue", size });
const meld = (target: number): Tool => ({ kind: "meld", target });

/** Variante synthétique : barre entière et outils (kind, param). */
function variant(...tools: [number, number][]): PlstVariant {
  const raw = tools.map(([kind, param]) => ({ kind, param }));
  while (raw.length < 9) raw.push({ kind: 0, param: 0 });
  return { parts: [144], tools: raw };
}

// --- Pièces ---------------------------------------------------------------------------------------------------------

describe("pièces : tailles, fractions, sprites", () => {
  it("les 30 tailles valides sont uniques, ≤ 144, et ont les sprites 2 à 31", () => {
    expect(PIECE_SIZES).toHaveLength(30);
    expect(new Set(PIECE_SIZES).size).toBe(30);
    expect(PIECE_SIZES.every((s) => s >= 9 && s <= MEASURE)).toBe(true);
    expect(PIECE_SIZES.map(spriteIndex)).toEqual(Array.from({ length: 30 }, (_, i) => i + 2));
    expect(isValidSize(54)).toBe(true);
    expect(isValidSize(7)).toBe(false);
    expect(isValidSize(10)).toBe(false);
  });

  it("fractions réduites", () => {
    expect(reduceFraction(54)).toEqual({ num: 3, den: 8 });
    expect(reduceFraction(16)).toEqual({ num: 1, den: 9 });
    expect(reduceFraction(144)).toEqual({ num: 1, den: 1 });
    expect(reduceFraction(9)).toEqual({ num: 1, den: 16 });
    expect(reduceFraction(108)).toEqual({ num: 3, den: 4 });
  });

  it("sprites : 144 → 2, 72 → 3, 9 → 24, 135 → 31, 7 → 0 ; fantôme +30", () => {
    expect([144, 72, 9, 135, 7].map(spriteIndex)).toEqual([2, 3, 24, 31, 0]);
    expect(ghostSpriteIndex(144)).toBe(32);
    expect(ghostSpriteIndex(135)).toBe(61);
    expect(ghostSpriteIndex(7)).toBe(0);
    expect(pieceShapeId(144)).toBe(30001);
    expect(ghostShapeId(144)).toBe(30031);
    expect(pieceShapeId(7)).toBe(0);
  });

  it("géométrie des bacs : position en unités, pièce sous la souris, étendue de dessin", () => {
    // Parts Bin (205, 231, 496, 274) : largeur 291 → (x − 205) × 288 / 287 / 2.
    expect(unitAt("parts", 205)).toBe(0);
    expect(unitAt("parts", 205 + 143)).toBe(71); // 143 × 288 / 287 = 143 (entier) / 2
    expect(unitAt("parts", 100)).toBeLessThan(0);
    const pattern = [-36, -36, -36]; // 3 emplacements du Pattern Bin (108 unités)
    expect(pieceIndexAt("pattern", pattern, 205)).toBe(0);
    expect(pieceIndexAt("pattern", pattern, 205 + 71)).toBe(0); // position 35
    expect(pieceIndexAt("pattern", pattern, 205 + 74)).toBe(1); // position 37
    expect(pieceIndexAt("pattern", pattern, 205 + 150)).toBe(2);
    expect(pieceIndexAt("pattern", pattern, 480)).toBe(-1); // après la dernière pièce
    expect(pieceIndexAt("pattern", pattern, 100)).toBe(-1);
    expect(pieceSpan("pattern", pattern, 0)).toEqual({ x: 207, w: 72 });
    expect(pieceSpan("pattern", pattern, 2)).toEqual({ x: 205 + 2 + 2 * 72, w: 72 });
  });
});

// --- Coupe / collage / fusion --------------------------------------------------------------------------------------

describe("Cutter", () => {
  it("vecteurs de la fiche", () => {
    expect(checkCut(16, 144)).toEqual({ ok: true, piece: 9 });
    expect(checkCut(16, 72)).toMatchObject({ ok: false, error: 3, ratio: 45 });
    expect(checkCut(5, 144)).toMatchObject({ ok: false, error: 4 });
    expect(checkCut(8, 144)).toEqual({ ok: true, piece: 18 });
    expect(checkCut(3, 72)).toEqual({ ok: true, piece: 24 });
    expect(checkCut(7, 144)).toMatchObject({ ok: false, error: 4 });
    expect(checkCut(2, 9)).toMatchObject({ ok: false, error: 3 });
  });

  it("q absent de la table → erreur 4 (ex. 144 / 12 = 12 est valide, 90 / 9... 10 ne l'est pas)", () => {
    expect(checkCut(12, 144)).toEqual({ ok: true, piece: 12 });
    expect(checkCut(9, 90)).toMatchObject({ ok: false, error: 4 }); // 10 n'est pas une taille
  });

  it("une seule pièce exigée (erreur 5), n pièces égales en sortie", () => {
    expect(evaluateTool([144], cut(4))).toEqual({ ok: true, removed: [144], added: [36, 36, 36, 36] });
    expect(evaluateTool([72, 72], cut(2))).toEqual({ ok: false, error: 5 });
    expect(evaluateTool([72], cut(16))).toMatchObject({ ok: false, error: 3, ratio: 45 });
    expect(evaluateTool([], cut(2))).toEqual({ ok: false, error: null });
  });
});

describe("Gluer", () => {
  it("1 pièce → erreur 7, tailles différentes → erreur 6, égales → somme", () => {
    expect(evaluateTool([18], glue(18))).toEqual({ ok: false, error: 7 });
    expect(evaluateTool([18, 36], glue(18))).toEqual({ ok: false, error: 6 });
    expect(evaluateTool([18, 18], glue(18))).toEqual({ ok: true, removed: [18, 18], added: [36] });
    expect(evaluateTool([36, 36, 36], glue(36))).toEqual({ ok: true, removed: [36, 36, 36], added: [108] });
  });
});

describe("Melder", () => {
  it("fusionne des pièces quelconques jusqu'à la cible", () => {
    expect(evaluateTool([36, 18], meld(54))).toEqual({ ok: true, removed: [36, 18], added: [54] });
    expect(evaluateTool([18], meld(54))).toEqual({ ok: false, error: 2 });
  });

  it("somme trop grande ou une seule pièce déjà à la cible : silence", () => {
    expect(evaluateTool([72], meld(72))).toEqual({ ok: false, error: null });
    expect(evaluateTool([72, 36], meld(54))).toEqual({ ok: false, error: null });
  });

  it("au dépôt : un Melder dépassé rend la pièce (rapport = 1re pièce × 10 / cible)", () => {
    expect(meldOverflow([], 72, meld(54))).toEqual({ ratio: 13 });
    expect(meldOverflow([36], 18, meld(54))).toBeNull();
    expect(meldOverflow([36], 36, meld(54))).toEqual({ ratio: 6 });
    expect(meldOverflow([36], 36, cut(2))).toBeNull();
    expect(meldOverflow([36], 36, null)).toBeNull();
  });
});

// --- Plateau, fantômes, victoire -----------------------------------------------------------------------------------

describe("RhythmBoard : fantômes, Empty, Undo", () => {
  const boogi = [36, 36, 36, 36];

  it("chargement : barre entière, motif en fantômes, outils rangés par famille", () => {
    const board = new RhythmBoard(boogi, variant([2, 2], [2, 4], [3, -18], [3, 144]));
    expect(board.parts).toEqual([144]);
    expect(board.pattern).toEqual([-36, -36, -36, -36]);
    expect(board.fractionator).toEqual([]);
    expect(board.tools).toEqual([cut(2), cut(4), null, glue(18), null, null, meld(144), null, null]);
    expect(board.activeToolIndex).toBe(0);
    expect(board.complete).toBe(false);
  });

  it("couper [144] en 4 puis Empty rend les 4 pièces (fantôme découpé)", () => {
    const board = new RhythmBoard(boogi, variant([2, 4]));
    expect(board.lift("parts", 0)).toEqual({ size: 144, from: "parts", index: 0 });
    expect(board.parts).toEqual([-144]);
    expect(board.drop({ size: 144, from: "parts", index: 0 }, "fractionator")).toMatchObject({ status: "placed", index: 0 });
    expect(board.doItReady).toBe(true);
    expect(board.doIt()).toMatchObject({ ok: true, removed: [144], added: [36, 36, 36, 36] });
    expect(board.fractionator).toEqual([36, 36, 36, 36]);
    expect(board.parts).toEqual([-36, -36, -36, -36]);
    board.empty();
    expect(board.fractionator).toEqual([]);
    expect(board.parts).toEqual([36, 36, 36, 36]);
  });

  it("Undo rétablit le Fractionator et les fantômes ; invalidé dès que les pièces bougent", () => {
    const board = new RhythmBoard(boogi, variant([2, 4]));
    const held = board.lift("parts", 0)!;
    board.drop(held, "fractionator");
    expect(board.canUndo).toBe(false);
    board.doIt();
    expect(board.canUndo).toBe(true);
    expect(board.undo()).toBe(true);
    expect(board.fractionator).toEqual([144]);
    expect(board.parts).toEqual([-144]);
    expect(board.canUndo).toBe(false);
    board.doIt();
    board.lift("fractionator", 0);
    expect(board.canUndo).toBe(false);
    expect(board.undo()).toBe(false);
  });

  it("collage et fusion regroupent les fantômes", () => {
    const board = new RhythmBoard([72, 36, 18, 18], variant([2, 2], [3, -72], [3, 54]));
    board.drop(board.lift("parts", 0)!, "fractionator");
    board.doIt(); // 144 → 72, 72
    expect(board.parts).toEqual([-72, -72]);
    board.empty();
    expect(board.parts).toEqual([72, 72]);
    board.selectTool(3); // Gluer 72 : une seule pièce → erreur 7
    board.drop(board.lift("parts", 0)!, "fractionator");
    expect(board.doIt()).toEqual({ ok: false, error: 7 });
    board.drop(board.lift("parts", 1)!, "fractionator");
    expect(board.doIt()).toMatchObject({ ok: true, added: [144] });
    expect(board.parts).toEqual([-144]);
    expect(board.fractionator).toEqual([144]);
  });

  it("outils : touches 1-9 / Tab, bouton vide ou actif sans effet, type 1 si des pièces restent", () => {
    const board = new RhythmBoard([72, 72], variant([2, 2], [3, 144]));
    expect(board.selectTool(2)).toEqual({ changed: false }); // vide
    expect(board.selectTool(0)).toEqual({ changed: false }); // déjà actif
    expect(board.selectTool(9)).toEqual({ changed: false });
    expect(board.nextTool()).toEqual({ changed: true });
    expect(board.activeTool).toEqual(meld(144));
    expect(board.nextTool()).toEqual({ changed: true });
    expect(board.activeTool).toEqual(cut(2)); // circulaire
    board.drop(board.lift("parts", 0)!, "fractionator");
    expect(board.selectTool(6)).toEqual({ changed: true });
    // 2 pièces dans le Fractionator
    board.empty();
    board.load([72, 72], variant([2, 2], [3, 144]));
    board.drop(board.lift("parts", 0)!, "fractionator");
    board.doIt();
    expect(board.selectTool(6)).toEqual({ changed: true, reaction: 1 });
  });

  it("Melder actif : le dépôt qui dépasse la cible est rendu avec la réaction de type 3", () => {
    const board = new RhythmBoard([54, 90], variant([2, 2], [3, 54]));
    board.drop(board.lift("parts", 0)!, "fractionator");
    board.doIt(); // 72 + 72
    board.selectTool(6);
    const held = board.lift("fractionator", 0)!;
    board.drop(held, "fractionator"); // 72 > 54
    expect(board.fractionator).toEqual([72, 72]);
    const again = board.lift("fractionator", 0)!;
    const result = board.drop(again, "fractionator");
    expect(result).toMatchObject({ status: "returned", reason: "meld-overflow", error: { type: 3 } });
    expect(board.fractionator).toEqual([72, 72]);
  });
});

describe("RhythmBoard : Pattern Bin et victoire", () => {
  it("emplacement de taille imposée : refus (retour d'où elle vient), reprise d'une pièce posée", () => {
    const board = new RhythmBoard([72, 36, 36], variant([2, 2], [2, 4]));
    board.drop(board.lift("parts", 0)!, "fractionator");
    board.doIt(); // 72, 72
    const held = board.lift("fractionator", 1)!;
    expect(board.drop(held, "pattern", 1)).toEqual({ status: "returned", reason: "refused" });
    expect(board.fractionator).toEqual([72, 72]);
    expect(board.pattern).toEqual([-72, -36, -36]);
    const again = board.lift("fractionator", 1)!;
    expect(board.drop(again, "pattern", 0)).toEqual({ status: "placed", bin: "pattern", index: 0, victory: "none" });
    expect(board.pattern).toEqual([72, -36, -36]);
    expect(board.filled.slice(0, 4)).toEqual([true, false, false, false]);
    // reprise d'une pièce posée, relâchée ailleurs : retour à son emplacement
    const back = board.lift("pattern", 0)!;
    expect(board.pattern).toEqual([-72, -36, -36]);
    expect(board.drop(back, undefined)).toEqual({ status: "returned", reason: "outside" });
    expect(board.pattern).toEqual([72, -36, -36]);
    expect(board.lift("pattern", 1)).toBeNull(); // fantôme
  });

  it("partie complète de Fanfare : victoire 'first' une seule fois, 'again' ensuite, variante suivante", () => {
    const board = new RhythmBoard([72, 72], variant([2, 2], [3, 144]));
    board.drop(board.lift("parts", 0)!, "fractionator");
    expect(board.doIt()).toMatchObject({ ok: true, added: [72, 72] });
    expect(board.drop(board.lift("fractionator", 0)!, "pattern", 0)).toMatchObject({ victory: "none" });
    const last = board.drop(board.lift("fractionator", 0)!, "pattern", 1);
    expect(last).toEqual({ status: "placed", bin: "pattern", index: 1, victory: "first" });
    expect(board.complete).toBe(true);
    expect(isPatternComplete(board.pattern)).toBe(true);
    // on reprend une pièce et on la repose : pas de nouveau décompte
    const reput = board.drop(board.lift("pattern", 1)!, "pattern", 1);
    expect(reput).toMatchObject({ victory: "again" });
    expect(nextVariant(0, 4)).toBe(1);
  });

  it("une pièce déposée dans le Parts Bin retrouve son fantôme ; sans fantôme elle revient", () => {
    const board = new RhythmBoard([72, 72], variant([2, 2]));
    const held = board.lift("parts", 0)!;
    expect(board.drop(held, "parts")).toEqual({ status: "placed", bin: "parts", index: 0, victory: "none" });
    expect(board.parts).toEqual([144]);
    const again = board.lift("parts", 0)!;
    expect(board.drop({ size: 72, from: "parts", index: 0 }, "parts")).toEqual({ status: "returned", reason: "no-ghost" });
    board.drop(again, undefined);
    expect(board.parts).toEqual([144]);
  });

  it("Fractionator plein : au plus 144 unités", () => {
    const board = new RhythmBoard([72, 72], variant([2, 2]));
    expect(board.drop({ size: 100, from: "parts", index: 0 }, "fractionator")).toMatchObject({ status: "placed" });
    expect(board.drop({ size: 100, from: "parts", index: 0 }, "fractionator")).toMatchObject({ status: "returned", reason: "no-room" });
  });
});

// --- Recette, variantes ---------------------------------------------------------------------------------------------

describe("recette du Teletune et variantes", () => {
  it("recettes de la fiche", () => {
    expect(recipeTexts([72, 36, 36])).toEqual(["(1) 1/2 bar", "(2) 1/4 bars"]);
    expect(recipeTexts([72, 72])).toEqual(["(2) 1/2 bars"]);
    expect(recipeTexts([24, 24, 24, 60, 12])).toEqual(["(1) 5/12 bar", "(3) 1/6 bars", "(1) 1/12 bar"]);
    expect(recipe([72, 36, 36])[1]).toEqual({ count: 2, size: 36, fraction: { num: 1, den: 4 } });
    // les pièces égales non adjacentes se regroupent aussi
    expect(recipeTexts([18, 36, 18, 36, 36])).toEqual(["(3) 1/4 bars", "(2) 1/8 bars"]);
  });

  it("progression des variantes", () => {
    expect(nextVariant(3, 4)).toBe(0);
    expect(nextVariant(1, 4)).toBe(2);
    expect(nextVariant(0, 4)).toBe(1);
    expect(currentVariant(2, 4)).toBe(2);
    expect(currentVariant(4, 4)).toBe(0);
    expect(currentVariant(200, 4)).toBe(0);
    expect(nextVariant(9, 4)).toBe(1);
    expect(songIndex(2, 14)).toBe(44);
    expect(variantCounterIndex(1, 3)).toBe(18);
    expect(() => songIndex(3, 0)).toThrow(RangeError);
    expect(() => songIndex(0, 15)).toThrow(RangeError);
  });

  it("outils bruts : Gluer si param < 2, Melder sinon", () => {
    expect(toolOf({ kind: 2, param: 4 })).toEqual(cut(4));
    expect(toolOf({ kind: 3, param: -18 })).toEqual(glue(18));
    expect(toolOf({ kind: 3, param: 54 })).toEqual(meld(54));
    expect(toolOf({ kind: 0, param: 0 })).toBeNull();
    expect(variantTools(variant([3, 54], [2, 2], [3, 72], [3, -18], [2, 3])).map((t) => t && t.kind)).toEqual(["cut", "cut", null, "glue", null, null, "meld", "meld", null]);
  });
});

// --- Erreurs d'Algebird ------------------------------------------------------------------------------------------------

describe("réactions d'Algebird", () => {
  it("tables de la fiche et rapport du type 3", () => {
    expect(ERROR_LINES[4]).toEqual([4000, 4100, 4200, 4300]);
    expect(ERROR_LINES[10]).toHaveLength(14);
    expect(sizeRatio(72, 16)).toBe(45);
    expect(tooSmallLine(45)).toBe(9800);
    expect(tooSmallLine(60)).toBe(9700);
    expect(tooSmallLine(80)).toBe(9600);
    expect(tooSmallLine(50)).toBeNull();
    const lines = new ErrorLines(new MsvcRandom(7));
    expect(lines.pick(3, 45)).toBe(9800);
    expect(ERROR_LINES[3]).toContain(lines.pick(3, 50));
    expect(lines.pick(11)).toBe(8500);
  });

  it("sans remise par type : toutes les répliques passent avant qu'une revienne", () => {
    const lines = new ErrorLines(new MsvcRandom(3));
    const seen = Array.from({ length: 4 }, () => lines.pick(4));
    expect(new Set(seen).size).toBe(4);
    const simple = new ErrorLines(new MsvcRandom(3), { noRepeat: false });
    for (let i = 0; i < 20; i++) expect(ERROR_LINES[5]).toContain(simple.pick(5));
  });

  it("clic sur Algebird et animation finale", () => {
    const lines = new ErrorLines(new MsvcRandom(11));
    for (let i = 0; i < 20; i++) {
      expect(ALGEBIRD_CLICK_LINES).toContain(lines.pickAlgebirdClick());
      expect(FINAL_ANIMATIONS).toContain(lines.pickFinalAnimation());
    }
  });
});

// --- Temps -----------------------------------------------------------------------------------------------------------------

describe("temps du jeu", () => {
  it("minuterie de 4 ms", () => {
    expect(ticksPerMeasure(170, 4)).toBe(352);
    expect(ticksPerBeat(170)).toBe(88);
    expect(ticksPerSixteenth(170)).toBe(22);
    expect([3, 4, 6].map(danceStepsPerMeasure)).toEqual([12, 16, 24]);
    expect(ticksPerBeat(130)).toBe(115);
    expect(ticksPerMeasure(130, 4)).toBe(461);
  });

  it("début des pièces de Tango (72, 36, 36) à 130 bpm", () => {
    const starts = partsTimeline([72, 36, 36], 130, 4);
    expect(starts.map((p) => p.startTick)).toEqual([0, 230, 345]);
    // les fantômes gardent leur place, seules les pièces sonnent
    expect(partsTimeline([-72, 36, 36], 130, 4).map((p) => [p.index, p.startTick])).toEqual([[1, 230], [2, 345]]);
  });
});

// --- PLST / STLV synthétiques -------------------------------------------------------------------------------------------

function plstBytes(pattern: number[], variants: [number, number][][]): Uint8Array {
  const words = new Array<number>(25 + 42 * variants.length).fill(0);
  pattern.forEach((v, i) => (words[i] = v));
  words[24] = variants.length;
  variants.forEach((tools, j) => {
    words[25 + 42 * j] = 144;
    tools.forEach(([kind, param], m) => {
      words[25 + 42 * j + 24 + 2 * m] = kind;
      words[25 + 42 * j + 24 + 2 * m + 1] = param & 0xffff;
    });
  });
  const bytes = new Uint8Array(words.length * 2);
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setUint16(2 * i, w, false));
  return bytes;
}

describe("parseStlv / parsePlst (octets synthétiques)", () => {
  it("PLST : motif, variantes, outils signés", () => {
    const plst = parsePlst(plstBytes([36, 36, 36, 36], [[[2, 2]], [[2, 2], [2, 4], [3, -18], [3, 144]], [[2, 2]], [[2, 2]]]));
    expect(plst.pattern).toEqual([36, 36, 36, 36]);
    expect(plst.variantCount).toBe(4);
    expect(plst.variants[1]!.tools.slice(0, 4)).toEqual([{ kind: 2, param: 2 }, { kind: 2, param: 4 }, { kind: 3, param: -18 }, { kind: 3, param: 144 }]);
    expect(plst.variants[1]!.parts).toEqual([144]);
  });

  it("refuse une PLST tronquée ou un motif qui ne fait pas une mesure", () => {
    expect(() => parsePlst(new Uint8Array(10))).toThrow();
    expect(() => parsePlst(plstBytes([36, 36], [[[2, 2]]]).subarray(0, 100))).toThrow(/octets/);
    expect(() => parsePlst(plstBytes([36, 36], [[[2, 2]]]))).toThrow(/144/);
  });

  it("STLV : 45 couples big-endian", () => {
    const bytes = new Uint8Array(180);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 45; i++) {
      view.setUint16(4 * i, 101 + 100 * Math.floor(i / 15) + (i % 15), false);
      view.setUint16(4 * i + 2, 30000 + i, false);
    }
    const entries = parseStlv(bytes);
    expect(entries).toHaveLength(45);
    expect(entries[15]).toEqual({ midiId: 201, plstId: 30015 });
    expect(() => parseStlv(new Uint8Array(100))).toThrow();
    const names = Array.from({ length: 45 }, (_, i) => `Song${i}`);
    const songs = buildSongList(entries, names);
    expect(songs[16]).toMatchObject({ index: 16, level: 1, slot: 1, name: "Song16", midiId: 202, plstId: 30016 });
  });
});

// --- Aide RSHELP (synthétique) ------------------------------------------------------------------------------------------------

class FakeAnimation implements PolyAnimation {
  done = true;
  interrupted = false;
  interrupt(): void {
    this.interrupted = true;
  }
}

function polySetup(seen = false) {
  const plays: number[] = [];
  const ports: PolyPorts = {
    play(scr) {
      plays.push(scr);
      return new FakeAnimation();
    },
  };
  const flag = { value: seen };
  const closed = { n: 0 };
  const poly = new PolyHelper(RHYTHM_POLY, {
    ports,
    rng: new MsvcRandom(5),
    introFlag: { get: () => flag.value, set: (v) => (flag.value = v) },
    onClosed: () => closed.n++,
  });
  const drain = () => {
    for (let guard = 0; guard < 20 && poly.currentScr !== null; guard++) poly.tick();
  };
  return { plays, poly, drain, flag, closed };
}

describe("aide du Rhythm Shop (RHYTHM_POLY)", () => {
  it("19 zones, rects de la fiche, les deux premières sortent de l'aide", () => {
    expect(RHYTHM_HELP_ZONES).toHaveLength(19);
    expect(RHYTHM_HELP_ZONES.map((z) => z.index)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(RHYTHM_HELP_EDGES[2]).toEqual([205, 231, 496, 274]);
    expect(RHYTHM_HELP_EDGES[16]).toEqual([19, 257, 166, 410]);
    expect(RHYTHM_HELP_ZONES[0]!.key).toBe(POLY_ZONE);
    expect(RHYTHM_HELP_ZONES[1]!.key).toBe(POLY_ZONE);
    for (const zone of RHYTHM_HELP_ZONES.slice(2)) expect(Object.keys(RHYTHM_POLY.topics)).toContain(zone.key);
  });

  it("ouverture : 1100 puis 1800 la première fois, 1600 ensuite", () => {
    const first = polySetup(false);
    first.poly.open();
    first.drain();
    expect(first.plays).toEqual([1100, 1800]);
    expect(first.flag.value).toBe(true);
    const later = polySetup(true);
    later.poly.open();
    later.drain();
    expect(later.plays).toEqual([1100, 1600]);
  });

  it("explications encadrées par 2200 / 2300, sauf Fractionator, Help, Exit et Algebird", () => {
    const { plays, poly, drain } = polySetup(true);
    poly.open();
    drain();
    plays.length = 0;
    poly.click("partsBin");
    drain();
    expect(plays).toEqual([2200, 1900, 2300]);
    plays.length = 0;
    for (const [key, scr] of [["fractionator", 1300], ["help", 1500], ["exit", 3700], ["algebird", ALGEBIRD_HELP_SCR]] as const) {
      poly.click(key);
      drain();
      expect(plays).toEqual([scr]);
      plays.length = 0;
    }
    poly.click("melder");
    drain();
    expect(plays).toEqual([2200, 900, 2300]);
  });

  it("sortie : une réplique parmi 2700-3600, puis 1200 ; l'aide se ferme", () => {
    const { plays, poly, drain, closed } = polySetup(true);
    poly.open();
    drain();
    plays.length = 0;
    poly.click(POLY_ZONE);
    drain();
    expect(RHYTHM_HELP_EXIT_LINES).toContain(plays[0]!);
    expect(plays[1]).toBe(1200);
    expect(poly.phase).toBe("closed");
    expect(closed.n).toBe(1);
  });
});

// --- Données réelles --------------------------------------------------------------------------------------------------------------

const SOLVER_LIMIT = 200_000;

/** Sac de pièces (tailles → nombre) → clé stable. */
const keyOf = (bag: Map<number, number>) => [...bag.entries()].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}x${n}`).join(",");

/** La variante est-elle réalisable avec les règles du Fractionator ? (parcours exhaustif des sacs de pièces, avec mémoire) */
function solvable(pattern: readonly number[], tools: readonly (Tool | null)[]): boolean {
  const goal = new Map<number, number>();
  for (const size of pattern) goal.set(size, (goal.get(size) ?? 0) + 1);
  const goalKey = keyOf(goal);
  const seen = new Set<string>();
  const stack: Map<number, number>[] = [new Map([[144, 1]])];
  let steps = 0;
  while (stack.length > 0) {
    const bag = stack.pop()!;
    const key = keyOf(bag);
    if (key === goalKey) return true;
    if (seen.has(key) || ++steps > SOLVER_LIMIT) continue;
    seen.add(key);
    const next = (removed: number[], added: number[]) => {
      const copy = new Map(bag);
      for (const s of removed) copy.set(s, copy.get(s)! - 1);
      for (const s of added) copy.set(s, (copy.get(s) ?? 0) + 1);
      stack.push(copy);
    };
    for (const tool of tools) {
      if (!tool) continue;
      if (tool.kind === "cut") {
        for (const [size, n] of bag) if (n > 0) {
          const result = evaluateTool([size], tool);
          if (result.ok) next(result.removed, result.added);
        }
      } else if (tool.kind === "glue") {
        const n = bag.get(tool.size) ?? 0;
        for (let k = 2; k <= n; k++) next(Array(k).fill(tool.size), [tool.size * k]);
      } else {
        // sous-multiensembles (≥ 2 pièces) de somme = cible
        const sizes = [...bag.entries()].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
        const pick: number[] = [];
        const walk = (i: number, left: number) => {
          if (left === 0) {
            if (pick.length >= 2) next([...pick], [tool.target]);
            return;
          }
          if (i >= sizes.length) return;
          const [size, count] = sizes[i]!;
          for (let c = 0; c <= count && c * size <= left; c++) {
            for (let j = 0; j < c; j++) pick.push(size);
            walk(i + 1, left - c * size);
            pick.length -= c;
          }
        };
        walk(0, tool.target);
      }
    }
  }
  return false;
}

describe.runIf(hasOriginalFiles)("données réelles de RHYTHM.DAT", () => {
  const rhythm = MohawkArchive.parse(readOriginal("RHYTHM.DAT"));
  const raw = { raw: (tag: string, id: number) => rhythm.get(tag, id) };
  const songs = loadSongList(raw);
  const plsts: Plst[] = songs.map((song) => loadPlst(raw, song.plstId));

  it("STLV : 45 couples, indices de référence", () => {
    const entries = parseStlv(rhythm.get("STLV", 30000));
    expect(entries).toHaveLength(SONG_COUNT);
    expect(entries[0]).toEqual({ midiId: 101, plstId: 30000 });
    expect(entries[14]).toEqual({ midiId: 115, plstId: 30014 });
    expect(entries[15]).toEqual({ midiId: 201, plstId: 30015 });
    expect(entries[44]).toEqual({ midiId: 315, plstId: 30044 });
    expect(entries.map((e) => e.plstId)).toEqual(Array.from({ length: 45 }, (_, i) => 30000 + i));
  });

  it("liste des morceaux : noms de STRL 30001 par niveau", () => {
    expect(songs).toHaveLength(45);
    expect(songs[0]).toMatchObject({ name: "Fanfare", level: 0, slot: 0, midiId: 101 });
    expect(songs[2]!.name).toBe("Boogi Woogi");
    expect(songs[15]!.name).toBe("Pompadoo");
    expect(songs[44]).toMatchObject({ name: "Doodlydoo", level: LEVEL_COUNT - 1, slot: SONGS_PER_LEVEL - 1, midiId: 315 });
  });

  it("PLST : 386 octets, motif et outils de référence", () => {
    for (const song of songs) expect(rhythm.get("PLST", song.plstId)).toHaveLength(PLST_SIZE);
    const fanfare = parsePlst(rhythm.get("PLST", 30000));
    expect(fanfare.pattern).toEqual([72, 72]);
    expect(fanfare.variantCount).toBe(4);
    expect(fanfare.variants[0]!.tools.slice(0, 2)).toEqual([{ kind: 2, param: 2 }, { kind: 3, param: 144 }]);
    const boogi = parsePlst(rhythm.get("PLST", 30002));
    expect(boogi.pattern).toEqual([36, 36, 36, 36]);
    expect(boogi.variants[1]!.tools.slice(0, 4)).toEqual([{ kind: 2, param: 2 }, { kind: 2, param: 4 }, { kind: 3, param: -18 }, { kind: 3, param: 144 }]);
    expect(recipeTexts(plsts[0]!.pattern)).toEqual(["(2) 1/2 bars"]);
    expect(recipeTexts(plsts[44]!.pattern)).toEqual(["(1) 5/12 bar", "(3) 1/6 bars", "(1) 1/12 bar"]);
  });

  it("45 motifs : somme 144, tailles valides, ≤ 16 pièces ; 4 variantes avec barre entière et au plus 3 outils par famille", () => {
    plsts.forEach((plst, k) => {
      expect(plst.pattern.reduce((a, b) => a + b, 0), `motif ${k}`).toBe(144);
      expect(plst.pattern.every(isValidSize), `tailles ${k}`).toBe(true);
      expect(plst.pattern.length).toBeLessThanOrEqual(16);
      expect(plst.variantCount).toBe(4);
      for (const v of plst.variants) {
        expect(v.parts).toEqual([144]);
        const known = v.tools.filter((t) => toolOf(t) !== null);
        expect(known.length, `outils ${k}`).toBeGreaterThan(0);
        expect(variantTools(v).filter((t) => t !== null)).toHaveLength(known.length); // aucun outil perdu au rangement
        expect(variantTools(v)[0], `outil 0 de ${k}`).not.toBeNull();
      }
    });
  });

  it("chaque variante des 45 morceaux est réalisable avec les règles des outils", () => {
    const failures: string[] = [];
    plsts.forEach((plst, k) =>
      plst.variants.forEach((v, j) => {
        if (!solvable(plst.pattern, variantTools(v))) failures.push(`${songs[k]!.name} v${j}`);
      }),
    );
    expect(failures).toEqual([]);
  });

  it("le solveur refuse une variante impossible (garde-fou du test précédent)", () => {
    expect(solvable([36, 36, 36, 36], [cut(3)])).toBe(false);
    expect(solvable([36, 36, 36, 36], [cut(2)])).toBe(true);
    expect(solvable([54, 90], [cut(8), meld(54), meld(90)])).toBe(true);
    expect(solvable([54, 90], [cut(2), meld(54)])).toBe(false);
  });

  it("partie jouée de bout en bout sur Fanfare variante 0", () => {
    const plst = plsts[0]!;
    const board = new RhythmBoard(plst.pattern, plst.variants[0]!);
    board.drop(board.lift("parts", pieceIndexAt("parts", board.parts, 300))!, "fractionator");
    expect(board.doIt().ok).toBe(true);
    board.drop(board.lift("fractionator", pieceIndexAt("fractionator", board.fractionator, 200))!, "pattern", pieceIndexAt("pattern", board.pattern, 210));
    const win = board.drop(board.lift("fractionator", 0)!, "pattern", pieceIndexAt("pattern", board.pattern, 400));
    expect(win).toMatchObject({ status: "placed", victory: "first" });
  });

  describe("musique (MIDIMPC.DAT, MIDIMAP.DAT)", () => {
    const midi = MohawkArchive.parse(readOriginal("MIDIMPC.DAT"));
    const map = MohawkArchive.parse(readOriginal("MIDIMAP.DAT"));
    const resource = (id: number) => parseMidi(midi.get("\0SND", id));
    const songOf = (id: number): Song => parseSong(resource(id).smf);

    it("Fanfare 101 : tempo 170, 4/4, bloc Prg#, une mesure après réécriture", () => {
      const song = songOf(101);
      expect(songBpm(song)).toBe(170);
      expect(songBeats(song)).toBe(4);
      expect(Object.fromEntries(parsePrograms(resource(101).programs).map((p) => [p.program, p.channelMask]))).toEqual({ 0: 0x200, 32: 2, 47: 1, 56: 0x14, 63: 8 });
      const measure = keepFirstMeasure(song.events);
      expect(measure[measure.length - 1]).toMatchObject({ kind: "end", tick: 1920 });
    });

    it("tempo et mesure des morceaux de référence", () => {
      const expected: [number, number, number][] = [[101, 170, 4], [102, 130, 4], [111, 160, 3], [115, 80, 3], [303, 122, 6], [304, 107, 4]];
      for (const [id, bpm, beats] of expected) {
        const song = songOf(id);
        expect([id, songBpm(song), songBeats(song)]).toEqual([id, bpm, beats]);
      }
    });

    it("SYSX de MIDIMAP : 64 messages, 4 groupes de 16 canaux", () => {
      const messages = parseSysx(map.get("SYSX", 1));
      expect(messages).toHaveLength(64);
      const group = (g: number) => messages.slice(16 * g, 16 * g + 16);
      expect(group(0).map((m) => [m[1], m[2]])).toEqual(Array(16).fill([121, 0]));
      expect(group(1).map((m) => [m[1], m[2]])).toEqual(Array(16).fill([7, 127]));
      expect(group(2).map((m) => [m[1], m[2]])).toEqual(Array(16).fill([11, 90]));
      expect(group(3).map((m) => [m[1], m[2]])).toEqual(Array(16).fill([10, 64]));
    });

    it("45 morceaux : les repères de la première mesure suivent le motif de la PLST (a.. = pièces, 1.. = temps)", () => {
      songs.forEach((info, k) => {
        const song = songOf(info.midiId);
        const cues = keepFirstMeasure(song.events).flatMap((e) => (e.kind === "marker" ? [cueOf(e)] : [])).filter((c) => c !== null);
        const slots = cues.filter((c) => c.type === "slot").map((c) => c.slot);
        const beats = cues.filter((c) => c.type === "beat").map((c) => c.beat);
        expect(slots, `${info.name} emplacements`).toEqual(plsts[k]!.pattern.map((_, i) => i));
        expect(beats, `${info.name} temps`).toEqual(Array.from({ length: songBeats(song) }, (_, i) => i + 1));
      });
    });

    it("positions des repères = débuts de pièces du motif (Tango : 72, 36, 36)", () => {
      const song = songOf(102);
      const first = keepFirstMeasure(song.events);
      const slotTicks = first.flatMap((e) => (e.kind === "marker" && cueOf(e)?.type === "slot" ? [e.tick] : []));
      const measureTicks = song.division * songBeats(song);
      expect(slotTicks.map((t) => Math.round((t / measureTicks) * 144))).toEqual([0, 72, 108]);
    });

    class FakeSink implements MidiSink {
      sent: { bytes: number[]; at: number | undefined }[] = [];
      send(message: Uint8Array, atMs?: number): void {
        this.sent.push({ bytes: [...message], at: atMs });
      }
      reset(): void {}
      audibleNotes() {
        return this.sent.filter((m) => (m.bytes[0]! & 0xf0) === 0x90 && m.bytes[2]! > 0);
      }
    }

    function play(id: number, pattern: number[]) {
      const sink = new FakeSink();
      const clock = { t: 1000 };
      const player = new MidiPlayer(sink, { now: () => clock.t, initMessages: parseSysx(map.get("SYSX", 1)) });
      const song = songOf(id);
      const cues: { cue: ReturnType<typeof cueOf>; at: number }[] = [];
      let ended = 0;
      const complete = playRhythmSong({ playSong: (s, options) => player.play(s, options) }, song, {
        pattern,
        programs: parsePrograms(resource(id).programs),
        onCue: (cue) => cues.push({ cue, at: clock.t }),
        onEnd: () => ended++,
      });
      const start = clock.t + 20;
      while (player.playing && clock.t < 20_000) {
        clock.t += 17;
        player.tick();
      }
      return { sink, cues, ended, complete, start, song, player };
    }

    it("motif complet : Fanfare entière, non réécrite (10 repères a, fin unique à z - end)", () => {
      const { cues, ended, complete, sink } = play(101, [72, 72]);
      expect(complete).toBe(true);
      expect(ended).toBe(1);
      const letters = cues.map((c) => (c.cue!.type === "slot" ? "abcdefgh"[c.cue!.slot] : ""));
      expect(letters.filter((l) => l === "a")).toHaveLength(10);
      expect(cues.length).toBeGreaterThan(40);
      expect(sink.audibleNotes().length).toBeGreaterThan(play(101, [72, -72]).sink.audibleNotes().length);
    });

    it("motif incomplet : repères 1 a 2 3 b 4 à l'heure, fin unique, mesure unique", () => {
      const { cues, ended, start, song, complete } = play(101, [72, -72]);
      expect(complete).toBe(false);
      expect(ended).toBe(1);
      expect(cues.map((c) => (c.cue!.type === "slot" ? "abcdefgh"[c.cue!.slot] : String(c.cue!.beat)))).toEqual(["1", "a", "2", "3", "b", "4"]);
      // chaque repère est signalé à son heure (jamais en avance, à un tick du moteur près), au tempo entier du jeu
      const speed = 170 / (60_000_000 / 352_941);
      for (const { cue, at } of cues) {
        const due = start + cue!.ms / speed;
        expect(at).toBeGreaterThanOrEqual(due - 1e-6);
        expect(at - due).toBeLessThan(17 + 1e-6);
      }
      const lastNote = Math.max(...song.events.filter((e) => e.kind === "end").map((e) => e.ms));
      expect(lastNote).toBeGreaterThan(cues[cues.length - 1]!.cue!.ms); // le morceau complet est plus long : seule une mesure a été jouée
    });

    it("emplacements vides muets : le motif [a rempli, b vide] ne fait sonner que l'emplacement a", () => {
      const full = play(101, [72, 72]);
      const half = play(101, [72, -72]);
      const none = play(101, [-72, -72]);
      expect(half.complete).toBe(false);
      expect(full.sink.audibleNotes().length).toBeGreaterThan(half.sink.audibleNotes().length);
      expect(half.sink.audibleNotes().length).toBeGreaterThan(0);
      expect(none.sink.audibleNotes()).toHaveLength(0);
      // aucune note audible après le repère b (tick 959)
      const slotB = half.cues.find((c) => c.cue!.type === "slot" && c.cue!.slot === 1)!.cue!;
      const speed = 170 / (60_000_000 / 352_941);
      for (const note of half.sink.audibleNotes()) expect(note.at! - half.start).toBeLessThanOrEqual(slotB.ms / speed + 1e-6);
      // les cues sont routés quand même (la scène éclaire les pièces vides aussi : le jeu ne s'en sert que si le motif est complet)
      expect(half.cues.map((c) => c.cue!.type)).toEqual(none.cues.map((c) => c.cue!.type));
    });

    it("initialisation : SYSX de MIDIMAP puis programmes du bloc Prg#", () => {
      const { sink } = play(101, [72, 72]);
      expect(sink.sent.slice(0, 64).every((m) => (m.bytes[0]! & 0xf0) === 0xb0)).toBe(true);
      const programChanges = sink.sent.filter((m) => (m.bytes[0]! & 0xf0) === 0xc0).slice(0, 7);
      expect(programChanges.length).toBeGreaterThan(0);
    });

    it("rhythmPlayOptions : MIDI entier non réécrit si le motif est complet (DS:2594), une mesure réécrite sinon (1058:125e)", () => {
      const song = songOf(101);
      expect(rhythmPlayOptions(song, { pattern: [72, 72] }).rewrite).toBeUndefined();
      expect(rhythmPlayOptions(song, { pattern: [72, -72] }).rewrite).toBeTypeOf("function");
      // Fanfare entière : 10 mesures (10 repères `a`), terminée par `z - end` à 19200 ; la chorégraphie (4, 8 ou 12 mesures) boucle dessus.
      const cues = song.events.filter((e) => e.kind === "marker" && e.metaType === 7) as MarkerEvent[];
      expect(cues.filter((c) => c.text === "a")).toHaveLength(10);
      expect(cues.at(-1)).toMatchObject({ text: "z - end", tick: 19200 });
    });

    it("rhythmPlayOptions : tempo entier, pas de boucle par défaut", () => {
      const options = rhythmPlayOptions(songOf(101), { pattern: [72, -72] });
      expect(options.bpm).toBe(170);
      expect(options.loop).toBeUndefined();
      expect(options.rewrite).toBeTypeOf("function");
      expect(rhythmPlayOptions(songOf(101), { pattern: [72, 72], loop: true, bpm: 120 })).toMatchObject({ loop: true, bpm: 120 });
    });
  });

  it("scripts d'aide : tous dans RSHELP.DAT (8500 dans RHYTHM.DAT)", () => {
    const help = MohawkArchive.parse(readOriginal("RSHELP.DAT"));
    for (const id of polyScriptIds(RHYTHM_POLY)) {
      if (id === ALGEBIRD_HELP_SCR) expect(rhythm.has("\0SCR", id), `RHYTHM ${id}`).toBe(true);
      else expect(help.has("\0SCR", id), `RSHELP ${id}`).toBe(true);
    }
  });

  it("réactions d'Algebird : tous les ids existent dans RHYTHM.DAT", () => {
    const ids = new Set<number>([...Object.values(ERROR_LINES).flat(), ...ALGEBIRD_CLICK_LINES, ...FINAL_ANIMATIONS, 9600, 9700, 9800]);
    for (const id of ids) expect(rhythm.has("\0SCR", id), `SCR ${id}`).toBe(true);
  });
});

describe("cueOf", () => {
  const marker = (text: string, metaType = 7): MarkerEvent => ({ kind: "marker", text, metaType, tick: 480, ms: 100 });
  it("a-x → emplacement, 1-8 → temps, le reste ignoré", () => {
    expect(cueOf(marker("a"))).toEqual({ type: "slot", slot: 0, tick: 480, ms: 100 });
    expect(cueOf(marker("e  "))).toMatchObject({ type: "slot", slot: 4 });
    expect(cueOf(marker("x"))).toMatchObject({ type: "slot", slot: 23 });
    expect(cueOf(marker("3"))).toEqual({ type: "beat", beat: 3, tick: 480, ms: 100 });
    expect(cueOf(marker("9"))).toBeNull();
    expect(cueOf(marker("y"))).toBeNull();
    expect(cueOf(marker("z - end"))).toBeNull();
    expect(cueOf(marker("a", 6))).toBeNull();
    expect(cueOf(marker(""))).toBeNull();
  });
});

describe("filledSlots", () => {
  it("24 drapeaux : une pièce posée = vrai", () => {
    const flags = filledSlots([72, -72]);
    expect(flags).toHaveLength(24);
    expect(flags.slice(0, 3)).toEqual([true, false, false]);
  });
});
