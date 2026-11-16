/**
 * Banc de parcours sans tête de Gabriel Knight (`docs/gk1/qa.md`) : une partie jouée par des actions de haut niveau,
 * exprimées sur les objets du jeu (« regarder le journal », « aller à la porte ») plutôt qu'en pixels.
 *
 * - **Reproductible** : horloge du jeu (`useGameClock`), graine de `Random` fixée, aucune attente réelle. Une image du banc
 *   est une image de la page (`ui/loop.ts`) : une image du jeu, puis le son jusqu'à l'horloge du jeu.
 * - **Objets** : acteurs (`cast`, variable globale 5) et décors cliquables (`features`, 32) de la pièce. Le point cliqué est
 *   cherché dans le rectangle de l'objet, là où `User::handleEvent` le choisirait : parmi les objets sous le pointeur, celui
 *   dont `y` est le plus grand (`OnMeAndLowY`, script 64996), le premier de la liste à égalité.
 * - **Échec lisible** : `PlayError` porte la pièce, l'image, la position de Gabriel, les textes à l'écran, la pile des
 *   scripts, les derniers appels du noyau et les avertissements ; avec `PLAY_DUMP=<dossier>`, l'image est écrite en PPM.
 * - **Points de reprise** : `checkpoint()` rend une image de sauvegarde (`engine/save.ts`) ; `Play.resume` en repart.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeCp850 } from "../../../src/data/cp850";
import { eventsOf, MouseButton, SciKey } from "../../../src/games/gk1/engine/events";
import { digitalAudioOf } from "../../../src/games/gk1/audio/digital";
import { MessageMode } from "../../../src/games/gk1/engine/ids";
import { setMessageMode } from "../../../src/games/gk1/engine/message";
import { soundManagerOf } from "../../../src/games/gk1/engine/kernel/sound";
import { runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { type Reg, SciError, toSint16 } from "../../../src/games/gk1/engine/memory";
import { lookupSelector, newLookup, readSelector, SelectorKind } from "../../../src/games/gk1/engine/object";
import { type Point, pointInPolygon } from "../../../src/games/gk1/engine/polygons";
import { canSaveGame, captureGame, parseSaveImage, restoreGame, type SaveImage } from "../../../src/games/gk1/engine/save";
import type { GameFixes } from "../../../src/games/gk1/engine/patches";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { type Frameout, frameoutOf } from "../../../src/games/gk1/render/frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../src/games/gk1/render/ids";
import type { Plane } from "../../../src/games/gk1/render/plane";
import { seqPlayerOf } from "../../../src/games/gk1/render/seq-player";
import type { Rect } from "../../../src/games/gk1/render/rect";
import { mainIndex, original } from "../data/real";

// -------------------------------------------------------------------------------------------------------------------------------
// Ce que le jeu range dans ses variables globales (script 0), lu dans les scripts désassemblés
// -------------------------------------------------------------------------------------------------------------------------------

export const Global = {
  Ego: 0,
  Game: 1,
  Room: 2,
  Cast: 5,
  RoomNumber: 11,
  PreviousRoom: 12,
  Score: 15,
  Features: 32,
  IconBar: 69,
  Inventory: 9,
  /** Sorties de la pièce (`ExitFeature`, script 21), quand elle en a. */
  Exits: 206,
  User: 80,
  /** Jour de l'histoire, 1 à 10. */
  Day: 123,
  /** Premier mot des drapeaux du jeu : le drapeau `n` est le bit `0x8000 >> (n % 16)` du mot `n / 16` (script 13). */
  Flags: 127,
} as const;

/** Verbes des curseurs (propriété `message` des icônes de la barre, script 0). */
export const Verb = {
  Walk: 13,
  Look: 7,
  Ask: 10,
  Talk: 11,
  Pickup: 12,
  Open: 6,
  Operate: 8,
  Move: 9,
} as const;

/** Dernière ligne de l'écran où le pointeur, sans cliquer, ouvre la barre d'icônes (`GKIconbar::shouldOpen` : bas de son plan). */
const ICON_BAR_BOTTOM = 31;
/** Où ranger le pointeur quand il ne sert pas : au milieu de la pièce, loin de la barre d'icônes. */
const REST_POINT = { x: 160, y: 120 };
/** Images d'arrêt, la main au joueur, après lesquelles une sortie est recliquée ; et nombre de clics au plus. */
const BLOCKED_FRAMES = 90;
const LEAVE_TRIES = 6;
/** Icône de la sacoche dans la barre d'icônes (script 0) : ouvre la fenêtre de l'inventaire. */
const INVENTORY_ICON = "icon4";
/** Propriété `exitDir` d'une sortie (`ExitFeature`), qui est aussi la valeur d'`edgeHit`. */
const ExitDirection = { North: 1, East: 2, South: 3, West: 4 } as const;

/** Pièces citées par le banc lui-même ; les parcours nomment les leurs. */
export const TITLE_ROOM = 375;
const PLAY_BUTTON = "playButt";
/** Images sans texte, la main au joueur, avant de tenir une scène pour finie (un clic peut mettre 25 images à lancer la sienne). */
const TEXT_WAIT_FRAMES = 40;
/** Images laissées à un clic pour mettre Gabriel en route, puis images d'arrêt avant de le tenir pour arrivé. */
const WALK_START_FRAMES = 20;
const WALK_STOP_FRAMES = 10;
/** Images entre deux Entrée sur une même fenêtre de texte. */
const ENTER_SPACING = 30;
const KERNEL_TAIL = 30;
const KERNEL_KEEP = 4000;
const DEFAULT_SEED = 1993;
const DEFAULT_MAX_FRAMES = 400_000;

const movies = new Map<string, Uint8Array | undefined>();

