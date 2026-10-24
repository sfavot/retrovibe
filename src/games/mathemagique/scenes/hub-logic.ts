/**
 * Logique pure du hub (Control Room, scène 0) : tables de zones, séquences secrètes, invite « quitter ». Aucune dépendance au rendu
 * ni au moteur, hormis les identifiants de scène : tout se teste sans archive (`docs/mathemagique/screens/common.md` §2, §4, §7).
 */
import { HotspotTable } from "../engine/gadgets";
import { SceneId } from "../engine/scene";
import type { KeyEvent } from "../engine/input";

/** Rectangle `[gauche, haut, droite, bas]` des tables de l'original. */
export type Edges = readonly [number, number, number, number];

// --- Groupe 0 : objets du décor (`DS:0c70`, 14 enregistrements, rappel `1020:098a`) ---

/** Indices 1 à 14 de la table `DS:0c70`. */
export const HUB_OBJECT = {
  whistle: 1,
  skylight1: 2,
  skylight2: 3,
  skylight3: 4,
  skylight4: 5,
  easel: 6,
  gear: 7,
  shelf: 8,
  frame: 9,
  curtain: 10,
  television: 11,
  polyHead: 12,
  polyBody: 13,
  fullScreen: 14,
} as const;

export const HUB_OBJECT_EDGES: readonly Edges[] = [
  [152, 317, 228, 403],
  [94, 0, 488, 25],
  [106, 25, 475, 50],
  [129, 50, 452, 75],
  [174, 75, 404, 96],
  [78, 62, 141, 187],
  [233, 111, 369, 204],
  [371, 80, 490, 192],
  [156, 214, 235, 293],
  [270, 209, 406, 341],
  [459, 225, 560, 383],
  [73, 245, 131, 321],
  [56, 321, 149, 398],
  [0, 0, 576, 432],
];

/** Activité lancée par un objet du décor (indices 2 à 11) et animation de départ (`SCR` de `MAINSCRN.DAT`). */
export interface HubLaunch {
  scene: SceneId;
  departure: number;
}

const SKYLIGHT: HubLaunch = { scene: SceneId.patternWindows, departure: 9200 };

/** Table de saut `CS:0d86` + animations de départ (§2.4.1). */
export const HUB_LAUNCH: Readonly<Record<number, HubLaunch>> = {
  [HUB_OBJECT.skylight1]: SKYLIGHT,
  [HUB_OBJECT.skylight2]: SKYLIGHT,
  [HUB_OBJECT.skylight3]: SKYLIGHT,
  [HUB_OBJECT.skylight4]: SKYLIGHT,
  [HUB_OBJECT.easel]: { scene: SceneId.sticklers, departure: 9300 },
  [HUB_OBJECT.gear]: { scene: SceneId.rhythm, departure: 1200 },
  [HUB_OBJECT.shelf]: { scene: SceneId.rockets, departure: 9100 },
  [HUB_OBJECT.frame]: { scene: SceneId.patterns, departure: 9000 },
  [HUB_OBJECT.curtain]: { scene: SceneId.bowling, departure: 1000 },
  [HUB_OBJECT.television]: { scene: SceneId.hidden, departure: 8900 },
};

/** Animation jouée au retour d'une activité (le rideau se referme, l'engrenage se referme) ; les autres n'en ont pas. */
export const HUB_RETURN_CLIP: Readonly<Partial<Record<SceneId, number>>> = {
  [SceneId.bowling]: 1100,
  [SceneId.rhythm]: 1300,
};

// --- Groupe 1 : boutons du pupitre (`DS:0d98`, rappel `1020:0e7b`) ---

export const HUB_CONSOLE = { quit: 1, help: 2, signIn: 3 } as const;

export const HUB_CONSOLE_EDGES: readonly Edges[] = [
  [155, 345, 191, 380],
  [192, 345, 228, 380],
  [229, 345, 265, 380],
];

/** Formes (`SHPL 200`) au repos et enfoncée de chaque bouton : Quit (rouge / vert), Help (sourire / rire), Sign-in (crayon). */
export const HUB_CONSOLE_SHAPES: readonly { normal: number; pressed: number; x: number; y: number }[] = [
  { normal: 200, pressed: 201, x: 160, y: 345 },
  { normal: 202, pressed: 203, x: 194, y: 345 },
  { normal: 204, pressed: 205, x: 229, y: 345 },
];

/** Sons d'appui : Quit 3057, Help 3012 ou 3013 (tiré à 50 %), Sign-in 3020. */
export const HUB_QUIT_SOUND = 3057;
export const HUB_HELP_SOUNDS: readonly [number, number] = [3012, 3013];
export const HUB_SIGNIN_SOUND = 3020;

// --- Groupe 3 : « jouets » du décor (`DS:0e20`, rappel `1020:172e`) ---

/** Interrupteur d'ambiance basculé par un levier. */
export type HubSwitch = "skylight" | "butterfly" | "easel" | "television";

