import { describe, expect, it } from "vitest";
import type { SlotSummary } from "../../../src/engine/save-slots";
import {
  SAVE_SCREEN,
  SlotScreen,
  VOLUME_WELLS,
  barRect,
  fitGameText,
  levelAtY,
  levelToPercent,
  mixedVolume,
  percentRect,
  percentToLevel,
  rowTextY,
  shortDate,
  slotRowHeight,
} from "../../../src/games/drascula/ui/native-screens";
import { fontSheet, saveScreenArt, volumeArt } from "../../../src/games/drascula/ui/native-dialogs";
import { TextColor, textColorRgb } from "../../../src/games/drascula/render/palette";
import { hasOriginalFiles } from "../helpers";
import { Player } from "../engine/test-host";

const empty = (slot: number): SlotSummary => ({ slot, empty: true, description: `Emplacement ${slot}`, savedAt: null });
const full = (slot: number, savedAt: number): SlotSummary => ({ slot, empty: false, description: `Partie ${slot}`, savedAt });

describe("écrans d'origine de Drascula : géométrie", () => {
  it("place un rectangle de l'écran en pourcentages de 320 x 200", () => {
    expect(percentRect({ x: 0, y: 0, width: 320, height: 200 })).toEqual({ left: "0%", top: "0%", width: "100%", height: "100%" });
    expect(percentRect(SAVE_SCREEN.save)).toEqual({ left: "65%", top: "61.5%", width: "23.125%", height: "13%" });
    expect(percentRect({ x: 1, y: 1, width: 3, height: 3 })).toEqual({ left: "0.3125%", top: "0.5%", width: "0.9375%", height: "1.5%" });
  });

  it("barre du volume : `y = 72 + 61 - v * 4`, hauteur `2 + v * 4`, posée sur le bas du puits (ligne 135)", () => {
    expect(barRect(82, 0)).toEqual({ x: 82, y: 133, width: 39, height: 2 });
    expect(barRect(194, 15)).toEqual({ x: 194, y: 73, width: 39, height: 62 });
    for (const level of [0, 7, 15]) {
      const bar = barRect(138, level);
      expect(bar.y + bar.height).toBe(135);
    }
    expect(VOLUME_WELLS.map((well) => well.barX)).toEqual([82, 138, 194]);
    for (const { well } of VOLUME_WELLS) {
      expect(well.y).toBeLessThanOrEqual(barRect(0, 15).y);
      expect(well.y + well.height).toBe(136);
    }
  });

  it("le pointeur dans un puits donne le cran dont la barre arrive à sa hauteur, borné de 0 à 15", () => {
    expect(levelAtY(133)).toBe(0);
    expect(levelAtY(140)).toBe(0);
    expect(levelAtY(73)).toBe(15);
    expect(levelAtY(10)).toBe(15);
    for (let level = 0; level <= 15; level++) expect(levelAtY(barRect(0, level).y)).toBe(level);
  });

  it("hauteur des lignes : 9 à la souris ; au doigt, au moins 36 px à l'écran, de 9 à 18 pixels du jeu", () => {
    expect(slotRowHeight(1.1, false)).toBe(9);
    expect(slotRowHeight(1.1, true)).toBe(18);
    expect(slotRowHeight(3, true)).toBe(12);
    expect(slotRowHeight(4, true)).toBe(9);
    expect(slotRowHeight(0, true)).toBe(9);
    expect(rowTextY(9)).toBe(1);
    expect(rowTextY(18)).toBe(6);
  });
});

describe("écrans d'origine de Drascula : volume", () => {
  it("crans de 0 à 15 <-> pourcentages enregistrés de 0 à 100", () => {
    expect(levelToPercent(0)).toBe(0);
    expect(levelToPercent(15)).toBe(100);
    expect(levelToPercent(8)).toBe(53);
    expect(levelToPercent(20)).toBe(100);
    expect(percentToLevel(100)).toBe(15);
    expect(percentToLevel(0)).toBe(0);
    expect(percentToLevel(50)).toBe(8);
    expect(percentToLevel(250)).toBe(15);
    expect(percentToLevel(Number.NaN)).toBe(15);
    for (let level = 0; level <= 15; level++) expect(percentToLevel(levelToPercent(level))).toBe(level);
  });

  it("le volume général multiplie le réglage", () => {
    expect(mixedVolume(1, 0.4)).toBe(0.4);
    expect(mixedVolume(0.5, 0.5)).toBe(0.25);
    expect(mixedVolume(0, 1)).toBe(0);
    expect(mixedVolume(2, 0.5)).toBe(0.5);
  });
});

describe("écrans d'origine de Drascula : textes en police du jeu", () => {
  const supports = (char: string): boolean => /^[A-Z0-9 .,:\-/?()É]$/.test(char);

  it("tirets longs ramenés à `-`, accents ôtés s'ils manquent, inconnus en espace, coupé à la longueur", () => {
    expect(fitGameText("CH.2 – 15/11/26 14:30", supports, 22)).toBe("CH.2 - 15/11/26 14:30");
    expect(fitGameText("ÉCHEC À L'ÉGLISE", supports, 22)).toBe("ÉCHEC A L ÉGLISE");
    expect(fitGameText("LA CHAMBRE DE LA CHAPELLE", supports, 21)).toBe("LA CHAMBRE DE LA CHAP");
    expect(fitGameText("ABC  ", supports, 10)).toBe("ABC");
  });

  it("date courte à l'heure locale", () => {
    expect(shortDate(new Date(2026, 10, 5, 9, 7).getTime())).toBe("05/11/26 09:07");
  });
});

