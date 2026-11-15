/**
 * Pièce en mémoire (0x10C octets dans TIMWIN.EXE, `docs/tim3/engine.md` § 2). Chaque champ porte son offset d'origine ;
 * tous sont des entiers. Les pointeurs deviennent des références (`Part`, `Polygon`, `RopeData`, `BeltData`).
 * Correspondance OpenTIM : `structures/Part.csv` (pièce TEMIM de 0xA2 octets, autres offsets).
 */

/** Polygone de collision : sommets de 12 octets {x, y, angle du côté sommet → suivant (mot bas)}. */
export class Polygon {
  readonly x: Int32Array;
  readonly y: Int32Array;
  /** +8 : angle 16 bits du côté qui part de ce sommet (calculé par 439e38). */
  readonly angle: Uint16Array;

  constructor(readonly length: number) {
    this.x = new Int32Array(length);
    this.y = new Int32Array(length);
    this.angle = new Uint16Array(length);
  }

  static from(points: readonly (readonly [number, number])[]): Polygon {
    const p = new Polygon(points.length);
    points.forEach(([x, y], i) => {
      p.x[i] = x;
      p.y[i] = y;
    });
    return p;
  }
}

/** Bits de +0x0C. */
export const F0C = {
  /** Posée et qui roule sur le support (434382). */
  ROLLING: 0x1,
  /** Contact avec une pièce lourde ou fixe : rebond ou roulement. */
  CONTACT_HEAVY: 0x2,
  /** Contact avec une pièce mobile : choc (4347e3). */
  CONTACT_MOBILE: 0x4,
  /** Déjà traitée dans le pas (43373c). */
  DONE: 0x8,
  /** Type hors table (≥ 0x119). */
  INVALID: 0x10,
  /** 4335ce l'a déplacée dans ce pas. */
  MOVED: 0x40,
  IN_BIN: 0x800,
  IN_MOBILE: 0x1000,
  IN_STATIC: 0x2000,
} as const;

/** Bits de +0x10. */
export const F10 = {
  FLIP_X: 0x10,
  FLIP_Y: 0x20,
  /** Contact par un sommet de l'autre pièce (42c1d6). */
  HIT_BY_VERTEX: 0x1000,
  /** Sortie de [−1000, 2000] px, ou détruite : ignorée par le pas. */
  GONE: 0x2000,
} as const;

/** Bits de +0x14. */
export const F14 = {
  /** Gravité inversée (bit 0x08 de l'octet +0x15). */
  REVERSED_GRAVITY: 0x800,
  /** Mur : extrémités dessinées (435b14). */
  WALL: 0x2000,
  /** En attente (compteur +0x104), hors du pas. */
  SUSPENDED: 0x4000,
} as const;

/**
 * Structure de corde (0x54 octets, allouée par 43e6a4 ou par le chargeur 43173e), partagée par la pièce corde (10, 76)
 * et les deux pièces attachées. Correspondance OpenTIM : `structures/RopeData.csv` (TEMIM, champs 16 bits).
 */
export class RopeData {
  /** +0x04 / +0x08 : pièces aux deux bouts ; +0x0C / +0x10 : celles de l'édition (43ada7 les recopie au démarrage). */
  end1: Part | null = null;
  end2: Part | null = null;
  origEnd1: Part | null = null;
  origEnd2: Part | null = null;
  /** +0x14 / +0x15 : emplacement de corde (0 ou 1) chez chaque bout ; +0x16 / +0x17 : ceux de l'édition. */
  slot1 = 0;
  slot2 = 0;
  origSlot1 = 0;
  origSlot2 = 0;
  /** +0x18 : compteur incrémenté par le slot 5 du bout tiré en mode 1 ; +0x1C : sa valeur au pas précédent. */
  n18 = 0;
  n1C = 0;
  /** +0x24 … +0x30 : extrémités {x1, y1, x2, y2} en pixels (438db6) ; +0x34 … +0x40 : celles du pas précédent. */
  readonly ends = new Int32Array(4);
  readonly prevEnds = new Int32Array(4);

  /** +0x00 : pièce corde (ou poulie) propriétaire. */
  constructor(public ropePart: Part) {}
}

/** Structure de courroie (0x70 octets, 43f460 ou 43173e), partagée par la courroie (8) et ses deux pièces. */
export class BeltData {
  /** +0x08 / +0x0C : pièces reliées (la seconde peut manquer pendant l'édition). */
  end1: Part | null = null;
  end2: Part | null = null;
  /** +0x10 … +0x2C : quatre points {x, y} des deux brins (438c70) ; +0x30 … +0x4C : ceux du pas précédent. */
  readonly pos = new Int32Array(8);
  readonly prevPos = new Int32Array(8);

  /** +0x04 : pièce courroie. */
  constructor(public beltPart: Part) {}
}