export interface HubToy {
  edges: Edges;
  /** `SCR` joué (zone et sons dans le script). */
  clip: number;
  /** Interrupteur basculé à la fin de l'animation (leviers 1 à 4). */
  lever?: HubSwitch;
}

export const HUB_TOYS: readonly HubToy[] = [
  { edges: [16, 23, 44, 117], clip: 9800 },
  { edges: [258, 80, 573, 112], clip: 9900 },
  { edges: [189, 383, 219, 401], clip: 9700, lever: "skylight" },
  { edges: [156, 396, 186, 415], clip: 9600, lever: "butterfly" },
  { edges: [1, 203, 54, 391], clip: 10400 },
  { edges: [64, 194, 151, 226], clip: 10400 },
  { edges: [65, 397, 90, 424], clip: 9400, lever: "easel" },
  { edges: [98, 398, 126, 415], clip: 9500, lever: "television" },
  { edges: [521, 42, 573, 80], clip: 10000 },
];

// --- Aide (`DS:1050`, 15 zones) ---

export const HUB_HELP_ZONE = {
  polyHead: 1,
  polyBody: 2,
  quit: 3,
  help: 4,
  signIn: 5,
  skylight: [6, 7, 8, 9],
  easel: 10,
  gear: 11,
  shelf: 12,
  frame: 13,
  curtain: 14,
  television: 15,
} as const;

export const HUB_HELP_EDGES: readonly Edges[] = [
  [73, 245, 131, 321],
  [56, 321, 149, 398],
  [160, 345, 195, 379],
  [194, 345, 229, 379],
  [229, 345, 264, 379],
  [94, 0, 488, 25],
  [106, 25, 475, 50],
  [129, 50, 452, 75],
  [174, 75, 404, 96],
  [78, 62, 141, 187],
  [233, 111, 369, 204],
  [371, 80, 490, 192],
  [156, 214, 235, 293],
  [270, 209, 406, 341],
  [459, 225, 560, 383],
];

/** Première zone qui montre le curseur « ? » : Poly (zones 1 et 2) garde la flèche. */
export const HUB_HELP_FIRST_CURSOR_ZONE = 3;

/** Clips d'explication par zone (index = zone - 1) ; un clic pendant un clip passe au suivant de la chaîne. Poly (1, 2) : cas à part. */
export const HUB_HELP_CHAINS: readonly (readonly number[])[] = [
  [],
  [],
  [8800],
  [4800, 4900],
  [8100],
  [3600, 3700],
  [3600, 3700],
  [3600, 3700],
  [3600, 3700],
  [4400, 4500, 4600, 4700],
  [4100, 4200, 4300],
  [3800, 3900],
  [3400, 3500],
  [3000, 3100],
  [3200, 3300],
];

export function createHubHelpTable(): HotspotTable {
  return HotspotTable.fromEdges(HUB_HELP_EDGES);
}

// --- Poly : clips ---

/** Accueil (tiré à chaque entrée) ; 5000 sert aussi de « connecte-toi d'abord » (§2.6). */
export const HUB_WELCOME_CLIPS: readonly number[] = [5000, 5100, 5200, 5300];
/** Salutation après une connexion. */
export const HUB_GREETING_CLIPS: readonly number[] = [5400, 5500, 5600, 5700];
/** Clips d'attente, tirés sans répétition. */
export const HUB_IDLE_CLIPS: readonly number[] = [6000, 6100, 2700, 2800, 2900];
export const HUB_INTRO_CLIP = 5800;
export const HUB_HELP_INTRO_CLIP = 4800;
export const HUB_TRIVIA_HMM_CLIP = 5900;
/** Phrases d'attente : 24 sons (3065 à 3088), 4 tirés à chaque entrée. */
export const HUB_CHATTER_FIRST = 3065;
export const HUB_CHATTER_COUNT = 24;
export const HUB_CHATTER_PICKED = 4;

/** Délais en ticks (`1346` : clip d'attente 240–480 ; `1380` : phrase d'attente 180–360 ; rappel « quitter » 240). */
export const HUB_IDLE_CLIP_DELAY = [240, 480] as const;
export const HUB_CHATTER_DELAY = [180, 360] as const;
export const HUB_QUIT_REMINDER_DELAY = 240;
/** Inactivité (30 min) au-delà de laquelle Poly ne bavarde plus. */
export const HUB_INACTIVITY_TICKS = 108_000;
/** Inactivité en mode aide après laquelle l'introduction est rejouée. */
export const HUB_HELP_REPEAT_TICKS = 300;

// --- Sifflet (sortie) ---

export const HUB_WHISTLE = { appear: 10300, confirm: 10100, rewind: 10200 } as const;
export const HUB_QUIT_REMINDERS: readonly number[] = [8300, 8400];

/**
 * Invite « quitter » en deux temps (§7) : le bouton Quit fait apparaître le sifflet (`prompt`), le sifflet confirme (`leaving`), un clic
 * ailleurs annule (retour à `idle`). Ctrl+Q ne passe pas par là (sortie directe du moteur).
 */
