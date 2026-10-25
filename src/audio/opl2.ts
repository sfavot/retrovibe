/*
 * Émulateur OPL2 (YM3812) en TypeScript.
 *
 * Port de audio/softsynth/opl/mame.cpp de ScummVM (https://www.scummvm.org), lui-même tiré de
 * « fmopl » de MAME v0.37a modifié par Tatsuyuki Satoh, via AdPlug (LGPL).
 * ScummVM : GPL-3.0-or-later (aussi LGPL-2.1+) ; ce port reprend la logique à l'identique
 * (tables, enveloppes, LFO, rythmes) en qualité « HQ » (ENV_BITS 16, EG_ENT 4096).
 *
 * Écarts volontaires : état porté par l'instance (pas de globales C), tables partagées construites
 * une fois, générateur de bruit blanc déterministe (ScummVM le sème avec l'horloge), pas de
 * timers/IRQ (AdLib ne lit jamais le statut) et pas d'accès par ports (écriture par registre seule).
 */

const CLOCK = 3579545;
const OPL_ARRATE = 141280;
const OPL_DRRATE = 1956000;

const FREQ_BITS = 24;
const FREQ_RATE = 1 << (FREQ_BITS - 20);
const TL_BITS = FREQ_BITS + 2;
const OPL_OUTSB = TL_BITS + 3 - 16;
const OPL_MAXOUT = 0x7fff << OPL_OUTSB;
const OPL_MINOUT = -(0x8000 << OPL_OUTSB);

const SIN_ENT_SHIFT = 11;
const SIN_ENT = 1 << SIN_ENT_SHIFT;

const ENV_BITS = 16;
const EG_ENT = 4096;
const EG_OFF = (2 * EG_ENT) << ENV_BITS;
const EG_DED = EG_OFF;
const EG_DST = EG_ENT << ENV_BITS;
const EG_AED = EG_DST;
const EG_AST = 0;
const EG_STEP = 96.0 / EG_ENT;

const VIB_ENT = 512;
const VIB_SHIFT = 32 - 9;
const AMS_ENT = 512;
const AMS_SHIFT = 32 - 9;
const VIB_RATE_SHIFT = 8;
const VIB_RATE = 1 << VIB_RATE_SHIFT;

const SLOT1 = 0;
const SLOT2 = 1;

// phases de l'enveloppe
const ENV_MOD_RR = 0;
const ENV_MOD_DR = 1;
const ENV_MOD_AR = 2;

const TL_MAX = EG_ENT * 2;

/** Numéro de registre (0x00-0x1f) vers numéro d'opérateur, -1 si inutilisé. */
const SLOT_ARRAY = [
  0, 2, 4, 1, 3, 5, -1, -1, 6, 8, 10, 7, 9, 11, -1, -1, 12, 14, 16, 13, 15, 17, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
];

const KSL_TABLE_SEED = [
  // octave 0
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  // octave 1
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.75, 1.125, 1.5, 1.875, 2.25, 2.625, 3.0,
  // octave 2
  0.0, 0.0, 0.0, 0.0, 0.0, 1.125, 1.875, 2.625, 3.0, 3.75, 4.125, 4.5, 4.875, 5.25, 5.625, 6.0,
  // octave 3
  0.0, 0.0, 0.0, 1.875, 3.0, 4.125, 4.875, 5.625, 6.0, 6.75, 7.125, 7.5, 7.875, 8.25, 8.625, 9.0,
  // octave 4
  0.0, 0.0, 3.0, 4.875, 6.0, 7.125, 7.875, 8.625, 9.0, 9.75, 10.125, 10.5, 10.875, 11.25, 11.625, 12.0,
  // octave 5
  0.0, 3.0, 6.0, 7.875, 9.0, 10.125, 10.875, 11.625, 12.0, 12.75, 13.125, 13.5, 13.875, 14.25, 14.625, 15.0,
  // octave 6
  0.0, 6.0, 9.0, 10.875, 12.0, 13.125, 13.875, 14.625, 15.0, 15.75, 16.125, 16.5, 16.875, 17.25, 17.625, 18.0,
  // octave 7
  0.0, 9.0, 12.0, 13.875, 15.0, 16.125, 16.875, 17.625, 18.0, 18.75, 19.125, 19.5, 19.875, 20.25, 20.625, 21.0,
];

