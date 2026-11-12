/**
 * Décompression des écrans (`PictureDecoder::vgaDecode`, engines/lure/decode.cpp, ScummVM, GPL v3+) et `Surface::loadScreen`
 * (surface.cpp).
 *
 * Format VGA : 1 024 octets de table (256 entrées de 4 octets : les quatre successeurs habituels de chaque octet), `u32` à `0x400` = position des
 * octets bruts, flux de bits à partir de `0x404` (le compteur démarre à 9 pour charger le premier octet). Chaque suite de bits choisit l'un
 * des quatre successeurs de l'octet précédent, une répétition `(longueur, octet précédent)`, ou un octet brut ; longueur 0 puis octet 0 termine
 * le flux. La sortie est tronquée à ce qui a été écrit, comme `reallocate` dans ScummVM.
 *
 * Écarts volontaires : l'état du décodeur (registres `AL`, `AH`, `CH`, `CL`, `BP`) est local à la fonction ; la lecture au-delà de la fin des
 * données renvoie un zéro une seule fois (`dataPos == size`) puis lève une erreur, comme `DSSI`. La variante « 5 bits » (`egaDecode`, en-tête
 * `0x140` ou `0x141`, que `Surface::loadScreen` détecte) n'est pas portée : aucun écran des quatre disques VGA ne l'utilise (mesuré, voir
 * `formats.md`) ; un écran qui commencerait ainsi serait refusé par `decodeScreen`.
 */

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
export const SCREEN_SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;
/** Hauteur de la barre de menus : les écrans de jeu n'ont que `SCREEN_HEIGHT - MENUBAR_HEIGHT` lignes décodées (`Surface::loadScreen`). */
export const MENUBAR_HEIGHT = 8;

class Output {
  private readonly buffer: Uint8Array;
  length = 0;

  constructor(maxSize: number) {
    this.buffer = new Uint8Array(maxSize);
  }

  byte(value: number): void {
    if (this.length === this.buffer.length) throw new Error("décompression d'image : sortie plus grande que prévu");
    this.buffer[this.length++] = value;
  }

  run(value: number, count: number): void {
    if (this.length + count > this.buffer.length) throw new Error("décompression d'image : sortie plus grande que prévu");
    this.buffer.fill(value, this.length, this.length + count);
    this.length += count;
  }

  result(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

/** `PictureDecoder::vgaDecode`. */
export function vgaDecode(src: Uint8Array, maxOutputSize: number): Uint8Array {
  if (src.length < 0x404) throw new Error("écran VGA invalide : données trop courtes");
  const out = new Output(maxOutputSize);
  let dataPos = src[0x400]! | (src[0x401]! << 8) | (src[0x402]! << 16) | (src[0x403]! << 24);
  let dataPos2 = 0x404;

  const fromRaw = (): number => {
    if (dataPos > src.length) throw new Error("écran VGA invalide : lecture après la fin des données");
    const value = dataPos === src.length ? 0 : src[dataPos]!;
    dataPos++;
    return value;
  };
  const fromBits = (): number => {
    if (dataPos2 >= src.length) throw new Error("écran VGA invalide : flux de bits tronqué");
    return src[dataPos2++]!;
  };

  let ch = fromBits();
  let cl = 9;
  const nextBit = (): boolean => {
    if (--cl === 0) {
      ch = fromBits();
      cl = 8;
    }
    const carry = (ch & 0x80) !== 0;
    ch = (ch << 1) & 0xff;
    return carry;
  };

  for (let done = false; !done; ) {
    let al = fromRaw();
    out.byte(al);
    let bp = al << 2;
    for (;;) {
      if (nextBit()) {
        if (nextBit()) {
          if (nextBit()) break; // octet brut
          al = src[bp + 3]!;
        } else {
          al = nextBit() ? src[bp + 2]! : src[bp + 1]!;
        }
      } else if (nextBit()) {
        // répétition de l'octet précédent (AH fois), ou fin de flux (AH = AL = 0), ou rien (AH = 0, AL != 0)
        al = bp >> 2;
        const count = fromRaw();
        if (count === 0) {
          if (fromRaw() === 0) {
            done = true;
            break;
          }
          continue;
        }
        out.run(al, count);
        continue;
      } else {
        al = src[bp]!;
      }
      out.byte(al);
      bp = al << 2;
    }
  }
  return out.result();
}

/** Décode un écran : octets indexés, une ligne = 320 octets (`SCREEN_SIZE + 1` octets au plus, comme `Surface::loadScreen`). */
export function decodeScreen(src: Uint8Array, maxOutputSize = SCREEN_SIZE + 1): Uint8Array {
  if (src.length >= 2 && (((src[0]! << 8) | src[1]!) & 0xfffe) === 0x140) throw new Error("écran « 5 bits » (variante EGA) non porté");
  return vgaDecode(src, maxOutputSize);
}

/**
 * Écran de jeu de 320 x 200 : `Surface::loadScreen` colle l'image décodée sous la barre de menus (les 8 premières lignes restent à 0)
 * et ignore ce qui dépasse `192` lignes.
 */
export function loadGameScreen(src: Uint8Array): Uint8Array {
  const decoded = decodeScreen(src);
  const screen = new Uint8Array(SCREEN_SIZE);
  screen.set(decoded.subarray(0, SCREEN_SIZE - MENUBAR_HEIGHT * SCREEN_WIDTH), MENUBAR_HEIGHT * SCREEN_WIDTH);
  return screen;
}
