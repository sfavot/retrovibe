import { describe, expect, it } from "vitest";
import { C_ACTION_MODE, C_SP_COLOR, C_STAND_UP, C_TURN_TABLE, CompactField as F, MegaSetField, NEXT_MEGA_SET, megaSetBase } from "../../../src/games/bass/data/compact-fields";
import { Compacts } from "../../../src/games/bass/engine/compacts";
import { Cpt, GAME_VERSION } from "../../../src/games/bass/engine/ids";
import { parseSaveWords } from "../../../src/games/bass/engine/save-data";
import { hasOriginalFiles, skyCpt } from "../data/helpers";

describe.skipIf(!hasOriginalFiles)("compacts du moteur (SkyCompact)", () => {
  const fresh = () => new Compacts(skyCpt());

  it("fetch : vue sur les données, null pour 0xFFFF ou un emplacement vide, RangeError hors des listes", () => {
    const c = fresh();
    const foster = c.require(Cpt.FOSTER);
    expect(foster.buffer).toBe(c.raw.buffer);
    expect(c.fetch(0xffff)).toBeNull();
    expect(c.fetch(0)).toBeNull();
    expect(() => c.fetch(9 << 12)).toThrow(RangeError);
    expect(c.info(Cpt.FOSTER).size).toBe(111);
    expect(c.isId(foster, Cpt.FOSTER)).toBe(true);
    expect(c.isId(foster, Cpt.JOEY)).toBe(false);
  });

  it("les données sont une copie : le SkyCpt partagé n'est pas modifié", () => {
    const c = fresh();
    const before = skyCpt().get(Cpt.FOSTER)!.data[F.xcood];
    c.require(Cpt.FOSTER)[F.xcood] = 1234;
    expect(skyCpt().get(Cpt.FOSTER)!.data[F.xcood]).toBe(before);
  });

  it("un alias désigne les mêmes données que sa cible", () => {
    const c = fresh();
    const [alias, target] = skyCpt().aliasPairs.find(([, t]) => skyCpt().get(t))!;
    expect(c.require(alias).byteOffset).toBe(c.require(target).byteOffset);
    expect(c.isId(c.require(alias), target)).toBe(true);
  });

  it("une vue court au-delà du compact, comme un pointeur Compact * (compacts contigus)", () => {
    const c = fresh();
    const joey = c.require(Cpt.JOEY);
    const size = c.info(Cpt.JOEY).size;
    // Le compact 2 (s'il existe) suit Joey ; sinon le compact non vide suivant dans la liste 0.
    let next = 2;
    while (!c.fetch(next)) next++;
    expect(joey[size]).toBe(c.require(next)[0]);
  });

  it("getElem / setElem par décalage DOS : compact, MegaSet, table de rotation, enroulement 16 bits", () => {
    const c = fresh();
    const foster = c.require(Cpt.FOSTER);
    expect(c.getElem(foster, C_ACTION_MODE)).toBe(foster[F.sync]);
    expect(c.getElem(foster, C_SP_COLOR)).toBe(foster[F.spColor]);
    expect(c.getElem(foster, C_STAND_UP)).toBe(foster[megaSetBase(0) + MegaSetField.standUpId]);
    expect(c.getElem(foster, C_STAND_UP + NEXT_MEGA_SET)).toBe(foster[megaSetBase(1) + MegaSetField.standUpId]);
    const turnTable = c.require(foster[megaSetBase(0) + MegaSetField.turnTableId]!);
    expect(c.getElem(foster, C_TURN_TABLE)).toBe(turnTable[0]);
    expect(c.getElem(foster, C_TURN_TABLE + 4)).toBe(turnTable[1]);
    c.setElem(foster, 14, 0x12345); // xcood : décalage DOS 14 (getToTableId occupe 4 octets)
    expect(foster[F.xcood]).toBe(0x2345);
    // Milieu d'un champ de 4 octets : premier mot (logic), comme compactOffsets de ScummVM.
    expect(c.getElem(foster, 12)).toBe(foster[F.logic]);
    expect(() => c.getElem(foster, 690)).toThrow(RangeError);
  });

  it("getSub / setSub par mode (0 à 14), erreur sinon ; MegaSet et tables de rotation", () => {
    const c = fresh();
    const foster = c.require(Cpt.FOSTER);
    c.setSub(foster, 4, 77);
    c.setSub(foster, 6, 78);
    expect([foster[F.actionSub], foster[F.actionSub_off]]).toEqual([77, 78]);
    expect(c.getSub(foster, 14)).toBe(foster[F.extraSub_off]);
    expect(() => c.getSub(foster, 16)).toThrow(/mode/);
    expect(() => c.getSub(foster, 3)).toThrow(/mode/);
    expect(c.turnTable(foster, 0)).toHaveLength(5);
    expect(() => c.turnTable(foster, 5)).toThrow();
    foster[F.megaSet] = 7;
    expect(() => c.megaSetWordBase(foster)).toThrow(/MegaSet/);
  });

  it("état de sauvegarde : les données de remise à zéro se chargent et se relisent à l'identique", () => {
    const c = fresh();
    const reset = skyCpt().createResetData(GAME_VERSION);
    const data = parseSaveWords(reset, c.saveWords);
    expect(data.header.revision).toBe(6);
    expect(data.header.size).toBe(reset.length * 2);
    expect(c.loadSaveWords(data.compactWords, 0)).toBe(c.saveWords);
    expect(c.saveState()).toEqual(data.compactWords);
    expect(() => parseSaveWords(reset.subarray(0, reset.length - 1), c.saveWords)).toThrow(/Restore failed/);
  });
});
