import { MAX_COMMAND_ARGS, TOKEN_GROUPS } from "../data/commands";
import type { GameObject } from "./state";

/**
 * Interpréteur des jetons de trois lettres d'*Armaeth* : tokeniseur de la saisie `/jeton arguments`
 * (`gm_script_tokenize` `109a:0002`), répartiteur à niveau de groupe (`gm_script_dispatch` `124c:0002`) et les 119
 * gestionnaires (`docs/armaeth/parser.md` § 11). Module pur : tout effet sur le monde, l'écran ou le son passe par
 * `TokenHost`, que l'interface injecte. Les attentes (`wat`, fenêtres de texte, `cmd`) ne bloquent pas : un gestionnaire
 * retourne une `TokenWait` que l'automate de `scripts.ts` consomme.
 */

/** Un argument absent vaut 0xFFFF, soit -1 une fois lu en entier signé (§ 11.1). */
export const ABSENT_ARG = -1;
/** Valeur de succès (7) des gestionnaires du moteur : ici un booléen. */
export const TOKEN_OK = true;
/** Attente de `cmd` entre l'affichage de la phrase et son exécution (`105e:0112`), en tics BIOS. */
export const CMD_ECHO_TICKS = 25;
/** Niveau de groupe accepté au démarrage (`DGROUP:05ea`, § 11.2). */
export const INITIAL_GROUP_LEVEL = 0;
/** Délai de lecture automatique maximal de `dsp` (tics, § 11.4). */
export const MAX_AUTO_DELAY = 255;

// ---------------------------------------------------------------------------------------------------------------
// Interface avec l'hôte

/** Rectangle de la fenêtre de `tta` (`ttl`, `DGROUP:0042..0048`) ; 0 = valeur par défaut de la mise en page (§ 13.1). */
export interface TextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Couleurs du texte scripté (`ecr`, `DGROUP:4b3a/4b3c/4b3e`) : fond, texte et anneaux A, ombre et anneaux B (indices de palette). */
export type TextColors = readonly [background: number, text: number, shadow: number];

/** Demande d'affichage d'une fenêtre de texte (`aff`, `dsp`, `tta`, `msg`). L'hôte pagine ; l'automate attend. */
export interface TextRequest {
  text: string;
  /** Fenêtre de `ttl` pour `tta` ; `null` = fenêtre par défaut (§ 13.1). */
  window: TextRect | null;
  /** Centré horizontalement et rétréci au texte (fenêtre par défaut) ; faux pour `tta`. */
  centered: boolean;
  /** Couleurs de `ecr` ; `null` = couleurs du pilote (message ordinaire, `msg`, tant qu'aucun `ecr` n'a été exécuté). */
  colors: TextColors | null;
}

/** Famille de liste d'objets du groupe 7 : `i` = INT (liste globale), `d` = DEC (décors de la salle), `o` = OBJ (objets de la salle). */
export type ListFamily = "int" | "dec" | "obj";
/** Préfixe d'un jeton du groupe 7 : créer, supprimer, vider, relâcher-puis-désigner, désigner, suivant, relâcher, lister. */
export type ListOp = "create" | "delete" | "clear" | "releaseSelect" | "select" | "next" | "release" | "list";
/** Jetons du groupe 9 qui agissent sur un objet (mouvement, rangement) et que l'hôte réalise. */
export type ObjectAction = "xpy" | "trj" | "raz" | "get" | "let" | "mov" | "chr";
/** Jetons du groupe 5 qui touchent le son (§ 11.4, `audio.md`) : sélection de pilote ou commande de piste. */
export type SoundKind = "buz" | "adl" | "rol" | "mus" | "brt" | "fbt" | "msl" | "mst";
/** Jetons de débogage (groupes 2 et 3) : affichages d'objets, de salles et de listes. */
export type DebugKind = "vue" | "inf" | "loc" | "dec" | "img" | "pos" | "dic" | "exp";

/**
 * Tout ce que les jetons font hors de l'interpréteur. Aucune méthode ne bloque : les attentes sont rendues à l'automate.
 * Les numéros sont ceux des données (`Num` d'objet, identifiant de scène).
 */
