import type { Sound } from "../../../../engine/infogrames/audio/sound";
import type { Hy8 } from "../../../../engine/infogrames/data/hy8";
import { SCREEN_WIDTH } from "../../../../engine/infogrames/data/mcg";
import { AnimationPlayer, SPRITE_MIRROR_X } from "../../../../engine/infogrames/sprites";
import type { Play } from "../game";
import { DOWN, LEFT, RIGHT, UP, type Script, type Zone } from "../runtime";
import { changeSesterces } from "../squares";
import { beginPlay, endPlay, flushInput, waitFrame } from "./common";

/**
 * Mini-jeu « Bagarre avec les Romains » (case 42, `MDF/32`, segment `26a6` : `26a6:0804` et ses quatre fonctions).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m32.md`.
 *
 * Le joueur, au centre, fait face à gauche ou à droite. Trois Romains arrivent tour à tour par les deux côtés, se mettent
 * en garde puis frappent. Il faut se tourner vers eux et les assommer avant leur coup, pendant 28 secondes ; un seul
 * coup reçu et c'est perdu. Le jeu se déroule dans une fenêtre, au milieu de la vidéo `M32AA` qui lui donne sa cadence.
 */
export const MODULE = 32;

/** Plus aucun Romain n'entre après ce nombre de secondes (chrono 2) ; le joueur gagne quand le dernier est tombé. */
export const DURATION = 0x1c;
/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;
/** Une image de jeu par image de la vidéo `M32AA` (9 images par seconde) ; après la vidéo, une toutes les 7 ticks. */
export const FALLBACK_TICKS = 7;
export const ROMANS = 3;

/** Côté d'un Romain (`DS:72a2`) : il arrive par la droite ou par la gauche. Le joueur l'atteint s'il regarde ce côté. */
export const FROM_RIGHT = 0;
export const FROM_LEFT = 1;
/** Regard du joueur (`DS:72a8`). Un Romain du côté `c` est en face quand le regard vaut `1 − c`. */
export const FACING_LEFT = 0;
export const FACING_RIGHT = 1;
/** Coup d'un Romain (`DS:72aa`) : coup haut (animation 10, paré par le coup de poing haut) ou coup bas (animation 8, paré par le bas). */
export const KIND_HIGH = 0;
export const KIND_LOW = 2;

/**
 * Animations du joueur (`m32sa000.hy8`, `DS:72ce`), à ajouter au regard : demi-tours (0 vers la droite, 1 vers la gauche),
 * attente, coup haut (8 images), coup bas (7 images), touché par un coup bas, touché par un coup haut.
 */
export const HERO_IDLE = 2;
export const HERO_HIGH = 4;
export const HERO_LOW = 6;
export const HERO_HIT_LOW = 8;
export const HERO_HIT_HIGH = 10;
/**
 * Animations d'un Romain (`m32sa001.hy8`, `DS:72c8`), à ajouter à son côté (et à son coup pour les deux premières) :
 * marche (6 images de 5 pixels), garde (1 image), coup bas (6 images), coup haut (8 images), assommé par un coup haut,
 * assommé par un coup bas (7 images).
 */
export const ROMAN_WALK = 0;
export const ROMAN_GUARD = 4;
export const ROMAN_LOW = 8;
export const ROMAN_HIGH = 10;
export const ROMAN_KO_HIGH = 12;
export const ROMAN_KO_LOW = 14;
/** Image de son animation où le coup d'un Romain porte, et image du coup du joueur qui assomme (lue à l'image suivante). */
const HIGH_HIT_FRAME = 4;
const LOW_HIT_FRAME = 2;
const PUNCH_FRAME = 2;

/** Joueur : ancre de son sprite. Romain `i` : ordonnée `0xb1 + 3 i`, abscisse d'entrée et pas d'un cycle de marche. */
const HERO_X = 0xa0;
const HERO_Y = 0xb4;
const ROMAN_Y = 0xb1;
const ROMAN_SPREAD = 3;
const ENTRY_RIGHT = 0x138;
const ENTRY_LEFT = 0xc0 - 0x78;
const STRIDE = 0x1e;
/** Le Romain s'arrête dès qu'il est à moins de 50 pixels de `0xc0`. */
const CENTRE_X = 0xc0;
const REACH = 0x32;
/** Décalage des abscisses des Romains (`x − 0x20`). */
const X_OFFSET = 0x20;

