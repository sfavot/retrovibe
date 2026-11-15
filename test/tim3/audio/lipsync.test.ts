import { describe, expect, it } from "vitest";
import {
  GESTURE_STATES,
  MOUTH_STATES,
  REST_POSE,
  mouthAt,
  parseLipSync,
  parseLipSyncJson,
} from "../../../src/games/tim3/audio/lipsync";
import { original } from "../data/real";

/** Octets `sync` : u32 142, mot initial, paires (instant, valeur), fin 0xFFFF. */
function sync(initial: number, pairs: [number, number][], terminator = true): Uint8Array {
  const out = new Uint8Array(6 + 4 * pairs.length + (terminator ? 2 : 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, 142, true);
  view.setUint16(4, initial, true);
  pairs.forEach(([t, v], i) => {
    view.setUint16(6 + 4 * i, t, true);
    view.setInt16(8 + 4 * i, v, true);
  });
  if (terminator) view.setUint16(6 + 4 * pairs.length, 0xffff, true);
  return out;
}

describe("synchro labiale", () => {
  it("lit les paires (instant, valeur) jusqu'au mot 0xFFFF", () => {
    const s = parseLipSync(sync(11, [[2, 5], [9, 9], [17, -1]]));
    expect(s.initial).toBe(11);
    expect(s.events).toEqual([
      { tick: 2, value: 5 },
      { tick: 9, value: 9 },
      { tick: 17, value: -1 },
    ]);
  });

  it("refuse un en-tête inattendu et des instants décroissants", () => {
    const bad = sync(0, [[1, 1]]);
    new DataView(bad.buffer).setUint32(0, 7, true);
    expect(() => parseLipSync(bad)).toThrow(/en-tête/);
    expect(() => parseLipSync(sync(0, [[9, 1], [3, 2]]))).toThrow(/décroissants/);
    expect(() => parseLipSync(new Uint8Array(3))).toThrow();
  });

  it("ouvre la bouche d'après la valeur 0 à 15, au soixantième de seconde, un évènement agissant quand l'instant le dépasse", () => {
    const s = parseLipSync(sync(0, [[6, 5], [30, 9], [60, -1]]));
    expect(mouthAt(s, 0)).toBe(REST_POSE);
    // 6 soixantièmes = 100 ms : l'évènement ne s'applique que strictement après
    expect(mouthAt(s, 100).viseme).toBe(0);
    expect(mouthAt(s, 117).viseme).toBe(5);
    expect(mouthAt(s, 117).mouthState).toBe(MOUTH_STATES[5]);
    expect(mouthAt(s, 600).viseme).toBe(9);
    // dernier évènement (-1) : fin de la parole, bouche au repos
    expect(mouthAt(s, 1100)).toEqual({ ...REST_POSE });
  });

  it("garde le geste 16 à 26 jusqu'au repos, ignore les valeurs hors table", () => {
    const s = parseLipSync(sync(0, [[3, 18], [10, 93], [20, 4], [40, 108]]));
    const pose = mouthAt(s, 500);
    expect(pose.gestureState).toBe(GESTURE_STATES[2]);
    expect(pose.gestureStartMs).toBe(50);
    expect(pose.viseme).toBe(4);
    expect(mouthAt(s, 5000).viseme).toBe(4);
  });

  it("rend la pose de repos sans synchro (but, indice)", () => {
    expect(mouthAt(undefined, 1000)).toBe(REST_POSE);
  });

  it("lit un lipsync.json et ignore les entrées illisibles", () => {
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const table = parseLipSyncJson({ help: { "7": b64(sync(1, [[2, 3]])), "8": "AAAA" }, profesor: { "12": b64(sync(0, [])) } });
    expect([...table.keys()].sort()).toEqual(["help/007", "profesor/012"]);
    expect(parseLipSyncJson(null).size).toBe(0);
  });
});

describe.skipIf(!original.has)("synchro labiale des fichiers réels", () => {
  const json = JSON.parse(new TextDecoder().decode(original.read("voices/lipsync.json"))) as Record<string, Record<string, string>>;

  it("se lit pour les 220 entrées de HELP et PROFESOR, instants croissants, valeurs connues", () => {
    const table = parseLipSyncJson(json);
    expect(table.size).toBe(188 + 32);
    const values = new Set<number>();
    for (const sync of table.values()) {
      expect(sync.events.length).toBeGreaterThan(0);
      for (const e of sync.events) values.add(e.value);
      expect(sync.events[sync.events.length - 1].value).toBe(-1);
    }
    for (const v of values) expect(v === -1 || (v >= 0 && v <= 26) || v === 93 || v === 108).toBe(true);
  });

  it("couvre la durée de la voix : le dernier évènement tombe dans la voix, au soixantième de seconde (une seule exception)", () => {
    const table = parseLipSyncJson(json);
    const outliers: string[] = [];
    for (const [key, sync] of table) {
      const mp3 = original.read(`voices/${key}.mp3`);
      const seconds = (mp3.length * 8) / 24000; // 24 kb/s constants
      const last = sync.events[sync.events.length - 1].tick / 60;
      if (last > seconds + 0.2 || last < seconds * 0.3) outliers.push(key);
    }
    // profesor/015 : 9 s de synchro pour 3,4 s de voix (donnée d'origine incohérente, la synchro dépasse simplement la voix)
    expect(outliers).toEqual(["profesor/015"]);
  });
});
