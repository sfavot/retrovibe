# Le Téléportaschtroumpf : plan d'implémentation

**État** : jeu jouable, 20 mini-jeux portés (`src/games/teleportaschtroumpf/scenes/minigames/`). Ce document est le plan d'origine ; l'état courant est dans `engine-ts.md`.

Jeu : *Les Schtroumpfs : Le Téléportaschtroumpf* (Infogrames Multimedia, 1995), version CD DOS.
Principe du jeu : un jeu de plateau (S01) sur la carte du Pays Schtroumpf (S02). Les cases mènent à une trentaine de mini-jeux (S15 à S42).
Toute la logique est codée en dur dans `SMURF.EXE` (16 bits, Borland C++). Il n'y a pas de scripts dans les données.

Ce document sert de brief commun aux sous-agents. Chaque tâche indique ses entrées, les fichiers qu'elle possède, ce qu'elle livre, comment la valider et ce dont elle dépend.

## Avancement

- Vagues A, B et C terminées (0.1–0.3, 1.1–1.7, 2.1). Les références font foi sur ce plan : `files.md`, `re-index.md`, `engine.md`, `mux.md`, `hy8.md`, `pfn.md`, `mut.md`.
- Corrections apportées par la RE (`engine.md`) :
  - **Ordre de démarrage** : S06 (intro), puis S05 (titre).
  - **S09** : choix du nombre de joueurs ; le temps se règle dans S04.
  - **S15 à S21** : des animations MUX sans code propre, pas des mini-jeux. S12 est du code mort.
  - **Musique** : en VOC (`s52m00Nm.voc`), sur une seule voie son. L'EXE ne lit **pas** les pistes CD-DA : elles ne sont pas extraites.
  - **Zones cliquables** : il n'y en a pas. Les menus se parcourent dans quatre directions, puis on clique.
  - **Sauvegarde** : pas de sauvegarde de partie, seulement `c:\smurf.cfg` (options parents).
- La phase 4 doit être recalculée à partir du tableau des scènes de `engine.md` §1.7.
- Vague D terminée (2.2 moteur : `engine-ts.md` ; 2.3 règles : `rules.md`, logique pure dans `game/`). Corrections de `rules.md` :
  - **Plateau sans dé.** S01 est un écran de plate-forme : on marche, court et saute sur 18 tronçons, et on appuie devant des portes.
  - **Portes 15 à 21 et S13–S21.** Ce sont des événements du plateau, pas des mini-jeux.
  - **Mini-jeux à ingrédient.** 8 mini-jeux donnent un ingrédient : S22, S27, S28, S31, S32, S33, S34 et S36.
  - **Mini-jeux à points.** Les autres donnent des points (rosée).
  - **Interface d'un mini-jeu.** Il lit le joueur et le niveau (0..2) et écrit lui-même son gain ; l'API TS passe par `Game.resolveMinigame`.
- **Décision (navigation, 2026-10-22, remplace la décision « souris » précédente)** : on garde le **clavier d'origine seul**.
  - Flèches et Q/A/Z/X pour se déplacer, Espace = valider, Entrée = voix d'aide.
  - Les boutons de la souris gardent leur rôle d'origine : gauche = valider, droit = aide.
  - Pas de survol pour sélectionner, pas de zones cliquables invisibles (S08, S04), pas de navigation par poussée contre les bords.
  - Curseur système masqué sur le canvas. Les scènes qui dessinent leur propre curseur HY8 (S51, S35, S26, S41, S25, S13, S24) le pilotent avec la position de la souris, comme l'original.
- Visionneuse : `src/games/teleportaschtroumpf/ui/asset-viewer.html`. Jeu en dev : `src/games/teleportaschtroumpf/ui/dev.html`.
- Phases 3 et 4 terminées :
  - écrans hors partie, partie, plateau, carte, événements, Grand Schtroumpf ;
  - les 20 mini-jeux (`docs/teleportaschtroumpf/minigames/`) ;
  - le canal de bruitages mélangés (`engine.md` §5.2 bis).
