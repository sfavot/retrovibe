# Gabriel Knight : journal de validation (vague K)

Parcours sans tête du jeu, joué par le moteur sur les scripts d'origine. Ce document dit ce qui est couvert, les bogues
trouvés, ce qui reste à vérifier à l'œil ou à l'oreille, et ce qu'un test ne peut pas atteindre.

## Lancer

- `npm test` : l'essai court tourne toujours (du titre à la librairie, le journal, le menu de Grace, une reprise ; 3 s).
- `PLAY=1 npx vitest run test/gk1/play` : le parcours complet, du bouton JOUER au générique de fin, puis les variantes.
  `playthrough.test.ts` joue les dix jours à la suite dans un seul processus, un test par jour : chaque jour continue la
  partie laissée par le précédent et n'est donc calculé qu'une fois ; les variantes (morts, seconde fin, correctifs
  comparés) repartent d'images gardées en mémoire pendant le parcours (`stageImages` de `walkthrough.ts`). `smoke.test.ts`
  (l'essai court et « texte et voix ») tourne à côté. **3 min 15 en tout** (207 s de calcul, contre 863 s quand chaque
  jour rejouait les précédents) : 158 s pour les dix jours, 37 s pour les variantes, dont 21 pour celle du livre des
  tambours, qui rejoue la fin du jour 3 et le jour 4. La configuration de vitest n'est pas touchée. Un jour qui échoue
  arrête les suivants (« le jour N n'a pas abouti »).
- `PLAY=1 PLAY_CHECKPOINTS=<dossier> npx vitest run test/gk1/play` : écrit en plus un point de reprise par étape
  (`<dossier>/<étape>.json`, une image de sauvegarde du moteur).
- `PLAY=1 PLAY_CHECKPOINTS=<dossier> PLAY_FROM=j10-matin npx vitest run test/gk1/play` : repart d'une étape. Les jours
  d'avant ne sont pas joués, leurs variantes non plus ; les variantes restantes lisent leur image dans le dossier
  (30 s depuis `j9-coeur`). Les points de reprise sont à récrire quand le format des sauvegardes change (`SAVE_VERSION`).
- `PLAY_DUMP=<dossier>` : en cas d'échec, l'image de l'écran est écrite en PPM (`echec-<pièce>-<image>.ppm`).

## Le banc (`test/gk1/play/`)

`harness.ts` (classe `Play`), `walkthrough.ts` (étapes et points de reprise), `day1.ts` à `day10.ts` (les étapes),
`playthrough.test.ts` (le parcours et ses variantes) et `smoke.test.ts`. `Play.playToEnd` joue jusqu'à l'arrêt du jeu (fin du générique). Une partie est reproductible : horloge du jeu, graine de `Random` (1993 par défaut), aucune attente réelle. Les
cinématiques `SEQ` sont jouées depuis `original/gk1/SEQ` ; les voix ne le sont pas (voir « Hors de portée »).

| Action | Rôle |
| --- | --- |
| `Play.boot()`, `Play.resume(image)`, `checkpoint()`, `canCheckpoint()` | partie neuve, reprise, point de reprise |
| `startGame()` | du titre à la première pièce (bouton JOUER, ouverture) |
| `step(n)`, `waitUntil(cond, max, quoi)`, `playUntil(cond, max, quoi)` | avancer ; `playUntil` ferme les textes en route |
| `skipText(max, jusqu'à)` | fermer les textes et laisser finir la scène, jusqu'à ce que le joueur ait la main |
| `room()`, `day()`, `score()`, `flag(n)`, `global(i)`, `prop`/`num(objet, nom)` | lire l'état du jeu |
| `objects()`, `object(nom)`, `present(nom)`, `objectAt(x, y)`, `pointOn(nom)` | objets de la pièce et point où cliquer |
| `selectVerb(verbe)`, `use(verbe, nom)`, `walkTo(x, y)`, `leave(sortie)` | curseurs (bouton droit), verbe sur un objet, marche, sortie |
| `inventory(objet, action)`, `useItem(objet, cible)`, `carried()`, `closeInset()` | inventaire par la barre d'icônes, gros plans |
| `combine(objet, sur)` | dans la fenêtre de l'inventaire, un objet posé sur un autre (la loupe sur une écaille) |
| `local(script, i)` | variable locale d'un script chargé (direction du traqueur au bayou) |
| `Play.boot({ fixes })`, `Play.resume(image, { fixes })` | jouer avec d'autres correctifs de scripts, pour comparer une scène avec et sans l'un d'eux |
| `menu()`, `talkTopic(libellé)` | menus d'interrogatoire et boutons des fenêtres |
| `travel(destination)` | cartes (pièces 200 et 205) |
| `texts()`, `item(nom)`, `clickItem(nom)`, `click(x, y)`, `point(x, y)`, `key(code)` | bas niveau |
| `describe()`, `dump(dossier, nom)`, `fail(message)` | diagnostic : pièce, image, textes, pile, derniers appels du noyau |

`pointOn` cherche dans le rectangle (ou le polygone) de l'objet le point le plus proche du centre où `User::handleEvent`
le choisirait : parmi les objets sous le pointeur, celui dont `y` est le plus grand (`OnMeAndLowY`, script 64996).

Ce que le banc a appris de l'interface (lu dans les scripts) :

- verbes des curseurs : marcher 13, regarder 7, interroger 10, parler 11, prendre 12, ouvrir 6, actionner 8, déplacer 9 ;
  loupe 4 et pince 3 dans l'inventaire ;
- le pointeur à la ligne 31 de l'écran ou au-dessus ouvre la barre d'icônes, et la barre ouverte suspend le jeu : le banc
  range le pointeur au milieu de la pièce après un clic dans un menu ;
- une sortie (`ExitFeature`, script 21) n'est qu'un curseur : c'est le bord de la pièce qui fait sortir (`GKEgo::doit` :
  `x ≤ 0`, `x ≥ 319`, `y ≥ 141`, `y ≤ horizon`). `ExitFeature::handleEvent` n'est appelé par personne ;
- une réplique à l'écran retient le jeu (`User::handleEvent` boucle sur la liste des talkers) : on la ferme avant d'agir ;
- un clic met jusqu'à 25 images à lancer sa scène : le banc attend 40 images calmes avant de tenir une action pour finie ;
- Gabriel qui marche vers l'objet d'un clic garde la main, et la scène ne commence qu'à son arrivée : `use` et `useItem`
  attendent aussi son arrêt (`skipText(…, still)`) ;
- un passant sur le chemin arrête Gabriel au square (son mouvement finit, la main lui reste) : `leave` reclique la sortie
  après 90 images d'arrêt, six fois au plus ;
