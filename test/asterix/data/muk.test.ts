import { describe, expect, it } from "vitest";
import { parseMuk } from "../../../src/games/asterix/data/muk";

/** Les MUK d'origine ne sont pas versionnés (convertis en `.vid`) : le lecteur est testé sur un fichier de synthèse. */
function build(): Uint8Array {
  const palette = new Uint8Array(768).map((_, i) => (i * 7) & 0xff);
  const payload = Uint8Array.of(6, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0xaa, 0xbb, 0xcc);
  const bytes = new Uint8Array(3 + 1 + 768 + 9 + payload.length);
  const view = new DataView(bytes.buffer);
  let pos = 0;
  bytes[pos++] = 0;
  view.setUint16(pos, 0x1234, true);
  pos += 2;
  bytes[pos++] = 1;
  bytes.set(palette, pos);
  pos += 768;
  bytes[pos++] = 2;
  view.setUint32(pos, payload.length, true);
  view.setUint32(pos + 4, 0xcafe, true);
  pos += 8;
  bytes.set(payload, pos);
  return bytes;
}

describe("parseMuk", () => {
  it("découpe les trois types d'enregistrement jusqu'au dernier octet", () => {
    const records = parseMuk(build());
    expect(records.map((r) => r.type)).toEqual(["value", "palette", "video"]);
    expect(records[0]).toEqual({ type: "value", value: 0x1234 });
    const palette = records[1];
    expect(palette.type === "palette" && palette.palette.length === 768 && palette.palette[3] === 21).toBe(true);
    const video = records[2];
    expect(video.type === "video" && video.field).toBe(0xcafe);
    expect(video.type === "video" && [...video.payload.subarray(13)]).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it("accepte un fichier vide", () => {
    expect(parseMuk(new Uint8Array(0))).toEqual([]);
  });

  it("refuse un type inconnu ou un enregistrement tronqué", () => {
    const bytes = build();
    expect(() => parseMuk(Uint8Array.of(3))).toThrow("type 3 inconnu à l'offset 0");
    expect(() => parseMuk(bytes.subarray(0, 2))).toThrow("enregistrement 0 tronqué");
    expect(() => parseMuk(bytes.subarray(0, 100))).toThrow("palette tronqué");
    expect(() => parseMuk(bytes.subarray(0, 3 + 769 + 5))).toThrow("enregistrement 2 tronqué");
    expect(() => parseMuk(bytes.subarray(0, bytes.length - 1))).toThrow("bloc vidéo tronqué");
  });
});
