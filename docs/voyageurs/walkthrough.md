# Les Voyageurs du temps : solution et partie complète (vague K)

La partie entière se joue sans écran, du démarrage (introduction comprise) au générique de fin, par de vraies entrées : touches des verbes
(F1 à F6), clics sur les objets, choix dans le menu des objets portés, clics sur les messages. Rien n'écrit l'état du jeu.

| Fichier | Rôle |
| --- | --- |
| `test/voyageurs/solution/walkthrough.ts` | la solution en données : 328 étapes en 6 parties |
| `test/voyageurs/solution/driver.ts` | le joueur (`Driver`) : étapes, attentes modales, enregistrement des entrées |
| `test/voyageurs/solution/inputs.ts` | format des entrées du banc (`n op`, `n@k op`), rejeu |
| `test/voyageurs/full-game.test.ts` | (a) d'une traite ; (b) sauvegarde, JSON et reprise après chaque étape ; (c) refus de sauvegarde entre deux parties |
| `test/voyageurs/deaths.test.ts` | quatre morts du héros, puis Nouvelle partie ou Charger |
| `test/voyageurs/solution/scummvm-replay.test.ts` | la partie rejouée comme au banc ScummVM, comparée tick par tick |
| `test/voyageurs/solution/bench-record.test.ts` | outil : relevé de la partie pour le banc, calcul des points de contrôle |

Les tests sont ignorés sans `original/voyageurs/` ; `VOYAGEURS_FULL_GAME=0` les passe. Durées (vitest) : (a) 0,4 s, (b) 2,5 s, rejeu 0,7 s.

## Comment la solution a été établie

Les scripts de chaque partie (PRC, REL, OBJ, MSG) ont été désassemblés avec les lecteurs du port et la table des opcodes (`FW_OPCODES`) ;
les relations (verbe, objet, objet) et leurs tests (position du héros, zone sous ses pieds, costume des objets, globales) donnent l'ordre
et les conditions. Les points de marche viennent des cartes de collision (`.NEO`) lues dans le moteur. Chaque étape a ensuite été jouée et
corrigée contre le moteur.

**La marche** est écrite dans les scripts (scripts globaux 10, 21, 22, ou 36 et 37) :
- le héros s'arrête quand le point cliqué est dans `[x + 8, x + 11]` et `[y + 29, y + 33]` ; ses pieds sont en `(x + 8, y + 31)`. En
  montant, il s'arrête donc les pieds deux pixels sous le clic, en descendant deux pixels au-dessus ;
- la marche verticale teste la ligne `x + 4` à `x + 15` sous les pieds : dans les couloirs étroits (escalier du passage secret, montée
  vers le lac, descente vers les loups, puits des égouts), il faut d'abord se placer en x, puis cliquer à la verticale ;
- un mouvement en diagonale abandonne la verticale au premier obstacle ; la solution décompose les trajets en segments.

## La solution, partie par partie

**0. Introduction** (445 ticks) : cinq messages à cliquer.

**1. 1989 : l'échafaudage, le bureau, le labo**
1. PRENDRE le seau ; EXAMINER l'échafaudage (le boîtier apparaît) ; ACTIONNER le bouton rouge (l'échafaudage monte).
2. ACTIONNER la fenêtre ; clic au-dessus du héros : il entre.
3. Bureau : PRENDRE le sac (poubelle) ; ACTIONNER le tapis (la clé) ; ACTIONNER le placard, PRENDRE la bombe insecticide ; ACTIONNER la porte
   des WC, PRENDRE le petit drapeau ; UTILISER le seau sur l'évier ; UTILISER le seau rempli sur la porte du milieu ; ACTIONNER la porte de
   droite : le patron reçoit le seau, le héros file chez lui.
4. Bureau du patron : EXAMINER la carte, UTILISER le drapeau sur le petit trou (passage secret) ; ACTIONNER le tiroir, PRENDRE la liasse ;
   UTILISER la clé sur le bon placard ; EXAMINER la machine à écrire (code **40315**) ; entrer dans le passage.
5. Passage : le plafond descend. EXAMINER le pavé, ACTIONNER 4, 0, 3, 1, 5 ; la porte s'ouvre (seuil franchissable en x = 134 seulement).
6. Labo : UTILISER la liasse sur la fente ; ACTIONNER le bouton vert puis le rouge (documents, alarme) ; PRENDRE les documents ; monter sur
   la plate-forme avant le garde : téléportation.