- un gros plan peut suivre le pointeur sans clic (thermostat du commissariat, script 235 : il s'ouvre aiguille en main,
  l'angle du pointeur autour de (174, 110) donne le cel ; un clic la lâche) : `point(x, y)` ;
- les touches du téléphone de Gabriel (script 221) sont des zones du gros plan, pas des objets : le banc clique leurs
  coordonnées (`PHONE_KEYS` de `day3.ts`), MARCHE d'abord ;
- chaque porte a ses verbes, lus dans son `doVerb` : « actionner » (8) le plus souvent, mais « marcher » (13) seulement
  pour la porte du musée du vaudou, celle du bureau de Hartridge (un clic pour se lever, un second pour sortir), la sortie
  du salon de Madame Cazaunoux ; « ouvrir » (6) ou « actionner » pour celles de l'amphithéâtre et du bar Napoléon ;
- une carte ne rend pas toujours la main (`inControl`) : après une porte qui y mène, n'attendre que la pièce
  (`through` de `day3.ts`), puis `travel` ;
- une scène qui ouvre un menu de répliques (le boniment de l'huile, Bruno) ne rend pas la main : `useItem(…, { settle:
  false })` puis attendre `menu()` ; les boutons se choisissent avec `talkTopic` ;
- les rectangles `ns…` d'un objet sont en coordonnées de la pièce, dix lignes sous le haut de l'écran : un clic calculé
  à la main ajoute 10 à `y` (les passages du bayou, la grille de l'éditeur de la tombe) ;
- un personnage sorti de la pièce reste dans la distribution, hors champ (le gardien du cimetière en `x = 360`) : tester
  sa position ou son script, pas `present` ;
- l'écran de la mort (pièce 770) a trois boutons sans texte : RETABLIR (87), QUITTER (110), RECOMMENCER (111, à droite),
  qui relance le jeu à l'écran-titre (pièce 93), il ne rejoue pas la scène ;
- les scènes à barre d'icônes propre (livre des tambours, éditeur de la tombe) : le pointeur en haut de l'écran l'ouvre,
  ses icônes ont un nom (`exitIcon`, `codeIcon1` « message suivant », `codeIcon2` « sortie ») ;
- deux objets se combinent dans la fenêtre de l'inventaire : « sélectionner », le premier, puis un clic sur le second ;
- dans le noir du tombeau des Gedde (script 325) il n'y a pas d'objets nommés : la lampe de poche est le curseur
  (verbe 129), un clic déplace son faisceau (`torch`, borné à (55, 22)-(265, 145)), et les autres verbes s'appliquent à ce
  que le faisceau éclaire ; un clic à la ligne 31 ou au-dessus ouvrirait la barre d'icônes ;
- les touches du téléphone servent aussi à l'agence de voyage (585-1130, quatrième numéro de `dialThePhone::init`,
  script 221) : le numéro n'est donné par aucun texte du jeu (annuaire de la boîte, sans doute) ;
- un sujet d'interrogatoire en ouvre un autre quand on le repose (`cue` du personnage : « Talisman » deux fois chez
  Wolfgang) ou quand un drapeau du jeu est posé (regarder un panneau de la chapelle ouvre « Les Panneaux de la
  Chapelle » chez Gerde) ;
- l'état d'un casse-tête se lit dans les variables locales de son script (`local`) : au mont serpenté (script 710), la
  salle courante (locale 0), la salle de chaque pierre et « au mur » (locales 21 + 2k et 22 + 2k), « momies réveillées »
  (locale 3). Les acteurs `aTile`, `secondTile`, `thirdTile` gardent le cel de la salle précédente quand ils sont
  cachés : choisir la pierre par ces variables, pas par les acteurs présents ;
- `pointOn("exitNorth")` vise le milieu de la sortie : dans la salle 5 du mont, momies réveillées, ce chemin passe sur
  le garde. Le banc clique alors dans le rectangle de sortie du côté libre ((88, 107) ; ajustement du banc seulement).

## Étapes couvertes

Jour 1, du bouton JOUER au matin du jour 2 (score 25 sur 342, 31 424 images du jeu, soit près de neuf minutes de jeu) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j1-titre` | JOUER, carton, rêve, dialogue d'ouverture | 0 |
| `j1-librairie` | journal, loupe, pince ; Grace : « Messages » puis trois « Autres messages » | 7 |
| `j1-commissariat` | sergent Frick : « Détective Mosely », « Photographies », « Lieu du crime » ; l'enveloppe | 10 |
| `j1-square` | square Jackson sud-est → sud-ouest → nord-ouest ; le mime suit Gabriel | 10 |
| `j1-radio` | retour avec le mime, le motard le poursuit, la radio de la moto | 17 |
| `j1-lac` | scène du lac (Mosely, Malia), enveloppe ouverte, loupe sur l'herbe, pince sur l'écaille, argile | 22 |
| `j1-soir` | Grace : « Demande de recherche », « Enquêtez sur Malia Gedde. » ; fermeture, nuit, carton, matin | 25 |

Jour 2, du matin au matin du jour 3 (score 61) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j2-matin` | journal du 19 juin, maison de la grand-mère, grenier, carnet de croquis | 27 |
| `j2-lac` | le carnet sur le motif du sable : croquis du motif du lac | 29 |
| `j2-commissariat` | sergent, Mosely (« Schémas autour de corps », « Six autres modèles »), dossier de Franks, sa corbeille, photo, « vérifier ma coiffure », thermostat, photocopie, chaleur, « Café », insigne | 45 |
| `j2-pharmacie` | scène de Madame Cazaunoux à la pharmacie ; librairie : bon de la caisse (curseur « ouvrir »), Grace : « Enquétez sur Madame Cazaunoux. » | 48 |
| `j2-square` | bon contre hot-dog, hot-dog au petit danseur, dessin envolé (deuxième entrée au nord-est), le danseur le rapporte, l'artiste reçoit dessin, croquis et photocopie | 55 |
| `j2-gedde` | heurtoir, majordome, insigne, Malia : « Vaudouisme », « Le Lac Pontchartrain », « Flirter avec elle » (démasqué) | 60 |
| `j2-soir` | sortie du manoir : la carte finit la journée et passe d'elle-même à la nuit ; café du matin | 61 |

Jour 3, du matin au matin du jour 4 (score 107) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j3-matin` | journal du 20 juin, Grace : « Messages », « Autres messages », « Numéro de téléphone de Ritter » ; studio : gel, téléphone (555-1280 Madame Cazaunoux, 555-6170 la clinique : « Castro ») | 67 |
| `j3-cathedrale` | sacristie : chemise et col (déguisement) ; square nord-ouest (Lorelei danse), nord-est : l'artiste remet le motif reconstitué | 70 |
| `j3-musee` | docteur John : « Vaudouisme », « Le Vaudouisme actuel » (Magentia Moonbeam), « L'histoire du Vaudouisme », « Marie Laveau » (le cimetière arrive sur la carte) | 76 |
| `j3-tulane` | pharmacie : la photo du meurtre à Willy ; Tulane : la conférence, le motif à Hartridge, « Cabrit Sans Cor' » | 83 |
| `j3-tableau` | Willy : « Des Masques d'animaux », « Willy Jr. » (cent dollars) ; Bruno achète le tableau ; le masque de crocodile et l'huile offerte | 89 |
| `j3-cazaunoux` | le Père Maclaughlin, « bouc sans corne », « Sacrifice humain », « Les véritables Reines Vaudous », « Lieu de culte Vaudou », le bracelet, l'argile : le moule | 97 |
| `j3-napoleon` | le barman (« Le Vaudouisme », « Des barmans » deux fois), le boniment de l'huile, Sam bat Markus et prend le moule | 101 |
| `j3-commissariat` | l'interrogatoire filmé interrompu, Mosely reprend son insigne | 103 |
| `j3-cimetiere` | signes de la tombe de Marie Laveau copiés au carnet, Malia au tombeau des Gedde ; librairie fermée, nuit, matin du jour 4 | 107 |

Jour 4, du matin au matin du jour 5 (score 140) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j4-matin` | journal du 21 juin ; grenier : l'horloge (cadran au dragon, trois heures, la clé), le tiroir secret, la photo et la lettre, lue ; la grand-mère : « Heinz Ritter » | 118 |
| `j4-ritter` | studio : l'appel à Schloss Ritter (49-09324-3333) | 120 |
| `j4-crash` | belvédère : Crash et le joueur de tambour aux jumelles ; bar Napoléon : la copie du bracelet ; cathédrale : le bracelet à Crash, « Joueur de tambour », « Le lieu de culte Vaudou. » (il meurt), le tatouage décalqué | 130 |
| `j4-moonbeam` | Magentia Moonbeam traduit les signes ; Grace : recherches sur le motif et sur les tambours Rada ; le colis de Wolfgang et le livre des tambours ; nuit, matin du jour 5 | 140 |

Jour 5, du matin au matin du jour 6 (score 158) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j5-matin` | journal du 22 juin ; film de la moto ; musée du vaudou dans le noir : le python étrangle Gabriel, le ventilateur le fait lâcher | 146 |
| `j5-ecailles` | librairie : Grace trouve l'écaille, la pince la prend au cendrier ; la loupe sur les deux écailles : réunies | 150 |
| `j5-hartridge` | Tulane : Hartridge mort à son bureau, ses notes | 152 |
| `j5-mosely` | Mosely : « Réouvre le cas », la coupure de 1810, les notes, les deux écailles, le motif : il rouvre l'enquête ; nuit, matin du jour 6 | 158 |

