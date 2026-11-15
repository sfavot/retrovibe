/**
 * Joueur de la solution des *Voyageurs du temps* (vague K) : une solution est une liste d'étapes (`Step[]`, des données dans
 * `walkthrough.ts`) que `Driver.run` joue par de **vraies entrées** (clics, touches F1 à F6 des verbes, choix dans le menu des objets
 * portés), sans jamais écrire l'état du jeu. Toutes les entrées sont enregistrées au format du banc (`inputs.ts`) : le banc ScummVM les
 * rejoue à l'identique (`scummvm-replay.test.ts`).
 *
 * Règles de l'interface (engine.md § 4) :
 * - un verbe est choisi au clavier au début d'un tick (`k examine`…), puis l'objet est cliqué au tick suivant ; UTILISER ouvre d'abord le
 *   menu des objets portés, où `Driver` choisit la ligne de l'objet (survol, puis appui et relâchement, dans les attentes modales) ;
 * - un objet n'est cliquable que par un pixel de son masque, hors de sa ligne du haut, et s'il est le calque le plus haut à cet endroit :
 *   `clickPoint` cherche le pixel le plus central qui désigne l'objet (`objectUnderCursor`, la fonction même du moteur) ;
 * - un clic gauche sans verbe donne la cible de marche (globales 249 / 250) ; la marche est scriptée par le jeu ;
 * - un message attend un clic : `Driver` clique au premier tour de chaque attente (`n@k c x y 1`).
 *
 * | Étape | Ce que fait le joueur |
 * | --- | --- |
 * | `{ walk: [x, y] }` | clic gauche sur le sol, puis attente que le héros s'arrête |
 * | `{ look \| take \| act \| talk: "nom#idx" }` | verbe EXAMINER, PRENDRE, ACTIONNER, PARLER puis clic sur l'objet |
 * | `{ use: "nom#idx", on: "nom#idx" }` | UTILISER, choix de l'objet porté dans le menu, clic sur la cible |
 * | `{ click: "nom#idx" }` | clic gauche direct sur l'objet (relation du verbe 6 : sorties, échelles, Crughons) |
 * | `{ walks: [[x, y], …], until, what }` | marcher vers ces points tour à tour jusqu'à la condition (sortie qui dépend de la phase du pas) |
 * | `{ wait: n }` | laisser passer n ticks |
 * | `{ until, what, max? }` | laisser passer des ticks jusqu'à la condition |
 * | `{ run, what }` | séquence de joueur écrite à la main (le tir des Crughons) |
 *
 * Options : `at` (point de clic imposé), `idle: false` (ne pas attendre la main après l'action), `expect` (condition vérifiée après
 * l'étape), `note`. Une action qui produit le message d'échec du moteur (aucune relation pour ce verbe et cet objet) **lève** une erreur,
 * comme une étape qui ne rend pas la main : l'erreur décrit l'état (décor, héros, scripts, derniers textes).
 */

import { decodeMessageText } from "../../../src/games/voyageurs/data/msg";
import type { VoyageursEngine } from "../../../src/games/voyageurs/engine/game";
import type { TestHost } from "../../../src/games/voyageurs/engine/host";
import { objectUnderCursor } from "../../../src/games/voyageurs/engine/input";
import { parseSave } from "../../../src/games/voyageurs/engine/save";
import { type FrameView, NullRenderer } from "../../../src/games/voyageurs/engine/services";
import { type EngineState, OverlayType, objectsWithCostume } from "../../../src/games/voyageurs/engine/state";
import { FAILURE_MESSAGES } from "../../../src/games/voyageurs/engine/texts";
import { formatInput, makeTracedEngine, ModalTracker, parseOp, type RecordedInput } from "./inputs";

/** Source d'une attente modale (`EventSource`) et condition de fin (`EventTarget`). */
const SRC_MESSAGE = 1;
const SRC_MENU = 2;
const SRC_SYSTEM_MENU = 3;
const SRC_INVENTORY = 5;
const SRC_WAIT_INPUT = 6;
const TGT_BUTTON_UP = 2;
const TGT_EMPTY_QUEUE = 9;
const TGT_MENU_CHOICE = 6;

/** Ticks sans mouvement du héros après lesquels il est arrêté (la marche scriptée peut attendre un tick ou deux avant de partir). */
const STILL_TICKS = 4;
const BLOCKED_TICKS = 16;