- Défauts de l'original corrigés à la demande, chacun documenté dans sa doc :
  - débordements 16 bits du temps ;
  - palier de points de S25 ;
  - bonus de l'oiseau de S51 et indice partagé entre S36 et S27 ;
  - animation du choc de S36.
- Phase 5 terminée :
  - jeu inscrit sur le site (jaquette `COVER.webp`) ;
  - écran de présentation commun aux trois jeux (`src/ui/title-screen.ts`) ;
  - manuel d'origine (`MANUEL.pdf`) et liste des contrôles ;
  - bouton « Son » ;
  - pause quand l'onglet est masqué ;
  - reprise d'une partie interrompue (adaptation web, sauvegarde au début de chaque tour) ;
  - robot de partie (`PLAY=1`, aucun bug trouvé sur 40 graines) ;
  - revue et corrections.
- Écarts connus restants :
  - Les commentaires du Grand Schtroumpf en tour normal ne se déclenchent jamais, comme dans l'original.
  - L'attente de fin de bip des menus n'est pas reproduite.
  - La notice PDF a perdu la mise en forme du .doc.
  - La jaquette fournie est celle de l'édition CD-i, avec un filigrane.
  - Préférence de son en double avec Lost in Time : pourrait passer dans `src/ui/`.
- Limite d'hébergement : le site publié pèse environ 320 Mo ; ajouter `mathemagique` et `zoombinis` tels quels dépasserait le 1 Go de GitHub Pages.

## État au 2026-10-22 (étude d'extraction)

- **Image disque.** `jeu-01592-teleportaschtroumpf-pcdos.rar` contient `Teleport.bin` et `Teleport.cue`.
  - La piste 1 est en MODE1/2352 : 242 330 secteurs, ISO 9660 lisible par `7zz`. On en tire l'ISO en gardant les octets 16 à 2063 de chaque secteur.
  - Les pistes 2 à 7 sont en CD-DA (PCM 16 bits stéréo 44,1 kHz, environ 2 min chacune). Les positions sont dans le `.cue`.
- **Données.** Elles sont dans `DATA/JEU_F/Sxx/SxxY/`. La liste des scènes est dans `DATA/JEU_F/DESCRIPT.ION` (CP437).
- **Prototypes Python validés.** Ils sont à porter en TypeScript. Le dossier se trouve dans le scratchpad de la session d'étude ; il sera recopié dans `scripts/teleportaschtroumpf/proto/` à la tâche 0.2.
  - **MCG.** Un u16 (0000 ou ff00), une palette de 768 octets en RGB 8 bits, puis une image 320×200 en 8 bpp brut. Les PAL contiennent seulement les 768 octets de palette.
  - **MUX.** Format décrit sur https://wiki.multimedia.cx/index.php/MUX, à suivre exactement.
    - LZ complet pour les flags 4 et 6, codes intra et inter.
    - Chunks : 07/06 audio PCM 8 bits non signé à 18 867 Hz ; 70/65 palette 8 bits ; 6f/64 vidéo ; 05 fin d'image ; 04 fin de fichier.
    - Environ 11 images/s (diviseur PIT 9039 et 12 ticks, à confirmer).
  - **HY8.** L'en-tête fait 6 u32.
    - `[1]` = offset de la table d'images. Elle contient des u32 relatifs à la table ; leur nombre vaut `premier offset / 4`.
    - Chaque image commence par `[largeur/16][hauteur]`. Puis, ligne par ligne : `[nb spans]`, chaque span `[skip][n4][n1]` suivi de `4·n4+n1` pixels, puis un octet d'écart de fin. L'index 0 est transparent.
    - La table à 0x18 semble décrire les animations : enregistrements de 8 octets, avec un index d'image u16 et un point chaud dx/dy signés. Non confirmé.
    - Les sections `[2]` et `[3]` sont inconnues.
  - **VOC.** Creative Voice File, 8 bits ; le time constant 0xCB donne 18 868 Hz.
- **Formats que l'EXE n'utilise pas** (à ignorer) : OPT, CC, MCC, LBM, PCM/UER (AIFF), MOL, MUK, FRM, TRP, TMP, OLD, LSR, MX, XA2, DP_PREFS.
- **Formats utilisés, compris depuis** : MUT et PRC (S36, la mine) dans `mut.md`, PFN (polices) dans `pfn.md`.

