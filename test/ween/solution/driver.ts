import { HeadlessHost } from "../../../src/engine/coktel/host";
import { KEY_ESCAPE, KEY_RETURN } from "../../../src/engine/coktel/input";
import { MemoryStorage } from "../../../src/engine/storage";
import { WeenGame, createWeenSystem } from "../../../src/games/ween/engine/ween";
import { BENCH_START_MS, maskedVarHash, readOriginalStk, type BenchInput } from "../engine/bench";

/**
 * Pilote d'une partie de Ween par de vrais clics, dans les conditions du banc ScummVM (comme `runBench` : horloge
 * exacte, graine 1, images de `Host.markImage`). Les entrées sont posées au point d'image, comme `GOB_INPUT` : chaque
 * entrée appliquée est notée avec son image (`inputs`), ce qui donne le fichier rejoué au banc.
 *
 * Une action n'est posée qu'au repos : depuis `SETTLE` images, la boucle d'attente la plus intérieure est celle de
 * `Hotspots.evaluate` (zones de la salle, barre d'icônes, messages, saisie). Après chaque étape (au repos), le pilote
 * relève l'image, le TOT courant et le hachage des variables (`VH` du banc).
 */

export type Action =
  /** Clic gauche : pointeur amené puis appui (relâche à l'image suivante). `name` : texte de survol attendu. */
  | { click: [number, number]; name?: string; now?: boolean }
  /** Clic droit. */
  | { rclick: [number, number]; now?: boolean }
  | { move: [number, number]; now?: boolean }
  /** Touche (code clavier du moteur, ou `ESC`, `RETURN`, un caractère). */
  | { key: number | string; now?: boolean }
  /** Attendre n images (sans condition de repos). */
  | { wait: number }
  /** Attendre le chargement d'un TOT. */
  | { tot: string }
  /** Prendre un objet de l'inventaire (barre d'icônes, sac, ligne de l'objet). */
  | { inv: string }
  /** Choisir un personnage (barre d'icônes, personnages, ligne du nom : WEEN, PETROY, URM). */
  | { who: string }
  /** Cliquer une icône de la barre (`ICONS`). */
  | { bar: keyof typeof ICONS }
  /** Prendre un objet de la salle : clic gauche (l'objet suit le pointeur), puis le ranger (`store`). */
  | { take: [number, number]; name?: string }
  /** Sortie : clic (répété si besoin) jusqu'au changement de TOT. */
  | { go: [number, number]; from?: string; tries?: number }
  /** Taper un texte puis Entrée. */
  | { type: string }
  /** Valider un message (le script attend un clic) : appui tenu sur place (états internes 1 et 2). */
  | { ack: true | 1 | 2 }
  /** Valider un écran sans texte qui attend un clic (appui tenu, sans condition). */
  | { click2: true }
  /** Valider tous les messages qui se suivent (dialogue d'un personnage). */
  | { acks: true }
  /** Ranger l'objet tenu dans l'inventaire (clic droit dans la salle). */
  | { store: true | number }
  /** (interne) Suite décidée au repos d'après l'état du jeu. */
  | { then: (game: WeenGame) => Action[] }
  /** Faire défiler un dialogue : un clic tant que seules des zones plein écran sont actives (au plus `dialog` clics). */
  | { dialog: number }
  /** Cliquer une ligne de la liste ouverte (inventaire, personnages, menu de la disquette). */
  | { pick: string };

export interface Step {
  /** Libellé lisible (lieu, geste). */
  label: string;
  do: Action[];
  /** TOT attendu à la fin de l'étape (vérifié par le test). */
  tot?: string;
}

export interface Checkpoint {
  label: string;
  image: number;
  tot: string;
  vh: number;
}

export interface ShownText {
  image: number;
  tot: string;
  /** Item du `.DAT` (`printTotText`), ou -1 pour un texte des variables (`printText`, dans `text`). */
  id: number;
  text?: string;
  /** Affiché par une fonction de survol (nom de la zone), pas un message. */
  hover?: boolean;
}