/** Fichier `SEQ/<nom>` du jeu extrait, lu une fois ; `undefined` s'il manque (le moteur passe alors la cinématique). */
function movieFile(name: string): Uint8Array | undefined {
  if (!movies.has(name)) {
    const path = resolve(original.dir, "SEQ", name);
    movies.set(name, existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined);
  }
  return movies.get(name);
}

export interface PlayOptions {
  /** Graine de `Random` (défaut : 1993). */
  seed?: number;
  /** Donne au jeu les index des voix du CD : en « texte et voix » (`setVoices`), les répliques durent ce que dure leur clip. */
  voices?: boolean;
  /** Plafond d'images pour toute la partie : au-delà, le parcours échoue. */
  maxFrames?: number;
  /** Dossier où écrire l'image de l'écran en cas d'échec (défaut : variable d'environnement `PLAY_DUMP`). */
  dumpDir?: string;
  /** Correctifs des scripts (défaut : ceux du jeu) : pour comparer une scène avec et sans l'un d'eux. */
  fixes?: GameFixes;
}

/** Un objet de la pièce : acteur ou décor cliquable. */
export interface RoomObject {
  readonly reg: Reg;
  readonly name: string;
  /** `cast` : il a une vue à l'écran ; `feature` : une zone du décor. */
  readonly kind: "cast" | "feature";
  readonly noun: number;
  readonly x: number;
  readonly y: number;
}

/** Un bouton d'un menu des scripts : son libellé et son rectangle à l'écran. */
export interface MenuChoice {
  readonly text: string;
  readonly rect: Rect;
}

export class PlayError extends Error {}

export class Play {
  readonly vm: Vm;
  readonly frameout: Frameout;
  /** Images jouées par ce banc. */
  frames = 0;
  /** Journal des actions du parcours, pour le message d'échec. */
  readonly log: string[] = [];
  private readonly maxFrames: number;
  private readonly dumpDir: string | undefined;
  private readonly lookup = newLookup();

  private constructor(options: PlayOptions) {
    this.vm = new Vm(mainIndex(), options.fixes);
    useGameClock(this.vm);
    this.vm.rng.seed(options.seed ?? DEFAULT_SEED);
    this.vm.kernel.journal.capture = true;
    this.frameout = frameoutOf(this.vm);
    // Les cinématiques `SEQ` sont jouées pour de bon, depuis les fichiers extraits (la page les charge de même).
    seqPlayerOf(this.vm).source = movieFile;
    if (options.voices) {
      // Les index des voix (durées des clips, repères des lèvres) sont lus dans le jeu extrait ; sans sortie audio, rien
      // n'est décodé : `DoAudio` rend la durée du clip au lieu du temps de lecture du texte.
      digitalAudioOf(this.vm).files = {
        has: (path) => existsSync(resolve(original.dir, path)),
        text: (path) => (existsSync(resolve(original.dir, path)) ? readFileSync(resolve(original.dir, path), "utf8") : undefined),
        load: async (path) => new Uint8Array(readFileSync(resolve(original.dir, path))),
      };
    }
    this.maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
    this.dumpDir = options.dumpDir ?? process.env.PLAY_DUMP;
  }

  /** Une partie neuve, au démarrage du jeu. */
  static boot(options: PlayOptions = {}): Play {
    const play = new Play(options);
    play.vm.boot();
    return play;
  }

  /** Une partie reprise d'un point de reprise (`checkpoint`). */
  static resume(image: SaveImage, options: PlayOptions = {}): Play {
    const play = new Play(options);
    restoreGame(play.vm, structuredClone(image));
    return play;
  }

  /** Relit un point de reprise écrit en JSON. */
  static parse(json: string): SaveImage {
    const image = parseSaveImage(JSON.parse(json));
    if (!image) throw new PlayError("point de reprise illisible (autre version du format ?)");
    return image;
  }

  // -----------------------------------------------------------------------------------------------------------------------------
  // Temps
  // -----------------------------------------------------------------------------------------------------------------------------

  /** Joue une image et rend l'état du moteur après elle. */
  private frame(): RunStatus {
    const journal = this.vm.kernel.journal;
    if (++this.frames > this.maxFrames) this.fail(`parcours trop long (${this.maxFrames} images)`);
    let status: RunStatus;
    try {
      status = runFrame(this.vm).status;
    } catch (error) {
      // Une erreur des scripts (`SciError`) porte déjà leur pile ; pour toute autre, celle du moteur dit où il a cédé.
      const detail = error instanceof SciError || !(error instanceof Error) ? String(error instanceof Error ? error.message : error) : (error.stack ?? error.message);
      this.fail(`le moteur s'est arrêté : ${detail}`);
    }
    soundManagerOf(this.vm).advanceTo(this.vm.ticks);
    if (journal.entries.length > KERNEL_KEEP) journal.entries.splice(0, journal.entries.length - KERNEL_TAIL);
    return status;
  }

  /** Joue `count` images. */
  step(count = 1): void {
    for (let i = 0; i < count; i++) {
      const status = this.frame();
      if (status !== RunStatus.Suspended) this.fail(`le jeu s'est terminé (${status})`);
    }
  }

  /**
   * Joue jusqu'à ce que le jeu s'arrête de lui-même (`GK::play` revient : fin du générique ou « Quitter » ; la page
   * retourne alors à son écran titre, `ui/loop.ts`). Rend le nombre d'images jouées ; échoue si le jeu tourne encore
   * après `maxFrames` images.
   */
  playToEnd(maxFrames = 20_000): number {
    for (let played = 1; played <= maxFrames; played++) if (this.frame() === RunStatus.Finished) return played;
    this.fail(`le jeu ne s'est pas terminé en ${maxFrames} images`);
  }