Jour 6, du matin au réveil du jour 7 (score 195) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j6-matin` | journal du 23 juin ; l'enveloppe sous la porte, la clé et la note de Mosely ; Grace peint le tatouage (deux réponses) | 165 |
| `j6-beignets` | le vendeur de beignets renvoyé à Royal et Conti (cinq répliques) ; commissariat déserté : portillon, clé, tiroir (traqueur, deux émetteurs) ; le sergent chasse Gabriel | 170 |
| `j6-tambours` | place Jackson nord-est : le livre des tambours, trois phrases (« réunir assemblée secrète », « ce soir », « marécage ») ; musée : l'émetteur dans le petit cercueil | 178 |
| `j6-tombe` | cimetière : second message copié, brique, messages comparés, départ du gardien, « DJ APPORTE SEKE MADOULE » écrit signe à signe | 188 |
| `j6-bayou` | bayou : traqueur, une dizaine d'écrans suivis au point, masque de crocodile, « Damballah », « Ogoun Badagris », le rituel ; réveil du jour 7 au studio | 195 |

Jour 7, du réveil dans le studio au réveil du jour 8 à Schloss Ritter (score 226) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j7-matin` | lampe de poche ; Wolfgang au téléphone : « Tetelo », « Talisman » deux fois, « La dépouille de Tetelo », « Le pays natal en Afrique » ; journal du 24 juin | 200 |
| `j7-tombe` | cimetière : la plaque soulevée du tombeau des Gedde, la manette ; dans le noir, la lampe ; le casier au vévé : Mosely, Gabriel assommé ; le portefeuille et la carte de crédit | 208 |
| `j7-billet` | Grace inquiète ; l'agence de voyage (585-1130), le billet pour Munich payé avec la carte de Mosely ; l'aéroport, le vol, Gerde à la porte du château | 213 |
| `j7-chateau` | un panneau de la chapelle, Gerde (« Les Panneaux de la Chapelle », « Cérémonie d'initiation »), dague, sel ; chambre : ciseaux, pot de chambre, manuscrit, mains lavées dans la neige, cheveux coupés ; chapelle : pot sur l'autel, sel, sang, à genoux, manuscrit lu ; rêve du dragon, réveil du jour 8 | 226 |

Jour 8, de la chambre de Wolfgang au mont serpenté du Bénin (score 237) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j8-matin` | la clé du rêve, la porte de la bibliothèque ; cinq livres qui se citent l'un l'autre, jusqu'aux « Anciennes Fouilles d'Afrique » (le mont au double anneau) | 235 |
| `j8-gerde` | le livre montré à Gerde, « On peut utiliser ma carte de crédit. » ; carton du château (jour 9), vol, arrivée au mont | 237 |

Jour 9, du mont serpenté à la carte de La Nouvelle-Orléans au jour 10 (score 263) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j9-matin` | anneau extérieur, douze salles : les dix pierres gravées déplaçables remises au mur de la salle de leur nombre (un tour et demi), la tige en forme de serpent (salle 9), retour à la salle 3 | 241 |
| `j9-momies` | la tige dans la pierre aux trois serpents : panneau secret, momies ; salles 4, 5, 6 par le nord, la liane par-dessus le garde, Wolfgang en salle 7, la tige dans le trou du passage : l'anneau central | 250 |
| `j9-coeur` | la table de sacrifice lue par Wolfgang, son couvercle, les deux barres de fer ; la dague sur la momie : Wolfgang donne son cœur, le talisman ; Grace enlevée (pièce 216) ; vol du retour, carte du jour 10 | 263 |

Jour 10, de la carte au générique de fin (score 311 sur 342 ; 52 étapes en tout) :

| Étape | Contenu | Score |
| --- | --- | --- |
| `j10-matin` | librairie vide, la note de Malia ; Mosely dans le studio (portefeuille et carte rendus), « Fais un plan », le traqueur | 266 |
| `j10-cathedrale` | confessionnal de droite, la tige dans le creux : l'ascenseur ; l'émetteur et la tige sous le coussin pour Mosely ; salle 806 | 271 |
| `j10-hounfour` | couloir rond : annuaire noir (salle 804), Malia et Tetelo (803), robes et masques (807), table du rituel, tambours : « LE FRERE AIGLE » | 280 |
| `j10-cle` | le docteur John en route : sa carte-clé (salle 802), l'argent (801), la morgue (811), retour devant la salle 808 | 285 |
| `j10-grace` | salle 808 : Grace, Mosely ; le talisman la réveille, le sanglier, le loup ; le docteur John les mène au rituel (pièce 899) | 290 |
| `j10-rituel` | le talisman sur Malia, le talisman à Mosely, l'idole renversée (bandes dessinées 891 et 892) | 301 |
| `j10-fin` | la main tendue à Malia (bande dessinée 893), épilogue avec Grace (pièce 670), score affiché « 311 » ; générique (680) jusqu'à l'arrêt du jeu | 311 |

Le jeu ne revient pas à son écran titre après le générique : `creditRm` (script 680) pose le drapeau de sortie
(`global4`), `GK::play` revient et le moteur rend « terminé » ; c'est la page qui retourne à son écran titre (`ui/loop.ts`).
Le générique dure 8 900 images sans appui ; d'après le script, un appui l'arrête aussitôt (`creditRm::handleEvent` pose le même drapeau : lu, non joué).

Variantes jouées avec `PLAY=1` (elles partent d'une image du parcours) :

- **mort au musée** (jour 5) : sans le ventilateur, le python tue Gabriel ; « Recommencer » ramène à l'écran-titre, jour 1,
  score nul, plus rien en poche (correctif du script 93) ; la partie neuve se joue comme une partie lancée à froid ;
- **livre des tambours** (script 212, `getTheVeve`) : recherche sur le motif demandée au jour 3, sur les tambours au
  jour 4. Avec le correctif, Grace remet le livre une fois au matin du jour 5 ; sans lui, le dialogue du motif repasse et
  celui du livre se répète (le défaut que décrit ScummVM) ;
- **enveloppe du jour 6** : un point avec `missingParams`, le score doublé sans (voir « Bogues ») ;
- **mort au bayou** (jour 6) : « Papa Gede? » à la première question, Gabriel est démasqué et tué ;
- **mort au mont serpenté** (jour 9) : les momies réveillées, Gabriel ne bouge pas ; elles le rattrapent en 400 images
  (`theDeathScript`, script 711), score 246, écran de la mort à trois boutons ;
- **mort au hounfour** (jour 10) : Gabriel entre chez le docteur John sans l'avoir éloigné et touche à la carte-clé
  (`sDJKillGabe`, script 802), score 271, écran de la mort à trois boutons ;
- **seconde fin** (jour 10) : au dernier moment du rituel, le joueur ne fait rien pendant quinze secondes ; Malia
  entraîne Gabriel (bande dessinée 894, drapeau 407), épilogue de Grace et Mosely (`sayDead`), score affiché « 301 »,
  générique, arrêt du jeu.

Deux vérifications transversales (avec `PLAY=1`) :

- **texte et voix** : avec les index des voix du CD et une sortie audio nulle (`Play.boot({ voices: true })`, `setVoices`),
  l'ouverture se déroule seule, sans une frappe : ses 20 répliques se ferment à la fin de leur clip (8 309 images, contre
  10 248 au temps de lecture du texte). Les lèvres et le son lui-même restent à juger à l'oreille ;
- **sauvegarde au milieu d'un jour** : de l'image prise après le grenier (jour 2), une partie reprise joue l'étape du
  lac ; son état final est identique, octet pour octet, à celui de la partie continuée (l'image d'entrée de l'étape suivante).

Les conditions de fin de chaque jour lues dans les scripts sont en tête de `day1.ts` à `day10.ts`.

### État final : le jeu est joué en entier

Le parcours va du bouton JOUER à l'arrêt du jeu après le générique, par les deux fins. **Score final 311 sur 342**
(301 pour la fin où Gabriel meurt : les 10 points de la main tendue manquent). Il n'y a plus de point de reprise à
transmettre : `PLAY_CHECKPOINTS` écrit les 51 images d'étape (la première étape part du démarrage).

Les 31 points laissés sont tous facultatifs. D'après les `getPoints` des scripts (229 envois ; ceux qui portent un
drapeau se comparent à l'état final), 22 points à drapeau ne sont pas pris :

- sujets d'interrogatoire : la grand-mère (drapeau 157, 1 point), le barman (171, 1), le gardien du cimetière (166 et
  167, 1 chacun), Magentia Moonbeam (168, 2), Gerde (184, 1) ;
- objets examinés dans l'inventaire (script 15) : la pince (196, 2), la loupe (195 et 197, 1 chacun), le journal de
  Gunter lu (199, 1), le carnet de croquis (462, 1) ; la lettre de Wolfgang lue (script 24, drapeau 198, 1) ;
- librairie : un journal (`getTheNewsPaper`, 148, 1 : le jour n'a pas été cherché), le livre allemand et le livre des serpents des
  rayons (script 212, 120 et 121, 1 chacun) ;
- ailleurs : l'écriteau du comptoir de la pharmacie (script 250, 140, 1), la danse du serpent de Magentia Moonbeam
  regardée (script 290, 169, 1), un objet montré à Hartridge (script 340, 149, 2), Lorelei (script 420, 160, 1).

Les 9 autres points sont dans des envois sans drapeau (`getPoints(-999, n)`), que l'état final ne permet pas de
distinguer : le voile de Lorelei, la mue du python, le tombeau des Gedde (pièce 325) et le second émetteur en font partie
(voir plus bas ce qui n'a pas été fait jour par jour). Au jour 10 lui-même, tout ce que les scripts 455, 800 à 812, 899
et 900 rapportent est pris, d'après leur lecture (48 points, de 263 à 311).

Ce que le jour 10 a appris au banc : dans le hounfour, le clic de marche vise dix lignes au-dessus du pointeur (comme
partout), ce qui compte ici parce que les changements de tronçon sont des rectangles au bord du sol ; la voûte d'un
tronçon pair (`hall`) recouvre le rectangle du bas à droite ; l'enseigne se regarde par `signFeat` (`doorSign` est
dessous). Les quatre moments du rituel se reconnaissent au script de Gabriel et à son état (`sPart1@40`, `sPart2@16`,
`sPart3@20`, `sPart4@28`) : le joueur a 10, 10, 10 et 15 secondes, le banc agit à la première image. La patrouille du
docteur John (`sDrJohnWalk`, 16 secondes par pas) laisse 80 secondes pour sa chambre ; le banc en met 55.

Ce qui n'a pas été fait aux jours 7 à 9 : les sujets facultatifs de Wolfgang et de Gerde (aucun ne rapporte de point
dans les essais faits), le journal du jour 10, les livres hors de la piste dans la bibliothèque, la sortie du mont par
le mauvais sens (`wrongWay`).

Ce qui n'a pas été fait aux jours 5 et 6 (points laissés ; le maximum est 342) : les notes de Hartridge et la note du
tiroir de Mosely ne sont pas lues en détail, le journal de Gunter non plus ; la danse de Lorelei et son voile (`veil`,
`fortScale`), la mue du python de Magentia Moonbeam (`snakeSkin`), le tombeau des Gedde (pièce 325), le second émetteur,
les sujets facultatifs des interrogatoires. Aux jours 3 et 4 : la plupart des sujets facultatifs ; le vendeur de beignets
du commissariat (script 231) n'est joué qu'au jour 6.

Outils du parcours (scratchpad, à refaire au besoin) : un désassemblage par script et un fichier de messages par module
(`formatScript(disassembleScript(…))`, `readMessages`), un script qui cherche où un drapeau est posé (`calle script 13,
export 1` avec `args : N` ; export 0 le lit, export 2 l'efface), et de petits scripts d'essai lancés par `npx vite-node`
qui chargent un point de reprise (`Play.resume(Play.parse(…))`), jouent quelques actions et affichent pièce, score, objets
et menu. Dans les interrogatoires (script 50) : exports 1 et 2 lisent un drapeau du jeu (absent, présent), 3 le pose ;
5 lit un sujet déjà abordé (variable globale 182), 6 le lit et le marque. Un sujet commun `t` s'affiche avec le drapeau
`36 + t` (`Interrogation::addGlobals`, script 51) ; les sujets propres à un personnage sont dans son `showCases`
(scripts 1050 à 1057), et la suite d'un sujet répété dans son `cue`.

### Scènes à correctif de script traversées (`engine.md` § 8)

Jouées par le parcours, sans incident : sorties (`ExitFeature::dispose`, script 21, à chaque pièce du square) ; entrée au
commissariat et portillon avec permission (`sGabeEnters`, `sInGateWithPermission`, script 230) ; sortie de la pharmacie
(`egoExits`, script 250) ; téléphone du studio (`rm220::init`, `useThePhone`, script 220 : Gabriel est en (107, 124)) ;
majordome des Gedde (`shutTheDoor`, script 350) ; maison de la grand-mère (`rm380::init`) ; coin nord-ouest du square au
jour 3 (loge de Lorelei, script 420 : traversé, la danse n'est pas regardée jusqu'au bout) ; narrateur (`Narrator::say`,
script 64928, partout). Jouées aux jours 3 et 4 par le parcours, sans incident : salon de Madame Cazaunoux (`rm280::init` : Gabriel entre et
s'assoit, puis le bracelet) ; pharmacie, deux sorties de plus (`egoExits`) ; téléphone du studio au jour 4 (appel à
Wolfgang) ; librairie au matin du jour 4 (script 210, `startOfDay4` du script 214).

Jouées aux jours 5 et 6, sans incident :

- **212, « téléphone du jour 5 »** : l'appel de Hartridge au matin du jour 5 se déroule jusqu'au bout ;
- **212, « dialogue du livre des tambours »** : vérifié par une variante dédiée (`playthrough.test.ts`). Le parcours principal
  (les deux recherches demandées le même jour) ne distingue pas le script corrigé de l'original ; la variante « motif au
  jour 3, tambours au jour 4 » le fait : une remise du livre avec le correctif, deux sans, et le dialogue du motif rejoué.
  Le saut en 0x1867 est la cible du `bnt` d'origine (ScummVM écrit 0x23 au lieu de 0x25 et commente « même cible ») ;
- **260, attaque du python** (deux correctifs) : la scène laisse la main au joueur à l'état 10, le ventilateur sauve
  Gabriel, sinon la mort ; le climatiseur n'est pas actionné hors de l'attaque ;
- **93, inventaire au redémarrage** : « Recommencer » après la mort au musée, plus rien en poche au jour 1 ;
- **210, enveloppe du jour 6** : elle tombe 500 images après le journal, textes fermés ; ramassée sans blocage ;
- **230, beignets du jour 6** (minuterie de 22 secondes, deux entrées) : Gabriel passe le portillon et atteint la porte de
  Mosely 300 images avant le retour du sergent ; **230, sieste du sergent** : atteinte à la main seulement (si l'on
  attend le retour du sergent, il s'endort : seconde occasion) ; **230, vitesse de Gabriel** et **231, vendeur** (devant la porte du commissariat) : traversés ;
- **480, pauses des bandes dessinées** et **480, vue du bayou** : le rituel se joue de la première question au jour 7.

Jouées aux jours 7 à 9, sans incident :

- **220, position de Gabriel au téléphone** : deux appels de plus (Wolfgang, l'agence de voyage) ;
- **530, chemin dans la chambre du château** (`enterFromHall`) : Gabriel entre deux fois par la porte du palier et
  atteint l'armoire, la fenêtre, la vitrine ;
- **710, réplique de la liane** : « J'y crois pas, je l'ai fait! » s'affiche et se ferme, puis « Whoa! » et la salle 7 ;
- **710, momies du jour 9** (`rightWay`) : salles 4 et 5 quittées avant que le garde soit debout, salle 6 avec ses trois
  gardes, salle 7 : pas d'acteur cassé relevé par le banc (à regarder : voir « À vérifier ») ;
- **720, pauses des bandes dessinées** : la mort de Wolfgang (`cutToTheHeart`) se joue jusqu'à la pièce 216 ;
- le carton du château (pièce 500) sert trois fois : arrivée, nuit du jour 7 (`endTheDay`, rêve en pièce 550, puis
  `startTheDay`), départ (`leaveGermany`, qui passe au jour 9) ; le vol (pièce 750) trois fois aussi.

Jouées au jour 10, sans incident :

- **891, 892, 894, pauses des bandes dessinées** : 891 (Grace sauvée, avec Mosely) et 892 (l'idole brisée) dans le
  parcours, 894 dans la seconde fin ; chacune rend la main au script qui l'a lancée. La 893 (Malia lâche prise) n'a pas
  de correctif ;
- **800** : aucun correctif de ScummVM ne s'applique à ce CD (`HonfourUnlockDoor` est propre à la disquette,
  `engine.md` § 8) ; les trois portes fermées s'ouvrent à la carte-clé (`sUnlockDoor`), sans blocage ;
- **471, le gros plan au fondu de type 12** : il est sur le chemin depuis le jour 1 (la scène du lac passe par la pièce
  471, de l'image 2 419 à l'image 3 424 de l'étape `j1-lac`) ; l'étape le vérifie désormais (`Room.LakeCloseUp`). Le
  fondu lui-même reste à regarder.

Pas atteintes : 211 (appel de Grace au jour 1 : joué par l'ouverture, non vérifié à l'oreille), 420 (danse de Lorelei
regardée jusqu'au bout), 64990 (fenêtre de sauvegarde du jeu : le banc sauve par `engine/save.ts` et ne l'ouvre pas ;
son correctif « changer de répertoire » n'est donc pas exercé par le parcours).

### Envois avec moins d'arguments que la méthode n'en lit

Recherche dans le désassemblage de tous les scripts (pour chaque envoi `nom(n)`, le plus petit nombre de paramètres lus
sans test de `argc` ni `&rest` par les méthodes de ce nom) :

- `getPoints` avec un seul argument : `getTheEnvelope` (script 210, jour 6 : corrigé par `missingParams`) et
  `startOfDay4` (script 214, drapeau 455), toujours les deux seuls ; ni l'un ni l'autre n'est sur le chemin des jours 7
  à 9, et le score n'y a jamais sauté ;
- `Timer::setTicks(70)` sans l'appelant, `Drum::cue` (script 815, livre des tambours) : la méthode passe son second
  paramètre à `init`, qui est renvoyé aussitôt après avec le bon appelant (`setTicks(1) init(1)` dans le même envoi) :
  sans effet, joué au jour 6 ;
- `View::setCel()` sans argument, `sDrawingBlows` (script 410, le dessin qui s'envole au jour 2) : le cel lu est la
  case suivante de la pile (le sélecteur `setLoop`), remplacé par `setCycle` dans le même envoi : sans effet visible
  relevé, joué au jour 2 ;
- `Event::localize()` sans plan, `DSlider::select` (script 64910) : curseurs des réglages, hors du parcours ;
- les envois de `sysLogger` (script 952) sont des faux positifs (sélecteurs homonymes de `Rect`), script de mise au
  point jamais chargé.

## Bogues trouvés

### Corrigés

- **`Message(Get)` avec un tampon nul arrêtait le jeu** au premier sujet d'un interrogatoire (« 0 n'est pas une chaîne
  modifiable », `Interrogation::sayMessage`, script 51, qui passe 0 pour savoir qui parle). Un tampon nul vaut « sans
  tampon » : le talker est rendu, rien n'est écrit, le curseur ne bouge pas (`MessageState::nextMessage` de ScummVM teste
  `buf.isNull()`). Corrigé dans `engine/kernel/message.ts` (`Get` et `Next`) ; test dans `test/gk1/engine/message.test.ts`.

- **L'enveloppe du jour 6 doublait le score** (159, puis 318 sur 342). Ce n'est pas un défaut du moteur : `getTheEnvelope`
  (script 210) envoie `getPoints(-999)` sans le nombre de points, et `GKEgo::getPoints` (script 18) empile le score
  (`lsg global15`) dans la case même où il lit ensuite ce second paramètre (`lap param2`). La lecture du code de ScummVM
  (`read_var`, `send_selector`) donne le même résultat, et aucun de ses correctifs ne s'en occupe ; l'interpréteur
  d'origine n'a pas pu être consulté. Un score de 318 au jour 6 n'est pas tenable : `GameFixes.missingParams`
  (`engine/patches.ts`, lu par `Vm.readVariable` pour un paramètre au-delà de `argc`) rend 1 point, comme les autres
  ramassages. **Écart volontaire à faire valider** (voir « Ouverts »). Tests : `patches.test.ts` (la table),
  `playthrough.test.ts` (un point avec, score doublé sans).

Aucun bogue du moteur rencontré aux jours 2 à 10 (45 étapes) : les ajustements faits sont dans le banc
(`harness.ts` : attente de l'arrêt de Gabriel, sortie recliquée, `point`, `useItem(…, { settle: false })`, `combine`,
`local`, option `fixes` ; aux jours 7 à 9, aucun changement de `harness.ts`, les aides propres à un jour sont dans son
fichier : faisceau de la lampe, tri des pierres, clic dans le rectangle de sortie ; au jour 10, `playToEnd` pour la fin du
jeu, et `ringTo`, `throughDoor` dans `day10.ts`).

### Transmis

Aucun : rien de ce qui a été rencontré ne relève de `engine/loop.ts`, `events.ts`, `scripts.ts`, des transitions, de la
loupe ou de `SetCursor`.

### Ouverts

Aucun bogue du moteur connu sur le chemin joué.

- **Points de l'enveloppe du jour 6, à trancher** : 1 point (choix fait, par analogie) ou le comportement brut des
  scripts (score doublé, celui que donnerait ScummVM d'après son code). À confirmer sur l'original (DOSBox, D6) : noter
  le score avant et après le ramassage de l'enveloppe. Le second envoi sans points, `startOfDay4` (script 214, drapeau
  455), est sur un chemin que le parcours ne prend pas.
- **« Cette note pourrait me servir. »** quand Gabriel vide le tiroir de Mosely (traqueur et émetteurs) : texte du jeu
  pour ce verbe, à comparer à l'original.

**Correctifs de scripts D12** (`engine/patches.ts`) : les scènes corrigées déjà traversées sont listées plus haut ; le
« livre des tambours » (saut en 0x1867) est vérifié. La fenêtre de sauvegarde du jeu n'est pas utilisée par le banc (`VERSION` non fourni). Pendant la session, une modification en cours d'un autre agent
(`vm.fixes` dans `kernel/audio.ts`) a fait échouer une exécution, puis plus : ce n'était pas un bogue du jeu.

## À vérifier à l'œil ou à l'oreille

- **Didascalies françaises affichées** : « (Criant au mime qui est en train de se moquer de lui--c'est l'escalade) Hé,
  t'as pas fini! », « (S'adressant au mime) … », « (PENSIF.) "Je me demande…" ». La règle de l'original ne retire une
  parenthèse que si elle n'a aucune minuscule (`stringStage` de ScummVM) ; les traducteurs les ont écrites en minuscules.
  Fidèle selon la règle, à confirmer au banc ScummVM (D6).
- **Répliques d'ambiance** (la radio du motard : « <Crack> Quelqu'un a-t-il vu Joe? ») : le banc les ferme d'une Entrée.
  À vérifier qu'elles se ferment seules au bout de leur temps de lecture, sans bloquer le joueur.
- **Vitesse de marche au square Jackson** : 110 pixels en 9 secondes environ (Gabriel y est petit et lent). À comparer.
- **Scènes à regarder** : le mime qui suit puis singe le motard, la poursuite, le retour du motard ; la limousine de Malia
  au lac ; la fermeture de la boutique, le rêve (neuf `SEQ`) et le carton « Jour 2 » ; le gros plan de la loupe au lac.
- **Écran des interrogatoires** (pièce 50) : portraits, fondu d'entrée et de sortie, position des sous-menus en haut.
- **Carte** : libellé du lieu sous le pointeur (« La Rue Bienville »), musique, fondu.
- **Bas de l'écran du lac** : le décor s'arrête à la ligne 156, le reste est noir (zone des textes ?). À comparer.
- **Jour 2** : la séance de photo chez Mosely (Franks entre, l'éclair) ; le gros plan du thermostat (l'aiguille suit le
  pointeur, curseur à double flèche borné au cadran) ; Mosely qui tombe la veste, le vol de l'insigne et son retour avec
  le café ; la photocopieuse ; le dessin qui s'envole (aucun texte : l'animation seule) et le petit danseur qui passe
  entre les barreaux ; le tiroir de la caisse ; le majordome qui raccompagne ; la nuit sans passage par la librairie.
- **Jour 3** : le clavier du téléphone (voyants MARCHE / ARRET, chiffres affichés) ; Gabriel en prêtre, cheveux gominés,
  devant la porte de Madame Cazaunoux ; Lorelei au coin nord-ouest.
- **Jour 3, suite** : le docteur John derrière son comptoir ; la conférence de Hartridge (diapositives, l'auditoire qui
  bouge, Gabriel endormi) ; Bruno qui décroche le tableau ; Willy qui décroche le masque de crocodile ; le gros plan du
  bracelet et la « bénédiction » à l'argile ; la partie d'échecs gagnée par Sam ; l'interrogatoire filmé chez Mosely ; le
  gros plan des signes de la tombe ; Malia au tombeau des Gedde (la scène entière, 600 images) ; la librairie fermée le
  soir (le client éconduit).
- **Jour 4** : le gros plan de l'horloge (le cadran extérieur tourne d'un cran par 23 degrés de pointeur, la grande
  aiguille suit le pointeur, la petite avance d'une heure par tour, curseur borné au cadran), le tiroir qui s'ouvre ; le
  téléphone vers l'Allemagne ; la vue aux jumelles (cadre, Crash et le joueur de tambour) ; Sam qui remet le bracelet dès
  l'entrée ; la mort de Crash, le gros plan du corps, la chemise ouverte, le décalque ; la danse du serpent de Magentia
  Moonbeam ; l'arrivée du colis de Wolfgang et du livre des tambours à la sortie de l'interrogatoire de Grace.
- **Jour 5** : le film de la moto à la première sortie ; le musée dans le noir, le python qui tombe, l'étreinte (le
  joueur a une dizaine de secondes), le ventilateur, l'arrivée du docteur John ; l'écran de la mort (crâne, trois
  boutons RETABLIR, QUITTER, RECOMMENCER) ; Grace qui retire l'écaille ; le gros plan de la loupe sur chaque écaille ;
  le corps de Hartridge ; Mosely qui raccompagne Gabriel. Didascalies affichées en entier dans la scène de Hartridge
  (« (Entrant dans le bureau pour trouver un cadavre)Hé, Hartridge… ») et au rituel (« (D'une voix déguisée et répondant
  de façon énigmatique.) "Damballah." ») : même règle que plus haut, à comparer.
- **Jour 6** : la scène du matin (la bête encore vivante dans la boutique) ; l'enveloppe qui tombe par la fente ; la séance de peinture au studio ; le
  vendeur de beignets devant le commissariat, la sortie de Franks et du sergent, leur retour ; le livre des tambours
  (police des signes rythmiques, lettres qui s'affichent au rythme du tambour, phrases choisies recopiées à droite,
  barre EFFACER / LIVRE SUIVANT / SORTIE) ; l'éditeur de la tombe (grille des signes avec leurs lettres, signes posés
  sur le mur, barre EFFACER LETTRE / MESSAGE SUIVANT / SORTIE, compteur de score) ; le bayou (décors composés de trois
  calques tirés au hasard, radar du traqueur en bas à droite, voyants, point) ; le rituel entier (danse, Malia, Tetelo,
  le léopard) ; le carton et le rêve avant le réveil du jour 7.
