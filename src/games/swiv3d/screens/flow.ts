/**
 * Enchaînement des écrans de SWIV 3D (docs/swiv3d/screens.md §2-§5, §9) : démarrage, sélection du pilote, menu principal, réglages,
 * crédits, script des missions (briefing, niveau, fin de mission), game over. Machine à états pure : l'application lui donne le temps et
 * les entrées, lit `view` pour savoir quoi afficher et réalise les effets demandés par `FlowHost` (son, musique, niveau).
 *
 * Entrées de menu gardées : Sélection / Nouveau / Suppression de pilote (nom de 15 caractères, 10 pilotes), Commencer, Continuer,
 * Rejouer la mission, Installer (commandes en lecture seule, volumes, langue français / anglais, préférence musicale), Revoir l'intro,
 * Crédits, Nouveau joueur, Quitter (retour au site). Abandonnées : gamma (la table de gamma n'est pas portée), taille de l'écran et
 * niveau de détail (rendu à taille fixe), multi-joueur (hors périmètre), mode test des niveaux et commandes de débogage (le code
 * `SWIV!AndLetDie`), types de contrôleur DirectInput / Gravis / Creative et brouillard 3Dfx (sans objet dans un navigateur).
 * Écarts assumés : titre 3D remplacé par le bandeau de texte ; suppression d'un pilote avec confirmation ; « Non » sélectionné d'office à
 * l'abandon ; une vidéo interrompue passe aussi l'attente qui la suit ; les attentes du démarrage se passent d'une touche.
 */
import type { MusicContext, MusicPreference } from "../audio";
import { MUSIC_PREFERENCES } from "../audio";
import { copy } from "../copy";
import { END_MISSION, type MissionScript } from "../data/missions";
import type { StringTables } from "../data/strings";
import { BootSequence } from "./boot";
import { Menu, standardLines, type MenuEvent, type MenuKey, type MenuLine } from "./menu";
import { MissionScriptRunner, replayableMissions, type MissionVars } from "./mission-script";
import {
  ADVENTURE_COMPLETED,
  LANGUAGES,
  NAME_MAX,
  PILOT_LIMIT,
  isNameChar,
  type GlobalSettings,
  type Language,
  type Pilot,
  type PilotStore,
  type Volumes,
} from "./pilots";
import type { TextRenderer } from "./text";

/** Touches de l'interface (clavier, manette, doigt) : une entrée par appui, répétition automatique comprise. */
export type UiKey = MenuKey | "backspace";

export interface UiInput {
  keys: UiKey[];
  /** Caractères saisis (nom du pilote). */
  chars: string[];
  /** Appuis de souris / doigt, repère 320×400. */
  taps: { x: number; y: number }[];
  /** Une touche, un clic ou un appui a eu lieu (`DAT_00480aa0`). */
  pressed: boolean;
}

export const NO_INPUT: UiInput = { keys: [], chars: [], taps: [], pressed: false };

export type LevelOutcome = "complete" | "gameOver";

export interface LevelStats {
  /** Durée de jeu du niveau, en secondes. */
  seconds?: number;
}

export interface LevelRequest {
  name: string;
  mission: number;
  vars: MissionVars;
  tracks: readonly number[];
  pilot: Pilot;
}

/** Ce que le flux demande à l'application. */
export interface FlowHost {
  /** Son d'interface (6002 déplacement, 6003 validation, 6004 curseur). */
  sound(sound: number): void;
  music(context: MusicContext): void;
  musicPreference(preference: MusicPreference): void;
  volumes(volumes: Volumes): void;
  /** Charge et démarre le niveau ; l'application rappelle `levelEnded`, `abortRequested` ou `levelFailed`. */
  startLevel(request: LevelRequest): void;
  /** Libère le niveau en cours. */
  endLevel(): void;
  pauseLevel(paused: boolean): void;
  /** Le fichier du niveau existe-t-il ? */
  hasLevel(name: string): boolean;
  /** « Quitter » : retour à l'accueil du site. */
  leave(): void;
  /** Saisie d'un nom sur écran tactile (sans clavier physique) ; `null` : annulé. */
  askName?(current: string): string | null;
}

