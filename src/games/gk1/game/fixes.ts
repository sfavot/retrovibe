/**
 * Correctifs de *Gabriel Knight* (CD français pour PC) : ce que ScummVM corrige dans les scripts de ce jeu et qui se
 * retrouve dans ce CD (`docs/gk1/plan.md`, D12 ; inventaire complet, avec ce qui n'est pas repris et pourquoi, dans
 * `docs/gk1/engine.md` § 8). Le mécanisme et la notation des signatures sont dans `engine/patches.ts`.
 *
 * Références : `engines/sci/engine/script_patches.cpp` (table `gk1Signatures` et correctifs communs à SCI2) et
 * `workarounds.cpp` (`uninitializedReadWorkarounds`, `uninitializedReadForParamWorkarounds`, `messageWorkarounds`,
 * `audio36Workarounds`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits. Chaque signature a été retrouvée dans les
 * scripts de `original/gk1/` et chaque script corrigé relu au désassembleur (`test/gk1/engine/patches.test.ts`).
 *
 * Écart volontaire : le remplacement « dialogue du livre des tambours » saute en 0x1867 du script 212, la cible du
 * branchement d'origine ; la valeur relevée dans ScummVM menait deux octets plus tôt, au milieu d'une instruction.
 * Second écart, sans équivalent dans ScummVM : `missingParams` (les points de l'enveloppe du jour 6).
 */
import { type GameFixes, type ScriptPatch, VariableKind } from "../engine/patches";

