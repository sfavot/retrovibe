/**
 * Page de développement du rendu de Drascula (vague R) : outil, hors du build du site. Page : `/src/games/drascula/ui/render-dev.html`
 * (serveur de dev Vite), paramètres `?chapter=2&room=14`. Précharge les images, fiches et `drascula.dat`, monte le moteur avec un
 * hôte minimal (souris et clavier, pas de son) et peint ses images ; l'hôte du jeu (vague J) remplacera celui-ci.
 * Les libellés sont ceux d'un outil de développement. L'état est exposé dans `window.drascula` pour les vérifications.
 *
 * Vague P : le jeu complet est monté (pièces et cinématiques de pièces des chapitres ; `?intro=1` ajoute les cinématiques communes ;
 * `?videos=1` précharge les `.BIN` : la porte du fond de l'auberge joue `animation_2_1`).
 *
 * Vagues T et C : `?talk=214` (réplique du héros), `?sequence=2` (scénario de dialogue du chapitre), `?converse=1` (choix de dialogue
 * `OP_1.CAL`), `?intro=1` (introduction avec logos), `?video=QPC.BIN&speed=1` (une vidéo SSN, `?video=LEV.BIN&animate=15` une animation),
 * `?ending=1` (fin du jeu), `?fast=8` (le temps du moteur passe 8 fois plus vite). Les voix ne sont pas jouées : une voix dure le temps
 * de son fichier, sans son.
 */
import { IndexedPresenter } from "../../../ui/indexed-canvas";
import { fetchBytes } from "../../../ui/files";
import { MemoryStorage } from "../../../engine/storage";
import { extensionOf, fetchGameFiles } from "../data/files";
import { MAX_CATCH_UP_TICKS, TICK_MS } from "../engine/cadence";
import type { DrasculaHost, DrasculaInput } from "../engine/host";
import { CINEMATICS, animate, playSsn } from "../cinematics";
import { DrasculaEngine } from "../engine/loop";
import { drasculaScript } from "../engine/rooms";
import type { GameFiles } from "../data/files";

const BASE = "/drascula";
const app = document.getElementById("app")!;

async function preload(withVideos: boolean): Promise<{ bytes: Map<string, Uint8Array>; files: GameFiles }> {
  const files = await fetchGameFiles(BASE);
  const extensions = withVideos ? ["ALG", "ALD", "BIN", "CAL"] : ["ALG", "ALD", "CAL"];
  const wanted = files.list((path) => extensions.includes(extensionOf(path)) || path.toLowerCase() === "drascula.dat");
  const bytes = new Map<string, Uint8Array>();
  await Promise.all(
    wanted.map(async (path) => {
      bytes.set(path.toUpperCase(), await fetchBytes(BASE, path));
    }),
  );
  return { bytes, files };
}

class DevHost implements DrasculaHost {
  readonly storage = new MemoryStorage();
  readonly input: DrasculaInput[] = [];
  screen = new Uint8Array(64000);
  palette = new Uint8Array(768);
  /** Heure (ms de l'horloge du moteur) de la fin du son en cours : une voix dure le temps de son fichier, sans son. */
  private soundEnd = 0;
  /** Horloge simulée : avance de `TICK_MS` par tick, pour que `?fast` accélère aussi les voix. */
  clock = 0;
  constructor(
    private readonly bytes: Map<string, Uint8Array>,
    private readonly files: GameFiles,
  ) {}
  now(): number {
    return this.clock;
  }
  exit(): void {}
  readFile(name: string): Uint8Array {
    const found = this.bytes.get(name.toUpperCase());
    if (!found) throw new Error(`fichier absent : ${name}`);
    return found;
  }
  pollInput(): readonly DrasculaInput[] {
    return this.input.splice(0);
  }
  present(pixels: Uint8Array, palette: Uint8Array): void {
    this.screen.set(pixels);
    this.palette.set(palette);
  }
  playSound(name: string): boolean {
    const path = this.files.resolve(name);
    const size = path === undefined ? undefined : this.files.size(path);
    if (size === undefined) return false;
    this.soundEnd = this.clock + ((size - 64) * 1000) / 11025;
    return true;
  }
  stopSound(): void {
    this.soundEnd = 0;
  }
  soundActive(): boolean {
    return this.clock < this.soundEnd;
  }
  playMusic(): void {}
  stopMusic(): void {}
  musicPlaying(): boolean {
    return true;
  }
}