export interface FlowData {
  strings: StringTables;
  script: MissionScript;
  text: TextRenderer;
  store: PilotStore;
  /** Libellé de la touche liée à une action (`DEFAULT_KEYS`), pour l'écran des commandes. */
  bindingLabel(action: string, language: Language): string;
}

/** Ce qui est affiché ; l'objet change à chaque changement d'écran. */
export type FlowView =
  | { kind: "none" }
  | { kind: "video"; name: string; mission: number; overlay: boolean }
  /** Dernière image de la vidéo précédente. */
  | { kind: "hold" }
  | { kind: "screen"; id: number }
  | { kind: "menu"; menu: Menu; backdrop: "demo" | "frozen" }
  | { kind: "level" };

/** Touches ignorées au début des écrans de fin de mission (110 images à 60 Hz environ, §9). */
export const END_SCREEN_GUARD_MS = 1500;
/** Crédits : 1003, 1002, 1001 (§4.5). */
const CREDITS_SCREENS = [1003, 1002, 1001];

const SOUND = { move: 6002, validate: 6003, slider: 6004 } as const;

/** Équivalents de `sprintf` utilisés par les chaînes du jeu : `%d`, `%02d`, `%s`, `%%`. */
export function format(template: string, ...args: (string | number)[]): string {
  let next = 0;
  return template.replace(/%(%|0?(\d*)d|s)/g, (_m, kind: string, width: string | undefined) => {
    if (kind === "%") return "%";
    const value = args[next++] ?? "";
    if (kind === "s") return String(value);
    return String(value).padStart(width ? Number(width) : 0, "0");
  });
}

type Phase =
  | { kind: "boot"; seq: BootSequence; replay: boolean }
  | { kind: "menu"; menu: Menu; backdrop: "demo" | "frozen"; choose(id: number): void; cancel(): void; adjust?(id: number, value: number): void }
  | { kind: "name"; menu: Menu; name: string }
  | { kind: "credits"; index: number }
  | { kind: "video"; mission: number }
  | { kind: "level" }
  | { kind: "end"; outcome: LevelOutcome; since: number; menu: Menu }
  | { kind: "idle" };

export class Flow {
  view: FlowView = { kind: "none" };
  private phase: Phase = { kind: "idle" };
  private now = 0;
  private lastNow = 0;
  private settings: GlobalSettings;
  private pilot: Pilot | null = null;
  private runner: MissionScriptRunner | null = null;
  private quitCount = 0;
  /** Mission en cours (nom du niveau terminé, écran de fin). */
  private missionIndex = 0;

  /** `boot` : jouer la séquence de démarrage ; sinon, directement la sélection du pilote. */
  constructor(
    private readonly data: FlowData,
    private readonly host: FlowHost,
    boot = true,
  ) {
    this.settings = data.store.loadGlobal();
    this.host.volumes(this.settings.volumes);
    if (boot) this.startBoot(false);
    else this.pilotSelect();
  }

  get language(): Language {
    return this.pilot?.language ?? this.settings.language;
  }

  get currentPilot(): Pilot | null {
    return this.pilot;
  }

  /** Nom de l'écran en cours (tests, page de dev). */
  get phaseName(): string {
    return this.phase.kind;
  }

  // --- Entrées de l'application ---------------------------------------------------------------------------

  /** Une image : `now` en ms (horloge d'image du navigateur). */
  update(now: number, input: UiInput): void {
    // Pas de plafond : les attentes du démarrage (3,5 s) se comptent en temps réel, même à faible cadence d'images.
    const dt = this.lastNow === 0 ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    this.now = now;
    const phase = this.phase;
    switch (phase.kind) {
      case "boot":
        if (input.pressed) phase.seq.skip();
        phase.seq.update(dt);
        this.syncBoot(phase);
        break;
      case "menu":
        phase.menu.tick();
        this.driveMenu(phase, input);
        break;
      case "name":
        phase.menu.tick();
        this.driveName(phase, input);
        break;
      case "credits":
        if (input.pressed) this.nextCredits(phase);
        break;
      case "end":
        phase.menu.tick();
        if (input.pressed && now - phase.since >= END_SCREEN_GUARD_MS) this.finishEnd(phase);
        break;
      default:
        break;
    }
  }

