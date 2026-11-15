/**
 * Solution des *Voyageurs du temps* en données (vague K), jouée par `Driver.run` (`driver.ts`) avec de vraies entrées, du démarrage
 * (introduction comprise) jusqu'au générique de fin. Les objets sont désignés par `nom#index` (nom de la table OBJ courante, contrôlé
 * avant chaque clic).
 *
 * Établie d'après les scripts désassemblés (PRC, REL) et les messages (MSG) de chaque partie, et d'après une soluce connue du jeu ; les
 * `note` disent pourquoi une étape est là quand ce n'est pas évident. Les points de marche viennent des cartes de collision (`.NEO`) : le
 * héros s'arrête avec ses pieds (x + 8, y + 31) à environ deux pixels du point cliqué.
 */

import type { Driver, Step } from "./driver";

export interface Phase {
  name: string;
  steps: Step[];
}

/** Crughons du tir (objets et globales 210 à 219 : 0 vivant, 1 touché) et leur chef (221, globale 220). */
const CRUGHONS = [210, 211, 212, 213, 214, 215, 216, 217, 218, 219];
const CHIEF = 221;
/** Un Crughon qui tire depuis x 122 à 142 touche le héros (scripts 6 à 17). */
const DANGER_X = 132;

/**
 * Le tir de L34 (scripts 2 à 29 de PART04) : à chaque tick, un clic sur le chef s'il est sur sa plate-forme, sinon sur le Crughon vivant le
 * plus proche de la zone dangereuse. Fini quand le chef est tombé et les dix Crughons abattus (« HOURRA ! »).
 */
function shootCrughons(d: Driver): void {
  for (let i = 0; i < 20_000 && !d.saw("HOURRA"); i++) {
    const s = d.state;
    if (s.allowPlayerInput) {
      const shown = (idx: number) => s.overlays.some((o) => o.objIdx === idx && o.type === 0) && s.objects[idx]!.x >= 0 && s.objects[idx]!.x < 320;
      const targets = shown(CHIEF) ? [CHIEF] : CRUGHONS.filter((idx) => s.globals[idx] === 0 && shown(idx)).sort((a, b) => Math.abs(s.objects[a]!.x - DANGER_X) - Math.abs(s.objects[b]!.x - DANGER_X));
      for (const idx of targets) {
        const point = d.findClickPoint(idx);
        if (point) {
          d.press(`c ${point[0]} ${point[1]} 1`);
          break;
        }
      }
    }
    d.tick();
  }
  if (!d.saw("HOURRA")) throw new Error(`le tir ne finit pas\n${d.describe()}`);
}

/** Sens de la course (0 : arrêt). */
const VAR_WALK_X = 253;

/** Échelles du labyrinthe (objets 200 à 205) : leur y dit où elles mènent. */
const LADDER_Y = { U: 16, M: 66, D: 116 } as const;
/** Niveaux d'une salle du labyrinthe : y du héros en haut et en bas. */
const LEVEL_Y = { h: 61, b: 111 } as const;

/**
 * Le labyrinthe de PART04B (décor L44, 3 colonnes × 8 rangées de salles ; salle = costume du héros, dizaines = rangée) : `route` est une
 * suite de mouvements, chacun suivi de la salle et du niveau attendus (`R 01h`, `M224 01b`…) :
 * - `R` / `L` : courir vers la sortie droite / gauche (salle voisine) ;
 * - `M<x>`, `U<x>`, `D<x>` : l'échelle en x (au milieu de la salle, vers la salle du dessus, vers celle du dessous). Le héros doit être
 *   arrêté avec x + 8 = x de l'échelle (il s'arrête toujours sur un multiple de 8, rel 1 à 6), puis on clique l'échelle.
 */
