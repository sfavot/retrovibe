import type { GameObject } from "../../src/games/armaeth/engine/state";
import { Player } from "./player";

interface Internals {
  barrier(code: number, mode: number, obj: GameObject): number;
}

/** Contretemps prévu (mort du héros, trajet fermé) qui fait recommencer un passage à hasard. */
export class RobotSetback extends Error {}

/** Emplacement opposé (le héros qui sort par l'emplacement `i` arrive par `OPPOSITE[i]`). */
const OPPOSITE = [2, 3, 0, 1, 5, 4] as const;

/** Côtés des sorties à marcher, dans l'ordre des emplacements 0 à 3 de `WorldRoom.exits`. */
const SIDES = ["up", "right", "down", "left"] as const;

/**
 * Joueur robot : en plus du `Player`, il sait traverser le monde salle par salle (recherche de plus court chemin dans le graphe des
 * sorties à marcher, puis `leave`), c'est-à-dire uniquement par des clics et des flèches, jamais par téléportation.
 */
export class Robot extends Player {
  /** Le héros ; mort, il n'y a plus rien à lire : contretemps, l'essai en cours est à recommencer (F3). */
  override get hero(): GameObject {
    const hero = this.state.hero;
    if (!hero) throw new RobotSetback("le héros est mort");
    return hero;
  }

  /** Réflexe du joueur, appelé après chaque image (par exemple fouetter l'ours dès qu'il est à portée). */
  watcher: (() => void) | null = null;
  private watching = false;

