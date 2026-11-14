/**
 * Séquences plein écran compressées par différence (« flirt » : bandes dessinées de l'introduction et scènes animées).
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::startSequence`, `Screen::processSequence`), GPL v3 ou ultérieure.
 *
 * Format : un octet `n` (nombre d'images), puis `n` images. Une image est une suite de « sauts » et de « copies » appliquée à l'écran
 * 320 x 192 courant (l'image précédente, ou l'image de fond d'un `SHOWSCREEN`), en ordre de lecture, jusqu'à ce que la position atteigne
 * `320 * 192` :
 * - saut : un octet `k` ajouté à la position, répété tant que `k == 0xFF` ;
 * - copie : un octet `m`, puis `m` pixels recopiés à la position ; si `m == 0xFF`, une nouvelle copie suit immédiatement (sans nouveau saut).
 * Une image se termine donc exactement à l'octet qui complète la position `61 440` ; les images suivent sans séparateur.
 *
 * Cadence du moteur : une image toutes les 60 ms (`nextFrame += 60`). Variante d'un compact (`startSequenceItem`) : même format, mais le
 * nombre d'images lu est `data[0] - 1`.
 *
 * Écarts volontaires : toute lecture hors des données ou toute écriture au-delà de l'écran lève une erreur (ScummVM lit et écrit au-delà
 * sans le dire) ; le décodeur est pur, il ne touche ni l'écran réel, ni l'horloge, ni les rectangles à recopier à l'hôte, il rend seulement
 * la grille des blocs de 16 x 16 modifiés (`_seqGrid`, 20 x 12) pour qui voudrait ne recopier que ces blocs.
 */

const GAME_SCREEN_WIDTH = 320;
const GAME_SCREEN_HEIGHT = 192;

/** Pixels de l'écran qu'une image de séquence parcourt (`GAME_SCREEN_WIDTH * GAME_SCREEN_HEIGHT`, soit 192 lignes). */
export const SEQUENCE_PIXELS = GAME_SCREEN_WIDTH * GAME_SCREEN_HEIGHT;
export const SEQUENCE_GRID_COLUMNS = 20;
export const SEQUENCE_GRID_ROWS = 12;
/** Intervalle entre deux images (ms). */
export const SEQUENCE_FRAME_MS = 60;

export interface SequenceFrameResult {
  /** Position de lecture dans le fichier après l'image. */
  readonly next: number;
  /** Blocs de 16 x 16 touchés (12 lignes de 20), 1 si touché. */
  readonly dirty: Uint8Array;
}

/**
 * Applique à `screen` (au moins `SEQUENCE_PIXELS` octets, normalement 320 x 200) l'image de séquence qui commence à `pos` dans `data` ;
 * rend la position suivante. Reproduit `processSequence`, y compris le calcul de la grille.
 */
export function decodeSequenceFrame(data: Uint8Array, pos: number, screen: Uint8Array): SequenceFrameResult {
  if (screen.length < SEQUENCE_PIXELS) throw new RangeError("séquence : écran trop petit");
  const dirty = new Uint8Array(SEQUENCE_GRID_COLUMNS * SEQUENCE_GRID_ROWS);
  const lastBlock = SEQUENCE_GRID_COLUMNS * SEQUENCE_GRID_ROWS - 1;
  const read = (): number => {
    if (pos >= data.length) throw new Error("séquence invalide : lecture après la fin des données");
    return data[pos++]!;
  };
  const blockOf = (screenPos: number): number =>
    Math.min(Math.floor(screenPos / (GAME_SCREEN_WIDTH * 16)) * SEQUENCE_GRID_COLUMNS + ((screenPos % GAME_SCREEN_WIDTH) >> 4), lastBlock) & 0xff;

  let screenPos = 0;
  do {
    let toSkip: number;
    do {
      toSkip = read();
      screenPos += toSkip;
    } while (toSkip === 0xff);

    let toDo: number;
    do {
      toDo = read();
      const first = blockOf(screenPos);
      const last = blockOf(screenPos + toDo);
      if (last >= first) {
        for (let b = first; b <= last; b++) dirty[b] = 1;
      } else {
        for (let b = first; b < Math.floor(first / SEQUENCE_GRID_COLUMNS + 1) * SEQUENCE_GRID_COLUMNS; b++) dirty[b] = 1;
        for (let b = Math.floor(last / SEQUENCE_GRID_COLUMNS) * SEQUENCE_GRID_COLUMNS; b <= last; b++) dirty[b] = 1;
      }
      if (pos + toDo > data.length) throw new Error("séquence invalide : copie au-delà de la fin des données");
      if (screenPos + toDo > screen.length) throw new Error("séquence invalide : écriture au-delà de l'écran");
      screen.set(data.subarray(pos, pos + toDo), screenPos);
      pos += toDo;
      screenPos += toDo;
    } while (toDo === 0xff);
  } while (screenPos < SEQUENCE_PIXELS);
  return { next: pos, dirty };
}

export class Sequence {
  readonly frameCount: number;
  private readonly data: Uint8Array;

  /** `fromItem` : séquence d'un compact (`startSequenceItem`), une image de moins que l'octet de tête. */
  constructor(data: Uint8Array, fromItem = false) {
    if (data.length < 1) throw new Error("séquence invalide : fichier vide");
    this.data = data;
    this.frameCount = fromItem ? data[0]! - 1 : data[0]!;
  }

  /** Applique toutes les images à `screen` l'une après l'autre ; `onFrame` est appelé après chacune (numéro à partir de 0). Rend la position de fin. */
  play(screen: Uint8Array, onFrame?: (frame: number, dirty: Uint8Array) => void): number {
    let pos = 1;
    for (let frame = 0; frame < this.frameCount; frame++) {
      const result = decodeSequenceFrame(this.data, pos, screen);
      pos = result.next;
      onFrame?.(frame, result.dirty);
    }
    return pos;
  }

  /** Un décodeur image par image (une image à chaque appel de `next`), pour une lecture cadencée par le moteur. */
  decoder(): SequenceDecoder {
    return new SequenceDecoder(this.data, this.frameCount);
  }
}

export class SequenceDecoder {
  private pos = 1;
  private framesDone = 0;

  constructor(
    private readonly data: Uint8Array,
    readonly frameCount: number,
  ) {}

  get running(): boolean {
    return this.framesDone < this.frameCount;
  }

  /** Images restantes (`_seqInfo.framesLeft`). */
  get framesLeft(): number {
    return this.frameCount - this.framesDone;
  }

  /** `processSequence` : applique l'image suivante à `screen` ; rend les blocs touchés, ou `null` si la séquence est finie. */
  next(screen: Uint8Array): Uint8Array | null {
    if (!this.running) return null;
    const result = decodeSequenceFrame(this.data, this.pos, screen);
    this.pos = result.next;
    this.framesDone++;
    return result.dirty;
  }
}