/** Sens de la marche des scripts du jeu (0 : arrêt ; 1 droite / bas, 2 gauche / haut). */
const VAR_WALK_X = 253;
const VAR_WALK_Y = 251;

/** Ticks laissés à la marche pour partir après un clic. */
const WALK_START_TICKS = 12;

const VERB_KEYS = { look: "examine", take: "take", act: "activate", talk: "speak" } as const;
const VERB_INDEX = { look: 0, take: 1, use: 3, act: 4, talk: 5 } as const;

export interface StepCommon {
  /** Point de clic imposé sur l'objet ou le sol. */
  at?: [number, number];
  /** Attendre la main après l'action (vrai par défaut). */
  idle?: boolean;
  /** Ticks d'attente au plus pour retrouver la main. */
  max?: number;
  /** Condition vérifiée à la fin de l'étape. */
  expect?: (d: Driver) => boolean;
  note?: string;
}

export type Step = StepCommon &
  (
    | { walk: [number, number] }
    | { look: string }
    | { take: string }
    | { act: string }
    | { talk: string }
    | { use: string; on: string }
    | { click: string }
    | { walks: [number, number][]; until: (d: Driver) => boolean; what: string; tries?: number }
    | { wait: number }
    | { until: (d: Driver) => boolean; what: string }
    | { run: (d: Driver) => void; what: string }
  );

/** Rendu nul qui relève les textes affichés (messages des scripts et messages d'échec du moteur). */
class TextCapture extends NullRenderer {
  readonly texts: string[] = [];
  failures = 0;

  override drawFrame(view: FrameView): void {
    const { state } = view;
    for (const overlay of state.overlays) {
      if (overlay.type === OverlayType.Message) {
        const raw = state.messages[overlay.objIdx];
        if (raw) this.texts.push(decodeMessageText(raw));
      } else if (overlay.type === OverlayType.Failure) {
        this.failures++;
        this.texts.push(`[échec] ${FAILURE_MESSAGES[overlay.failure ?? 0] ?? ""}`);
      }
    }
  }
}

export class Driver {
  readonly engine: VoyageursEngine;
  readonly host: TestHost;
  /** Entrées jouées, au format du banc. */
  readonly record: RecordedInput[] = [];
  /** Lignes `TK` du moteur (comparaison au banc). */
  readonly tkLines: string[] = [];
  readonly texts: string[];
  private readonly capture = new TextCapture();
  private readonly tracker = new ModalTracker();
  /** Lignes à choisir dans les prochains menus, dans l'ordre (une par menu). */
  private menuQueue: number[] = [];
  private heroLast = "";
  private heroStill = 0;
  /** L'attente d'entrée de la pause (menu système) n'est pas levée par un clic (`pause`). */
  private holdPause = false;