  /** La vidéo affichée est terminée ou interrompue. */
  videoEnded(skipped: boolean): void {
    const phase = this.phase;
    if (phase.kind === "boot") {
      phase.seq.videoEnded(skipped);
      this.syncBoot(phase);
    } else if (phase.kind === "video") this.advanceScript();
  }

  /** Le niveau est fini : mission accomplie ou game over. */
  levelEnded(outcome: LevelOutcome, stats: LevelStats = {}): void {
    if (this.phase.kind !== "level") return;
    const pilot = this.pilot;
    if (pilot && stats.seconds) {
      pilot.playSeconds += Math.round(stats.seconds);
      this.data.store.save(pilot);
    }
    const lines = this.endLines(outcome, stats.seconds);
    const menu = this.makeMenu(standardLines(this.endBanner(outcome), lines), { y: "center", noCancel: true });
    this.phase = { kind: "end", outcome, since: this.now, menu };
    this.view = { kind: "menu", menu, backdrop: "frozen" };
  }

  /** Page de dev : joue un niveau tout de suite, sans menus ni script (à la fin, retour à la sélection du pilote). */
  playLevelDirect(name: string, pilot: Pilot): void {
    this.pilot = pilot;
    this.runner = null;
    this.missionIndex = Math.max(0, this.data.script.missions.find((m) => m.level === name)?.index ?? 0);
    this.phase = { kind: "level" };
    this.view = { kind: "level" };
    this.host.startLevel({ name, mission: this.missionIndex, vars: new Map(), tracks: [], pilot });
  }

  /** Échap pendant le niveau : demande de confirmation (§4.8). */
  abortRequested(): void {
    if (this.phase.kind !== "level") return;
    this.host.pauseLevel(true);
    const resume = (): void => {
      this.host.pauseLevel(false);
      this.phase = { kind: "level" };
      this.view = { kind: "level" };
    };
    this.showMenu({
      banner: [this.s(13, 1)],
      body: [
        { type: "choice", id: 1, text: this.s(13, 10) },
        { type: "choice", id: 2, text: this.s(13, 11) },
      ],
      backdrop: "frozen",
      // « Non » d'office : un Entrée de trop ne doit pas faire perdre la mission (l'original sélectionne « Oui »).
      initial: 2,
      choose: (id) => {
        if (id === 1) this.leaveLevelToMenu();
        else resume();
      },
      cancel: resume,
    });
  }

  /** Le niveau n'a pas pu être chargé : retour au menu (comme le chargement raté de l'élément `300`). */
  levelFailed(): void {
    this.host.endLevel();
    this.leaveLevelToMenu();
  }

  // --- Démarrage ----------------------------------------------------------------------------------------------

  private startBoot(replay: boolean): void {
    this.host.music("silent");
    const seq = new BootSequence(!replay);
    this.phase = { kind: "boot", seq, replay };
    this.syncBoot(this.phase);
  }

  /** Aligne `view` sur l'étape de la séquence ; à la fin, menus. */
  private syncBoot(phase: Extract<Phase, { kind: "boot" }>): void {
    const step = phase.seq.step;
    if (!step) {
      if (phase.replay) {
        this.host.music("menu");
        this.mainMenu();
      } else this.pilotSelect();
      return;
    }
    const previous = this.view;
    if (step.kind === "video") {
      if (previous.kind !== "video" || previous.name !== step.name) this.view = { kind: "video", name: step.name, mission: 0, overlay: false };
    } else if (step.screen !== undefined) {
      if (previous.kind !== "screen" || previous.id !== step.screen) this.view = { kind: "screen", id: step.screen };
    } else if (previous.kind !== "hold") this.view = { kind: "hold" };
  }

  // --- Menus ----------------------------------------------------------------------------------------------

