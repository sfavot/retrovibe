/**
 * Joueur scripté de *Flight of the Amazon Queen* pour les tests de passage (`docs/fotaq/specials.md`, § 5). Il joue comme une
 * personne : il fait avancer le temps, déplace la souris, clique sur le panneau (verbes, cases de l'inventaire), sur les objets de la
 * pièce, sur les choix d'un dialogue, appuie sur Échap ; il ne modifie jamais l'état du jeu en cours de parcours. Le moteur est le vrai
 * (scène, répliques, cinématiques, logique de `fotaqScript`), l'hôte est celui des tests (horloge manuelle, voix mesurées).
 *
 * Seul l'état de départ d'un groupe (`start`) pose directement des objets d'inventaire, des états du jeu et la tenue : un test de
 * passage commence là où le groupe commence, pas au début du jeu (`test/fotaq/solutions.ts`).
 */

import { TICK_MS } from "../../src/games/fotaq/engine/cadence";
import { FotaqCutaways } from "../../src/games/fotaq/engine/cutaway";
import { FotaqTalk } from "../../src/games/fotaq/engine/dialogs";
import type { FotaqAction } from "../../src/games/fotaq/engine/host";
import { FotaqEngine } from "../../src/games/fotaq/engine/loop";
import type { GameScript } from "../../src/games/fotaq/engine/script";
import { Outfit } from "../../src/games/fotaq/engine/services";
import { fotaqScript } from "../../src/games/fotaq/engine/specials";
import { objectCopy } from "../../src/games/fotaq/engine/room";
import { GameStage } from "../../src/games/fotaq/engine/stage";
import { GridScreen } from "../../src/games/fotaq/engine/grid";
import { GameVar, JoeWalk } from "../../src/games/fotaq/engine/state";
import { gameData, TestHost } from "./engine/test-host";

/** Verbes du panneau, dans l'ordre des cases (de gauche à droite). */
export const PanelVerb = { Open: 1, Close: 2, Move: 3, Give: 4, Look: 5, PickUp: 6, Talk: 7, Use: 8 } as const;
export type PanelVerbName = keyof typeof PanelVerb;

/** Abscisses des quatre cases de l'inventaire et ordonnée de la rangée du panneau. */
const INVENTORY_X = [196, 231, 267, 302];
const PANEL_ROW_Y = 175;
/** Hauteur de l'écran de jeu (au-dessous : le panneau). */
const ROOM_HEIGHT = 150;
/** Flèche du bas d'un menu de dialogue : son bob (`ARROW_BOB_DOWN`) et un point de sa zone du panneau. */
const ARROW_DOWN_BOB = 63;
const ARROW_DOWN = { x: 311, y: 190 };
/** Défilements au plus pour trouver une option cachée. */
const MAX_CHOICE_SCROLLS = 8;
/** Ticks du fondu d'entrée du piton avant qu'il suive la souris. */
const PINNACLE_FADE = 30;
/** Limite par défaut d'une attente, en ticks (100 ms) : 20 minutes de jeu. */
const DEFAULT_LIMIT = 12_000;

/** État de départ d'un groupe : ce qu'un joueur aurait à ce moment-là. */
export interface Start {
  /** Pièce de départ, sans objet d'entrée (ignoré si `entryObject`). */
  room?: number;
  /** Objet par lequel Joe entre dans sa pièce de départ. */
  entryObject?: number;
  /** Objets d'inventaire (`Item`) possédés en plus de la batte et du journal. */
  items?: readonly number[];
  /** États du jeu (`gameStates`), numéro -> valeur. */
  states?: Readonly<Record<number, number>>;
  /** Tenue de Joe (`Outfit`). */
  outfit?: Outfit;
  /** Objets du jeu à montrer (nom rendu positif), comme le ferait une cinématique jouée plus tôt. */
  shown?: readonly number[];
  /** Copies d'objets `[modèle, objet]` (`objectCopy`), comme les états de cinématique `fromObject` joués plus tôt. */
  copies?: readonly (readonly [from: number, to: number])[];
}

export interface WalkthroughOptions extends Start {
  /** Logique codée en dur (par défaut `fotaqScript`, tous les groupes). */
  script?: GameScript;
  /** Voix actives : une réplique dure autant que sa voix (par défaut) ; sinon le temps de son texte. */
  voices?: boolean;
  seed?: number;
  /** Hôte à utiliser (les tests de sauvegarde en donnent un qui connaît `lastSong`). */
  host?: TestHost;
}

