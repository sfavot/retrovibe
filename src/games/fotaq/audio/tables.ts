/**
 * Tables de morceaux et d'effets de Flight of the Amazon Queen, transcrites des données de `engines/queen/musicdata.cpp`
 * (ScummVM, GPL v3 ou ultérieure ; `_song`, `_tune`, `_sfxName`, `_jungleList`), comme `render/font-data.ts` transcrit la
 * police : ce sont des **données du jeu**, absentes de `queen.1c`, et non du code. Transcription faite par un script depuis le
 * texte de ScummVM, relue par les tests (`test/fotaq/audio/tables.test.ts`).
 *
 * Écarts : les champs que le son du PC n'utilise jamais sont omis (`volume`, `tempo`, `reverb` et `ignore` de `SongData`, deuxième
 * effet et `delay` de `TuneData`, listes de la démo) ; seul `tuneList[0]` d'un morceau sert (`PCSound::playSong`). Les noms en
 * commentaire de ScummVM sont gardés (`name`) pour la lisibilité.
 *
 * Vocabulaire : un « morceau » (`song`, numéro de 1 à 209 donné par les listes de commandes) désigne une « liste de morceaux »
 * (`tune`, numéro de 1 à 212) qui contient des numéros de musique de `AQBANK.MUS` (à partir de 1), un effet ou les deux.
 */

export interface SongEntry {
  name: string;
  /** Numéro (à partir de 1) de la liste de morceaux jouée (`tuneList[0]`). */
  tune: number;
  /** 0 : rien ; 1 : musique ; 2 : change le volume de la musique (ou joue l'effet de la liste) puis s'arrête (`overrideCmd`). */
  override: 0 | 1 | 2;
}

export interface TuneEntry {
  name: string;
  /**
   * Numéros de musique (à partir de 1) et valeurs spéciales : 1001 à 1999 = autre liste (valeur - 1000, à partir de 0), 2000 =
   * reprendre le morceau précédent, négatif ou 0 = fin. La fin de liste (0) n'est pas gardée.
   */
  songs: readonly number[];
  /** Numéro d'effet (`_sfxName`, à partir de 1) joué à la place de la musique, 0 si aucun. */
  sfx: number;
  /** 0 aléatoire en boucle, 1 séquentiel en boucle, 2 une fois (`mode`). */
  mode: number;
}

