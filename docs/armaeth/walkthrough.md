# Armaeth : solution jouée par le robot

Solution du jeu écrite comme une suite d'**actions de joueur** (commandes tapées, clics des bottes, flèches, touches `-` / `=`, F2 / F3), avec le score attendu après chaque étape. Elle est jouée de bout en bout par `test/armaeth/walkthrough.test.ts` (robot : `test/armaeth/robot.ts`, graine du hasard 3, aucun téléport ni écriture d'état). Les conseils sont tirés de l'arbre d'aide `A1FSOS.SYS` (606 nœuds, « Niveau de jeu 0 à 3 ») ; `[n]` = identifiant de nœud.

**État atteint : le robot joue les chapitres 0, 1 et 2 (score 175) et entre dans la salle de garde 305 ; la fin (couronnement, salle 108) n'est pas atteinte** (§ Blocages). Durée du test : environ 11 s.

## Chapitre 0 : la forêt (score 95)

Aide : ours [16], pie [17], feu [18], torches [19], entrée secrète [20] (stèle [110-118], serrure [111], clef d'or [123-129], mécanisme [112], levier [160-167]).

| Étape | Actions | Score |
|---|---|---|
| Départ | cliquer pour passer le logo et l'introduction (salle 1) | 0 |
| Cabane (salle 3) | « prendre le fouet », « prendre le seau » | 0 |
| Salle 11 | « prendre la clef » (clef d'or [123-129]) | 0 |
| Salle 14 | au pied de l'échelle (cases de sol 7, X ~122) : `-` jusqu'à Y <= 82, `-` (arrêt), flèche gauche jusqu'à X <= 40, flèche gauche (arrêt), `=` : prise perdue, chute dans la poche, KO de 100 tics ; clic des bottes en (41, 150) : glissade vers la prairie (salle 8) | 0 |
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
| Éboulement (202) | échelle gauche (X 144-159) : `-` jusqu'à Y <= 28, `-`, flèche droite jusqu'à X >= 192, arrêt, `=` en bas de l'échelle de droite, flèche bas : chute de 7 px, KO de 100 tics | 135 |
| Rampe | clics des bottes (230, 62), (262, 95), (290, 112), (296, 98) | 135 |
| Herse | dire « tinhuel » (V214 / V215 ; V213 si les nains ont bloqué le mécanisme : restaurer) : la herse (`Num 207`) se lève (+40) | 175 |
| Passage | par la sortie haute de 202 vers la salle 305 (salle de garde) | 175 |

## Chapitre 3 : non joué (suite reconstituée depuis l'aide et les docs)

Ordre prévu par l'aide et par les gestionnaires déjà portés (aucune de ces étapes n'est jouée par le robot) :

1. Traverser la salle de garde 305 vers la mine par la porte de droite [367] (les gardes de la salle ne poursuivent pas au-delà [363]).
2. Bouclier [256] : la hache (`Num 206`) est nécessaire ; le puits 102 mène à la salle 212 (poterne 210), niche, hache [301-303].
3. Trousseau (`Num 108`, salle 104) : ouvre le coffre de fer 319 (salle 313, au fond du puits : l'eau est mortelle tant que la vanne 310 du garde-manger 305 n'est pas ouverte ; la grille 309 demande la clef 331, portée par un soldat) [346, 542-548].
4. Baguette (`Num 320`) donnée à Minas Thyl (salle 304) : talisman 321 (+20) [348, 584].
5. « sillerynn » avec le talisman et le seau (`Num 25`) : couronne 328.
6. « chausser la couronne » : couronnement `Num 333`, salle 108 [fin].

Confiance : conditions d'inventaire et références de messages certaines (`characters.md` § 7-9) ; enchaînement et scores des étapes 2 à 5 probables.

## Blocages

- **Soldats de la salle 305** (confiance : certain pour l'effet, probable pour la cause). Quel que soit le délai passé en 202, le soldat 58 se trouve en (88, 113, P 127) à l'arrivée du héros en (75, 115, P 131) : contact en moins de 70 tics, duel sans arme = mort (`2a44:02de`, « tous les autres cas : P »). Les 4 soldats sont `Ego 0` au chargement alors que `characters.md` § 9.4 donne `Ego 5` / `Ego 6` aux séries 80 et 81 (gardes de poste) et que l'aide [361-367] décrit des gardes qui ne poursuivent pas ou dorment (`Ego 7/8`). Lacunes à reconstituer avant d'aller plus loin : activation des soldats à l'entrée (`147f:000a`, jusqu'à 2 soldats aux positions `(0x44, 0x50, 0x48)` / `(0x24, 0x50, 0x36)`, événement 201), réveil des endormis, valeurs exactes des postes `2151:0006`. Il faut aussi une réponse à la question « le soldat 58 est-il endormi dans la salle initiale ? » (l'image de contrôle de 305 montre une silhouette allongée à sa position de départ).
- **Hache (`Num 206`)** : à la fin du chapitre 0 elle est déjà dans l'inventaire du nain 204 (série 69), qui ramasse les objets de valeur ; le robot ne peut pas l'obtenir sans affronter un nain. Les portes de chapitre (`4b1e`) sont toutes ouvertes dès `CM2` (`cle 0 7` à `cle 3 7`) : le port est fidèle, la cause est le comportement hors salle des nains (les nains ne changent jamais de salle par les bords, `leaveRoom` ne franchit pas la limite), à confirmer.
- Lacunes de textes : captures et verdict du roi (S51-54, S55, S70-76, CM3), objet de remplacement de Prytwen (salle 110).

## Bugs trouvés par le robot

Chaque entrée : cause, correction, adresse d'origine. Couverture par les jalons du test du parcours : 2, 3, 5, 6 et 10 (échelle et chute du chapitre 0, stèle, lumière de la 101, herse levée du chapitre 2) ; les correctifs 1, 4, 7, 8 et 9 n'ont pas de test dédié (à écrire).

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

Non corrigé (observations) : les nains ne quittent jamais la salle chargée par les bords ; `walkTo` : le tas de bois de la salle 8 n'est joignable que par la glissade de la poche (reproduction du comportement d'origine).
