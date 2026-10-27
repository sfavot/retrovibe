# L'Odyssée des Zoombinis : parcours d'une partie (écrans, choix des Zoombinis, carte, camps, Zoombiniville, sauvegardes)

Étude de rétro-ingénierie de `ZOOMBINI.EXE` (NE 16 bits, version 1.0FR) et des textes `TEXTSTR.MHK`. Le moteur (boucle, scènes `SCRB` / `SCRS`, `REGS`, `NODE`, `PATH`, palettes) est décrit dans `engine.md` ; les règles internes de chacune des 12 épreuves sont renvoyées aux études des épreuves (R3 à R6, `puzzles/*.md`, à venir). Le corpus Ghidra et les fonctions se trouvent dans `archives/zoombinis/re/ZOOMBINI/` (index : `re-index.md`).

Conventions :
- les adresses sont `segment:offset` du code (ex. `1110:0107`) ; `DS:xxxx` désigne le segment de données (`1530`) ; les variables globales sont nommées `[xxxx]` d'après leur offset dans `DS` (ex. `[8552]`) ;
- les champs de la partie courante sont notés `S+0xNN` (`S` = tampon de partie de 0xAE05 octets, pointeur `[2362]`, voir 6.3) ;
- confiance : **sûr** (lu dans le code, ou vérifié sur un fichier), **probable** (cohérent avec plusieurs indices), **hypothèse** (déduit, non vérifié) ;
- plusieurs routines (boîtes de dialogue, enregistrement, touches de la carte) ne sont pas des fonctions du corpus (Ghidra ne les a pas créées : adresses atteintes seulement par des pointeurs de rappel). Elles ont été lues avec un script Ghidra jetable : `11a0:3914` (dialogue d'enregistrement et de chargement), `11a0:21c4` (dessin des dialogues), `11a0:141e` (écriture de la partie), `10d0:0607` (nom du fichier de partie), `1110:0b3a` à `1110:0d7b` (touches de la carte), `1110:182b`. Leurs adresses sont citées comme les autres.

Le texte français des écrans cités vient de `TEXTSTR.MHK` (chaînes `STRL`, Mac Roman, voir 5.3) ; les mots entre guillemets sont les textes du jeu, pas une proposition de copy.

## 1. Déroulé d'une partie

### 1.1 Démarrage (`1160:0000`)

Le point d'entrée `1000:0000` appelle `1160:0000` (WinMain) : **sûr**.

1. Version de Windows (`GetVersion` ; `[22f6]` = 1 si supérieure à 3.11) ; `GetWinFlags` doit indiquer le mode étendu 386 (bit 0x20), sinon message d'erreur et sortie.
2. Contrôles d'environnement, chacun avec un message d'erreur (chaînes anglaises de `1530:2737` et suivantes, versions françaises dans `STRL` 1000 à 1048) : initialisation du gestionnaire de ressources (`11c8:8889`), mémoire libre (au moins 0x189C40 octets, soit 1,6 Mo ; 0x389C40, soit 3,6 Mo, sous Windows plus récent que 3.11), mémoire physique libre (au moins 6 Mo, mêmes systèmes), autres contrôles système (`11c8:af54`, `11c8:62b9`, `11e0:19ee`, `11d0:06fd`, `11f0:38b6`, `11c0:0a94`), puis `waveOutGetNumDevs` et `midiOutGetNumDevs` non nuls. Le rapport entre chaque contrôle et chaque message n'est pas établi (7).
3. Lecture de l'en-tête de `ZOOMBINI.WHO` (`10d0:0286`, mode 0, voir 6.1) : le fichier est créé s'il n'existe pas.
4. Lecture de `ZOOMBINI.CFG` (`1138:00ee`, voir 6.2) : répertoires du CD et d'installation.
5. Allocation du tampon de partie `S` (0xAE05 octets, `11c8:5af4`), initialisé par `10d0:089b(1)` (nouvelle partie, valeurs par défaut) puis recopié dans les globales par `10d0:07f5`.
6. Chargement de `TEXTSTR.MHK` (`1178:004c`, `1178:0103` : 15 listes de chaînes), de `MIDIMPC.MHK` et `ZOOMBINI.MHK` (`1168:004f`) et des 5 curseurs `CURS` 1 à 5 (`1160:0000`, `0x43555253` = « CURS »).
7. `[8554] = 0` (écran demandé : 0), puis boucle principale : `1198:0000` est appelé tant que `[a1ee] == 0` ; il exécute `1108:0000` (changement d'écran, 1.2) quand `[8554] != -1`, avec la tâche de fond (`1038:0029`).

Il n'y a **pas d'écran de titre ni de menu principal** : après le logo, le jeu va directement au choix des Zoombinis (nouvelle partie) ou reprend l'écran de la partie chargée (**sûr**). Les menus (nouvelle partie, charger, enregistrer, options, quitter) sont une boîte de dialogue ouverte à la demande (1.4).

À la fermeture (`1160:05c9`) : si une partie non enregistrée est en cours (`[96f2] == 0`, `[3fce] != 0`, `[9666] != 0`, `[87e4] != 0`, aucun dialogue ouvert, écran 1 à 18), la boîte « La partie en cours n'a pas été enregistrée… veux-tu sauver ta partie avant de quitter? » (dialogue type 4, `[a1ee] = 2`) est ouverte avant de quitter ; l'en-tête du `.WHO` est réécrit (`10d0:0286` mode 1) et chaque écran est démonté par son rappel de nettoyage.

### 1.2 Table des écrans et changement d'écran (`1108:0000`)

Le jeu est une suite d'**écrans** numérotés de 0 à 22 (**sûr**). `[8552]` est l'écran courant, `[8554]` l'écran demandé (−1 = rien), `[8556]` l'écran demandé par la scène elle-même (consommé par son rappel de tick, qui le recopie dans `[8554]`), `[855a]` l'écran précédent, `[8558]` l'écran final quand une transition (écran 2) est intercalée, `[8550]` mémorise la dernière épreuve finale terminée.

La table est à `DS:14fe` (23 pointeurs lointains vers des structures de 5 pointeurs lointains : initialisation, nettoyage `+4`, tick `+8`, `+0xC` vide, gestionnaire de touches `+0x10` ; le rôle de `+8` est **probable**, les autres **sûrs**, vus dans `1108:0000`, `1160:05c9` et `1198:05b3`).

| Id | Initialisation | Archive | Rôle |
|---:|---|---|---|
| 0 et 22 | `1180:0048` (tick `1180:012d`, touches `1180:0000`) | (aucune) | logo QuickTime `Logo025.MOV`, puis écran de reprise |
| 1 | `1110:0107` | `MAP.MHK` | carte |
| 2 | `11b0:00c4` | `XFER.MHK` | transition entre deux écrans (marche des Zoombinis) |
| 3 | `1128:006d` | `PICKER.MHK` | choix des Zoombinis (Zoombinîle) |
| 4 | `10b0:0027` | `BASECAMP.MHK` | camp de base 1, « l'abri du rocher » |
| 5 | `10b8:0030` | `BCTWO.MHK` | camp de base 2, « l'aire de grozarbre » |
| 6 | `1188:0128` | `TOWN.MHK` | Zoombiniville |
| 7 | `10c0:00e6` | `BRIDGE.MHK` | « les gorges allergiques » |
| 8 | `1190:0107` | `TUNNELS.MHK` | « les grottes de passe-clos » |
| 9 | `1130:0000` | `PIZZA.MHK` | « la hutte à pizza » |
| 10 | `10d8:0071` | `FERRY.MHK` | « le bac du père mathieu » |
| 11 | `10f8:0000` | `LILLY.MHK` | « les têtards tatoués » |
| 12 | `1170:0000` | `SLIDES.MHK` | « la fosse de monte-pierre » |
| 13 | `10e0:00ea` | `FLEENS.MHK` | « les nizibooms » |
| 14 | `10e8:0000` | `HOTEL.MHK` | « l'hôtel du temps-compté » |
| 15 | `1120:0000` | `NET.MHK` | « la muraille de signes » |
| 16 | `10c8:0000` | `CAVES.MHK` | « la tanière du sphinx » |
| 17 | `1158:0000` | `SMOKE.MHK` | « le piège de cristal » |
| 18 | `1118:0000` | `MAZE2.MHK` | « le gouffre des véhibules » |
| 19 et 21 | `1110:20f6` | `PICKER.MHK` | écran caché (1.7) |
| 20 | `1110:2f46` | `PICKER.MHK` | écran caché (1.7) |

Le rapprochement des 12 épreuves avec les 12 noms de la liste `STRL` 2000 est **sûr** : l'indice de la liste (1 à 15) est le numéro de lieu de la carte (3.1), et la carte envoie le lieu *n* vers l'écran de la colonne ci-dessus (`1110:0819`). Il est cohérent avec les textes de fin d'étape (`STRL` 2016, 4.3) et avec les noms anglais (`ENGLISH/TEXTSTR.MHK` : Allergic Cliffs, Stone Cold Caves, Pizza Pass, Captain Cajun's Ferryboat, Titanic Tattooed Toads, Stone Rise, Fleens!, Didimension Hotel, Mudball Wall, The Lion's Lair, Mirror Machine, Bubblewonder Abyss).

**Changement d'écran** (`1108:0000`, exécuté quand `[8554] != -1`) :
- **fin d'étape** (**sûr**) : si l'écran quitté est une épreuve finale d'étape (9, 12, 15 ou 18) et que la destination est le camp ou la ville suivant (4, 5, 5, 6), la bonne combinaison est mémorisée : `[8550] = écran`, et le bit `1 << niveau` du masque d'étape est mis (`S+0x50` pour l'étape 1, `S+0x52` bits 0 à 3 pour l'étape 2, bits 4 à 7 pour l'étape 3, `S+0x51` pour l'étape 4), voir 3.4 ;
- **transition** (**sûr**) : si l'écran quitté est 3, 4, 5 ou 7 à 18 (pas 0, 1, 2 ni 6) et que la destination n'est pas la carte (1), l'écran 2 (`XFER`) est inséré (`[8558]` = destination réelle, `[8552] = 2`) ; elle n'est pas jouée si les transitions sont désactivées (`[854e] != 0`, option 5.2) ni pendant la reprise (`[970a]`) ; en partie d'entraînement (`[96f2] != 0`) il n'y a jamais de transition et toute destination autre que 3 et 0 devient la carte ;
- `S+0xCA` reçoit l'écran quitté et `S+0xCC` l'écran demandé (sauf 0 et 2) : c'est le point de reprise d'une partie chargée (1.5) ;
- pour les écrans 7, 10, 13 et 16 (première épreuve d'une étape) hors entraînement, `S+0x54 = 1` (étape commencée sans retour à la carte, voir 3.4) ;
- l'initialisation de l'écran est ensuite appelée (`table[écran]+0`).

### 1.3 Logo (écrans 0 et 22, `1180:*`)

- `1180:012d` joue `Logo025.MOV` (QuickTime pour Windows, `1008:013c` / `1008:0459`) ; le film n'est lu qu'une fois (`[9e0c]` : 0, 1 puis 2). Les autres `LOGO025B.MOV`, `LOGO027.MOV`, `LOGO027B.MOV`, `LOGO025C.MOV` (versions anglaise et allemande) ne sont pas nommés dans le code : seul `Logo025.MOV` apparaît (**sûr** pour le code ; leur usage éventuel par des chemins calculés n'est pas exclu). Les `.PRF` sont des statistiques de lecture (images perdues), sans effet.
- Toute touche ou clic pendant le film (`1180:0000` : `1180:0245(-1)`) arrête le logo ; la fin du film fait de même. `Ctrl+Q` (code 0x11) quitte (`1180:007d`, `[a1ee] = −1`) (**sûr**).
- À la fin, l'écran suivant est choisi par `1160:0521` : `S+0xCC` si c'est 1, 3, 4, 5 ou 6, ou si c'est un écran d'épreuve (7 à 18) et que le groupe courant n'est pas vide (`S-0x56D2 > 0`, voir 6.3) ; sinon **3 (choix des Zoombinis)**. Une partie neuve a `S+0xCC = −1` : elle arrive donc au choix des Zoombinis (**sûr**).
- L'écran 22 (même initialisation que 0) est la cible du changement de langue (`11a0:416c(1)`) : le jeu repasse par le logo avant de reprendre.

### 1.4 La boîte de dialogue du jeu (`11a0:1737`, `11a0:35ca`, `11a0:3914`, `11a0:21c4`)

`11a0:1737(…, mode)` ouvre l'un des modes de dialogue (**sûr**) ; un seul à la fois (`[a2da]` : masque des modes ouverts) :

| Mode | Usage | Textes (`STRL` 2018, 0 = premier) |
|---:|---|---|
| 1 | menu principal : 8 boutons | 11 « Nouvelle partie (ctrl n) », 12 « Charger partie (ctrl c) », 13 « Enregistrer partie (ctrl s) », 14 « Quitter (ctrl q) », 15 « Dialogues & effets (ctrl v) », 16 « Musique de fond (ctrl y) », 17 « Souris aimantee (ctrl j) », 18 « Transitions (ctrl t) » ; 28 « Equipe » (crédits) ; 7 « Options » |
| 2 | chargement : liste des parties (8 lignes par page, défilement de 8 en 8) | 26 « Charger une Partie », 19 « Aucune Partie Enregistree » si `[a1f6] == 0` (alors ouverture du mode 4), 5 « Charger », 4 « Annuler » |
| 3 | enregistrement : saisie du nom + liste | 24 « Enregistrer une Partie », 25 « Enregistrer sous: », 6 « Enregistrer », 27 « es-tu sûr de vouloir remplacer la partie existante " », 23 « Remplacer », 37 « impossible d'enregistrer plus de 50 parties » |
| 4 et 6 | messages oui/non (confirmation de quitter, de nouvelle partie, d'écrasement, partie d'entraînement) | 0, 1, 2, 3, 20, 21, 29 à 36, 38 à 41, 45, 46 |
| 5 | « Équipe » (crédits ; probable) | 28 |

Les boutons du mode 1 déclenchent (`11a0:35ca`, cas 1 à 10) : 1 `11a0:425e` (nouvelle partie), 2 `11a0:4434` (charger), 3 `11a0:4493` (enregistrer), 4 `11a0:44f2` (quitter), 5 à 8 bascules d'options (5.2), 9 fermeture, 10 mode 5 (crédits, 5.4). Les raccourcis clavier correspondent à `Ctrl+lettre` (code = rang de la lettre : N = 0x0E, C = 3, L = 0x0C, S = 0x13, Q = 0x11, T = 0x14, J = 0x0A, V = 0x16, Y = 0x19, B = 2) traités par `1198:05b3` (**sûr**). Les libellés `Ctrl+v` et `Ctrl+y` du texte français ne sont pas ceux de la version anglaise (`CTRL B`, `CTRL Y`) ; le code accepte les deux (`case 2` et `0x16`).

Le menu n'est actif que sur les écrans 1 à 18 (`4434`, `4493` testent `0 < [8552] < 0x13`) ; sur l'entraînement, charger et enregistrer sont refusés avec les messages « impossible de charger une partie d'entraînement » (38), « impossible d'enregistrer une partie d'entraînement. » (35), « impossible de créer une nouvelle partie d'entraînement » (39) (**sûr**).

### 1.5 Nouvelle partie, charger, enregistrer

- **Nouvelle partie** (`11a0:425e`, `11a0:416c`) : si une partie est en cours non enregistrée (`[87e4] == 0`), « La partie en cours n'a pas été enregistrée. Créer une nouvelle partie? » (21, boutons « Nouvelle » 22 et « Annuler »), sinon « Es-tu sûr de vouloir commencer une nouvelle partie? » (36). Confirmée, `11a0:416c` réinitialise la partie (`10d0:089b(1)`, tous les compteurs à 0, niveaux 0), pose `S+0xCA = 3`, nomme la partie courante `ZBUser.txt` (partie non enregistrée) et envoie à l'écran 1 si on était sur la carte, sinon à l'écran 3 (**sûr**).
- **Charger** (mode 2) : la liste est le contenu du `.WHO` (6.1) ; choisir un nom lit le fichier `ZOOMnnnn.txt` correspondant (`10d0:0734`) ; vérification de la valeur 0x6B en tête (« Fichier utilisateur invalide, supprimer et réessayer », `STRL` 1028 et 1030) ; l'écran de reprise est ensuite `S+0xCC` (1.3) (**sûr**).
- **Enregistrer** (mode 3, `11a0:3914`) : nom saisi d'au plus 18 caractères choisis dans la liste de `STRL` 1100 (« AaBbCc…Zz1234567890:;'[]{}<>,.-_+=|!@#$%^&*() àäçÇëèéêïîôœüùû » ; espaces de tête et de fin retirés ; le test est `longueur + 4 < 22`, `11a0:316d`) ; un nom déjà présent propose « Remplacer » ; sinon une entrée est ajoutée (50 au plus). Le nom du fichier est `ZOOM` + numéro à 4 chiffres (`%04d`, compteur du `.WHO`) + `.txt` (`10d0:0607`) (**sûr**).
- **Écriture automatique** : une fois la partie nommée, l'état est réécrit au changement d'écran par `11a0:141e` → `10d0:06ad` (fichier `<nom>.txt`, 0xAE05 octets, seulement si le nom courant n'est pas `ZBUser.txt` et si `[87e4]` est levé). Avant l'écriture, `11a0:141e` range le groupe courant dans la réserve propre à l'écran (3 : réserve du choix des Zoombinis ; 4 : camp 1 ; 5 : camp 2 ; voir 6.3). L'entraînement écrit dans `ZBtemp.txt` (`1110:03b8`) (**sûr** pour les noms de fichiers ; la fréquence exacte de l'écriture automatique est **probable**).
- **Changement de langue** (touches `Ctrl+D/E/F`, codes 4, 5 et 6 ; `[5cfc]` vaut 2, 0 ou 1 ; `11a0:4346`) : dialogues « es-tu sûr de vouloir changer de langue? » (42 à 46). Le jeu embarque donc trois langues (une par dossier du CD, `ENGLISH/`, `FRENCH/`, `GERMAN/`) ; seule la version française est servie dans ce dépôt : cette fonction est sans objet pour nous (**probable**).

### 1.6 Niveaux de difficulté (`STRL` 2004, `1168:515d`)

Le jeu a **quatre niveaux** : 0 à 3 en interne (**sûr**) ; textes `STRL` 2004 : 2 « pas si facile », 3 « assez difficile », 4 « très difficile », 5 « mission impossible » (la liste commence par 0 « touche terrain » = titre de la légende de la carte, 1 « choisis un niveau » = titre du menu de niveau de l'entraînement ; en anglais : « terrain key », « choose a level », « not so easy », « oh, so hard », « very hard », « very, very hard »).

- **Aventure** : la difficulté est **propre à chaque étape** (1 à 4, voir 3.1) et stockée dans `S+0xC2 + 2×(étape−1)` (4 mots, `1168:515d` via `1108:02f9`). Une nouvelle partie commence à 0 partout. Le niveau d'une étape **augmente de 1** (jusqu'à 3) quand le joueur termine la dernière épreuve de l'étape sans perdre aucun Zoombini (`1168:36e1`, 3.4) : la fois suivante, l'étape est plus difficile. Le joueur ne choisit donc pas son niveau en aventure (**sûr**).
- **Entraînement** (`[96f2]` = 1 à 4 : niveau + 1, `1168:515d` renvoie `[96f2]−1`) : on y entre depuis la carte avec la touche `Maj` (code 0x10, niveau 1) ; les touches `1` à `4` (codes 0x31 à 0x34) choisissent le niveau ; les quatre rectangles du menu de niveaux (`1110:12a9`, rectangles `DS:1614`) envoient les mêmes codes (`1110:0b8d`, `1110:0b97`, `1110:0819` cas 0x11) (**sûr**). L'icône de la carte et la légende affichent le niveau courant (`1110:1601`).
- **Effet global du niveau** (**sûr** pour la liste, le détail est dans les études des épreuves) : réglage de chaque épreuve (appel de `1168:515d` dans `10c0:00e6`, `10c8:0000`, `10d8:0071`, `10e0:00ea`, `10e8:0000`, `10f8:0000`, `1118:0000`, `1120:0000`, `1130:0000`, `1158:0000`, `1170:0000`, `1190:0107`, `11b0:00c4`), variante de texte à la fin (16 textes = 4 étapes × 4 niveaux), icône du lieu sur la carte (+0x10 images par niveau, `1110:1601`), monument de Zoombiniville (4.2), indice de la phrase du narrateur. Le masque `1 << niveau` sert aussi aux marques de réussite.
- Un drapeau `[9700]`, mis à 1 par `1168:36e1` après l'augmentation de niveau, retire 1 au niveau lu juste après (`1108:0000`) : il évite que la même fin d'étape compte pour le niveau suivant (**probable**).

### 1.7 Écrans cachés (19, 20, 21)

Depuis la carte, cliquer le lieu 8 (« la fosse de monte-pierre ») ou le lieu 9 (« les nizibooms ») envoie à l'écran 20 (`1110:2f46`) ou 19 (`1110:20f6`) à la place de l'épreuve **si un code secret a été tapé au clavier** (`10a8:03d9` accumule un condensat roulant des touches, `10a8:041f` le compare à deux constantes de 32 bits ; `1110:0819` cas 8 et 9). Ces deux écrans ont leur propre archive (`PICKER.MHK`, ids 1100, 1200 et suivants, une scène avec un message « Requires QuickTime for Windows version… ») : ce sont des écrans de l'équipe de développement (**hypothèse**, non explorés ; hors parcours normal). Un autre code (`10a8:041f(0x39a0, 0xfd39, 0xd204, 0xa675)`, touche 0x20 dans `1198:05b3`) active un mode de test `[a43f]` (message « you got it ») qui ouvre des raccourcis (saut d'écran par les touches `a` à `p` sur la carte, pas à pas, etc.). Aucun n'est utile à l'implémentation.

## 2. Choix des Zoombinis (`PICKER`, écran 3)

Archive `PICKER.MHK` : `REGS` 1000, 1001, 1200, 1201 ; `NODE` 1000 (8 points) ; `PATH` 1000 ; `SHPL` 1001, 2000, 4000 ; `tBMP` 100, 1000, 1001, 1100, 1200, 2000, 4000, 4100 à 4400 ; 53 `SCRB` (1000 à 1013…). Format des ressources : `engine.md`. Chargement : `1128:006d` (appelle `1168:2a5c(1000)` pour `NODE`/`PATH`).

### 2.1 Les Zoombinis : 4 attributs de 5 valeurs

Un Zoombini est décrit par **4 octets** de valeurs 1 à 5 (**sûr**) : les 625 combinaisons (5⁴) sont les 0x271 Zoombinis du jeu. L'ordre des octets est celui des quatre groupes de boutons du choix (identifiants 1 à 5, 6 à 10, 11 à 15, 16 à 20 → octet 0 à 3, `1128:061a`, `1128:1122`). L'attribution d'un nom à chaque octet n'est pas écrite dans le code ; l'ordre cheveux, yeux, nez, pieds suit la présentation du jeu mais n'est **pas vérifié** (hypothèse) et le manuel PDF est un scan sans couche de texte exploitable (aucun OCR installé). Les noms des 5 valeurs de chaque attribut sont donc un point ouvert (7).

Un octet vaut 0 tant que le groupe de boutons n'a pas de sélection (`[8c7c..8c7f]`, `1128:13a4`).

### 2.2 Composition du groupe de 16

- **Groupe** : 16 places au plus (`[8cea] = 0x10`, 16 emplacements de coordonnées `DS:1470:03cc`, identifiants d'objets de scène `[9714..]`). Un Zoombini se crée en choisissant une valeur dans chacun des 4 groupes de boutons (bascule : recliquer retire la sélection, `1128:061a`), puis en cliquant le bouton « ajouter » (cas 1 de `1128:079c`, `1168:0755` crée le personnage et lui tire un octet aléatoire `10a8:04e8(0x40,0)`) (**sûr**).
- **Au plus deux exemplaires identiques** : un tableau de 625 octets (`S+0xAB94`, indexé par `a0×125 + a1×25 + a2×5 + a3`, avec ai = valeur−1) compte les exemplaires ; un type n'est proposé que si son compteur est inférieur à 2 (`1128:13a4`) ; il augmente à la création et diminue au retrait (`1128:16ac`) (**sûr** pour l'arithmétique ; sa lecture « deux exemplaires au plus » est **probable**).
- **Compteurs** : `S+0x48` = nombre de Zoombinis créés (incrémenté à l'ajout, décrémenté au retrait, borné à 0x271 = 625) ; le groupe est dit **complet** (`[8ce4] = 1`, `1128:1b20`) quand il compte 16 membres, ou quand les 625 sont créés (dernier groupe plus petit) (**sûr**).
- **Retrait** : cliquer un Zoombini du groupe (cas 7) le fait glisser hors du groupe, remet ses 4 valeurs dans les groupes de boutons (pour en refaire un), libère son compteur (`S+0x48 −= 1`, `1168:170f`) (**sûr**).
- **Case 2** : le personnage guide dit une phrase tirée au hasard parmi 12 (`1168:575b`, `10a8:04e8(0xc,0)`).
- **Case 3** : efface la sélection des 4 groupes.
- **Case 4 (« au hasard »)** : tire les 4 valeurs avec `10a8:04e8(5,1)` jusqu'à obtenir un type disponible (64 essais), puis, à défaut, prend la dernière combinaison encore disponible dans un balayage des 625 (`1128:143a`) (**sûr**).
- **Case 5** : retour à la carte (`[8554] = 1`). **Case 6 (départ)** : refusé tant que le groupe n'est pas complet (phrase d'aide tirée au sort) ; sinon les 4 premiers Zoombinis du groupe font leur animation de départ (`1168:4231`, rôle probable de `NODE`/`PATH` 1000 : trajectoire de sortie) et `[8556] = 7` : l'écran suivant est **7 (les gorges allergiques)**, avec la transition `XFER` 1 (3 → 7) (**sûr**).
- **Reprise d'un groupe incomplet** : `1128:006d` recopie dans le groupe de travail la réserve `S+0xA1FC` (groupe en cours de constitution, 6.3) ; le groupe passe de `S−0x5E04` à `S−0x56D2` à l'entrée (`1128:006d`) et revient à la sortie (`1128:049a`).
- **Mode caché** : avec `Maj` tenue (`1148:0566(0) == 0x800`) et le mode de test `[a43f]` actif, le bouton « au hasard » remplit tout le groupe, et un autre bouton force `S+0x48 = S+0x4E = 0x270` (une seule place restante, pour tester la fin du jeu). Sans le mode de test, aucun effet (**sûr**, hors parcours).

### 2.3 Interface

- Boutons : 20 boutons d'attributs (entrées de 0x24 octets à `1470:0000`, identifiants 1 à 20) et 6 boutons d'action (entrées de 0x24 octets à partir de `1470:02ac`) ; le `switch` de `1128:079c` traite les actions 1 (ajouter), 2 (guide), 3 (effacer), 4 (au hasard), 5 (carte), 6 (départ), 7 (retirer un Zoombini du groupe). L'état « enfoncé » alterne par image (`SHPL` / `tBMP`, `1128:0eaf`, `1128:1122`). Le rôle exact des 4 `REGS` (1000 et 1001 : 108 octets ; 1200 et 1201 : 46 octets) est dans `engine.md`.
- Mascottes animées : si `S+0x20 == 0` (réglage « plus d'action »), deux personnages décoratifs sont ajoutés (`1128:1aa1`, objets 0x1008 et 0x1009), dont l'état (`S+0x26`, 0 à 3) change à chaque visite (`1128:17b9`) ; `Ctrl+W` (code 0x17) les fait avancer.
- À l'ouverture, une phrase d'accueil est tirée (`[8cf2]` = 0x4E4A, 0x4E4B ou 0x4E4C selon la provenance et le nombre de Zoombinis restant à créer) : identifiants de sons `\0SND` (`engine.md`).

## 3. Carte (`MAP`, écran 1)

Archive `MAP.MHK` : 8 `SCRB` (1000 à 1007), 1 `SHPL` 300, 2 `tBMP` 300 et 1000. **Aucun** `NODE` / `PATH` / `REGS` : la carte est décrite par du code (positions codées dans le segment de données).

### 3.1 Lieux, étapes, chemins

Seize lieux (index 0 à 15 de `STRL` 2000, numéro de lieu = index+1 dans `1110:0819`), reliés en **quatre étapes de trois épreuves** (`1108:02f9` : étape = `((écran−7)/3 & 3) + 1`, **sûr**) :

| Étape | Texte `STRL` 2006 | Épreuves (écrans) | Départ → arrivée |
|---:|---|---|---|
| 1 | « le gros, la brute et le gourmand » | gorges allergiques (7) → grottes de passe-clos (8) → hutte à pizza (9) | Zoombinîle → abri du rocher (camp 1) |
| 2 | « le marais quajeux » | bac du père mathieu (10) → têtards tatoués (11) → fosse de monte-pierre (12) | camp 1 → aire de grozarbre (camp 2) |
| 3 | « la forêt de chaussée » | nizibooms (13) → hôtel du temps-compté (14) → muraille de signes (15) | camp 1 → camp 2 |
| 4 | « les monts du désespoir » | tanière du sphinx (16) → piège de cristal (17) → gouffre des véhibules (18) | camp 2 → Zoombiniville |

Les étapes 2 et 3 sont **deux chemins parallèles** entre les deux camps (embranchement du camp 1, **sûr** : `10b0:0819` envoie à 10 ou à 13) ; chacune est parcourue dans l'ordre fixe indiqué (**sûr** : enchaînements `[8556]` fixés dans `10c0:0a99` → 8, `1190:0be9` → 9, `1130:1803` → 4, `10d8:0984` → 11, `10f8:1b3a` → 12, `1170:08f5` / `1170:0532` → 5, `10e0:0ae5` → 14, `10e8:1cea` → 15, `1120:0f25` → 5, `10c8:130f` → 17, `1158:1429` → 18, `1118:2285` → 6).

Chaque épreuve se termine par `[8556] = 1` (retour à la carte) en cas d'échec ou d'abandon, par l'écran suivant du tableau en cas de réussite. Les 12 lieux d'épreuve du `STRL` 2000 sont aux index 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13, 14 ; les lieux restants sont 0 (Zoombinîle), 4 (l'abri du rocher), 11 (l'aire de grozarbre) et 15 (Zoombiniville).

Les 16 transitions `XFER` (4.1 et 5.1) suivent les segments : 3→7, 7→8, 8→9, 9→4, 4→10, 10→11, 11→12, 12→5, 4→13, 13→14, 14→15, 15→5, 5→16, 16→17, 17→18, 18→6.

### 3.2 La carte elle-même

- Positions des lieux : 16 couples (x, y) à `1530:1634` (rectangle de sensibilité ±0x14 × ±0x0F autour de chaque point, `1110:0000`) ; légende et panneaux dessinés par `1110:0f5c` (légende) et `1110:12a9` (menu de niveaux de l'entraînement).
- Survol (`1110:0562`, tick) : le nom du lieu (`STRL` 2000) s'affiche, seuls les lieux actifs répondent (tableau `[87fc..880c]`, 0 = inactif).
- Clic (`1110:0819`) : voir le tableau 1.2. **En aventure** (`[96f2] == 0`), seuls sont cliquables : **Zoombinîle** (lieu 1 → écran 3), **l'abri du rocher** (lieu 5 → écran 4, si `S+0x50 & 0xF != 0`, c'est-à-dire l'étape 1 terminée au moins une fois), **l'aire de grozarbre** (lieu 12 → écran 5, si `S+0x52 & 0xFF != 0`), **Zoombiniville** (lieu 16 → écran 6, si `S+0x51 & 0xF != 0`) ; les 12 lieux d'épreuve ne se choisissent pas à la carte (**sûr**, `uVar3` reste nul). **En entraînement**, tous les lieux sont cliquables.
- Panneau « retour à la partie » (`1110:0f5c`, `STRL` 2002) : quatre états selon l'avancement, le choix proposé s'allonge : 5 à 8 (« retour à la partie: aller à zoombinîle »), 9 à 12 (« … ou à l'abri du rocher »), 13 à 16 (« … l'abri du rocher ou aire grozarbre »), 17 à 20 (« … l'un des deux camps de base ou zoombini- ville ») ; l'état est celui de `S+0x50`, `S+0x52` (ou `S+0x51`) (**sûr**).
- Activation d'un lieu (`[87fc + i]`, `1110:1c75`, une valeur par lieu) : pour chaque étape, si son niveau (`S+0xC2…`) est 0, la valeur d'un lieu d'épreuve est le masque de ses niveaux réussis (`S+0x56..0x61`, bits bas ; donc 0 ou 1 au niveau 0) et celle du camp ou de la ville d'arrivée est le masque de l'étape (`S+0x50 & 0xF`, `S+0x52 & 0xF`, `S+0x52 >> 4`, `S+0x51 & 0xF`) ; si le niveau est 1 ou plus, tous les lieux de l'étape valent niveau+1. 0 = lieu non affiché / inactif ; sinon la valeur−1 sert de numéro de variante d'icône (`1110:1601` : +0x10 images par variante) (**sûr** pour le calcul, **probable** pour l'interprétation).
- Dialogue du menu : cliquer dans le rectangle `DS:3fde` ouvre le menu principal (mode 1, 1.4).

### 3.3 Camps de base (`BASECAMP` écran 4, `BCTWO` écran 5)

Archives : `BASECAMP.MHK` (`REGS` 9000, 9001 ; `NODE`/`PATH` 1000 ; 32 `SCRB` 1100…) et `BCTWO.MHK` (`REGS` 10000, 10001 ; `NODE`/`PATH` 1000 ; 30 `SCRB` 6000…). Les deux camps ont la même structure (code jumeau `10b0:*` / `10b8:*`) (**sûr**).

- **Rôle** : le joueur y dépose ou reprend des Zoombinis. Chaque camp possède une **réserve** de 625 emplacements de 22 octets (`S+0xCE` pour le camp 1, `S+0x3688` pour le camp 2, 6.3) : les Zoombinis « restés en arrière » y sont rangés (par ordre d'arrivée) et affichés cinq par cinq sur un présentoir avec flèches (boutons 4 à 7, `10b0:19b4` ; pas de 1 ou de 5). On les prend par glisser-déposer (`10b0:0a2a`, cas 1) pour reconstituer un groupe, et on peut y reposer un membre du groupe courant (cas 2) (**sûr** pour le mécanisme, **probable** pour le détail).
- **À l'arrivée** (`10b0:0027`) : le groupe qui vient d'arriver (survivants, `S−0x56D2`) est compté dans `S+0x4A` (camp 1) / `S+0x4C` (camp 2) ; une copie du groupe est gardée (réserve `S−0x5B9E` ou `S−0x5938`) pour la sauvegarde ; `1168:0824` compte les membres vivants (octet d'indice 8 de la fiche non nul).
- **Quitter** : les sorties sont `10b0:0819` cas 1 (**bac du père mathieu**, écran 10) et cas 2 (**nizibooms**, écran 13) pour le camp 1, `10b8:088c` (**tanière du sphinx**, écran 16) pour le camp 2, et le cas 3 renvoie à la carte. Elles ne sont autorisées que si le groupe compte **16 membres** (`[6df6]` = `FUN_1168_02cc() > 15`), ou en fin de jeu s'il ne reste plus de quoi former un groupe de 16 (`[6e00]` : `S+0x48 ≥ 625` et reste ≤ 15) ; sinon une phrase d'aide est prononcée (identifiants 0x4E51 à 0x4E56 pour le camp 1, 0x4E72 à 0x4E75 pour le camp 2) (**sûr**).
- **Décor** : 5 objets cliquables (0x457 à 0x45B) dont l'image change à chaque clic (cycle de leur nombre d'images) ; leur état est mémorisé dans `S+0x14..0x1D` (5 mots) (**sûr**).
- La fonction `10b0:1ac9` verse un groupe arrivé dans la réserve du camp (au premier emplacement libre ou à la fin si la réserve est pleine) ; `10b0:17df` et `10b0:1381` gèrent le défilement, `10b0:1217` cherche l'emplacement libre le plus proche de l'endroit où on lâche le Zoombini.

### 3.4 Perdus, restés en arrière, retour (`1168:36e1`, `1108:0000`)

`1168:36e1` est exécuté à la sortie de chaque écran d'épreuve (7 à 18) via `11a8:021c` / `11a8:03e7` (**sûr**) :
- **marque de réussite** : `S+0x56 + (écran−7)` reçoit le bit `1 << niveau` (4 bits bas : niveaux réussis) ; si aucun Zoombini n'a été perdu, le bit `0x10 << niveau` (4 bits hauts : niveaux réussis sans perte) ;
- **Zoombinis perdus** : tous les membres du groupe dont l'octet d'indice 8 de la fiche est nul sont les Zoombinis perdus pendant l'épreuve. Ils sont rendus **au dernier arrêt de l'étape** : étape 1 → la réserve du choix des Zoombinis (`S−0x5E04`, ils retournent à Zoombinîle) ; étapes 2 et 3 → la réserve du camp 1 (`S−0x5B9E`, `S+0x4A += perdus`) ; étape 4 → la réserve du camp 2 (`S−0x5938`, `S+0x4C += perdus`). Au camp, ils sont de nouveau sur le présentoir (3.3) ;
- **monument et progression** : si l'épreuve est la dernière de l'étape (écrans 9, 12, 15, 18), qu'aucun Zoombini n'est perdu, que l'étape a été faite d'une traite (`S+0x54 != 0`, drapeau mis à l'entrée de l'étape et effacé ici) et que le mode d'entraînement n'est pas actif (`[22e8] == 0`, `[96f2] == 0`), alors : le bit `0x10 << niveau` est posé, un **monument** est ajouté dans le premier des 16 emplacements libres (étape en `S+0xA2+k`, niveau+1 en `S+0xB2+k`, date du jour en `S+0x62`/`S+0x82`/`S+0x92`, via `10a8:0c75`) sauf s'il existe déjà un monument pour ce couple (étape, niveau), et le niveau de l'étape augmente de 1 (3 au plus, `[9700] = 1`) ;
- **Retour à la carte** : « Ce groupe de zoombinis sera perdu si tu retournes a la carte » (`STRL` 2018, 0 ; boutons 1 « Tant pis... » = perdre le groupe et 2 « Ah non ! » = rester, `[a1ee]`, `1160:05c9` dialogue 4). Revenir à la carte depuis une épreuve ou un camp ne vide pas la partie mais le groupe en cours, qui n'est pas restitué (`1110:03b8` met `S−0x56D2 = 0` hors entraînement, `1128:049a` aussi) (**probable** pour le détail de la perte).
- **Compteurs** : `S+0x48` Zoombinis créés, `S+0x4A` présents au camp 1 (arrivés ou renvoyés), `S+0x4C` présents au camp 2, `S+0x4E` arrivés à Zoombiniville (voir 4) ; reste à créer = `625 − (S+0x4A + S+0x4C + S+0x4E) − membres du groupe` (`1128:079c` cas 6) (**probable**).

## 4. Zoombiniville (`TOWN`, écran 6)

Archive `TOWN.MHK` : 61 `SCRB`, 6 `SCRS` (4999 à 5004), 4 `REGS` (2000, 2001, 6000, 6001), 1 `SHPL` 1200, 7 `tBMP`. Chargement : `1188:0128`.

### 4.1 Arrivée et population

- À l'arrivée, les survivants du dernier groupe sont versés dans la table de population (`1188:1bf5`, 625 entrées de 22 octets à `S+0x6C42`, une par Zoombini : octets 0 à 3 = les 4 attributs, 4 à 7 = identifiant, 12 à 21 = 10 octets propres au Zoombini copiés de la fiche du groupe) et `S+0x4E += survivants`. Si `S+0x4E > 0x270` (les 625 sont arrivés), `[9fe2] = 1` : fin du jeu (phrase finale 3003 = 0xBBB) (**sûr**).
- **Texte de population** : « population de zoombiniville » (`STRL` 2008) avec le nombre `S+0x4E`.
- **Habitants visibles** : au plus 20 Zoombinis (`iVar6 < 0x14`) tirés parmi les plus récents de la table, placés au hasard sur le décor de 1 600 points de large (`10a8:04e8(0x63f,0xfec0)`), qui marchent (`1168:09f7`).
- **Objets décoratifs aléatoires** (`1188:1cdf`) : jusqu'à 3 objets de scène créés au hasard dont le nombre total à produire (`[a026]`) vaut 1, 3, 6, 10 puis 15 quand la population dépasse 100, 200, 300, 400 puis 500 (les seuils s'ajoutent), 0x14 à l'arrivée du dernier Zoombini puis 0x28 ; leur nature n'est pas identifiée (**probable** pour le mécanisme).
- **Défilement** : cliquer à gauche (x < 0x50) ou à droite (x > 0x230) de l'écran décale le décor de 320 points, avec bouclage à 1 600 (0x640) (`1188:1071` → `1188:0a88`) ; `S+0x1E` mémorise la position (0 à 5) et `1188:15b3` l'applique à 4 objets de scène (ids 1000, 0x3E9, 0x3EA, 0x3EB) (**sûr** pour le mécanisme, la signification des 6 positions est à confirmer).

### 4.2 Monuments (`STRL` 2012 à 2016)

- **Nombre de bâtiments** : `min(16, (S+0x4E − 20) / 37)` (`1188:0128`, `local_18`), tirés au hasard sans répétition parmi 16 types (`1098:0098` avec masque) (**sûr**).
- **Un monument = une étape × un niveau** : 16 emplacements `S+0xA2+k` (étape, 1 à 4) et `S+0xB2+k` (niveau, 1 à 4), remplis par `1168:36e1` (3.4). Le survol d'un bâtiment (`1188:1832`, 5 lignes) affiche : (0) le type de bâtiment (`STRL` 2014, 16 types : monument, moulin, observatoire, bowling, magasin, piscine, square, kiosque à musique, école, bibliothèque, caserne de pompiers, opéra, hôtel de ville, beffroi, musée, palais), (1) l'exploit (`STRL` 2016 à l'indice `(étape−1)×4 + niveau−1`), (2) « quand le voyage était: » (`STRL` 2012), (3) le niveau (`STRL` 2004 à l'indice `niveau+1`), (4) la date « jour mois année » formatée par `"%d %s %d"` avec le mois de `STRL` 2010 (janvier à décembre) (**sûr**). Le type de bâtiment affiché pour un emplacement vient d'une table du code (`DS:010D…`) que je n'ai pas extraite (l'ordre des 16 types, point ouvert).
- **Les 16 textes `STRL` 2016** : étape 1 (index 0 à 3 : gorges, grottes, hutte à pizza), étape 2 (4 à 7 : bac, têtards, fosse), étape 3 (8 à 11 : nizibooms, hôtel, muraille), étape 4 (12 à 15 : sphinx, piège de cristal, véhibules) ; chaque étape a 4 variantes (une par niveau).
- **Décor cliquable** : 16 zones (`1188:16d4` : `DS:3968` position de chaque bâtiment, `DS:3a0c` identifiant du sprite, `REGS` 6000 / 6001) ; un bâtiment n'est affiché que si son emplacement est rempli ; le sprite d'indice 4 de la table active un objet animé (`[a00e]`, `1188:0936`) (**sûr** pour le mécanisme).
- **Animations** : le dernier groupe arrivé est joué (`S+0x46` mémoire de dialogue de l'écran, `1168:5c57`), des événements aléatoires (`1188:0ce5`) toutes les 120 ou 600 « ticks » (`[a01c]` selon `[908a]`) lâchent des Zoombinis sur le décor (`1168:3f76`) ; sons `\0SND` à `0x4E76`..`0x4E78` / `0x4E7D` selon la progression (**probable**).
- **Fin de partie** : atteinte quand `S+0x4E` dépasse 0x270 ; `[9fe2] = 1` impose la phrase finale (0xBBB) et la répète de façon aléatoire (`1188:0ce5`), avec plus d'étoiles ; il n'y a pas d'écran de fin séparé : on reste à Zoombiniville, le menu reste disponible (**probable**).

## 5. Transitions, options, crédits, dialogues

### 5.1 Transitions (`XFER`, écran 2, `11b0:00c4`)

Archive `XFER.MHK` : 34 `SCRB`, 11 `SCRS` (5199 à 5204, 6200 à 6204), 6 `SHPL`, 16 `tBMP`. Elle joue la **marche du groupe** entre deux écrans, du point de départ au point d'arrivée de l'un des 16 segments (3.1). Le segment (`[4180]`, 1 à 16) est choisi dans `11b0:00c4` par la paire (`[855a]` écran quitté, `[8558]` écran d'arrivée), puis une phrase du narrateur est choisie selon la catégorie d'arrivée (`[ad26]`, 0 à 5 selon le camp, l'étape ou Zoombiniville), le niveau (`1168:515d`) et la mémoire de dialogue de l'écran (`S+0x28+2k`, `1168:5c57`). À la fin, la transition envoie à `[8558]` (`11b0:175c`). Désactivable par l'option « transitions désactivées » (`[854e]`). La table `S+0x28..S+0x47` contient donc **16 mots de mémoire de dialogue**, un par écran : 3 (0x28), 7 (0x2A), 8 (0x2C), 9 (0x2E), 4 (0x30), 10 à 12 (0x32, 0x34, 0x36), 13 à 15 (0x38, 0x3A, 0x3C), 5 (0x3E), 16 à 18 (0x40, 0x42, 0x44), 6 (0x46) (**sûr**).

### 5.2 Options (`STRL` 2023, `11a0:35ca`, `1198:05b3`)

Les options sont enregistrées dans la partie (`S+0x04..0x0A`, `S+0x20`) et lues par `10d0:07f5` (**sûr**) :

| Champ | Globale | Défaut | Effet | Raccourci | Messages `STRL` 2023 (0 = premier) |
|---|---|---:|---|---|---|
| `S+0x04` (octet) | `[a43a]` | 1 | musique de fond (arrête `[a402]` à la coupure) | `Ctrl+Y` (0x19), bouton 5 | 2 « sonores activés », 3 « sonores désactivés » |
| `S+0x05` (octet) | `[a43b]` | 1 | dialogues et effets sonores (arrête le canal `[3ea6]` à la coupure) | `Ctrl+B` / `Ctrl+V` (2, 0x16), bouton 6 | 0 « musique activée », 1 « musique désactivée » |
| `S+0x06` (octet) | `[a43c]` | 1 | souris aimantée | `Ctrl+J` (0x0A), bouton 7 | 8 « souris aimantée », 9 « souris normale » |
| `S+0x07` (octet) | `[a43d]` | 1 | affichage du curseur | `Ctrl+H` (8) | 6 « curseur masqué », 7 « curseur affiché » |
| `S+0x08` (octet) | `[a43f]` | 0 | mode de test (secret) | (code) | |
| `S+0x09` (octet) | `[a43e]` | 0 | auto-aimantation | `Ctrl+U` (0x15) | 12 « auto-aimantation oui », 13 « auto-aimantation non » |
| `S+0x0A` (mot) | `[854e]` | 0 | **1 = transitions désactivées** | `Ctrl+T` (0x14), bouton 8 | 10 « transitions activées », 11 « transitions désactivées » |
| `S+0x20` (mot) | | 0 | **1 = « moins d'action »** (moins d'animations décoratives, 2.3) | `Ctrl+G` (7) | 4 « moins d'action », 5 « plus d'action » |

**Attention (probable)** : le texte du message affiché pour la musique et celui des effets semblent **inversés** par rapport à l'action réalisée (la touche qui coupe la musique de fond affiche « sonores… » et celle qui coupe les dialogues et effets affiche « musique… ») : défaut de l'original à confirmer. Le menu (mode 1) range ses boutons dans l'ordre 15 « Dialogues & effets », 16 « Musique de fond » alors que les cas 5 à 8 de `11a0:35ca` agissent dans l'ordre `[a43a]`, `[a43b]`, `[a43c]`, `[854e]` : à vérifier à l'écran.

### 5.3 Dialogues, textes (`STRL` 1000 à 2023)

`TEXTSTR.MHK` contient 40 `STRL` : 1000 à 1048 (25 listes de messages d'erreur et d'installation, certaines en deux versions, 1040 = texte de version et droits, démo ou complet), 1100 (jeu de caractères admis pour les noms), 2000 (16 noms de lieux), 2002 (21 textes de la légende de la carte), 2004 (6 : légende et niveaux), 2006 (4 titres d'étape), 2008 (population), 2010 (12 mois), 2012 (« quand le voyage était: »), 2014 (16 bâtiments), 2016 (16 exploits), 2018 (47 : dialogues et menus), 2020 à 2022 (crédits), 2023 (14 messages d'options). Chargement : `1178:0103` : 410 hex (1040), 0x44C (1100), 2000, 2002 … 2018, 2020, 2021, 2023 (**sûr**). `FUN_1010:0000(index, liste)` renvoie la chaîne *index−1* (index 1-based) (**sûr**). Les textes de 2018 dans l'ordre : 0 à 4 (avertissement de retour à la carte + boutons), 5 à 7 (Charger, Enregistrer, Options), 8 à 10 (= Oui / = Non / Oui ou non ?), 11 à 18 (menu), 19 à 27 (listes et remplacement), 28 (« Equipe »), 29 à 41 (quitter, enregistrer), 42 à 46 (changement de langue).

### 5.4 Crédits (`STRL` 2020 à 2022)

- `STRL` 2020 : les rôles de la conception à la voix des Zoombinis (140 lignes) ; 2021 : localisation, marketing, qualité, remerciements, droits (145 lignes) ; **2022** : variante quasi identique de 2021 (« RESP. EQUIPE CONTROLE QUALITE » absent, capitalisation de « mcClellan ») **jamais chargée** par `1178:0103` : ressource inutilisée (**sûr**).
- Les crédits s'ouvrent probablement par le bouton « Equipe » du menu (mode 5 de `11a0:1737`, dessin dans `11a0:21c4`, tick `11a0:1f55`, qui charge une ressource d'id 20, `11a8:2ae6`). Le code qui lit `[9da6]` et `[9dae]` (les deux listes 2020 et 2021) pour les faire défiler n'est pas dans les fonctions du corpus (point ouvert). La boîte « À propos » (texte `STRL` 1040, 2e chaîne) s'affiche par `Ctrl+I` (code 9, `1198:0213`) (**sûr**).

## 6. Formats des fichiers de sauvegarde

### 6.1 `ZOOMBINI.WHO` (liste des parties)

Fichier de **1606 octets (0x646)** exactement, créé dans le répertoire du jeu au premier lancement (`10d0:0286`, mode 1 : tampon mis à zéro, mot 0 = 0x6B, écrit en entier). Little-endian (**sûr**, code de `10d0:0286`, `11a0:3914`, `11a0:1737`).

| Offset | Taille | Champ | Rôle |
|---:|---:|---|---|
| 0x0000 | u16 | signature = **0x006B** (octets `6B 00`) | une autre valeur → erreur « Fichier utilisateur invalide, supprimer et réessayer » |
| 0x0002 | u16 | prochain numéro de fichier de partie (`[a1f8]`) | sert à fabriquer `ZOOM%04d` ; incrémenté à chaque nouvelle partie enregistrée |
| 0x0004 | u16 | nombre de parties (`[a1f6]`, 0 à 50) | 0 → « Aucune Partie Enregistree » |
| 0x0006 + 32×i | 32 | entrée *i* (0 ≤ *i* < 50) | voir ci-dessous |

Entrée (32 octets, `6 + 50 × 32 = 1606`, **sûr** : décalages 0x20, +6 et +0x1D de `11a0:3914`) :

| Offset | Taille | Champ |
|---:|---:|---|
| +0x00 | 23 | nom de la partie, chaîne terminée par un octet nul (18 caractères au plus à la saisie) |
| +0x17 | 9 | nom du fichier sans extension : `ZOOM` + 4 chiffres + octet nul (ex. `ZOOM0000`) ; le fichier est `<nom>.txt` dans le même répertoire |

Le reste du tampon est à zéro. L'ajout d'une partie écrit le nom (`+0`), le nom de fichier (`+0x17`), `+4 = count + 1`, `+2 = compteur` et réécrit tout le fichier (`10d0:0286` mode 3). Écraser une partie de même nom (comparaison de la chaîne, `1000:0fc4`) réutilise l'entrée existante et son fichier. L'encodage des caractères accentués du jeu de saisie (`STRL` 1100) n'est pas vérifié (l'exemple est vide) : point ouvert 9.

**Vérification** : l'exemple `archives/zoombinis/setup/app/C/ZOOMBINI/ZOOMBINI.WHO` fait 1606 octets, tous nuls sauf le premier (`6B`) : fichier neuf, 0 partie, compteur 0 (**sûr**).

Lecture (`10d0:0286`) : mode 0 → lit les 0x646 octets dans un tampon temporaire et n'en retient que `[a1f6] = +4` ; mode 2 → retient `[a1f6] = +4` et `[a1f8] = +2`, dans le tampon fourni (liste de la boîte de chargement) ; mode 1 → écrit `+4 = [a1f6]` (à la fermeture) ; mode 3 → écrit le tampon fourni. Fichier absent : créé (`11e0:00a8`) puis traité comme neuf ; erreur d'ouverture, de lecture, d'écriture ou signature invalide → les messages `STRL` 1020, 1022, 1024, 1026, 1028 et 1030.

### 6.2 `ZOOMBINI.CFG` (configuration d'installation)

**Ce n'est pas un fichier de préférences du jeu** (**sûr**) : c'est le fichier INI de l'installeur Microsoft Setup (Broderbund) déposé dans le répertoire d'installation, texte Windows-1252 (octets 0xE9 et 0xF8 pour « Odyssée » et « Brøderbund »), lignes terminées par CR LF, **1609 octets** et 65 lignes dans l'exemple. Sections de l'exemple, avec leur offset : `[product]` (0), `[REGISTER]` (72), `[general]` (179), `[quicktime]` (446), `[directories]` (826), `[proggroup]` (973), `[pgi1]` (1031), `[pgi2]` (1113), `[E:\INSTAL16\SNOIDS]` (1226, liste des fichiers installés), `[build]` (1425), `[install]` (1466), `[proggroupR]` (1564). Il est écrit à l'installation, pas par le jeu.

Le jeu n'y lit que deux clés (`1138:00ee`, via l'analyseur INI du gestionnaire de configuration Mohawk `11d0:089c` ; la comparaison des noms est insensible à la casse, puisque l'exemple contient `InstallFromDir` et que le code cherche `INSTALLFROMDIR`, **sûr**) :
- `InstallFromDir` : répertoire du CD des données (`D:\` dans la section `[install]`, `D:` dans `[directories]`, l'exemple porte les deux ; la section interrogée n'est pas identifiée) ;
- `InstallToDir` : répertoire d'installation (`C:\ZOOMBINI\`, ou `C:\ZOOMBINI` dans `[directories]`), préfixe de `ZOOMBINI.WHO` et des fichiers de partie (`14b8:0156`, `1138:0000`, `1138:000a`).

Clé absente : « impossible de lire le fichier Zoombini.CFG » (`STRL` 1046, version anglaise « unable to read file Zoombini.CFG ») puis échec du démarrage. Les clés `wavedevice`, `mididevice`, `fontinstall`, `wing=1`, `qtwrequired=1` sont lues par l'installeur / par le lanceur MIDI `BROEMIDI` et `MOHAWK.WIN`, pas par `ZOOMBINI.EXE` (aucune autre clé n'est référencée dans ses chaînes). Pour notre implémentation, ce fichier n'a pas à être reproduit : seul `ZOOMBINI.WHO` et les fichiers de partie le sont.

### 6.3 Fichiers de partie (`ZOOMnnnn.txt`, `ZBUser.txt`, `ZBtemp.txt`)

Hors périmètre strict de la demande (le format de la ligne 6 vise le `.WHO` et le `.CFG`), mais indispensable pour comprendre les écrans, car tout l'état d'une partie est dans **un seul tampon de 0xAE05 = 44 549 octets** (alloué à `1160:0000`, écrit tel quel par `10d0:0113`), little-endian. Les décalages ont été obtenus à partir des accès du code (en notation 16 bits : `−0x56D2` = `+0xA92E`) (**sûr** pour les bornes de tables, **probable** pour le sens de plusieurs champs) :

| Offset | Taille | Contenu |
|---:|---:|---|
| 0x0000 | u16 | signature, comparée **octets échangés** à 0x6B à la lecture (`10d0:0734`) : probablement `00 6B` dans le fichier (le `.WHO` porte `6B 00`) ; **probable** |
| 0x0002 | u16 | `[a438]` (inconnu) |
| 0x0004 à 0x0009 | 6 octets | options (voir 5.2) ; 0x0A : mot `[854e]` |
| 0x0014 | 5×u16 | état des 5 objets de décor des camps (3.3) |
| 0x001E | u16 | position de défilement de Zoombiniville (0 à 5) |
| 0x0020 | u16 | « moins d'action » |
| 0x0026 | u16 | état des mascottes du choix des Zoombinis |
| 0x0028 à 0x0047 | 16×u16 | mémoire de dialogue par écran (5.1) |
| 0x0048 | u16 | Zoombinis créés |
| 0x004A / 0x004C / 0x004E | u16 | Zoombinis au camp 1 / au camp 2 / à Zoombiniville |
| 0x0050 / 0x0051 | u8 / u8 | masque des niveaux terminés : étape 1 / étape 4 (bits 0 à 3 = niveau) |
| 0x0052 | u16 | étape 2 (bits 0 à 3) et étape 3 (bits 4 à 7) |
| 0x0054 | u16 | étape en cours sans retour à la carte |
| 0x0056 à 0x0061 | 12×u8 | réussites par épreuve (écran−7) : bits 0 à 3 niveaux réussis, bits 4 à 7 réussis sans perte |
| 0x0062 / 0x0082 / 0x0092 | 16×u16 / 16×u8 / 16×u8 | date des monuments (jour, mois, année : ordre à confirmer) |
| 0x00A2 / 0x00B2 | 16×u8 chacun | étape (1 à 4) / niveau (1 à 4) des 16 monuments |
| 0x00C2, 0x00C4, 0x00C6, 0x00C8 | 4×u16 | niveau (0 à 3) des étapes 1 à 4 |
| 0x00CA / 0x00CC | u16 | écran précédent / écran de reprise (−1 = nouvelle partie) |
| 0x00CE | 4 + 625×22 | réserve du camp 1 (`[6de6]`) |
| 0x3688 | 4 + 625×22 | réserve du camp 2 (`10b8:0030`) |
| 0x6C42 | 4 + 625×22 | population de Zoombiniville (`1188:0128`) |
| 0xA1FC | 614 | groupe en cours de constitution (réserve de l'écran 3) |
| 0xA462 | 614 | réserve du groupe du camp 1 |
| 0xA6C8 | 614 | réserve du groupe du camp 2 |
| 0xA92E | 614 | **groupe courant** (6 octets d'en-tête : nombre de membres, 2 drapeaux, puis 32 fiches de 19 octets) |
| 0xAB94 | 625 | compteur d'exemplaires par type de Zoombini (2.2) |

Fiche de 19 octets : 0 à 3 = valeurs des 4 attributs (1 à 5) ; 4 à 7 = identifiant (double mot) ; 8 = présent dans le groupe (1) / perdu (0) ; 9 à 18 = 10 octets d'état propres au Zoombini (nom généré ? le jeu contient des tables de syllabes en `DS:14C8..14E0` et `1168:09f7` construit le personnage). Entrée de réserve ou de ville de 22 octets : attributs (4), identifiant (4), 4 octets inconnus, 10 octets d'état. Les écritures se font au changement d'écran (1.5).

## 7. Points ouverts

1. **Noms des 4 attributs et des 5 valeurs de chacun** (cheveux, yeux, nez, pieds ?) : aucun texte du jeu ne les nomme ; le manuel PDF est un scan sans texte (pas d'OCR dans l'environnement). À établir en regardant les `tBMP` / `SCRB` du choix des Zoombinis (`PICKER.MHK`) ou à transcrire depuis le manuel ; l'ordre des octets d'attribut 0 à 3 n'est pas confirmé.
2. **Correspondance emplacement de monument → type de bâtiment** (table de `1188:1832` et `1188:16d4` : `DS:3968`, `DS:3A0C`, sprites des 16 bâtiments) et le détail des événements de Zoombiniville (`1188:0936`, `1188:0ce5`, `1168:3f76`).
3. **Lecteur des crédits** (`STRL` 2020 et 2021 chargées en `[9da6]`, `[9dae]`, jamais lues par une fonction du corpus ; `STRL` 2022 inutilisée) ; et la fonction de la scène `SCRB` 20 et du bouton « Options » (mode 5).
4. **Entrée exacte en mode entraînement** par l'interface (la touche `Maj` est certaine ; l'objet 0x3EC / `1110:199b` est probablement l'interrupteur à l'écran) et ce que `[9700]` retire au niveau.
5. **Ordre des deux messages musique / effets** (5.2) et le lien entre les boutons du menu et les bascules `[a43a]`/`[a43b]` : à vérifier en jouant l'original.
6. **Sémantique précise des compteurs** `S+0x48`, `S+0x4A`, `S+0x4C`, `S+0x4E` et du second drapeau du groupe (`S−0x56D0`, `S−0x56CE`), qui commandent la restitution des Zoombinis perdus (3.4) ; la règle « au plus deux exemplaires » du tableau `S+0xAB94`.
7. **Écrans 19 à 21** (`PICKER.MHK` ids 1100 et suivants, `1110:20f6`, `1110:2f46`, `1110:2b23`…) et mode de test `[a43f]` : outils de développement présumés ; hors parcours.
8. **Textes d'erreur** : correspondance exacte entre les messages d'erreur de `STRL` 1000 à 1048 et les 23 cas de `1160:0000` (la table `[2732]` est une suite de pointeurs vers les chaînes anglaises de `1530:2737…` ; les textes français sont en `STRL`).
9. **Encodage des noms de parties** du `.WHO` (caractères accentués de `STRL` 1100) : à vérifier sur un fichier réel contenant des accents (l'exemple est vide).
10. **Date des monuments** : ordre exact (jour, mois, année) des trois tableaux `S+0x62`, `S+0x82`, `S+0x92` (`10a8:0c75`).
11. **Logos** : `LOGO025.MOV` est le seul film nommé par le code ; le rôle de `LOGO027*.MOV` et de `LOGO025B/C.MOV` n'est pas établi (variantes de langue ou de version).
