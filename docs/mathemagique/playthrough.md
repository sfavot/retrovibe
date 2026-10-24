# Robot de parcours de Math Workshop (tâche J3)

Un robot qui joue tout le jeu sans navigateur, sur l'hôte de test, avec les vraies scènes et les vraies données (`original/mathemagique/`), pour trouver des bugs que les tests de scène ne voient pas (enchaînements, états résiduels, sorties en cours d'animation). Il suit l'esprit du robot du Téléportaschtroumpf (`test/teleportaschtroumpf/playthrough/`).

## Lancer

À ajouter par la lead dans la section Math Workshop du README :

> `PLAY=1 npx vitest run test/mathemagique/playthrough` lance le robot (variables : `PLAY_SEEDS` nombre de graines, 10 par défaut ; `PLAY_FROM`, `PLAY_ONLY`, `PLAY_DEBUG=1` ; voir `docs/mathemagique/playthrough.md`).

Sans `PLAY`, le test est ignoré (`npm test` reste rapide). Il est aussi ignoré sans `original/mathemagique/`.

| Variable | Défaut | Rôle |
|---|---|---|
| `PLAY` | — | active le robot |
| `PLAY_SEEDS` | 10 | nombre de graines |
| `PLAY_FROM` | 1 | première graine |
| `PLAY_ONLY` | — | une seule graine (rejeu d'un défaut) |
| `PLAY_DEBUG` | — | `1` : journal du parcours et des violations au fil de l'eau |
| `PLAY_MAX_REAL_SECONDS` / `PLAY_MAX_SIM_SECONDS` | 600 / 7200 | plafonds de temps réel et simulé d'une graine |
| `PLAY_UNIFORM_SECONDS` | 4 | durée au-delà de laquelle une image d'un seul ton ou une palette éteinte est une violation |
| `PLAY_LIT_SECONDS` | 8 | âge d'une scène à partir duquel sa palette doit être allumée (hors fondu) |
| `PLAY_STUCK_SECONDS` | 300 | durée au-delà de laquelle une animation encore en cours (hors hub) est « coincée » |

Durée : environ 1,3 s réelle par graine (10 à 20 minutes de jeu simulées), 20 graines en une trentaine de secondes.

## Ce que fait une graine

Un générateur seedé (`Rng`, indépendant du hasard du jeu) tire tous les choix : une graine = un parcours rejouable (`PLAY_ONLY=n PLAY_DEBUG=1`).

1. **Titre** : crédits une fois sur trois (plaque, une page, EXIT), puis la porte → **hub** ; l'accueil de Poly passé, le moniteur de connexion s'ouvre, un joueur est créé au clavier (noms avec accents, espaces, point).
2. **Préférences** par Ctrl + clic sur Sign-in : Ambient Sounds, Click & Stick (le mode du pointeur alterne d'une activité à l'autre : cliquer-poser / glisser), durée du Bowling (tapée au clavier).
3. **Chaque activité**, depuis le hub, en cliquant l'objet du décor, dans un ordre tiré :
   - Hidden : niveau et vignette au hasard, parfois Reset en cours de route, puzzle résolu (pavage calculé depuis l'état public de la scène), rejeu par la télé, Exit ;
   - Patterns, Sticklers : niveau et vignette au hasard, Reset parfois, puzzle résolu avec les deux modes de souris (rotation à Espace), récompense (interrompue au clic une fois sur deux), Exit ;
   - Rockets : limite M et nombre de fusées changés, une partie complète contre Poly (stratégie gagnante ou tirage), une contre un ami, retour contre Poly, Reset, Exit ;
   - Bowling : opération et niveau au hasard, aide de Polly, questions mêlant bonnes et mauvaises réponses (clic et touches 1 à 4), STOP, un strike (dix bonnes réponses), parfois le niveau entier (dix strikes : bit du masque et rang vérifiés), Hall of Fame, « Print My Certificate » sur un port factice (cellule d'office puis cellule choisie), pages, EXIT, Exit ; une seconde visite avec une durée de 2 s pour le temps écoulé ;
   - Rhythm Shop : Fanfare variante 0 résolue (Fractionator, Cutter, deux moitiés dans le Pattern Bin) avec les deux modes de souris, morceau suivant / précédent, outils par Tab et chiffres, aide ;
   - Pattern Windows : lucarne, motif, version, couleurs et traits de peinture (clic ou glissé), Robinet, Yuck !, kaléidoscope, Imprimer (port factice), Exit ;
   - aide de Poly dans deux ou trois activités tirées, et dans le hub.
4. **Singe** : avant la sortie de chaque activité (une fois sur deux), 4 s de clics gauches et droits, doubles clics, glissés, déplacements et touches au hasard, hors des boutons Exit et Aide ; puis, depuis le hub, trois tournées de singe sans aucune restriction (elles lancent des activités, ouvrent le moniteur, l'aide, les séquences secrètes…), chacune terminée par la demande de sortie du moteur (`requestExit`).
5. **Sifflet** : Quit, annulation par un clic ailleurs, Quit, clic sur le sifflet : `host.exit()` doit être appelé.

## Invariants vérifiés

À chaque image (`robot.ts`, `checkFrame`) :

- aucune exception du moteur ou d'une scène ; aucun `Engine.error` / `Engine.failed` (échec de chargement d'une scène) ;
- l'image présentée n'a jamais un seul indice de couleur, ni une palette éteinte (somme des octets < 3000, comme `wiring.test.ts`), pendant plus de `PLAY_UNIFORM_SECONDS` ;
- `PLAY_LIT_SECONDS` après l'entrée d'une scène, sans fondu en cours, la palette présentée n'est pas noire ;
- enter / leave des scènes équilibrés (chaque fabrique est enveloppée) : pas d'enter sans leave de la précédente, pas de double enter ni de double leave ;
- toute attente bornée (retour au hub, fin d'animation, fermeture de l'aide…) : dépassement = violation « bloqué » avec l'état de la scène, de la pièce portée, des animations et du curseur.

Chaque seconde simulée :

- audio : au plus 40 WAVE à la fois, 4 en boucle, 200 handles jamais arrêtés ; aucun `stopWave` d'un handle jamais lancé ;
- aucune animation SCR ne tourne depuis plus de `PLAY_STUCK_SECONDS` hors du hub (les boucles d'ambiance du hub sont voulues) ;
- toute note MIDI jouée alors que le service sonore n'a aucune musique en cours (hors 1,5 s après l'entrée d'une scène) ;

Au retour au hub après chaque activité et à la fin : le roster enregistré se relit (`RosterStore.load` « ok »), fait l'aller-retour `decode` / `encode` sans changement, a les mêmes joueurs, le même masque pour le joueur courant et les mêmes préférences que la mémoire, et le rang reste entre 1 et 25. À la fin : le MIDI a été remis à zéro au moins une fois s'il a joué ; temps réel et simulé bornés.

## Résultats (20 graines, puis 400)

Voir le rapport en fin d'exécution (`RAPPORT : …`). État à la livraison : **aucune violation de jeu** sur les graines 1 à 20 (`PLAY_SEEDS=20`, environ 30 s) ni sur 1 à 60 et 100 à 399 (une graine : environ 1,5 s réelle). Le robot détecte bien ce qu'il cherche (essais de contrôle : fondu au noir tenu → « palette noire », animation en boucle hors hub → « animation coincée »).

Défauts rencontrés pendant la mise au point, **tous du robot** et corrigés dans le robot : clic de sortie fait pendant une animation non interruptible (la sortie réessaie maintenant), moniteur du nom ouvert par un clic du singe (OK le referme), aide de Poly non refermée faute de viser Poly, `lastResult` de Rockets conservé d'une partie à l'autre, rotation d'un fragment de Sticklers avant de le poser près d'un bord, bit de masque du Bowling écrasé par la copie que la scène garde pendant sa visite (le robot l'écrit avant d'entrer), clic du singe sur Quit puis le sifflet (le jeu se ferme réellement : fin de partie normale).

### Observations (pas des bugs avérés)

- **Sticklers** : un fragment tourné est tenu avec les dimensions de son orientation courante ; déposé sur sa cible, il peut être repoussé par les bords de la zone de jeu (`clampStickCenter`), puis la rotation à Espace ramène un fragment de centre décalé de plus de 10 px de sa cible (tolérance de collage) : il ne se colle pas et il faut le reprendre (7 puzzles sur 27 le montrent quand on pose avant de tourner : niveau vert vignettes 2, 6, 7 et 8, niveau rouge vignettes 2, 3 et 8, numérotées à partir de 0). Conforme à `engine.md` (« le centre ne bouge pas puis est ramené dans l'écran ») ; seul un joueur qui pose avant de tourner le voit.
- **Hidden** : un clic sur la photo d'un puzzle résolu relance l'animation de récompense (voulu : la télé rejoue) ; pendant cette animation les boutons, Exit compris, sont inactifs (un clic de sortie fait à ce moment est perdu, sans retour d'information).
- **Bowling, Pattern Windows** : un clic sur le nom du joueur ouvre le moniteur ; Exit est inactif tant qu'il est ouvert (voulu).

## Ce que le robot ne vérifie pas

- le rendu réel du navigateur : Web Audio (`web-audio.ts`), synthétiseur MIDI (`spessasynth`), DOM, CSS, responsive, clavier virtuel, tactile (appui long), plein écran, Ctrl+V ;
- le contenu du certificat et du vitrail imprimés (le port est factice : on vérifie le nom de fichier, le type PNG et qu'un fichier est remis) ;
- l'exactitude des images : seul l'unicolore / la palette éteinte est détecté, pas un décor faux ou mal placé ;
- Rhythm Shop : seule la Fanfare variante 0 est résolue (les 44 autres morceaux et leurs variantes ne le sont pas, faute de solveur) ;
- Patterns et Sticklers : l'aide de Poly n'est pas ouverte (seuls Hidden, Rockets, Bowling, Rhythm Shop, Pattern Windows et le hub le font) ;
- Bowling : les niveaux bonus et la saisie d'un temps de plus de 3 chiffres ;
- les séquences secrètes du hub ne sont tapées que par hasard (singe).

## Fichiers

`test/mathemagique/playthrough/` : `playthrough.test.ts` (entrée, rapport), `journey.ts` (déroulé d'une graine), `robot.ts` (socle : temps, clics, attentes, invariants, enveloppe des scènes), `hub.ts` (titre, joueur, préférences, aide, sifflet), `puzzles.ts` (Hidden, Patterns, Sticklers), `activities.ts` (Rockets, Bowling, Hall of Fame, Rhythm Shop, Pattern Windows), `chaos.ts` (singe), `help.ts` (session d'aide de Poly), `host.ts` (hôte de test sans accumulation d'images, audio factice qui compte les handles et les notes).
