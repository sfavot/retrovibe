import { type SceneHotspot } from "../data/scene";
import { messageId } from "../data/text";
import { opensInputLine } from "./input-line";
import {
  DEFAULT_TOOL,
  ICON_FOOT_Y,
  ICON_SLOTS,
  INT_PAGE_BUTTON,
  INT_ROOM_BUTTON,
  INT_TOOL_INDICATOR,
  type ImageSize,
  SYSTEM_ICONS,
  type SystemCommand,
  TOOL_BOOTS,
  type ToolRecord,
  VERB_CLASS_BASE,
  findTool,
  iconImageSize,
  iconKind,
  isIconAvailable,
  nextPage,
  slotCenterX,
} from "./icons";
import type { ParsedCommand } from "./parser";

/**
 * Contrôleur d'interface d'*Armaeth* : barre d'icônes, curseur, souris et clavier, sans DOM
 * (`docs/armaeth/interface.md`). Il transforme un clic ou une touche en actions que le moteur exécute ; les
 * commandes issues d'un clic ont la forme de celles de l'analyseur (`ParsedCommand`), pour que l'exécution des
 * verbes soit partagée avec la phrase tapée (§ 8).
 */

export const BUTTON_LEFT = 1;
export const BUTTON_RIGHT = 2;

/** Plage de la souris (`192e:0008`) : `x 4..316`, `y 10..194`. */
export const MOUSE_X_RANGE = [4, 316] as const;
export const MOUSE_Y_RANGE = [10, 194] as const;
/** Priorité de dessin du curseur (`1539:0084`). */
export const CURSOR_PRIORITY = 250;
/** Images du curseur `INT 1` : pointeur 10×11, visages rouges 11×11 (interface.md § 3). */
export const POINTER_SIZE: ImageSize = { width: 10, height: 11 };
export const REFUSAL_SIZE: ImageSize = { width: 11, height: 11 };
/** Le refus dure 20 passages ignorés ; le 21e rend le curseur (interface.md § 5, point 1). */
export const REFUSAL_TICKS = 20;
/** Messages `S16` / `S49` : pas de héros (interface.md § 5, point 6). */
export const MESSAGE_NO_HERO = messageId("S", 16);
export const MESSAGE_NO_HERO_DEAD = messageId("S", 49);

/** Position d'une cellule d'inventaire (`1652:0006`) : centre `x = 28 + 24k`, pied `y = 195`. */
export function inventoryAnchor(k: number): { x: number; y: number } {
  return { x: 28 + 24 * k, y: 195 };
}

// ---------------------------------------------------------------------------------------------------------------
// Monde vu par l'interface

/**
 * Cible d'un clic (objet de salle, de l'inventaire, du panneau de contenu, ou décor), en coordonnées d'écran :
 * `x` = centre, `y` = pied du sprite (le fournisseur ajoute l'origine de la scène aux listes 1 et 4, et saute le héros
 * et les objets invisibles, § 5.1 et § 5.2).
 */
