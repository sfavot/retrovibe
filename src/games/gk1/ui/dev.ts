/**
 * Page du moteur de Gabriel Knight : outil de développement, hors du build du site.
 * Page : `/src/games/gk1/ui/dev.html` (serveur de dev Vite, entrée `gk1-dev` de `.claude/launch.json`). Les ressources
 * viennent de `original/gk1/`, servi en `/gk1/`.
 *
 * La machine virtuelle démarre le script 0 et tourne, une image du jeu par image du navigateur (`engine/loop.ts`) ;
 * le tampon composé par `FrameOut` (`render/frameout.ts`) est montré tel quel. Commandes : pause, image par image, vitesse.
 * `window.__gk1` donne la machine virtuelle, le compositeur et la file des évènements à la console.
 *
 * **Entrées** (`engine/events.ts`, `plan.md` D7) : le pointeur et le clavier du canvas vont à la file des évènements du jeu.
 * Clic gauche : bouton gauche ; clic droit ou appui long du doigt : bouton droit (curseur suivant) ; clic du milieu : bouton
 * du milieu. Un appui ou Échap pendant une cinématique l'interrompt. Les cinématiques viennent de `SEQ/` (`movies.ts`).
 *
 * Les textes sont dans `../copy.ts`. La page du jeu (`mountPointClickApp`, son) viendra au Jalon 1.
 */
import { h } from "../../../ui/asset-viewer/helpers";
import { fetchBytes } from "../../../ui/files";
import { IndexedPresenter, makeCanvas } from "../../../ui/indexed-canvas";
import { bindCanvasPointer, bindKeyboard } from "../../../ui/pointer";
import { copy } from "../copy";
import { ResourceIndex } from "../data/resource-map";
import { type EventQueue, eventsOf, modifiersOf, MouseButton, sciKeyOf } from "../engine/events";
import { currentRoom, runFrame, useGameClock } from "../engine/loop";
import { RunStatus, Vm } from "../engine/vm";
import { type Frameout, frameoutOf } from "../render/frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/ids";
import { seqPlayerOf } from "../render/seq-player";
import { movieFiles } from "./movies";

const BASE = "/gk1";
const SPEEDS = [1, 8, 60] as const;
/** Images du navigateur entre deux mises à jour des listes (souches, avertissements). */
const REPORT_INTERVAL = 30;
/** Vue du curseur tant que le jeu n'en a pas choisi (`render/cursor.ts`). */
const NO_CURSOR_VIEW = 0xffff;

const t = copy.dev;
const viewer = copy.viewer;
const root = document.querySelector<HTMLDivElement>("#app")!;

declare global {
  interface Window {
    __gk1?: { vm: Vm; frameout: Frameout; events: EventQueue; frame: () => number };
  }
}

function listOf(entries: readonly (readonly [string, number])[]): HTMLElement {
  if (entries.length === 0) return h("p", { class: "empty" }, t.none);
  return h("ul", {}, ...entries.map(([name, count]) => h("li", {}, t.count(name, count))));
}

