/**
 * Noyau, groupe « palette » : `Palette` (`SetFromResource`, `SetFade`, `FindColor`), `PalVary`, `PalCycle`, `RemapColors`.
 *
 * Référence : `engines/sci/engine/kgraphics32.cpp` de ScummVM (`kPaletteSetFromResource32`, `kPaletteSetFade`,
 * `kPaletteFindColor32`, `kPalVarySetVary` et suivantes, `kPalCycleSetCycle` et suivantes, `kRemapColorsOff`,
 * `kRemapColorsByRange`, `kRemapColorsByPercent`) et `kernel_tables.h` (numéros des sous-fonctions), GPL v3 ou ultérieure,
 * lus puis réécrits. Le travail est fait par `render/palette.ts` et `render/remap.ts` ; tout se voit au `FrameOut` suivant.
 *
 * - `Palette(1, numéro)` : fusionne une ressource palette dans la palette du jeu (jamais appelée par les scripts du CD).
 * - `Palette(2, première, dernière, pourcentage)` : fondu des couleurs de `première` à `dernière` comprises.
 * - `Palette(3, r, v, b)` : indice de la couleur de l'écran la plus proche.
 * - `PalVary(0, palette[, secondes[, pourcentage]])` : varie vers cette palette (100 % par défaut, tout de suite sans
 *   durée) ; `(1, secondes, pourcentage)` : nouveau pourcentage visé ; `(2)` : pourcentage courant ; `(3)` : arrêt ;
 *   `(4 | 7 | 8 | 9, palette)` : fusionne ou remplace la palette cible ou la palette de départ, et rend le pourcentage
 *   courant ; `(5, secondes)` : nouvelle durée.
 * - `PalCycle(0, première, dernière, sens, délai)` : cycle de couleurs (sens négatif : à rebours ; délai en ticks) ;
 *   `(1, première[, crans])` : avance tout de suite ; `(4[, première])` : arrête ce cycle, ou tous.
 * - `RemapColors(0[, couleur])` : arrête ce remplacement, ou tous ; `(1, couleur, de, à, delta)` : par plage ;
 *   `(2, couleur, pourcentage)` : par luminosité. Les arguments en trop sont ignorés.
 *
 * Écarts volontaires : une palette absente donne un avertissement (ScummVM s'arrête) ; les pauses de `PalVary` (6) et de
 * `PalCycle` (2, 3) et les remplacements de SCI2.1 (3 à 5), jamais appelés, sont signalés et sans effet.
 */
import { ResourceType } from "../../data/ids";
import { type Palette, readPalette } from "../../data/palette";
import { frameoutOf } from "../../render/frameout";
import { PalCycleOp, PaletteOp, PalVaryOp, RemapOp, VARY_FULL } from "../../render/ids";
import { TICKS_PER_SECOND } from "../ids";
import { fromInt, NULL_REG, type Reg, toSint16 } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;
const BYTE_MASK = 0xff;

function palette(vm: Vm, argv: Uint32Array): Reg {
  const gamePalette = frameoutOf(vm).palette;
  switch (argv[0]) {
    case PaletteOp.SetFromResource: {
      const resource = loadPalette(vm, argv[1] & WORD_MASK, "Palette");
      if (resource) gamePalette.submit(resource);
      return vm.acc;
    }
    case PaletteOp.SetFade:
      gamePalette.setFade(argv[3] & WORD_MASK, argv[1] & WORD_MASK, argv[2] & WORD_MASK);
      return vm.acc;
    case PaletteOp.FindColor:
      return gamePalette.findColor(argv[1] & BYTE_MASK, argv[2] & BYTE_MASK, argv[3] & BYTE_MASK);
    default:
      vm.warn(`Palette : sous-fonction ${argv[0]} non portée`);
      return NULL_REG;
  }
}

