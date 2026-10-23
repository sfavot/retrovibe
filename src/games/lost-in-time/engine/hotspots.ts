import {
  MOUSE_BOTH,
  MOUSE_LEFT,
  MOUSE_NONE,
  MOUSE_RIGHT,
  type AddHotspotArgs,
  type FontMetrics,
  type HotspotBlock,
  type HotspotContext,
  type HotspotDef,
  type HotspotSystem,
  type Subsystems,
  type VmContext,
} from "./host";
import { KEY_BACKSPACE, KEY_DELETE, KEY_DOWN, KEY_ESCAPE, KEY_F1, KEY_F10, KEY_LEFT, KEY_RETURN, KEY_RIGHT, KEY_UP } from "./input";

/**
 * Zones de la souris et saisie de texte (Hotspots de ScummVM, Util/Game::checkKeys pour la partie
 * entrées). Les zones sont dans un tableau de taille fixe dont la première case « vide » (left =
 * 0xFFFF) marque la fin, comme dans l'original : l'ordre d'itération décide de la zone retenue.
 */

const HOTSPOT_COUNT = 250;
const MOUSE_ANY = 4;
/** Surface de dessin des champs de saisie (kBackSurface). */
const BACK_SURFACE = 21;
/** Largeur d'une attente de touche en saisie (ms). */
const INPUT_POLL = 300;

// États (4 bits de poids fort de l'identifiant)
const FILLED_DISABLED = 0xc;
const FILLED = 0x8;
const DISABLED = 0x4;
const TYPE2 = 0x2;
const TYPE1 = 0x1;

// Types (4 bits de poids faible des drapeaux)
const T_MOVE = 1;
const T_CLICK = 2;
const T_INPUT1_NO_LEAVE = 3;
const T_INPUT2_NO_LEAVE = 5;
const T_INPUT3_NO_LEAVE = 7;
const T_INPUT3_LEAVE = 8;
const T_INPUT_FLOAT_NO_LEAVE = 9;
const T_INPUT_FLOAT_LEAVE = 10;

const i16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;

class Spot {
  id = 0;
  left = 0xffff;
  top = 0;
  right = 0;
  bottom = 0;
  flags = 0;
  key = 0;
  funcEnter = 0;
  funcLeave = 0;
  funcPos = 0;

  clear(): void {
    this.id = 0;
    this.left = 0xffff;
    this.top = 0;
    this.right = 0;
    this.bottom = 0;
    this.flags = 0;
    this.key = 0;
    this.funcEnter = 0;
    this.funcLeave = 0;
    this.funcPos = 0;
  }

  copyFrom(o: Spot): void {
    Object.assign(this, o);
  }

  clone(): Spot {
    const s = new Spot();
    s.copyFrom(this);
    return s;
  }

  get type(): number {
    return this.flags & 0xf;
  }

  /** MOUSE_LEFT / MOUSE_RIGHT / MOUSE_ANY / MOUSE_NONE. */
  get button(): number {
    const bits = (this.flags & 0x70) >> 4;
    return bits === 0 ? MOUSE_LEFT : bits === 1 ? MOUSE_RIGHT : bits === 2 ? MOUSE_ANY : MOUSE_NONE;
  }

  get window(): number {
    return this.flags & 0x0f00;
  }

  get cursor(): number {
    return (this.flags & 0xf000) >> 12;
  }

  get state(): number {
    return stateOf(this.id);
  }

  get isEnd(): boolean {
    return this.left === 0xffff;
  }

  get isInput(): boolean {
    return this.type >= T_INPUT1_NO_LEAVE && this.type <= T_INPUT_FLOAT_LEAVE;
  }

  get isActiveInput(): boolean {
    return !this.isEnd && this.isFilledEnabled && this.isInput;
  }

  get isInputLeave(): boolean {
    return this.isInput && !(this.type & 1);
  }

  get isFilledEnabled(): boolean {
    return (this.state & FILLED_DISABLED) === FILLED;
  }

  get isFilledNew(): boolean {
    return this.state === FILLED;
  }

  get isDisabled(): boolean {
    return (this.state & DISABLED) !== 0;
  }

  isIn(x: number, y: number): boolean {
    x = i16(x);
    y = i16(y);
    return x >= i16(this.left) && x <= i16(this.right) && y >= i16(this.top) && y <= i16(this.bottom);
  }

  buttonMatch(button: number): boolean {
    const mine = this.button;
    if (mine === MOUSE_ANY) return true;
    if (mine === MOUSE_NONE) return false;
    return mine === button;
  }

  disable(): void {
    this.id |= DISABLED << 12;
  }

  enable(): void {
    this.id &= ~(DISABLED << 12) & 0xffff;
  }
}

const stateOf = (id: number): number => (id & 0xf000) >> 12;

interface StackEntry {
  shouldPush: boolean;
  key: number;
  id: number;
  index: number;
  x: number;
  y: number;
  spots: Spot[];
}

/** Paramètres d'un champ de saisie du bloc en cours. */
interface InputDesc {
  fontIndex: number;
  backColor: number;
  frontColor: number;
  /** Chaînes attendues, séparées par des zéros (types 5 à 8). */
  length: number;
  str: Uint8Array | null;
}

/** Paramètres de sortie de check / findKey…, comme les références du C++. */
interface Found {
  id: number;
  index: number;
}

