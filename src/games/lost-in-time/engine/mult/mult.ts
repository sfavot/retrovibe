import type {
  InitMultArgs,
  LoadMultArgs,
  MultObjectArgs,
  MultSystem,
  SceneryLoadArgs,
  Subsystems,
  VmContext,
} from "../host";
import { KEY_ESCAPE } from "../input";
import { ANIM_SURFACE, BACK_SURFACE, s16 } from "../graphics/core";
import type { GraphicsCore } from "../graphics/core";
import type { DrawImpl } from "../graphics/draw";
import type { PaletteImpl } from "../graphics/palette";
import type { Surface } from "../graphics/surface";
import { Variables } from "../variables";
import { videoProps, type VideoPlayer } from "../video";
import { ANIM_DATA_SIZE, AnimData } from "./anim-data";
import { NO_REDRAW, Scenery, type AnimBounds } from "./scenery";

const MULT_SLOTS = 8;
const RENDER_FLAG_VIDEO_POS = 0x100;

interface StaticKey {
  frame: number;
  layer: number;
}

interface AnimKey {
  /** Non signé dans l'original. */
  frame: number;
  layer: number;
  posX: number;
  posY: number;
  order: number;
}

interface TextKey {
  frame: number;
  cmd: number;
}

interface PalKey {
  frame: number;
  cmd: number;
  rates: number[];
  /** subst[k][c] à k * 4 + c : indices (1-based) de la chaîne de couleurs tournante c. */
  subst: Int8Array;
}

interface PalFadeKey {
  frame: number;
  fade: number;
  palIndex: number;
  flag: number;
}

interface SndKey {
  frame: number;
  cmd: number;
  freq: number;
  fadeLength: number;
  repCount: number;
  resId: number;
  soundIndex: number;
}

interface ImdKey {
  frame: number;
  imdFile: number;
  flags: number;
  palFrame: number;
  lastFrame: number;
  palStart: number;
  palEnd: number;
}

/** Mult_Data : clés d'animation d'une ressource mult chargée par loadMult. */
class MultData {
  palFadeKeys: PalFadeKey[] = [];
  palKeys: PalKey[] = [];
  staticKeys: StaticKey[] = [];
  staticIndices: number[] = [];
  staticLoaded: boolean[] = [];
  animKeys: AnimKey[][] = [[], [], [], []];
  animIndices: number[] = [];
  animLoaded: boolean[] = [];
  animKeysFrames = [-1, -1, -1, -1];
  animKeysStartFrames = [0, 0, 0, 0];
  animKeysStopFrames = [0, 0, 0, 0];
  animKeysIndices: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  animDirection = 0;
  textKeys: TextKey[] = [];
  sndKeys: SndKey[] = [];
  sndSlots: number[] = [];
  frameRate = 0;
  /** Palettes de fondu : 5 x 16 couleurs RGB. */
  fadePal: Uint8Array[] = Array.from({ length: 5 }, () => new Uint8Array(48));
  animObjs: number[][] = [[0, 1, 2, 3], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  palAnimIndices = [0, 0, 0, 0];
  frameStart = 0;
  imdKeysIndices: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  imdKeys: ImdKey[][] = [[], [], [], []];
  imdIndices = [-1, -1, -1, -1];
  /** Fichiers IMD : 14 octets par nom. */
  imdFiles: Uint8Array | null = null;
  /** Mots d'exécution de la section IMD (numéros de ressources de fonds, indexés par -layer - 2). */
  execWords: number[] = [];
}

/** Variable 32 bits des scripts désignée par un décalage (VariableReference). */
class VarRef {
  constructor(
    private readonly vars: Variables,
    private readonly offset: number,
  ) {}

  get value(): number {
    return this.vars.readOff32(this.offset) | 0;
  }

  set value(v: number) {
    this.vars.writeOff32(this.offset, v);
  }
}

/** Mult_Object : un objet animé (position, état d'animation, rectangles à rafraîchir). */
class MultObject {
  tick = 0;
  lastLeft = -1;
  lastRight = -1;
  lastTop = -1;
  lastBottom = -1;
  needRedraw = 0;
  newLeft = 0;
  newTop = 0;
  newRight = 0;
  newBottom = 0;

  constructor(
    readonly anim: AnimData,
    readonly posX: VarRef,
    readonly posY: VarRef,
  ) {}
}

/** Cadre d'une lecture playMult. */
interface PlayState {
  stop: boolean;
  stopNoClear: boolean;
  endFrame: number;
}

type Pending = () => Promise<void>;

class Reader {
  pos = 0;
  private readonly view: DataView;
  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  i16(): number {
    const v = this.pos + 2 <= this.data.length ? this.view.getInt16(this.pos, true) : 0;
    this.pos += 2;
    return v;
  }

  u16(): number {
    return this.i16() & 0xffff;
  }

  i8(): number {
    const v = this.pos < this.data.length ? (this.data[this.pos] << 24) >> 24 : 0;
    this.pos++;
    return v;
  }

  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    out.set(this.data.subarray(this.pos, this.pos + n));
    this.pos += n;
    return out;
  }
}

const NAME_LENGTH = 14;

/**
 * Mult_v2 + Mult : animations clés (décors, objets, palettes, sons, vidéos IMD) et objets animés
 * dont l'état vit dans les variables des scripts. Les structures et l'ordre des traitements suivent ScummVM.
 */
export class MultImpl implements MultSystem, AnimBounds {
  animLeft = 0;
  animTop = 0;
  animWidth = 0;
  animHeight = 0;
  objCount = 0;

  readonly scenery: Scenery;

  private vm: VmContext | null = null;
  private multData: MultData | null = null;
  private readonly multDatas: (MultData | null)[] = new Array(MULT_SLOTS).fill(null);
  private frame = 0;
  private objects: MultObject[] | null = null;
  private orderArray: number[] | null = null;
  private animSurf: Surface | null = null;
  private animDataAllocated = false;

  // Palette : substitution tournante (clés de palette) et fondus par couleur (clés de fondu).
  private doPalSubst = false;
  private palWork: Uint8Array | null = null;
  private palAnimKey = 0;
  private readonly palFading = [false, false, false];
  private fadeTarget: Uint8Array = new Uint8Array(48);
  private fadeValue = 2;