export const SONGS: readonly SongEntry[] = [
  { name: "Hotel Gangsters", tune: 1, override: 1 },
  { name: "Hotel General", tune: 2, override: 1 },
  { name: "Jungle", tune: 3, override: 1 },
  { name: "Waterfall On", tune: 7, override: 0 },
  { name: "Vnormal", tune: 8, override: 2 },
  { name: "Trader Bob", tune: 9, override: 1 },
  { name: "Jetty Music", tune: 10, override: 1 },
  { name: "Ferry Music", tune: 11, override: 1 },
  { name: "Temple Upstairs", tune: 12, override: 1 },
  { name: "Temple Downstairs", tune: 13, override: 1 },
  { name: "Temple Maze", tune: 14, override: 1 },
  { name: "Temple Skull", tune: 15, override: 1 },
  { name: "Johns Theme (Love Story)", tune: 16, override: 1 },
  { name: "Vmedium", tune: 17, override: 2 },
  { name: "Vsoft", tune: 18, override: 2 },
  { name: "Floda Upstairs", tune: 19, override: 1 },
  { name: "Floda General", tune: 20, override: 1 },
  { name: "Klunks Room", tune: 21, override: 1 },
  { name: "Hotel Lola", tune: 22, override: 1 },
  { name: "Hotel Escape 1", tune: 23, override: 1 },
  { name: "Amazon Fortress", tune: 24, override: 1 },
  { name: "Waterfall Off", tune: 25, override: 0 },
  { name: "Wave Torch", tune: 26, override: 0 },
  { name: "Zombies Rez Out", tune: 27, override: 0 },
  { name: "Open Door (standard)", tune: 28, override: 0 },
  { name: "Close Door (standard)", tune: 29, override: 0 },
  { name: "Cloth Unrolls", tune: 30, override: 0 },
  { name: "Snake Slithers Off", tune: 31, override: 0 },
  { name: "Hotel Fanfare 2", tune: 32, override: 1 },
  { name: "Floda Secret", tune: 33, override: 1 },
  { name: "Temple Fanfare 1", tune: 34, override: 1 },
  { name: "Commander Rocket 1", tune: 35, override: 1 },
  { name: "Hotel Escape 2", tune: 36, override: 1 },
  { name: "Back of Truck", tune: 37, override: 1 },
  { name: "Hotel Fanfare 1", tune: 38, override: 1 },
  { name: "Truck Fanfare", tune: 39, override: 1 },
  { name: "Airport", tune: 40, override: 1 },
  { name: "Plane Leaves", tune: 41, override: 1 },
  { name: "Arrive Hotel", tune: 42, override: 1 },
  { name: "Jungle Fanfare", tune: 43, override: 1 },
  { name: "General Fanfare", tune: 44, override: 1 },
  { name: "Johns Room", tune: 45, override: 1 },
  { name: "Floda Lab", tune: 46, override: 1 },
  { name: "Azura's Theme", tune: 47, override: 1 },
  { name: "Use Record", tune: 48, override: 1 },
  { name: "Franks Theme", tune: 49, override: 1 },
  { name: "Anderson Doubts", tune: 50, override: 1 },
  { name: "Bud and Lou Theme", tune: 51, override: 1 },
  { name: "Gorilla Theme", tune: 52, override: 1 },
  { name: "Missionaries Theme", tune: 53, override: 1 },
  { name: "Sloth Theme", tune: 54, override: 1 },
  { name: "Amazon Dungeon", tune: 55, override: 1 },
  { name: "Throne Room", tune: 56, override: 1 },
  { name: "Temple Puzzle", tune: 57, override: 1 },
  { name: "Temple Fountain Room", tune: 58, override: 1 },
  { name: "Light Switch", tune: 59, override: 0 },
  { name: "Hydraulic Open", tune: 60, override: 0 },
  { name: "Hydraulic Close", tune: 61, override: 0 },
  { name: "Close Door (metal)", tune: 62, override: 0 },
  { name: "Small Hatch Close", tune: 63, override: 0 },
  { name: "Scissors Snip", tune: 64, override: 0 },
  { name: "Pick up Sticky", tune: 65, override: 0 },
  { name: "Oracle Rezzes In", tune: 66, override: 0 },
  { name: "Sparkle SFX", tune: 67, override: 0 },
  { name: "Splorch!", tune: 68, override: 0 },
  { name: "Pour Liquid", tune: 69, override: 0 },
  { name: "End Credit Medley", tune: 70, override: 1 },
  { name: "Dino Ray", tune: 71, override: 0 },
  { name: "Squish!", tune: 72, override: 0 },
  { name: "Robot Laser", tune: 73, override: 0 },
  { name: "Thud wood light", tune: 74, override: 0 },
  { name: "Thud wood deep", tune: 75, override: 0 },
  { name: "Thud metallic", tune: 76, override: 0 },
  { name: "Cut Coconut", tune: 77, override: 0 },
  { name: "Thud Stone", tune: 78, override: 0 },
  { name: "Cloth Slide 1", tune: 79, override: 0 },
  { name: "Open Chest", tune: 80, override: 0 },
  { name: "Close Chest", tune: 81, override: 0 },
  { name: "Open Drawer", tune: 82, override: 0 },
  { name: "Truck door closes", tune: 83, override: 0 },
  { name: "Truck Starts", tune: 84, override: 0 },
  { name: "Truck Drives Off", tune: 85, override: 0 },
  { name: "Fish Splash", tune: 86, override: 0 },
  { name: "Close Drawer/Push Ladder", tune: 87, override: 0 },
  { name: "Aggression Enhancer", tune: 88, override: 0 },
  { name: "Stone Door Grind 1", tune: 89, override: 0 },
  { name: "Prequel 1", tune: 90, override: 1 },
  { name: "Intro Credits", tune: 91, override: 1 },
  { name: "Valley 1", tune: 92, override: 1 },
  { name: "Valley 3", tune: 93, override: 1 },
  { name: "Fight Music", tune: 94, override: 1 },
  { name: "Confrontation 1", tune: 95, override: 1 },
  { name: "Confrontation 2", tune: 96, override: 1 },
  { name: "Plane Hatch Open", tune: 97, override: 0 },
  { name: "Plane Hatch Close", tune: 98, override: 0 },
  { name: "Tie Vines", tune: 99, override: 0 },
  { name: "Pterodactyl", tune: 100, override: 0 },
  { name: "Beef Jerky Splash", tune: 101, override: 0 },
  { name: "Piranha Burp", tune: 102, override: 0 },
  { name: "Falling Vine", tune: 103, override: 0 },
  { name: "Stone Door Grind 2", tune: 104, override: 0 },
  { name: "Stone Grind (light)", tune: 105, override: 0 },
  { name: "Ape Takes Off Mask", tune: 106, override: 0 },
  { name: "Bark Breaks", tune: 107, override: 0 },
  { name: "Stone Click", tune: 108, override: 0 },
  { name: "Sproing!", tune: 109, override: 0 },
  { name: "Cash Register", tune: 110, override: 0 },
  { name: "Squeaky Toy", tune: 111, override: 0 },
  { name: "Falling Chains", tune: 112, override: 0 },
  { name: "Open Locker Door", tune: 113, override: 0 },
  { name: "Close Locker Door", tune: 114, override: 0 },
  { name: "Rub Pencil", tune: 115, override: 0 },
  { name: "Open Safe", tune: 116, override: 0 },
  { name: "Close Safe", tune: 117, override: 0 },
  { name: "Push Chair", tune: 118, override: 0 },
  { name: "Snake Hiss", tune: 119, override: 0 },
  { name: "Oracle Rezzes Out", tune: 120, override: 0 },
  { name: "Wall Crumbles", tune: 121, override: 0 },
  { name: "Crypt Crumbles", tune: 122, override: 0 },
  { name: "Joe Sucked Up", tune: 123, override: 0 },
  { name: "Rocket Pack Zoom", tune: 124, override: 0 },
  { name: "Piranha Splash", tune: 125, override: 0 },
  { name: "Snap Branch", tune: 126, override: 0 },
  { name: "Dino Horn", tune: 127, override: 0 },
  { name: "Tire Screech", tune: 128, override: 0 },
  { name: "Oil Splat", tune: 129, override: 0 },
  { name: "Punch", tune: 130, override: 0 },
  { name: "Body Hits Ground", tune: 131, override: 0 },
  { name: "Chicken", tune: 132, override: 0 },
  { name: "Open Sarcophagus", tune: 133, override: 0 },
  { name: "Close Sarcophagus", tune: 134, override: 0 },
  { name: "Creaking Stick", tune: 135, override: 0 },
  { name: "Pick Hits Stone", tune: 136, override: 0 },
  { name: "Stalactite Crumbles", tune: 137, override: 0 },
  { name: "Tic-Toc", tune: 138, override: 0 },
  { name: "Stone Grind (heavy)", tune: 139, override: 0 },
  { name: "Explosion", tune: 140, override: 0 },
  { name: "Cloth Slide 2", tune: 141, override: 0 },
  { name: "Temple Laser", tune: 142, override: 0 },
  { name: "Dino Transformation", tune: 143, override: 0 },
  { name: "Experimental Laser", tune: 144, override: 0 },
  { name: "Stone Grind (medium)", tune: 145, override: 0 },
  { name: "Weeping God Grind", tune: 146, override: 0 },
  { name: "Alien Hum", tune: 147, override: 0 },
  { name: "Alien Puzzle", tune: 148, override: 0 },
  { name: "Vacuum On", tune: 149, override: 0 },
  { name: "Vacuum Off", tune: 150, override: 0 },
  { name: "Elevator Starts", tune: 151, override: 0 },
  { name: "Mummy Crumbles", tune: 152, override: 0 },
  { name: "Temple Green Circle", tune: 153, override: 0 },
  { name: "Rattle Bars", tune: 154, override: 0 },
  { name: "Door Dissolves", tune: 155, override: 0 },
  { name: "Altar Slides", tune: 156, override: 0 },
  { name: "Light Torch", tune: 157, override: 0 },
  { name: "Stamp Sound", tune: 158, override: 0 },
  { name: "Plaster Loud", tune: 159, override: 0 },
  { name: "Sparky Bathtub", tune: 160, override: 0 },
  { name: "Ape Rezzes Out", tune: 161, override: 0 },
  { name: "Song  159", tune: 162, override: 1 },
  { name: "Song  160", tune: 163, override: 1 },
  { name: "Song  161", tune: 164, override: 1 },
  { name: "Piranhas Swim", tune: 165, override: 0 },
  { name: "Prison/Dungeon Door", tune: 166, override: 0 },
  { name: "Fight Explosion", tune: 167, override: 0 },
  { name: "Press Button", tune: 168, override: 2 },
  { name: "Pull Lever", tune: 169, override: 0 },
  { name: "Wrong Code", tune: 170, override: 0 },
  { name: "Correct Code", tune: 171, override: 0 },
  { name: "Sizzle", tune: 172, override: 0 },
  { name: "Money In Slot", tune: 173, override: 0 },
  { name: "Lightning Crack", tune: 174, override: 0 },
  { name: "Machine Gun Fire", tune: 175, override: 0 },
  { name: "Cage Descends", tune: 176, override: 0 },
  { name: "Chair Activates", tune: 177, override: 0 },
  { name: "Robot Powers On", tune: 178, override: 0 },
  { name: "Grow Big", tune: 179, override: 0 },
  { name: "Eat Food", tune: 180, override: 0 },
  { name: "Head Shrink", tune: 181, override: 0 },
  { name: "Grinding Gears", tune: 182, override: 0 },
  { name: "Chair Splash", tune: 183, override: 0 },
  { name: "Deflect Laser", tune: 184, override: 0 },
  { name: "Zap Frank", tune: 185, override: 0 },
  { name: "Frank Transforms", tune: 186, override: 0 },
  { name: "Alarm Clock", tune: 187, override: 0 },
  { name: "Slide Chute", tune: 188, override: 0 },
  { name: "Puff", tune: 189, override: 0 },
  { name: "Bite", tune: 190, override: 0 },
  { name: "Stone Door Grind 2", tune: 191, override: 0 },
  { name: "Prequel 2", tune: 192, override: 1 },
  { name: "Prequel 3", tune: 193, override: 1 },
  { name: "Prequel 4", tune: 194, override: 1 },
  { name: "Stop Music", tune: 195, override: 1 },
  { name: "Plane Flyby", tune: 196, override: 0 },
  { name: "Commander Rocket 2", tune: 197, override: 1 },
  { name: "Commander Rocket 3", tune: 198, override: 1 },
  { name: "Rescue", tune: 199, override: 1 },
  { name: "Slow Fanfare", tune: 200, override: 1 },
  { name: "Plane Crash", tune: 201, override: 1 },
  { name: "Plane Engine 1", tune: 202, override: 0 },
  { name: "Plane Engine 2", tune: 203, override: 0 },
  { name: "Boat In", tune: 204, override: 0 },
  { name: "Boat Out", tune: 205, override: 0 },
  { name: "Final Fanfare!", tune: 206, override: 1 },
  { name: "Frank Destroyed", tune: 207, override: 1 },
  { name: "Jaspar Eats", tune: 208, override: 0 },
  { name: "Compy Scream 1", tune: 209, override: 0 },
  { name: "Compy Scream 2", tune: 210, override: 0 },
  { name: "Punch Klunk Fanfare", tune: 211, override: 1 },
  { name: "Talk Frank", tune: 212, override: 1 },
];