## Règles pour tous les sous-agents

- Lire avant d'écrire :
  - ce plan ;
  - `README.md` ;
  - le code d'un jeu existant (`src/games/lost-in-time/` pour la structure data/engine, `src/data/reader.ts` pour la lecture binaire) ;
  - le code ou les notes déjà produits par les tâches précédentes (`docs/teleportaschtroumpf/*.md`).
- Ne toucher qu'aux fichiers que la tâche possède. Les autres agents travaillent dans le même checkout, sans worktree.
  - Pas de commit, pas de changement de branche.
  - Ne pas modifier `registry.ts`, `README.md` ni `src/ui/` : c'est réservé à la tâche 5.1.
- Toute copy visible par l'utilisateur, nouvelle ou modifiée, est marquée « à valider » dans le rapport.
- Pas de nouvelle dépendance npm.
- Valider avec `npm run typecheck` et `npm test`, plus `npm run build` pour les tâches UI.
  - Les tests qui lisent `original/teleportaschtroumpf/` sont ignorés si le dossier est vide, sur le modèle de `test/lost-in-time/helpers.ts`.
- Faire un rapport final court, au maximum 15 lignes : fichiers créés, ce qui est validé, ce qui ne l'est pas, questions.
  - Les découvertes de rétro-ingénierie vont dans un fichier `docs/teleportaschtroumpf/<sujet>.md`, pas dans le rapport.
- Ne pas copier de code GPL. La documentation (MultimediaWiki) peut être reformulée.

---

## Phase 0 : décisions, extraction et outillage (séquentiel, en premier)

### 0.1 Hygiène du dépôt (petite, faite par la session principale)
- Déplacer `original/le téléportaschtroumpf/*.rar` vers `archives/teleportaschtroumpf/`, qui est déjà ignoré par git.
- Identifiant du jeu : `teleportaschtroumpf`, en ASCII et sans espace, pour l'URL `#/teleportaschtroumpf` et le dossier `original/teleportaschtroumpf/`.

### 0.2 Script d'extraction (Sonnet)
- **Possède** : `scripts/teleportaschtroumpf-extract.sh`, `scripts/teleportaschtroumpf/` (prototypes Python recopiés, utilitaire bin→iso), `original/teleportaschtroumpf/`.
- **Étapes** :
  1. Extraire le `.rar` avec `bsdtar`, car `7zz` ne gère pas cette méthode RAR.
  2. Convertir la piste 1 en ISO, puis l'extraire avec `7zz`.
  3. Copier `DATA/JEU_F/` dans `original/teleportaschtroumpf/DATA/` en conservant l'arborescence `Sxx/SxxY/` et en majuscules. Exclure les formats inutilisés listés plus haut.
  4. Copier `SMURF.EXE`, même s'il est exclu par `*.exe` : ajouter une exception au `.gitignore` comme pour `DESKADV.EXE`. Il sera peut-être utile pour des tables lues à l'exécution.
  5. (Abandonné) Les pistes CD-DA 2 à 7 ne sont pas extraites : le jeu ne les lit jamais (`engine.md` §5).
  6. Produire un inventaire `docs/teleportaschtroumpf/files.md` : taille totale, nombre de fichiers par extension et par scène.
- **Validation** : le script est idempotent. Taille totale versionnée à indiquer (objectif inférieur à 300 Mo ; aucun fichier au-dessus de 100 Mo, limite GitHub).
- **Point ouvert** : si la taille est trop grande, proposer des options (convertir les VOC en MP3 ?) sans les appliquer.

### 0.3 Outillage de rétro-ingénierie de SMURF.EXE (Sonnet)
- **Prérequis à valider** : installer Ghidra avec `brew install --cask ghidra` (outil local, hors projet, JDK requis). Alternative plus légère et moins bonne : rizin, ou capstone en Python.
- **Possède** : `scripts/teleportaschtroumpf/re/` (scripts Ghidra headless), `archives/teleportaschtroumpf/re/` (sorties non versionnées).
- **Étapes** :
  1. Importer `SMURF.EXE` dans Ghidra (MZ, x86 real mode 16 bits) et lancer l'auto-analyse.
  2. Exporter la décompilation C de toutes les fonctions : un fichier par fonction, plus un index (adresse, taille, appelants, appelés).
  3. Exporter les chaînes et leurs références croisées, pour savoir quelle fonction charge quel fichier (`s22a001d.mcg`, etc.).
  4. Repérer les fonctions de la bibliothèque Borland C++ (FLIRT ou heuristiques) pour les écarter.