export interface ClickTarget {
  /** `object` : type 2 (`15000 + num`) ; `decor` : type 1 (`4000 + num`, pointeur effacé). */
  kind: "object" | "decor";
  /** `Num` : type de l'objet. */
  num: number;
  /** `Ser` : numéro de série (objets seulement). */
  serial: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Commande issue d'un clic : même forme que `parseCommand`, avec les cibles précises (le texte, lui, désigne un nom). */
export interface ToolCommand extends ParsedCommand {
  source: "click";
  directTarget: ClickTarget | null;
  indirectTarget: ClickTarget | null;
}

/** Retour de l'exécution d'une commande par le moteur (`2210:0008`). */
export interface ExecuteOutcome {
  /** Un gestionnaire a réussi (7). */
  success: boolean;
  /** Politique `4cc6` impaire (`regarder`) : on continue avec les objets suivants de la même liste (sauf liste 4). */
  continueList?: boolean;
}

export interface InterfaceWorld {
  /** Un script tourne (`DGROUP:4b34 ≠ 0`) : clics et la plupart des touches sont ignorés. */
  readonly scriptRunning: boolean;
  /** Héros présent (`4bfe`). */
  readonly heroPresent: boolean;
  /** Héros mort : message `S49` au lieu de `S16` (`4b67`, hypothèse interface.md § 5 point 6). */
  readonly heroDead?: boolean;
  /** `DGROUP:4b50 ≠ 0` : le héros peut être déplacé au clavier (7 après `sys 3`). */
  readonly moveEnabled: boolean;
  /** Console de débogage active (`dgs` > 10) : F7 et F8. */
  readonly debugEnabled?: boolean;
  /** Ligne de saisie ouverte : les touches vont à l'automate de `input-line.ts`. */
  readonly inputLineOpen?: boolean;
  /** Salle trop sombre (`197e:0272 ≠ 0`) : l'outil bottes affiche le message d'obscurité. */
  readonly dark?: boolean;
  /** Fenêtre de la scène : origine `(x0, y0)` et taille. */
  readonly scene: { x0: number; y0: number; width: number; height: number };
  /** Points sensibles de la scène (`data/scene.ts`), coordonnées relatives à la scène. */
  readonly hotspots: readonly SceneHotspot[];
  /** Cibles de la liste 1 (objets de la salle), 2 (inventaire), 3 (panneau de contenu) ou 4 (décors), dans l'ordre de la liste. */
  targets(list: 1 | 2 | 3 | 4): readonly ClickTarget[];
  /** Objet sélectionné dont le contenu est affiché (`4c12`), premier objet de la liste 3. */
  readonly selected: ClickTarget | null;
  /** Messages en file (`1e58:00f3`). */
  pendingMessages(): number;
  /** Exécute une commande par le chemin partagé avec la phrase tapée. */
  execute(command: ToolCommand): ExecuteOutcome;
  /** Marche vers un point relatif à la scène (`1504:0002`) : vrai si un trajet existe. */
  walk(x: number, y: number): boolean;
  /** Sortie par un secteur 0 haut, 1 droite, 2 bas, 3 gauche (`1504:0274`) : vrai si la salle a une sortie là. */
  exit(sector: number): boolean;
  /** La salle a une sortie dans ce secteur (sans y envoyer le héros). */
  hasExit(sector: number): boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Actions

export type HeroKey = "home" | "end" | "up" | "down" | "left" | "right" | "pgup" | "pgdn";

/** Vecteurs `(Hor, Prf)` des touches de déplacement (interface.md § 7, type 4). */
export const HERO_KEY_VECTORS: Readonly<Record<HeroKey, readonly [number, number]>> = {
  home: [-1, -1],
  end: [-1, 1],
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  pgup: [1, -1],
  pgdn: [1, 1],
};

export type HeroMove = HeroKey | "climb" | "descend";

/** Commande des touches de fonction (interface.md § 7, type 2). */
export const FUNCTION_KEY_COMMANDS: Readonly<Record<number, string>> = {
  1: "help",
  2: "save",
  3: "restore",
  4: "continue",
  5: "restart",
  6: "score",
  7: "debug1",
  8: "debug2",
  10: "inventory",
};

export type InterfaceAction =
  /** Outil choisi : le curseur et l'indicateur prennent l'image de la variante ; l'objet tenu est lâché. */
  | { type: "selectTool"; tool: number; variant: 0 | 1 }
  /** Outil par défaut (clic sur l'emblème ou changement de page). */
  | { type: "defaultTool" }
  | { type: "changePage"; page: number }
  | { type: "holdObject"; target: ClickTarget }
  | { type: "releaseObject" }
  /** Commande de clic, avec le résultat de son exécution. */
  | { type: "command"; command: ToolCommand; success: boolean }
  /** Bouton « salle » (`INT 2`) : verbe 5 ou 42 sans objet, appelé directement (hors `2210:0008`). */
  | { type: "roomButton"; command: ParsedCommand }
  /** Marche vers un point relatif à la scène ; arrête le héros et ferme le panneau de contenu. */
  | { type: "walkTo"; x: number; y: number; ok: boolean }
  | { type: "exitBySector"; sector: number; ok: boolean }
  /** Message `I<code mod 1000>` de priorité 8 (classe `I`). */
  | { type: "hotspotMessage"; id: number; code: number; messageId: number }
  | { type: "message"; id: number }
  /** Message d'obscurité de `1504:0002` (identifiant inconnu, interface.md question 7). */
  | { type: "darkRoom" }
  /** Aucun effet ni message : animation des quatre visages rouges. */
  | { type: "refusal" }
  | { type: "system"; command: SystemCommand; delta?: number; mode?: "toggle" | "step" | "normal" }
  /** `toggle` (défaut, jeu d'origine) : rappuyer arrête ; `start` : part sans bascule (flèche tenue, option du portage). */
  | { type: "heroKey"; dir: HeroMove; mode?: "toggle" | "start" }
  | { type: "openInputLine"; char?: string; recall?: boolean }
  | { type: "functionKey"; n: number; command: string }
  /** F8 pendant un script : saute jusqu'au prochain `fin` (`4b38 = 7`). Le moteur ne l'applique qu'aux scripts non bloquants (`cnt` nul). */
  | { type: "scriptStep" }
  | { type: "bell" };

export type NavKey = HeroKey | "insert";

export type KeyEvent =
  /** Type 1 : caractère. */
  | { type: "char"; char: string }
  /** Type 2 : F1 à F10 ; les variantes Maj / Ctrl / Alt sont ignorées. */
  | { type: "function"; n: number; modifier?: "shift" | "ctrl" | "alt" }
  /** Type 3 : Alt + lettre, chiffre, `-` ou `=`. */
  | { type: "alt"; key: string }
  /**
   * Type 4 : touches de déplacement et Inser. `held` (option du portage « marcher tant qu'on tient la flèche ») : `press` fait partir
   * le héros sans bascule, `release` l'arrête s'il va encore dans cette direction. Sans `held` : comportement du jeu d'origine.
   */
  | { type: "nav"; key: NavKey; held?: "press" | "release" };

export interface PointerModifiers {
  ctrl: boolean;
  /** Toucher du doigt (option du portage : avec les bottes, un toucher au bord de la scène y fait sortir, voir `TOUCH_EXIT_MARGIN`). */
  touch?: boolean;
}

/**
 * Au doigt, avec les bottes : un toucher à moins de ce nombre de pixels d'un bord de la scène où la salle a une sortie fait sortir de ce
 * côté, comme le clic droit (`1504:0274`). Écart du portage : sans souris ni flèches, l'appui long (clic droit) était le seul moyen de
 * changer de salle, et rien ne l'indiquait. Ailleurs, ou sans sortie de ce côté, le toucher fait marcher comme le clic gauche.
 */
export const TOUCH_EXIT_MARGIN = 20;

// ---------------------------------------------------------------------------------------------------------------
// Curseur

export type CursorKind = "pointer" | "tool" | "held" | "refusal";

export interface CursorView {
  kind: CursorKind;
  /** Image : ressource `INT` (numéro, `Fig`) ou image de l'objet tenu. */
  sprite: { resource: "INT"; num: number; fig: number } | { resource: "object"; num: number; serial: number; fig: 0 };
  width: number;
  height: number;
  /** Centre `x` et pied `y` (le sprite est centré sur la souris). */
  x: number;
  y: number;
  priority: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Rectangle `[x0, x1) × (y0, y1]` d'un sprite de centre `x` et de pied `y`. */
function spriteRect(x: number, foot: number, width: number, height: number): Rect {
  const x0 = x - (width >> 1);
  return { x0, y0: foot - height, x1: x0 + width, y1: foot };
}

/** Recouvrement de rectangles (§ 5, point 5) : pas de test de point, pas de priorité d'affichage. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

const targetCode = (t: ClickTarget) => (t.kind === "decor" ? 4000 : 15000) + t.num;

/** Secteur diagonal d'un point relatif à la scène : 0 haut, 1 droite, 2 bas, 3 gauche. */
export function sectorOf(x: number, y: number, width: number, height: number): number {
  // hypothèse (interface.md § 5.6) : les diagonales sont celles du rectangle de la scène, égalité côté horizontal.
  const dx = x - width / 2;
  const dy = y - height / 2;
  if (Math.abs(dx) * height >= Math.abs(dy) * width) return dx >= 0 ? 1 : 3;
  return dy < 0 ? 0 : 2;
}

export interface InterfaceOptions {
  /** Page d'icônes initiale (champ `+0x2D` de `INT 3`, sauvegardé avec le monde). */
  page?: number;
}

export class InterfaceController {
  private pageIndex: number;
  private toolNum = DEFAULT_TOOL;
  private toolVariant: 0 | 1 = 0;
  private heldTarget: ClickTarget | null = null;
  private mouseX = 160;
  private mouseY = 12;
  /** Compteur de refus (`Tim`) ; `-1` hors refus. */
  private refusal = -1;
  /** Attente du relâchement des boutons (`1db5:01aa`) : un clic = une action. */
  private latched = false;

