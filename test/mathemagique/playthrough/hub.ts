import { SceneId } from "../../../src/games/mathemagique/engine/scene";
import { HUB_OBJECT, HUB_OBJECT_EDGES } from "../../../src/games/mathemagique/scenes/hub-logic";
import { helpSession } from "./help";
import type { Robot } from "./robot";

const NAMES = ["Léa", "Zoé", "Max", "Ana Belle", "Noé 7", "Jo", "Éloïse", "Sam.K"];

export function centerOf(object: number): [number, number] {
  const [l, t, r, b] = HUB_OBJECT_EDGES[object - 1]!;
  return [Math.floor((l + r) / 2), Math.floor((t + b) / 2)];
}

/** Boutons du pupitre (centre) : Quit, Help, Sign-in. */
export const CONSOLE = { quit: [173, 362], help: [210, 362], signIn: [247, 362] } as const;
/** Gadgets du moniteur au repos (`monitor.test.ts` : `AT`). */
export const MONITOR = { ok: [278, 284], ambient: [330, 320], click: [330, 337], row: (k: number) => [397, 307 + 22 * k] as [number, number] } as const;

/** Titre → (crédits un coup sur trois) → porte → hub, puis le moniteur de connexion s'ouvre après l'accueil de Poly. */
export async function bootToHub(r: Robot): Promise<boolean> {
  r.engine.start();
  await r.run(800);
  if (r.currentId !== SceneId.title) r.problem("démarrage", `la première scène est ${r.sceneName}, pas le titre`);
  if (r.rng.chance(0.4)) {
    // La plaque mène aux crédits : une page, le balayage, puis EXIT vers le titre.
    await r.until(() => r.services.sound.musicPlaying || r.host.time > 12_000, 15_000, "titre : musique");
    await r.run(6_000);
    await r.click(133, 341, 100);
    if (await r.until(() => r.currentId === SceneId.credits, 20_000, "plaque du titre → crédits")) {
      await r.run(23_000);
      await r.click(82, 108, 100);
      await r.until(() => r.currentId === SceneId.title, 20_000, "crédits : EXIT → titre");
      r.note("crédits visités");
    }
  }
  // Une touche passe l'introduction (logo) ; le clic sur la porte lance le hub.
  await r.press("Space", " ");
  await r.run(2500);
  if (!(await r.tryUntil(() => r.currentId === SceneId.title, 20_000))) await r.run(0);
  for (let attempt = 0; attempt < 4 && r.currentId !== SceneId.hub; attempt++) {
    await r.click(290, 300, 500);
    await r.tryUntil(() => r.currentId === SceneId.hub, 15_000);
  }
  if (r.currentId !== SceneId.hub) {
    r.problem("bloqué", "la porte du titre n'ouvre pas le hub");
    return false;
  }
  r.note("hub atteint");
  return true;
}

/** Accueil de Poly passé, la connexion ouverte (roster vide : la saisie du nom commence tout de suite). */
export async function createPlayer(r: Robot): Promise<boolean> {
  await r.run(1200);
  await r.click(520, 20, 1500);
  const hub = r.hub;
  if (!hub.monitorOpen) {
    // L'accueil n'est peut-être pas fini : un second essai plus tard.
    await r.run(8000);
    await r.click(520, 20, 1500);
  }
  if (!r.hub.monitorOpen) {
    r.problem("bloqué", "le moniteur de connexion ne s'ouvre pas après l'accueil de Poly");
    return false;
  }
  const name = r.rng.pick(NAMES);
  await r.type(name, 60);
  await r.press("Enter", "Enter", 2500);
  const ok = await r.until(() => !r.hub.monitorOpen, 20_000, "fermeture du moniteur après la création du joueur");
  const roster = r.engine.ctx.roster;
  const players = roster.roster.players().map((p) => p.name);
  if (ok && !players.length) r.problem("roster", `aucun joueur créé après la saisie de « ${name} »`);
  else if (ok) r.note(`joueur « ${players.join(", ")} » créé`);
  // La présentation de Poly pour un nouveau joueur dure : on laisse le hub se poser.
  await r.run(25_000);
  r.checkRoster("après la création du joueur");
  return ok;
}

/** Le hub est revenu et posé (curseur actif, boucles lancées). */
export async function hubRest(r: Robot): Promise<boolean> {
  if (!(await r.until(() => r.currentId === SceneId.hub, 60_000, "retour au hub"))) return false;
  await r.run(3500);
  return true;
}

