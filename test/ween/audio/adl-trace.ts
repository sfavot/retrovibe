import { vi, type MockInstance } from "vitest";
import { parseExtTable, readExtResource } from "../../../src/engine/coktel/data/ext";
import { AdlPlayer } from "../../../src/engine/coktel/audio/adlib/adl-player";
import { AdLib } from "../../../src/engine/coktel/audio/adlib/adlib";
import { Opl2 } from "../../../src/audio/opl2";
import { entry } from "../helpers";

/** Les six musiques de `ADL.EXT` (ressources 30000 à 30005 d'`ADL.TOT`), décompressées. */
export function weenAdls(): Uint8Array[] {
  const file = entry("ADL.EXT");
  return parseExtTable(file).map((item) => readExtResource(file, item, entry("COMMUN.EX1")).data);
}

/** Un événement de voix du lecteur, à l'indice de tick (`onTimer`) où il a lieu. */
export type VoiceEvent = string;

/**
 * Lecture de `ADLPlayer::pollMusic` (`sound/adlplayer.cpp`) et de `AdLib::onTimer` (`sound/adlib.cpp:170-214`) refaite à
 * part, sans le code du portage : suite des commandes de voix de la première passe, par tick, et tick de fin (celui du
 * marqueur 0xFF ou de la fin des données). Après un délai `d` > 0 la commande suivante tombe `d + 1` ticks plus loin
 * (le compteur `_toPoll` est décrémenté à chaque tick avant d'être relu), à `d` = 0 dans le même tick.
 */
export function referenceTrace(adl: Uint8Array): { events: VoiceEvent[]; endTick: number; timbres: number; mode: number } {
  const mode = adl[0];
  const timbres = adl[1] + 1;
  const songStart = 3 + timbres * 56;
  const song = adl.subarray(songStart);
  const at = (i: number) => song[i] ?? 0;
  const current = new Array<number>(11).fill(0);
  let modify = 0xff;
  let pos = 0;
  let tick = 0;
  let first = true;
  const events: VoiceEvent[] = [];
  const log = (s: string) => events.push(`${tick} ${s}`);

  for (;;) {
    if (pos >= song.length) return { events, endTick: tick, timbres, mode };
    if (first) pos += at(pos) & 0x80 ? 2 : 1;
    first = false;
    const cmd = at(pos++);
    if (cmd === 0xff) return { events, endTick: tick, timbres, mode };
    if (cmd === 0xfe) modify = at(pos++);
    if (cmd >= 0xd0) {
      pos += 2;
      for (let i = 0; i < 11; i++) if (current[i] === modify) log(`ins ${i} ${modify}`);
    } else {
      const voice = cmd & 0x0f;
      switch (cmd & 0xf0) {
        case 0x00:
          log(`vol ${voice} ${at(pos + 1)}`);
          log(`on ${voice} ${at(pos)}`);
          pos += 2;
          break;
        case 0xa0:
          log(`bend ${voice} ${at(pos++) << 7}`);
          break;
        case 0xb0:
          log(`vol ${voice} ${at(pos++)}`);
          break;
        case 0xc0: {
          const ins = at(pos++);
          log(`ins ${voice} ${ins}`);
          if (voice < 11 && ins < timbres) current[voice] = ins;
          break;
        }
        case 0x90:
          log(`on ${voice} ${at(pos++)}`);
          break;
        case 0x80:
          log(`off ${voice}`);
          break;
        default:
          return { events, endTick: tick, timbres, mode }; // commande inconnue : arrêt
      }
    }
    let delay = at(pos++);
    if (delay & 0x80) delay = ((delay & 3) << 8) | at(pos++);
    if (delay > 0) tick += delay + 1;
  }
}

export interface PlayerTrace {
  /** Commandes de voix reçues par le lecteur (hors `rewind`), par tick. */
  events: VoiceEvent[];
  /** Écritures de registres OPL : `tick reg val`, y compris celles de `rewind` et de `reset`. */
  writes: string[];
  /** Ticks (`onTimer`) où le lecteur a signalé la fin du morceau. */
  finishedAt: number[];
  /** Nombre de ticks joués. */
  ticks: number;
  playing: boolean;
}

export const TRACE_RATE = 48_000;

/**
 * Joue `data` dans le lecteur commun (`AdlPlayer` sur `Opl2`), `passes` passages (`repeat` = passages supplémentaires,
 * négatif = boucle infinie) ou au plus `maxTicks` ticks, et note les commandes de voix et les écritures OPL. La synthèse
 * elle-même (`Opl2.generate`) est neutralisée : seul le séquenceur nous intéresse ici.
 */
export function tracePlayer(data: Uint8Array, repeat: number, maxTicks: number): PlayerTrace {
  const events: VoiceEvent[] = [];
  const writes: string[] = [];
  const finishedAt: number[] = [];
  let tick = -1;
  const spies: MockInstance[] = [vi.spyOn(Opl2.prototype, "generate").mockImplementation(() => {})];
  try {
    const proto = AdLib.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const wrap = (name: string, fn: (...a: unknown[]) => void) => {
      const original = proto[name];
      spies.push(
        vi.spyOn(proto, name).mockImplementation(function (this: unknown, ...a: unknown[]) {
          fn(...a);
          return original.apply(this, a);
        }),
      );
    };
    const log = (s: string) => {
      if (tick >= 0) events.push(`${tick} ${s}`);
    };
    wrap("onTimer", () => void tick++);
    wrap("noteOn", (v, n) => log(`on ${v} ${n}`));
    wrap("setVoiceVolume", (v, x) => log(`vol ${v} ${x}`));
    wrap("bendVoicePitch", (v, x) => log(`bend ${v} ${x}`));
    const original = Opl2.prototype.writeReg;
    spies.push(
      vi.spyOn(Opl2.prototype, "writeReg").mockImplementation(function (this: Opl2, reg: number, val: number) {
        writes.push(`${tick} ${reg} ${val}`);
        return original.call(this, reg, val);
      }),
    );

    const player = new AdlPlayer(TRACE_RATE);
    const playerProto = AdlPlayer.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const originalIns = playerProto.setInstrument;
    spies.push(
      vi.spyOn(playerProto, "setInstrument").mockImplementation(function (this: unknown, ...a: unknown[]) {
        log(`ins ${a[0]} ${a[1]}`);
        return originalIns.apply(this, a);
      }),
    );
    player.onFinished = () => finishedAt.push(tick);
    // noteOff du séquenceur (commande 0x80) ; reset() / allOff() éteignent aussi les voix, sans passer par une commande.
    const originalOff = proto.noteOff;
    spies.push(
      vi.spyOn(proto, "noteOff").mockImplementation(function (this: unknown, ...a: unknown[]) {
        if (!new Error().stack!.includes("allOff")) log(`off ${a[0]}`);
        return originalOff.apply(this, a);
      }),
    );
    player.load(data);
    player.setRepeating(repeat);
    player.startPlay();
    const buf = new Float32Array(TRACE_RATE / 100);
    while (player.isPlaying() && tick < maxTicks) player.render(buf, 0, buf.length);
    return { events, writes, finishedAt, ticks: tick + 1, playing: player.isPlaying() };
  } finally {
    for (const s of spies) s.mockRestore();
  }
}
