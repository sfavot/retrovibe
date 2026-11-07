/**
 * Trait du trajet qui se colore dans les transitions des cartes (`XFER`, régions 1 à 4) : portage de `11b0:24ed` (dessin de la feature `SCRB` fond + 200),
 * `11b0:1fcd` (préparation), `11b0:214d` et `11b0:2350` (remplissage), `11b0:26ec` (tick), lus dans les octets du segment 11b0 (hors corpus Ghidra).
 *
 * Original :
 *  - la feature fond + 200 (délai 4, `11b0:00c4`) ne garde qu'une de ses quatre parties, le trait noir du tronçon de l'étape atteinte (`11b0:2406`, `DS:ad38`) ;
 *  - à chaque échéance (`26ec` redemande le dessin toutes les 4 ticks), `24ed` :
 *    - la première fois (`DS:ad3a` = 0), `1fcd` repeint dans l'image (en mémoire) les pixels d'indice 1 et 2 du trait avec les deux couleurs « avant » de la clé
 *      du niveau atteint (`DS:ad2e`), compte ces pixels (`DS:ad3e`) et sème le remplissage au point de départ du tronçon (table `DS:4220`) ;
 *    - les fois suivantes, `214d(ad3a)` étend un remplissage de proche en proche (8 voisins, 24 fronts au plus) qui passe les pixels « avant » aux couleurs
 *      « après », jusqu'à ce qu'il n'en reste plus que `n − n × ad3a / 1000` ;
 *    - puis `ad3a += 7` (1000 au plus) : le trait se colore depuis le lieu de départ en 143 étapes (≈ 570 ticks), du noir vers le vert au premier
 *      passage, puis d'une couleur de niveau à la suivante.
 * Couleurs (indices de palette, `24ed`) selon `ad2e` : 2 → 0x30, 0x31 puis 0x32, 0x33 ; 3 → 0x32, 0x33 puis 0x34, 0x35 ; 4 → 0x34, 0x35 puis 0x36, 0x37 ; sinon
 * 0x2e, 0x2f puis 0x30, 0x31.
 *
 * Écart : l'original lit et écrit hors de l'image quand un voisin sort du tampon (abscisse −1 = dernier pixel de la ligne précédente, conservé ici ; ligne −1 :
 * mémoire voisine, ignorée ici).
 */
import type { Shape } from "../../../data/mohawk/shap";

/** `DS:4220` : point de départ du remplissage dans l'image de chaque partie, par région 1 à 4 puis partie 1 à 4 (lu dans le segment de données). */
export const TRAIL_STARTS: readonly (readonly [number, number])[] = [
  [3, 105], [130, 146], [1, 2], [6, 60],
  [42, 194], [1, 106], [1, 1], [1, 4],
  [1, 1], [1, 1], [1, 53], [102, 162],
  [1, 12], [57, 154], [1, 1], [2, 109],
];

/** Délai de la feature (`11b0:00c4` : 4) : un dessin, donc une étape, toutes les 4 ticks (`11b0:26ec`). */
export const TRAIL_DELAY = 4;
/** Progression ajoutée à chaque dessin (`ad3a += 7`) et plafond (`0x3e8`). */
export const TRAIL_STEP = 7;
export const TRAIL_FULL = 1000;
/** Nombre de fronts du remplissage (`DS:adb2`, 24 octets). */
const FRONTS = 24;
/** Indices du trait noir dans l'image (`1fcd` : arguments 1 et 2). */
const SOURCE = [1, 2] as const;

/** Couleurs « avant » (2) puis « après » (2) d'après le niveau atteint `ad2e` (`11b0:24ed`). */
export function trailColors(value: number): readonly [number, number, number, number] {
  switch (value) {
    case 2:
      return [0x30, 0x31, 0x32, 0x33];
    case 3:
      return [0x32, 0x33, 0x34, 0x35];
    case 4:
      return [0x34, 0x35, 0x36, 0x37];
    default:
      return [0x2e, 0x2f, 0x30, 0x31];
  }
}

/** Index de `TRAIL_STARTS` (`24ed` : `(région − 1) × 4 + ad38 − 1`, 0 hors de 0 à 15). */
export function trailStartIndex(region: number, keep: number): number {
  const index = (region - 1) * 4 + keep - 1;
  return index >= 0 && index <= 15 ? index : 0;
}

