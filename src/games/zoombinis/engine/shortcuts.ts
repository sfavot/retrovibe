/**
 * Raccourcis clavier généraux de Zoombinis (`1198:05b3`, `docs/zoombinis/engine.md` §7.2, `docs/zoombinis/screens.md` §5.2) : touches non
 * consommées par l'écran (gestionnaire « après » du moteur). Les actions de menu (nouvelle partie, charger, enregistrer) ne sont actives que
 * sur les écrans 1 à 18 ; les bascules d'options affichent leur message de `STRL` 2023 (`1168:2117` : plaque au bas de l'écran pendant 90 ticks).
 *
 * Touches (la lettre tapée compte, pas la touche physique : clavier AZERTY compris) :
 *  - `Ctrl+N` nouvelle partie ; `Ctrl+C` / `Ctrl+L` charger ; `Ctrl+S` enregistrer ; `Ctrl+Q` quitter ;
 *  - `Ctrl+V` / `Ctrl+B` musique (`DS:a43b`, messages « musique activée / désactivée »), `Ctrl+Y` voix et effets (`DS:a43a`, « sonores … ») : le code, pas les libellés
 *    du menu (« Dialogues & effets (ctrl v) », « Musique de fond (ctrl y) ») ;
 *  - `Ctrl+T` transitions, `Ctrl+J` souris aimantée (sans effet dans le navigateur), `Ctrl+U` auto-aimantation, `Ctrl+G` « moins d'action », `Ctrl+H` curseur ;
 *  - `Ctrl+I` « À propos » (`1198:0213`) ; `/` et `?` ouvrent le menu.
 * `Ctrl+D`, `Ctrl+E` et `Ctrl+F` (changement de langue, `11a0:4346`) sont sans objet. `Ctrl+R` (enregistrer dans l'original, aussi) reste au navigateur.
 *
 * Codes secrets et mode de test (`screens.md` §1.7, `engine.md` §7.2) :
 *  - toute touche qui donne un caractère (`WM_CHAR`, code < 0x100 : `charCodeOf`) est ajoutée au condensat de la session (`10a8:03d9`, `typeSecretKey`) avant
 *    l'écran ; `Ctrl+A` (code 1) le remet à zéro. La carte le lit pour les écrans cachés 19 et 20 (`game/route.ts`, `mapClick`) ;
 *  - `Espace` non consommé par l'écran : si le condensat est celui du mode de test, `[a43f]` est levé et la plaque affiche « you got it » (`1198:0640`) ; sinon,
 *    celui du test MIDI bascule `[a1f2]` (« midi test on / off ») ; sinon, test MIDI actif : `Espace` rejoue le morceau courant de la liste `DS:3e16` (18 `tMID`),
 *    `Maj+Espace` passe au suivant, et la plaque affiche « midi test:<id> » (`11a8:360b(…, 3)`) ;
 *  - en mode de test seulement : `@` marque l'étape 1, l'étape 2 et l'étape 4 réussies au niveau 0 (bit 0 de `S+0x50`, `S+0x52`, `S+0x51`, `1198:071d`) ; `&` peint
 *    les 256 couleurs de la palette en carrés de 8 × 8 en haut à gauche (`1148:16d0`).
 * Écarts (sans objet dans le navigateur, ou outils du moteur non portés ; `docs/zoombinis/engine-ts.md` « Mode de test ») : `^` (affichage de la mémoire libre,
 * `DS:22e6`, « Free:… »), `P` (cadence), `S` (numéros des sons joués), `[` / `]` (pas à pas), `=` et `Ctrl+Z` (redessin de l'écran, `DS:3fc0`), `Ctrl+X`, `*`
 * (`DS:3e3a`, période d'attente `DS:235c` à 0), `N` (graphe `NODE` / `PATH` de l'écran). Les caractères tapés pendant qu'une boîte de dialogue est ouverte
 * n'entrent pas dans le condensat (la boîte prend la touche avant ; l'original les compte aussi).
 *
 * Écart : l'original affiche « curseur masqué / affiché » d'après `DS:a43d`, dont la seule lecture (`1168:58c7`, `10f8:6cdf`) masque le pointeur
 * **pendant le transport d'une pièce** ; le curseur n'est donc pas masqué partout et aucun type de curseur « caché » n'est ajouté. L'option `hideCursorWhileCarrying`
 * a le sens de `DS:a43d` (voir `docs/zoombinis/engine-ts.md`).
 */
