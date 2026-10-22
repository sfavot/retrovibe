/**
 * Mémoire des variables d'un script : `count * 4` octets, little-endian.
 * Les variables sont adressées par décalage en octets ; les chaînes sont des
 * suites d'octets terminées par un zéro (« chaînes d'octets » : un caractère
 * JavaScript par octet, sans interprétation de la page de code).
 */
export class Variables {
  readonly size: number;
  readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(count: number) {
    this.size = count * 4;
    this.bytes = new Uint8Array(this.size);
    this.view = new DataView(this.bytes.buffer);
  }

  private check(offset: number, length: number): void {
    if (!(offset >= 0 && offset + length <= this.size)) {
      throw new RangeError(`Variables : accès hors limites (décalage ${offset}, ${length} octet(s), taille ${this.size})`);
    }
  }

  readOff8(offset: number): number {
    this.check(offset, 1);
    return this.bytes[offset];
  }

  readOff16(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(offset, true);
  }

  readOff32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, true);
  }

  writeOff8(offset: number, value: number): void {
    this.check(offset, 1);
    this.bytes[offset] = value;
  }

  writeOff16(offset: number, value: number): void {
    this.check(offset, 2);
    this.view.setUint16(offset, value & 0xffff, true);
  }

  writeOff32(offset: number, value: number): void {
    this.check(offset, 4);
    this.view.setUint32(offset, value >>> 0, true);
  }

  /** Variable de 32 bits numéro `index` (VAR(n)). */
  readVar32(index: number): number {
    return this.readOff32(index * 4);
  }

  writeVar32(index: number, value: number): void {
    this.writeOff32(index * 4, value);
  }

  /** Octets de la chaîne à `offset`, sans le zéro final (limités à `maxLength` si donné). */
  cstr(offset: number, maxLength = Infinity): Uint8Array {
    this.check(offset, 0);
    const limit = Math.min(this.size, offset + maxLength);
    let end = offset;
    while (end < limit && this.bytes[end] !== 0) end++;
    return this.bytes.subarray(offset, end);
  }

  readString(offset: number, maxLength = Infinity): string {
    return bytesToString(this.cstr(offset, maxLength));
  }

  /** strcpy : copie la chaîne puis un zéro final. */
  writeBytesString(offset: number, value: Uint8Array): void {
    this.check(offset, value.length + 1);
    this.bytes.set(value, offset);
    this.bytes[offset + value.length] = 0;
  }

  writeString(offset: number, value: string): void {
    this.writeBytesString(offset, stringToBytes(value));
  }

  /** Copie `length` octets de la mémoire à `offset` ; null si hors limites. */
  copyTo(offset: number, length: number): Uint8Array | null {
    if (offset < 0 || offset + length > this.size) return null;
    return this.bytes.slice(offset, offset + length);
  }

  copyFrom(offset: number, data: Uint8Array): boolean {
    if (offset < 0 || offset + data.length > this.size) return false;
    this.bytes.set(data, offset);
    return true;
  }
}

/** Octets -> chaîne, un caractère par octet. */
export function bytesToString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Chaîne -> octets (un octet par caractère, poids faible). */
export function stringToBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}