  /** Joue jusqu'à ce que `done` soit vrai ; échoue après `maxFrames` images, en disant ce qui était attendu. */
  waitUntil(done: () => boolean, maxFrames = 3000, what = "condition"): void {
    for (let waited = 0; !done(); waited++) {
      if (waited >= maxFrames) this.fail(`attendu en vain pendant ${maxFrames} images : ${what}`);
      this.step();
    }
  }

  // -----------------------------------------------------------------------------------------------------------------------------
  // Lecture de l'état du jeu
  // -----------------------------------------------------------------------------------------------------------------------------

  /** Variable locale d'un script chargé (l'état d'une scène que ses objets ne portent pas : le labyrinthe du bayou). */
  local(script: number, index: number): number {
    const loaded = this.vm.scripts.loaded(script);
    const locals = loaded && this.vm.memory.localsSegment(loaded.localsSegment);
    if (!locals || index < 0 || index >= locals.values.length) this.fail(`pas de variable locale ${index} dans le script ${script}`);
    return toSint16(locals.values[index]);
  }

  private globals(): Uint32Array {
    const script = this.vm.scripts.loaded(0);
    const locals = script && this.vm.memory.localsSegment(script.localsSegment);
    if (!locals) throw new PlayError("le script 0 n'est pas chargé");
    return locals.values;
  }

  /** Variable globale `index`, brute (nombre ou référence). */
  globalReg(index: number): Reg {
    return this.globals()[index];
  }

  /** Variable globale `index`, comme nombre signé. */
  global(index: number): number {
    return toSint16(this.globals()[index]);
  }

  room(): number {
    return this.global(Global.RoomNumber);
  }

  day(): number {
    return this.global(Global.Day);
  }

  score(): number {
    return this.global(Global.Score);
  }

  /** Drapeau `n` du jeu (procédure 0 du script 13). */
  flag(n: number): boolean {
    return (this.globals()[Global.Flags + (n >> 4)] & (0x8000 >> (n & 15))) !== 0;
  }

  has(object: Reg, name: string): boolean {
    const target = this.vm.memory.getObject(object);
    if (!target) return false;
    const selector = this.vm.selectors.find(name);
    return selector >= 0 && lookupSelector(this.vm.memory, target, selector, this.lookup) === SelectorKind.Variable;
  }

  /** Propriété `name` de `object`, brute. */
  prop(object: Reg, name: string): Reg {
    return readSelector(this.vm.memory, object, this.vm.selectors.id(name));
  }

  /** Propriété `name` de `object`, comme nombre signé. */
  num(object: Reg, name: string): number {
    return toSint16(this.prop(object, name));
  }

  get ego(): Reg {
    return this.globalReg(Global.Ego);
  }

  egoAt(): Point {
    return { x: this.num(this.ego, "x"), y: this.num(this.ego, "y") };
  }

  /** Le joueur a la main : `User` accepte les entrées et Gabriel obéit. */
  inControl(): boolean {
    const user = this.globalReg(Global.User);
    return user !== 0 && this.num(user, "input") !== 0 && this.num(user, "controls") !== 0;
  }

  /** Valeurs d'une liste des scripts (`List`, `Set`, `Cast`…). */
  elements(list: Reg): Reg[] {
    const out: Reg[] = [];
    if (list === 0 || !this.has(list, "elements")) return out;
    const elements = this.prop(list, "elements");
    if (elements === 0) return out;
    for (let at = this.vm.memory.list(elements).first; at !== 0; at = this.vm.memory.node(at)!.succ) out.push(this.vm.memory.node(at)!.value);
    return out;
  }

  /** Acteurs puis décors de la pièce, dans l'ordre où `User` les interroge. */
  objects(): RoomObject[] {
    const describe = (reg: Reg, kind: RoomObject["kind"]): RoomObject => ({
      reg,
      kind,
      name: this.vm.nameOf(reg),
      noun: this.has(reg, "noun") ? this.num(reg, "noun") : 0,
      x: this.has(reg, "x") ? this.num(reg, "x") : 0,
      y: this.has(reg, "y") ? this.num(reg, "y") : 0,
    });
    return [
      ...this.elements(this.globalReg(Global.Cast)).map((reg) => describe(reg, "cast")),
      ...this.elements(this.globalReg(Global.Features)).map((reg) => describe(reg, "feature")),
    ];
  }

  /** L'objet de la pièce de ce nom ; échoue s'il n'y est pas. */
  object(name: string): RoomObject {
    const found = this.objects().find((candidate) => candidate.name === name);
    if (!found) this.fail(`aucun objet « ${name} » dans la pièce (présents : ${this.objects().map((o) => o.name).join(", ")})`);
    return found;
  }

  present(name: string): boolean {
    return this.objects().some((candidate) => candidate.name === name);
  }

  /** Élément d'écran d'un objet nommé, sur n'importe quel plan visible (boutons des fenêtres, icônes…). */
  item(name: string) {
    for (const plane of this.frameout.planes) {
      // Les fenêtres fermées (inventaire, réglages, barre d'icônes) gardent leur plan, caché sous une priorité négative.
      if (plane.priority < 0) continue;
      for (const item of plane.items) if (item.object !== 0 && this.vm.nameOf(item.object) === name) return item;
    }
    return undefined;
  }

  /** Texte (CP850 décodé) d'un élément d'écran qui en montre un, sinon `undefined`. */
  private itemText(object: Reg, bitmap: Reg): string | undefined {
    if (object === 0 || bitmap === 0 || !this.has(object, "text")) return undefined;
    const text = this.prop(object, "text");
    if (text === 0) return undefined;
    return decodeCp850(Uint8Array.from(this.vm.memory.getString(text), (char) => char.charCodeAt(0)));
  }

