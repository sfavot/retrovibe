import { describe, expect, it } from "vitest";
import { toUnicode } from "../../../src/games/bass/data/charset";
import { CompactField as F } from "../../../src/games/bass/data/compact-fields";
import { DATA_FILE_HEADER_SIZE } from "../../../src/games/bass/data/header";
import type { BassEngine } from "../../../src/games/bass/engine/game";
import { MouseButton } from "../../../src/games/bass/engine/host";
import { Cpt, L, SF, ST, TOP_LEFT_X, TOP_LEFT_Y, Var } from "../../../src/games/bass/engine/ids";
import { MCODES, mcodeNumber } from "../../../src/games/bass/engine/mcodes/index";
import type { BassSound, Router } from "../../../src/games/bass/engine/services";
import {
  applyTextVoiceMode,
  BassTextManager,
  FIRST_TEXT_BUFFER,
  textVoiceModeOf,
  textVoiceOptions,
  type TextVoiceMode,
} from "../../../src/games/bass/engine/text";
import { TraceRecorder } from "../../../src/games/bass/engine/trace";
import { AutoRoute } from "../../../src/games/bass/engine/route/autoroute";
import { Grid } from "../../../src/games/bass/engine/route/grid";
import { BassScreenRenderer } from "../../../src/games/bass/render/screen";
import { readReferenceFrame } from "../render/harness";
import { skyDisk } from "../data/helpers";
import { hasOriginalFiles, lineCycle, makeEngine, readFixture } from "./helpers";

/** « Je pourrais L'UTILISER... » : deux lignes dans 128 pixels, avec une voix (50659). */
const LINE_WITH_VOICE = 4155;
/** « Hé, attendez. » : un accent détourné, pas de voix. */
const LINE_NO_VOICE = 28674;

/** Voix factices : durée fixe, sur l'horloge du moteur, comme `BassSpeech` (qui suit l'horloge du jeu). */
class FakeVoices implements BassSound {
  started: number[] = [];
  stops = 0;
  private endsAt = 0;

  constructor(
    private readonly engine: () => BassEngine,
    private readonly available: ReadonlySet<number>,
    private readonly durationMs: number,
  ) {}

  loadSection(): void {}
  startMusic(): void {}
  startFx(): void {}
  stopFx(): void {}
  pauseFx(): void {}
  unPauseFx(): void {}
  checkFxQueue(): void {}

  startSpeech(textNum: number): boolean {
    const e = this.engine();
    if (!(e.system.systemFlags & SF.ALLOW_SPEECH)) return false; // `Sound::startSpeech`
    if (!this.available.has(textNum)) return false;
    this.started.push(textNum);
    this.endsAt = e.timeMs + this.durationMs;
    return true;
  }

  speechFinished(): boolean {
    return this.engine().timeMs >= this.endsAt;
  }

  stopSpeech(): void {
    this.stops++;
    this.endsAt = 0;
  }
}

interface Rig {
  engine: BassEngine;
  text: BassTextManager;
  voices: FakeVoices;
  host: ReturnType<typeof makeEngine>["host"];
}

function rig(options: { mode?: TextVoiceMode; routing?: boolean; trace?: TraceRecorder; renderer?: BassScreenRenderer } = {}): Rig {
  let engine!: BassEngine;
  const disk = skyDisk();
  const voices = new FakeVoices(() => engine, new Set([LINE_WITH_VOICE]), 1400);
  let router: AutoRoute | undefined;
  const lazyRouter: Router = { autoRoute: (cpt) => (router ??= new AutoRoute(grid, engine.compacts)).autoRoute(cpt) };
  const grid = new Grid({ disk, get vars() { return engine.vars; }, get compacts() { return engine.compacts; } });
  const { subtitles, speech } = textVoiceOptions(options.mode ?? "both");
  const made = makeEngine({ sound: voices, subtitles, speech, trace: options.trace, ...(options.renderer ? { screen: (e: BassEngine) => options.renderer!.attach(e) } : {}), ...(options.routing ? { grid, router: lazyRouter } : {}) });
  engine = made.engine;
  engine.startAfterIntro();
  return { engine, text: engine.text as BassTextManager, voices, host: made.host };
}

