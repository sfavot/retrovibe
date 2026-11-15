/**
 * Assemblage du moteur des *Voyageurs du temps* avec son rendu réel (`FwRenderer`) : un seul endroit pour l'hôte (navigateur) et les
 * scripts qui veulent l'image (`scripts/voyageurs-cover.mts`). Le son vient de l'hôte (`VoyageursHost.audio`).
 */

import { readFont } from "./data/font";
import { VoyageursEngine, type VoyageursEngineOptions } from "./engine/game";
import type { VoyageursHost } from "./engine/host";
import { FwRenderer } from "./render/renderer";

export interface VoyageursGame {
  readonly engine: VoyageursEngine;
  readonly renderer: FwRenderer;
}

/** Nom du fichier de la police et des textes du jeu. */
export const FONT_FILE = "TEXTE.DAT";

export function createVoyageursEngine(host: VoyageursHost, options: Omit<VoyageursEngineOptions, "host" | "renderer"> = {}): VoyageursGame {
  const font = host.files.read(FONT_FILE);
  if (!font) throw new Error(`Fichier du jeu introuvable : ${FONT_FILE}`);
  const renderer = new FwRenderer(readFont(font));
  return { engine: new VoyageursEngine({ ...options, host, renderer }), renderer };
}