- **Jour 7** : le tombeau des Gedde dans le noir (disque de lumière de la lampe, qui glisse vers le point cliqué ; le
  reste de l'écran noir), le casier ouvert sur Mosely, l'écran noir « Quelque temps plus tard.... », le gros plan du
  casier vide et du portefeuille ; le clavier du téléphone pour l'agence ; le film du vol (pièce 750), le carton du
  château sous la neige (fumée, flocons, lumières) ; Gerde qui épluche ses pommes de terre ; la chapelle (vitrail,
  bougies), Gabriel aux cheveux coupés (son reflet : « presque chauve »), la neige sur le rebord de la fenêtre, le pot
  de chambre sur l'autel, l'entaille, Gabriel à genoux ; le rêve du dragon (pièce 550 : l'œil, les expressions, sept
  films `flopMovie`), le réveil courbaturé.
- **Jour 8** : la clé sur la table au pied du lit, la porte sculptée qui s'ouvre, la bibliothèque ; le carton du château
  au départ.
- **Jour 9** : la jeep et le chauffeur ; les douze salles de l'anneau (trois décors qui alternent, torches, lianes,
  momies figées), le gros plan d'une pierre gravée (`tileInset`, `snakeView` : le nombre de serpents doit se lire), les
  pierres posées au mur ou par terre ; la tige dans la pierre, le tremblement ; **les momies** (correctif `rightWay` :
  dans les salles 4 et 5 le garde se lève pendant que Gabriel sort ; en salle 6 trois gardes, tous entiers et animés ?),
  le saut à la liane, Wolfgang qui retient les momies, le panneau qui se referme ; l'anneau central : les barres portées
  à deux, la table qui ne cède pas, la mort de Wolfgang (bandes dessinées), le talisman ; l'enlèvement de Grace
  (pièce 216, film) ; le texte du retour sur la carte.
