/**
 * Joueur de la solution de *Beneath a Steel Sky* (vague K) : une solution est une liste d'étapes (`Step[]`, des données dans
 * `walkthrough.ts`) que `Driver.run` joue par de **vrais clics** passés par `BassHost.pollInput` (pointeur, clic gauche ou droit, barre
 * d'inventaire, choix de dialogue, touches des terminaux), sans jamais écrire l'état du jeu.
 *
 * Règles de l'interface reprises du jeu (`engine.md` § 17) :
 * - **survol avant clic** : le jeu n'agit que sur la zone déjà survolée (`SPECIAL_ITEM`, lu au tour du déplacement) ; `click` déplace le
 *   pointeur, laisse passer des tours jusqu'à ce que le jeu survole la zone, puis clique au même point ;
 * - une zone est désignée par son **nom dans `sky.cpt`** : `hotspots` relit la liste de souris comme `Mouse::pointerEngine` (`mouseRel*`,
 *   `mouseSize*`, `xcood`, `ycood`, première zone touchée dans l'ordre de la liste) et `pointOf` choisit un point de la zone qu'aucune zone
 *   précédente ne couvre ;
 * - clic gauche : regarder (ou marcher vers une sortie) ; clic droit : agir (prendre, ouvrir, parler) ; objet : clic droit sur son icône
 *   (la barre s'ouvre en haut de l'écran et n'agit qu'une fois descendue, `MENU` = 2), puis clic droit sur la zone ou sur une autre icône.
 *
 * Le joueur « a la main » (`idle`) quand la souris et les boutons sont actifs, le pointeur libre, aucun effet en cours, et que Foster ne fait
 * rien (logique 0, script ou attente d'un clic `L_WAIT_SYNC`), ou qu'un choix de dialogue attend, ou qu'un terminal de LINC est à l'écran.
 *
 * | Étape | Ce que fait le joueur |
 * | --- | --- |
 * | `{ look: zone }` | clic gauche sur la zone |
 * | `{ act: zone }` | clic droit sur la zone ; dans un terminal (écrans 101 et suivants), attend que le menu se réécrive |
 * | `{ use: objet, on: zone \| { item } }` | prend l'objet de l'inventaire, puis clic droit sur la zone ou sur une autre icône (combiner) |
 * | `{ icon: objet }` | clic sur une icône de l'inventaire (dans LINC : « DECONNEXION ») |
 * | `{ go: zone }` | clic gauche, sans exiger de changer d'écran (essayer une porte, quitter un gros plan) |
 * | `{ walk: [x, y] }` | clic gauche sur un point du sol (s'écarter du chemin de Joey) |
 * | `{ exit: zone }` | clic droit (ouvrir) puis clics gauches jusqu'à changer d'écran ; un personnage qui barre le passage ou un portier qui salue n'arrêtent pas le joueur |
 * | `{ say: fragment \| rang }` | dans le choix de dialogue en cours, la ligne qui contient le fragment (ou de ce rang) |
 * | `{ chat: personnage, until, prefer? }` | conversation menée jusqu'à `until` : les lignes de `prefer` d'abord, sinon la première qui n'est pas un adieu |
 * | `{ reply: rang, until }` | répondre à tous les choix qui se présentent (le tribunal, l'androïde) jusqu'à `until` |
 * | `{ meet: personnage }` | rejoindre un personnage qui se promène, par les sorties nommées `sc<écran>_exit_<destination>` de `sky.cpt` |
 * | `{ until, what, max? }` | laisser passer des tours jusqu'à ce qu'un joueur observe la condition (Lamb devant l'ascenseur, Joey de retour…) |
 * | `{ wait: n }` | laisser passer `n` tours |
 *
 * Options communes : `screen` (écran attendu), `max` (tours d'attente), `retry` (rejouer l'étape tant que le résultat manque), `then:
 * "watch"` (une séquence sans main suit), `note` (documentation de la solution). Une étape qui ne peut pas aboutir **lève** une erreur qui
 * décrit l'état (écran, section, Foster, zones, derniers textes).
 */