export class Walkthrough {
  // Ces cinq éléments ne changent que dans les tests de sauvegarde (`save/checkpoint.ts` les remplace tous par ceux d'un moteur neuf
  // qui a repris la partie) : le code d'une solution les relit à chaque appel et ne les garde pas d'une étape à l'autre.
  host = new TestHost();
  stage = new GameStage();
  /** Le vrai interpréteur de cinématiques ; `played` note le nom de chaque fichier joué. */
  cutaways = new FotaqCutaways();
  talk = new FotaqTalk();
  engine: FotaqEngine;

  constructor(options: WalkthroughOptions = {}) {
    if (options.host) this.host = options.host;
    this.host.voices = options.voices ?? true;
    this.engine = new FotaqEngine(this.host, {
      data: gameData(),
      seed: options.seed ?? 1,
      script: options.script ?? fotaqScript,
      stage: this.stage,
      talk: this.talk,
      cutaways: this.cutaways,
      ...(options.entryObject !== undefined ? { entryObject: options.entryObject } : options.room !== undefined ? { room: options.room } : {}),
    });
    this.applyStart(options);
  }

  private applyStart(start: Start): void {
    const { engine } = this;
    for (const item of start.items ?? []) engine.inventory.insert(item);
    for (const [index, value] of Object.entries(start.states ?? {})) engine.setGameState(Number(index), value);
    if (start.outfit !== undefined) {
      engine.setGameState(GameVar.JoeDressingMode, start.outfit);
      this.stage.setOutfit(engine, start.outfit);
    }
    const { objects } = engine.state;
    for (const object of start.shown ?? []) objects[object].name = Math.abs(objects[object].name);
    for (const [from, to] of start.copies ?? []) objectCopy(engine, from, to);
  }

  // --- Le temps ------------------------------------------------------------------------------------------------------------

  /** Fonctions appelées après chaque tick (lecture de l'écran pendant une attente : un générique, par exemple). */
  readonly observers: (() => void)[] = [];

  /** Ticks de 100 ms joués depuis la création. */
  get ticks(): number {
    return this.host.clock / TICK_MS;
  }