import type { KeyEvent } from "../../../engine/mohawk/input";
import { SECRET_MIDI_TEST, SECRET_TEST_MODE, secretMatches, typeSecretKey } from "../game/route";
import { testMode } from "../game/state";
import type { ZoombinisContext } from "./context";
import { DIALOG, letterOf, type OptionKey } from "./dialog";
import type { ZoombinisEngine } from "./engine";
import { ZOOMBINIS_GAME } from "./game";
import { defineService } from "./scene";
import { GRAPHICS } from "./services";
import { ZOOMBINIS_SOUND } from "./sound";
import { TextFlags, ZOOMBINIS_TEXT } from "./text";

/** Message de `STRL` 2023 (indice 1-based) et plaque (`1168:2117`, type 1 ou 2) de chaque bascule, d'après la nouvelle valeur de l'option. */
const OPTION_MESSAGES: Readonly<Record<OptionKey, { type: 0 | 1 | 2; message: (value: boolean) => number }>> = {
  music: { type: 2, message: (on) => (on ? 1 : 2) },
  effects: { type: 2, message: (on) => (on ? 3 : 4) },
  lessAction: { type: 2, message: (less) => (less ? 5 : 6) },
  hideCursorWhileCarrying: { type: 1, message: (hide) => (hide ? 7 : 8) },
  magneticMouse: { type: 2, message: (on) => (on ? 9 : 10) },
  transitionsOff: { type: 2, message: (off) => (off ? 12 : 11) },
  autoMagnet: { type: 2, message: (on) => (on ? 13 : 14) },
};

/** Lettre (avec Ctrl) → option basculée. */
const OPTION_KEYS: Readonly<Record<string, OptionKey>> = {
  v: "music",
  b: "music",
  y: "effects",
  t: "transitionsOff",
  j: "magneticMouse",
  u: "autoMagnet",
  g: "lessAction",
  h: "hideCursorWhileCarrying",
};

/** Lettres des raccourcis `Ctrl+lettre` du jeu (options, menu, `1198:05b3`) et `Ctrl+W` des mascottes du choix (`1128:05dc`). */
const CTRL_LETTERS = new Set([...Object.keys(OPTION_KEYS), "n", "c", "l", "s", "q", "i", "w"]);

/**
 * Vrai si `Ctrl+touche` est un raccourci du jeu : l'hôte du navigateur empêche alors l'action par défaut quand il le peut
 * (`Ctrl+N`, `Ctrl+T` et `Ctrl+W` restent au navigateur sous Windows et Linux, qui ne les cède pas).
 */
export function isShortcutCtrlKey(event: { key: string }): boolean {
  return event.key.length === 1 && CTRL_LETTERS.has(event.key.toLowerCase());
}

/** Durée de la plaque des messages du mode de test (`1168:2117(1, 0x5a, …)`). */
const TEST_MESSAGE_TYPE = 1;
/** Morceaux du test MIDI (`DS:3e16`, 18 mots) : les `tMID` de `MIDIMPC.MHK`. */
export const MIDI_TEST_SONGS: readonly number[] = [
  30000, 30001, 30020, 30021, 30022, 30023, 30025, 30026, 30027, 30028, 30030, 30031, 30032, 30033, 30035, 30036, 30037, 30038,
];