  override run(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.engine.tick();
      if (this.watcher && !this.watching) {
        this.watching = true;
        try {
          this.watcher();
        } finally {
          this.watching = false;
        }
      }
    }
  }

  /** Le joueur met quelques secondes à taper : le héros a fini de réagir à son dernier trajet (`Err 0x11`) avant la commande. */
  override say(line: string, settle = 4): string[] {
    this.run(12);
    return super.say(line, settle);
  }

  /**
   * Fait passer les images (en lisant les fenêtres qui s'ouvrent) jusqu'à ce que `done()` soit vrai ; rend vrai si c'est le cas avant
   * `maxFrames`. Les messages lus vont dans `log`.
   */
  until(done: () => boolean, maxFrames = 2000): boolean {
    for (let i = 0; i < maxFrames && !done(); i++) {
      this.run(1);
      if (this.engine.windows.active) this.readWindow();
    }
    return done();
  }

  /** Une touche de direction (flèche) : elle règle la marche du héros ; la rappuyer l'arrête. */
  arrow(key: "up" | "right" | "down" | "left"): void {
    this.host.key({ type: "nav", key });
    this.run(1);
  }

  /** Le caractère `-` (monter) ou `+` / `=` (descendre) : la rappuyer arrête le mouvement vertical (`ENGINE.heroKey`). */
  vertical(key: "-" | "="): void {
    this.host.type(key);
    this.run(1);
  }

  /** Sauvegarde (F2, emplacement 1) comme le fait le joueur avant un passage dangereux. */
  save(): void {
    this.host.key({ type: "function", n: 2 });
    this.run(5);
    this.drain();
  }

  /** Restauration (F3) : l'état du monde revient à la dernière sauvegarde, le hasard continue. */
  restore(): void {
    // une fenêtre de message ouverte (dialogue de Minas Thyl...) avale la touche : on les ferme toutes
    for (let k = 0; k < 30; k++) {
      this.drain();
      if (!this.engine.windows.active) break;
    }
    this.host.key({ type: "function", n: 3 });
    this.run(5);
    this.drain();
    this.run(60);
    this.drain();
    this.entry = -1;
    this.failedExits.clear();
  }

  /**
   * Passage à hasard : sauvegarde, essai, et si `ok` est faux (mort du héros, ours, frelons...) restauration et nouvel essai, au
   * plus `tries` fois. Rend le numéro de l'essai réussi (1 = du premier coup) ; lève sinon.
   */
  attempt(name: string, tries: number, run: () => void, ok: () => boolean): number {
    this.save();
    for (let n = 1; n <= tries; n++) {
      try {
        run();
      } catch (error) {
        if (!(error instanceof RobotSetback)) throw error;
        if (process.env.ROBOT_DEBUG) console.log(`${name} essai ${n} : ${error.message}`);
      }
      if (this.state.hero && ok()) return n;
      if (process.env.ROBOT_DEBUG) console.log(`${name} essai ${n} : échec (héros ${this.state.hero ? "vivant" : "mort"}, salle ${this.roomId}) ${this.log.slice(-2).join(" | ").slice(0, 200)}`);
      this.restore();
      if (process.env.ROBOT_DEBUG) console.log(`${name} restauré : salle ${this.state.loadedRoom?.id}, héros ${this.state.hero ? "vivant" : "absent"}, ${this.state.hero?.x},${this.state.hero?.y}`);
    }
    throw new Error(`${name} : échec après ${tries} essais`);
  }

  /** Hauteur Y du sol de la case (X, P) du plan 0 de la salle chargée (le joueur la lit à l'écran : hauteur du pied pour un clic des bottes). */
  floor(x: number, depth: number): number {
    const terrain = (this.engine as unknown as { terrain: { grid: { spans: Uint16Array } } }).terrain;
    return terrain.grid.spans[(depth >> 3) * 81 + (x >> 2)]! & 0xff;
  }

  /** Salle chargée. */
  get roomId(): number {
    return this.state.loadedRoom!.id;
  }

  /** Voisines à marcher de la salle `id` : `[emplacement, salle]` (sorties libres pour le héros dans l'état courant du monde). */
  neighbours(id: number): [number, number][] {
    const room = this.state.rooms.find((r) => r.id === id)!;
    const out: [number, number][] = [];
    for (let slot = 0; slot < 4; slot++) {
      const idx = room.exits[slot]!;
      const code = room.barriers[slot]!;
      // sortie fermée au héros dans l'état courant du monde (barrage de la forêt, herses, dalles)
      if (idx && (code === 0 || (this.engine as unknown as Internals).barrier(code, 0, this.hero) === 0)) out.push([slot, this.state.rooms[idx]!.id]);
    }
    return out;
  }

  /** Sorties qui ont échoué : `salle>destination@entrée` (l'emplacement par lequel le héros est arrivé, -1 au départ). */
  private readonly failedExits = new Set<string>();
  /** Le joueur oublie les sorties qui n'ont pas marché (le monde a changé : herse levée, planche posée, nouvelle étape). */
  forgetFailures(): void {
    this.failedExits.clear();
  }

  /** Emplacement de la sortie par lequel le héros est entré dans la salle courante (-1 : placement libre). */
  private entry = -1;

  /**
   * Plus court chemin (liste de salles, départ exclu) de la salle courante à `target`, en évitant les salles de `avoid` et les sorties
   * qui ont déjà échoué depuis le même point d'entrée : l'accessibilité d'une sortie dépend du côté par lequel on est arrivé (une
   * salle peut être coupée en deux par un mur, un ruisseau ou une pile de bois).
   */
  route(target: number, avoid: ReadonlySet<number> = new Set()): number[] | null {
    const start = this.roomId;
    const key = (room: number, entry: number) => `${room}@${entry}`;
    const prev = new Map<string, [string, number]>();
    const queue: [number, number][] = [[start, this.entry]];
    const seen = new Set([key(start, this.entry)]);
    let found: string | null = null;
    while (queue.length) {
      const [id, entry] = queue.shift()!;
      if (id === target) {
        found = key(id, entry);
        break;
      }
      for (const [slot, next] of this.neighbours(id)) {
        if (avoid.has(next) || this.failedExits.has(`${id}>${next}@${entry}`)) continue;
        const k = key(next, OPPOSITE[slot]!);
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, [key(id, entry), next]);
        queue.push([next, OPPOSITE[slot]!]);
      }
    }
    if (!found) return null;
    const rooms: number[] = [];
    for (let k = found; k !== key(start, this.entry); ) {
      const [from, room] = prev.get(k)!;
      rooms.unshift(room);
      k = from;
    }
    return rooms;
  }

  /** Côté de l'écran (`up`...) de la sortie de la salle chargée qui mène à `dest`, selon la permutation des côtés de la scène. */
  sideTo(dest: number): (typeof SIDES)[number] {
    const slot = this.neighbours(this.roomId).find(([, id]) => id === dest)![0];
    const terrain = (this.engine as unknown as { terrain: { permutation: number[] } }).terrain;
    return SIDES[terrain.permutation[slot]!]!;
  }

  /** Arrête le héros (il garde son élan en entrant dans une salle) : un clic des bottes sous ses pieds. */
  stop(): void {
    if (!this.state.hero) return;
    this.walkTo(this.hero.x, this.hero.y, 300);
    this.run(10);
  }

  /**
   * Sort de la salle du côté géométrique `side` : clic droit des bottes dans le secteur `sector` (`interface.md` § 5.6 ; le secteur est
   * l'emplacement de sortie, le héros marche ensuite vers le côté que la permutation de la scène lui donne : `side` et `sector`
   * diffèrent dans les salles à côtés permutés de la mine) ; si le trajet n'existe pas depuis la position du héros, clics des bottes
   * au bord puis flèche (`Player.leave`). Rend vrai si la salle a changé.
   */
  exit(side: (typeof SIDES)[number], maxTicks = 3000, quick = false, sector: (typeof SIDES)[number] = side): boolean {
    const before = this.roomId;
    this.stop();
    this.run(15); // le clic d'arrêt lance l'animation de refus du curseur (20 images) : un clic de sortie tombé dedans serait perdu
    this.useBoots();
    const { x, y } = this.origin;
    // les salles étroites de la mine ne remplissent pas la fenêtre : le secteur se lit dans le rectangle de la scène
    const { width: w, height: h } = this.engine.currentScene!.header;
    const spot = { up: [w / 2, Math.max(12, h * 0.12)], right: [w * 0.94, h * 0.4], down: [w / 2, h * 0.72], left: [w * 0.06, h * 0.4] }[sector].map(Math.round) as [number, number];
    // un trajet qui s'interrompt (`Err 0x11`, passage d'un plan à l'autre) est relancé par un nouveau clic, comme le ferait le joueur
    for (let round = 0; round < 4 && this.state.loadedRoom?.id === before && this.state.hero; round++) {
      if (round > 0) {
        // le héros arrêté (`Err 0x11`) ne prend un nouveau trajet qu'après un premier clic, qui n'est que l'arrêt
        this.stop();
        this.run(15);
      }
      this.click(x + spot[0], y + spot[1], 2);
      let walked = false;
      for (let i = 0; i < maxTicks && this.state.loadedRoom?.id === before && this.state.hero && this.hero.path.defined; i += 5) {
        walked = true;
        this.run(5);
        this.drain(4);
      }
      if (process.env.ROBOT_DEBUG) console.log(`exit ${before} côté ${side} tour ${round} : marché ${walked}, héros ${this.state.hero ? [this.hero.x, this.hero.y, this.hero.p, this.hero.err].join(",") : "mort"}`);
      if (!walked) break;
    }
    // `quick` : le joueur presse (salle dangereuse) : il ne s'arrête pas et reprend la main dès l'arrivée
    if (quick && this.state.loadedRoom?.id !== before) return true;
    this.run(30);
    this.drain(20);
    let moved = this.state.loadedRoom?.id !== before;
    if (!moved && this.state.hero) moved = this.leave(side);
    if (moved) this.stop();
    return moved;
  }

  /** Marche jusqu'à la salle `target` par les sorties ; rend les salles traversées. Lève si aucune route ne reste. */
  goTo(target: number, avoid: ReadonlySet<number> = new Set(), quick = false): number[] {
    const visited: number[] = [];
    for (let guard = 0; this.roomId !== target && guard < 60; guard++) {
      if (!this.state.hero) throw new RobotSetback(`héros mort en route vers la salle ${target} (salle ${this.roomId})`);
      const path = this.route(target, avoid);
      if (!path) throw new Error(`aucune route de la salle ${this.roomId} à ${target}`);
      const from = this.roomId;
      const dest = path[0]!;
      const slot = this.neighbours(from).find(([, id]) => id === dest)![0];
      const side = this.sideTo(dest);
      let moved = false;
      for (let attempt = 0; attempt < 2 && !moved; attempt++) moved = this.exit(side, 3000, quick && this.roomId === from && path.length === 1, SIDES[slot]);
      if (!moved) {
        this.failedExits.add(`${from}>${dest}@${this.entry}`);
        continue;
      }
      if (process.env.ROBOT_DEBUG) console.log(`goTo ${from} -> ${dest} (côté ${side}) arrivé ${this.roomId} moved ${moved}`);
      this.entry = this.roomId === dest ? OPPOSITE[slot]! : -1;
      visited.push(this.roomId);
    }
    if (this.roomId !== target) throw new Error(`salle ${target} non atteinte (en ${this.roomId})`);
    return visited;
  }

  /**
   * Les nains, soldats et Sarhûls éveillés de la salle chargée : ce que le joueur voit en entrant. Les gardes de poste (soldats `Ego 5` et
   * `6`) n'attaquent pas tant qu'un autre soldat dort ou veille dans la salle (`characters.md` § 7.3) : ils ne comptent pas.
   */
  threats(): GameObject[] {
    return this.state.objects.filter(
      (o) => ((o.num >= 201 && o.num <= 204) || o.num === 301 || o.num === 302) && o.room === this.state.loadedRoom && o.holder === null && o.ego !== 7 && o.ego !== 8 && o.ego !== 2 && o.ego !== 3 && !(o.num === 301 && (o.ego === 5 || o.ego === 6)),
    );
  }

  /**
   * Passe dans la salle `room` (voisine) comme un joueur prudent : si des ennemis éveillés y sont à l'arrivée, il ressort aussitôt, attend
   * et recommence (au plus `patience` fois). Lève `RobotSetback` si la salle reste occupée ou si le héros meurt.
   */
  hop(room: number, patience = 8): void {
    for (let k = 0; k < patience; k++) {
      const from = this.roomId;
      try {
        this.goTo(room, new Set(), true);
      } catch (error) {
        if (!this.state.hero || this.hero.ego === 6) throw new RobotSetback(String(error));
        throw error;
      }
      if (this.threats().length === 0) return;
      try {
        this.goTo(from, new Set(), true);
      } catch (error) {
        // la sortie par laquelle le héros est venu est fermée derrière lui (herse refermée par les nains) : il n'a plus qu'à recharger
        throw new RobotSetback(`pas de retraite : ${String(error)}`);
      }
      this.stop(); // le héros garde son élan en entrant : il ne doit pas filer jusqu'au vide pendant l'attente
      for (let i = 0; i < 40; i++) {
        this.run(10);
        this.drain(2);
        if (process.env.ROBOT_DEBUG && this.state.hero && i % 8 === 0) console.log("attente", this.roomId, [this.hero.x, this.hero.y, this.hero.p, this.hero.ground, this.hero.ego, this.hero.err].join(","));
        if (!this.state.hero) {
          if (process.env.ROBOT_DEBUG) console.log("mort en attendant en", this.roomId, this.log.slice(-2).join(" | "));
          throw new RobotSetback("mort en attendant");
        }
      }
    }
    throw new RobotSetback(`salle ${room} encombrée`);
  }
}
