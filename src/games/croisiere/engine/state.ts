/**
 * État global du moteur (les variables globales de ScummVM `engines/cruise/vars.cpp`, `cruise_main.cpp`, `script.cpp`, `function.cpp`)
 * regroupé dans un objet passé à chaque module et à chaque fonction native.
 *
 * Références (GPL v3+, release 2026.4.0) : `vars.cpp` (valeurs initiales), `cruise_main.cpp::initAllData` (démarrage sur `AUTO00`),
 * `cruise_main.cpp::changeScriptParamInList`, `scriptFunc2`, `removeFinishedScripts`, `script.cpp` (`removeScript`,
 * `attacheNewScriptToTail`).
 */
import { scummvmRandom, type ScummvmRandom } from "../../../engine/rng";
import type { Actor } from "./actors";
import { CellList, type Cell } from "./cells";
import { DisplayState } from "./display";
import { FileDatabase } from "./files";
import { GAME_FRAME_DELAY_1, GLOBAL_VAR_COUNT, ScriptType } from "./ids";
import type { Incrust } from "./incrust";
import { OverlayTable, type GameFiles } from "./overlays";
import { NullRenderer, NullSound, type CroisiereRenderer, type CroisiereSound } from "./services";
import type { EngineTrace } from "./trace";
import type { Menu, MenuSub, SelectedEntry } from "./menu";
import type { TextGfx } from "../render/text";
import { Vm } from "./vm";
import { freeCtp, WalkState } from "./walk";

/** Instance de script (`scriptInstanceStruct`). */
export interface ScriptInstance {
  overlayNumber: number;
  /** −1 : script terminé, purgé après la passe. */
  scriptNumber: number;
  /** IP. */
  scriptOffset: number;
  /** BSS du processus (espace mémoire 1), `null` si le script n'en déclare pas. */
  data: Uint8Array | null;
  freeze: number;
  /** 0 : le script attend la passe suivante (`Op_AddProc`). */
  sysKey: number;
  type: number;
  /** Overlay, numéro et type du parent. */
  var18: number;
  var16: number;
  var1A: number;
  /** Registre de condition (opcode 7). */
  ccr: number;
}


export interface EngineOptions {
  files: GameFiles;
  /** Graine du RNG (`--random-seed` du banc). */
  seed?: number;
  renderer?: CroisiereRenderer;
  sound?: CroisiereSound;
  trace?: EngineTrace | null;
  /** Contournement de la protection de copie (plan.md D3, `CRUISE_SKIP_PROTECTION` du banc). Vrai par défaut. */
  skipProtection?: boolean;
  /** Journal (avertissements de ScummVM, commentaires du jeu). */
  log?: (message: string) => void;
}

export class EngineState {
  readonly files: GameFiles;
  readonly overlays: OverlayTable;
  readonly globalVars = new Int16Array(GLOBAL_VAR_COUNT);
  /** Listes de processus (`procHead`, `relHead`), sans la tête. */
  procs: ScriptInstance[] = [];
  rels: ScriptInstance[] = [];
  readonly cells = new CellList();
  readonly display = new DisplayState();
  readonly filesDb: FileDatabase;
  readonly incrusts: Incrust[] = [];
  readonly actors: Actor[] = [];
  /** Zones de marche, graphe et trajets (`ctp.cpp`, `actor.cpp`, `perso.cpp`). */
  readonly walk = new WalkState(this.display.poly);
  readonly vm: Vm;
  readonly rnd: ScummvmRandom;
  readonly renderer: CroisiereRenderer;
  readonly sound: CroisiereSound;
  trace: EngineTrace | null;
  readonly skipProtection: boolean;
  private readonly logger?: (message: string) => void;

  /** Script en cours d'exécution (`currentScriptPtr`). */
  currentScript: ScriptInstance | null = null;
  bootOverlayNumber = 0;