**2. Moyen Âge**
1. Marécage : longer les lignes sûres (la boue tue) ; UTILISER la bombe sur les moustiques depuis x = 125 à 130 ; EXAMINER l'éclat (pendentif).
2. Clairière : EXAMINER le pied de l'arbre (corde), UTILISER la corde sur la branche ; le paysan se baigne : PRENDRE tunique et pantalon.
3. Forêt : ACTIONNER l'arbre, EXAMINER le sol (pièce). Auberge : UTILISER la pièce sur l'aubergiste, écouter les clients.
4. Village : UTILISER le pendentif sur le garde (Torin reçoit le héros) ; PRENDRE la lance ; forêt : UTILISER la lance sur la soutane (moine).
5. Lac : UTILISER le sac sur le lac (il fuit : 200 ticks) ; vite chez les loups : UTILISER le sac rempli sur un loup (électronique) ; ACTIONNER
   la porte du monastère.
6. Cloître : **sens des aiguilles d'une montre** (script 3 : à gauche dans le couloir du bas, en haut à gauche, à droite en haut, en bas à
   droite ; le centre est interdit), les portes se referment à chaque retour. Chambre du père (il commande du Chikapok) ; entrepôt : PRENDRE la
   coupe ; cave : UTILISER la coupe sur le tonneau ; le père boit, s'écroule : EXAMINER le père (télécommande), UTILISER la télécommande sur le
   meuble (carte magnétique) ; cave : UTILISER la télécommande sur le tonneau, monter à l'échelle ; labo : PRENDRE la capsule de gaz, UTILISER la
   carte sur la console : Lana, puis départ pour 4315.

**3. 4315**
1. Ruines : EXAMINER les décombres (chalumeau). Rue : PRENDRE les décombres (fusibles), EXAMINER les autres (plaque), ACTIONNER la plaque.
2. Égouts : UTILISER le chalumeau sur le robinet ; aller à gauche jusqu'à la créature ; le héros avance seul : UTILISER le chalumeau rempli
   sur la créature quand il est en x 151 à 169.
3. Navi-port : UTILISER la lance sur la caméra (face à elle), passer les portes. Quai : EXAMINER le récupérateur, UTILISER la pièce sur la fente
   (deux fois : journal) ; monter dans le train.
4. Hall : placard des fusibles (UTILISER les fusibles sur les fusibles : la télévision du contrôleur marche) ; passer quand l'hôtesse pianote.
5. Cellule : UTILISER la clé sur le conduit, la capsule, puis aussitôt le journal ; sortir ; attendre les Crughons (jugement, peloton, hypno-éduc).

**4. Crétacé (PART04)** : descendre l'éboulis ; le tir (un clic sur chaque Crughon, le plus proche de la zone x 122 à 142 d'abord, puis sur
le chef) ; EXAMINER Lo'Ann trois fois (pilule, pendentif), UTILISER le pendentif sur elle ; EXAMINER le Skaar (carte) ; UTILISER la carte sur le
lecteur (une seule fois), ACTIONNER le caisson, PRENDRE le vêtement, UTILISER le vêtement sur la caméra, s'allonger dans le caisson, ACTIONNER
le caisson. Cabine : attendre au fond que les deux Crughons soient descendus, la **pilule au dernier moment** (26 ticks après leur sortie),
passer la porte, dans le hangar descendre en x 138 à 141 (loin du Crughon figé) et ACTIONNER la caisse depuis la zone 10. Vaisseau : la porte.