const SCRIPT_PATCHES: readonly ScriptPatch[] = [
  // `GK::handleEvent` : Alt+N ouvre le journal de débogage des versions française et espagnole (fenêtres qu'on ne peut pas fermer, puis erreur). Le test de la touche ne passe plus.
  { script: 0, name: "touche Alt+N du journal de débogage", count: 1, signature: "34 w:3100 1a 31", patch: "+4 33" },
  // `ExitFeature::dispose` remettait l'ancien curseur même quand le curseur de sortie affiché était celui d'une autre sortie (place Jackson). Il ne le remet que si la vue du curseur est la sienne, par le code de `ExitFeature::doit`.
  { script: 21, name: "curseur de sortie rendu à tort", count: 1, signature: "89 13 7a 76 78 43 02 w:0004 1a 31 0b 38 s:setCursor 78 67 +1 81 01 4a w:0006 39 b:delete 78 7c 81 ce 4a w:0006 48 +370 31 0b 38 s:setCursor 78 67", patch: "39 b:delete 78 7c 81 ce 4a w:0006 39 b:view 76 81 13 4a w:0004 67 o:17-2 1a 2e w:017e 48" },
  // `doTheRestart::changeState(0)` vidait l'inventaire sans passer par `put` : l'objet tenu restait dans la barre d'icônes au jour 1. Chaque objet est rendu par `ego put:`.
  { script: 93, name: "inventaire au redémarrage", count: 1, signature: "38 s:owner 78 76 39 b:state 78 76 39 b:at 78 8b 00 81 09 4a w:0006 4a w:000c", patch: "38 s:put 7a 8b 00 76 81 00 4a w:0008 33 08" },
  // `bookStoreNarrator::display` animait Gabriel en train de parler alors que sa marche n'était pas finie : il restait figé. La variable globale 209, posée par 2/2, fait sauter cette animation une fois.
  { script: 210, name: "téléphone du jour 5 (1/2)", count: 1, signature: "35 08 1a 30 +2 39 b:view 76 81 00 4a w:0004 36 34 w:0385 1a 2f", patch: "+6 81 d1 38 w:0000 a9 d1 2e ow:4-10 34 w:0001" },
  // `bookstore::cue` : la minuterie de l'enveloppe pouvait tomber pendant une suite de messages et laisser le jeu sans la main. Elle attend aussi que plus aucun message ne soit en cours (liste de la variable globale 84 vide).
  { script: 210, name: "enveloppe du jour 6", count: 2, signature: "39 b:state 76 51 +1 4a w:0004 18 31 +1 38 s:handsOff 76 81 01 4a w:0004", patch: "+8 2f o:10+1 39 b:size 76 81 54 4a w:0004 2f o:10-9" },
  // `startingCartoon::changeState(18)` : la dernière phrase de Grace au téléphone était coupée par la suivante. L'état attend six secondes au lieu de la fin de l'animation.
  { script: 211, name: "téléphone de Grace, jour 1", count: 1, signature: "35 12 1a 31 2c +28 38 w:0003 51 69 36 78 7c 81 00 4a w:0024 32 +2", patch: "+33 7a 51 69 36 78 81 00 4a w:0022 35 06 65 1c 3a 48" },
  // `startOfDay5::changeState(32)` et `getTheVeve::changeState(24)` posent la variable globale 209 avant la phrase de Gabriel (voir 1/2).
  { script: 212, name: "téléphone du jour 5 (2/2)", count: 2, signature: "38 w:0115 39 6a 7c 81 00 4a w:000c +4 32", patch: "+15 78 a9 d1" },
  // `getTheVeve::changeState` : le dialogue du livre des tambours se répétait et celui du vévé repassait. Le test « a le livre » est sauté quand Gabriel vient de le recevoir.
  { script: 212, name: "dialogue du livre des tambours", count: 1, signature: "31 0b 38 s:get 78 39 0e 81 00 4a w:0006 38 s:has 78 39 0e 81 00 4a w:0006 18 30 w:0025", patch: "31 0d +11 33 0d 38 s:has 78 39 0e 81 00 4a w:0006 2f 25" },
  // `rm220::init` et `useThePhone::changeState(0)` posaient Gabriel en (104, 126), hors de la zone de marche : il traversait le mur. Position (107, 124), celle des autres appels.
  { script: 220, name: "position de Gabriel au téléphone", count: 2, signature: "39 68 39 7e", patch: "39 6b 39 7c" },
  // `daySixBeignet::changeState(4)` : 220 cycles, donc une durée qui dépend de la machine, trop courte pour atteindre la porte. 22 secondes.
  { script: 230, name: "minuterie du policier aux beignets (1/2)", count: 1, signature: "35 04 1a 30 +2 38 s:dispose 76 72 +2 4a w:0004 34 w:00dc 65 +1 32", patch: "+16 34 w:0016 65 o:20+2" },
  // `sInGateWithPermission::changeState(0)` relançait la même minuterie pour 200 cycles. 20 secondes.
  { script: 230, name: "minuterie du policier aux beignets (2/2)", count: 1, signature: "72 +2 1a 31 0d 38 s:cycles 78 38 w:00c8 72", patch: "+6 38 s:seconds 78 38 w:0014" },
  // `sargSleeping::changeState(8)` : 220 cycles. 22 secondes.
  { script: 230, name: "minuterie du policier endormi", count: 1, signature: "35 08 1a 31 +1 34 w:00dc 65 +1 32", patch: "+5 34 w:0016 65 o:9+2" },
  // `sGabeEnters::changeState(4)` laissait Gabriel à la vitesse lente de la porte. `normalize` à la place de `ignoreActors`.
  { script: 230, name: "vitesse de Gabriel au commissariat", count: 1, signature: "38 s:ignoreActors 78 76 81 00 4a w:000c", patch: "38 s:normalize 39 00 81 00 4a w:000a" },
  // Heap : `moveSpeed` du vendeur valait 0, sa marche dépendait de la cadence des images. 6.
  { script: 231, name: "vitesse du vendeur de beignets", count: 1, signature: "w:0006 w:0302 w:0000", patch: "+4 w:0006" },
  // `egoExits::changeState` : même oubli qu'au commissariat. `normalize` avant `newRoom`.
  { script: 250, name: "vitesse de Gabriel en sortant de la pharmacie", count: 1, signature: "30 w:003f +60 32 w:0012 3c 35 01 1a 31 0c 38 s:newRoom 78 38 w:00c8 81 02 4a w:0006 3a", patch: "3a 31 3d +60 48 38 s:normalize 76 81 00 4a w:0004 38 s:newRoom 78 38 w:00c8 81 02 4a w:0006" },
  // `flipTheSwitch::changeState` : la réplique du Dr John était coupée, la scène ne l'attendait pas. Vitesse de cycle de Gabriel fixée, et les états attendent la fin des messages (`say` avec l'appelant) au lieu de celle des animations.
  { script: 260, name: "climatiseur du musée", count: 1, signature: "30 w:0020 +26 4a w:000c 32 w:0409 3c 35 01 1a 30 w:0056 +24 4a w:001a +33 4a w:000c 32 w:03c0 +620 7a +3 7c 81 00 4a w:0014 +8 38 w:0004 +10 4a w:000c 32 w:012f +3 38 w:0004 +9 4a w:000c 32 w:011a +6 38 s:stop", patch: "30 w:001c +26 33 47 3c 18 1a 31 5c 38 s:cycleSpeed 78 39 06 +24 4a w:0020 +659 78 +3 80 w:0000 4a w:0012 +8 38 w:0005 +10 7c 4a w:000e 33 1b +3 38 w:0005 +9 7c 4a w:000e 33 06" },
  // `snakeAttack::changeState` : vitesse, son et image désaccordés. Vitesse de cycle de Gabriel fixée, départ dès le premier état, position de départ en x = 112.
  { script: 260, name: "attaque du serpent (1/2)", count: 1, signature: "65 1a 32 +2 3c 35 01 1a 30 w:0048 35 01 39 b:view 78 38 w:0107 38 s:setCel 78 76 38 s:setLoop 78 76 39 b:signal 78 39 b:signal 76 81 00 4a w:0004 +18 39 64", patch: "39 b:view 78 33 07 3c 18 1a 65 1a 33 48 38 w:0107 39 b:cel 78 76 38 s:setLoop 78 76 39 b:signal 78 38 s:cycleSpeed 78 39 0a +5 4a w:000a +18 39 70" },
  // Même scène : deuxième position de Gabriel en x = 139, sous le serpent.
  { script: 260, name: "attaque du serpent (2/2)", count: 1, signature: "39 7a 39 7c 38 s:setCycle 7a 51 18 36 7c 81 00 4a w:0022 32 +2", patch: "38 w:008b 39 7c 38 s:setCycle 7a 51 18 36 7c 81 00 4a w:0022 3a 48" },
  // `rm280::init` : Gabriel arrivait sur le bord du polygone de marche et traversait le mur. Le sommet (124, 104) passe en (124, 103).
  { script: 280, name: "chemin chez Madame Cazanoux", count: 1, signature: "78 38 w:0090 38 w:00f6 38 w:0092 38 w:00f2 39 69 39 7c 39 68 39 56 39 6f 39 45 39 7c 39 2e 38 w:0081", patch: "+15 39 7c 39 67" },
  // `shutTheDoor::doit` : la minuterie du majordome pouvait tomber pendant un gros plan (`inset`) et laisser le jeu sans la main. Le script ne tourne pas tant que la pièce a un gros plan.
  { script: 350, name: "majordome et gros plans", count: 1, signature: "39 b:doit 76 57 +1 w:0004 39 b:state 76 54 w:0004 36 35 00 1a 31 11 83 0a 31 0d 38 s:seconds 78 76 +5 54 w:000c 48 87 01 65", patch: "38 s:inset 76 81 02 4a w:0004 2f 07 c:0*7 67 o:40 83 0a 2a 31 0b 76 69 o:40+8 +5 54 w:0006" },
  // `rm380::init` : au retour d'un interrogatoire, Gabriel scintillait et traversait le panier à tricot. Il est initialisé par le code de l'entrée normale, obstacle compris.
  { script: 380, name: "chambre de la grand-mère", count: 1, signature: "38 s:setCel 78 39 05 38 s:setLoop 78 76 38 s:init 76 38 s:posn 7a 38 w:00af 39 75 81 00 4a w:001e 35 01 a3 00", patch: "39 b:cel 78 39 05 38 s:setLoop 7a 76 78 38 s:init 76 38 s:posn 7a 38 w:00af 39 75 81 00 a3 00 4a w:0020 33 87" },
  // `booth::doVerb`, `chair1::doVerb`, `chair2::doVerb` : le texte disait Lorelei assise dans la loge vide si elle n'avait pas eu son voile. Le test porte sur le jour (5 au plus).
  { script: 420, name: "loge vide du jour 6", count: 6, signature: "30 w:001a 83 01 18 30 w:0014", patch: "31 1b 89 7b 35 05 24 31 14" },
  // `fortuneTeller::cue` relançait la minuterie avec un autre client : danses à répétition, points en double. L'ancienne minuterie est libérée, la pièce reste le client.
  { script: 420, name: "minuterie de la danse de Lorelei", count: 1, signature: "30 w:0005 c3 04 32 w:001f 3c 35 10 1a 30 w:0018 38 s:setReal 7a 72 +2 36 +13 4a w:0008", patch: "30 w:0004 +2 33 20 3c 35 10 1a 31 1a 38 s:dispose 76 38 s:setReal 7a 89 02 +13 4a w:000c" },
  // `seconds = 1` attend le prochain changement de seconde de l'horloge : de 0 à 1 s selon l'instant. 60 ticks.
  { script: 471, name: "bandes dessinées : pause d'une seconde", count: 4, signature: "35 01 65 1c", patch: "35 3c 65 o:3+4" },
  { script: 480, name: "bandes dessinées : pause d'une seconde", count: 10, signature: "35 01 65 1c", patch: "35 3c 65 o:3+4" },
  { script: 720, name: "bandes dessinées : pause d'une seconde", count: 2, signature: "35 01 65 1c", patch: "35 3c 65 o:3+4" },
  { script: 891, name: "bandes dessinées : pause d'une seconde", count: 1, signature: "35 01 65 1c", patch: "35 3c 65 o:3+4" },
  // `seconds = 2` : de 1 à 2 s. 120 ticks.
  { script: 471, name: "bandes dessinées : pause de deux secondes", count: 3, signature: "35 02 65 1c", patch: "35 78 65 o:3+4" },
  { script: 480, name: "bandes dessinées : pause de deux secondes", count: 7, signature: "35 02 65 1c", patch: "35 78 65 o:3+4" },
  { script: 720, name: "bandes dessinées : pause de deux secondes", count: 6, signature: "35 02 65 1c", patch: "35 78 65 o:3+4" },
  { script: 892, name: "bandes dessinées : pause de deux secondes", count: 1, signature: "35 02 65 1c", patch: "35 78 65 o:3+4" },
  { script: 894, name: "bandes dessinées : pause de deux secondes", count: 1, signature: "35 02 65 1c", patch: "35 78 65 o:3+4" },
  // `roomScript::changeState(64)` : la case où Malia reconnaît Gabriel prenait la vue de Malia (6141). Vue 6142.
  { script: 480, name: "vue de la bande dessinée du bayou", count: 1, signature: "39 b:view 78 38 w:17fd", patch: "+3 38 w:17fe" },
  // `enterFromHall::changeState` : Gabriel arrivait sur le bord d'un obstacle. Arrivée en y = 124.
  { script: 530, name: "chemin dans la chambre du château", count: 1, signature: "38 w:00e6 39 7b", patch: "+4 7c" },
  // `vineSwing::changeState(1)` : la réplique de Gabriel était coupée. L'état attend la fin du message (`say` avec l'appelant) au lieu de celle de l'animation.
  { script: 710, name: "réplique de la liane, jour 9", count: 1, signature: "38 w:0004 51 17 36 39 0b 78 7c 81 00 4a w:0020 38 s:setMotion 78 76 72 w:0412 4a w:0006 38 s:say 38 w:0004 39 07 39 08 39 10 78 81 5b 4a w:000c", patch: "38 w:0003 51 17 36 39 0b 78 81 00 4a w:001e 38 s:setMotion 78 76 72 w:0412 4a w:0006 38 s:say 38 w:0005 39 07 39 08 39 10 78 7c 81 5b 4a w:000e" },
  // `rightWay::changeState(1)` : une momie quittée avant d'être debout n'était qu'à moitié initialisée et restait cassée dans les pièces suivantes. Initialisation complète, celle de `keyWorks::changeState(7)`.
  { script: 710, name: "momies du jour 9", count: 1, signature: "39 b:view 78 38 w:02c5 +750 38 s:setMotion 38 w:0004 51 70 36 89 00 39 0f", patch: "+756 39 b:view 76 39 b:view 76 39 b:view 39 00 32 w:fcff" },
  // `Narrator::say` : l'heure de fin calculée pouvait valoir 65 535, qui veut dire « pas de fin » : le message ne se fermait jamais. Dans ce cas elle vaut 0.
  { script: 64928, name: "blocage du narrateur", count: 1, signature: "65 +1 33 0b 67 +1 35 3c 02 36 81 58 02 65 +1 35 01 48", patch: "+2 33 0a +5 89 58 02 65 o:1 00 31 fb" },
  // `SRDialog::init` : le bouton des fenêtres de sauvegarde n'a pas de sens sans disque. Il est inactif.
  { script: 64990, name: "bouton « changer de répertoire »", count: 1, signature: "72 +2 4a w:0004 36 35 f7 12 36", patch: "+7 35 00" },
];

