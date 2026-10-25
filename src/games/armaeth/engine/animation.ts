import { type Sprite, type SpriteFrame, readSprite } from "../data/sprite";
import type { AniTable, DefRecord, DefTable, SpriteFamily } from "../data/tables";
import type { VgaArchive } from "../data/vga-archive";
import { type GameObject, RAW_OFFSET, rawU16, setRawU16, setRawU8 } from "./state";

/**
 * Animation des objets (`docs/armaeth/engine.md` § 6.3, `characters.md` § 1.3) : choix de la ressource sprite d'un objet,
 * pas d'animation (`animStep`, `1833:0006`) et animations scénarisées `ANM` (`16f5:0132`, `16f5:02a2`, `16f5:038c`).
 * Module pur : les sons sont rendus sous forme d'événements, jamais joués ici.
 */

/** Ressource sprite : famille et identifiant (`Num`, ou `Anm` pour une animation scénarisée). */
export interface SpriteKey {
  family: SpriteFamily;
  id: number;
}

/** Source des ressources sprite (chargeur paresseux en production, table de ressources synthétiques dans les tests). */
export interface SpriteSource {
  /** Ressource décodée, ou `undefined` si la famille ne la contient pas. */
  get(key: SpriteKey): Sprite | undefined;
}

/** Famille de ressources d'un objet d'après `Typ` (`gm_load_sprite_resource`, `1735:000e` : 0 `INT`, 1 `DEC`, 2 et 3 `OBJ`). */
const FAMILY_OF_TYPE: readonly SpriteFamily[] = ["INT", "DEC", "OBJ", "OBJ"];

/** Ressource sprite de l'objet : `ANM` de numéro `Anm` quand `Anm` est non nul, sinon la famille de `Typ` avec `Num`. */
export function spriteKeyOf(obj: Pick<GameObject, "typ" | "num" | "animId">): SpriteKey | undefined {
  if (obj.animId !== 0) return { family: "ANM", id: obj.animId };
  const family = FAMILY_OF_TYPE[obj.typ];
  return family ? { family, id: obj.num } : undefined;
}

/**
 * Bibliothèque de ressources sprite lues dans les quatre archives `.VGA` (`INT`, `DEC`, `OBJ`, `ANM`). La table `DEF`
 * (`gm_def_lookup`, `10b3:0006`), si elle est fournie, décide de l'existence d'une ressource : une clé absente de `DEF` n'est
 * pas chargée (le moteur s'arrête avec une erreur). Les ressources sont décodées à la demande et gardées.
 */
export class SpriteLibrary implements SpriteSource {
  private readonly cache = new Map<string, Sprite>();

  constructor(
    private readonly archives: Record<SpriteFamily, VgaArchive>,
    private readonly def?: DefTable,
  ) {}

  /** Enregistrement `DEF` de la ressource (modèle d'objet), ou `undefined` sans table `DEF` ou si la clé est absente. */
  defRecord(key: SpriteKey): DefRecord | undefined {
    return this.def?.records[key.family].find((r) => r.id === key.id);
  }

  has(key: SpriteKey): boolean {
    if (this.def && !this.defRecord(key)) return false;
    return this.archives[key.family].entries.some((e) => e.id === key.id);
  }

  get(key: SpriteKey): Sprite | undefined {
    const name = `${key.family}${key.id}`;
    let sprite = this.cache.get(name);
    if (!sprite) {
      if (!this.has(key)) return undefined;
      sprite = readSprite(this.archives[key.family].bytes(key.id));
      this.cache.set(name, sprite);
    }
    return sprite;
  }
}

/** Ressource courante de l'objet. */
export function spriteOf(obj: GameObject, sprites: SpriteSource): Sprite | undefined {
  const key = spriteKeyOf(obj);
  return key ? sprites.get(key) : undefined;
}

/** Image courante de l'objet (`Des`), ou `undefined` si elle n'est pas choisie ou hors de la ressource (cas `INT 3 Fig 2`). */
export function currentFrame(obj: GameObject, sprites: SpriteSource): SpriteFrame | undefined {
  if (obj.anim.frame < 0) return undefined;
  return spriteOf(obj, sprites)?.frames[obj.anim.frame];
}

