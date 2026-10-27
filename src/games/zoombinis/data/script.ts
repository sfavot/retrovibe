/**
 * Ressources `SCRB` et `SCRS` : scripts d'animation d'objets (« features ») du moteur de Zoombinis, lus par `11a0:033a` et
 * `11a0:1013` (`docs/zoombinis/engine.md` §3). Contrairement aux `\0SCR` de Mathémagique, il n'y a pas d'opcode : un script est une
 * séquence d'images, chacune étant la liste des sprites visibles. Un seul lecteur sert aux deux types, car les images ont la
 * même structure ; seul l'entête change.
 *
 * Big-endian, en mots de 16 bits :
 *
 * | Type | Entête |
 * |---|---|
 * | `SCRB` | u16 nombre d'images `n` |
 * | `SCRS` | u16 nombre d'images `n`, u16 type de pose (0, 1, 2, 3 ou 0xffff) |
 *
 * Une image est lue case par case, **24 cases au plus** (`local_1a = 0x18`) :
 *
 * | Mot `w` (i16) | Contenu |
 * |---|---|
 * | `w > 0` | partie : indice 1-based de la sous-image dans la planche `tBMP` du groupe, puis i16 `x`, i16 `y` |
 * | `w == 0` | case vide : consomme aussi deux mots (`x`, `y`), ne dessine rien |
 * | `w < 0` | terminateur : fin de l'image. Octet bas = numéro d'évènement (0 = aucun ; sinon le moteur appelle le rappel de l'objet avec `numéro - 1`), octet haut `0xff` ou `0xfe`. Si `w < -0x100` (octet haut `0xfe`), un mot supplémentaire donne l'id du `\0SND` à jouer |
 *
 * Les positions sont des pixels de l'écran 640 × 480 ; le moteur en retranche le point d'ancrage `REGS` de la sous-image
 * quand le groupe en a (`regs.ts`).
 *
 * Image de 24 cases (8 `SCRB` mesurés : 7 dans `FERRY.MHK`, 1 dans `LILLY.MHK` ; `engine.md` en annonce 18) : la boucle s'arrête à
 * 24 cases sans lire le terminateur (point ouvert 3 d'`engine.md`). Ce lecteur reproduit la boucle du moteur : une telle image
 * est rendue avec `terminated: false` (pas d'évènement ni de son), et le terminateur est relu comme premier mot de l'image
 * suivante, qui est donc une image sans case. Les `n` images annoncées sont lues, pas davantage : les derniers mots
 * (`trailingWords`) ne sont jamais atteints, ce qui revient à tronquer le script (comportement supposé de l'original).
 */
import { BinaryReader } from "../../../data/reader";

/** Nombre maximal de cases lues par image. */
export const SCRIPT_MAX_CELLS = 24;

/** Premier octet bas des terminateurs de son dépendant du Zoombini dans les `SCRS` (`0xffc9` à `0xffd9`). */
export const SNOID_VOICE_FIRST = 0xc9;

/**
 * Codes de voix des terminateurs `0xffc9`…`0xffd9` (`11a8:32b2`), dans l'ordre. Le code, combiné à la voix du Zoombini,
 * donne l'id du son (`1168:575b`, `engine.md` §3.7) ; le code 16 tire un son au hasard dans 1800…1814.
 */
export const SNOID_VOICE_CODES = [8, 6, 7, 10, 2, 12, 1, 9, 0, 4, 5, 3, 11, 13, 14, 15, 16] as const;

/** Une case : partie dessinée (`w > 0`) ou case vide (`w == 0`, `x` et `y` sont lus mais sans effet). */
export interface ScriptCell {
  /** Indice 1-based de la sous-image dans la planche du groupe ; 0 = case vide. */
  w: number;
  x: number;
  y: number;
}

export interface ScriptImage {
  /** Cases dans l'ordre de lecture, vides comprises (au plus `SCRIPT_MAX_CELLS`). */
  cells: ScriptCell[];
  /** Faux si la boucle de 24 cases s'est arrêtée avant le terminateur (voir l'entête du fichier). */
  terminated: boolean;
  /** Mot terminateur brut (0 si `terminated` est faux). */
  terminator: number;
  /** Numéro d'évènement : octet bas du terminateur (0 = aucun). Le rappel du moteur reçoit `event - 1`. */
  event: number;
  /** Id du `\0SND` à jouer à cette image, s'il y en a un. */
  soundId?: number;
}

export interface Script {
  /** Nombre d'images déclaré dans l'entête. */
  imageCount: number;
  /** Type de pose (second mot de l'entête d'un `SCRS`) ; `undefined` pour un `SCRB`. */
  pose?: number;
  images: ScriptImage[];
  /** Mots non lus après la dernière image (non nul seulement après une image de 24 cases). */
  trailingWords: number;
}

/** Code de voix (`SNOID_VOICE_CODES`) d'un numéro d'évènement `0xc9`…`0xd9` d'un `SCRS` ; `undefined` sinon. */
export function snoidVoiceCode(event: number): number | undefined {
  return SNOID_VOICE_CODES[event - SNOID_VOICE_FIRST];
}

/** Cases dessinées d'une image (les cases vides sont écartées). */
export function visibleCells(image: ScriptImage): ScriptCell[] {
  return image.cells.filter((cell) => cell.w > 0);
}

function readImage(r: BinaryReader, kind: string, index: number): ScriptImage {
  const cells: ScriptCell[] = [];
  const truncated = () => new Error(`${kind} : image ${index} tronquée en ${r.offset}`);
  while (cells.length < SCRIPT_MAX_CELLS) {
    if (r.offset + 2 > r.length) throw truncated();
    const w = r.i16be();
    if (w < 0) {
      let soundId: number | undefined;
      if (w < -0x100) {
        if (r.offset + 2 > r.length) throw truncated();
        soundId = r.u16be();
      }
      const image: ScriptImage = { cells, terminated: true, terminator: w & 0xffff, event: w & 0xff };
      if (soundId !== undefined) image.soundId = soundId;
      return image;
    }
    if (r.offset + 4 > r.length) throw truncated();
    cells.push({ w, x: r.i16be(), y: r.i16be() });
  }
  return { cells, terminated: false, terminator: 0, event: 0 };
}

function parseScript(bytes: Uint8Array, kind: "SCRB" | "SCRS"): Script {
  const headerBytes = kind === "SCRS" ? 4 : 2;
  if (bytes.length < headerBytes) throw new Error(`${kind} : ressource trop courte`);
  const r = new BinaryReader(bytes);
  const imageCount = r.u16be();
  const pose = kind === "SCRS" ? r.u16be() : undefined;
  const images: ScriptImage[] = [];
  for (let i = 0; i < imageCount; i++) images.push(readImage(r, kind, i));
  const script: Script = { imageCount, images, trailingWords: (r.length - r.offset) >> 1 };
  if (pose !== undefined) script.pose = pose;
  return script;
}

/** Lit un `SCRB` (animation d'un objet de décor, d'interface ou d'un personnage de puzzle). */
export function parseScrb(bytes: Uint8Array): Script {
  return parseScript(bytes, "SCRB");
}

/** Lit un `SCRS` (animation d'un Zoombini ou d'une créature qui se déplace comme eux). */
export function parseScrs(bytes: Uint8Array): Script {
  return parseScript(bytes, "SCRS");
}