export class Part {
  /** +0x00 / +0x04 : liste chaînée (voir `lists.ts`). */
  next: Part | null = null;
  prev: Part | null = null;
  /** +0x08 */
  type = 0;
  /** +0x0C, +0x10, +0x14 */
  flags0C = 0;
  flags10 = 0;
  flags14 = 0;
  /** +0x18 : image (état d'animation) ; +0x1C, +0x20 : images des pas précédents. */
  frame = 0;
  framePrev = 0;
  framePrev2 = 0;
  /** +0x24 (copie de +0xF4 au démarrage). */
  f24 = 0;
  /** +0x28 (octet) : rafraîchissement d'affichage. */
  redraw = 0;
  /** +0x2C / +0x30 : position en 1/512 de pixel. */
  fx = 0;
  fy = 0;
  /** +0x34 / +0x38 : position en pixels. */
  px = 0;
  py = 0;
  /** +0x3C / +0x40 : position en pixels au pas précédent. */
  prevPx = 0;
  prevPy = 0;
  /** +0x44 / +0x48 : position de dessin ; +0x4C / +0x50 : la même au pas précédent. */
  drawX = 0;
  drawY = 0;
  prevDrawX = 0;
  prevDrawY = 0;
  /** +0x54 / +0x58 : vitesse en 1/512 de pixel par pas. */
  vx = 0;
  vy = 0;
  /** +0x5C : masse (masse du type au démarrage ; seaux : plus leur contenu). */
  mass = 0;
  /** +0x60 : quantité de mouvement (434221). */
  momentum = 0;
  /** +0x64 / +0x68 : taille de la forme ; +0x6C / +0x70 : taille de l'image ; +0x74 / +0x78 : celle du pas précédent. */
  shapeW = 0;
  shapeH = 0;
  frameW = 0;
  frameH = 0;
  prevFrameW = 0;
  prevFrameH = 0;
  /** +0x7C / +0x80 : boîte englobante de collision. */
  boxW = 0;
  boxH = 0;
  /** +0x84 : courroie (structure partagée par la courroie et ses deux pièces). */
  belt: BeltData | null = null;
  /**
   * +0x90 … +0xA4 : pièces liées. 0 et 1 : liens de corde (pièce ou poulie suivante vers chaque bout) ; 2 et 3 : leur
   * copie d'édition (43ada7 recopie 2, 3 → 0, 1) ; 4 et 5 : branchements électriques.
   */
  links: (Part | null)[] = [null, null, null, null, null, null];
  /** +0xA8 / +0xAC : cordes attachées (emplacement 0 et 1 ; la poulie porte sa corde en 0, celle qui la traverse en 1). */
  ropes: [RopeData | null, RopeData | null] = [null, null];
  /**
   * +0xB0 … +0xBB (octets signés) : points d'accroche {x, y} relatifs à la position en pixels. 0 et 1 : cordes
   * (+0xB0 … +0xB3, lus par 43a901) ; 4 (+0xB8) : mise à feu, fiche… selon le type.
   */
  readonly ropeAnchor = new Int8Array(12);
  /**
   * +0x90 (= +0x98) des lasers (91 … 93) et du mélangeur de faisceaux (95) : tampon du faisceau de 0x80 octets, 16 points
   * {x, y} en pixels (43c65c, tracé par 43ce78). Le nombre de tronçons est +0x104.
   */
  beam: Int32Array | null = null;
  /** +0x90 de la balle programmable (87) : {densité, élasticité, frottement, accélération} réglés dans l'éditeur. */
  prog: Int32Array | null = null;
  /** +0x88, +0x89, +0x8C : ancrages lus du LEV. */
  f88 = 0;
  f89 = 0;
  f8C = 0;
  /** +0xC8 / +0xCC : écarts posés par 434cc4 (zone de contact propre au type). */
  fC8 = 0;
  fCC = 0;
  /** +0xC4 : chaîne du contenu d'un seau (4352d1). */
  bucketNext: Part | null = null;
  /** +0xD0 */
  fD0 = 0;
  /** +0xD4 : nombre de sommets ; +0xD8 : polygone (partagé avec le type, ou propre à la pièce). */
  vertexCount = 0;
  poly: Polygon | null = null;
  /** +0xDC : pièce en contact ; +0xE0 / +0xE1 : côtés touchés ; +0xE2 : angle du côté ; +0xE4 : indice du côté. */
  contact: Part | null = null;
  contactLeft = 0;
  contactRight = 0;
  contactAngle = 0;
  contactIndex = 0;
  /** +0xE8 / +0xEC : position d'édition (pixels) ; +0xF0 : image ; +0xF4 ; +0xF8 : drapeaux +0x10 d'édition. */
  editX = 0;
  editY = 0;
  editFrame = 0;
  editF24 = 0;
  editFlags10 = 0;
  /** +0xFC / +0x100 / +0x104 / +0x108 : compteurs propres au type (rotation d'une balle, délai…) et valeurs précédentes. */
  fFC = 0;
  f100 = 0;
  f104 = 0;
  f108 = 0;
  /** Index de la pièce dans le LEV (pour les liens). */
  levIndex = -1;
}
