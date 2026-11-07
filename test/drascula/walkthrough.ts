import { FRAME_TICKS } from "../../src/games/drascula/engine/cadence";
import { rectContains } from "../../src/games/drascula/engine/room";
import type { GameScript } from "../../src/games/drascula/engine/script";
import { Verb } from "../../src/games/drascula/engine/state";
import { drasculaScript } from "../../src/games/drascula/engine/rooms";
import { Player } from "./engine/test-host";

/**
 * Joueur scripté du jeu complet, pour les tests de pièces et de « passage de chapitre » (`docs/drascula/rooms.md`). Il joue comme une
 * personne : touches F1 à F6 pour les verbes, clics de souris sur les objets de la pièce, clic droit et clics dans l'inventaire, choix
 * de dialogue au survol. Il ne touche jamais à l'état du moteur : ce qui s'y passe vient des mêmes clics que dans le navigateur.
 *
 * ```ts
 * const w = new Walkthrough({ chapter: 1 });
 * w.act(Verb.Talk, 52);            // parler au barman (objet 52 de la pièce)
 * w.useItem(28, 100);              // le téléphone sur la tête de mort
 * w.choose(0);                     // premier choix du menu de dialogue ouvert
 * w.voices(mark)                   // voix jouées depuis `mark = w.mark()`
 * ```
 */

/** Touche de chaque verbe (F1 à F6, `metaengine.cpp`). */
const VERB_KEYS: Record<number, string> = { [Verb.Look]: "F1", [Verb.Pick]: "F2", [Verb.Open]: "F3", [Verb.Close]: "F4", [Verb.Talk]: "F5", [Verb.Move]: "F6" };
/** Au plus ce nombre de ticks (200 s de jeu par défaut) pour qu'une action rende la main. */
const DEFAULT_LIMIT = 20_000;

/** Le script du jeu sans les cinématiques `names` (l'introduction de 6 minutes, par exemple : `1_1`). */
export function scriptWithout(...names: string[]): GameScript {
  const animations = { ...drasculaScript.animations };
  for (const name of names) delete animations[name];
  return { ...drasculaScript, animations };
}

export interface WalkthroughOptions {
  chapter?: number;
  seed?: number;
  /** Cinématiques à ne pas jouer (par défaut `1_1`, l'introduction du chapitre 1). */
  skip?: readonly string[];
  /** Script complet à la place du jeu (tests du moteur). */
  script?: GameScript;
  /**
   * Faux : le constructeur rend la main sans attendre que le jeu soit au repos, pour un début de chapitre qui attend des clics
   * (le dialogue 11 du chapitre 6) ; l'appelant avance lui-même (`waitForChoices`, `choose`, `settle`). Vrai par défaut.
   */
  settle?: boolean;
}

export class Walkthrough {
  readonly player: Player;

  /** Démarre le chapitre et rend la main une fois la première pièce affichée (sauf `settle: false`). */
  constructor(options: WalkthroughOptions = {}) {
    const script = options.script ?? scriptWithout(...(options.skip ?? ["1_1"]));
    this.player = new Player({ chapter: options.chapter ?? 1, seed: options.seed ?? 1, script });
    if (options.settle !== false) this.player.settle(DEFAULT_LIMIT);
  }

  get engine() {
    return this.player.engine;
  }
  get state() {
    return this.player.state;
  }
  get host() {
    return this.player.host;
  }
  get hero() {
    return this.player.hero;
  }
  get room(): number {
    return this.engine.room.number;
  }
  get flags(): number[] {
    return this.engine.flags;
  }

  /** Repère dans le journal des voix. */
  mark(): number {
    return this.host.sounds.length;
  }

  /** Voix et effets joués depuis `mark` (noms en minuscules : `214.als`, `s3.als`). */
  voices(mark = 0): string[] {
    return this.host.sounds.slice(mark);
  }

  /** Avance de `ticks` ticks. */
  wait(ticks: number): this {
    this.player.run(ticks);
    return this;
  }

  /** Avance jusqu'à ce que le jeu rende la main (aucune séquence, héros arrêté). */
  settle(limit = DEFAULT_LIMIT): this {
    this.player.settle(limit);
    return this;
  }

  /** Avance jusqu'à ce que `done()` soit vrai ; lève au-delà de `limit` ticks. */
  until(done: () => boolean, limit = DEFAULT_LIMIT): this {
    for (let i = 0; i < limit; i++) {
      if (done()) return this;
      this.player.run(1);
    }
    throw new Error(`condition non atteinte en ${limit} ticks`);
  }

  // --- Souris -----------------------------------------------------------------------------------------------------------

  /**
   * Un point où cliquer pour atteindre l'objet `id` de la pièce : dans sa zone, hors des autres objets visibles et du héros (un clic
   * sur plusieurs zones agit sur toutes, un clic sur le héros agit sur le héros).
   */
  pointOf(id: number): { x: number; y: number } {
    const { objects } = this.engine.room;
    const object = objects.find((candidate) => candidate.id === id);
    if (!object) throw new Error(`objet ${id} absent de la pièce ${this.room}`);
    const hero = this.hero;
    const free = (x: number, y: number) =>
      !objects.some((other) => other !== object && other.visible && rectContains(other.rect, x, y)) &&
      !(x >= hero.x - 2 && x <= hero.x + hero.width + 2 && y >= hero.y - 2 && y <= hero.y + hero.height + 2);
    const { x1, y1, x2, y2 } = object.rect;
    const cx = Math.trunc((x1 + x2) / 2);
    const cy = Math.trunc((y1 + y2) / 2);
    let best: { x: number; y: number } | null = null;
    let distance = Infinity;
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d < distance && free(x, y)) {
          distance = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
    return { x: cx, y: cy };
  }