function maze(route: string): (d: Driver) => void {
  const moves = route.trim().split(/\s+/);
  return (d) => {
    const running = () => d.state.globals[VAR_WALK_X] !== 0;
    const climbing = () => d.state.globalScripts.some((g) => g.index === 22 || g.index === 23);
    for (let i = 0; i < moves.length; i += 2) {
      const move = moves[i]!;
      const expected = moves[i + 1]!;
      const feet = d.hero.y + 31;
      if (move === "R" || move === "L") {
        // La cible de la course survit au changement de salle : le mouvement suivant la remplace (le dernier l'arrête, x + 16).
        const from = d.hero.costume;
        d.press(`c ${move === "R" ? 318 : 1} ${feet} 1`);
        d.until((x) => x.hero.costume !== from, `sortie ${move} de la salle ${from}`, 300);
        if (i + 2 >= moves.length) d.press(`c ${d.hero.x + 16} ${feet} 1`);
      } else {
        const lx = Number(move.slice(1));
        const ly = LADDER_Y[move[0] as keyof typeof LADDER_Y];
        const target = lx - 8;
        // Script 10 : arrêt dès que la cible est dans [x + 12, x + 20] ; la course avance de 4 à 7 pixels, puis le héros se cale sur le
        // multiple de 8 suivant dans son sens de marche, sauf au-dessus d'un trou du sol (zone 0). Vers la gauche il faut viser x + 19,
        // vers la droite x + 14 ; un héros arrêté ailleurs passe de l'autre côté de l'échelle (24 pixels, sans sortir de la salle) et revient.
        const approach = () => d.press(`c ${target + (d.hero.x > target ? 19 : 14)} ${feet} 1`);
        approach();
        let backing = false;
        let attempts = 0;
        let still = 0;
        let last = d.hero.x;
        for (let t = 0; !(d.hero.x === target && !running()); t++) {
          if (t > 600 || attempts > 6) throw new Error(`labyrinthe : le héros ne s'arrête pas en x = ${target}\n${d.describe()}`);
          d.tick();
          // Arrêté, ou bloqué au bord d'un trou (le sens de course reste alors posé) : quatre ticks sans bouger.
          still = d.hero.x === last ? still + 1 : 0;
          last = d.hero.x;
          if (still < 4 || d.hero.x === target) continue;
          still = 0;
          if (backing) {
            approach();
          } else {
            const other = Math.min(272, Math.max(16, d.hero.x > target ? target - 24 : target + 24));
            d.press(`c ${other + 16} ${feet} 1`);
            attempts++;
          }
          backing = !backing;
        }
        const ladder = [200, 201, 202, 203, 204, 205].find((idx) => d.state.objects[idx]!.x === lx && d.state.objects[idx]!.y === ly);
        if (ladder === undefined) throw new Error(`labyrinthe : pas d'échelle ${move}\n${d.describe()}`);
        const [cx, cy] = d.clickPoint(ladder);
        d.press(`c ${cx} ${cy} 1`);
        d.tick();
      }
      const room = Number(expected.slice(0, 2));
      const level = LEVEL_Y[expected[2] as keyof typeof LEVEL_Y];
      const arrived = (x: Driver) => x.hero.costume === room && x.hero.y === level && !climbing();
      d.until((x) => arrived(x) && (move === "R" || move === "L" || !running()), `salle ${expected} (${move})`, 400);
    }
    d.waitIdle(300);
  };
}

/** Entrées permises, aucune relation en cours, héros immobile depuis 6 ticks (salles sans script de marche 10). */
const settled = (d: Driver) => d.state.allowPlayerInput !== 0 && d.state.objectScripts.length === 0 && d.stillFor >= 6;

/** Aucun script d'objet ne tourne (une relation est finie). */
const noObjectScript = (d: Driver) => d.state.objectScripts.length === 0;

/** Le décor courant est `bg`. */
const inBg = (bg: string) => (d: Driver) => d.bg === bg;