/** Branche le pointeur et le clavier du canvas sur la file des évènements du jeu. */
function bindInput(canvas: HTMLCanvasElement, events: EventQueue): void {
  bindCanvasPointer(
    canvas,
    { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
    {
      move: (x, y) => events.move(x, y),
      down: (button, x, y) => events.down(button, x, y),
      up: (button, x, y) => events.up(button, x, y),
      // Appui long du doigt : un clic droit là où le doigt s'est posé.
      longPress: (x, y) => {
        events.down(MouseButton.Right, x, y);
        events.up(MouseButton.Right, x, y);
      },
    },
  );
  bindKeyboard(canvas, {
    keyDown: (event) => {
      const key = sciKeyOf(event);
      events.keyDown(key, modifiersOf(event));
      return key !== 0;
    },
    keyUp: (event) => {
      const key = sciKeyOf(event);
      events.keyUp(key, modifiersOf(event));
      return key !== 0;
    },
    blur: () => events.releaseAll(),
  });
}

function run(index: ResourceIndex): void {
  const vm = new Vm(index);
  useGameClock(vm);
  seqPlayerOf(vm).source = movieFiles(BASE);
  vm.boot();
  const frameout = frameoutOf(vm);
  const events = eventsOf(vm);

  const canvas = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
  canvas.removeAttribute("style");
  canvas.className = "screen";
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", t.screen);
  canvas.tabIndex = 0;
  bindInput(canvas, events);
  const presenter = IndexedPresenter.forCanvas(canvas, SCREEN_WIDTH, SCREEN_HEIGHT);

  const status = h("output", {});
  const pauseButton = h("button", { type: "button" }, t.pause);
  const stepButton = h("button", { type: "button" }, t.step);
  const speedButtons = SPEEDS.map((factor) => h("button", { type: "button", "aria-pressed": String(factor === SPEEDS[0]) }, t.speedValue(factor)));
  const stubs = h("div", {});
  const warnings = h("div", {});
  const message = h("p", { class: "error", role: "alert" });

  let frame = 0;
  let paused = false;
  let stopped = false;
  let speed: number = SPEEDS[0];
  let sinceReport = REPORT_INTERVAL;

  const report = (): void => {
    sinceReport = 0;
    stubs.replaceChildren(listOf([...vm.kernel.journal.stubs].map(([name, record]) => [name, record.count] as const)));
    warnings.replaceChildren(listOf([...vm.warnings]));
  };
  const present = (): void => {
    presenter.present(frameout.present(), frameout.palette.screen);
    // Le curseur du jeu remplace celui du système dès qu'il est dessiné.
    canvas.classList.toggle("game-cursor", frameout.cursor.visible && frameout.cursor.view !== NO_CURSOR_VIEW);
    const items = frameout.planes.reduce((sum, plane) => sum + plane.items.length, 0);
    status.textContent = t.status(frame, currentRoom(vm), frameout.planes.length, items);
    if (++sinceReport >= REPORT_INTERVAL) report();
  };
  const advance = (count: number): void => {
    try {
      for (let i = 0; i < count && !stopped; i++) {
        if (runFrame(vm).status === RunStatus.Finished) {
          stopped = true;
          message.textContent = t.finished;
        } else frame++;
      }
    } catch (error) {
      stopped = true;
      message.textContent = viewer.error((error as Error).message);
      console.error(error);
    }
    if (stopped) {
      pauseButton.disabled = stepButton.disabled = true;
      report();
    }
    present();
  };

  pauseButton.addEventListener("click", () => {
    paused = !paused;
    pauseButton.textContent = paused ? t.resume : t.pause;
  });
  stepButton.addEventListener("click", () => {
    if (!paused) pauseButton.click();
    advance(1);
    report();
  });
  speedButtons.forEach((button, i) =>
    button.addEventListener("click", () => {
      speed = SPEEDS[i];
      speedButtons.forEach((other, j) => other.setAttribute("aria-pressed", String(i === j)));
    }),
  );

  root.replaceChildren(
    h(
      "main",
      { class: "gk1-dev" },
      h("h1", {}, t.title),
      canvas,
      h("div", { class: "bar", role: "group", "aria-label": t.controls }, pauseButton, stepButton, h("span", {}, t.speed), ...speedButtons, status),
      message,
      h("div", { class: "columns" }, h("section", {}, h("h3", {}, t.stubs), stubs), h("section", {}, h("h3", {}, t.warnings), warnings)),
    ),
  );
  window.__gk1 = { vm, frameout, events, frame: () => frame };

  const loop = (): void => {
    if (!paused && !stopped) advance(speed);
    if (!stopped) requestAnimationFrame(loop);
  };
  present();
  requestAnimationFrame(loop);
}

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, t.loading));
  let index: ResourceIndex;
  try {
    const [map, volume] = await Promise.all([fetchBytes(BASE, "RESOURCE.MAP"), fetchBytes(BASE, "RESOURCE.000")]);
    index = new ResourceIndex();
    index.addVolume(map, volume, "RESOURCE.000");
  } catch (error) {
    root.replaceChildren(h("p", { class: "error" }, viewer.unavailable((error as Error).message)), h("p", { class: "empty" }, viewer.extractHint));
    return;
  }
  try {
    run(index);
  } catch (error) {
    root.replaceChildren(h("p", { class: "error" }, viewer.error((error as Error).message)));
    console.error(error);
  }
}

void start();
