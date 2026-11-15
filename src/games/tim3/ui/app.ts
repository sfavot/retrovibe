/**
 * Application de The Incredible Machine 3 : page commune des jeux sur canvas (`mountGameShell`, 640×480, échelle
 * fractionnaire), un pas de simulation toutes les 32 ms (`TickScheduler`, D10), pointeur et clavier (`bindCanvasPointer`,
 * `bindKeyboard`), son (`WebTim3Audio`, `SoundPrefs`), fenêtres `.ITF` du jeu (`*-window.ts`, `menus.ts`), progression (`tim3:`).
 *
 * Démarrage comme le jeu (43b16c, `docs/tim3/ui.md` § Parcours d'entrée) : logo et titre animés (`IntroPlayer`), crédits si rien
 * n'a été passé, menu principal (`MAINMENU`), puis le mode choisi ; un puzzle s'ouvre sur sa fiche (`PUZZDISP`). En Jeu, la
 * disquette ouvre le choix du puzzle (`DOSBOX`, `DOSBIN`) ; « Menu principal » sous l'écran reprend l'entrée « Zones > Menu
 * principal » du menu Windows d'origine.
 *
 * Labo (`docs/tim3/ui.md` § Outils du Labo) : cadenas (`HTLOCK`), levier d'essai (mode 8 : la machine se joue comme un puzzle, puis le
 * Labo revient tel quel), éditeur d'indices (`HINT.ITF`), conditions de réussite (`SOLVE.ITF`), but écrit dans la barre du bas, onglets
 * du bac. Les machines qui ont un but se jouent depuis le bac « Puzzles Personnels » du choix du puzzle.
 *
 * Inscription (`docs/tim3/ui.md` § Inscription) : registre des joueurs (`engine/players.ts`), progression et aires gardées de chacun ;
 * l'invité « Hôte » au lancement. Visite guidée (§ Visite guidée) : un Labo vide où le professeur fait construire un puzzle maison pas à
 * pas (`engine/walkthrough.ts`, `HELP.ITF`).
 *
 * Deux joueurs (`docs/tim3/ui.md` § Deux joueurs) : fenêtre des réglages (`HEDTOHED`), puis des parties sur les puzzles HH, à tour de
 * rôle sur le même écran (`engine/duel.ts` : chronomètre, une pièce du bac et une de l'aire par tour, manches), tableau des joueurs
 * sous l'aire, messages du jeu à chaque tour et à chaque manche.
 *
 * Données : les volumes Dynamix (`RESOURCE.MAP/.001/.002` + `FRENCH.DAT`) sont chargés d'un bloc ; les voix MP3 à la demande.
 */
import "./style.css";
import { fetchGameFiles } from "../../../data/game-files";
import { prefixedStorage } from "../../../engine/storage";
import { h } from "../../../ui/dom";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { leaveGame, mountGameShell } from "../../../ui/game-shell";
import { localStorageStore } from "../../../ui/local-storage";
import { bindCanvasPointer, bindKeyboard } from "../../../ui/pointer";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { TickScheduler } from "../../../ui/tick-scheduler";
import { WebTim3Audio, goalVoice, helpVoice, hintVoice, parseLipSyncJson, type Tim3Audio } from "../audio";
import { copy } from "../copy";
import { readAnm } from "../data/anm";
import { HELP_INTRO, HELP_NOTHING, helpTable, type HelpTable } from "../data/help";
import { readItf } from "../data/itf";
import { levelParts, readLev, type Level } from "../data/lev";
import { readPartDef } from "../data/part-def";
import { readBinSolveRes, readSolveRes, type SolvePart } from "../data/solutions";
import { interfaceText, loadTexts, parseIdTable, parseLines, type GameTexts } from "../data/text";
import { ResourceIndex } from "../data/volume";
import { readSoundEffect } from "../data/wave";
import { Editor } from "../engine/editor";
import { SCENERY_TAB, TAB_TEXT } from "../engine/bin-tabs";
import { GOAL_MAX } from "../engine/lab-puzzle";
import type { Part } from "../engine/part";
import { parseProgramRows, type ProgramRow } from "../engine/program";
import { DISPLAY, PlayerRegistry, signInDecision, type PlayerPrefs } from "../engine/players";
import { WALK_LEAVE_TEXT, Walkthrough, walkFacts, type WalkEffect } from "../engine/walkthrough";
import {
  EditStore,
  SLOT_COUNT,
  cleanName,
  labSaveSlots,
  levelWithParts,
  loadMachine,
  hasGoal,
  machineLevel,
  machineSettings,
  puzzleLevel,
  saveMachine,
  snapshotLab,
  snapshotWorld,
  type LabMachine,
} from "../engine/save";
import { DEFAULT_LAB, DUEL_CATEGORY, HOME_CATEGORY, HomeProgress, Progress, STEP_MS, Tim3Session, duelPuzzleList, homePuzzleRef, homeSlot, labLevel, puzzleList, type PuzzleRef } from "../engine/session";
import { Duel, TURN_BACKGROUND, defaultDuelSettings, nextDuelPuzzle, type DuelOutcome, type DuelSettings, type Player } from "../engine/duel";
import { formatText } from "../render/itf-draw";
import { openDuelSetupWindow } from "./duel-window";
import { solutionSession } from "../engine/solution";
import { TypeTable } from "../engine/types";
import { renderHelp } from "../help";
import { RenderAssets, SCREEN_HEIGHT, SCREEN_WIDTH, Surface, imageCount, stateImage, type Rect } from "../render";
import { LOGO, TITLE, opaqueLut, type FrameSound } from "../render/front";
import { BinScreen, PuzzleCardScreen, PuzzleListScreen, currentPuzzle, type ChooserTexts } from "./chooser";
import { CreditsScreen } from "./credits";
import { IntroPlayer } from "./intro";
import { openItfWindow, screenOptions, type ItfHost, type ItfScreen, type ItfWindowHandle } from "./itf-window";
import { MainMenuScreen, quitMainMenu, type MainMenuAction } from "./main-menu";
import { openBinsolveWindow } from "./binsolve-window";
import { openGlobeWindow } from "./globe-window";
import { openHelpWindow, openWalkthroughWindow } from "./help-window";
import { openSignInWindow } from "./signin-window";
import { HINT_TEXT, openHintEditorWindow, openHintWindow, type HintEditorChoice } from "./hint-window";
import { openGoalEditor } from "./goal-editor";
import { LOCK_TEXT, openLockWindow } from "./lock-window";
import { SOLVE_TEXT, drawPartPreview, openSolveWindow } from "./solve-window";
import { openInfoWindow } from "./info-window";
import { openLoadSaveWindow, openMachineListWindow, type LoadSaveChoice } from "./machines-window";
import { confirmDialog, genericDialog, messageDialog, solvedDialog } from "./menus";
import { openMusicboxWindow } from "./musicbox-window";
import { USERPREF_UNSAVED_TEXT as PREFS_UNSAVED_TEXT, openUserPrefWindow } from "./userpref-window";
import { openProgramWindow } from "./program-window";
import { PlayScreen, type HelpTarget, type PlayEvent, type ShownButton, type ToolbarButton } from "./play";
import { TOOLBAR_NAMES, TOOLBAR_TEXT, toolbarDecision, type ToolbarAction } from "./toolbar";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (`./tim3`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Expose `window.__tim3` (session, écran) pour la console (page de dev). */
  debug?: boolean;
  /** Puzzle à ouvrir (`TLEV1`) ; sinon le dernier joué, sinon le premier. */
  puzzle?: string;
}

/** Préfixe de la progression (D11) et identifiant de la préférence « Son » (`retrovibe:tim3:sound`). */
const GAME_ID = "tim3";
/** Rattrapage maximal après une image lente (pas de rattrapage massif au retour d'un onglet masqué). */
const MAX_CATCH_UP = 4;
/** Délai avant l'infobulle d'une case du bac survolée à la souris. */
const TIP_DELAY_MS = 600;
/** Sons de l'éditeur (41126d dans 42e660, 42f24a) : prise et pose 0xE1B, retrait 0xE1A, retournement 0xE18. */
const SOUND_PLACE = 0xe1b;
/** Ouverture de la fenêtre « programmer » (42ea72). */
const SOUND_PROGRAM = 0xc40;
const SOUND_REMOVE = 0xe1a;
/** Poignée « solution » (42eab4 : 0xC8C, puis `SOLVE.ITF`). */
const SOUND_SOLVE = 0xc8c;
/** `INTRFACE.RES` : machine du Labo ou essai réussi (419878 : 31178, au lieu de PUZZSOLV dans les modes 1, 6 et 8). */
const LAB_SOLVED_TEXT = 31178;
/** Puzzle réussi : son 0xE21, 18 pas après l'ouverture de PUZZSOLV (4261df : compte à rebours 0x12, 426234). */
const SOUND_SOLVED = 0xe21;
const SOLVED_SOUND_STEPS = 18;
/** Mode à deux joueurs : tour qui passe (4331a4 : 0xBF8), bac fermé ou pièce interdite (418228, 42e6ed : 0xE24). */
const SOUND_TURN = 0xbf8;
const SOUND_DUEL_REFUSED = 0xe24;
/** `INTRFACE.RES` du mode à deux joueurs (4213b9, 41d827, 419803, 433200, 42e706, 418246). */
const DUEL_TEXT = {
  player1: 2100,
  player2: 2101,
  turn: 31116,
  solved: 31117,
  next: 31118,
  replay: 31119,
  won: 31120,
  rematch: 31121,
  moved: 31152,
  taken: 31153,
  oneMore: 2154,
  serious: 2155,
} as const;
/** Un pas de l'horloge du tour au plus par image (un onglet longtemps en arrière-plan ne vide pas le tour d'un coup). */
const DUEL_MAX_STEP_MS = 250;
const VOLUMES = ["RESOURCE.MAP", "RESOURCE.001", "RESOURCE.002", "FRENCH.DAT"] as const;
/** `SYSTEM.RES` : nom de l'invité, « Hôte » (`TIM.SAV`, 42d03d). */
const SYSTEM_GUEST_LINE = 3;
/** `INTRFACE.RES` de l'inscription (426877) : nom inconnu (31174, Oui / Non), ni nom ni rangée (31175). */
const SIGNIN_TEXT = { newPlayer: 31174, noName: 31175 } as const;
/**
 * Guitare : interrupteur des effets, préférence commune à tous les joueurs (le jeu ne le garde pas dans le fichier de partie). La
 * musique et le volume sont ceux du joueur courant (`PlayerRegistry.sound`).
 */
const EFFECTS_KEY = "effects";

/** Écran plein du parcours d'entrée : l'intro, ou le fond noir derrière le menu principal, les crédits et le choix du puzzle. */
type Front = { kind: "intro"; player: IntroPlayer } | { kind: "backdrop" };

/** Bouton de barre d'action du pied de page. */
function actionButton(label: string, title: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
  const b = h("button", { type: "button", class: "toggle", title }, label);
  b.addEventListener("click", onClick);
  return b;
}

