/**
 * Application de The Incredible Machine 3 : page commune des jeux sur canvas (`mountGameShell`, 640×480, échelle
 * fractionnaire), un pas de simulation toutes les 32 ms (`TickScheduler`, D10), pointeur et clavier (`bindCanvasPointer`,
 * `bindKeyboard`), son (`WebTim3Audio`, `SoundPrefs`), fenêtres DOM (choix du puzzle, options, Labo), progression (`tim3:`).
 *
 * Données : les volumes Dynamix (`RESOURCE.MAP/.001/.002` + `FRENCH.DAT`) sont chargés d'un bloc ; les voix MP3 à la demande.
 */
import "./style.css";
import { fetchGameFiles } from "../../../data/game-files";
import { prefixedStorage } from "../../../engine/storage";
import { h } from "../../../ui/dom";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { mountGameShell } from "../../../ui/game-shell";
import { localStorageStore } from "../../../ui/local-storage";
import { bindCanvasPointer, bindKeyboard } from "../../../ui/pointer";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { TickScheduler } from "../../../ui/tick-scheduler";
import { WebTim3Audio, goalVoice, hintVoice, parseLipSyncJson, type Tim3Audio } from "../audio";
import { copy } from "../copy";
import { readAnm } from "../data/anm";
import { readItf } from "../data/itf";
import { levelParts, readLev, type Level } from "../data/lev";
import { readPartDef } from "../data/part-def";
import { readBinSolveRes } from "../data/solutions";
import { interfaceText, loadTexts, parseIdTable, parseLines, type GameTexts } from "../data/text";
import { ResourceIndex } from "../data/volume";
import { Editor, createPart } from "../engine/editor";
import type { Part } from "../engine/part";
import { parseProgramRows, type ProgramRow } from "../engine/program";
import {
  EditStore,
  SLOT_COUNT,
  cleanName,
  labSaveSlots,
  levelWithParts,
  loadMachine,
  machineLevel,
  machineSettings,
  saveMachine,
  snapshotLab,
  snapshotWorld,
  type LabMachine,
  type SaveOutcome,
} from "../engine/save";
import { DEFAULT_LAB, Progress, STEP_MS, Tim3Session, labLevel, puzzleList, type PuzzleRef } from "../engine/session";
import { solutionSession } from "../engine/solution";
import { TypeTable } from "../engine/types";
import { renderHelp } from "../help";
import { RenderAssets, SCREEN_HEIGHT, SCREEN_WIDTH, Surface, drawAnmImage, imageFrame, stateImage, type Rect } from "../render";
import type { ItfHost } from "./itf-dialog";
import { confirmDialog, labDialog, machinesDialog, messageDialog, optionsDialog, partInfoDialog, programDialog, puzzleChooser, solvedDialog, type DialogHandle } from "./menus";
import { PlayScreen, type PlayEvent, type ShownButton, type ToolbarButton } from "./play";
import { TOOLBAR_NAMES, toolbarDecision, type ToolbarAction } from "./toolbar";

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
/** Identifiants de `INTRFACE.RES` (rubrique « PROGRAM PART ») : Terminé, réglettes, refus des boîtes (0x7a6e) et du ballon (0x7a6f). */
const PROGRAM_TEXT = { done: 31334, mass: 31335, elasticity: 31336, density: 31337, friction: 31341, box: 31342, balloon: 31343 } as const;
const SOUND_REMOVE = 0xe1a;
/** Puzzle réussi : son 0xE21, 18 pas après l'ouverture de PUZZSOLV (4261df : compte à rebours 0x12, 426234). */
const SOUND_SOLVED = 0xe21;
const SOLVED_SOUND_STEPS = 18;
const VOLUMES = ["RESOURCE.MAP", "RESOURCE.001", "RESOURCE.002", "FRENCH.DAT"] as const;
/** Musique de l'option « Musique » (préférence mémorisée, activée par défaut). */
const MUSIC_KEY = "music";

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
  const progress = new Progress(storage);
  const edits = new EditStore(storage);
  const slots = labSaveSlots(storage);
  const puzzles = puzzleList();
  let musicOn = storage.get(MUSIC_KEY) !== "0";

  // ------------------------------------------------------------------ état

  let current: PuzzleRef | null = null;
  /** LEV d'origine du puzzle ouvert (la photo de l'aire s'y rapporte) ; `null` au Labo. */
  let baseLevel: Level | null = null;
  /** Nom de la dernière machine du Labo sauvegardée ou chargée (proposé à la sauvegarde suivante). */
  let labName = "";
  let session!: Tim3Session;
  let screen!: PlayScreen;
  let dialog: DialogHandle | null = null;
  let helpView: HTMLElement | null = null;
  let tabHidden = false;
  const scheduler = new TickScheduler(STEP_MS, MAX_CATCH_UP);

  const tip = h("div", { class: "tim3-tip", role: "tooltip", hidden: true });
  shell.stage.append(tip);
  const live = h("p", { class: "tim3-sr", "aria-live": "polite" });
  shell.stage.append(live);

  // Démarrer, indices, options (guitare) et aide (livre, « ? ») sont dans la barre d'outils du jeu : seul le choix du puzzle reste ici.
  const puzzlesButton = actionButton(copy.puzzles, copy.puzzlesLabel, () => openChooser());
  shell.toggles.append(h("span", { class: "tim3-actions" }, puzzlesButton));

  const announce = (text: string): void => {
    live.textContent = text;
  };

  const music = (id: number): void => {
    if (musicOn) sound.enterPuzzle(id);
    else {
      sound.enterPuzzle(0);
    }
  };

  const playScreen = (level: Level, goal: string, hints: string[]): void => {
    screen = new PlayScreen(session, assets, level, { goal, hints, parts: texts.parts }, toolbar, onEvent);
    screen.solved = current !== null && progress.isSolved(current.name);
    if (options.debug) (window as unknown as { __tim3: unknown }).__tim3 = { session: () => session, screen: () => screen, index };
  };

  /**
   * Garde l'état d'édition (D11) : l'aire du puzzle ou du Labo, jamais en pleine marche (l'état gardé est alors celui d'avant
   * « Démarrer »). Un puzzle auquel on n'a rien posé n'a rien à garder. Une erreur ne doit jamais gêner le jeu.
   */
  const persistEdit = (): void => {
    if (!session || session.running) return;
    try {
      if (current && baseLevel) {
        const parts = snapshotWorld(session.world, baseLevel);
        if (parts && parts.placed.length > 0) edits.savePuzzle(current.name, parts);
        else edits.clearPuzzle(current.name);
      } else if (session.lab) {
        const machine = snapshotLab(session.world, session.lab);
        if (machine) edits.saveLab(machine);
      }
    } catch (error) {
      console.error(error);
    }
  };

  /** Ouvre un puzzle : l'aire qu'on y avait laissée, ou (`solution`, ampoule) la solution du concepteur posée. */
  const loadPuzzle = (ref: PuzzleRef, solution = false): void => {
    persistEdit();
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
      return;
    }
    progress.last = ref.name;
    music(level.info.music);
    sound.playVoice(goalVoice(ref.index));
    announce(`${copy.categories[ref.category]} ${ref.number} : ${t?.title ?? ""}. ${t?.goal ?? ""}`);
  };

  /** Ouvre le Labo : la machine donnée (emplacement chargé) ou, sans elle, celle qu'on y avait laissée. `false` si elle est illisible. */
  const openLab = (machine: LabMachine | null = edits.lab()): boolean => {
    persistEdit();
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

  const fillLabBin = (): void => {
    if (!session.lab) return;
    const present = new Set(session.editor.binParts().map((p) => p.type));
    for (const t of Editor.labTypes(session.world)) if (!present.has(t)) createPart(session.world, t);
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
    } else {
      tip.hidden = true;
      persistEdit();
      session.start();
      screen.resetFocus();
      scheduler.resync();
    }
  };

  const showHint = (): void => {
    if (session.running) return;
    if (screen.hintCount === 0) {
      pauseFor(messageDialog(itfHost(), copy.noHints, resume));
      return;
    }
    const i = screen.nextHint();
    sound.stopVoice();
    if (i >= 0 && current) {
      const ref = hintVoice(i + 1, current.index);
      if (ref) sound.playVoice(ref);
      announce(screen.texts.hints.filter((x) => x !== "")[i] ?? "");
    } else announce(screen.texts.goal);
  };

  const solved = (): void => {
    sound.stopEffects();
    screen.session = session;
    screen.resetFocus();
    if (!current) return;
    const ref = current;
    progress.markSolved(ref.name);
    screen.solved = true;
    const inCategory = puzzles.filter((p) => p.category === ref.category).map((p) => p.name);
    let extra: string | undefined;
    if (progress.count(puzzles.map((p) => p.name)) === puzzles.length) extra = congratulations[5];
    else if (progress.count(inCategory) === inCategory.length) extra = congratulations[ref.category];
    const next = progress.next(ref.name);
    // PUZZSOLV (4260f0) ; le son 0xE21 part 18 pas après l'ouverture (426213). « Rejouer la Solution » relance la machine du
    // joueur : à la victoire, la session est revenue à l'état d'avant « Démarrer » (`Tim3Session.tick` → `stop`).
    const openSolved = (): void => {
      const fanfare = window.setTimeout(() => sound.playEffect(SOUND_SOLVED), SOLVED_SOUND_STEPS * STEP_MS);
      pauseFor(
        solvedDialog(itfHost(), {
          hasNext: next !== null,
          canReplay: true,
          same: () => undefined,
          replay: () => {
            if (!session.running) toggleRun();
          },
          next: () => next && loadPuzzle(next),
          onClose: () => {
            window.clearTimeout(fanfare);
            resume();
          },
        }),
      );
    };
    // Fin de catégorie (BINSOLVE.RES) : la fenêtre BINSOLVE.ITF n'est pas encore dessinée, son texte passe par GENERIC d'abord.
    if (extra) pauseFor(messageDialog(itfHost(), extra, openSolved));
    else openSolved();
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
        if (current && !session.running) sound.playVoice(goalVoice(current.index));
        break;
      case "program":
        openProgram(e.part);
        break;
      case "info":
        pauseFor(partInfoDialog(shell.main, texts.parts.find((p) => p.id === e.partType), resume));
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
    }
  };

  /** Clic sur un bouton de la barre du haut (418ded, `ui/toolbar.ts`) : confirmation d'origine d'abord s'il y en a une. */
  const toolbarAction = (name: string): void => {
    const lab = session.lab !== null;
    const fieldEmpty = session.world.statics.head === null && session.world.mobiles.head === null;
    const decision = toolbarDecision(name, { lab, solved: screen.solved, running: session.running, fieldEmpty });
    if (decision.confirm === undefined) return runToolbar(decision.action);
    pauseFor(confirmDialog(itfHost(), interfaceText(interfaceLines, decision.confirm), () => runToolbar(decision.action), resume));
  };

  const runToolbar = (action: ToolbarAction): void => {
    switch (action) {
      case "none":
        return;
      case "play": {
        if (session.running) toggleRun();
        const ref = puzzles.find((p) => p.name === (current?.name ?? progress.last)) ?? puzzles[0]!;
        return loadPuzzle(ref);
      }
      case "lab":
        if (session.running) toggleRun();
        return void openLab();
      case "machines":
        return openMachines();
      case "options":
        return openOptions();
      case "globals":
        if (session.lab) return openLabSettings();
        return pauseFor(messageDialog(itfHost(), copy.labOnly, resume));
      case "clear":
        if (session.running) return;
        session.editor.clearField();
        screen.resetFocus();
        fillLabBin();
        persistEdit();
        return announce(copy.fieldCleared);
      case "help":
        return openHelp();
      case "hints":
        return showHint();
      case "solution":
        if (current && !session.running) loadPuzzle(current, true);
        return;
      case "run":
        return toggleRun();
      case "unavailable":
        return pauseFor(messageDialog(itfHost(), copy.notAvailable, resume));
    }
  };

  /** Poignée « programmer » (42ea57 : son 0xC40, puis 4249f8). */
  const openProgram = (part: Part): void => {
    if (session.running) return;
    const program = session.editor.program(part, programRows);
    const info = texts.parts.find((p) => p.id === part.type);
    if (!program) {
      pauseFor(partInfoDialog(shell.main, info, resume));
      return;
    }
    sound.playEffect(SOUND_PROGRAM);
    const line = (id: number): string => interfaceText(interfaceLines, id);
    pauseFor(
      programDialog(shell.main, {
        title: info?.name ?? copy.partInfoTitle,
        program,
        texts: {
          done: line(PROGRAM_TEXT.done),
          mass: line(PROGRAM_TEXT.mass),
          elasticity: line(PROGRAM_TEXT.elasticity),
          density: line(PROGRAM_TEXT.density),
          friction: line(PROGRAM_TEXT.friction),
          box: line(PROGRAM_TEXT.box),
          balloon: line(PROGRAM_TEXT.balloon),
        },
        preview: programPreview,
        changed: () => sound.playEffect(SOUND_PLACE),
        onClose: resume,
      }),
    );
  };

  /** Aperçu d'un choix : première image de l'état de `PROGPART.ANM`, à la palette du jeu. */
  const programPreview = (state: number): HTMLCanvasElement | null => {
    const anm = assets.anm("PROGPART.ANM");
    if (!anm) return null;
    const image = stateImage(anm, state);
    const f = image >= 0 ? imageFrame(anm, image) : null;
    if (!f || f.width <= 0 || f.height <= 0) return null;
    const surface = new Surface(f.width, f.height);
    drawAnmImage(surface, assets, anm, image, -f.x, -f.y);
    const canvas = h("canvas", { width: f.width, height: f.height, style: `--w: ${f.width}` });
    const c2d = canvas.getContext("2d");
    if (!c2d) return null;
    const data = c2d.createImageData(f.width, f.height);
    surface.toRgba(assets.gameLut(), new Uint32Array(data.data.buffer));
    c2d.putImageData(data, 0, 0);
    return canvas;
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
  const itfHost = (): ItfHost => ({ main: shell.main, canvas: shell.canvas, assets });

  const pauseFor = (handle: DialogHandle): void => {
    dialog?.close();
    dialog = handle;
    tip.hidden = true;
    screen.cancelGesture();
    applyPause();
  };
  const resume = (): void => {
    dialog = null;
    applyPause();
    persistEdit();
  };

  const openChooser = (): void =>
    pauseFor(
      puzzleChooser(shell.main, {
        progress,
        titles: texts.levels,
        current: current?.name ?? null,
        pick: (p) => loadPuzzle(p),
        lab: () => void openLab(),
        onClose: resume,
      }),
    );

  const openOptions = (): void =>
    pauseFor(
      optionsDialog(shell.main, {
        voices: sound.voicesEnabled,
        music: musicOn,
        setVoices: (on) => {
          sound.voicesEnabled = on;
          if (!on) sound.stopVoice();
        },
        setMusic: (on) => {
          musicOn = on;
          storage.set(MUSIC_KEY, on ? "1" : "0");
          if (on) sound.playMusic(session.music);
          else sound.stopMusic();
        },
        onClose: resume,
      }),
    );

  const dateOf = (savedAt: number): string => new Date(savedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const saveMessage = (outcome: SaveOutcome, name: string): string => {
    switch (outcome) {
      case "saved":
        return copy.machineSaved(name);
      case "noName":
        return copy.machineNoName;
      case "empty":
        return copy.machineNothing;
      case "occupied":
        return copy.machineOccupied;
      case "failed":
        return copy.machineFailed;
    }
  };

  /** Bouton disque : les dix emplacements de machines (Sauvegarder au Labo seulement, Charger partout). */
  const openMachines = (): void => {
    if (session.running) return;
    pauseFor(
      machinesDialog(shell.main, {
        canSave: session.lab !== null,
        name: labName,
        rows: () =>
          Array.from({ length: SLOT_COUNT }, (_, i) => {
            const stored = slots.read(i + 1);
            return { slot: i + 1, name: stored?.save.name ?? null, date: stored ? dateOf(stored.savedAt) : "" };
          }),
        save: (slot, name, replace) => {
          const machine = session.lab ? snapshotLab(session.world, session.lab) : null;
          const outcome = machine ? saveMachine(slots, slot, name, machine, Date.now(), replace) : "failed";
          const clean = cleanName(name) ?? "";
          if (outcome === "saved") labName = clean;
          return { ok: outcome === "saved", occupied: outcome === "occupied", message: saveMessage(outcome, clean) };
        },
        load: (slot) => {
          const loaded = loadMachine(slots, slot);
          if (loaded.status !== "loaded") return { ok: false, message: copy.machineUnreadable };
          const apply = (): void => {
            if (openLab(loaded.machine)) {
              labName = loaded.name;
              announce(copy.machineLoaded(loaded.name));
            } else {
              pauseFor(messageDialog(itfHost(), copy.machineLoadFailed, resume));
            }
          };
          // La fenêtre se ferme après ce retour ; la machine remplace l'aire du Labo (après confirmation s'il y avait du travail).
          const worked = session.lab !== null && (session.world.statics.head !== null || session.world.mobiles.head !== null);
          queueMicrotask(() => (worked ? pauseFor(confirmDialog(itfHost(), copy.clearConfirm, apply, resume)) : apply()));
          return { ok: true, message: copy.machineLoaded(loaded.name) };
        },
        erase: (slot) => {
          slots.clear(slot);
          return copy.machineErased(slot);
        },
        onClose: resume,
      }),
    );
  };

  const openLabSettings = (): void => {
    if (!session.lab || session.running) return;
    pauseFor(
      labDialog(shell.main, {
        settings: session.lab,
        music: texts.music.filter((m) => m.id >= 1000 && m.id <= 1023),
        change: (s) => {
          session.setLab(s);
          if (s.music !== undefined && musicOn) sound.playMusic(s.music);
        },
        onClose: resume,
      }),
    );
  };

  const openHelp = (): void => {
    if (helpView) return;
    const close = (): void => {
      helpView?.remove();
      helpView = null;
      applyPause();
      shell.focusCanvas();
    };
    helpView = h("div", { class: "tim3-help-overlay", role: "dialog", "aria-modal": "true", "aria-label": copy.help }, renderHelp(close, copy.helpResume));
    shell.main.append(helpView);
    screen.cancelGesture();
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
    // Les boutons sont recalculés à chaque appel : on les compare par nom.
    const target = slot ?? button?.name ?? null;
    if (target === tipSlot) return;
    tipSlot = target;
    window.clearTimeout(tipTimer);
    tip.hidden = true;
    if (session.editor.held) return;
    if (slot) tipTimer = window.setTimeout(() => showTip(slot.type, slot), TIP_DELAY_MS);
    if (button) tipTimer = window.setTimeout(() => showButtonTip(button), TIP_DELAY_MS);
  };

  const unbindPointer = bindCanvasPointer(
    shell.canvas,
    { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
    {
      move: (x, y, event) => {
        if (paused) return;
        const touch = event?.pointerType === "touch";
        screen.pointerMove(x, y, touch);
        if (!touch) hoverTip(x, y);
      },
      down: (button, x, y, event) => {
        if (paused || button !== 0) return;
        audio.unlock();
        window.clearTimeout(tipTimer);
        tip.hidden = true;
        screen.pointerDown(x, y, event.pointerType === "touch");
      },
      up: (button, x, y) => {
        if (paused || button !== 0) return;
        screen.pointerUp(x, y);
        persistEdit();
      },
      leave: () => {
        screen.pointerLeave();
        window.clearTimeout(tipTimer);
        tipSlot = null;
        if (!session.editor.held) tip.hidden = true;
      },
      longPress: (x, y) => {
        if (!paused) screen.longPress(x, y);
      },
    },
    { onGesture: () => audio.unlock() },
  );
  const unbindKeys = bindKeyboard(
    shell.canvas,
    {
      keyDown: (event) => {
        if (paused || event.ctrlKey || event.metaKey || event.altKey) return false;
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
  const first = puzzles.find((p) => p.name === (options.puzzle ?? progress.last)) ?? puzzles[0]!;
  loadPuzzle(first);

  const ctx = shell.canvas.getContext("2d")!;
  const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  const pixels = new Uint32Array(image.data.buffer);
  const lut = assets.gameLut();
  let lastCursor = "";

  shell.start({
    sound: { prefs: new SoundPrefs(store, audio, GAME_ID), storageKey: soundPrefKey(GAME_ID), unlock: () => audio.unlock() },
    onPause: (hidden) => {
      tabHidden = hidden;
      if (hidden) persistEdit();
      if (hidden) screen.cancelGesture();
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
      if (paused) return;
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
