# Flight of the Amazon Queen : groupe 1, jungle et Amazones (vague L)

Code : `src/games/fotaq/engine/specials/group-1/` (`ids.ts`, `areas.ts`, `index.ts`). Tests : `test/fotaq/specials/group-1/` (`areas.test.ts`, `walkthrough.test.ts`) et la solution jouée `solution.ts` (à brancher dans `test/fotaq/solutions.ts`).

## 1. Ce que le groupe porte

Pièces 1 à 6 et 8 à 21, **aucun mouvement spécial** (`ownership.ts`). Seul `handleSpecialArea` a des cas dans ces pièces (`areas.ts`) :

| Pièce | Zone / étape | Réaction | ScummVM |
| --- | --- | --- | --- |
| 4 (pont de lianes) | zone 4 éteinte tant que la liane n'est pas posée (`AREA r4 on 4`) | Joe dit la réplique 16 (`JOE00161`), pas de cinématique | `ROOM_JUNGLE_BRIDGE` : `makeJoeSpeak(16)` |
| 6 (premier gorille) | zone 6 éteinte | `C6C.CUT` | `ROOM_JUNGLE_GORILLA_1` |
| 14 (faux dinosaure) | zone 9 éteinte | `C14B.CUT` | `ROOM_JUNGLE_GORILLA_2` |
| 16 (entrée des Amazones) | zone 3 éteinte (la zone 1 l'est aussi mais ne joue rien) | `C16A.CUT` | `ROOM_AMAZON_ENTRANCE`, `areaNum == 3` |
| 17 (cachette) | 4e étape de marche / 2e étape de marche | `C17A.CUT` / `C17B.CUT` | `ROOM_AMAZON_HIDEOUT`, test sur `walkDataNum` |

Le moteur (`FotaqEngine.handleSpecialArea`) tourne Joe, annule la pièce demandée et enchaîne les cinématiques renvoyées ; le groupe ne fait que choisir la première (`g.playCutaway` rend le `nextCut` de ScummVM).

**Pas de `roomUpdates`** : `Graphics::update` n'anime que les pièces 69 et 74 (`BamScene`), qui sont d'autres groupes. La parallaxe (`handleParallax` : pièce 17) et les couleurs de texte (pièce 9) sont déjà dans le moteur, de même que la liste de commandes 649 et le défilement de palette de la pièce 4 (`engine.md` § 9). **Pas de `specialRooms`** : aucune des pièces du groupe (hors piton, groupe 6) n'est prise en charge par `changeToSpecialRoom`.

## 2. Écarts à ScummVM

- **`C17B.CUT` n'existe pas dans les données du jeu** (seul `C17A.CUT` est fourni) et aucune zone de la pièce 17 n'est éteinte au départ ni par une commande : la branche `walkDataNum == 2` est du code mort, dans ScummVM comme ici. Elle est portée à l'identique (demande `C17B.CUT`) ; le test vérifie la demande avec un `playCutaway` simulé. Si elle devait un jour s'exécuter, le moteur lèverait « fichier absent » (ScummVM aussi ne trouverait pas la ressource).
- La pièce 17 : `C17A` n'est atteignable que si une zone de marche à la 4e étape d'un chemin est éteinte ; ce n'est pas le cas non plus dans les données. Même statut (code mort, testé par appel direct de `handleSpecialArea`).
- `playCutaway` rend ici le nom de la cinématique suivante (le tableau `nextCut` de ScummVM) ; la boucle finale de ScummVM est celle du moteur.

## 3. Aides manquantes, besoins hors dossier

Aucun. Remarques pour le joueur scripté, **reprises par le coordinateur dans `test/fotaq/walkthrough.ts`** (`chooseText` qui défile, `reach` appelé par `goTo` / `act` / `useItem`, `toPinnacle` / `fromPinnacle` ; les copies locales de `solution.ts` sont retirées) :

- **Le menu d'un dialogue n'affiche que quatre lignes** : une option peut être cachée derrière la flèche du bas (zone du panneau à droite, ici cliquée en (311, 190)). `Walkthrough.chooseText` ne la voit pas ; `solution.ts` a un `pick` qui fait défiler. À remonter dans `Walkthrough` par le coordinateur (`chooseText` qui défile).
- **Les pièces plus larges que l'écran** (20, 21, 17, 14…) : `pointOf` lève tant que l'objet n'est pas à l'écran ; `solution.ts` a un `reach` (Joe marche vers le bord du côté de l'objet). Même remarque.
- **Le piton** (pièce 7) ne rend jamais la main (`handlePinnacleRoom` attend la souris) : `settle` ne peut pas suivre un clic qui y mène ; `solution.ts` a `toPinnacle` (clic puis attente du piton) et `fromPinnacle` (survol puis clic sur la destination), calqués sur `test/fotaq/specials/group-6/pinnacle.test.ts`. Idem, à mutualiser si d'autres groupes en ont besoin.

## 4. Passage du groupe : `group1Solution` et `returnToAmazons`

`solution.ts` exporte `group1Solution : GroupSolution` (`start`, `solve`) : passages **1a à 1c**, du site du crash (pièce 1) à la cachette des Amazones (pièce 17). Départ : `{ entryObject: 6, items: [58] }` (Joe sort par la porte de la pièce 1, vêtements en inventaire). Le test de passage joue les 1a à 1c (moins d'une demi-seconde réelle).

**Le passage 1d ne peut pas faire partie de `solve`** : il suppose le groupe 2 joué (Azura libérée, `gs40 = 1`), alors que `PLAY_ORDER = [6, 4, 5, 1, 2, 3]` place le groupe 1 entier avant le 2. Il est exporté à part : `returnToAmazons(w)` (étape 66 : `O117` « entrée » de la pièce 17 -> `C18C.CUT`, I17 corne de tyranno, `gs102 = 1`). **Branché** : la partie complète (`PLAY_ORDER`, passage 1d, `specials.md` § 7) le joue après 2a, précédé du trajet de l'étape 65 (piton O48 -> pièce 16, O101 -> pièce 17) ; le test du groupe ne rejoue pas ce trajet (le test remet Joe dans la pièce 17, où il est déjà, et pose `gs40 = 1` à la main pour simuler le groupe 2).

État d'arrivée vérifié (1c) : pièce 17, Joe en (309, 73) ; inventaire : I1 batte, I2 journal, I3 couteau, I10 B.D, I12 scarabée, I14 dictionnaire, I19 disque, I20 aspirateur, I21 épuisette, I24 de l'argent, I40 briquet, I76 ciseaux, I94 plans de la fusée, I95 poupée (+ les restes) ; états : gs1, gs2, gs5, gs6, gs7, gs11, gs15, gs18, gs20, gs22, gs23, gs26, gs31, gs51, gs54, gs83, gs101, gs103, gs109, gs112, gs120 (= 2), gs123 (= 2), gs130, gs136, gs163, gs164, gs166, gs168, gs169, gs173, gs174, gs195, gs196 à 1 ; gs12 = 2, gs14 = 2, gs16 = 2, gs25 = 2, gs56 = 3, gs115 = 2. Tenue : sous-vêtements puis vêtements normaux (`C2A`, mouvement spécial 4 du groupe 4 ; I58 n'est plus en inventaire).

## 5. Corrections de la solution du § 7 de `specials.md`

La solution du § 7 était incomplète ou fausse en plusieurs points, **corrigés par le test de passage** :

1. **Pièce 1, étape 6** : la porte O6 est fermée ; il faut d'abord **Ouvrir O6**, puis marcher. De même la sortie de la pièce 1 n'est pas de la forme « Marcher O6 » seule.
2. **Pont de la pièce 4 (étapes 13 et 14)** : l'étape 14 (« facultatif ») est **obligatoire** : la banane O26 est de l'autre côté du pont, zone éteinte tant que la liane n'est pas posée (`handleSpecialArea` de la pièce 4 : Joe s'arrête et dit la réplique 16). Ordre correct : pièce 4 (`c4b`) -> 3 -> 5 (`c5c`) -> couteau sur O35 (liane, `c5a`) -> 3 -> 4 -> liane I8 sur O28 (`c4a`, `gs7 = 1`) -> banane O26 -> 3 -> 5 -> 6.
3. **Gorille et faux dinosaure (étapes 18 et 33)** : `gs115 = 1` n'est **pas** posé par `ape.DOG` (pièce 6, qui ne fait que jouer `c6a`), mais par le **premier** dialogue de la pièce 14 (`ape2.DOG`, `C346` : `gs115 == 0`, la fin du dialogue joue `c14c`), chemin joué : « C'est un déguisement, non? » > « Un dinosaure qui parle, ça n'existe pas! » > « Je sais qui vous êtes! Le gorille… » > « Ce déguisement grotesque ne me trompe pas. Vous êtes un singe. ». Le **second** dialogue (`ape3.DOG`) est `Comment avez-vous fait pour disparaître…` > `Si je vous dis encore que vous n'existez pas…` > `Désolé, mon vieux, mais vous n'existez pas!` (cette dernière option est **cachée derrière la flèche du bas** : le menu n'affiche que quatre lignes) -> `gs115 = 2`, `c14a`. Les chemins de l'arbre « lu » de l'étape 33 sont donc **vérifiés** maintenant.
4. **Étape 22 (`bob5.DOG`)** : trois choix suffisent : « Pourquoi avez-vous besoin de mon aide? » > « D'accord, je vous aiderai… » > « Pourquoi pensez-vous que c'est la Flöda… » > « Bon, maintenant que je connais les détails… ». La liste des options est de deux lignes seulement après « D'accord » (« Bon, maintenant… » n'apparaît qu'après un choix de plus). **Vérifié.**
5. **Étape 27/28 (`lou1.DOG`, `bud1.DOG`)** : chemins du § 7 **rejoués et corrects** (`gs120 = 1` avec « Dites, il fait vraiment chaud ici! » seul).
6. **Pièce 16 (étapes 60 et 61)** : le premier « Utiliser O97 » s'arrête devant la zone 3 éteinte (`C16A`, deux Amazones) ; il faut **refaire** « Utiliser O97 » (Joe est alors au bord de la zone, en (147, 141)) pour déclencher `C16B` et passer en pièce 19. Le § 7 les décrivait comme une seule action.
7. **Étape 64** : la cinématique jouée en sortant de la pièce 19 est **`c18e.CUT`** (et non `c18a`), Joe arrive bien en (309, 73), `gs103 = 1`.
8. **Pièces plus larges que l'écran** (20, 21, 14, 17, 16…) : les objets de passage et de jeu ne sont pas toujours à l'écran à l'arrivée ; le joueur scripté marche d'abord (`reach`).
9. **Piton** : voir § 3 (on ne peut pas attendre la fin du clic).
10. **Quitter la pièce 9 par O58** (vers la 8) après `c9a` : Bud et Skip passent en pièce 15 et `gs12 = 2` (le § 7 dit `gs12 = 1`).
11. **Étapes 40 et 41** : à l'arrivée, `gs140` n'est pas à 1 (le § 7 l'annonçait) ; sans conséquence pour la suite.
12. **Étapes 5, 11 et 58** (Faye, Sparky 2 et 3) : facultatives, **non jouées** par `solve`.

Les étapes 1 à 64 du § 7 qui ne sont pas listées ci-dessus sont rejouées telles quelles.

## 6. Points ouverts

- `solve` ne joue ni les dialogues facultatifs (Faye, Sparky 2 et 3), ni la variante de Bud (`gs8`, `gs160`), ni le chemin long de la sorcière (`witch1.DOG`, `gs120 == 0`).
- Aucune vérification à l'écran de la bulle de l'étape 4 de la pièce 4 (la réplique 16 est testée par sa voix `JOE00161`).
- `C17B.CUT` manquant : voir § 2.