/** Multiplicateurs de fréquence, doublés (1/2, 1, 2, 3 ... 15). */
const MUL_TABLE = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];

// --- Tables partagées (OPLOpenTable / OPLBuildTables) ---------------------------------------

const KSL_TABLE = new Uint32Array(KSL_TABLE_SEED.map((db) => Math.trunc(db / (EG_STEP / 2))));
const SL_TABLE = new Int32Array(
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 31].map(
    (db) => Math.trunc(db * ((3 / EG_STEP) * (1 << ENV_BITS))) + EG_DST,
  ),
);

/** Niveau total -> amplitude ; partie positive puis partie négative. */
const TL_TABLE = new Int32Array(TL_MAX * 2);
/** Onde sinus : décalage dans TL_TABLE, 4 formes d'onde de SIN_ENT entrées. */
const SIN_TABLE = new Int32Array(SIN_ENT * 4);
const AMS_TABLE = new Int32Array(AMS_ENT * 2);
const VIB_TABLE = new Int32Array(VIB_ENT * 2);
/** Compteur d'enveloppe -> niveau de sortie (attaque, puis déclin/relâchement, puis coupé). */
const ENV_CURVE = new Int32Array(2 * EG_ENT + 1);
const RATE_0 = new Int32Array(76);

function buildTables(): void {
  for (let t = 0; t < EG_ENT - 1; t++) {
    const rate = ((1 << TL_BITS) - 1) / Math.pow(10.0, (EG_STEP * t) / 20); // dB -> tension
    TL_TABLE[t] = Math.trunc(rate);
    TL_TABLE[TL_MAX + t] = -TL_TABLE[t];
  }
  // zone coupée : TL_TABLE reste à 0

  // degré 0 = degré 180 = coupé
  SIN_TABLE[0] = SIN_TABLE[SIN_ENT / 2] = EG_ENT - 1;
  for (let s = 1; s <= SIN_ENT / 4; s++) {
    let pom = Math.sin((2 * Math.PI * s) / SIN_ENT);
    pom = 20 * Math.log10(1 / pom); // décibels
    const j = Math.trunc(pom / EG_STEP);
    SIN_TABLE[s] = SIN_TABLE[SIN_ENT / 2 - s] = j; // 0-90 et 180-90 : partie positive
    SIN_TABLE[SIN_ENT / 2 + s] = SIN_TABLE[SIN_ENT - s] = TL_MAX + j; // 180-270 et 360-270 : négative
  }
  for (let s = 0; s < SIN_ENT; s++) {
    SIN_TABLE[SIN_ENT + s] = s < SIN_ENT / 2 ? SIN_TABLE[s] : EG_ENT;
    SIN_TABLE[SIN_ENT * 2 + s] = SIN_TABLE[s % (SIN_ENT / 2)];
    SIN_TABLE[SIN_ENT * 3 + s] = Math.trunc(s / (SIN_ENT / 4)) & 1 ? EG_ENT : SIN_TABLE[SIN_ENT * 2 + s];
  }

  for (let i = 0; i < EG_ENT; i++) {
    const pom = Math.pow((EG_ENT - 1 - i) / EG_ENT, 8) * EG_ENT; // courbe d'attaque
    ENV_CURVE[i] = Math.trunc(pom);
    ENV_CURVE[(EG_DST >> ENV_BITS) + i] = i; // déclin, relâchement
  }
  ENV_CURVE[EG_OFF >> ENV_BITS] = EG_ENT - 1;

  for (let i = 0; i < AMS_ENT; i++) {
    const pom = (1.0 + Math.sin((2 * Math.PI * i) / AMS_ENT)) / 2;
    AMS_TABLE[i] = Math.trunc((1.0 / EG_STEP) * pom); // 1 dB
    AMS_TABLE[AMS_ENT + i] = Math.trunc((4.8 / EG_STEP) * pom); // 4,8 dB
  }
  for (let i = 0; i < VIB_ENT; i++) {
    const pom = VIB_RATE * 0.06 * Math.sin((2 * Math.PI * i) / VIB_ENT);
    VIB_TABLE[i] = Math.trunc(VIB_RATE + pom * 0.07); // +-7 cents
    VIB_TABLE[VIB_ENT + i] = Math.trunc(VIB_RATE + pom * 0.14); // +-14 cents
  }
}
buildTables();

