import type { Hy8Image } from "../../../../engine/infogrames/data/hy8";
import { SCREEN_WIDTH } from "../../../../engine/infogrames/data/mcg";
import type { VideoPlayer } from "../../../../engine/infogrames/video";
import type { Play } from "../game";
import type { Script } from "../runtime";
import { changeSesterces } from "../squares";
import { Anim, beginPlay, endPlay, waitFrame } from "./common";

/**
 * Mini-jeu « Les jeux olympiques » (case 33, `MDF/30`, segment `24a1` : `24a1:027a` et ses quatre fonctions).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m30.md`.
 *
 * Un lancer de javelot. La vidéo `m30a.mux` montre l'athlète qui prend son élan ; pendant sa course une jauge se
 * remplit, une case par image. Le joueur clique pour lancer : plus la jauge est pleine, plus le javelot va loin
 * (1 à 3 sesterces), mais trop tôt le lancer est trop court, et trop tard il n'y a pas de lancer du tout.
 */
export const MODULE = 30;

/**
 * Table `DS:310e` (20 mots) : valeur de la case de jauge `n`, 0 trop tôt, 1 à 3 la zone du lancer (et les sesterces
 * gagnés), 4 trop tard. L'indice 0 (jauge vide) n'est jamais lu. Copie de l'exécutable, vérifiée par le test contre
 * `ASTERIX.EXE` (à lire par `data/exe.ts`, décision D4, quand le fichier ne sera plus partagé entre agents).
 */
export const GAUGE_VALUES = [0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] as const;
/** Valeur à partir de laquelle un clic n'est plus accepté. */
export const TOO_LATE = 4;
/** Marqueurs `08` de la vidéo : 1 une case de jauge de plus (images 31 à 39), 2 l'instant du lancer (image 40). */
export const MARKER_STEP = 1;
export const MARKER_THROW = 2;
/** Une image tous les 4 ticks pendant le lancer (`1831:030a(4)`). */
export const FRAME_TICKS = 4;

/** Jauge : premier sprite brut des cases (images 16 à 20 de `m30s.hy8`, une par valeur), pas, ligne du bas. */
const GAUGE_IMAGE = 0x10;
const GAUGE_STEP = 0x10;
const GAUGE_X = 0x5d - 0x20;
const GAUGE_Y = 0x44;
/** Rectangle de la jauge recomposé sous l'athlète à chaque image (`1481:0a39(0x4b, 0x3a, 0xa6, 0xb)`). */
const GAUGE_RECT = { x: 0x4b, y: 0x3a, width: 0xa6, height: 0xb } as const;

/** Animations de `m30s.hy8` : le javelot qui se plante (20 images), l'athlète qui lance (6 images). */
const ANIM_LANDING = 0;
const ANIM_THROW = 1;
/** Ancre de l'athlète qui lance, sur le décor de la course. */
const THROW_X = 0x79;
const THROW_Y = 0x4b;
/** Point de chute par valeur de la jauge (`24a1:00c2`), avant le décalage (−32, −40) et le hasard. */
const LANDING_SHORT = [0x50, 0xc3] as const;
const LANDINGS: Readonly<Record<number, readonly [number, number]>> = { 1: [0x96, 0xa5], 2: [0xd7, 0x7d], 3: [0x113, 0x55] };
/** Hasard du point de chute : `rnd() % 40` en abscisse puis `rnd() % 30` en ordonnée. */
const LANDING_SPREAD_X = 0x28;
const LANDING_SPREAD_Y = 0x1e;
/** Attente sur le terrain vide avant la chute du javelot, en centièmes. */
const LANDING_DELAY = 0x50;

/** État du mini-jeu (globales `DS:7060` à `DS:7063`), exposé aux robots par `rt.hint.state`. */
export interface OlympiquesState {
  /** `DS:7061` : cases de jauge allumées (0 avant la course, 10 si personne n'a cliqué). */
  level: number;
  /** `DS:7060` : le joueur a cliqué, la jauge est figée. */
  clicked: boolean;
  /** `DS:7063` : la vidéo a été arrêtée à l'instant du lancer (il y a eu un clic). */
  stopped: boolean;
  /** Dernière image décodée de la vidéo (−1 avant la première). */
  frame: number;
}

/** Sesterces du lancer pour une jauge figée à `level` cases (0 : trop court). */
export function gainFor(level: number): number {
  const value = GAUGE_VALUES[level];
  return value > 0 && value < TOO_LATE ? value : 0;
}

/** `2b57:01d2(n, x, y, tampon, images)` : sprite brut posé dans un tampon, x = bord gauche, y = ligne du bas, 0 transparent. */
function blitInto(target: Uint8Array, image: Hy8Image, x: number, y: number): void {
  const top = y - image.height + 1;
  for (let row = 0; row < image.height; row++) {
    for (let col = 0; col < image.width; col++) {
      const value = image.pixels[row * image.width + col];
      if (value !== 0) target[(top + row) * SCREEN_WIDTH + x + col] = value;
    }
  }
}

/**
 * `1481:0a39(x, y, largeur, hauteur)` (`186c:0089`) : composition masquée du fond B sur le tampon A. Chaque pixel de B
 * est porté dans les couleurs 128..255 (`+0x80` s'il vaut `0x80` ou moins) et n'est écrit que là où A est lui-même dans
 * ces couleurs : ce que la vidéo dessine dans les couleurs 0..127 (l'athlète) reste devant.
 */