async function start(): Promise<void> {
  app.textContent = "chargement des fichiers…";
  const params = new URLSearchParams(location.search);
  const withVideos = params.has("intro") || params.has("video") || params.has("videos") || params.has("ending");
  let loaded: Awaited<ReturnType<typeof preload>>;
  try {
    loaded = await preload(withVideos);
  } catch (error) {
    app.textContent = `Fichiers indisponibles : ${(error as Error).message}`;
    return;
  }
  const chapter = Number(params.get("chapter") ?? 1);
  const room = params.get("room");
  const host = new DevHost(loaded.bytes, loaded.files);
  // Le jeu (pièces des chapitres) ; sans `?intro`, sans les cinématiques communes (introduction, château, chapitre 6) pour jouer tout de suite.
  const animations = { ...drasculaScript.animations };
  if (!params.has("intro")) for (const name of Object.keys(CINEMATICS)) delete animations[name];
  const engine = new DrasculaEngine(host, { chapter, seed: 1, script: { ...drasculaScript, animations } });

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 200;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Image du jeu");
  canvas.tabIndex = 0;
  const status = document.createElement("output");
  app.replaceChildren(canvas, status);
  const presenter = IndexedPresenter.forCanvas(canvas, 320, 200);

  let buttons = 0;
  const point = (event: PointerEvent): { x: number; y: number } => {
    const box = canvas.getBoundingClientRect();
    return { x: Math.floor(((event.clientX - box.left) / box.width) * 320), y: Math.floor(((event.clientY - box.top) / box.height) * 200) };
  };
  const push = (event: PointerEvent): void => {
    host.input.push({ type: "pointer", ...point(event), buttons });
  };
  canvas.addEventListener("pointermove", push);
  canvas.addEventListener("pointerdown", (event) => {
    buttons = event.button === 2 ? 2 : 1;
    push(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    buttons = 0;
    push(event);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("keydown", (event) => host.input.push({ type: "key", key: event.key }));

  // Une pièce choisie : on laisse l'introduction du chapitre se jouer, puis on entre dans la pièce demandée.
  const afterStart = (action: () => void): void => {
    let tries = 0;
    const timer = setInterval(() => {
      if (!engine.busy || ++tries > 600) {
        clearInterval(timer);
        action();
      }
    }, 20);
  };
  if (room && !params.has("intro")) {
    const target = Number(room);
    afterStart(() => {
      engine.state.hero.x = -1;
      engine.run(engine.enterRoom(target));
    });
  }
  // Répliques, dialogues et vidéos (vagues T et C).
  const talk = params.get("talk");
  const sequence = params.get("sequence");
  const converse = params.get("converse");
  const video = params.get("video");
  if (talk) afterStart(() => engine.run(engine.talk(Number(talk))));
  if (sequence) afterStart(() => engine.run(engine.dialogs.play(Number(sequence))));
  if (converse) afterStart(() => engine.run(engine.dialogs.converse(Number(converse))));
  if (video) {
    afterStart(() => {
      const fps = params.get("animate");
      engine.run(fps ? animate(engine, video, Number(fps)) : playSsn(engine, video, Number(params.get("speed") ?? 9)));
    });
  }
  if (params.has("ending")) afterStart(() => engine.run(CINEMATICS["9_6"](engine)));
  const fast = Math.max(1, Number(params.get("fast") ?? 1));

  let last = performance.now();
  let carry = 0;
  const frame = (now: number): void => {
    carry += now - last;
    last = now;
    let ticks = Math.floor(carry / TICK_MS);
    carry -= ticks * TICK_MS;
    ticks = Math.min(ticks, MAX_CATCH_UP_TICKS) * fast;
    for (let i = 0; i < ticks; i++) {
      host.clock += TICK_MS;
      engine.tick();
    }
    engine.render();
    presenter.present(host.screen, host.palette);
    const s = engine.state;
    const said = engine.subtitle ? `, « ${engine.subtitle.text} »` : "";
    status.textContent = `chapitre ${s.chapter}, pièce ${s.room?.number ?? "-"}, héros (${s.hero.x}, ${s.hero.y}) ${s.hero.width}x${s.hero.height}${said}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as unknown as { drascula: unknown }).drascula = { engine, host };
}

void start();
