import type { PaletteLoadArgs, PaletteSystem } from "../host";
import type { GraphicsCore } from "./core";

const i16 = (v: number): number => (v << 16) >> 16;

/**
 * Palette VGA 6 bits : o1_palLoad (toutes les sous-commandes), animation de plage (o1_animatePalette /
 * Inter_v2::animPalette) et fondus (PalAnim).
 * `core.wanted` est la palette voulue par le jeu (_vgaPalette), `core.shown` celle qui est affichée.
 */
export class PaletteImpl implements PaletteSystem {
  /** Palettes empilées par la commande 55. */
  private readonly stack: Uint8Array[] = [];
  /** Cible du fondu (PalAnim::_toFade*), 768 octets RGB. */
  private readonly toFade = new Uint8Array(768);
  private fadeValue = 1;

  constructor(private readonly core: GraphicsCore) {}

  async load({ cmd, applyNow, data }: PaletteLoadArgs): Promise<void> {
    const core = this.core;
    const vm = core.vm!;
    const fake = vm.fakeVideoMode;
    const code = cmd & 0x7f;

    // Commandes qui ne concernent pas le mode vidéo courant : données ignorées.
    switch (code) {
      case 48: // palette 16 couleurs EGA
      case 49: // palette CGA/Hercules
        return;
      case 50:
      case 52:
        if (core.colorCount === 256) return;
        break;
      case 51:
        if (fake < 0x64) return;
        break;
      case 53:
        if (core.colorCount !== 256) return;
        break;
      case 54:
      case 61:
        if (fake < 0x13) return;
        break;
    }

    core.applyPal = applyNow;
    const wanted = core.wanted;

    switch (code) {
      case 50: // palette EGA : sans effet sur le rendu indexé
        break;
      case 52:
        wanted.set(data.subarray(0, 48), 0);
        break;
      case 53: {
        const res = vm.resources?.getResource(i16(data[0] | (data[1] << 8)));
        if (res) wanted.set(res.data.subarray(0, 768), 0);
        break;
      }
      case 54:
        wanted.fill(0);
        break;
      case 55:
        this.stack.push(wanted.slice());
        core.applyPal = false;
        return;
      case 56: {
        const first = data[0];
        const count = (data[1] - first + 1) * 3;
        const saved = this.stack.pop();
        if (saved) wanted.set(saved.subarray(first * 3, first * 3 + count), first * 3);
        core.applyPal = true;
        core.setFullPalette();
        core.applyPal = false;
        break;
      }
      case 61: {
        const first = data[0];
        const count = (data[1] - first + 1) * 3;
        const res = vm.resources?.getResource(i16(data[2] | (data[3] << 8)));
        if (!res) break;
        wanted.set(res.data.subarray(first * 3, first * 3 + count), first * 3);
        if (core.applyPal) {
          core.applyPal = false;
          core.setFullPalette();
          return;
        }
        break;
      }
    }

    // Bit 0x80 posé : fondu immédiat vers la palette voulue. Sinon elle est appliquée par blitInvalidated.
    if (!core.applyPal) await this.fade(wanted, 0);
  }

  /** Fait tourner la plage [low, high] d'un cran (la couleur qui sort rentre de l'autre côté). */
  animate(low: number, high: number, direction: 1 | -1): void {
    const pal = this.core.wanted;
    const move = (from: number, to: number): void => {
      pal.copyWithin(to * 3, from * 3, from * 3 + 3);
    };
    const saved = new Uint8Array(3);
    if (direction === -1) {
      saved.set(pal.subarray(low * 3, low * 3 + 3));
      for (let i = low; i < high; i++) move(i + 1, i);
      pal.set(saved, high * 3);
    } else {
      saved.set(pal.subarray(high * 3, high * 3 + 3));
      for (let i = high; i > low; i--) move(i - 1, i);
      pal.set(saved, low * 3);
    }
  }

  commitAnimation(): void {
    this.core.setFullPalette();
  }

  // --- fondus (PalAnim) ---

  /** Fixe la cible d'un fondu (PalAnim::fade avec allColors = -1) ; `null` = noir. */
  prepareFade(target: Uint8Array | null, fadeV: number): void {
    this.fadeValue = fadeV < 0 ? -fadeV : 2;
    const count = this.core.colorCount * 3;
    for (let i = 0; i < count; i++) this.toFade[i] = target ? target[i] : 0;
  }

  /** Un pas de fondu sur toute la palette ; vrai quand la cible est atteinte. */
  fadeStep(): boolean {
    const shown = this.core.shown;
    const count = this.core.colorCount * 3;
    const step = this.fadeValue;
    let stop = true;
    for (let i = 0; i < count; i++) {
      const from = shown[i];
      const to = this.toFade[i];
      const next = from - step > to ? from - step : from + step < to ? from + step : to;
      if (next !== from) {
        shown[i] = next;
        stop = false;
      }
    }
    this.core.touch();
    return stop;
  }

  /** Fondu complet de la palette affichée vers `target` (une image par pas). */
  async fade(target: Uint8Array | null, fadeV: number): Promise<void> {
    const vm = this.core.vm!;
    this.prepareFade(target, fadeV);
    let stop: boolean;
    do {
      stop = this.fadeStep();
      await vm.host.nextFrame();
      if (fadeV > 0) await vm.sleep(fadeV);
    } while (!stop);
    if (target) this.core.setFullPalette();
    else this.core.clearPalette();
  }
}
