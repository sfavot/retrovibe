/**
 * Description d'une pièce : `INFO.ITF` (ouverture 420c14, procédure 420cc9, clics 420f77).
 *
 * - IN_PART (22010, décor 17) : `INFO<type>.ANM` en boucle sur toute sa séquence, une image par passe de la boucle des contrôles
 *   (rappels 42109a / 421043, drapeau 1 : au plus une toutes les 50 ms) ; origine = centre de la zone moins la moitié de l'image 0,
 *   chaque image décalée de son propre x, y ; sans fichier (types 41, 49, 72, 110 à 115…), la zone reste vide.
 * - IN_TITLE (valeur 31162 → 162) : nom de la pièce ; IN_TEXT (11161 → 161) : description de `INFO.RES` (4215b1).
 * - Défilement : si le texte tient, ▲ et ▼ sont cachés ; sinon IN_TEXT et son cadre (22007) perdent 27 pixels de large. ▼ (420ff7)
 *   avance d'une page tant qu'il reste des lignes, ▲ (420faf) revient du dernier pas.
 * - OK (22005) et Échap ferment ; Entrée = OK (450d44). Le son 0xE1B de l'ouverture est joué par l'appelant (41ea91, 42e979).
 */
import type { Anm } from "../data/anm";
import { readItf, type Itf } from "../data/itf";
import type { PartInfo } from "../data/text";
import { drawAnmImage, imageCount, imageFrame } from "../render/anm-draw";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { layoutItf, itfOrigin } from "../render/itf-draw";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost } from "./itf-window";

export const INFO = { text: 22014, up: 22013, down: 22012, title: 22011, part: 22010, textBox: 22007, done: 22005 } as const;
/** Largeur rendue aux flèches quand le texte défile (420d07). */
const SCROLL_BAR = 27;

/** Image courante de l'animation d'une pièce (42109a) et son dessin (421043). */
export class PartAnimation {
  frame = 0;
  private first = true;

  constructor(readonly anm: Anm | null) {}

  /** Une passe : image suivante, en boucle ; vrai s'il faut redessiner. */
  step(): boolean {
    if (!this.anm) return false;
    if (this.first) {
      this.first = false;
      return false;
    }
    const count = imageCount(this.anm);
    this.frame = this.frame + 1 < count ? this.frame + 1 : 0;
    return count > 1;
  }

  draw(surface: Surface, assets: RenderAssets, r: Rect): void {
    const f0 = this.anm ? imageFrame(this.anm, 0) : null;
    if (!this.anm || !f0) return;
    const clip = surface.setClip(r.x, r.y, r.width, r.height);
    drawAnmImage(surface, assets, this.anm, this.frame, r.x + Math.trunc((r.width - f0.width) / 2), r.y + Math.trunc((r.height - f0.height) / 2));
    surface.restoreClip(clip);
  }
}

/** Fenêtre sans DOM (tests, rendu) : ITF et options. */
export function infoWindow(assets: RenderAssets, itf: Itf, type: number, info: PartInfo | undefined): { itf: Itf; options: ItfWindowOptions } {
  const animation = new PartAnimation(assets.anm(`INFO${type}.ANM`));
  const scroll: Record<number, number> = { [INFO.text]: 0 };
  const state: NonNullable<ItfWindowOptions["state"]> = {
    texts: { [INFO.title]: info?.name ?? "", [INFO.text]: info?.description ?? "" },
    scroll,
    draw: { [INFO.part]: (s, r) => animation.draw(s, assets, r) },
  };
  // 420d07 : mesure du texte à l'ouverture.
  const measure = (): { visible: number; total: number } => layoutItf(assets, itf, { ...state, ...itfOrigin(itf) }).items.find((i) => i.id === INFO.text)?.lines ?? { visible: 0, total: 0 };
  let lines = measure();
  if (lines.total <= lines.visible) state.hidden = [INFO.up, INFO.down];
  else {
    const narrow = (id: number) => {
      const c = itf.controls.find((k) => k.id === id);
      return c ? { width: c.width - SCROLL_BAR } : {};
    };
    state.moved = { [INFO.text]: narrow(INFO.text), [INFO.textBox]: narrow(INFO.textBox) };
    lines = measure();
  }
  let lastStep = 0;
  return {
    itf,
    options: {
      title: info?.name ?? copy.partInfoTitle,
      state,
      defaultId: INFO.done,
      cancelId: INFO.done,
      labels: { [INFO.up]: copy.scrollUp, [INFO.down]: copy.scrollDown },
      tick: () => animation.step(),
      choose: (id) => {
        const skipped = scroll[INFO.text]!;
        if (id === INFO.down) {
          if (lines.total - lines.visible > skipped) {
            scroll[INFO.text] = skipped + lines.visible;
            lastStep = lines.visible;
          }
          return true;
        }
        if (id === INFO.up) {
          if (skipped !== 0) scroll[INFO.text] = Math.max(0, skipped - lastStep);
          return true;
        }
        return false;
      },
    },
  };
}

/** Ouvre la description de la pièce de type `type`. */
export function openInfoWindow(host: ItfHost, type: number, info: PartInfo | undefined, onClose?: () => void): ItfWindowHandle {
  const w = infoWindow(host.assets, readItf(host.assets.index.get("INFO.ITF")), type, info);
  return openItfWindow(host, w.itf, { ...w.options, ...(onClose ? { onClose } : {}) });
}