class Slot {
  TL = 0;
  TLL = 0;
  KSR = 0;
  AR: Int32Array = RATE_0;
  DR: Int32Array = RATE_0;
  SL = 0;
  RR: Int32Array = RATE_0;
  ksl = 0;
  ksr = 0;
  mul = 0;
  Cnt = 0;
  Incr = 0;
  eg_typ = 0;
  evm = ENV_MOD_RR;
  evc = 0;
  eve = 0;
  evs = 0;
  evsa = 0;
  evsd = 0;
  evsr = 0;
  ams = 0;
  vib = 0;
  /** Décalage de la forme d'onde dans SIN_TABLE. */
  wavetable = 0;
}

class Channel {
  readonly SLOT = [new Slot(), new Slot()];
  CON = 0;
  FB = 0;
  op1_out = [0, 0];
  block_fnum = 0;
  kcode = 0;
  fc = 0;
  ksl_base = 0;
  keyon = 0;
}

function keyOn(slot: Slot): void {
  slot.Cnt = 0; // redémarrage de l'onde
  slot.evm = ENV_MOD_AR;
  slot.evs = slot.evsa;
  slot.evc = EG_AST;
  slot.eve = EG_AED;
}

function keyOff(slot: Slot): void {
  if (slot.evm > ENV_MOD_RR) {
    // Cas particulier de ScummVM (contournement Kyra) : une note coupée pendant l'attaque initiale
    // saute en bas de la courbe de relâchement.
    if (slot.evm === ENV_MOD_AR && slot.evc === EG_AST) slot.evc = EG_DED;
    else if (!(slot.evc & EG_DST)) slot.evc = EG_DST;
    slot.eve = EG_DED;
    slot.evs = slot.evsr;
    slot.evm = ENV_MOD_RR;
  }
}

export class Opl2 {
  private readonly rate: number;
  private readonly freqbase: number;
  private readonly P_CH: Channel[] = Array.from({ length: 9 }, () => new Channel());
  private readonly arViews: Int32Array[] = [];
  private readonly drViews: Int32Array[] = [];
  private readonly AR_TABLE = new Int32Array(76);
  private readonly DR_TABLE = new Int32Array(76);
  private readonly FN_TABLE = new Uint32Array(1024);
  private rhythm = 0;
  private wavesel = 0;
  private amsTable = 0;
  private vibTable = 0;
  private amsCnt = 0;
  private vibCnt = 0;
  private readonly amsIncr: number;
  private readonly vibIncr: number;
  private rng = 0x6d616d65; // « mame »

  // état d'un échantillon
  private ams = 0;
  private vib = 0;
  private outd = 0;
  private feedback2 = 0;

  constructor(rate: number) {
    this.rate = rate;
    this.freqbase = this.rate ? CLOCK / this.rate / 72 : 0;
    this.initTimeTables();
    for (let fn = 0; fn < 1024; fn++) {
      this.FN_TABLE[fn] = Math.trunc((this.freqbase * fn * FREQ_RATE * (1 << 7)) / 2);
    }
    this.amsIncr = Math.trunc(this.rate ? (((AMS_ENT * (1 << AMS_SHIFT)) / this.rate) * 3.7 * (CLOCK / 3600000)) : 0);
    this.vibIncr = Math.trunc(this.rate ? (((VIB_ENT * (1 << VIB_SHIFT)) / this.rate) * 6.4 * (CLOCK / 3600000)) : 0);
    for (let i = 0; i < 16; i++) {
      this.arViews.push(this.AR_TABLE.subarray(i << 2));
      this.drViews.push(this.DR_TABLE.subarray(i << 2));
    }
    this.reset();
  }

