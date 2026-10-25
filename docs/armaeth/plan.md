# Armaeth : plan d'implémentation

Jeu : *Armaeth* (Grandslam Video, 1994, CD pour DOS adapté par Rob Northen Computing), version française.
Jeu d'action et d'aventure en vue de côté : on dirige Killian au clavier et à la souris, on agit par icônes et par
commandes tapées (« prendre la clé »). Moteur `AM1.EXE` (Microsoft C 6, modèle large) et pilote vidéo résident `VGA.EXE`.

Ce document sert de brief commun aux sous-agents. Les références font foi sur ce plan :
`engine.md` (moteur), `parser.md` (commandes, jetons, scripts `CM`), `screens.md` (écrans), `formats.md`,
`graphics.md`, `audio.md`, `re-index.md` (corpus Ghidra, régénéré par `scripts/armaeth/re/run.sh`).

## Avancement

- Phase 1 terminée : extraction (`scripts/armaeth-extract.sh`), corpus Ghidra de `AM1.EXE` et `VGA.EXE`,
  lecteurs de toutes les données (`src/games/armaeth/data/`), visionneuse (`ui/asset-viewer.html`), études du moteur.
- Mise en commun déjà faite entre les jeux : liste des fichiers, chargement, images indexées, visionneuse,
  extraction des CD, outils Ghidra, aides de test (voir la section « Code commun aux jeux » du README).
- Le moteur sans tête exécute toute la logique du jeu (gestionnaires, personnages, trajets), avec un test de parcours complet et un test d'accessibilité sur toutes les salles ; la page navigateur attend la vague F0.
- Prochaine étape : vague F0, après le commit de la vague F de Mathémagique.

## Décisions

- **Langue** : version française seulement (`A1F*`). Les versions anglaise et allemande restent dans `archives/armaeth/cd/`.
- **Protection `SC0.EXE`** (code de tableau) : non reproduite.
- **Cadence** : IRQ0 à 50 Hz (diviseur PIT `0x5D37`), comme l'original ; le monde avance toutes les `délai + 1` images.
- **Son** : AdLib/OPL2 seulement, avec l'émulateur OPL2 de Lost in Time déplacé dans un module commun (vague F0)
  et un séquenceur neuf qui reproduit le pilote de `AM1.EXE`. MIDI MPU-401 et haut-parleur non portés.
- **Moteur propre au jeu**, sur le modèle du Téléportaschtroumpf et de Mathémagique : `Host` seule frontière avec
  le navigateur, scènes = machines à états, aucune attente bloquante dans `tick`, `TestHost` pour les tests.
- **Défauts de l'original** : reproduits par défaut ; chaque correction est décidée au cas par cas et documentée.
- **Aide `SOS`** (programme séparé, indices par chapitre) : page séparée, comme l'original (option A de `screens.md`),
  reliée depuis l'écran titre ; aucun texte nouveau, étiquettes de `MSGUTL` 57 à 61.
- **Analyse dynamique** : DOSBox-X (installé par Homebrew) et son débogueur pour trancher les points marqués
  « à confirmer » dans `engine.md`, `parser.md` et `screens.md` (cadence réelle, ordre des tirages, file de messages, fenêtres).

## Décisions à prendre

- **Sauvegardes** : sélecteur d'emplacements du navigateur à la place des quatre champs de l'original ; textes à valider.

## Vagues

| Vague | Tâche | Contenu | Dépend de |
|---|---|---|---|
| F0 | moteur commun | `src/engine/` (stockage, horloge à pas fixe, RNG avec préréglage MSC, hôte de base), `src/ui/game-shell.ts` (canvas, pause sur onglet caché, bouton son, erreurs), entrées pointeur et clavier, préférence de son, sortie Web Audio, `src/audio/opl2/` (déplacé de Lost in Time), faux hôte de test ; migration des jeux existants | commit de Mathémagique |
| R | R1 objets | catalogue des ~130 gestionnaires par type d'objet (verbes appliqués aux objets) | — |
| R | R2 personnages | IA des `Ego` 0 à 8 (modules `246c`-`2dd9`), combats, morts, table `Err → action` | — |
| R | R3 mouvements | `Dep` 1 à 4, codes de barrage (`1414:0006`), placement (`gm_object_behavior_main`) | — |
| R | R4 interface | icônes et curseurs (`FUN_1553_0004`, table `DGROUP:0bc2`), touches F, souris | — |
| G | G1 cœur | hôte, état du monde (depuis `world.ts`), horloge de jeu, boucle principale, chargement de salle, file d'événements différés, sauvegarde | F0 |
| G | G2 rendu | cadre et masque, décor, sprites avec priorité et miroir (comme `VGA.EXE`), rectangles modifiés, lumière jour / nuit | F0 |
| G | G3 son | séquenceur des banques `A1FMIX.SYS` à 50 Hz sur l'OPL2 commun, effets, jetons `mus` / `brt` / `fbt` / `msl` / `mst` | F0 |
| H | H1 texte | police `GPH`, fenêtres de message, ligne de saisie, analyseur (dictionnaire, emplacements, résolution des objets, file de messages) | G |
| H | H2 scripts | interpréteur des 119 jetons, scripts `CM1` à `CM4`, niveau `dgs` | G |
| H | H3 objets | mise à jour, animation (`ANI` / `DEF`), grille de marche, déplacements, trajets, contrôle de Killian | G, R3 |
| I | I1 actions | gestionnaires de verbes et par type d'objet, icônes et inventaire | H, R1, R4 |
| I | I2 personnages | comportements des personnages et des pièges, morts et résurrection (F4), fins | H, R2 |
| J | intégration | écrans titre, distribution et récit d'intro, page du jeu, entrée dans `registry.ts`, jaquette générée depuis la scène 20, `dev.html`, tactile, aide `SOS` | I |
| K | validation | partie complète jusqu'au couronnement, robot de partie si possible, revue | J |

Les tâches R produisent des documents (`docs/armaeth/`) et peuvent tourner en parallèle de F0 et G.

**Vague P (avant F0)** : F0 attend que les sessions Mathémagique et swiv3d (qui partagent déjà `src/audio/`) aient
commité, pour ne pas réécrire leurs fichiers. En attendant, les parties de G et H qui ne dépendent pas du navigateur
sont écrites en modules purs, testés sans DOM : P1 état du monde (horloge, file d'événements, score, sauvegarde)
et `src/engine/rng.ts` (nouveau module commun, adopté par les autres jeux en F0) ; P2 composition de l'image
(cadre, décor, masque, sprites, texte `GPH`, lumière) ; P3 séquenceur musical (écritures de registres OPL2) ;
P4 analyseur de commandes et file de messages. Ils seront branchés sur `Host` en G.
Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` et, dès qu'il y a un rendu, une vérification dans le navigateur.

## Dette technique notée

- Ghidra donne des noms automatiques différents à quelques fonctions d'un lancement à l'autre (déjà vrai pour le Téléportaschtroumpf) : à rendre déterministe dans `SeedFunctions` si ça gêne.
- Mathémagique n'est pas encore passé sur le code commun (liste des fichiers, extraction, outils Ghidra, visionneuse, encodeur PNG) : à faire avec la vague F0.
