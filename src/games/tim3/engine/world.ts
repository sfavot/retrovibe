/**
 * Monde de la simulation : types, listes de pièces, réglages du niveau, état des collisions, générateur, registre des
 * handlers. Chargement d'un niveau (`readLev`) comme 43252d (431d3f, 43ada7, 43267a) puis démarrage de la machine
 * (435658, 435ab4 → 43ada7).
 */
import type { Level, LevPart } from "../data/lev";
import { PART_LOCKED } from "../data/lev";
import { CollisionState } from "./collide";
import { s8, s16 } from "./fixed";
import { applyAtmosphere, DEFAULT_GRAVITY, DEFAULT_PRESSURE } from "./gravity";
import { insertSorted, PartList } from "./lists";
import { updateGeometry } from "./move";
import { BeltData, F0C, Part, Polygon, RopeData } from "./part";
import { defaultRegistry } from "./parts";
import { type HandlerRegistry, stubResult } from "./parts/registry";
import { Random } from "./random";
import { type FrameRect, TYPE_COUNT, TypeTable } from "./types";

/** Journal des appels non portés (souches) et des cas hors du comportement connu. */
export interface WorldLog {
  /** Adresse (hex) → nombre d'appels. */
  stubs: Map<string, number>;
  notes: string[];
}

export class World {
  readonly statics = new PartList("static");
  readonly mobiles = new PartList("mobile");
  readonly bin = new PartList("bin");
  /**
   * 0x4815f8 : liste auxiliaire, triée par effort décroissant (43ab07) : pièces tirées par une corde (bascules) dont le
   * slot 1 tourne en tête du pas suivant. 43aad1 la vide ensuite (ses nœuds retournent à 0x4815fc, sans effet ici).
   */
  aux: AuxNode[] = [];
  /** 0x4815b0 = 0x2000 : machine en marche (`start`) ; sinon édition (chargement). */
  running = false;
  /** 0x481194 : pièce traitée en premier par 43abff (édition) ; nulle en marche. */
  first: Part | null = null;
  /** 0x481380 / 0x481384 */
  pressure = DEFAULT_PRESSURE;
  gravity = DEFAULT_GRAVITY;
  /** 0x481574 : compteur d'images (pas effectués). */
  frameCounter = 0;
  /** 0x481034 : options d'animation (bit 0 : animations décoratives, comme le clignotement du flipper) ; 7 au démarrage. */
  animFlags = 7;
  /** 0x477d00 : compte à rebours du clignotement des boules de flipper (0x78 = 120 dans l'image de l'exe). */
  pinballTimer = 120;
  /** Comptes à rebours d'animations de repos tirés au hasard (valeur 120 dans l'image de l'exe) : fusées 0x477fe4, lampes
   * d'Aladdin 0x4780bc, moteur à souris 0x477e74, taquet 0x477fb4. */
  rocketTimer = 120;
  lampTimer = 120;
  mouseIdleTimer = 120;
  cleatTimer = 120;
  /** Autres comptes à rebours globaux jamais réinitialisés par l'exe : chat 0x477eb0 (120), souris 0x4780b8 (140),
   * mandrill 0x477fc8 (120), clignotement du taille-haie 0x47806c (120). */
  catTimer = 0x78;
  newtonMouseTimer = 0x8c;
  mandrillTimer = 0x78;
  trimmerTimer = 0x78;
  /** 0x4815b4 : poignée de redimensionnement de l'éditeur (0x8003 … 0x8006), lue par le slot 4 du tuyau 97 ; 8 au
   * rangement dans le bac. */
  resizeHandle = 0;
  readonly collision = new CollisionState();
  rng = new Random();
  readonly log: WorldLog = { stubs: new Map(), notes: [] };
  /** Effets sonores demandés pendant le pas (numéro, pièce) ; vidés par l'hôte. */
  readonly sounds: { id: number; part: Part }[] = [];