/** Compacts de texte (23 à 33) encore affichés. */
function liveTexts(engine: BassEngine): number[] {
  const ids: number[] = [];
  for (let id = Cpt.TEXT_1; id <= Cpt.TEXT_11; id++) if (engine.compacts.require(id)[F.status]) ids.push(id);
  return ids;
}

/** Textes affichés qui ne sont pas le nom de l'objet pointé (`L_CURSOR`). */
function speechTexts(engine: BassEngine): number[] {
  return liveTexts(engine).filter((id) => engine.compacts.require(id)[F.logic] !== L.CURSOR);
}

describe("modes texte / voix (fonctions pures)", () => {
  it("trois modes : drapeaux du moteur, retour aux modes, application à chaud", () => {
    expect(textVoiceOptions("both")).toEqual({ subtitles: true, speech: true });
    expect(textVoiceOptions("text")).toEqual({ subtitles: true, speech: false });
    expect(textVoiceOptions("voice")).toEqual({ subtitles: false, speech: true });
    for (const mode of ["both", "text", "voice"] as const) {
      const system = { systemFlags: SF.SBLASTER };
      const audio = { speechOn: true };
      applyTextVoiceMode(system, mode, audio);
      expect(textVoiceModeOf(system.systemFlags)).toBe(mode);
      expect(system.systemFlags & SF.SBLASTER).toBe(SF.SBLASTER);
      expect(audio.speechOn).toBe(mode !== "text");
    }
  });
});

