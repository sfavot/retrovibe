# Armaeth : personnages, combats, mort et fin (`AM1.EXE`)

Tâche R2. Référence pour la réimplémentation TypeScript du **comportement des personnages** d'*Armaeth* (Grandslam 1994, DOS) : le héros (Killian), les créatures (ours, pie, crapaud, Sarhûls), les nains, Prytwen, Minas Thyl, les feux, les mécanismes à états (stèle, dalle, herses), la mort, les sorts, la fin du jeu. Il complète `engine.md` (noyau : boucle, objets, mouvement, § 9 et § 13), `parser.md` (verbes, réactions § 6.7, file de messages) et `screens.md` (E13 mort, E14 fins). Les objets (modèles, inventaire) sont décrits dans `objects.md`, le déplacement et les trajets dans `movement.md`, l'interface dans `interface.md` (écrits en parallèle) : ce document n'en reprend que ce dont les algorithmes ont besoin.

Sources : décompilation et désassemblage Ghidra (`archives/armaeth/re/decomp/*.c`, `disasm.txt`, adresses `segment:offset` Ghidra, segment de base `1000`), tables extraites de `AM1.EXE` (`DGROUP` = segment `42d7`), données `A1FCFG.SYS` (monde initial), `A1FANI.SYS`, `A1FMSG.SYS`/`A1FTMS.SYS` (les textes sont cités **par identifiant** et décrits en quelques mots, jamais recopiés). Aucune exécution dynamique : toute durée « réelle » est un nombre de tics (§ 1.1).

**Confiance** : **certain** = lu dans le code (désassemblage, tables de saut décodées à la main) ; **probable** = rôle déduit de plusieurs sites d'appel, des données ou des messages ; **hypothèse** = lecture plausible non établie. Les messages sont notés `G12` (classe `G` = 7, id 7012), `V344` (classe 22), `S70` (classe 19), `Z2` (classe 26), `E4` (classe 5) ; en code la classe est la lettre ASCII (`0x47` = `G`, `0x56` = `V`, `0x53` = `S`, `0x5a` = `Z`, `0x45` = `E`).

## 0. Ce qu'il faut retenir

1. **`Ego` (+0x2D) n'est pas une « classe d'IA » générique** : c'est l'**octet d'état** de l'objet, et son sens dépend du `Num`. Seul le **héros** (`Num 1`) passe par le répartiteur `246c:000a` qui aiguille sur `Ego` 0..8 (§ 4). Tout autre personnage a **sa propre procédure `Fct`** (table 2 de `1ec8:000a`, § 2) qui lit son `Ego` à sa façon. Le texte de description d'un objet (messages classe `30 + Ego`, numéro `Num`) est la **meilleure légende** de ses états (§ 3). Cela corrige `engine.md` § 9.1.
2. **Il n'y a ni points de vie ni jet de combat** dans le noyau. Un combat est une **animation scénarisée** (`ANM`, `A1FANI.SYS`) entre deux objets liés (« partenaires », `Bag` +0x3A), dont la **fin** déclenche une table de résolution propre au personnage (§ 7.2 Prytwen, § 7.3 nains). Les armes/protections (`bouclier 205`, `hache 206`, `épée 314`, `baguette 320`, `talisman 321`...) sont testées **dans l'inventaire** par numéro de modèle.
3. **La mort = destruction de l'objet héros** (`19a6:01a5`), précédée d'une animation `ANM` et d'un message `G` (§ 6). Quatre variantes : destruction sans reste, objets laissés dans la salle, **dépouille** (`Num 2`, § 6.4) qui garde l'inventaire, ou **disparition** (`Err 0x0E`).
4. **Deux familles de mouvements** : les personnages « libres » demandent un trajet au moteur (`22ef:0000` vers un objet, `228e:0000` vers une sortie, `2151:0006` vers un point aléatoire, puis `30d9:0006` à chaque tic) ; les animations et chutes posent directement `Hor`/`Ver`/`Prf` (∈ {-1,0,+1}) et laissent `179d:0004` appliquer. Le héros se déplace aussi au clavier (flèches, `+`/`-` : `interface.md` § 7) ; à la souris il suit un trajet (`Def` +0x6E) avec l'outil bottes.
5. **Les types de sol (`Sol`) pilotent les accidents** du héros : eau, feu, lave, vide, pentes, sol friable, passerelle... (§ 4.3, table complète). `13a8:000a` décide **quel `Num`/`Ego`/`Anm` accepte quel type de sol** (§ 5) ; le trajet et le déplacement s'y plient.
6. **Les perceptions sont triviales** : un PNJ parcourt la liste d'objets de **sa salle** (jamais plus loin), filtre par `Num`, teste la **visibilité** (`219b:0000` : champ `Inv` nul et lumière suffisante) et le contact par `1a50:0006` (même `P`, recouvrement X/Y). Pas de distance seuil ni de plan : seule la salle compte (§ 1.5).
7. **Pas de compagnon** : aucun objet ne suit le héros. Les seules « liaisons » sont les animations à deux (partenaires) et le transport d'un Prytwen assommé (héros `Ego 8`, § 4.2.8).
8. **La fin** : couronnement (`Num 333`, salle 108, § 10.1), trois passages secrets qui sont aussi les **portes de niveau** (§ 10.2), abandon (`CM4`). Aucun test de victoire par le score : le verdict `S51`-`S54` compare le trésor porté au trésor total du monde (§ 10.3).

## 1. Primitives communes

### 1.1 Cadence

Un « tic » = un tic de monde (`engine.md` § 3 : un toutes les `4b51 + 1` images, environ 10/s à 70 Hz au délai 6) : tous les compteurs `Tim`, les temporisateurs différés (`23a2`) et les durées ci-dessous sont en **tics**. L'horloge de jeu compte **100 tics = 1 minute de jeu**.

### 1.2 Convention d'appel des modules (registres cachés)

Le décompilat masque les arguments passés en registres ; les relevés suivants viennent du désassemblage (certain).

| Fonction | Signature réelle | Rôle |
|---|---|---|
| `1a37:007f` | `AL`=`Gst`, `DL`=`Mob`, `BL`=`Ego` ; pile : drapeau, `Dep`, `Txt`, `Fig`, objet | **change l'état** d'un objet : écrit `Gst` +5, `Mob` +6, `Dep` +7, `Txt` +8, `Ego` +0x2D, `Fig` +0x2E puis re-place l'objet (`1aba:000e`). Le drapeau est le **mode de placement** passé à `1aba:000e` : `0xFF` = choix automatique d'après `Typ`/`Xyp` (Typ 0 : mode 6 ; Typ 1/2 : `Xyp` 0 -> mode 0, 8 -> 8, sinon **mode 5** = position valide la plus proche du même type de sol) ; toute autre valeur est utilisée telle quelle (2 = `Xyp = 2` sans recherche de position). Si l'ancien et le nouveau `Mob` diffèrent et que l'un des deux vaut 0 (statique <-> mobile), le fond statique est redessiné (`DX = 99`). |
| `1a37:003a` | `AL`, `DL`, `BL` comme ci-dessus ; pile : `Fig`, objet | idem en **gardant `Dep` et `Txt`** |
| `1a37:0002` | `AL`=`Ego`, `DL`=`Fig` ; pile : objet | idem en gardant `Gst`, `Mob`, `Dep`, `Txt` |
| état d'entrée d'un gestionnaire (`246c:0240`, `25ea:0008`, `25ea:03ca`, `26ab:*`, `2594:*`) | `AL` = `Fig` d'entrée (0 = **continuer**, sans entrer), `DX` = classe de message, `BX` = numéro ; pile : objet | `AL` non nul : exécute le **corps d'entrée** (`Gst`/`Mob`/`Ego`/`Fig`/`Dep` de l'état, remise à zéro de l'animation et de `Ver`, message `DX:BX` via `209c:0092`) ; le répartiteur appelle toujours avec `AL = 0` |
| `209c:0092` | `AX` classe, `DX` numéro ; pile : objet | affiche le message **si l'objet est dans la salle du héros** (héros de `Num 1` dont le conteneur +0x5C est la salle de l'objet) ou si la salle de l'objet est la salle chargée pendant un script (`4b34`) ; ne fait rien si `AX <= 0` ou `DX <= 0` |
| `209c:000c` | idem | comme `0092` mais affiche aussi si le héros **contient** l'objet ou est **contenu** par lui |
| `16f5:0132` | `AX` = id `ANM`, `DX` = `Gst`, `BX` = `Mob` ; pile : objet, partenaire (far ou nul), `Ego`, `Hor`, `Ver`, `Prf`, mode d'affichage, classe, numéro | **démarre une animation scénarisée** (§ 1.3) |
| `2594:0004` | `AX` = id `ANM` (0 = ne rien démarrer), `DX` classe, `BX` numéro ; pile : partenaire, objet | version **héros** : démarre l'animation (`Gst 7`, `Mob 1`, **`Ego 6`**, `Ver 1`) puis, à chaque appel, interroge l'animation et applique la conséquence de sa fin (table § 6.2) |
| `2405:0000` | `AX` = variante 0..2, `DX` classe, `BX` numéro ; pile : objet | remplace l'objet par une **dépouille** (§ 6.4) |
| `19a6:01a5` | pile : conteneur de repli (far), objet | **détruit** l'objet ; le contenu est détruit si `AL = 0`, déplacé dans le conteneur de repli sinon (`19dc:04f1`) ; remet `4bfe` à 0 si l'objet était le héros |
| `19dc:0000` | pile : conteneur de destination, objet | **déplace** l'objet dans un conteneur (salle ou objet) |
| `23a2:0002` | `AX` opération, `DX` événement, `BX` valeur ; pile : objet, clé de procédure | temporisateur différé (§ 9.2) |
| `2255:00e8` | `AX` chapitre 0..9, `DX` indice 0..99 | attribue des points (`engine.md` § 9.3) |
| `2273:0190` | objet | `Hor = Ver = Prf = 0` |
| `2273:000c` | partenaires A, B | **fait face** (probable) : annule les trajets et les vitesses de A (si héros) et de B, puis, si B est mobile, calcule le sens de A par rapport à B (P, puis X, puis Y pour les `Dep` non nuls) et pose via `2151:0006` une cible de B dans ce sens : B se tourne vers A et s'en approche |
| `2683:023e` | objet | prélude d'entrée d'état du héros : décharge l'animation `Anm` si elle est active, `Ver = 0`, `Anm = 0`, coupe le son, `4b50 = 7` (le joueur reprend la main) |

Classes de message utilisées : `G` (accidents, combats, morts), `V` (réponses de verbes et dialogues), `S` (système), `Z` (lave), `E` (jingles et erreurs).

### 1.3 Animations scénarisées (`ANM`, `A1FANI.SYS`)

`A1FANI.SYS` : 47 animations. Enregistrement de 12 octets lu par `16f5:00ec` (recherche par id) : mot 0 id ; mot 1 **classe de son** (`0x41` = `A` si un son est joué, `0x20` sinon) ; mots 2 et 3 : numéros du son (sinon 0) ; mot 4 nombre de pas ; mot 5 indice du premier pas. Chaque pas est un mot : **octet haut = `Fig`** (séquence d'images), **octet bas = nombre de boucles** de cette séquence (`Tim`). Confirmé sur les 47 enregistrements (ex. ANM 2 : `0/1 1/2 2/1 3/4`).

`16f5:0132` (certain) : annule les trajets (`30d9:0114`) ; `Bag` +0x3A de chaque objet reçoit la `Ser` de l'autre (lien de partenaires, 0 sans partenaire) ; décharge la ressource sprite ; `Anm` +0x30 = id ; `Nbr` +0x36 = nombre de pas ; `Hor`/`Ver`/`Prf` = arguments ; `1a37:003a(Gst, Mob, Ego, Fig 0)` ; charge le premier pas (`16f5:038c` : `Tim` = octet bas, `Fig` = octet haut) ; affiche le message demandé (mode 1 : `209c:000c`, 2 : `209c:0092`, autre : direct) ; si le mot de son est non nul et l'objet dans la salle chargée : `gm_sound_play(…, 7, 0, 7)`.

`16f5:02a2` (certain), appelé à chaque tic par le personnage animé : si `1833:0336` dit que la séquence d'images courante est terminée (objet hors des salles actives : toujours « terminée » ; sinon `Ind >= Tot` et `Rep <= 1`), `Tim` est décrémenté ; à 0 le pas suivant est chargé (`Nbr` -1) ; quand `Nbr` tombe à 0 : `Anm = 0`, `Err = 0`, ressource déchargée, arrêt du son, et la fonction **renvoie l'id de l'animation terminée** (0 tant qu'elle dure). L'appelant aiguille sur cet id.

Ids vus en code (appelants) : 1 `couronnement`, 2 noyade, 3 immolation, 4 repas de l'ours, 5 frelons, 6 arrachage des ronces (héros) / 7 (ronces), 12 KO, 17 et 18 téléportation, 19 chute dans l'eau, 20..23 nain n° 0..3 assommé, 24..27 nain n° 0..3 abattu, 28 désintégration du nain, 29 duel contre un nain, 32 boulet de lave, 33 lave, 34 à 36 sorts de Minas Thyl (35 : étranglement), 37 et 38 soldat assommé / abattu, 39 magie d'Erin Hûviel, 40 Sarhûl qui dévore, 41 victime dévorée, 42 couronnement, 43 chute mortelle, 44 à 47 sortilèges et métamorphoses (Minas Thyl, crapaud) ; les rôles précis sont en § 6.2 et § 7.

### 1.4 Recherche d'objets