/** Remplissage d'un trait (copie de l'image de la partie gardée ; l'original modifie l'image chargée, rechargée à chaque entrée). */
export class TrailColoring {
  /** L'image à dessiner, modifiée au fil du remplissage. */
  readonly shape: Shape;
  private readonly pixels: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  private readonly before: readonly [number, number];
  private readonly after: readonly [number, number];
  private readonly start: readonly [number, number];
  private readonly active = new Uint8Array(FRONTS);
  private readonly xs = new Int32Array(FRONTS);
  private readonly ys = new Int32Array(FRONTS);
  /** `DS:ad3e` : pixels du trait. */
  private total = 0;
  /** `DS:ad42` : pixels encore « avant ». */
  private remaining = 0;
  /** `DS:ad3a`. */
  private progress = 0;

  constructor(source: Shape, start: readonly [number, number], value: number) {
    this.pixels = source.pixels.slice();
    this.shape = { ...source, pixels: this.pixels };
    this.width = source.width;
    this.height = source.height;
    const [b0, b1, a0, a1] = trailColors(value);
    this.before = [b0, b1];
    this.after = [a0, a1];
    this.start = start;
  }

  /** Pixels du trait (0 avant la préparation). */
  get count(): number {
    return this.total;
  }

  /** Pixels encore à colorer. */
  get left(): number {
    return this.remaining;
  }

  /** Un dessin de la feature (`24ed`) : préparation au premier, une étape de remplissage ensuite. */
  step(): void {
    if (this.progress === 0) this.prepare();
    else this.grow(this.progress);
    this.progress = Math.min(TRAIL_FULL, this.progress + TRAIL_STEP);
  }

  /** `11b0:1fcd`. */
  private prepare(): void {
    this.active.fill(0);
    let count = 0;
    const [source0, source1] = SOURCE;
    for (let i = 0; i < this.pixels.length; i++) {
      const p = this.pixels[i]!;
      if (p === source0) {
        count++;
        this.pixels[i] = this.before[0];
      }
      if (p === source1) {
        count++;
        this.pixels[i] = this.before[1];
      }
    }
    this.total = count;
    this.remaining = count;
    let [x, y] = this.start;
    if (this.width < x) x = this.width - 1;
    if (this.height < y) y = this.height - 1;
    this.active[0] = 1;
    this.xs[0] = x;
    this.ys[0] = y;
  }

  /** `11b0:214d` : étend le remplissage jusqu'à ce qu'il ne reste que `n − n × progress / 1000` pixels « avant ». */
  private grow(progress: number): void {
    const target = this.total - Math.floor((this.total * progress) / TRAIL_FULL);
    while (target < this.remaining) {
      const before = this.remaining;
      for (let i = 0; i < FRONTS; i++) {
        if (!this.active[i]) continue;
        this.active[i] = 0;
        const x = this.xs[i]!;
        const y = this.ys[i]!;
        if (y + 1 < this.height) {
          this.visit(x, y + 1);
          this.visit(x - 1, y + 1);
          if (x + 1 < this.width) this.visit(x + 1, y + 1);
        }
        // `lVar5 != 1` : la ligne 0 n'est pas atteinte depuis la ligne 1 (défaut de l'original, reproduit).
        if (y !== 1) {
          this.visit(x, y - 1);
          this.visit(x - 1, y - 1);
          if (x + 1 < this.width) this.visit(x + 1, y - 1);
        }
        this.visit(x - 1, y);
        if (x + 1 < this.width) this.visit(x + 1, y);
      }
      if (before === this.remaining) this.remaining = 0;
    }
  }

  /** `11b0:2350` : un voisin « avant » prend la couleur « après » et devient un front, s'il en reste un de libre. */
  private visit(x: number, y: number): void {
    const index = y * this.width + x;
    if (index < 0 || index >= this.pixels.length) return;
    const p = this.pixels[index]!;
    const k = p === this.before[0] ? 0 : p === this.before[1] ? 1 : null;
    if (k === null) return;
    const slot = this.active.indexOf(0);
    if (slot < 0) return;
    this.xs[slot] = x;
    this.ys[slot] = y;
    this.active[slot] = 1;
    if (this.remaining !== 0) this.remaining--;
    this.pixels[index] = this.after[k];
  }
}