  constructor(
    private readonly world: InterfaceWorld,
    options: InterfaceOptions = {},
  ) {
    this.pageIndex = options.page ?? 0;
  }

  get page(): number {
    return this.pageIndex;
  }
  get tool(): { num: number; variant: 0 | 1 } {
    return { num: this.toolNum, variant: this.toolVariant };
  }
  get held(): ClickTarget | null {
    return this.heldTarget;
  }
  get refusing(): boolean {
    return this.refusal >= 0;
  }

  /** Remise à l'état de départ (chargement) : outil par défaut, page conservée ou imposée. */
  reset(page = this.pageIndex): void {
    this.pageIndex = page;
    this.defaultTool();
    this.refusal = -1;
    this.latched = false;
  }

  private defaultTool(): void {
    this.toolNum = DEFAULT_TOOL;
    this.toolVariant = 0;
    this.heldTarget = null;
  }

  /** Apparence du curseur (priorité 250). */
  cursor(): CursorView {
    let kind: CursorKind;
    let sprite: CursorView["sprite"];
    let size: ImageSize;
    if (this.refusal >= 0) {
      kind = "refusal";
      sprite = { resource: "INT", num: 1, fig: 1 };
      size = REFUSAL_SIZE;
    } else if (this.heldTarget) {
      kind = "held";
      sprite = { resource: "object", num: this.heldTarget.num, serial: this.heldTarget.serial, fig: 0 };
      size = { width: this.heldTarget.width, height: this.heldTarget.height };
    } else if (this.toolNum !== DEFAULT_TOOL) {
      kind = "tool";
      sprite = { resource: "INT", num: this.toolNum, fig: this.toolVariant };
      size = iconImageSize(this.toolNum, this.toolVariant) ?? POINTER_SIZE;
    } else {
      kind = "pointer";
      sprite = { resource: "INT", num: 1, fig: 0 };
      size = POINTER_SIZE;
    }
    return { kind, sprite, ...size, x: this.mouseX, y: this.mouseY + (size.height >> 1), priority: CURSOR_PRIORITY };
  }