| Fonction | Rôle |
|---|---|
| `1a7b:03b0` (`AX` = `Num`, `DX` != 0 : abandon fatal si absent) | premier objet de **type 2** (liste globale) de ce `Num` |
| `1a7b:03d7` (`AX` = `Ser`) | objet de `Ser` donné |
| `21e7:003c` (liste, `AX` = `Num`, `DX`/`BX` = bornes d'`Ego`, -1 = sans borne) | premier de la liste de `Num` voulu et d'`Ego` dans `[DX, BX]` |
| `21e7:0006` (`AX`, `DX`, `BX`) / `21e7:0022` (objet ; idem) | cherche dans le **contenu du héros** / dans le contenu d'un objet |
| `21fb:005a(obj)` | frère : cherche, dans la salle (liste A) ou le conteneur de `obj`, un objet de `Num`/`Ego` voulus ; `21fb:0002` = frères du héros |
| `2120:0008(obj)` | objet de `Ser` = `Col` (+0x3C) **dans la salle** de `obj` et à portée (`2120:0075`, `parser.md` § 6.2) |

### 1.5 Perception et mise en cible

- **Visibilité** `219b:0000(cible, observateur)` (certain) : `Inv` (+0x2F) de la cible doit être nul ; si l'observateur est dans la salle chargée : la lumière du pilote doit être au moins `-40` (`197e:0272 == 0`) ; sinon : `Lum(cible) + Lum(observateur) > 31` (0x1F).
- **Contact** : `1a50:0006` au sein de `179d:0004` (voir § 3.1 pour `Err 8/9`).
- **Cible** `22ef:0000(cible, poursuivant ; AX)` : copie la position de la cible (`Xc,Yc,Pc,Nc`), pose `Cib`/`Ser` (si `AX != 0` : suivre l'objet), calcule le trajet (`gm_compute_path`) si la salle est chargée (sinon `Def = 7` d'office) ; renvoie `Def`.
- **Ramasser** `219b:00d0(objet, preneur)` : visible, `Ram` non nul, le poids passe (`20ac:0060` : poids total du contenu + objet <= `Chg` du preneur), puis `22ef`.
- **Sortie** `228e:0000(obj ; AX = id de salle voulue ou -1, DX != 0 : respecter les barrages)` : liste les emplacements de sortie existants (et, si `DX`, non barrés par `1414:0006`), en tire un au hasard (`rand() % n`) ; dans une salle non chargée : écrit `Inf` et appelle `186d:000c` (changement de salle immédiat) ; dans la salle chargée : cible à `X`/`P` de l'arête du côté voulu (`±1000`, ramené aux bornes du plan), `Y` à mi-hauteur, trajet ; renvoie 0 si aucune sortie ne convient.
- **Errance** `2151:0006` / `2151:02a0(obj)` : cible aléatoire dans `[min-20, max+20)` de chaque axe (`rand() % (max-min+40) + min-20`), `Y` ramené à 30 pour les `Dep 1` trop hauts ; pas de calcul si la salle n'est pas chargée (`Def = 7`).
- Un PNJ ne décide que s'il n'a **pas de trajet en cours** et que `Ctl` (+0x40) est nul ; sinon il suit son trajet (`30d9:0006`, retours : 0 en marche, 2 collision avec la cible, 3 cible absente, 4 pas de chemin, 5 arrivé, 6 sans trajet).

## 2. Qui exécute quoi : tables de procédures

`gm_main_loop` appelle, pour tout objet de `Gst = 7`, la procédure `Fct` résolue par `1ec8:000a(Num, table 2)` (`engine.md` § 6.2). Table 2 relevée dans `AM1.EXE` (clé = `Num`, certain) :

| `Num` | Objet | `Fct` | Remarque |
|---:|---|---|---|
| 1 | héros (Killian) | `246c:000a` | répartiteur `Err` puis `Ego` 0..8 (§ 4) |
| 2 | « un de vos infortunés prédécesseurs » (dépouille) | `2405:0106` | § 6.4 |
| 3 | pie | `2774:0004` | § 8.2 |
| 4 | ours des cavernes | `26da:000e` | § 8.1 |
| 12 | torche | `2420:000e` | § 8.5 |
| 16 | stèle de granite (passage vers la mine) | `2500:0008` | § 10.2 |
| 18 | feu | `264c:0002` | § 8.4 |
| 20 | ronces | `257b:000a` | § 8.6 |
| 23 | éclaboussure (message `V25`, interjection d'un plouf) | `2588:0006` | se détruit après 7 tics en affichant `V25` (certain) ; acceptée sur les types de sol d'eau (§ 5) |
| 101 | Prytwen le malfaisant | `28b1:0000` | § 7.2 |
| 103 | grille de la salle 110 | `2846:000a` | mécanisme : `objects.md` |
| 104 | dalle sous le trône | `27ed:000a` | § 10.2 |
| 201..204, 301 | nains (201/202 : « mineurs », 203/204 : guerriers, 301 : soldats) | `2a44:000c` | § 7.1, § 7.3 |
| 207 | herse de granite | `29fd:0000` | § 10.2 |
| 302 | Sarhûl | `2cdf:0004` | § 8.3 |
| 303 | Minas Thyl la sorcière | `2dd9:0006` | § 7.5 |
| 316 / 317 | grille ouvragée / double herse | `2c1e:0008` / `2c4d:000c` | mécanismes : `objects.md` (états § 3.2) |
| 327 | crapaud | `2d52:000e` | § 8.7 |
| 333 | acteur du couronnement (**remplace le héros** pendant la cérémonie) | `2caf:000e` | § 10.1 |
| autres | aucune (`10c8:0006`) | | objets passifs |

Gestionnaires de **verbes** par personnage (tables 1 « objet direct » et 5 « objet indirect », `parser.md` § 6.4) : pie `2774:05ce`/`0606`, ours `26da:06c6`/`07ea`, Prytwen `28b1:0b6e`/`0fba`, nains `2a44:0eb8`/`11e2`, Sarhûl `2cdf:054a`/`06d2`, Minas Thyl `2dd9:0df8`/`0fd0`, crapaud `2d52:0496`/`0620`, feu `264c:0126`/`01ac`, torche `2420:011e`/`245d:000e` ; **événements différés** (table 8, clés = `Num` de l'objet porteur, § 9.2) : Prytwen `28b1:11e0`, nain `2a44:12fc`, ours `26da:0800`, Minas Thyl `2dd9:1440`, crapaud `2d52:07fe`, héros `2683:017a` (clé 1), 101..104 et 2000/2001 ; **réactions** (table 9, § 9.3) : `2683:0000` (héros), `2774:045c`, `26da:0444`, `28b1:1482`, `2a44:13fa`, `2cdf:0706`, `2dd9:1570`, `2d52:0838`.

## 3. Le champ `Ego`, l'`Err` et les types d'accident

### 3.1 Table `Err` : codes, producteurs, réactions

`Err` (+0x3E) est le résultat du dernier déplacement. Il est écrit par `179d:0004` (mouvement), `1a50:0006` (contact), `1c96:0102` (terrain), `1aba:000e`/`1b11:000c` (placement) et consommé **en tête** de chaque `Fct`. Codes (certain sauf mention) :

| Err | Producteur / sens | Héros (`246c:000a`/`246c:0240`) | PNJ (`28b1`, `2a44`, `26da`, `2cdf`, `2dd9`, `2774`) |
|---:|---|---|---|
| 0 | libre | suite normale | suite normale |
| 1 | obstacle plein sur le trajet (case de type 1), ou bord d'une salle non chargée | suite normale | suite normale |
| 2 | type de case refusé par `13a8:000a`, ou obstacle pour les `Dep` 1/3 | suite normale | suite normale |
| 3 | jamais écrit par `179d` (reste du système de chute ; **probable** : même rôle que 5) | **vide** : chute (voir ci-dessous) | suite normale |
| 4 | contact avec le plan de profondeur (`1c96:0102`) | suite normale | suite normale |
| 5 | aucune case praticable / sol trop bas | **vide** : chute | suite normale |
| 6 | sol trop haut (`dpY`) | suite normale | suite normale |
| 7 | **atterrissage** d'un objet en chute par cases (`Dep 3`) ; `Inf` = type de la case | arrêt s'il n'y a pas de trajet | suite normale |
| 8 / 9 | **contact** avec un autre objet de même `P` (`1a50:0006`) ; 9 si l'un des deux a `Txt != 0`, sinon 8 ; `Col` +0x3C = `Ser` de l'autre ; l'autre objet reçoit aussi 8/9 s'il n'avait pas d'erreur ou s'il est de `Gst 7` | suite normale | **réaction de contact** (fonction du personnage) si son `Ego` l'autorise, sinon rien |
| 0x0A | bord atteint, `Inf` = côté | suite normale | suite normale |
| 0x0B | sortie existante, `Inf` = emplacement | `186d:000c` ; résultat 0 : on recommence l'aiguillage (peut donner 0x0F) ; 1 : transit de salle, `return 7` ; autre : suite | idem |
| 0x0C | bord sans sortie pour un objet de `Txt = 2` (dans la salle chargée) | **fatal** `E11` (le héros n'a `Txt = 2` qu'en `Ego 7`) | annule le trajet (`Def = 0`) |
| 0x0D | (non produit) | arrêt s'il n'y a pas de trajet | suite normale |
| 0x0E | bord sans sortie pour tout autre objet de la salle chargée (hors salle chargée : `Err 1`) | **mort** « disparition » `G18` + jingle `E4` (sans reste), § 6.1 | annule le trajet |
| 0x0F | barrage (`1414:0006`) | **rebond** : `Hor`, `Prf` inversés, arrêt, `Err = 0`, `Ver = 0` | annule le trajet |
| 0x10 | (non produit) | arrêt s'il n'y a pas de trajet | suite normale |
| 0x11 | « vient d'être placé » | suite normale **sans** test de mouvement | suite normale |
| 0x12 | transit de salle (héros : `Ser += 10000`) | n/a (traité par la boucle) | n/a |
| 0x13 | arrivé dans la nouvelle salle | arrêt, `placer(5)`, `4b80 := conteneur` | annule le trajet |
| 0x14 / 0x15 | placement impossible / position hors limites | **fatal** `E11` | – |
| 0x16 | conflit de position (mouvement `Dep 2/4` sans zone) | **fatal** `E11` sauf si `Ego == 4` | – |
| 0x17 | échec de recherche de position | `placer(5)` ; en cas d'échec **fatal** `E11` sauf si `Ego == 4` | – |

Aiguillage des PNJ (tableau de 20 mots lus en tête de `28b1:0000`, `2a44:000c`, `26da:000e`, `2cdf:0004`, `2774:0004`, `2dd9:0006` ; identique partout, **certain**) : `Err` 8 et 9 -> réaction de contact ; 11 -> `186d:000c` (0 : relire `Err` ; 1 : `return 7` ; autre : suite) ; 12, 14, 15, 19 -> `Def = 0` ; tout le reste -> suite. Un `Err` non traité **bloque le mouvement** de l'objet au tic suivant (`179d:0004` retourne dès qu'`Err != 0`) ; chaque `Fct` doit donc le remettre à 0 en fin de tic (c'est le `Err = 0` final de chaque module).

**Chute dans le vide** (héros, `Err 3` ou `5`, aucun trajet actif) : entrée dans l'état `Ego 4` (§ 4.2.5) avec `Fig 8` et le message `G6` si `Ego == 0` ou `G12` sinon (`246c:02cf`).

### 3.2 `Ego` par objet : états lisibles dans les descriptions

Les messages de classe `30 + Ego` (numéro = `Num`) décrivent l'objet selon son état. Ils donnent le **sens joueur** de chaque valeur. Le tableau résume (certain pour les valeurs et leur existence, probable pour le rattachement à un comportement précis).

| `Num` | `Ego` : sens |
|---|---|
| 1 héros | 0 vivant, marche ; 1 nage mal (eau profonde) ; 2 grimpe ; 3 « roulades » (glissade) ; 4 chute libre ; 5 KO (étourdi) ; 6 sous animation scénarisée ; 7 « continuez à travailler » (arrache les ronces) ; 8 porte Prytwen |
| 2 dépouille | 0 restes d'un aventurier ; 1 maladroit (chute) ; 2 repas de l'ours |
| 3 pie | 0 au repos ; 1 cherche ; 2 cherche des vers ; 3 s'enfuit avec un objet ; 4 tient un objet ; 5 dort ; 6 tuée par l'ours |
| 4 ours | 0 normal ; 1 affamé et féroce ; 2 « laissez-le tranquille » ; 3 occupé avec les abeilles ; 4 joueur |
| 12 torche | 0..3 allumée (de presque consumée à neuve) ; 4..8 éteinte (4 presque consumée … 8 neuve) |
| 16 stèle | 0 fermée ; 1 bloquée ; 2 glisse (s'ouvre) ; 3 coulisse (se ferme) ; 4 ouverte ; 5 fermée ; 6 sous les ronces |
| 18 feu | 0 mort ; 1 presque éteint … 6 très beau feu (niveau de combustion, § 8.4) |
| 101 Prytwen | 0 normal ; 1 « en affaire » (animation) ; 2 assommé ; 3 mort ; 4 s'en va ; 5 attend l'or |
| 103 grille, 207 herse, 316 grille, 317 herse | 0 fermée ; 1 s'ouvre ; 2 se ferme ; 3 ouverte |
| 104 dalle | 0 fermée ; 1 s'enfonce ; 2 se referme ; 3 ouverte ; 4 fermée |
| 201..204 nains | 0 normal ; 1 se bat ; 2 assommé ; 3 mort (se désintègre) ; 4 s'éloigne (fuite) |
| 301 soldat | 0..4 comme les nains ; 5 garde la porte du cellier ; 6 garde le passage nord ; 7 dort sur une chaise ; 8 écroulé dans son assiette |
| 302 Sarhûl | 0 normal ; 1 dévore ; 2 attend son tour ; 3 occupé |
| 303 Minas Thyl | 0 normal ; 1 lance un sort ; 2 et 3 disparaît / réapparaît (baguette) ; 4 emmène le héros vers un mauvais sort ; 5 attend un cadeau ; 6 occupée ; 7 comme 0 |
| 327 crapaud | 0 ; 1 pensif (attend) ; 2 et 3 change de forme |
| 333 acteur du couronnement | 0 métamorphose ; 1 « où êtes-vous ? » ; 2 patientez ; 3 et 5 habit de roi ; 4 allure ; 6 « mérité de s'asseoir » ; 7 roi |
| coffres 9, 21, 110, 113, 319, portes 111, 309, 329 | 0 fermé à clef ; 1 fermé non verrouillé ; 2 ouvert |
| fiole 304 | 0 ; 1 inscription cabalistique ; 2 vide |
| bouteille 332 | 0 hydromel ; 1 potion ; 2 à moitié vide ; 3 vide |
| passerelle 318, planche 308 | 0 intacte ; 1 effondrée / posée |

**Index inverse : quels objets donnent un sens à chaque valeur d'`Ego`** (messages `30 + Ego` existants dans `A1FMSG.SYS`, vérifié sur les données ; les objets sans comportement dynamique, coffres et portes, ne sont listés qu'en bloc) :

| `Ego` | Objets qui l'utilisent (par `Num`) |
|---:|---|
| 0 | tous |
| 1 | héros, pie, ours, feu (niveau 1), stèle, dalle, grilles et herses, Prytwen, nains 201..204, soldats, Sarhûl, Minas Thyl, crapaud, acteur 333, coffres et portes (9, 21, 110, 111, 113, 114, 309, 319, 329, 332...), fiole 304, grimoire 305, chaudron 306, planche 308, vanne 310, jambon 311, passerelle 318, torchères 114 et 115, poterne 210, niche 211, puits 215 |
| 2 | héros, dépouille, pie, ours, feu, stèle, dalle, Prytwen, nains 201..204, soldats, Sarhûl, Minas Thyl, fiole 304, grille 309, grilles 316/317, coffres (9, 21, 110, 113, 319), portes 111/329, bouteille 332, crapaud, acteur 333 |
| 3 | héros, pie, ours, feu, stèle, dalle, grille 103, Prytwen, nains, soldats, Sarhûl, Minas Thyl, herse 207, grilles 316/317, crapaud, bouteille 332, acteur 333 |
| 4 | héros, pie, ours, feu, stèle, dalle, Prytwen, nains, soldats, Minas Thyl, acteur 333 |
| 5 | héros, pie, feu, stèle, Prytwen, soldats, Minas Thyl, acteur 333 |
| 6 | héros, pie, feu, stèle, soldats, Minas Thyl, acteur 333 |
| 7 | héros, soldats, Minas Thyl, acteur 333 |
| 8 | héros, soldats |

(Pour la torche `12` et le feu `18`, `Ego` est un niveau de combustion et non un état de comportement.)

Valeurs initiales de `CFG` pour les objets de type 2 (lues avec `Gst`) : tous les personnages `Ego 0`, sauf le **feu** (`Ego 2`), les **soldats** `Ser 80` (`Ego 5`, cellier) et `Ser 81` (`Ego 6`, passage nord), la **stèle** `Ser 123` (`Ego 6`, `Gst 0`, sous les ronces), les coffres `21`, `111`, `113` et les torchères `114` (`Ego 1`). Personnages avec `Gst 7` au départ : héros (salle 1), ours (7), pie (10), feu (18), Prytwen (105), nains 201/202 (201), 203 (203 et 315), 204 (205 et 211), 201 (308), Minas Thyl (304), soldats ×4 (305), Sarhûls ×4 (309).

## 4. Le héros (`Num 1`, `246c:000a`)

### 4.1 Répartiteur

```text
246c:000a(o) :                       // certain
  si o nul : abort(0xE4)
  selon o.Err (table § 3.1, 24 entrées à 246c:010c) :
      0x0C            : E11 + abort(0x3A)                      // personnage non localisable
      0x0E            : mort par disparition (§ 6.1) ; retour 0
      0x13            : 2273:0190(o) ; placer(o, 5) ; 4b80 = conteneur(o) ; retour 7
      0x14, 0x15      : E11 + abort(0x3F)
      0x16            : si o.Ego != 4 : E11 + abort(0x3F)      // sinon on continue
      0x17            : si placer(o, 5) échoue (≠ 0, ≠ 0x11) et o.Ego != 4 : E11 + abort(0x3F)
      autres          : suite
  selon o.Ego (table 246c:0220, 9 entrées) avec AL = 0, BX = 0 :
      0, 1 -> 246c:0240   2 -> 25ea:0008   3 -> 26ab:000a   4 -> 25ea:03ca
      5 -> 26ab:0134      6 -> 2594:0004   7 -> 2594:033a   8 -> 26ab:01fc
      > 8  -> abort(0x21)
  retourner la valeur du gestionnaire
```

Valeurs de retour : 7 = objet encore vivant, tic fini ; 0 = l'objet a été détruit ou le parcours de liste doit être refait (cf. `engine.md` § 4, redémarrage de liste). **Tous les états du héros sont des `Mob 2` de `Gst 7` sauf Ego 5 (`Mob 1`) et Ego 6 (`Mob 1`)** ; `4b50` (« le joueur a la main ») est remis à 7 par `2683:023e` à l'entrée des états 0, 2 et 8, mis à 0 à l'entrée des états passifs 3, 4, 5 et 6 (l'état 7 ne le touche pas).

### 4.2 États

#### 4.2.1 `Ego 0` et `Ego 1` : marche, nage (`246c:0240`)

- **Entrée** (`AL != 0`) : `2683:023e`, puis `1a37:007f(Gst 7, Mob 2, Ego 0, Dep 0, Txt, Fig 0)` (flag `0xFF`), message `DX:BX` (`209c:0092`), `Err = 0x11`. Le répartiteur appelle avec `AL = 0` : l'état 1 n'est jamais « entré » par le répartiteur ; il est posé par le terrain (`Sol 5`).
- **Tic** : (1) aiguillage sur `Err` (§ 3.1) ; (2) si `Ver` (+0x61, « en marche ») est nul : fin de tic ; si la salle de l'objet n'est pas la salle chargée : fin de tic ; (3) **réaction au type de sol** `Sol` (+0x5A, table § 4.3) ; (4) fin de tic `246c:08f4` : sans trajet (`Def` = 0) `Err = 0`, `Ver = 0` ; avec trajet : `r = 30d9:0006(o)` ; `r = 0` -> `Ver = 0`, retour 7 ; `r != 0` : pour le héros joueur `2363:01ea(o, r)` (§ 4.4), retour 0 si elle renvoie 0 sinon 7.
- Le héros « marche » avec `Fig 0` ; `Fig 1` (`Sol 3`), `Fig 2` (`Sol 4`) et `Fig 3` (`Ego 1`, `Sol 5`) sont les séquences d'eau (patauge, nage de surface, nage profonde : noms probables). Vitesses : `dpX = 2`, `dpY = 4`, `dpP = 1` (CFG).

#### 4.2.2 `Ego 2` : escalade, escalier (`25ea:0008`)

- **Entrée** (`AL != 0`, par `Sol 7..10, 23..26, 40..43` depuis `246c`) : `2683:023e`, `2273:0190`, puis selon `Sol` : direction verticale `v` ∈ {-1, 0, +1}, `Fig` ∈ 4..7, `Dep` ∈ {4, 2} :

| `Sol` | `v` | `Fig` | `Dep` |
|---|---:|---:|---:|
| 7 | -1 | 4 | 4 |
| 8 | -1 | 5 | 4 |
| 9 | -1 | 6 | 2 |
| 10 | -1 | 7 | 2 |
| 23 | +1 | 4 | 4 |
| 24 | +1 | 5 | 4 |
| 25 | +1 | 6 | 2 |
| 26 | +1 | 7 | 2 |
| 40 | 0 | 4 | 4 |
| 41 | 0 | 5 | 4 |
| 42 | 0 | 6 | 2 |
| 43 | 0 | 7 | 2 |

  puis `1a37:007f(Gst 7, Mob 2, Ego 2, flag 2, Dep, Txt, Fig)` ; si `v != 0` : placement `gm_object_behavior_main` avec tolérance `Hau/2` et direction `v`, sinon repli sur le placement libre ; message ; `Err` n'est pas remis à 0 par l'entrée. `Dep 4` = déplacement lié aux **zones** (échelle, corde), `Dep 2` = escalier à zones (`179d:0004` § 7.2 de `engine.md`).
- **Tic** : selon `Err` : 3 ou 5 (perte de prise) : direction `d = (Sol - 11) mod 4` (0 -> `Prf +1`, 1 -> `Prf -1`, 2 -> `Hor +1`, 3 -> `Hor -1`), puis chute `25ea:03ca(Fig 9, G11)` ; 11 : sortie (`186d:000c`, 1 = transit) ; 15 : demi-tour (`Hor`, `Prf` inversés) ; 17 : **normalisation** selon `Sol` :
  - `Sol 11, 15, 19` -> `Fig 4`, `Dep 4` ; `12, 16, 20` -> `Fig 5`, `Dep 4` ; `13, 17, 21` -> `Fig 6`, `Dep 2` ; `14, 18, 22` -> `Fig 7`, `Dep 2` (si `Fig`/`Dep` diffèrent : `2273:0190`, nouvel état `Ego 2`) ;
  - `Sol 48` (sommet d'arbre) : chute `Ego 4` (`Fig 9`) avec `Prf = +1` et le message `G32` ;
  - `Sol 49` : recentre `X = 0x4F` puis `Dep 4`/`Fig 4` ; `Sol 50` : `X = 0x25` ; `Sol 59` : `X = 0x40` (mêmes `Dep 4`/`Fig 4`) ;
  - `Sol 51` (barreaux mouillés) : si `4ae0 <= 1` (un seul plan actif) : `Dep 4`/`Fig 4` sans recentrage, sinon chute `Prf = +1` avec `G33` ;
  - `Sol 23..47` hors 23..26, 40..43 et `Sol 52..58` : `abort(0x56)`.
  - fin de tic : si `Sol` ∈ 11..14 avec `Ver = +1`, ou `Sol` ∈ 19..22 avec `Ver = -1` : le héros est arrivé en haut/bas de l'échelle : retour à la marche (`246c:0240` avec `AL = 7`) ; sinon `Err = 0`.
  Confiance : certain pour les tables, probable pour l'interprétation (échelle, escalier, arbre).

#### 4.2.3 `Ego 3` : glissade, roulades (`26ab:000a`)

- **Entrée** (`AL` = `Fig` 8 ou 9, message `G1` ou `G2`) : `2683:023e`, `4b50 = 0`, `1a37:007f(Gst 7, Mob 2, Ego 3, Dep 0, Fig = AL)`, `Yc` (+0x72) = `Y` courant, message. `gm_sound_select_track(7)` à chaque tic.
- **Tic** : `Err` 3 ou 5 -> chute libre `25ea:03ca` (garde `Fig`) ; 11 -> sortie ; 0, 9, 10, 17 -> si `Y < Yc` : KO (`Ego 5`) sinon `Yc = Y`, `Err = 0` ; autres `Err` -> KO. En clair : le héros roule tant qu'il **descend** ; dès que `Y` cesse de croître il est assommé. Les vitesses `Hor`/`Prf` sont posées par l'appelant (§ 4.3).

#### 4.2.4 `Ego 5` : KO, « étourdi » (`26ab:0134`)

- **Entrée** : `2683:023e`, `Ver = 1`, `4b50 = 0`, `1a37:007f(Gst 7, Mob 1, Ego 5, Dep 0, Fig 10)`, **`Tim` (+0x32) = 100**, `dpP = 0`, message (`DX:BX`), `gm_sound_select_track(0)`.
- **Tic** : `Tim--` ; à 0 : `2273:0190`, retour à `246c:0240` ; sinon `Err = 0` et retour 7. **KO = 100 tics** (≈ 10 s). Utilisé après une chute < 15 tics, une glissade, un coup de Prytwen, la fin d'une glissade. Description : `G` « Ding Dong » (état 5 du héros).

#### 4.2.5 `Ego 4` : chute libre (`25ea:03ca`)

- **Entrée** (`AL` = `Fig` 8 ou 9, message `G6` / `G12` / `G11` / `G32`/`G33`/`G30`/`G353`/`G354`...) : `2683:023e`, `Ver = 1`, `4b50 = 0`, `1a37:007f(Gst 7, Mob 2, Ego 4, flag 2, Dep 3, Txt, Fig)` ; `X += dpX * sgn(Hor)`, `P += dpP * sgn(Prf)`, **`Y += 4`**, `Sol = 0`, recherche de la position valide la plus proche (`gm_object_behavior_main`, bornes verticales 8..10 et signe de `Prf` ; en cas d'échec sans bornes) ; `Tim = 0` ; message (probable pour les bornes).
- **Tic** : `gm_sound_select_track(7)` ; `Err` : 7 (atterrissage, ci-dessous) ; 11 -> sortie (`186d:000c`) ; 0, 8, 9, 10, 17 -> `Err = 0`, retour 7 ; 1..6 et 12..16 -> message puis **erreur fatale** (la chute ne doit pas rencontrer d'obstacle). `179d:0004` fait descendre l'objet de `dpY` par tic (`Dep 3`), incrémente `Tim` et dérive en X/P après 4 tics.
- **Atterrissage** (`Err 7`, `Inf` = type de sol d'arrivée `T`, `Tim = d` tics de chute) : coupe le son, `Dep = 0`, `Sol = 0`, replace sur le type `T`, puis :

| arrivée | durée | conséquence |
|---|---|---|
| `T ∈ {4, 5, 6, 47}` (eau) | quelconque | `+0x38 = d`, animation 19 (`2594:0004`), puis § 6.2 : `d > 20` -> mort `G35`, sinon `G34` et retour à la marche |
| autre `T` | `d < 15` | KO (`Ego 5`) |
| autre `T` | `d >= 15` | animation 43 : mort `G16` + dépouille (§ 6.4) |

#### 4.2.6 `Ego 6` : animation scénarisée (`2594:0004`)

Le héros est sous animation `ANM` (mort, téléportation, sort, combat) : `Gst 7`, `Mob 1`, `Ver 1`. Le répartiteur appelle `2594:0004(AX = 0)` à chaque tic : `16f5:02a2` interroge l'animation, la valeur renvoyée (id) aiguille sur la **table des conséquences** (§ 6.2). Tant qu'elle dure, `4b50 = 0`. À la fin : `4b50 = 7`.

#### 4.2.7 `Ego 7` : arrachage des ronces (`2594:033a`)

Si `Sol != 39` : retour à la marche (`246c:0240`, `AL = 7`, sans message). Si `Err != 0` : idem avec le message `G19` (buté sur quelque chose). Sinon : `Txt = 2`, le héros marche vers le point `(X = 0x4C, P = 0x54)` à `Hor`/`Prf` = signe de l'écart ; quand `(0x4C - X)² < 2` et `P = 0x54` : `16f5:0132(ANM 7, objet = ronces, partenaire = héros)` puis `2594:0004(ANM 6, partenaire = ronces)` (durée 11 pas, § 6.2) ; fin : message `G20`, la stèle (`Num 16`) passe à `Ego 5` (§ 10.2).

#### 4.2.8 `Ego 8` : porte Prytwen assommé (`26ab:01fc`)

- **Entrée** : `2683:023e`, `1a37:007f(Gst 7, Mob 2, Ego 8, flag 0xFF, Dep 0, Fig 11)`, message ; vitesse de marche inchangée, mais `Pds` du héros inclut Prytwen (450) donc les types d'eau, l'escalade, etc. évaluent la charge (§ 4.3).
- **Tic** : si `Fig != 11` : `1a37:0002(Ego 8, Fig 11)` ; `Err 11` : sortie ; `Err 15` : `Def = 0` ; sans trajet (`Def = 0`) : `Err = 0` et fin d'état (retour à `Ego 0` au prochain `246c`) ; avec trajet : `30d9:0006` puis `2363:01ea` comme pour la marche. Description (`G` état 8) : « Prytwen pèse lourd ». Entrée par `28b1:0b6e` (verbe prendre sur un Prytwen assommé, § 7.2).

### 4.3 Table `Sol` -> réaction (`246c:0240`, table `246c:086a`, 69 entrées)

Notations : `E(n)` = entrer dans l'état `n` ; `déf.` = « sol ordinaire » : si `Fig != 0`, `1a37:0002(Ego 0, Fig 0)` (retour à la marche), puis fin de tic ; « **sans trajet** » = la réaction ne s'applique que si `Def = 0` (le trajet calculé par le moteur évite ces cases, **sauf pour les types de sol 27 à 34, 37, 45, 52, 53, 60, 63 et 68, que le trajet n'évite pas** (certain, code porté et testé) ; quand le joueur clique dedans, le héros s'y laisse tomber). Les `T` non listés (> 68 ou « autres ») sont ordinaires.

| `Sol` | Réaction | Confiance |
|---|---|---|
| 0 | vide : sans trajet, `Ego 4` `Fig 8` message `G6` | certain |
| 1, 2, 11..22, 36, 38, 39, 44, 46, 48..51, 54..59, 61, 62, 64..67 | ordinaire | certain |
| 3 | patauge : si `Fig != 1`, `1a37:0002(Ego 0, Fig 1)` | certain |
| 4 | nage en surface : `Ego 0`, `Fig 2` ; supprime les événements différés 9 et 10 du héros | certain |
| 5 | **eau profonde** : `Ego 1`, `Fig 3` ; marge de charge `m = ((Chg - poids) * 10) / (Chg / 10)` (`Chg` = 500 pour le héros, `poids` = `20ac:0008`, somme récursive du **contenu** sans le héros) ; si `Chg > 0`, `poids < Chg` et `m > 10` : événement différé 10 = `9 * m` tics (proc 1 = `2683:017a`) et `Tim = m` ; sinon (`Chg <= 0`, surcharge ou marge `m <= 10`) : animation 2 + `G7` = noyade immédiate. À l'échéance de l'événement 10 (héros encore en `Fig 3`) : `G9` (fatigue) et événement 11 = `Tim` tics ; à l'échéance de l'événement 11 (toujours en `Fig 3`) : animation 2 + `G8` (noyade). Sans charge `m` vaut 100 : avertissement après 900 tics, noyade 100 tics plus tard | certain |
| 6 | courant fort : animation 2 + `G10` (noyade) | certain |
| 7..10, 23..26, 40..43 | escalade : **sans trajet** et `Ver != 0` : `25ea:0008(AL = 7)` (`Ego 2`, § 4.2.2) | certain |
| 27 | pente : si `Hor == +1` (sinon ordinaire) : `26ab:000a(Fig 8, G1)` | certain |
| 28 | pente : si `Hor == -1` : idem | certain |
| 29 | pente : si `Prf == +1` : idem | certain |
| 30 | pente : si `Prf == -1` : idem | certain |
| 31 | glissade : si `Hor == -1` : `Hor = +1` puis `26ab:000a(Fig 9, G2)` | certain |
| 32 | glissade : si `Hor == +1` : `Hor = -1` puis idem | certain |
| 33 | glissade : si `Prf == -1` : `Prf = +1` puis idem | certain |
| 34 | glissade : si `Prf == +1` : `Prf = -1` puis idem | certain |
| 35 | **feu** : sans trajet ; cherche le feu (`Num 18`, `22b7:0000`, à portée) ; s'il existe, affiche `G3` puis `G4` (feu mort) ou `G5` (feu vivant) à la main, copie la position du feu dans le héros (`P + 1`), `+0x28` = `Ser` du feu, animation 3 | certain |
| 37 | **frelons** : si `Inv == 0` : animation 5 + `G14` (sinon ordinaire) | certain |
| 45 | **sol friable** : 1 chance sur 20 par tic : `Prf = +1`, `Hor = 0`, `P += 10`, `25ea:03ca(Fig 9, G30)` | certain |
| 47 | eau glacée : animation 2 + `G31` | certain |
| 52 | **lave** : si `23a2:01c0(héros, 0) == 0` (aucune protection, § 9.1) : animation 33 + `Z2` ; sinon ordinaire (et `13a8:000a` affiche `Z1`, § 5) | certain |
| 53 | **passerelle vermoulue** : charge `c = poids + Pds(héros)` (800 + ...) ; si `c <= Chg(passerelle) = 840` ordinaire ; sinon la passerelle (`Num 318`) passe à `Ego 1`/`Fig 1`, `Dep = 1` (chute libre), `4ae0 = 1`, `1793:0006(0)`, puis `25ea:03ca(Fig 8, G353)` | certain |
| 60 | **chapiteau d'Erin Hûviel** : si le héros porte le talisman (`Num 321`) : points `(3, 3)` une fois, ordinaire ; sinon animation 39 + `G355` | certain |
| 63 | **planche** : cherche une planche (`Num 308`) dans la salle ; si absente ou `Ego 0` : chute `G6` ; si posée et la passerelle (`318`) à `Ego 0` : ordinaire ; si posée et passerelle effondrée : la planche est détruite, `G354`, chute | probable |
| 68 | âtre (autre feu) : `+0x28 = 0`, animation 3 + `G46` | certain |
| autres de 0..68 | ordinaire | certain |

`23a2:01c0(héros, 0)` lit le compteur de l'événement 0 du héros (protection contre la lave, § 9.1).

### 4.4 Retour de trajet (`2363:01ea`)

Appelée quand le suivi de trajet du **héros joueur** rend un résultat non nul (`r` = 1 / 2 arrivée, 3 cible absente, 4 recalcul impossible, 5 « même décision malgré un blocage », `movement.md` § 6.3) : 
- `r = 5` **n'est pas « arrivé »** : si `+0x43` est nul, il est posé (7) et le trajet est recalculé une fois (indicateur remis à zéro par le clic et par `2363:0154`) ; sinon `G44` (impossible d'aller plus loin) ;
- `r = 1, 2, 4` : si une **commande est en attente** (`DGROUP:5222`, mémorisée par `2363:000c`), elle est rejouée (verbe, prépositions et objets restaurés, `4cc4 = 7`, file de messages remise à zéro, `2210:011e/021e/0008`) ; si rien n'a réussi, la file est affichée ou `S` « message perdu » ;
- `r = 3` ou `r >= 6` : la commande en attente est abandonnée ;
- dans tous les cas, ensuite : `2273:0190` + `gm_reset_object_motion` + `Err = 0x11`, retour 7.
C'est le mécanisme « **aller vers l'objet, puis agir** » commun aux verbes (`22ef:0000` pose la cible).

## 5. Types de sol acceptés : `13a8:000a(AX = Sol, DX = effet ; objet)`

Retour **0 = accepté**, **7 = refusé** (certain : `179d:0004` pose `Err = 2` sur retour non nul ; `305e:008a` n'ajoute au graphe de navigation que les cases acceptées ; `1b11:000c` filtre ses candidats). `DX != 0` demande les **effets de bord** (messages, points) : seul le déplacement réel les passe. Les variables : `N` = `Num`, `E` = `Ego`, `A` = `Anm` (+0x30) de l'objet. `P(x)` = `20b5:0634(objet, x)` (porte `x` franchissable, voir plus bas). Types **non listés : acceptés par tous**.

| `Sol` | Règle | Remarque |
|---|---|---|
| 0, 1 | refusé | vide, mur plein |
| 2 | accepté | sol ordinaire |
| 3, 4, 5, 6, 47 | `N = 1` : `E ∈ {0, 1}` ou (`E = 6` et `A ∈ {2, 19}`) ; `N = 23` (éclaboussure) ; sinon refusé | eau : seul le héros (nageant ou en animation de noyade/chute) et l'éclaboussure y vont |
| 35 (feu) | `N = 1` : `E != 8` ; `N = 18` (le feu lui-même) ; sinon refusé | le héros chargé de Prytwen refuse le feu |
| 37 (frelons) | `N = 4` (ours) ; `N = 1` : `E = 0` ou (`E = 6` et `A ∈ {4, 5}`) ; sinon refusé | |
| 38 | `N ∈ {201..204, 301}` refusé (nains) ; autres acceptés ; avec `DX != 0` : appelle `2846:0398` sur la porte `Num 103` (effet de bord scénario) | zone interdite aux nains |
| 39 | `N = 1` seulement | cases de l'arrachage des ronces (`Ego 7`) |
| 52 (lave) | `N = 1` : `E = 6` -> `A = 33` seulement ; sinon accepté, et avec `DX != 0` et protection active : message `Z1` ; `N != 1` : accepté si l'objet a un compteur d'événement 0 (protection) ; `N = 303` accepté si une émeraude (`Num 313`) est dans la même salle ; sinon refusé | Minas Thyl ne marche sur la lave que pour aller chercher l'émeraude ou si elle est protégée |
| 60 (chapiteau) | `N = 1` : `E = 0` accepté (avec `DX != 0` et talisman 321 dans l'inventaire : `Z301`), `E = 6` -> `A = 39`, autre `E` refusé ; `N != 1` : accepté s'il porte le talisman 321 | |
| 61 (cratère) | `N = 1` accepté ; `N = 303` : si `Sol` de l'objet != 0 ; `N = 313` (émeraude) : accepté et, avec `DX != 0`, points `(3, 4)` ; sinon refusé | |
| 63 (planche) | `N = 1` accepté ; sinon accepté seulement si une planche (`Num 308`, liste globale) existe avec `Ego != 0` | |
| 64 | `Mob = 0` ; ou `Sol` déjà 64 ; ou `P(309)` | devant la grille de fer |
| 68 | `N ∈ {1, 216, 303, 306}` | le chaudron et son âtre |
| 80 | porte logique de la stèle : `Ego` de `Num 16` = 4 (ouverte), ou `Txt = 2` ; puis `Mob = 2` ou `N = 1` | passage derrière la stèle |
| 81 | idem avec `Num 104` à `Ego 3` (dalle ouverte) | passage sous le trône |
| 82 | `N = 1` ou `Mob = 0` | |
| 83 | `Mob = 0` | étages « statiques » |
| 90, 91, 92 | `P(111)`, `P(309)`, `P(329)` | cases de seuil des portes 111, 309, 329 |
| 110 | `Txt = 2` ou (porte 103 absente) ou `Ego` de `Num 103` = 3 | grille de la salle 110 ouverte |
| 111 | idem avec `Num 207` (herse de granite) |  |
| 112 | idem avec `Num 316` à `Ego 3` |  |
| 113 | `Txt = 2` ou `Num 316` absente ou `Ego` de `Num 316` = **0** | l'autre face de la grille 316 |
| 114 | idem avec `Num 317` à `Ego 3` |  |

`P(x)` = `20b5:0634` : la porte `x` (enregistrement de la table `DGROUP:0694`) est franchissable si `Txt = 2` (objets fantômes), ou si son `Ego >= 2` (ouverte), ou si son `Ego ∈ {0, 1}` et que l'objet est **mobile** (`Mob = 2`) — et, pour `Ego 0` (verrouillée), qu'il **possède la clef** (contenu non vide). Les portes closes ne sont donc un obstacle que pour les objets statiques ; les personnages mobiles les franchissent (hypothèse : le franchissement déclenche l'ouverture dans `20b5:000e`).

## 6. Mort du héros

### 6.1 Disparition (`Err 0x0E`)

`246c:000a` : `2f9b:0375(0x4A)`, jingle `E4` (`gm_sound_play(0x0E, 'E', 4, 7, 0, 0)`), message `G18` (`209c:0092`), destruction du héros **sans reste** (`19a6:01a5` avec `AL = 0`), retour 0. Produit quand l'objet sort de la zone d'une salle chargée par un côté sans sortie (`179d:0004`, § 3.1).

### 6.2 Animations de mort et de sort du héros (`2594:0004`)

À l'**appel d'une animation** (`AX != 0`) : `Inv` est remis à 0 pour les ids 3, 4, 17, 18, 19 (après sauvegarde de l'ancienne valeur dans `+0x27` pour 19), 33, 34, 42 ; `219b:006c` (redessin statique), `2f9b:0375(0x4A)` ; `16f5:0132` avec `Gst 7`, `Mob 1`, **`Ego 6`**, `Ver 1`, `Hor = -1` pour l'id 6 (0 sinon), message en mode 2 ; `4b50 = 0`. À chaque tic (`AX = 0`) : `16f5:02a2` ; à la fin, `4b50 = 7` et aiguillage sur l'id terminé (table `2594:0276`, indexée `id - 2`) :

| id | pas / boucles | Déclenché par | Conséquence à la fin (certain) |
|---:|---|---|---|
| 2 | 4 / 8 | noyade : surcharge en eau profonde (`G7`), courant (`G10`), eau glacée (`G31`), épuisement (événement 11, `G8`) | jingle `E4`, `G23`, héros détruit, **contenu détruit** |
| 3 | 6 / 48 | immolation (`Sol 35`, `Sol 68`) | si `+0x28` != 0 : le feu de `Ser` `+0x28` est ranimé au niveau 6 (`264c:02b0`, § 8.4) ; `G22` ; détruit, contenu détruit |
| 4 | 1 / 40 | repas de l'ours (§ 8.1) | `G25` ; détruit ; **contenu laissé dans la salle** |
| 5 | 3 / 24 | frelons (`Sol 37`, `Inv = 0`) | `2405:0000` variante 0 + `G24` : dépouille ; le héros n'est pas détruit ici (la dépouille le remplace) |
| 6 | 11 / 71 | arrachage des ronces (`Ego 7`) | `G20` et retour à la marche |
| 12 | 2 / 300 | KO long après le vol de Prytwen | `G108` (« vous reprenez vos esprits ») et retour à la marche |
| 17 | 1 / 1 | arrivée de téléportation | retour à la marche sans message |
| 18 | 1 / 1 | départ de téléportation (formule `Erin`, § 9.4) | `Inf = 6`, `+0x66` = salle de destination `+0x38` ; **lance l'animation 17** ; si la salle chargée est la destination : `placer(mode 9)` (position aléatoire), sinon `186d:000c` (changement de salle) |
| 19 | 1 / 1 | atterrissage dans l'eau (§ 4.2.5) | `Inv` restauré depuis `+0x27` ; `+0x38 > 20` : `G35`, mort, contenu détruit ; sinon `G34` et marche |
| 32 | 1 / 1 | boulet de lave (geyser, `V376`) | `2405:0000` variante 1 + `G40` : dépouille |
| 33 | 12 / 60 | lave sans protection (`Z2`) ou fin de protection sur la lave (`V361`) | `G41`, détruit, contenu détruit |
| 35 | 4 / 16 | étranglement (Minas Thyl, `V375`) ; fumerolles (salle 304, `G301`) | `2405:0000` variante 1 + `G42` : dépouille |
| 39 | 9 / 26 | chapiteau sans talisman (`G355`) | `G43`, détruit, **contenu laissé** |
| 41 | 2 / 256 | dévoré par un Sarhûl (§ 8.3) | `G338`, détruit, **contenu laissé** |
| 43 | 1 / 1 | chute mortelle (§ 4.2.5) | `2405:0000` variante 0 + `G16` : dépouille |
| autres | | | `abort(0x42)` |

« Détruit, contenu laissé » = `19a6:01a5(conteneur du héros, héros)` avec `AL = 1` : les objets portés sont **déplacés dans la salle** ; « contenu détruit » = `AL = 0`. Dans tous les cas : `gm_sound_play(0x0E, 'E', 4, 7, 0, 0)` (jingle `E4`) puis message `G…` puis destruction ; l'objet héros n'existe plus (`4bfe = 0`).

### 6.3 Tableau des causes de mort

| Cause | Mécanisme | Message(s) | Protection / parade | Reste |
|---|---|---|---|---|
| Vide, escalade ratée, sol friable, passerelle | chute (`Ego 4`) ; atterrissage sec >= 15 tics : ANM 43 ; eau > 20 tics : ANM 19 | `G6`, `G11`, `G12`, `G30`, `G32`, `G33`, `G353`, `G354` puis `G16` / `G35` | tomber de moins de 15 tics ; passerelle : porter <= 40 de poids | dépouille / aucun |
| Eau profonde | `Sol 5`, charge | `G7`..`G9`, `G10`, `G31`, `G23` | alléger : marge `m > 10` | aucun |
| Feu, âtre | `Sol 35`, `68` | `G3`..`G5`, `G46`, `G22` | ne pas y marcher | aucun |
| Lave | `Sol 52` | `Z2`, `G41` | potion (§ 9.1) | aucun |
| Frelons | `Sol 37` | `G14`, `G24` | être invisible (`Inv`) | dépouille |
| Gaz (salle 304) | événement 2 (1000 tics après l'entrée) | `G301`, `G42` | quitter la salle | dépouille |
| Chapiteau | `Sol 60` | `G355`, `G43` | talisman 321 | laissé |
| Ours | contact (§ 8.1) | `G21`, `G25` | fouet / fuite | laissé |
| Sarhûl | contact (§ 8.3) | `G302`/`G363`, `G338` | invisibilité, jambon, forme transformée | laissé |
| Nain | duel perdu (§ 7.3) | `G220`+`G201` / `G356`+`G357` | bouclier, hache, épée | dépouille variante 0/1, butin pris par le nain |
| Prytwen (salle 105) | duel (§ 7.2) | `G101` | rester hors de sa tanière | dépouille |
| Minas Thyl | sorts | `V314`, `V315`, `V372`..`V375`, `G42` | ne pas la voler ni l'insulter | dépouille |
| Crapaud | coup de talon, morsure | `V343`, `V344` | embrasser (V345) | – |
| Disparition | `Err 0x0E` | `G18` | – | aucun |

### 6.4 Dépouille (`Num 2`, `2405:0000` / `2405:0106`)

`2405:0000(AX = variante 0..2, DX:BX = message ; objet)` : jingle `E4`, message, puis **remplace** l'objet mort par un objet `Num 2` ( « un de vos infortunés prédécesseurs ») créé à sa place (`1a6b:0006` : copie des 14 octets de position `+0x52..+0x5F`, `Gst 7`, `Mob 1`, `Ego = variante`, `Fig = 5 * variante`, `Chg 800`, `Pds 500`, vitesses reprises), le contenu de l'ancien objet passant au nouveau ; `Tim` = `D[variante][0]`.

`2405:0106(corps)` : `Tim--` ; à 0 : `s = Fig + 1` ; si `s mod 5 = 0` : fin (si `Ego == 2`, l'objet frère `21fb:005a` — le chaudron de Minas Thyl, `Num 306` — repasse à `Ego 0` ; le contenu est déposé dans la salle ; le corps est détruit) ; sinon `Tim = D[...][s]` et `Fig = s` (`1a37:007f(Gst 7, Mob 1 … Fig s)`). Durées (`DGROUP:523E`, tics) : variantes 0 et 1 : 1600, 1600, 2000, 2000, 2000 (soit 16, 16, 20, 20, 20 minutes de jeu, 92 au total) ; variante 2 : 100 × 5 (5 minutes). La variante 2 est celle du héros **cuit dans le chaudron** de Minas Thyl (description « n'apprécie pas la bonne cuisine » ; le chaudron, `Ego 1` « soupe humaine » pendant ce temps, revient à `Ego 0` à la disparition du corps) ; les variantes 0 et 1 sont les autres morts (0 : frelons, chute ; 1 : boulet de lave, étranglement, coups de nains avec `rand() % 2`). Confiance : certain pour les durées et la boucle, probable pour le rôle de chaque variante.

## 7. Nains, Prytwen, Minas Thyl

### 7.1 Squelette commun des PNJ « libres »

Même ossature dans `28b1:0000`, `2a44:000c`, `26da:000e`, `2774:0004`, `2cdf:0004`, `2dd9:0006` (certain) :

```text
tic(o) :
  boucle sur Err (table § 3.1) : 8/9 -> contact(o) si Ego le permet ; 11 -> 186d:000c ; 12/14/15/19 -> Def = 0
  si Def != 0 :                                   // trajet en cours
      r = 30d9:0006(o)
      r == 0 : fin du tic (Err = 0, retour 7)        // en marche
      r != 0 et o est le héros joueur et une action est en attente : 2363:01ea
      r == 2 : Col = Ser de la cible (+0x7A) ; contact(o)
  selon Ego :                                      // états passifs
      ANM en cours (Ego 1..3, parfois 6) : id = 16f5:02a2(o) ; 0 : fin du tic ; sinon aiguiller sur l'id (§ 7.2, § 7.3, § 8)
  Def = 0 ; si Ctl == 0 :                          // décision
      parcourir la liste A de la salle ; selon Num de chaque objet : approcher (22ef) / fuir (228e) / voler / attaquer
      sinon, 1 chance sur n : 228e (quitter la salle) ; sinon 2151:02a0 (errance)
  Err = 0 ; retour 7
```

`contact(o)` : `p = 2120:0008(o)` (objet touché, à portée) ; selon `Num` de `p` : la réaction du personnage (duel, repas, vol…). Aucune distance seuil : le contact est celui de `1a50:0006` (§ 3.1), le déclenchement de poursuite n'exige que la **même salle** et la visibilité (§ 1.5).

### 7.2 Prytwen le malfaisant (`Num 101`, `28b1:*`)

Description (messages 30 + Ego) : `Ego 0` normal ; 1 en affaire ; 2 assommé ; 3 mort ; 4 s'en va ; 5 attend l'or. `Chg 600`, `Pds 450`, `Lum 32` (CFG), salle initiale 105 (sa tanière ; sa salle au trésor est la 110).

- **Aiguillage `Ego`** (table `28b1:03b6`, certain) : 0 -> décision ; 1 -> animation (`16f5:02a2`, fins ci-dessous) ; 2 et 5 -> inerte (`Err = 0`) ; 3 -> mort : hors de la salle chargée, dans la salle 110 un objet de remplacement est créé (`1a6b:0006`, probable), ailleurs Prytwen est détruit ; dans la salle chargée il reste inerte ; 4 -> fuite : `228e:0000(-1, 7)` (quitter par une sortie non barrée).
- **Décision (`Ego 0`, `Ctl == 0`)** : on compte ses objets de `Val >= 10` (`n`) et on note s'il possède la clef de bronze (`Num 109`) ; s'il a des trésors **et** la clef et n'est pas dans sa tanière, il tente d'abord de quitter la salle (`228e`). Sinon il parcourt les objets de sa salle (visibles, `Inv = 0`) :
  - **héros** (`Num 1`), pas déjà sa cible et `Ego != 6` : dans sa tanière (salle 105) il l'**aborde toujours** (`22ef`, message `G126`) ; ailleurs il l'aborde (message `G125`) s'il n'a aucun objet de valeur, sinon avec une chance sur n ;
  - **nains** (`201..204`, `301`) en `Ego 0/2/4` : dans la tanière il les approche (il les attaque) ; ailleurs, si le nain est en `Ego 0`, il **fuit** par une sortie (`228e`) avec un message ;
  - **Sarhûl** (`302`), **Minas Thyl** (`303`) : fuite par une sortie avec message ;
  - le coffre de chêne (`21`) et le coffre de la salle au trésor (`110`) : il s'en approche (une chance sur n) pour y ranger ou y reprendre son butin ; objets ramassables de `Val >= 10` et clef `109` : ramassage (`219b:00d0`).
  Sinon, une chance sur n de quitter la salle, ou errance (`2151:02a0`).
- **Contact** (`28b1:0734`, ne s'exécute que si Prytwen est en `Ego 0`, 4 ou 5) : cible `Num 1` visible et `Ego 0` : dans la tanière (salle 105) -> message `209c:0092` et duel immédiat (`Ego 1` pour Prytwen, `Ego 6` pour le héros, animation 13/14, positions copiées, `P + 1`) ; ailleurs, si Prytwen est `Ego 0` : **ultimatum** — `4b50 = 0`, les deux se font face (`1a37:003a`), `209c:000c`, Prytwen reçoit l'événement 14 (**20 tics**, proc 101) ; cible `Num 110` (coffre au trésor) : il y range son butin non clef (si le coffre est verrouillé il lui faut la clef `109`) ; cible `Num 21` (coffre de chêne) : il l'ouvre s'il est fermé non verrouillé (`Ego 1`) puis le pille (`28b1:1140`) ; objet ramassable : il le prend (`Val >= 10` ou clef, poids ok).
- **Fin de l'ultimatum** (événement 14, `28b1:11e0`) : si Prytwen est toujours `Ego 5` et que le héros est à portée en `Ego 0`, il l'agresse (position du héros recopiée sur celle de Prytwen, `P + 1`) ; sinon il repasse `Ego 0`.
- **Résolution du duel** (fin des animations 13 et 14, `28b1:0114`, certain) : `c` = compteur de duels (`Mc1` +0x20, de 0 à 6, incrémenté modulo 7 à chaque duel), `d` :
  - salle 105 : `d = 0` ;
  - ailleurs : `c < 2` : `d = rand() % 4 + 1` ; `c >= 2` : `d = gm_chance_one_in() + 1` (donc 1 ou 2).

  | `d` | Issue |
  |---:|---|
  | 0 | le héros est tué : Prytwen `Ego 0`, dépouille variante 0 + `G101`, Prytwen vole la dépouille (`28b1:1140`), puis il part (`228e`) |
  | 1 | **Prytwen KO** : `Gst 0`, `Mob 1`, `Ego 2`, `Fig 1` ; événement 6 = **3000 tics** (proc 101) ; le héros reprend la marche (`G118`) ; points `(1, 1)` |
  | >= 2 | le héros est **KO** : animation 12 (`G102`), Prytwen passe `Ego 4` (il part), vole le héros (`28b1:1140`), `G124` |

  Sans duel antérieur : 25 % de victoire du héros, 75 % de KO ; dans la tanière : mort certaine. L'animation 15 (autre issue de duel) : Prytwen `Ego 4`, héros KO via `26ab:0134`, vol.
- **Vol** (`28b1:1140(source, receveur)`) : tant que le contenu de la source a un objet de `Val >= 10` ou de `Num 109` qui rentre dans la capacité du receveur (`20ac:0060`, `Chg 600`), il est déplacé (`19dc:0000`) ; `209c:000c` si le héros en est témoin.
- **Événements** (table 8, clé 101, `28b1:11e0`, probable) : 6 = réveil après KO (si Prytwen est dans l'inventaire du héros : il est déposé dans la salle ; 1 chance sur 4 il repasse `Ego 0`, sinon il agrippe le héros dans une animation à deux ; sinon `Ego 4` et un message) ; 7 = **retour dans la salle 110** en (`X 0x2C`, `P 0x2F`) 10 000 tics après sa fuite (`28b1:0578`), si le héros n'y est pas ; 14 = fin de l'ultimatum.
- **Verbes** (`28b1:0b6e` objet direct, `0fba` objet indirect) : *prendre* un Prytwen assommé (`Ego 2`) dont le poids tient dans `Chg` du héros : `V101` ; héros `Ego 8` (`26ab:01fc`), points ; trop lourd : `V120` ; *jeter/mettre* : le dépose (`V105`) ; *fouiller* : `V103` (liste ses poches) ; *attaquer* un Prytwen à terre : `V108` (refusé) ; *fouetter* : le fouet est arraché et détruit (`V109`) ; *parler* : `V110`/`V136` ; *tuer* un mort : `V134` ; *donner* de l'or : détail non relevé (§ 12).

### 7.3 Nains (`Num 201..204`, `301`, `2a44:*`)

- **Types** (`Num - 201 = x`) : `x ∈ {0, 1}` (201, 202) : `t = 0`, nain « mineur » armé d'un couteau ; `x ∈ {2, 3}` (203, 204) : `t = 1`, guerrier à la hache ; `x >= 4` (301) : `t = 2`, soldat (`e = 7`). Chacun a ses animations individuelles : *assommé* `ANM 20 + x`, *abattu* `ANM 24 + x` ; soldat : 37 et 38 ; désintégration : ANM 28.
- **Aiguillage `Ego`** : 0 ou >= 5 : décision (si la réaction de contact vaut 0 elle rend la main) ; 1, 2, 3 : états de combat/animation (la réaction de contact les ignore) ; 4 : fuite ; 5, 6 (soldats) : gardes d'un poste (cibles `2151:0006` avec X dans `[100, 170)` et P dans `[50, 52)` pour `Ego 5`, X `[57, 95)` et P `[18, 20)` pour `Ego 6` : `2a44:0a60` et `2a44:0a84` empilent (X : `AX = 7`, `DX = lo`, `BX = hi` ; P : `7, lo, hi`) ; l'ancienne lecture `(0x34, 0x32, 7)` du décompilat prenait des bornes de P pour des coordonnées) ; 7, 8 : endormis (décor).
- **Décision (`Ego 0`)** (probable, structure certaine) : pour chaque objet de la salle visible : herse (`Num 207`) ouverte -> le nain **crie « Armaëth ! »** (`G232`) et la referme (`29fd:017a`) ; héros -> approche (`2a44:135a`) ; Prytwen (`Num 101`) -> approche ; Sarhûl (`302`) et Minas Thyl (`303`) -> **fuite** (`228e`) avec message (`G340`) ; objets de valeur (`Val >= 10`) -> ramasse via `219b:00d0` ; sinon 1 chance sur n de quitter la salle, errance. **Soldats de la salle 305** (désassemblage `147f:016a..025a` et `2a44:08da..0994`, certain ; vérifié par le port et le robot) : (1) à **chaque entrée** du héros (`147f:000a`), les portes 309 et 329 sont ramenées dans la salle chargée (`20b5:0248(Num, -1)`), puis, pour chacune des deux places (`SI` = 1 puis 0), **s'il n'y a pas déjà** un soldat à cet `Ego` et avec **une chance sur 2** (`gm_chance_one_in(2)`), le premier soldat `Ego 0` de la salle passe `Ego 7 + SI` (`1a37:003a`, `Fig = SI + 1`, `Gst 7`, `Mob 1`), ses mouvements sont remis à zéro (`30d9:0114(7, 7)`), un réveil est armé (`23a2:0002(op 3)`, événement 4 et 120 tics pour `Ego 8`, événement 3 et 60 tics pour `Ego 7`, procédure 201) et sa position est écrite **après** le placement : `Ego 8` (écroulé dans son assiette) en `(X 0x44, Y 0x50, P 0x48)`, `Ego 7` (dort sur sa chaise) en `(0x24, 0x50, 0x3A)` (`P 0x3A`, pas `0x36`), `Sol 0`, `Ver 1`. Ils se réveillent à l'échéance (`2a44:12fc`, `G342`). Les soldats `Ego 5` / `6` ne s'endorment jamais. (2) **Gardes de poste** : un garde qui voit le héros (`Ego 5` ou `6`, héros ni en chute ni sous animation) l'attaque seulement si le héros est sur la case 0x37 (`Ego 5`, cellier) ou 0x36 (`Ego 6`, passage nord) ; sinon il l'ignore tant qu'un autre soldat est éveillé (`Ego 0..1` pour le garde du cellier, `Ego 0..5` pour celui du passage nord : `21fb:005a`), puis, s'il n'y en a pas, tant qu'un soldat dort (`Ego 7/8` : message `G341` une fois sur 6 devant le héros ou Prytwen, compteur `DGROUP:5282`) ; sans éveillé ni endormi il reprend `Ego 0` et attaque. Un soldat `Ego 0` poursuit le héros à vue (il ne quitte pas la salle 305 : `2a44:0a2c`). Au chargement, `CFG` met les soldats de séries 58 et 82 à `Ego 0` : l'arrivée du héros donne donc 1 chance sur 4 que les deux dorment, 1 sur 2 qu'exactement un dorme.
- **Contact avec le héros** (`2a44:0ae6`, certain) : le héros doit être visible (`Inv == 0`), `Ego ∈ {0, 2, 5}` (marche, grimpe, KO) ; sinon, s'il est caché (`Inv != 0`) et le nain d'`Ego < 7`, simple `2273:000c` (le nain se tourne). Si le héros porte Prytwen (`Ego 8`), le contenu est lâché (`19dc:0000`). Puis : le nain passe en `Ego 1` (animation), le héros en `Ego 6`, la position du héros est copiée sur celle du nain (`P + 1`), le duel (ANM 29) commence.
- **Résolution du duel** (fin de l'ANM 29, `2a44:02de`, certain) : `S` = bouclier (`Num 205`), `X` = épée d'orichalque (`314`), `A` = hache (`206`) **dans l'inventaire du héros**, `r = rand() % 4`, `t` = type.

  | Cas | Issue |
  |---|---|
  | `S` et `X` | victoire décisive (V) |
  | `t = 0` : `S` et `A` | V |
  | `t = 0` : `S`, ni `A` ni `X` | `r = 0` perte (P), `r = 1` assommé (K), `r = 2, 3` le nain renonce (F) |
  | `t = 0` : pas `S`, `X` | V |
  | `t = 0` : pas `S`, pas `X`, `A` | `r ∈ {0, 1}` P, `r ∈ {2, 3}` V |
  | `t = 0` : rien | `r = 0` K, sinon P |
  | `t = 1` : `S`, `A` | `r = 0` P, `r = 1` K, `r >= 2` V |
  | `t = 1` : `S`, sans `A`, sans `X` | `r = 0` K, sinon P |
  | `t = 1` : pas `S`, `X` | `r = 0` K, sinon V |
  | `t = 1` : pas `S`, pas `X`, `A` | `r = 0` V, sinon P |
  | `t = 1` : rien | P |
  | `t = 2` (soldat) : pas `S`, `X` | `r ∈ {0, 1}` K, `r ∈ {2, 3}` V |
  | `t = 2` : `S`, sans `X`, `A` | `r = 0` K, sinon P |
  | `t = 2` : autres | P |

  - **V** : le nain meurt : `ANM 24 + x` (soldat : 38) en mode message 3, puis ANM 28 (désintégration, `G204` la première fois) puis le nain est détruit ; message du héros : `G360` (épée dans l'inventaire) sinon `G203` ; **points `(2, 4)`** si `t = 1` ; si le nain est un soldat de la salle 305 sans autre `Num` dans la salle : points supplémentaires ; le héros retrouve la marche (`246c:0240`, `AL = 7`).
  - **K** : le nain est assommé : `ANM 20 + x` (soldat : 37), `Ego 2` ; message du héros : `G216` (bouclier) ou `G202`, soldat : `G358` (bouclier) ou `G359`. Réveil quand l'animation finit : `G214`, `Ego 0`.
  - **F** (`t = 0`, `S` seul) : le nain s'enfuit (`Ego 4`, `G217`) vers une sortie (`228e`).
  - **P** : le héros meurt : nain `Ego 0`, messages `G220` + `G201` (mineurs et guerriers) ou `G356` + `G357` (soldat), le nain **confisque** les 8 objets clés présents (`21f0:0008` avec la liste `DGROUP:5272` : `6, 109, 108, 320, 328, 314, 331, 321` : clef d'or, clef de bronze, trousseau, baguette, couronne, épée d'orichalque, clef ouvragée, talisman) dans la limite de son poids (`G212`), puis `2405:0000` (dépouille variante `rand() % 2`).
- **Verbes du joueur** (`2a44:0eb8`, certain pour les conditions, probable pour les effets) : *attaquer* (21) un nain qui n'est pas en `Ego 1, 2, 3` : duel (ANM 29 sur le nain, message `V206`, puis `2594:0004` sur le héros, position copiée) ; *tuer* (22) un nain **assommé** (`Ego 2`) ou **endormi** (soldats `Ego 7/8`) : exige l'épée d'orichalque (`314`) ou la hache (`206`) pour un nain (`V366` à l'épée, `V207` à la hache seule), l'épée seule pour un soldat (`V366` ; `V367` hache seule ; `V368` sans arme) ; le nain passe `Ego 3` avec l'animation `Num - 177` (24..27 ; soldat : 38) puis se désintègre ; refus `V208` sans arme ; *fouiller* (7) un nain `Ego 2/3` : `V205` et liste de ses poches ; *fouetter* (23, fouet `Num 10`) ou *parler* (24) : le nain passe `Ego 0`, `+0x28 = 1` et se dirige vers le héros (`2a44:135a`), `V209`/`V210` ; sur un nain occupé : `V201`..`V204`.

### 7.4 Résumé du « combat » pour une réimplémentation

Un combat = (déclencheur de contact ou de verbe) -> (animation à deux, `Ego 1`/`Ego 6`) -> (table de résolution à la fin de l'animation). Il n'y a ni dégâts cumulés ni initiative ; seuls comptent : les objets de l'inventaire, le type du nain, un tirage `rand() % 4`, et pour Prytwen un compteur modulo 7.

### 7.5 Minas Thyl (`Num 303`, `2dd9:*`)

Description : § 3.2. Dans `CFG` elle est en salle 304 avec le talisman (`Num 321`, `Val 2000`) dans ses poches ; sa baguette (`Num 320`) est dans le coffre de fer `319` de la salle 313 ; son antre (chaudron `306`, grimoire `305`, fiole `304`) est la salle 301.

- **Aiguillage `Ego`** (table `2dd9:03d0`, certain pour l'adresse de chaque cas) : 0 et 7 -> décision ; 1 -> attend la fin de la séquence d'images (`1833:0336`) puis `2dd9:1478` (remet un état) ; 2 -> lance l'animation 44 (apparition, `Ego 6`) ; 3 -> repasse à 0 ; 4 -> inerte (elle emmène sa victime, voir « Contact ») ; 5 -> comme 1 puis quitte la salle (`228e`) ; 6 -> interroge l'animation, aiguillage sur l'id fini : 45 (disparition) -> choisit une salle d'arrivée au hasard (voir ci-dessous), se pose `Ego 2` et part ; 44 (apparition) -> `Ego 0` et message `G310` ; 34 -> la victime liée (`Bag`) est remplacée par une dépouille (`2405:0000`, position copiée, `P - 4`) ; 36 -> points, message (`G308`, elle sombre dans la lave) et destruction de Minas Thyl.
- **Téléportation (baguette en sa possession)** : une chance sur n par tic de décision ; tirage d'un numéro de salle `rand() % 4b62` jusqu'à obtenir une salle d'id >= 22 différente de 212 et 313 (une chance sur n de choisir directement la salle 301) ; `1478(…, Ego 2)`, `+0x66` = salle, `Inf = 6`, `186d:000c` ; dans la salle d'arrivée l'`Ego 2` lance l'animation 44 (elle apparaît, `G310`). La disparition (animation 45) est lancée par la décision ou par certains dialogues (`V324`). Sans baguette elle erre dans sa salle.
- **Cibles** (liste A de sa salle, objets visibles) : héros (`Num 1`) si elle est `Ego 0` et qu'il n'est pas caché ; Prytwen (`101`), nains (`201..204`, `301`) (sort `2dd9:14cc`) ; ours (4) ; crapaud (`327`) ; émeraude (`313`) et objets de valeur (`219b:00d0`) ; messages d'ambiance `G312` (nain), `G315` (Prytwen), `G316` (Sarhûl).
- **Sort `2dd9:14cc(victime, Minas)`** : `1a37:003a` sur Minas (`Ego 1`), puis `2d52:06b0(victime, Minas)` : la victime est **remplacée par un crapaud** (`Num 327`), qui garde le `Num` d'origine dans `+0x28` (§ 8.7), animation 46/47 ; si la victime était le héros joueur, `4bfe` désigne le crapaud.
- **Contact** (`2dd9:0858`, Minas `Ego 0` ou 7, ou 4 avec le chaudron `306`) : cible `Num 1` visible et `Ego ∈ {0, 2, 5}` : dans son antre (salle 301) elle capture le héros (`G323`, elle passe `Ego 4`, le héros est entraîné jusqu'à son chaudron `306` : fin « soupe humaine » avec `G364` et dépouille variante 2) ; ailleurs, selon l'inventaire du héros : baguette dans ses poches -> exigence / menace (`G327`, `G328`, `G343`) ; elle prend l'émeraude, la baguette, la sphère de cristal et la fiole qu'il porte (`21f0:0008`, liste `DGROUP:5284` = 313, 320, 315, 304) ; rien -> `G321`/`G322` ou sort ; chaudron : il bout (`Ego 1`).
- **Dialogues** (verbe *donner*, 32, `2dd9:0fd0` objet indirect ; Minas `Ego ∈ {0, 5, 7}`) : la **baguette** (`320`) : première fois `V321`, `V323`, et le **talisman passe dans l'inventaire du héros** (points via `2255:00e8`) ; si elle n'a plus de talisman : `V324` ; ensuite `V322` ; l'**émeraude** (`313`) : `V318` et elle s'y précipite ; la **sphère de cristal** (`315`) : `V320` ; les clefs : `V325` ; la fiole : `V372` (elle la reprend et se fâche) ; le talisman : `V373` (elle le prend, le héros « découvre sa vraie condition » : sort `V374`) ; tout objet de valeur : `V326`, `V329` ; sans valeur : `V327` ; rien à offrir : `V313`. *Prendre* son grimoire : `V333`/`V334`. *Parler* à Minas Thyl `Ego 0/5/7` : elle approche (`22ef`) et parle (`V316`, `V317`).
- **Confiance** : adresses, tables, messages et conditions de téléportation : certain ; enchaînement exact des états `Ego 1..6` et déroulé de la capture : **probable / hypothèse** (le module `2dd9:009d`, 47 Ko, est un fragment non décomposé par Ghidra, voir § 12).

## 8. Créatures et éléments animés

### 8.1 Ours des cavernes (`Num 4`, `26da:*`, salle 7)

- **Initialisation** (`Set` +0x2C nul) : événement 9 (faim) = **24 000 tics** (proc 4 = `26da:0800`) ; `Ego 0` au départ. À l'échéance de l'événement 9 : `Ego 0` -> `Ego 1` (affamé) et réarmement ; `Ego 1` -> si l'ours n'est pas dans la salle chargée il **meurt de faim** (des objets de dépouille sont créés : carcasse `Num 15`, fourrure `Num 5` ; probable), sinon réarmement. L'événement 12 (2000 tics, posé à la fin d'un repas) n'a pas de procédure : c'est un simple drapeau « rassasié ».
- **Aiguillage** : `Err` 8/9 -> contact (seulement si `Ego < 2`) ; 11 -> sortie ; 12/14/15/19 -> `Def = 0`. `Ego 0, 1` : décision ; `Ego >= 2` : animation (`16f5:02a2`) : fin de l'id 41 (dévoré par un Sarhûl) -> destruction ; id 9 -> enchaîne l'animation 10 (`Ego 2`, il mâche : 40 puis 20 boucles) ; autre id -> remet un état (`Ego 0`), réarme l'événement.
- **Décision** : si la salle est la salle chargée et éclairée (`197e:0272 == 0`), que des abeilles (`Num 24`) sont présentes, que l'événement 12 (rassasié) a expiré et (`Ego != 0` ou `2241:003a` — appétit) : il se dirige vers elles (`22ef`). Sinon il parcourt sa salle : héros (`1`), dépouille (`2`), pie (`3`), Prytwen (`101`), Sarhûl (`302`), Minas Thyl (`303`), crapaud (`327`) : `219b:0092` (visible + approche) ; il n'attaque que s'il est dans la salle 7 (sa grotte) ou affamé (`Ego != 0`), sinon avec une chance sur n ; à défaut une chance sur n de changer de salle (`228e`), sinon errance (`2151:02a0`). Il ne cible **pas** les nains.
- **Contact** (`26da:0480`, certain, ours `Ego < 2`) selon la cible : **héros** (`Ego <= 5`, même invisible : le contact suffit) : animation à deux (ours `Ego 4`, héros `Ego 6`), `G21` ; la fin du côté héros est l'animation 4 : `G25` et mort avec le contenu laissé (§ 6.2) ; **dépouille** `Num 2` : détruite, `G27`, ours `Ego 2` ; **Prytwen** (`Ego 0` seulement) : `G117`, animation à deux (le voleur est dévoré) ; **abeilles** (`24`, hors obscurité) : l'ours prend leur position (`P + 1`), `G28`, il reste occupé (`Ego 3`) ; **pie** : `G26`, la pie passe `Ego 6` (morte) ; **crapaud** (`327`) : détruit, `G352` ; **nains, soldats, Minas Thyl** : pas d'attaque, il affiche `G206` (« les nains sont les amis des animaux ») puis se met face à eux ; **Sarhûl** : face-à-face sans message (le nain, de son côté, caresse l'ours : `G234`).
- **Verbes** : *fouetter* (23) avec le fouet (`Num 10`) un ours d'`Ego < 2` assez proche : `V77`, puis `rand() % 5` : 4 fois sur 5 `V78` (il a peur, cible d'errance, `2151:02a0`), 1 fois sur 5 `V79` (raté) ; sans fouet `V80`. Description `Ego 1` : affamé. L'ours est écarté par le fouet, ignore le héros invisible (perception), et s'occupe des abeilles quand il est rassasié.

### 8.2 Pie (`Num 3`, `2774:*`, salle 10, volante `Dep 1`)

- **États** (`Ego`) : 0 vol/errance, 1 alerte (cherche), 2 repos 200 tics (`Tim`, 1 chance sur n d'inverser `Hor`), 3 fuite avec butin, 4 porte un objet, 5 sommeil (tant qu'il fait nuit), 6 morte (animation puis destruction).
- **Décision** : le nid (`Num 19`, contient le diadème `Num 8`) est visé si la pie fuit (`Ego 3`), s'il fait sombre ou 1 fois sur 4 au repos ; la **petite clef en or** (`Num 6`) est ramassée via `219b:00d0` ; toute autre créature mobile visible la fait fuir (`2774:061c`, `Ego 0` ou 3, `2273:000c`) ; 1 chance sur n de se reposer.
- **Contact** (`2774:049e`) : sur la clef : si `Chg 2` le permet, elle la prend (`Ego 4`, `G29`) ; sur le nid : elle y dépose son butin (`19dc:04f1`), `Ego 2` (repos, `Tim 200`, `Hor 1`) s'il fait jour, `Ego 5` (sommeil) sinon ; sur un objet statique : rien ; sur une créature : fuite.
- Mortelle pour la pie : l'ours (`G26`), les Sarhûls (`G305`). Description : § 3.2.

### 8.3 Sarhûls (`Num 302`, `2cdf:*`, salle 309)

- **Aiguillage** : `Err` 8/9 -> contact ; 11 ; 12.. ; `Ego 1, 2` : animation (fins : id 40 -> `Ego 0` ; id 31 -> détruit la victime liée puis `Ego 0`) ; `Ego 3` : occupé jusqu'à ce que `21e7:003c` ne trouve plus de proie dans la salle -> `Ego 0`.
- **Décision (`Ego 0`)** : cibles : héros (sauf `Ego 6`), Prytwen (`101`), pie (`3`), ours (`4`), nains (`201..204`, `301`), jambon (`311`), crapaud (`327`) : `219b:0092` (visible + approche) ; un autre Sarhûl en `Ego 2` (« attend son tour ») est approché. Sinon une chance sur n de partir (`228e`), sinon errance.
- **Contact** (`2cdf:02da`, certain, Sarhûl `Ego 0`) : dans la salle 309, le contact n'a lieu que si les deux objets sont du **même côté de la grille** `316` (types `58`/`112` vs `57`/`113` selon l'état de la grille, `2c1e:02de`). Selon la cible : **héros** : sauf s'il est en `Ego 6`, animation à deux (Sarhûl animation 40, héros animation 41, `Ego 1`/`Ego 6`), `G302` si le héros est visible et `G363` s'il est invisible (il a touché la bête), puis mort par l'animation 41 (`G338`, contenu laissé) ; **pie** : dévorée (`G305`) ; **jambon** : `G304`, le jambon est détruit, le Sarhûl est occupé ; **crapaud** : dévoré ; **Prytwen**, **nains**, **soldat** : animation de dévoration (`G303`) ; **Minas Thyl** : épargnée (`G306`, simple face-à-face) ; **autre Sarhûl** `Ego >= 2` : devient `Ego 3`.
- **Verbes** (`2cdf:054a`/`0686`/`06d2`) : donner un jambon (`311`) à un Sarhûl : il le prend (`V312`/animation) et reste occupé ; offrir autre chose : `V313`, `V327`.. Description `Ego 1`.. : § 3.2. Protection : jambon, invisibilité (il ne voit pas mais le contact reste fatal), forme transformée (`Ego 6`), rester hors de sa salle ou du mauvais côté de la grille.

### 8.4 Feu (`Num 18`, `264c:*`)

- **Variables** : `Ego` = niveau 0..6, `Set` +0x2C, `Tim` +0x32 = combustible restant, +0x34 = compteur de 100 tics, `Ver = 1` en permanence, `Lum` +0x0A = lumière.
- **Tic** (`264c:0002`) : 1er tic : `Set = 7`, `Tim = D[Ego]`, +0x34 = 0 ; si `Ego == 0` : `Gst = 0` (mort, plus de mises à jour) ; sinon +0x34 += 1 ; à 100 : +0x34 = 0, `Tim -= 100` (0 si `Tim <= 100`) ; si `Tim = 0` : `Ego -= 1` ; si `Ego > 0` : `Tim = D[Ego]` ; état (`1a37:007f`, `Fig = Ego`) ; `Lum` : si `Ego < 3` -> 0, sinon `Lum = (((Tim / 10) / (D[Ego] / 1000)) << 4) / 100 + (Ego - 3) * 16` ; si `Lum` change : palette à recalculer (`4ae6 = 7`).
- **Durées** `D[Ego]` (`DGROUP:5264`, tics) : `[0, 24000, 18000, 12000, 12000, 6000, 6000]` (niveau 1 : 240 min de jeu ... niveau 6 : 60 min).
- **Raviver** (`264c:02b0(AL = niveau voulu ou 0 -> Ego + 1, plafond 6, DL != 0 -> message ; objet consommé)`) : `Ego` = niveau, `Fig` = niveau, `Tim = D[niveau]`, +0x34 = 1000 (recalcul au tic suivant), l'objet consommé est détruit ; messages `V27`/`V28`. Appelé par les verbes (`264c:01ac` : jeter/mettre une **torche** (`Num 12`) dans le feu éteint ou vivant : `V9`, `V27`, `V28` + points) et par l'immolation du héros (niveau 6 forcé, ANM 3).

### 8.5 Torche (`Num 12`, `2420:*`)

`Ego 0..3` allumée (3 = neuve) ; `Ego 4..8` éteinte (`Fig`/`Ego` de 4 à 7 = niveau + 4, 8 = neuve éteinte). Tic : `Ver = 1`, +0x34 compte 100 tics ; `Tim -= 100` ; à 0 : message `V1`..`V4` si la torche est dans l'inventaire du héros ; `Ego == 0` : détruite, sinon `Ego -= 1`, `Tim = T[Ego]` avec `T = [12000, 18000, 24000, 36000]` (`DGROUP:525C`) ; `Lum = (((Tim / 10) / (T / 1000)) << 4) / 100 + 16 * Ego`. Éteindre (`2420:0398`) : `Ego/Fig += 4`, `Lum = 0`. Allumer au feu (`2420:011e`) exige un feu de `Ego >= 3` (ou une torche allumée), remet `Ego -= 4`, `Tim` = valeur de la table, +0x34 = 1000. Les torches du héros s'éteignent en entrant dans la salle 304 (`G373`).

### 8.6 Ronces (`Num 20`, `257b:*`)

`Dep 1`, `Txt 2`. Les verbes *arracher* (8), *briser* (10) et *nettoyer* (26) ne marchent que si le héros est sur `Sol 39` (la case devant elles) : il passe alors `Ego 7` (§ 4.2.7). À la fin de l'animation 7 : les ronces sont détruites, la stèle (`Num 16`) passe à `Ego 5` (fermée, visible) et des points sont attribués ; `G20`. *Allumer* : refusé (trop humides).

### 8.7 Crapaud (`Num 327`, `2d52:*`)

Créature « de transformation » : `+0x28` = `Num` d'origine de la créature ensorcelée (`2d52:06b0` copie son `Num` et son octet +0x14 ; la nouvelle créature est placée à la position de la victime, `Ctl = 0` si c'était le héros joueur, qui contrôle alors le crapaud). États : 0 normal, 1 « pensif » (il s'arrête 100 tics quand le héros le touche : événement 8, proc 327 = `2d52:07fe`, `2d52:03d6`), 2/3 en métamorphose (animations 46/47). Verbes (`2d52:0496`) : *attaquer/tuer* (21, 22) : le crapaud est détruit (`V343` probable) ; *embrasser/aider* (37, 38) : si `+0x28 != 1`, animation de métamorphose et `V345` -> la créature d'origine reparaît (`G332` ours des cavernes, `G333` Prytwen, `G334` nain) ; le cas `+0x28 == 1` (héros ensorcelé) lance `2594:0004` et un `Hor` aléatoire ±1 (non élucidé) ; `2d52:059f` : animation 35 + `V344` (morsure empoisonnée, mort) dans un cas de baiser non élucidé. Sarhûls et ours le mangent.

## 9. Magie, protections, temporisateurs

### 9.1 Protections contre les accidents

| Danger | Protection | Mécanisme | Durée |
|---|---|---|---|
| Lave (`Sol 52`) | **potion** (bouteille `332` à `Ego 1` ou 2) | *boire* (34) ajoute **400 tics** à l'événement 0 du héros (proc 1001 = `2c9c:00ee`) ; chaque gorgée fait passer la bouteille 1 -> 2 -> 3 (vide) ; à l'échéance, message `V360`, et si le héros est sur la lave : animation 33 (`V361`) | 400 par gorgée (2 gorgées) |
| Frelons (`Sol 37`) | **élixir d'invisibilité** (fiole `304` à `Ego 1`) | *boire* : `Inv` du héros != 0 pendant **2500 tics** (événement 1, proc 1002 = `2b9d:0102`, fin `V362`) | 2500 |
| Gaz (salle 304) | quitter la salle | événement 2 = 1000 tics après l'entrée | 1000 |
| Chapiteau (`Sol 60`) | **talisman** `321` | test d'inventaire | permanent |
| Nains | bouclier `205`, hache `206`, épée `314` | table § 7.3 | – |
| Sarhûl, ours | invisibilité (perception) ; fouet (ours) ; jambon (Sarhûl) | § 8 | – |
| Prytwen | rester hors de sa tanière, sinon duel | § 7.2 | – |

`Inv` (+0x2F) nul = visible ; non nul = **caché** : le héros invisible n'est plus cible des PNJ (`219b:0000`), n'est pas piqué par les frelons, est pris par un Sarhûl **s'il le touche** (`G363`).

### 9.2 Temporisateurs différés (`23a2`)

Table de **12 octets** (`Typ`, `Num`, `Ser`, événement, compteur, procédure) ; `23a2:0002(AX = opération, DX = événement, BX = valeur ; objet, clé de procédure)` : opérations `-1` supprimer (rien si absent), `0` lire ou créer, `1` ajouter (plafond 0xFFFF, crée si absent), `2` retrancher (plancher 0, rien si absent), `3` fixer, `4` autre (non relevé, rien si absent) ; renvoie la valeur. `23a2:0250` (à chaque tic de monde, après les objets) décrémente chaque compteur ; **l'entrée est retirée quand le compteur valait 0 avant le décrément** (donc `n` tics d'attente = `n + 1` passages) et la procédure (table 8, clé = clé de l'entrée) est appelée avec l'objet de `Ser` mémorisé (nul si `Ser = 0`) et l'événement en `AX`. Événements relevés :

| Porteur | Événement | Durée (tics) | Proc | Effet à l'échéance |
|---|---:|---|---|---|
| héros | 0 | +400 par gorgée | 1001 | fin de la protection contre la lave (§ 9.1) |
| héros | 1 | 2500 | 1002 | fin de l'invisibilité |
| héros | 2 | 1000 (entrée salle 304) | 1 | asphyxie : animation 35 + `G301` si le héros est encore en salle 304 et `Ego != 6` |
| héros | 10 / 11 | `9m` / `m` | 1 | noyade (§ 4.3) |
| Prytwen | 6 | 3000 (KO), 100 en réarmement | 101 | réveil |
| Prytwen | 7 | 10 000 | 101 | retour en salle 110 |
| Prytwen | 14 | 20 | 101 | fin de l'ultimatum |
| ours | 9 | 24 000 (100 si l'ours est dans la salle chargée) | 4 | faim : `Ego 1` (probable) |
| ours | 12 | 2000 | 4 | aucun effet : drapeau « rassasié » |
| crapaud | 8 | 100 | 327 | `Ego 1 -> 0` |
| objet nul | `100 + niveau` | 60 | 2000 | fenêtre d'introduction du niveau (§ 11) |
| soldats (salle 305) | 201 | – | – | arrivée (§ 7.3) |

### 9.3 Réactions (famille 9) et ultimatums

`2363:000c(objet visé)` est appelé par les verbes en échec sur un personnage : le gestionnaire de famille 9 de l'objet (`2683:0000`, `2774:045c`, `26da:0444`, `28b1:1482`, `2a44:13fa`, `2cdf:0706`, `2dd9:1570`, `2d52:0838`) répond **7** si le personnage est disponible (`Ego` 0, ou 0/4/7 selon le module) -> la commande ratée **arme une réaction** (`4cc8`, contexte mémorisé en `DGROUP:47f92..`) ; sinon il affiche son message d'indisponibilité (`Ego` occupé) et répond 0. Fin de commande : `2363:0154` fait agir le personnage mémorisé : `22ef:0000(lui, héros)` jusqu'à deux fois (il **se dirige vers le héros**), puis efface la réaction. C'est ainsi que déranger un nain, Prytwen ou Minas Thyl les fait venir au héros.

### 9.4 Noms magiques (verbes de classe 13, table 6)

Prononcés en commande (« armaeth », « tinhuel », « erin », « tehrehanan », « ezhrimanoth », « sillerynn ») ; le gestionnaire est appelé avec `AX = 0` pour exécuter (autre valeur : refus silencieux).

| Nom | Clé | Gestionnaire | Condition | Effet |
|---|---:|---|---|---|
| armaeth | 1 | `3443:0008` -> `3443:0028(0)` | salle 202 ou 305 (herse `Num 207`) | referme la herse si elle est ouverte (`Ego 3`) : `V212` ; sinon `V211` (déjà fermée) ; hors de ces salles : `V217` |
| tinhuel | 2 | `3443:0018` -> `3443:0028(7)` | idem | ouvre la herse si elle est fermée (`Ego 0`) : `V214`/`V215`, `+0x28 += 1` ; `V216` si déjà ouverte ; `V213` si les nains ont bloqué le mécanisme |
| erin | 3 | `3474:000c` | talisman (`321`) dans l'inventaire (`V386` sinon) ; un nom de lieu (classe 19, `code % 1000` = id de salle) dans la phrase (`V387` si inconnu) ; héros `Ego 0`, `Fig 0` | `+0x38` = salle, animation 18 puis 17 (§ 6.2), `V87` |
| tehrehanan | 4 | `3454:000c` | baguette (`320`) **et** bouteille (`332`) à `Ego 0` | bouteille -> `Ego 1` (potion), `V380`, points `(3, 12)` ; `V379`..`V382` pour les refus (pas d'hydromel, déjà transformé, vide) |
| ezhrimanoth | 5 | `346c:0008` | baguette (`320`) **et** fiole (`304`) à `Ego 0` | fiole -> `Ego 1` (élixir), `V350`, points `(3, 11)` ; `V351`/`V352` pour les refus |
| sillerynn | 6 | `345e:0004` | talisman (`321`) **et** seau (`25`) | le seau est remplacé par la **couronne** (`Num 328` créée par `1a6b:0006`, qui détruit le seau ; arguments `0x28` et `0x1388` du constructeur), points `(3, 13)`, jingle, `V355` ; `V356` (une seule couronne), `V357` (sans seau), `V384` (sans talisman) |

Le grimoire (`Num 305`) lu avec la baguette (`V336`, `V337`) donne les formules de l'élixir d'invisibilité et de la marche sur la lave. Confiance : certain pour les clés, conditions d'inventaire et références de messages ; probable pour les points et les détails de création.

## 10. Mécanismes de salle, passages secrets, fins

### 10.1 Couronnement (`Num 328` -> `Num 333`, salle 108)

- **Déclencheur** (`2c83:0004`, verbe *chausser/porter* 39 sur la couronne `Num 328`, indirect présent, le héros étant libre `Ego 0`) : `4b53 = 0` (pause levée), `4b50 = 0` (le joueur perd la main), `4b51 = 6` (délai de tic remis au défaut), `27ed:0194` (la dalle `Num 104` est placée à `Y = 0x8B` ; si la salle chargée est la 108 : 3 plans actifs), puis **tous les objets mobiles ou animés** (`Mob 2` ou `Anm != 0`) autres que le héros sont **détruits** (leur contenu va dans leur conteneur) ; enfin le héros est **remplacé par un objet `Num 333`** (`1a6b:0006` : même position, `Chg 500`, `Pds 800`, `Gst 7`), que `4bfe` désigne désormais, et l'animation 18 démarre sur lui (`Ego 0`, message `V358`).
- **Acteur** `Num 333` (`2caf:000e`) — c'est le héros contrôlé par le joueur, d'où ses descriptions adressées au joueur (§ 3.2) : `Ego 0` : attend la fin de l'animation, puis son, `2fe0:0002`, et se rend dans la salle 108 s'il n'y est pas (`Inf 6`, `+0x66 = 0x6C`) ; `Ego 1` : se place en (`X 0xA0`, `Y 0x8C`, `P 0x6C`, plan 1, `Sol 2`), animation 2 ; `Ego 2`.. `Ego 6` : séquence de marche vers le trône (`Prf = -1`, ici `P < 0x11` -> étape suivante) et animations (messages `G371` « habit royal », `G372` « Roi de Dol Armaëth » aux étapes 3 et 6) ; `Ego 7` (fin) : points, `4b67 = 4b6b = 7` (partie terminée), `14cf:000c(0x32)` (verdict, § 10.3), message `S55`, `4bfe = 0` (le héros disparaît), l'acteur passe `Gst 0`. **Désassemblage relu** (`2caf:0142..0269`, certain) : chaque étape est un `1a37:007f(mode 2, Dep 0, Txt 2, …)` avec `Gst 7` et, `Mob`/`Ego`/`Fig` : étape 3 `Mob 1`, `Ego 3`, `Fig 0` ; étape 4 **`Mob 2`**, `Ego 4`, `Fig 1` (`Hor = Ver = 0`, `Prf = 0xFF` : la marche) ; étape 5 `Mob 1`, `Ego 5`, `Fig 0` ; étape 6 `Mob 1`, `Ego 6`, `Fig 2` ; fin `Gst 0`, `Mob 0`, `Ego 7`, `Fig 3`. Le déclencheur appelle `27ed:0194` (implémenté : `objects.ts` `closeSlab`) : sans la dalle fermée les cases 81 du plan 0 retiennent l'acteur. Fin implémentée (`npc-things.ts`, `HandlerScore.verdict`) : `G372`, `(3, 7)`, drapeaux, `14cf:000c(0x32)`, `S55` (`2caf:0232`, `2caf:023a` ; `S56` n'y figure pas).
- Suite : le jeu **ne se ferme pas** (`screens.md` E14) ; F4 rappelle le choix par `S49`.

### 10.2 Passages secrets et portes de niveau

Trois objets suivent la même ossature (état `Ego`, un compteur `Tim`, des vitesses `Y`/`X` d'une unité par tic), chacun relie une salle extérieure à une salle intérieure :

| Objet | `Fct` | Salles | Mouvement | Déclencheur joueur |
|---|---|---|---|---|
| stèle `Num 16` | `2500:0008` | 5 et 101 | `Ego 2` : `X += 1` par tic jusqu'à `X >= 0x62` -> `Ego 4` (ouverte) ; `Ego 3` : `X -= 1` jusqu'à `X <= 0x36` -> `Ego 0` | clef d'or (`Num 6`, `V61`), levier (`Num 11`, `V63`) après les ronces ; `2500:016c`/`026c` (verbes et formules) |
| dalle `Num 104` | `27ed:000a` | 108 (trône) et 202 | `Ego 1` : `Y -= 1`, `Ego 2` : `Y += 1` pendant `Tim` tics (`0x16`, posé par le gestionnaire d'événement `27ed:01e0` ; événement 18 armé à 10 tics par le verbe sur la torchère) puis `Ego 3` (ouverte) / `Ego 0` | tirer la torchère `Num 114` (`V114`, `V115`) ; piège `V118` |
| herse `Num 207` | `29fd:0000` | 202 et 305 | idem avec `Tim = 0x22` (`29fd:017a`) | formules `armaeth`/`tinhuel` (§ 9.4), verbes de la herse |

À la fin du mouvement : `2f9b:0375` (coupe le son), `2255:00e8` (points), nouvel état (`1a37:003a`), `147f:000a`/`147f:0352` (recalcul des plans et de la lumière de la salle, effets d'entrée), `1793:0006(0)` (annule les trajets de la salle), `4b50 = 7`, drapeau de niveau `4b68..4b6a = 7`. Si la salle chargée est une des salles listées, des messages `S` de découverte sont affichés (`S70` « ces aventures appartiennent à d'autres épisodes » puis `S72` pour la stèle, `S74` pour la dalle, `S76` pour la herse ; `S71`..`S76` décrivent les six passages : monde extérieur, royaume actuel, ancien royaume, mine secrète, dôme d'entrée ; l'affectation de `S71`, `S73`, `S75` à chaque côté n'a pas été relevée) et le script `CM3` (état 6 : écran noir, `fin`, `sys 8`) peut clore l'épisode — **uniquement quand la plage de niveaux `4b4e = a0 * 100 + a1` (jeton `niv`) l'exige** : dans `CFG` (`a0 = 0`, `a1 = 3`) les conditions (`a1 < 2`, `a1 < 3`, `a0 < 1`...) sont fausses et les passages s'ouvrent sans verdict ni fin d'épisode. Le verdict `14cf:000c` n'est appelé alors que si le niveau courant n'est pas encore marqué (`4b68[niveau] == 0`).

Effets d'entrée dépendant des passages (`147f:000a`, probable) : le nombre de plans actifs `4ae0` vaut 3 salle 5 stèle fermée / 2 ouverte ; salle 101 : extérieur et lumière du jour si la stèle est ouverte, sinon nuit (`Lum` de salle -32) ; salle 108 : 2 ou 3 plans selon la dalle ; salle 202 : 2 plans si `4b4e / 100 < 3`, sinon 3 ; salle 205 : si `4b4e % 100 >= 3` un objet est supprimé et `4ae0 = 1`.

### 10.3 Verdict de complétion (`14cf:000c`)

Appelé avec un message d'en-tête (`S41` découverte d'un secret majeur, `S42` score (F6), `S43` abandon, `S50` couronnement). Il affiche l'en-tête, puis des lignes mises en forme par `14cf:0188` (messages `S27`..`S33`, `S42`) avec les nombres : **score** `4b5a` / maximum (725 dans `CFG`, `2255:00e8(-1)`), **fortune** et valeur des « menus objets » portés, **maximum actuel possible** (`14ee:006c`). `Val` >= 10 compte comme trésor, 1..9 comme menu objet ; `4cb8` = trésors portés par le héros (récursivement), **plus** ceux du gros coffre de chêne (`Num 21`) si le héros possède sa clef (`Num 22`) ; `4cb4` = trésors de tous les objets du monde (liste globale de type 2, sans récursion). Puis le message de conclusion :

| `4b67` (partie terminée) | Secret du niveau découvert (`4b68[niveau]`) | Tout le trésor porté (`4cb4 = 4cb8`) | Message |
|---|---|---|---|
| 0 | non | non / oui | `S36` / `S37` |
| 0 | oui | non / oui | `S38` / `S39` |
| 7 | non | non / oui | `S51` / `S52` |
| 7 | oui | non / oui | `S53` / `S54` |

Aucun test de victoire par le score ; pas de partie « perdue » : la mort renvoie à `F4` (`2594:043a`, recrée le héros au centre de la fenêtre avec `S24` si `4bfe = 0`).

## 11. Chapitres et introductions

- `niv a0 a1` (et `svg`) écrit `4b4e = a0 * 100 + a1` (0 <= a0 <= a1 < 10). Interprétation (hypothèse) : `a0` = niveau de départ, `a1` = niveau maximal ; `CFG` : `0, 3` (« niveaux de jeu 0 à 3 » de l'aide `SOS.EXE`). Le niveau est lu par `147f:000a` (plans des salles 202 et 205), `2500:0008`, `27ed:000a`, `29fd:0000`.
- **Introductions de niveau** (`21cc:000e(niveau, effacer, montrer)` appelé par `147f:0352` à l'entrée des salles **1** (niveau 0), **101** (1), **202** (2), **305** (3) et par `123d:000a`) : si le drapeau `4b73 + niveau` est nul et `4b44 == 0`, il est posé et un événement différé `100 + niveau` de **60 tics** est armé (proc 2000 = `21cc:008e`) ; à l'échéance une fenêtre affiche la liste de messages du niveau (`DGROUP:0704..`) : niveau 0 : `S13`, `S14` ; niveau 1 : `S101`..`S105` ; niveau 2 : `S201`..`S204` ; niveau 3 : `S301`..`S304`. Les drapeaux `4b73..4b76` sont sauvegardés dans l'en-tête.

## 12. Questions ouvertes

1. **`2dd9:009d`** (47 Ko, fragment non décomposé) : probablement la capture de Minas Thyl, le chaudron et la « soupe humaine » ; états `Ego 1..6` de Minas Thyl non reconstitués en entier.
2. **Dialogues de Prytwen** : association verbe -> message de `28b1:0b6e` / `0fba` (six cas relevés, deux seulement détaillés) ; mécanisme « donner de l'or » (`Ego 5`).
3. ~~**Soldats** (`Ego 5..8`)~~ : résolu (§ 7.3, `147f:016a`, `2a44:08da`, `2a44:0a3b`).
4. **Paramètres cachés de `gm_chance_one_in(n)`** : `n` n'est pas visible dans le décompilat pour la plupart des appels (registre `AX`) ; les probabilités « 1 chance sur n » sont à relever site par site (dynamique ou désassemblage ligne à ligne).
5. **`Err 3`** : jamais produit par `179d:0004` ; origine non trouvée (peut-être `1b11:000c`).
6. **Table `Err -> action` des PNJ** : seule l'ossature commune (20 entrées) est relevée ; chaque module ajoute ses cas (ours, pie, Minas Thyl) au traitement de la décision.
7. **Seaux, grille 316, herse 317, coffres** (`2c1e`, `2c4d`, `2846`, `22c1:0002`, `20b5:000e`) : mécanismes détaillés renvoyés à `objects.md`.
8. **Codes de barrage** `1414:0006` (27 codes) : hors périmètre de ce document (cases de salle) ; leur lecture a montré que les barrages des salles 105, 110 dépendent de l'état de la stèle (`2500:0650`), de la dalle (`27ed:0251`), de la herse (`29fd:01d6`), des grilles `316`/`317` (`2c1e:02de`, `2c4d:0312`) et d'un hasard (`gm_chance_one_in`) ; tableau complet à faire.
9. **Rythme réel** : durées en secondes à valider en dynamique (§ 1.1).
10. **Variantes de la dépouille** (§ 6.4) : seule la variante 2 (chaudron) a une conséquence propre ; les variantes 0 et 1 ne diffèrent que par la description (« maladroit » pour la 1).

## 13. Corrections à reporter dans les autres documents

- *(reporté)* **`engine.md` § 9.1** : `Ego` 0..8 n'est **pas** une « classe d'IA » utilisée par tous les personnages ; le répartiteur `246c:000a` ne sert que le héros (clé 1 de la table 2). Les autres personnages ont leur `Fct` (§ 2) et utilisent `Ego` comme état propre (§ 3.2). `246c:0240` est le gestionnaire de **marche/nage du héros** (`Ego 0/1`), pas une IA de PNJ.
- *(reporté)* **`engine.md` § 7.2** (codes `Err`) : le test de `179d:0004` sur « type 2 » (`Err 0x0C`) porte sur `Txt` (+0x08), pas sur `Typ` : `0x0C` = bord sans sortie d'un objet de `Txt 2`, `0x0E` = idem pour les autres objets de la salle chargée ;  ajouter `7` (atterrissage `Dep 3`), `0x10`, `0x15`, `0x16`, `0x17`, la sémantique de `0x14`/`0x15` (placement impossible) et le tableau de réaction du § 3.1 ci-dessus ; `0x0E` = disparition (« vous venez de disparaître », `G18`) — c'est bien la mort du § 6.1, sans animation.
- *(reporté)* **`engine.md` § 13** : questions 4 (IA) et 5 (`13a8:000a`, `1a50:0006`) sont résolues ici (§ 3 à § 8) ; la question « table `Err -> action` » aussi (§ 3.1).
- *(reporté)* **`engine.md` § 9.2** : « combats scénarisés dans les procédures d'objets » est exact ; ajouter le principe `ANM` + table de résolution (§ 1.3, § 6.2, § 7).
- *(reporté)* **`engine.md` § 5.5** : les effets d'entrée par salle (`147f`) relèvent des mécanismes de passage (§ 10.2) et des introductions de niveau (§ 11).
- *(reporté)* **`parser.md` § 6.7** (réactions) : la famille 9 répond « personnage disponible » (7) ; `2363:0154` fait **marcher le héros vers l'objet** (`22ef:0000`, deux essais ; mesuré sous DOSBox-X, `dosbox.md` § 4.1 : le personnage ne marche vers le héros que dans le gestionnaire propre à Prytwen, armoire de la salle 105 en sa présence, message `G119`) ; `2363:01ea` rejoue une commande en attente à l'arrivée d'un trajet (§ 4.4). Les verbes de classe 13 ont des gestionnaires précis (§ 9.4). Le verbe 39 (*chausser/porter*) sur la couronne déclenche le couronnement (§ 10.1).
- *(reporté)* **`screens.md` E13** : la mort n'est pas toujours « suppression du héros » seule : 4 variantes (§ 6) dont la **dépouille** (`Num 2`) qui garde l'inventaire ; la résurrection F4 recrée le héros sans toucher aux dépouilles. **E14** : le couronnement est déclenché par la couronne (§ 10.1), les `S70..S76` et `CM3` ne se produisent qu'avec une plage de niveaux restreinte (§ 10.2) ; le verdict affiche `S36`..`S39` (secret) ou `S51`..`S54` (couronnement) selon (secret du niveau, trésor total porté) (§ 10.3) ; les introductions `S13/S14`, `S101..S105`, `S201..S204`, `S301..S304` viennent de `21cc:008e` (événement différé 2000, 60 tics après l'entrée dans les salles 1, 101, 202, 305) (§ 11).
- *(reporté)* **`audio.md`** : sons déclenchés par les personnages : jingle `E4` (`gm_sound_play(0x0E, 'E', 4, 7, 0, 0)`) à chaque mort ; `ANI` mot 1 = classe `A` et mots 2/3 = numéros de son pour 28 animations (§ 1.3) ; `gm_sound_select_track(7)` à chaque tic des états de chute/glissade, `(0)` à l'entrée du KO.
- *(reporté)* **`formats.md` « table de 12 octets »** : le champ « procédure » est une clé de la famille 8 (`1ec8:000a`), pas un offset ; opérations et passage `compteur = 0 -> déclenchement` en § 9.2.