  private readonly draw: DrawImpl;
  private readonly core: GraphicsCore;

  constructor(
    private readonly sys: Pick<Subsystems, "cursor" | "sound" | "video" | "palette">,
    gfx: { draw: DrawImpl; core: GraphicsCore },
  ) {
    this.draw = gfx.draw;
    this.core = gfx.core;
    this.scenery = new Scenery(this.draw, this, () => this.machine);
  }

  attach(vm: VmContext): void {
    this.vm = vm;
  }

  private get machine(): VmContext {
    if (!this.vm) throw new Error("Mult : machine virtuelle non attachée");
    return this.vm;
  }

  private get vars(): Variables {
    return this.machine.vars;
  }

  // --- cycle de vie ---

  initAll(): void {
    this.objects = null;
    this.animSurf = null;
    this.scenery.init();
  }

  zeroMultData(): void {
    this.multData = null;
  }

  /** Mult::freeMult : libère les objets et la surface d'animation (pas les clés). */
  freeMult(): void {
    this.objects = null;
    this.orderArray = null;
    this.animSurf = null;
    this.draw.freeSprite(ANIM_SURFACE);
  }

  // --- chargement d'une ressource mult (Mult_v2::loadMult) ---

  loadMult(args: LoadMultArgs): void {
    const vm = this.machine;
    const index = args.index;
    const data = new MultData();
    this.multData = data;
    this.multDatas[index] = data;

    const res = vm.resources?.getResource(args.resId);
    if (!res) return;
    const r = new Reader(res.data);

    let staticCount = (r.i8() + 1) & 0xff;
    const animCount = (r.i8() + 1) & 0xff;
    const hasImds = (staticCount & 0x80) !== 0;
    staticCount &= 0x7f;

    for (let i = 0; i < staticCount; i++, r.pos += 14) {
      let idx = this.scenery.loadStatic(args.statics[i] ?? this.missing());
      if (idx >= 100) {
        idx -= 100;
        data.staticLoaded[i] = true;
      }
      data.staticIndices[i] = idx;
    }
    for (let i = 0; i < animCount; i++, r.pos += 14) {
      let idx = this.scenery.loadAnim(args.anims[i] ?? this.missing());
      if (idx >= 100) {
        idx -= 100;
        data.animLoaded[i] = true;
      }
      data.animIndices[i] = idx;
    }

    data.frameRate = r.i16();
    const staticKeysCount = r.i16();
    for (let i = 0; i < staticKeysCount; i++) data.staticKeys.push({ frame: r.i16(), layer: r.i16() });

    for (let i = 0; i < 4; i++) {
      const count = r.i16();
      for (let j = 0; j < count; j++) {
        data.animKeys[i].push({ frame: r.u16(), layer: r.i16(), posX: r.i16(), posY: r.i16(), order: r.i16() });
      }
    }

    for (let i = 0; i < 5; i++) data.fadePal[i] = r.bytes(48);

    const fadeCount = r.i16();
    for (let i = 0; i < fadeCount; i++) {
      data.palFadeKeys.push({ frame: r.i16(), fade: r.i16(), palIndex: r.i16(), flag: r.i8() });
    }

    const palCount = r.i16();
    for (let i = 0; i < palCount; i++) {
      const frame = r.i16();
      const cmd = r.i16();
      const rates = [r.i16(), r.i16(), r.i16(), r.i16()];
      r.pos += 4;
      data.palKeys.push({ frame, cmd, rates, subst: new Int8Array(r.bytes(64).buffer) });
    }

    const textCount = r.i16();
    for (let i = 0; i < textCount; i++) {
      data.textKeys.push({ frame: r.i16(), cmd: r.i16() });
      if (!hasImds) r.pos += 24;
    }

    const soundKeys = new Map(args.soundKeys.map((k) => [k.keyIndex, k]));
    const sndCount = r.i16();
    for (let i = 0; i < sndCount; i++) {
      const key: SndKey = { frame: r.i16(), cmd: r.i16(), freq: r.i16(), fadeLength: r.i16(), repCount: r.i16(), resId: -1, soundIndex: -1 };
      r.pos += 2;
      if (!hasImds) r.pos += 24;
      data.sndKeys.push(key);

      if (key.cmd !== 1 && key.cmd !== 4) continue;
      const load = soundKeys.get(i);
      if (!load) continue;
      key.resId = load.id;
      if (load.duplicate) {
        const same = data.sndKeys.slice(0, i).find((k) => k.resId === key.resId);
        if (same) key.soundIndex = same.soundIndex;
      } else {
        const slot = this.sys.sound.loadSearch(load.id, load.name) ?? 0;
        data.sndSlots.push(slot);
        key.soundIndex = slot & 0x7fff;
      }
    }

    if (args.imds) this.loadImds(data, r, args);
  }

  /** Section IMD de la ressource (Mult_v2::loadImds) ; la partie lue dans le script a été décodée avec l'opcode. */
  private loadImds(data: MultData, r: Reader, args: LoadMultArgs): void {
    const vm = this.machine;
    const imds = args.imds!;
    const script = vm.script.data;
    const view = new DataView(script.buffer, script.byteOffset, script.byteLength);
    for (let i = 0; i < imds.execWords; i++) {
      const at = imds.execPos + i * 2;
      data.execWords.push(at + 2 <= script.length ? view.getUint16(at, true) : 0);
    }
    if (vm.script.versionMinor < 3) return;

    const size = r.i16();
    if (size > 0) r.pos += size * 20;
    if (!imds.files) return;

    // Noms sans extension : la version Windows référence des VMD par des noms d'IMD.
    data.imdFiles = imds.files;
    r.pos += 2;
    for (let i = 0; i < 4; i++) {
      const count = r.i16();
      for (let j = 0; j < count; j++) {
        const frame = r.i16();
        const imdFile = r.i16();
        r.pos += 4;
        const flags = r.u16();
        const palFrame = r.i16();
        const lastFrame = r.i16();
        data.imdKeys[i].push({ frame, imdFile, flags, palFrame, lastFrame, palStart: r.i8(), palEnd: r.i8() });
      }
    }
  }