- **Jour 10** : la librairie vide et Mosely qui entre ; le confessionnal qui descend (la cabine, le creux du panneau) ;
  la salle de l'ascenseur ; **le couloir rond** (décor composé par tronçon, enseigne aux serpents, boîtier, voûte des
  tronçons pairs, Gabriel qui sort d'un bord et rentre par l'autre), les rayons (lueur qui vacille), les douze salles
  (bureaux, chambre de Malia avec l'ombre de Gabriel caché, chambre du docteur John, réserve, salle de l'or, morgue) ;
  la salle du rituel et sa table gravée ; l'écran des tambours avec le second livre ; la cellule de Grace (Mosely qui
  entre, les déguisements de sanglier et de loup) ; **le rituel** (danse de Malia, feu qui palpite par `Palette
  SetFade` à chaque image, tremblements `ShakeScreen`, éclairs de palette quand l'idole se brise, le sol fendu, Malia
  suspendue), les bandes dessinées 891 à 894 ; l'épilogue (Grace et Gabriel, ou Grace et Mosely), la fenêtre du score
  et ses trois chiffres, le générique qui défile.
- **Fin du jeu** : vérifié dans le navigateur (« Recette navigateur ») : après le générique, ou sur un appui pendant le
  générique, la page revient à son écran titre.