  /** Les plans qui portent du texte, chacun avec ses libellés et ses boutons (`TellerButton`, `DButton`…). */
  private textPlanes(): { labels: string[]; buttons: MenuChoice[] }[] {
    const out: { labels: string[]; buttons: MenuChoice[] }[] = [];
    for (const plane of this.frameout.planes) {
      if (plane.priority < 0) continue;
      const labels: string[] = [];
      const buttons: MenuChoice[] = [];
      for (const item of plane.items) {
        const text = this.itemText(item.object, item.bitmap);
        if (text === undefined) continue;
        if (this.vm.nameOf(item.object).includes("Button")) buttons.push({ text, rect: item.screenRect });
        else labels.push(text);
      }
      if (labels.length + buttons.length > 0) out.push({ labels, buttons });
    }
    return out;
  }

  /** Textes des fenêtres de message à l'écran : les plans de texte sans bouton (une réplique, une description). */
  texts(): string[] {
    return this.textPlanes().filter((plane) => plane.buttons.length === 0).flatMap((plane) => plane.labels);
  }

  /** Choix du menu à l'écran (sujets d'un interrogatoire, boutons d'une fenêtre), de haut en bas. */
  menu(): MenuChoice[] {
    return this.textPlanes().flatMap((plane) => plane.buttons);
  }

  // -----------------------------------------------------------------------------------------------------------------------------
  // Où cliquer
  // -----------------------------------------------------------------------------------------------------------------------------

  /** Plan de la pièce (celui du `cast`). */
  private roomPlane(): Plane {
    const cast = this.globalReg(Global.Cast);
    const plane = this.frameout.findPlane(this.prop(cast, "plane"));
    if (!plane) this.fail("la pièce n'a pas de plan");
    return plane;
  }

  /** `onMe` d'un objet de la pièce au point (x, y) du plan, comme les scripts (`Feature::onMe`, `View::onMe`). */
  private onMe(object: RoomObject, x: number, y: number): boolean {
    const reg = object.reg;
    const check = this.has(reg, "onMeCheck") ? this.prop(reg, "onMeCheck") : 0;
    if (object.kind === "cast" && this.has(reg, "signal")) {
      const signal = this.prop(reg, "signal");
      if (signal & 0x0008) return false;
      if (check === 0) return this.frameout.isOnMe(reg, x, y, (signal & 0x1000) !== 0);
    }
    if (check === 0) {
      const [left, top, right, bottom] = ["nsLeft", "nsTop", "nsRight", "nsBottom"].map((name) => this.num(reg, name));
      if (left === 0 && top === 0 && right === 0 && bottom === 0) return false;
      return left <= x && x <= right && top <= y && y <= bottom;
    }
    const polygons = this.has(check, "elements") ? this.elements(check) : [check];
    return polygons.some((polygon) => pointInPolygon({ x, y }, this.polygonPoints(polygon)));
  }

  private polygonPoints(polygon: Reg): Point[] {
    const data = this.vm.memory.array(this.prop(this.prop(polygon, "points"), "data"));
    const points: Point[] = [];
    for (let i = 0; i < this.num(polygon, "size"); i++) points.push({ x: toSint16(data.get(i * 2)), y: toSint16(data.get(i * 2 + 1)) });
    return points;
  }

  /** L'objet que `User` choisirait pour un clic au point (x, y) du plan de la pièce. */
  objectAt(x: number, y: number, objects = this.objects()): RoomObject | undefined {
    let best: RoomObject | undefined;
    for (const candidate of objects) {
      if ((!best || candidate.y > best.y) && this.onMe(candidate, x, y)) best = candidate;
    }
    return best;
  }

  /** Rectangle englobant d'un objet dans le plan de la pièce. */
  private bounds(object: RoomObject): Rect {
    const reg = object.reg;
    const check = this.has(reg, "onMeCheck") ? this.prop(reg, "onMeCheck") : 0;
    if (check !== 0) {
      const points = (this.has(check, "elements") ? this.elements(check) : [check]).flatMap((polygon) => this.polygonPoints(polygon));
      return {
        left: Math.min(...points.map((p) => p.x)),
        top: Math.min(...points.map((p) => p.y)),
        right: Math.max(...points.map((p) => p.x)) + 1,
        bottom: Math.max(...points.map((p) => p.y)) + 1,
      };
    }
    if (object.kind === "cast") {
      const plane = this.roomPlane();
      const item = plane.findItem(reg);
      if (item) {
        const rect = item.screenRect;
        return { left: rect.left - plane.gameRect.left, top: rect.top - plane.gameRect.top, right: rect.right - plane.gameRect.left, bottom: rect.bottom - plane.gameRect.top };
      }
    }
    return { left: this.num(reg, "nsLeft"), top: this.num(reg, "nsTop"), right: this.num(reg, "nsRight") + 1, bottom: this.num(reg, "nsBottom") + 1 };
  }

  /**
   * Point de l'écran où cliquer pour atteindre cet objet : le point de son rectangle le plus proche du centre où `User`
   * le choisit, à l'écran et hors de la barre d'icônes. Échoue s'il est entièrement couvert.
   */
  pointOn(name: string): Point {
    const objects = this.objects();
    const target = objects.find((candidate) => candidate.name === name);
    if (!target) this.fail(`aucun objet « ${name} » dans la pièce (présents : ${objects.map((o) => o.name).join(", ")})`);
    const plane = this.roomPlane();
    const rect = this.bounds(target);
    const centre = { x: (rect.left + rect.right) >> 1, y: (rect.top + rect.bottom) >> 1 };
    let best: Point | undefined;
    let bestDistance = Infinity;
    const covering = new Set<string>();
    for (let y = Math.max(rect.top, 0); y < rect.bottom; y++) {
      const screenY = y + plane.gameRect.top;
      if (screenY <= ICON_BAR_BOTTOM || screenY >= plane.screenRect.bottom) continue;
      for (let x = Math.max(rect.left, 0); x < rect.right; x++) {
        const screenX = x + plane.gameRect.left;
        if (screenX < plane.screenRect.left || screenX >= plane.screenRect.right) continue;
        const distance = (x - centre.x) ** 2 + (y - centre.y) ** 2;
        if (distance >= bestDistance) continue;
        const hit = this.objectAt(x, y, objects);
        if (hit?.reg === target.reg) {
          best = { x: screenX, y: screenY };
          bestDistance = distance;
        } else if (hit) covering.add(hit.name);
        else covering.add("(rien)");
      }
    }
    if (!best) this.fail(`« ${name} » n'est cliquable nulle part (rectangle ${JSON.stringify(rect)}, sous : ${[...covering].join(", ")})`);
    return best;
  }

