/**
 * Enregistrement des fonctions du noyau : **une ligne par groupe**. Une vague qui porte un groupe ajoute son fichier dans ce
 * dossier et sa ligne ici, sans toucher à `vm.ts` ni à `kernel.ts` (`docs/gk1/plan.md`, « Vagues »).
 */
import { registerArrayKernel } from "./arrays";
import { registerAudioKernel } from "./audio";
import { registerCelKernel } from "./cels";
import { registerCursorKernel } from "./cursor";
import { registerEditTextKernel } from "./edit-text";
import { registerEffectKernel } from "./effects";
import { registerEventKernel } from "./events";
import { registerFileKernel } from "./fileio";
import type { Kernel } from "./kernel";
import { registerListKernel } from "./lists";
import { registerMathKernel } from "./math";
import { registerMessageKernel } from "./message";
import { registerMiscKernel } from "./misc";
import { registerMotionKernel } from "./motion";
import { registerMovieKernel } from "./movie";
import { registerObjectKernel } from "./objects";
import { registerPaletteKernel } from "./palette";
import { registerPlaneKernel } from "./planes";
import { registerPolygonKernel } from "./polygons";
import { registerResourceKernel } from "./resources";
import { registerSaveKernel } from "./save";
import { registerSoundKernel } from "./sound";
import { registerStubs } from "./stubs";
import { registerTextKernel } from "./text";

export function registerKernel(kernel: Kernel): void {
  registerResourceKernel(kernel);
  registerObjectKernel(kernel);
  registerListKernel(kernel);
  registerMathKernel(kernel);
  registerArrayKernel(kernel);
  registerMiscKernel(kernel);
  registerSoundKernel(kernel);
  registerPlaneKernel(kernel);
  registerCelKernel(kernel);
  registerPaletteKernel(kernel);
  registerTextKernel(kernel);
  registerCursorKernel(kernel);
  registerEffectKernel(kernel);
  registerEventKernel(kernel);
  registerMotionKernel(kernel);
  registerPolygonKernel(kernel);
  registerMovieKernel(kernel);
  registerMessageKernel(kernel);
  registerAudioKernel(kernel);
  registerSaveKernel(kernel);
  registerFileKernel(kernel);
  registerEditTextKernel(kernel);
  // Toujours en dernier : ne fixe que les fonctions restées sans implémentation.
  registerStubs(kernel);
}
