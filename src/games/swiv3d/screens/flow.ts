/**
 * Enchaînement des écrans de SWIV 3D (docs/swiv3d/screens.md §2-§5, §9) : démarrage, sélection du pilote, menu principal, réglages,
 * crédits, script des missions (briefing, niveau, fin de mission), game over. Machine à états pure : l'application lui donne le temps et
 * les entrées, lit `view` pour savoir quoi afficher et réalise les effets demandés par `FlowHost` (son, musique, niveau).
 *
 * Entrées de menu gardées : Sélection / Nouveau / Suppression de pilote (nom de 15 caractères, 10 pilotes, code `SWIV!AndLetDie`),
 * Commencer, Continuer, Rejouer la mission, Installer (contrôleur : type clavier / souris / manette, liens des touches, axes ; volumes ;
 * langue français / anglais ; correction gamma ; préférence musicale), Revoir l'intro, Crédits, Nouveau joueur, Quitter (retour au site),
 * Entrez le mode test niveau (pilote au code), le Setup en jeu (F1) et, en mission de test, le menu Tricher (F12). Abandonnées : taille de l'écran et niveau
 * de détail (rendu à taille fixe), multi-joueur (hors périmètre), commandes de débogage, calibrage de la manette (la Gamepad API rend des
 * axes déjà calibrés), types de contrôleur DirectInput / Gravis / Creative et brouillard 3Dfx (sans objet dans un navigateur).
 * Écarts assumés : suppression d'un pilote avec confirmation ; « Non » sélectionné d'office à l'abandon ; une vidéo interrompue passe
 * aussi l'attente qui la suit ; les attentes du démarrage se passent d'une touche ; un pilote réglé sur la manette garde son profil
 * même si le navigateur ne voit pas encore de manette (elle n'apparaît qu'après un premier appui).
 */
import type { MusicContext, MusicPreference } from "../audio";
import { MUSIC_PREFERENCES } from "../audio";
import { copy } from "../copy";
import { END_MISSION, type MissionScript } from "../data/missions";
import type { StringTables } from "../data/strings";
import { BootSequence } from "./boot";
import {
  CONTROLLER_TYPES,
  KEY_ROWS,
  clampAxes,
  cycleAxis,
  defaultProfile,
  motionOnKeys,
  usesAxes,
  type ControllerType,
  type Motion,
} from "./controllers";
import { COUNTER, EndCounters } from "./end-screen";
import { Menu, ROW, splitLines, standardLines, type MenuEvent, type MenuKey, type MenuLine } from "../ui-draw/menu";
import { MissionScriptRunner, replayableMissions, stateVars, type MissionVars } from "./mission-script";
import {
  ADVENTURE_COMPLETED,
  AMMO_SLOTS,
  GAMMA_LEVELS,
  LANGUAGES,
  NAME_MAX,
  PILOT_LIMIT,
  isNameChar,
  type GlobalSettings,
  type Language,
  type MissionState,
  type Pilot,
  type PilotStore,
  type Volumes,
} from "./pilots";
import type { TextRenderer } from "../ui-draw/text";

/** Touches de l'interface (clavier, manette, doigt) : une entrée par appui, répétition automatique comprise. */
export type UiKey = MenuKey | "backspace";

export interface UiInput {
  keys: UiKey[];
  /**
   * Saisie du nom du pilote, dans l'ordre de frappe : caractères (`{ char }`) et touches de l'interface mêlés, comme la file de touches
   * de l'original (`00490410`) : « nom + Entrée » dans la même image valide le nom complet.
   */
  typed: (UiKey | { char: string })[];
  /** Appuis de souris / doigt, repère 320×400. */
  taps: { x: number; y: number }[];
  /** Une touche, un clic ou un appui a eu lieu (`DAT_00480aa0`). */
  pressed: boolean;
  /**
   * Codes de l'original des touches et boutons pressés (`DAT_00480aa4` : code de balayage PC, `0x90`.. souris, `0x93`.. manette), sans la
   * répétition automatique : capture d'une touche à lier.
   */
  scans: number[];
}

export const NO_INPUT: UiInput = { keys: [], typed: [], taps: [], pressed: false, scans: [] };

export type LevelOutcome = "complete" | "gameOver";

/** Ce que le niveau rapporte à sa fin : alimente l'écran de fin de mission (`gm_screen_level_complete`) et l'état d'arrivée suivant. */
export interface LevelStats {
  /** Durée de jeu du niveau, en secondes. */
  seconds?: number;
  /** Points gagnés dans le niveau (`+0x110`) et score total du joueur (`+0x108`). */
  levelScore?: number;
  score?: number;
  /** `valeur × 100 / total` en entiers : cibles d'objectif détruites, bonus posés ramassés, bonus largués (« secrets ») ramassés. */
  objectivesPercent?: number;
  bonusPercent?: number;
  secretsPercent?: number;
  /** Nombre de bonus posés / largués du niveau (informatif : l'écran de fin se règle sur les pourcentages non nuls). */
  bonusTotal?: number;
  secretsTotal?: number;
  /** État du joueur à l'arrivée : reporté sur la mission suivante (mission accomplie seulement). */
  state?: MissionState;
  /**
   * Compteur de fin du niveau (`DAT_005b03e8`) quand la boucle de niveau rend la main : 55 ou 35, plus les ticks déjà joués dans la même
   * image. L'écran de fin en repart ; absent ou négatif (fin forcée de la page de dev) : 55 / 35.
   */
  endCounter?: number;
}