  private missing(): SceneryLoadArgs {
    return { index: 0, backs: [], picsCount: 0, resId: -1, pics: [], search: true };
  }

  /** Mult_v2::freeMultKeys sur les données courantes. */
  private freeCurrentKeys(): void {
    const data = this.multData;
    if (!data) return;
    data.staticLoaded.forEach((loaded, i) => loaded && this.scenery.freeStatic(data.staticIndices[i]));
    data.animLoaded.forEach((loaded, i) => loaded && this.scenery.freeAnim(data.animIndices[i]));
    for (const slot of data.sndSlots) if (!(slot & 0x8000)) this.sys.sound.freeSlot(slot);

    if (this.animDataAllocated) {
      this.freeMult();
      this.animDataAllocated = false;
    }
    for (let i = 0; i < MULT_SLOTS; i++) if (this.multDatas[i] === data) this.multDatas[i] = null;
    this.multData = null;
  }

  freeMultKeys(index: number): void {
    if (index < 0 || index >= MULT_SLOTS || !this.multDatas[index]) return;
    this.multData = this.multDatas[index];
    this.freeCurrentKeys();
    this.multDatas[index] = null;
  }

  // --- objets ---

  /** Inter_v2::o2_initMult. */
  initMult(args: InitMultArgs): void {
    const oldWidth = this.animWidth;
    const oldHeight = this.animHeight;
    const oldCount = this.objCount;
    this.animLeft = args.left;
    this.animTop = args.top;
    this.animWidth = args.width;
    this.animHeight = args.height;
    this.objCount = args.objCount;

    if (this.objects && oldCount !== this.objCount) {
      this.objects = null;
      this.orderArray = null;
    }
    if (!this.objects) {
      const vars = this.vars;
      this.orderArray = new Array(this.objCount).fill(0);
      this.objects = [];
      for (let i = 0; i < this.objCount; i++) {
        const anim = new AnimData(vars.bytes, args.animDataVar + i * 4 * this.machine.animDataSize);
        anim.isStatic = 1;
        this.objects.push(
          new MultObject(anim, new VarRef(vars, i * 4 + Math.trunc(args.posXVar / 4) * 4), new VarRef(vars, i * 4 + Math.trunc(args.posYVar / 4) * 4)),
        );
      }
    }

    if (this.animSurf && (oldWidth !== this.animWidth || oldHeight !== this.animHeight)) {
      this.draw.freeSprite(ANIM_SURFACE);
      this.animSurf = null;
    }
    if (!this.animSurf) {
      this.draw.initSpriteSurf(ANIM_SURFACE, this.animWidth, this.animHeight);
      this.animSurf = this.draw.sprites[ANIM_SURFACE];
    }
    this.draw.copySprite(BACK_SURFACE, ANIM_SURFACE, this.animLeft, this.animTop, this.animWidth, this.animHeight, 0, 0, 0);
  }

  /** Inter_v2::o2_loadMultObject (les objets de gobelins n'existent pas dans Lost in Time). */
  loadMultObject(args: MultObjectArgs): void {
    const obj = this.objects?.[args.objIndex];
    if (!obj) return;
    obj.posX.value = args.x;
    obj.posY.value = args.y;
    args.data.forEach((value, i) => value !== null && obj.anim.setByte(i, value));

    const animType = obj.anim.animType;
    if (animType !== 100 && animType !== 101 && obj.posX.value === -1234 && obj.posY.value === -4321) {
      obj.lastLeft = -1;
      obj.lastTop = -1;
      obj.lastBottom = -1;
      obj.lastRight = -1;
    }
  }

  getAnimLayerInfo(anim: number, layer: number, varDX: number, varDY: number, varUnk0: number, varFrames: number): void {
    const vars = this.vars;
    const info = this.scenery.getAnimLayer(anim, layer);
    vars.writeOff32(varDX, info?.animDeltaX ?? 0);
    vars.writeOff32(varDY, info?.animDeltaY ?? 0);
    vars.writeOff32(varUnk0, info?.unknown0 ?? 0);
    vars.writeOff32(varFrames, info?.framesCount ?? 0);
  }

  getObjAnimSize(objIndex: number, varLeft: number, varTop: number, varRight: number, varBottom: number): void {
    const sc = this.scenery;
    const obj = objIndex >= 0 && objIndex < this.objCount ? this.objects?.[objIndex] : undefined;
    if (!obj) {
      sc.toRedrawLeft = sc.toRedrawTop = sc.toRedrawRight = sc.toRedrawBottom = 0;
    } else {
      const a = obj.anim;
      if (a.isStatic === 0) sc.updateAnim(a.layer, a.frame, a.animation, 0, obj.posX.value, obj.posY.value, false);
      sc.toRedrawLeft = Math.max(sc.toRedrawLeft, 0);
      sc.toRedrawTop = Math.max(sc.toRedrawTop, 0);
    }
    const vars = this.vars;
    vars.writeOff32(varLeft, sc.toRedrawLeft);
    vars.writeOff32(varTop, sc.toRedrawTop);
    vars.writeOff32(varRight, sc.toRedrawRight);
    vars.writeOff32(varBottom, sc.toRedrawBottom);
  }

  // --- décors (délégués à Scenery) ---

  loadStatic(args: SceneryLoadArgs): number {
    return this.scenery.loadStatic(args);
  }

  loadAnim(args: SceneryLoadArgs): number {
    return this.scenery.loadAnim(args);
  }

  freeStatic(index: number): void {
    this.scenery.freeStatic(index);
  }

  freeAnim(index: number): void {
    this.scenery.freeAnim(index);
  }

  renderStatic(index: number, layer: number): void {
    this.scenery.renderStatic(index, layer);
  }

  loadCurLayer(curStatic: number, curStaticLayer: number): void {
    this.scenery.curStatic = s16(curStatic);
    this.scenery.curStaticLayer = s16(curStaticLayer);
  }

  updateAnim(layer: number, frame: number, animation: number, flags: number, deltaX: number, deltaY: number): void {
    this.scenery.updateAnim(layer, frame, animation, flags, deltaX, deltaY, true);
  }

  // --- multSub (Mult_v2::multSub) ---