/** Icônes de la barre de `MENU.TOT` (pointeur en haut de l'écran) : centres. */
export const ICONS = {
  disque: [28, 11],
  joker: [71, 11],
  bloc: [114, 11],
  sac: [158, 11],
  personnages: [202, 11],
  deplacer: [246, 11],
  reglages: [290, 11],
} as const satisfies Record<string, readonly [number, number]>;

/** Inventaire : lignes de 40 octets à partir de la variable 597 (octet 2 388), affichées en (188, 16 + 10 i). */
const INVENTORY_AT = 2388;
const INVENTORY_LINES = 20;

/** Où ranger l'objet tenu (clic droit) : dans la salle, sous la barre d'icônes. */
const STORE_AT: [number, number] = [160, 120];

/** Où cliquer pour refermer une liste ouverte (hors de la liste : zone plein écran de `MENU.TOT`, touche F2). */
const CLOSE_AT: [number, number] = [4, 196];

/** Une liste (inventaire, personnages) est ouverte : zone plein écran de touche F2 (0x3c00) active. */
function listOpen(game: WeenGame): boolean {
  const spots = (game.sys.hotspots as unknown as { spots: (Spot & { key: number })[] }).spots;
  return spots.some((z) => z.left === 0 && z.right === 319 && z.key === 0x3c00 && !z.isDisabled && z.window === 0);
}

/** Images de repos avant de poser une action. */
export const SETTLE = 6;
/** Où valider un message. */
const ACK_AT: [number, number] = [160, 185];
/** Message validé par une boucle du script : images d'attente après le texte. */
const ACK_LATE = 80;
/** Durée d'un appui tenu (`ack`). */
const HOLD = 4;
/** Images entre le déplacement du pointeur et le clic. */
const AIM = 3;
/** Images au plus pour une étape (au-delà : bloqué). */
const STEP_LIMIT = Number(process.env.WEEN_STEP_LIMIT ?? 20_000);

class Stop extends Error {}

/** Champs d'une zone du moteur (`Hotspots`, tableau privé) lus par le pilote. */
interface Spot {
  id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  isDisabled: boolean;
  window: number;
}

const silent = { playSample() {}, stopSample() {}, queuePcm() {}, clearQueue() {} };

/** Code clavier du moteur (ascii dans l'octet bas ; Échap et Entrée avec leur code de touche). */
export function keyCode(key: number | string): number {
  if (typeof key === "number") return key;
  if (key === "ESC") return KEY_ESCAPE;
  if (key === "RETURN") return KEY_RETURN;
  return key.charCodeAt(0);
}

/** Objet tenu (pointeur en forme d'objet, « Utiliser X sur ») : indice, -1 si aucun (variable 63). */
export const held = (game: WeenGame): number => game.vars.readVar32(63) | 0;

/** Lignes de la liste affichée (inventaire ou personnages, vides comprises ; remplies à l'ouverture). */
export function inventory(game: WeenGame): string[] {
  const b = game.inter.variables!.bytes;
  const out: string[] = [];
  for (let i = 0; i < INVENTORY_LINES; i++) {
    const at = INVENTORY_AT + 40 * i;
    let s = "";
    for (let j = at; j < at + 40 && b[j] !== 0; j++) s += String.fromCharCode(b[j]);
    out.push(s.trim());
  }
  return out;
}

export interface PlayResult {
  game: WeenGame;
  host: HeadlessHost;
  checkpoints: Checkpoint[];
  /** Entrées posées, au format du banc. */
  inputs: BenchInput[];
  tots: [number, string][];
  /** Textes du jeu affichés (`printTotText`) : TOT courant et numéro de l'item du `.DAT`. */
  texts: ShownText[];
  /** Pourquoi le pilote s'est arrêté avant la fin, avec l'étape (null si toutes jouées). */
  stuck: string | null;
}

export interface PlayOptions {
  store?: MemoryStorage;
  /** Appelé à chaque image (débogage, captures) ; `stack` : boucles d'attente en cours. */
  probe?: (n: number, game: WeenGame, idle: boolean, stack: string) => void;
  /** Arrêt après la dernière étape + n images. */
  tail?: number;
  /** Si fourni : hachage des variables (`VH` du banc) à chaque image, à l'indice n - 1. */
  vh?: number[];
  /** Texte d'un item affiché (vérification des survols `click.name`). */
  textOf?: (tot: string, id: number) => string;
}