/** Ressource palette `number`, ou `undefined` avec un avertissement. */
function loadPalette(vm: Vm, number: number, caller: string): Palette | undefined {
  const data = vm.resources.find(ResourceType.Palette, number);
  if (!data) vm.warn(`${caller} : palette ${number} absente`);
  return data ? readPalette(data) : undefined;
}

function palVary(vm: Vm, argv: Uint32Array): Reg {
  const gamePalette = frameoutOf(vm).palette;
  const withPalette = (apply: (palette: Palette) => void): Reg => {
    const palette = loadPalette(vm, argv[1] & WORD_MASK, "PalVary");
    if (palette) apply(palette);
    return fromInt(gamePalette.varyPercent);
  };
  switch (argv[0]) {
    case PalVaryOp.SetVary: {
      const ticks = argv.length > 2 ? toSint16(argv[2]) * TICKS_PER_SECOND : 0;
      const percent = argv.length > 3 ? toSint16(argv[3]) : VARY_FULL;
      withPalette((palette) => gamePalette.setVary(palette, percent, ticks));
      return vm.acc;
    }
    case PalVaryOp.SetPercent:
      gamePalette.setVaryPercent(argv.length > 2 ? toSint16(argv[2]) : 0, argv.length > 1 ? toSint16(argv[1]) * TICKS_PER_SECOND : 0);
      return vm.acc;
    case PalVaryOp.GetPercent:
      return fromInt(gamePalette.varyPercent);
    case PalVaryOp.Off:
      gamePalette.varyOff();
      return vm.acc;
    case PalVaryOp.MergeTarget:
      return withPalette((palette) => gamePalette.mergeVaryTarget(palette));
    case PalVaryOp.SetTime:
      gamePalette.setVaryDuration(toSint16(argv[1]) * TICKS_PER_SECOND);
      return vm.acc;
    case PalVaryOp.SetTarget:
      return withPalette((palette) => gamePalette.setVaryTarget(palette));
    case PalVaryOp.SetStart:
      return withPalette((palette) => gamePalette.setVaryStart(palette));
    case PalVaryOp.MergeStart:
      return withPalette((palette) => gamePalette.mergeVaryStart(palette));
    default:
      vm.warn(`PalVary : sous-fonction ${argv[0]} non portée`);
      return vm.acc;
  }
}

function palCycle(vm: Vm, argv: Uint32Array): Reg {
  const gamePalette = frameoutOf(vm).palette;
  switch (argv[0]) {
    case PalCycleOp.SetCycle:
      gamePalette.setCycle(argv[1] & WORD_MASK, argv[2] & WORD_MASK, toSint16(argv[3]), argv.length > 4 ? argv[4] & WORD_MASK : 0);
      break;
    case PalCycleOp.DoCycle:
      gamePalette.doCycle(argv[1] & WORD_MASK, argv.length > 2 ? toSint16(argv[2]) : 1);
      break;
    case PalCycleOp.Off:
      gamePalette.cycleOff(argv.length > 1 ? argv[1] & WORD_MASK : undefined);
      break;
    default:
      vm.warn(`PalCycle : sous-fonction ${argv[0]} non portée`);
  }
  return vm.acc;
}

function remapColors(vm: Vm, argv: Uint32Array): Reg {
  const remap = frameoutOf(vm).remap;
  switch (argv[0]) {
    case RemapOp.Off:
      remap.off(argv.length > 1 ? argv[1] & BYTE_MASK : 0);
      break;
    case RemapOp.ByRange:
      remap.byRange(argv[1] & BYTE_MASK, toSint16(argv[2]), toSint16(argv[3]), toSint16(argv[4]));
      break;
    case RemapOp.ByPercent:
      remap.byPercent(argv[1] & BYTE_MASK, toSint16(argv[2]));
      break;
    default:
      vm.warn(`RemapColors : sous-fonction ${argv[0]} non portée`);
  }
  return vm.acc;
}

export function registerPaletteKernel(kernel: Kernel): void {
  kernel.register("Palette", palette).register("PalVary", palVary).register("PalCycle", palCycle).register("RemapColors", remapColors);
}