/**
 * Pas d'animation (`animStep`, `1833:0006`, certain). La direction vient de la vitesse (`Hor`, puis `Prf`) ; à l'arrêt, `force`
 * à 0 ne fait rien, sinon la direction mémorisée est conservée. Même direction et `force` nul : la durée restante baisse et,
 * à 0, on passe au pas suivant (retour au premier après le dernier) ; sinon la séquence de la direction repart du pas 1.
 * L'image est miroir quand le bit 7 du pas diffère du miroir de direction (gauche et `mirrorLeft` non nul). Rend vrai si un
 * pas a été (re)choisi (l'image ou le miroir ont pu changer).
 *
 * hypothèse (engine.md §6.3) : `dpX` et `dpY` sont recopiés à chaque pas (le texte les attribue à `animStep`, le pseudo-code
 * ne les cite pas) ; `dpP` ne change qu'au chargement de la ressource (`loadObjectSprite`).
 * hypothèse (engine.md §6.3) : une `Fig` sans enregistrement, ou une séquence plus courte que `Tot`, laisse l'objet inchangé
 * (le moteur lirait des mots voisins) ; la durée restante est un octet (0 - 1 = 255).
 */
export function animStep(obj: GameObject, sprites: SpriteSource, force = 0): boolean {
  const sprite = spriteOf(obj, sprites);
  const fig = sprite?.animation.figs[obj.fig];
  if (!sprite || !fig) return false;
  const a = obj.anim;
  let d: number;
  if (obj.speedX !== 0) d = obj.speedX < 0 ? 1 : 0;
  else if (obj.speedP !== 0) d = obj.speedP < 0 ? 3 : 2;
  else if (obj.speedY === 0) {
    if (force === 0) return false;
    d = a.dir < 4 ? a.dir : 2;
    force = 7;
  } else {
    d = a.dir < 4 ? a.dir : 2;
    if (obj.dep === 4 && d !== 3) {
      d = 3;
      force = 7;
    }
  }
  const sequence = fig.directions[d];
  const mirrorOfDirection = d === 1 && fig.mirrorLeft !== 0;
  let index: number;
  if (a.dir === d && force === 0) {
    a.remaining = (a.remaining - 1) & 0xff;
    if (a.remaining !== 0) return false;
    index = a.index + 1;
    if (index > a.total) index = 1;
  } else {
    index = 1;
    a.total = sequence.steps.length;
  }
  const step = sequence.steps[index - 1];
  if (!step) return false;
  a.dir = d;
  a.index = index;
  a.mirror = step.mirror !== mirrorOfDirection ? 1 : 0;
  a.remaining = step.duration;
  a.frame = step.frame;
  const image = sprite.frames[step.frame];
  a.height = image?.height ?? 0;
  a.width = image?.width ?? 0;
  a.dpX = fig.dpX;
  a.dpY = fig.dpY;
  return true;
}

/**
 * Charge la ressource de l'objet (`1833:01fc`) : `dpP` à 1, puis premier pas de la séquence de la direction courante.
 * Sans enregistrement pour `Fig`, l'image reste non choisie (l'objet n'est pas dessiné).
 */
export function loadObjectSprite(obj: GameObject, sprites: SpriteSource): void {
  obj.anim.dpP = 1;
  obj.anim.frame = -1;
  animStep(obj, sprites, 7);
}

/** Change `Fig` et relance la séquence au pas 1 (`1a37:*` replace l'objet) ; la direction courante est conservée. */
export function setFig(obj: GameObject, sprites: SpriteSource, fig: number): void {
  obj.fig = fig;
  animStep(obj, sprites, 7);
}

/**
 * Phase aléatoire d'un décor (`1cc3:0745..07f5`, `engine.md` § 5.3) : premier pas forcé, `Rep = 1`, `Ind = rand() % Tot + 1`,
 * puis un pas normal qui passe au pas suivant (la phase effective est donc `Ind + 1`, en bouclant). `rand` est le `rand()` du
 * jeu (15 bits).
 */
export function randomizeDecorPhase(obj: GameObject, sprites: SpriteSource, rand: () => number): void {
  loadObjectSprite(obj, sprites);
  const a = obj.anim;
  if (a.total === 0) return;
  a.remaining = 1;
  a.index = (rand() % a.total) + 1;
  animStep(obj, sprites, 0);
}

// --- animations scénarisées (ANM / A1FANI.SYS) --------------------------------------------------------------------------

/** Événement sonore demandé par une animation : l'appelant le joue (`gm_sound_play`) ou l'arrête. */
export type AnimationEvent =
  | { type: "sound"; soundClass: string; id: number; number: number; loop: boolean }
  | { type: "soundStop" };

/** Classe de son « aucun son » des enregistrements `ANI` (mot 1 : `0x41` = `A`, `0x20` = aucun). */
const NO_SOUND_CLASS = 0x20;

export interface ScriptedAnimation {
  /** Identifiant `ANI` / `ANM` (1 à 47). */
  id: number;
  /** `Gst`, `Mob`, `Ego` donnés à l'objet (`1a37:003a`) ; `Dep` et `Txt` sont conservés. */
  gst: number;
  mob: number;
  ego: number;
  /** Vitesses imposées à l'objet. */
  hor: number;
  ver: number;
  prf: number;
  /** Partenaire d'animation (combat) : chacun reçoit la `Ser` de l'autre dans `Bag` ; absent = 0. */
  partner?: GameObject | null;
  /** L'objet est dans la salle chargée : le son de l'animation est demandé. */
  audible: boolean;
}