  // -----------------------------------------------------------------------------------------------------------------------------
  // Gestes
  // -----------------------------------------------------------------------------------------------------------------------------

  /** Passe le jeu en « texte et voix », narrateur compris (réglage du panneau du jeu). */
  setVoices(): void {
    setMessageMode(this.vm, MessageMode.Both, true);
  }

  /** De l'écran titre à la première pièce : attend les boutons, clique sur JOUER, et laisse l'ouverture se dérouler. */
  startGame(): string[] {
    this.note("écran titre : JOUER");
    this.waitUntil(() => this.room() === TITLE_ROOM && this.item(PLAY_BUTTON) !== undefined, 6000, "l'écran titre");
    // Le fondu d'arrivée du titre : vingt étapes de trois ticks, pendant lesquelles les boutons ne répondent pas encore.
    this.step(120);
    for (let tries = 0; this.room() === TITLE_ROOM; tries++) {
      if (tries > 20) this.fail("le bouton JOUER ne répond pas");
      this.clickItem(PLAY_BUTTON);
      this.step(20);
    }
    return this.skipText(40_000);
  }

  /** Déplace le pointeur, puis clique en (x, y) de l'écran. */
  click(x: number, y: number, button: number = MouseButton.Left): void {
    const events = eventsOf(this.vm);
    events.move(x, y);
    this.step(3);
    events.down(button, x, y);
    events.up(button, x, y);
    this.step(2);
  }

  /** Déplace le pointeur en (x, y) de l'écran sans cliquer, et laisse le jeu le voir (un réglage qui suit le pointeur). */
  point(x: number, y: number, frames = 20): void {
    eventsOf(this.vm).move(x, y);
    this.step(frames);
  }

  /** Appuie sur une touche (code SCI). */
  key(code: number): void {
    const events = eventsOf(this.vm);
    events.keyDown(code);
    events.keyUp(code);
    this.step(2);
  }

  /**
   * Joue jusqu'à ce que `done` soit vrai, en fermant d'une Entrée chaque fenêtre de texte qui passe (une réplique en cours
   * retient le jeu : `User::handleEvent` ne traite rien d'autre tant qu'elle est là). Rend les textes lus en route.
   */
  playUntil(done: () => boolean, maxFrames = 20_000, what = "condition"): string[] {
    const read: string[] = [];
    let shown = "";
    let sentAt = -ENTER_SPACING;
    for (let waited = 0; !done(); waited++) {
      if (waited >= maxFrames) this.fail(`attendu en vain pendant ${maxFrames} images : ${what}`);
      const texts = this.texts();
      const key = texts.join("\n");
      // Une seule frappe par fenêtre : une Entrée de trop, arrivée après la fermeture, vaudrait un clic dans la pièce.
      if (texts.length > 0 && (key !== shown || this.frames - sentAt >= ENTER_SPACING)) {
        if (key !== shown) read.push(...texts);
        sentAt = this.frames;
        eventsOf(this.vm).keyDown(SciKey.Enter);
        eventsOf(this.vm).keyUp(SciKey.Enter);
      }
      shown = key;
      this.step();
    }
    return read;
  }

  /**
   * Ferme les fenêtres de texte et laisse finir les scènes, jusqu'à ce que le joueur ait la main sans texte à l'écran
   * depuis un tiers de seconde (et que `until` soit vrai). Rend les textes lus. Avec `still`, attend aussi que Gabriel soit
   * arrêté : quand il marche vers l'objet d'un clic, il garde la main, et la scène ne commence qu'à son arrivée.
   */
  skipText(maxFrames = 20_000, until: () => boolean = () => true, still = false): string[] {
    let calm = 0;
    return this.playUntil(
      () => {
        calm = this.texts().length === 0 && this.inControl() && !(still && this.walking()) ? calm + 1 : 0;
        return calm > TEXT_WAIT_FRAMES && until();
      },
      maxFrames,
      "que le jeu rende la main",
    );
  }

  /** Verbe du curseur courant (propriété `message` de l'icône choisie), 0 s'il n'y en a pas. */
  verb(): number {
    const icon = this.prop(this.globalReg(Global.IconBar), "curIcon");
    return icon === 0 ? 0 : this.num(icon, "message");
  }

  /** Choisit un curseur d'action par le bouton droit, qui les fait défiler (manuel, « Interface »). */
  selectVerb(verb: number): void {
    if (this.verb() === verb) return;
    // Pendant une scène, le curseur est celui de l'attente : on la laisse finir.
    this.skipText();
    const plane = this.roomPlane().screenRect;
    const at = { x: (plane.left + plane.right) >> 1, y: plane.bottom - 4 };
    for (let tries = 0; this.verb() !== verb; tries++) {
      if (tries > 16) this.fail(`curseur du verbe ${verb} introuvable (courant : ${this.verb()})`);
      this.click(at.x, at.y, MouseButton.Right);
      this.step(4);
    }
  }