import { CompactField as F } from "../../../src/games/bass/data/compact-fields";
import { toUnicode } from "../../../src/games/bass/data/charset";
import type { BassEngine } from "../../../src/games/bass/engine/game";
import { MouseButton, type TestHost } from "../../../src/games/bass/engine/host";
import { BassTextManager } from "../../../src/games/bass/engine/text";
import { Cpt, L, SF, ST, TOP_LEFT_X, TOP_LEFT_Y, Var } from "../../../src/games/bass/engine/ids";

/** Flèches de la barre d'inventaire (`left_arrow`, `right_arrow`). */
const MENU_LEFT_ARROW = 47;
const MENU_RIGHT_ARROW = 48;
/** Variables de l'inventaire (`o0` = 69, comme le banc : `scriptvar o0`). */
const INVENTORY_FIRST_VAR = 69;
const INVENTORY_VARS = 30;
/** Premier écran des terminaux de LINC. */
const TERMINAL_SCREEN = 101;

export interface Hotspot {
  id: number;
  name: string;
  label: string;
  /** Rectangle en coordonnées de l'écran (bornes comprises). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Driver {
  constructor(
    readonly engine: BassEngine,
    readonly host: TestHost,
  ) {
    this.hook();
  }

  /** Textes formés (répliques, descriptions, choix), en Unicode, dans l'ordre. */
  readonly texts: string[] = [];
  /** Rang dans `texts` du premier texte de l'étape en cours. */
  stepStart = 0;

  /** Relève les textes formés par le moteur (sauf le nom de la zone sous le pointeur) : ce que le joueur lit. */
  private hook(): void {
    const text = this.engine.text as BassTextManager;
    const low = text.lowTextManager.bind(text);
    text.lowTextManager = (textNum, width, logicNum, color, center) => {
      const out = low(textNum, width, logicNum, color, center);
      if (logicNum !== L.CURSOR) this.texts.push(toUnicode(text.getText(textNum)));
      return out;
    };
  }

  tick(n = 1): void {
    for (let i = 0; i < n; i++) this.engine.tick();
  }

  /** Un tour de jeu complet. */
  cycle(n = 1): void {
    const target = this.engine.completedCycles + n;
    for (let t = 0; this.engine.completedCycles < target; t++) {
      if (t > 100_000) throw new Error("cycle : le moteur ne termine plus de tour");
      this.tick();
    }
  }

  get screen(): number {
    return this.engine.vars[Var.SCREEN]!;
  }

  /** Zones de la liste de souris de l'écran courant, dans l'ordre de `pointerEngine`. */
  hotspots(): Hotspot[] {
    const { vars, compacts } = this.engine;
    const out: Hotspot[] = [];
    let listNum = vars[Var.MOUSE_LIST_NO]!;
    for (let guard = 0; guard < 50; guard++) {
      const list = compacts.require(listNum);
      let pos = 0;
      while (list[pos] !== 0 && list[pos] !== 0xffff) {
        const id = list[pos++]!;
        const item = compacts.require(id);
        if (item[F.screen] !== vars[Var.SCREEN] || !(item[F.status]! & ST.MOUSE)) continue;
        const relX = (item[F.mouseRelX]! << 16) >> 16;
        const relY = (item[F.mouseRelY]! << 16) >> 16;
        const left = item[F.xcood]! + relX - TOP_LEFT_X;
        const top = item[F.ycood]! + relY - TOP_LEFT_Y;
        out.push({ id, name: compacts.info(id).name, label: this.label(id), x0: left, y0: top, x1: left + item[F.mouseSizeX]!, y1: top + item[F.mouseSizeY]! });
      }
      if (list[pos] !== 0xffff) break;
      listNum = list[pos + 1]!;
    }
    return out;
  }

  /** Texte d'une zone : nom sous le pointeur (`cursorText`), ou ligne d'un choix de dialogue (compacts de texte 23 à 33). */
  label(id: number): string {
    const item = this.engine.compacts.require(id);
    try {
      if (id >= Cpt.TEXT_1 && id <= Cpt.TEXT_11) return toUnicode((this.engine.text as BassTextManager).getText(item[F.getToFlag]!));
      return item[F.cursorText] ? toUnicode((this.engine.text as BassTextManager).getText(item[F.cursorText]!)) : "";
    } catch {
      return "?";
    }
  }