  /** Avance de `ticks` ticks de 100 ms. */
  wait(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.host.clock += TICK_MS;
      this.engine.tick();
      for (const observer of this.observers) observer();
    }
  }

  /** Avance jusqu'à ce que `condition` soit vraie ; lève au-delà de `limit` ticks. Rend le nombre de ticks écoulés. */
  until(condition: () => boolean, limit = DEFAULT_LIMIT, what = "la condition"): number {
    for (let i = 0; i <= limit; i++) {
      if (condition()) return i;
      this.wait(1);
    }
    throw new Error(`${what} n'est pas arrivée en ${limit} ticks (pièce ${this.engine.state.room}, cinématiques : ${this.cutaways.played.join(" ")})`);
  }

  /** Joe n'est occupé par rien : ni séquence, ni cinématique, ni changement de pièce, ni marche à exécuter. */
  get idle(): boolean {
    const { engine } = this;
    return !engine.busy && !engine.input.cutawayRunning && engine.state.newRoom === 0 && engine.joeWalk !== JoeWalk.Execute;
  }

  /** Un menu de dialogue attend le joueur. */
  get awaitingChoice(): boolean {
    return this.engine.input.dialogueRunning && this.choices().length > 0;
  }

  /**
   * Attend que le joueur ait la main (fin d'une marche, d'une réplique, d'une cinématique, d'un changement de pièce) ou qu'un menu de dialogue attende son choix. Un tick au moins
   * passe d'abord : une entrée reçue n'est lue qu'au tick suivant.
   */
  settle(limit = DEFAULT_LIMIT): number {
    this.wait(1);
    return 1 + this.until(() => this.idle || this.awaitingChoice, limit, "la reprise de la main");
  }

  /** Attend la fin de la cinématique en cours (ou, s'il n'y en a pas, que le joueur ait la main). */
  waitForCutaway(limit = DEFAULT_LIMIT): number {
    return this.settle(limit);
  }

  /** Attend d'être dans la pièce `room`, la main rendue au joueur. */
  waitForRoom(room: number, limit = DEFAULT_LIMIT): number {
    return this.until(() => this.engine.state.room === room && this.idle, limit, `la pièce ${room}`);
  }

  // --- Souris et clavier ---------------------------------------------------------------------------------------------------

  /** Appui sur une touche d'action (`skipCutaway` : Échap). */
  key(action: FotaqAction): void {
    this.host.push({ type: "action", action });
    this.wait(1);
  }

  /** Échap : passe la cinématique ou le dialogue en cours. */
  skip(): void {
    this.key("skipCutaway");
  }

  /** Appuie sur Échap tous les `every` ticks jusqu'à ce que `condition` soit vraie (une introduction qui enchaîne les cinématiques). */
  skipUntil(condition: () => boolean, limit = DEFAULT_LIMIT, every = 2): number {
    let ticks = 0;
    while (!condition()) {
      if (ticks > limit) throw new Error(`la condition n'est pas arrivée en ${limit} ticks malgré Échap (pièce ${this.engine.state.room}, cinématiques : ${this.cutaways.played.join(" ")})`);
      this.skip();
      this.wait(every - 1);
      ticks += every;
    }
    return ticks;
  }

  private move(x: number, y: number, buttons = 0): void {
    this.host.push({ type: "pointer", x, y, buttons });
  }

  /** Survole le point, puis y clique (bouton 1 : gauche, 2 : droit) ; attend que le jeu rende la main. */
  click(x: number, y: number, button = 1, limit = DEFAULT_LIMIT): void {
    this.move(x, y);
    this.wait(1);
    this.move(x, y, button);
    this.move(x, y, 0);
    this.settle(limit);
  }

  /** Un point de l'écran de jeu où cliquer pour viser l'objet `object` de la pièce courante (hors des autres objets). */
  pointOf(object: number): { x: number; y: number } {
    const { engine } = this;
    const zone = object - engine.currentRoomData;
    const box = engine.grid.zone(GridScreen.Room, zone);
    if (!box) throw new Error(`l'objet ${object} n'a pas de zone dans la pièce ${engine.state.room}`);
    const scroll = engine.horizontalScroll;
    const centerX = Math.trunc((box.x1 + box.x2) / 2);
    const centerY = Math.trunc((box.y1 + box.y2) / 2);
    // Les points de la boîte, du centre vers les bords.
    const candidates: { x: number; y: number }[] = [];
    for (let y = box.y1; y <= Math.min(box.y2, ROOM_HEIGHT - 1); y++) for (let x = box.x1; x <= box.x2; x++) candidates.push({ x, y });
    candidates.sort((a, b) => Math.abs(a.x - centerX) + Math.abs(a.y - centerY) - (Math.abs(b.x - centerX) + Math.abs(b.y - centerY)));
    for (const { x, y } of candidates) {
      const screenX = x - scroll;
      if (screenX < 0 || screenX > 319) continue;
      if (engine.grid.findObjectUnderCursor(screenX, y, scroll) === zone) return { x: screenX, y };
    }
    throw new Error(`l'objet ${object} n'est pas visible à l'écran (pièce ${engine.state.room}, défilement ${scroll})`);
  }

  /** L'objet `object` de la pièce courante est visible à l'écran (`pointOf` le trouve). */
  visible(object: number): boolean {
    try {
      this.pointOf(object);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Amène l'objet `object` à l'écran : dans une pièce plus large que l'écran, Joe marche vers le bord du côté de l'objet (la caméra le
   * suit), comme le ferait une personne. Le clic vise un point du décor sans objet (pas une sortie). Lève si l'objet reste invisible.
   */
  reach(object: number): void {
    for (let attempt = 0; attempt < 12 && !this.visible(object); attempt++) {
      const box = this.engine.grid.zone(GridScreen.Room, object - this.engine.currentRoomData);
      if (!box) break;
      const toRight = (box.x1 + box.x2) / 2 > this.engine.horizontalScroll + 160;
      const before = this.engine.state.joe.x;
      const room = this.room;
      for (const y of [this.engine.state.joe.y, 140, 125, 112, 135, 120, 105]) {
        const x = this.bareX(toRight, y);
        if (x === undefined) continue;
        this.click(x, y);
        if (this.engine.state.joe.x !== before || this.room !== room) break;
      }
      if (this.engine.state.joe.x === before || this.room !== room) break;
    }
    this.pointOf(object);
  }

  /** Abscisse d'écran près du bord (droit si `toRight`) où un clic à l'ordonnée `y` ne vise aucun objet : une simple marche. */
  private bareX(toRight: boolean, y: number): number | undefined {
    const { engine } = this;
    for (let i = 0; i < 40; i++) {
      const x = toRight ? 316 - i : 3 + i;
      if (engine.grid.findObjectNumber(engine.grid.findObjectUnderCursor(x, y, engine.horizontalScroll)) === 0) return x;
    }
    return undefined;
  }

  // --- Le piton (pièce 7) -------------------------------------------------------------------------------------------------

  /**
   * Passe par l'objet de sortie `object` vers le piton (pièce 7). Le piton attend la souris et ne rend jamais la main
   * (`handlePinnacleRoom`) : le clic n'est pas suivi de `settle`, on attend que le piton suive la souris (caméra libre), fondu compris.
   */
  toPinnacle(object: number, limit = DEFAULT_LIMIT): void {
    this.reach(object);
    const { x, y } = this.pointOf(object);
    this.move(x, y);
    this.wait(1);
    this.move(x, y, 1);
    this.move(x, y, 0);
    this.until(() => this.atPinnacle, limit, "le piton");
    // Le fondu d'entrée du piton précède l'attente de la souris.
    this.wait(PINNACLE_FADE);
  }

  /** Le piton attend le choix d'une destination. */
  get atPinnacle(): boolean {
    return this.room === 7 && this.stage.bobs.cameraBob === -1 && this.engine.busy;
  }

  /** Au piton, survole puis clique la destination `object` (objet de la pièce 7 : le décor défile avec la souris) ; attend la pièce `room`. */
  fromPinnacle(object: number, room: number, limit = 1_000): void {
    const zone = object - this.engine.currentRoomData;
    for (let y = 0; y < ROOM_HEIGHT; y += 2) {
      for (let x = 0; x < 320; x += 2) {
        // Défilement = abscisse de la souris.
        if (this.engine.grid.findObjectUnderCursor(x, y, x) !== zone) continue;
        this.move(x, y);
        this.wait(2);
        this.move(x, y, 1);
        this.move(x, y, 0);
        this.waitForRoom(room, limit);
        return;
      }
    }
    throw new Error(`le piton n'a pas de destination ${object}`);
  }

  // --- Verbes, objets, inventaire ------------------------------------------------------------------------------------------

  /** Clique sur un verbe du panneau. */
  verb(name: PanelVerbName): void {
    this.click((PanelVerb[name] - 1) * 20 + 10, PANEL_ROW_Y);
  }

  /** Clique sur l'objet `object` de la pièce courante (marcher vers lui, ou passer une porte), amené d'abord à l'écran (`reach`). */
  goTo(object: number, limit = DEFAULT_LIMIT): void {
    this.reach(object);
    const { x, y } = this.pointOf(object);
    this.click(x, y, 1, limit);
  }

  /** Verbe puis objet de la pièce. Une porte ou une action qui marche demande parfois un second clic : voir `goTo`. */
  act(verb: PanelVerbName, object: number, limit = DEFAULT_LIMIT): void {
    this.reach(object);
    this.verb(verb);
    const { x, y } = this.pointOf(object);
    this.click(x, y, 1, limit);
  }

  /** Rang (0 à 3) de la case qui montre l'objet d'inventaire `item` ; les flèches font défiler jusqu'à lui. */
  slotOf(item: number): number {
    const { inventory } = this.engine;
    for (let tries = 0; tries < 40; tries++) {
      for (let slot = 0; slot < INVENTORY_X.length; slot++) if (inventory.find(slot) === item) return slot;
      this.key("scrollDown");
    }
    throw new Error(`l'objet d'inventaire ${item} n'est dans aucune case`);
  }

  private clickItem(item: number, button = 1): void {
    this.click(INVENTORY_X[this.slotOf(item)], PANEL_ROW_Y, button);
  }

  /** Utilise (ou donne) l'objet d'inventaire `item` avec l'objet `object` de la pièce : verbe, case, objet. */
  useItem(item: number, object: number, verb: "Use" | "Give" = "Use", limit = DEFAULT_LIMIT): void {
    this.reach(object);
    this.verb(verb);
    this.clickItem(item);
    const { x, y } = this.pointOf(object);
    this.click(x, y, 1, limit);
  }

  /** Utilise l'objet d'inventaire `first` avec l'objet d'inventaire `second`. */
  combine(first: number, second: number, limit = DEFAULT_LIMIT): void {
    this.verb("Use");
    this.clickItem(first);
    this.click(INVENTORY_X[this.slotOf(second)], PANEL_ROW_Y, 1, limit);
  }

  /** Verbe sur un objet d'inventaire (examiner, par exemple). */
  verbOnItem(verb: PanelVerbName, item: number): void {
    this.verb(verb);
    this.clickItem(item);
  }

  // --- Dialogues -----------------------------------------------------------------------------------------------------------

  /** Les choix affichés dans le panneau (une ligne par choix : les lignes de suite, décalées, sont jointes à leur choix). */
  choices(): string[] {
    const { display } = this.stage;
    const choices: string[] = [];
    for (let y = 151; y < 199; y++) {
      const slot = display.textAt(y);
      if (!slot.text) continue;
      if (slot.x <= 1 || choices.length === 0) choices.push(slot.text);
      else choices[choices.length - 1] += ` ${slot.text}`;
    }
    return choices;
  }

  private choiceLines(): number[] {
    const { display } = this.stage;
    const lines: number[] = [];
    for (let y = 151; y < 199; y++) {
      const slot = display.textAt(y);
      if (slot.text && slot.x <= 1) lines.push(y);
    }
    return lines;
  }

  /** Attend que le menu d'un dialogue soit affiché. */
  waitForChoices(limit = DEFAULT_LIMIT): string[] {
    this.until(() => this.awaitingChoice, limit, "un menu de dialogue");
    return this.choices();
  }

  /** Choisit l'option `n` (de 0) du menu affiché, attend la réplique qui suit puis le menu suivant ou la fin du dialogue. */
  choose(n: number, limit = DEFAULT_LIMIT): void {
    const lines = this.choiceLines();
    if (n < 0 || n >= lines.length) throw new Error(`le menu n'a pas d'option ${n} : ${JSON.stringify(this.choices())}`);
    // Le texte est posé à l'ordonnée où la zone du choix commence, qui est aussi la fin de la zone précédente : on vise le milieu.
    const y = lines[n] + 4;
    this.move(10, y);
    this.wait(1);
    this.move(10, y, 1);
    this.move(10, y, 0);
    // Le menu s'efface quand Joe dit sa réplique ; puis vient le menu suivant, ou la fin du dialogue.
    this.until(() => this.idle || this.choices().length === 0, limit, "la réplique de Joe");
    this.until(() => this.idle || this.awaitingChoice, limit, "la suite du dialogue");
  }

  /**
   * Choisit l'option dont le texte contient `fragment`. Le panneau n'affiche que quatre lignes : tant que l'option n'est pas visible et
   * que la flèche du bas est affichée, on clique sur elle pour faire défiler.
   */
  chooseText(fragment: string, limit = DEFAULT_LIMIT): void {
    for (let scrolls = 0; ; scrolls++) {
      const index = this.choices().findIndex((text) => text.includes(fragment));
      if (index >= 0) return this.choose(index, limit);
      if (scrolls >= MAX_CHOICE_SCROLLS || !this.stage.bobs.bob(ARROW_DOWN_BOB).active) break;
      this.click(ARROW_DOWN.x, ARROW_DOWN.y);
    }
    throw new Error(`aucune option ne contient « ${fragment} » : ${JSON.stringify(this.choices())}`);
  }

  // --- Lecture de l'écran --------------------------------------------------------------------------------------------------

  get room(): number {
    return this.engine.state.room;
  }

  /** Les noms des voix jouées depuis la marque `mark` (`voices.length` pris plus tôt). */
  voices(mark = 0): string[] {
    return this.host.spoken.slice(mark).map((entry) => entry.name);
  }

  /** Marque dans le journal des voix. */
  mark(): number {
    return this.host.spoken.length;
  }
}