  /**
   * Applique un verbe à un objet de la pièce : choisit le curseur, clique sur l'objet, puis laisse la scène se jouer et
   * ferme ses textes. Rend les textes lus.
   */
  use(verb: number, name: string, options: { at?: Point; settle?: boolean } = {}): string[] {
    this.note(`verbe ${verb} sur ${name}`);
    this.selectVerb(verb);
    const at = options.at ?? this.pointOn(name);
    this.click(at.x, at.y);
    return options.settle === false ? [] : this.skipText(20_000, undefined, true);
  }

  /** Clique au milieu d'un élément d'écran nommé (icône, bouton d'une fenêtre, objet de l'inventaire). */
  clickItem(name: string): void {
    const item = this.item(name);
    if (!item) this.fail(`« ${name} » n'est pas à l'écran`);
    const rect = item.screenRect;
    this.click((rect.left + rect.right) >> 1, (rect.top + rect.bottom) >> 1);
  }

  /** Objets que Gabriel porte (noms des scripts : `tweezers`, `magGlass`…). */
  carried(): string[] {
    return this.elements(this.globalReg(Global.Inventory))
      .filter((item) => this.has(item, "owner") && this.prop(item, "owner") === this.ego)
      .map((item) => this.vm.nameOf(item));
  }

  /** Ouvre la fenêtre de l'inventaire par la barre d'icônes et la fait défiler jusqu'à l'objet. */
  private openInventory(item: string): void {
    if (!this.carried().includes(item)) this.fail(`Gabriel n'a pas « ${item} » (il porte : ${this.carried().join(", ")})`);
    this.skipText();
    // Le pointeur en haut de l'écran ouvre la barre ; son icône de la sacoche ouvre la fenêtre.
    eventsOf(this.vm).move(SCREEN_WIDTH >> 1, 3);
    this.waitUntil(() => this.item(INVENTORY_ICON) !== undefined, 300, "l'ouverture de la barre d'icônes");
    this.step(10);
    this.clickItem(INVENTORY_ICON);
    this.waitUntil(() => this.item("invExit") !== undefined, 300, "l'ouverture de l'inventaire");
    this.step(10);
    this.scrollInventoryTo(item);
  }

  /** Fait défiler la fenêtre de l'inventaire, vers le bas puis vers le haut, jusqu'à ce que l'objet y soit. */
  private scrollInventoryTo(item: string): void {
    for (const arrow of ["invDown", "invUp"]) {
      for (let page = 0; page < 8 && !this.item(item); page++) {
        this.clickItem(arrow);
        this.step(10);
      }
    }
    if (!this.item(item)) this.fail(`« ${item} » introuvable dans la fenêtre de l'inventaire`);
  }

  /** Referme la fenêtre de l'inventaire si elle est ouverte. */
  private closeInventory(): void {
    if (!this.item("invExit")) return;
    this.clickItem("invExit");
    this.waitUntil(() => this.item("invExit") === undefined, 300, "la fermeture de l'inventaire");
    this.step(10);
  }

  /**
   * Dans la fenêtre de l'inventaire, prend un objet comme curseur et le pose sur un autre (la loupe sur une écaille, une
   * écaille sur l'autre). Referme la fenêtre et rend les textes lus.
   */
  combine(item: string, onto: string): string[] {
    this.note(`inventaire : ${item} sur ${onto}`);
    if (!this.carried().includes(onto)) this.fail(`Gabriel n'a pas « ${onto} » (il porte : ${this.carried().join(", ")})`);
    this.openInventory(item);
    this.clickItem("invSelect");
    this.step(6);
    this.clickItem(item);
    this.step(10);
    this.scrollInventoryTo(onto);
    this.clickItem(onto);
    const read = this.playUntil(() => this.texts().length === 0 && (this.item("invExit") !== undefined || this.insetOpen() || this.inControl()), 20_000, "la fin de la combinaison");
    this.step(10);
    read.push(...this.playUntil(() => this.texts().length === 0, 20_000, "la fin des textes de l'inventaire"));
    this.closeInventory();
    return read;
  }

  /**
   * Ouvre la fenêtre de l'inventaire par la barre d'icônes et agit sur un objet : `select` le prend comme curseur (le
   * prochain clic dans la pièce l'utilise), `look`, `read` et `open` lui appliquent ce bouton de la fenêtre. Referme la
   * fenêtre et rend les textes lus.
   */
  inventory(item: string, action: "select" | "look" | "read" | "open" = "select"): string[] {
    this.note(`inventaire : ${action} ${item}`);
    this.openInventory(item);
    const button = { select: "invSelect", look: "invLook", read: "invRead", open: "invOpen" }[action];
    this.clickItem(button);
    this.step(6);
    this.clickItem(item);
    const read = this.playUntil(() => this.texts().length === 0 && (this.item("invExit") !== undefined || this.insetOpen()), 20_000, "le retour à la fenêtre de l'inventaire");
    this.step(10);
    read.push(...this.playUntil(() => this.texts().length === 0, 20_000, "la fin des textes de l'inventaire"));
    // Regarder certains objets (une photo, une lettre) ferme la fenêtre et montre l'objet en gros plan : `closeInset`.
    if (!this.item("invExit")) return read;
    this.clickItem("invExit");
    this.waitUntil(() => this.item("invExit") === undefined, 300, "la fermeture de l'inventaire");
    this.step(10);
    return read;
  }

  /** Un gros plan (`Inset`, script 64923) est ouvert sur la pièce. */
  insetOpen(): boolean {
    const room = this.globalReg(Global.Room);
    return room !== 0 && this.has(room, "inset") && this.prop(room, "inset") !== 0;
  }