  constructor(
    readonly types: TypeTable,
    readonly handlers: HandlerRegistry = defaultRegistry(),
  ) {}

  /** 439ad8(0x3000) puis 439b21(…, 0x1000) : statiques puis mobiles. */
  *staticThenMobile(): IterableIterator<Part> {
    yield* this.statics;
    yield* this.mobiles;
  }

  /**
   * 43ab07(from, to) : demande que `to` (bascule) tourne au pas suivant avec l'effort de `from` (+0x60). Refusé (0) si
   * `to` y est déjà avec un effort au moins égal ; sinon insertion avant le premier nœud d'effort inférieur, rend 1.
   */
  auxInsert(from: Part, to: Part): number {
    const force = from.momentum;
    for (const n of this.aux) if (n.part === to && force <= n.force) return 0;
    let i = 0;
    if (this.aux.length > 0 && force <= this.aux[0]!.force) {
      i = 1;
      while (i < this.aux.length && force < this.aux[i]!.force) i++;
    }
    this.aux.splice(i, 0, { part: to, force });
    return 1;
  }

  /**
   * 439695(part, n) : zone à redessiner, côté simulation. Pose l'octet +0x28 (sauf bout de corde 0x31) et, en marche,
   * recalcule les extrémités des cordes attachées (438db6) si leur pièce corde n'est pas déjà marquée dans ce pas.
   * Les handlers qui appellent 439695 dans l'exe doivent appeler ceci (les cordes en dépendent).
   */
  redraw(part: Part, n: number): void {
    if (part.type !== 0x31) part.redraw = (n << 24) >> 24;
    if (part.type === 7) {
      const r = part.ropes[1];
      if (r) r.ropePart.redraw = (n << 24) >> 24;
      return;
    }
    if (part.belt) {
      // En édition seulement (0x4815b0 = 0x1000) : 438c70 et 438985.
      part.belt.beltPart.redraw = (n << 24) >> 24;
    }
    if (!this.running) {
      for (const r of part.ropes) {
        if (!r) continue;
        r.ropePart.redraw = (n << 24) >> 24;
        this.special(0x438db6, part, r);
      }
      return;
    }
    for (const r of part.ropes) {
      if (!r || r.ropePart.redraw & 0x3f) continue;
      r.ropePart.redraw = (n << 24) >> 24;
      this.special(0x438db6, part, r);
    }
  }

  /** Appelle le slot `slot` du type `type` avec des arguments explicites (slot 5 depuis 43a31d : voir `pull`). */
  callType(slot: number, type: number, part: Part, arg?: number | Part | null, ...more: number[]): number {
    const address = this.types.get(type).handlers[slot]!;
    if (address === 0) return 0;
    const entry = this.handlers.get(address);
    if (!entry) {
      this.stub(address, part);
      return stubResult(slot);
    }
    const r = entry.fn(this, part, arg, ...more);
    return typeof r === "number" ? r : 0;
  }

  /**
   * Slot 5 de `target` tel que 43a31d (43a8f1) et 43f050 l'appellent : `(puller, target, emplacement, flags, masse,
   * effort)`. Signature unique des handlers de slot 5 : `fn(world, target, puller, emplacement, flags, masse, effort)`
   * (`part` = la pièce du type, comme pour les autres slots). `emplacement` : corde de `target` concernée (0 depuis
   * 43a31d). `flags` = 1 : simple comptage (+0x18 de la corde) ; sinon drapeaux de 439f67 (| 0x8000 : simulation).
   * Rend 1 si la pièce tirée résiste (ou bouge) selon le type.
   */
  pull(puller: Part, target: Part, flags: number, mass: number, force: number, slot = 0): number {
    return this.callType(5, target.type, target, puller, slot, flags, mass, force);
  }

  /** Crochets de l'hôte pour le son (`docs/tim3/audio.md`) : effets joués par les handlers (41126d) et arrêts (41151e). */
  onSound?: (e: { id: number; priority: number; flags: number }) => void;
  onStopSound?: (id: number) => void;