export const PHASES: Phase[] = [
  {
    name: "0. introduction",
    steps: [{ until: (d) => d.bg === "L1.PI1" && d.state.allowPlayerInput !== 0, what: "fin de l'introduction", max: 1000 }],
  },
  {
    name: "1. l'échafaudage, le bureau, le labo (1989)",
    steps: [
      { take: "seau d'eau#3", expect: (d) => d.has("seau d'eau#3") },
      { look: "echafaudage#2", note: "fait apparaître le boîtier et ses deux boutons (script 6)" },
      { walk: [123, 154] },
      { act: "Bouton Rouge#17", note: "l'échafaudage monte jusqu'à la fenêtre" },
      { walk: [180, 66] },
      { act: "fenetre#19" },
      { walk: [172, 35], expect: inBg("L2.PI1"), note: "clic au-dessus du héros : il enjambe la fenêtre (script 24, globale 10)" },
      { walk: [131, 128] },
      { take: "sac en plastique#34", expect: (d) => d.has("sac en plastique#34") },
      { walk: [201, 126] },
      { act: "tapis#30", expect: (d) => d.has("Cle#36") },
      { walk: [101, 122] },
      { act: "placard#26" },
      { take: "Bombe Insecticide#38", expect: (d) => d.has("Bombe Insecticide#38") },
      { walk: [80, 120] },
      { act: "porte WC#25" },
      { take: "petit drapeau#40", expect: (d) => d.has("petit drapeau#41") },
      { walk: [72, 126] },
      { use: "seau d'eau#3", on: "evier#24", expect: (d) => d.has("seau rempli#44") },
      { walk: [175, 118] },
      { use: "seau rempli#44", on: "porte#31" },
      { walk: [215, 124] },
      { act: "porte#33", note: "le patron entre par la porte du milieu et reçoit le seau ; le héros sort seul à droite (scripts 29, 25)" },
      { until: inBg("L3.PI1"), what: "bureau du patron", max: 1500 },
      { look: "carte#53" },
      { use: "petit drapeau#41", on: "petit trou#67", note: "le passage secret s'ouvre derrière la carte" },
      { walk: [180, 130] },
      { act: "tiroir#61" },
      { take: "liasse de papier#66", expect: (d) => d.has("liasse de papier#66") },
      { walk: [125, 122] },
      { use: "Cle#36", on: "placard#58", note: "le bon placard : la machine à écrire apparaît" },
      { look: "machine a ecrire#63", expect: (d) => d.saw("40315") },
      { walk: [200, 132], note: "le bas de la pièce : le haut est barré par le bureau" },
      { walk: [225, 124] },
      { until: inBg("L4.PI1"), what: "passage secret", max: 300 },
      { look: "Pave Numerique#88", note: "le plafond descend : le code 40315 (machine à écrire) l'arrête" },
      { act: "4#82" },
      { act: "0#78" },
      { act: "3#81" },
      { act: "1#79" },
      { act: "5#83", expect: (d) => d.saw("BON CODE") },
      { walk: [143, 122], note: "le seuil (zone 3, x 138 à 151) ne laisse monter que le héros en x = 134 ou 135 : se placer d'abord" },
      { walk: [143, 114] },
      { walk: [172, 114] },
      { until: inBg("L5.PI1"), what: "laboratoire", max: 300 },
      { walk: [176, 134], note: "descendre par la colonne de droite (zone 3, héros en x ≥ 164), puis à gauche vers la fente (zone 2)" },
      { walk: [176, 147] },
      { walk: [150, 146] },
      { use: "liasse de papier#66", on: "ouverture#106" },
      { act: "bouton vert#108", note: "met en route la machine à voyager dans le temps (script 39 attend le héros sur la plate-forme)" },
      { walk: [178, 146] },
      { act: "bouton rouge#107", idle: false, note: "les documents sortent, puis l'alarme : un garde arrive (script 40)" },
      { until: (d) => d.state.objects[109]!.name === "documents" && d.state.overlays.some((o) => o.objIdx === 109) && d.idle, what: "les documents sont sortis", max: 200 },
      { take: "documents#109", expect: (d) => d.has("documents#109") },
      { walk: [196, 134], idle: false, note: "la plate-forme : téléportation au Moyen Âge (script 39), avant le garde" },
      { until: (d) => d.state.names.part === "PART02", what: "chargement de PART02", max: 300 },

    ],
  },
  {
    name: "2. le marécage, la clairière, le village, le monastère (Moyen Âge)",
    steps: [
      { until: (d) => d.bg === "L6.PI1" && d.walking && d.idle, what: "arrivée dans le marécage", max: 1500 },
      { walk: [210, 146], note: "la boue (zone 4) tue : longer la ligne de pieds 146 puis 140" },
      { walk: [210, 138] },
      { walk: [137, 138], note: "héros en x 125 à 130 : les moustiques tuent en x ≤ 124, l'insecticide n'agit qu'en x ≤ 130" },
      { use: "Bombe Insecticide#38", on: "moustiques#5" },
      { walk: [28, 138] },
      { look: "Eclat#7", expect: (d) => d.has("pendentif#8") },
      { walk: [6, 138] },
      { until: inBg("L7.PI1"), what: "la clairière", max: 300 },
      { walk: [150, 153] },
      { walk: [50, 149] },
      { look: "pied de l'arbre#18", expect: (d) => d.has("Corde#20") },
      { use: "Corde#20", on: "branche d'arbre#19", max: 3000, note: "perché dans l'arbre, le héros voit un paysan se baigner dans le lac" },
      { walk: [122, 152] },
      { take: "tunique#22" },
      { take: "pantalon#23", expect: (d) => d.state.globals[200] === 1, note: "habits de paysan : globale 200 = 1" },
      { walk: [6, 150] },
      { until: inBg("L8.PI1"), what: "le village", max: 300 },
      { walk: [140, 162] },
      { walk: [140, 134] },
      { walk: [25, 134], note: "sortie à gauche (zone 1) vers la forêt" },
      { until: inBg("L11.PI1"), what: "la forêt", max: 300 },
      { walk: [296, 145] },
      { walk: [100, 145] },
      { act: "arbre#52", note: "une pièce tombe" },
      { look: "sol#113", expect: (d) => d.has("piece en argent#56") },
      { walk: [318, 145], note: "retour au village (zone 1 à droite)" },
      { until: inBg("L8.PI1"), what: "le village", max: 300 },
      { walk: [150, 134] },
      { walk: [150, 154] },
      { walk: [200, 154] },
      { act: "porte#43" },
      { until: inBg("L9.PI1"), what: "l'auberge", max: 300 },
      { use: "piece en argent#56", on: "aubergiste#31", idle: false, note: "on écoute les clients : globale 201 = 1" },
      { until: (d) => d.state.globals[201] === 1 && d.idle, what: "fin de la conversation des clients", max: 2000 },
      { walk: [106, 140] },
      { walk: [106, 144] },
      { until: inBg("L8.PI1"), what: "le village", max: 300 },
      { walk: [199, 156] },
      { walk: [45, 156] },
      { use: "pendentif#8", on: "garde#24", max: 3000, note: "le seigneur Torin reçoit le héros (L10), puis le garde s'endort" },
      { until: (d) => d.bg === "L8.PI1" && d.idle, what: "retour au village", max: 3000 },
      { take: "lance#62", expect: (d) => d.has("lance#62") },
      { walk: [140, 160] },
      { walk: [140, 134] },
      { walk: [25, 134] },
      { until: inBg("L11.PI1"), what: "la forêt", max: 300 },
      { walk: [296, 165] },
      { walk: [134, 165], note: "héros en x 124 à 128, pieds dans la zone 3" },
      { use: "lance#62", on: "soutane#55", max: 2000, expect: (d) => d.state.globals[200] === 2, note: "habit de moine : globale 200 = 2" },
      { walk: [318, 165] },
      { until: inBg("L8.PI1"), what: "le village", max: 300 },
      { walk: [140, 134] },
      { walk: [140, 160] },
      { walk: [306, 160] },
      { until: inBg("L7.PI1"), what: "la clairière", max: 300 },
      { walk: [88, 167], note: "monter vers la rive (zone 6) par le couloir x 71 à 105 (le héros teste x + 4 à x + 15)" },
      { walk: [88, 135] },
      { use: "sac en plastique#34", on: "lac#61", expect: (d) => d.has("sac rempli#101"), note: "le sac fuit : 200 ticks pour atteindre les loups" },
      { walk: [88, 159] },
      { walk: [4, 159] },
      { until: inBg("L8.PI1"), what: "le village", max: 300 },
      { walk: [200, 190] },
      { until: inBg("L12.PI1"), what: "les loups", max: 300 },
      { walk: [90, 75], note: "descente en zigzag : la marche verticale teste x + 4 à x + 15 sous les pieds" },
      { walk: [90, 121] },
      { walk: [101, 121] },
      { walk: [101, 133] },
      { walk: [106, 133], note: "le goulot (zone 4) : la zone 3, juste en dessous, est mortelle tant que les loups vivent" },
      { use: "sac rempli#101", on: "loup#57", note: "le loup électronique prend une décharge" },
      { walk: [103, 145] },
      { walk: [255, 145] },
      { walk: [255, 133] },
      { act: "porte#64", idle: false, note: "entrée du monastère : PART02B.PRC" },
      { until: (d) => d.state.names.prc === "PART02B.PRC" && d.idle, what: "la salle du monastère", max: 1000 },
      { walk: [80, 144], note: "le tour du cloître dans le sens des aiguilles d'une montre (script 3), sans poser le pied au centre (zone 2)" },
      { walk: [80, 60] },
      { walk: [89, 88] },
      { walk: [85, 40] },
      { walk: [215, 76] },
      { walk: [213, 102] },
      { act: "porte#71" },
      { walk: [239, 102] },
      { until: inBg("L16.PI1"), what: "la chambre du père supérieur", max: 300 },
      { walk: [105, 146], idle: false, note: "« Frère, va me chercher une coupe de Chikapok ! » : globale 201 = 1" },
      { until: (d) => d.saw("Chikapok") && d.idle, what: "la commande du père supérieur", max: 1000 },
      { walks: [[70, 146], [40, 146]], until: inBg("L13.PI1"), what: "sortie vers le cloître", note: "la sortie (zone 1, x 61 à 65 sous x + 6) n'est atteinte qu'à certaines phases du pas : aller-retour" },
      { until: (d) => d.idle, what: "entrée dans le cloître", max: 300 },
      { walk: [221, 142], note: "descendre le côté droit, puis à gauche le long du bas, puis monter le côté gauche (sens horaire)" },
      { walk: [80, 140] },
      { walk: [80, 98] },
      { act: "porte#70" },
      { walk: [60, 100] },
      { until: inBg("L14.PI1"), what: "l'entrepôt", max: 300 },
      { walk: [95, 148] },
      { take: "coupe#75", expect: (d) => d.has("coupe#75"), note: "permis seulement après la commande du père (globale 201)" },
      { walk: [258, 148] },
      { until: (d) => d.bg === "L13.PI1" && d.idle, what: "le cloître", max: 300 },
      { walk: [83, 96] },
      { walk: [80, 60] },
      { walk: [89, 88] },
      { walk: [85, 40] },
      { walk: [153, 76] },
      { act: "porte#72" },
      { walk: [153, 60], note: "droit vers le haut : un pas à gauche dans le couloir du haut serait une faute (script 3)" },
      { until: inBg("L15.PI1"), what: "la cave", max: 300 },
      { walk: [70, 83], note: "l'escalier se descend seul (script 14)" },
      { walk: [180, 143] },
      { use: "coupe#75", on: "tonneau#82", expect: (d) => d.has("coupe remplie#88") },
      { walk: [121, 143], note: "l'escalier se remonte seul (zone 3)" },
      { walk: [46, 40], note: "clic au-dessus du héros : sortie vers le cloître (script 13)" },
      { until: (d) => d.bg === "L13.PI1" && d.idle, what: "le cloître", max: 300 },
      { walk: [215, 70] },
      { walk: [213, 102] },
      { act: "porte#71", note: "les portes se referment à chaque retour dans le cloître" },
      { walk: [239, 102] },
      { until: (d) => d.bg === "L16.PI1" && d.idle, what: "la chambre du père supérieur", max: 300 },
      { walk: [105, 146], idle: false, note: "le père boit le vin (ce n'est pas du Chikapok) et s'écroule, ivre mort" },
      { until: (d) => d.saw("ivre mort") && d.idle, what: "le père supérieur ivre", max: 2000 },
      { look: "pere superieur#87", expect: (d) => d.has("telecommande#93") },
      { use: "telecommande#93", on: "meuble#92", expect: (d) => d.has("carte magnetique#94") },
      { walks: [[70, 146], [40, 146]], until: inBg("L13.PI1"), what: "sortie vers le cloître" },
      { until: (d) => d.idle, what: "entrée dans le cloître", max: 300 },
      { walk: [221, 142] },
      { walk: [80, 140] },
      { walk: [80, 60] },
      { walk: [89, 88] },
      { walk: [85, 40] },
      { walk: [153, 76] },
      { act: "porte#72" },
      { walk: [153, 60], note: "droit vers le haut : un pas à gauche dans le couloir du haut serait une faute (script 3)" },
      { until: (d) => d.bg === "L15.PI1" && d.idle, what: "la cave", max: 300 },
      { walk: [70, 83] },
      { walk: [165, 143], note: "héros en x 157 à 160, sous l'échelle" },
      { use: "telecommande#93", on: "tonneau#77", note: "le tonneau s'ouvre : un passage" },
      { walk: [165, 110], idle: false, note: "clic au-dessus du héros : il monte à l'échelle (script 19), puis entre dans le passage (script 29)" },
      { until: (d) => d.bg === "L17.PI1" && d.idle, what: "le laboratoire de Lana", max: 1000 },
      { walk: [175, 132] },
      { take: "capsule de gaz#99", expect: (d) => d.has("capsule de gaz#99"), note: "servira dans la cellule des Crughons" },
      { walk: [172, 142] },
      { walk: [150, 142] },
      { use: "carte magnetique#94", on: "console#96", idle: false, note: "le caisson s'ouvre : Lana, la fille de Torin ; retour chez Torin puis départ pour 4315 (PART02C)" },
      { until: (d) => d.state.names.part === "PART03" && d.walking && d.idle, what: "arrivée en 4315 (PART03)", max: 5000 },
    ],
  },
  {
    name: "3. les ruines de Paris, les égouts, le navi-port, les Crughons (4315)",
    steps: [
      { walk: [265, 158], note: "contourner par la gauche : la zone 1 des décombres se rejoint par le bas" },
      { walk: [265, 182] },
      { walk: [283, 182] },
      { look: "decombres#10", expect: (d) => d.has("chalumeau#2") },
      { walk: [265, 182] },
      { walk: [265, 150] },
      { walk: [318, 152] },
      { until: (d) => d.bg === "L20.PI1" && d.idle, what: "la rue", max: 300 },
      { walk: [113, 197] },
      { walk: [113, 151] },
      { walk: [80, 153] },
      { take: "decombres#16", expect: (d) => d.has("fusibles#24") },
      { walk: [140, 153] },
      { look: "decombres#14", note: "une plaque d'égout" },
      { act: "plaque d'egout#25", idle: false, note: "le héros, sur la zone 1, descend dans les égouts" },
      { until: (d) => d.bg === "L21.PI1" && d.idle, what: "les égouts", max: 500 },
      { walk: [250, 116], note: "salle A → B (zone 7)" },
      { walk: [205, 116], note: "salle B → C (zone 5)" },
      { use: "chalumeau#2", on: "robinet#26", expect: (d) => d.has("chalumeau rempli#29") },
      { walk: [205, 136], note: "descendre par le puits (zone 8)" },
      { walk: [70, 134], idle: false, note: "salle C → D (zone 13) ; la cible restant à gauche, le héros enchaîne D, E, F, G jusqu'à H" },
      { until: (d) => d.saw("IMMONDE") && d.hero.x >= 150, what: "le héros s'avance vers la créature", max: 1500, note: "il marche seul vers elle : au-delà de x = 169 elle le croque" },
      { use: "chalumeau rempli#29", on: "creature immonde#27", idle: false, note: "le chalumeau n'agit qu'à partir de x = 151" },
      { until: (d) => d.bg === "L22.PI1" && d.idle, what: "le navi-port", max: 3000 },
      { walk: [161, 194] },
      { walk: [161, 160], note: "bien en face de la caméra : héros en x 148 à 153, y ≤ 132" },
      { use: "lance#62", on: "camera#32", note: "la caméra nettoyée, les portes s'ouvrent devant le héros (script 14)" },
      { walk: [161, 148] },
      { until: (d) => d.bg === "L23.PI1" && d.idle, what: "le quai", max: 600 },
      { walk: [30, 158] },
      { look: "recuperateur#35", expect: (d) => d.has("piece#37") },
      { use: "piece#37", on: "fente a monnaie#34", note: "aucun effet : la pièce retombe dans le récupérateur" },
      { look: "recuperateur#35", expect: (d) => d.has("piece#37") },
      { use: "piece#37", on: "fente a monnaie#34", expect: (d) => d.has("journal#38"), note: "ça marche : le journal du 16 juillet 4315" },
      { until: (d) => d.state.zoneData[2] === 2 && d.idle, what: "le train arrive", max: 2000 },
      { walk: [130, 158] },
      { walk: [130, 136], idle: false, note: "monter dans le train (zone 4)" },
      { until: (d) => d.bg === "L24.PI1" && d.idle, what: "le hall et l'hôtesse", max: 1500 },
      { walk: [171, 153] },
      { walk: [171, 199], note: "la sortie du bas (zone 6) : le placard des fusibles" },
      { until: (d) => d.bg === "L25.PI1" && d.idle, what: "le placard", max: 300 },
      { use: "fusibles#24", on: "fusibles#43", note: "« Il ne se passe rien » : mais la télévision du contrôleur marche" },
      { walk: [145, 96] },
      { until: (d) => d.bg === "L24.PI1" && d.idle, what: "retour dans le hall", max: 600 },
      { walk: [171, 173] },
      { walk: [195, 173] },
      { until: (d) => d.state.globals[200] === 1, what: "l'hôtesse surveille", max: 300 },
      { until: (d) => d.state.globals[200] === 0, what: "l'hôtesse est occupée", max: 300 },
      { walk: [226, 173], idle: false, note: "le passage (zone 2) pendant que l'hôtesse pianote (globale 200 = 0)" },
      { until: (d) => d.bg === "L27.PI1" && d.idle, what: "capturé par les Crughons : la cellule", max: 3000 },
      { use: "Cle#36", on: "conduit d'aeration#47", note: "la grille du conduit est dévissée" },
      { use: "capsule de gaz#99", on: "conduit d'aeration#47", idle: false, note: "le gaz : il reste une vingtaine de ticks" },
      { use: "journal#38", on: "conduit d'aeration#47", note: "le journal bouche le conduit ; le garde, endormi par le gaz, ouvre la porte" },
      { walk: [184, 120] },
      { until: (d) => d.bg === "L28.PI1", what: "le vaisseau", max: 300 },
      { until: (d) => d.state.names.part === "PART04" && d.walking && d.idle, what: "jugement, peloton, hypno-éduc, puis le Crétacé (PART04)", max: 8000, note: "ne pas bouger : les Crughons découvrent le héros, puis tout est cinématique" },
    ],
  },
  {
    name: "4. le Crétacé : les Crughons, le caisson, le hangar (PART04)",
    steps: [
      { walk: [230, 103], note: "descendre l'éboulis en diagonale" },
      { walk: [187, 135] },
      { walk: [160, 151] },
      { walk: [128, 167] },
      { walk: [100, 177] },
      { walk: [50, 185], note: "Lo'Ann donne le fuseur" },
      { walk: [8, 184], idle: false },
      { until: (d) => d.bg === "L34.PI1" && d.state.allowPlayerInput !== 0 && d.saw("clicker"), what: "le tir", max: 2000 },
      { run: shootCrughons, what: "le tir : abattre les Crughons, puis leur chef", idle: false },
      { until: (d) => d.saw("PRENDS CA") && d.state.globals[2] === 1, what: "Lo'Ann est blessée (globale 2 = 1)", max: 1000 },
      { look: "Lo'Ann#98", idle: false, note: "le héros ne marche plus (pas de script 10) jusqu'au départ de Lo'Ann" },
      { until: noObjectScript, what: "examen 1", max: 300 },
      { look: "Lo'Ann#98", idle: false },
      { until: noObjectScript, what: "examen 2", max: 300, expect: (d) => d.has("pillule#4") },
      { look: "Lo'Ann#98", idle: false },
      { until: noObjectScript, what: "examen 3", max: 300, expect: (d) => d.has("pendentif#2") },
      { use: "pendentif#2", on: "Lo'Ann#98", idle: false, note: "Albert II la ramène en 4315 ; le héros s'en va seul vers le bas" },
      { until: (d) => d.bg === "L35.PI1" && d.idle, what: "la salle des caissons", max: 1500 },
      { walk: [120, 198] },
      { walk: [120, 164] },
      { look: "crughon#210", expect: (d) => d.has("carte magnetique#14"), note: "un Skaar endormi : sa carte magnétique" },
      { walk: [120, 198] },
      { walk: [194, 198], note: "le couloir vers la porte (zone 1) ne se monte qu'en x 182 à 185" },
      { walk: [194, 138] },
      { walk: [180, 144], note: "en haut du couloir, se décaler à gauche pour atteindre la porte" },
      { walk: [180, 136] },
      { until: (d) => d.bg === "L36.PI1" && d.idle, what: "la salle du caisson", max: 300 },
      { use: "carte magnetique#14", on: "lecteur de carte#13", note: "une seule fois : un second passage éteint les voyants" },
      { walk: [181, 135] },
      { walk: [181, 150] },
      { act: "caisson#7", note: "le couvercle se lève" },
      { take: "vetement#12" },
      { walk: [181, 135] },
      { walk: [112, 137] },
      { use: "vetement#12", on: "camera#11", note: "la caméra aveuglée : sinon le comité d'accueil attend le héros (L42)" },
      { walk: [181, 137] },
      { walk: [181, 150] },
      { click: "caisson#7", idle: false, note: "le héros s'allonge dans le caisson (héros en y ≥ 116)" },
      { until: noObjectScript, what: "allongé", max: 100 },
      { act: "caisson#7", idle: false, note: "le couvercle se referme : voyage (cinématique L37 à L41)" },
      { until: (d) => d.bg === "L42.PI1" && d.walking && d.state.allowPlayerInput !== 0, what: "la cabine (L42)", max: 3000 },
      { walk: [272, 86], note: "monter au fond de la cabine (pieds en y 88, priorité 96)" },
      { walk: [255, 86], note: "attendre à côté de la porte : les deux Crughons en sortent et descendent (priorité 94 à 110)" },
      { until: (d) => d.state.overlays.some((o) => o.objIdx === 60), what: "les Crughons sortent", max: 300 },
      { wait: 23, note: "la pilule au dernier moment : le script 47 cherche le héros 26 ticks après la sortie des Crughons" },
      { use: "pillule#4", on: "heros#1", idle: false, note: "invisible pendant 180 ticks, ou jusqu'à la zone 10 du hangar" },
      { until: (d) => d.state.objects[60]!.y >= 65 && d.state.objects[211]!.y >= 71, what: "les Crughons descendus", max: 300 },
      { walk: [238, 86] },
      { walk: [238, 84], idle: false, note: "la porte (zone 1) : le héros est mené dans le hangar" },
      { until: (d) => d.idle && d.hero.y > 100, what: "le hangar", max: 300 },
      { walk: [149, 177], note: "descendre en x = 138 à 141 : assez loin du Crughon figé en x 156 (même priorité que le héros vers y 154)" },
      { walk: [149, 197] },
      { walk: [44, 197], note: "la caisse : pieds dans la zone 10 (sûre), héros en x ≤ 40" },
      { act: "caisse#15", idle: false, note: "le héros se cache dans la caisse, embarquée sur le vaisseau-bombe (L43)" },
      { until: (d) => d.bg === "L43.PI1" && d.idle, what: "le vaisseau (L43)", max: 2000 },
      { walk: [161, 141], note: "pieds sur la ligne de la porte (zone 1, y 143) : elle s'ouvre (et se referme dès qu'on revient sur le sol, zone 12)" },
      { until: (d) => d.state.zoneData[2] === 2, what: "la porte ouverte", max: 100 },
      { walk: [161, 137], idle: false },
      { until: (d) => d.state.names.part === "PART04B" && d.bg === "L44.PI1" && d.idle, what: "le labyrinthe (PART04B)", max: 1000 },
    ],
  },
  {
    name: "5. le labyrinthe du vaisseau-bombe, l'ordinateur, la fin (PART04B)",
    steps: [
      {
        run: maze(`R 01h M224 01b R 02b D160 12h M224 12b L 11b D176 21h R 22h M32 22b D208 32h L 31h M224 31b D160 41h L 40h M192 40b
          D144 50h M256 50b D288 60h R 61h U160 51b M272 51h R 52h U144 42b M160 42h U176 32b D256 42h M272 42b D288 52h M256 52b D176 62h
          L 61h M272 61b R 62b D112 72h L 71h L 70h M64 70b R 71b`),
        what: "aller : de la salle 00 à la salle 71 (6 minutes en tout, compte à rebours du script 34)",
        idle: false,
      },
      { walk: [166, 142], idle: false, note: "la porte de la salle de l'ordinateur (zone 9)" },
      { until: (d) => d.bg === "L45.PI1" && d.saw("QUE VAIS-JE FAIRE"), what: "la salle de l'ordinateur", max: 600 },
      { walk: [68, 130], idle: false, note: "ici, la marche passe par les scripts 36 et 37 (pas de script 10)" },
      { until: settled, what: "devant la console (zone 2)", max: 300 },
      { use: "carte magnetique#14", on: "console#6", idle: false, note: "ARISTOTE reprogramme le Scorzuum : la bombe frappera la Terre il y a 65 millions d'années" },
      { until: (d) => noObjectScript(d) && !d.has("carte magnetique#14"), what: "la carte consommée", max: 300 },
      { walk: [160, 156], idle: false, note: "sortie au sud : retour dans le labyrinthe (script 38)" },
      { until: (d) => d.bg === "L44.PI1" && d.idle, what: "retour dans le labyrinthe, salle 71", max: 600 },
      {
        run: maze(`L 70b M64 70h R 71h R 72h U112 62b L 61b M272 61h R 62h U176 52b M256 52h U288 42b M272 42h U256 32b D176 42h M160 42b
          D144 52h L 51h M272 51b D160 61h L 60h U288 50b M256 50h U144 40b M192 40h R 41h U160 31b M224 31h L 30h`),
        what: "retour : de la salle 71 à la salle 30, vers les navettes",
        idle: false,
      },
      { walk: [211, 92], idle: false, note: "la navette de secours (zone 8) : fuite, explosion, fin" },
      { until: (d) => d.saw("BIENTOT"), what: "la séquence de fin", max: 6000 },
      { until: (d) => d.bg === "L44.PI1" && d.state.objects[22]!.y < 200, what: "le générique défile", max: 3000 },
    ],
  },
];