export interface TokenHost {
  /** Bip (`3574:0072`) : échec d'un jeton. */
  bell(): void;

  // --- objets ---
  /** `gm_resolve_object_ref` (§ 11.4) : `num < 1` = le héros ; sinon l'objet de ce `Num` (salle courante, puis listes globales). */
  resolveObject(num: number): GameObject | undefined;
  /** Écrit un champ de l'enregistrement de l'objet (décalage en octets, taille 1 ou 2, signé). */
  writeObjectField(obj: GameObject, offset: number, size: 1 | 2, value: number): void;
  /** `1a37:0002` : redessine / recalcule l'objet après un changement d'apparence (`fig`, `txt`, `dep`). */
  refreshObject(obj: GameObject): void;
  /** `fct` : installe (`true`) ou retire le pointeur de comportement `+0x8C:+0x8E` de l'objet. */
  setBehaviour(obj: GameObject, enabled: boolean): void;
  /** Jetons du groupe 9 : déplacement, trajectoire, rangement. `obj` peut être absent si l'objet n'existe pas. */
  objectAction(action: ObjectAction, obj: GameObject | undefined, args: readonly number[]): void;
  /** Jetons du groupe 7 : opérations sur les listes d'objets et le héros ; `args` = arguments bruts du jeton. */
  objectList(op: ListOp, family: ListFamily, args: readonly number[]): void;
  /** `sl1`, `sl2`, `sl3` : séquence visuelle de fin d'épisode (étapes 1 à 3, hypothèse). */
  sequence(step: 1 | 2 | 3, arg: number): void;

  // --- texte ---
  /** Texte d'un message (`gm_get_message`) ; `undefined` s'il n'existe pas. */
  getMessage(messageClass: number, id: number): string | undefined;
  /** Ouvre une fenêtre de texte ; l'automate attend ensuite une touche, un clic ou un délai (§ 13.3 et § 13.4). */
  showText(request: TextRequest): void;
  /** Page suivante après une confirmation : vrai s'il en reste une (la fenêtre reste), faux si le texte est épuisé et la fenêtre fermée. */
  advanceText(): boolean;
  /** Ferme la fenêtre en cours et restaure le fond (saut F8 pendant une attente). */
  closeText(): void;
  /** `cmd` : affiche la phrase comme une commande tapée (bas d'écran, `y = 0xA0`). */
  echoCommand(text: string): void;
  /** `cmd`, `exe` : exécute une phrase du jeu (`gm_parse_command`). */
  executeCommand(text: string): void;
  /** `peo` : couleurs de texte du pilote vidéo. */
  setTextColors(a: number, b: number, c: number): void;

  // --- monde et scène ---
  /** `niv`, `svg` : chapitre * 100 + niveau (`DGROUP:4b4e`). */
  setChapterLevel(chapterLevel: number): void;
  /** `trf` / `mov` : salle de destination (`4b80`) ; `sendHero` envoie aussi le héros (`+0x3F ← 6`). */
  setDestinationRoom(roomId: number, sendHero: boolean): void;
  /** `lir` : charge la scène (image de fond) d'identifiant `sceneId`. */
  loadScene(sceneId: number): void;
  /** `pil` : taille de la pile de sauvegarde des sprites (> 0) ou libération (< 0). */
  snapshotStack(size: number): void;
  /** `rsv` : `gm_savegame_slot(mode)` (-1 = recommencer, 0 = restaurer, 1 = sauvegarder). */
  saveSlot(mode: number): void;
  /** `sau` / `res` : `gm_save_world` / `gm_load_world` sur le fichier temporaire. */
  worldFile(op: "save" | "load"): void;
  /** `sub` (purge et rechargement) et `sal` (mots de la table des salles) ; hypothèses. */
  worldOperation(op: "sub" | "sal", arg: number): void;
  /** `cle` : porte `a1` de la famille de gestionnaires `a0` (0..9, `parser.md` § 6.4) ; réinitialise le mouvement de ses objets. */
  setHandlerGate(family: number, value: number): void;
  /** `heu` : heure du jeu (`4b54/4b55/4b56`). */
  setClock(hour: number, minute: number, ticks: number): void;
  /** `ral` : diviseur de vitesse du jeu (`4b51`, 0..255). */
  setSpeedDivider(delay: number): void;