export interface LevelRequest {
  name: string;
  mission: number;
  vars: MissionVars;
  tracks: readonly number[];
  pilot: Pilot;
  /** État d'arrivée enregistré pour cette mission (fiche `1000 + n`) : niveau du canon ; `null` pour une partie neuve. */
  state?: MissionState | null;
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
  /** Correction gamma de toutes les palettes, 0 (aucune) à 3 (`DAT_00484644`, `gm_modex_enter`). */
  gamma(level: number): void;
  /** Le périphérique du type de contrôleur est-il là ? (`DAT_0048419c` souris, `DAT_00484198` manette ; le clavier l'est toujours.) */
  hasController(type: ControllerType): boolean;
  /** Menu Tricher (`gm_menu_pickups`) : bonus `n` (`gm_pickup_apply`) ou forme du joueur (`gm_player_set_form`) dans le niveau en cours. */
  cheat(effect: { pickup: number } | { form: number }): void;
  /** Sortie du Setup ouvert en jeu (F1) : le profil de contrôleur du pilote repasse aux commandes du niveau (`gm_player_load_keys`). */
  loadControls(pilot: Pilot): void;
}

export interface FlowData {
  strings: StringTables;
  script: MissionScript;
  text: TextRenderer;
  store: PilotStore;
}

/** Ce qui est affiché ; l'objet change à chaque changement d'écran. */
export type FlowView =
  | { kind: "none" }
  | { kind: "video"; name: string; mission: number; overlay: boolean }
  /** Dernière image de la vidéo précédente. */
  | { kind: "hold" }
  | { kind: "screen"; id: number }
  /**
   * `backdrop` : `demo` = décor de `DEMO.SLV` ; `frozen` = dernière image du niveau (écran d'abandon) ; `level` = le niveau, qui continue de
   * tourner derrière (écran de fin). `title` : titre 3D de l'écran (octets de la chaîne, `|` = saut de ligne, et teinte), `null` s'il
   * n'y en a pas (écrans de fin de mission).
   */
  | { kind: "menu"; menu: Menu; backdrop: "demo" | "frozen" | "level"; title: MenuTitle | null }
  | { kind: "level" };

/** Titre 3D d'un menu : texte et teinte (ligne × 256 de la table de couleurs du bloc 11003). */
export interface MenuTitle {
  text: Uint8Array;
  tint: number;
}

/**
 * Titres 3D des menus (`gm_message_spawn(table, id, teinte, 11)` en tête de chaque menu, `screens.md` § 4.1) : chaîne et teinte de
 * l'exécutable. Les teintes `0x1500`, `0x1400`, `0x1000` et `0x400` sont des lignes différentes de la table de couleurs.
 */
const TITLES = {
  selectPilot: [0, 0, 0x1500],
  newPilot: [0, 50, 0x1400],
  deletePilot: [0, 60, 0x1000],
  main: [1, 0, 0x1000],
  setup: [2, 0, 0x1500],
  language: [2, 100, 0x400],
  controller: [3, 0, 0x400],
  controllerType: [3, 100, 0x1000],
  axes: [3, 1000, 0x500],
  captureKey: [3, 33, 0x1400],
  gamma: [6, 0, 0x100],
  volume: [8, 0, 0x1500],
  music: [9, 0, 0x1500],
  retry: [11, 0, 0x400],
  testMission: [11, 20, 0x400],
  abort: [13, 0, 0x1400],
  quit: [13, 20, 0x1400],
  cheat: [100, 1000, 0x100],
} as const satisfies Record<string, readonly [table: number, id: number, tint: number]>;

/** Crédits : 1003, 1002, 1001 (§4.5). */
const CREDITS_SCREENS = [1003, 1002, 1001];

/**
 * Ordonnée du premier élément des menus (`Y` passé à `gm_menu_run`, `screens.md` § 4 et 9) : contrôleur 100, sélection / suppression du
 * pilote, menu principal, rejouer, type de contrôleur, mission de test et Tricher 110, écran de fin 120, langue 140, nouveau pilote,
 * réglages, gamma et capture d'une touche 160, axes 170.
 */
const MENU_Y = { controller: 100, list: 110, end: 120, language: 140, small: 160, axes: 170 } as const;
const END_MENU_Y = MENU_Y.end;

/** Sons d'interface ; `6000` / `6001` encadrent les menus ouverts en jeu (pause, Tricher : `gm_frame`). */
const SOUND = { open: 6000, close: 6001, move: 6002, validate: 6003, slider: 6004 } as const;

/** Nom qui débloque le mode test (`00480234`) : comparé à la validation du nom, il n'est pas créé (`gm_screen_new_pilot`). */
export const TEST_MODE_CODE = "SWIV!AndLetDie";

/** Lignes du cadre des menus (§4.1) : espaceur de `h` px (voile `0xa1` par défaut), trait de 1 px, bandeaux, choix sur plusieurs lignes. */
const space = (height: number, row: number = ROW.veil): MenuLine => ({ type: "spacer", height, row });
const RULE: MenuLine = { type: "spacer", height: 1, row: ROW.rule };
const bands = (text: string): MenuLine[] => splitLines(text).map((t): MenuLine => ({ type: "title", text: t }));
const choices = (id: number, text: string): MenuLine[] => splitLines(text).map((t): MenuLine => ({ type: "choice", id, text: t }));