export class QuitPrompt {
  phase: "idle" | "prompt" | "leaving" = "idle";

  /** Bouton Quit : ouvre l'invite. Faux si elle est déjà ouverte (ou si la sortie est en cours). */
  ask(): boolean {
    if (this.phase !== "idle") return false;
    this.phase = "prompt";
    return true;
  }

  /** Clic sur le sifflet : vrai si la sortie est confirmée. */
  confirm(): boolean {
    if (this.phase !== "prompt") return false;
    this.phase = "leaving";
    return true;
  }

  /** Clic ailleurs : referme l'invite. Faux s'il n'y en avait pas. */
  cancel(): boolean {
    if (this.phase !== "prompt") return false;
    this.phase = "idle";
    return true;
  }

  get open(): boolean {
    return this.phase === "prompt";
  }
}

// --- Séquences secrètes (§4.1, §4.3) ---

/**
 * Code de touche vu par le suivi des séquences (`1018:03fd`) : `WM_CHAR` donne le code ASCII (Ctrl + lettre : 1 à 26), les flèches et
 * F1–F12 donnent `VK + 0x7f`. `null` pour ce qui ne produit pas de caractère (Maj, Ctrl, touches mortes…).
 */
export function secretKeyCode(event: Pick<KeyEvent, "key" | "ctrl">): number | null {
  const { key } = event;
  if (key.length === 1) {
    const code = key.charCodeAt(0);
    if (event.ctrl && /^[a-zA-Z]$/.test(key)) return (code & 0x1f) || null;
    return code;
  }
  switch (key) {
    case "Enter":
      return 13;
    case "Tab":
      return 9;
    case "Backspace":
      return 8;
    case "Escape":
      return 27;
    case "ArrowLeft":
      return 0x25 + 0x7f;
    case "ArrowUp":
      return 0x26 + 0x7f;
    case "ArrowRight":
      return 0x27 + 0x7f;
    case "ArrowDown":
      return 0x28 + 0x7f;
  }
  const fn = /^F(\d{1,2})$/.exec(key);
  if (fn) {
    const n = Number(fn[1]);
    if (n >= 1 && n <= 12) return 0x70 + n - 1 + 0x7f;
  }
  return null;
}

/** Code de remise à zéro de l'historique : Ctrl+A. */
export const SECRET_RESET_CODE = 1;

/**
 * Historique des touches (`DS:4f1c`, `DS:0b73`) : `H = (H << 7) | (code & 0x7f)` puis `X ^= H`, sur 32 bits ; le code 1 (Ctrl+A) remet
 * `H` et `X` à zéro. Un code secret correspond quand le couple `(X, H)` égale celui de sa frappe depuis un historique vide.
 */
export class KeyHistory {
  h = 0;
  x = 0;

  push(code: number): void {
    if (code === SECRET_RESET_CODE) {
      this.reset();
      return;
    }
    this.h = ((this.h << 7) | (code & 0x7f)) >>> 0;
    this.x = (this.x ^ this.h) >>> 0;
  }

  reset(): void {
    this.h = 0;
    this.x = 0;
  }

  /** Alimente avec un événement clavier ; faux si la touche ne produit pas de code. */
  pushKey(event: Pick<KeyEvent, "key" | "ctrl">): boolean {
    const code = secretKeyCode(event);
    if (code === null) return false;
    this.push(code);
    return true;
  }

  /** Identifiant du `SHPL` (301 à 320) de la séquence tapée, `undefined` si aucune ne correspond. */
  match(): number | undefined {
    for (const secret of SECRETS) if (secret.x === this.x && secret.h === this.h) return secret.shpl;
    return undefined;
  }
}

/** Couple `(X, H)` obtenu en tapant `keys` depuis un historique vide. */
export function historyOf(keys: string): { x: number; h: number } {
  const history = new KeyHistory();
  for (const c of keys) history.push(c.charCodeAt(0));
  return { x: history.x, h: history.h };
}

export interface SecretCode {
  /** `SHPL` de la photo affichée dans l'écran du moniteur. */
  shpl: number;
  /** Frappes (minuscules) ; hypothèse : initiales des membres de l'équipe. */
  keys: string;
  x: number;
  h: number;
}

function secret(shpl: number, keys: string): SecretCode {
  return { shpl, keys, ...historyOf(keys) };
}

/**
 * Les 12 codes de deux lettres décodés (`common.md` §4.3, vérifiés par simulation). Les 7 autres (`SHPL` 301, 302, 304 à 308) ont un
 * préfixe de touches inconnu : non implémentés.
 */
export const SECRETS: readonly SecretCode[] = [
  secret(303, "mr"),
  secret(309, "hn"),
  secret(310, "pb"),
  secret(311, "ah"),
  secret(312, "mb"),
  secret(313, "mc"),
  secret(315, "cm"),
  secret(316, "sp"),
  secret(317, "ba"),
  secret(318, "mm"),
  secret(319, "dm"),
  secret(320, "je"),
];