/** Joue `steps` depuis le lancement (introduction comprise : la première étape est en général Échap). */
export async function play(steps: Step[], options: PlayOptions = {}): Promise<PlayResult> {
  const checkpoints: Checkpoint[] = [];
  const recorded: BenchInput[] = [];
  const tots: [number, string][] = [];
  const texts: ShownText[] = [];
  let stuck: string | null = null;

  // Mêmes conditions que `runBench` : horloge du banc, souris en (0, 0) que warpMouse ne déplace pas.
  const host = new HeadlessHost({
    readFile: (name) => (name.toUpperCase() === "INTRO.STK" ? readOriginalStk() : undefined),
    exactTime: true,
  });
  host.time = BENCH_START_MS;
  host.input.mouseX = 0;
  host.input.mouseY = 0;
  host.input.setMousePos = () => {};
  const system = createWeenSystem({ host, soundBackend: silent, store: options.store ?? new MemoryStorage() });
  const game = new WeenGame(host, system.sys, { maxSteps: Number.MAX_SAFE_INTEGER });

  // Boucles d'attente en cours : `E` (check d'evaluate), `K`/`k` (keyFunc), `h` (survol dans une attente),
  // `A` (fonction de zone appelée hors de l'attente : en général le « leave » d'une zone cliquée).
  const stack: string[] = [];
  const hs = game.sys.hotspots as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const wrap = (name: string, mark: "K" | "E" | "H" | null) => {
    const original = hs[name].bind(hs);
    hs[name] = async (...args: unknown[]) => {
      const top = stack.at(-1);
      stack.push(mark === "H" ? (top === "E" ? "h" : "A") : (mark ?? (top === "K" ? "k" : "E")));
      try {
        return await original(...args);
      } finally {
        stack.pop();
      }
    };
  };
  wrap("check", "K");
  wrap("checkFull", null);
  wrap("handleInputs", "E");
  wrap("call", "H");
  const draw = game.sys.draw;
  const printTotText = draw.printTotText.bind(draw);
  draw.printTotText = (id: number) => {
    texts.push({ image: host.images, tot: game.curTotFile.toUpperCase(), id, hover: stack.at(-1) === "h" });
    return printTotText(id);
  };
  const printText = draw.printText.bind(draw);
  draw.printText = (args) => {
    if (args.text.trim()) texts.push({ image: host.images, tot: game.curTotFile.toUpperCase(), id: -1, text: args.text });
    return printText(args);
  };
  let lastTot = "";
  const onLoadTot = game.hooks.onLoadTot;
  game.hooks.onLoadTot = (g, tot) => {
    onLoadTot?.(g, tot);
    lastTot = tot.toUpperCase();
    tots.push([host.images, lastTot]);
  };

  let busyRun = 0;
  let idleImages = 0;
  let stepIndex = 0;
  let stepStart = 0;
  let waitUntil = 0;
  let pendingRelease = false;
  let aimedAt = -1;
  let lastPosted = 0;
  let tail = -1;
  // actions restant à jouer dans l'étape (les actions composées s'y développent)
  let actions: Action[] = steps[0] ? [...steps[0].do] : [];
  const fail = (why: string): never => {
    stuck = `${steps[stepIndex]?.label ?? "?"} : ${why}`;
    throw new Stop();
  };

  host.onImage = (n) => {
    if (options.vh && game.inter.variables) options.vh[n - 1] = maskedVarHash(game.inter.variables.bytes);
    // repos : la boucle d'attente la plus intérieure est celle d'`evaluate` (survol compris) ; une image isolée hors
    // de l'attente (tic d'animation d'une salle, zone à délai) ne l'interrompt pas
    const waiting = /Eh?$/.test(stack.join(""));
    if (waiting) {
      idleImages++;
      busyRun = 0;
    } else if (++busyRun > 2) idleImages = 0;
    options.probe?.(n, game, idleImages >= SETTLE, stack.join(""));
    if (pendingRelease) {
      host.input.mouseButtons = 0;
      pendingRelease = false;
      return;
    }
    if (tail >= 0) {
      if (n >= tail) throw new Stop();
      return;
    }
    if (stepIndex >= steps.length) {
      tail = n + (options.tail ?? 0);
      if (n >= tail) throw new Stop();
      return;
    }
    if (n - stepStart > STEP_LIMIT) fail("bloqué");
    if (n < waitUntil) return;
    const action = actions[0];
    if (!action) {
      if (idleImages < SETTLE) return;
      checkpoints.push({
        label: steps[stepIndex].label,
        image: n,
        tot: game.curTotFile.toUpperCase(),
        vh: maskedVarHash(game.inter.variables!.bytes),
      });
      stepIndex++;
      actions = steps[stepIndex] ? [...steps[stepIndex].do] : [];
      stepStart = n;
      return;
    }
    if ("wait" in action) {
      waitUntil = n + action.wait;
      actions.shift();
      idleImages = 0;
      return;
    }
    if ("tot" in action) {
      if (lastTot === action.tot.toUpperCase()) {
        actions.shift();
        lastTot = "";
      }
      return;
    }
    if ("click2" in action) {
      // écran sans texte qui attend un clic (pointeur en livre) : appui tenu après une courte attente
      actions.splice(0, 1, { wait: 30 }, { ack: 1 });
      return;
    }
    if ("acks" in action) {
      // tous les messages qui se suivent : jusqu'au retour au repos sans message nouveau
      const last = [...texts].reverse().find((t) => t.id >= 0 && !t.hover && t.image >= lastPosted);
      if (idleImages >= SETTLE && waiting && !last) actions.shift();
      else if (last) actions.splice(0, 1, { ack: true }, { acks: true });
      return;
    }
    if ("ack" in action) {
      // message qui attend un clic dans une boucle du script (sans la boucle des zones) : appui tenu quelques images
      // (`d`, puis `u` au banc), pour qu'un tour de la boucle le voie
      if (action.ack === true) {
        // un message affiché depuis l'entrée précédente, et rien de neuf depuis SETTLE images (ou la boucle des zones)
        const last = [...texts].reverse().find((t) => t.id >= 0 && !t.hover && t.image >= lastPosted);
        // (boucle des zones au repos : message ordinaire ; sinon, une boucle du script après le texte : on attend
        // ACK_LATE images, une animation peut encore suivre le texte)
        // (sans message depuis l'entrée précédente, au repos : rien à valider)
        if (idleImages >= SETTLE && waiting && !last) actions.shift();
        else if ((idleImages >= SETTLE && waiting) || (last && n - last.image >= ACK_LATE)) actions.splice(0, 1, { ack: 1 });
        return;
      }
      if (action.ack === 1) {
        // dans la zone des textes, hors des zones de la salle : le clic ne sert qu'à valider
        if (host.input.mouseX !== ACK_AT[0] || host.input.mouseY !== ACK_AT[1]) {
          Object.assign(host.input, { mouseX: ACK_AT[0], mouseY: ACK_AT[1] });
          recorded.push({ image: n, move: [...ACK_AT] });
          waitUntil = n + AIM;
          return;
        }
        host.input.mouseButtons = 1;
        recorded.push({ image: n, down: [host.input.mouseX, host.input.mouseY] } as never);
        waitUntil = n + HOLD;
        actions.splice(0, 1, { ack: 2 });
        return;
      }
      host.input.mouseButtons = 0;
      recorded.push({ image: n, up: [host.input.mouseX, host.input.mouseY] } as never);
      lastPosted = n;
      idleImages = 0;
      busyRun = 0;
      actions.shift();
      return;
    }
    if ("go" in action && action.from && game.curTotFile.toUpperCase() !== action.from) {
      // arrivé : pas besoin d'attendre le repos (l'écran suivant peut attendre un clic)
      actions.shift();
      return;
    }
    if ("store" in action && n - lastPosted >= 20 && held(game) < 0 && !listOpen(game)) {
      // rien à ranger depuis 20 images : pas besoin d'attendre le repos (un message peut attendre dans une boucle
      // du script)
      actions.shift();
      return;
    }
    const now = "now" in action && action.now === true;
    // au repos, et l'image vient de la boucle d'attente : l'entrée est lue aussitôt (`checkKeys` suit le point
    // d'image) ; posée pendant un tic d'animation, un clic d'une image serait relâché avant d'être vu
    if (!now && (idleImages < SETTLE || !waiting)) return;
    if ("then" in action) {
      actions.splice(0, 1, ...action.then(game));
      return;
    }
    if ("bar" in action) {
      actions.splice(0, 1, { move: [160, 0] }, { click: [...ICONS[action.bar]] });
      return;
    }
    if ("dialog" in action) {
      const spots = (game.sys.hotspots as unknown as { spots: Spot[] }).spots;
      const live = spots.filter((z) => z.left !== 0xffff && !z.isDisabled && z.window === 0);
      const talking = live.length > 0 && live.every((z) => z.left === 0 && z.top === 0 && z.right === 319 && z.bottom === 199);
      if (!talking || action.dialog <= 0) actions.shift();
      else actions.splice(0, 1, { click: [160, 170] }, { dialog: action.dialog - 1 });
      return;
    }
    if ("type" in action) {
      actions.splice(0, 1, ...[...action.type].map((c) => ({ key: c })), { key: "RETURN" });
      return;
    }
    if ("go" in action) {
      // un clic suffit en général ; le premier peut n'être pris que comme le choix de la sortie (pointeur en porte)
      const from = action.from ?? game.curTotFile.toUpperCase();
      const tries = action.tries ?? 3;
      if (action.from && game.curTotFile.toUpperCase() !== from) actions.shift();
      else if (tries <= 0) fail("la sortie ne mène nulle part");
      else actions.splice(0, 1, { click: action.go }, { go: action.go, from, tries: tries - 1 });
      return;
    }
    if ("store" in action) {
      // clic droit dans la salle (hors de la barre et de l'inventaire), jusqu'à ce que plus rien ne soit tenu (un
      // clic peut d'abord fermer un message)
      const tries = action.store === true ? 3 : action.store;
      if (held(game) < 0) {
        // le clic droit range l'objet et ouvre la liste de l'inventaire : la refermer
        if (listOpen(game)) actions.splice(0, 1, { click: CLOSE_AT });
        else actions.shift();
      }
      else if (tries <= 0) fail("l'objet tenu ne se range pas");
      else actions.splice(0, 1, { rclick: STORE_AT }, { store: tries - 1 });
      return;
    }
    if ("take" in action) {
      actions.splice(0, 1, { click: action.take, name: action.name }, { store: true });
      return;
    }
    if (("inv" in action || "who" in action) && listOpen(game)) {
      actions.unshift({ click: CLOSE_AT });
      return;
    }
    if ("inv" in action) {
      actions.splice(0, 1, { bar: "sac" }, { pick: action.inv });
      return;
    }
    if ("who" in action) {
      actions.splice(0, 1, { bar: "personnages" }, { pick: action.who });
      return;
    }
    if ("pick" in action) {
      // la liste est recopiée dans les variables à l'ouverture du sac
      const line = inventory(game).findIndex((s) => s === action.pick.toUpperCase());
      if (line < 0) fail(`« ${action.pick} » absent de la liste (${inventory(game).filter(Boolean).join(", ")})`);
      // ligne i : zone 0x8007 + i de MENU.TOT
      const zone = (game.sys.hotspots as unknown as { spots: Spot[] }).spots.find(
        (z) => (z.id & 0x7fff) === 7 + line,
      );
      if (!zone || zone.left >= 320) fail(`ligne ${line} de l'inventaire introuvable`);
      actions.splice(0, 1, { click: [(zone!.left + zone!.right) >> 1, (zone!.top + zone!.bottom) >> 1] });
      return;
    }
    if ("click" in action || "rclick" in action) {
      const [x, y] = "click" in action ? action.click : action.rclick;
      if (!now && aimedAt < 0) {
        // d'abord amener le pointeur (survol), puis cliquer : un appui posé en même temps que le déplacement
        // n'est vu que comme un survol par certaines zones
        if (host.input.mouseX !== x || host.input.mouseY !== y) {
          Object.assign(host.input, { mouseX: x, mouseY: y });
          recorded.push({ image: n, move: [x, y] });
        }
        aimedAt = n;
        waitUntil = n + AIM;
        return;
      }
      const name = "click" in action ? action.name : undefined;
      if (name && options.textOf) {
        // derniers textes affichés : le nom de la zone survolée (il n'est réécrit qu'au changement de zone, et un
        // message a pu s'afficher depuis)
        const shown = texts.slice(-6).map((t) => t.text ?? options.textOf!(t.tot, t.id)).filter((s) => s.trim());
        if (!shown.some((s) => s.toLowerCase().includes(name.toLowerCase())))
          fail(`survol de (${x}, ${y}) : « ${shown.join(" | ")} » au lieu de « ${name} »`);
      }
      aimedAt = -1;
      Object.assign(host.input, { mouseX: x, mouseY: y, mouseButtons: "click" in action ? 1 : 2 });
      pendingRelease = true;
      recorded.push("click" in action ? { image: n, click: [x, y] } : ({ image: n, rclick: [x, y] } as never));
    } else if ("move" in action) {
      Object.assign(host.input, { mouseX: action.move[0], mouseY: action.move[1] });
      recorded.push({ image: n, move: action.move });
    } else {
      host.input.pushKey(keyCode(action.key));
      recorded.push({ image: n, key: action.key } as never);
    }
    lastTot = "";
    idleImages = 0;
    busyRun = 0;
    lastPosted = n;
    actions.shift();
  };
  try {
    await game.start();
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  if (!stuck && stepIndex < steps.length) stuck = `${steps[stepIndex].label} : le jeu s'est arrêté (${game.endedOn ?? "?"})`;
  return { game, host, checkpoints, inputs: recorded, tots, texts, stuck };
}

/** Fichier `GOB_INPUT` du banc. */
export function benchInputFile(inputs: BenchInput[]): string {
  return inputs
    .map((i) => {
      const any = i as BenchInput & { rclick?: [number, number]; down?: [number, number]; up?: [number, number]; key?: number | string };
      if (any.rclick) return `${i.image} r ${any.rclick[0]} ${any.rclick[1]}`;
      if (any.down) return `${i.image} d ${any.down[0]} ${any.down[1]}`;
      if (any.up) return `${i.image} u ${any.up[0]} ${any.up[1]}`;
      if ("click" in i) return `${i.image} c ${i.click[0]} ${i.click[1]}`;
      if ("move" in i) return `${i.image} m ${i.move[0]} ${i.move[1]}`;
      return `${i.image} k ${any.key}`;
    })
    .map((l) => `${l}\n`)
    .join("");
}

/**
 * Étapes écrites en texte, une par ligne : `libellé : action ; action ; …` (`#` : commentaire). Actions :
 * `x,y` ou `x,y "nom"` (clic, survol attendu), `p x,y "nom"` (prendre l'objet), `g x,y` (sortie), `r x,y` (clic droit), `s` (ranger l'objet tenu), `ok` (valider un message), `ok*` (tous les messages qui se suivent), `code x,y… levier x,y` (code tiré au hasard, voir `solveCode`), `ok!` (écran sans texte qui attend un clic), `x TEXTE` (taper, puis Entrée), `m x,y`, `k TOUCHE`, `w n` (images),
 * `t NOM` (TOT chargé), `d [n]` (dialogue : clics jusqu'au retour des zones de la salle), `i OBJET` (objet de l'inventaire), `c NOM` (personnage), `l LIGNE` (ligne de la liste ouverte : SAUVER, CHARGER…), `b ICÔNE`, `!` devant une action : sans attendre le repos.
 * `@NOM` en fin de ligne : TOT attendu en fin d'étape.
 */
export function parseSteps(text: string): Step[] {
  const steps: Step[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(" : ");
    if (colon < 0) throw new Error(`étape sans « : » : ${line}`);
    let body = line.slice(colon + 3).trim();
    let tot: string | undefined;
    const at = body.match(/\s*@(\S+)$/);
    if (at) {
      tot = at[1].toUpperCase();
      if (!tot.endsWith(".TOT")) tot += ".TOT";
      body = body.slice(0, at.index).trim();
    }
    const actions = body
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseAction(s));
    steps.push({ label: line.slice(0, colon).trim(), do: actions, tot });
  }
  return steps;
}