  // --- affichage et son ---
  /** `lum` : luminosité cible (`4ae2`, `4ae4`). */
  setLight(level: number, aux: number): void;
  /** `rvb` : palette du pilote avec décalages (rouge, vert, bleu). */
  shiftPalette(r: number, v: number, b: number): void;
  /** `sec` : réinitialise le bloc de liaison du pilote vidéo. */
  resetDriver(): void;
  /** `isr` : point d'entrée du bloc de liaison du pilote. */
  driverInit(): void;
  /** `mod` : `gm_init_video`. */
  initVideo(): void;
  /** `dsk` : indicateur de disque (`0ebc`, 7 = CD). */
  setDiskFlag(value: number): void;
  /** `mse` : sondage de la souris (`4cac`). */
  setMouseEnabled(enabled: boolean): void;
  /** Commandes de son (`mus`, `brt`, `fbt`, `msl`, `mst`) et sélection de pilote (`buz`, `adl`, `rol`). */
  sound(kind: SoundKind, args: readonly number[]): void;

  // --- débogage et sortie ---
  /** Jetons d'inspection (`inf`, `loc`, `dec`, `img`, `pos`, `dic`, `exp`, `vue`). */
  debug(kind: DebugKind, obj: GameObject | undefined, args: readonly number[]): void;
  /** `xit` : `gm_quit(0, 0)`. */
  quit(): void;
}

// ---------------------------------------------------------------------------------------------------------------
// État de script et attentes

/** Demande d'attente retournée par un gestionnaire ; l'automate la traite sans bloquer. */
export type TokenWait =
  /** `wat`, ou attente de `cmd` : `ticks` tics BIOS (18,2 Hz), puis `then` éventuel. */
  | { kind: "ticks"; ticks: number; then?: () => void }
  /** Fenêtre de texte : clic / Entrée / Échap (`delay` = 0) ou `delay` tics (`aut`, `dsp`), à chaque page. */
  | { kind: "text"; delay: number };

/** Variables de contrôle des scripts (`DGROUP:4b34..4b50`, `05ea`, `4b66`, `4b3a..`), possédées par l'interpréteur. */
export interface ScriptFlags {
  /** `4b34` : un script est en cours. */
  running: boolean;
  /** `4b36` (`cnt`) : non nul = enchaîner les enregistrements sans rendre la main. */
  cnt: number;
  /** `4b38` : mode saut (F8), jusqu'au prochain `fin`. */
  skip: boolean;
  /** `4b42` (`nil`) : script en pause. */
  paused: boolean;
  /** `4b50` : le héros répond aux commandes (faux pendant un script). */
  heroControl: boolean;
  /** `05ea` (`dgs`) : plus haut groupe accepté. */
  dgs: number;
  /** `4b66` (`aut`) : délai de lecture automatique en tics, 0 = attendre une touche. */
  autoDelay: number;
  /** `4b3a/4b3c/4b3e` (`ecr`) ; `null` tant qu'aucun `ecr` n'a été exécuté. */
  textColors: TextColors | null;
  /** Fenêtre de `tta` (`ttl`) ; `null` tant qu'aucun `ttl` n'a été exécuté. */
  titleWindow: TextRect | null;
  /** `4cac` (`mse`) : les clics de souris sont lus ; hypothèse : actif au départ. */
  mouse: boolean;
  /** `xit` exécuté : le jeu quitte. */
  quit: boolean;
}

export function createScriptFlags(): ScriptFlags {
  return {
    running: false,
    cnt: 0,
    skip: false,
    paused: false,
    heroControl: true,
    dgs: INITIAL_GROUP_LEVEL,
    autoDelay: 0,
    textColors: null,
    titleWindow: null,
    mouse: true,
    quit: false,
  };
}

/** Lien avec l'automate de scripts (`sys n` appelle `gm_cm_script_step(n)`). */
export interface ScriptControl {
  step(state: number): void;
}

// ---------------------------------------------------------------------------------------------------------------
// Gestionnaires