describe("écran des sauvegardes : déroulé", () => {
  const summaries = (): SlotSummary[] => [full(1, 100), empty(2), full(3, 300), ...[4, 5, 6, 7, 8, 9, 10].map(empty)];

  it("premier choix : sauvegarder vise le premier vide, charger la plus récente", () => {
    expect(new SlotScreen(summaries(), "save", true).selected).toBe(2);
    expect(new SlotScreen(summaries(), "load", true).selected).toBe(3);
    expect(new SlotScreen([1, 2].map(empty), "load", true).selected).toBe(1);
    expect(new SlotScreen([full(1, 1), full(2, 2)], "save", true).selected).toBe(1);
  });

  it("sauvegarder sur un vide : tout de suite ; sur un plein : un second appui confirme ; changer d'emplacement annule", () => {
    const screen = new SlotScreen(summaries(), "save", true);
    expect(screen.pressSave()).toEqual({ type: "save", slot: 2 });
    screen.select(3);
    expect(screen.pressSave()).toEqual({ type: "none" });
    expect(screen.message).toBe("confirm");
    screen.select(1);
    expect(screen.message).toBeNull();
    expect(screen.pressSave()).toEqual({ type: "none" });
    expect(screen.pressSave()).toEqual({ type: "save", slot: 1 });
    expect(screen.confirming).toBe(false);
  });

  it("charger : refusé sur un vide (le dire), possible sur un plein ; charger annule une confirmation en attente", () => {
    const screen = new SlotScreen(summaries(), "load", true);
    screen.select(2);
    expect(screen.loadEnabled).toBe(false);
    expect(screen.pressLoad()).toEqual({ type: "none" });
    expect(screen.message).toBe("empty");
    screen.select(1);
    expect(screen.pressSave()).toEqual({ type: "none" });
    expect(screen.pressLoad()).toEqual({ type: "load", slot: 1 });
    expect(screen.confirming).toBe(false);
  });

  it("pendant une séquence, sauvegarder est refusé et l'écran le dit dès l'ouverture ; charger reste possible", () => {
    const screen = new SlotScreen(summaries(), "save", false);
    expect(screen.message).toBe("cannotSave");
    expect(screen.saveEnabled).toBe(false);
    expect(screen.pressSave()).toEqual({ type: "none" });
    screen.select(3);
    expect(screen.pressLoad()).toEqual({ type: "load", slot: 3 });
    expect(new SlotScreen(summaries(), "load", false).message).toBeNull();
  });

  it("Entrée fait l'action d'ouverture ; les flèches restent dans la liste", () => {
    const screen = new SlotScreen(summaries(), "load", true);
    expect(screen.activate()).toEqual({ type: "load", slot: 3 });
    screen.move("first");
    screen.move("previous");
    expect(screen.selected).toBe(1);
    screen.move("last");
    screen.move("next");
    expect(screen.selected).toBe(10);
    screen.move("previous");
    expect(screen.selected).toBe(9);
  });

  it("chargement qui attend : plus rien ne répond ; un échec reste dans l'écran avec son message", () => {
    const screen = new SlotScreen(summaries(), "load", true);
    screen.startBusy();
    expect(screen.message).toBe("busy");
    expect(screen.pressLoad()).toEqual({ type: "none" });
    screen.select(1);
    expect(screen.selected).toBe(3);
    screen.finish("load", { ok: false, message: "Cette sauvegarde ne peut pas être chargée." }, summaries());
    expect(screen.busy).toBe(false);
    expect(screen.message).toBe("loadFailed");
    expect(screen.detail).toBe("Cette sauvegarde ne peut pas être chargée.");
    screen.select(1);
    expect(screen.message).toBeNull();
    expect(screen.detail).toBeNull();
  });
});

describe.skipIf(!hasOriginalFiles)("écrans d'origine de Drascula : images tirées des fichiers du jeu", () => {
  it("écran des sauvegardes : `SAVESCR.ALG` en `HALF_PAL` (128 couleurs de l'image, le reste du jeu), texte vert clair", () => {
    const player = new Player({ chapter: 1 });
    const gfx = player.engine.gfx;
    const art = saveScreenArt(gfx);
    const image = gfx.image("savescr.alg");
    expect(art.pixels).toBe(image.pixels);
    expect([...art.palette.subarray(0, 128 * 3)]).toEqual([...image.palette.subarray(0, 128 * 3)].map((value) => value & 0xfc));
    expect([...art.palette.subarray(200 * 3, 201 * 3)]).toEqual([...gfx.palette.game.subarray(200 * 3, 201 * 3)].map((value) => (value & 0xff) * 4));
    expect([...art.palette.subarray(254 * 3, 255 * 3)]).toEqual(textColorRgb(TextColor.LightGreen));
  });

  it("volume : la pièce sans curseur dans la palette affichée ; le panneau vient de `95.ALG`", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const art = volumeArt(player.engine.gfx, player.engine.state);
    expect(art.pixels).toHaveLength(320 * 200);
    expect(art.palette).toEqual(player.engine.gfx.palette.shown);
    const sheet = fontSheet(player.engine.gfx);
    // Les puits du panneau sont noirs (0), le cadre gris (158).
    expect(sheet.at(VOLUME_WELLS[0].well.x - 73 + 1 + 5, 100 - 63 + 56)).toBe(0);
    expect(sheet.at(1 + 2, 56 + 2)).toBe(158);
  });
});