  private s(table: number, id: number): string {
    return this.data.strings.get(this.language, table, id) ?? "";
  }

  private makeMenu(lines: MenuLine[], options: ConstructorParameters<typeof Menu>[1]): Menu {
    return new Menu(lines, options, this.data.text);
  }

  private showMenu(options: {
    banner: string[];
    body: MenuLine[];
    backdrop?: "demo" | "frozen";
    initial?: number;
    noCancel?: boolean;
    choose(id: number): void;
    cancel?(): void;
    adjust?(id: number, value: number): void;
  }): Menu {
    const menu = this.makeMenu(standardLines(options.banner, options.body), { y: "center", noCancel: options.noCancel, initial: options.initial });
    const backdrop = options.backdrop ?? "demo";
    this.phase = { kind: "menu", menu, backdrop, choose: options.choose, cancel: options.cancel ?? (() => {}), adjust: options.adjust };
    this.view = { kind: "menu", menu, backdrop };
    return menu;
  }

  private driveMenu(phase: Extract<Phase, { kind: "menu" }>, input: UiInput): void {
    // Chaque entrée est traitée avant la suivante : deux appuis dans la même image règlent deux fois un curseur.
    const inputs: (() => MenuEvent | null)[] = [];
    for (const key of input.keys) if (key !== "backspace") inputs.push(() => phase.menu.press(key));
    for (const tap of input.taps) inputs.push(() => phase.menu.tap(tap.x, tap.y));
    for (const next of inputs) {
      // Un événement a pu changer d'écran : les suivants ne concernent plus ce menu.
      if (this.phase !== phase) return;
      const event = next();
      if (event) this.handle(phase, event);
    }
  }

  private handle(phase: Extract<Phase, { kind: "menu" }>, event: MenuEvent): void {
    switch (event.kind) {
      case "moved":
        this.host.sound(SOUND.move);
        break;
      case "chosen":
        this.host.sound(SOUND.validate);
        phase.choose(event.id);
        break;
      case "cancelled":
        this.host.sound(SOUND.validate);
        phase.cancel();
        break;
      case "adjusted":
        this.host.sound(SOUND.slider);
        phase.adjust?.(event.id, event.value);
        break;
    }
  }

  // --- Sélection du pilote, nom, suppression ------------------------------------------------------------------------

  private pilotSelect(): void {
    this.pilot = null;
    this.runner = null;
    this.host.music("menu");
    const pilots = this.data.store.list();
    const body: MenuLine[] = [];
    if (pilots.length < PILOT_LIMIT) body.push({ type: "choice", id: 0, text: this.s(0, 10) });
    if (pilots.length > 0) body.push({ type: "choice", id: 1, text: this.s(0, 11) });
    for (const p of pilots) body.push({ type: "choice", id: 100 + p.slot, text: p.name });
    const last = this.settings.lastPilot;
    const initial = last !== null && pilots.some((p) => p.slot === last) ? 100 + last : pilots.length > 0 ? 100 + pilots[0]!.slot : 0;
    this.showMenu({
      banner: [this.s(0, 1)],
      body,
      initial,
      noCancel: true,
      choose: (id) => {
        if (id === 0) this.newPilot();
        else if (id === 1) this.deletePilot();
        else this.selectPilot(id - 100);
      },
    });
  }

  private selectPilot(slot: number): void {
    const pilot = this.data.store.get(slot);
    if (!pilot) return this.pilotSelect();
    this.pilot = pilot;
    this.settings.lastPilot = slot;
    this.settings.language = pilot.language;
    this.data.store.saveGlobal(this.settings);
    this.host.musicPreference(MUSIC_PREFERENCES[pilot.music]!);
    this.mainMenu();
  }

  private newPilot(): void {
    const menu = this.makeMenu(standardLines([this.s(0, 51)], this.nameLines("")), { y: "center", noCancel: false });
    this.phase = { kind: "name", menu, name: "" };
    this.view = { kind: "menu", menu, backdrop: "demo" };
  }