/** Police de repli (8x8 à chasse fixe) quand le dessin n'en fournit pas. */
const DEFAULT_FONT: FontMetrics = {
  monospaced: true,
  charHeight: 8,
  charWidthDefault: 8,
  charWidth: () => 8,
};

/** Util::cleanupStr (sans la table de traduction exacte) : minuscules sans accents, espaces fusionnés. */
function cleanupStr(s: string): string {
  const plain = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return plain.replace(/ +/g, " ").trim();
}

/** Hotspots::convertSpecialKey : les chiffres de la rangée haute valent leur caractère. */
export function convertSpecialKey(key: number): number {
  const lo = key & 0xff;
  const scan = key >> 8;
  if (lo >= 32 && scan > 1 && scan < 12) return u16(48 + ((scan - 1) % 10) + (key & 0xff00));
  return key;
}

export class Hotspots implements HotspotSystem {
  private readonly spots: Spot[] = Array.from({ length: HOTSPOT_COUNT }, () => new Spot());
  private readonly stack: StackEntry[] = [];
  private shouldPush = false;
  private currentKey = 0;
  private currentId = 0;
  private currentIndex = 0;
  private currentX = 0;
  private currentY = 0;
  private vm: VmContext | null = null;
  private editing = false;

  /** `sys` : seuls le dessin et le curseur servent ; la machine virtuelle arrive par attach(). */
  constructor(private readonly sys: Pick<Subsystems, "draw" | "cursor">) {}

  attach(vm: VmContext): void {
    this.vm = vm;
  }

  private get machine(): VmContext {
    if (!this.vm) throw new Error("Hotspots : machine virtuelle non attachée");
    return this.vm;
  }

  /** Un champ de saisie attend du texte (l'interface propose alors le clavier virtuel). */
  get textEntry(): boolean {
    return this.editing;
  }

  private get terminated(): boolean {
    const vm = this.machine;
    return vm.terminate !== 0 || vm.quit;
  }