  private initTimeTables(): void {
    for (let i = 4; i <= 60; i++) {
      let rate = this.freqbase;
      if (i < 60) rate *= 1.0 + (i & 3) * 0.25;
      rate *= 1 << ((i >> 2) - 1);
      rate *= EG_ENT << ENV_BITS;
      this.AR_TABLE[i] = Math.trunc(rate / OPL_ARRATE);
      this.DR_TABLE[i] = Math.trunc(rate / OPL_DRRATE);
    }
    for (let i = 60; i < 76; i++) {
      this.AR_TABLE[i] = EG_AED - 1;
      this.DR_TABLE[i] = this.DR_TABLE[60];
    }
  }

  /** OPLResetChip : remet tous les registres à zéro. */
  reset(): void {
    this.wavesel = 0;
    this.writeReg(0x01, 0);
    for (let i = 0xff; i >= 0x20; i--) this.writeReg(i, 0);
    for (const ch of this.P_CH) {
      for (const slot of ch.SLOT) {
        slot.wavetable = 0;
        slot.evc = EG_OFF;
        slot.eve = EG_OFF + 1;
        slot.evs = 0;
      }
    }
  }

  // --- Registres ----------------------------------------------------------------------------

  private calcFcSlot(ch: Channel, slot: Slot): void {
    slot.Incr = (ch.fc * slot.mul) >>> 0;
    const ksr = ch.kcode >> slot.KSR;
    if (slot.ksr !== ksr) {
      slot.ksr = ksr;
      slot.evsa = slot.AR[ksr];
      slot.evsd = slot.DR[ksr];
      slot.evsr = slot.RR[ksr];
    }
    slot.TLL = slot.TL + (ch.ksl_base >> slot.ksl);
  }

  private slotOf(n: number): [Channel, Slot] {
    const ch = this.P_CH[n >> 1];
    return [ch, ch.SLOT[n & 1]];
  }

  private setMul(n: number, v: number): void {
    const [ch, slot] = this.slotOf(n);
    slot.mul = MUL_TABLE[v & 0x0f];
    slot.KSR = v & 0x10 ? 0 : 2;
    slot.eg_typ = (v & 0x20) >> 5;
    slot.vib = v & 0x40;
    slot.ams = v & 0x80;
    this.calcFcSlot(ch, slot);
  }

  private setKslTl(n: number, v: number): void {
    const [ch, slot] = this.slotOf(n);
    const ksl = v >> 6; // 0 / 1,5 / 3 / 6 dB par octave
    slot.ksl = ksl ? 3 - ksl : 31;
    slot.TL = Math.trunc((v & 0x3f) * (0.75 / EG_STEP)); // pas de 0,75 dB
    slot.TLL = slot.TL + (ch.ksl_base >> slot.ksl);
  }

  private setArDr(n: number, v: number): void {
    const [, slot] = this.slotOf(n);
    const ar = v >> 4;
    const dr = v & 0x0f;
    slot.AR = ar ? this.arViews[ar] : RATE_0;
    slot.evsa = slot.AR[slot.ksr];
    if (slot.evm === ENV_MOD_AR) slot.evs = slot.evsa;
    slot.DR = dr ? this.drViews[dr] : RATE_0;
    slot.evsd = slot.DR[slot.ksr];
    if (slot.evm === ENV_MOD_DR) slot.evs = slot.evsd;
  }

  private setSlRr(n: number, v: number): void {
    const [, slot] = this.slotOf(n);
    const sl = v >> 4;
    const rr = v & 0x0f;
    slot.SL = SL_TABLE[sl];
    if (slot.evm === ENV_MOD_DR) slot.eve = slot.SL;
    slot.RR = this.drViews[rr];
    slot.evsr = slot.RR[slot.ksr];
    if (slot.evm === ENV_MOD_RR) slot.evs = slot.evsr;
  }