  private nameLines(name: string): MenuLine[] {
    return [{ type: "text", text: format(this.s(0, 52), name) }];
  }

  private driveName(phase: Extract<Phase, { kind: "name" }>, input: UiInput): void {
    let name = phase.name;
    for (const key of input.keys) {
      if (key === "escape") {
        this.host.sound(SOUND.validate);
        return this.pilotSelect();
      }
      if (key === "backspace") name = [...name].slice(0, -1).join("");
      else if (key === "enter" && name.trim() !== "") return this.createPilot(name);
    }
    for (const ch of input.chars) if ([...name].length < NAME_MAX && isNameChar(ch)) name += ch;
    // Écran tactile : un appui ouvre la saisie du navigateur.
    if (input.taps.length > 0 && this.host.askName) {
      const typed = this.host.askName(name);
      if (typed !== null) {
        const clean = [...typed].filter(isNameChar).join("").slice(0, NAME_MAX);
        if (clean.trim() !== "") return this.createPilot(clean);
      }
    }
    if (name !== phase.name) {
      phase.name = name;
      phase.menu.setLines(standardLines([this.s(0, 51)], this.nameLines(name)));
    }
  }

  private createPilot(name: string): void {
    const pilot = this.data.store.create(name, this.settings.language, 0);
    this.host.sound(SOUND.validate);
    if (!pilot) return this.pilotSelect();
    this.selectPilot(pilot.slot);
  }

  private deletePilot(): void {
    const pilots = this.data.store.list();
    this.showMenu({
      banner: [this.s(0, 61)],
      body: pilots.map((p): MenuLine => ({ type: "choice", id: p.slot, text: p.name })),
      choose: (slot) => this.confirmDelete(slot),
      cancel: () => this.pilotSelect(),
    });
  }

  /** Confirmation avant d'effacer (l'original efface sans demander : ici la sauvegarde du navigateur est la seule copie). */
  private confirmDelete(slot: number): void {
    const pilot = this.data.store.get(slot);
    if (!pilot) return this.pilotSelect();
    this.showMenu({
      banner: [this.s(0, 60), pilot.name],
      body: [
        { type: "choice", id: 1, text: this.s(0, 101) },
        { type: "choice", id: 0, text: this.s(0, 100) },
      ],
      choose: (id) => {
        if (id === 0) {
          this.data.store.remove(slot);
          if (this.settings.lastPilot === slot) this.settings.lastPilot = null;
          this.data.store.saveGlobal(this.settings);
        }
        this.pilotSelect();
      },
      cancel: () => this.deletePilot(),
    });
  }

  // --- Menu principal -------------------------------------------------------------------------------------------

  private mainMenu(initial?: number): void {
    const pilot = this.pilot;
    if (!pilot) return this.pilotSelect();
    const completed = pilot.bestMission === ADVENTURE_COMPLETED;
    const started = pilot.bestMission > 0;
    const body: MenuLine[] = [];
    if (!started) body.push({ type: "choice", id: 10, text: this.s(1, 10) });
    else {
      if (!completed) body.push({ type: "choice", id: 20, text: this.s(1, 11) });
      body.push({ type: "choice", id: 30, text: this.s(1, 12) });
    }
    body.push(
      { type: "choice", id: 40, text: this.s(1, 13) },
      { type: "choice", id: 50, text: this.s(1, 14) },
      { type: "choice", id: 60, text: this.s(1, 15) },
      { type: "choice", id: 70, text: this.s(1, 18) },
      { type: "choice", id: 80, text: this.s(1, 19) },
    );
    this.showMenu({
      banner: [format(this.s(1, 1), pilot.name)],
      body,
      initial,
      noCancel: true,
      choose: (id) => {
        switch (id) {
          case 10:
            return this.runScript(undefined);
          case 20:
            return this.runScript(pilot.bestMission);
          case 30:
            return this.retryMenu();
          case 40:
            return this.setupMenu();
          case 50:
            return this.startBoot(true);
          case 60:
            return this.startCredits();
          case 70:
            return this.pilotSelect();
          case 80:
            return this.quitMenu();
        }
      },
    });
  }