export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
    fit: "fractional",
    copy,
    backLabel: options.backLabel,
    classes: { root: "tim3", canvas: "tim3-canvas" },
  });
  const store = localStorageStore();
  const storage = prefixedStorage(store, `${GAME_ID}:`);

  let index: ResourceIndex;
  let texts: GameTexts;
  let types: TypeTable;
  let assets: RenderAssets;
  let audio: WebTim3Audio;
  let descriptions: Map<number, string>;
  let congratulations: string[];
  let toolbar: ToolbarButton[];
  let programRows: ProgramRow[];
  let interfaceLines: string[];
  /** Textes du professeur de la visite guidée (`PROFESOR.RES`). */
  let professorLines: string[];
  let help: HelpTable;
  let solveParts: SolvePart[] = [];
  try {
    const files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    const [map, v1, v2, french] = await Promise.all(VOLUMES.map((f) => fetchBytes(options.base, f)));
    const volumes: Record<string, Uint8Array> = { "RESOURCE.001": v1!, "RESOURCE.002": v2! };
    index = new ResourceIndex()
      .add(map!, (n) => {
        const v = volumes[n.toUpperCase()];
        if (!v) throw new Error(`volume inconnu : ${n}`);
        return v;
      })
      .overlay(french!, "FRENCH.DAT");
    texts = loadTexts(index);
    descriptions = new Map(parseIdTable(index.get("DESCRIPT.RES")).map((e) => [e.id, e.text.replace(/^[@!&%$*]+/, "")]));
    congratulations = readBinSolveRes(index.get("BINSOLVE.RES"));
    programRows = parseProgramRows(parseLines(index.get("PROGPART.RES")));
    interfaceLines = parseLines(index.get("INTRFACE.RES"));
    professorLines = parseLines(index.get("PROFESOR.RES"));
    try {
      solveParts = readSolveRes(index.get("SOLVE.RES"));
    } catch (error) {
      console.warn("TIM3 : SOLVE.RES illisible", error);
    }
    help = helpTable(index);
    types = new TypeTable({
      anm: (t) => (index.has(`PART${t}.ANM`) ? readAnm(index.get(`PART${t}.ANM`)) : null),
      par: (t) => (index.has(`PART${t}.PAR`) ? readPartDef(index.get(`PART${t}.PAR`)) : null),
    });
    assets = new RenderAssets(index);
    const itf = readItf(index.get("WTOOLBAR.ITF"));
    toolbar = TOOLBAR_NAMES.flatMap((name) => {
      const c = itf.controls.find((k) => k.name === name);
      return c ? [{ name, id: c.id, x: c.x, y: c.y - 66, width: c.width, height: c.height }] : [];
    });
    const voicePath = (key: string): string => `voices/${key}.mp3`;
    const exact = (path: string): boolean => files.resolve(path)?.toLowerCase() === path.toLowerCase();
    let lipsync;
    try {
      lipsync = exact("voices/lipsync.json") ? parseLipSyncJson(JSON.parse(new TextDecoder().decode(await fetchBytes(options.base, "voices/lipsync.json")))) : undefined;
    } catch (error) {
      console.warn("TIM3 : synchro labiale illisible", error);
    }
    audio = new WebTim3Audio({
      now: () => performance.now(),
      resources: index,
      voices: { has: (key) => exact(voicePath(key)), load: (key) => fetchBytes(options.base, voicePath(key)) },
      lipsync,
      storage: store,
      soundfontUrl: `${import.meta.env.BASE_URL}mathemagique/mathemagique-gm.sf2`,
    });
    // Débloque le son tant que l'activation du clic (« Jouer ») est valable.
    audio.unlock();
  } catch (error) {
    shell.fail(error, "load");
    return;
  }
  const sound: Tim3Audio = audio;
  // Joueurs (`engine/players.ts`) : la progression et les aires gardées sont celles du joueur courant, l'invité au lancement.
  const players = new PlayerRegistry(storage, texts.system[SYSTEM_GUEST_LINE] ?? "");
  let progress = new Progress(players.storage());
  let homeProgress = new HomeProgress(players.storage());
  let edits = new EditStore(players.storage());
  // Les machines du Labo sont communes à tous les joueurs (comme les fichiers de puzzles du jeu).
  const slots = labSaveSlots(storage);
  const puzzles = puzzleList();
  const duelPuzzles = duelPuzzleList();
  /** Musique en marche (4115e6(1000, ·)) : réglage du joueur courant. */
  let musicOn = true;
  sound.effectsEnabled = storage.get(EFFECTS_KEY) !== "0";
  /**
   * Préférences du joueur courant (`USERPREF.ITF`, `SOLVE.ITF`) : affichage (`[0x481034]`, posé sur le monde de chaque session :
   * `applyDisplay`), interrupteur général du son, mode avancé de `SOLVE.ITF`.
   */
  let prefs: PlayerPrefs = players.prefs();
  /** Réglages de son et préférences du joueur courant, à son chargement (42c6d0 : 4115e6(10000 / 1000, ·), 411674(1001 / 3001, volume)). */
  const applyPlayerSound = (): void => {
    const s = players.sound();
    prefs = players.prefs();
    musicOn = s.music;
    sound.volume = s.volume;
    sound.soundEnabled = prefs.soundOn;
    if (!musicOn) sound.stopMusic();
  };
  applyPlayerSound();
  /** Effet choisi dans la guitare (gardé d'une ouverture à l'autre, `[0x47f980]`). */
  let effectChoice = 0;

  // ------------------------------------------------------------------ état

  let current: PuzzleRef | null = null;
  /** LEV d'origine du puzzle ouvert (la photo de l'aire s'y rapporte) ; `null` au Labo. */
  let baseLevel: Level | null = null;
  /** Nom de la dernière machine du Labo sauvegardée ou chargée (proposé à la sauvegarde suivante). */
  let labName = "";
  /** Essai du Labo (mode 8) : la machine d'avant l'essai, rendue telle quelle à la fin (43252d(fichier, 1)). */
  let labTest: LabMachine | null = null;
  /** 31143 n'est montré qu'à la première entrée en essai (`[0x481004]`). */
  let testIntroShown = false;
  /** Onglet du bac au Labo (`[0x471f90]`), gardé pendant la partie (le mode avancé de `SOLVE.ITF` est une préférence du joueur). */
  let labTab = 0;
  /** Puzzle maison ouvert : emplacement et date de sa sauvegarde (progression). */
  let home: { slot: number; savedAt: number } | null = null;
  /** Pièce dont `SOLVE.ITF` attend un rectangle (« Position »). */
  let solvePart: Part | null = null;
  let goalEditor: { close(): void } | null = null;
  /** Match à deux joueurs en cours (`null` hors du mode 2). */
  let duel: Duel | null = null;
  /** Visite guidée en cours (mode 6) ; sa machine n'est jamais gardée (31136 en la quittant). */
  let walk: Walkthrough | null = null;
  /** Le professeur s'est déjà présenté (`[0x4728c0]`) : remis à zéro à l'inscription d'un nouveau joueur (4269fc). */
  let professorMet = false;
  /** Session d'un autre joueur après un changement de joueur : rien n'en est gardé jusqu'au mode suivant. */
  let detached = false;
  /** Réglages de la fenêtre des deux joueurs, gardés d'un match à l'autre (`0x472840`, noms `0x47e6dc`). */
  let duelSettings: DuelSettings | null = null;
  /** Fin de manche montrée, en attente du choix (« Rejouer » relance la machine puis la repose). */
  let duelPending: DuelOutcome | null = null;
  let lastFrameAt: number | null = null;
  let session!: Tim3Session;
  let screen!: PlayScreen;
  let dialog: ItfWindowHandle | null = null;
  let helpView: HTMLElement | null = null;
  let tabHidden = false;
  const scheduler = new TickScheduler(STEP_MS, MAX_CATCH_UP);

  const tip = h("div", { class: "tim3-tip", role: "tooltip", hidden: true });
  shell.stage.append(tip);
  const live = h("p", { class: "tim3-sr", "aria-live": "polite" });
  shell.stage.append(live);

  // Démarrer, indices, options (guitare), aide (livre, « ? ») et choix du puzzle (disquette) sont dans la barre d'outils du jeu ;
  // reste ici l'entrée « Zones > Menu principal » du menu Windows d'origine.
  const menuButton = actionButton(copy.mainMenu, copy.mainMenuLabel, () => backToMainMenu());
  // Mode à deux joueurs : « Terminer le Tour » de la barre (35022), aussi au clavier et pour les lecteurs d'écran.
  const endTurnButton = actionButton(copy.duelEndTurn, copy.duelEndTurnLabel, () => endTurnNow());
  endTurnButton.hidden = true;
  shell.toggles.append(h("span", { class: "tim3-actions" }, endTurnButton, menuButton));
  /** Parcours d'entrée en cours (intro, ou fond des menus) ; `null` en Jeu et au Labo. */
  let front: Front | null = null;

  const announce = (text: string): void => {
    live.textContent = text;
  };

  const music = (id: number): void => {
    if (musicOn) sound.enterPuzzle(id);
    else {
      sound.enterPuzzle(0);
    }
  };

  /** Préférences d'affichage du joueur (`[0x481034]`, globale du jeu) sur le monde de la session (`World.animFlags`). */
  const applyDisplay = (): void => {
    const live = session as Tim3Session | undefined;
    if (live) live.world.animFlags = prefs.display;
  };

  const playScreen = (level: Level, goal: string, hints: string[]): void => {
    goalEditor?.close();
    applyDisplay();
    screen = new PlayScreen(session, assets, level, { goal, hints, parts: texts.parts }, toolbar, onEvent);
    screen.solved = home ? homeProgress.isSolved(home.slot, home.savedAt) : current !== null && progress.isSolved(current.name);
    screen.test = labTest !== null;
    screen.binTab = labTab;
    screen.duel = duel;
    screen.walkthrough = walk !== null;
    detached = false;
    endTurnButton.hidden = duel === null;
    if (options.debug) (window as unknown as { __tim3: unknown }).__tim3 = { session: () => session, screen: () => screen, index };
  };

  /**
   * Garde l'état d'édition (D11) : l'aire du puzzle ou du Labo, jamais en pleine marche (l'état gardé est alors celui d'avant
   * « Démarrer »). Un puzzle auquel on n'a rien posé n'a rien à garder. Une erreur ne doit jamais gêner le jeu.
   */
  const persistEdit = (): void => {
    // Essai : le Labo gardé est celui d'avant l'essai. Puzzle maison : l'aire n'est pas gardée (la machine peut changer d'emplacement).
    if (!session || session.running || labTest || home || duel || walk || detached) return;
    try {
      if (current && baseLevel) {
        const parts = snapshotWorld(session.world, baseLevel);
        if (parts && parts.placed.length > 0) edits.savePuzzle(current.name, parts);
        else edits.clearPuzzle(current.name);
      } else if (session.lab) {
        const machine = snapshotLab(session.world, session.lab, session.labPuzzle);
        if (machine) edits.saveLab(machine);
      }
    } catch (error) {
      console.error(error);
    }
  };

  /** Ouvre un puzzle : l'aire qu'on y avait laissée, ou (`solution`, ampoule) la solution du concepteur posée. */
  const loadPuzzle = (ref: PuzzleRef, solution = false): boolean => {
    persistEdit();
    leaveDuel();
    walk = null;
    labTest = null;
    const slot = homeSlot(ref);
    if (slot !== null) return loadHome(ref, slot, solution);
    home = null;
    const original = readLev(index.get(`${ref.name}.LEV`));
    const kept = solution ? null : edits.puzzle(ref.name);
    let fresh = true;
    current = ref;
    baseLevel = original;
    session = solution ? solutionSession(types, original, { puzzle: ref }) : new Tim3Session(types, original, { puzzle: ref });
    if (kept) {
      try {
        session = new Tim3Session(types, levelWithParts(original, kept), { puzzle: ref, unlock: kept.placed, originalCount: levelParts(original).length });
        fresh = false;
      } catch (error) {
        // Aire gardée illisible : on repart du puzzle d'origine.
        console.warn("TIM3 : aire gardée ignorée", error);
        edits.clearPuzzle(ref.name);
      }
    }
    const level = fresh ? original : session.level;
    const t = texts.levels[ref.index];
    playScreen(level, t?.goal ?? level.goal, t?.hints ?? level.hints.map((x) => x.text));
    if (solution) {
      // Même puzzle : musique et voix continuent ; l'aire avec la solution remplace l'état gardé.
      persistEdit();
      announce(copy.solutionShown);
      return true;
    }
    progress.last = ref.name;
    // La voix du but est celle de la fiche (`enterPuzzle`, 425f6b), pas du chargement.
    music(level.info.music);
    announce(`${copy.categories[ref.category]} ${ref.number} : ${t?.title ?? ""}. ${t?.goal ?? ""}`);
    return true;
  };

  /**
   * Puzzle maison (bac « Puzzles Personnels ») : la machine de l'emplacement, jouée comme un puzzle (pièces non verrouillées au bac,
   * 43267a), avec son but et ses indices (sans voix : elles sont celles des puzzles du professeur). `solution` : l'ampoule, la machine
   * telle que son auteur l'a construite (pièces du bac remises à leur place, `solutionSession`).
   */
  const loadHome = (ref: PuzzleRef, slot: number, solution: boolean): boolean => {
    const stored = slots.read(slot);
    if (!stored || !hasGoal(stored.save.machine)) {
      pauseFor(messageDialog(itfHost(), copy.homeMissing, resume));
      return false;
    }
    const level = puzzleLevel(stored.save.machine, stored.save.name);
    current = ref;
    baseLevel = level;
    home = { slot, savedAt: stored.savedAt };
    session = solution ? solutionSession(types, level, { puzzle: ref }) : new Tim3Session(types, level, { puzzle: ref });
    playScreen(level, level.goal, level.hints.map((h) => h.text));
    if (solution) {
      announce(copy.solutionShown);
      return true;
    }
    music(level.info.music);
    announce(`${copy.homeCategory} ${slot} : ${level.title}. ${level.goal}`);
    return true;
  };

  /** Ouvre le Labo : la machine donnée (emplacement chargé) ou, sans elle, celle qu'on y avait laissée. `false` si elle est illisible. */
  const openLab = (machine: LabMachine | null = edits.lab()): boolean => {
    persistEdit();
    leaveDuel();
    walk = null;
    labTest = null;
    home = null;
    let settings = machine ? machineSettings(machine) : { ...DEFAULT_LAB };
    let ok = true;
    current = null;
    baseLevel = null;
    try {
      session = machine ? new Tim3Session(types, machineLevel(machine), { lab: settings, unlock: machine.placed }) : new Tim3Session(types, labLevel(settings), { lab: settings });
    } catch (error) {
      console.warn("TIM3 : machine du Labo ignorée", error);
      ok = false;
      settings = { ...DEFAULT_LAB };
      session = new Tim3Session(types, labLevel(settings), { lab: settings });
    }
    // Labo : la palette de toutes les pièces remplit le bac (une pièce de chaque type, renouvelée quand on la prend).
    fillLabBin();
    playScreen(session.level, copy.labGoal, []);
    music(settings.music);
    announce(copy.labTitle);
    persistEdit();
    return ok;
  };

  /** Palette du Labo : une pièce de chaque type de l'onglet (417264), pièces des fêtes le jour venu (43b06c). */
  const fillLabBin = (): void => {
    if (!session.lab) return;
    applyDisplay();
    session.editor.stockLab(Editor.labTypes(session.world, labTab, new Date()));
  };

  /** Texte de `INTRFACE.RES`. */
  const gameText = (id: number): string => interfaceText(interfaceLines, id).replaceAll("\\n", "\n");

  // ------------------------------------------------------------------ outils du Labo

  /** Levier d'essai au Labo (41908a) : 31143 la première fois, puis l'essai (mode 8) de la machine telle qu'elle est. */
  const startTest = (): void => {
    if (!session.lab || session.running) return;
    const machine = snapshotLab(session.world, session.lab, session.labPuzzle);
    if (!machine) return;
    persistEdit();
    const enter = (): void => {
      labTest = machine;
      const level = puzzleLevel(machine, labName);
      session = new Tim3Session(types, level);
      playScreen(level, machine.goal, level.hints.map((h) => h.text));
      announce(copy.testStarted);
    };
    if (testIntroShown) return enter();
    testIntroShown = true;
    pauseFor(
      messageDialog(itfHost(), gameText(TOOLBAR_TEXT.testIntro), () => {
        resume();
        enter();
      }),
    );
  };

  /** Fin de l'essai (43252d(fichier, 1)) : le Labo d'avant l'essai revient, pièces et puzzle maison compris. */
  const endTest = (): void => {
    const machine = labTest;
    if (!machine) return;
    if (session.running) toggleRun();
    labTest = null;
    openLab(machine);
    announce(copy.testEnded);
  };

  /** Cadenas de la barre (420810) : HTLOCK, puis tout verrouiller (4209e5) ou tout déverrouiller (420afc) et le message du jeu. */
  const openLock = (): void => {
    if (!session.lab || session.running) return;
    let choice: boolean | null = null;
    pauseFor(
      openLockWindow(itfHost(), {
        choose: (locked) => {
          choice = locked;
        },
        onClose: () => {
          resume();
          if (choice === null) return;
          screen.resetFocus();
          session.editor.lockAll(choice);
          persistEdit();
          pauseFor(messageDialog(itfHost(), gameText(choice ? LOCK_TEXT.locked : LOCK_TEXT.unlocked), resume));
        },
      }),
    );
  };

  /**
   * Éditeur d'indices (41f3dc) : `null` depuis la barre ; un emplacement (poignée « modifier ») ; ou la place d'une nouvelle main
   * (après « Nouveau »), créée quand son texte est écrit (41f159).
   */
  const openHintEditor = (target: { slot: number } | { at: { x: number; y: number } } | null): void => {
    const lab = session.labPuzzle;
    if (!lab || session.running) return;
    let slot = target && "slot" in target ? target.slot : null;
    const at = target && "at" in target ? target.at : null;
    let choice: HintEditorChoice = "done";
    // Pas de voix (41f62e au Labo : voix d'un indice du dernier puzzle joué, bug de l'original non reproduit, `ui.md`).
    pauseFor(
      openHintEditorWindow(itfHost(), {
        text: slot !== null ? (lab.hints[slot]?.text ?? "") : at ? "" : null,
        count: lab.hintCount + (at && slot === null ? 1 : 0),
        save: (text) => {
          if (slot !== null) lab.setHintText(slot, text);
          else if (at) slot = lab.addHint(at.x, at.y, text);
        },
        message: (text) => void messageDialog(itfHost(), text),
        choose: (c) => {
          choice = c;
        },
        onClose: () => {
          resume();
          switch (choice) {
            case "create":
              screen.placing = "hint";
              screen.hintsShown = true;
              return announce(copy.hintPlace);
            case "show":
              screen.hintsShown = lab.hintCount > 0;
              return announce(screen.hintsShown ? copy.hintsShown(lab.hintCount) : copy.hintsHidden);
            case "hide":
              screen.hintsShown = false;
              return announce(copy.hintsHidden);
            case "help":
              return openHelp();
            case "done":
              return;
          }
        },
      }),
    );
  };

  /** Poignée « effacer » d'une main (41f867) : 31122 « Effacer » / « Annuler », puis l'emplacement est libéré (41f1bd). */
  const deleteHint = (slot: number): void => {
    const lab = session.labPuzzle;
    if (!lab) return;
    pauseFor(
      genericDialog(itfHost(), {
        text: gameText(HINT_TEXT.confirmDelete),
        buttons: [HINT_TEXT.delete, HINT_TEXT.cancel],
        choose: (r) => {
          if (r !== 1) return;
          lab.removeHint(slot);
          announce(copy.hintDeleted);
        },
        onClose: resume,
      }),
    );
  };

  /** Première image d'un état de l'ANM d'un type (44b2c0 : −1 = nombre d'images). */
  const stateFirst = (type: number) => {
    const anm = assets.partAnm(type);
    return (state: number): number => (!anm ? 0 : state === -1 ? imageCount(anm) : Math.max(0, stateImage(anm, state)));
  };

  /** 429d84 : la pièce a été retournée ou programmée, sa condition de réussite (Labo) suit sa variante. */
  const followVariant = (part: Part): void => {
    session.labPuzzle?.followVariant(part, solveParts[part.type] ?? null, stateFirst(part.type));
  };

  /** Poignée « solution » (42ea99 → 426d1c) : `SOLVE.ITF` pour la pièce (une télécommande : ses explosifs). */
  const openSolve = (target: Part): void => {
    const lab = session.labPuzzle;
    if (!lab || session.running) return;
    const part = target.type === 0x16 && target.links[1] ? target.links[1] : target;
    const existing = lab.conditionOf(part);
    let position = false;
    sound.playEffect(SOUND_SOLVE);
    pauseFor(
      openSolveWindow(itfHost(), {
        name: texts.parts.find((p) => p.id === part.type)?.name ?? "",
        solve: solveParts[part.type] ?? null,
        frame: part.editFrame,
        first: stateFirst(part.type),
        drawPart: (surface, r, image) => drawPartPreview(surface, assets, part.type, r, image),
        condition: existing && { state1: existing.state1, state2: existing.state2, count: existing.count, rectX: existing.rectX, rectY: existing.rectY, rectWidth: existing.rectWidth, rectHeight: existing.rectHeight },
        others: lab.conditions.filter((c) => c.part !== part).length,
        delay: lab.delay,
        advanced: prefs.solveAdvanced,
        set: (value) => lab.setCondition(part, value),
        setDelay: (d) => {
          lab.delay = d;
        },
        setAdvanced: (a) => {
          if (!savePrefs({ solveAdvanced: a })) void messageDialog(itfHost(), gameText(PREFS_UNSAVED_TEXT));
        },
        message: (text) => void messageDialog(itfHost(), text),
        drawPosition: () => {
          position = true;
        },
        help: () => queueMicrotask(() => openHelp()),
        onClose: () => {
          resume();
          if (!position) return announce(copy.solveSaved);
          // 427419(0x4a5f) : 31138, puis un rectangle tracé dans l'aire ; la fenêtre revient ensuite (426d1c).
          solvePart = part;
          pauseFor(
            messageDialog(itfHost(), gameText(SOLVE_TEXT.drawBox), () => {
              resume();
              screen.placing = "rect";
              announce(gameText(SOLVE_TEXT.drawBox));
            }),
          );
        },
      }),
    );
  };

  /** Rectangle « Position » tracé : la condition de la pièce devient « dans ce rectangle », puis `SOLVE.ITF` revient. */
  const solveRect = (rect: Rect | null): void => {
    const part = solvePart;
    const lab = session.labPuzzle;
    solvePart = null;
    if (!part || !lab) return;
    if (rect && rect.width > 0 && rect.height > 0) {
      const count = lab.conditionOf(part)?.count ?? 0;
      if (!lab.setCondition(part, { state1: 0, state2: 0, count, rectX: rect.x, rectY: rect.y, rectWidth: rect.width, rectHeight: rect.height })) {
        return pauseFor(messageDialog(itfHost(), gameText(SOLVE_TEXT.full), () => {
          resume();
          openSolve(part);
        }));
      }
      persistEdit();
    }
    openSolve(part);
  };

  /** Barre du but au Labo (414fc1) : le texte s'écrit sur place. */
  const editGoal = (): void => {
    const lab = session.labPuzzle;
    if (!lab || session.running || goalEditor) return;
    goalEditor = openGoalEditor(shell, {
      value: lab.goal,
      maxLength: GOAL_MAX,
      label: copy.goalEdit,
      input: (v) => {
        lab.goal = v;
      },
      onClose: () => {
        goalEditor = null;
        persistEdit();
        announce(copy.goalEditDone);
      },
    });
  };

  // ------------------------------------------------------------------ actions

  const toggleRun = (): void => {
    if (session.running) {
      session.stop();
      // Ambiances en boucle (< 92) et effets en cours : coupés à l'arrêt de la machine (audio.md).
      sound.stopEffects();
      screen.session = session;
      screen.resetFocus();
      fillLabBin();
      // « Rejouer » d'une fin de manche : la question revient quand la machine s'arrête (4199ad).
      if (duelPending) queueMicrotask(showDuelOutcome);
    } else {
      tip.hidden = true;
      persistEdit();
      session.start();
      screen.resetFocus();
      scheduler.resync();
    }
  };

  /** Main de la barre (4192d3) : montre toutes les mains des indices (4204cf) ou les cache (420536) ; sans indice, GENERIC 31112. */
  const showHint = (): void => {
    if (session.running) return;
    if (screen.hintCount === 0) {
      pauseFor(messageDialog(itfHost(), copy.noHints, resume));
      return;
    }
    announce(screen.toggleHints() ? copy.hintsShown(screen.hintCount) : copy.hintsHidden);
  };

  /** Clic sur la main d'un indice (42013d) : HINT.ITF avec son texte et sa voix (emplacement LEV `slot`). */
  const openHint = (slot: number): void => {
    const text = screen.texts.hints[slot] ?? "";
    const voice = current && current.index >= 0 ? hintVoice(slot + 1, current.index) : null;
    const play = (): void => {
      sound.stopVoice();
      if (voice) sound.playVoice(voice);
    };
    play();
    pauseFor(
      openHintWindow(itfHost(), {
        text,
        replay: play,
        onClose: () => {
          sound.stopVoice();
          resume();
        },
      }),
    );
  };

  const solved = (): void => {
    sound.stopEffects();
    screen.session = session;
    screen.resetFocus();
    if (duel) return duelSolved();
    // Labo et essai (419878) : GENERIC 31178, la machine est revenue à l'état d'édition.
    if (session.lab || labTest) {
      pauseFor(messageDialog(itfHost(), gameText(LAB_SOLVED_TEXT), resume));
      return;
    }
    if (!current) return;
    const ref = current;
    if (home) return homeSolved(ref, home);
    const wasSolved = progress.isSolved(ref.name);
    progress.markSolved(ref.name);
    screen.solved = true;
    const inCategory = puzzles.filter((p) => p.category === ref.category).map((p) => p.name);
    // Fin de catégorie (42ccae) : BINSOLVE.ITF par-dessus PUZZSOLV, seulement à la première résolution de ce puzzle (42d210) ; jamais
    // pour les puzzles à deux joueurs joués seul (4261a7 : catégorie 5).
    let finished: number | "all" | null = null;
    const duelPuzzle = ref.category === DUEL_CATEGORY;
    if (!duelPuzzle && !wasSolved && progress.count(puzzles.map((p) => p.name)) === puzzles.length) finished = "all";
    else if (!duelPuzzle && !wasSolved && progress.count(inCategory) === inCategory.length) finished = ref.category;
    const next = duelPuzzle ? nextInList(duelPuzzles, ref) : progress.next(ref.name);
    // PUZZSOLV (4260f0) ; le son 0xE21 part 18 pas après l'ouverture (426213). « Rejouer la Solution » relance la machine du
    // joueur : à la victoire, la session est revenue à l'état d'avant « Démarrer » (`Tim3Session.tick` → `stop`).
    const fanfare = window.setTimeout(() => sound.playEffect(SOUND_SOLVED), SOLVED_SOUND_STEPS * STEP_MS);
    let binsolve: ItfWindowHandle | null = null;
    pauseFor(
      solvedDialog(itfHost(), {
        hasNext: next !== null,
        canReplay: true,
        same: () => undefined,
        replay: () => {
          if (!session.running) toggleRun();
        },
        next: () => next && enterPuzzle(next),
        onClose: () => {
          window.clearTimeout(fanfare);
          binsolve?.close();
          resume();
        },
      }),
    );
    // BINSOLVE (419c9c) s'ouvre pendant l'initialisation de PUZZSOLV, donc par-dessus ; après la prise du focus de PUZZSOLV, pour
    // qu'il lui revienne à la fermeture.
    if (finished !== null) {
      const category = finished;
      queueMicrotask(() =>
        queueMicrotask(() => {
          binsolve = openBinsolveWindow(itfHost(), sound, category, congratulations[category === "all" ? 5 : category] ?? "", () => {
            binsolve = null;
          });
        }),
      );
    }
  };

  /** Puzzle suivant d'une liste : le premier non résolu après `ref`, sinon le suivant, sinon aucun. */
  const nextInList = (list: readonly PuzzleRef[], ref: PuzzleRef): PuzzleRef | null => {
    const i = list.findIndex((p) => p.name === ref.name);
    return list.slice(i + 1).find((p) => !progress.isSolved(p.name)) ?? list[i + 1] ?? null;
  };

  // ------------------------------------------------------------------ deux joueurs (mode 2)

  /** Réglages gardés ; au premier match, les noms par défaut du jeu (2100, 2101). */
  const currentDuelSettings = (): DuelSettings => (duelSettings ??= defaultDuelSettings([gameText(DUEL_TEXT.player1), gameText(DUEL_TEXT.player2)]));

  /** Le match s'arrête (autre mode, menu principal). */
  const leaveDuel = (): void => {
    duel = null;
    duelPending = null;
    endTurnButton.hidden = true;
  };

  /**
   * Fenêtre des réglages (`HEDTOHED`, 41d15c) : OK lance le match sur le puzzle de 42cbad(5) ; Annuler revient au menu principal
   * (mode 7, 422a24), d'où qu'on vienne.
   */
  const openDuelSetup = (): void => {
    if (session?.running) toggleRun();
    leaveDuel();
    let chosen: DuelSettings | null = null;
    pauseFor(
      openDuelSetupWindow(itfHost(), {
        settings: currentDuelSettings(),
        text: gameText,
        message: (text) => void messageDialog(itfHost(), text),
        start: (settings) => {
          chosen = settings;
        },
        cancel: () => undefined,
        onClose: () => {
          resume();
          if (!chosen) return backToMainMenu(true);
          duel = new Duel(chosen);
          enterDuelGame(nextDuelPuzzle(duelPuzzles, current, (n) => progress.isSolved(n), () => Math.random() * 0x7fffffff));
        },
      }),
    );
  };

  /**
   * Une partie du match (43252d(puzzle, 2)) : le puzzle tel que le LEV le donne (rien n'est gardé), la règle du tour branchée sur
   * l'éditeur, la fiche `PUZZDISP`, puis le message du tour (4330d0 : un nouveau puzzle donne le tour au joueur courant).
   */
  const enterDuelGame = (ref: PuzzleRef): void => {
    const match = duel;
    if (!match) return;
    if (homeSlot(ref) !== null) {
      // Les puzzles maison ne se jouent pas à deux dans le port : ils s'ouvrent en Jeu.
      return enterPuzzle(ref);
    }
    front = null;
    persistEdit();
    walk = null;
    labTest = null;
    home = null;
    duelPending = null;
    const level = readLev(index.get(`${ref.name}.LEV`));
    current = ref;
    baseLevel = level;
    session = new Tim3Session(types, level, { puzzle: ref, guard: match.round });
    match.prepareTurn();
    session.setBackground(TURN_BACKGROUND[match.turn]);
    const t = texts.levels[ref.index];
    playScreen(level, t?.goal ?? level.goal, t?.hints ?? level.hints.map((x) => x.text));
    music(level.info.music);
    announce(`${copy.categories[ref.category] ?? ""} ${ref.number} : ${t?.title ?? ""}. ${t?.goal ?? ""}`);
    // Même fiche qu'en Jeu (`enterPuzzle`) : musique du début, voix du but à la 18e passe, coupée par OK.
    sound.restartMusic();
    const voice = goalVoice(ref.index);
    showScreen(new PuzzleCardScreen(assets, readItf(index.get("PUZZDISP.ITF")), ref, puzzleTitle(ref), () => void sound.playVoice(voice, false)), () => {
      sound.stopVoice();
      sound.resumeMusic();
      shell.focusCanvas();
      turnMessage();
    });
  };

  /** 4331a4 … 433200 : son 0xBF8, fond du joueur, tableau, GENERIC 31116 ; le temps du joueur part à la fermeture (433208). */
  const turnMessage = (): void => {
    const match = duel;
    if (!match) return;
    sound.playEffect(SOUND_TURN);
    session.setBackground(TURN_BACKGROUND[match.turn]);
    pauseFor(
      messageDialog(itfHost(), formatText(gameText(DUEL_TEXT.turn), match.name()), () => {
        resume();
        if (duel !== match) return;
        match.startTurn();
        announce(copy.duelTurnStarted(match.name(), Math.round(match.remaining / 1000)));
        shell.focusCanvas();
      }),
    );
  };

  /** « Terminer le Tour » (418e70) : l'échéance est maintenant. */
  const endTurnNow = (): void => {
    if (duel?.started && !dialog && !front) duel.endTurnNow();
  };

  /** 4330d0 : temps écoulé, machine arrêtée, aucune fenêtre : la pièce tenue est posée ou rendue (4301f5), le tour passe. */
  const switchTurn = (): void => {
    const match = duel;
    if (!match) return;
    screen.cancelGesture();
    session.editor.dropHeld();
    screen.resetFocus();
    tip.hidden = true;
    match.switchTurn();
    turnMessage();
  };

  /** Bac fermé (418207 → 31153) ou pièce de l'aire interdite (42e6d3 → 31152) : son 0xE24 et le message du jeu. */
  const duelRefused = (reason: "bin" | "moved"): void => {
    sound.playEffect(SOUND_DUEL_REFUSED);
    pauseFor(messageDialog(itfHost(), gameText(reason === "bin" ? DUEL_TEXT.taken : DUEL_TEXT.moved), resume));
  };

  /** Texte de fin de manche (419803 en mode 2, 41d827). */
  const outcomeText = (match: Duel, o: DuelOutcome): string => {
    switch (o.kind) {
      case "match":
        return formatText(gameText(DUEL_TEXT.won), match.name(o.winner));
      case "game":
        return formatText(gameText(DUEL_TEXT.solved), match.name(o.winner));
      case "matchPoint": {
        if (o.leader === null) return `~S3${gameText(DUEL_TEXT.serious)}`;
        const other: Player = o.leader === 0 ? 1 : 0;
        return `~S3${match.name(other)}, ${match.name(o.leader)} ${gameText(DUEL_TEXT.oneMore)}`;
      }
    }
  };

  /** La machine a résolu le puzzle : manche au joueur du tour (41993b), puis la question de fin de manche. */
  const duelSolved = (): void => {
    const match = duel;
    if (!match) return;
    if (!duelPending) {
      duelPending = match.solved();
      announce(copy.duelScore(match.name(0), match.wins[0], match.name(1), match.wins[1]));
    }
    showDuelOutcome();
  };

  /**
   * Rejouer (premier bouton) : la machine repart, la question revient à son arrêt. Suivant : le puzzle est noté résolu (42ccae), la
   * partie suivante s'ouvre (42cbad(5)), le vainqueur de la manche commence. Affronter : la fenêtre des réglages (419aed, mode 7 → 2).
   */
  const showDuelOutcome = (): void => {
    const match = duel;
    const outcome = duelPending;
    if (!match || !outcome || session.running) return;
    const last = outcome.kind === "match" ? DUEL_TEXT.rematch : DUEL_TEXT.next;
    let replay = false;
    pauseFor(
      genericDialog(itfHost(), {
        text: outcomeText(match, outcome),
        buttons: [DUEL_TEXT.replay, last],
        choose: (r) => {
          replay = r === 1;
        },
        onClose: () => {
          resume();
          if (duel !== match) return;
          if (replay) {
            if (!session.running) toggleRun();
            return;
          }
          duelPending = null;
          if (current) progress.markSolved(current.name);
          if (outcome.kind === "match") return openDuelSetup();
          enterDuelGame(nextDuelPuzzle(duelPuzzles, current, (n) => progress.isSolved(n), () => Math.random() * 0x7fffffff));
        },
      }),
    );
  };

  /** Puzzles maison qui ont un but, par emplacement. */
  const homePuzzles = (): PuzzleRef[] =>
    Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).flatMap((slot) => {
      const s = slots.read(slot);
      return s && hasGoal(s.save.machine) ? [homePuzzleRef(slot)] : [];
    });

  /** Puzzle maison réussi : noté (emplacement et date), PUZZSOLV ; « Puzzle Suivant » : le puzzle maison suivant non résolu. */
  const homeSolved = (ref: PuzzleRef, h: { slot: number; savedAt: number }): void => {
    homeProgress.markSolved(h.slot, h.savedAt);
    screen.solved = true;
    const list = homePuzzles();
    const after = list.filter((p) => p.number > ref.number);
    const isSolved = (p: PuzzleRef): boolean => homeProgress.isSolved(p.number, slots.read(p.number)?.savedAt ?? -1);
    const next = after.find((p) => !isSolved(p)) ?? after[0] ?? null;
    const fanfare = window.setTimeout(() => sound.playEffect(SOUND_SOLVED), SOLVED_SOUND_STEPS * STEP_MS);
    pauseFor(
      solvedDialog(itfHost(), {
        hasNext: next !== null,
        canReplay: true,
        same: () => undefined,
        replay: () => {
          if (!session.running) toggleRun();
        },
        next: () => next && enterPuzzle(next),
        onClose: () => {
          window.clearTimeout(fanfare);
          resume();
        },
      }),
    );
  };

  const onEvent = (e: PlayEvent): void => {
    switch (e.type) {
      case "start":
        if (!session.running) toggleRun();
        break;
      case "stop":
        if (session.running) toggleRun();
        break;
      case "goal":
        if (current && current.index >= 0 && !session.running) sound.playVoice(goalVoice(current.index));
        break;
      case "goalEdit":
        editGoal();
        break;
      case "locked":
        persistEdit();
        announce(e.locked ? copy.partLocked : copy.partUnlocked);
        break;
      case "solution":
        openSolve(e.part);
        break;
      case "hintEdit":
        openHintEditor({ slot: e.slot });
        break;
      case "hintDelete":
        deleteHint(e.slot);
        break;
      case "hintChanged":
        persistEdit();
        break;
      case "hintPlaced":
        openHintEditor({ at: { x: e.x, y: e.y } });
        break;
      case "rectDrawn":
        solveRect(e.rect);
        break;
      case "placeCancel":
        announce(copy.placeCancelled);
        if (solvePart) solveRect(null);
        break;
      case "tab":
        labTab = e.tab;
        // 4187b5 : l'onglet des décors rallume leur affichage (préférence du joueur).
        if (labTab === SCENERY_TAB && !(prefs.display & DISPLAY.scenery) && !setDisplay(prefs.display | DISPLAY.scenery)) {
          pauseFor(messageDialog(itfHost(), gameText(PREFS_UNSAVED_TEXT), resume));
        }
        fillLabBin();
        announce(copy.binTab(gameText(TAB_TEXT + e.tab)));
        break;
      case "flipped":
        followVariant(e.part);
        break;
      case "program":
        openProgram(e.part);
        break;
      case "info":
        openInfo(e.partType);
        break;
      case "hint":
        openHint(e.slot);
        break;
      case "tip":
        showTip(e.partType, e.anchor);
        break;
      case "toolbarTip":
        showButtonTip(e.button);
        break;
      case "tipEnd":
        tip.hidden = true;
        break;
      case "sound":
        sound.playEffect(e.name === "remove" ? SOUND_REMOVE : SOUND_PLACE);
        if (e.name === "remove" || e.name === "drop") fillLabBin();
        break;
      case "toolbar":
        toolbarAction(e.name);
        break;
      case "duelRefused":
        duelRefused(e.reason);
        break;
      case "helpPick":
        helpPicked(e.target);
        break;
      case "helpCancel":
        screen.message = null;
        announce(copy.helpPickCancelled);
        break;
    }
  };

  // ------------------------------------------------------------------ inscription (SIGNIN.ITF, docs/tim3/ui.md § Inscription)

  /** Change de joueur : l'aire en cours reste à l'ancien ; la progression, le son et les préférences deviennent ceux du nouveau. */
  const switchPlayer = (id: number): void => {
    persistEdit();
    if (!players.select(id)) return;
    const store = players.storage();
    progress = new Progress(store);
    homeProgress = new HomeProgress(store);
    edits = new EditStore(store);
    applyPlayerSound();
    applyDisplay();
    detached = true;
    const player = players.byId(id);
    if (player) announce(copy.playerChanged(players.nameOf(player)));
  };

  /**
   * Écran d'inscription (426b53), depuis le menu principal ou la feuille et le stylo de la barre ; ensuite, toujours le menu principal
   * (mode 7 vers 10) et la musique 1000 relancée (4268d8).
   */
  const openSignIn = (): void => {
    let chosen: number | null = null;
    let help = false;
    const list = players.list();
    const handle = openSignInWindow(itfHost(), {
      names: () => players.list().map((p) => players.nameOf(p)),
      current: list.findIndex((p) => p.id === players.current),
      click: () => sound.playEffect(SOUND_PLACE),
      done: (typed, selected) => {
        const signedIn = (id: number): void => {
          chosen = id;
          handle.close();
        };
        const d = signInDecision(players, typed, selected);
        switch (d.kind) {
          case "select":
            return signedIn(d.player.id);
          case "noName":
            return void messageDialog(itfHost(), gameText(SIGNIN_TEXT.noName));
          case "ask":
            return void confirmDialog(itfHost(), gameText(SIGNIN_TEXT.newPlayer), () => {
              const r = players.create(d.name);
              if (r.status === "created") professorMet = false;
              if (r.status === "created" || r.status === "exists") return signedIn(r.player.id);
              void messageDialog(itfHost(), r.status === "full" ? copy.signInFull : copy.signInFailed);
            });
        }
      },
      help: () => {
        help = true;
      },
      onClose: () => {
        resume();
        if (help) return openHelp(openSignIn);
        backToMainMenu(true);
        if (chosen !== null) switchPlayer(chosen);
        if (musicOn) sound.playMusic(TITLE.music);
      },
    });
    pauseFor(handle);
  };

  // ------------------------------------------------------------------ visite guidée (mode 6, docs/tim3/ui.md § Visite guidée)

  /** Mode 6 (42332c) : un Labo vide, chaussure enfoncée, puis la fenêtre de la visite (422b65). */
  const enterWalkthrough = (): void => {
    persistEdit();
    leaveDuel();
    labTest = null;
    home = null;
    current = null;
    baseLevel = null;
    front = null;
    walk = new Walkthrough(professorMet);
    session = new Tim3Session(types, labLevel(DEFAULT_LAB), { lab: { ...DEFAULT_LAB } });
    fillLabBin();
    playScreen(session.level, copy.labGoal, []);
    music(DEFAULT_LAB.music);
    shell.focusCanvas();
    openWalkthrough();
  };

  /** La fenêtre du professeur de la visite (41d8e8(0)) : au départ, puis au portrait de la barre (41922f). */
  const openWalkthrough = (): void => {
    const w = walk;
    if (!w) return;
    if (session.running) toggleRun();
    goalEditor?.close();
    pauseFor(
      openWalkthroughWindow(itfHost(), {
        walk: w,
        facts: () => walkFacts(session.world, session.labPuzzle),
        lines: professorLines,
        audio: sound,
        confirmLeave: (leave) => void confirmDialog(itfHost(), gameText(WALK_LEAVE_TEXT), leave),
        after: (e) => {
          resume();
          professorMet = w.met;
          walkEffect(e);
        },
      }),
    );
  };

  /** Ce que fait la visite une fois sa fenêtre fermée (41d9a3, 41d8e8). */
  const walkEffect = (e: WalkEffect | null): void => {
    const w = walk;
    if (!e || !w) return;
    switch (e.kind) {
      case "close":
        // Action 2 : la barre du but prend le focus ; 0x40 : l'éditeur d'indices (41d96f) ; sinon le joueur travaille.
        if (e.then === "hints") return openHintEditor(null);
        if (e.then === "goal") editGoal();
        return announce(copy.walkthroughResume);
      case "music":
        return openOptions(openWalkthrough);
      case "lockAll":
        session.editor.lockAll(true);
        screen.resetFocus();
        return openWalkthrough();
      case "save":
        w.saved(saveWalkthrough(w));
        return openWalkthrough();
      case "leave":
        // La machine de la visite est perdue (31136) : elle ne doit pas devenir celle du Labo.
        walk = null;
        detached = true;
        return backToMainMenu(true);
      default:
        return;
    }
  };

  /**
   * Action 4 (41edfc) : le jeu écrit un nouveau puzzle maison `PUZB<n>.TIM` ; le port prend le premier emplacement libre des machines du
   * Labo. Pas d'emplacement libre ou stockage plein : échec (texte 30 du professeur).
   */
  const saveWalkthrough = (w: Walkthrough): boolean => {
    const machine = session.lab ? snapshotLab(session.world, session.lab, session.labPuzzle) : null;
    const free = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).find((n) => slots.read(n) === null);
    if (!machine || free === undefined) return false;
    if (saveMachine(slots, free, w.name, machine, Date.now()) !== "saved") return false;
    labName = cleanName(w.name) ?? "";
    announce(copy.machineSaved(labName));
    return true;
  };

  // ------------------------------------------------------------------ aide du professeur (HELP.ITF, docs/tim3/ui.md)

  /** Texte et voix de l'aide d'un contrôle (41e7e7), « Je suis désolé… » (23200) s'il n'en a pas. */
  const helpFor = (id: number): { text: string; voice: ReturnType<typeof helpVoice> | null } => {
    const entry = help.find(id) ?? help.find(HELP_NOTHING);
    return { text: entry?.text ?? "", voice: entry ? helpVoice(entry.rank) : null };
  };

  /** Fenêtre du professeur pour un contrôle (41e798 puis 41d9a3) ; son « ? » passe l'écran en mode aide (41e6b7). */
  const playHelp = (id: number): void => {
    let again = false;
    pauseFor(
      openHelpWindow(itfHost(), {
        ...helpFor(id),
        audio: sound,
        another: () => {
          again = true;
        },
        onClose: () => {
          resume();
          if (again) startHelpPick();
        },
      }),
    );
  };

  /** Mode aide de l'écran de jeu : curseur « ? » (451718(5, 1)), consigne dans la barre du but et pour les lecteurs d'écran. */
  const startHelpPick = (): void => {
    screen.startHelpPick();
    screen.message = copy.helpPick;
    announce(copy.helpPick);
  };

  /** 41e85c : son 0xE1B, puis l'aide de l'élément ; une pièce donne sa description et le mode aide continue (41ea8b). */
  const helpPicked = (target: HelpTarget): void => {
    screen.message = null;
    if (target.kind === "part") return openInfo(target.partType, startHelpPick);
    sound.playEffect(SOUND_PLACE);
    playHelp(target.kind === "control" ? target.id : HELP_NOTHING);
  };

  /** Clic sur un bouton de la barre du haut (418ded, `ui/toolbar.ts`) : confirmation d'origine d'abord s'il y en a une. */
  const toolbarAction = (name: string): void => {
    const lab = session.lab !== null;
    const fieldEmpty = session.world.statics.head === null && session.world.mobiles.head === null;
    const decision = toolbarDecision(name, { lab, test: labTest !== null, duel: duel !== null, walkthrough: walk !== null, solved: screen.solved, running: session.running, fieldEmpty });
    if (decision.endTest) {
      // Mode 8 : l'essai se termine (Labo d'avant l'essai), puis le bouton agit comme au Labo.
      endTest();
      if (decision.action !== "none") toolbarAction(name);
      return;
    }
    if (decision.confirm === undefined) return runToolbar(decision.action);
    pauseFor(confirmDialog(itfHost(), interfaceText(interfaceLines, decision.confirm), () => runToolbar(decision.action), resume));
  };

  const runToolbar = (action: ToolbarAction): void => {
    switch (action) {
      case "none":
        return;
      case "play": {
        if (session.running) toggleRun();
        // Depuis les deux joueurs : le puzzle en cours du Jeu (mode 7 → 0, 42cbad(−1)).
        const ref = duel ? currentPuzzle(puzzles, progress) : (puzzles.find((p) => p.name === (current?.name ?? progress.last)) ?? puzzles[0]!);
        return enterPuzzle(ref);
      }
      case "duel":
        return openDuelSetup();
      case "signIn":
        if (session.running) toggleRun();
        return openSignIn();
      case "walkthrough":
        if (session.running) toggleRun();
        return enterWalkthrough();
      case "professor":
        return openWalkthrough();
      case "endTurn":
        return endTurnNow();
      case "lab":
        if (session.running) toggleRun();
        return void openLab();
      case "machines":
        return openMachines();
      case "chooser":
        return openChooser();
      case "options":
        return openOptions();
      case "globals":
        return openGlobe();
      case "clear":
        if (session.running) return;
        session.editor.clearField();
        screen.resetFocus();
        fillLabBin();
        persistEdit();
        return announce(copy.fieldCleared);
      case "help":
        return playHelp(HELP_INTRO);
      case "hints":
        return showHint();
      case "hintEditor":
        return openHintEditor(null);
      case "lock":
        return openLock();
      case "test":
        return startTest();
      case "solution":
        if (current && !session.running) loadPuzzle(current, true);
        return;
      case "run":
        return toggleRun();
    }
  };

  /** Description d'une pièce (INFO.ITF, 420c14) ; l'appelant du jeu joue 0xE1B à l'ouverture (41ea91, 42e979). */
  const openInfo = (type: number, after?: () => void): void => {
    sound.playEffect(SOUND_PLACE);
    pauseFor(
      openInfoWindow(itfHost(), type, texts.parts.find((p) => p.id === type), () => {
        resume();
        after?.();
      }),
    );
  };

  /** Poignée « programmer » (42ea57 : son 0xC40, puis 4249f8, `PROG<type>.ITF`). */
  const openProgram = (part: Part): void => {
    if (session.running) return;
    const program = session.editor.program(part, programRows);
    if (!program) return openInfo(part.type);
    sound.playEffect(SOUND_PROGRAM);
    pauseFor(
      openProgramWindow(itfHost(), {
        title: texts.parts.find((p) => p.id === part.type)?.name ?? copy.partInfoTitle,
        program,
        changed: () => sound.playEffect(SOUND_PLACE),
        onClose: () => {
          // 424a82 : l'image de la pièce a pu changer, sa condition de réussite suit (429d84).
          followVariant(part);
          resume();
        },
      }),
    );
  };

  /** Infobulle d'un bouton de la barre : texte de `DESCRIPT.RES`, plus « non disponible » s'il est grisé. */
  const showButtonTip = (button: ShownButton): void => {
    const text = descriptions.get(button.id);
    if (text) placeTip([button.disabled ? copy.toolbarUnavailable(text) : text], button, "below");
  };

  const showTip = (type: number, anchor: Rect): void => {
    const info = texts.parts.find((p) => p.id === type);
    if (info) placeTip([h("strong", {}, info.name), info.description], anchor, "left");
  };

  /** Infobulle posée à gauche de `anchor` (bac) ou dessous (barre d'outils), en coordonnées de l'écran du jeu. */
  const placeTip = (content: (Node | string)[], anchor: Rect, side: "left" | "below"): void => {
    tip.replaceChildren(...content);
    const rect = shell.canvas.getBoundingClientRect();
    const stageRect = shell.stage.getBoundingClientRect();
    const scale = rect.width / SCREEN_WIDTH;
    tip.hidden = false;
    const left = rect.left - stageRect.left;
    const top = rect.top - stageRect.top;
    if (side === "left") {
      tip.style.left = `${Math.max(4, left + anchor.x * scale - 8 - tip.offsetWidth)}px`;
      tip.style.top = `${Math.max(4, top + anchor.y * scale)}px`;
    } else {
      tip.style.left = `${Math.max(4, Math.min(left + anchor.x * scale, left + rect.width - tip.offsetWidth - 4))}px`;
      tip.style.top = `${top + (anchor.y + anchor.height) * scale + 4}px`;
    }
  };

  // ------------------------------------------------------------------ fenêtres

  /** Où les fenêtres `.ITF` se dessinent : par-dessus le canvas du jeu. */
  const itfHost = (): ItfHost => ({ main: shell.main, canvas: shell.canvas, assets, descriptions, playEffect: (id, priority, flags) => sound.playEffect(id, priority, flags) });

  const pauseFor = (handle: ItfWindowHandle): void => {
    dialog?.close();
    dialog = handle;
    tip.hidden = true;
    if (!front) screen.cancelGesture();
    applyPause();
  };
  const resume = (): void => {
    dialog = null;
    applyPause();
    persistEdit();
  };

  // ------------------------------------------------------------------ parcours d'entrée et choix du puzzle

  const effect = (s: FrameSound): void => void sound.playEffect(s.id, s.priority, s.flags);

  /** Écran `.ITF` du parcours d'entrée ; `then` reçoit son résultat (`null` : fermé par l'hôte). */
  const showScreen = <R,>(s: ItfScreen<R>, then: (result: R | null) => void): void =>
    pauseFor(
      openItfWindow(
        itfHost(),
        s.itf,
        screenOptions(s, (result) => {
          dialog = null;
          applyPause();
          then(result);
        }),
      ),
    );

  /** Message « non disponible » du jeu, puis `then`. */
  const unavailable = (then: () => void): void =>
    pauseFor(
      messageDialog(itfHost(), copy.notAvailable, () => {
        resume();
        then();
      }),
    );

  /** Fond noir derrière les menus : le jeu n'est plus montré (comme la fenêtre du menu principal d'origine). */
  const setBackdrop = (): void => {
    front = { kind: "backdrop" };
    frontSurface.clear(0);
    frontSurface.toRgba(blackLut, pixels);
    ctx.putImageData(image, 0, 0);
    shell.canvas.style.cursor = "";
    lastCursor = "";
  };

  const startIntro = (): void => {
    let jingleMs = 0;
    try {
      jingleMs = readSoundEffect(index.get(`SX_${LOGO.jingle}.WAV`)).duration * 1000;
    } catch (error) {
      console.warn("TIM3 : air de Sierra illisible", error);
    }
    const player = new IntroPlayer(
      assets,
      index,
      {
        effect,
        stopEffect: (id) => sound.stopEffect(id),
        music: (id) => {
          if (musicOn) sound.playMusic(id);
        },
      },
      jingleMs,
    );
    front = { kind: "intro", player };
    announce(copy.introSkip);
    shell.focusCanvas();
  };

  /** Fin de l'intro : la musique du titre (43b194), puis les crédits si rien n'a été passé, sinon le menu principal. */
  const endIntro = (player: IntroPlayer): void => {
    setBackdrop();
    if (musicOn) sound.playMusic(TITLE.music);
    if (player.skipped) openMainMenu();
    else showScreen(new CreditsScreen(assets, readItf(index.get("CREDITS.ITF")), parseLines(index.get("CREDITS.RES")), copy.creditsTitle), (r) => r && openMainMenu());
  };

  /** Mode aide du menu principal (après le « ? » de la fenêtre du professeur ouverte par-dessus). */
  let menuPicking = false;

  /** Fenêtre du professeur par-dessus le menu principal, qui reste ouvert (`dialog`) ; son « ? » passe le menu en mode aide. */
  const menuHelp = (id: number): void => {
    let again = false;
    openHelpWindow(itfHost(), {
      ...helpFor(id),
      audio: sound,
      another: () => {
        again = true;
      },
      onClose: () => {
        menuPicking = again;
        dialog?.refresh();
      },
    });
  };

  const openMainMenu = (): void => {
    setBackdrop();
    menuPicking = false;
    const menu = new MainMenuScreen(
      assets,
      readItf(index.get("MAINMENU.ITF")),
      { title: copy.mainMenu, describe: (id) => descriptions.get(id) },
      {
        open: () => menuHelp(HELP_INTRO),
        picking: () => menuPicking,
        // 41e958 : le premier contrôle sous le pointeur qui a une aide, sinon « Je suis désolé… ».
        pick: (ids) => {
          menuPicking = false;
          sound.playEffect(SOUND_PLACE);
          menuHelp(ids.find((id) => help.find(id) !== null) ?? HELP_NOTHING);
        },
        cancel: () => {
          menuPicking = false;
        },
        prompt: copy.helpPick,
      },
    );
    showScreen(menu, (action) => mainMenuChoice(action));
  };

  const mainMenuChoice = (action: MainMenuAction | null): void => {
    switch (action) {
      case "play":
        return enterPuzzle(currentPuzzle(puzzles, progress));
      case "lab":
        front = null;
        openLab();
        return shell.focusCanvas();
      case "duel":
        return openDuelSetup();
      case "signIn":
        return openSignIn();
      case "walkthrough":
        return enterWalkthrough();
      case "help":
        return openHelp(openMainMenu);
      case "options":
        return openPreferences(openMainMenu);
      case "quit":
        return quit();
      case null:
        return;
    }
  };

  /** Quitter (422f00) : « Désirez-vous quitter? » ; Oui : l'accueil du site, ou le jeu relancé sur la page de dev ; Non : le menu. */
  const quit = (): void => {
    let leaving = false;
    quitMainMenu(
      (text, yes, no) =>
        pauseFor(
          confirmDialog(itfHost(), interfaceText(interfaceLines, text), yes, () => {
            resume();
            queueMicrotask(() => leaving || no());
          }),
        ),
      () => {
        leaving = true;
        leaveGame(options.backLabel, () => void mountApp(container, options));
      },
      openMainMenu,
    );
  };

  /** « Menu principal » sous l'écran : la machine s'arrête, l'aire est gardée, le menu remplace le jeu. Pendant l'intro : la passe. */
  const backToMainMenu = (force = false): void => {
    if (front?.kind === "intro") return front.player.skip();
    if (!force && (front || dialog || helpView)) return;
    leaveDuel();
    if (!session) return openMainMenu();
    if (session.running) toggleRun();
    screen.helpPicking = false;
    persistEdit();
    sound.stopEffects();
    sound.stopVoice();
    tip.hidden = true;
    openMainMenu();
  };

  /** Ouvre un puzzle sur sa fiche (`PUZZDISP`, 425d20), comme le jeu à chaque entrée dans un puzzle. */
  const enterPuzzle = (ref: PuzzleRef): void => {
    front = null;
    if (!loadPuzzle(ref)) return;
    const title = puzzleTitle(ref);
    // Fiche (425edc … 425f6b) : la musique du puzzle repart du début ; la voix du but part 18 passes après, pendant la fiche, et coupe la
    // musique ; OK coupe la voix et relance la musique (425d6f … 425daa).
    sound.restartMusic();
    const voice = ref.index >= 0 && homeSlot(ref) === null ? goalVoice(ref.index) : null;
    const card = new PuzzleCardScreen(assets, readItf(index.get("PUZZDISP.ITF")), ref, title, voice ? () => void sound.playVoice(voice, false) : undefined);
    showScreen(card, () => {
      sound.stopVoice();
      sound.resumeMusic();
      shell.focusCanvas();
    });
  };

  /** Titre d'un puzzle : `LEVELS.INF`, ou le nom de la machine d'un puzzle maison. */
  const puzzleTitle = (p: PuzzleRef): string => {
    const slot = homeSlot(p);
    return slot !== null ? (slots.read(slot)?.save.name ?? "") : (texts.levels[p.index]?.title ?? "");
  };

  const chooserTexts: ChooserTexts = {
    title: copy.chooserTitle,
    puzzleTitle,
    solved: copy.solvedMark,
  };

  /** Puzzles résolus pour la liste : ceux du jeu, et les puzzles maison (emplacement et date de sauvegarde). */
  const chooserProgress = {
    isSolved: (name: string): boolean => {
      const m = /^HOME(\d+)$/.exec(name);
      if (!m) return progress.isSolved(name);
      const slot = Number(m[1]);
      const stored = slots.read(slot);
      return stored !== null && homeProgress.isSolved(slot, stored.savedAt);
    },
  };

  /** Disquette en Jeu (418f2c) : la liste des puzzles de la catégorie en cours (`DOSBOX`), puzzles maison compris. */
  const openChooser = (): void => {
    if (!current) return;
    if (session.running) toggleRun();
    const all = [...puzzles, ...duelPuzzles, ...homePuzzles()];
    showList(new PuzzleListScreen(assets, readItf(index.get("DOSBOX.ITF")), all, chooserProgress, chooserTexts, current.category, current, effect));
  };

  const showList = (list: PuzzleListScreen): void =>
    showScreen(list, (r) => {
      switch (r?.kind) {
        case "load":
          // Deux joueurs : le puzzle choisi devient la partie suivante (41acf0 en mode 2), scores gardés.
          return duel ? enterDuelGame(r.puzzle) : enterPuzzle(r.puzzle);
        case "bins":
          return showBins(list);
        case "help":
          return openHelp(() => showList(list));
        case "unavailable":
          return unavailable(() => showList(list));
        case "cancel":
          return shell.focusCanvas();
        default:
          return;
      }
    });

  /** « Autres Puzzles » : les bacs (`DOSBIN`), puis la liste de la catégorie choisie (41ae39). */
  const showBins = (list: PuzzleListScreen): void =>
    showScreen(
      new BinScreen(readItf(index.get("DOSBIN.ITF")), copy.binsTitle, list.category),
      (r) => {
        switch (r?.kind) {
          case "category":
            // Bac « Maison » sans machine qui ait un but : le jeu dit que le répertoire est vide (31184) ; le port explique.
            if (r.category === HOME_CATEGORY && homePuzzles().length === 0) {
              return pauseFor(
                messageDialog(itfHost(), copy.homeEmpty, () => {
                  resume();
                  showBins(list);
                }),
              );
            }
            list.setCategory(r.category, current);
            return showList(list);
          case "cancel":
            return showList(list);
          case "help":
            return openHelp(() => showBins(list));
          case "unavailable":
            return unavailable(() => showBins(list));
          default:
            return;
        }
      },
    );

  /** Guitare (MUSICBOX.ITF, 4234ec), depuis la barre d'outils : musique, effets, volume, voix du professeur. */
  const openOptions = (after?: () => void): void => {
    // Depuis le menu principal de départ, aucun puzzle n'est ouvert : musique du titre.
    const live = session as Tim3Session | undefined;
    pauseFor(
      openMusicboxWindow(itfHost(), {
        musicList: texts.music,
        soundList: texts.sounds,
        initial: { music: sound.musicNumber || (live?.music ?? TITLE.music), musicOn, effectsOn: sound.effectsEnabled, volume: sound.volume, voicesOn: sound.voicesEnabled, effect: effectChoice },
        playMusic: (id) => {
          if (musicOn) sound.playMusic(id);
        },
        stopMusic: () => sound.stopMusic(),
        playEffect: (id) => sound.playEffect(id),
        stopEffect: (id) => sound.stopEffect(id),
        setMusicOn: (on) => {
          musicOn = on;
          players.setSound({ music: on });
          if (!on) sound.stopMusic();
        },
        setEffectsOn: (on) => {
          sound.effectsEnabled = on;
          storage.set(EFFECTS_KEY, on ? "1" : "0");
          if (!on) sound.stopEffects();
        },
        setVolume: (v) => {
          sound.volume = v;
          players.setSound({ volume: v });
        },
        setVoices: (on) => {
          sound.voicesEnabled = on;
          if (!on) sound.stopVoice();
        },
        // Au Labo, le morceau choisi devient celui de la machine (423999 : `[0x477950]`) ; en Jeu, il dure jusqu'au puzzle suivant.
        musicChosen: (id) => {
          if (live?.lab && !live.running) live.setLab({ music: id });
        },
        effectChosen: (i) => {
          effectChoice = i;
        },
        onClose: () => {
          resume();
          after?.();
        },
      }),
    );
  };

  /** Garde des préférences du joueur courant (42c8cb) ; elles valent pour la séance même si l'écriture échoue (faux). */
  const savePrefs = (next: Partial<PlayerPrefs>): boolean => {
    prefs = { ...prefs, ...next };
    return players.setPrefs(next);
  };

  /** Préférences d'affichage du joueur courant : gardées (42c8cb) et posées sur le monde en cours ; faux si l'écriture a échoué. */
  const setDisplay = (display: number): boolean => {
    const saved = savePrefs({ display });
    applyDisplay();
    return saved;
  };

  /**
   * Préférences du joueur (`USERPREF.ITF`, 42aa60), depuis « Options » du menu principal (4230dd). À la fermeture, comme après
   * « Configurer > Préférences » (4167ae → 418818) : décors éteints, le bac du Labo quitte l'onglet des décors.
   */
  const openPreferences = (after?: () => void): void => {
    let help = false;
    /** Une écriture a échoué : 31173 en fermant (le jeu écrit le fichier du joueur à la fermeture, 42aaa1). */
    let unsaved = false;
    pauseFor(
      openUserPrefWindow(itfHost(), {
        initial: { display: prefs.display, soundOn: prefs.soundOn },
        setDisplay: (display) => {
          if (!setDisplay(display)) unsaved = true;
        },
        setSound: (on) => {
          if (!savePrefs({ soundOn: on })) unsaved = true;
          sound.soundEnabled = on;
        },
        help: () => {
          help = true;
        },
        onClose: () => {
          resume();
          if (!(prefs.display & DISPLAY.scenery) && labTab === SCENERY_TAB) {
            labTab = 0;
            const live = session as Tim3Session | undefined;
            if (live) {
              screen.binTab = labTab;
              fillLabBin();
            }
          }
          const next = (): void => {
            if (help) return openHelp(() => openPreferences(after));
            after?.();
          };
          if (!unsaved) return next();
          pauseFor(
            messageDialog(itfHost(), gameText(PREFS_UNSAVED_TEXT), () => {
              resume();
              next();
            }),
          );
        },
      }),
    );
  };

  /** Globe (GRAVITY.ITF, 41cbdc) : réglettes au Labo, consultation en Jeu ; couleur du décor partout. */
  const openGlobe = (): void => {
    if (session.running) return;
    const lab = session.lab;
    pauseFor(
      openGlobeWindow(itfHost(), {
        settings: { gravity: lab?.gravity ?? session.world.gravity, pressure: lab?.pressure ?? session.world.pressure, background: session.background },
        lab: lab !== null,
        change: (s) => {
          if (s.background !== undefined) session.setBackground(s.background);
          if (lab && (s.gravity !== undefined || s.pressure !== undefined)) session.setLab({ ...(s.gravity !== undefined ? { gravity: s.gravity } : {}), ...(s.pressure !== undefined ? { pressure: s.pressure } : {}) });
        },
        refused: (text) => void messageDialog(itfHost(), text),
        onClose: resume,
      }),
    );
  };

  /** Machines du Labo (disquette au Labo, 418f3a) : LOADSAVE, puis la liste des emplacements. */
  const openMachines = (): void => {
    if (session.running || !session.lab) return;
    const worked = session.world.statics.head !== null || session.world.mobiles.head !== null;
    pauseFor(
      openLoadSaveWindow(itfHost(), {
        modified: worked,
        choose: (choice) => {
          if (choice === "save") {
            // 418f41 : rien à sauvegarder → 31209.
            if (!worked) return pauseFor(messageDialog(itfHost(), copy.machineNothing, resume));
            return openMachineList("save");
          }
          // Charger au Labo modifié : 31134 d'abord.
          if (worked) return pauseFor(confirmDialog(itfHost(), copy.clearConfirm, () => openMachineList("load"), resume));
          openMachineList("load");
        },
        onClose: resume,
      }),
    );
  };

  /** Liste DOSBOX des dix emplacements (Charger ou Sauvegarder). */
  const openMachineList = (mode: LoadSaveChoice): void => {
    const handle: ItfWindowHandle = openMachineListWindow(itfHost(), {
      mode,
      name: labName,
      slots: () => Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i + 1, name: slots.read(i + 1)?.save.name ?? null })),
      click: () => sound.playEffect(SOUND_PLACE),
      validate: (slot, name) => (mode === "load" ? loadSlot(slot, handle) : saveSlot(slot, name, handle, false)),
      onClose: resume,
    });
    pauseFor(handle);
  };

  /** Sauvegarde dans un emplacement ; les messages s'ouvrent par-dessus la liste, qui se ferme une fois la machine gardée. */
  const saveSlot = (slot: number, name: string, list: ItfWindowHandle, replace: boolean): void => {
    const machine = session.lab ? snapshotLab(session.world, session.lab, session.labPuzzle) : null;
    const outcome = machine ? saveMachine(slots, slot, name, machine, Date.now(), replace) : "failed";
    const clean = cleanName(name) ?? "";
    switch (outcome) {
      case "saved":
        labName = clean;
        list.close();
        return announce(copy.machineSaved(clean));
      case "occupied":
        return void confirmDialog(itfHost(), copy.machineOccupied, () => saveSlot(slot, name, list, true));
      case "noName":
        return void messageDialog(itfHost(), copy.machineNoName);
      case "empty":
        return void messageDialog(itfHost(), copy.machineNothing);
      case "failed":
        return void messageDialog(itfHost(), copy.machineFailed);
    }
  };

  /** Charge un emplacement au Labo (la liste se ferme d'abord). */
  const loadSlot = (slot: number, list: ItfWindowHandle): void => {
    const loaded = loadMachine(slots, slot);
    if (loaded.status !== "loaded") return void messageDialog(itfHost(), copy.machineUnreadable);
    list.close();
    if (openLab(loaded.machine)) {
      labName = loaded.name;
      announce(copy.machineLoaded(loaded.name));
    } else pauseFor(messageDialog(itfHost(), copy.machineLoadFailed, resume));
  };

  /** Aide du site ; `after` : à sa fermeture (retour au menu principal ou au choix du puzzle). */
  const openHelp = (after?: () => void): void => {
    if (helpView) return;
    const close = (): void => {
      helpView?.remove();
      helpView = null;
      applyPause();
      shell.focusCanvas();
      after?.();
    };
    helpView = h("div", { class: "tim3-help-overlay", role: "dialog", "aria-modal": "true", "aria-label": copy.help }, renderHelp(close, copy.helpResume));
    shell.main.append(helpView);
    if (!front) screen.cancelGesture();
    applyPause();
  };

  let paused = false;
  const applyPause = (): void => {
    const now = tabHidden || dialog !== null || helpView !== null;
    if (now === paused) return;
    paused = now;
    if (tabHidden) audio.suspend();
    else audio.resume();
    if (!paused) scheduler.resync();
  };

  // ------------------------------------------------------------------ entrées

  let tipTimer = 0;
  let tipSlot: unknown = null;
  const hoverTip = (x: number, y: number): void => {
    const slot = screen.slotUnder(x, y);
    const button = slot ? null : screen.toolbarAt(x, y);
    const tab = slot || button ? null : screen.tabAt(x, y);
    // Les boutons sont recalculés à chaque appel : on les compare par nom.
    const target = slot ?? button?.name ?? (tab ? `tab${tab.tab}` : null);
    if (target === tipSlot) return;
    tipSlot = target;
    window.clearTimeout(tipTimer);
    tip.hidden = true;
    if (session.editor.held) return;
    if (slot) tipTimer = window.setTimeout(() => showTip(slot.type, slot), TIP_DELAY_MS);
    if (button) tipTimer = window.setTimeout(() => showButtonTip(button), TIP_DELAY_MS);
    if (tab) tipTimer = window.setTimeout(() => placeTip([gameText(TAB_TEXT + tab.tab)], { x, y, width: 1, height: 1 }, "left"), TIP_DELAY_MS);
  };

  const unbindPointer = bindCanvasPointer(
    shell.canvas,
    { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
    {
      move: (x, y, event) => {
        if (paused || front) return;
        const touch = event?.pointerType === "touch";
        screen.pointerMove(x, y, touch);
        if (!touch) hoverTip(x, y);
      },
      down: (button, x, y, event) => {
        if (paused || button !== 0) return;
        audio.unlock();
        // Intro : un clic ou un toucher la passe (42a4d8 : bouton de la souris).
        if (front?.kind === "intro") return front.player.skip();
        if (front) return;
        window.clearTimeout(tipTimer);
        tip.hidden = true;
        screen.pointerDown(x, y, event.pointerType === "touch");
      },
      up: (button, x, y) => {
        if (paused || front || button !== 0) return;
        screen.pointerUp(x, y);
        persistEdit();
      },
      leave: () => {
        if (front) return;
        screen.pointerLeave();
        window.clearTimeout(tipTimer);
        tipSlot = null;
        if (!session.editor.held) tip.hidden = true;
      },
      longPress: (x, y) => {
        if (!paused && !front) screen.longPress(x, y);
      },
    },
    { onGesture: () => audio.unlock() },
  );
  const unbindKeys = bindKeyboard(
    shell.canvas,
    {
      keyDown: (event) => {
        if (paused || event.ctrlKey || event.metaKey || event.altKey) return false;
        // Intro : une touche la passe (42a4e4 : touche enfoncée).
        if (front?.kind === "intro") {
          front.player.skip();
          return true;
        }
        if (front) return false;
        const taken = screen.key(event.key);
        if (taken) {
          tip.hidden = true;
          persistEdit();
        }
        return taken;
      },
    },
    () => audio.unlock(),
  );

  // ------------------------------------------------------------------ démarrage

  window.addEventListener("pagehide", persistEdit);

  const ctx = shell.canvas.getContext("2d")!;
  const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  const pixels = new Uint32Array(image.data.buffer);
  const lut = assets.gameLut();
  const blackLut = opaqueLut(lut);
  const frontSurface = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  let lastCursor = "";

  // Page de dev avec `?puzzle=` : le puzzle tout de suite ; sinon le parcours d'origine.
  const asked = options.puzzle ? puzzles.find((p) => p.name === options.puzzle) : undefined;
  if (asked) loadPuzzle(asked);
  else startIntro();

  shell.start({
    sound: { prefs: new SoundPrefs(store, audio, GAME_ID), storageKey: soundPrefKey(GAME_ID), unlock: () => audio.unlock() },
    onPause: (hidden) => {
      tabHidden = hidden;
      if (hidden) persistEdit();
      if (hidden && !front) screen.cancelGesture();
      applyPause();
    },
    onDispose: () => {
      persistEdit();
      window.removeEventListener("pagehide", persistEdit);
      unbindPointer();
      unbindKeys();
      window.clearTimeout(tipTimer);
      dialog?.close();
      audio.close();
    },
    onFrame: (now) => {
      audio.update();
      // Deux joueurs : le temps du tour court, fenêtres ouvertes et machine en marche comprises (GetTickCount, 4330d0), pas onglet
      // masqué ; le tour ne passe qu'une fois la machine arrêtée et les fenêtres fermées.
      const dt = lastFrameAt === null ? 0 : Math.min(DUEL_MAX_STEP_MS, now - lastFrameAt);
      lastFrameAt = now;
      if (duel && !tabHidden && !front) {
        duel.advance(dt);
        if (duel.expired && !session.running && !dialog && !helpView) switchTurn();
      }
      if (paused) return;
      if (front) {
        if (front.kind !== "intro") return;
        const player = front.player;
        const phase = player.update(now);
        if (player.dirty) {
          player.surface.toRgba(player.lut, pixels);
          ctx.putImageData(image, 0, 0);
          player.dirty = false;
        }
        if (phase === "done") endIntro(player);
        return;
      }
      if (session.running) {
        for (let ticks = scheduler.due(now); ticks > 0 && session.running; ticks--) {
          const r = session.tick();
          for (const fx of session.drainEffects()) {
            if (fx.stop) sound.stopEffect(fx.id);
            else sound.playEffect(fx.id, fx.priority, fx.flags);
          }
          if (r.solved) {
            solved();
            break;
          }
        }
      } else {
        scheduler.resync();
      }
      screen.render().toRgba(lut, pixels);
      ctx.putImageData(image, 0, 0);
      const cursor = screen.cursor();
      if (cursor !== lastCursor) {
        shell.canvas.style.cursor = cursor;
        lastCursor = cursor;
      }
    },
  });
}