  /** OPLWriteReg. */
  writeReg(r: number, v: number): void {
    r &= 0xff;
    v &= 0xff;
    const P_CH = this.P_CH;
    switch (r & 0xe0) {
      case 0x00:
        // seul 0x01 (sélection de forme d'onde) compte ; timers et IRQ ne servent à personne ici
        if ((r & 0x1f) === 0x01) {
          this.wavesel = v & 0x20;
          if (!this.wavesel) {
            for (const ch of P_CH) ch.SLOT[SLOT1].wavetable = ch.SLOT[SLOT2].wavetable = 0;
          }
        }
        return;
      case 0x20: {
        const slot = SLOT_ARRAY[r & 0x1f];
        if (slot !== -1) this.setMul(slot, v);
        return;
      }
      case 0x40: {
        const slot = SLOT_ARRAY[r & 0x1f];
        if (slot !== -1) this.setKslTl(slot, v);
        return;
      }
      case 0x60: {
        const slot = SLOT_ARRAY[r & 0x1f];
        if (slot !== -1) this.setArDr(slot, v);
        return;
      }
      case 0x80: {
        const slot = SLOT_ARRAY[r & 0x1f];
        if (slot !== -1) this.setSlRr(slot, v);
        return;
      }
      case 0xa0: {
        if (r === 0xbd) {
          this.writeRhythm(v);
          return;
        }
        // key on, block, fnum
        if ((r & 0x0f) > 8) return;
        const ch = P_CH[r & 0x0f];
        let blockFnum: number;
        if (!(r & 0x10)) {
          blockFnum = (ch.block_fnum & 0x1f00) | v;
        } else {
          const keyon = (v >> 5) & 1;
          blockFnum = ((v & 0x1f) << 8) | (ch.block_fnum & 0xff);
          if (ch.keyon !== keyon) {
            ch.keyon = keyon;
            if (keyon) {
              ch.op1_out[0] = ch.op1_out[1] = 0;
              keyOn(ch.SLOT[SLOT1]);
              keyOn(ch.SLOT[SLOT2]);
            } else {
              keyOff(ch.SLOT[SLOT1]);
              keyOff(ch.SLOT[SLOT2]);
            }
          }
        }
        if (ch.block_fnum !== blockFnum) {
          const blockRv = 7 - (blockFnum >> 10);
          const fnum = blockFnum & 0x3ff;
          ch.block_fnum = blockFnum;
          ch.ksl_base = KSL_TABLE[blockFnum >> 6];
          ch.fc = this.FN_TABLE[fnum] >>> blockRv;
          ch.kcode = ch.block_fnum >> 9;
          this.calcFcSlot(ch, ch.SLOT[SLOT1]);
          this.calcFcSlot(ch, ch.SLOT[SLOT2]);
        }
        return;
      }
      case 0xc0: {
        if ((r & 0x0f) > 8) return;
        const ch = P_CH[r & 0x0f];
        const feedback = (v >> 1) & 7;
        ch.FB = feedback ? 8 + 1 - feedback : 0;
        ch.CON = v & 1;
        return;
      }
      case 0xe0: {
        const slot = SLOT_ARRAY[r & 0x1f];
        if (slot === -1) return;
        if (this.wavesel) P_CH[slot >> 1].SLOT[slot & 1].wavetable = (v & 0x03) * SIN_ENT;
        return;
      }
    }
  }

  /** Registre 0xBD : profondeur AM/vibrato, mode rythme et touches des percussions. */
  private writeRhythm(v: number): void {
    const rkey = this.rhythm ^ v;
    this.amsTable = v & 0x80 ? AMS_ENT : 0;
    this.vibTable = v & 0x40 ? VIB_ENT : 0;
    this.rhythm = v & 0x3f;
    if (!(this.rhythm & 0x20)) return;
    const ch = this.P_CH;
    if (rkey & 0x10) {
      // grosse caisse
      if (v & 0x10) {
        ch[6].op1_out[0] = ch[6].op1_out[1] = 0;
        keyOn(ch[6].SLOT[SLOT1]);
        keyOn(ch[6].SLOT[SLOT2]);
      } else {
        keyOff(ch[6].SLOT[SLOT1]);
        keyOff(ch[6].SLOT[SLOT2]);
      }
    }
    if (rkey & 0x08) (v & 0x08 ? keyOn : keyOff)(ch[7].SLOT[SLOT2]); // caisse claire
    if (rkey & 0x04) (v & 0x04 ? keyOn : keyOff)(ch[8].SLOT[SLOT1]); // tom
    if (rkey & 0x02) (v & 0x02 ? keyOn : keyOff)(ch[8].SLOT[SLOT2]); // cymbale
    if (rkey & 0x01) (v & 0x01 ? keyOn : keyOff)(ch[7].SLOT[SLOT1]); // charleston
  }