/** État d'une mission de test : tout à zéro, énergie 400 (`gm_main_game` `004220a5` : `gm_state_clear` puis `+0x3c = 0x190`). */
const TEST_STATE: MissionState = { ammo: Array<number>(AMMO_SLOTS).fill(0), score: 0, form: 0, energy: 400, cannonPower: 0 };

/** Pages du menu Tricher (`gm_menu_pickups`) : armes 0-9, armes 10-19, puis vie, compagnons, bouclier, puissance et véhicules. */
const CHEAT_PAGES: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  [100, 101, 102, 105, 106, 107, 108, 113],
];
/** Véhicules proposés selon la zone (variable 4 du script, `DAT_004841b0`) : id `200 + forme`. */
const CHEAT_FORMS: readonly (readonly number[])[] = [[200, 201], [200, 202], [201], [201, 203], [203, 204, 205]];
/** « Autres tricheries » : page suivante. */
const CHEAT_MORE = -9;

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
  | { kind: "menu"; menu: Menu; backdrop: "demo" | "frozen" | "level"; choose(id: number): void; cancel(): void; adjust?(id: number, value: number): void }
  | { kind: "name"; menu: Menu; name: string; testMode: boolean }
  /** Attente d'une touche à lier (`gm_menu_capture_key`) : le menu n'a pas de choix. */
  | { kind: "capture"; menu: Menu; done(scan: number): void }
  | { kind: "credits"; index: number }
  | { kind: "video"; mission: number }
  | { kind: "level" }
  | { kind: "end"; outcome: LevelOutcome; menu: Menu; counters: EndCounters; seconds: number }
  | { kind: "idle" };

export class Flow {
  view: FlowView = { kind: "none" };
  private phase: Phase = { kind: "idle" };
  private lastNow = 0;
  private settings: GlobalSettings;
  private pilot: Pilot | null = null;
  private runner: MissionScriptRunner | null = null;
  private quitCount = 0;
  /** Mission en cours (nom du niveau terminé, écran de fin). */
  private missionIndex = 0;
  /** État du joueur à la fin de la dernière mission accomplie : copié dans la fiche de la mission suivante (élément `200`). */
  private carry: MissionState | null = null;
  /** Missions lancées par « Entrez le mode test niveau » (`DAT_005b03fc`) : ni progression ni état d'arrivée, menu Tricher en jeu. */
  private test = false;
  /** Zone du niveau en cours (variable 4 du script) : véhicules du menu Tricher. */
  private zone = 0;
  /** Setup ouvert en jeu par F1 : ses menus sont sur l'image figée du niveau et Échap reprend le niveau. */
  private setupInLevel = false;

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

  /** Mission de test en cours : F12 ouvre le menu Tricher. */
  get testMode(): boolean {
    return this.test;
  }

  // --- Entrées de l'application ---------------------------------------------------------------------------

  /** Une image : `now` en ms (horloge d'image du navigateur). */
  update(now: number, input: UiInput): void {
    // Pas de plafond : les attentes du démarrage (3,5 s) se comptent en temps réel, même à faible cadence d'images.
    const dt = this.lastNow === 0 ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
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
      case "capture":
        phase.menu.tick();
        this.driveCapture(phase, input);
        break;
      case "credits":
        if (input.pressed) this.nextCredits(phase);
        break;
      case "end":
        phase.menu.tick();
        // Décompte animé : 40 ticks par seconde, indépendant de la cadence d'images ; une touche n'abrège rien (§9).
        if (phase.counters.advance(dt) > 0) phase.menu.setLines(this.endMenuLines(phase.outcome, phase.counters, phase.seconds));
        if (input.pressed && phase.counters.acceptsKeys) this.finishEnd(phase);
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
    this.carry = outcome === "complete" && !this.test ? (stats.state ?? null) : null;
    const counters = new EndCounters(
      outcome,
      {
        levelScore: stats.levelScore ?? 0,
        totalScore: stats.score ?? 0,
        objectivesPercent: stats.objectivesPercent ?? 0,
        bonusPercent: stats.bonusPercent ?? 0,
        secretsPercent: stats.secretsPercent ?? 0,
      },
      stats.endCounter,
    );
    const seconds = Math.round(stats.seconds ?? 0);
    const menu = this.makeMenu(this.endMenuLines(outcome, counters, seconds), { y: END_MENU_Y, noCancel: true });
    this.phase = { kind: "end", outcome, menu, counters, seconds };
    // Pas de titre 3D : « Mission accomplie ! » / « Game over » est un bandeau du menu ; le message figé du niveau (« Accompli »,
    // « Game over ! ») reste affiché, aucun `gm_title_release` n'est appelé par ces écrans.
    this.view = { kind: "menu", menu, backdrop: "level", title: null };
  }

