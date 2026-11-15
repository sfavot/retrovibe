/**
 * Joueur de la solution de *Croisière pour un cadavre* (vague K) : la solution est une liste d'étapes (`Step[]`, des données dans
 * `walkthrough.ts`) que `Driver.run` joue par de **vraies entrées de souris**, sans jamais écrire l'état du jeu.
 *
 * Les entrées sont des **niveaux par tour**, comme `CRUISE_INPUT` du banc (`n x y b` : à partir du tour `n`, souris en (x, y), boutons
 * `b`), posés par `onTickStart` avec `applyInputLevel` : la liste `inputs` se rejoue telle quelle dans ScummVM. Un clic = trois niveaux :
 * survol (1 tour), bouton enfoncé (2 tours), relâché (2 tours) ; jamais plus d'un changement de bouton par tour (`manageEvents`).
 *
 * Interface du jeu reprise de `input.ts` :
 * - un objet de l'écran est désigné par son **nom** (bloc de noms de l'overlay, celui que le jeu affiche dans le titre du menu) : `pointOf`
 *   balaie l'écran avec `findObject` (premier plan d'abord, comme le jeu) et choisit le point touché le plus central de la zone ; l'état du
 *   rastériseur, que `findObject` modifie, est remis comme avant le balayage ;
 * - clic gauche sur l'objet : menu de ses verbes (titre = nom de l'objet) ; clic sur l'entrée à sa position dessinée (`drawMenu`) ;
 * - clic droit : inventaire ; clic sur un objet de l'inventaire : menu de ses verbes ;
 * - verbe à deux objets : le bandeau « Objet:Verbe » s'affiche, puis clic sur le second objet (écran ou inventaire) ;
 * - dialogue (`dialogueEnabled`) : menu « Parler de » (personnes, puis sujets), les sujets déjà abordés ont la couleur `subColor` ;
 * - message (`userWait`) : un clic gauche le ferme.
 *
 * Une étape qui ne peut pas aboutir **lève** une erreur qui décrit l'état (tour, pièce, overlays, objets visibles, menu, derniers textes).
 */

