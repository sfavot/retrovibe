export interface Sound {
  /** Fréquence en Hz (minimum 4700, comme ScummVM). */
  frequency: number;
  /** Octet de drapeaux (premier octet du fichier, 8 par défaut). */
  flag: number;
  /** PCM 8 bits signé (comme ScummVM, qui le lit en int8 ; moyenne ≈ 0 sur les données du jeu). */
  data: Uint8Array;
}

/** Fichier .SND : taille u32 BE, fréquence u16 BE à l'octet 4, données à partir de 6. */
export function parseSnd(file: Uint8Array): Sound {
  if (file.length <= 6) throw new Error("SND : fichier trop court");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const flag = file[0] ? file[0] & 0x7f : 8;
  const size = view.getUint32(0, false) & 0x00ffffff;
  const frequency = Math.max(view.getInt16(4, false), 4700);
  return { frequency, flag, data: file.subarray(6, 6 + Math.min(size, file.length - 6)) };
}