interface TokenContext {
  host: TokenHost;
  flags: ScriptFlags;
  control: ScriptControl;
  /** 16 arguments entiers signés, complétés par `ABSENT_ARG`. */
  args: readonly number[];
  text: string;
}

/** `false` = échec (le répartiteur sonne), une `TokenWait` = attente, sinon succès. */
type TokenOutcome = void | false | TokenWait;
type TokenHandler = (ctx: TokenContext) => TokenOutcome;

export interface TokenDef {
  group: number;
  /** Indice dans le groupe. */
  index: number;
  name: string;
  /** Nombre d'arguments significatifs (hors texte), documentation. */
  arity: number;
  /** Faux si `parser.md` § 11.4 marque l'effet « non établi » : le gestionnaire est alors un no-op documenté. */
  established: boolean;
  handler: TokenHandler;
}

interface Spec {
  arity: number;
  handler: TokenHandler;
  established?: boolean;
}

const def = (arity: number, handler: TokenHandler): Spec => ({ arity, handler });
/** Jeton dont l'effet n'est pas établi (`parser.md` § 11.4) : aucun effet, succès. */
const unestablished = (arity: number): Spec => ({ arity, handler: () => undefined, established: false });
/** Jeton EGA seulement : le pilote VGA le refuse silencieusement dans le port (palette EGA inexistante). */
const egaOnly = (arity: number): Spec => def(arity, () => undefined);

function fail(ctx: TokenContext): false {
  ctx.host.bell();
  return false;
}

/** Valeur d'un argument, ou `fallback` s'il est absent. */
function argOr(ctx: TokenContext, i: number, fallback: number): number {
  const v = ctx.args[i];
  return v === undefined || v === ABSENT_ARG ? fallback : v;
}

/** `gm_resolve_object_ref(args, i)` ; un objet introuvable laisse le jeton sans effet (hypothèse : le moteur d'origine n'a pas de message). */
function objectAt(ctx: TokenContext, i: number): GameObject | undefined {
  return ctx.host.resolveObject(ctx.args[i] ?? ABSENT_ARG);
}

/** Jeton qui écrit un champ de l'objet `args[objIndex]`. */
function fieldWriter(arity: number, objIndex: number, offset: number, size: 1 | 2, refresh: boolean, map: (a0: number) => number = (v) => v): Spec {
  return def(arity, (ctx) => {
    const obj = objectAt(ctx, objIndex);
    if (!obj) return;
    ctx.host.writeObjectField(obj, offset, size, map(ctx.args[0]));
    if (refresh) ctx.host.refreshObject(obj);
  });
}

/** `niv` / `svg` : `a0 * 100 + a1` si `0 ≤ a0 ≤ a1 < 10` (a1 vaut a0 par défaut pour `niv`). */
function levelSetter(ctx: TokenContext, defaultToFirst: boolean): TokenOutcome {
  const a0 = ctx.args[0];
  const a1 = defaultToFirst ? argOr(ctx, 1, a0) : ctx.args[1];
  if (a0 < 0 || a0 > a1 || a1 >= 10) return fail(ctx);
  ctx.host.setChapterLevel(a0 * 100 + a1);
}

/** Affichage d'un texte dans la fenêtre par défaut avec les couleurs de `ecr` (`aff`, `dsp`), puis attente. */
function showDefault(ctx: TokenContext, delay: number): TokenWait {
  ctx.host.showText({ text: ctx.text, window: null, centered: true, colors: ctx.flags.textColors });
  return { kind: "text", delay };
}

function objectActionSpec(arity: number, action: ObjectAction, objIndex: number): Spec {
  return def(arity, (ctx) => ctx.host.objectAction(action, objectAt(ctx, objIndex), ctx.args));
}

const LIST_OPS: readonly ListOp[] = ["create", "delete", "clear", "releaseSelect", "select", "next", "release", "list"];
const LIST_FAMILIES: readonly ListFamily[] = ["int", "dec", "obj"];
const LIST_ARITY: Record<ListOp, number> = { create: 3, delete: 1, clear: 0, releaseSelect: 1, select: 1, next: 0, release: 1, list: 0 };

function debugSpec(arity: number, kind: DebugKind, objIndex: number | null): Spec {
  return def(arity, (ctx) => ctx.host.debug(kind, objIndex === null ? undefined : objectAt(ctx, objIndex), ctx.args));
}