  /** Point de l'écran où le pointeur désigne `id` (dans sa zone, hors des zones qui la précèdent dans la liste). */
  pointOf(id: number, spots = this.hotspots()): [number, number] | null {
    const index = spots.findIndex((h) => h.id === id);
    if (index < 0) return null;
    const target = spots[index]!;
    const before = spots.slice(0, index);
    const minY = id === Cpt.MENU_BAR || this.engine.vars[Var.MENU] ? 0 : 2;
    const x0 = Math.max(0, target.x0), x1 = Math.min(319, target.x1);
    const y0 = Math.max(minY, target.y0), y1 = Math.min(191, target.y1);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (before.some((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1)) continue;
        const dist = (x - cx) ** 2 + (y - cy) ** 2;
        if (dist < bestD) {
          bestD = dist;
          best = [x, y];
        }
      }
    }
    return best;
  }

  /** Déplace le pointeur sur `id` et attend que le jeu le survole (`SPECIAL_ITEM`). */
  hover(id: number): [number, number] {
    for (let attempt = 0; attempt < 40; attempt++) {
      const point = this.pointOf(id);
      if (point) {
        this.host.push({ type: "move", x: point[0], y: point[1] });
        this.cycle();
        if (this.engine.vars[Var.SPECIAL_ITEM] === id) {
          this.cycle();
          if (this.engine.vars[Var.SPECIAL_ITEM] === id) return point;
        }
      } else this.cycle();
    }
    throw new Error(`survol impossible de ${this.describe(id)} ; ${this.state()}`);
  }

  /** Survol puis clic (gauche : regarder ; droit : agir). */
  click(id: number, button: "left" | "right"): void {
    const [x, y] = this.hover(id);
    this.host.push({ type: "click", x, y, button: button === "left" ? MouseButton.Left : MouseButton.Right });
    this.cycle();
  }

  /** Clic sur un point de l'écran (sol). */
  clickAt(x: number, y: number, button: "left" | "right" = "left"): void {
    this.host.push({ type: "move", x, y });
    this.cycle(2);
    this.host.push({ type: "click", x, y, button: button === "left" ? MouseButton.Left : MouseButton.Right });
    this.cycle();
  }

  /** Vrai quand le joueur a la main : souris et boutons actifs, pointeur libre, aucun effet en cours. */
  get human(): boolean {
    const { vars, system } = this.engine;
    return (vars[Var.MOUSE_STATUS]! & 6) === 6 && !vars[Var.MOUSE_STOP] && !(system.systemFlags & SF.MOUSE_LOCKED) && !this.engine.blocked;
  }

  /** Le joueur peut agir : il a la main et Foster ne fait rien (logique 0 ou script), ou un choix de dialogue attend, ou un terminal. */
  get idle(): boolean {
    if (!this.human) return false;
    if (this.choosing) return true;
    // Terminaux de LINC (écrans 101 et suivants) : Foster attend (`L_WAIT_SYNC`) pendant que le joueur appuie sur les touches.
    if (this.screen >= TERMINAL_SCREEN) return true;
    const logic = this.fosterLogic;
    // `L_WAIT_SYNC` : Foster attend qu'on clique (gros plan à travers une grille, terminal) ; la souris est rendue au joueur.
    return logic === L.NOP || logic === L.SCRIPT || logic === L.WAIT_SYNC;
  }

  /** Attend que le joueur puisse agir (deux tours de suite), au plus `max` tours. */
  waitIdle(max = 3000): void {
    let stable = 0;
    for (let i = 0; i < max; i++) {
      this.cycle();
      stable = this.idle ? stable + 1 : 0;
      if (stable >= 2) return;
    }
    throw new Error(`le joueur n'a pas la main après ${max} tours ; ${this.state()}`);
  }

  /** Un choix de dialogue attend (`SF_CHOOSING`). */
  get choosing(): boolean {
    return (this.engine.system.systemFlags & SF.CHOOSING) !== 0;
  }

  /** Logique de Foster. */
  get fosterLogic(): number {
    return this.engine.compacts.require(Cpt.FOSTER)[F.logic]!;
  }

  /** Identifiant, nom et texte d'une zone (messages d'erreur). */
  describe(id: number): string {
    const { compacts } = this.engine;
    return compacts.has(id) ? `${id} (${compacts.info(id).name} « ${this.label(id)} »)` : String(id);
  }

  /** État lisible du jeu pour les messages d'erreur. */
  state(): string {
    const { vars } = this.engine;
    const f = this.engine.compacts.require(Cpt.FOSTER);
    return `écran ${vars[Var.SCREEN]}, section ${vars[Var.CUR_SECTION]}, Foster logique ${f[F.logic]} (${f[F.xcood]}, ${f[F.ycood]}), souris ${vars[Var.MOUSE_STATUS]} stop ${vars[Var.MOUSE_STOP]}, objet tenu ${vars[Var.OBJECT_HELD]}, zones [${this.hotspots().map((h) => `${h.id}:${h.name}`).join(" ")}], derniers textes ${JSON.stringify(this.texts.slice(-3))}`;
  }

  /** Identifiant d'une zone de l'écran courant d'après son nom dans `sky.cpt` (ou un identifiant tel quel). */
  find(target: string | number): number {
    if (typeof target === "number") return target;
    // Un personnage qui suit (Joey) ou une zone qui apparaît après une animation : on l'attend un peu, comme un joueur.
    let spot = this.hotspots().find((h) => h.name === target);
    for (let i = 0; !spot && i < 200; i++) {
      this.cycle();
      spot = this.hotspots().find((h) => h.name === target);
    }
    if (!spot) throw new Error(`zone « ${target} » absente ; ${this.state()}`);
    return spot.id;
  }

  /** Vrai si la zone `name` est à l'écran et qu'un point la désigne (aucune zone ne la couvre entièrement). */
  reachable(name: string): boolean {
    const spots = this.hotspots();
    const spot = spots.find((h) => h.name === name);
    return !!spot && this.pointOf(spot.id, spots) !== null;
  }

  /** Ouvre la barre d'inventaire (pointeur en haut de l'écran). */
  openMenu(): void {
    // La barre descend en quelques tours (`MENU` = 1) ; les icônes n'agissent qu'une fois en place (`MENU` = 2, `ycood` = 136).
    for (let i = 0; i < 40 && this.engine.vars[Var.MENU] !== 2; i++) {
      if (!this.engine.vars[Var.MENU]) this.host.push({ type: "move", x: 160, y: 0 });
      this.cycle();
    }
    if (this.engine.vars[Var.MENU] !== 2) throw new Error(`barre d'inventaire fermée ; ${this.state()}`);
  }

  /** Icône de l'objet `name` (`<name>_menu` ou le nom exact), en faisant défiler la barre au besoin. */
  menuIcon(name: string): number {
    this.openMenu();
    for (let scroll = 0; scroll < 60; scroll++) {
      const spot = this.hotspots().find((h) => h.y0 <= 0 && (h.name === name || h.name === `${name}_menu`));
      if (spot) return spot.id;
      this.click(scroll < 20 ? MENU_RIGHT_ARROW : MENU_LEFT_ARROW, "left");
    }
    throw new Error(`objet « ${name} » absent de l'inventaire ; ${this.state()}`);
  }

  /** Prend en main l'objet `item` de l'inventaire (clic droit sur son icône), puis referme la barre. */
  hold(item: string): void {
    const icon = this.menuIcon(item);
    this.click(icon, "right");
    if (this.engine.vars[Var.OBJECT_HELD] !== icon) throw new Error(`objet « ${item} » non tenu ; ${this.state()}`);
  }

  /** Joue une étape de la solution ; avec `retry`, la rejoue (après une pause) tant que le résultat attendu n'est pas là. */
  run(step: Step): void {
    if (!step.retry) return this.runOnce(step);
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) this.cycle(40);
      this.runOnce(step);
      if (step.retry(this)) return;
    }
    throw new Error(`étape rejouée 8 fois sans résultat : ${JSON.stringify(step).slice(0, 100)} ; ${this.state()}`);
  }

  private runOnce(step: Step): void {
    this.stepStart = this.texts.length;
    if ("wait" in step) return this.cycle(step.wait);
    if ("chat" in step) {
      if (!this.idle) this.waitIdle();
      return this.chat(step);
    }
    if ("reply" in step) {
      // Répondre à chaque choix qui se présente (le tribunal), jusqu'à `until`.
      for (let i = 0; i < (step.max ?? 20000); i++) {
        if (step.until(this)) return this.waitIdle();
        if (this.choosing && this.idle) {
          const lines = this.choices();
          const line = typeof step.reply === "number" ? lines[Math.min(step.reply, lines.length - 1)]! : (lines.find((h) => h.label.includes(step.reply as string)) ?? lines[0]!);
          this.click(line.id, "left");
        } else this.cycle();
      }
      throw new Error(`réponses : ${step.what} non atteint ; ${this.state()}`);
    }
    if ("meet" in step) {
      if (!this.idle) this.waitIdle();
      return this.meet(step.meet, step.max);
    }
    if ("until" in step) {
      for (let i = 0; i < (step.max ?? 3000); i++) {
        if (step.until(this)) return;
        this.cycle();
      }
      throw new Error(`attente trop longue : ${step.what} ; ${this.state()}`);
    }
    if (!this.idle) this.waitIdle();
    if ("say" in step) {
      if (!this.choosing) throw new Error(`aucun choix de dialogue pour « ${step.say} » ; ${this.state()}`);
      const lines = this.hotspots().filter((h) => h.id >= Cpt.TEXT_1 && h.id <= Cpt.TEXT_11);
      const line = typeof step.say === "number" ? lines[step.say] : lines.find((h) => h.label.includes(step.say as string));
      if (!line) throw new Error(`ligne « ${step.say} » absente : ${JSON.stringify(lines.map((h) => h.label))}`);
      this.click(line.id, "left");
    } else if ("look" in step) {
      this.click(this.find(step.look), "left");
    } else if ("act" in step) {
      const terminal = this.screen >= TERMINAL_SCREEN;
      const before = this.texts.length;
      this.click(this.find(step.act), "right");
      // Terminal : la touche n'est lue qu'au tour suivant, puis le menu se réécrit ; on attend le nouveau menu avant la touche suivante.
      for (let i = 0; terminal && this.texts.length === before && this.screen >= TERMINAL_SCREEN && i < 300; i++) this.cycle();
      if (terminal && this.screen >= TERMINAL_SCREEN) this.cycle(10);
    } else if ("use" in step) {
      this.hold(step.use);
      if (typeof step.on === "object") {
        this.click(this.menuIcon(step.on.item), "right");
        this.waitIdle();
        this.closeMenu();
      } else {
        this.closeMenu();
        this.click(this.find(step.on), "right");
      }
    } else if ("icon" in step) {
      this.click(this.menuIcon(step.icon), step.button ?? "right");
    } else if ("go" in step) {
      this.click(this.find(step.go), "left");
    } else if ("walk" in step) {
      this.clickAt(step.walk[0], step.walk[1]);
    } else if ("exit" in step) {
      // Une porte fermée s'ouvre d'abord (clic droit), puis on la franchit (clic gauche sur la sortie).
      const from = this.screen;
      // Un personnage peut barrer le passage (« Désolé ! ») : on recommence un peu plus tard.
      const buttons = [step.button ?? "right", "left", "left", "left", "left", "left", "left", "left"] as const;
      for (const [attempt, button] of buttons.entries()) {
        if (attempt > 2) this.cycle(25);
        this.leaveChooser();
        this.click(this.find(step.exit), button);
        for (let i = 0; i < 1000 && this.screen === from && ((from >= TERMINAL_SCREEN && i < 30) || !this.idle); i++) this.cycle();
        if (this.screen !== from) break;
        this.waitIdle();
        if (this.screen !== from) break;
      }
      if (this.screen === from) throw new Error(`sortie ${step.exit} : toujours à l'écran ${from} ; ${this.state()}`);
    }
    if (step.then === "watch") return; // la suite est une séquence sans main (fin du jeu) : l'étape suivante l'attend
    for (let i = 0; step.screen !== undefined && this.screen !== step.screen && i < 2000; i++) this.cycle();
    this.waitIdle(step.max);
    if (step.screen !== undefined && this.screen !== step.screen) throw new Error(`écran ${this.screen} au lieu de ${step.screen} ; ${this.state()}`);
  }

  /**
   * Sorties de l'écran courant nommées `sc<écran>_exit_<destination>` (parc, métro, LINC central) : destination -> nom de la zone. Le plan
   * se lit dans les noms de `sky.cpt`, pas dans une table de la solution.
   */
  namedExits(): Map<number, string> {
    const out = new Map<number, string>();
    for (const h of this.hotspots()) {
      const m = /^sc(\d+)_exit_(\d+)$/.exec(h.name);
      if (m && Number(m[1]) === this.screen) out.set(Number(m[2]), h.name);
    }
    return out;
  }

  private names?: Map<string, number>;

  /** Noms des compacts de `sky.cpt` -> identifiant. */
  compactNames(): Map<string, number> {
    if (!this.names) {
      const { compacts } = this.engine;
      this.names = new Map();
      compacts.listLengths.forEach((length, list) => {
        for (let index = 0; index < length; index++) {
          const id = (list << 12) | index;
          if (compacts.has(id)) this.names!.set(compacts.info(id).name, id);
        }
      });
    }
    return this.names;
  }

  /** Plus court chemin de sorties nommées vers `target` (parcours en largeur sur les noms de `sky.cpt`). */
  private pathTo(target: number): string | null {
    const names = [...this.compactNames().keys()];
    const edges = new Map<number, number[]>();
    for (const name of names) {
      const m = /^sc(\d+)_exit_(\d+)$/.exec(name);
      if (!m) continue;
      const list = edges.get(Number(m[1])) ?? [];
      list.push(Number(m[2]));
      edges.set(Number(m[1]), list);
    }
    const from = this.screen;
    const prev = new Map<number, number>([[from, -1]]);
    const queue = [from];
    while (queue.length) {
      const at = queue.shift()!;
      if (at === target) break;
      for (const next of edges.get(at) ?? []) if (!prev.has(next)) (prev.set(next, at), queue.push(next));
    }
    if (!prev.has(target)) return null;
    let step = target;
    while (prev.get(step) !== from) step = prev.get(step)!;
    return this.namedExits().get(step) ?? null;
  }

  /** Rejoint un personnage qui se promène (Mme Piermont, le jardinier…) : on suit les sorties nommées jusqu'à son écran. */
  private meet(name: string, max = 6000): void {
    const id = this.compactNames().get(name);
    if (id === undefined) throw new Error(`compact « ${name} » inconnu`);
    for (let i = 0; i < max; i++) {
      if (this.reachable(name)) return;
      const where = this.engine.compacts.require(id)[F.screen]!;
      const exit = where !== this.screen ? this.pathTo(where) : null;
      if (exit && this.idle) this.run({ exit });
      else this.cycle();
    }
    throw new Error(`${name} introuvable ; ${this.state()}`);
  }

  /** Quitte un choix de dialogue qui se présente en chemin (un portier qui salue) par sa dernière ligne, celle qui prend congé. */
  leaveChooser(): void {
    for (let k = 0; k < 5 && this.choosing; k++) {
      const lines = this.choices();
      this.click(lines[lines.length - 1]!.id, "left");
      this.waitIdle();
    }
  }

  /** Vrai si l'objet `item` (nom de son icône sans `_menu`) est dans l'inventaire (`o0`… : variables 69 et suivantes). */
  has(item: string): boolean {
    const id = this.compactNames().get(`${item}_menu`) ?? this.compactNames().get(item);
    if (id === undefined) throw new Error(`objet « ${item} » inconnu`);
    for (let v = INVENTORY_FIRST_VAR; v < INVENTORY_FIRST_VAR + INVENTORY_VARS; v++) if (this.engine.vars[v] === id) return true;
    return false;
  }

  /** Lignes du choix de dialogue en cours. */
  choices(): Hotspot[] {
    return this.choosing ? this.hotspots().filter((h) => h.id >= Cpt.TEXT_1 && h.id <= Cpt.TEXT_11) : [];
  }

  /**
   * Conversation menée comme un joueur curieux : la première ligne qui n'est pas un adieu, tant que `until` est faux (au plus `max` choix) ;
   * la conversation est relancée si elle se termine. `prefer` : fragments à choisir d'abord quand ils sont proposés.
   */
  private chat(step: Extract<Step, { chat: Target }>): void {
    const goodbye = /^(Rien|A plus tard|Tant pis|Au revoir|Laissez tomber|Je vais poursuivre|Je ne veux pas)/;
    for (let i = 0; i < (step.max ?? 40); i++) {
      if (step.until(this)) {
        // Fin de la conversation : la dernière ligne d'un choix est celle qui prend congé.
        for (let k = 0; k < 5 && this.choosing; k++) {
          const lines = this.choices();
          this.click((lines.find((h) => goodbye.test(h.label)) ?? lines[lines.length - 1]!).id, "left");
          this.waitIdle();
        }
        return;
      }
      if (!this.choosing) {
        this.click(this.find(step.chat), "right");
        this.waitIdle();
        continue;
      }
      const lines = this.choices();
      const line =
        lines.find((h) => step.prefer?.some((p) => h.label.includes(p))) ?? lines.find((h) => !goodbye.test(h.label)) ?? lines[lines.length - 1]!;
      this.click(line.id, "left");
      this.waitIdle();
    }
    if (!step.until(this)) throw new Error(`conversation avec ${step.chat} : ${step.what} non atteint ; ${this.state()}`);
  }

  /** Referme la barre d'inventaire (pointeur au milieu de l'écran). */
  closeMenu(): void {
    for (let i = 0; i < 20 && this.engine.vars[Var.MENU]; i++) {
      this.host.push({ type: "move", x: 160, y: 100 });
      this.cycle();
    }
  }
}