  multSub(values: number[]): void {
    const vm = this.machine;
    let flags = values[0] & 0xffff;
    const multIndex = (flags >> 12) & 0xf;
    if (multIndex > 7) throw new Error("Mult : index hors limites");

    vm.timer.notifyNewAnim();
    const data = this.multDatas[multIndex];
    this.multData = data;
    if (!data) return;

    const index = flags & 0x200 ? 3 : flags & 0x100 ? 2 : flags & 0x80 ? 1 : 0;
    if (flags & 0x400) {
      flags = 0x400;
      data.animDirection = -1;
    } else {
      data.animDirection = 1;
      flags &= 0x7f;
    }

    data.animObjs[index][0] = flags;
    for (let i = 1; i < 4; i++) data.animObjs[index][i] = s16(values[i]);

    const expr = s16(values[4]);
    data.animKeysFrames[index] = expr;
    data.animKeysStartFrames[index] = expr;
    this.vars.writeVar32(18 + index, expr);

    const objects = this.objects;
    if (expr === -1) {
      if (!objects) return;
      for (let i = 0; i < 4; i++) {
        const obj = data.animObjs[index][i];
        if (obj === -1 || obj === 1024) continue;
        const a = objects[obj]?.anim;
        if (a) a.animType = a.animTypeBak;
      }
      return;
    }

    const startFrame = expr;
    let stopFrame: number;
    if (data.animDirection === 1) {
      stopFrame = 32000;
      for (const key of data.textKeys) if (key.frame > startFrame && key.frame < stopFrame) stopFrame = key.frame;
    } else {
      stopFrame = 0;
      for (const key of data.textKeys) if (key.frame < startFrame && key.frame > stopFrame) stopFrame = key.frame;
    }

    if (objects) {
      for (let i = 0; i < 4; i++) {
        const obj = data.animObjs[index][i];
        const a = objects[obj]?.anim;
        if (obj !== -1 && obj !== 1024 && a) a.animTypeBak = a.animType;
      }
    }

    for (let i = 0; i < 4; i++) {
      data.animKeysIndices[index][i] = 0;
      const at = data.animKeys[i].findIndex((k) => k.frame >= startFrame);
      if (at >= 0) data.animKeysIndices[index][i] = at;
    }

    if (data.animDirection === -1) {
      const keys = data.imdKeys[index];
      let i = 0;
      while (i < keys.length && keys[i].frame <= startFrame) i++;
      data.imdIndices[index] = i - 1;
    }

    const firstFrame = data.animDirection === 1 ? startFrame : stopFrame;
    for (let i = 0; i < 4; i++) {
      data.imdKeysIndices[index][i] = 0;
      const at = data.imdKeys[i].findIndex((k) => k.frame >= firstFrame);
      if (at >= 0) data.imdKeysIndices[index][i] = at;
    }

    data.animKeysStartFrames[index] = startFrame;
    data.animKeysStopFrames[index] = stopFrame;
  }

  // --- lecture d'un mult (Mult::playMult) ---

  playMult(dataIndex: number, startFrame: number, checkEscape: boolean): Promise<void> {
    this.multData = this.multDatas[dataIndex] ?? null;
    return this.run(startFrame, -1, checkEscape, 0);
  }

  private beginPlay(startFrame: number, endFrame: number): PlayState | null {
    if (!this.multData) return null;
    this.frame = startFrame;
    if (endFrame === -1) endFrame = 32767;
    if (this.frame === -1) this.playMultInit();
    return { stop: true, stopNoClear: false, endFrame };
  }

  private async run(startFrame: number, endFrame: number, checkEscape: boolean, handleMouse: number): Promise<void> {
    const vm = this.machine;
    const st = this.beginPlay(startFrame, endFrame);
    if (!st) return;
    do {
      st.stop = true;
      if (this.vars.readVar32(58) === 0) {
        this.drawStatics(st);
        this.drawAnims(st);
      }
      await this.animate();
      const pending: Pending[] = [];
      this.afterAnimate(st, handleMouse, pending);
      for (const fade of pending) await fade();

      if (checkEscape && vm.host.input.popKey() === KEY_ESCAPE) st.stop = true;
      await vm.timer.waitEndFrame();
      this.frame++;
    } while (!st.stop && !st.stopNoClear && !vm.quit);
    this.endPlay(st);
  }

  /** Une seule image sans attente (Game::checkKeys quand la variable 58 est posée). */
  private playOnce(frame: number, handleMouse: number): void {
    const vm = this.machine;
    const st = this.beginPlay(frame, frame);
    if (!st) return;
    st.stop = true;
    this.advanceAllObjects(null);
    this.updateObjects();
    this.afterAnimate(st, handleMouse, null);
    if (vm.host.input.popKey() === KEY_ESCAPE) st.stop = true;
    this.frame++;
    this.endPlay(st);
  }

  checkKeysTick(handleMouse: number): void {
    const data = this.multData;
    if (!data || !this.vm) return;
    let vars: Variables;
    try {
      vars = this.vm.vars;
    } catch {
      return;
    }
    const var58 = vars.readVar32(58) | 0;
    if (var58 === 0) return;
    if (data.frameStart !== var58 - 1) data.frameStart++;
    else data.frameStart = 0;
    this.playOnce(s16(data.frameStart + vars.readVar32(57)), handleMouse);
  }

  /** Suite d'une image après animate : curseur, textes, palettes, sons. */
  private afterAnimate(st: PlayState, handleMouse: number, pending: Pending[] | null): void {
    if (handleMouse) this.sys.cursor.animate(-1);
    else this.draw.blitInvalidated();

    if (this.vars.readVar32(58) === 0) this.drawText(st);

    this.prepPalAnim(st);
    this.doPalAnim();
    this.doFadeAnim(st, pending);
    this.doSoundAnim(this.frame);

    if (this.frame >= st.endFrame) st.stopNoClear = true;
    if (this.sys.sound.isPlaying()) st.stop = false;
  }

  private endPlay(st: PlayState): void {
    const data = this.multData!;
    if (st.stopNoClear) {
      this.vars.writeVar32(57, this.frame - data.frameStart - 1);
      return;
    }
    if (this.animDataAllocated) {
      this.freeMult();
      this.animDataAllocated = false;
    }
    if (this.sys.sound.isPlaying()) this.sys.sound.stop(10);
    this.vars.writeVar32(57, 0xffffffff);
  }