  /** Page de dev : joue un niveau tout de suite, sans menus ni script (à la fin, retour à la sélection du pilote). */
  playLevelDirect(name: string, pilot: Pilot): void {
    this.pilot = pilot;
    this.runner = null;
    this.missionIndex = Math.max(0, this.data.script.missions.find((m) => m.level === name)?.index ?? 0);
    this.zone = 0;
    this.phase = { kind: "level" };
    this.view = { kind: "level" };
    this.carry = null;
    this.host.startLevel({ name, mission: this.missionIndex, vars: new Map(), tracks: [], pilot, state: pilot.states[this.missionIndex] ?? null });
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
      title: TITLES.abort,
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

  /**
   * F12 en mission de test (`gm_frame` : touche `0x58`, seulement si `DAT_005b03fc`) : menu Tricher sur l'image figée du niveau, encadré
   * des sons 6000 et 6001 comme la pause.
   */
  cheatRequested(): void {
    if (this.phase.kind !== "level" || !this.test) return;
    this.host.pauseLevel(true);
    this.host.sound(SOUND.open);
    this.cheatMenu();
  }

  /**
   * F1 en jeu (`gm_frame`, touche `0x3b`, hors séquence de fin comme la pause) : menu Setup (`gm_menu_setup(…, 1)`) entre les sons 6000
   * et 6001. Le monde est figé (`gm_menu_run` sans le drapeau 4 : `gm_poll_events` ne joue plus la logique) ; à la sortie, le profil de
   * contrôleur est rechargé (`gm_player_load_keys`, type et axes liés).
   */
  setupRequested(): void {
    if (this.phase.kind !== "level" || !this.pilot) return;
    this.host.pauseLevel(true);
    this.host.sound(SOUND.open);
    this.setupInLevel = true;
    this.setupMenu();
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

  /** Titre 3D d'un écran : la chaîne `(table, id)` en octets (le dessin la lit telle quelle, `|` = saut de ligne) et sa teinte. */
  private title([table, id, tint]: readonly [table: number, id: number, tint: number]): MenuTitle | null {
    const text = this.data.strings.getBytes(this.language, table, id);
    return text ? { text, tint } : null;
  }

  /** Fond des menus : le décor de `DEMO.SLV`, ou l'image figée du niveau pour le Setup ouvert en jeu. */
  private get menuBackdrop(): "demo" | "frozen" {
    return this.setupInLevel ? "frozen" : "demo";
  }

  private makeMenu(lines: MenuLine[], options: ConstructorParameters<typeof Menu>[1]): Menu {
    return new Menu(lines, options, this.data.text);
  }

  private showMenu(options: {
    /** Titre 3D `(table, id, teinte)` (`TITLES`) et bandeau(x) de texte sous lui ; `y` : ordonnée du menu (`MENU_Y`). */
    title: readonly [table: number, id: number, tint: number];
    y?: number;
    /** Cadre type (`standardLines`) : bandeau(x) puis lignes ; ou `lines`, le cadre exact de l'exécutable quand il diffère. */
    banner?: string[];
    body?: MenuLine[];
    lines?: MenuLine[];
    backdrop?: "demo" | "frozen";
    initial?: number;
    noCancel?: boolean;
    choose(id: number): void;
    cancel?(): void;
    adjust?(id: number, value: number): void;
  }): Menu {
    const lines = options.lines ?? standardLines(options.banner ?? [], options.body ?? []);
    const menu = this.makeMenu(lines, { y: options.y ?? MENU_Y.small, noCancel: options.noCancel, initial: options.initial });
    const backdrop = options.backdrop ?? this.menuBackdrop;
    this.phase = { kind: "menu", menu, backdrop, choose: options.choose, cancel: options.cancel ?? (() => {}), adjust: options.adjust };
    this.view = { kind: "menu", menu, backdrop, title: this.title(options.title) };
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
      title: TITLES.selectPilot,
      y: MENU_Y.list,
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
    // La gamma du pilote est réappliquée à toutes les palettes (`0041d6de` : `DAT_00484644 = +0x30`, `gm_modex_enter`).
    this.host.gamma(pilot.gamma);
    this.host.musicPreference(MUSIC_PREFERENCES[pilot.music]!);
    this.mainMenu();
  }

  private newPilot(): void {
    const menu = this.makeMenu(standardLines([this.s(0, 51)], this.nameLines("")), { y: MENU_Y.small, noCancel: false });
    this.phase = { kind: "name", menu, name: "", testMode: false };
    this.view = { kind: "menu", menu, backdrop: "demo", title: this.title(TITLES.newPilot) };
  }

  private nameLines(name: string): MenuLine[] {
    return [{ type: "text", text: format(this.s(0, 52), name) }];
  }

  private driveName(phase: Extract<Phase, { kind: "name" }>, input: UiInput): void {
    let name = phase.name;
    // Caractères et touches dans l'ordre de frappe.
    for (const entry of input.typed) {
      if (typeof entry !== "string") {
        if ([...name].length < NAME_MAX && isNameChar(entry.char)) name += entry.char;
      } else if (entry === "escape") {
        this.host.sound(SOUND.validate);
        return this.pilotSelect();
      } else if (entry === "backspace") name = [...name].slice(0, -1).join("");
      else if (entry === "enter" && name === TEST_MODE_CODE) {
        // Le code n'est pas un nom : la fiche reçoit `+0x28 = 1` et la saisie recommence à vide (`0041cc45`).
        phase.testMode = true;
        name = "";
      } else if (entry === "enter" && name.trim() !== "") return this.createPilot(name, phase.testMode);
    }
    // Écran tactile : un appui ouvre la saisie du navigateur.
    if (input.taps.length > 0 && this.host.askName) {
      const typed = this.host.askName(name);
      if (typed !== null) {
        const clean = [...typed].filter(isNameChar).join("").slice(0, NAME_MAX);
        if (clean === TEST_MODE_CODE) phase.testMode = true;
        else if (clean.trim() !== "") return this.createPilot(clean, phase.testMode);
      }
    }
    if (name !== phase.name) {
      phase.name = name;
      phase.menu.setLines(standardLines([this.s(0, 51)], this.nameLines(name)));
    }
  }

  private createPilot(name: string, testMode: boolean): void {
    const pilot = this.data.store.create(name, this.settings.language, 0, testMode);
    this.host.sound(SOUND.validate);
    if (!pilot) return this.pilotSelect();
    this.selectPilot(pilot.slot);
  }

  private deletePilot(): void {
    const pilots = this.data.store.list();
    this.showMenu({
      title: TITLES.deletePilot,
      y: MENU_Y.list,
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
      title: TITLES.deletePilot,
      banner: [pilot.name],
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
    // Haut de la boucle principale : fin du mode test (`00421db7`), puis `gm_controller_check` avant chaque menu principal.
    this.test = false;
    if (this.controllerCheck(pilot, () => this.mainMenu(initial))) return;
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
    );
    const quit: MenuLine[] = [{ type: "choice", id: 80, text: this.s(1, 19) }];
    // « Entrez le mode test niveau » : seulement pour un pilote créé après le code (`fiche +0x28 > 0`), sous « Quitter ».
    if (pilot.testMode) quit.push({ type: "choice", id: 90, text: this.s(1, 20) });
    this.showMenu({
      title: TITLES.main,
      y: MENU_Y.list,
      // Cadre de `gm_menu_main` : « Quitter » (et le mode test) isolé entre deux traits encadrés d'espaceurs de 2 px, espaceur de 3 px en bas.
      lines: [space(3), RULE, ...bands(format(this.s(1, 1), pilot.name)), RULE, space(3), ...body, space(2), RULE, space(2), ...quit, space(2), RULE, space(3)],
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
          case 90:
            return this.testMissionMenu();
        }
      },
    });
  }

  private retryMenu(): void {
    const pilot = this.pilot!;
    const missions = replayableMissions(this.data.script, pilot.bestMission, pilot.bestMission === ADVENTURE_COMPLETED, (level) => this.host.hasLevel(level));
    const best = missions.includes(pilot.bestMission) ? pilot.bestMission : missions[missions.length - 1];
    this.showMenu({
      title: TITLES.retry,
      y: MENU_Y.list,
      banner: [],
      body: missions.map((n): MenuLine => ({ type: "choice", id: n, text: this.s(200, n) })),
      initial: best,
      choose: (n) => this.runScript(n),
      cancel: () => this.mainMenu(30),
    });
  }

  private quitMenu(): void {
    const phrase = this.s(13, 30 + (this.quitCount++ & 3));
    this.showMenu({
      title: TITLES.quit,
      banner: [],
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
      title: TITLES.setup,
      banner: [],
      body: [10, 11, 12, 13, 14].map((id): MenuLine => ({ type: "choice", id, text: this.s(2, id) })),
      initial,
      choose: (id) => {
        if (id === 10) this.controllerMenu(() => this.setupMenu(10));
        else if (id === 11) this.volumeMenu();
        else if (id === 12) this.languageMenu();
        else if (id === 13) this.gammaMenu();
        else this.musicMenu();
      },
      cancel: () => (this.setupInLevel ? this.resumeFromSetup() : this.mainMenu(40)),
    });
  }

  /** Échap dans le Setup ouvert en jeu : profil de contrôleur rechargé, son 6001, le niveau reprend. */
  private resumeFromSetup(): void {
    this.setupInLevel = false;
    if (this.pilot) this.host.loadControls(this.pilot);
    this.host.pauseLevel(false);
    this.host.sound(SOUND.close);
    this.phase = { kind: "level" };
    this.view = { kind: "level" };
  }

  // --- Contrôleur (`00418454`, `004171b4`, `0041797c`, `004168b0`) ----------------------------------------------------------

  /**
   * `gm_controller_check` (`00418f54`) : un pilote sans contrôleur configuré (type 0), ou réglé sur la souris sans souris, passe par le
   * choix du type puis le menu du contrôleur avant le menu principal. Une manette absente ne remet pas le type à 0 : la Gamepad API ne
   * montre une manette qu'après un appui sur un de ses boutons. Vrai si le menu a été ouvert (`then` est rappelé à sa sortie).
   */
  private controllerCheck(pilot: Pilot, then: () => void): boolean {
    const c = pilot.controller;
    if (c && (c.type !== 2 || this.host.hasController(2))) return false;
    if (c) {
      pilot.controller = null;
      this.data.store.save(pilot);
    }
    this.controllerMenu(then);
    return true;
  }

  /**
   * « Configuration du contrôleur » : le type (ligne double), les liens d'axes (sauf au clavier), les touches des mouvements qui ne
   * sont pas sur un axe, « Freiner », puis tir et sélection. Choisir une touche ouvre sa capture ; Échap revient à `back`. Sans type
   * configuré, le choix du type s'ouvre d'abord (`+0x0c == 0`).
   */
  private controllerMenu(back: () => void, initial?: number): void {
    const pilot = this.pilot!;
    const c = pilot.controller;
    if (!c) return this.controllerTypeMenu(() => this.controllerMenu(back));
    const key = (row: number): MenuLine => ({ type: "choice", id: row, text: format(this.s(3, row), this.keyName(c.keys[KEY_ROWS[row]!]!)) });
    const motion = (m: Motion, rows: number[]): MenuLine[] => (motionOnKeys(c, m) ? rows.map(key) : []);
    const lines: MenuLine[] = [
      space(3),
      RULE,
      ...choices(1, format(this.s(3, 1), this.s(3, 10 + c.type))),
      space(3),
      RULE,
      ...(usesAxes(c.type) ? [space(3), ...choices(20, this.s(3, 20)), space(3), RULE, space(3)] : []),
      ...motion(0, [21, 22]),
      ...motion(1, [24, 25]),
      ...motion(2, [26, 27]),
      key(28),
      RULE,
      ...[29, 30, 31, 32].map(key),
      space(4),
      RULE,
      space(4),
    ];
    const again = (id: number) => (): void => this.controllerMenu(back, id);
    this.showMenu({
      title: TITLES.controller,
      y: MENU_Y.controller,
      lines,
      initial,
      choose: (id) => {
        if (id === 1) this.controllerTypeMenu(again(1));
        else if (id === 20) this.axisMenu(again(20));
        else {
          const slot = KEY_ROWS[id];
          if (slot === undefined) return;
          this.captureKey(id, c.keys[slot]!, (scan) => {
            c.keys[slot] = scan;
            this.data.store.save(pilot);
            again(id)();
          });
        }
      },
      cancel: back,
    });
  }

  /** Nom d'une touche (table 1000 du jeu, indexée par le code de balayage : « Flèche ← », « Espace », « Souris 1 », « Manette 2 »…). */
  private keyName(scan: number): string {
    return this.s(1000, scan);
  }

  /**
   * « Type du contrôleur » (`004171b4`) : clavier toujours, souris et manette si elles sont là ; pas d'annulation (drapeaux `0x21`).
   * Changer de type pose les touches et les axes par défaut du type ; reprendre le même type ne touche à rien.
   */
  private controllerTypeMenu(then: () => void): void {
    const pilot = this.pilot!;
    const types = CONTROLLER_TYPES.filter((t) => t === 1 || this.host.hasController(t));
    this.showMenu({
      title: TITLES.controllerType,
      y: MENU_Y.list,
      lines: [
        space(3),
        RULE,
        ...bands(this.s(3, 101)),
        RULE,
        space(3),
        ...types.map((t): MenuLine => ({ type: "choice", id: t, text: this.s(3, 10 + t) })),
        space(2),
        RULE,
        space(3),
      ],
      initial: pilot.controller?.type,
      noCancel: true,
      choose: (id) => {
        const type = id as ControllerType;
        if (pilot.controller?.type !== type) pilot.controller = defaultProfile(type);
        this.data.store.save(pilot);
        then();
      },
    });
  }

  /**
   * « Liens du contrôleur » (`0041797c`) : chaque mouvement passe à l'axe suivant du type (« Clavier » = aucun), « Attacher au centre »
   * (manette seulement) bascule Oui / Non. Le titre 3D est recréé à chaque passage, comme dans l'exe.
   */
  private axisMenu(back: () => void, initial?: number): void {
    const pilot = this.pilot!;
    const c = pilot.controller!;
    clampAxes(c);
    const axis = (id: number, motion: Motion): MenuLine => ({ type: "choice", id, text: format(this.s(3, 1009 + id), this.s(3, 200 + c.axes[motion])) });
    this.showMenu({
      title: TITLES.axes,
      y: MENU_Y.axes,
      lines: [
        space(3),
        RULE,
        space(3),
        ...bands(this.s(3, 1001)),
        space(3),
        RULE,
        space(3),
        axis(1, 0),
        axis(2, 1),
        axis(3, 2),
        // `0/100` « Oui » si la zone morte est active (octet à 0), `0/101` « Non » sinon.
        ...(c.type > 2 ? [{ type: "choice", id: 4, text: format(this.s(3, 1013), this.s(0, 100 + c.clip)) } satisfies MenuLine] : []),
        space(3),
        RULE,
        space(3),
      ],
      initial,
      choose: (id) => {
        if (id === 4) c.clip = c.clip === 0 ? 1 : 0;
        else cycleAxis(c, (id - 1) as Motion);
        this.data.store.save(pilot);
        this.axisMenu(back, id);
      },
      cancel: back,
    });
  }

  /**
   * « Sélectionner une touche » (`004168b0`) : « Appuyez sur la touche pour » et la ligne de l'action avec sa touche actuelle, sans choix
   * ni annulation ; la première touche ou le premier bouton qui a un nom dans la table 1000 est pris (son 6003). Les touches sans nom
   * (`#…` : Échap, F1…, chiffres) sont refusées, sauf pour un pilote en mode test.
   */
  private captureKey(row: number, current: number, done: (scan: number) => void): void {
    const lines: MenuLine[] = [
      RULE,
      space(3, ROW.banner),
      ...bands(this.s(3, 34)),
      ...bands(format(this.s(3, row), this.keyName(current))),
      space(3, ROW.banner),
      RULE,
    ];
    const menu = this.makeMenu(lines, { y: MENU_Y.small, noCancel: true });
    this.phase = { kind: "capture", menu, done };
    this.view = { kind: "menu", menu, backdrop: this.menuBackdrop, title: this.title(TITLES.captureKey) };
  }

  private driveCapture(phase: Extract<Phase, { kind: "capture" }>, input: UiInput): void {
    for (const scan of input.scans) {
      const name = this.keyName(scan);
      if (name === "" || (name.startsWith("#") && !this.pilot?.testMode)) continue;
      this.host.sound(SOUND.validate);
      return phase.done(scan);
    }
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
      title: TITLES.volume,
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
      title: TITLES.language,
      y: MENU_Y.language,
      banner: [],
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
      title: TITLES.music,
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

  /**
   * « Correction gamma » (`gm_menu_gamma` `00417ffc`) : quatre niveaux ; choisir l'applique tout de suite à la palette et l'écrit dans la
   * fiche, le menu reste ouvert (le titre 3D n'est créé qu'une fois) jusqu'à Échap.
   */
  private gammaMenu(): void {
    const pilot = this.pilot!;
    this.showMenu({
      title: TITLES.gamma,
      lines: [
        space(3),
        RULE,
        space(3),
        ...bands(this.s(6, 1)),
        space(3),
        RULE,
        space(3),
        ...Array.from({ length: GAMMA_LEVELS }, (_, g): MenuLine => ({ type: "choice", id: g, text: this.s(6, 10 + g) })),
        space(3),
        RULE,
        space(3),
      ],
      initial: pilot.gamma,
      choose: (g) => {
        pilot.gamma = g;
        this.data.store.save(pilot);
        this.host.gamma(g);
      },
      cancel: () => this.setupMenu(13),
    });
  }

  // --- Mode test et menu Tricher -------------------------------------------------------------------------------------

  /**
   * « Tester la mission » (`gm_menu_test_mission` `0041e614`) : les noms de missions de la table 200 jusqu'au premier `#`, 8 par page,
   * « Retour » / « Suivant » pour feuilleter (6 missions de plus ou de moins), des espaceurs de 19 px à la place des lignes absentes.
   * La mission choisie se joue en mode test (`DAT_005b03fc = 1`).
   */
  private testMissionMenu(offset = 0, initial?: number): void {
    let count = 0;
    while (!(this.s(200, count) || "#").startsWith("#")) count++;
    const empty = space(19);
    const slots = Array.from({ length: 8 }, (_, i): MenuLine => (offset + i < count ? { type: "choice", id: offset + i, text: this.s(200, offset + i) } : empty));
    this.showMenu({
      title: TITLES.testMission,
      y: MENU_Y.list,
      lines: [
        space(3),
        RULE,
        ...bands(this.s(11, 21)),
        RULE,
        space(3),
        offset === 0 ? empty : { type: "choice", id: -100, text: this.s(11, 10) },
        space(3),
        RULE,
        space(3),
        ...slots,
        space(3),
        RULE,
        space(3),
        offset < count - 7 ? { type: "choice", id: 100, text: this.s(11, 11) } : empty,
        space(3),
        RULE,
        space(2),
      ],
      initial,
      choose: (id) => {
        if (id === -100) this.testMissionMenu(Math.max(0, offset - 6), id);
        else if (id === 100) this.testMissionMenu(Math.min(offset + 6, count - 5), id);
        else if (this.data.script.missions.some((m) => m.index === id)) this.runScript(id, true);
      },
      cancel: () => this.mainMenu(90),
    });
  }

  /**
   * Menu Tricher (`gm_menu_pickups` `0041bb40`) : trois pages (armes 0-9, armes 10-19, bonus et véhicules de la zone) tournées par
   * « Autres tricheries » ; un choix applique le bonus ou la forme et le menu reste ouvert ; Échap reprend le niveau (son 6001). Le titre
   * 3D n'est créé qu'une fois : changer de page ne fait que remplacer les lignes.
   */
  private cheatMenu(): void {
    let page = 0;
    const lines = (): MenuLine[] => {
      const items = CHEAT_PAGES[page]!.map((n): MenuLine => ({ type: "choice", id: n, text: this.s(100, n) }));
      const forms = page === 2 ? (CHEAT_FORMS[this.zone] ?? []).map((n): MenuLine => ({ type: "choice", id: n, text: this.s(100, n) })) : [];
      return [
        space(3),
        RULE,
        ...bands(this.s(100, 1001)),
        RULE,
        space(3),
        { type: "choice", id: CHEAT_MORE, text: this.s(100, 9999) },
        space(3),
        RULE,
        space(3),
        ...items,
        ...(forms.length > 0 ? [space(3), RULE, space(3), ...forms] : []),
        space(3),
        RULE,
        space(3),
      ];
    };
    const resume = (): void => {
      this.host.pauseLevel(false);
      this.host.sound(SOUND.close);
      this.phase = { kind: "level" };
      this.view = { kind: "level" };
    };
    const menu = this.showMenu({
      title: TITLES.cheat,
      y: MENU_Y.list,
      lines: lines(),
      backdrop: "frozen",
      choose: (id) => {
        if (id === CHEAT_MORE) {
          page = (page + 1) % CHEAT_PAGES.length;
          menu.setLines(lines(), CHEAT_MORE);
        } else if (id < 200) this.host.cheat({ pickup: id });
        else this.host.cheat({ form: id - 200 });
      },
      cancel: resume,
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

  /** `test` : « Entrez le mode test niveau » (missions sans progression, menu Tricher). */
  private runScript(startMission: number | undefined, test = false): void {
    this.test = test;
    this.carry = null;
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
          if (step.index !== END_MISSION && this.test) {
            // Mission de test : état remis à zéro avec 400 d'énergie, ni fiche d'arrivée ni meilleure mission (`00422024`-`004220b6`).
            runner.seed(stateVars(TEST_STATE));
          } else if (step.index !== END_MISSION) {
            // Élément `200` : l'état de fin de la mission précédente devient la fiche d'arrivée `1000 + n` ; le joueur repart de cet état
            // (les éléments `100`-`103` qui suivent s'y appliquent). Une partie neuve n'a pas de fiche : variables du script seules.
            if (this.carry) pilot.states[step.index] = this.carry;
            this.carry = null;
            const arrival = pilot.states[step.index];
            if (arrival) runner.seed(stateVars(arrival));
            // La meilleure mission est celle qui a été démarrée, pas terminée (§5.2).
            if (pilot.bestMission < step.index) pilot.bestMission = step.index;
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
          this.zone = step.vars.get(4) ?? 0;
          this.phase = { kind: "level" };
          this.view = { kind: "level" };
          this.host.startLevel({
            name: step.name,
            mission: step.mission,
            vars: step.vars,
            tracks: step.tracks,
            pilot,
            state: this.test ? null : (pilot.states[step.mission] ?? null),
          });
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
    this.carry = null;
    this.host.music("menu");
    this.mainMenu();
  }

  // --- Fin de mission -----------------------------------------------------------------------------------------------

  /**
   * Cadre des écrans de fin (`004194b0`, `00419ed8`) : trait, deux bandeaux encadrés (espaceurs de 3 px de la ligne `0x76`, traits),
   * espaceur de 10 px, lignes de bilan, espaceur de 12 px, « N'importe quelle touche » ; pas de trait en bas. Succès : nom de la mission
   * puis `(7, 0)` « Mission accomplie ! » ; échec : `(7, 1)` « Game over » puis le nom de la mission.
   */
  private endMenuLines(outcome: LevelOutcome, counters: EndCounters, seconds: number): MenuLine[] {
    const mission = this.s(200, this.missionIndex);
    const banners = outcome === "complete" ? [mission, this.s(7, 0)] : [this.s(7, 1), mission];
    const band = (text: string): MenuLine[] => splitLines(text).map((t): MenuLine => ({ type: "title", text: t }));
    const rule: MenuLine = { type: "spacer", height: 1, row: ROW.rule };
    const pad: MenuLine = { type: "spacer", height: 3, row: ROW.banner };
    const lines = this.endLines(outcome, counters, seconds);
    const anyKey = lines.pop()!;
    return [
      rule,
      pad,
      ...band(banners[0]!),
      pad,
      rule,
      pad,
      ...band(banners[1]!),
      pad,
      rule,
      { type: "spacer", height: 10, row: ROW.veil },
      ...lines,
      { type: "spacer", height: 12, row: ROW.veil },
      anyKey,
    ];
  }

  /**
   * Lignes de l'écran « Mission accomplie » / « Game over » (`004194b0`, `00419ed8`). Les cinq lignes de score et de pourcentage
   * affichent les compteurs en cours de décompte ; les temps sont fixes. « Bonus » et « Secrets » n'existent qu'après un succès et
   * seulement si leur pourcentage **final** est non nul (`DAT_00480c08`, `DAT_00480c0c`) ; « Durée totale » est toujours là.
   */
  private endLines(outcome: LevelOutcome, counters: EndCounters, seconds: number): MenuLine[] {
    const lines: MenuLine[] = [];
    const value = (id: number, row: number): void => {
      lines.push({ type: "text", text: format(this.s(7, id), counters.current[row]!) });
    };
    const time = (id: number, total: number): void => {
      lines.push({ type: "text", text: format(this.s(7, id), Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60) });
    };
    value(10, COUNTER.levelScore);
    value(11, COUNTER.totalScore);
    time(12, seconds);
    time(13, this.pilot?.playSeconds ?? 0);
    value(14, COUNTER.objectives);
    if (outcome === "complete") {
      if (counters.target[COUNTER.bonus]) value(15, COUNTER.bonus);
      if (counters.target[COUNTER.secrets]) value(16, COUNTER.secrets);
    }
    lines.push({ type: "choice", id: 99, text: this.s(4, 1) });
    return lines;
  }

  /** Aucun son : l'écran tourne avec le drapeau « rendre la main » de `gm_menu_run`, qui sort avant le traitement des touches (§9). */
  private finishEnd(phase: Extract<Phase, { kind: "end" }>): void {
    this.host.endLevel();
    if (phase.outcome === "complete") this.advanceScript();
    else {
      this.runner = null;
      this.host.music("menu");
      this.mainMenu();
    }
  }
}