  // --- Synthèse -----------------------------------------------------------------------------

  /** OPL_CALC_SLOT : avance l'enveloppe, retourne le niveau de sortie. */
  private calcSlot(slot: Slot): number {
    if ((slot.evc += slot.evs) >= slot.eve) {
      switch (slot.evm) {
        case ENV_MOD_AR: // attaque -> déclin
          slot.evm = ENV_MOD_DR;
          slot.evc = EG_DST;
          slot.eve = slot.SL;
          slot.evs = slot.evsd;
          break;
        case ENV_MOD_DR: // déclin -> sustain ou relâchement
          slot.evc = slot.SL;
          slot.eve = EG_DED;
          if (slot.eg_typ) {
            slot.evs = 0;
          } else {
            slot.evm = ENV_MOD_RR;
            slot.evs = slot.evsr;
          }
          break;
        case ENV_MOD_RR: // relâchement -> coupé
          slot.evc = EG_OFF;
          slot.eve = EG_OFF + 1;
          slot.evs = 0;
          break;
      }
    }
    return slot.TLL + ENV_CURVE[slot.evc >> ENV_BITS] + (slot.ams ? this.ams : 0);
  }

  /** OP_OUT : sortie d'un opérateur pour la phase courante, le niveau d'enveloppe et la modulation. */
  private opOut(slot: Slot, env: number, con: number): number {
    return TL_TABLE[SIN_TABLE[slot.wavetable + (((slot.Cnt + con) >>> (24 - SIN_ENT_SHIFT)) & (SIN_ENT - 1))] + env];
  }

  /** Avance la phase d'un opérateur (vibrato compris). */
  private advance(slot: Slot): void {
    slot.Cnt = (slot.vib ? slot.Cnt + (Math.imul(slot.Incr, this.vib) >>> VIB_RATE_SHIFT) : slot.Cnt + slot.Incr) >>> 0;
  }

  /** OPL_CALC_CH : un canal FM à deux opérateurs. */
  private calcCh(ch: Channel): void {
    this.feedback2 = 0;
    let slot = ch.SLOT[SLOT1];
    let envOut = this.calcSlot(slot);
    if (envOut < EG_ENT - 1) {
      this.advance(slot);
      let out: number;
      if (ch.FB) {
        const feedback1 = (ch.op1_out[0] + ch.op1_out[1]) >> ch.FB;
        ch.op1_out[1] = ch.op1_out[0];
        out = ch.op1_out[0] = this.opOut(slot, envOut, feedback1);
      } else {
        out = this.opOut(slot, envOut, 0);
      }
      if (ch.CON) this.outd += out;
      else this.feedback2 += out;
    } else {
      ch.op1_out[1] = ch.op1_out[0];
      ch.op1_out[0] = 0;
    }
    slot = ch.SLOT[SLOT2];
    envOut = this.calcSlot(slot);
    if (envOut < EG_ENT - 1) {
      this.advance(slot);
      this.outd += this.opOut(slot, envOut, this.feedback2);
    }
  }