  /** Mult_v2::playMultInit : objets et surface d'animation internes quand initMult n'a pas été appelé. */
  private playMultInit(): void {
    const data = this.multData!;
    this.doPalSubst = false;
    this.palFading.fill(false);

    if (!this.animSurf) {
      this.machine.timer.setFrameRate(data.frameRate);
      this.animTop = 0;
      this.animLeft = 0;
      this.animWidth = this.core.surfWidth;
      this.animHeight = this.core.surfHeight;
      this.objCount = 4;
      this.orderArray = new Array(this.objCount).fill(0);

      const posX = new Variables(this.objCount * 4);
      const posY = new Variables(this.objCount * 4);
      const animBytes = new Uint8Array(this.objCount * ANIM_DATA_SIZE);
      this.objects = [];
      for (let i = 0; i < this.objCount; i++) {
        const anim = new AnimData(animBytes, i * ANIM_DATA_SIZE);
        anim.isStatic = 1;
        this.objects.push(new MultObject(anim, new VarRef(posX, i * 4), new VarRef(posY, i * 4)));
      }

      this.draw.initSpriteSurf(ANIM_SURFACE, this.animWidth, this.animHeight);
      this.animSurf = this.draw.sprites[ANIM_SURFACE];
      this.animSurf?.blit(this.draw.back, 0, 0, this.core.surfWidth, this.core.surfHeight, 0, 0);

      for (let i = 0; i < this.objCount; i++) data.palAnimIndices[i] = i;
      this.animDataAllocated = true;
    } else {
      this.animDataAllocated = false;
    }
    this.frame = 0;
  }

  /** Copie le fond dans la surface d'animation (le fond propre que les objets restaurent). */
  private saveBackground(): void {
    this.animSurf?.blit(this.draw.back, 0, 0, this.core.surfWidth, this.core.surfHeight, 0, 0);
  }

  private drawStatics(st: PlayState): void {
    const data = this.multData!;
    const sc = this.scenery;
    const keys = data.staticKeys;
    if (keys.length > 0 && keys[keys.length - 1].frame > this.frame) st.stop = false;

    for (const key of keys) {
      if (key.frame !== this.frame || key.layer === -1) continue;
      if (key.layer >= 0) {
        let i = 0;
        let layer = key.layer;
        let staticIndex = data.staticIndices[0];
        while (i < data.staticIndices.length - 1 && sc.getStaticLayersCount(staticIndex) <= layer) {
          layer -= sc.getStaticLayersCount(staticIndex);
          staticIndex = data.staticIndices[++i];
        }
        sc.curStatic = data.staticIndices[i];
        sc.curStaticLayer = layer;
        sc.renderStatic(sc.curStatic, sc.curStaticLayer);
      } else {
        const resId = data.execWords[-key.layer - 2];
        if (resId !== undefined) this.draw.loadSprite(resId, BACK_SURFACE, 0, 0, 0);
        sc.curStatic = -1;
      }
      this.saveBackground();
    }
  }

  private drawAnims(st: PlayState): void {
    const data = this.multData!;
    const sc = this.scenery;
    for (let i = 0; i < 4; i++) {
      const keys = data.animKeys[i];
      if (keys.length > 0 && keys[keys.length - 1].frame > this.frame) st.stop = false;
    }

    for (let index = 0; index < 4; index++) {
      const animObj = this.objects?.[data.animObjs[0][index]];
      for (const key of data.animKeys[index]) {
        if (!animObj || key.frame !== this.frame) continue;
        const a = animObj.anim;
        if (key.layer === -1) {
          a.isStatic = 1;
          continue;
        }
        animObj.posX.value = key.posX;
        animObj.posY.value = key.posY;
        a.frame = 0;
        a.order = key.order;
        a.animType = 1;
        a.isPaused = 0;
        a.isStatic = 0;
        a.maxTick = 0;
        animObj.tick = 0;
        a.layer = key.layer;

        let i = 0;
        let animIndex = data.animIndices[0];
        let count = sc.getAnimLayersCount(animIndex);
        let layer = key.layer;
        while (layer >= count && i < data.animIndices.length - 1) {
          layer -= count;
          animIndex = data.animIndices[++i];
          count = sc.getAnimLayersCount(animIndex);
        }
        a.layer = layer;
        a.animation = animIndex;
      }
    }
  }

  private drawText(st: PlayState): void {
    const data = this.multData!;
    for (const key of data.textKeys) {
      if (key.frame !== this.frame) continue;
      if (key.cmd === 0 || key.cmd === 3) st.stop = false;
      else if (key.cmd === 1) {
        st.stopNoClear = true;
        data.frameStart = 0;
      }
    }
  }

  // --- palette ---

  private prepPalAnim(st: PlayState): void {
    const data = this.multData!;
    const key = data.palKeys.find((k) => k.frame === this.frame);
    if (!key) return;
    st.stop = false;
    if (key.cmd === -1) {
      this.doPalSubst = false;
      this.core.setFullPalette();
    } else {
      this.doPalSubst = true;
      this.palAnimKey = data.palKeys.indexOf(key);
      data.palAnimIndices.fill(0);
      this.palWork = this.core.wanted.slice();
    }
  }

  private doPalAnim(): void {
    if (!this.doPalSubst || !this.palWork) return;
    const data = this.multData!;
    const key = data.palKeys[this.palAnimKey];
    const pal = this.palWork;
    const subst = (k: number, c: number): number => key.subst[k * 4 + c];

    for (let c = 0; c < 4; c++) {
      if (key.rates[c] === 0 || this.frame % key.rates[c] !== 0) continue;
      const first = (subst(0, c) - 1) * 3;
      let saved = [pal[first], pal[first + 1], pal[first + 2]];

      for (;;) {
        const idx = data.palAnimIndices[c];
        const next = subst((idx + 1) % 16, c);
        const dest = (subst(idx, c) - 1) * 3;
        const from = (next - 1) * 3;
        if (next === 0) pal.set(saved, dest);
        else pal.copyWithin(dest, from, from + 3);

        data.palAnimIndices[c] = (idx + 1) % 16;
        if (subst(data.palAnimIndices[c], c) === 0) {
          data.palAnimIndices[c] = 0;
          const start = (subst(0, c) - 1) * 3;
          saved = [pal[start], pal[start + 1], pal[start + 2]];
        }
        if (data.palAnimIndices[c] === 0) break;
      }
    }

    // En 256 couleurs seules les 16 premières sont mises à jour à l'écran.
    const count = this.core.colorCount === 256 ? 48 : 768;
    this.core.shown.set(pal.subarray(0, count));
    this.core.touch();
  }

