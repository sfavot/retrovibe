import type { Panel } from "../../../ui/asset-viewer/viewer";
import { globalPanel } from "./panels/global";
import { levelPanel } from "./panels/level";
import { manualPanel, musicPanel, scrPanel, soundsPanel, videoPanel } from "./panels/media";
import { nameOf } from "./panels/shared";

/** Panneaux essayés dans l'ordre ; les fichiers sans panneau tombent sur l'hexadécimal de la visionneuse. */
export const PANELS: Panel[] = [globalPanel, levelPanel, soundsPanel, videoPanel, scrPanel, musicPanel, manualPanel];

/** Groupe (dossier de la barre latérale) d'un fichier. */
export function family(path: string): string {
  const name = nameOf(path);
  if (name.endsWith(".BD") || name.endsWith(".SLV")) return "Données";
  if (name.endsWith(".SMK") || name.endsWith(".SCR")) return "Vidéos";
  if (name.endsWith(".MP3")) return "Musique";
  return "Divers";
}