/** Clique l'objet du décor et attend l'activité. */
export async function launch(r: Robot, object: number, scene: SceneId, label: string): Promise<boolean> {
  if (!(await hubRest(r))) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    await r.click(...centerOf(object), 200);
    if (await r.tryUntil(() => r.currentId === scene, 40_000)) {
      r.note(`${label} lancé depuis le hub`);
      return true;
    }
    r.note(`${label} : le clic du hub n'a pas lancé l'activité (essai ${attempt + 1})`);
    await r.run(4000);
  }
  r.problem("bloqué", `le clic sur l'objet ${label} du hub ne lance pas l'activité`);
  return false;
}

/** Ouvre les préférences (Ctrl + clic sur Sign-in). */
export async function openPreferences(r: Robot): Promise<boolean> {
  if (!(await hubRest(r))) return false;
  await r.click(...CONSOLE.signIn, 1500, { ctrl: true });
  r.host.input.keyUp("ControlLeft", { ctrl: false, shift: false, alt: false });
  if (r.hub.monitorMode !== "preferences") {
    r.problem("bloqué", `Ctrl + clic sur Sign-in n'ouvre pas les préférences (mode ${String(r.hub.monitorMode)})`);
    if (r.hub.monitorOpen) await r.click(...MONITOR.ok, 800);
    return false;
  }
  return true;
}

export async function closeMonitor(r: Robot): Promise<void> {
  await r.click(...MONITOR.ok, 500);
  await r.until(() => !r.hub.monitorOpen, 15_000, "fermeture du moniteur (OK)");
  await r.run(500);
  r.checkRoster("après la fermeture des préférences");
}

/** Préférences : bascules choisies, durée du Bowling (secondes) si demandée. */
export async function setPreferences(r: Robot, change: { ambient?: boolean; clickAndStick?: boolean; bowlingSeconds?: number }): Promise<void> {
  if (!(await openPreferences(r))) return;
  const roster = r.engine.ctx.roster.roster;
  if (change.ambient !== undefined && roster.ambient !== change.ambient) {
    await r.click(...MONITOR.ambient, 300);
    if (roster.ambient !== change.ambient && r.hub.monitorOpen) r.note("Ambient Sounds : bascule non vue avant la fermeture");
  }
  if (change.clickAndStick !== undefined && roster.clickAndStick !== change.clickAndStick) {
    await r.click(...MONITOR.click, 300);
  }
  if (change.bowlingSeconds !== undefined) {
    for (let i = 0; i < 4; i++) await r.press("Backspace", "Backspace", 40);
    await r.type(String(change.bowlingSeconds), 40);
  }
  await closeMonitor(r);
  if (change.ambient !== undefined && roster.ambient !== change.ambient) r.problem("préférences", `Ambient Sounds attendu ${change.ambient}, obtenu ${roster.ambient}`);
  if (change.clickAndStick !== undefined && roster.clickAndStick !== change.clickAndStick) r.problem("préférences", `Click & Stick attendu ${change.clickAndStick}, obtenu ${roster.clickAndStick}`);
  if (change.bowlingSeconds !== undefined && roster.bowlingSeconds !== change.bowlingSeconds) r.problem("préférences", `durée du Bowling attendue ${change.bowlingSeconds} s, obtenue ${roster.bowlingSeconds} s`);
  r.note(`préférences : clic ${roster.clickAndStick ? "cliquer-poser" : "glisser"}, ambiance ${roster.ambient}, bowling ${roster.bowlingSeconds} s`);
}

/** Aide du hub (mode aide du pupitre) : un clic sur le décor, puis sur Poly, qui y met fin. */
export async function hubHelp(r: Robot): Promise<void> {
  if (!(await hubRest(r))) return;
  await helpSession(r, "Hub", CONSOLE.help, () => r.hub.helpMode, centerOf(HUB_OBJECT.polyBody), [centerOf(HUB_OBJECT.television), centerOf(HUB_OBJECT.shelf)]);
  await r.run(1000);
}

/** Sifflet : Quit puis clic sur le sifflet. Renvoie vrai si l'hôte a reçu `exit()`. */
export async function quit(r: Robot): Promise<boolean> {
  if (!(await hubRest(r))) return false;
  // D'abord une annulation (clic ailleurs), puis la vraie sortie.
  await r.click(...CONSOLE.quit, 1500);
  if (r.hub.quitPhase !== "prompt") r.problem("bloqué", "Quit n'ouvre pas l'invite du sifflet");
  await r.click(540, 418, 2500);
  if (r.hub.quitPhase !== "idle") r.problem("bloqué", "un clic ailleurs ne referme pas l'invite du sifflet");
  await r.click(...CONSOLE.quit, 1500);
  await r.click(...centerOf(HUB_OBJECT.whistle), 500);
  await r.tryUntil(() => r.host.exited, 30_000);
  if (!r.host.exited) r.problem("bloqué", "le sifflet ne ferme pas le jeu (host.exit non appelé)");
  return r.host.exited;
}