  private doFadeAnim(st: PlayState, pending: Pending[] | null): void {
    const data = this.multData!;
    const core = this.core;
    for (const key of data.palFadeKeys) {
      if (key.frame !== this.frame) continue;
      st.stop = false;
      const target = data.fadePal[key.palIndex];
      if (!target) continue;
      // Les palettes de fondu n'ont que 16 couleurs : elles remplacent le début de la palette voulue.
      core.wanted.set(target, 0);
      if (!(key.flag & 1)) {
        if (key.fade === 0) core.setFullPalette();
        else if (pending) pending.push(() => (this.sys.palette as PaletteImpl).fade(core.wanted, key.fade));
        else core.setFullPalette();
      } else {
        this.fadeTarget = target;
        this.fadeValue = key.fade < 0 ? -key.fade : 2;
        this.palFading[0] = ((key.flag >> 1) & 1) !== 0;
        this.palFading[1] = ((key.flag >> 2) & 1) !== 0;
        this.palFading[2] = ((key.flag >> 3) & 1) !== 0;
      }
    }

    for (let c = 0; c < 3; c++) {
      if (!this.palFading[c]) continue;
      this.palFading[c] = !this.fadeStepColor(c);
      st.stop = false;
    }
  }

  /** PalAnim::fadeStepColor : un pas de fondu d'une composante sur les 16 premières couleurs ; vrai quand atteinte. */
  private fadeStepColor(component: number): boolean {
    const shown = this.core.shown;
    let stop = true;
    for (let i = 0; i < 16; i++) {
      const at = i * 3 + component;
      const from = shown[at];
      const to = this.fadeTarget[at];
      shown[at] = from - this.fadeValue > to ? from - this.fadeValue : from + this.fadeValue < to ? from + this.fadeValue : to;
      if (from !== to) stop = false;
    }
    this.core.touch();
    return stop;
  }

  // --- sons ---

  private doSoundAnim(frame: number): void {
    const data = this.multData!;
    const sound = this.sys.sound;
    for (const key of data.sndKeys) {
      if (key.frame !== frame) continue;
      if (key.cmd !== -1) {
        if (key.cmd === 1 || key.cmd === 4) {
          sound.stop(0);
          if (key.soundIndex >= 0) sound.play(key.soundIndex, Math.max(key.repCount + 1, 0), key.freq);
        }
      } else if (sound.isPlaying()) {
        sound.stop(key.fadeLength);
      }
    }
  }

  // --- avance des clés (Mult_v2::advanceObjects) ---

  private advanceAllObjects(videos: Pending[] | null): void {
    const saved = this.multData;
    for (let i = 0; i < MULT_SLOTS; i++) {
      if (!this.multDatas[i]) continue;
      this.multData = this.multDatas[i];
      for (let j = 0; j < 4; j++) this.advanceObjects(j, videos);
    }
    this.multData = saved;
  }

  private advanceObjects(index: number, videos: Pending[] | null): void {
    const data = this.multData!;
    const sc = this.scenery;
    let frame = data.animKeysFrames[index];
    if (frame === -1) return;

    for (let i = 0; i < 4; i++) {
      const obj = data.animObjs[index][i];
      const animObj = this.objects?.[obj];

      if (obj !== -1 && obj !== 1024 && animObj) {
        const keys = data.animKeys[i];
        const a = animObj.anim;
        for (let j = data.animKeysIndices[index][i]; j < keys.length; j++) {
          const key = keys[j];
          if (key.frame > frame) break;
          if (key.frame < frame) continue;
          if (key.layer > -1) {
            data.animKeysIndices[index][i] = j;
            animObj.posX.value = key.posX;
            animObj.posY.value = key.posY;
            a.frame = 0;
            a.animType = 1;
            a.isStatic = 0;
            a.isPaused = 0;
            a.maxTick = 0;
            animObj.tick = 0;

            let animation = 0;
            let layer = key.layer;
            let layers = sc.getAnimLayersCount(data.animIndices[0]);
            while (layer >= layers && animation < data.animIndices.length - 1) {
              layer -= layers;
              animation++;
              layers = sc.getAnimLayersCount(data.animIndices[animation]);
            }
            a.layer = layer;
            a.animation = data.animIndices[animation];
            break;
          }
          a.isStatic = 1;
        }
      }

      if (obj !== -1) {
        const keys = data.imdKeys[i];
        for (let j = data.imdKeysIndices[index][i]; j < keys.length; j++) {
          const key1 = keys[j];
          const key2 = keys[j - 1];
          if (key1.frame > frame) break;
          if (key1.frame < frame) continue;
          if (key1.imdFile !== -1) {
            data.imdIndices.fill(-1);
            if (data.animDirection === 1 || !key2 || key2.imdFile === -1) data.imdIndices[i] = j;
            else if (data.animKeysStopFrames[index] === frame) data.imdIndices[i] = -1;
            else data.imdIndices[i] = j - 1;
          } else {
            data.imdIndices[i] = -1;
          }
        }
      }

      if (data.imdIndices[i] !== -1) {
        const key = data.imdKeys[i][data.imdIndices[i]];
        if (!key) continue;
        const fileN = -key.imdFile - 2;
        if (fileN < 0) return;
        const dir = data.animDirection;
        let startFrame = frame - key.frame;
        if (dir !== 1 && --startFrame < 0) startFrame = 0;
        const name = this.imdName(data, fileN);
        if (videos && name) videos.push(() => this.playImd(name, key, startFrame));
      }
    }

    this.doSoundAnim(frame);
    this.vars.writeVar32(22, frame);

    if (data.animKeysStopFrames[index] === frame) {
      data.imdIndices.fill(-1);
      frame = -1;
      for (let i = 0; i < 4; i++) {
        const obj = data.animObjs[index][i];
        if (obj === -1 || obj === 1024) continue;
        const a = this.objects?.[obj]?.anim;
        if (a) a.animType = a.animTypeBak;
      }
    } else if (data.animDirection === 1) {
      frame++;
    } else {
      frame--;
    }

    data.animKeysFrames[index] = frame;
    this.vars.writeVar32(18 + index, frame);
  }

