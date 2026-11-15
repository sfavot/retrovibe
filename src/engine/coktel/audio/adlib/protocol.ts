/** Messages entre le fil principal et l'AudioWorklet de la musique AdLib. */
export type AdlibCommand =
  | { type: "load"; data: Uint8Array }
  | { type: "unload" }
  | { type: "repeat"; count: number }
  | { type: "play"; seq: number }
  | { type: "stop" };

export type AdlibEvent = { type: "stopped"; seq: number };