/**
 * Code d'un mécanisme tiré au hasard (2e porte du labyrinthe) : la variable `progress` compte les touches justes
 * (5 = erreur ; certaines touches ne changent rien ; `length` = code complet, atteint parfois en moins de
 * touches) et le levier remet à zéro. Le code dépend de VAR(213), tirée au hasard dans `EMAJ1014`. On essaie les touches une à une, en rejouant le début trouvé après chaque
 * erreur ; le levier final (qui ouvre) reste une étape à part.
 */
export function solveCode(keys: [number, number][], lever: [number, number], length: number, progress = 210): Action {
  const press = (k: number): Action => ({ click: keys[k] });
  // état propre à chaque partie (les étapes servent à plusieurs parties)
  const start = (): Action[] => {
    const found: number[] = [];
    let candidate = 0;
    const step = (): Action[] => (found.length === length ? [] : [press(candidate), { then: check }]);
    const check = (game: WeenGame): Action[] => {
      const value = game.vars.readVar32(progress) | 0;
      if (value === length) return []; // code complet (il peut être plus court que `length` touches)
      if (value === found.length + 1) {
        found.push(candidate);
        candidate = 0;
        return step();
      }
      candidate++;
      if (candidate >= keys.length) throw new Error(`code introuvable après ${found.join(",")}`);
      // touche sans effet (valeur inchangée) : on essaie la suivante ; erreur : remise à zéro et début rejoué
      return value === found.length ? step() : [{ click: lever }, ...found.map(press), ...step()];
    };
    return step();
  };
  return { then: start };
}