/** Fenêtre de jeu recopiée du tampon vers l'écran à chaque image (`1481:045e`) ; la vidéo occupe le reste. */
export const WINDOW = { x: 0x48, y: 0x30, width: 0xb6, height: 0x88 } as const;

/** Vidéo du perdant selon l'animation du joueur touché (`26a6:0b42`, indice `DS:72ce − 8`). */
const LOSS_VIDEOS = ["M32AE.mux", "M32AF.mux", "M32AC.mux", "M32AD.mux"] as const;

/**
 * Décision D11 : toucher ou cliquer un côté de l'écran. Du côté que le joueur regarde, c'est un coup (haut dans la moitié
 * haute de la fenêtre, bas dans la moitié basse) ; de l'autre côté, un demi-tour suivi du coup.
 */
const SPLIT_X = 0xa0;
const SPLIT_Y = 0x94;
export const TOUCH_ZONES: readonly Zone[] = [
  { x1: 0, y1: 0, x2: SPLIT_X - 1, y2: SPLIT_Y - 1 },
  { x1: 0, y1: SPLIT_Y, x2: SPLIT_X - 1, y2: 199 },
  { x1: SPLIT_X, y1: 0, x2: 319, y2: SPLIT_Y - 1 },
  { x1: SPLIT_X, y1: SPLIT_Y, x2: 319, y2: 199 },
];

/** Un Romain (`DS:72a2` à `DS:72c8`, un mot ou un octet par Romain). */
export interface Roman {
  /** `DS:72c2` : en scène. */
  active: boolean;
  /** `DS:72a2` : `FROM_RIGHT` ou `FROM_LEFT`. */
  side: number;
  /** `DS:72aa` : `KIND_HIGH` ou `KIND_LOW`. */
  kind: number;
  /** `DS:72b6` et `DS:72b0` : abscisse et pas d'un cycle de marche. */
  x: number;
  speed: number;
  /** `DS:72bc` : images avant l'entrée, puis avant le coup. */
  delay: number;
  /** `DS:72c8` et rang dans l'animation (`+0x16` de l'objet `DS:72d0 + 0x24 i`). */
  anim: number;
  frame: number;
}

/** État du mini-jeu (globales `DS:72a0` à `DS:72ce`), exposé aux robots par `rt.hint.state`. */
export interface BagarreState {
  /** `DS:72a0` : directions reçues depuis la dernière image où le joueur a pu agir. */
  input: number;
  /** `DS:72a8`. */
  facing: number;
  /** `DS:72ce` et rang dans l'animation (`DS:7352`). */
  heroAnim: number;
  heroFrame: number;
  /** `DS:72c5` : le joueur a reçu un coup. */
  heroHit: boolean;
  /** `DS:72c6` et `DS:72c7` : fin de la boucle. */
  lost: boolean;
  won: boolean;
  romans: Roman[];
  /** Images de jeu écoulées (repère du portage). */
  frames: number;
}

/** Vrai si le joueur attend, debout : la seule posture où une direction est prise en compte. */
export function heroIdle(state: BagarreState): boolean {
  return state.heroAnim === state.facing + HERO_IDLE && !state.heroHit;
}

/**
 * Objet animation du séquenceur `1345` avec les champs que ce mini-jeu lit en plus du sprite : le rang (`+0x16`) et le
 * déplacement cumulé de l'animation (`+0x1c`), remis à zéro quand elle boucle ou qu'on en choisit une autre.
 */
class Mover {
  private player: AnimationPlayer;
  sprite = 0;
  dx = 0;

  constructor(readonly sheet: Hy8) {
    this.player = new AnimationPlayer(sheet, 0);
  }