- **Livrable** : `docs/teleportaschtroumpf/re-index.md`. Il contient la méthode pour régénérer les sorties, puis une table *scène Sxx → fonctions qui chargent ses fichiers*, qui sert de point d'entrée à chaque tâche des phases 2 à 4.
- **Validation** : la table couvre toutes les scènes de `DESCRIPT.ION`.

---

## Phase 1 : décodeurs de formats en TypeScript (parallélisables après 0.2)

Tous vont dans `src/games/teleportaschtroumpf/data/`, avec leurs tests dans `test/teleportaschtroumpf/`.

### 1.1 Images et palettes : MCG et PAL (Sonnet, petite)
- **Possède** : `data/palette.ts`, `data/mcg.ts`, `test/teleportaschtroumpf/mcg.test.ts`, `test/teleportaschtroumpf/helpers.ts`.
- Lire le MCG (en-tête, palette 8 bits, pixels). Établir le rôle de l'octet `ff00` contre `0000` : comparer les fichiers, puis vérifier dans la RE de 0.3 si elle est disponible.
- **Tests** : les 118 MCG se lisent ; vérifier des valeurs de pixels et de palette précises sur l'écran titre `S05A.MCG`.

### 1.2 Vidéo MUX (Sonnet)
- **Possède** : `data/mux.ts`, `test/teleportaschtroumpf/mux.test.ts`.
- **Étapes** :
  1. Écrire un décodeur incrémental (image par image, sans tout charger d'avance), qui gère les chunks palette et audio, le paramètre `output start` et le skip inter.
  2. Faire un relevé sur les 232 MUX et les fichiers sans extension (S20H, S21M, S36, S45V/S10A001T…) : flags vidéo présents (les flags 1/3 « LZ partiel » et 8 sont-ils utilisés ?), fréquences, tailles, nombre d'images. Implémenter ce qui est réellement utilisé.
  3. Confirmer la cadence : mesurer le rapport octets audio / images sur plusieurs fichiers.
- **Tests** : décodage complet de tous les fichiers sans exception, tous les décompressés LZ à la taille annoncée, checksum de l'image 80 de `S01B.MUX`.

### 1.3 Sprites HY8 (Sonnet, après 0.3 pour la partie animations)
- **Possède** : `data/hy8.ts`, `test/teleportaschtroumpf/hy8.test.ts`, `docs/teleportaschtroumpf/hy8.md`.
- **Étapes** :
  1. Décoder les images (format établi). Vérifier sur les 33 fichiers que l'écart de fin vaut toujours `largeur - x`.
  2. Comprendre la table d'animations à 0x18 et les sections `[2]` et `[3]` à partir des fonctions de la RE qui lisent les HY8.
- **Tests** : toutes les images décodées sans débordement ; nombre d'images par fichier.

### 1.4 Sons VOC et textes DAT (Sonnet, petite)
- **Possède** : `data/voc.ts`, `data/text.ts`, avec leurs tests.
- VOC : faire l'inventaire des types de blocs réellement présents dans les 975 fichiers (1, 2, 8, 9, silence, boucles) et des fréquences, puis les gérer tous. Sortie : un `Float32Array` et une fréquence.
- DAT : décodage CP437 et structure de `S40A.DAT` (quiz : propositions et bonnes réponses) et de `S49A.DAT`.

### 1.5 Polices PFN (Sonnet, après 0.3)
- **Possède** : `data/font.ts`, `docs/teleportaschtroumpf/pfn.md`.
- Format à trouver avec la RE : les fonctions qui chargent `s52d001f.pfn`, `s52d2.pfn` et `s52d3.pfn`.

### 1.6 Mine : MUT et PRC (Sonnet, après 0.3, peut glisser en phase 4)
- **Possède** : `data/mut.ts`, `docs/teleportaschtroumpf/mut.md`.
- Format à trouver avec la RE. Indices : chaîne « Load .mut error ! », PRC = liste de u16. Les FRM et TRP en texte semblent être les sources des PRC.

### 1.7 Visionneuse de ressources pour le dev (Sonnet, après 1.1 à 1.4)
- **Possède** : `src/games/teleportaschtroumpf/ui/asset-viewer.ts`.
- Page accessible seulement en dev (`#/teleportaschtroumpf?viewer`). Elle liste les scènes et affiche les MCG, les HY8 en planche, les MUX en lecture et les VOC en écoute.
- Elle sert de preuve visuelle pour les tâches suivantes. Aucune copy publique.

---

## Phase 2 : socle du moteur (après 0.3 ; 2.2 et 2.3 en séquentiel)

### 2.1 RE du cadre global (Sonnet, ou Opus si Sonnet bloque)
- **Possède** : `docs/teleportaschtroumpf/engine.md`.
- Documenter, avec les adresses des fonctions :
  - le `main` et l'enchaînement des scènes (machine à états, codes de scène) ;
  - la boucle de jeu et le timing (fréquence du PIT, cadence logique) ;
  - le rendu : mode VGA, double buffer, blit des sprites HY8, fondus de palette, curseur souris ;
  - les entrées : souris, clavier, joystick, zones cliquables (hotspots codés en dur ?) ;
  - le son : voies VOC, priorités, musique (pistes CD ? `s52m002m.voc` ?) et correspondance piste ↔ scène ;
  - l'état de partie : joueurs, personnage, niveau, temps, mission (S08, S09) ;
  - la sauvegarde (`save000.mcg`, `DP_PREFS`) et les options parents (S04).
- Ne pas implémenter.

### 2.2 Implémentation du moteur (Sonnet, un seul agent)
- **Possède** : `src/games/teleportaschtroumpf/engine/` et `audio/`.
- **Contenu** :
  - gestionnaire de scènes : interface `Scene` avec `enter`, `update(dt)`, `render`, `input` ;
  - surface indexée 320×200, conversion en canvas avec la palette courante et les fondus ;
  - blit des sprites HY8 avec transparence et point chaud ;
  - lecteur MUX synchronisé sur l'audio ;
  - mixeur Web Audio pour les VOC ;
  - entrées souris et clavier mises à l'échelle ;
  - horloge logique fidèle à l'original ;
  - sauvegarde dans `localStorage`, sur le modèle de `indy/ui/save.ts`.
- **Tests** : des tests headless du gestionnaire de scènes et de l'horloge, sur le modèle de `test/lost-in-time/headless.test.ts`.

### 2.3 État de partie et règles du plateau (Sonnet)
- **Possède** : `engine/state.ts`, `engine/board.ts`, `docs/teleportaschtroumpf/rules.md`.
- RE des règles : déplacement, cases, ingrédients, objectif du téléporteur, conditions de victoire (S11), puits (S13, S14), cadeaux (S51), temps et mission.
- Logique pure, testable sans rendu.

---

## Phase 3 : écrans et parcours (après 2.2 ; trois agents en parallèle, un par groupe)

Chaque écran est une `Scene` dans `src/games/teleportaschtroumpf/scenes/<sxx>-<nom>.ts`. La correspondance des hotspots, sons et animations vient de la RE.

- **3.1 Démarrage** : S05 titre, S06 introduction (MUX), S07 menu principal, S10 règles du jeu, S04 menu parents, sortie.
- **3.2 Préparation** : S08 personnages et niveaux, S09 temps et mission.
- **3.3 Plateau** : S01 plateau, S02 carte, S03 écran info, S45 aide, S46 abandon, S48 pause, S49 confirmation, S51 cadeaux, S11 fin gagnante, S13 et S14 le puits, S19 et S42 Grand Schtroumpf. Cette tâche dépend de 2.3.
- **Validation** : la scène s'affiche dans le navigateur, les hotspots répondent et les sons et vidéos se lancent. Capture comparée à l'original dans DOSBox si possible.

---

## Phase 4 : mini-jeux (après 2.2 ; très parallélisables, un agent par mini-jeu ou par paire)

Pour chacun, la même démarche :
1. Trouver la fonction dans `re-index.md`.
2. Documenter les règles, les niveaux de difficulté, les ressources utilisées et les conditions de réussite dans `docs/teleportaschtroumpf/minigames/<sxx>.md`.
3. Implémenter `scenes/<sxx>-<nom>.ts`.
4. Écrire un test headless de la logique (victoire et défaite).
5. Vérifier le rendu dans le navigateur.

| Scène | Nom | Remarque |
|---|---|---|
| S15 | Les Pièges de Gargamel | |
| S16 | Le Pont Branlant | |
| S17 | La Fusée du Cosmoschtroumpf | |
| S18 | Le Lac Glacé | |
| S20 | La Prison de Gargamel | MUX S20H |
| S21 | Le Turlusiphon | PCM et S21M |
| S22 | Le Dragon | |
| S23 | Le Schtroumpf Musicien | |
| S24 | Le Puzzle | |
| S25 | Observation | |
| S26 | Jeu Sonore | |
| S27 | La Luge | |
| S28 | Les Schtroumpfs Noirs | |
| S29 | L'Anniversaire | |
| S30 | Le Pont de la Rivière Schtroumpfs | |
| S31 | Les Tortues | |
| S32 | Chez Gargamel | |
| S33 | La Formule Magique | |
| S34 | La Cigogne | |
| S35 | Le Coloriage | |
| S36 | La Mine Désaffectée | dépend de 1.6 |
| S38 | Le Schtroumpf à Lunettes | |
| S39 | L'Oiseau | |
| S40 | Le Quizz | dépend de 1.4 (DAT) |
| S41 | Le Magicien | |

Regroupement conseillé : par paires de mini-jeux de taille voisine. Si 0.3 donne la taille des fonctions, équilibrer avec.

---

## Phase 5 : intégration et finition (en dernier, par la session principale ou un seul agent)

- **5.1** Ajouter le jeu à `registry.ts`. Mettre à jour la page d'accueil, le README (tableau des jeux, section architecture) et les textes de présentation, tous **à valider**.
- **5.2** UX : mise à l'échelle et responsive, curseur, focus clavier, états de chargement et d'erreur (fichiers manquants), audio débloqué au premier clic.
- **5.3** Parcours complet : un robot headless qui enchaîne une partie (sur le modèle de `PLAY=1` d'Indy), plus une vérification manuelle dans le navigateur.
- **5.4** Build de production : taille de `dist/`, chargement paresseux des ressources par scène, test du déploiement sous un sous-dossier.
- **5.5** Revue (`/review-current`) et préparation d'un message de commit, sans commit tant qu'il n'est pas demandé.

---

## Ordonnancement et parallélisme

| Vague | Tâches | En parallèle |
|---|---|---|
| A | 0.1 (session principale), puis 0.2 | non |
| B | 0.3 ∥ 1.1 ∥ 1.2 ∥ 1.4 | oui, fichiers disjoints |
| C | 1.3 ∥ 1.5 ∥ 1.6 ∥ 2.1 ∥ 1.7 | oui |
| D | 2.2, puis 2.3 | non (socle partagé) |
| E | 3.1 ∥ 3.2 ∥ 3.3 ∥ mini-jeux (4 à 6 agents à la fois) | oui |
| F | 5.x | non |

## Risques

- **RE 16 bits.** La décompilation Ghidra du code Borland real mode (segments, pointeurs far, EMS) est bruitée. Sonnet peut buter sur la vague C et sur les mini-jeux complexes ; prévoir une relance en Opus, ciblée sur les fonctions bloquantes.
- **Fidélité.** Sans DOSBox pour comparer, les cadences, les hotspots et les textes en dur risquent d'être approximatifs. Installer DOSBox-X localement est à envisager (autre décision).
- **Taille du dépôt.** Environ 200 Mo de MUX et de VOC à versionner.
- **Agents dans le même checkout.** Sans worktree, le respect strict de la colonne « Possède » est la seule protection contre les écrasements.