function parseAction(text: string): Action {
  let s = text;
  const now = s.startsWith("!");
  if (now) s = s.slice(1).trim();
  const xy = (t: string): [number, number] => {
    const m = t.match(/^(-?\d+)\s*,\s*(-?\d+)$/);
    if (!m) throw new Error(`coordonnées attendues : ${text}`);
    return [Number(m[1]), Number(m[2])];
  };
  const click = s.match(/^(p\s+)?(-?\d+\s*,\s*-?\d+)(?:\s+"([^"]*)")?$/);
  if (click && click[1]) return { take: xy(click[2]), name: click[3] };
  const go = s.match(/^g\s+(-?\d+\s*,\s*-?\d+)$/);
  if (go) return { go: xy(go[1]) };
  if (click) return { click: xy(click[2]), name: click[3], now };
  const [op, ...rest] = s.split(/\s+/);
  const arg = rest.join(" ");
  switch (op) {
    case "r":
      return { rclick: xy(arg), now };
    case "m":
      return { move: xy(arg), now };
    case "k":
      return { key: arg, now };
    case "w":
      return { wait: Number(arg) };
    case "ok":
      return { ack: true };
    case "ok*":
      return { acks: true };
    case "ok!":
      return { click2: true };
    case "x":
      // texte tapé puis Entrée : une touche par action
      return { type: arg };
    case "s":
      return { store: true };
    case "code": {
      // code x,y x,y … levier x,y : touches, levier de remise à zéro (longueur = nombre de touches)
      const parts = arg.split(/\s+/);
      const at = parts.indexOf("levier");
      const keys = parts.slice(0, at).map(xy);
      return solveCode(keys, xy(parts[at + 1]), keys.length);
    }
    case "d":
      return { dialog: arg ? Number(arg) : 40 };
    case "t":
      return { tot: arg.toUpperCase().endsWith(".TOT") ? arg.toUpperCase() : `${arg.toUpperCase()}.TOT` };
    case "i":
      return { inv: arg };
    case "c":
      return { who: arg };
    case "l":
      return { pick: arg };
    case "b":
      if (!(arg in ICONS)) throw new Error(`icône inconnue : ${text}`);
      return { bar: arg as keyof typeof ICONS };
    default:
      throw new Error(`action inconnue : ${text}`);
  }
}