describe.skipIf(!hasOriginalFiles)("BassTextManager : textes français et sprites", () => {
  it("décode et met en page des lignes connues (accents détournés, deux lignes, largeur fixe)", () => {
    const { engine, text } = rig();
    expect(toUnicode(text.getText(LINE_WITH_VOICE))).toBe("Je pourrais L'UTILISER...");
    expect(toUnicode(text.getText(LINE_NO_VOICE))).toBe("Hé, attendez.");

    const long = text.lowTextManager(LINE_WITH_VOICE, 128, 0, 200, true);
    expect([long.width, long.height, long.textWidth]).toEqual([128, 24, 64]);
    expect(long.numLetters).toBe(40); // 25 lettres, 13 relues après la coupure, plus 2 (`_numLetters`)
    const short = text.lowTextManager(LINE_NO_VOICE, 128, 0, 200, true);
    expect([short.width, short.height, short.numLetters]).toEqual([128, 12, 15]);

    // Sprite : en-tête de 22 octets, puis pixels indexés (0 transparent, couleur du texte, 240 contour), puis 4 octets.
    const sprite = short.sprite!;
    expect(sprite.length).toBe(DATA_FILE_HEADER_SIZE + 128 * 12 + 4);
    const pixels = new Set(sprite.subarray(DATA_FILE_HEADER_SIZE, DATA_FILE_HEADER_SIZE + 128 * 12));
    expect([...pixels].sort((a, b) => a - b)).toEqual([0, 200, 240]);
    // Centré : l'encre reste à l'écart des deux bords (texte de 69 pixels dans 128).
    const columns = [...Array(128).keys()].filter((x) => [...Array(12).keys()].some((y) => sprite[DATA_FILE_HEADER_SIZE + y * 128 + x]));
    expect(columns[0]).toBeGreaterThanOrEqual(28);
    expect(columns.at(-1)).toBeLessThanOrEqual(100);

    // Aligné à gauche (pointeur, LINC) : l'encre commence au bord.
    const left = text.lowTextManager(LINE_NO_VOICE, 128, 0, 200, false).sprite!;
    expect([...Array(12).keys()].some((y) => left[DATA_FILE_HEADER_SIZE + y * 128 + 1])).toBe(true);
    expect(engine.journal).toEqual([]);
  });

  it("alloue un compact de texte libre : sprite rangé en `_itemList`, statut, logique, écran ; le compact libéré est réutilisé", () => {
    const { engine, text } = rig();
    engine.vars[Var.SCREEN] = 7;
    const a = text.lowTextManager(LINE_NO_VOICE, 128, L.CURSOR, 242, false);
    const b = text.lowTextManager(LINE_NO_VOICE, 128, 0, 242, false);
    expect([a.compactNum, b.compactNum]).toEqual([Cpt.TEXT_1, Cpt.TEXT_1 + 1]);
    const cpt = engine.compacts.require(a.compactNum);
    expect(cpt[F.status]).toBe(ST.LOGIC | ST.FOREGROUND | ST.RECREATE);
    expect([cpt[F.logic], cpt[F.screen], cpt[F.flag]]).toEqual([L.CURSOR, 7, FIRST_TEXT_BUFFER]);
    expect(engine.items.fetch(FIRST_TEXT_BUFFER)).toBe(a.sprite);
    expect(engine.items.fetch(FIRST_TEXT_BUFFER + 1)).toBe(b.sprite);
    cpt[F.status] = 0;
    expect(text.lowTextManager(LINE_NO_VOICE, 128, 0, 242, false).compactNum).toBe(Cpt.TEXT_1);
  });

  it("onze textes au plus : le dernier compact est réutilisé et le fait est journalisé", () => {
    const { engine, text } = rig();
    for (let i = 0; i < 11; i++) text.lowTextManager(LINE_NO_VOICE, 128, 0, 242, false);
    expect(liveTexts(engine)).toHaveLength(11);
    expect(text.lowTextManager(LINE_NO_VOICE, 128, 0, 242, false).compactNum).toBe(Cpt.TEXT_11);
    expect(engine.journal.some((m) => m.includes("plus de compact de texte libre"))).toBe(true);
  });

  it("texte du pointeur (`fnPointerText`, `logicCursor`) : côté de la souris, bas de l'écran de jeu", () => {
    const { engine, text } = rig();
    const barre = 85; // « barre »
    text.pointerText(barre, 17, 70);
    const first = engine.compacts.require(engine.vars[Var.CURSOR_ID]!);
    expect(engine.vars[Var.CURSOR_ID]).toBe(Cpt.TEXT_1);
    expect(first[F.logic]).toBe(L.CURSOR);
    expect([first[F.xcood], first[F.ycood]]).toEqual([17 + TOP_LEFT_X + 13, 70 + TOP_LEFT_Y - 10]);
    text.logicCursor(first, 17, 0);
    expect(first[F.ycood]).toBe(TOP_LEFT_Y); // pas au-dessus de la zone de jeu
    // Souris à droite : le texte passe à gauche du curseur (largeur de la dernière ligne).
    first[F.status] = 0;
    text.pointerText(barre, 200, 100);
    const right = engine.compacts.require(engine.vars[Var.CURSOR_ID]!);
    const width = text.lowTextManager(engine.compacts.require(barre)[F.cursorText]!, 128, 0, 242, false).textWidth;
    expect(right[F.xcood]).toBe(200 + TOP_LEFT_X - 8 - width);
    engine.vars[Var.MENU] = 1;
    text.pointerText(barre, 17, 70);
    const menu = engine.compacts.require(engine.vars[Var.CURSOR_ID]!);
    expect([menu[F.xcood], menu[F.ycood]]).toEqual([17 + TOP_LEFT_X + 24, 70 + TOP_LEFT_Y - 2]);
  });

  it("module de texte (`fnTextModule`, police des liens) et surbrillance (`changeTextSpriteColor`)", () => {
    const { engine, text } = rig();
    const info = engine.compacts.require(Cpt.TEXT_11 + 5); // un compact quelconque sert de description
    info[1] = 100;
    info[2] = 3;
    info[3] = 152;
    info[4] = 170;
    text.textModule(Cpt.TEXT_11 + 5, LINE_NO_VOICE);
    const created = engine.vars[Var.RESULT]!;
    const cpt = engine.compacts.require(created);
    expect([cpt[F.xcood], cpt[F.ycood], cpt[F.logic]]).toEqual([152, 170, 3]);
    const sprite = engine.items.fetch(cpt[F.flag]!)!;
    expect(sprite[6] | (sprite[7]! << 8)).toBe(100);
    expect(text.font).toBe(0); // police principale rétablie
    expect(new Set(sprite.subarray(DATA_FILE_HEADER_SIZE, DATA_FILE_HEADER_SIZE + 100 * 12))).toContain(209);
    // Surbrillance : seuls les pixels de texte de 241 à 255 changent (209 et le contour 240 restent).
    const choice = text.lowTextManager(LINE_NO_VOICE, 128, 0, 243, false).sprite!;
    text.changeTextSpriteColor(choice, 250);
    const colours = new Set(choice.subarray(DATA_FILE_HEADER_SIZE, DATA_FILE_HEADER_SIZE + 128 * 12));
    expect([...colours].sort((a, b) => a - b)).toEqual([0, 240, 250]);
    text.changeTextSpriteColor(null, 1); // texte déjà effacé : sans effet
  });
});