  // Interface (vars.cpp, cruise_main.cpp)
  userEnabled = 0;
  userWait = false;
  autoTrack = false;
  autoMsg = -1;
  autoOvl = 0;
  currentActiveMenu = -1;
  readonly menuTable: (Menu | null)[] = [null, null, null, null, null, null, null, null];
  /** Relation à deux objets en attente du second objet (`linkedRelation`) : sous-entrées de l'entrée choisie. */
  linkedRelation: MenuSub[] | null = null;
  /** Bandeau « Objet:Verbe » (`linkedMsgList`). */
  linkedMsgList: TextGfx | null = null;
  /** Dernière entrée sélectionnée lue (`currentMenuElement`, `currentMenuElementX/Y`). */
  currentMenuElement: SelectedEntry | null = null;
  /** Curseur affiché (`changeCursor`, `CURSOR_*`) ; purement informatif. */
  cursor = 0;
  dialogueEnabled = false;
  dialogueOvl = 0;
  dialogueObj = 0;
  userDelay = 0;
  sysKey = -1;
  sysX = 0;
  sysY = 0;
  automaticMode = 0;
  activeMouse = 0;
  playerMenuEnabled = 0;
  displayOn = 1;
  protectionCode = 0;
  narratorOvl = 0;
  narratorIdx = 0;
  xdial = 0;
  aniX = 0;
  aniY = 0;
  animationStart = false;
  /** Zoom (`Op_SetZoom`) : `var39`, `var42`, `var45`, `var46`. */
  var39 = 0;
  var42 = 0;
  var45 = 0;
  var46 = 0;
  /** Inventaire autorisé (`Op_Inventory`). */
  var41 = 0;
  flagCt = 0;
  /** `flag_obstacle` (marche), remis à 0 par `cor_droite`. */
  flagObstacle = 0;
  isMessage = 0;
  automoveInc = 0;
  automoveMax = 0;
  fontFileIndex = -1;
  op7BVar = 0;
  vblLimit = 0;
  nextOverlay = "";
  lastOverlay = "";
  /** Nom du CTP chargé (`currentCtpName`), posé par la vague F2. */
  currentCtpName = "";
  /** Activation différée de l'utilisateur (`enableUser`, fin de la marche automatique). */
  enableUser = 0;

  // Boucle et entrées
  gameSpeed = GAME_FRAME_DELAY_1;
  speedFlag = false;
  currentMouseX = 0;
  currentMouseY = 0;
  currentMouseButton = 0;
  /** Bouton tenu, front montant (`buttonDown` de `processInput`). */
  buttonDown = 0;
  selectDown = 0;
  menuDown = 0;
  /** Temps virtuel (ms) : avance par les attentes (`delayMillis`) de la boucle et des fondus. */
  virtualTime = 0;

  constructor(options: EngineOptions) {
    this.files = options.files;
    this.overlays = new OverlayTable(options.files);
    this.filesDb = new FileDatabase(options.files);
    this.rnd = scummvmRandom(options.seed ?? 1);
    this.renderer = options.renderer ?? new NullRenderer();
    this.sound = options.sound ?? new NullSound();
    this.trace = options.trace ?? null;
    this.skipProtection = options.skipProtection ?? true;
    this.logger = options.log;
    this.vm = new Vm(this);
  }

  warn(message: string): void {
    this.logger?.(message);
  }

  /** `delayMillis` en temps virtuel : le son compte ses pas dessus. */
  delay(ms: number): void {
    this.virtualTime += ms;
    this.sound.elapse(ms);
  }

  /** Lecture d'un fichier des volumes, `null` s'il manque (`findFileInDisks` < 0). */
  readFile(name: string): Uint8Array | null {
    return this.files.has(name) ? this.files.readFile(name) : null;
  }

  /** `initAllData` : tables vides, chargement de `AUTO00` et de sa procédure 0, prête à la première passe. */
  initAllData(): void {
    this.overlays.reset();
    this.overlays.stateID = 0;
    this.display.masterScreen = 0;
    this.menuTable.fill(null);
    this.globalVars.fill(0);
    this.display.backgroundNames.fill("");
    this.filesDb.clear();
    this.procs = [];
    this.rels = [];
    this.cells.reset();
    this.actors.length = 0;
    this.incrusts.length = 0;
    this.bootOverlayNumber = this.overlays.load("AUTO00");
    if (this.bootOverlayNumber) {
      this.vm.resetStack();
      this.attachScript(this.procs, this.bootOverlayNumber, 0, 20, 0, 0, ScriptType.PROC);
      this.scriptFunc2(this.procs, this.bootOverlayNumber, 1, 0);
    }
    this.lastOverlay = "AUTO00";
    this.gameSpeed = GAME_FRAME_DELAY_1;
    this.speedFlag = false;
  }

  /**
   * `initVars` (saveload.cpp) : tout est vidé (menus, fichiers, zones de marche, incrustations, cellules, acteurs, scripts, overlays,
   * variables), puis les variables de l'interface reprennent leurs valeurs de départ. Utilisé par « Recommencer » avant `initAllData`.
   * Non portés : la précharge (`resetPreload`) et l'état musical propre à `function.cpp` (`songLoaded`, `songPlayed`, `songLoop`).
   */
  initVars(): void {
    this.menuTable.fill(null);
    this.linkedMsgList = null;
    this.linkedRelation = null;
    this.filesDb.clear();
    freeCtp(this);
    this.incrusts.length = 0;
    this.cells.reset();
    this.actors.length = 0;
    this.procs = [];
    this.rels = [];
    this.overlays.reset();
    this.overlays.stateID = 0;
    this.display.masterScreen = 0;
    this.globalVars.fill(0);
    this.display.backgroundNames.fill("");
    this.vblLimit = 0;
    this.activeMouse = 0;
    this.userEnabled = 1;
    this.dialogueEnabled = false;
    this.dialogueOvl = 0;
    this.dialogueObj = 0;
    this.userDelay = 0;
    this.sysKey = -1;
    this.sysX = 0;
    this.sysY = 0;
    this.automoveInc = 0;
    this.automoveMax = 0;
    this.displayOn = 1;
    this.isMessage = 0;
    this.display.fadeFlag = 0;
    this.automaticMode = 0;
    this.display.titleColor = 2;
    this.display.itemColor = 1;
    this.display.selectColor = 3;
    this.display.subColor = 5;
    this.narratorOvl = 0;
    this.narratorIdx = 0;
    this.aniX = 0;
    this.aniY = 0;
    this.animationStart = false;
    this.selectDown = 0;
    this.menuDown = 0;
    this.buttonDown = 0;
    this.var41 = 0;
    this.playerMenuEnabled = 0;
    this.display.pcFadeFlag = false;
  }