/**
 * Code `WM_CHAR` d'une touche : caractère < 0x100 (`Ctrl+lettre` donne 1 à 26, `Entrée` 0x0d, `Retour arrière` 8, `Tab` 9, `Échap` 0x1b), ou null pour une touche
 * qui ne produit pas de caractère (elle n'arrive à `1198:05b3` que par `WM_KEYDOWN`, en code + 0xff, et n'entre pas dans le condensat). `Alt Gr` (Ctrl + Alt) donne
 * son caractère.
 */
export function charCodeOf(event: KeyEvent): number | null {
  if (event.ctrl && !event.alt) {
    const letter = letterOf(event);
    return letter !== null && letter >= "a" && letter <= "z" ? letter.charCodeAt(0) & 0x1f : null;
  }
  switch (event.key) {
    case "Enter":
      return 0x0d;
    case "Backspace":
      return 0x08;
    case "Tab":
      return 0x09;
    case "Escape":
      return 0x1b;
  }
  if (event.key.length !== 1) return null;
  const code = event.key.charCodeAt(0);
  return code < 0x100 ? code : null;
}

/** Rectangle de la ligne d'état du mode de test (`DS:3d0e`). */
const DEBUG_LINE = { x: 0, y: 0, w: 310, h: 16 } as const;
/** Fond (`11e8:3034(…, 0xff)`) et encre (`11e8:7c08(0)`) de la ligne d'état. */
const DEBUG_LINE_FILL = 0xff;
const DEBUG_LINE_INK = 0;

/**
 * `1198:03cf` : ligne d'état du mode de test, en haut à gauche de l'écran (rectangle `DS:3d0e`, 310 × 16, fond 0xff, texte centré `11e8:5d70(…, 0x22, …)`) ; sans
 * effet hors du mode de test. Dessinée sur l'écran, elle reste jusqu'au prochain dessin de cette zone (le port recompose l'écran entier à chaque changement d'une
 * feature : elle s'efface plus tôt que dans l'original). Textes du programme, en anglais (« Snoids to practice with = », « Which Transition (a-p): »…).
 */
export function showDebugLine(ctx: ZoombinisContext, text: string): void {
  if (!testMode(ctx.services.get(ZOOMBINIS_GAME).game)) return;
  const screen = ctx.services.get(GRAPHICS).screen;
  screen.fill(DEBUG_LINE_FILL, DEBUG_LINE);
  ctx.services.tryGet(ZOOMBINIS_TEXT)?.drawText(screen, "small", text, DEBUG_LINE, TextFlags.center | TextFlags.vcenter, DEBUG_LINE_INK);
  ctx.requestPresent();
}

export class Shortcuts {
  /** `DS:a1f2` : test MIDI actif ; `DS:a1f4` : morceau courant (indice dans `MIDI_TEST_SONGS`). */
  midiTest = false;
  midiSong = 0;

  /** `10a8:03d9` en tête de `1198:05b3` : ajoute le caractère de la touche au condensat (ne consomme jamais la touche). */
  record(ctx: ZoombinisContext, event: KeyEvent): void {
    const code = charCodeOf(event);
    if (code !== null) typeSecretKey(ctx.services.get(ZOOMBINIS_GAME).session.secret, code);
  }

  /** Traite une touche non consommée ; vrai si c'est un raccourci. */
  handle(ctx: ZoombinisContext, event: KeyEvent): boolean {
    const dialogs = ctx.services.get(DIALOG);
    const code = charCodeOf(event);
    if (code === 0x20) return this.space(ctx, event);
    if (code !== null && this.testKey(ctx, code)) return true;
    if (!event.ctrl && !event.alt && (event.key === "/" || event.key === "?")) {
      dialogs.openMenu(ctx);
      return true;
    }
    if (!event.ctrl || event.alt) return false;
    const letter = letterOf(event);
    if (letter === null) return false;
    const option = OPTION_KEYS[letter];
    if (option) {
      const value = dialogs.toggleOption(ctx, option);
      const { message, type } = OPTION_MESSAGES[option];
      dialogs.showMessage(ctx, message(value), type);
      return true;
    }
    switch (letter) {
      case "n":
        dialogs.newGame(ctx);
        return true;
      case "c":
      case "l":
        dialogs.openLoad(ctx);
        return true;
      case "s":
        dialogs.openSave(ctx);
        return true;
      case "q":
        dialogs.quit(ctx);
        return true;
      case "i":
        dialogs.openAbout(ctx);
        return true;
      default:
        return false;
    }
  }