import type { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { findObject } from "../../../src/games/croisiere/engine/input";
import { ObjType } from "../../../src/games/croisiere/engine/ids";
import { getObjectName, getSingleObjectParam } from "../../../src/games/croisiere/engine/objects";
import type { Menu, MenuElement } from "../../../src/games/croisiere/engine/menu";
import type { EngineState } from "../../../src/games/croisiere/engine/state";

/** Désignation d'un objet de l'écran : nom (premier trouvé, premier plan d'abord), ou nom et overlay, ou nom et rang parmi les homonymes. */
export type Target = string | { name: string; ovl?: string; idx?: number; nth?: number; at?: [number, number] };

export type Step =
  /** Verbe sur un objet de l'écran (`with` : second objet, à l'écran ou `{ inv }` dans l'inventaire). */
  | { verb: string; on: Target; with?: Target | { inv: string }; note?: string; expect?: string }
  /** Verbe sur un objet de l'inventaire (`with` : second objet). */
  | { verb: string; inv: string; with?: Target | { inv: string }; note?: string; expect?: string }
  /** Clic simple sur un objet sans menu (sortie, pièce du plan) ou sur un point. */
  | { click: Target | [number, number]; note?: string; expect?: string }
  /** Plan du bateau (« Carte » / « Utiliser »), puis la pièce `sNN`. */
  | { go: string; note?: string; expect?: string }
  /** Conversation ouverte par le jeu lui-même (après une scène) : mêmes `topics` que `talk`. */
  | { dialog: (string[] | "*")[]; note?: string; expect?: string }
  /** Conversation : `topics` = chemins de choix (`[personne, sujet]`), ou `"*"` = tous les sujets proposés ; puis « Merci de votre aide... ». */
  | { talk: Target; topics: (string[] | "*")[]; note?: string; expect?: string }
  /** Laisser passer des tours (`frames`) ou attendre que le joueur ait la main (`idle`). */
  | { wait: number; note?: string; expect?: string }
  | { idle: true; max?: number; note?: string; expect?: string }
  /** Fin de partie : laisser jouer (en fermant les messages) jusqu'au chargement de l'overlay `overlay` (après le générique). */
  | { end: string; max?: number; note?: string; expect?: string };

export interface CellInfo {
  ovl: number;
  ovlName: string;
  idx: number;
  type: number;
  name: string;
  freeze: number;
}

/** Texte vu par le joueur (message à l'écran) et tour de son apparition. */
export interface SeenText {
  frame: number;
  ovl: string;
  idx: number;
  text: string;
}

const SCREEN_W = 320;
const SCREEN_H = 200;
/** Tours laissés à un message affiché sans que le joueur ait la main avant de le fermer d'un clic. */
const MESSAGE_PATIENCE = 100;
/**
 * Tours pendant lesquels le joueur doit avoir la main avant d'agir : une scène peut démarrer quelques tours après l'entrée dans une pièce
 * (« Psssst, Inspecteur... »), et un clic lancé à ce moment ouvrirait un menu sous la scène.
 */
const IDLE_STABLE = 15;

export class Driver {
  /** Niveaux d'entrée écrits (`CRUISE_INPUT`) : `n x y b`. */
  readonly inputs: string[] = [];
  /** Messages apparus à l'écran, dans l'ordre. */
  readonly texts: SeenText[] = [];
  /** Niveau voulu (posé au début du tour suivant). */
  private want = { x: 0, y: 0, b: 0 };
  private applied = { x: 0, y: 0, b: 0 };
  private shown = new Set<string>();
  /** Journal des étapes (diagnostic). */
  readonly log: string[] = [];

  constructor(public engine: CroisiereEngine) {
    this.adopt(engine);
  }

  /**
   * Continue la partie dans `engine` (reprise d'une sauvegarde dans un moteur neuf) : les entrées par tour y sont rejouées à la suite, la
   * liste `inputs` et les textes vus continuent.
   */
  adopt(engine: CroisiereEngine): void {
    this.engine = engine;
    engine.onTickStart = (tick) => {
      const w = this.want;
      const a = this.applied;
      if (w.x !== a.x || w.y !== a.y || w.b !== a.b) {
        engine.applyInputLevel(w.x, w.y, w.b);
        this.applied = { ...w };
        this.inputs.push(`${tick} ${w.x} ${w.y} ${w.b}`);
      }
      engine.releaseBenchEscape();
    };
  }

  get e(): EngineState {
    return this.engine.state;
  }

  get frameNumber(): number {
    return this.engine.frameNumber;
  }

  /** Joue `n` tours (modaux compris). */
  frame(n = 1): void {
    for (let i = 0; i < n; i++) {
      if (this.engine.stopped) throw new Error("le jeu s'est arrêté");
      this.engine.runFrame();
      this.collectTexts();
    }
  }

  /** Fonds affichés successivement (`tour nom`), et overlays chargés successivement. */
  readonly backgrounds: string[] = [];
  readonly overlayLoads: string[] = [];
  private lastBackground = "";
  private lastOverlays = "";

  private collectTexts(): void {
    const e = this.e;
    const bg = e.display.backgroundNames[e.display.masterScreen] ?? "";
    if (bg !== this.lastBackground) {
      this.lastBackground = bg;
      this.backgrounds.push(`${this.frameNumber} ${bg}`);
    }
    const ovls = this.overlays().join(" ");
    if (ovls !== this.lastOverlays) {
      for (const name of ovls.split(" ")) if (name && !this.lastOverlays.split(" ").includes(name)) this.overlayLoads.push(`${this.frameNumber} ${name}`);
      this.lastOverlays = ovls;
    }
    const now = new Set<string>();
    for (const cell of e.cells) {
      if (cell.type !== ObjType.MESSAGE) continue;
      const key = `${cell.overlay}:${cell.idx}`;
      now.add(key);
      if (!this.shown.has(key)) {
        const text = e.getText(cell.idx, cell.overlay) ?? "";
        this.texts.push({ frame: this.frameNumber, ovl: e.overlays.entries[cell.overlay]?.name ?? "?", idx: cell.idx, text });
      }
    }
    this.shown = now;
  }

  /** Souris en (x, y) avec les boutons `b`, à partir du tour suivant. */
  mouse(x: number, y: number, b = 0): void {
    this.want = { x: Math.max(0, Math.min(SCREEN_W - 1, Math.round(x))), y: Math.max(0, Math.min(SCREEN_H - 1, Math.round(y))), b };
  }

  /** Clic : survol, bouton enfoncé, relâché. `button` 1 gauche, 2 droit. */
  click(x: number, y: number, button = 1): void {
    this.mouse(x, y, 0);
    this.frame(1);
    // `userDelay` efface le bouton au début du tour : le joueur attend qu'il soit écoulé.
    for (let i = 0; this.e.userDelay && i < 100; i++) this.frame(1);
    this.mouse(x, y, button);
    this.frame(2);
    this.mouse(x, y, 0);
    this.frame(2);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // État
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Nom de l'overlay `ovl`. */
  ovlName(ovl: number): string {
    return this.e.overlays.entries[ovl]?.name ?? "?";
  }

  /** Nom d'objet `idx` de l'overlay `ovl`. */
  objName(ovl: number, idx: number): string {
    const names = this.e.overlays.entries[ovl]?.data?.objectNames;
    return names && names.length ? getObjectName(names, idx) : "";
  }

  /** Cellules nommées (objets désignables), du premier plan vers le fond. */
  cells(): CellInfo[] {
    const out: CellInfo[] = [];
    for (let cell = this.e.cells.head.prev; cell; cell = cell.prev) {
      if (cell.overlay <= 0) continue;
      if (![ObjType.SPRITE, ObjType.MASK, ObjType.EXIT, ObjType.VIRTUAL].includes(cell.type as never)) continue;
      const name = this.objName(cell.overlay, cell.idx);
      if (!name.trim()) continue;
      out.push({ ovl: cell.overlay, ovlName: this.ovlName(cell.overlay), idx: cell.idx, type: cell.type, name, freeze: cell.freeze });
    }
    return out;
  }

  /** Overlays chargés. */
  overlays(): string[] {
    const out: string[] = [];
    const t = this.e.overlays;
    for (let i = 1; i < t.numOfLoadedOverlay; i++) if (t.entries[i]?.alreadyLoaded) out.push(t.entries[i]!.name);
    return out;
  }

  /** Le joueur a la main : utilisateur actif, pas de message à fermer, pas de marche automatique, aucun menu ni dialogue. */
  ready(): boolean {
    const e = this.e;
    return (
      e.userEnabled !== 0 &&
      !e.userWait &&
      !e.autoTrack &&
      e.currentActiveMenu === -1 &&
      !e.menuTable[0] &&
      !e.menuTable[1] &&
      !e.linkedRelation &&
      !e.dialogueEnabled &&
      !e.isMessage &&
      !!e.display.backgroundNames[e.display.masterScreen]
    );
  }

  /** Menu actif (objet, inventaire ou « Parler de »). */
  activeMenu(): Menu | null {
    const e = this.e;
    return e.currentActiveMenu >= 0 ? (e.menuTable[e.currentActiveMenu] ?? null) : null;
  }

  describe(): string {
    const e = this.e;
    const menu = this.activeMenu();
    const lines = [
      `tour ${this.frameNumber}, fond ${e.display.backgroundNames[e.display.masterScreen] ?? "?"}, ue=${e.userEnabled} uw=${e.userWait} at=${e.autoTrack} menu=${e.currentActiveMenu} dlg=${e.dialogueEnabled} rel=${!!e.linkedRelation} bd=${e.buttonDown} sd=${e.selectDown} md=${e.menuDown} mb=${e.currentMouseButton} ud=${e.userDelay} m1=${!!e.menuTable[1]}`,
      `overlays : ${this.overlays().join(" ")}`,
      `objets : ${[...new Set(this.cells().filter((c) => c.freeze === 0).map((c) => `${c.name}(${c.ovlName}:${c.idx}:${getSingleObjectParam(e, c.ovl, c.idx, 5)})`))].join(", ")}`,
    ];
    if (menu) lines.push(`menu « ${menu.stringPtr} » : ${menu.elements.map((el) => ((el.color & 0xff) !== 255 ? `${el.string}[${el.color}]` : el.string)).join(" | ")}`);
    lines.push(`textes : ${this.texts.slice(-4).map((t) => `« ${t.text.slice(0, 80)} »`).join(" ")}`);
    lines.push(`étapes :\n${this.log.slice(-8).join("\n")}`);
    return lines.join("\n");
  }

  fail(message: string): never {
    throw new Error(`${message}\n${this.describe()}`);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Attentes
  // ---------------------------------------------------------------------------------------------------------------------------------

  /**
   * Fait avancer le jeu jusqu'à ce que le joueur ait la main (stable 3 tours), en fermant les messages par un clic. Lève une erreur après
   * `max` tours.
   */
  idle(max = 20_000): void {
    let stable = 0;
    const start = this.frameNumber;
    while (stable < IDLE_STABLE) {
      if (this.frameNumber - start > max) this.fail(`le joueur n'a pas la main après ${max} tours`);
      if (this.e.dialogueEnabled && this.activeMenu()) this.fail("dialogue ouvert hors d'une étape de conversation");
      if (this.pump()) stable = 0;
      else stable = this.ready() ? stable + 1 : 0;
    }
  }

  /** Comme `idle`, mais s'arrête aussi si le jeu ouvre un dialogue (vrai dans ce cas). */
  private idleOrDialog(max = 20_000): boolean {
    let stable = 0;
    const start = this.frameNumber;
    while (stable < IDLE_STABLE) {
      if (this.frameNumber - start > max) this.fail(`le joueur n'a pas la main après ${max} tours`);
      if (this.e.dialogueEnabled) return true;
      if (this.pump()) stable = 0;
      else stable = this.ready() ? stable + 1 : 0;
    }
    return false;
  }

  /** Tours passés avec un message à l'écran sans que le joueur ait la main. */
  private waiting = 0;

  /**
   * Un pas d'attente : ferme le message qui attend un clic (`userWait`, ou message d'un script qui attend un bouton, `GetMouseButton`,
   * laissé `MESSAGE_PATIENCE` tours), sinon joue un tour. Vrai si un message a été fermé.
   */
  private pump(): boolean {
    const e = this.e;
    if (e.userWait) {
      this.dismiss();
      this.waiting = 0;
      return true;
    }
    const menuOpen = e.currentActiveMenu !== -1 && !!this.activeMenu();
    // Sur le plan du bateau, le message est le nom de la pièce survolée : ne pas cliquer.
    this.waiting = e.isMessage && !menuOpen && !this.overlays().includes("SHIP") ? this.waiting + 1 : 0;
    if (this.waiting > MESSAGE_PATIENCE) {
      this.dismiss();
      this.waiting = 0;
      return true;
    }
    this.frame(1);
    return false;
  }

  /** Démarrage : intro et première pièce, sans aucune entrée, jusqu'à ce que le joueur ait la main (tour 3484 dans le banc). */
  boot(max = 10_000): void {
    let stable = 0;
    while (stable < 3) {
      if (this.frameNumber > max) this.fail("première pièce non atteinte");
      this.frame(1);
      stable = this.ready() ? stable + 1 : 0;
    }
  }

  /** Ferme le message affiché (`userWait`) par un clic gauche sur place. */
  dismiss(): void {
    const { x, y } = this.want;
    this.mouse(x, y, 1);
    this.frame(2);
    this.mouse(x, y, 0);
    this.frame(2);
  }

  /** Attend (en fermant les messages) qu'un menu soit actif, ou que `until` soit vrai. */
  waitFor(what: string, until: () => boolean, max = 5_000): void {
    const start = this.frameNumber;
    while (!until()) {
      if (this.frameNumber - start > max) this.fail(`attente trop longue : ${what}`);
      this.pump();
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Désignation
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Exécute `fn` en remettant ensuite l'état du rastériseur de polygones (que `findObject` modifie). */
  private keepRasterizer<T>(fn: () => T): T {
    const poly = this.e.display.poly as unknown as { buf: Int16Array; segments: number; lines: number };
    const buf = poly.buf.slice();
    const segments = poly.segments;
    const lines = poly.lines;
    try {
      return fn();
    } finally {
      poly.buf.set(buf);
      poly.segments = segments;
      poly.lines = lines;
    }
  }

  /** Points de l'écran (pas de 2) où `findObject` désigne l'objet `(ovl, idx)`. */
  private hits(match: (ovl: number, idx: number) => boolean): { x: number; y: number; key: string }[] {
    const coarse = this.scan(match, 4);
    return coarse.length ? coarse : this.scan(match, 2);
  }

  /** Balayage de l'écran au pas `step` (points intérieurs). */
  private scan(match: (ovl: number, idx: number) => boolean, step: number): { x: number; y: number; key: string }[] {
    return this.keepRasterizer(() => {
      const out: { x: number; y: number; key: string }[] = [];
      for (let y = 1; y < SCREEN_H - 1; y += step) {
        for (let x = 1; x < SCREEN_W - 1; x += step) {
          const o = findObject(this.e, x, y);
          if (o.type !== -1 && match(o.ovl, o.idx)) out.push({ x, y, key: `${o.ovl}:${o.idx}` });
        }
      }
      return out;
    });
  }

  /** Point de l'écran où cliquer pour désigner `target` ; attend jusqu'à `max` tours qu'il apparaisse (personnage qui entre). */
  pointOf(target: Target, max = 3_000): [number, number] {
    const start = this.frameNumber;
    for (;;) {
      const p = this.tryPointOf(target);
      if (p) return p;
      if (this.frameNumber - start > max) this.fail(`objet introuvable ou non cliquable : ${JSON.stringify(target)}`);
      if (this.e.userWait) this.dismiss();
      else this.frame(10);
    }
  }

  private tryPointOf(target: Target): [number, number] | null {
    const t = typeof target === "string" ? { name: target } : target;
    if (t.at) return t.at;
    // Objets désignés (`findObject` rend l'objet suivi par la cellule : un personnage animé est désigné par son nom, pas celui de l'image).
    const points = new Map<string, [number, number][]>();
    for (const h of this.hits((ovl, idx) => this.objName(ovl, idx) === t.name && (!t.ovl || this.ovlName(ovl) === t.ovl) && (t.idx === undefined || idx === t.idx))) {
      if (!points.has(h.key)) points.set(h.key, []);
      points.get(h.key)!.push([h.x, h.y]);
    }
    if (!points.size) return null;
    // Homonymes : du premier plan vers le fond (ordre de la liste des cellules), puis dans l'ordre des numéros d'objet.
    const order = new Map<string, number>();
    this.cells().forEach((c, i) => {
      const key = `${c.ovl}:${c.idx}`;
      if (!order.has(key)) order.set(key, i);
    });
    const rank = (key: string) => order.get(key) ?? 1e6 + Number(key.split(":")[1]);
    const keys = [...points.keys()].sort((a, b) => rank(a) - rank(b));
    const key = keys[t.nth ?? 0];
    return key ? central(points.get(key)!) : null;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Point d'une entrée de menu (zone de `updateMenuMouse` : bords gauche et haut exclus). */
  private entryPoint(menu: Menu, el: MenuElement): [number, number] {
    const h = menu.gfx?.height ?? 8;
    return [Math.min(el.x + 40, SCREEN_W - 1), el.y + Math.max(1, Math.floor(h / 2))];
  }

  /** Clique l'entrée `text` du menu actif. */
  choose(text: string): void {
    // Un message qui attend un clic (`userWait`) prendrait le clic : on le ferme d'abord.
    this.waitFor(`message fermé avant « ${text} »`, () => !this.e.userWait && this.e.userEnabled !== 0);
    const menu = this.activeMenu();
    if (!menu) this.fail(`pas de menu pour choisir « ${text} »`);
    const el = menu.elements.find((x) => x.string === text) ?? menu.elements.find((x) => x.string.trim() === text.trim());
    if (!el) this.fail(`entrée « ${text} » absente du menu`);
    const [x, y] = this.entryPoint(menu, el);
    this.log.push(`  choix « ${text} » dans « ${menu.stringPtr} » (${menu.elements.map((m) => m.string).join("|")}) en ${x},${y} @${this.frameNumber}`);
    // Survol (sélection) puis clic.
    this.mouse(x, y, 0);
    this.frame(2);
    this.click(x, y);
  }

  /** Ouvre l'inventaire (clic droit) et choisit l'objet `name`. */
  private openInventoryItem(name: string): void {
    this.openInventory();
    this.choose(name);
  }

  /**
   * Clic droit : inventaire. Si un clic droit précédent a laissé `menuDown` sans menu (inventaire vide ou refermé par le jeu), le jeu
   * n'ouvre plus rien tant qu'un clic gauche ne l'a pas remis à zéro : le joueur clique d'abord à gauche (ce clic ne fait pas marcher).
   */
  private openInventory(): void {
    const { x, y } = this.restPoint();
    const open = () => !!this.e.menuTable[1] && this.e.currentActiveMenu === 1;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (this.e.menuDown && !this.e.menuTable[1] && !this.e.linkedRelation) this.click(x, y, 1);
      this.click(x, y, 2);
      for (let i = 0; i < 10 && !open(); i++) this.pump();
      if (open()) return;
      // Inventaire vide à cet instant (overlay pas encore rechargé après un gros plan) : on réessaie un peu plus tard.
      this.frame(20);
    }
    this.fail("l'inventaire ne s'ouvre pas");
  }

  /** Point neutre où ouvrir l'inventaire (milieu de l'écran : le menu y tient). */
  private restPoint(): { x: number; y: number } {
    return { x: 160, y: 60 };
  }

  /** Verbe `verb` dans le menu d'objet actif, puis second objet éventuel. */
  private verbThen(verb: string, second?: Target | { inv: string }): void {
    this.waitFor(`menu du verbe ${verb}`, () => this.e.currentActiveMenu === 0 && !!this.e.menuTable[0]);
    this.choose(verb);
    if (!second) return;
    if (!this.e.linkedRelation) this.fail(`le verbe « ${verb} » n'attend pas de second objet`);
    if (typeof second === "object" && "inv" in second) {
      this.openInventory();
      const menu = this.e.menuTable[1]!;
      const el = menu.elements.find((m) => m.string === second.inv);
      if (!el) this.fail(`objet « ${second.inv} » absent de l'inventaire`);
      const [ex, ey] = this.entryPoint(menu, el);
      this.mouse(ex, ey, 0);
      this.frame(2);
      this.click(ex, ey);
    } else {
      const [x, y] = this.pointOf(second);
      this.click(x, y);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Étapes
  // ---------------------------------------------------------------------------------------------------------------------------------

  run(step: Step): void {
    this.log.push(JSON.stringify(step).slice(0, 120));
    if ("idle" in step) {
      this.idle(step.max);
      return;
    }
    if ("wait" in step) {
      this.frame(step.wait);
      return;
    }
    if ("end" in step) {
      const start = this.frameNumber;
      while (!this.overlays().includes(step.end)) {
        if (this.frameNumber - start > (step.max ?? 50_000)) this.fail(`overlay de fin ${step.end} non atteint`);
        this.pump();
      }
      return;
    }
    const textsBefore = this.texts.length;
    if ("talk" in step && this.idleOrDialog()) {
      // Le personnage engage lui-même la conversation (en entrant dans sa pièce).
      this.converse(step.topics);
      return;
    }
    if ("dialog" in step) {
      this.waitFor("dialogue ouvert par le jeu", () => this.e.dialogueEnabled, 20_000);
      this.converse(step.dialog);
      return;
    }
    if (!("talk" in step)) this.idle();
    if ("verb" in step && "on" in step) {
      const [x, y] = this.pointOf(step.on);
      this.click(x, y);
      this.verbThen(step.verb, step.with);
    } else if ("verb" in step) {
      this.openInventoryItem(step.inv);
      this.verbThen(step.verb, step.with);
    } else if ("click" in step) {
      const [x, y] = Array.isArray(step.click) && typeof step.click[0] === "number" ? (step.click as [number, number]) : this.pointOf(step.click as Target);
      this.click(x, y);
    } else if ("go" in step) {
      this.openInventoryItem("Carte");
      this.verbThen("Utiliser");
      // Sur le plan, le nom de la pièce survolée est un message : on attend seulement que l'utilisateur soit actif 3 tours de suite.
      let onMap = 0;
      this.waitFor("plan du bateau", () => {
        onMap = this.overlays().includes("SHIP") && this.e.userEnabled !== 0 && !this.e.userWait && !this.e.autoTrack ? onMap + 1 : 0;
        return onMap >= 3;
      });
      // Clic sur la pièce (son nom s'affiche), puis sur « exit » : le plan se ferme et Raoul y est (ou « je ne peux pas y entrer »).
      const [x, y] = this.pointOf({ name: step.go.toLowerCase(), ovl: "SHIP" });
      this.click(x, y);
      this.frame(4);
      const [ex, ey] = this.pointOf({ name: "exit", ovl: "SHIP" });
      const refusals = this.texts.length;
      this.click(ex, ey);
      this.waitFor(`arrivée en ${step.go}`, () => {
        if (this.texts.slice(refusals).some((t) => t.ovl === "SHIP" && t.idx === 0)) this.fail(`pièce ${step.go} interdite`);
        return !this.overlays().includes("SHIP") && this.overlays().includes(step.go.toUpperCase().replace(/[A-Z]$/, ""));
      });
    } else if ("talk" in step) {
      this.talk(step.talk, step.topics);
    }
    if (step.expect) {
      this.idle();
      const seen = this.texts.slice(textsBefore).some((t) => t.text.includes(step.expect!));
      if (!seen) this.fail(`texte attendu absent : « ${step.expect} »`);
    }
  }

  /** Conversation avec `who` : ouvre « Parler », suit les chemins de sujets (`"*"` : tous les nouveaux), puis « Merci de votre aide... ». */
  private talk(who: Target, topics: (string[] | "*")[]): void {
    const [x, y] = this.pointOf(who);
    if (this.e.dialogueEnabled) {
      // Le personnage a engagé la conversation pendant qu'on le cherchait.
      this.converse(topics);
      return;
    }
    this.click(x, y);
    this.waitFor("menu du personnage", () => this.e.dialogueEnabled || (this.e.currentActiveMenu === 0 && !!this.e.menuTable[0]));
    if (!this.e.dialogueEnabled) this.verbThen("Parler");
    this.waitFor("début du dialogue", () => this.e.dialogueEnabled);
    this.converse(topics);
  }

  /** Dialogue ouvert : suit les chemins de sujets (`"*"` : tous), puis « Merci de votre aide... ». */
  private converse(topics: (string[] | "*")[]): void {
    if (!this.dialogMenu()) return;
    for (const path of topics) {
      if (path === "*") {
        if (!this.askEverything()) return;
        continue;
      }
      for (const choice of path) {
        const menu = this.dialogMenu();
        if (!menu) this.fail(`conversation terminée avant « ${choice} »`);
        // Un chemin commence au premier niveau (les personnes) : on y revient d'abord.
        if (choice === path[0] && menu.elements.some((el) => el.string === CHANGE_TOPIC) && !menu.elements.some((el) => el.string === choice)) {
          this.choose(CHANGE_TOPIC);
          if (!this.dialogMenu()) this.fail(`conversation terminée avant « ${choice} »`);
        }
        this.choose(choice);
      }
    }
    if (this.dialogMenu()) this.choose(END_TALK);
    // Le personnage peut relancer la conversation de lui-même (scène qui suit) : on la mène de la même façon.
    if (this.idleOrDialog()) {
      if (++this.relaunches > 5) this.fail("conversation relancée sans fin");
      this.converse(topics);
    }
    this.relaunches = 0;
  }

  private relaunches = 0;

  /**
   * Menu « Parler de » stable (3 tours sans message, utilisateur actif, aucun message à fermer), ou `null` si la conversation est finie
   * (le joueur a la main hors dialogue).
   */
  private dialogMenu(max = 20_000): Menu | null {
    const start = this.frameNumber;
    let stable = 0;
    for (;;) {
      if (this.frameNumber - start > max) this.fail("menu « Parler de » attendu");
      const e = this.e;
      const ok = e.dialogueEnabled && !!this.activeMenu() && !e.userWait && e.userEnabled !== 0 && !e.isMessage;
      if (ok && ++stable >= 3) return this.activeMenu();
      if (!ok) stable = 0;
      if (!e.dialogueEnabled && this.ready()) {
        // Fin de conversation (le jeu a refermé le dialogue) : on vérifie que c'est stable.
        if (!this.idleOrDialog()) return null;
      }
      this.pump();
    }
  }

  /**
   * Pose chaque sujet proposé qui n'a pas encore été posé à cet interlocuteur dans la partie, personne après personne, jusqu'à ce qu'il
   * n'y en ait plus (un sujet posé peut en ouvrir d'autres). Faux si le jeu a fini la conversation.
   */
  private askEverything(): boolean {
    // Chaque conversation repose tout : certaines réponses déjà entendues font avancer l'enquête quand on les redemande plus tard.
    const asked = new Set<string>();
    const who = this.objName(this.e.dialogueOvl, this.e.dialogueObj);
    const exhausted = new Set<string>();
    for (let guard = 0; guard < 500; guard++) {
      const menu = this.dialogMenu();
      if (!menu) return false;
      const isSub = menu.elements.some((el) => el.string === CHANGE_TOPIC);
      const entries = menu.elements.filter((el) => el.string !== CHANGE_TOPIC && el.string !== END_TALK);
      if (isSub) {
        const key = (el: MenuElement) => `${who}/${this.category}/${el.string}/${el.subs.map((x) => `${this.ovlName(x.ovlIdx)}:${x.header}`).join(",")}`;
        const topic = entries.find((el) => !asked.has(key(el)));
        if (topic) {
          asked.add(key(topic));
          exhausted.clear();
          this.choose(topic.string);
        } else {
          exhausted.add(this.category ?? "?");
          this.choose(CHANGE_TOPIC);
        }
        continue;
      }
      const person = entries.find((el) => !exhausted.has(el.string));
      if (!person) return true;
      this.category = person.string;
      this.choose(person.string);
    }
    this.fail("conversation sans fin");
  }

  /** Personne choisie au premier niveau du menu « Parler de ». */
  private category: string | null = null;
}

/** Entrées fixes du menu « Parler de ». */
const CHANGE_TOPIC = "Changer de sujet";
const END_TALK = "Merci de votre aide...";

/** Point le plus proche du centre de gravité des points touchés. */
function central(points: [number, number][]): [number, number] {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  let best = points[0]!;
  let bestD = Infinity;
  for (const p of points) {
    const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