- **Didascalies du jour 10** affichées en entier, en minuscules : « (Parlant à un Mosely absent qui lui a laissé une
  piste.) », « (Il active un élevateur secret, il est excité.) » : même règle que plus haut, à comparer.
- **Didascalies** : « (HORRIFIE--VIENT JUSTE DE TROUVER MOSELY 'MORT') » est bien retirée (tout en capitales) ; « <en
  sifflant> "Regardez la table!" » reste affichée (minuscules, entre chevrons).
- **Carte, la main au joueur** : `User` n'accepte pas toujours les entrées sur la carte (oui en venant du cimetière ou
  du square, non en venant de la rue de Madame Cazaunoux), sans effet visible : les icônes répondent dans les deux cas.
  À comparer à ScummVM si un curseur paraît figé sur la carte.
- **Passants du square** : Gabriel s'arrête net quand un passant coupe sa route (pièce 430, jour 3, en (105, 84)) et ne
  repart pas seul. C'est le script `sAvoid` du passant qui lui retire la main (« Recette navigateur », question a).
- **Son** : aucune vérification possible ici (musiques de chaque pièce, bruitages, voix, lèvres). Au jour 10 : la musique 895
  pendant la patrouille du docteur John et le retour de la 550, les tambours Rada de la cellule, la musique 904 de la
  seconde fin, celle du générique.

