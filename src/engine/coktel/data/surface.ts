/** Surface 8 bits indexée (une valeur de palette par pixel). */
export interface IndexedSurface {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export function createSurface(width: number, height: number): IndexedSurface {
  return { width, height, pixels: new Uint8Array(width * height) };
}
