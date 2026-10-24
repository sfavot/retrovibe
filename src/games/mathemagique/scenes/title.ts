/**
 * Écran titre (scène 8, `TITLE.DAT`) : logo « Brøderbund PRESENTS » à la première entrée seulement, maison orange avec ses 9 animations en
 * boucle et l'horloge de la façade (heure système), musique `\0SND` 1000 ; la porte (et la fin de la musique) mène au hub, la plaque aux
 * crédits (`docs/mathemagique/screens/common.md` §1, `1068:0364` / `1068:05af`).
 *
 * Machine à états (aucune boucle bloquante) : `logo` → `logoOut` → `intro` → `title` → `door` → `leaving`. Les fondus sont ceux du palette
 * (30 ticks) ; l'ouverture de la porte (`SCR` 10000) est une lecture bloquante non interruptible.
 */
import { loadPcm } from "../audio/pcm";
import { TICK_MS, type Deadline } from "../engine/clock";
import { rectFromEdges, type GadgetGroup } from "../engine/gadgets";
import { drawShape } from "../engine/graphics/blit";
import type { Archive } from "../engine/resources";
import { SCR_FLAG, type AnimationHandle } from "../engine/scr-player";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";
import type { SoundHandle } from "../engine/sound";

const ARCHIVE = "TITLE.DAT";

/** Couleur de fond du logo (`10d8:3006`, indice `0x15` : hypothèse « fond noir »). */
const LOGO_BACKGROUND = 0x15;
const LOGO_SHAPE = 200;
const LOGO_POSITION = { x: 155, y: 140 } as const;
/** Durée d'affichage du logo (5 s) et des fondus (ticks). */
const LOGO_TICKS = 300;
const FADE_TICKS = 30;

const BACKGROUND_SHAPE = 105;
const MUSIC_SOUND = 1000;
const DOOR_SCRIPT = 10000;
const CLOCK_SCRIPT = 500;

/** Animations en boucle de la façade (descripteurs `DS:26b8…2718`, drapeaux `0x03` : fond sauvegardé). */
const LOOP_SCRIPTS: readonly number[] = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
const LOOP_FLAGS = SCR_FLAG.saveBackground | SCR_FLAG.keepMidi;

/** Zones cliquables (`DS:265c`, `DS:2670`) : indice 1 = porte, 2 = plaque. */
const DOOR_EDGES = [258, 266, 320, 344] as const;
const PLAQUE_EDGES = [117, 329, 150, 353] as const;

/** La musique se termine un peu avant son échéance théorique : marge (ticks) retirée de la durée du WAVE. */
const MUSIC_END_MARGIN_TICKS = 5;

type Phase = "logo" | "logoOut" | "intro" | "title" | "door" | "leaving";

/** État qui survit d'une entrée à l'autre (`DS:7bbe` : le logo n'est montré qu'une fois par partie). */
interface TitleSession {
  logoShown: boolean;
}

const sessions = new WeakMap<MathServices, TitleSession>();

function sessionOf(services: MathServices): TitleSession {
  let session = sessions.get(services);
  if (!session) {
    session = { logoShown: false };
    sessions.set(services, session);
  }
  return session;
}

/**
 * Compteur passé à `fastForward` pour la `SCR` 500 (144 images : 0 = 12 h 00 … 143 = 11 h 55) : `heure × 12 + pas`, formule de `1068:0785` sans son
 * `+ 1` (le compteur de `1090:0432` part de 1 et s'arrête à la première image qui l'atteint ; celui de `fastForward` part de 0). L'heure (24 h)
 * perd 12 si elle dépasse 12 (12 h reste 12, 0 h reste 0) ; la minute est arrondie au pas de 5 (`+1` si `minute % 5 > 2`, ou `= 2` avec au moins
 * 30 s). Comme l'original, il n'y a pas de retour à 0 : à partir de 55 min (pas 12) et à 12 h, le compteur dépasse 143 et le script s'arrête sur sa
 * dernière image (11 h 55), `fastForward` bornant à la dernière image. Hypothèse : 12 h 00 affiche donc 11 h 55 (défaut de l'original).
 */
export function clockFrame(hours: number, minutes: number, seconds: number): number {
  const hour = hours > 12 ? hours - 12 : hours;
  let step = Math.floor(minutes / 5);
  const rest = minutes % 5;
  if (rest > 2 || (rest === 2 && seconds >= 30)) step++;
  return hour * 12 + step;
}

class TitleScene implements Scene {
  private archive!: Archive;
  private phase: Phase = "logo";
  private wait: Deadline | null = null;
  private group: GadgetGroup | null = null;
  private loops: AnimationHandle[] = [];
  private music: SoundHandle | null = null;
  private musicMinimum: Deadline | null = null;
  private next: SceneId = SceneId.hub;
  private readonly session: TitleSession;

  constructor(private readonly services: MathServices) {
    this.session = sessionOf(services);
  }

  async load(ctx: SceneContext): Promise<void> {
    await ctx.resources.open(ARCHIVE);
  }

  enter(ctx: SceneContext): void {
    this.archive = ctx.resources.require(ARCHIVE);
    this.services.useArchive(this.archive);
    ctx.setCursor("arrow");
    const { palette } = this.services.graphics;
    if (!this.session.logoShown) {
      this.session.logoShown = true;
      this.drawLogo();
      this.phase = "logo";
      this.wait = ctx.clock.deadline(FADE_TICKS + LOGO_TICKS);
    } else {
      this.buildTitle(ctx);
      this.phase = "intro";
      this.wait = ctx.clock.deadline(FADE_TICKS);
    }
    palette.fadeFromBlack(FADE_TICKS);
    ctx.requestPresent();
  }