  /** Clique en (x, y) et rend la main une fois l'action finie (`limit` ticks au plus : une cinématique est longue). */
  clickAt(x: number, y: number, limit = DEFAULT_LIMIT): this {
    this.player.click(x, y);
    return this.settle(limit);
  }

  /** Clic sans verbe sur l'objet `id` : le héros y marche (ou passe la porte). Un verbe ou un objet en main est d'abord rangé. */
  goTo(id: number, limit = DEFAULT_LIMIT): this {
    if (this.state.takeObject) this.selectVerb(Verb.None);
    const { x, y } = this.pointOf(id);
    return this.clickAt(x, y, limit);
  }

  /** Choisit un verbe (touche F1 à F6) ; `Verb.None` vide le curseur (F8). */
  selectVerb(verb: number): this {
    this.player.key(verb === Verb.None ? "F8" : VERB_KEYS[verb]);
    this.player.run(FRAME_TICKS);
    return this;
  }

  /** Verbe puis clic sur l'objet `id` de la pièce : le héros y marche, l'action est jouée. */
  act(verb: number, id: number, limit = DEFAULT_LIMIT): this {
    this.selectVerb(verb);
    const { x, y } = this.pointOf(id);
    return this.clickAt(x, y, limit);
  }

  // --- Inventaire -------------------------------------------------------------------------------------------------------

  /** Clic droit : ouvre ou ferme l'écran d'inventaire. */
  toggleInventory(): this {
    this.player.rightClick();
    this.player.run(FRAME_TICKS);
    return this;
  }

  /** Centre de la case de l'inventaire qui contient `item`. */
  private slotPoint(item: number): { x: number; y: number } {
    const slot = this.state.inventory.indexOf(item, 1);
    if (slot < 1) throw new Error(`objet ${item} absent de l'inventaire`);
    const at = this.engine.data.dat.itemLocations[slot];
    return { x: at.x + 20, y: at.y + 12 };
  }

  /** Ouvre l'inventaire, prend l'objet `item` en main (clic dans sa case) puis referme l'inventaire. */
  takeItem(item: number): this {
    this.toggleInventory();
    const { x, y } = this.slotPoint(item);
    this.player.click(x, y);
    this.settle();
    return this.toggleInventory().settle();
  }

  /** L'objet `item` de l'inventaire sur l'objet `id` de la pièce. */
  useItem(item: number, id: number, limit = DEFAULT_LIMIT): this {
    this.takeItem(item);
    if (this.state.pickedObject !== item) throw new Error(`l'objet ${item} n'est pas en main`);
    const { x, y } = this.pointOf(id);
    return this.clickAt(x, y, limit);
  }

  /** Le verbe `verb` (sa case de l'inventaire, 1 à 6) sur l'objet `item` de l'inventaire ouvert, puis referme l'inventaire. */
  verbOnItem(verb: number, item: number): this {
    this.toggleInventory();
    const cell = this.slotPoint(verb);
    this.player.click(cell.x, cell.y);
    this.settle(); // un clic occupe le jeu un instant (`delay(50)`) : le suivant serait ignoré
    const { x, y } = this.slotPoint(item);
    this.player.click(x, y);
    this.settle();
    if (this.state.menuScreen) this.toggleInventory();
    return this;
  }

  /** L'objet `item` appliqué à l'objet `other`, tous deux dans l'inventaire. */
  combine(item: number, other: number): this {
    this.toggleInventory();
    const first = this.slotPoint(item);
    this.player.click(first.x, first.y);
    this.settle();
    const second = this.slotPoint(other);
    this.player.click(second.x, second.y);
    this.settle();
    if (this.state.menuScreen) this.toggleInventory();
    return this;
  }

  // --- Dialogues --------------------------------------------------------------------------------------------------------

  /** Attend que le menu des choix d'un dialogue soit affiché. */
  waitForChoices(limit = DEFAULT_LIMIT): this {
    return this.until(() => this.engine.choices !== null, limit);
  }

  /**
   * Choisit le choix `n` (0 à 3) du menu de dialogue : survol, clic, puis attend le retour du menu (réponse jouée) ou la fin du
   * dialogue. Rend vrai si le menu est revenu.
   */
  choose(n: number): boolean {
    this.waitForChoices();
    const phrases = this.engine.choices!.phrases;
    const bottoms = this.engine.dialogs.bottoms(phrases);
    const y = n === 0 ? 1 : bottoms[n - 1] + 1;
    this.player.move(100, y);
    this.player.run(2);
    this.player.move(100, y, 1);
    this.player.move(100, y, 0);
    this.player.run(2);
    // Le menu disparaît pendant que le héros dit sa réplique, puis revient avec la réponse jouée (ou le dialogue finit).
    this.until(() => this.engine.choices === null || !this.engine.busy);
    this.until(() => this.engine.choices !== null || !this.engine.busy);
    return this.engine.choices !== null;
  }

  /** Touche pressée (Échap pour sauter, F-touches…). */
  key(key: string): this {
    this.player.key(key);
    return this;
  }
}