  /** 41126d(id, priorité, drapeaux) appelé par un handler : file du pas (`sounds`) et crochet `onSound`. */
  sound(id: number, part: Part, priority = 0, flags = 0): void {
    this.sounds.push({ id, part });
    this.onSound?.({ id, priority, flags });
  }

  /** 41151e(id) : arrête un effet. */
  stopSound(id: number): void {
    this.onStopSound?.(id);
  }

  note(text: string): void {
    if (this.log.notes.length < 200) this.log.notes.push(text);
  }

  stub(address: number, part: Part | null): void {
    const key = address.toString(16);
    this.log.stubs.set(key, (this.log.stubs.get(key) ?? 0) + 1);
    void part;
  }

  /** 44b314(anim du type, image) ; hors limites, l'exe laisse le tampon de la pile tel quel : on rend 0 et on le note. */
  frameRect(part: Part): FrameRect {
    const f = this.types.anims[part.type]?.frame(part.frame);
    if (f) return f;
    this.note(`image ${part.frame} hors de l'ANM du type ${part.type}`);
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  /** Appelle le slot `slot` du type de `part` (handler porté, ou souche journalisée). */
  call(slot: number, part: Part, arg?: number | Part | null): number {
    const address = this.types.get(part.type).handlers[slot]!;
    if (address === 0) return 0;
    const entry = this.handlers.get(address);
    if (!entry) {
      this.stub(address, part);
      return stubResult(slot);
    }
    const r = entry.fn(this, part, arg);
    return typeof r === "number" ? r : 0;
  }

  /** Fonction spéciale du noyau (cordes, seaux, lasers) : portée par une famille, ou souche journalisée. */
  special(address: number, part: Part, arg?: unknown): number {
    const s = this.handlers.getSpecial(address);
    if (!s) {
      this.stub(address, part);
      return 0;
    }
    const r = s.fn(this, part, arg);
    return typeof r === "number" ? r : 0;
  }

  /**
   * Types des pièces posées dont un handler de simulation (slots 0, 1, 2, 5) n'est pas porté, ou qui passent par une
   * fonction spéciale non portée (courroies, cordes, seaux, lasers). Vide : la trace du niveau doit être exacte.
   */
  unportedTypes(): number[] {
    const SPECIAL: Record<number, number> = { 8: 0x438c70, 10: 0x438db6, 76: 0x438db6, 17: 0x43518f, 108: 0x43518f, 91: 0x43d013, 92: 0x43d013, 93: 0x43d013, 95: 0x43d013 };
    const out = new Set<number>();
    for (const p of this.staticThenMobile()) {
      const d = this.types.get(p.type);
      if ([0, 1, 2, 5].some((s) => d.handlers[s] !== 0 && !this.handlers.has(d.handlers[s]!))) out.add(p.type);
      const special = SPECIAL[p.type];
      if (special !== undefined && !this.handlers.has(special)) out.add(p.type);
      if (p.ropes[0] && !this.handlers.has(0x43a31d)) out.add(p.type);
    }
    return [...out].sort((a, b) => a - b);
  }

  /** Charge un niveau et met la machine en position de départ (pas 0 des traces). */
  static load(types: TypeTable, level: Level, handlers?: HandlerRegistry): World {
    const w = new World(types, handlers);
    w.loadLevel(level);
    w.start();
    return w;
  }

  /** 431d3f + suite de 43252d : pièces du LEV, remise à zéro, bac (43267a). */
  loadLevel(level: Level): void {
    this.pressure = s16(level.info.pressure);
    this.gravity = s16(level.info.gravity);
    applyAtmosphere(this.types, this.gravity, this.pressure);
    // 0x480940 : toutes les pièces sont allouées avant la lecture, les liens désignent un index (4316e1).
    const records = [...level.fixedParts, ...level.movingParts];
    const parts = records.map(() => new Part());
    records.forEach((rec, index) => this.addFromLev(rec, parts, index, index < level.fixedParts.length ? this.statics : this.mobiles));
    this.running = false;
    this.reset();
    this.savePrevious();
    this.savePrevious();
    this.stowUnlocked();
  }

  /**
   * 43267a : drapeau 0x8000 partout, puis chaque pièce non verrouillée (mobiles d'abord) part au bac comme si on la
   * retirait dans l'éditeur (42f978, sous 0x4815b0 = 0x1000 et 0x4815b4 = 8) : image 0, retournements défaits (slot 3),
   * boîte du type (432cdb), slots 4 et 2 ; ses cordes, sa courroie, ses branchements et la poulie qu'elle traverse en
   * sont détachés (43925f), les pièces corde et courroie suivent au bac.
   */
  private stowUnlocked(): void {
    for (const list of [this.mobiles, this.statics]) for (const p of list) p.flags0C |= 0x8000;
    for (const list of [this.mobiles, this.statics]) {
      for (;;) {
        let x: Part | null = null;
        for (const p of list) if (!(p.flags14 & PART_LOCKED)) {
          x = p;
          break;
        }
        if (!x) break;
        if (x.type === 7) {
          // La corde qui passe par cette poulie part d'abord (chaîne des poulies vers la pièce qui la tient).
          let rope: Part | null = null;
          let q: Part = x;
          while (!rope && q.type === 7 && q.links[0]) {
            const n: Part = q.links[0];
            if (q === n.links[0]) rope = n.ropes[0]!.ropePart;
            if (q === n.links[1]) rope = n.ropes[1]!.ropePart;
            q = n;
          }
          if (rope) this.remove(rope);
          this.remove(x);
          continue;
        }
        x.frame = x.editFrame = x.type === 0x57 ? x.frame : 0;
        if (x.flags10 & 0x10) this.call(3, x, 1);
        if (x.flags10 & 0x20) this.call(3, x, 2);
        x.editFlags10 = x.flags10;
        const d = this.types.get(x.type);
        x.boxW = d.boxW;
        x.boxH = d.boxH;
        this.call(4, x);
        updateGeometry(this, x);
        this.call(2, x);
        this.remove(x);
      }
    }
  }

  /** 42f978 (0x481194 = `x`) : retire une pièce de l'aire vers le bac, avec ses attaches. */
  private remove(x: Part): void {
    if (x.type === 8) {
      this.detachBelt(x);
    } else if (x.type === 10 || x.type === 0x4c) {
      this.detachRopes(x, true);
    } else if (x.type === 0x16 || x.type === 0x37) {
      const y = x.links[1];
      if (y) {
        y.links[1] = null;
        this.toBin(y);
        this.detachAll(y);
      }
      x.links[1] = null;
      this.toBin(x);
      this.detachAll(x);
    } else {
      this.toBin(x);
      this.detachAll(x);
    }
  }

  /** 4395ba sous 0x4815b4 = 8 et 0x4815b0 = 0x1000 : la pièce quitte sa liste pour le bac (4393be, 4393e0). */
  private toBin(x: Part): void {
    x.flags0C &= ~0x8000;
    x.flags14 &= ~PART_LOCKED;
    if (x.flags0C & F0C.IN_STATIC) this.statics.remove(x);
    else if (x.flags0C & F0C.IN_MOBILE) this.mobiles.remove(x);
    else if (x.flags0C & F0C.IN_BIN) this.bin.remove(x);
    insertSorted(this.bin, x, this.types, false);
  }

  /** 43909c : la courroie `b` lâche ses deux pièces (bit 0x2 de +0x10 effacé), puis part au bac. */
  private detachBelt(b: Part): void {
    const belt = b.belt;
    if (!belt) return;
    for (const end of [belt.end1, belt.end2]) {
      if (!end) continue;
      end.flags10 &= ~2;
      end.editFlags10 = end.flags10;
      end.belt = null;
    }
    belt.end1 = belt.end2 = null;
    if (!(b.flags0C & F0C.IN_BIN)) this.toBin(b);
  }

  /** 4390ff(corde, bouts) : la pièce corde lâche ses bouts (end1 seulement si `both`) et les poulies, puis part au bac. */
  private detachRopes(r: Part, both: boolean): void {
    for (let i = 0; i < 2; i++) {
      const rope = r.ropes[i];
      if (!rope) continue;
      const a = rope.end1;
      if (both && a) {
        rope.end1 = rope.origEnd1 = null;
        a.ropes[rope.slot1 & 1] = null;
        let q = a.links[rope.slot1];
        a.links[2 + rope.slot1] = a.links[rope.slot1] = null;
        while (q && q.type === 7) {
          const n: Part | null = q.links[0];
          q.links[0] = q.links[1] = q.links[2] = q.links[3] = null;
          q.ropes[1] = null;
          q = n;
        }
      }
      const b = rope.end2;
      if (b) {
        b.ropes[rope.slot2 & 1] = null;
        rope.end2 = rope.origEnd2 = null;
        const q = b.links[rope.slot2];
        b.links[2 + rope.slot2] = b.links[rope.slot2] = null;
        if (q && !both) {
          const k = q.links[0] === b ? 0 : q.links[1] === b ? 1 : -1;
          if (k >= 0) q.links[2 + k] = q.links[k] = null;
        }
      }
      if (!(r.flags0C & F0C.IN_BIN)) this.toBin(r);
    }
  }

  /** 43925f : la pièce `x`, rangée au bac, lâche branchements (438fe3), courroie, poulie traversée ou cordes. */
  private detachAll(x: Part): void {
    if (!(x.flags0C & F0C.IN_BIN)) return;
    if (x.flags14 & 3) this.unplug(x);
    if (x.type !== 8 && x.belt) this.detachBelt(x.belt.beltPart);
    if (x.type === 7) {
      const b = x.links[0];
      if (!b) return;
      const e = x.links[1]!;
      const ib = b.links[0] === x ? 0 : b.links[1] === x ? 1 : -1;
      const ie = e.links[0] === x ? 0 : e.links[1] === x ? 1 : -1;
      b.links[2 + ib] = b.links[ib] = e;
      e.links[2 + ie] = e.links[ie] = b;
      // 438b1b (image d'une poulie voisine selon ses brins) : non porté, rare (poulie dans le bac d'un puzzle).
      if (b.type === 7 || e.type === 7) this.stub(0x438b1b, x);
      const r = x.ropes[1];
      if (r) this.redraw(r.ropePart, 2);
      x.links[0] = x.links[1] = x.links[2] = x.links[3] = null;
      x.ropes[1] = null;
      return;
    }
    if (x.type === 10 || x.type === 0x4c) return;
    for (let i = 0; i < 2; i++) {
      const rope = x.ropes[i];
      if (rope) this.detachRopes(rope.ropePart, true);
    }
  }

  /** 438fe3 : débranche la pièce (prises +0xA0/+0xA4 et pièces branchées), slot 2 des deux côtés. */
  private unplug(x: Part): void {
    if (x.flags14 & 2) {
      for (let i = 4; i < 6; i++) {
        const b = x.links[i];
        if (!b) continue;
        x.links[i] = null;
        b.links[4] = null;
        this.call(2, b);
      }
      this.call(2, x);
      x.editFrame = x.frame;
      return;
    }
    const b = x.links[4];
    if (!b) return;
    b.links[4 + (x.fD0 & 0xff)] = null;
    x.links[4] = null;
    this.call(2, x);
    this.call(2, b);
    b.editFrame = b.frame;
  }

  /** Démarrer (435658(1), puis 435ab4 dans 4359a4) : remise à l'état d'édition, compteur d'images à 0. */
  start(): void {
    this.running = true;
    this.reset();
    this.first = null;
    this.frameCounter = 0;
  }

  /** 43173e : pièce d'un enregistrement de LEV (la version ≥ 0x111 de tous les LEV de TIM3 est supposée). */
  private addFromLev(rec: LevPart, parts: Part[], index: number, list: PartList): void {
    const p = parts[index]!;
    const at = (i: number) => (i === -1 ? null : (parts[i] ?? null));
    p.levIndex = index;
    p.type = rec.type;
    if (p.type < TYPE_COUNT) {
      const d = this.types.get(p.type);
      p.flags0C = d.flags0C | (rec.flags1 & 0x8000);
      p.flags10 = d.flags10 | (rec.flags2 & 0x32);
      p.flags14 = rec.flags3 & ~0x10 & 0x140 | d.flags14;
    } else {
      p.flags0C |= F0C.INVALID;
      this.note(`type ${p.type} hors table au chargement`);
    }
    p.editFlags10 = p.flags10;
    p.editFrame = s16(rec.appearance);
    p.editF24 = s16(rec.unknown0A);
    p.frameW = s16(rec.width1);
    p.frameH = s16(rec.height1);
    p.boxW = s16(rec.width2);
    p.boxH = s16(rec.height2);
    p.editX = s16(rec.x);
    p.editY = s16(rec.y);
    const l = levLinks(rec);
    p.fFC = l.behavior;
    p.f88 = l.f88;
    p.f89 = l.f89;
    p.f8C = l.f8C;
    if (l.belt) {
      const b = new BeltData(p);
      p.belt = b;
      b.end1 = at(l.belt[0]);
      b.end2 = at(l.belt[1]);
      if (b.end1) b.end1.belt = b;
      if (b.end2) b.end2.belt = b;
    }
    for (let i = 0; i < 2; i++) {
      p.ropeAnchor[2 * i] = l.anchors[2 * i]!;
      p.ropeAnchor[2 * i + 1] = l.anchors[2 * i + 1]!;
      const r = l.ropes[i];
      if (!r) continue;
      const rope = new RopeData(p);
      p.ropes[i] = rope;
      rope.end1 = rope.origEnd1 = at(r.part1);
      rope.end2 = rope.origEnd2 = at(r.part2);
      rope.slot1 = rope.origSlot1 = r.slot1;
      rope.slot2 = rope.origSlot2 = r.slot2;
      if (rope.end1) rope.end1.ropes[rope.slot1 & 1] = rope;
      if (rope.end2) rope.end2.ropes[rope.slot2 & 1] = rope;
    }
    for (let i = 0; i < 2; i++) p.links[i] = p.links[i + 2] = at(l.links[i]!);
    p.links[4] = at(l.links[2]!);
    p.links[5] = at(l.links[3]!);
    if (p.type === 7 && l.pulleyRope !== undefined) {
      // La corde qui traverse la poulie : celle de la pièce corde, si elle est déjà lue (sinon 43ada7 la pose).
      const r = at(l.pulleyRope);
      if (r) p.ropes[1] = r.ropes[0];
    }
    switch (p.type) {
      case 0x15:
      case 0x1a:
      case 0x26:
      case 0x60:
      case 0x78:
        // 431c15 : côté de branchement (+0xD0) des pièces branchées sur une prise.
        if (p.links[4]) p.links[4].fD0 = 0;
        if (p.links[5]) p.links[5].fD0 = 1;
        break;
      case 0x5b:
      case 0x5c:
      case 0x5d:
      case 0x5f:
      case 0x57:
        // 431c04 : slot 7 (lasers 91–93, mélangeur 95) ; 431b95 : 43baec, slot 7 de la balle programmable.
        this.call(7, p);
        break;
    }
    if (rec.kind === "programmableBall") {
      p.prog = Int32Array.of(s16(rec.density), s16(rec.elasticity), s16(rec.friction), s16(rec.gravityBuoyancy));
      p.mass = s16(rec.mass);
      p.editFrame = s16(rec.appearance2);
    }
    if (p.type < TYPE_COUNT) {
      const d = this.types.get(p.type);
      p.vertexCount = d.vertexCount;
    }
    p.flags10 = p.editFlags10;
    p.frame = p.editFrame;
    p.f24 = p.editF24;
    p.px = p.editX;
    p.py = p.editY;
    updateGeometry(this, p);
    if (p.type < TYPE_COUNT) {
      const d = this.types.get(p.type);
      if (p.vertexCount !== 0 && !d.polygons) p.poly = new Polygon(p.vertexCount);
      this.call(2, p);
    }
    insertSorted(list, p, this.types, true);
  }

  /** 43ada7 : remet chaque pièce posée dans son état d'édition (position, image, drapeaux), puis son slot 2. */
  reset(): void {
    for (const list of [this.statics, this.mobiles]) {
      for (const p of list.toArray()) {
        if (p.flags0C & F0C.INVALID) {
          list.remove(p);
          continue;
        }
        p.flags0C &= ~0xf;
        p.flags10 = p.editFlags10;
        p.flags14 &= ~0x4010;
        p.px = p.prevPx = p.editX;
        p.py = p.prevPy = p.editY;
        p.fx = p.px << 9;
        p.fy = p.py << 9;
        p.frame = p.framePrev = p.framePrev2 = p.editFrame;
        updateGeometry(this, p);
        p.prevDrawX = p.drawX;
        p.prevDrawY = p.drawY;
        p.prevFrameW = p.frameW;
        p.prevFrameH = p.frameH;
        if (p.type !== 0x57) p.mass = this.types.get(p.type).mass;
        p.contact = null;
        p.f24 = p.editF24;
        p.vx = p.vy = 0;
        if (p.type !== 0x1b && p.type !== 0x88 && p.type !== 0x7f) p.fFC = 0;
        p.f100 = p.fFC;
        p.f108 = 0;
        p.f104 = 0;
        if (p.type !== 0x0e && p.type !== 0x56) {
          p.links[0] = p.links[2]!;
          p.links[1] = p.links[3]!;
        }
        this.call(2, p);
        p.editFrame = p.frame;
      }
    }
    // Seconde boucle de 43ada7 : courroies (438c70) et cordes (43af6d : bouts d'édition, 438db6, 43a0dc).
    for (const p of this.staticThenMobile()) {
      if (p.type === 8) this.special(0x438c70, p);
      else if (p.type === 0x0a || p.type === 0x4c) this.special(0x43af6d, p);
    }
  }

  /** 43abff / 43ac4f : la position, l'image et les compteurs courants deviennent ceux « du pas précédent ». */
  savePrevious(): void {
    if (this.first) savePart(this.first, this.running);
    for (const p of this.staticThenMobile()) if (p !== this.first) savePart(p, this.running);
  }
}

/** 43ac4f : état courant → précédent (pièce, puis courroie en édition, corde des types 10, 7 et 76). */
function savePart(p: Part, running: boolean): void {
  p.prevPx = p.px;
  p.prevPy = p.py;
  p.prevDrawX = p.drawX;
  p.prevDrawY = p.drawY;
  p.prevFrameW = p.frameW;
  p.prevFrameH = p.frameH;
  p.framePrev2 = p.framePrev;
  p.framePrev = p.frame;
  if (p.type === 8 && !running && p.belt) p.belt.prevPos.set(p.belt.pos);
  if (p.type === 10 || p.type === 7 || p.type === 0x4c) {
    const r = p.ropes[0];
    if (r) {
      r.n1C = r.n18;
      r.prevEnds.set(r.ends);
    }
  }
  p.f100 = p.fFC;
  p.f108 = p.f104;
}

/** Nœud de la liste auxiliaire 0x4815f8 (12 octets : suivant, pièce, effort). */
export interface AuxNode {
  part: Part;
  force: number;
}

interface LevLinks {
  /** +0x18 de l'enregistrement → +0xFC. */
  behavior: number;
  f88: number;
  f89: number;
  f8C: number;
  /** Index des deux pièces d'une courroie, si l'enregistrement en porte une. */
  belt: [number, number] | null;
  /** Ancrages {x0, y0, x1, y1} → +0xB0 … +0xB3. */
  anchors: number[];
  ropes: ({ part1: number; part2: number; slot1: number; slot2: number } | null)[];
  /** Pièces liées → +0x90/+0x98, +0x94/+0x9C, +0xA0, +0xA4. */
  links: number[];
  /** Poulie (7) : index de la pièce corde qui la traverse. */
  pulleyRope?: number;
}

const lo = (v: number) => s8(v & 0xff);
const hi = (v: number) => s8((v >> 8) & 0xff);

/**
 * Suite générique d'un enregistrement de LEV telle que 43173e la lit : u16 courroie, 2 × u8, i16 ; [courroie : 2 × i16] ;
 * 2 × { u16 corde, 2 × u8 ancrage ; [corde : 2 × i16 pièces, 2 × u8 emplacements] } ; 4 × i16 liens ; [poulie : i16].
 * `data/lev.ts` nomme ces champs selon la forme fixe de chaque type (vérifiée sur tous les LEV : seules les cordes ont
 * leur corde en 0, les poulies aussi, les courroies leur courroie).
 */
function levLinks(rec: LevPart): LevLinks {
  switch (rec.kind) {
    case "default":
    case "programmableBall":
      return {
        behavior: s16(rec.behavior),
        f88: s8(rec.beltAnchorX),
        f89: s8(rec.beltAnchorY),
        f8C: s16(rec.beltLineDistance),
        belt: null,
        anchors: [s8(rec.rope1AnchorX), s8(rec.rope1AnchorY), s8(rec.rope2AnchorX), s8(rec.rope2AnchorY)],
        ropes: [null, null],
        links: [rec.connected1, rec.connected2, rec.plugged1, rec.plugged2],
      };
    case "rope":
      return {
        behavior: s16(rec.segmentLength),
        f88: lo(rec.unknown1C),
        f89: hi(rec.unknown1C),
        f8C: s16(rec.unknown1E),
        belt: null,
        anchors: [lo(rec.unknown22), hi(rec.unknown22), lo(rec.unknown2C), hi(rec.unknown2C)],
        ropes: [{ part1: rec.ropePart1, part2: rec.ropePart2, slot1: s8(rec.ropeEnd1Usage), slot2: s8(rec.ropeEnd2Usage) }, null],
        links: [rec.connected1, rec.connected2, rec.plugged1, rec.plugged2],
      };
    case "belt":
      return {
        behavior: s16(rec.unknown18),
        f88: lo(rec.unknown1C),
        f89: hi(rec.unknown1C),
        f8C: s16(rec.unknown1E),
        belt: [rec.beltPart1, rec.beltPart2],
        anchors: [lo(rec.unknown26), hi(rec.unknown26), lo(rec.unknown2A), hi(rec.unknown2A)],
        ropes: [null, null],
        links: [rec.connected1, rec.connected2, rec.plugged1, rec.plugged2],
      };
    case "pulley":
      return {
        behavior: s16(rec.unknown18),
        f88: lo(rec.unknown1C),
        f89: hi(rec.unknown1C),
        f8C: s16(rec.unknown1E),
        belt: null,
        anchors: [s8(rec.rope1AnchorX), s8(rec.rope1AnchorY), s8(rec.rope2AnchorX), s8(rec.rope2AnchorY)],
        ropes: [{ part1: s16(rec.unknown24), part2: s16(rec.unknown26), slot1: lo(rec.unknown28), slot2: hi(rec.unknown28) }, null],
        links: [rec.pulleyPart1, rec.pulleyPart2, rec.unknown32, rec.unknown34],
        pulleyRope: rec.ropeIndex,
      };
  }
}