  /** Ferme le gros plan ouvert : un clic à côté de lui (`Inset::handleEvent`, `disposeNotOnMe`), puis l'inventaire s'il revient. */
  closeInset(): void {
    this.note("ferme le gros plan");
    const inset = this.prop(this.globalReg(Global.Room), "inset");
    const plane = this.frameout.findPlane(this.prop(inset, "plane"));
    const rect = plane?.screenRect ?? { left: 0, top: 0, right: 0, bottom: 0 };
    // Un point de la pièce hors du gros plan : à sa gauche s'il y a la place, sinon à sa droite.
    const at = { x: rect.left > 12 ? rect.left >> 1 : Math.min(rect.right + 10, SCREEN_WIDTH - 2), y: Math.max(ICON_BAR_BOTTOM + 10, (rect.top + rect.bottom) >> 1) };
    this.click(at.x, at.y);
    this.playUntil(() => !this.insetOpen(), 600, "la fermeture du gros plan");
    this.step(20);
    // Un gros plan ouvert depuis l'inventaire y ramène (`invInset::dispose`, script 23) : on referme la fenêtre.
    if (this.item("invExit")) {
      this.clickItem("invExit");
      this.waitUntil(() => this.item("invExit") === undefined, 300, "la fermeture de l'inventaire");
      this.step(10);
    }
    this.skipText();
  }

  /**
   * Utilise un objet de l'inventaire sur un objet de la pièce. Rend les textes lus. Avec `settle: false`, n'attend pas que
   * le joueur ait la main (la scène ouvre un menu : l'appelant attend ce menu).
   */
  useItem(item: string, target: string, options: { at?: Point; settle?: boolean } = {}): string[] {
    this.inventory(item);
    this.note(`${item} sur ${target}`);
    const at = options.at ?? this.pointOn(target);
    this.click(at.x, at.y);
    return options.settle === false ? [] : this.skipText(20_000, undefined, true);
  }

  /**
   * Choisit un sujet dans le menu d'un interrogatoire (ou un bouton d'une fenêtre) par son libellé exact, puis ferme les
   * répliques jusqu'au retour du menu, ou jusqu'à ce que `until` soit vrai. Rend les répliques lues.
   */
  talkTopic(text: string, until: () => boolean = () => this.menu().length > 0, maxFrames = 20_000): string[] {
    this.note(`sujet « ${text} »`);
    this.waitUntil(() => this.menu().length > 0, 600, "un menu à l'écran");
    const choice = this.menu().find((candidate) => candidate.text === text);
    if (!choice) this.fail(`pas de sujet « ${text} » (menu : ${this.menu().map((c) => c.text).join(" / ")})`);
    this.click((choice.rect.left + choice.rect.right) >> 1, (choice.rect.top + choice.rect.bottom) >> 1);
    this.waitUntil(() => this.menu().length === 0 || !this.menu().some((c) => c.text === text), 600, "la fermeture du menu");
    // Un sous-menu s'affiche en haut de l'écran : laissé là, le pointeur ouvrirait la barre d'icônes au retour dans la
    // pièce, et la barre ouverte suspend le jeu.
    eventsOf(this.vm).move(REST_POINT.x, REST_POINT.y);
    return this.playUntil(() => this.texts().length === 0 && until(), maxFrames, `la fin des répliques sur « ${text} »`);
  }

  /** Sur une carte (pièces 200 et 205) : clique sur une destination et attend l'arrivée dans une autre pièce. */
  travel(destination: string, maxFrames = 6000): void {
    this.note(`carte : ${destination}`);
    const from = this.room();
    // La carte tourne dans sa propre boucle, la main retirée au joueur : seule la présence de l'icône compte.
    this.waitUntil(() => this.item(destination) !== undefined, 1200, `la destination « ${destination} » sur la carte`);
    this.step(60);
    const rect = this.item(destination)!.screenRect;
    this.click((rect.left + rect.right) >> 1, (rect.top + rect.bottom) >> 1);
    this.playUntil(() => this.room() !== from, maxFrames, `quitter la carte vers « ${destination} »`);
  }

  /**
   * Sort de la pièce par une de ses sorties (`ExitFeature`, script 21 : `northExit`, `westExit`…) ou, sans nom, en marchant
   * vers le point (x, y) de la pièce ; attend l'arrivée dans une autre pièce et que le joueur y ait la main.
   */
  leave(exit: string | Point, maxFrames = 6000): void {
    const from = this.room();
    this.note(`sortie par ${typeof exit === "string" ? exit : JSON.stringify(exit)}`);
    this.selectVerb(Verb.Walk);
    const plane = this.roomPlane();
    let at: Point;
    if (typeof exit === "string") {
      const feature = this.elements(this.globalReg(Global.Exits)).find((candidate) => this.vm.nameOf(candidate) === exit);
      if (feature === undefined) this.fail(`pas de sortie « ${exit} » ici`);
      const [left, top, right, bottom] = ["nsLeft", "nsTop", "nsRight", "nsBottom"].map((name) => this.num(feature, name));
      // La sortie n'est qu'un curseur : c'est le bord de la pièce qui fait sortir (`GKEgo::doit`, `edgeHit`). On vise donc
      // le côté extérieur de la zone, celui que Gabriel doit atteindre.
      const direction = this.num(feature, "exitDir");
      at = { x: (left + right) >> 1, y: (top + bottom) >> 1 };
      if (direction === ExitDirection.North) at.y = Math.min(bottom, this.num(this.globalReg(Global.Room), "horizon"));
      else if (direction === ExitDirection.East) at.x = right;
      else if (direction === ExitDirection.South) at.y = bottom;
      else if (direction === ExitDirection.West) at.x = left;
    } else at = exit;
    const target = { x: at.x + plane.gameRect.left, y: Math.max(at.y + plane.gameRect.top, ICON_BAR_BOTTOM + 1) };
    this.click(target.x, target.y);
    // Un passant sur le chemin arrête Gabriel (son mouvement finit là, la main lui reste) : le joueur recliquerait.
    let stopped = 0;
    let clicks = 1;
    this.playUntil(
      () => {
        if (this.room() !== from) return true;
        stopped = this.inControl() && this.texts().length === 0 && !this.walking() ? stopped + 1 : 0;
        if (stopped > BLOCKED_FRAMES && clicks < LEAVE_TRIES) {
          this.note(`arrêté en ${JSON.stringify(this.egoAt())} : nouveau clic vers la sortie`);
          this.click(target.x, target.y);
          stopped = 0;
          clicks++;
        }
        return false;
      },
      maxFrames,
      `quitter la pièce ${from}`,
    );
    this.skipText();
  }