function soundSpec(arity: number, kind: SoundKind): Spec {
  return def(arity, (ctx) => ctx.host.sound(kind, ctx.args));
}

/** Gestionnaires par nom de jeton (les groupes 0 à 10 de `TOKEN_GROUPS`) ; chaque entrée cite `parser.md` § 11.4. */
const SPECS: Record<string, Spec> = {
  // --- groupe 0 : contrôle des scripts (139a:0006) ---
  fin: def(0, (ctx) => {
    ctx.flags.skip = false;
  }),
  rem: def(0, () => undefined),
  nop: def(0, () => undefined),
  sys: def(1, (ctx) => ctx.control.step(ctx.args[0])),
  cnt: def(1, (ctx) => {
    ctx.flags.cnt = ctx.args[0];
  }),
  dgs: def(1, (ctx) => {
    ctx.flags.dgs = ctx.args[0];
  }),
  xit: def(0, (ctx) => {
    ctx.flags.quit = true;
    ctx.host.quit();
  }),
  sec: def(0, (ctx) => ctx.host.resetDriver()),
  mse: def(1, (ctx) => {
    ctx.flags.mouse = ctx.args[0] !== 0;
    ctx.host.setMouseEnabled(ctx.flags.mouse);
  }),

  // --- groupe 1 : temps, lumière, palette (1250:0008) ---
  heu: def(3, (ctx) => ctx.host.setClock(argOr(ctx, 0, 23), argOr(ctx, 1, 59), argOr(ctx, 2, 99))),
  lum: def(2, (ctx) => ctx.host.setLight(ctx.args[0], ctx.args[1])),
  trf: def(1, (ctx) => {
    if (ctx.args[0] > 0) ctx.host.setDestinationRoom(ctx.args[0], true);
  }),
  ral: def(1, (ctx) => {
    if (ctx.args[0] >= 0 && ctx.args[0] <= 255) ctx.host.setSpeedDivider(ctx.args[0]);
  }),
  lmr: fieldWriter(2, 1, 0x0a, 2, false),
  wat: def(1, (ctx): TokenOutcome => (ctx.args[0] > 0 ? { kind: "ticks", ticks: ctx.args[0] } : undefined)),
  rvb: def(3, (ctx) => ctx.host.shiftPalette(ctx.args[0], ctx.args[1], ctx.args[2])),

  // --- groupe 2 : tracé (10f2:0008) ---
  rlf: unestablished(0), // non établi (parser.md §11.4) : tracé de ligne direct dont les arguments sont lus par la fonction
  rel: unestablished(0), // non établi (parser.md §11.4) : idem
  vue: debugSpec(1, "vue", 0), // hypothèse (parser.md §11.4) : cadre autour de l'objet

  // --- groupe 3 : informations de débogage (10fb:0006) ---
  inf: debugSpec(1, "inf", 0),
  loc: def(1, (ctx) => {
    if (ctx.args[0] > 0) ctx.host.debug("loc", objectAt(ctx, 0), ctx.args);
  }),
  dec: debugSpec(0, "dec", null),
  img: debugSpec(0, "img", null),
  pos: debugSpec(1, "pos", 0),
  dic: debugSpec(1, "dic", null),
  exp: debugSpec(1, "exp", 0), // hypothèse (parser.md §11.4)

  // --- groupe 4 : texte et phrases (105e:0004) ---
  aut: def(1, (ctx) => {
    if (ctx.args[0] >= 0) ctx.flags.autoDelay = ctx.args[0];
  }),
  aff: def(0, (ctx) => showDefault(ctx, ctx.flags.autoDelay)),
  dsp: def(0, (ctx) => {
    const len = ctx.text.length;
    return showDefault(ctx, Math.min(MAX_AUTO_DELAY, len + Math.floor(len / 3)));
  }),
  cmd: def(0, (ctx): TokenWait => {
    ctx.host.echoCommand(ctx.text);
    return { kind: "ticks", ticks: CMD_ECHO_TICKS, then: () => ctx.host.executeCommand(ctx.text) };
  }),
  exe: def(0, (ctx) => ctx.host.executeCommand(ctx.text)),
  sub: def(1, (ctx) => ctx.host.worldOperation("sub", ctx.args[0])), // hypothèse (parser.md §11.4)
  sal: def(1, (ctx) => ctx.host.worldOperation("sal", ctx.args[0])), // hypothèse (parser.md §11.4)
  ecr: def(3, (ctx) => {
    ctx.flags.textColors = [ctx.args[0], ctx.args[1], ctx.args[2]];
  }),
  msg: def(2, (ctx): TokenOutcome => {
    const [messageClass, id] = ctx.args;
    if (messageClass < 0 || id < 0) return;
    const text = ctx.host.getMessage(messageClass, id);
    if (text === undefined) return;
    ctx.host.showText({ text, window: null, centered: true, colors: null });
    return { kind: "text", delay: ctx.flags.autoDelay };
  }),
  peo: def(3, (ctx) => ctx.host.setTextColors(ctx.args[0], ctx.args[1], ctx.args[2])),
  ttl: def(4, (ctx) => {
    ctx.flags.titleWindow = { x: ctx.args[0], y: ctx.args[1], width: ctx.args[2], height: ctx.args[3] };
  }),
  tta: def(0, (ctx): TokenWait => {
    ctx.host.showText({ text: ctx.text, window: ctx.flags.titleWindow, centered: false, colors: ctx.flags.textColors });
    return { kind: "text", delay: ctx.flags.autoDelay };
  }),

  // --- groupe 5 : vidéo EGA et son (111f:0006) ---
  cga: egaOnly(2),
  pal: egaOnly(16),
  mon: egaOnly(0),
  buz: soundSpec(0, "buz"),
  adl: soundSpec(0, "adl"),
  rol: soundSpec(0, "rol"),
  mus: soundSpec(6, "mus"),
  brt: soundSpec(4, "brt"),
  fbt: soundSpec(3, "fbt"),
  msl: soundSpec(1, "msl"),
  mst: soundSpec(1, "mst"),

  // --- groupe 6 : scène, niveaux (123d:000a) ---
  scn: unestablished(0), // non établi (parser.md §11.4) : 21cc:000e()
  niv: def(2, (ctx) => levelSetter(ctx, true)),
  sol: unestablished(1), // non établi (parser.md §11.4) : `4ae0 ← max(a0, 1)`, sens inconnu
  aes: unestablished(0), // non établi (parser.md §11.4) : 147f:000a()
  pds: unestablished(2), // non établi (parser.md §11.4) : 133e:0006(clamp(a0), a1)
  ref: def(1, () => undefined), // certain (parser.md §11.4) : `10dc:0160` est un stub qui renvoie 0, donc aucun texte
  aev: unestablished(0), // non établi (parser.md §11.4) : 147f:0352()

  // --- groupe 8 : champs d'objet (1218:000a), objet = args[1] sauf mention ---
  ego: fieldWriter(2, 1, 0x2d, 1, false),
  fig: fieldWriter(2, 1, 0x2e, 1, true),
  txt: fieldWriter(2, 1, 0x08, 1, true),
  dep: fieldWriter(2, 1, 0x07, 1, true),
  tim: def(3, (ctx) => {
    const obj = objectAt(ctx, 2);
    if (!obj) return;
    ctx.host.writeObjectField(obj, 0x32, 2, ctx.args[0]);
    ctx.host.writeObjectField(obj, 0x34, 2, ctx.args[1]);
  }),
  fct: def(2, (ctx) => {
    const obj = objectAt(ctx, 1);
    if (obj) ctx.host.setBehaviour(obj, ctx.args[0] === 0);
  }),
  dir: def(4, (ctx) => {
    const obj = objectAt(ctx, 3);
    if (!obj) return;
    // Hor +0x60 ← a0, Prf +0x62 ← a1, Ver +0x61 ← a2 (octets signés, world.ts).
    ctx.host.writeObjectField(obj, 0x60, 1, ctx.args[0]);
    ctx.host.writeObjectField(obj, 0x62, 1, ctx.args[1]);
    ctx.host.writeObjectField(obj, 0x61, 1, ctx.args[2]);
  }),
  dpx: fieldWriter(2, 1, 0x45, 1, false),
  dpy: fieldWriter(2, 1, 0x46, 1, false),
  por: unestablished(0), // non établi (parser.md §11.4) : 20b5:0248()
  hor: def(0, fail), // certain (parser.md §11.4) : `10dc:015c` est un stub, puis bip et retour 0
  mob: fieldWriter(2, 1, 0x06, 1, false),
  gst: fieldWriter(2, 1, 0x05, 1, false, (a0) => (a0 !== 0 ? 7 : 0)),
  inv: unestablished(0), // non établi (parser.md §11.4) : 219b:006c(objet)

  // --- groupe 9 : position, trajectoire, déplacements (11dc:000c) ---
  xpy: objectActionSpec(6, "xpy", 5),
  trj: objectActionSpec(5, "trj", 4),
  sor: unestablished(3), // non établi (parser.md §11.4) : 228e:0000(objet a2)
  att: unestablished(2), // non établi (parser.md §11.4) : 21fb:005a puis 22ef:0000
  raz: objectActionSpec(1, "raz", 0),
  get: objectActionSpec(2, "get", 1),
  let: objectActionSpec(2, "let", 1), // hypothèse (parser.md §11.4)
  mov: objectActionSpec(2, "mov", 1),
  chr: objectActionSpec(5, "chr", 4), // hypothèse (parser.md §11.4)
  sl1: def(4, (ctx) => ctx.host.sequence(1, ctx.args[3])), // hypothèse (parser.md §11.4)
  sl2: def(0, (ctx) => ctx.host.sequence(2, 0)), // hypothèse (parser.md §11.4)
  sl3: def(0, (ctx) => ctx.host.sequence(3, 0)), // hypothèse (parser.md §11.4)

  // --- groupe 10 : système (137b:0006) ---
  cle: def(2, (ctx) => {
    if (ctx.args[0] < 0 || ctx.args[0] > 9) return fail(ctx);
    ctx.host.setHandlerGate(ctx.args[0], ctx.args[1]);
  }),
  dsk: def(1, (ctx) => ctx.host.setDiskFlag(ctx.args[0])),
  isr: def(0, (ctx) => ctx.host.driverInit()),
  sem: unestablished(1), // non établi (parser.md §11.4) : `4b40 ← a0`
  nil: def(1, (ctx) => {
    ctx.flags.paused = ctx.args[0] !== 0;
  }),
  rsv: def(1, (ctx) => ctx.host.saveSlot(ctx.args[0])),
  svg: def(2, (ctx) => levelSetter(ctx, false)),
  skp: unestablished(1), // non établi (parser.md §11.4) : `4b44 ← a0`
  sau: def(0, (ctx) => ctx.host.worldFile("save")),
  res: def(0, (ctx) => ctx.host.worldFile("load")),
  pil: def(1, (ctx) => ctx.host.snapshotStack(ctx.args[0])),
  lir: def(1, (ctx) => {
    if (ctx.args[0] >= 0) ctx.host.loadScene(ctx.args[0]);
  }),
  mod: def(0, (ctx) => ctx.host.initVideo()),
};