  private retryMenu(): void {
    const pilot = this.pilot!;
    const missions = replayableMissions(this.data.script, pilot.bestMission, pilot.bestMission === ADVENTURE_COMPLETED, (level) => this.host.hasLevel(level));
    const best = missions.includes(pilot.bestMission) ? pilot.bestMission : missions[missions.length - 1];
    this.showMenu({
      banner: [this.s(1, 12)],
      body: missions.map((n): MenuLine => ({ type: "choice", id: n, text: this.s(200, n) })),
      initial: best,
      choose: (n) => this.runScript(n),
      cancel: () => this.mainMenu(30),
    });
  }

  private quitMenu(): void {
    const phrase = this.s(13, 30 + (this.quitCount++ & 3));
    this.showMenu({
      banner: [this.s(13, 20)],
      body: [
        ...phrase.split("|").map((text): MenuLine => ({ type: "text", text })),
        { type: "choice", id: 1, text: this.s(13, 11) },
        { type: "choice", id: 0, text: this.s(13, 10) },
      ],
      choose: (id) => {
        if (id === 0) this.host.leave();
        else this.mainMenu(80);
      },
      cancel: () => this.mainMenu(80),
    });
  }

  // --- Réglages -----------------------------------------------------------------------------------------------------

  private setupMenu(initial = 10): void {
    this.showMenu({
      banner: [this.s(2, 0)],
      body: [10, 11, 12, 14].map((id): MenuLine => ({ type: "choice", id, text: this.s(2, id) })),
      initial,
      choose: (id) => {
        if (id === 10) this.controllerMenu();
        else if (id === 11) this.volumeMenu();
        else if (id === 12) this.languageMenu();
        else this.musicMenu();
      },
      cancel: () => this.mainMenu(40),
    });
  }

  /** Commandes : liste des liaisons (lecture seule, le port ne les fait pas redéfinir). */
  private controllerMenu(): void {
    const language = this.language;
    const rows: [number, string][] = [
      [21, "turnLeft"],
      [22, "turnRight"],
      [24, "forward"],
      [25, "back"],
      [26, "strafeLeft"],
      [27, "strafeRight"],
      [28, "brake"],
      [29, "firePrimary"],
      [30, "fireSpecial"],
      [31, "weaponNext"],
      [32, "weaponPrev"],
    ];
    const back = (): void => this.setupMenu(10);
    this.showMenu({
      banner: [this.s(3, 20)],
      body: rows.map(([id, action]): MenuLine => ({ type: "choice", id, text: format(this.s(3, id), this.data.bindingLabel(action, language)) })),
      choose: back,
      cancel: back,
    });
  }

  private volumeMenu(): void {
    const lines = (): MenuLine[] => {
      const v = this.settings.volumes;
      return [
        { type: "slider", id: 1, text: this.s(8, 10), value: v.master },
        { type: "slider", id: 2, text: this.s(8, 11).trim(), value: v.music },
        { type: "slider", id: 3, text: this.s(8, 12), value: v.effects },
      ];
    };
    const menu = this.showMenu({
      banner: [this.s(8, 1)],
      body: lines(),
      choose: () => this.setupMenu(11),
      cancel: () => this.setupMenu(11),
      adjust: (id, value) => {
        const v = this.settings.volumes;
        if (id === 1) v.master = value;
        else if (id === 2) v.music = value;
        else v.effects = value;
        this.host.volumes(v);
        this.data.store.saveGlobal(this.settings);
        menu.setLines(standardLines([this.s(8, 1)], lines()));
      },
    });
  }

  private languageMenu(): void {
    this.showMenu({
      banner: [this.s(2, 12)],
      body: LANGUAGES.map((l): MenuLine => ({ type: "choice", id: l, text: copy.languageNames[l]! })),
      initial: this.language,
      choose: (id) => {
        const language = id as Language;
        this.settings.language = language;
        if (this.pilot) {
          this.pilot.language = language;
          this.data.store.save(this.pilot);
        }
        this.data.store.saveGlobal(this.settings);
        this.setupMenu(12);
      },
      cancel: () => this.setupMenu(12),
    });
  }