## Recette navigateur (16/11/2026)

Page `#/gk1` du serveur de développement (`gk1-site`, port 5322), dans le navigateur intégré. Captures dans
`/private/tmp/claude-501/-Users-suzy-Repositories-retrovibe/7cc71ed3-b672-4e29-a72e-0c1abb90c1d5/scratchpad/gk1-qa/` (noms entre parenthèses ci-dessous).

**Méthode.** La première moitié (écran titre, aide, menus, fin du jeu, mort, sauvegardes, barre d'icônes, cartons, éditeur
de la tombe, livre des tambours, traqueur, momies, lampe, hounfour, rituel) a été regardée **à cadence réelle** (60 images
par seconde mesurées), souris et clavier réels. Le volet du navigateur a ensuite été masqué (onglet « caché », plus
d'images) : la suite (thermostat, horloge, jumelles, questions d'ergonomie, mobile) a été pilotée par `loop.step()`, les
entrées injectées par la file d'évènements ou par des `PointerEvent` de type `touch`, et les images relues depuis le
canvas. Les étapes lointaines sont atteintes par les points de reprise du parcours : l'image JSON est écrite dans
`localStorage` sous `gk1:slot20` (`{ savedAt, save }`), puis chargée par « Menu → Charger » ; aucun crochet de
développement n'a été ajouté.

### Verdict par point