  /** Nom d'un fichier IMD de la section, sans extension. */
  private imdName(data: MultData, fileN: number): string {
    const files = data.imdFiles;
    if (!files || (fileN + 1) * NAME_LENGTH > files.length) return "";
    let name = "";
    for (let i = 0; i < NAME_LENGTH && files[fileN * NAME_LENGTH + i] !== 0; i++) name += String.fromCharCode(files[fileN * NAME_LENGTH + i]);
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(0, dot) : name;
  }

  /** Mult_v2::playImd : affiche l'image `startFrame` de la vidéo d'une clé IMD. */
  private async playImd(name: string, key: ImdKey, startFrame: number): Promise<void> {
    const player = this.sys.video as VideoPlayer;
    const vars = this.vars;
    const props = videoProps();
    if (this.draw.renderFlags & RENDER_FLAG_VIDEO_POS) {
      props.x = vars.readVar32(55) | 0;
      props.y = vars.readVar32(56) | 0;
    }

    props.flags = (key.flags >> 8) & 0xff;
    if (props.flags & 0x20) props.flags = (props.flags & 0x9f) | 0x80;
    props.palStart = key.palStart;
    props.palEnd = key.palEnd;
    props.palFrame = key.palFrame;
    props.lastFrame = key.lastFrame;

    if (props.palFrame !== -1 && props.lastFrame !== -1 && props.lastFrame - props.palFrame < props.startFrame && !(key.flags & 0x4000)) {
      player.closeVideo(0);
      return;
    }

    player.evaluateFlags(props);
    const slot = player.openVideo(true, name, props);
    if (slot < 0) return;

    if (props.palFrame === -1) props.palFrame = 0;
    if (props.lastFrame === -1) props.lastFrame = player.frameCount(slot) - 1;
    const cycle = props.lastFrame - props.palFrame + 1;
    const base = cycle > 0 ? startFrame % cycle : startFrame;

    props.endFrame = props.lastFrame;
    props.startFrame = base + props.palFrame;
    props.lastFrame = base + props.palFrame;
    props.flags &= 0x7f;
    await player.playVideo(slot, props);
  }

  // --- Mult_v2::animate ---

  async animate(): Promise<void> {
    if (!this.objects) return;
    const videos: Pending[] = [];
    this.advanceAllObjects(videos);
    for (const play of videos) await play();
    this.updateObjects();
  }