**5. Le vaisseau-bombe (PART04B)** : labyrinthe de 24 salles sur deux niveaux, compte à rebours de 3 600 ticks pour l'aller, l'ordinateur et
le retour. Itinéraire (plus court chemin calculé sur les murs et les échelles des 24 scripts de salle) : 37 mouvements à l'aller (1 290
ticks), 27 au retour (965). Une échelle se prend héros arrêté en `x + 8` = x de l'échelle ; il se cale sur un multiple de 8 dans son sens de
marche, sauf au-dessus d'un trou du sol : il faut parfois revenir de l'autre côté. Ordinateur : UTILISER la carte sur la console. Retour
vers les navettes : fin, puis générique en boucle (script 35, décor L44 ; le jeu ne s'arrête pas de lui-même).

## Morts du héros (`deaths.test.ts`)

Aucune mort ne recharge le jeu : le script affiche son message, coupe les entrées et arrête la marche. Le menu système reste ouvert (Sauver
en moins) : Nouvelle partie relance depuis le démarrage, Charger ouvre le dialogue du site. Chaque mort est atteinte en s'écartant de la
solution ; ses entrées, rejouées au banc ScummVM (`fw-replay.sh`), donnent des lignes `TK` identiques jusqu'à la mort.

| Mort | Écart à la solution | Message | Suite testée |
| --- | --- | --- | --- |
| Plafond du passage secret (L4) | ne pas taper le code | « Le plafond était un peu bas » | Nouvelle partie |
| Alarme du labo (L5, script 18) | rester après les documents, remonter sur le palier de gauche (le garde ne passe pas le creux du sol) | « La curiosité est un vilain défaut » | Nouvelle partie |
| Boue du marécage (L6) | marcher dans la zone 4 | « GLOU GLOU » | Charger |
| Moustiques (L6, script 8) | passer en x ≤ 124 sans insecticide | « les moustiques ont eu raison de vous » | Charger |
| Moines du village (L8, scripts 15 et 35) | entrer sans les habits du paysan (globale 200 = 0) | « ESPION ! ESPION ! » | |
| Loups (L12, script 45) | descendre dans la zone 3 avant la décharge | « TROP PRES ! » | |
| Moines du monastère (PART02B) | entrer en habit de paysan (globale 200 = 1) | « ESPION ! ESPION ! » | |
| Faute dans le cloître (PART02B, script 3) | marcher dans le sens interdit | « Infidèle ! », puis « ESPION ! » | Nouvelle partie |
| Créature des égouts (L21) | ne pas l'arroser à temps | « elle vous a croqué » | Nouvelle partie |
| Sécurité du navi-port (L22, script 18) | revenir du quai et descendre vers les gardes | « s'achève votre voyage » | |
| Gaz de la cellule (L27, script 39) | ne pas boucher le conduit avec le journal | « le gaz s'est répandu » | Nouvelle partie |
| Tir des Crughons (L34) | laisser approcher un Crughon | « C'est ici que se termine votre périple » | |
| Comité d'accueil (L42) | ne pas aveugler la caméra du caisson | « Le comité d'accueil est déja en place » | Charger |
| Crughons de la cabine (L42, script 47) | ne pas avaler la pilule | « c'est la fin de tous vos espoirs » | |
| Compte à rebours (PART04B, script 34) | rester dans le labyrinthe, carte gardée | « La bombe vient de détruire le dernier pole » | |
| Compte à rebours, bombe reprogrammée | ne pas rejoindre la navette | « Notre flotte vient d'être anéantie » | |

Écarts à la règle générale, tels que dans les scripts et au banc : l'alarme du labo et le compte à rebours laissent tourner le script de
marche 10 (seuls les scripts 36 et 37 qui déplacent le héros s'arrêtent) ; la sécurité du navi-port efface seulement la cible de marche ;
le comité d'accueil n'affiche que son message (plus aucun script, entrées laissées permises, sauvegarde possible). Le héros ne bouge plus.

**Compte à rebours** : 3 600 ticks (6 × 6 × 10 × 10, script 34), 3 606 entre la main rendue dans PART04B et le message. Il compte des
ticks, pas du temps : la pause du menu système (attente d'entrée modale, `makeSystemMenu`), les messages et les menus le figent, dans
ScummVM (la boucle principale est bloquée dans `manageEvents`) comme dans le portage (30 s de pause : aucun tick, même tick de mort qu'au
banc). La pause du site (bouton, onglet masqué, fenêtre ouverte) n'appelle plus `step` : rien n'avance non plus.

**Protection (D7)** : toute comparaison de la globale 255 répond « égal ». La globale n'est comparée qu'en contrôle préalable (cloître,
cabine L42, vaisseau-bombe) : les fautes du cloître et les moines restent atteignables (testés ci-dessus) ; la partie complète traverse
le monastère sans « ESPION ! » ni « Infidèle ! » (`full-game.test.ts`).

## Comparaison au banc ScummVM

Le banc rejoue `solution/fixtures/scummvm-inputs.txt` (1 013 entrées, dont 462 adressées à des attentes modales) avec `bench/fw-replay.sh`
(graine 1, temps virtuel). Le patch du banc (`cine-trace.patch`) ajoute les entrées `n@k` : sans elles, les choix de menu (UTILISER) ne se
rejouaient pas. Résultat : **les 16 059 lignes `TK` sont identiques** (empreinte des globales, scripts actifs et positions, calques, décor,
attente de clic, entrées ; seul le champ `mus` est hors comparaison), ainsi que les 300 images de fin d'étape. `scummvm-checkpoints.txt`
garde une empreinte de trace par fin d'étape (donc de chaque tick) et l'empreinte de l'image.

Refaire les fixtures après un changement de la solution : `bench-record.test.ts` (procédure en tête du fichier).

## Écarts et corrections du moteur trouvés en vague K

- **Sauvegarde entre deux parties** : à la fin de PART01, le bundle PART02 est ouvert alors que le décor est encore L5 ; une sauvegarde prise
  là ne se rechargeait pas (fond absent du bundle). La sauvegarde est refusée (`busy`) tant que le fond n'est pas dans le bundle courant.
- **Numéro de tick des attentes modales** (`MW`) : celui du banc (`benchTick`) ; une attente de menu pendant les entrées du tick n portait n − 1.