/** Zone visée : nom du compact dans `sky.cpt` (cherché parmi les zones de l'écran courant) ou identifiant. */
export type Target = string | number;

interface Common {
  /** Écran attendu à la fin de l'étape. */
  screen?: number;
  /** Tours d'attente maximum avant que le joueur ait la main. */
  max?: number;
  /**
   * Résultat attendu de l'étape : sinon elle est rejouée (un personnage gêne le passage, un objet n'est pas encore prenable). Comme un joueur
   * qui recommence ; la partie reprise d'une sauvegarde n'a pas toujours le même minutage (voir `engine.md` § 20).
   */
  retry?: (d: Driver) => boolean;
  /** `"watch"` : ne pas attendre que le joueur ait la main après l'étape (une séquence non interactive suit). */
  then?: "watch";
  note?: string;
}

/** Une étape de la solution. */
export type Step =
  | ({ look: Target } & Common)
  | ({ act: Target } & Common)
  | ({ use: string; on: Target | { item: string } } & Common)
  | ({ walk: [number, number] } & Common)
  /** Clic sur une icône de l'inventaire (droit par défaut ; dans LINC, « DECONNEXION » est une icône). */
  | ({ icon: string; button?: "left" | "right" } & Common)
  /** Clic gauche (marcher vers la zone, sans exiger de changer d'écran). */
  | ({ go: Target } & Common)
  | ({ exit: Target; button?: "left" | "right" } & Common)
  | ({ say: string | number } & Common)
  /** Répondre à chaque choix de dialogue qui se présente (la première ligne, ou celle qui contient le texte) jusqu'à `until`. */
  | ({ reply: number | string; until: (d: Driver) => boolean; what: string } & Common)
  /** Rejoindre un personnage là où il se trouve (voir `Driver.meet`). */
  | ({ meet: string } & Common)
  /** Converser avec `chat` jusqu'à `until` (voir `Driver.chat`). */
  | ({ chat: Target; until: (d: Driver) => boolean; what: string; prefer?: string[] } & Common)
  | ({ wait: number } & Common)
  | ({ until: (d: Driver) => boolean; what: string } & Common);

/** Vrai quand un texte contenant `fragment` a été dit ou montré. */
export const heard =
  (fragment: string) =>
  (d: Driver): boolean =>
    d.texts.slice(d.stepStart).some((t) => t.includes(fragment));
