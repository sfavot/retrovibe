import type { HostStorage } from "../../../engine/storage";
import { parseWorld } from "../data/world";
import type { ArmaethStorage } from "../engine/host";

/** Octets -> base64 (par blocs : `String.fromCharCode(...bytes)` dépasse la pile pour 21 868 octets). */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** base64 -> octets ; `null` si le texte n'est pas du base64 valide. */
export function decodeBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Sauvegardes du jeu dans un stockage clé / valeur (`localStorage` préfixé `armaeth:`), un fichier de monde en base64 par
 * emplacement. Une valeur illisible (base64 cassé, fichier qui n'est pas un monde) vaut « emplacement vide » : le moteur ne
 * reçoit jamais d'octets qu'il ne sait pas relire. Une écriture refusée (stockage plein ou bloqué) est signalée dans la console.
 */
export function createSaveStorage(store: HostStorage): ArmaethStorage {
  return {
    read(slot) {
      const text = store.get(slot);
      if (text === null) return null;
      const bytes = decodeBase64(text);
      if (bytes) {
        try {
          parseWorld(bytes);
          return bytes;
        } catch {
          // fichier de monde invalide : traité comme absent
        }
      }
      console.warn(`Armaeth : la sauvegarde « ${slot} » est illisible et ignorée.`);
      return null;
    },
    write(slot, bytes) {
      if (!store.set(slot, encodeBase64(bytes))) console.warn(`Armaeth : la sauvegarde « ${slot} » n'a pas pu être écrite (stockage plein ou bloqué).`);
    },
  };
}