  /** Redessine les objets animés (dirty rects, ordre, images suivantes, intersections). */
  private updateObjects(): void {
    const objects = this.objects;
    const orderArray = this.orderArray;
    if (!objects || (objects.length > 0 && !orderArray)) return;
    const sc = this.scenery;
    const draw = this.draw;
    const versionMinor = this.machine.script.versionMinor;

    let minOrder = 100;
    let maxOrder = 0;
    const render: MultObject[] = [];
    const animIndices: number[] = [];

    objects.forEach((animObj, i) => {
      const a = animObj.anim;
      a.intersected = 200;
      if (a.isStatic !== 2 && (a.isStatic === 0 || animObj.lastLeft !== -1)) {
        animIndices.push(i);
        render.push(animObj);
      }
    });

    // Zones sales
    for (const animObj of render) {
      const a = animObj.anim;
      animObj.needRedraw = 0;
      animObj.newTop = 1000;
      animObj.newLeft = 1000;
      animObj.newBottom = 0;
      animObj.newRight = 0;
      if (a.isStatic === 2) continue;

      if (!a.isStatic && !a.isPaused && a.maxTick === animObj.tick) {
        animObj.needRedraw = 1;
        sc.updateAnim(a.layer, a.frame, a.animation, 8, animObj.posX.value, animObj.posY.value, false);
        if (animObj.lastLeft === -1) {
          animObj.newLeft = sc.toRedrawLeft;
          animObj.newTop = sc.toRedrawTop;
          animObj.newRight = sc.toRedrawRight;
          animObj.newBottom = sc.toRedrawBottom;
        } else {
          animObj.newLeft = Math.min(animObj.lastLeft, sc.toRedrawLeft);
          animObj.newTop = Math.min(animObj.lastTop, sc.toRedrawTop);
          animObj.newRight = Math.max(animObj.lastRight, sc.toRedrawRight);
          animObj.newBottom = Math.max(animObj.lastBottom, sc.toRedrawBottom);
          if (
            versionMinor > 2 &&
            animObj.newLeft === animObj.lastLeft &&
            animObj.newTop === animObj.lastTop &&
            animObj.newRight === animObj.lastRight &&
            animObj.newBottom === animObj.lastBottom &&
            a.redrawLayer === a.layer &&
            a.redrawFrame === a.frame &&
            a.redrawAnimation === a.animation
          ) {
            animObj.needRedraw = 0;
          }
        }
      } else if (!a.isStatic) {
        if (animObj.lastLeft === -1) {
          animObj.needRedraw = 1;
          sc.updateAnim(a.layer, a.frame, a.animation, 8, animObj.posX.value, animObj.posY.value, false);
          animObj.newLeft = sc.toRedrawLeft;
          animObj.newTop = sc.toRedrawTop;
          animObj.newRight = sc.toRedrawRight;
          animObj.newBottom = sc.toRedrawBottom;
        } else {
          animObj.newLeft = animObj.lastLeft;
          animObj.newTop = animObj.lastTop;
          animObj.newRight = animObj.lastRight;
          animObj.newBottom = animObj.lastBottom;
        }
      } else if (animObj.lastLeft !== -1) {
        animObj.needRedraw = 1;
        animObj.newLeft = animObj.lastLeft;
        animObj.newTop = animObj.lastTop;
        animObj.newRight = animObj.lastRight;
        animObj.newBottom = animObj.lastBottom;
      }

      a.redrawLayer = a.layer;
      a.redrawFrame = a.frame;
      a.redrawAnimation = a.animation;
      if (animObj.needRedraw || !a.isStatic) {
        minOrder = Math.min(minOrder, a.order);
        maxOrder = Math.max(maxOrder, a.order);
      }
    }

    // Restauration du fond sous les zones sales
    for (const animObj of render) {
      if (!animObj.needRedraw || animObj.lastLeft === -1) continue;
      animObj.lastLeft = -1;
      const maxLeft = Math.max(animObj.newLeft, this.animLeft);
      const maxTop = Math.max(animObj.newTop, this.animTop);
      const width = animObj.newRight - maxLeft + 1;
      const height = animObj.newBottom - maxTop + 1;
      if (width <= 0 || height <= 0) continue;
      draw.copySprite(ANIM_SURFACE, BACK_SURFACE, maxLeft - this.animLeft, maxTop - this.animTop, width, height, maxLeft, maxTop, 0);
    }

    // Ordre de dessin
    const order: number[] = [];
    for (let i = minOrder; i <= maxOrder; i++) {
      render.forEach((animObj, j) => {
        if (animObj.anim.order === i && (animObj.needRedraw || !animObj.anim.isStatic)) order.push(j);
      });
    }

    // Mise à jour de l'affichage
    for (const k of order) {
      const animObj1 = render[k];
      const a1 = animObj1.anim;

      if (!animObj1.needRedraw) {
        if (a1.isStatic) continue;
        for (const l of order) {
          const animObj2 = render[l];
          if (!animObj2.needRedraw) continue;
          if (
            animObj1.newRight >= animObj2.newLeft &&
            animObj2.newRight >= animObj1.newLeft &&
            animObj1.newBottom >= animObj2.newTop &&
            animObj2.newBottom >= animObj1.newTop
          ) {
            sc.toRedrawLeft = animObj2.newLeft;
            sc.toRedrawRight = animObj2.newRight;
            sc.toRedrawTop = animObj2.newTop;
            sc.toRedrawBottom = animObj2.newBottom;
            sc.updateAnim(a1.layer, a1.frame, a1.animation, 12, animObj1.posX.value, animObj1.posY.value, true);
            sc.updateStatic(a1.order + 1);
          }
        }
        continue;
      }

      if (a1.isStatic !== 0) {
        sc.toRedrawLeft = animObj1.newLeft;
        sc.toRedrawRight = animObj1.newRight;
        sc.toRedrawTop = animObj1.newTop;
        sc.toRedrawBottom = animObj1.newBottom;
      } else {
        sc.updateAnim(a1.layer, a1.frame, a1.animation, 10, animObj1.posX.value, animObj1.posY.value, true);
        if (sc.toRedrawLeft !== NO_REDRAW) {
          animObj1.lastLeft = sc.toRedrawLeft;
          animObj1.lastRight = sc.toRedrawRight;
          animObj1.lastTop = sc.toRedrawTop;
          animObj1.lastBottom = sc.toRedrawBottom;
        } else {
          animObj1.lastLeft = -1;
        }
      }
      sc.updateStatic(a1.order + 1);
    }

    // Images suivantes
    for (const animObj of render) {
      const a = animObj.anim;
      if (a.isStatic) continue;
      if (a.animType === 7 && a.newState !== -1) {
        a.layer = a.newState;
        a.frame = 0;
        a.newState = -1;
        a.isPaused = 0;
      }
      if (a.isPaused) continue;
      if (a.maxTick === animObj.tick) {
        animObj.tick = 0;
        this.newCycleAnim(animObj);
      } else {
        animObj.tick++;
      }
    }

    // Intersections
    render.forEach((animObj1, i) => {
      if (animObj1.anim.isStatic || animObj1.lastLeft === -1) return;
      render.forEach((animObj2, j) => {
        if (i === j || animObj2.anim.isStatic || animObj2.lastLeft === -1) return;
        if (
          animObj2.lastRight >= animObj1.lastLeft &&
          animObj2.lastLeft <= animObj1.lastRight &&
          animObj2.lastBottom >= animObj1.lastTop &&
          animObj2.lastTop <= animObj1.lastBottom
        ) {
          animObj2.anim.intersected = animIndices[i];
        }
      });
    });
  }

  /**
   * Mult_v2::newCycleAnim : image suivante ; à la fin des images, comportement selon animType.
   * Les types 10 (déplacement de gobelin) et 100/101 ne sont pas portés : voir game.goblin.
   */
  private newCycleAnim(animObj: MultObject): void {
    const a = animObj.anim;
    const layer = a.animation >= 0 ? this.scenery.getAnimLayer(a.animation, a.layer) : null;
    if (a.animation >= 0 && !layer) return;

    if (a.animType === 4) {
      a.frame = 0;
      a.isPaused = 1;
      return;
    }
    if (a.animType === 12) a.animType = 11;
    if (a.animType === 11) {
      if (a.isBusy !== 0 && a.animTypeBak === 1) {
        if (a.framesLeft !== 0) a.framesLeft--;
        else {
          a.isBusy = 0;
          a.animTypeBak = 0;
          a.animType = 10;
        }
      }
      return;
    }

    if (a.animType !== 8) a.frame++;
    if (layer && a.frame < layer.framesCount) {
      a.newCycle = 0;
      return;
    }

    switch (a.animType) {
      case 0:
        a.frame = 0;
        break;
      case 1:
        a.frame = 0;
        if (layer) {
          animObj.posX.value += layer.animDeltaX;
          animObj.posY.value += layer.animDeltaY;
        }
        break;
      case 2:
        a.frame = 0;
        a.animation = a.newAnimation;
        a.layer = a.newLayer;
        break;
      case 3:
        a.animType = 4;
        a.frame = 0;
        break;
      case 5:
        a.isStatic = 1;
        a.frame = 0;
        break;
      case 6:
      case 7:
        a.frame--;
        a.isPaused = 1;
        break;
      case 10:
        a.frame = 0;
        break;
    }
    a.newCycle = 1;
  }
}