export const TUNES: readonly TuneEntry[] = [
  { name: "Hotel Gangsters", songs: [32], sfx: 0, mode: 1 },
  { name: "Hotel General", songs: [41], sfx: 0, mode: 1 },
  { name: "Jungle", songs: [15, 16], sfx: 0, mode: 1 },
  { name: "Jungle", songs: [17], sfx: 0, mode: 1 },
  { name: "Jungle", songs: [18], sfx: 0, mode: 1 },
  { name: "Jungle", songs: [7, 8, 9, 10, 11, 12, 13, 14], sfx: 0, mode: 0 },
  { name: "Waterfall On", songs: [3], sfx: 0, mode: 1 },
  { name: "Vnormal", songs: [23], sfx: 0, mode: 1 },
  { name: "Trader Bob", songs: [23], sfx: 0, mode: 1 },
  { name: "Jetty Music", songs: [37], sfx: 0, mode: 1 },
  { name: "Ferry Music", songs: [38], sfx: 0, mode: 1 },
  { name: "Temple Upstairs", songs: [30], sfx: 0, mode: 1 },
  { name: "Temple Downstairs", songs: [34, 36, 56], sfx: 0, mode: 0 },
  { name: "Temple Maze", songs: [87, 35], sfx: 0, mode: 1 },
  { name: "Temple Skull", songs: [76], sfx: 0, mode: 1 },
  { name: "Johns Theme (Love Story)", songs: [44], sfx: 0, mode: 1 },
  { name: "Vmedium", songs: [28], sfx: 0, mode: 1 },
  { name: "Vsoft", songs: [28], sfx: 0, mode: 1 },
  { name: "Floda Upstairs", songs: [28, 39], sfx: 0, mode: 0 },
  { name: "Floda General", songs: [89, 63, 64, 65], sfx: 0, mode: 0 },
  { name: "Klunks Room", songs: [43], sfx: 0, mode: 1 },
  { name: "Hotel Lola", songs: [31], sfx: 0, mode: 1 },
  { name: "Hotel Escape 1", songs: [52], sfx: 0, mode: 1 },
  { name: "Amazon Fortress", songs: [40], sfx: 0, mode: 1 },
  { name: "Waterfall Off", songs: [-3], sfx: 0, mode: 1 },
  { name: "Wave Torch", songs: [], sfx: 121, mode: 2 },
  { name: "Zombies Rez Out", songs: [], sfx: 20, mode: 2 },
  { name: "Open Door (standard)", songs: [], sfx: 1, mode: 2 },
  { name: "Close Door (standard)", songs: [], sfx: 2, mode: 2 },
  { name: "Cloth Unrolls", songs: [], sfx: 51, mode: 2 },
  { name: "Snake Slithers Off", songs: [], sfx: 122, mode: 2 },
  { name: "Hotel Fanfare 2", songs: [69, 2000], sfx: 0, mode: 2 },
  { name: "Floda Secret", songs: [29, 42], sfx: 0, mode: 1 },
  { name: "Temple Fanfare 1", songs: [70, 2000], sfx: 0, mode: 2 },
  { name: "Commander Rocket 1", songs: [45], sfx: 0, mode: 2 },
  { name: "Hotel Escape 2", songs: [52], sfx: 0, mode: 1 },
  { name: "Back of Truck", songs: [51, 48, 33, 54, 52], sfx: 0, mode: 1 },
  { name: "Hotel Fanfare 1", songs: [67, 2000], sfx: 0, mode: 2 },
  { name: "Truck Fanfare", songs: [67, 177], sfx: 0, mode: 2 },
  { name: "Airport", songs: [81], sfx: 0, mode: 1 },
  { name: "Plane Leaves", songs: [68, 1198], sfx: 0, mode: 2 },
  { name: "Arrive Hotel", songs: [26], sfx: 0, mode: 1 },
  { name: "Jungle Fanfare", songs: [68, 2000], sfx: 0, mode: 2 },
  { name: "General Fanfare", songs: [57, 2000], sfx: 0, mode: 2 },
  { name: "Johns Room", songs: [90], sfx: 0, mode: 1 },
  { name: "Floda Lab", songs: [92], sfx: 0, mode: 1 },
  { name: "Azura's Theme", songs: [80], sfx: 0, mode: 1 },
  { name: "Use Record", songs: [91, 2000], sfx: 0, mode: 2 },
  { name: "Franks Theme", songs: [77], sfx: 0, mode: 1 },
  { name: "Anderson Doubts", songs: [75], sfx: 0, mode: 1 },
  { name: "Bud and Lou Theme", songs: [94, 1003], sfx: 0, mode: 1 },
  { name: "Gorilla Theme", songs: [97, 1003], sfx: 0, mode: 1 },
  { name: "Missionaries Theme", songs: [98, 1003], sfx: 0, mode: 1 },
  { name: "Sloth Theme", songs: [100, 1003], sfx: 0, mode: 1 },
  { name: "Amazon Dungeon", songs: [96], sfx: 0, mode: 1 },
  { name: "Throne Room", songs: [78], sfx: 0, mode: 1 },
  { name: "Temple Puzzle", songs: [88], sfx: 0, mode: 1 },
  { name: "Temple Fountain Room", songs: [55], sfx: 0, mode: 1 },
  { name: "Light Switch", songs: [], sfx: 4, mode: 2 },
  { name: "Hydraulic Open", songs: [], sfx: 7, mode: 2 },
  { name: "Hydraulic Close", songs: [], sfx: 8, mode: 2 },
  { name: "Close Door (metal)", songs: [], sfx: 9, mode: 2 },
  { name: "Small Hatch Close", songs: [], sfx: 10, mode: 2 },
  { name: "Scissors Snip", songs: [], sfx: 5, mode: 2 },
  { name: "Pick up Sticky", songs: [], sfx: 6, mode: 2 },
  { name: "Oracle Rezzes In", songs: [], sfx: 11, mode: 2 },
  { name: "Sparkle SFX", songs: [], sfx: 12, mode: 2 },
  { name: "Splorch!", songs: [], sfx: 13, mode: 2 },
  { name: "Pour Liquid", songs: [], sfx: 3, mode: 2 },
  { name: "End Credit Medley", songs: [95], sfx: 0, mode: 1 },
  { name: "Dino Ray", songs: [], sfx: 14, mode: 2 },
  { name: "Squish!", songs: [], sfx: 15, mode: 2 },
  { name: "Robot Laser", songs: [], sfx: 16, mode: 2 },
  { name: "Thud wood light", songs: [], sfx: 17, mode: 2 },
  { name: "Thud wood deep", songs: [], sfx: 18, mode: 2 },
  { name: "Thud metallic", songs: [], sfx: 19, mode: 2 },
  { name: "Cut Coconut", songs: [], sfx: 22, mode: 2 },
  { name: "Thud Stone", songs: [], sfx: 23, mode: 2 },
  { name: "Cloth Slide 1", songs: [], sfx: 24, mode: 2 },
  { name: "Open Chest", songs: [], sfx: 25, mode: 2 },
  { name: "Close Chest", songs: [], sfx: 26, mode: 2 },
  { name: "Open Drawer", songs: [], sfx: 27, mode: 2 },
  { name: "Truck door closes", songs: [], sfx: 28, mode: 2 },
  { name: "Truck Starts", songs: [], sfx: 29, mode: 2 },
  { name: "Truck Drives Off", songs: [], sfx: 30, mode: 2 },
  { name: "Fish Splash", songs: [], sfx: 31, mode: 2 },
  { name: "Close Drawer/Push Ladder", songs: [], sfx: 33, mode: 2 },
  { name: "Aggression Enhancer", songs: [], sfx: 32, mode: 2 },
  { name: "Stone Door Grind 1", songs: [], sfx: 78, mode: 2 },
  { name: "Prequel 1", songs: [20], sfx: 0, mode: 1 },
  { name: "Intro Credits", songs: [21], sfx: 0, mode: 2 },
  { name: "Valley 1", songs: [71], sfx: 0, mode: 1 },
  { name: "Valley 3", songs: [73], sfx: 0, mode: 1 },
  { name: "Fight Music", songs: [72], sfx: 0, mode: 1 },
  { name: "Confrontation 1", songs: [93], sfx: 0, mode: 1 },
  { name: "Confrontation 2", songs: [74], sfx: 0, mode: 1 },
  { name: "Plane Hatch Open", songs: [], sfx: 35, mode: 2 },
  { name: "Plane Hatch Close", songs: [], sfx: 36, mode: 2 },
  { name: "Tie Vines", songs: [], sfx: 37, mode: 2 },
  { name: "Pterodactyl", songs: [], sfx: 38, mode: 2 },
  { name: "Beef Jerky Splash", songs: [], sfx: 39, mode: 2 },
  { name: "Piranha Burp", songs: [], sfx: 40, mode: 2 },
  { name: "Falling Vine", songs: [], sfx: 41, mode: 2 },
  { name: "Stone Door Grind 2", songs: [], sfx: 79, mode: 2 },
  { name: "Stone Grind (light)", songs: [], sfx: 82, mode: 2 },
  { name: "Ape Takes Off Mask", songs: [], sfx: 44, mode: 2 },
  { name: "Bark Breaks", songs: [], sfx: 45, mode: 2 },
  { name: "Stone Click", songs: [], sfx: 46, mode: 2 },
  { name: "Sproing!", songs: [], sfx: 42, mode: 2 },
  { name: "Cash Register", songs: [], sfx: 48, mode: 2 },
  { name: "Squeaky Toy", songs: [], sfx: 49, mode: 2 },
  { name: "Falling Chains", songs: [], sfx: 50, mode: 2 },
  { name: "Open Locker Door", songs: [], sfx: 52, mode: 2 },
  { name: "Close Locker Door", songs: [], sfx: 53, mode: 2 },
  { name: "Rub Pencil", songs: [], sfx: 54, mode: 2 },
  { name: "Open Safe", songs: [], sfx: 55, mode: 2 },
  { name: "Close Safe", songs: [], sfx: 56, mode: 2 },
  { name: "Push Chair", songs: [], sfx: 57, mode: 2 },
  { name: "Snake Hiss", songs: [], sfx: 58, mode: 2 },
  { name: "Oracle Rezzes Out", songs: [], sfx: 59, mode: 2 },
  { name: "Wall Crumbles", songs: [], sfx: 60, mode: 2 },
  { name: "Crypt Crumbles", songs: [], sfx: 61, mode: 2 },
  { name: "Joe Sucked Up", songs: [], sfx: 63, mode: 2 },
  { name: "Rocket Pack Zoom", songs: [], sfx: 47, mode: 2 },
  { name: "Piranha Splash", songs: [], sfx: 83, mode: 2 },
  { name: "Snap Branch", songs: [], sfx: 66, mode: 2 },
  { name: "Dino Horn", songs: [], sfx: 67, mode: 2 },
  { name: "Tire Screech", songs: [], sfx: 68, mode: 2 },
  { name: "Oil Splat", songs: [], sfx: 70, mode: 2 },
  { name: "Punch", songs: [], sfx: 71, mode: 2 },
  { name: "Body Hits Ground", songs: [], sfx: 72, mode: 2 },
  { name: "Chicken", songs: [], sfx: 69, mode: 2 },
  { name: "Open Sarcophagus", songs: [], sfx: 21, mode: 2 },
  { name: "Close Sarcophagus", songs: [], sfx: 21, mode: 2 },
  { name: "Creaking Stick", songs: [], sfx: 62, mode: 2 },
  { name: "Pick Hits Stone", songs: [], sfx: 73, mode: 2 },
  { name: "Stalactite Crumbles", songs: [], sfx: 74, mode: 2 },
  { name: "Tic-Toc", songs: [], sfx: 76, mode: 2 },
  { name: "Stone Grind (heavy)", songs: [], sfx: 81, mode: 2 },
  { name: "Explosion", songs: [], sfx: 77, mode: 2 },
  { name: "Cloth Slide 2", songs: [], sfx: 84, mode: 2 },
  { name: "Temple Laser", songs: [], sfx: 85, mode: 2 },
  { name: "Dino Transformation", songs: [], sfx: 86, mode: 2 },
  { name: "Experimental Laser", songs: [], sfx: 87, mode: 2 },
  { name: "Stone Grind (medium)", songs: [], sfx: 88, mode: 2 },
  { name: "Weeping God Grind", songs: [], sfx: 89, mode: 2 },
  { name: "Alien Hum", songs: [], sfx: 90, mode: 2 },
  { name: "Alien Puzzle", songs: [], sfx: 91, mode: 2 },
  { name: "Vacuum On", songs: [], sfx: 92, mode: 2 },
  { name: "Vacuum Off", songs: [], sfx: 93, mode: 2 },
  { name: "Elevator Starts", songs: [], sfx: 94, mode: 2 },
  { name: "Mummy Crumbles", songs: [], sfx: 95, mode: 2 },
  { name: "Temple Green Circle", songs: [], sfx: 96, mode: 2 },
  { name: "Rattle Bars", songs: [], sfx: 97, mode: 2 },
  { name: "Door Dissolves", songs: [], sfx: 98, mode: 2 },
  { name: "Altar Slides", songs: [], sfx: 99, mode: 2 },
  { name: "Light Torch", songs: [], sfx: 100, mode: 2 },
  { name: "Stamp Sound", songs: [], sfx: 34, mode: 2 },
  { name: "Plaster Loud", songs: [], sfx: 102, mode: 2 },
  { name: "Sparky Bathtub", songs: [], sfx: 103, mode: 2 },
  { name: "Ape Rezzes Out", songs: [], sfx: 104, mode: 2 },
  { name: "Song  159", songs: [], sfx: 0, mode: 2 },
  { name: "Song  160", songs: [], sfx: 0, mode: 2 },
  { name: "Song  161", songs: [], sfx: 0, mode: 2 },
  { name: "Piranhas Swim", songs: [], sfx: 105, mode: 2 },
  { name: "Prison/Dungeon Door", songs: [], sfx: 43, mode: 2 },
  { name: "Fight Explosion", songs: [], sfx: 80, mode: 2 },
  { name: "Press Button", songs: [], sfx: 65, mode: 2 },
  { name: "Pull Lever", songs: [], sfx: 107, mode: 2 },
  { name: "Wrong Code", songs: [], sfx: 108, mode: 2 },
  { name: "Correct Code", songs: [], sfx: 109, mode: 2 },
  { name: "Sizzle", songs: [], sfx: 110, mode: 2 },
  { name: "Money In Slot", songs: [], sfx: 111, mode: 2 },
  { name: "Lightning Crack", songs: [], sfx: 112, mode: 2 },
  { name: "Machine Gun Fire", songs: [], sfx: 113, mode: 2 },
  { name: "Cage Descends", songs: [], sfx: 114, mode: 2 },
  { name: "Chair Activates", songs: [], sfx: 115, mode: 2 },
  { name: "Robot Powers On", songs: [], sfx: 116, mode: 2 },
  { name: "Grow Big", songs: [], sfx: 117, mode: 2 },
  { name: "Eat Food", songs: [], sfx: 118, mode: 2 },
  { name: "Head Shrink", songs: [], sfx: 119, mode: 2 },
  { name: "Grinding Gears", songs: [], sfx: 120, mode: 2 },
  { name: "Chair Splash", songs: [], sfx: 123, mode: 2 },
  { name: "Deflect Laser", songs: [], sfx: 124, mode: 2 },
  { name: "Zap Frank", songs: [], sfx: 125, mode: 2 },
  { name: "Frank Transforms", songs: [], sfx: 126, mode: 2 },
  { name: "Alarm Clock", songs: [], sfx: 127, mode: 2 },
  { name: "Slide Chute", songs: [], sfx: 64, mode: 2 },
  { name: "Puff", songs: [], sfx: 128, mode: 2 },
  { name: "Bite", songs: [], sfx: 129, mode: 2 },
  { name: "Stone Door Grind 2", songs: [], sfx: 79, mode: 2 },
  { name: "Prequel 2", songs: [22], sfx: 0, mode: 1 },
  { name: "Prequel 3", songs: [24], sfx: 0, mode: 1 },
  { name: "Prequel 4", songs: [25], sfx: 0, mode: 1 },
  { name: "Stop Music", songs: [1], sfx: 0, mode: 1 },
  { name: "Plane Flyby", songs: [], sfx: 101, mode: 2 },
  { name: "Commander Rocket 2", songs: [46], sfx: 0, mode: 1 },
  { name: "Commander Rocket 3", songs: [47], sfx: 0, mode: 1 },
  { name: "Rescue", songs: [99], sfx: 0, mode: 1 },
  { name: "Slow Fanfare", songs: [], sfx: 0, mode: 1 },
  { name: "Plane Crash", songs: [93], sfx: 0, mode: 1 },
  { name: "Plane Engine 1", songs: [], sfx: 130, mode: 2 },
  { name: "Plane Engine 2", songs: [], sfx: 131, mode: 2 },
  { name: "Boat In", songs: [], sfx: 132, mode: 2 },
  { name: "Boat Out", songs: [], sfx: 133, mode: 2 },
  { name: "Final Fanfare!", songs: [21, 95, 21], sfx: 0, mode: 1 },
  { name: "Frank Destroyed", songs: [25, 1044], sfx: 0, mode: 1 },
  { name: "Jaspar Eats", songs: [], sfx: 134, mode: 2 },
  { name: "Compy Scream 1", songs: [], sfx: 135, mode: 2 },
  { name: "Compy Scream 2", songs: [], sfx: 136, mode: 2 },
  { name: "Punch Klunk Fanfare", songs: [69, 1017], sfx: 0, mode: 1 },
  { name: "Talk Frank", songs: [77, 1017], sfx: 0, mode: 1 },
];

