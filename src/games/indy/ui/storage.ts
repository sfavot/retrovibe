import { localStorageStore } from "../../../ui/local-storage";

/** Accès à localStorage : le stockage peut être indisponible ou plein, on échoue sans bruit. */
export const storage = localStorageStore();