  private musicMenu(): void {
    const pilot = this.pilot!;
    this.showMenu({
      banner: [this.s(9, 1)],
      body: [10, 11, 12].map((id): MenuLine => ({ type: "choice", id, text: this.s(9, id) })),
      initial: 10 + pilot.music,
      choose: (id) => {
        pilot.music = (id - 10) as 0 | 1 | 2;
        this.data.store.save(pilot);
        this.host.musicPreference(MUSIC_PREFERENCES[pilot.music]!);
        this.setupMenu(14);
      },
      cancel: () => this.setupMenu(14),
    });
  }

  // --- Crédits ------------------------------------------------------------------------------------------------------

  private startCredits(): void {
    this.host.music("silent");
    this.phase = { kind: "credits", index: 0 };
    this.view = { kind: "screen", id: CREDITS_SCREENS[0]! };
  }

  private nextCredits(phase: Extract<Phase, { kind: "credits" }>): void {
    phase.index++;
    if (phase.index >= CREDITS_SCREENS.length) {
      this.host.music("menu");
      this.mainMenu(60);
    } else this.view = { kind: "screen", id: CREDITS_SCREENS[phase.index]! };
  }

  // --- Script des missions ------------------------------------------------------------------------------------------

  private runScript(startMission: number | undefined): void {
    this.runner = new MissionScriptRunner(this.data.script, startMission);
    this.advanceScript();
  }

  private advanceScript(): void {
    const runner = this.runner;
    const pilot = this.pilot;
    if (!runner || !pilot) return this.pilotSelect();
    for (;;) {
      const step = runner.next();
      switch (step.kind) {
        case "mission":
          // La meilleure mission est celle qui a été démarrée, pas terminée (§5.2).
          if (step.index !== END_MISSION && pilot.bestMission < step.index) {
            pilot.bestMission = step.index;
            this.data.store.save(pilot);
          }
          continue;
        case "video":
          this.host.music("silent");
          this.phase = { kind: "video", mission: step.mission };
          this.view = { kind: "video", name: step.name, mission: step.mission, overlay: step.name.toUpperCase().startsWith("BR_TER") };
          return;
        case "level":
          this.missionIndex = step.mission;
          this.phase = { kind: "level" };
          this.view = { kind: "level" };
          this.host.startLevel({ name: step.name, mission: step.mission, vars: step.vars, tracks: step.tracks, pilot });
          return;
        case "finished":
          this.runner = null;
          if (step.completed) {
            pilot.bestMission = ADVENTURE_COMPLETED;
            this.data.store.save(pilot);
          }
          this.host.music("menu");
          return this.mainMenu();
      }
    }
  }

  private leaveLevelToMenu(): void {
    this.host.endLevel();
    this.runner = null;
    this.host.music("menu");
    this.mainMenu();
  }

  // --- Fin de mission -----------------------------------------------------------------------------------------------

  private endBanner(outcome: LevelOutcome): string[] {
    const mission = this.missionIndex;
    return outcome === "complete" ? [this.s(7, 0), this.s(200, mission)] : [this.s(7, 1)];
  }

  private endLines(outcome: LevelOutcome, seconds: number | undefined): MenuLine[] {
    const lines: MenuLine[] = [];
    const time = (id: number, total: number): void => {
      lines.push({ type: "text", text: format(this.s(7, id), Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60) });
    };
    if (seconds !== undefined) time(12, Math.round(seconds));
    if (this.pilot && this.pilot.playSeconds > 0) time(13, this.pilot.playSeconds);
    lines.push({ type: "choice", id: 99, text: this.s(4, 1) });
    void outcome;
    return lines;
  }

  private finishEnd(phase: Extract<Phase, { kind: "end" }>): void {
    this.host.sound(SOUND.validate);
    this.host.endLevel();
    if (phase.outcome === "complete") this.advanceScript();
    else {
      this.runner = null;
      this.host.music("menu");
      this.mainMenu();
    }
  }
}