/** Module des messages de la pièce 410 (l'artiste de la place Jackson) et de la pièce 420 (la loge de Lorelei). */
const ARTIST_MODULE = 410;
const LORELEI_MODULE = 420;

export const GK1_FIXES: GameFixes = {
  scriptPatches: SCRIPT_PATCHES,
  uninitializedReads: [
    // Clic pendant une marche : `Feature::handleEvent` lit sa variable temporaire 0 avant de l'écrire.
    { script: 64950, object: "Feature", method: "handleEvent", kind: VariableKind.Temp, index: 0, value: 0 },
    // Panneau de réglages au clavier, Entrée sur un curseur : `dispatchEvent` (hérité de `IconBar`) lit sa temporaire 6.
    { script: 64937, object: "GKControls", method: "dispatchEvent", kind: VariableKind.Temp, index: 6, value: 0 },
    // Barre d'icônes ouverte avec un objet d'inventaire : `showInvItem` lit un paramètre qu'on ne lui passe pas.
    { script: 12, object: "GKIconbar", method: "showInvItem", kind: VariableKind.Param, index: 1, value: 1 },
  ],
  missingParams: [
    // `getTheEnvelope` (script 210, jour 6) et `startOfDay4` (script 214) envoient `getPoints` sans le nombre de points :
    // la méthode additionnait au score la case de pile où elle venait d'empiler ce score, et le doublait. Un point, comme
    // les autres ramassages. Écart volontaire et validé : l'interpréteur d'origine et ScummVM doublent tous deux le score
    // (mesuré, `docs/gk1/engine.md` § 8).
    { script: 18, object: "GKEgo", method: "getPoints", index: 2, value: 1 },
  ],
  messageRemaps: [
    // La photocopie du vévé montrée à l'artiste après le croquis et l'original : le message demandé n'existe pas.
    { from: { module: ARTIST_MODULE, tuple: { noun: 3, verb: 48, cond: 31, seq: 1 } }, to: { module: ARTIST_MODULE, tuple: { noun: 3, verb: 24, cond: 31, seq: 1 } } },
    // L'argent tendu à Lorelei : le script inverse les réponses « assise » et « en train de danser », et demande pour l'une
    // une condition qui n'existe pas.
    { from: { module: LORELEI_MODULE, tuple: { noun: 2, verb: 32, cond: 3, seq: 1 } }, to: { module: LORELEI_MODULE, tuple: { noun: 2, verb: 32, cond: 0, seq: 1 } } },
    { from: { module: LORELEI_MODULE, tuple: { noun: 2, verb: 32, cond: 0, seq: 1 } }, to: { module: LORELEI_MODULE, tuple: { noun: 2, verb: 32, cond: 2, seq: 1 } } },
  ],
  voiceRemaps: [
    // La voix de la réponse « assise » est rangée sous la condition 3, son texte sous la condition 0.
    { from: { module: LORELEI_MODULE, tuple: { noun: 2, verb: 32, cond: 0, seq: 1 } }, to: { module: LORELEI_MODULE, tuple: { noun: 2, verb: 32, cond: 3, seq: 1 } } },
  ],
};