describe.skipIf(!hasOriginalFiles)("répliques : voix, sous-titres et durée (`stdSpeak`)", () => {
  function speak(mode: TextVoiceMode, line: number): { r: Rig; foster: ReturnType<BassEngine["compacts"]["require"]> } {
    const r = rig({ mode });
    const foster = r.engine.compacts.require(Cpt.FOSTER);
    r.engine.logic.stdSpeak(foster, line, 13, 0);
    return { r, foster };
  }

  it("texte + voix (défaut) : voix lancée, sous-titre affiché, 10 tours après la fin de la voix", () => {
    const { r, foster } = speak("both", LINE_WITH_VOICE);
    expect(r.voices.started).toEqual([LINE_WITH_VOICE]);
    expect(foster[F.logic]).toBe(L.TALK);
    expect(foster[F.spTime]).toBe(10);
    expect(foster[F.spTextId]).toBe(Cpt.TEXT_1);
    expect(liveTexts(r.engine)).toEqual([Cpt.TEXT_1]);
    // Le texte est dans l'écran courant, centré au-dessus de Foster, dans la zone de jeu.
    const textCpt = r.engine.compacts.require(Cpt.TEXT_1);
    expect(textCpt[F.xcood]).toBeGreaterThanOrEqual(TOP_LEFT_X);
    expect(textCpt[F.ycood]).toBeGreaterThanOrEqual(TOP_LEFT_Y);
  });

  it("texte seul : pas de voix, la durée est lettres + 5", () => {
    const { r, foster } = speak("text", LINE_WITH_VOICE);
    expect(r.voices.started).toEqual([]);
    expect(foster[F.spTime]).toBe(40 + 5);
    expect(foster[F.spTextId]).toBe(Cpt.TEXT_1);
  });

  it("voix seule : pas de sous-titre (aucun compact de texte), 10 tours", () => {
    const { r, foster } = speak("voice", LINE_WITH_VOICE);
    expect(r.voices.started).toEqual([LINE_WITH_VOICE]);
    expect(foster[F.spTime]).toBe(10);
    expect(foster[F.spTextId]).toBe(0);
    expect(liveTexts(r.engine)).toEqual([]);
  });

  it.each(["voice", "both"] as const)("voix absente (mode %s) : le sous-titre est forcé, durée lettres + 5", (mode) => {
    const { r, foster } = speak(mode, LINE_NO_VOICE);
    expect(r.voices.started).toEqual([]);
    expect(foster[F.spTextId]).toBe(Cpt.TEXT_1);
    expect(foster[F.spTime]).toBe(15 + 5);
    expect(liveTexts(r.engine)).toEqual([Cpt.TEXT_1]);
  });

  it("réplique hors de l'écran courant : pas de texte affiché", () => {
    const r = rig();
    const foster = r.engine.compacts.require(Cpt.FOSTER);
    foster[F.screen] = 9;
    r.engine.logic.stdSpeak(foster, LINE_NO_VOICE, 13, 0);
    expect(foster[F.spTextId]).toBe(0);
    expect(liveTexts(r.engine)).toEqual([]);
    expect(foster[F.spTime]).toBe(20);
  });

  it("changement de mode à chaud : la réplique suivante suit le nouveau mode", () => {
    const r = rig({ mode: "both" });
    applyTextVoiceMode(r.engine.system, "text");
    const foster = r.engine.compacts.require(Cpt.FOSTER);
    r.engine.logic.stdSpeak(foster, LINE_WITH_VOICE, 13, 0);
    expect(r.voices.started).toEqual([]);
    expect(foster[F.spTime]).toBe(45);
  });
});