// Groupe 7 : 8 préfixes × 3 familles, dans l'ordre de TOKEN_GROUPS (adi add ado dli ...).
LIST_OPS.forEach((op, opIndex) => {
  LIST_FAMILIES.forEach((family, familyIndex) => {
    const name = TOKEN_GROUPS[7][opIndex * 3 + familyIndex];
    SPECS[name] = def(LIST_ARITY[op], (ctx) => ctx.host.objectList(op, family, ctx.args));
  });
});

/** La table des 119 jetons, dans l'ordre de `TOKEN_GROUPS`. */
export const TOKENS: readonly TokenDef[] = TOKEN_GROUPS.flatMap((names, group) =>
  names.map((name, index): TokenDef => {
    const spec = SPECS[name];
    if (!spec) throw new Error(`Jeton sans gestionnaire : ${name}`);
    return { group, index, name, arity: spec.arity, established: spec.established ?? true, handler: spec.handler };
  }),
);

/** Le jeton `(groupe, indice)`. */
export function tokenDef(group: number, index: number): TokenDef | undefined {
  return TOKENS.find((t) => t.group === group && t.index === index);
}

// ---------------------------------------------------------------------------------------------------------------
// Tokeniseur de la saisie

/** Commande décodée : mêmes paramètres que `gm_script_dispatch`. */
export interface TokenCall {
  group: number;
  token: number;
  /** 16 entiers signés, complétés par `ABSENT_ARG`. */
  args: number[];
  text: string;
}

