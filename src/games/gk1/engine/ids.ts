/**
 * Constantes de la machine virtuelle SCI2 (`docs/gk1/plan.md`, vague S1). Celles des formats de fichiers sont dans `data/ids.ts`.
 * Valeurs relues dans `engines/sci/engine/vm.h`, `vm_types.h`, `object.h`, `segment.h` et `kernel.h` de ScummVM (GPL v3 ou ultérieure).
 */

/** Nombre de cases (mots) de la pile de la machine virtuelle (`VM_STACK_SIZE` de ScummVM). */
export const STACK_SIZE = 0x1000;

/** Numéros de segments fixes. Le segment 0 est celui des entiers ; les scripts et leurs variables locales viennent ensuite. */
export const Segment = {
  Number: 0,
  Stack: 1,
  Clones: 2,
  Lists: 3,
  Nodes: 4,
  Arrays: 5,
  /** Bitmaps créés par le noyau (textes) ; 7 : réservé. */
  Bitmaps: 6,
  FirstDynamic: 8,
  /** Case de pile jamais écrite (variable temporaire après `link`). */
  Uninitialized: 0xffff,
} as const;

/**
 * Bits de la propriété `-info-` posés par l'interpréteur (`INFO_CLASS` et `INFO_CLONE` sont dans `data/ids.ts`) :
 * clone que `DisposeClone` doit laisser en place, objet graphique à redessiner, objet graphique présent à l'écran.
 */
export const INFO_NO_DISPOSE = 0x0002;
export const INFO_VIEW_VISIBLE = 0x0008;
export const INFO_VIEW_INSERTED = 0x0010;

/**
 * Propriétés d'un objet graphique dont l'écriture pose `INFO_VIEW_VISIBLE` : indices 26 à 44 (`Object::mustSetViewVisible` de
 * ScummVM, cas général de SCI2). Dans la classe `View` de ce CD ce sont `x` … `yStep` ; `plane` est à l'indice 25, juste
 * avant (vérifié par les tests). **Confirmé au rendu (vague G1)** : `AddScreenItem` et `UpdateScreenItem` baissent le bit, et les
 * scripts ne rappellent ensuite `UpdateScreenItem` que pour un objet modifié (une fois par image pour l'objet qui avance dans
 * la pièce 17, jamais pour les boutons immobiles de l'écran titre). La variante 24 à 43 de ScummVM est celle des jeux aux
 * sélecteurs de SCI3.
 */
export const VIEW_PROPERTY_FIRST = 26;
export const VIEW_PROPERTY_LAST = 44;

/** Script dont les variables locales sont les variables globales, et dont l'export 0 est l'objet du jeu. */
export const GAME_SCRIPT = 0;
export const GAME_OBJECT_EXPORT = 0;
/**
 * Langue du jeu : `language = 33` du `RESOURCE.CFG` de ce CD (codes téléphoniques : 1 anglais, 33 français, 34 espagnol,
 * 39 italien, 49 allemand). L'interpréteur d'origine la range au démarrage dans la propriété `printLang` de l'objet du jeu,
 * qui vaut 1 dans les scripts ; ceux-ci la relisent pour choisir une mise en page par langue (`engine.md` § 2).
 */
export const CONFIG_LANGUAGE = 33;
/** Variable globale où la bibliothèque de scripts de Sierra tient le numéro de la pièce courante (`curRoomNum`). */
export const GLOBAL_CURRENT_ROOM = 11;
/** Variable globale du mode des messages (`msgType` de la bibliothèque de Sierra), que le jeu fixe et relit lui-même. */
export const GLOBAL_MESSAGE_MODE = 90;
/** Variable globale de GK1 : la narratrice est doublée (réglage du jeu). */
export const GLOBAL_NARRATOR_VOICE = 166;
/** Valeurs de la globale `GLOBAL_MESSAGE_MODE` : bit 0 texte, bit 1 voix. */
export const MessageMode = { Text: 1, Speech: 2, Both: 3 } as const;
export type MessageMode = (typeof MessageMode)[keyof typeof MessageMode];

/** Types d'éléments d'un tableau (`Array`, `String`). */
export const ArrayType = { Int16: 0, Id: 1, Byte: 2, String: 3 } as const;
export type ArrayType = (typeof ArrayType)[keyof typeof ArrayType];

/** Profondeur maximale d'itérations imbriquées sur une même liste (`ListEachElementDo` dans un élément de la liste). */
export const LIST_MAX_RECURSION = 10;

/** `Platform` : sous-fonction « quelle plateforme » et réponse « DOS ». */
export const PLATFORM_GET = 0;
export const PLATFORM_DOS = 1;

/** `GetTime` : modes. */
export const GetTimeMode = { Ticks: 0, Time12: 1, Time24: 2, Date: 3 } as const;
/** Ticks par seconde de l'horloge du jeu. */
export const TICKS_PER_SECOND = 60;
/** Année d'origine des dates DOS de `GetTime`. */
export const DOS_EPOCH_YEAR = 1980;

/** `String Trim` : côtés à nettoyer. */
export const TRIM_RIGHT = 1;
export const TRIM_CENTER = 2;
export const TRIM_LEFT = 4;

/** Nombre maximal de mots d'arguments d'un sélecteur dans un `send` (garde-fou de ScummVM). */
export const SEND_MAX_ARGC = 0x800;
