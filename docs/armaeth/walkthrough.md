# Armaeth : solution jouée par le robot

Solution du jeu écrite comme une suite d'**actions de joueur** (commandes tapées, clics des bottes, flèches, touches `-` / `=`, F2 / F3), avec le score attendu après chaque étape. Elle est jouée de bout en bout par `test/armaeth/walkthrough.test.ts` (robot : `test/armaeth/robot.ts`, graine du hasard 3, aucun téléport ni écriture d'état). Les conseils sont tirés de l'arbre d'aide `A1FSOS.SYS` (606 nœuds, « Niveau de jeu 0 à 3 ») ; `[n]` = identifiant de nœud.

**État atteint : le robot joue les chapitres 0, 1 et 2 (score 175), puis dans le chapitre 3 la hache, la poterne et le bouclier du puits (score 190), le trousseau de la geôle et la planche de Minas Thyl (salle 304) ; la fin (couronnement, salle 108) n'est pas atteinte** (§ Blocages). Graine du hasard **10** (les graines 3, 8 et 16 de la version précédente ne passent plus depuis les correctifs 10 à 14 ci-dessous : le hasard est chaotique, la solution est la même). Durée du test : environ 35 s.

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

## Chapitre 3 : la mine, la sorcière et la couronne (joué jusqu'à la planche)

Plan d'ensemble, relu dans l'arbre d'aide `[342-606]` et dans la table initiale du monde (`CFG`) : la clef du garde-manger (`Num 331`) est dans les poches du **garde du cellier** (soldat série 80) ; la grille de fer 309 (alcôve du garde-manger, au fond de la salle 305) cache la **vanne 310** ; la vanne vide le puits (salle 212, eau `Num 215`) et donne accès au **coffre de fer 319** (salle 313, fond du puits), qui contient la **baguette 320** ; l'**épée d'orichalque 314** et l'émeraude 313 sont dans le coffre 323 de la plateforme de droite du gouffre (salle 312, atteinte par la planche 308 qu'on pose en travers) ; Minas Thyl (salle 304) donne le **talisman 321** contre sa baguette ; « sillerynn » (talisman et seau 25) fait la couronne 328 ; « chausser la couronne » déclenche le couronnement.

| Étape (jouée par le robot) | Actions | Score |
|---|---|---|
| (a) Hache | « prendre la hache » sur la rampe de la salle 202 dès l'arrivée (elle y est depuis le début : un nain la ramasse s'il passe avant le héros, c'est ce qui fait varier la graine) ; retour par l'échelle de droite, la barre et l'échelle de gauche (les pieds des échelles donnent sur les corniches : pas de chute) | 175 |
| (a) Puits | salle 102 : margelle (case 40, clic (90, 70)), `=`, `=` : la corde ; arrêt à Y >= 38 dans la salle 212 ; « casser la poterne avec la hache » (+10), « prendre le bouclier dans la niche » (+5) ; `-` jusqu'au sommet : le héros est posé sur la margelle | 190 |
| (b) Trousseau | par 101, 111, 103 ; dans la salle 106 (voûte du fond à gauche) se placer sous la voûte (clic (36, 44)) puis flèche haut ; salle 104 : « prendre le trousseau » | 190 |
| (c) Planche | rampe du dôme, salles 203, 207, 206, 205, 302 (un nain éveillé à l'arrivée : ressortir et attendre) ; sous le tunnel du fond de la 302 (clic (95, 60)) flèche haut : salle 304 (la lave tue : longer par le milieu à petits pas, geysers au hasard) ; Minas Thyl propose son pacte (`G325`) puis attend ; « prendre la planche » ; retour par le même chemin | 190 |

Reste à jouer (non fait, voir § Blocages) : traverser la salle de garde 305 vers la mine, poser la planche en salle 312 (« poser la planche » au bord, peu de charge), prendre l'épée dans le coffre, abattre le garde du cellier (épée : « tuer » sur un soldat assommé ou duel `K`/`V`, `2a44:02de`), prendre la clef 331, ouvrir la grille 309 puis la vanne, descendre au fond du puits (corde, `=` jusqu'à la salle 313), ouvrir le coffre 319 avec le trousseau, rendre la baguette à Minas Thyl (« donner la baguette à Minas ») : talisman (+20), « sillerynn », « chausser la couronne ».

Confiance : étapes (a) à (c) jouées et testées ; suite : références de messages et conditions certaines (`characters.md`, `objects.md`), enchaînement probable.

## Blocages

- **Soldats de la salle 305 : levé.** Cause : le port n'implémentait pas `147f:000a` pour la salle 305 ni la logique des gardes de poste. À chaque entrée, 1 chance sur 2 par place qu'un soldat `Ego 0` s'endorme (`Ego 8` puis `Ego 7`, réveil après 120 et 60 tics) ; les gardes `Ego 5` / `6` restent à leur poste (X 100..169, P 50..51 et X 57..94, P 18..19) et n'attaquent que sur leur case ou quand plus aucun soldat n'est là (`characters.md` § 7.3). Le soldat 58 n'est donc plus un tueur : au chargement des soldats série 58 et 82 (`Ego 0`), les deux dorment 1 fois sur 4 (traversée sûre), un seul 1 fois sur 2 ; le robot réessaie sinon (F2 / F3).
- **Chapitre 3 non terminé.** Le robot s'arrête à la planche prise et à la salle 302. Ce qui bloque la suite est de la **durée de jeu aléatoire** (cinq salles de nains à repasser dans le sens retour, une tentative dure 40 s et il en faut des dizaines : le test dépasserait la minute) et non un défaut connu du port. Pistes : abattre les nains avec le bouclier et la hache (mineur `V`, guerrier 50 % `V`) au lieu de les éviter, ou attendre que les nains soient dans une autre salle.
- **Lacunes de textes et de scénario** (reportées, non nécessaires avant la fin) : capture et chaudron de Minas Thyl (`2dd9:009d`, antre salle 301 ; la capture suspend le héros en `Ego 6`), suite de la reprise de la baguette (`2dd9:0afc`, disparition, `G328`/`G329`), verdict du roi (S51-54, S55, S70-76, CM3), objet de remplacement de Prytwen (salle 110).

## Bugs trouvés par le robot

Chaque entrée : cause, correction, adresse d'origine. Couverture : les correctifs 2, 3, 5, 6 et 10 par les jalons du test du parcours ; 1, 4 (`engine.test.ts`), 7 (`npc.test.ts`), 8 (`tokens.test.ts`) et 9 (`hero.test.ts`) par des tests dédiés ; 11 à 15 par `placement.test.ts`, `npc.test.ts`, `room-entry.test.ts` et le parcours.

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

Corrections de la documentation laissée par le premier robot : la hache n'est **pas** dans l'inventaire du nain 204 au départ (elle est par terre sur la rampe de la salle 202, `(296, 86, 77)` ; un nain la ramasse parfois avant l'arrivée du héros) ; les nains **changent** de salle (le mineur 201 de la salle 202 passe en 205, le guerrier 203 de la 310 en 311) ; les « portes de chapitre » ne sont pas en cause.

Non corrigé (observations) : `walkTo` : le tas de bois de la salle 8 n'est joignable que par la glissade de la poche (reproduction du comportement d'origine). Le banc DOSBox-X permet de tester un état du port dans l'original : `serializeWorld` du port vers `SVG001.SVG` (`-i`), F3 puis `c`, `svg`, `001` dans les quatre champs, et `/dgs 99` puis `/inf 1` pour lire la fiche du héros.