function composeMasked(target: Uint8Array, background: Uint8Array, x: number, y: number, width: number, height: number): void {
  for (let row = y; row < y + height; row++) {
    for (let i = row * SCREEN_WIDTH + x; i < row * SCREEN_WIDTH + x + width; i++) {
      if (target[i] < 0x80) continue;
      const value = background[i];
      target[i] = value <= 0x80 ? value + 0x80 : value;
    }
  }
}

/** `24a1:027a`. */
export function* olympiques(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources, palette, fade, voice, input } = rt.ctx;
  const player = board.player;
  yield* rt.fadeOut(16);
  const [throwSound, landingSound, sheet, track, field] = yield* rt.load(
    Promise.all([
      resources.sound("m30b0000.voc"),
      resources.sound("m30b0001.voc"),
      resources.hy8("m30s.hy8"),
      resources.picture("m30da001.mcc"),
      resources.picture("m30da002.mcc"),
    ]),
  );
  // Le décor de la course va dans le fond B, le terrain dans C ; la palette du terrain, recopiée dans les couleurs
  // 128..255, est envoyée sur l'écran noir (la vidéo apporte ensuite la sienne).
  surface.background.set(track.pixels);
  palette.load(field.palette);
  palette.colors.copyWithin(384, 0, 384);
  fade.reset();

  const s: OlympiquesState = { level: 0, clicked: false, stopped: false, frame: -1 };

  /** `24a1:01f9` : le clic fige la jauge tant qu'elle n'est pas « trop tard » ; les marqueurs la remplissent, puis lancent. */
  const judge = (video: VideoPlayer, button: boolean): void => {
    if (s.level > 0 && GAUGE_VALUES[s.level] < TOO_LATE && button) s.clicked = true;
    const marker = video.marker;
    if (marker !== MARKER_STEP && marker !== MARKER_THROW) return;
    video.marker = 0;
    if (marker === MARKER_THROW && s.clicked) s.stopped = true;
    else if (!s.clicked) s.level++;
  };

  /** `24a1:01a0` : les cases allumées sont posées dans le fond B, puis la bande de la jauge est recomposée sous l'athlète. */
  const gauge = (buffer: Uint8Array): void => {
    for (let i = 1; i <= s.level; i++) blitInto(surface.background, sheet.images[GAUGE_VALUES[i] + GAUGE_IMAGE], i * GAUGE_STEP + GAUGE_X, GAUGE_Y);
    composeMasked(buffer, surface.background, GAUGE_RECT.x, GAUGE_RECT.y, GAUGE_RECT.width, GAUGE_RECT.height);
  };

  // `1948:04cc("m30a.mux", 0x20080, 24a1:0254)` : la vidéo se décode sur le tampon A, le rappel `24a1:0254` compose la
  // jauge et présente à chaque image décodée. Ni bouton ni Échap ne l'interrompent : seul le rappel l'arrête.
  const buffer = new Uint8Array(surface.work.length);
  let pressed = false;
  beginPlay(rt, MODULE, s);
  yield* rt.video("m30a.mux", {
    skip: "none",
    target: buffer,
    poll: () => s.stopped,
    draw: (video) => {
      // Un clic ne reste en file qu'un tick : il est retenu jusqu'à l'image suivante (`DS:4b6b == 1` : bouton gauche).
      if (rt.click() !== null) pressed = true;
      if (video.shown !== s.frame) {
        s.frame = video.shown;
        judge(video, pressed || input.pressed("validate"));
        pressed = false;
        if (s.level !== 0) gauge(buffer);
      }
      surface.work.set(buffer);
    },
  });
  endPlay(rt);

  if (s.stopped) {
    // `24a1:000d` : l'athlète lance devant le panneau (la jauge reste dans le fond), puis le javelot se plante sur le terrain.
    const javelin = new Anim(sheet);
    javelin.select(ANIM_THROW);
    voice.play(throwSound);
    do {
      rt.restore();
      javelin.step();
      javelin.draw(rt, THROW_X, THROW_Y);
      yield* waitFrame(FRAME_TICKS);
    } while (!javelin.wrapped);
    surface.background.set(field.pixels);
    rt.restore();
    yield* rt.wait(LANDING_DELAY);
    javelin.select(ANIM_LANDING);
    const [baseX, baseY] = LANDINGS[GAUGE_VALUES[s.level]] ?? LANDING_SHORT;
    const x = baseX + (rt.rnd() % LANDING_SPREAD_X);
    const y = baseY + (rt.rnd() % LANDING_SPREAD_Y);
    voice.play(landingSound);
    do {
      rt.restore();
      javelin.step();
      javelin.draw(rt, x - 0x20, y - 0x28);
      yield* waitFrame(FRAME_TICKS);
    } while (!javelin.wrapped);
    yield* rt.waitSound();
    const gain = gainFor(s.level);
    if (gain > 0) yield* changeSesterces(rt, player, gain, true);
    yield* rt.cleanup();
  }
  yield* rt.fadeOut(16);
  yield* rt.waitSound();
}