/** `atoi` : préfixe numérique, 0 sinon. */
function atoi(s: string): number {
  const m = /^\s*[+-]?\d+/.exec(s);
  return m ? Number.parseInt(m[0], 10) : 0;
}

/** Complète à 16 arguments avec `ABSENT_ARG` ; valeurs ramenées à 16 bits signés comme dans le jeu. */
export function padArgs(args: readonly number[]): number[] {
  const out = new Array<number>(MAX_COMMAND_ARGS).fill(ABSENT_ARG);
  for (let i = 0; i < Math.min(args.length, MAX_COMMAND_ARGS); i++) out[i] = (args[i] << 16) >> 16;
  return out;
}

/**
 * `gm_script_tokenize` (`109a:0002`, § 11.1) sur une ligne normalisée commençant par `/` : les trois caractères suivants sont
 * cherchés dans la chaîne de chaque groupe (comme `strstr`, un faux positif à cheval sur deux jetons est accepté, l'indice
 * est `position / 4`) ; ensuite les arguments (`atoi`, 16 au plus) ou, avec `*` en 6e position, le reste de la ligne en texte.
 * `null` si la ligne est trop courte ou le jeton inconnu (le moteur sonne).
 */
export function tokenizeLine(line: string): TokenCall | null {
  if (line.length < 4 || !line.startsWith("/")) return null;
  const name = line.slice(1, 4);
  for (let group = 0; group < TOKEN_GROUPS.length; group++) {
    const position = TOKEN_GROUPS[group].join(" ").indexOf(name);
    if (position === -1) continue;
    const token = Math.floor(position / 4);
    let args: number[] = [];
    let text = "";
    if (line.length > 5) {
      if (line[5] === "*") text = line.slice(7);
      else
        args = line
          .slice(5)
          .split(" ")
          .filter((part) => part !== "")
          .slice(0, MAX_COMMAND_ARGS)
          .map(atoi);
    }
    return { group, token, args: padArgs(args), text };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Répartiteur

/** Résultat d'un jeton exécuté. */
export interface DispatchResult {
  /** Faux : le répartiteur a sonné (groupe refusé, jeton inconnu ou échec du gestionnaire). */
  ok: boolean;
  /** Attente demandée par le gestionnaire. */
  wait?: TokenWait;
}

/** `gm_script_dispatch` (`124c:0002`, § 11.2) et ses gestionnaires. */
export class TokenInterpreter {
  readonly flags: ScriptFlags;

  constructor(
    readonly host: TokenHost,
    readonly control: ScriptControl,
    flags: ScriptFlags = createScriptFlags(),
  ) {
    this.flags = flags;
  }

  /** Un groupe est exécutable s'il est dans `0..10` et au plus égal au niveau `dgs` (§ 11.2). */
  groupAllowed(group: number): boolean {
    return group >= 0 && group < TOKEN_GROUPS.length && group <= this.flags.dgs;
  }

  dispatch(group: number, token: number, args: readonly number[], text = ""): DispatchResult {
    const entry = this.groupAllowed(group) ? tokenDef(group, token) : undefined;
    if (!entry) {
      this.host.bell();
      return { ok: false };
    }
    const outcome = entry.handler({ host: this.host, flags: this.flags, control: this.control, args: padArgs(args), text });
    if (outcome === false) return { ok: false };
    return outcome ? { ok: TOKEN_OK, wait: outcome } : { ok: TOKEN_OK };
  }

  /** Exécute une ligne `/jeton arguments` de la saisie ; un jeton inconnu sonne. */
  runLine(line: string): DispatchResult {
    const call = tokenizeLine(line);
    if (!call) {
      this.host.bell();
      return { ok: false };
    }
    return this.dispatch(call.group, call.token, call.args, call.text);
  }
}
