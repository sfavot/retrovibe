/** Lecture minimale de fichiers MIDI standard (format 0/1) en une liste de notes absolues. */

export interface MidiNote {
  /** Début et durée en secondes. */
  time: number;
  duration: number;
  key: number;
  velocity: number;
  channel: number;
  program: number;
}

interface RawEvent {
  tick: number;
  type: "on" | "off" | "tempo" | "program";
  channel: number;
  key: number;
  velocity: number;
  value: number;
}

export function parseMidi(buffer: ArrayBuffer): MidiNote[] {
  const view = new DataView(buffer);
  let p = 0;
  const tag = () => String.fromCharCode(view.getUint8(p++), view.getUint8(p++), view.getUint8(p++), view.getUint8(p++));
  if (tag() !== "MThd") throw new Error("Fichier MIDI invalide");
  const headerLength = view.getUint32(p);
  p += 4;
  const trackCount = view.getUint16(p + 2);
  const division = view.getUint16(p + 4);
  p += headerLength;

  const events: RawEvent[] = [];
  for (let t = 0; t < trackCount && p < view.byteLength; t++) {
    if (tag() !== "MTrk") break;
    const length = view.getUint32(p);
    p += 4;
    const end = p + length;
    let tick = 0;
    let status = 0;
    const varLen = () => {
      let v = 0;
      for (;;) {
        const b = view.getUint8(p++);
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
    };
    while (p < end) {
      tick += varLen();
      let b = view.getUint8(p);
      if (b & 0x80) {
        status = b;
        p++;
      }
      b = status;
      const kind = b & 0xf0;
      const channel = b & 0x0f;
      if (b === 0xff) {
        const meta = view.getUint8(p++);
        const len = varLen();
        if (meta === 0x51 && len === 3) {
          const value = (view.getUint8(p) << 16) | (view.getUint8(p + 1) << 8) | view.getUint8(p + 2);
          events.push({ tick, type: "tempo", channel: 0, key: 0, velocity: 0, value });
        }
        p += len;
        if (meta === 0x2f) break;
      } else if (b === 0xf0 || b === 0xf7) {
        p += varLen();
      } else if (kind === 0x90 || kind === 0x80) {
        const key = view.getUint8(p++);
        const velocity = view.getUint8(p++);
        const on = kind === 0x90 && velocity > 0;
        events.push({ tick, type: on ? "on" : "off", channel, key, velocity, value: 0 });
      } else if (kind === 0xc0) {
        events.push({ tick, type: "program", channel, key: 0, velocity: 0, value: view.getUint8(p++) });
      } else if (kind === 0xd0) {
        p += 1;
      } else {
        p += 2;
      }
    }
    p = end;
  }

  events.sort((a, b) => a.tick - b.tick);
  const notes: MidiNote[] = [];
  const open = new Map<string, MidiNote>();
  const programs = new Array(16).fill(0);
  let tempo = 500000;
  let lastTick = 0;
  let time = 0;
  for (const e of events) {
    time += ((e.tick - lastTick) * tempo) / division / 1e6;
    lastTick = e.tick;
    if (e.type === "tempo") tempo = e.value;
    else if (e.type === "program") programs[e.channel] = e.value;
    else if (e.type === "on") {
      const id = `${e.channel}:${e.key}`;
      // Une note rejouée sans avoir été relâchée termine la précédente.
      const previous = open.get(id);
      if (previous) previous.duration = Math.max(0.03, time - previous.time);
      const note = { time, duration: 0, key: e.key, velocity: e.velocity, channel: e.channel, program: programs[e.channel] };
      open.set(id, note);
      notes.push(note);
    } else {
      const id = `${e.channel}:${e.key}`;
      const note = open.get(id);
      if (note) {
        note.duration = Math.max(0.03, time - note.time);
        open.delete(id);
      }
    }
  }
  for (const note of open.values()) note.duration = 0.3;
  return notes;
}