  /** Marche vers le point (x, y) de la pièce et attend l'arrêt. Rend la position d'arrivée. */
  walkTo(x: number, y: number): Point {
    this.note(`marche vers (${x}, ${y})`);
    this.selectVerb(Verb.Walk);
    const plane = this.roomPlane();
    this.click(x + plane.gameRect.left, y + plane.gameRect.top);
    this.waitStill();
    return this.egoAt();
  }

  /**
   * Gabriel est en route : il a un mouvement, ou il se tourne avant de repartir (son mouvement est alors mis de côté dans
   * `oldMover` de son `Grooper`, script 64977).
   */
  walking(): boolean {
    if (this.prop(this.ego, "mover") !== 0) return true;
    const looper = this.prop(this.ego, "looper");
    return looper !== 0 && this.has(looper, "oldMover") && this.prop(looper, "oldMover") !== 0;
  }

  /** Attend que Gabriel parte (s'il doit partir) puis qu'il soit arrêté, en fermant les textes qui passent. */
  waitStill(maxFrames = 6000): void {
    for (let waited = 0; waited < WALK_START_FRAMES && !this.walking(); waited++) this.step();
    let still = 0;
    this.playUntil(
      () => {
        still = this.walking() || this.texts().length > 0 ? 0 : still + 1;
        return still > WALK_STOP_FRAMES;
      },
      maxFrames,
      "l'arrêt de Gabriel",
    );
  }

  // -----------------------------------------------------------------------------------------------------------------------------
  // Points de reprise et diagnostic
  // -----------------------------------------------------------------------------------------------------------------------------

  /** Un point de reprise est possible : le jeu est lancé et hors cinématique. */
  canCheckpoint(): boolean {
    return this.vm.scripts.loaded(0) !== undefined && this.safeRoom() !== 0 && canSaveGame(this.vm);
  }

  /** Image de sauvegarde de la partie, quand le jeu peut être sauvé (pas pendant une cinématique). */
  checkpoint(name = ""): SaveImage {
    if (!canSaveGame(this.vm)) this.fail(`pas de point de reprise possible ici (${name})`);
    return captureGame(this.vm, name);
  }

  note(action: string): void {
    this.log.push(`[${this.frames}] pièce ${this.safeRoom()} : ${action}`);
  }

  private safeRoom(): number {
    try {
      return this.room();
    } catch {
      return 0;
    }
  }

  /** État lisible de la partie : ce que le message d'échec rapporte. */
  describe(): string {
    const lines: string[] = [];
    const safe = (label: string, read: () => string): void => {
      try {
        lines.push(`${label} : ${read()}`);
      } catch (error) {
        lines.push(`${label} : illisible (${error instanceof Error ? error.message : String(error)})`);
      }
    };
    safe("pièce", () => `${this.room()} (jour ${this.day()}, score ${this.score()})`);
    lines.push(`image : ${this.frames} (horloge ${this.vm.ticks})`);
    safe("Gabriel", () => `${JSON.stringify(this.egoAt())}, main au joueur : ${this.inControl()}, verbe ${this.verb()}`);
    safe("textes", () => JSON.stringify(this.texts()));
    safe("objets", () => this.objects().map((o) => o.name).join(", "));
    lines.push(`dernières actions :\n  ${this.log.slice(-8).join("\n  ")}`);
    safe("pile des scripts", () => this.vm.backtrace().slice(0, 12).join(" < "));
    lines.push(`derniers appels du noyau :\n  ${this.vm.kernel.journal.entries.slice(-KERNEL_TAIL).join("\n  ")}`);
    lines.push(`avertissements : ${[...this.vm.warnings].map(([message, count]) => `${message} ×${count}`).join(" ; ") || "aucun"}`);
    lines.push(`souches du noyau : ${[...this.vm.kernel.journal.stubs.keys()].join(", ") || "aucune"}`);
    return lines.join("\n");
  }

  /** Écrit l'image présentée (curseur compris) en PPM ; rend le chemin. */
  dump(dir: string, name: string): string {
    mkdirSync(dir, { recursive: true });
    const pixels = this.frameout.present();
    const palette = this.frameout.palette.screen;
    const stride = palette.length / 256;
    const header = Buffer.from(`P6\n${SCREEN_WIDTH} ${SCREEN_HEIGHT}\n255\n`, "ascii");
    const body = Buffer.alloc(SCREEN_WIDTH * SCREEN_HEIGHT * 3);
    for (let i = 0; i < pixels.length; i++) {
      body[i * 3] = palette[pixels[i] * stride];
      body[i * 3 + 1] = palette[pixels[i] * stride + 1];
      body[i * 3 + 2] = palette[pixels[i] * stride + 2];
    }
    const path = resolve(dir, `${name}.ppm`);
    writeFileSync(path, Buffer.concat([header, body]));
    return path;
  }

  /** Arrête le parcours avec un message complet. */
  fail(message: string): never {
    let dumped = "";
    if (this.dumpDir) {
      try {
        dumped = `\nimage : ${this.dump(this.dumpDir, `echec-${this.safeRoom()}-${this.frames}`)}`;
      } catch (error) {
        dumped = `\nimage non écrite : ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    throw new PlayError(`${message}\n${this.describe()}${dumped}`);
  }
}