  /** Une image de jeu : avance l'animation de refus (le 21e passage rend le curseur et attend le relâchement). */
  tick(): void {
    if (this.refusal < 0) return;
    this.refusal += 1;
    if (this.refusal > REFUSAL_TICKS) {
      this.refusal = -1;
      this.latched = true;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Souris

  /**
   * État de la souris à une image (`1564:0004`) : `buttons` est un masque `BUTTON_LEFT | BUTTON_RIGHT`. Sans bouton
   * (ou pendant un script, ou un refus) il ne se passe rien d'autre que le suivi de la position.
   */
  pointer(x: number, y: number, buttons: number, modifiers: PointerModifiers = { ctrl: false }): InterfaceAction[] {
    if (this.refusal >= 0) return [];
    this.mouseX = Math.min(MOUSE_X_RANGE[1], Math.max(MOUSE_X_RANGE[0], Math.round(x)));
    this.mouseY = Math.min(MOUSE_Y_RANGE[1], Math.max(MOUSE_Y_RANGE[0], Math.round(y)));
    if (buttons === 0) {
      this.latched = false;
      return [];
    }
    if (this.latched || this.world.scriptRunning) return [];
    this.latched = true;
    return this.click(buttons, modifiers);
  }

  private click(buttons: number, modifiers: PointerModifiers): InterfaceAction[] {
    const record = findTool(this.toolNum, this.toolVariant);
    if (!record) return [];
    const actions: InterfaceAction[] = [];
    const right = (buttons & BUTTON_RIGHT) !== 0 && (buttons & BUTTON_LEFT) === 0;
    const cursor = this.cursor();
    const rect = spriteRect(cursor.x, cursor.y, cursor.width, cursor.height);
    let successes = 0;
    let messages = 0;

    for (let list = 0; list < 5; list++) {
      if (!record.lists[list]) continue;
      if (list === 0) {
        const icon = this.interfaceHit(rect);
        if (icon !== undefined) {
          this.clickInterface(icon, buttons, actions);
          return actions;
        }
        continue;
      }
      if (!this.world.heroPresent) {
        actions.push({ type: "message", id: this.world.heroDead ? MESSAGE_NO_HERO_DEAD : MESSAGE_NO_HERO });
        return actions;
      }
      const targets = this.world.targets(list as 1 | 2 | 3 | 4);
      for (const target of targets) {
        if (!overlaps(rect, spriteRect(target.x, target.y, target.width, target.height))) continue;
        if (list === 2 && record.grab && !this.heldTarget && modifiers.ctrl) {
          this.heldTarget = target;
          actions.push({ type: "holdObject", target });
          return actions;
        }
        const first = list === 3 ? this.world.selected : this.heldTarget;
        const command = this.buildCommand(record, first, target, (buttons & BUTTON_RIGHT) !== 0);
        const outcome = this.world.execute(command);
        actions.push({ type: "command", command, success: outcome.success });
        if (outcome.success) {
          successes += 1;
          if (!(outcome.continueList && list !== 4)) break;
        }
      }
    }

    // Points sensibles (§ 5.7) : file vide, point brut de la souris, tous les enregistrements recouverts.
    if (record.hotspots && this.world.pendingMessages() === 0) {
      const { x0, y0 } = this.world.scene;
      const px = this.mouseX - x0;
      const py = this.mouseY - y0;
      for (const h of this.world.hotspots) {
        if (!h.rect || px < h.rect.x0 || px > h.rect.x1 || py < h.rect.y0 || py > h.rect.y1) continue;
        const id = h.messageId % 1000;
        actions.push({ type: "hotspotMessage", id, code: h.messageId, messageId: messageId("I", id) });
        messages += 1;
      }
    }

    // Clic dans le vide (§ 5.6).
    if (record.empty && successes === 0 && messages === 0 && this.world.pendingMessages() === 0) {
      const outcome = this.clickEmpty(record, right, modifiers, actions);
      successes += outcome.successes;
      messages += outcome.messages;
    }

    if (successes > 0 || messages > 0 || this.world.pendingMessages() > 0) {
      if (this.heldTarget) {
        this.heldTarget = null;
        actions.push({ type: "releaseObject" });
      }
    } else {
      this.refusal = 0;
      actions.push({ type: "refusal" });
    }
    return actions;
  }

  /** Construction de la phrase (`1553:0004`, § 5.3 et § 5.4). */
  private buildCommand(record: ToolRecord, first: ClickTarget | null, clicked: ClickTarget, rightDown: boolean): ToolCommand {
    const invert = record.inverse || (rightDown && record.rightInverts && !this.heldTarget);
    const direct = invert ? first : clicked;
    const indirect = invert ? clicked : first;
    return {
      status: "ok",
      normalized: "",
      verb: VERB_CLASS_BASE + record.verb,
      preposition: indirect ? record.preposition : 0,
      direct: direct ? [targetCode(direct)] : [],
      indirect: indirect ? [targetCode(indirect)] : [],
      source: "click",
      directTarget: direct,
      indirectTarget: indirect,
    };
  }

  private clickEmpty(
    record: ToolRecord,
    right: boolean,
    modifiers: PointerModifiers,
    actions: InterfaceAction[],
  ): { successes: number; messages: number } {
    if (record.num === TOOL_BOOTS) {
      if (!this.world.heroPresent) {
        actions.push({ type: "message", id: this.world.heroDead ? MESSAGE_NO_HERO_DEAD : MESSAGE_NO_HERO });
        return { successes: 0, messages: 1 };
      }
      if (this.world.dark) {
        actions.push({ type: "darkRoom" });
        return { successes: 1, messages: 0 };
      }
      const { x0, y0, width, height } = this.world.scene;
      const x = this.mouseX - x0;
      const y = this.mouseY - y0;
      const nearEdge = Math.min(x, y, width - 1 - x, height - 1 - y) < TOUCH_EXIT_MARGIN;
      if (right || (modifiers.touch && nearEdge && this.world.hasExit(sectorOf(x, y, width, height)))) {
        const sector = sectorOf(x, y, width, height);
        const ok = this.world.exit(sector);
        actions.push({ type: "exitBySector", sector, ok });
        return { successes: ok ? 1 : 0, messages: 0 };
      }
      const ok = this.world.walk(x, y);
      actions.push({ type: "walkTo", x, y, ok });
      return { successes: ok ? 1 : 0, messages: 0 };
    }
    // Outil « mettre » : pose l'objet tenu au sol. hypothèse (interface.md § 5.6) : l'un ou l'autre bouton.
    if (record.verb !== 0 && this.heldTarget) {
      const grounded: ToolCommand = {
        status: "ok",
        normalized: "",
        verb: VERB_CLASS_BASE + record.verb,
        preposition: 0,
        direct: [targetCode(this.heldTarget)],
        indirect: [],
        source: "click",
        directTarget: this.heldTarget,
        indirectTarget: null,
      };
      const outcome = this.world.execute(grounded);
      actions.push({ type: "command", command: grounded, success: outcome.success });
      return { successes: outcome.success ? 1 : 0, messages: 0 };
    }
    return { successes: 0, messages: 0 };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Objets d'interface (liste 0)

  /** Objets `INT` cliquables (§ 3.3) avec leur rectangle : emblème, magicien, elfe, icônes de la page courante. */
  private interfaceObjects(): { num: number; rect: Rect }[] {
    const list: { num: number; rect: Rect }[] = [
      { num: INT_ROOM_BUTTON, rect: spriteRect(8, 22, 11, 24) },
      { num: INT_PAGE_BUTTON, rect: spriteRect(312, 22, 11, 28) },
    ];
    // `INT 4` : 1×1 au repos, sinon copie de l'image du curseur (hypothèse, interface.md question 3).
    const tool = this.toolNum === DEFAULT_TOOL ? { width: 1, height: 1 } : (iconImageSize(this.toolNum, this.toolVariant) ?? { width: 1, height: 1 });
    list.push({ num: INT_TOOL_INDICATOR, rect: spriteRect(160, 17, tool.width, tool.height) });
    const icons = ICON_SLOTS[this.pageIndex] ?? [];
    // hypothèse (interface.md § 5.1) : ordre de création des icônes = numéro croissant.
    for (const num of [...icons].sort((a, b) => a - b)) {
      if (!isIconAvailable(this.pageIndex, num)) continue;
      const size = iconImageSize(num, 0);
      if (!size) continue;
      list.push({ num, rect: spriteRect(slotCenterX(icons.indexOf(num)), ICON_FOOT_Y, size.width, size.height) });
    }
    return list;
  }

  private interfaceHit(cursor: Rect): number | undefined {
    return this.interfaceObjects().find((o) => overlaps(cursor, o.rect))?.num;
  }

  private clickInterface(num: number, buttons: number, actions: InterfaceAction[]): void {
    const right = (buttons & BUTTON_RIGHT) !== 0 && (buttons & BUTTON_LEFT) === 0;
    const variant = right ? 1 : 0;
    if (num === INT_TOOL_INDICATOR) {
      this.defaultTool();
      actions.push({ type: "defaultTool" });
      return;
    }
    if (num === INT_PAGE_BUTTON) {
      this.pageIndex = nextPage(this.pageIndex, (buttons & BUTTON_RIGHT) !== 0, (buttons & BUTTON_LEFT) !== 0);
      this.defaultTool();
      actions.push({ type: "changePage", page: this.pageIndex });
      return;
    }
    if (num === INT_ROOM_BUTTON) {
      if (!this.world.heroPresent) {
        actions.push({ type: "message", id: this.world.heroDead ? MESSAGE_NO_HERO_DEAD : MESSAGE_NO_HERO });
        return;
      }
      actions.push({
        type: "roomButton",
        command: { status: "ok", normalized: "", verb: VERB_CLASS_BASE + (right ? 42 : 5), preposition: 0, direct: [], indirect: [] },
      });
      return;
    }
    const kind = iconKind(num);
    if (kind === "tool") {
      this.toolNum = num;
      this.toolVariant = variant;
      this.heldTarget = null;
      actions.push({ type: "selectTool", tool: num, variant });
    } else if (kind === "ladder") {
      if (!this.world.heroPresent) {
        actions.push({ type: "message", id: this.world.heroDead ? MESSAGE_NO_HERO_DEAD : MESSAGE_NO_HERO });
      } else if (this.world.moveEnabled) {
        actions.push({ type: "heroKey", dir: right ? "descend" : "climb" });
      }
    } else if (kind === "system") {
      const command = SYSTEM_ICONS.get(num);
      if (!command) return;
      const action: InterfaceAction = { type: "system", command };
      if (command === "volume") action.delta = right ? 1 : -1;
      else if (command === "speed") action.delta = right ? 1 : -1;
      else if (command === "pause") action.mode = "toggle";
      actions.push(action);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Clavier

  /** Un événement clavier hors ligne de saisie (`1023:0016`) ; la ligne ouverte ou une fenêtre de message le prend avant. */
  key(event: KeyEvent): InterfaceAction[] {
    const w = this.world;
    if (w.inputLineOpen) return [];
    const script = w.scriptRunning;
    const canMove = w.heroPresent && w.moveEnabled && !script;
    switch (event.type) {
      case "char": {
        if (script) return [];
        const c = event.char;
        if (c === "+" || c === "=") return canMove ? [{ type: "heroKey", dir: "descend" }] : [];
        if (c === "-" || c === "_") return canMove ? [{ type: "heroKey", dir: "climb" }] : [];
        return opensInputLine(c) ? [{ type: "openInputLine", char: c }] : [];
      }
      case "function": {
        if (event.modifier) return [];
        const n = event.n;
        if (n === 1) return [{ type: "functionKey", n, command: "help" }];
        if (n === 9 || n < 1 || n > 10) return [];
        // Pendant un script (`1023:0256`, table `CS:0268`) : F1 aide, F8 saute SANS test de `dgs`, F7 et F9 rien, les autres bipent.
        // Hors script, F7 et F8 (`23fa:0006` / `23fa:003c`) exigent `dgs` > 10.
        if (script) {
          if (n === 8) return [{ type: "scriptStep" }];
          return n === 7 ? [] : [{ type: "bell" }];
        }
        if ((n === 7 || n === 8) && !w.debugEnabled) return [];
        return [{ type: "functionKey", n, command: FUNCTION_KEY_COMMANDS[n] }];
      }
      case "alt": {
        const k = event.key.toUpperCase();
        if (k === "A" || k === "-") return [{ type: "system", command: "speed", delta: 1 }];
        if (k === "Z" || k === "=") return [{ type: "system", command: "speed", delta: -1 }];
        if (k === "P") return [{ type: "system", command: "pause", mode: "step" }];
        if (k === "N") return [{ type: "system", command: "pause", mode: "normal" }];
        return [];
      }
      case "nav": {
        if (script) return [];
        if (event.key === "insert") return [{ type: "openInputLine", recall: true }];
        if (!canMove) return [];
        return [event.held === "press" ? { type: "heroKey", dir: event.key, mode: "start" } : { type: "heroKey", dir: event.key }];
      }
    }
  }
}
