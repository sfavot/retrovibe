/**
 * Ressource `SYSX` de `MIDIMAP.DAT` : messages MIDI courts envoyés à la réinitialisation du périphérique (clés de configuration
 * `XSYSMidiMap` et `fEnableHardReset`, `docs/zoombinis/engine.md` §6.1). Deux ressources identiques (ids 1 et 0xffff) de 192 octets :
 * 64 messages de 3 octets (octet d'état, deux octets de données). Pour chacun des 16 canaux `n` (dans l'ordre : tous les canaux d'un même message, puis le message suivant) : `Bn 79 00` (réinitialise les
 * contrôleurs), `Bn 07 7f` (volume 127), `Bn 0b 5a` (expression 90), `Bn 0a 40` (panoramique au centre).
 */
export interface MidiShortMessage {
  status: number;
  data1: number;
  data2: number;
}

export function parseSysx(bytes: Uint8Array): MidiShortMessage[] {
  if (bytes.length % 3 !== 0) throw new Error(`SYSX : ${bytes.length} octets, multiple de 3 attendu`);
  const messages: MidiShortMessage[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const status = bytes[i]!;
    if (status < 0x80) throw new Error(`SYSX : octet d'état invalide en ${i}`);
    messages.push({ status, data1: bytes[i + 1]!, data2: bytes[i + 2]! });
  }
  return messages;
}
