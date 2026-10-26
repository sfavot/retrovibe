# Armaeth : solution jouée par le robot

Solution du jeu écrite comme une suite d'**actions de joueur** (commandes tapées, clics des bottes, flèches, touches `-` / `=`, F2 / F3), avec le score attendu après chaque étape. Elle est jouée de bout en bout par `test/armaeth/walkthrough.test.ts` (robot : `test/armaeth/robot.ts`, graine du hasard 10, aucun téléport ni écriture d'état). Les conseils sont tirés de l'arbre d'aide `A1FSOS.SYS` (606 nœuds, « Niveau de jeu 0 à 3 ») ; `[n]` = identifiant de nœud.

**État atteint : le robot joue le jeu de bout en bout, du titre au couronnement et au verdict** : chapitres 0, 1 et 2 (score 175), puis dans le chapitre 3 la hache, la poterne et le bouclier (190), le trousseau, la planche de Minas Thyl (200), la traversée de la salle de garde et de la mine, la planche posée en travers du gouffre et l'épée d'orichalque (220), le garde du cellier, la clef ouvragée, la grille de fer et la vanne, le fond du puits et la baguette, le talisman donné contre la baguette (240), « sillerynn » (270), « chausser la couronne » : couronnement dans la salle 108, verdict (`S50` puis `S53`) et `S55`, **score 320 sur 725, partie terminée**. Graine du hasard **10** (les graines 4 à 7 échouent dès le chapitre 0 : le hasard est chaotique, la solution est la même ; à partir du chapitre 3 le parcours résiste à des perturbations de quelques centaines à milliers d'images, voir § Blocages). Durée du test : environ 17 s (chaque `it` en moins de 10 s).

## Chapitre 0 : la forêt (score 95)

Aide : ours [16], pie [17], feu [18], torches [19], entrée secrète [20] (stèle [110-118], serrure [111], clef d'or [123-129], mécanisme [112], levier [160-167]).

| Étape | Actions | Score |
|---|---|---|
| Départ | cliquer pour passer le logo et l'introduction (salle 1) | 0 |
| Cabane (salle 3) | « prendre le fouet », « prendre le seau » | 0 |
| Salle 11 | « prendre la clef » (clef d'or [123-129]) | 0 |
| Salle 14 | au pied de l'échelle (cases de sol 7 de la rangée P 72, clic (122, 125)) : `-` jusqu'à Y <= 82, `-` (arrêt), flèche gauche jusqu'à X <= 40, flèche gauche (arrêt), `=` : prise perdue, chute dans la poche, KO de 100 tics ; clic des bottes en (41, 150) : glissade vers la prairie (salle 8) | 0 |
| Salle 8 | marcher sur le tas de bois (sol 65, (217, 140)) : « prendre du bois » x 3 (torches) | 0 |
| Salle 18 | à côté du feu : « mettre la torche dans le feu » (+20), « allumer la torche avec le feu » (+5). Le conseil « raviver le feu » de l'aide [18] n'a pas de gestionnaire (verbe 18, réponse par défaut V29) | 25 |
| Ronces | marcher sur le sol 39 : « arracher les ronces » (+20) | 45 |
| Serrure | sol 36 devant la stèle : « ouvrir la stèle avec la clef » (+20) : le mécanisme se met en marche mais reste bloqué | 65 |
| Salle 7 (ours) | fouetter l'ours dès qu'il approche (réflexe du robot), « prendre le levier » [160-167] ; sortie à droite | 65 |
| Salle 5 | sol 44 : « pousser la stèle avec le levier » (+30), attendre, la stèle coulisse ; flèche droite, escalier (cases 80) vers la salle 101 | 95 |

Passages à hasard (ours, frelons, mort sur le chemin) : le robot sauvegarde (F2) et restaure (F3) puis recommence (`Robot.attempt`).

## Chapitre 1 : le château (score 135)

Aide : Prytwen [168], coffre [169], entrée secrète [170] (inscription, torchère près du trône [254]).

| Étape | Actions | Score |
|---|---|---|
| Salle 101 | la salle est éclairée (la stèle est ouverte) ; porter la torche allumée : le château est dans le noir | 95 |
| Trône (108) | par 111 puis 108 ; se placer en (143, 76), flèche haut jusqu'à P <= 16 (un écart de profondeur < 9 avec la torchère), arrêt ; « tirer la torchère » (V114, +40) : la dalle `Num 104` s'ouvre | 135 |

## Chapitre 2 : le dôme et la herse de granite (score 175)

Aide : nains [255], bouclier [256], herse [257] (formules, parchemin [316-319]), repaire de Ségomir [258].

| Étape | Actions | Score |
|---|---|---|
| Descente | de 108, la dalle ouverte mène à la salle 202 ; attendre qu'aucun nain ne soit visible (sinon remonter, patienter à l'écart, revenir : un nain sans arme = mort) | 135 |
| Éboulement (202) | échelle gauche (X 144-159) : `-` jusqu'à Y <= 28, `-`, flèche droite jusqu'à X >= 192, arrêt, `=` en bas de l'échelle de droite, le pied de l'échelle de droite donne sur la rampe : on y marche | 135 |
| Rampe | clics des bottes (230, 62), (262, 95), (290, 112), (296, 98) | 135 |
| Herse | dire « tinhuel » (V214 / V215 ; V213 si les nains ont bloqué le mécanisme : restaurer) : la herse (`Num 207`) se lève (+40) | 175 |
| Passage | par la sortie haute de 202 vers la salle 305 (salle de garde) | 175 |

## Chapitre 3 : la mine, la sorcière et la couronne (score 320, fin)

Plan d'ensemble, relu dans l'arbre d'aide `[342-606]` et dans la table initiale du monde (`CFG`) : la clef du garde-manger (`Num 331`) est dans les poches du **garde du cellier** (soldat série 80) ; la grille de fer 309 (alcôve du garde-manger, au fond de la salle 305) cache la **vanne 310** ; la vanne vide le puits (salle 212, eau `Num 215`) et donne accès au **coffre de fer 319** (salle 313, fond du puits), qui contient la **baguette 320** ; l'**épée d'orichalque 314** et l'émeraude 313 sont dans la crevasse 323 de la plateforme de droite du gouffre (salle 312, atteinte par la planche 308 qu'on pose en travers) ; Minas Thyl (salle 304) donne le **talisman 321** contre sa baguette ; « sillerynn » (talisman et seau 25) fait la couronne 328 ; « chausser la couronne » déclenche le couronnement.

| Étape (jouée par le robot) | Actions | Score |
|---|---|---|
| (a) Hache | « prendre la hache » sur la rampe de la salle 202 dès l'arrivée (elle y est depuis le début : un nain la ramasse s'il passe avant le héros, c'est ce qui fait varier la graine) ; retour par l'échelle de droite, la barre et l'échelle de gauche (les pieds des échelles donnent sur les corniches : pas de chute) | 175 |
| (a) Puits | salle 102 : margelle (case 40, clic (90, 70)), `=`, `=` : la corde ; arrêt à Y >= 38 dans la salle 212 ; « casser la poterne avec la hache » (+10), « prendre le bouclier dans la niche » (+5) ; `-` jusqu'au sommet : le héros est posé sur la margelle | 190 |
| (b) Trousseau | par 101, 111, 103 ; dans la salle 106 (voûte du fond à gauche) se placer sous la voûte (clic (36, 44)) puis flèche haut ; salle 104 : « prendre le trousseau » | 190 |
| (c) Planche | rampe du dôme, salles 203, 207, 206, 205, 302 (un nain éveillé à l'arrivée : ressortir et attendre) ; sous le tunnel du fond de la 302 (clic (95, 60)) flèche haut : salle 304 (la lave tue : longer par le milieu à petits pas, geysers au hasard) ; Minas Thyl propose son pacte (`G325`) puis attend ; « prendre la planche » (+10) ; retour par le même chemin | 200 |
| (d) La mine | de 302 à 312 par 205, 206, 207, 203, 202, **305 (salle de garde)**, 308, 306, 310 : **une sauvegarde (F2) avant chaque salle**, F3 et nouvel essai de cette seule salle si le héros y meurt ; la herse (`Num 207`) est rouverte par « tinhuel » si les nains l'ont refermée ; en 312 on jette sur la plateforme de gauche le seau, la hache, le bouclier, le fouet et le levier (le pont vermoulu, `Sol 53`, ne porte que 40 de charge, la planche comprise), on marche sur le pont, au bout de la plateforme du centre (`Sol 0x3E`, clic (198, 98)) « mettre la planche » (+20 ; « poser » n'est pas dans le dictionnaire), sur la plateforme de droite « regarder dans le trou » puis « prendre l'épée dans le trou » (l'émeraude est laissée : Minas Thyl la convoite) ; retour, on reprend le seau, la hache et le bouclier | 220 |
| (e) Cellier | retour en 305 (avec l'épée et le bouclier chaque duel est une victoire : `2a44:02de`) ; clic sur la case 0x37 devant la grille (X 140, P 52) : le garde du cellier attaque, l'épée le transperce, la clef 331 tombe ; « prendre la clef », « ouvrir la grille avec la clef », « ouvrir la vanne » (le puits se vide) | 220 |
| (f) Baguette | par 202, l'échelle de gauche, 108, 102 ; margelle, `=` `=` : la corde descend jusqu'à la salle 313 (le puits est vide) ; « ouvrir le coffre avec le trousseau », « prendre la baguette dans le coffre » ; pied de la corde, `-` jusqu'à la margelle | 220 |
| (g) Talisman, couronne, fin | descente du dôme, 302 ; Minas Thyl, immobile là où le héros l'a laissée (souvent son antre, 301), vient à sa rencontre : « donner la baguette à Minas » dès qu'elle est à portée (talisman, +20) ; « sillerynn » (+30 : le seau devient la couronne), « chausser la couronne » : le héros est téléporté devant le trône (108), l'acteur gravit les marches (`G371`, `G372`, +50), verdict `S50` (conclusion `S53` : secret du niveau découvert, trésor incomplet), `S55` ; `gameOver` | 320 |

Confiance : toutes les étapes sont jouées et testées. Parties supposées : le déroulé exact de la capture de Minas Thyl dans son antre, que le robot évite (voir § Blocages).

## Blocages

- **Soldats de la salle 305 : levé.** Cause : le port n'implémentait pas `147f:000a` pour la salle 305 ni la logique des gardes de poste. À chaque entrée, 1 chance sur 2 par place qu'un soldat `Ego 0` s'endorme (`Ego 8` puis `Ego 7`, réveil après 120 et 60 tics) ; les gardes `Ego 5` / `6` restent à leur poste (X 100..169, P 50..51 et X 57..94, P 18..19) et n'attaquent que sur leur case ou quand plus aucun soldat n'est là (`characters.md` § 7.3). Au chargement des soldats série 58 et 82 (`Ego 0`), les deux dorment 1 fois sur 4, un seul 1 fois sur 2 ; le robot ressort et attend sinon (`Robot.hop` : les gardes de poste ne comptent pas parmi les menaces).
- **Retour de 302 à 305 (cinq salles de nains) : levé.** Vérification de la fiabilité : avec une attente de 0 à 3 000 images insérée avant la traversée (16 valeurs : 17, 43, 97, 211, 333, 401, 500, 650, 777, 900, 1 000, 1 200, 1 500, 2 000, 2 500, 3 000, qui font diverger tout le hasard de la suite) le test passe à chaque fois. Les dizaines d'essais de 40 s n'étaient pas de la malchance : le robot échouait toujours dans la salle 207 (lac du fond, pont de plan 1). Causes, toutes dans le robot : (1) le clic droit de sortie visait `(160, 8)` de la scène, soit la barre d'icônes quand la scène commence à Y 10 : aucun trajet, puis `Player.leave` errait dans l'eau jusqu'à la noyade ; (2) un trajet interrompu par `Err 0x11` (passage d'un plan à l'autre) n'est repris qu'après un premier clic d'arrêt, puis un second clic de sortie ; (3) le curseur change d'outil / refuse un clic en 20 images : un clic envoyé dans cette animation est perdu ; (4) dans la mine les scènes sont étroites (308 : 64 x 80) et à côtés permutés (306, 311 : `perm` `3 0 1 2`) : le secteur cliqué est l'**emplacement** de sortie (`4b94` = identité, `exitBySector`), le héros marche ensuite vers le côté que la permutation lui donne. Une fois ces points réglés les cinq salles se passent du premier coup (chaque salle `Robot.hop` : on regarde les menaces à l'arrivée, on ressort et on attend sinon) et la traversée coûte moins d'une seconde de test ; sauvegarder avant chaque salle et ne refaire que la dernière (`crossTo`) couvre les morts rares (guerrier `rand() % 4` : 1 chance sur 4 de mourir avec le bouclier et la hache). Avec **l'épée et le bouclier chaque duel est une victoire** (`2a44:02de`) : les allers-retours suivants (mine, puits, dôme) ne demandent plus de précaution.
- **Herse refermée par les nains.** Un nain qui voit la herse ouverte la referme (`2a44:0a60`) : sur la route de 202 à 305 (dans les deux sens) le robot dit « tinhuel » de 202 ou de 305 et attend la fin du coulissement (`crossAll`, `portcullisOpen`).
- **Minas Thyl immobile, parfois dans son antre.** Hors de la salle chargée elle erre de salle en salle quelques instants puis s'immobilise (trajet hors salle `30d9:08c8` sans pas : `stepX` vient de l'animation, nul à l'arrêt) ; elle finit souvent en 301. Dans l'antre elle **capture** le héros au contact (`2dd9:0858`) : la séquence (`2dd9:009d`, chaudron `306`, « soupe humaine » `G364`) n'est pas reconstituée (le héros reste suspendu en `Ego 6`). Le robot entre dans l'antre, s'arrête aussitôt (le héros garde son élan, sinon il va droit au contact) et dit « donner la baguette à Minas » dès qu'elle est à portée (`Robot.until` sur `inReach`) : l'échange a lieu avant le contact. Piste non jouée : l'émeraude (convoitée par Minas Thyl) lancée sur la lave la fait sombrer (`G308`, événement 5) et libère le talisman.
- **Lacunes de textes et de scénario** (reportées, non nécessaires pour la fin) : capture et chaudron de Minas Thyl (`2dd9:009d`, antre salle 301), suite de la reprise de la baguette (`2dd9:0afc`, disparition, `G328`/`G329`), messages de découverte des passages (`S70`..`S76`, `CM3`), objet de remplacement de Prytwen (salle 110). Fin : le verdict `S50` + `S51`..`S54` et `S55` sont rendus (`2caf:0232`, `2caf:023a`) ; `S56` (« Bientôt ARMAETH II ») n'est pas appelé par `2caf:000e` (il doit l'être par le script de fin ou la commande `terminer`, non retrouvé).

## Bugs trouvés par le robot

Chaque entrée : cause, correction, adresse d'origine. Couverture : les correctifs 2, 3, 5, 6 et 10 par les jalons du test du parcours ; 1, 4 (`engine.test.ts`), 7 (`npc.test.ts`), 8 (`tokens.test.ts`) et 9 (`hero.test.ts`) par des tests dédiés ; 11 à 15 par `placement.test.ts`, `npc.test.ts`, `room-entry.test.ts` et le parcours ; 16 à 18 par `coronation.test.ts` et l'étape (g) du parcours.

1. `engine.ts` contact : `1a50:0006` parcourait la liste de l'objet porteur (`listA` de la salle) et non celle de la salle chargée : le Sarhûl de la salle 309 touchait le héros en permanence (`Err 8`, héros figé).
2. `hero.ts` `enterFall` + `mover.ts` (Dep 3) : placement d'entrée de chute `25ea:03ca` (`ctx.motion.search`, tolérance P 8, Y 10) et saut du contact après placement `179d:05ba` : la chute ne finissait jamais (`Err 2`).
3. `objects.ts` stèle : poussée `2500:04f3` (`Gst 7, Mob 1, Ego 3`...), blocage `2500:0438`, fermeture `2500:0590` : la stèle ne coulissait pas.
4. `engine.place` : appel préalable de `loadObjectSprite` (`1aba:000e` commence par `1833:01fc`) : le héros ne pouvait plus bouger en profondeur après un KO.
5. `room.ts` : lumière de la salle 101 (`147f:000a`) : `outdoor 7 / offset -32` si la stèle est ouverte, sinon 0 / 0 (salle noire).
6. `magic.ts` / `npc-things.ts` : herse `29fd:0000` / `29fd:017a` placée en mode 2 (`1a37:007f(2,1,0,0)`) sans recherche de sol : une herse levée retombait.
7. `npc-kit.ts` : `Ver` par défaut 1 pour les animations de personnages (`16f5:0132`) : les animations scriptées des nains n'avançaient pas.
8. `token-host.ts` `setLight` : l'auxiliaire est transmis tel quel (borne -1, comparaison signée `197e:0008`) : surexposition blanche avec la torche.
9. `hero.ts` : le héros d'`animId` 0 reste tenu tant que son partenaire (`+0x3A`) a une animation (duel, Prytwen) au lieu de repartir à la marche.
10. `hero.ts` `enterClimb` : placement `25ea:0008` après le changement d'état : le héros est posé sur les zones (corde du puits).

11. `placement.ts` : le balayage des zones (`1b11:0614`) est réservé à `Dep 2` et `4` (`1b11:04ed`, désassemblage) ; il était fait pour tous les corps. Preuve : l'original, lancé sous DOSBox-X avec une sauvegarde écrite par le port (`serializeWorld`, fichier `SVG001.SVG`, touche F3), pose le héros qui remonte la corde du puits de la salle 102 sur la margelle `(79, 53, 55)`, `Sol 40`, `Dep 0` (fiche `/inf 1`), et non sur la zone de la corde (`Sol 19`) où il retombait dans le puits. Conséquence pour le robot : les clics de marche atterrissent sur les cases de la grille (échelle de la salle 14 : clic (122, 125) ; salle 7 : le couloir bas), les pieds des échelles du dôme donnent sur les corniches.
12. `placement.ts` `placeObject` mode 5 : un échec de la recherche typée qui rend le `0x11` périmé de `DS:0ea8` n'est plus pris pour un succès (la recherche libre du mode 1 suit) ; même preuve que 11 (sans elle le héros restait sur la zone au sommet de la corde).
13. `game/helpers.ts` `setState` : `1a37:007f` appelle `1aba:000e` pour tout objet rangé dans une salle, même non chargée (le code périmé de `DS:0ea8` en dépend).
14. `game/room-entry.ts` (nouveau, `147f:000a`) : soldats de la salle 305 qui s'endorment, portes 309 et 329 ramenées dans la salle (`engine.ts` : option `onEnterRoom`).
15. `game/npc-dwarves.ts` : gardes de poste (`2a44:08da..0994`) et postes `2151:0006` (intervalles et non coordonnées : `helpers.wander` reçoit des intervalles `[lo, hi)`) ; `game/npc-minas.ts` : contact de Minas Thyl hors de son antre d'après `2dd9:0858` (pacte `G325` / `G326`, `Ego 5`, avertissements `G317`..`G319` avec la baguette, au lieu de `G321` en boucle sans changement d'état).

16. `game/npc-things.ts` acteur du couronnement (`2caf:000e`) : les états des étapes ne suivaient pas les appels `1a37:007f` du désassemblage (`2caf:0142`, `0182`, `01ba`, `01ef`, `0269` : `Gst`, `Mob`, `Fig`, `Dep 0`, `Txt 2`, mode 2) ; surtout la marche vers le trône (`Ego 4`) doit être `Mob 2` (`MOV DL,2`, `2caf:017e`) : en `Mob 1` l'acteur ne bougeait pas et la partie ne se terminait jamais. Les autres étapes sont en `Mob 1` (`Fig` 0 à l'étape 5, pas 1) et la dernière en `Gst 0`, `Mob 0`, `Fig 3`.
17. `game/objects.ts` couronnement (`2c83:0004`) : l'appel `27ed:0194` n'était pas fait : la dalle du trône (`Num 104`) est **replacée fermée** (`Y = 0x8B`, `Gst 0 Mob 0 Ego 0 Fig 0 Dep 1 Txt 2`, mode 2) ; dans la salle 108 les trois plans sont actifs (`4ae0 = 3`) et les trajets annulés (`1793:0006`). Avec la dalle ouverte (le cas normal : on est passé par elle pour entrer dans le dôme) les cases 81 du plan 0, qui descendent vers la salle 202, servaient de sol à l'acteur, bloqué en bas des marches (limite Y 164) : plus de fin.
18. `engine/engine.ts`, `engine/handlers.ts` (`HandlerScore.verdict`), `game/npc-things.ts` : fin du couronnement (`2caf:0232..023a`) : après `G372` et les points `(3, 7)`, `14cf:000c(0x32)` affiche le score et le verdict (en-tête `S50`, conclusion `S51`..`S54`) puis `S55` (`2caf:023a`), avant la disparition du héros (`4bfe = 0`). Le port posait seulement le drapeau de fin de partie (lacune notée par le premier robot). Le verdict avait déjà son écran (`Engine.showScore`).

Corrections du **robot** (pas du port), trouvées en jouant la fin : `Robot.exit` clique le secteur de la scène (et non un point fixe de l'écran), cliquer le secteur de l'**emplacement** de sortie (`sector`) et marcher vers le côté permuté (`side`) dans les salles de la mine, relancer un trajet interrompu par `Err 0x11` après un clic d'arrêt, attendre la fin de l'animation de refus du curseur ; `Robot.hop` ne compte pas les gardes de poste (`Ego 5` et `6`) parmi les menaces et recharge s'il ne peut plus ressortir ; `Robot.hero` lève un contretemps quand le héros est mort ; `Player.useBoots` attend la fin du changement d'outil.

Corrections de la documentation laissée par le premier robot : la hache n'est **pas** dans l'inventaire du nain 204 au départ (elle est par terre sur la rampe de la salle 202, `(296, 86, 77)` ; un nain la ramasse parfois avant l'arrivée du héros) ; les nains **changent** de salle (le mineur 201 de la salle 202 passe en 205, le guerrier 203 de la 310 en 311) ; les « portes de chapitre » ne sont pas en cause.

Non corrigé (observations) : `walkTo` : le tas de bois de la salle 8 n'est joignable que par la glissade de la poche (reproduction du comportement d'origine). Le banc DOSBox-X permet de tester un état du port dans l'original : `serializeWorld` du port vers `SVG001.SVG` (`-i`), F3 puis `c`, `svg`, `001` dans les quatre champs, et `/dgs 99` puis `/inf 1` pour lire la fiche du héros.
