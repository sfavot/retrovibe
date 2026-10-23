import { TestHost } from "../engine-test-host";

/**
 * Hôte du robot : comme `TestHost`, mais sans garder les 64 Ko de chaque image présentée (une partie de 30 minutes en
 * produirait des gigaoctets). Il ne retient qu'une empreinte échantillonnée de la dernière image, qui sert à détecter un écran figé.
 */
export class RobotHost extends TestHost {
  /** Nombre d'images présentées depuis le début. */
  presented = 0;
  /** Empreinte de la dernière image (pixels échantillonnés + palette). */
  fingerprint = 0;

  override present(surface: Uint8Array, palette: Uint8Array): void {
    this.presented++;
    let h = 2166136261;
    for (let i = 0; i < surface.length; i += 7) h = Math.imul(h ^ surface[i], 16777619);
    for (let i = 0; i < palette.length; i += 5) h = Math.imul(h ^ palette[i], 16777619);
    this.fingerprint = h >>> 0;
    // Aucune image n'est conservée (`presentations` reste vide) : le robot ne lit que l'empreinte.
  }
}