  /** Hotspots::findCursor : curseur sous (x, y) — celui de la zone, sinon « clic » (1) ou « saisie » (3). */
  findCursor(x: number, y: number): number {
    let cursor = 0;
    for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
      const spot = this.spots[i];
      if (spot.window !== 0 || spot.isDisabled || !spot.isIn(x, y)) continue;
      if (spot.cursor === 0) {
        if (spot.type >= T_INPUT1_NO_LEAVE) return 3;
        if (spot.button !== MOUSE_RIGHT && cursor === 0) cursor = 1;
      } else if (cursor === 0) cursor = spot.cursor;
    }
    return cursor;
  }

  // --- gestion du tableau ---------------------------------------------------------------

  clear(): void {
    this.currentKey = 0;
    for (const s of this.spots) s.clear();
  }

  add(a: AddHotspotArgs): number {
    for (let i = 0; i < HOTSPOT_COUNT; i++) {
      const spot = this.spots[i];
      // case libre => ajout ; même identifiant => mise à jour
      if (!(spot.isEnd || spot.id === a.id)) continue;
      // à la mise à jour, l'état « désactivé » est conservé
      let id = a.id;
      const mask = ~(DISABLED << 12) & 0xffff;
      if ((spot.id & mask) === (a.id & mask)) id = spot.id;
      spot.id = id;
      spot.left = u16(a.left);
      spot.top = u16(a.top);
      spot.right = u16(a.right);
      spot.bottom = u16(a.bottom);
      spot.flags = u16(a.flags);
      spot.key = u16(a.key);
      spot.funcEnter = u16(a.funcEnter);
      spot.funcLeave = u16(a.funcLeave);
      spot.funcPos = a.funcPos;
      return i;
    }
    throw new Error("Hotspots.add : tableau de zones plein");
  }

  remove(id: number): void {
    for (const s of this.spots) if (s.id === id) s.clear();
  }

  removeState(state: number): void {
    for (const s of this.spots) if (s.state === state) s.clear();
  }

  /** Recalcule les zones dont les coordonnées sont des expressions du script. */
  private recalculate(force: boolean): void {
    const vm = this.machine;
    const draw = this.sys.draw;
    for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
      const spot = this.spots[i];
      if (!force && (spot.flags & 0x80) !== 0) continue;
      if (spot.funcPos === 0) continue;

      const withFlags = spot.state === (FILLED | TYPE2);
      const v = vm.evalCoords(spot.funcPos, withFlags ? 5 : 4);
      let [left, top, width, height] = v;
      const flags = withFlags ? v[4] : 0;

      const rs = draw.renderState?.();
      if (rs?.capturePop && left !== -1) {
        left += rs.backDeltaX;
        top += rs.backDeltaY;
      }
      [left, top] = draw.adjustCoords(0, left, top);
      if ((spot.flags & 15) < 3) [width, height] = draw.adjustCoords(2, width, height);
      else height = draw.adjustCoords(2, 0, height)[1];

      if (left < 0) {
        width += left;
        left = 0;
      }
      if (top < 0) {
        height += top;
        top = 0;
      }
      spot.left = u16(left);
      spot.top = u16(top);
      spot.right = u16(left + width - 1);
      spot.bottom = u16(top + height - 1);
      if (withFlags) spot.flags = u16(flags);
    }
  }

  /** Met de côté les zones locales (all = 0), toutes (1) ou seulement les désactivées (2). */
  push(all: number, force: boolean): void {
    if (!this.shouldPush && !force) return;
    const saved: Spot[] = [];
    for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
      const spot = this.spots[i];
      const st = spot.state;
      if (
        all === 1 ||
        (all === 0 && spot.id >= 20) ||
        (all === 2 && (st === (FILLED_DISABLED | TYPE1) || st === DISABLED || st === (FILLED_DISABLED | TYPE2)))
      ) {
        saved.push(spot.clone());
        spot.clear();
      }
    }
    this.stack.push({
      shouldPush: this.shouldPush,
      key: this.currentKey,
      id: this.currentId,
      index: this.currentIndex,
      x: this.currentX,
      y: this.currentY,
      spots: saved,
    });
    this.shouldPush = false;
    this.currentKey = 0;
    this.currentId = 0;
    this.currentIndex = 0;
    this.currentX = 0;
    this.currentY = 0;
  }

  pop(): void {
    const backup = this.stack.pop();
    if (!backup) throw new Error("Hotspots.pop : pile vide");
    let i = 0;
    while (i < HOTSPOT_COUNT && !this.spots[i].isEnd) i++;
    if (HOTSPOT_COUNT - i < backup.spots.length) throw new Error("Hotspots.pop : plus assez de place");
    backup.spots.forEach((s, n) => this.spots[i + n].copyFrom(s));
    this.shouldPush = backup.shouldPush;
    this.currentKey = backup.key;
    this.currentId = backup.id;
    this.currentIndex = backup.index;
    this.currentX = backup.x;
    this.currentY = backup.y;
  }

  private isValid(key: number, id: number, index: number): boolean {
    return index < HOTSPOT_COUNT && key !== 0 && (stateOf(id) & FILLED) !== 0;
  }

  // --- appels de fonctions du script -----------------------------------------------------

  private async call(offset: number): Promise<void> {
    this.shouldPush = true;
    const size = this.stack.length;
    await this.machine.runFunction(offset);
    while (size !== this.stack.length) this.pop();
    this.shouldPush = false;
    this.recalculate(false);
  }

  private async enter(index: number): Promise<void> {
    if (index >= HOTSPOT_COUNT) return;
    const vm = this.machine;
    const spot = this.spots[index];
    if (spot.state === (FILLED | TYPE1) || spot.state === (FILLED | TYPE2)) vm.vars.writeVar32(17, -(spot.id & 0x0fff));
    this.currentX = vm.mouseX;
    this.currentY = vm.mouseY;
    if (spot.funcEnter !== 0) await this.call(spot.funcEnter);
  }

  private async leave(index: number): Promise<void> {
    if (index >= HOTSPOT_COUNT) return;
    const spot = this.spots[index];
    if (spot.state === (FILLED | TYPE1) || spot.state === (FILLED | TYPE2)) {
      this.machine.vars.writeVar32(17, spot.id & 0x0fff);
    }
    if (spot.funcLeave !== 0) await this.call(spot.funcLeave);
  }

  // --- souris ----------------------------------------------------------------------------

  /** Zone sous la souris : déplacement (survol) ou clic. La clé retournée est celle de la zone. */
  private checkMouse(type: typeof T_MOVE | typeof T_CLICK, out: Found): number {
    const vm = this.machine;
    out.id = 0;
    out.index = 0;
    // pas de fenêtres (Fascination seulement) : tout est dans la fenêtre 0
    const mx = vm.mouseX;
    const my = vm.mouseY;

    if (type === T_MOVE) {
      for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
        const spot = this.spots[i];
        if (spot.isDisabled || spot.type > T_MOVE || spot.window !== 0 || !spot.isIn(mx, my)) continue;
        out.id = spot.id;
        out.index = i;
        return spot.key;
      }
      return 0;
    }

    for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
      const spot = this.spots[i];
      if (spot.isDisabled || spot.window !== 0 || spot.type < T_MOVE || !spot.isIn(mx, my)) continue;
      if (!spot.buttonMatch(vm.mouseButtons)) continue;
      out.id = spot.id;
      out.index = i;
      // pour les autres types, la clé a un autre sens
      return spot.type === T_MOVE || spot.type === T_CLICK ? spot.key : 0;
    }
    // le bouton droit sert de touche Échap
    return vm.mouseButtons !== MOUSE_LEFT ? KEY_ESCAPE : 0;
  }

  private async checkHotspotChanged(): Promise<boolean> {
    const vm = this.machine;
    const found: Found = { id: 0, index: 0 };
    const key = this.checkMouse(T_MOVE, found);
    if (key === this.currentKey) {
      this.currentX = vm.mouseX;
      this.currentY = vm.mouseY;
      return false;
    }
    if (this.isValid(this.currentKey, this.currentId, this.currentIndex)) await this.leave(this.currentIndex);
    this.currentKey = key;
    this.currentId = found.id;
    this.currentIndex = found.index;
    this.currentX = vm.mouseX;
    this.currentY = vm.mouseY;
    if (this.isValid(key, found.id, found.index)) await this.enter(found.index);
    return true;
  }

  /** Util::waitMouseRelease : attend que plus aucun bouton ne soit enfoncé (sans toucher à l'état du jeu). */
  private async waitMouseRelease(drawMouse: number): Promise<void> {
    const vm = this.machine;
    const pressed = (): boolean => {
      vm.checkKeys(drawMouse, false);
      const b = vm.host.input.mouseButtons;
      return b !== MOUSE_NONE && b !== MOUSE_BOTH;
    };
    while (pressed()) {
      if (drawMouse !== 0) this.sys.cursor.animate(2);
      await vm.host.nextFrame();
      if (this.terminated) return;
    }
  }

  /**
   * Hotspots::check : attend une touche, un clic ou la fin d'un délai, en gérant le survol.
   * `delay` : > 0 pause après un clic, 0 attente illimitée, < 0 délai maximal (ms) ;
   * -2 : ne rend la main qu'une fois sans bouton enfoncé.
   */
  async check(handleMouse: number, delay: number): Promise<number> {
    return this.checkFull(handleMouse, delay, { id: 0, index: 0 });
  }

  private async checkFull(handleMouse: number, delay: number, out: Found): Promise<number> {
    const vm = this.machine;
    const host = vm.host;
    const cursor = this.sys.cursor;
    const draw = this.sys.draw;

    if (delay >= -1) {
      this.currentKey = 0;
      this.currentId = 0;
      this.currentIndex = 0;
    }
    out.id = 0;
    out.index = 0;

    if (handleMouse) {
      if (this.currentKey === 0) {
        // dernier état : aucune zone touchée ; a-t-il changé ?
        const m: Found = { id: 0, index: 0 };
        this.currentKey = this.checkMouse(T_MOVE, m);
        this.currentId = m.id;
        this.currentIndex = m.index;
        if (this.isValid(this.currentKey, this.currentId, this.currentIndex)) await this.enter(this.currentIndex);
      }
      cursor.animate(-1);
    }

    const startTime = host.now();
    draw.blitInvalidated();

    let key = 0;
    while (key === 0) {
      if (this.terminated) {
        if (handleMouse) cursor.blit();
        return 0;
      }

      await this.checkHotspotChanged();

      if (handleMouse) cursor.animate(-1);
      else draw.blitInvalidated();

      key = vm.checkKeys(handleMouse);

      if (!handleMouse && vm.mouseButtons !== MOUSE_NONE) {
        // pas de souris voulue : on attend simplement qu'elle soit relâchée
        await this.waitMouseRelease(0);
        key = 3;
      }

      if (key !== 0) {
        if (handleMouse & 1) cursor.blit();
        out.id = 0;
        out.index = 0;
        if (this.isValid(this.currentKey, this.currentId, this.currentIndex)) await this.leave(this.currentIndex);
        this.currentKey = 0;
        break;
      }

      if (handleMouse) {
        if (vm.mouseButtons !== MOUSE_NONE) {
          cursor.animate(2);
          if (delay > 0) await vm.sleep(delay);
          else if (handleMouse & 1) await this.waitMouseRelease(1);
          cursor.animate(-1);

          key = this.checkMouse(T_CLICK, out);
          if (key !== 0 || out.id !== 0) {
            if (handleMouse & 1 && (delay <= 0 || vm.mouseButtons === MOUSE_NONE)) cursor.blit();
            // la zone a changé : on quitte l'ancienne
            if (this.currentKey !== 0 && key !== this.currentKey) await this.leave(this.currentIndex);
            this.currentKey = 0;
            break;
          }
          if (handleMouse & 4) return 0;
          if (this.currentKey !== 0) await this.leave(this.currentIndex);
          // pas de clic : un survol ?
          const m: Found = { id: 0, index: 0 };
          this.currentKey = this.checkMouse(T_MOVE, m);
          this.currentId = m.id;
          this.currentIndex = m.index;
          if (this.isValid(this.currentKey, this.currentId, this.currentIndex)) await this.enter(this.currentIndex);
        } else await this.checkHotspotChanged();
      }

      if (delay === -2 && key === 0 && vm.mouseButtons === MOUSE_NONE) {
        out.id = 0;
        out.index = 0;
        break;
      }

      if (handleMouse) cursor.animate(-1);

      if (delay < 0 && key === 0 && vm.mouseButtons === MOUSE_NONE) {
        // délai écoulé ?
        if (host.now() + delay > startTime) {
          out.id = 0;
          out.index = 0;
          break;
        }
      }

      await host.nextFrame();
    }
    return key;
  }

  // --- saisie de texte -------------------------------------------------------------------

  private fontOf(index: number): FontMetrics {
    return this.sys.draw.fontMetrics?.(index) ?? DEFAULT_FONT;
  }

  private fillRect(x: number, y: number, w: number, h: number, color: number): void {
    const draw = this.sys.draw;
    // la zone modifiée est marquée par l'opération de dessin elle-même (dirtiedRect), comme dans ScummVM
    draw.fillRect(BACK_SURFACE, x, y, w, h, color, true);
  }

  private printText(x: number, y: number, text: ArrayLike<number>, font: number, color: number): void {
    if (text.length === 0) return;
    const draw = this.sys.draw;
    let s = "";
    for (let i = 0; i < text.length; i++) s += String.fromCharCode(text[i]);
    draw.printText({ x, y, backColor: 0, frontColor: color, fontIndex: font, text: s, transparent: true, deltaVeto: true });
  }

  private textCursor(font: FontMetrics, str: number[], pos: number, x: number, y: number, height: number) {
    if (!font.monospaced) {
      // à droite du caractère courant
      let cx = x;
      for (let i = 0; i < pos; i++) cx += font.charWidth(str[i] ?? 0);
      return { x: cx, y, w: 1, h: height };
    }
    // souligne le caractère courant
    return { x: x + font.charWidthDefault * pos, y: y + height - 1, w: font.charWidthDefault, h: 1 };
  }

  private stringLength(str: number[], font: FontMetrics): number {
    let n = 0;
    for (const c of str) n += font.charWidth(c);
    return n;
  }

  /**
   * Hotspots::updateInput : édite la chaîne de la variable `keyOffset` dans le champ (x, y, width,
   * height). Retourne Entrée / haut / bas / F1..F10, ou 0 (zone cliquée, délai écoulé, arrêt).
   */
  private async updateInput(...args: Parameters<Hotspots["editInput"]>): Promise<number> {
    this.editing = true;
    try {
      return await this.editInput(...args);
    } finally {
      this.editing = false;
    }
  }

  private async editInput(
    x: number,
    y: number,
    width: number,
    height: number,
    backColor: number,
    frontColor: number,
    keyOffset: number,
    fontIndex: number,
    type: number,
    time: { duration: number },
    out: Found,
  ): Promise<number> {
    const vm = this.machine;
    const vars = vm.vars;
    const font = this.fontOf(fontIndex);
    const handleMouse = vm.handleMouse !== 0 ? 1 : 0;

    const str = Array.from(vars.cstr(keyOffset));
    const store = (): void => vars.writeBytesString(keyOffset, Uint8Array.from(str));
    let pos = str.length;
    const editSize = font.monospaced ? Math.trunc(width / font.charWidthDefault) : 0;
    const textY = y + Math.trunc((height - font.charHeight) / 2);
    const fieldW = font.monospaced ? editSize * font.charWidthDefault : width;

    const poll = (delay: number): Promise<number> => this.checkFull(handleMouse, delay, out);

    for (;;) {
      // s'il reste de la place, une case de plus pour le prochain caractère
      let temp = [...str, 32];
      if (editSize !== 0 && temp.length > editSize) temp = str.slice();

      this.fillRect(x, y, fieldW, height, backColor);
      this.printText(x, textY, temp, fontIndex, frontColor);

      if (editSize !== 0 && pos === editSize) pos--;
      const curSym = temp[pos] ?? 0;
      vars.writeVar32(56, pos);

      let key = 0;
      let first = true;
      for (;;) {
        // curseur
        let c = this.textCursor(font, str, pos, x, y, height);
        this.fillRect(c.x, c.y, c.w, c.h, frontColor);

        if (first) {
          // la première fois, on purge les anciennes informations
          key = await poll(-1);
          if (key === 0) key = await poll(-INPUT_POLL);
          first = false;
        } else key = await poll(-INPUT_POLL);

        // efface le curseur
        c = this.textCursor(font, str, pos, x, y, height);
        this.fillRect(c.x, c.y, c.w, c.h, backColor);
        this.printText(c.x, textY, [curSym], fontIndex, frontColor);

        if (key !== 0 || out.id !== 0) break;

        key = await poll(-INPUT_POLL);
        if (key !== 0 || out.id !== 0 || this.terminated) break;

        if (time.duration > 0) {
          time.duration -= 600;
          if (time.duration <= 1) {
            key = 0;
            out.id = 0;
            break;
          }
        }
      }

      if (key === 0 || out.id !== 0 || this.terminated) return 0;

      switch (key) {
        case KEY_RIGHT:
          // à l'intérieur de la chaîne, on avance ; sinon on passe au champ suivant
          if (pos < str.length && (editSize === 0 || pos < editSize - 1)) {
            pos++;
            continue;
          }
          return KEY_DOWN;
        case KEY_LEFT:
          if (pos > 0) {
            pos--;
            continue;
          }
          return KEY_UP;
        case KEY_BACKSPACE:
          if (pos > 0) {
            str.splice(pos - 1, 1);
            pos--;
            store();
          } else if (pos < str.length) {
            str.splice(pos, 1);
            store();
          }
          continue;
        case KEY_DELETE:
          if (pos < str.length) {
            str.splice(pos, 1);
            store();
          }
          continue;
        case KEY_RETURN:
        case KEY_UP:
        case KEY_DOWN:
          return key;
        case KEY_ESCAPE:
          // avec une souris, Échap ne fait rien dans un champ
          continue;
        default:
          break;
      }
      if (key >= KEY_F1 && key <= KEY_F10 && (key & 0xff) === 0) return key;

      // caractère « normal »
      const saved = key;
      key &= 0xff;
      if (type === T_INPUT_FLOAT_NO_LEAVE || type === T_INPUT_FLOAT_LEAVE) {
        if (key >= 32) {
          const from = "0123456789-.,+ ";
          const to = "0123456789-,,+ ";
          if (saved >> 8 > 1 && saved >> 8 < 12 && saved >= 0x100) key = ((saved >> 8) - 1) % 10 + 48;
          const n = from.indexOf(String.fromCharCode(key));
          key = n >= 0 ? to.charCodeAt(n) : 0;
        }
      }
      if (key >= 32) {
        if (editSize === 0) {
          // la chaîne, le nouveau caractère et le suivant doivent tenir
          if (this.stringLength(str, font) + font.charWidth(32) + font.charWidth(key) > width) continue;
          if (str.length >= vm.animDataSize * 4 - 1) continue;
        } else if (str.length > editSize) continue;
        else if (str.length === editSize) str.pop(); // au maximum : on écrase le dernier
        str.splice(pos, 0, key);
        pos++;
        store();
      }
    }
  }

  private inputToHotspot(input: number): number {
    let n = 0;
    for (let i = 0; i < HOTSPOT_COUNT; i++) {
      if (!this.spots[i].isActiveInput) continue;
      if (n === input) return i;
      n++;
    }
    return 0xffff;
  }

  private hotspotToInput(hotspot: number): number {
    let input = 0;
    for (let i = 0; i < HOTSPOT_COUNT; i++) {
      if (!this.spots[i].isActiveInput) continue;
      if (i === hotspot) break;
      input++;
    }
    return input;
  }

  private findClickedInput(index: number): number {
    const vm = this.machine;
    for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
      const s = this.spots[i];
      if (s.window !== 0 || s.isDisabled || !s.isIn(vm.mouseX, vm.mouseY) || s.cursor !== 0 || !s.isInput) continue;
      return i;
    }
    return index;
  }

  /** Redessine tous les champs de saisie actifs. */
  private updateAllTexts(inputs: InputDesc[]): void {
    const vars = this.machine.vars;
    let input = 0;
    for (const spot of this.spots) {
      if (spot.isEnd || !spot.isFilledEnabled || !spot.isInput) continue;
      const desc = inputs[input];
      if (!desc) break;
      const font = this.fontOf(desc.fontIndex);
      const w = spot.right - spot.left + 1;
      const h = spot.bottom - spot.top + 1;
      this.fillRect(spot.left, spot.top, w, h, desc.backColor);
      const y = spot.top + Math.trunc((h - font.charHeight) / 2);
      this.printText(spot.left, y, vars.cstr(spot.key), desc.fontIndex, desc.frontColor);
      input++;
    }
  }

  private async handleInputs(
    time: { duration: number },
    inputs: InputDesc[],
    cur: { input: number },
    out: Found,
  ): Promise<number> {
    const vars = this.machine.vars;
    const inputCount = inputs.length;
    this.updateAllTexts(inputs);
    for (let i = 0; i < 40; i++) vars.writeVar32(17 + i, 0);

    for (;;) {
      const hs = this.inputToHotspot(cur.input);
      if (hs === 0xffff) return 0;
      const spot = this.spots[hs];
      const desc = inputs[cur.input];
      const key = await this.updateInput(
        spot.left,
        spot.top,
        spot.right - spot.left + 1,
        spot.bottom - spot.top + 1,
        desc.backColor,
        desc.frontColor,
        spot.key,
        desc.fontIndex,
        spot.type,
        time,
        out,
      );
      if (this.terminated) return 0;

      if (key === 0) {
        if (out.id === 0) return 0; // ni touche ni zone
        if (this.machine.mouseButtons !== MOUSE_NONE) out.index = this.findClickedInput(out.index);
        if (!this.spots[out.index].isInput) return 0;
        cur.input = this.hotspotToInput(out.index);
      } else if (key >= KEY_F1 && key <= KEY_F10 && (key & 0xff) === 0) {
        return key;
      } else if (key === KEY_RETURN) {
        if (inputCount === 1) return KEY_RETURN;
        cur.input = cur.input === inputCount - 1 ? 0 : cur.input + 1;
      } else if (key === KEY_DOWN) {
        if (inputCount - 1 > cur.input) cur.input++;
      } else if (key === KEY_UP) {
        if (cur.input > 0) cur.input--;
      }
    }
  }

  // --- recherche d'une zone --------------------------------------------------------------

  private findKey(key: number, out: Found): boolean {
    out.id = 0;
    out.index = 0;
    for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
      const s = this.spots[i];
      if (!s.isFilledEnabled) continue;
      if (s.key === key || s.key === 0x7fff) {
        out.id = s.id;
        out.index = i;
        return true;
      }
    }
    return false;
  }

  private findKeyCaseInsensitive(key: number, out: Found): boolean {
    out.id = 0;
    out.index = 0;
    const upper = (c: number): number => String.fromCharCode(c).toUpperCase().charCodeAt(0);
    for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
      const s = this.spots[i];
      if (!s.isFilledEnabled || (s.key & 0xff00) !== 0 || s.key === 0) continue;
      if (upper(key & 0xff) === upper(s.key)) {
        out.id = s.id;
        out.index = i;
        return true;
      }
    }
    return false;
  }

  private findNthPlain(n: number, startIndex: number, out: Found): boolean {
    out.id = 0;
    out.index = 0;
    let counter = 0;
    for (let i = startIndex; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
      const s = this.spots[i];
      if (!s.isFilledNew) continue;
      if (++counter !== n) continue;
      out.id = s.id;
      out.index = i;
      return true;
    }
    return false;
  }

  private setCurrentHotspot(ids: number[] | null, id: number): void {
    const vars = this.machine.vars;
    if (!ids) vars.writeVar32(16, 0);
    else if (stateOf(id) === FILLED) vars.writeVar32(16, i16(ids[id & 0xfff] ?? 0));
    else vars.writeVar32(16, id & 0xfff);
  }

  private get currentHotspot(): number {
    return this.machine.vars.readVar32(16);
  }

  private async leaveNthPlain(
    n: number,
    startIndex: number,
    timeVal: number,
    ids: number[],
    out: Found,
    time: { duration: number },
  ): Promise<boolean> {
    const vm = this.machine;
    out.id = 0;
    out.index = 0;
    if (!this.findNthPlain(n, startIndex, out)) return false;
    vm.storeMouse();
    if (this.currentHotspot !== 0) return false; // déjà une zone en cours de traitement
    this.setCurrentHotspot(ids, out.id);

    const spot = this.spots[out.index];
    if (spot.funcLeave !== 0) {
      const start = vm.host.now();
      await this.call(spot.funcLeave);
      vm.animPalette();
      const callTime = vm.host.now() - start;
      time.duration = Math.min(Math.max(timeVal - callTime, 2), timeVal);
    }
    if (this.currentHotspot === 0) {
      out.id = 0;
      out.index = 0;
    }
    return this.currentHotspot !== 0;
  }

  private async evaluateFind(
    key: number,
    timeVal: number,
    ids: number[],
    block: HotspotBlock,
    endIndex: number,
    time: { duration: number },
    out: Found,
  ): Promise<boolean> {
    if (out.id !== 0) return false;

    if (key !== 0) {
      if (this.findKey(key, out)) return false;
      this.findKeyCaseInsensitive(key, out);
      return false;
    }

    let finished = false;
    if (time.duration !== 0) {
      if (block.hotspotIndex1 !== 0) {
        finished = await this.leaveNthPlain(block.hotspotIndex1, endIndex, timeVal, ids, out, time);
      } else if (block.hotspotIndex2 !== 0) {
        this.findNthPlain(block.hotspotIndex2, endIndex, out);
      } else {
        // entre dans la première zone
        for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
          if (this.spots[i].isFilledNew) {
            out.id = this.spots[i].id;
            out.index = i;
            break;
          }
        }
        // quitte la zone courante
        if (this.currentKey !== 0 && this.spots[this.currentIndex].funcLeave !== 0) {
          await this.call(this.spots[this.currentIndex].funcLeave);
        }
        this.currentKey = 0;
      }
    } else if (block.leaveWindowIndex !== 0) {
      this.findNthPlain(block.leaveWindowIndex, endIndex, out);
    }
    return finished;
  }

  // --- évaluation d'un bloc --------------------------------------------------------------

  /** Hotspots::evaluateNew pour une zone déjà décodée par l'interpréteur. */
  private evaluateNew(def: HotspotDef, ids: number[], inputs: InputDesc[]): { hasInput: boolean; inputId: number | null } {
    const i = def.index;
    const draw = this.sys.draw;
    ids[i] = 0;
    let { left, top, width, height } = def;
    left = u16(left);

    const rs = draw.renderState?.();
    if (rs?.capturePop && left !== 0xffff) {
      left = u16(left + rs.backDeltaX);
      top = u16(top + rs.backDeltaY);
    }
    if (left !== 0xffff) {
      [left, top] = draw.adjustCoords(0, left, top);
      const t = def.type & 0x3f;
      if (t >= 20 || t < 3) [width, height] = draw.adjustCoords(0, width, height);
      else height = draw.adjustCoords(0, height, 0)[0];
      left = u16(left);
    }
    let right = u16(left + width - 1);
    const bottom = u16(top + height - 1);

    if (def.enable) {
      // réactive les zones désactivées de ce type
      const wanted = def.enable === "type2" ? FILLED_DISABLED | TYPE2 : FILLED_DISABLED | TYPE1;
      for (const spot of this.spots) {
        if (spot.state !== wanted) continue;
        spot.enable();
        spot.funcEnter = def.funcEnter;
        spot.funcLeave = def.funcEnter;
      }
      return { hasInput: false, inputId: null };
    }

    let hasInput = false;
    let inputId: number | null = null;
    let key = def.key;
    let flags = def.flags;
    let funcEnter = def.funcEnter;
    let funcLeave = def.funcLeave;
    let funcPos = def.funcPos;

    switch (def.type) {
      case 0:
      case T_MOVE:
        ids[i] = def.id;
        break;
      case 20:
      case T_CLICK:
        if (def.type === 20) inputId = i;
        ids[i] = def.id;
        funcEnter = 0;
        break;
      case 21:
        ids[i] = def.id;
        funcLeave = 0;
        break;
      default:
        if (def.type >= T_INPUT1_NO_LEAVE && def.type <= T_INPUT_FLOAT_LEAVE && def.input) {
          hasInput = true;
          const inp = def.input;
          key = inp.keyVar;
          const desc: InputDesc = {
            fontIndex: inp.fontIndex,
            backColor: inp.backColor,
            frontColor: inp.frontColor,
            length: inp.length,
            str: inp.str,
          };
          if (left === 0xffff) {
            // pas de coordonnées : zone ignorée
            break;
          }
          const font = this.fontOf(inp.fontIndex);
          if (font.monospaced) right = u16(left + width * font.charWidthDefault - 1);
          funcEnter = 0;
          funcPos = 0;
          flags = def.type;
          inputs.push(desc);
        }
        break;
    }
    this.add({ id: i | (FILLED << 12), left, top, right, bottom, flags, key, funcEnter, funcLeave, funcPos });
    return { hasInput, inputId };
  }

  async evaluate(block: HotspotBlock, ctx: HotspotContext): Promise<number | null> {
    const vm = this.machine;
    const vars = ctx.vars;
    const inputs: InputDesc[] = [];
    const ids: number[] = new Array(HOTSPOT_COUNT).fill(0);

    // fin des zones déjà présentes (les zones locales ont été mises de côté)
    let endIndex = 0;
    while (endIndex < HOTSPOT_COUNT && !this.spots[endIndex].isEnd) endIndex++;
    this.shouldPush = false;

    const time = { duration: i16(block.duration * 1000) };
    if (block.hotspotIndex1 !== 0 || block.hotspotIndex2 !== 0) {
      time.duration = Math.trunc(time.duration / 100);
      if (block.duration === 100) time.duration = 2;
    }
    const timeVal = time.duration;

    this.setCurrentHotspot(null, 0);

    let hasInput = false;
    let inputId = 0xffff;
    for (const def of block.hotspots) {
      const r = this.evaluateNew(def, ids, inputs);
      if (r.hasInput) hasInput = true;
      if (r.inputId !== null) inputId = r.inputId;
    }
    if (block.needRecalc) this.recalculate(true);

    vm.host.input.clearKeys();

    const found: Found = { id: 0, index: 0 };
    let finishedDuration = false;

    while (found.id === 0 && !ctx.isTerminated()) {
      let key: number;
      if (hasInput && inputs.length > 0) {
        const cur = { input: 0 };
        key = await this.handleInputs(time, inputs, cur, found);
        vars.writeVar32(17 + 38, cur.input);
        if (key === KEY_RETURN) {
          // Entrée : on déclenche le « leave » du premier champ de saisie
          for (let i = 0; i < HOTSPOT_COUNT && !this.spots[i].isEnd; i++) {
            const s = this.spots[i];
            if (s.isFilledEnabled && s.isInputLeave) {
              found.id = s.id;
              inputId = s.id & 0x7fff;
              found.index = i;
              break;
            }
          }
          break;
        }
      } else key = await this.checkFull(vm.handleMouse, -time.duration, found);

      key = convertSpecialKey(key);

      if (await this.evaluateFind(key, timeVal, ids, block, endIndex, time, found)) finishedDuration = true;
      if (finishedDuration) break;

      if (found.id === 0 || this.spots[found.index].funcLeave !== 0) continue;

      ctx.storeMouse();
      this.setCurrentHotspot(ids, found.id);
      if (this.spots[found.index].funcEnter !== 0) await this.call(this.spots[found.index].funcEnter);
      this.setCurrentHotspot(null, 0);
      found.id = 0;
    }

    if ((found.id & 0xfff) === inputId) this.matchInputStrings(inputs);

    if (vm.handleMouse === 1) this.sys.cursor.blit();

    let leave: number | null = null;
    if (!ctx.isTerminated() && !finishedDuration) {
      leave = this.spots[found.index].funcLeave;
      ctx.storeMouse();
      if (this.currentHotspot === 0) this.setCurrentHotspot(ids, found.id);
    }

    // retire les zones locales, désactive celles qui restent
    for (let i = 0; i < block.hotspots.length; i++) this.remove(i | (FILLED << 12));
    for (const s of this.spots) {
      if (s.state === (FILLED | TYPE1) || s.state === (FILLED | TYPE2)) s.disable();
    }
    return leave;
  }

  // --- bilan d'une saisie ----------------------------------------------------------------

  private matchInputStrings(inputs: InputDesc[]): void {
    const vars = this.machine.vars;
    let strInputCount = 0;
    let inputIndex = 0;
    let inputPos = 1;
    for (const spot of this.spots) {
      if (spot.isEnd || !spot.isFilledEnabled || !spot.isInput) continue;
      if (spot.type >= T_INPUT_FLOAT_NO_LEAVE) {
        // nombre : sans espaces
        vars.writeString(spot.key, vars.readString(spot.key).replace(/ /g, ""));
      }
      if (spot.type >= T_INPUT2_NO_LEAVE && spot.type <= T_INPUT3_LEAVE) {
        const desc = inputs[inputIndex];
        let typed = vars.readString(spot.key);
        const clean = spot.type < T_INPUT3_NO_LEAVE;
        if (clean) typed = cleanupStr(typed);
        let pos = 0;
        while (desc?.str && pos < desc.length) {
          let end = pos;
          while (end < desc.length && desc.str[end] !== 0) end++;
          let wanted = "";
          for (let i = pos; i < end; i++) wanted += String.fromCharCode(desc.str[i]);
          pos = end + 1;
          if (clean) wanted = cleanupStr(wanted);
          if (wanted === typed) {
            vars.writeVar32(17, vars.readVar32(17) + 1);
            vars.writeVar32(17 + inputPos, 1);
            break;
          }
        }
        strInputCount++;
      } else vars.writeVar32(17 + inputPos, 2);
      inputIndex++;
      inputPos++;
    }
    vars.writeVar32(17, strInputCount === (vars.readVar32(17) & 0xffff) ? 1 : 0);
  }
}