| Point | Verdict | Détail |
| --- | --- | --- |
| Écran titre du site, « Jouer », « Continuer » | correct | mise en page, jaquette, note « Dernière sauvegarde » (`00-site-titre`) ; « Charger une partie » est affiché, pas essayé |
| Aide et crédits | correct | `MANUEL.pdf` et `BD.pdf` répondent 200 en `application/pdf`, liens en nouvel onglet (`00-site-aide`) |
| Menu, « Son », volume, pause | correct | le jeu s'arrête fenêtre ouverte et en pause ; focus rendu au canvas (`00-site-menu`, `00-site-pause`) |
| Plein écran | à vérifier | le volet refuse le vrai plein écran ; le repli (`is-fullscreen`) agrandit bien l'écran |
| Écran titre du jeu : JOUER, SORTIR | correct | SORTIR arrête le jeu, la page revient à son écran titre (`01-jeu-titre`) ; INTRO et RETABLIR de cet écran pas essayés (RETABLIR vu depuis l'écran de la mort) |
| Carton « Jour 1 », première scène, accents | correct | (`01-carton-jour1`) |
| Barre d'icônes, panneau de réglages, « À propos », aide du jeu | correct | (`01-barre-icones`, `01-panneau-reglages`) |
| Fenêtre « Sauvegarder » du jeu, nom tapé au clavier (« Rec été ») | correct | accents en CP850, curseur clignotant ; la première frappe remplace le nom proposé, une touche d'édition le garde (`03-sauvegarder-jeu`) |
| Menu du site « Sauvegarder / Charger », rechargement, « Continuer » | correct | les deux chemins écrivent les mêmes emplacements |
| Mort (python du musée) : RETABLIR, RECOMMENCER, QUITTER | correct | RETABLIR ouvre la fenêtre du jeu (« Annuler » y est grisé, comme attendu après une mort) ; RECOMMENCER ramène à l'écran titre du jeu ; QUITTER rend la page à son écran titre (`05-mort-boutons`, `05-mort-retablir`) |
| Fin du jeu depuis `j10-fin` : rituel, bandes dessinées, épilogue, score, générique | correct | « 301 sur 342 » ; la fenêtre du score se ferme d'un clic **à côté** (curseur SORTIE), pas dessus : c'est le script (`finalInset::doit`, script 670) ; fin du générique ou clic pendant le générique : la page revient à son écran titre (`10-epilogue`, `10-score-final`, `10-generique-programmeurs`) |
| Thermostat (jour 2) | correct | l'aiguille suit le pointeur, curseur borné au cadran (`02-thermostat`) |
| Horloge (jour 4) | correct | cadran extérieur tourné, aiguilles (`04-horloge`, `04-horloge-cadran`) |
| Jumelles (jour 4) | correct | masque à deux lentilles, scène dedans (`04-jumelles-2`) |
| Écran de la mort, musée dans le noir | correct | palette sombre, python (`05-mort`) |
| Livre des tambours (jour 6) | correct | police des signes, panneaux de droite (`06-livre-tambours`) |
| Éditeur de la tombe (jour 6) | correct | grille, signes posés, barre EFFACER LETTRE / MESSAGE SUIVANT / SORTIE. Le compteur de cette barre affiche « sur 340 » : cels fixes du script 302 (`codeBar`), donnée d'origine (`06-editeur-tombe`) |
| Carte, libellé du lieu | correct | « La Résidence Moonbeam » (`06-carte`) |
| Bayou, radar du traqueur | correct | (`06-bayou-traqueur`, `k6-conclave`) |
| Tombeau dans le noir (jour 7) | correct, à comparer | disque de lumière qui glisse vers le clic ; un point clair de 2 × 2 pixels reste visible en (259, 120) : la vue 3291 de Gabriel dans le noir (`07-tombe-lampe`, `k7-torch`) |
| Chapelle, anneau des momies, pierres (jours 7 et 9) | correct | priorités et torches (`k7-kneel`, `k9-tiles`, `k9-chase`) |
| Hounfour : salle de l'ascenseur, rituel du jour 10 | correct | texte rouge « Ahhhhhhhhh! », feu (`k10-hall`, `j10-rituel`) |
| Didascalies entre parenthèses | non revu | pas de nouvelle scène vue avec une didascalie ; règle inchangée, à comparer (D6) |

Rien de cassé dans le rendu : pas de débordement de fenêtre de texte, pas de défaut de priorité ni d'échelle sur les
scènes vues.

### Questions d'ergonomie

- **(a) Passant qui arrête Gabriel : fidèle.** Mesuré sur la place (pièce 430, jour 3) : Gabriel bute sur une passante
  (bit « obstacle »), puis c'est la passante bloquée qui lance `sAvoid` (script 401, `PedActor::doit`). `sAvoid` appelle
  `GK::handsOff`, qui retire son mouvement à Gabriel (`setMotion: 0`), fait faire un écart au passant et rend la main.
  Rien ne relance la marche : il faut recliquer. `DoBresen` suit `kDoBresen` de ScummVM (pas refusé, client rétabli,
  `moveDone` jugé sur la position tentée), et la table `gk1Signatures` reprise dans `game/fixes.ts` n'a rien pour ce script.
- **(b) Barre d'icônes pendant une scène : fidèle.** `GK::handsOff` désactive les icônes, pas la barre
  (`IconBar::handleEvent` ne s'arrête que sur le bit 4 de `state`). Elle s'ouvre donc avec le seul panneau de réglages,
  et le jeu attend qu'on la quitte (`5b-scene-pointeur-haut`).
- **(c) Sorties au bord : fidèle.** Les zones sont étroites dans les scripts (place Jackson : ouest 4 pixels, nord 10,
  sud 10) et ne changent que le curseur (`ExitFeature::doit`). Le clic est une marche ordinaire vers le point cliqué ;
  Gabriel ne sort qu'en atteignant le bord (`GKEgo::doit` : x ≤ 0, x ≥ 319, y ≥ 141, y ≤ horizon). Mesuré : un clic en
  x = 3 l'amène en (3, 50) sans sortir ; au nord, toute la zone est au-dessus de l'horizon et un clic au milieu suffit.
  `ExitFeature::handleEvent`, qui enverrait Gabriel jusqu'au bord, existe mais aucun script ne l'appelle.
- **(d) Garde de la salle 5 : fidèle aux scripts corrigés.** `rightWay` (script 710) pose le garde en (63, 111) et le
  lance sur Gabriel après 4 cycles (`PChase`, distance 15). Gabriel entre en (75, 142) : un clic au milieu de la sortie
  le fait monter tout droit, à 11 pixels du garde, donc pris quelle que soit la cadence. Un clic à droite de la zone
  (x = 91) passe à 17 pixels et sort. À comparer à ScummVM (D6), dont vient l'initialisation complète du garde.

### Mobile et accessibilité

- **Portrait 375 × 812** : pas de défilement horizontal, écran sur toute la largeur, bouton « Menu » de 44 pixels ; le
  menu porte « Son », « Plein écran » et « Quitter » (`6-mobile-portrait`). Les icônes de la barre du jeu y font une
  vingtaine de pixels : jouable, plus confortable en paysage.
- **Paysage 736 × 414** : écran de 616 × 385, contrôles sur les côtés (`6-mobile-paysage`).
- **Toucher** : toucher = clic gauche, appui long = curseur suivant, toucher en haut = la barre s'ouvre sans cliquer, le
  toucher suivant choisit l'icône (`6-mobile-barre`).
- **Nom de sauvegarde au toucher** : le champ de la page se pose sur celui du jeu, prend le focus, écrit le nom
  (« Mobile é »), Entrée sauve, Échap annule (`6-mobile-saisie`).
- **Accessibilité de la page** : ordre de tabulation canvas, retour, Son, Menu, Aide, Plein écran ; contrastes de 8,8 et
  11,3 ; messages en `role="status"`.

### Corrigé

- **Champ du nom de sauvegarde sur téléphone** : sa police faisait 12 px, taille sous laquelle Safari sur iOS agrandit la
  page au focus sans la rétablir. Le champ garde une police de 16 px et il est réduit par `transform: scale` pour couvrir
  exactement le champ du jeu (`textEntryLayout`, `ui/text-entry.ts`). Test : `test/gk1/ui/text-entry.test.ts`. Vu dans le
  navigateur en 375 × 812 (`6-mobile-champ-apres-correctif`) ; **pas vérifié sur un vrai iPhone**.
- **Textes** (`copy.ts`) : la présentation et l'aide disaient encore « portage en cours, le début du jeu est jouable » ;
  le nom accessible du bouton « Menu » oubliait « sauvegarder » et « charger » ; l'aide explique maintenant les sorties
  au bord, le passant, les fenêtres qui se ferment d'un clic à côté et la barre pendant une scène. Test :
  `test/gk1/ui/copy.test.ts`.

### Propositions (à décider)

- **Module commun `src/ui/game-shell.ts`** : le canvas a un `aria-label` mais pas de rôle, donc pas de nom annoncé de façon
  fiable ; lui donner `role="application"`, comme la page de développement. La page du jeu n'a pas de titre `h1`.
- **Région `aria-live` pour les répliques** : faisable sans toucher au moteur. `afterTicks` lirait les textes des plans
  de texte (ce que fait `texts()` du banc) et les écrirait dans un paragraphe `role="status"` masqué à l'écran. Il manque
  au shell un point d'accroche pour ce paragraphe (`stageChildren` est fixé par `mountPointClickApp`) : petite évolution
  de `src/ui/point-click-app.ts`.
- **Sorties (c)** : si on veut adoucir, la voie propre est un correctif de script qui fait appeler
  `ExitFeature::handleEvent` par les régions (401, 301, 450). Écart à l'original.
- **Barre pendant les scènes (b)** et **passants (a)** : laissés fidèles ; l'aide les explique.
- **Champ de saisie et rotation du téléphone** : le champ n'est placé qu'à l'ouverture ; une rotation fenêtre ouverte le
  laisse décalé. À reprendre avec un test de la page dans un faux DOM.

### Reste à vérifier à l'oreille

Rien n'a pu être écouté pendant cette recette. À faire sur une vraie machine, son activé :

- musique de chaque pièce et de la carte, fondus, reprise après une fenêtre et après la pause ;
- voix anglaises calées sur le texte, lèvres des portraits, mode « voix », « texte » ou les deux du panneau ;
- bruitages numérisés ; curseurs VITESSE, MUSIQUE, BRUITAGE du panneau ; bouton « Son » et volume de la page ;
- répliques d'ambiance (radio du motard) : se ferment-elles seules ;
- tambours du livre (lettres au rythme), tambours Rada de la cellule ;
- jour 10 : musique 895 pendant la patrouille du docteur John et retour de la 550, musique 904 de la seconde fin,
  musique du générique ;
- premier son après « Jouer » sur téléphone (déblocage par le geste), et chargement de la soundfont en fond.

## Hors de portée d'un test

- Le **son lui-même** et la synchronisation des lèvres : le parcours joue en texte seul (temps de lecture du texte) ; seule
  l'ouverture est jouée avec les durées des clips, sans rien décoder (le reste est dans `test/gk1/audio/`).
- La **cadence et l'aspect exacts** de l'original (banc ScummVM, D6) ; les transitions et la palette ne sont vérifiées que
  par leurs tests propres.
- Le **toucher** et la coquille de la page (testés dans `test/gk1/ui/`).
- Le parcours dépend de la graine du hasard pour les passants du square : une autre graine peut demander plus d'essais
  pour approcher le mime (le banc en fait jusqu'à huit).