function aniRecord(ani: AniTable, id: number) {
  const record = ani.records.find((r) => r.id === id);
  if (!record) throw new Error(`Animation ${id} inconnue`);
  return record;
}

/** Charge le pas `index` de l'animation (`16f5:038c`) : `Tim` = octet bas (boucles), `Fig` = octet haut. */
function loadAniStep(obj: GameObject, sprites: SpriteSource, ani: AniTable, id: number, index: number): void {
  const word = ani.sequence(id)[index];
  setRawU16(obj, RAW_OFFSET.tim, word & 0xff);
  setFig(obj, sprites, word >> 8);
}

/**
 * Démarre une animation scénarisée (`16f5:0132`, certain) : partenaires liés par `Bag`, `Anm` = id, `Nbr` = nombre de pas,
 * vitesses, état (`Gst`, `Mob`, `Ego`, `Fig 0`), premier pas, ressource `ANM` chargée. Les trajets de l'objet sont annulés par
 * l'appelant (mover). Rend le son à jouer, le cas échéant.
 * hypothèse (characters.md §1.3) : mot 2 de l'enregistrement = identifiant du son, mot 3 = numéro ; lecture en boucle
 * (arguments `7, 0, 7` de `gm_sound_play`) arrêtée à la fin de l'animation.
 */
export function startScriptedAnimation(obj: GameObject, sprites: SpriteSource, ani: AniTable, params: ScriptedAnimation): AnimationEvent[] {
  const record = aniRecord(ani, params.id);
  const partner = params.partner ?? null;
  setRawU16(obj, RAW_OFFSET.bag, partner?.serial ?? 0);
  if (partner) setRawU16(partner, RAW_OFFSET.bag, obj.serial);
  obj.animId = params.id;
  setRawU16(obj, RAW_OFFSET.nbr, record.steps);
  obj.speedX = params.hor;
  obj.speedY = params.ver;
  obj.speedP = params.prf;
  obj.gst = params.gst;
  obj.mob = params.mob;
  obj.ego = params.ego;
  obj.fig = 0;
  loadAniStep(obj, sprites, ani, params.id, 0);
  loadObjectSprite(obj, sprites);
  const events: AnimationEvent[] = [];
  if (record.kind !== NO_SOUND_CLASS && (record.unknown2 !== 0 || record.unknown3 !== 0) && params.audible) {
    events.push({ type: "sound", soundClass: String.fromCharCode(record.kind), id: record.unknown2, number: record.unknown3, loop: true });
  }
  return events;
}

export interface ScriptedTick {
  /** Identifiant de l'animation qui vient de se terminer (`16f5:02a2`), 0 tant qu'elle dure. */
  finished: number;
  events: AnimationEvent[];
}

/** Séquence d'images terminée (`1833:0336`) : toujours pour un objet hors des salles actives, sinon `Ind >= Tot` et `Rep <= 1`. */
export function sequenceFinished(obj: GameObject, active: boolean): boolean {
  return !active || (obj.anim.index >= obj.anim.total && obj.anim.remaining <= 1);
}

/**
 * Un tic d'animation scénarisée (`16f5:02a2`, certain) : quand la séquence d'images est terminée, `Tim` baisse ; à 0 le pas
 * suivant est chargé (`Nbr - 1`) ; quand `Nbr` tombe à 0 : `Anm = 0`, `Err = 0`, ressource d'origine rechargée, arrêt du son,
 * et l'id terminé est rendu. `active` : l'objet est dans une salle active (chargée).
 */
export function tickScriptedAnimation(obj: GameObject, sprites: SpriteSource, ani: AniTable, active: boolean): ScriptedTick {
  const none: ScriptedTick = { finished: 0, events: [] };
  const id = obj.animId;
  if (id === 0 || !sequenceFinished(obj, active)) return none;
  const loops = Math.max(0, rawU16(obj, RAW_OFFSET.tim) - 1);
  setRawU16(obj, RAW_OFFSET.tim, loops);
  if (loops !== 0) return none;
  const remaining = Math.max(0, rawU16(obj, RAW_OFFSET.nbr) - 1);
  setRawU16(obj, RAW_OFFSET.nbr, remaining);
  if (remaining === 0) {
    obj.animId = 0;
    setRawU8(obj, RAW_OFFSET.err, 0);
    loadObjectSprite(obj, sprites);
    return { finished: id, events: [{ type: "soundStop" }] };
  }
  loadAniStep(obj, sprites, ani, id, aniRecord(ani, id).steps - remaining);
  return none;
}