  /** `1198:0640` à `1198:0705` : `Espace` (code 0x20) non consommé par l'écran ; vrai s'il a servi. */
  private space(ctx: ZoombinisContext, event: KeyEvent): boolean {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const dialogs = ctx.services.get(DIALOG);
    const secret = zoombinis.session.secret;
    if (secretMatches(secret, SECRET_TEST_MODE)) {
      zoombinis.game.options.testMode = true;
      dialogs.showMessage(ctx, "you got it", TEST_MESSAGE_TYPE);
      return true;
    }
    if (secretMatches(secret, SECRET_MIDI_TEST)) {
      this.midiTest = !this.midiTest;
      if (this.midiTest) this.midiSong = 0;
      dialogs.showMessage(ctx, this.midiTest ? "midi test on" : "midi test off", TEST_MESSAGE_TYPE);
      return true;
    }
    if (!this.midiTest) return false;
    // `1148:0566(0) == 0x800` : `Maj` seule tenue avance d'un morceau.
    if (event.shift) this.midiSong += 1;
    if (this.midiSong >= MIDI_TEST_SONGS.length || this.midiSong < 0) this.midiSong = 0;
    const song = MIDI_TEST_SONGS[this.midiSong]!;
    ctx.services.get(ZOOMBINIS_SOUND).queue(song);
    dialogs.showMessage(ctx, `midi test:${song}`, TEST_MESSAGE_TYPE);
    return true;
  }

  /** Touches du mode de test de `1198:05b3` portées (`@`, `&`) ; rien hors du mode de test. */
  private testKey(ctx: ZoombinisContext, code: number): boolean {
    const game = ctx.services.get(ZOOMBINIS_GAME).game;
    if (!testMode(game)) return false;
    switch (code) {
      case 0x40: // `@` (`1198:071d`)
        game.masks.stage1 |= 1;
        game.masks.stage2 |= 1;
        game.masks.stage4 |= 1;
        return true;
      case 0x26: // `&` (`1148:16d0`)
        drawPalette(ctx);
        return true;
      default:
        return false;
    }
  }
}

/** `1148:16d0` : les 256 indices de palette en carrés de 8 × 8, 32 par ligne, en haut à gauche de l'écran. */
function drawPalette(ctx: ZoombinisContext): void {
  const screen = ctx.services.get(GRAPHICS).screen;
  for (let i = 0; i < 0x100; i++) screen.fill(i, { x: (i & 0x1f) * 8, y: ((i & 0xe0) >> 5) * 8, w: 8, h: 8 });
  ctx.requestPresent();
}

export const SHORTCUTS = defineService<Shortcuts>("zoombinis.shortcuts");

/**
 * Ajoute le gestionnaire de touches « après l'écran » (après `installDialog`, qui prend les touches pendant qu'une boîte est ouverte). Sans effet si déjà installé.
 * Le moteur commun ne permet pas d'empêcher l'action par défaut du navigateur : c'est l'hôte (`ui/mohawk/browser-host.ts`, `gameOwnsKey`) qui décide.
 */
export function installShortcuts(engine: ZoombinisEngine): Shortcuts {
  const existing = engine.services.tryGet(SHORTCUTS);
  if (existing) return existing;
  const shortcuts = new Shortcuts();
  engine.services.provide(SHORTCUTS, shortcuts);
  // Le condensat des codes secrets voit toutes les touches (avant l'écran), sans les consommer.
  engine.addKeyHandler("before", (event, ctx) => {
    shortcuts.record(ctx, event);
    return false;
  });
  engine.addKeyHandler("after", (event, ctx) => shortcuts.handle(ctx, event));
  return shortcuts;
}
