# Ween: The Prophecy : partie complète en test (vague K)

État au 15/11/2026 : **la partie est jouée jusqu'à la fin du jeu**. Les trois grains de sable sont déposés dans le Revuss, puis viennent `GAGNEFX.TOT` (texte de fin) et l'écran final `EMAJ1END.TOT`. La solution compte 642 étapes, 48 357 images.

Le portage est **identique au banc ScummVM image par image** sur toute la partie, après deux correctifs du moteur commun (voir « Écarts, constats »).

**Pour reprendre** : la solution se trouve dans `test/ween/solution/walkthrough.ts`. On explore une salle avec `explore.test.ts` et on lit son script avec `script.test.ts` (outils décrits plus bas), puis on régénère la référence du banc (« Comparaison au banc »).

## Sources

Aucune soluce française n'a été trouvée. Les deux sources ci-dessous concordent sur toutes les réponses d'énigmes. Elles servent d'indications : les gestes réels viennent du jeu, et elles se trompent parfois sur l'ordre ou l'objet à utiliser (voir « Écarts »).

- Sierra Help, *Ween: The Prophecy Walkthrough* (<https://sierrahelp.com/Walkthroughs/WeenWalkthrough.html>). Soluce en six chapitres, concise (« use X on Y »). Elle est reprise presque mot pour mot par Just Adventure (<https://www.justadventure.com/walkthrough/prophecy/>).
- TuxedoCyan, FAQ DOS (2001), sur Mogelpower (<https://www.mogelpower.de/cheats/loesung.php?id=40208>). Source indépendante, qui explique l'interface et les déplacements. C'est elle qui donne la sortie cachée du précipice (la porte derrière les planches).
- Walkthrough King (<https://www.walkthroughking.com/text/ween.aspx>) : seulement le plan des chapitres (trois grains de sable, voyage, île du volcan, Revuss).

Pour les chapitres 4 à 6, la FAQ de Mogelpower est la plus précise (ordre des potions, lucioles, serrures de la prison, Revuss). Quand les soluces ne suffisaient pas, la condition a été lue dans le script de la salle (`script.test.ts`).

## Interface (constatée dans le jeu)

- **Barre d'icônes** (`MENU.TOT`) : elle apparaît quand le pointeur touche le haut de l'écran. Les icônes sont disquette (sauver, charger, quitter), joker (Petroy), bloc-notes, sac (inventaire), personnages (WEEN, PETROY, puis URM), se déplacer et réglages. Les listes (inventaire, personnages, disquette, emplacements) sont faites de lignes de texte : zones `0x8007 + i` de `MENU.TOT`. Les libellés sont recopiés à l'ouverture dans les variables à partir de l'octet 2 388 (40 octets par ligne).
- **Clic gauche sur un objet** : Ween le tient (« Utiliser X sur », pointeur en forme d'objet ; variable 63 = indice de l'objet, -1 sinon). **Un second clic gauche** l'utilise sur la cible, qui peut être un objet de la salle ou une ligne de l'inventaire (c'est ainsi qu'on combine deux objets). **Le clic droit** range l'objet tenu dans l'inventaire et ouvre la liste. Sans objet tenu, il ouvre seulement la liste. Un objet fixe (clef du laboratoire, tableau) revient à sa place.
- **Gros plans** : cliquer certains objets ouvre un gros plan (tablette, bague, moule, pierres), où il faut cliquer à nouveau pour prendre l'objet.
- **Sorties** : ce sont des zones sans nom, sous un pointeur en forme de porte. Un clic suffit en général. Certaines n'apparaissent qu'après un geste, comme la porte derrière les planches du précipice ou la porte de la stèle.
- **Messages** : la plupart attendent un clic dans la boucle des zones. Certains (épée scellée) attendent dans une boucle du script, après une animation.
- **Urm** : la flûte, utilisée sur WEEN (liste des personnages), l'appelle. Un fruit lui est donné en cliquant sur lui. Il demande ensuite où agir : on clique sur le lieu.
- **Sauvegarde** : disquette, SAUVER, emplacement, nom tapé au clavier, Entrée (JE CONFIRME). **Chargement** : disquette, CHARGER, nom de la sauvegarde, Entrée. Une espace tapée dans le nom n'est pas retenue.

## Outils de test (`test/ween/solution/`)

- `driver.ts` : le pilote. Il joue dans les conditions du banc (horloge exacte, graine 1, mêmes points d'image).
  - Une action n'est posée qu'au repos : depuis 6 images, la boucle d'attente la plus intérieure est celle de `Hotspots.evaluate`, repérée en enveloppant `check`, `checkFull`, `handleInputs` et `call`.
  - Le clic n'est posé que sur une image de cette boucle. Posé pendant un tic d'animation, un clic d'une seule image serait relâché avant d'être lu.
  - Le pilote note les entrées au format `GOB_INPUT` et, à la fin de chaque étape, l'image, le TOT et le `VH`.
  - Les étapes s'écrivent en texte (`parseSteps`) avec ces actions : clic avec nom de survol attendu, `p` (prendre), `i` (objet de l'inventaire), `c` (personnage), `l` (ligne de liste), `b` (icône), `g` (sortie), `s` (ranger), `ok` (message), `ok*` (messages qui se suivent), `x` (texte tapé), `d` (dialogue), `t` (TOT attendu), `w` (attente).
- `zones.ts` et `explore.test.ts` : l'outil d'exploration, ignoré sans `WEEN_EXPLORE`. Il joue un fichier d'étapes, puis écrit :
  - l'écran avec les zones actives encadrées (PNG ×2) et la liste des zones ;
  - avec `WEEN_EXPLORE_SURVEY=1`, le nom affiché au survol de chaque zone ;
  - l'inventaire, les textes affichés (`.DAT` et chaînes des variables) ;
  - les boucles d'attente image par image, les chaînes des variables et les entrées pour le banc.

  `WEEN_ALL_ZONES=1` liste aussi les zones désactivées.
- `script.test.ts` : lecture d'un script, ignorée sans `WEEN_SCRIPT` (nom du TOT, ex. `EMAJ1024`). Le désassembleur v2 du dépôt (`decodeInstr`) est complété par l'écriture des expressions en clair : `V<n>` désigne VAR(n), `B<octet>` et `W<octet>` des octets ou des mots, avec les blocs indentés, les textes du `.DAT` et les zones des blocs de type 2 (identifiant, coordonnées, fonctions d'entrée et de sortie). La sortie va dans `WEEN_SCRIPT_OUT`. Les fonctions de clic se retrouvent par le `switch V61` de la boucle de la salle (V61 = identifiant de la zone), et les mélanges d'objets par le `switch V191` (objet visé dans la liste), V63 étant l'objet tenu.
- `walkthrough.ts` : la solution en données. `full-game.test.ts` : (a) partie d'une traite comparée au banc ; (b) sauvegarde par la disquette après 4 étapes (cabane, laboratoire, crâne, stèle), reprise dans un moteur neuf sur le même stockage (même écran, variables relues identiques aux variables sauvegardées), fin de la partie depuis la dernière reprise. `make-reference.test.ts` et `bench/` : voir « Comparaison au banc ».

## Étapes jouées

### Chapitre 1

| Écran | Gestes | Résultat |
| --- | --- | --- |
| Introduction | Échap (image 21) | protection sautée (`PS 27 intro.tot 348`), `MENU`, `EMAJ1000` |
| Cabane `EMAJ1000` | boule de cristal, message de Petroy, boule de cuivre, pince, placard ouvert deux fois (saindoux, couteau), sortie gauche | `EMAJ1001` |
| Galerie `EMAJ1001` | dialogue d'Uki et Orbi, paille, pince sur la rambarde (bois), couteau sur le roseau, couteau sur le roseau de l'inventaire (flûte), axe, porte | `EMAJ1000` |
| Cabane | rideau | `EMAJ1002` |
| Laboratoire `EMAJ1002` | tablette (gros plan), soporifique, graines, clef sur le crâne (bague), soporifique sur les graines (drogue), tableau sur le crochet, drogue sur la niche, moule (gros plan), sortie | `EMAJ1000` |
| Cabane | Uki et Orbi font le chaudron (bague + boule) ; flûte (Urm), fraises à Urm (or), or, confiture, paille et bois dans la cheminée, confiture à Urm puis Urm sur la cheminée (feu), or dans le chaudron, chaudron sur le feu, chaudron sur le moule (clef en or), rideau | `EMAJ1002` |
| Laboratoire | clef en or sur le cadenas, demi-statuette, trappe | `EMAJ1003` |
| Précipice `EMAJ1003` | tibia, flambeau, planches, chaudron sur le foyer, saindoux dans le chaudron, flambeau sur le foyer (huile), chaudron, porte derrière les planches | `EMAJ1004` |
| Salle du crâne `EMAJ1004` | corde, corde sur les planches (planches liées), chaudron sur l'écuelle (huile), bague sur le chaudron (redevient boule), boule dans l'orbite (la bouche s'ouvre), pierre de lune (gros plan), tibia dans l'orifice, écuelle sur le tibia, levier, boule, sortie | `EMAJ1003` |
| Précipice | planches liées sur la pierre surgie, stèle | `PONTFX`, `EMAJ1005` |
| Stèle `EMAJ1005` | flambeau sur le porte-flamme, crâne, pierre de soleil (gros plan), tibia, lance, tibia sur la lance, sur le rideau puis sur les mûres, flûte (Urm), mûres à Urm, Urm vers le trou (clef), clef dans la serrure, porte | `EMAJ1006` |
| Salle de l'épée `EMAJ1006` | épée scellée (4 messages), crochet, épée sur la statue, trappe, chaudron (boule + bague) sur l'acide ×3, mécanisme : élixir puis effigie, sortie | `EMAJ1005` |
| Stèle | Borgol (messages), gros plan de la stèle, pierres de soleil puis de lune dans la niche de gauche, acide puis effigie dans la niche de droite | `SABLE.TOT` (premier grain), `EMAJ1007` |

### Chapitre 2

| Écran | Gestes | Résultat |
| --- | --- | --- |
| Pont `EMAJ1007` | coffre (gros plan), corniche (le monstre et une plume), plume, plume sur le coffre, parchemin (2 messages), venin, pollen, venin et pollen dans le chaudron (croissance), fermer le coffre, chaudron sur les feuilles (fraisier), fraises (gros plan), Urm et les fraises (or), or sur la demi-statuette (statuette entière), statuette sur l'eau | `EMAJ1011` (Urm emporte l'élixir) |
| Sous l'eau `EMAJ1011` | escalier ×2 (insecte), insecte (3 messages), insecte sur les algues (le poisson électrique est mangé), verre sur le poisson (barre d'airain), escalier (fissure), barre dans la fissure (les pics se coincent), barre sur le petit trou, escalier, algues, arêtes (pointe de harpon), pointe sur la barre (harpon), algues, harpon sur le poisson, harpon et poisson sur les pics (le Wurk les arrache), sortie | `OPAL1FX`, `EMAJ1012` |
| Entrée du temple `EMAJ1012` | venin sur le serpent, flambeau sur les ronces, diadème, bague sur le chaudron (boule), diadème sur la boule (tuyau), tuyau sur le piège (il tombe), piège, piège sur les guêpes, porte | `DRAGFX` (`ok!`), `EMAJ1013` |
| Dragon `EMAJ1013` | parchemin du bas ×5 (le dragon devient guêpe), piège sur la guêpe, cerises, Urm et les cerises, Urm sur le piège, sortie | `SABLE` (deuxième grain), `EMAJ1014` |
| Labyrinthe `EMAJ1014` | Borgol, tablette près de l'inscription (sinon Urm la reprend plus loin), mécanisme de gauche : arc, chèvre, chaudron, rôti, levier (crâne), porte | `EMAJ1017` |
| `EMAJ1017` | mécanisme, fiole, code (cherché touche par touche), levier, porte | `EMAJ1019` (Gardienne) |

### Chapitre 3

| Écran | Gestes | Résultat |
| --- | --- | --- |
| Gardienne `EMAJ1019` | Gardienne (3 messages) ; gargouille sur la cimaise, écu, marteau, tas de bois sur le foyer, fiole dans l'enclave ; fontaine (gros plan), lichen, lichen sur le foyer ; dents 12, 4, 6, 3 (loupe et eau) ; feuilles, marteau sur le bras (amphore), amphore sur le foyer ; chiffon mouillé à la fontaine, sur la tête (gros plan), sur un œil (deux quartz) ; pollen sur un œil (fleur), venin sur l'autre (serpent) ; tuyau sur le serpent (serpentin, temps limité), fleur sur le foyer, serpentin sur les gargouilles ; pierre (faisceau) ; feuilles sur le foyer, chiffon mouillé sur le serpentin, loupe sur le faisceau : philtre dans l'enclave ; philtre sur la Gardienne ; serpentin (tuyau et troisième grain) ; diadème sur le tuyau (boule), boule sur la statue, puis reprise : porte du sanctuaire | `SABLE`, `JP3FX`, `EMAJ1020` |
| Sanctuaire `EMAJ1020` | collier, gant, coffre (mygales), gant sur les mygales puis sur le cœur, cœur dans l'emplacement, calice sur la balance, nez, tentures, potiche (clef), miroirs, passage, miroirs dans la fente, clef dans la serrure, porte | `OPALEFX`, `EMAJ1021` |
| Couloirs `EMAJ1021` | porte de gauche | `EMAJ1022` |
| Statue de Kor `EMAJ1022` | dialogue ; collier sur la boule (épée), épée dans l'orifice (éclair), éclair, épée, éclair sur le trou du puits (coffre), filet, cerclage, sortie | `EMAJ1025` |
| Rivière `EMAJ1025` | grillage, filet sur la rivière (poisson), poisson dans le piège, grillage sur le cerclage (tamis), tamis sur la rivière (pépites), piège (crabe), retour | `EMAJ1022` |
| Statue de Kor | crabe sur le coffre (chaîne), épée sur le coffre (clef), clef dans la serrure (soleil), pépites, éclair et soleil sur le socle | `EMAJ1024` (Uki et Orbi : havresac volé) |

Écarts : le troisième grain de sable vient de la Gardienne. La porte de droite des couloirs (cour et reine, Sierra Help) n'est pas nécessaire : l'offrande à Kor mène au chapitre 4.

Écarts (chapitre 2) : la solution 2 du pont (sous l'eau) a été prise pour passer par `EMAJ1011`, et `EMAJ1009` n'est pas visité. Le deuxième grain de sable vient après le dragon, pas après la Gardienne. Le code de la 2e porte dépend de VAR(213), tirée au hasard à l'entrée d'`EMAJ1014`. Sur la partie d'une traite, il vaut 1, 3, 4, 2 (touches de gauche à droite, puis de haut en bas). Après une reprise, l'aléa change : par exemple 1, 3, 4. VAR(210) suit l'avancement du code (5 = erreur, 4 = code complet) et le levier la remet à zéro : c'est donc une variable de salle, comme le dit le banc. L'action `code` du pilote (`solveCode`) trouve le code en lisant VAR(210). VAR(212) reste à 0 à l'entrée d'`EMAJ1011` et d'`EMAJ1014`.

## Comparaison au banc

Les outils sont dans `test/ween/solution/bench/` :

- `make-reference.test.ts` joue la solution au portage. Il écrit les entrées `GOB_INPUT`, le `VH` de chaque image, les TOT et les points de contrôle.
- `full.sh` rejoue les entrées au banc avec `GOB_DUMP` sur toute la partie. Le flux est filtré par `vhfilter.mjs` (`VH` masqué, sans gros fichier). Il faut `SCUMMVM` (binaire patché) et `WEEN_GAME_DIR` (dossier du jeu), via `scripts/ween/bench/ween-replay.sh` (configuration privée par lancement), un seul ScummVM à la fois.
- `compare.mjs` donne la première image divergente. Si tout est identique, il écrit `fixtures/full-game.json` : entrées, TOT, et image + `VH` + libellé de chaque étape.
- `ref.sh DOSSIER` enchaîne les trois (environ 25 s pour le chapitre 1).

Pour trouver une divergence : vider les variables du banc à l'image fautive (`GOB_DUMP=n-n`) et celles du portage (sonde de `play`), puis comparer.

État : 141 chargements de TOT identiques, `VH` identique sur les 48 357 images de la partie complète, et les 642 points de contrôle de la fixture. Le scénario `ween-replay.txt` du banc quitte après 600 s de jeu (environ 12 000 images) : `full.sh` écrit son propre scénario d'attente (3 600 s au plus, donné par `ref.sh`).

## Écarts avec les soluces, constats

- **Correctif du moteur commun** (`src/engine/coktel/video/player.ts`, `interpreter.ts`, `game.ts`, `host.ts`). Pendant une vidéo IMD qu'on peut interrompre, ScummVM relit la souris (`Util::getMouseState`, `videoplayer.cpp:891-895`) avant `storeKey`. Le portage gardait l'ancienne position dans VAR(2) et VAR(3). La divergence a été trouvée à l'image 7 490, pendant la vidéo de `SABLE.TOT`. Ajout de `VmContext.getMouseState()`, aussi utilisé par `checkKeys`. Lost in Time reste vert.
- **Correctif du moteur commun** (`src/engine/coktel/audio/sound.ts`, `SoundDesc.length` et `fadeOutLength`). `calcLength` et `calcFadeOutLength` (`sounddesc.cpp`) calculent en uint32 : la fréquence, en int16, est convertie en non signé. Ween joue un son avec une fréquence de -5 (`EMAJ1012`, flambeau sur les ronces) : la durée vaut 0 et le son s'arrête aussitôt. Le portage divisait en signé (durée énorme, VAR(1) restait à 1). Divergence trouvée à l'image 11 189.
- Salle de l'épée : il faut cliquer le crochet derrière l'épée, prendre l'épée et l'utiliser sur la statue (« levier »). Elle reprend sa place une fois rangée.
- Le chaudron vide l'acide en un seul usage (les deux suivants sont sans effet visible) et garde de l'acide.
- Mécanisme : les touches sont des interrupteurs (soleil et lune enfoncés au départ) et la couronne valide :
  - soleil et lune relevés, couronne : élixir ;
  - épée et lune enfoncées, couronne : effigie.

  La cache se rouvre en cliquant au centre (192,73) : la zone du haut referme le gros plan.
- Stèle : on pose la pierre de soleil, puis la pierre de lune, dans la niche de gauche. L'acide du chaudron va sur la niche de droite (« stalactites »), puis l'effigie : c'est le premier grain de sable (`SABLE.TOT`), puis le pont `EMAJ1007`.

- Le chaudron se fait seul : Uki et Orbi assemblent bague et boule au retour du laboratoire.
- Pour retrouver la boule (orbite du crâne), il faut utiliser la bague sur le chaudron, une fois l'huile versée dans l'écuelle.
- Le levier n'a d'effet qu'avec la boule laissée dans l'orbite : on la reprend après.
- Les planches liées se posent sur la pierre surgie du précipice, pas sur le précipice lui-même.
- Les mûres sont trop hautes : il faut le tibia et la lance une seconde fois.
- Urm, « pas assez bon », agit quand même : il faut cliquer deux fois sur le trou, car le premier clic ferme son message.
- **VAR(212)** : c'est une variable de salle, remise à 0 à l'entrée des salles qui s'en servent. À la plage (`EMAJ1026`), elle passe à 1 quand on clique la mer ou qu'on y jette le filet (« Cette mer est vraiment poissonneuse ! ») : la mer devient alors « Poissons ». Elle sert aussi de compteur pour les lettres du Revuss (`EMAJ1036`, voir plus bas). Les salles du labyrinthe qui la lisent (`EMAJ1015`, `1016`) restent hors du chemin joué.
- **EMAJ1010** (640 × 200) est visitée : c'est la traversée de l'eau entre le pont (`EMAJ1007`, statuette sur l'eau) et `EMAJ1011`. Ses images sont comprises dans la comparaison au banc (`VH` identiques).
- **EMAJ1008** (320 × 465, défilement vertical) n'est pas sur le chemin joué. On n'y arrive que par l'autre solution du pont (le sbire de KRAAL, puis `EMAJ1008`, `EMAJ1009` et `OPAL1FX`). Ce n'est pas un détour : elle remplace `EMAJ1010` et `EMAJ1011`. Elle n'est donc pas comparée au banc.

### Chapitre 4

| Écran | Gestes | Résultat |
| --- | --- | --- |
| Escalier `EMAJ1024` | sans havresac, on tient un objet à la fois (le clic droit le repose). Écuelle sur la résine, résine sur la fleur ; corne sur le bout de bois, liane (pioche), pioche sous le rocher (source) ; pot sur la source, eau sur les petits champignons (champignons géants, une pierre) ; œil du crâne (le ver ne sort pas) ; **attente** : le moustique se prend dans la résine (« Bzzzz ! »), puis l'oiseau vient le manger ; pierre sur l'oiseau ; œil du crâne (le ver sort), ver sur les champignons géants, escalier | `EMAJ1026` |
| Plage `EMAJ1026` | monstre (Uki et Orbi reconnaissent le voleur) ; fraisier (gros plan), fraises tenues puis reposées ; flûte trouvée sur la plage, flûte sur WEEN (Urm), fraises à Urm (or) ; or au monstre (havresac) ; rame dans l'encoche ; filet sur la mer (poisson) ; collier sur la boule (épée), épée sur le poisson (œufs) ; œufs à l'araignée (voile) ; épée sur le bambou, bambou sur le bateau (mât), voile sur le mât ; marteau sur les arceaux, arceaux sur le bateau ; noix de coco sur les nasses ; collier sur l'épée (boule), diadème sur la boule (tuyau) ; nasses sur les arceaux : départ | `EMAJ1027` |
| Bateau `EMAJ1027` | marteau sur le cadenas, soute (goudron), tuyau sur la bouteille (bouchon), goudron sur le bouchon, bouchon englué dans le trou, marteau sur le bouchon (le marteau se brise) | `EMAJ1028` |

### Chapitre 5

| Écran | Gestes | Résultat |
| --- | --- | --- |
| Plage de l'île `EMAJ1028` | clef dans la serrure de la cabane | `EMAJ1029` |
| Cabane `EMAJ1029` | pelle, sortie | `EMAJ1028` |
| Plage | pelle sur les huit tas de sable (la pelle casse) ; dans chaque trou (gros plan) : œil, lingot, arêtes, diamant, sandale, bijoux ; diadème sur le tuyau (boule), collier sur la boule (épée), épée sur l'huître (perle) | `EMAJ1029` |
| Cabane | fraises tenues puis reposées, flûte (Urm), fraises à Urm (or) ; or, œil, arêtes, diamant, sandale, bijoux, perle, lingot et écu au vieillard (« enfin comblé ») ; anneau (planches), épée sur les planches, ouverture | `EMAJ1030` |
| Jungle `EMAJ1030` | épée sur les branches (flèches) ; collier sur l'épée, bague sur la boule (chaudron), chaudron dans un trou, l'autre trou (Orivor) ; pendule ; chaudron repris, épée refaite, épée sur l'herbe où le pendule s'agite (or) ; or à l'Orivor (corde), corde sur la branche (arc) ; arc sur la noix (un oiseau perd ses plumes) ; tuyau sur les plumes, plumes sur les flèches, arc sur la noix (elle tombe), épée sur la noix (fée Nature) | `EMAJ1031` |
| Entrée du volcan `EMAJ1031` | canne sur l'œil de verre (vieillard) ; fraises, Urm, or au vieillard (il ment) ; canne sur l'œil, myrtilles à Urm, Urm sur le vieillard (pétrifié, la porte s'ouvre) ; plume sur le coffre (fioles de pollen et de venin) ; chaudron : pollen + venin (potion de croissance) sur les champignons (truffes), puis sur l'herbe (camomille) ; venin + truffe (luciferys) sur le rubis (foyer) ; chaudron sur l'eau, sur le foyer, camomille (infusion), infusion sur le ver, ver sur les champignons, porte | `EMAJ1032` |
| Porte cachée `EMAJ1032` | épée sur le buisson (porte), pollen sur le quartz (fleur), pistil ; truffe + pollen (vitalys) sur Borgol ; attente de la fourmi (zone cachée tant que son animation n'est pas finie), fourmi, pistil à la fourmi | `EMAJ1033` |
| Fourmilière `EMAJ1033` | deux grains de sable, axe, troisième grain sous l'axe | `EMAJ1032` |
| Porte cachée, entrée | vitalys sur la statue (levier) ; à droite : mécanisme, axe dans l'orifice, levier, clef ; à gauche : clef dans la serrure ; pollen + venin + truffe (morphosys) sur la grille ; venin sur les serpents ; luciferys sur les rubis ; eau du chaudron sur les flammes, porte | `EMAJ1034` |
| Intérieur du volcan `EMAJ1034` | écuelle ; épée sur l'ornement de la statue, puis quatre fois sur le trou ; luciferys sur le rubis (bijou) ; niche de droite ×4 (glu), écuelle sur la glu ; **lucioles** : vitalys sur le bijou (la luciole s'envole), épée sur la fissure (la lave se fige, la luciole s'y pose), glu sur la luciole, luciole engluée dans une niche éteinte. Bijou suivant : boule dans le trou de la 2e niche ; brindille de la 1re niche dans l'orifice de la statue ; bijou brisé (3e niche) + glu + bijou cassé. **Leviers** des cinq niches : compteurs VAR(222) = 1, VAR(224) = 2, VAR(225) = 3, VAR(226) = 4, VAR(223) = 5 ; les lettres s'allument, arc sur K, R, A, A, L (zones 56, 60, 50, 64, 54) | `KRAALFX`, `EMAJ1035` |

### Chapitre 6

| Écran | Gestes | Résultat |
| --- | --- | --- |
| Prison `EMAJ1035` | cœur ; clou (gros plan, quatre clics) ; serrure : clou dans le 6e trou du cadran de droite (en partant du haut, sens horaire), aiguille de droite (un barreau se lève), épingle ; clou au 7e trou de droite, épingle au 3e de gauche, les deux aiguilles, sortie | `EMAJ1036` |
| Revuss `EMAJ1036` | leviers de droite, du centre puis de gauche, quatre fois chacun (VAR(213) = 12), fermer ; gravure : D, J, E, L ; niche : cœur dans l'orifice, couteau ; bambou, couteau sur le bambou (flûte), couteau sur la flûte (accordée), flûte sur WEEN (Urm laisse une pierre) ; pierre (gros plan) dans le trou de la gravure ; A, Z, E, U, L, I, S, S, E ; statue de la niche de droite dans la niche ; trois grains de sable, grains dans le Revuss | `GAGNEFX`, `EMAJ1END` |

Constats des chapitres 4 à 6 :
- **Ancien blocage de l'escalier** (`EMAJ1024`) : il ne manquait pas de geste, seulement du temps. Le moustique et l'oiseau sont pilotés par VAR(215), incrémentée par la zone de délai du bloc de zones (fonction 2928) : une fois par délai d'attente sans clic. L'eau sur les champignons met VAR(216) à 1 et VAR(215) à 98. À 100, le moustique arrive ; il se prend dans la résine (fleur, état 3), puis l'oiseau vient (état 4, puis 5 : « Oiseau »). Le moustique se prend environ 480 images après l'eau ; la solution attend 1 500 images, l'oiseau est alors posé. Les zones `0x8009` et `0x8013` notées avant étaient la corne et le ver : l'oiseau prend la place de la fleur (zone `0x800a`).
- Sans havresac, un objet pris est seulement tenu : les fraises comptent pour Urm dès qu'on les a tenues (indicateur de l'objet 0), même reposées.
- Les mélanges d'objets dépendent de la salle (`switch V191` de chaque TOT) : par exemple épée + collier donne la boule, boule + diadème le tuyau, boule + bague le chaudron. Le chaudron garde sa potion sous le nom « CHAUDRON » dans la liste.
- Dans la liste, un mélange suivi d'une animation longue (lucioles, flûte accordée) demande une attente avant le clic droit, sinon il est perdu.
- Les gros plans des trous de la plage, des bijoux et de la pierre du Revuss s'ouvrent au premier clic. L'objet se prend par un second clic dans le gros plan.

## Suite

Rien n'est bloqué : la partie est complète et identique au banc.

Restent à observer, hors du chemin joué :
- `EMAJ1008` et `EMAJ1009` (autre solution du pont) ;
- les salles du labyrinthe `EMAJ1015`, `1016` et `1018` (VAR(212)) ;
- la porte de droite des couloirs (`EMAJ1023`).