/** Noms des effets (`_sfxName`), à partir de l'effet 1 ; le fichier est `voices/<NOM en majuscules>.mp3`. */
export const SFX_NAMES: readonly string[] = [
  "116BSSSS", // Door Open (standard)
  "105ASSSS", // Door Close (standard)
  "133SSSSS", // Pour Liquid
  "27SSSSSS", // Light Switch
  "15SSSSSS", // Scissor Snip
  "79SSSSSS", // Pick up Sticky
  "96SSSSSS", // Hydraulic Doors Open
  "97SSSSSS", // Hydraulic Doors Close
  "105SSSSS", // Metallic Door Slams
  "106SSSSS", // Small Hatch Close
  "132SSSSS", // Oracle Rezzes In
  "132CSSSS", // Polish Sparkle
  "137BSSSS", // Splorch!
  "138SSSSS", // Dino Ray Gun
  "137ASSSS", // Squish!
  "61SSSSSS", // Robot Laser
  "109SSSSS", // Thud wood light
  "110SSSSS", // Thud wood deep
  "111SSSSS", // Thud metallic
  "77SSSSSS", // Zombies Rez Out
  "58SSSSSS", // Sarc Door Closes
  "131ASSSS", // Thud breadboard fruit/Coconut
  "75SSSSSS", // Thud stone
  "135SSSSS", // Cloth Slide 1
  "112SSSSS", // Open Chest
  "121SSSSS", // Close Chest
  "120SSSSS", // Open Drawer
  "122SSSSS", // Truck door closes
  "123ASSSS", // Truck Starts
  "123BSSSS", // Truck Drives Off
  "18SSSSSS", // Fish Splash
  "138BSSSS", // Aggression Enhancer
  "113SSSSS", // Close Drawer/Push Ladder
  "40SSSSSS", // *Stamp Sound
  "3SSSSSSS", // plane hatch open
  "4SSSSSSS", // plane hatch close
  "11SSSSSS", // tie vines
  "10SSSSSS", // Pterodactyl
  "6SSSSSSS", // Beef Jerky Splash
  "7SSSSSSS", // Piranha Burp
  "13SSSSSS", // Falling Vine
  "29SSSSSS", // Sproing!
  "33SSSSSS", // Prison/Dungeon Door
  "24SSSSSS", // Ape takes off mask
  "25SSSSSS", // Bark breaks
  "136SSSSS", // Stone Click
  "1006SSSS", // Rocket Pack Zoom
  "36SSSSSS", // Cash Register
  "37SSSSSS", // Squeaky Toy
  "38SSSSSS", // Falling Chains
  "64SSSSSS", // Cloth Unravels
  "48SSSSSS", // Open Locker Door
  "49SSSSSS", // Close Locker Door
  "50SSSSSS", // Rub Pencil on Pad
  "51SSSSSS", // Open Safe
  "52SSSSSS", // Close Safe
  "59SSSSSS", // Push Chair
  "83SSSSSS", // Snake Hiss
  "70SSSSSS", // Oracle Rezzes Out
  "73ASSSSS", // Wall Crumbles
  "76SSSSSS", // Crypt Crumbles
  "74ASSSSS", // Creaking Stick
  "80SSSSSS", // Joe Sucked Up
  "114ASSSS", // Slide Chute
  "1007SSSS", // Press Button
  "101SSSSS", // Snap Branch
  "103SSSSS", // Dino Horn
  "125SSSSS", // Tire Screech
  "126SSSSS", // Chicken
  "127SSSSS", // Oil Splat
  "128SSSSS", // Punch
  "129SSSSS", // Body Hits Ground
  "71SSSSSS", // Pick Hits Stone
  "119SSSSS", // Stalactite Crumbles
  "93SSSSSS", // *Drip
  "42BSSSSS", // Tic-Toc
  "88SSSSSS", // Explosion
  "1001SSSS", // Stone Door Grind 1
  "1002SSSS", // Stone Door Grind 2
  "1000SSSS", // *Fight Explosion
  "1003SSSS", // Stone Grind (heavy)
  "89SSSSSS", // Stone Grind (light)
  "5SSSSSSS", // Piranha Splash
  "1005SSSS", // Cloth Slide 2
  "87SSSSSS", // Temple Laser
  "55BSSSSS", // Dino Transformation
  "55SSSSSS", // Experimental Laser
  "134SSSSS", // Stone Grind (medium)
  "94SSSSSS", // Weeping God Grind
  "95SSSSSS", // Alien Hum
  "103ASSSS", // Alien Puzzle
  "21SSSSSS", // Vacuum On
  "21CSSSSS", // Vacuum Off
  "44SSSSSS", // Elevator Starts
  "68SSSSSS", // Mummy Crumbles
  "60BSSSSS", // Temple Green Circle
  "115SSSSS", // Rattle Bars
  "56SSSSSS", // Door Dissolves
  "85SSSSSS", // Altar Slides
  "81SSSSSS", // Light Torch
  "1027SSSS", // Plane Flyby
  "41BSSSSS", // Plaster Loud
  "73SSSSSS", // Sparky Bathtub
  "14SSSSSS", // Ape Rezzes Out
  "17SSSSSS", // Piranhas Swim
  "1004SSSS", // *Gun Shot
  "1008SSSS", // Pull Lever
  "1009SSSS", // Wrong Code
  "1010SSSS", // Correct Code
  "1011SSSS", // Sizzle
  "1012SSSS", // Money In Slot
  "1013SSSS", // Lightning
  "1014SSSS", // Machine Gun Fire
  "1015SSSS", // Cage Descends
  "1016SSSS", // Temple Chair Activates
  "1017SSSS", // Robot Powers On
  "1018SSSS", // Grow Big
  "1019SSSS", // Eat Food
  "1020SSSS", // Head Shrink
  "84SSSSSS", // Grinding Gears
  "1021SSSS", // Wave Torch
  "1022SSSS", // Snake Slithers Off
  "26SSSSSS", // Chair Splash
  "60SSSSSS", // Deflect Laser
  "1023SSSS", // Zap Frank
  "1024SSSS", // Frank Transforms
  "1025SSSS", // Alarm Clock
  "35SSSSSS", // Puff
  "1026SSSS", // Bite
  "1028SSSS", // Plane Engine 1
  "1029SSSS", // Plane Engine 2
  "1030SSSS", // Boat In
  "1031SSSS", // Boat Out
  "1032SSSS", // Jaspar Eats
  "1033SSSS", // Compy Scream 1
  "1034SSSS", // Compy Scream 2
];

/** Musiques tirées au hasard dans la jungle (`_jungleList`, numéros à partir de 1 ; le 0 final est omis). */
export const JUNGLE_LIST: readonly number[] = [15, 16, 17, 18, 7, 8, 9, 10, 11, 12, 13, 14];