  constructor(options: { keepTk?: boolean } = {}) {
    this.texts = this.capture.texts;
    const keepTk = options.keepTk ?? true;
    const made = makeTracedEngine(
      (line) => {
        this.tracker.line(line);
        if (keepTk && line.startsWith("TK ")) this.tkLines.push(line);
      },
      (source) => this.onModalPoll(source),
      { renderer: this.capture },
    );
    this.engine = made.engine;
    this.host = made.host;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // État lu (jamais écrit)

  get state(): EngineState {
    return this.engine.state;
  }

  get bg(): string {
    return this.state.names.bg;
  }

  get hero(): { x: number; y: number; frame: number; costume: number; mask: number } {
    return this.state.objects[1]!;
  }

  /** Zone de la carte de collision au pixel (x, y) (`zoneData` appliquée), 0 hors de l'écran. */
  zoneAt(x: number, y: number): number {
    if (x < 0 || x >= 320 || y < 0 || y >= 200) return 0;
    return this.state.zoneData[this.state.collision[y * 320 + x]!]!;
  }

  /** L'objet est porté (costume −2). */
  has(ref: string): boolean {
    return this.state.objects[this.resolve(ref)]!.costume === -2;
  }

  /** Un texte affiché contient `fragment`. */
  saw(fragment: string): boolean {
    return this.texts.some((t) => t.includes(fragment));
  }

  /** Ticks depuis le dernier mouvement du héros. */
  get stillFor(): number {
    return this.heroStill;
  }

  /** Le script de marche (script global 10 de chaque PRC : il lit la cible des globales 249 / 250) tourne. */
  get walking(): boolean {
    return this.state.globalScripts.some((s) => s.index === 10);
  }

  /**
   * Le joueur a la main : entrées permises, script de marche actif (les cinématiques l'arrêtent), aucun script d'objet en cours, aucun verbe
   * en cours, héros arrêté (sens de marche horizontal et vertical à 0 : globales 253 et 251, et quelques ticks sans bouger ; la marche
   * verticale marque des pauses de plusieurs ticks).
   */
  get idle(): boolean {
    const s = this.state;
    // Un héros bloqué contre un obstacle peut garder son sens de marche : il est alors arrêté au bout de `BLOCKED_TICKS`.
    const flags = s.globals[VAR_WALK_X]! === 0 && s.globals[VAR_WALK_Y]! === 0;
    const still = (flags && this.heroStill >= STILL_TICKS) || this.heroStill >= BLOCKED_TICKS;
    return s.allowPlayerInput !== 0 && this.walking && s.objectScripts.length === 0 && s.playerCommand === -1 && still;
  }

  describe(): string {
    const s = this.state;
    const h = this.hero;
    const scripts = (list: { index: number; pos: number }[]) => list.map((x) => `${x.index}:${x.pos}`).join(",") || "-";
    const carried = objectsWithCostume(s, -2).map((i) => `${s.objects[i]!.name}#${i}`).join(", ");
    return [
      `tick ${this.engine.ticks}, décor ${s.names.bg}, ${s.names.prc}, entrées ${s.allowPlayerInput ? "permises" : "bloquées"}`,
      `héros (${h.x},${h.y}) frame ${h.frame} costume ${h.costume} mask ${h.mask}, pieds en zone ${this.zoneAt(h.x + 8, h.y + 31)}`,
      `marche : cible (${s.globals[249]},${s.globals[250]}) sens x ${s.globals[VAR_WALK_X]} y ${s.globals[VAR_WALK_Y]}, immobile depuis ${this.heroStill} ticks`,
      `scripts g=${scripts(s.globalScripts)} o=${scripts(s.objectScripts)}`,
      `porté : ${carried || "rien"}`,
      `textes : ${this.texts.slice(-4).map((t) => `« ${t.slice(0, 70)} »`).join(" ")}`,
    ].join("\n");
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Entrées

  /** Entrée livrée au début du prochain tick (`n op`). */
  press(op: string): void {
    if (!this.engine.betweenTicks) throw new Error("entrée hors d'une frontière de tick");
    this.record.push({ tick: this.engine.ticks + 1, wait: 0, op });
    this.engine.input(...parseOp(op));
    this.heroStill = 0;
  }

  private modalInput(op: string): void {
    this.record.push({ tick: this.tracker.tick, wait: this.tracker.index, op });
    this.engine.input(...parseOp(op));
  }

  /** Premier tour d'une attente modale : clic sur un message, choix dans un menu, fermeture de l'inventaire. */
  private onModalPoll(source: number): void {
    if (!this.tracker.takeFresh()) return;
    const { x, y, left, right } = this.engine.mouse;
    const target = this.tracker.target;
    if (source === SRC_WAIT_INPUT && this.holdPause) return;
    if (source === SRC_MESSAGE || source === SRC_INVENTORY || source === SRC_WAIT_INPUT) {
      this.modalInput(`c ${x} ${y} 1`);
      return;
    }
    if (source !== SRC_MENU && source !== SRC_SYSTEM_MENU) throw new Error(`attente modale inattendue (source ${source}) :\n${this.describe()}`);
    if (target === TGT_BUTTON_UP) {
      if (left || right) this.modalInput(`u ${x} ${y} ${left ? 1 : 2}`);
      return;
    }
    if (target === TGT_EMPTY_QUEUE) return;
    if (target !== TGT_MENU_CHOICE) throw new Error(`attente de menu inattendue (condition ${target})`);
    const menu = this.engine.menus[this.engine.menus.length - 1];
    const want = this.menuQueue[0];
    if (!menu || want === undefined) {
      // Menu imprévu : annulé par un clic droit.
      this.modalInput(`c ${x} ${y} 2`);
      return;
    }
    const mx = menu.x + Math.trunc(menu.width / 2);
    const my = menu.y + 8 + want * 9;
    if (menu.selection === want) {
      this.modalInput(`d ${mx} ${my} 1`);
      this.menuQueue.shift();
    } else {
      this.modalInput(`m ${mx} ${my}`);
    }
  }

  /** Un tick (les attentes modales sont servies en route). */
  tick(count = 1): void {
    for (let i = 0; i < count; i++) {
      if (!this.engine.runTick(50_000)) throw new Error(`moteur bloqué :\n${this.describe()}`);
      const h = this.hero;
      const key = `${h.x},${h.y}`;
      this.heroStill = key === this.heroLast ? this.heroStill + 1 : 0;
      this.heroLast = key;
    }
  }

  waitIdle(max = 3000): void {
    for (let i = 0; i < max; i++) {
      if (this.idle) return;
      this.tick();
    }
    throw new Error(`la main ne revient pas en ${max} ticks :\n${this.describe()}`);
  }

  until(predicate: (d: Driver) => boolean, what: string, max = 3000): void {
    for (let i = 0; i < max; i++) {
      if (predicate(this)) return;
      this.tick();
    }
    throw new Error(`« ${what} » n'arrive pas en ${max} ticks :\n${this.describe()}`);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Objets

  /** `nom#idx` → idx, après contrôle du nom dans la table des objets. */
  resolve(ref: string): number {
    const at = ref.lastIndexOf("#");
    const idx = Number(ref.slice(at + 1));
    const name = ref.slice(0, at);
    const actual = this.state.objects[idx]?.name;
    if (at < 0 || !Number.isInteger(idx) || actual !== name) throw new Error(`objet ${ref} : la table dit « ${actual} »\n${this.describe()}`);
    return idx;
  }

  /** Pixel le plus central qui désigne l'objet sous le curseur (`objectUnderCursor`), ou `null`. */
  findClickPoint(idx: number): [number, number] | null {
    const obj = this.state.objects[idx]!;
    const anim = this.state.anims[Math.abs(obj.frame)];
    if (!anim) return null;
    // Boîte de recherche : celle du test de `getObjectUnderCursor` (largeur `var1 << 4` ou `(width / 2) << 4`).
    const width = Math.max(anim.var1 << 4, Math.trunc(anim.width / 2) << 4);
    const hits: [number, number][] = [];
    for (let y = Math.max(0, obj.y); y < Math.min(200, obj.y + anim.height); y++) {
      for (let x = Math.max(0, obj.x); x < Math.min(320, obj.x + width); x++) if (objectUnderCursor(this.state, x, y) === idx) hits.push([x, y]);
    }
    if (!hits.length) return null;
    const cx = hits.reduce((a, [x]) => a + x, 0) / hits.length;
    const cy = hits.reduce((a, [, y]) => a + y, 0) / hits.length;
    let best = hits[0]!;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of hits) {
      const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** `findClickPoint`, ou une erreur si l'objet n'est pas cliquable. */
  clickPoint(idx: number): [number, number] {
    const point = this.findClickPoint(idx);
    if (!point) throw new Error(`objet ${this.state.objects[idx]!.name}#${idx} non cliquable\n${this.describe()}`);
    return point;
  }

  private clickObject(idx: number, at?: [number, number]): void {
    const [x, y] = at ?? this.clickPoint(idx);
    if (objectUnderCursor(this.state, x, y) !== idx) throw new Error(`(${x},${y}) ne désigne pas ${this.state.objects[idx]!.name}#${idx}`);
    this.press(`c ${x} ${y} 1`);
    this.tick();
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Étapes

  run(step: Step): void {
    const failures = this.capture.failures;
    if ("walk" in step) {
      const [x, y] = step.walk;
      const { x: hx, y: hy } = this.hero;
      this.press(`c ${x} ${y} 1`);
      // La marche peut ne partir qu'après quelques ticks : attendre le premier pas (ou constater que le héros est déjà arrivé).
      for (let i = 0; i < WALK_START_TICKS && this.hero.x === hx && this.hero.y === hy; i++) this.tick();
    } else if ("use" in step) {
      const item = this.resolve(step.use);
      const target = this.resolve(step.on);
      const list = objectsWithCostume(this.state, -2).slice(0, 20);
      const row = list.indexOf(item);
      if (row < 0) throw new Error(`${step.use} n'est pas porté\n${this.describe()}`);
      this.menuQueue = [row];
      this.press("k use");
      this.tick();
      this.menuQueue = [];
      if (this.state.playerCommand !== VERB_INDEX.use || this.state.commandVar3[0] !== item) throw new Error(`UTILISER ${step.use} : choix refusé\n${this.describe()}`);
      this.clickObject(target, step.at);
    } else if ("look" in step || "take" in step || "act" in step || "talk" in step) {
      const [verb, ref] = "look" in step ? (["look", step.look] as const) : "take" in step ? (["take", step.take] as const) : "act" in step ? (["act", step.act] as const) : (["talk", step.talk] as const);
      const idx = this.resolve(ref);
      this.press(`k ${VERB_KEYS[verb]}`);
      this.tick();
      if (this.state.playerCommand !== VERB_INDEX[verb]) throw new Error(`verbe ${verb} refusé\n${this.describe()}`);
      this.clickObject(idx, step.at);
    } else if ("click" in step) {
      this.clickObject(this.resolve(step.click), step.at);
    } else if ("walks" in step) {
      const tries = step.tries ?? 4;
      done: for (let round = 0; round < tries; round++) {
        for (const [x, y] of step.walks) {
          this.press(`c ${x} ${y} 1`);
          for (let i = 0; i < (step.max ?? 400); i++) {
            this.tick();
            if (step.until(this)) break done;
            if (i > 2 && this.idle) break;
          }
        }
      }
      if (!step.until(this)) throw new Error(`« ${step.what} » n'arrive pas :\n${this.describe()}`);
    } else if ("wait" in step) {
      this.tick(step.wait);
    } else if ("until" in step) {
      this.until(step.until, step.what, step.max);
    } else if ("run" in step) {
      step.run(this);
    }
    if (this.capture.failures !== failures) throw new Error(`message d'échec du moteur :\n${this.describe()}`);
    const action = !("wait" in step) && !("until" in step) && !("walks" in step);
    if (action && step.idle !== false) this.waitIdle(step.max);
    if (step.expect && !step.expect(this)) throw new Error(`condition non remplie après l'étape :\n${this.describe()}`);
  }

  /**
   * Menu système (F10) : choisit les lignes `rows` dans les menus qui s'ouvrent l'un après l'autre (menu, puis confirmation). Lignes du
   * menu du port : 0 Pause, 1 Nouvelle partie, 2 Quitter, 3 Charger une partie, 4 Sauver la partie ; confirmation : 0 « Ok , Vas-y ... ».
   */
  systemMenu(...rows: number[]): void {
    this.menuQueue = [...rows];
    this.press("k systemmenu");
    this.tick();
    if (this.menuQueue.length) throw new Error(`menu système : choix non faits (${this.menuQueue.join(", ")})\n${this.describe()}`);
  }

  /**
   * Pause du menu système (ligne 0) tenue `steps` pas de 10 ms de temps virtuel, puis levée par un clic ; rend le nombre de ticks écoulés
   * pendant la pause. Au banc, le clic enregistré lève la pause dès son premier tour (aucun tick ne passe non plus).
   */
  pause(steps: number): number {
    this.menuQueue = [0];
    this.holdPause = true;
    this.press("k systemmenu");
    const ticks = this.engine.ticks;
    for (let i = 0; i < steps; i++) this.engine.step();
    const elapsed = this.engine.ticks - ticks;
    if (this.engine.banner !== "PAUSE" || this.menuQueue.length) throw new Error(`pause non ouverte\n${this.describe()}`);
    this.holdPause = false;
    this.modalInput(`c ${this.engine.mouse.x} ${this.engine.mouse.y} 1`);
    this.tick();
    if (this.engine.banner !== null) throw new Error(`pause non levée\n${this.describe()}`);
    return elapsed;
  }

  /** Entrées enregistrées, au format `CINE_INPUT`. */
  inputsText(): string {
    return this.record.map(formatInput).join("\n");
  }

  /**
   * Joueur neuf qui reprend la partie après un aller-retour de la sauvegarde en vrai JSON ; `null` si le jeu refuse de sauvegarder.
   * Les entrées enregistrées ne suivent pas (la partie reprise n'est plus rejouable au banc).
   */
  resumed(): Driver | null {
    const save = this.engine.save();
    if (!save) return null;
    const parsed = parseSave(JSON.parse(JSON.stringify(save)));
    if (!parsed) throw new Error("sauvegarde illisible après JSON");
    const next = new Driver({ keepTk: false });
    next.engine.load(parsed);
    next.texts.push(...this.texts);
    next.heroLast = this.heroLast;
    next.heroStill = this.heroStill;
    return next;
  }
}
