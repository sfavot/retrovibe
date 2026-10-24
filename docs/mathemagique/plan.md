# Math Workshop (Mathémagique) : plan d'implémentation

Jeu : *Math Workshop* (Broderbund, 1994, CD Windows 3.x), titre affiché « Math Workshop (Mathémagique) ».
Moteur « Mohawk » : toute la logique est compilée dans `MATH` (NE 16 bits) ; les données sont des archives Mohawk (`*.DAT`).

Ce document sert de brief commun aux sous-agents. Les références font foi sur ce plan :
`engine.md` (moteur), `formats.md`, `shap.md`, `scr.md`, `re-index.md`, `screens/*.md` (un document par écran ou activité).

## Avancement

- Vagues A à E terminées (commit `e56ebd4`) : extraction, lecteurs de données (`src/games/mathemagique/data/`),
  visionneuse (`ui/asset-viewer.html`), rétro-ingénierie Ghidra, études du moteur et des 8 écrans.
- Vague H terminée (câblage) : les écrans Hidden, Patterns, Sticklers, Rockets et Hall of Fame sont enregistrés ; le hub pose son
  moniteur (`MonitorOverlay`, touches, ticks, `monitorClosed`) ; polices en Mac Roman (`encodeText`) ; tri des joueurs sans accents ;
  hôte navigateur : champ invisible du clavier mobile (`ui/text-input.ts`), téléchargement du certificat (`ui/certificate-download.ts`),
  appui long de 500 ms = Ctrl + clic, joueurs enregistrés en quittant et à `pagehide`. Reste : Bowling, Rhythm Shop, Pattern Windows.
- Prochaine étape : vague I.

## Décisions

- **Traduction** : mise de côté tant qu'on n'a pas le CD français (« Mathémagique », doublé en français, introuvable en ligne).
- **Manuel** : le PDF fourni est celui de la v2 de 1997 (`manual-en.md`) ; il sera réécrit en page web française adaptée à la v1 (vague J), textes à valider.
- **Vidéos du guide des parents** (`QTW/*.MOV`) : retirées du site (le jeu ne les lit pas ; `PVG.EXE` était un programme à part).
- **MIDI** : synthèse par soundfont General MIDI avec `spessasynth_lib` (Apache-2.0) et la banque GeneralUser GS,
  réduite aux instruments utilisés par les MIDI du jeu. Notre propre séquenceur garde la main sur les marqueurs (Rhythm Shop).
- **Moteur propre au jeu**, sur le modèle du Téléportaschtroumpf (`docs/teleportaschtroumpf/engine-ts.md`) :
  - `Host` comme seule frontière avec le navigateur (fichiers, temps, entrées, audio, stockage, présentation) ;
  - tick fixe de 60 Hz (17 ms, comme `timeSetEvent` de l'original) ;
  - scènes = machines à états (enter / leave / tick / exit / key) ; les attentes bloquantes de l'original deviennent des états, jamais d'`await` dans `tick` ;
  - `TestHost` (temps simulé, entrées pilotables, audio factice, stockage mémoire) pour les tests sans navigateur.
- **Dette technique notée** (hors périmètre) : un moteur commun aux jeux (`Host`, horloge, scènes, pause sur onglet caché)
  demanderait de refactorer le Téléportaschtroumpf et Lost in Time ; la liste des fichiers (`GameFiles`) existe en deux copies.
  Seule la préférence de son, déjà dupliquée, est partagée dans `src/ui/` (vague F3).
- **Défauts de l'original** : reproduits par défaut ; chaque correction est décidée au cas par cas et documentée.

## Vagues

| Vague | Tâche | Contenu | Dépend de |
|---|---|---|---|
| F | F1 cœur | `host`, `clock`, `scene` (changement différé), `rng` (LCG MSVC + tirage sans remise, vecteurs de test), cache de ressources, `roster` (sérialisation pure de `MWRoster`), `TestHost`, `engine-ts.md` | — |
| F | F2 graphismes | surfaces indexées 576×432, sauvegarde / restauration de zones, blit modes 0 / 8, masques 1 bit teintés, découpe, palette (SHPL partielle, éclaircissement, fondus, cycles), polices `.FON`, présentation canvas à l'échelle entière | — |
| F | F3 audio | WAVE (Web Audio, préchargement par SNDL, fin de son), MIDI (séquenceur à marqueurs, tempo, réécriture des notes, SYSX), adaptateur `spessasynth_lib`, script de réduction de la soundfont, préférence de son partagée | accord de téléchargement |
| G | G1 services | lecteur SCR (bloquant / pas à pas, sons, hooks, décalages), gadgets et zones cliquables, entrées (clic-clic / glisser, pièce portée, clavier), curseurs | F |
| G | G2 intégration | `index.ts` + registre, page de jeu, hôte navigateur, `dev.html`, pause sur onglet caché, jaquette générée depuis l'écran titre | F |
| G | G3 Poly et puzzles | aide de Poly (`POLLY.DAT`), code commun des puzzles (`PUZZ`, rotation, aimantation) | F |
| H | H1 | titre, crédits, hub (séquences secrètes) | G |
| H | H2 | moniteur (connexion, joueurs, préférences, Math Trivia), Hall of Fame, certificats | G |
| H | H3 à H6 | Rockets, Hidden, Puzzle Patterns, Super Sticklers | G |
| I | I1 à I3 | Bowling, Pattern Windows, Rhythm Shop (logique + séquenceur, puis scène) | H |
| J | finitions | page manuel FR, contrôles, tactile (appuis longs comme Lost in Time), robot de partie, revue | I |

Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` et, dès qu'il y a un rendu, une vérification dans le navigateur.

## Décisions de la vague H (2026-10-24)

- **Impression** (certificats, vitraux) : image PNG à télécharger, composée comme l'impression d'origine (WMF rendus).
- **Nom du joueur** : saisi dans le canvas (rendu d'origine), champ HTML invisible pour le clavier mobile ; lettres accentuées autorisées.
- **Joueurs** : `localStorage`, 40 au maximum, sauvegarde aussi en quittant (correction d'un défaut de l'original).
- **Quitter** (hub, après la confirmation par sifflet) : retour à l'accueil du site.
- **Ctrl + clic** sur tactile : appui long de 500 ms (comme Lost in Time).
- **Séquences secrètes** : les 12 décodées, au clavier ; les 7 partielles restent à retrouver.
- **Rockets** : le compteur de victoires de Poly jamais remis à zéro est reproduit (défaut documenté).
- **Textes du site validés** : `src/games/mathemagique/copy.ts`.