  /** `scriptFunc2` : ne touche que le premier script de la liste (conditions de ScummVM conservées telles quelles). */
  private scriptFunc2(list: ScriptInstance[], ovl: number, param: number, param2: number): void {
    const first = list[0];
    if (!first) return;
    if (ovl === first.overlayNumber || ovl !== -1) {
      if (param2 === first.scriptNumber || param2 !== -1) first.sysKey = param;
    }
  }

  /**
   * `attacheNewScriptToTail` : ajoute un processus en queue. `scriptType` négatif (`MinusPROC`, `Op_Exec`) : démarre dans la passe
   * en cours (`sysKey = 1`) ; PROC positif : à la passe suivante ; REL : tout de suite. Renvoie le BSS du processus (`null` s'il n'en
   * a pas ou si le script n'existe pas) et l'instance.
   */
  attachScript(list: ScriptInstance[], ovl: number, param: number, arg0: number, arg1: number, arg2: number, scriptType: number): { bss: Uint8Array | null; instance: ScriptInstance | null } {
    let useArg3Neg = 0;
    if (scriptType < 0) {
      useArg3Neg = 1;
      scriptType = -scriptType;
    }
    let block;
    if (scriptType === ScriptType.PROC) block = this.overlays.proc(ovl, param);
    else if (scriptType === ScriptType.REL) block = this.overlays.rel(ovl, param);
    else return { bss: null, instance: null };
    if (!block || !block.data.length) return { bss: null, instance: null };
    const size = block.sysKey;
    const instance: ScriptInstance = {
      overlayNumber: ovl,
      scriptNumber: param,
      scriptOffset: 0,
      data: size ? new Uint8Array(size) : null,
      freeze: 0,
      sysKey: scriptType === ScriptType.PROC ? useArg3Neg : 1,
      type: scriptType,
      var18: arg2,
      var16: arg1,
      var1A: arg0,
      ccr: 0,
    };
    list.push(instance);
    return { bss: instance.data, instance };
  }

  /** `changeScriptParamInList` : −1 = joker ; seule primitive qui gèle et dégèle les scripts. */
  changeScriptParamInList(ovl: number, num: number, list: ScriptInstance[], oldFreeze: number, newValue: number): void {
    for (const s of list) {
      if ((s.overlayNumber === ovl || ovl === -1) && (s.scriptNumber === num || num === -1) && (s.freeze === oldFreeze || oldFreeze === -1)) {
        s.freeze = newValue;
      }
    }
  }

  /** `removeScript` : marque les scripts (`scriptNumber = -1`), purgés après la passe. */
  removeScript(ovl: number, idx: number, list: ScriptInstance[]): void {
    for (const s of list) if (s.overlayNumber === ovl && (s.scriptNumber === idx || idx === -1)) s.scriptNumber = -1;
  }

  /** `removeFinishedScripts`. */
  removeFinishedScripts(list: ScriptInstance[]): ScriptInstance[] {
    return list.filter((s) => s.scriptNumber !== -1);
  }

  /** `freeOverlay` : tue les scripts de l'overlay puis libère ses données. */
  freeOverlay(idx: number): number {
    const entry = this.overlays.entries[idx];
    if (!entry || !entry.alreadyLoaded) return this.overlays.free(idx);
    this.removeScript(idx, -1, this.procs);
    this.removeScript(idx, -1, this.rels);
    return this.overlays.free(idx);
  }

  /** `releaseOverlay`. */
  releaseOverlay(name: string): number {
    const idx = this.overlays.findByName(name);
    if (idx < 0) return idx;
    return this.freeOverlay(idx);
  }

  /** Libère le texte rendu d'une cellule retirée (`freeGfx`). */
  readonly freeCellGfx = (cell: Cell): void => {
    if (cell.gfx) this.renderer.freeText?.(cell);
  };

  /** `getText` : message `index` de l'overlay, `null` si l'overlay n'a pas de textes. */
  getText(index: number, ovl: number): string | null {
    const data = this.overlays.entries[ovl]?.data;
    if (!data || !data.messages.length) return null;
    return data.messages[index] ?? null;
  }
}