describe.skipIf(!hasOriginalFiles)("mcodes de texte sur BassTextManager : choix de dialogue", () => {
  const call = (r: Rig, name: string, a = 0, b = 0, c = 0): boolean => MCODES[mcodeNumber(name)]!.fn(r.engine.logic, a, b, c);

  it("fnChooser : une ligne cliquable par choix (trame, empilées), joueur figé ; fnTextKill ne retire que les lignes cliquables", () => {
    const r = rig();
    // Le joueur (Foster) est le compact courant du script appelant.
    r.engine.logic.compact = r.engine.compacts.require(Cpt.FOSTER);
    call(r, "fn_new_list");
    call(r, "fn_ask_this", LINE_WITH_VOICE, 5);
    call(r, "fn_ask_this", LINE_NO_VOICE, 6);
    expect(call(r, "fn_chooser")).toBe(false); // le script se suspend
    expect(r.engine.system.systemFlags & SF.CHOOSING).toBeTruthy();
    expect(r.engine.compacts.require(Cpt.FOSTER)[F.logic]).toBe(L.CHOOSE);

    const first = r.engine.compacts.require(Cpt.TEXT_1);
    const second = r.engine.compacts.require(Cpt.TEXT_1 + 1);
    expect([first[F.getToFlag], first[F.downFlag], second[F.getToFlag], second[F.downFlag]]).toEqual([LINE_WITH_VOICE, 5, LINE_NO_VOICE, 6]);
    expect([first[F.xcood], first[F.ycood]]).toEqual([TOP_LEFT_X, TOP_LEFT_Y]);
    expect(first[F.status]! & ST.MOUSE).toBeTruthy();
    expect(second[F.ycood]).toBe(TOP_LEFT_Y + 12); // en 320 pixels, la première ligne tient sur une ligne de 12 pixels
    const sprite = r.engine.items.fetch(first[F.flag]!)!;
    expect(sprite[6] | (sprite[7]! << 8)).toBe(320);
    // Trame : un pixel sur deux du fond devient la couleur 1.
    expect(new Set(sprite.subarray(DATA_FILE_HEADER_SIZE, DATA_FILE_HEADER_SIZE + 320 * 12))).toContain(1);

    // Surbrillance (`fnHighlight`) : le stylo 11 devient 242 ((11 - 11) ^ 1 + 241).
    call(r, "fn_highlight", Cpt.TEXT_1, 11);
    expect(new Set(sprite.subarray(DATA_FILE_HEADER_SIZE, DATA_FILE_HEADER_SIZE + 320 * 12))).toContain(240 + 2);

    // Une réplique non cliquable survit à `fnTextKill`, pas à `fnTextKill2`.
    const speech = r.text.lowTextManager(LINE_NO_VOICE, 128, 0, 200, true);
    call(r, "fn_text_kill");
    expect([first[F.status], second[F.status]]).toEqual([0, 0]);
    expect(r.engine.compacts.require(speech.compactNum)[F.status]).not.toBe(0);
    call(r, "fn_text_kill2");
    expect(liveTexts(r.engine)).toEqual([]);
  });

  it("fnChooser sans choix : rend la main sans rien figer", () => {
    const r = rig();
    call(r, "fn_new_list");
    expect(call(r, "fn_chooser")).toBe(true);
    expect(liveTexts(r.engine)).toEqual([]);
  });
});

/** Première ligne différente (rang), ou -1 si `actual` reprend tout `expected`. */
function firstDivergence(expected: readonly string[], actual: readonly string[]): number {
  for (let i = 0; i < expected.length; i++) if (expected[i] !== actual[i]) return i;
  return -1;
}

/** Mcodes que le survol relance (`pointerEngine` : `mouseOn` de la zone sous le pointeur). */
const HOVER_MCODES = /^MC \d+ id=\d+ fn_(cross_mouse|pointer_text|normal_mouse) /;
/** Scénario du banc : clic gauche sur la barre (zone 85) au tour 42 ; Foster marche, puis dit la réplique 4155. */
function playBarre(mode: TextVoiceMode, cycles: number, renderer?: BassScreenRenderer): Rig & { trace: TraceRecorder } {
  const trace = new TraceRecorder(1);
  const r = rig({ mode, routing: true, trace, renderer });
  // Les entrées du banc sont datées en temps réel : le survol est vu au tour 33, le clic traité au tour 42.
  r.host.push({ type: "move", x: 160, y: 100 });
  r.engine.runCycles(33);
  r.host.push({ type: "move", x: 17, y: 70 });
  r.engine.runCycles(9);
  r.host.push({ type: "click", x: 17, y: 70, button: MouseButton.Left });
  r.engine.runCycles(cycles - 42);
  return { ...r, trace };
}