  /** OPL_CALC_RH : bloc rythme (canaux 6 à 8). */
  private calcRh(): void {
    const ch = this.P_CH;
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    const whitenoise = (this.rng >>> 31) * (EG_ENT >> 4);
    const vib = this.vib;

    // grosse caisse : deux opérateurs en série, sortie forte
    this.feedback2 = 0;
    let slot = ch[6].SLOT[SLOT1];
    let envOut = this.calcSlot(slot);
    if (envOut < EG_ENT - 1) {
      this.advance(slot);
      if (ch[6].FB) {
        const feedback1 = (ch[6].op1_out[0] + ch[6].op1_out[1]) >> ch[6].FB;
        ch[6].op1_out[1] = ch[6].op1_out[0];
        this.feedback2 = ch[6].op1_out[0] = this.opOut(slot, envOut, feedback1);
      } else {
        this.feedback2 = this.opOut(slot, envOut, 0);
      }
    } else {
      this.feedback2 = 0;
      ch[6].op1_out[1] = ch[6].op1_out[0];
      ch[6].op1_out[0] = 0;
    }
    slot = ch[6].SLOT[SLOT2];
    envOut = this.calcSlot(slot);
    if (envOut < EG_ENT - 1) {
      this.advance(slot);
      this.outd += this.opOut(slot, envOut, this.feedback2) * 2;
    }

    const slot71 = ch[7].SLOT[SLOT1];
    const slot72 = ch[7].SLOT[SLOT2];
    const slot81 = ch[8].SLOT[SLOT1];
    const slot82 = ch[8].SLOT[SLOT2];
    const envSd = this.calcSlot(slot72) + whitenoise;
    const envTam = this.calcSlot(slot81);
    const envTop = this.calcSlot(slot82);
    const envHh = this.calcSlot(slot71) + whitenoise;

    // phases
    slot71.Cnt = (slot71.vib ? slot71.Cnt + (Math.imul(slot71.Incr, vib) >>> (VIB_RATE_SHIFT - 1)) : slot71.Cnt + 2 * slot71.Incr) >>> 0;
    slot72.Cnt = (slot72.vib ? slot72.Cnt + (Math.imul(ch[7].fc, vib) >>> (VIB_RATE_SHIFT - 3)) : slot72.Cnt + ch[7].fc * 8) >>> 0;
    this.advance(slot81);
    slot82.Cnt = (slot82.vib ? slot82.Cnt + (Math.imul(ch[8].fc * 3, vib) >>> (VIB_RATE_SHIFT - 4)) : slot82.Cnt + ch[8].fc * 48) >>> 0;

    const tone8 = this.opOut(slot82, whitenoise, 0);
    if (envSd < EG_ENT - 1) this.outd += this.opOut(slot71, envSd, 0) * 8; // caisse claire
    if (envTam < EG_ENT - 1) this.outd += this.opOut(slot81, envTam, 0) * 2; // tom
    if (envTop < EG_ENT - 1) this.outd += this.opOut(slot72, envTop, tone8) * 2; // cymbale
    if (envHh < EG_ENT - 1) this.outd += this.opOut(slot72, envHh, tone8) * 2; // charleston
  }

  /** YM3812UpdateOne : écrit `length` échantillons 16 bits mono dans `buffer` à partir de `offset`. */
  generate(buffer: Int16Array, offset: number, length: number): void {
    let amsCnt = this.amsCnt;
    let vibCnt = this.vibCnt;
    const rhythm = this.rhythm & 0x20;
    const channels = rhythm ? 6 : 9;
    for (let i = 0; i < length; i++) {
      amsCnt = (amsCnt + this.amsIncr) >>> 0;
      vibCnt = (vibCnt + this.vibIncr) >>> 0;
      this.ams = AMS_TABLE[this.amsTable + (amsCnt >>> AMS_SHIFT)];
      this.vib = VIB_TABLE[this.vibTable + (vibCnt >>> VIB_SHIFT)];
      this.outd = 0;
      for (let c = 0; c < channels; c++) this.calcCh(this.P_CH[c]);
      if (rhythm) this.calcRh();
      const data = Math.min(Math.max(this.outd, OPL_MINOUT), OPL_MAXOUT);
      buffer[offset + i] = data >> OPL_OUTSB;
    }
    this.amsCnt = amsCnt;
    this.vibCnt = vibCnt;
  }
}
