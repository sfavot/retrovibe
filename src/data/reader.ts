/** Lecteur binaire little-endian séquentiel. */
export class BinaryReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  offset = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  get length(): number {
    return this.bytes.length;
  }

  get isAtEnd(): boolean {
    return this.offset >= this.bytes.length;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  bytesView(count: number): Uint8Array {
    const v = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return v;
  }

  i16Array(count: number): Int16Array {
    const out = new Int16Array(count);
    for (let i = 0; i < count; i++) out[i] = this.i16();
    return out;
  }

  /** Quatre caractères ASCII (marqueurs de section). */
  tag(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8());
  }

  /** Chaîne de longueur fixe terminée par un octet nul (Windows-1252). */
  fixedString(length: number): string {
    const raw = this.bytesView(length);
    const end = raw.indexOf(0);
    return decodeText(end === -1 ? raw : raw.subarray(0, end));
  }

  /** Chaîne de longueur donnée, sans terminateur. */
  string(length: number): string {
    return decodeText(this.bytesView(length));
  }
}

const decoder = new TextDecoder("windows-1252");

export function decodeText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