  /** `1345:0143(objet, n)`. */
  select(animation: number): void {
    this.player = new AnimationPlayer(this.sheet, animation);
    this.dx = 0;
  }

  /** `1345:00c0(objet)`. */
  step(): void {
    const frame = this.player.frame;
    if (frame) {
      this.dx += frame.dx;
      this.sprite = frame.sprite | (frame.flags & SPRITE_MIRROR_X);
    }
    this.player.advance();
    if (this.player.frameIndex === 0) this.dx = 0;
  }

  /** `+0x16` : 0 juste après le pas qui a montré la dernière image. */
  get frame(): number {
    return this.player.frameIndex;
  }
}

/** `26a6:0804`. */
export function* bagarre(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources, voice, input } = rt.ctx;
  const player = board.player;
  yield* rt.fadeOut(16);
  // Le décor va dans le tampon et dans le fond ; l'écran reste noir jusqu'à la première image de la vidéo.
  rt.draw(yield* rt.load(resources.picture("m32da000.mcc")), 4);
  surface.commitBackground();
  surface.clear();
  const [romanSheet, heroSheet, punchHighSound, punchLowSound, hitLowSound, hitHighSound] = yield* rt.load(
    Promise.all([
      resources.hy8("m32sa001.hy8"),
      resources.hy8("m32sa000.hy8"),
      resources.sound("m32b0006.voc"),
      resources.sound("b32-02a.voc"),
      resources.sound("m32b0000.voc"),
      resources.sound("m32b0002.voc"),
    ]),
  );

  const s: BagarreState = {
    input: 0,
    facing: FACING_LEFT,
    heroAnim: FACING_LEFT + HERO_IDLE,
    heroFrame: 0,
    heroHit: false,
    lost: false,
    won: false,
    romans: [],
    frames: 0,
  };
  const hero = new Mover(heroSheet);
  hero.select(s.heroAnim);
  hero.step();
  const movers: Mover[] = [];
  for (let i = 0; i < ROMANS; i++) {
    movers.push(new Mover(romanSheet));
    s.romans.push({ active: false, side: FROM_RIGHT, kind: KIND_HIGH, x: 0, speed: 0, delay: i * 10 + 0xf + (rt.rnd() % 5), anim: 0, frame: 0 });
  }
  yield* flushInput(rt);
  rt.startChrono(2);

  /** Vrai pendant la vidéo : les bruitages s'y mélangent (`2a28:0b3e`) ; après elle, ils prennent la voie (`16cb:08c9`). */
  let inVideo = true;
  const play32 = (sound: Sound): void => {
    if (inVideo) rt.effect(sound);
    else voice.play(sound);
  };
  const setHero = (animation: number): void => {
    s.heroAnim = animation;
    hero.select(animation);
  };
  const setRoman = (i: number, animation: number): void => {
    s.romans[i].anim = animation;
    movers[i].select(animation);
  };
  const anyRoman = (): boolean => s.romans.some((roman) => roman.active);
  const hitHero = (animation: number, sound: Sound): void => {
    setHero(s.facing + animation);
    s.heroHit = true;
    play32(sound);
  };

  /** `26a6:004b` : un Romain. Hors scène, il attend son tour ; en scène, il marche, se met en garde, frappe, ou tombe. */
  const stepRoman = (i: number): void => {
    const roman = s.romans[i];
    const mover = movers[i];
    if (!roman.active) {
      roman.delay--;
      if (s.heroHit || roman.delay > 0 || rt.chrono(2) >= DURATION) return;
      roman.active = true;
      roman.kind = rt.rnd() & 1 ? KIND_HIGH : KIND_LOW;
      if (rt.rnd() & 1) {
        roman.x = ENTRY_LEFT - i * ROMAN_SPREAD;
        roman.speed = STRIDE;
        roman.side = FROM_LEFT;
      } else {
        roman.x = ENTRY_RIGHT + i * ROMAN_SPREAD;
        roman.speed = -STRIDE;
        roman.side = FROM_RIGHT;
      }
      setRoman(i, roman.kind + roman.side);
      roman.frame = 0;
      return;
    }
    mover.step();
    roman.frame = mover.frame;
    if (mover.frame === 0 && roman.anim < ROMAN_GUARD) roman.x += roman.speed;
    rt.sprite(romanSheet, mover.sprite, roman.x + mover.dx - X_OFFSET, i * ROMAN_SPREAD + ROMAN_Y);
    // Le coup porte, sauf si le joueur est en train de donner le coup de poing de même hauteur vers ce Romain.
    if (roman.anim === roman.side + ROMAN_HIGH && mover.frame === HIGH_HIT_FRAME && 1 - roman.side + HERO_HIGH !== s.heroAnim) {
      hitHero(HERO_HIT_HIGH, hitHighSound);
    }
    if (roman.anim === roman.side + ROMAN_LOW && mover.frame === LOW_HIT_FRAME && 1 - roman.side + HERO_LOW !== s.heroAnim) {
      hitHero(HERO_HIT_LOW, hitLowSound);
    }
    if (mover.frame !== 0) return;
    // Fin d'une animation (table de sauts `26a6:0434`, par groupes de quatre).
    switch (roman.anim >> 2) {
      case 0: {
        // Marche : arrivé près du joueur, il se met en garde pour quelques images (moins au niveau Action élevé).
        if (Math.abs(roman.x + mover.dx - CENTRE_X) >= REACH) return;
        roman.x += mover.dx;
        setRoman(i, roman.kind + roman.side + ROMAN_GUARD);
        const draw = rt.rnd();
        roman.delay = (2 - player.action) * 3 + 2 + (draw % ((2 - player.action) * 2 + 2));
        return;
      }
      case 1:
        // Garde : le coup part quand le délai est écoulé (jamais après un coup reçu par le joueur).
        if (s.heroHit || --roman.delay > 0) return;
        setRoman(i, roman.side + (roman.kind === KIND_HIGH ? ROMAN_HIGH : ROMAN_LOW));
        return;
      case 2:
        // Coup donné : retour en garde (le délai est épuisé, le coup suivant part à l'image d'après).
        setRoman(i, roman.kind + roman.side + ROMAN_GUARD);
        return;
      default:
        // Assommé : il sort, et reviendra après 25 à 39 images selon le niveau.
        roman.active = false;
        roman.delay = (7 - player.action) * 5 + (rt.rnd() % 5);
    }
  };

  /** `26a6:0454` : commandes du joueur, Romains assommés, victoire, animation et dessin du joueur. */
  const stepHero = (): void => {
    if (s.heroAnim === s.facing + HERO_IDLE && !s.heroHit && (rt.chrono(2) < DURATION || anyRoman())) {
      if (s.input & (DOWN | UP)) {
        if (s.input & DOWN) setHero(s.facing + HERO_LOW);
        if (s.input & UP) setHero(s.facing + HERO_HIGH);
      } else {
        if (s.input & RIGHT && s.facing === FACING_LEFT) {
          setHero(0);
          s.facing = FACING_RIGHT;
        }
        if (s.input & LEFT && s.facing === FACING_RIGHT) {
          setHero(1);
          s.facing = FACING_LEFT;
        }
      }
    } else s.input = 0;
    // Le coup de poing porte à sa troisième image, sur tout Romain arrivé du côté regardé.
    s.romans.forEach((roman, i) => {
      if (!roman.active || hero.frame !== PUNCH_FRAME || roman.kind + roman.side === roman.anim || roman.side === s.facing) return;
      if (s.heroAnim === s.facing + HERO_LOW) {
        setRoman(i, roman.side + ROMAN_KO_LOW);
        play32(punchLowSound);
      }
      if (s.heroAnim === s.facing + HERO_HIGH) {
        setRoman(i, roman.side + ROMAN_KO_HIGH);
        play32(punchHighSound);
      }
    });
    if (!anyRoman() && !s.heroHit && s.heroAnim === s.facing + HERO_IDLE && rt.chrono(2) >= DURATION) s.won = true;
    hero.step();
    s.heroFrame = hero.frame;
    rt.sprite(heroSheet, hero.sprite, HERO_X, HERO_Y);
    if (hero.frame !== 0) return;
    if (s.heroHit) s.lost = true;
    else setHero(s.facing + HERO_IDLE);
  };

  /** Dernière image de la vidéo (l'écran hors de la fenêtre) et dernière fenêtre de jeu dessinée. */
  const screen = new Uint8Array(surface.work.length);
  const view = new Uint8Array(surface.work.length);
  /** Demi-tour demandé au toucher, avec le coup qui le suivra (D11). */
  let follow: { facing: number; punch: number; turning: boolean } | null = null;

  /** Une image de jeu (`26a6:078b`, ou le corps de la boucle de `26a6:0804`) : fond, Romains, joueur, fenêtre gardée. */
  const gameFrame = (): void => {
    if (follow) {
      if (s.heroHit) follow = null;
      else if (s.heroAnim < HERO_IDLE) follow.turning = true;
      else if (s.heroAnim !== s.facing + HERO_IDLE) follow = null;
      else if (follow.turning) {
        if (s.facing === follow.facing) s.input |= follow.punch;
        follow = null;
      }
    }
    rt.restore();
    for (let i = 0; i < ROMANS; i++) stepRoman(i);
    stepHero();
    s.frames++;
    for (let row = WINDOW.y; row < WINDOW.y + WINDOW.height; row++) {
      const start = row * SCREEN_WIDTH + WINDOW.x;
      view.set(surface.work.subarray(start, start + WINDOW.width), start);
    }
  };
  /** L'écran : la vidéo, et la fenêtre de jeu par-dessus. */
  const present = (): void => {
    surface.drawFullScreen(screen);
    rt.copyRect(view, WINDOW.x, WINDOW.y, WINDOW.x, WINDOW.y, WINDOW.width, WINDOW.height);
  };
  /** `26a6:000c` : directions cumulées dans `DS:72a0` ; le portage y ajoute le clic et le toucher. */
  const readInput = (): void => {
    s.input |= rt.dirs();
    const click = rt.click(TOUCH_ZONES);
    if (typeof click !== "number") return;
    const facing = click >> 1;
    const punch = click & 1 ? DOWN : UP;
    if (facing === s.facing) s.input |= punch;
    else {
      s.input |= facing === FACING_RIGHT ? RIGHT : LEFT;
      follow = { facing, punch, turning: false };
    }
  };

  beginPlay(rt, MODULE, s);
  // `1948:04cc("M32AA.MUX", 0x20104, 26a6:078b, 26a6:000c)` : la vidéo se décode à l'écran avec la palette du décor ;
  // le jeu avance d'une image à chaque image décodée et l'arrête dès qu'il est fini.
  let seen = -1;
  yield* rt.video("M32AA.MUX", {
    skip: "none",
    keepPalette: true,
    draw: (video) => {
      const last = Math.min(video.shown, video.frameCount - 1);
      for (; seen < last && !s.lost && !s.won; seen++) gameFrame();
      screen.set(video.pixels);
      present();
    },
    poll: () => {
      readInput();
      return s.lost || s.won;
    },
  });
  inVideo = false;
  // La vidéo est finie avant la partie : le jeu continue seul, sans plus lire les commandes ; trois Romains en scène
  // en même temps valent alors victoire.
  while (!s.lost && !s.won) {
    gameFrame();
    present();
    if (!s.won && s.romans.every((roman) => roman.active)) s.won = true;
    yield* waitFrame(FALLBACK_TICKS);
  }
  endPlay(rt);

  yield* rt.cleanup();
  present();
  yield* rt.fadeOut(16);
  // `15d7:08e9(nom)` : boutons et Échap relâchés, puis la vidéo plein écran, interruptible.
  const result = s.won ? "M32AB.mux" : LOSS_VIDEOS[s.heroAnim - HERO_HIT_LOW];
  if (result) {
    while (rt.buttonHeld || input.pressed("skip")) yield;
    yield* rt.video(result);
  }
  if (s.won) yield* changeSesterces(rt, player, GAIN, true);
}