  leave(): void {
    this.services.endScene();
  }

  tick(ctx: SceneContext): void {
    const { palette } = this.services.graphics;
    switch (this.phase) {
      case "logo": {
        // Le logo attend la fin du compte à rebours, ou un clic / une touche (`1088:1091`, masque 3).
        const skipped = ctx.input.buttonEvents.some((e) => e.down) || ctx.input.keyEvents.some((e) => !e.repeat);
        if (this.wait!.expired || skipped) {
          palette.fadeToBlack(FADE_TICKS);
          this.wait = ctx.clock.deadline(FADE_TICKS);
          this.phase = "logoOut";
        }
        break;
      }
      case "logoOut":
        if (this.wait!.expired) {
          this.buildTitle(ctx);
          palette.fadeFromBlack(FADE_TICKS);
          this.wait = ctx.clock.deadline(FADE_TICKS);
          this.phase = "intro";
          ctx.requestPresent();
        }
        break;
      case "intro":
        if (this.wait!.expired) {
          this.startMusic(ctx);
          this.phase = "title";
        }
        break;
      case "title":
        // Tick d'indice 0 : la fin de la musique ouvre la porte toute seule.
        if (this.music && this.musicMinimum!.expired && !this.services.sound.isPlaying(this.music)) this.openDoor(ctx);
        break;
      case "door":
        break;
      case "leaving":
        if (this.wait?.expired) {
          ctx.scenes.request(this.next);
          this.wait = null;
        }
        break;
    }
  }

  // --- Décor ---

  private drawLogo(): void {
    const { screen, palette } = this.services.graphics;
    palette.loadShpl(this.archive.shpl(LOGO_SHAPE));
    screen.fill(LOGO_BACKGROUND);
    drawShape(screen, this.archive.shap(LOGO_SHAPE), LOGO_POSITION.x, LOGO_POSITION.y, 8);
  }

  private buildTitle(ctx: SceneContext): void {
    const { screen, palette } = this.services.graphics;
    const { scr, gadgets, sound } = this.services;
    sound.stopMusic();
    palette.loadShpl(this.archive.shpl(BACKGROUND_SHAPE));
    drawShape(screen, this.archive.shap(BACKGROUND_SHAPE), 0, 0, 0);
    this.drawClock(ctx);
    this.group = gadgets.addGroup({
      id: "title",
      records: [
        { rect: rectFromEdges(...DOOR_EDGES) },
        { rect: rectFromEdges(...PLAQUE_EDGES) },
      ],
      onActivate: (index) => {
        if (this.phase !== "title") return;
        if (index === 1) this.openDoor(ctx);
        else this.openCredits(ctx);
      },
    });
    gadgets.captureBackground(screen);
    this.loops = LOOP_SCRIPTS.map((id) => scr.start(this.archive, id, { flags: LOOP_FLAGS, loop: true }));
  }

  /** Heure système dessinée une fois dans le décor (`SCR` 500 avancé sans attente jusqu'à l'image voulue). */
  private drawClock(ctx: SceneContext): void {
    const now = new Date(ctx.host.unixMillis());
    const animation = this.services.scr.start(this.archive, CLOCK_SCRIPT, { flags: SCR_FLAG.keepMidi, deferFirstStep: true });
    animation.fastForward(clockFrame(now.getHours(), now.getMinutes(), now.getSeconds()));
    // L'aiguille reste là où elle est : l'animation s'arrête, sa dernière image reste sur la surface.
    animation.interrupt();
  }

  // --- Musique ---

  private startMusic(ctx: SceneContext): void {
    this.music = this.services.sound.playSound(this.archive, MUSIC_SOUND);
    // Garde-fou : si le son ne part pas (audio pas encore débloqué), on n'enchaîne pas avant sa durée théorique.
    const pcm = loadPcm(this.archive.mohawk, MUSIC_SOUND);
    const ticks = Math.floor((pcm.samples.length / pcm.sampleRate / TICK_MS) * 1000) - MUSIC_END_MARGIN_TICKS;
    this.musicMinimum = ctx.clock.deadline(Math.max(0, ticks));
  }

  // --- Sorties ---

  /** Porte (clic) ou fin de la musique : la porte s'ouvre jusqu'au bout, fondu vers le noir, hub (`1068:06d3(1)`). */
  private openDoor(ctx: SceneContext): void {
    if (this.phase !== "title") return;
    this.phase = "door";
    this.next = SceneId.hub;
    if (this.group) this.group.active = false;
    this.services.pointer.cursor.setBase("busy");
    // Les boucles s'arrêtent sur leur dernière image : la porte se joue sur un décor figé.
    for (const loop of this.loops) loop.interrupt();
    this.services.scr.playBlocking(this.archive, DOOR_SCRIPT, { flags: 0 }, () => this.fadeOut(ctx));
  }

  /** Plaque : retour aux crédits, musique coupée, fondu vers le noir. */
  private openCredits(ctx: SceneContext): void {
    if (this.phase !== "title") return;
    this.phase = "door";
    this.next = SceneId.credits;
    if (this.group) this.group.active = false;
    this.services.sound.stopAll();
    this.fadeOut(ctx);
  }

  private fadeOut(ctx: SceneContext): void {
    this.services.graphics.palette.fadeToBlack(FADE_TICKS);
    this.wait = ctx.clock.deadline(FADE_TICKS);
    this.phase = "leaving";
  }
}

export function createTitleScene(services: MathServices): Scene {
  return new TitleScene(services);
}