describe.skipIf(!hasOriginalFiles)("trace comparée au banc ScummVM : Foster regarde la barre et parle (CY, MC)", () => {
  /**
   * Compare au banc : tout est identique jusqu'à la fin de la réplique (`add_human` puis `normal_mouse` du tour `end`) ; ensuite le banc
   * ne relance plus le survol de la barre (`fnAddHuman` y appelle `warpMouse`, qui déplace le pointeur de la fenêtre factice), le portage
   * le relance : on compare alors le reste sans les mcodes du survol.
   */
  const compare = (fixture: string, actual: readonly string[], end: number): string => {
    const expected = readFixture(fixture).filter((l) => lineCycle(l) <= 242);
    const cut = expected.indexOf(`MC ${end} id=23 fn_normal_mouse 0 0 0`) + 1;
    expect(cut).toBeGreaterThan(0);
    const head = firstDivergence(expected.slice(0, cut), actual.slice(0, cut));
    if (head !== -1) return `ligne ${head} (tour ${lineCycle(expected[head]!)}) : ${expected[head]} / ${actual[head]}`;
    const tail = (lines: readonly string[]): string[] => lines.slice(cut).filter((l) => !HOVER_MCODES.test(l));
    const rest = firstDivergence(tail(expected), tail(actual));
    expect(tail(actual)).toHaveLength(tail(expected).length);
    return rest === -1 ? "aucune" : `après la réplique, ligne ${rest} : ${tail(expected)[rest]} / ${tail(actual)[rest]}`;
  };

  it("texte + voix : mêmes mcodes et mêmes tours, réplique de 27 tours (voix 17 tours + 10)", () => {
    const { trace, engine, voices } = playBarre("both", 242);
    expect(compare("talk.trace", trace.lines, 113)).toBe("aucune");
    expect(trace.lines).toContain("MC 86 id=3 fn_speak_me 3 4155 13");
    expect(trace.lines).toContain("MC 113 id=3 fn_add_human 0 0 0");
    expect(voices.started).toEqual([LINE_WITH_VOICE]);
    expect(engine.journal).toEqual([]);
  });

  it("voix seule : même trace (les sous-titres n'agissent pas sur le script)", () => {
    const { trace, engine } = playBarre("voice", 242);
    expect(compare("talk.trace", trace.lines, 113)).toBe("aucune");
    expect(speechTexts(engine)).toEqual([]);
  });

  it("texte seul (voix coupée) : la réplique dure lettres + 5 = 45 tours, fin au tour 131", () => {
    const { trace, voices } = playBarre("text", 242);
    expect(compare("talk-text.trace", trace.lines, 131)).toBe("aucune");
    expect(trace.lines).toContain("MC 131 id=3 fn_add_human 0 0 0");
    expect(voices.started).toEqual([]);
  });

  it("un clic coupe la voix et le texte (Foster est dans `clickTable`)", () => {
    const r = playBarre("both", 90); // la réplique a commencé au tour 86
    const foster = r.engine.compacts.require(Cpt.FOSTER);
    expect(foster[F.logic]).toBe(L.TALK);
    expect(speechTexts(r.engine)).toEqual([Cpt.TEXT_1]); // le nom de la barre (curseur) a été effacé au début de la réplique
    r.host.push({ type: "action", action: "skipLine" });
    r.engine.runCycles(2);
    expect(r.voices.stops).toBe(1);
    expect(foster[F.logic]).not.toBe(L.TALK);
    expect(speechTexts(r.engine)).toEqual([]);
  });

  it("image du banc avec sous-titre (tours 95 et 100) : identique pixel pour pixel, accents français compris", () => {
    // Banc : `SKY_SHOT_CYCLES=60,95,100` sur le scénario ci-dessus (voix + sous-titres, fr). Réplique 4155 : « Je pourrais L'UTILISER... ».
    const renderer = new BassScreenRenderer();
    const r = playBarre("both", 100, renderer);
    expect(r.engine.completedCycles).toBe(100);
    expect(speechTexts(r.engine)).toEqual([Cpt.TEXT_1]);
    const speech = r.engine.compacts.require(Cpt.TEXT_1);
    expect(speech[F.status]).not.toBe(0);
    const ref = readReferenceFrame("talk-0100");
    let different = 0;
    for (let i = 0; i < 64000; i++) if (ref.pixels[i] !== renderer.frame.pixels[i]) different++;
    expect(different).toBe(0);
    expect(renderer.frame.palette.subarray(0, 720)).toEqual(ref.palette.subarray(0, 720));
  });
});
