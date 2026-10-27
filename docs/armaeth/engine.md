# Armaeth : moteur d'exécution (`AM1.EXE`)

Référence pour la réimplémentation TypeScript du **noyau d'exécution** d'*Armaeth* : démarrage, boucle principale, salles, objets, déplacement, contrôle par la souris, sauvegarde, hasard. Le langage de commandes, l'analyseur de phrases et les scripts `CM1..4` sont dans `parser.md`, les écrans (menus, inventaire, sauvegarde, fin) dans `screens.md` ; les formats de fichiers dans `formats.md` et `graphics.md`, le son dans `audio.md`, l'index des fonctions dans `re-index.md`. Cette étude corrige plusieurs points de ces documents (voir « Écarts avec les documents existants »).

Sources : décompilation et désassemblage Ghidra (`archives/armaeth/re/`, adresses `segment:offset` Ghidra, segment de base `1000`), recoupés par des calculs sur les fichiers de données (60 scènes, `A1FCFG.SYS`, `A1FOBJ.VGA`, messages `A1FMSG.SYS`). Aucune exécution dynamique : tout ce qui touche au rythme réel est marqué comme tel.

**Confiance** : **certain** = lu en entier dans le code (et recoupé par les données quand c'est dit) ; **probable** = rôle déduit des appelants, des constantes et des données ; **hypothèse** = lecture plausible non établie. Les globales sont données en décalage `DGROUP:xxxx` (les variables `iRam0004xxxx` du décompilat valent `DGROUP:(xxxx - 0x42d70)`).

## 1. Vue d'ensemble

Le jeu est une **aventure à pointer-cliquer** (souris + ligne de saisie de phrases), en vue de trois quarts : une scène occupe un rectangle fixe de l'écran 320 x 200 (**pas de défilement**), les personnages se déplacent dans un monde à trois coordonnées `X` (horizontale), `P` (profondeur, de 8 à 159) et `Y` (hauteur d'écran du pied). Le moteur est entièrement piloté par des **listes d'objets de 144 octets** et par des **procédures de comportement** (`Fct`) choisies par le numéro de ressource de l'objet.

Trois états globaux gouvernent tout :

| Variable | Rôle |
|---|---|
| `DGROUP:4b84` (far) | salle **chargée** (enregistrement de 42 octets) |
| `DGROUP:4b80` (far) | salle **voulue** : quand `4b80 != 4b84` la boucle recharge (changement de salle) |
| `DGROUP:4bfe` (far) | objet **héros** (nul pendant l'introduction) |

Il n'y a **ni points de vie, ni combat au tour par tour** dans le moteur : la mort, les combats contre les nains et la fin du jeu sont des **événements scriptés** dans les procédures d'objets et de salles (modules `2363`-`2f32`, non détaillés ici, voir § 9). Il existe en revanche un **score** (table de 35 entrées, maximum 725), un **poids porté** et une **horloge de jeu** qui commande la lumière.

## 2. Démarrage

`main` (`1000:0000`, certain) :

1. `gm_install_hw_error_handler` : vecteur INT 24h (erreurs critiques DOS) et chargement de `MSGHRD`.
2. `gm_load_msgint` : texte `MSGINT` (messages d'erreur, table des accents).
3. `gm_init_paths` : lit `A1FINS.SYS`, calcule les chemins ; `gm_parse_argv` : `am1 * a1f` (lecteur, préfixe de langue ; extension `.vga` ou `.ega` selon le pilote).
4. `gm_init_engine` (`1005:000a`) :
   1. zéro dans `DGROUP:0eb8` ; `gm_find_vga_driver` (`INT 16h`, `AX=1D5F`, `CX=00CB`) : le pilote résident `VGA.EXE` rend un pointeur vers son bloc de liaison ; absent = erreur fatale ;
   2. **première étape du script CM1** (`gm_cm_script_step`, un enregistrement par appel : `cnt 7`) ;
   3. copie du pointeur de table du pilote en `DGROUP:0eac` (l'octet 0 de la table doit valoir 2 = VGA, sinon fatal) ; `gm_mouse_driver_setup` ; pointeurs de palette `4b04 = DGROUP:5512`, couleurs de texte `4b08 = 5818`, `4b10 = 5819`, `4b0c = 581a` ;
   4. `gm_init_video` : BIOS `INT 10h` mode 13h, entrée `+0x46` du pilote (mode), `+0x4a` (palette, décalages 0, 0, 0), `+0x72` (couleurs de texte) ;
   5. tampon de profondeur : `0ee4 = 64000`, `0ee6 = 200`, `0ee8 = 320`, allocation de `0xFA20` octets (`0edc`), entrée `+0x4e` du pilote (le pilote rend en `0ee0` le pointeur aligné du **plan de priorité**), puis 200 lignes de 320 octets mises à 0 ;
   6. chargement des ressources fixes : `GPH` (police), `MIX` (son, initialise le pilote musical), `TMS` (index des messages), `DIC` (dictionnaire), `ANI` ; `DGROUP:4c1c` (modèle d'objet de 144 octets, utilisé par `gm_create_object`) mis à zéro ;
   7. **deuxième étape du script CM1** (`dgs 99`).
5. `srand(time())` : `time()` = date/heure DOS (`INT 21h AH=2Ah/2Ch`) ; seuls les 16 bits bas servent de graine (certain, § 11).
6. `gm_main_loop` ; au retour `gm_quit(0,0)` (mode texte 03h, arrêt du son, `exit(0)`).

Le **monde n'est pas chargé par `main`** : il l'est par les scripts. `CM1` (`cnt 7`, `dgs 99`, `dsk 7`, `lum 0`, `dgs 0`, `sys 3`) enchaîne sur `CM2` (récit d'introduction, puis `rsv` = `gm_savegame_slot` qui lit `A1FCFG.SYS`, `cle 0..3`, `sys 3`) ; la boucle principale tourne **pendant** les scripts : `DGROUP:4b34 != 0` signale qu'un script est ouvert, et `gm_cm_script_step` (`1346:0004`) exécute **un enregistrement par tic de monde**, ou **en rafale tant que `DGROUP:4b36 != 0`** (jeton `cnt`, positionné par `cnt 7` en tête de chaque script, remis à 0 à l'ouverture d'un script ; le jeton `sys n` ouvre le script suivant). Un script ouvert met `4b50 = 0` ; sa fin remet `4b50 = 7` (« le joueur a la main »). Détails des jetons : `parser.md`. Confiance : certain pour l'enchaînement (données `CM1`/`CM2`, `137b:0006`, `139a:0006`, `1346:0004`), probable pour le rôle de `sys`.

Le **seul vecteur détourné par le jeu** est INT 24h ; l'IRQ0 (INT 08h) n'est prise que par le **pilote musical embarqué** (50 Hz, `40f7:0214`, voir `audio.md`). Il n'y a pas de minuterie de jeu.

## 3. Cadence

- **Aucune minuterie logicielle** : une itération de la boucle principale = une image. L'image se termine par l'entrée `+0x3a` du pilote vidéo (`vga_wait_vsync_present`, `VGA.EXE 1000:0aa7`) qui attend le début du retour vertical (`3DAh` bit 3), recopie vers `A000` les **seuls rectangles modifiés** puis restaure les fonds des sprites dynamiques. Le mode 13h tourne à **environ 70 Hz** : la cadence des images est celle de l'écran (certain pour le mécanisme, probable pour la valeur ; un processeur lent la fait baisser). **Mesuré sous DOSBox-X (`dosbox.md` § 3) : 70,0866 Hz exactement** (mode 13h), indépendant du CPU émulé de 12 000 à 60 000 cycles. Le port joue donc une image toutes les 1000 / 70,0866 ms ; le séquenceur musical, lui, reste à 50 Hz (IRQ0) sur sa propre horloge.
- L'état du **monde** avance par **tics** plus lents que les images : `DGROUP:4b51` (octet, 6 dans `CFG`) est le délai, `4b52` le compteur. Par image : `si 4b53 != 0 : pas de tic` (pause) ; sinon `si 4b51 == 0 : tic` ; sinon `tic = (4b52 == 0)`, `4b52 -= 1` (octet), et si un tic a lieu `4b52 = 4b51`. Soit **un tic toutes les `4b51 + 1` images** (certain, `18a9:01c0..0202`). Au délai initial 6 : un tic toutes les 7 images, soit **10,01 tics/s** (99,9 ms) ; le héros avance de 2 px par tic, **20 px/s** (mesuré, `dosbox.md` § 3).
- Touches de réglage (certain, `1023:027c` + table de touches `3588:0008`) : **Alt+A** ou **Alt+-** : `4b51 += 1` (plafond 0xFA, plus lent) ; **Alt+Z** ou **Alt+=** : `4b51 -= 1` (plancher 0) ; **Alt+P** : `4b53 = 7` (pause) ; **Alt+N** : `4b53 = 0` (reprise). Chacune remet `4b52 = 0`. **Toute touche reconnue force un tic dans l'image** (voir quirks).
- Les objets d'interface (type 0, dont le curseur) sont mis à jour **à chaque image** ; les objets de la salle et du monde **à chaque tic** (§ 4).
- L'**horloge de jeu** avance d'un cran par tic de monde (hors première image d'une salle) : `4b56` compte 0..99, à 100 : `4b55` (minutes) + 1 ; à 60 : `4b55 = 0`, `4b54` (heures) + 1 ; à 24 : `4b54 = 0`. Soit **100 tics = 1 minute de jeu**. Chaque fois que le compteur des centièmes boucle et que `minutes % 10 == 0`, la palette est marquée à recalculer (§ 7.5). `CFG` démarre à 10 h 00 (`4b54 = 10`).

## 4. Boucle principale (`gm_main_loop`, `18a9:0008`)

Variables locales de la boucle (DGROUP) : `e4c` drapeau de reprise après dépassement de la pile d'annulation du pilote, `e58` « première image », `e5a` « héros absent de la salle », `e5c` « palette à appliquer après chargement », `e5e` « image précédente dans la même salle », `e60` « événement clavier », `e62` « tic », `e64` verrou et `e66` inhibition de la redessin statique.

```text
NOUVELLE_SALLE:                                     (18a9:036a)
  redessinStatique(-1)                              // e66 = 7 : inhibe
  chargerSalle(0)                                   // § 5.2 : 4b84 := 4b80, etc.
  e5c = 7 ; paletteSale = 7 (4ae6)
  pilote[+0x66]()                                   // redécoupe la zone d'annulation
  e5a = héros != null && héros.conteneur != 4b84
  si e5a && placerHérosDansSalle() == 0:            // 186d:0128
        si 4b84 == 4b80 : abort(0x101)
        goto NOUVELLE_SALLE
  pour o dans salle.listeA (+0x22, via Lis +0x80) avec o.Gst == 0:
        placer(o, mode = (o.Xyp == 2 ? 2 : 5))       // 1aba:000e, § 7.3
  réinitMouvements(e5a)                              // 1793:0006 : pour Mob==2 de la liste A
  si héros && héros.Err ∈ {0, 0x11} : héros.Err = 0x11
  redessinStatique(+1)                              // 067c : fond + objets statiques
  si e4c : goto SNAPSHOT
  e58 = 7                                            // première image

IMAGE:                                               (18a9:0100)
  pour o dans liste_INT (4c0e, via Nxt +0x84):       // type 0 : interface
        r = majObjet(o) ; si r == 0 ou si o.Nxt a changé : recommencer la liste
  si 4b32 : retour                                   // jamais écrit : toujours 0 (quirk)
  e60 = e5e ? sonderClavier() : 0                    // 1023:000c
  si 4b32 : retour
  si 4b84 != 4b80 : e5e = 0 ; goto NOUVELLE_SALLE
  e5e = 7
  // tic de monde (e62), voir § 3
  e62 = e60 ? 7 : (4b53 ? 0 : (4b51 == 0 ? 7 : compteur 4b52))
  si e62 || e58 :
        pour o dans salle.listeB (+0x26, via Lis) : majObjet(o)       // décors
  si e58 : e58 = 0  // première image : saute le reste
  sinon si e62 :
        pour o dans liste_OBJ (4c0a, via Nxt) : majObjet(o)           // tous les objets de type 2 du monde
        fileDÉvénements()                                             // 23a2:0250, § 9.3
        horloge()                                                     // § 3
  si e4c : SNAPSHOT: instantané(0x800) ; e4c = 0 ; goto NOUVELLE_SALLE
  pilote[+0x56]()                                    // nop
  si (4c18 || 4c1a || 4c16 || 4c02 != 4bfe):         // sélection / héros / interface modifiés
        si 4c12 == héros ou héros nul : désélectionner(0,0)   // 1664:0004
        redessinStatique(0) ; 4c02 = héros
  // dessin dynamique, 5 passes, voir § 6.4
  si paletteSale : niveau = calculerLumière() ; si encore sale : pilote[+0x4a](palette, niveau, niveau, niveau)
  paletteSale = 0
  pilote[+0x3a]()                                    // attente retour vertical + présentation
  si e5c : e5c = 0 ; entréeDeSalle()                 // 147f:0352 (message, son à l'entrée)
  afficherLigneDeTexte()                             // 327a:05e2
  si e62 && 4b34 && !4b42 : étapeScript()            // un enregistrement CM par tic, § 2
  goto IMAGE
```

Points précis (tous certains sauf mention) :

- `majObjet` (§ 6.2) est appelé avec le **suivant lu avant l'appel** ; si l'objet a modifié la liste (`Nxt` changé) ou renvoie 0 la boucle **recommence en tête de liste** (c'est le motif `iRam43bc2/bc4` du décompilat). Cela peut donc rejouer des objets déjà mis à jour dans le même tic (quirk).
- Le **retour 1 du pilote** (pile de rectangles pleine) fait rejouer le dessin ; le **retour 2** (zone de pixels pleine) positionne `e4c` : la boucle écrit un instantané du monde (`A1FTMP.SVG`), le relit, ce qui **agrandit de 0x800 octets** la zone d'annulation (`4b64 = taille + 0x800`, `gm_snapshot_alloc` retente jusqu'à ce que le pilote accepte) puis recharge la salle (§ 10). Retour 3 : `gm_abort(2)`.
- `redessinStatique(n)` (`18a9:067c`) : `n < 0` pose l'inhibition `e66` et sort ; `n > 0` l'enlève ; si ni verrou ni inhibition : verrou, pilote `+0x5a` (annule tous les fonds), `1652:0006` (repositionne les icônes de l'inventaire, § 8.3), **lecture ou écriture de `TMP.SCR`** (`1664:06b6` / `1664:0057`, volet d'objet sélectionné : `screens.md`), puis dessin des objets **statiques** (`Mob == 0 && Xyp != 0`), puis remise à zéro de `4c16`, `4c18`, `4c1a`.
- `4c16`, `4c18`, `4c1a` sont les drapeaux « sélection / héros / interface a changé » : posés par `1aba:000e` quand l'objet modifié est la sélection, le héros ou de type 0 (§ 7.3).
- La première image d'une salle (`e58`) saute la mise à jour des objets de type 2 et l'horloge : les objets de la salle n'avancent qu'à partir de l'image suivante.
- Après chaque `NOUVELLE_SALLE` le héros, s'il existe, a `Err = 0x11` (« sans erreur, vient d'être placé »).

## 5. Salles

### 5.1 Enregistrement de salle (42 octets, 60 dans `CFG`, table en `DGROUP:4b7c`, 4bfc éléments)

Les salles sont repérées par leur **indice** dans la table (`indice * 0x2a + 4b7c`) ou par leur identifiant (mot 0, `gm_find_scene` `1e0e:0000`). Disposition (certain pour les rôles cités, recoupé sur les 60 salles) :

| Offset | Taille | Rôle |
|---|---|---|
| +0x00 | u16 | identifiant de scène (0 = cadre d'interface, 1..22, 101..111, 201..212, 301..315) |
| +0x02 | s16 | **décalage de lumière** de la salle (0 sauf salle 7 : -32 = 0xFFE0) ; § 7.5 |
| +0x04 | u8 | **extérieur** (non nul = reçoit la lumière du jour, `0x01` partout sauf la salle 0) |
| +0x05 | u8 | classe de la musique de la salle (`0x4D` = `M` partout) |
| +0x06 | u16 | numéro de la musique (`gm_sound_play(+0x08, +0x05, +0x06)`, `1cc3:0033..0049`, `audio.md`) |
| +0x08 | u16 | identifiant de la musique |
| +0x0A | 6 x u16 | **sorties** : indice de la salle voisine par emplacement 0..5, 0 = pas de sortie |
| +0x16 | 6 x u16 | **codes de barrage** par emplacement : 0 = libre, sinon code évalué par `1414:0006` (§ 5.4) |
| +0x22 | far | tête de la liste **A** (objets de type 2 de la salle, chaînés par `Lis` +0x80) |
| +0x26 | far | tête de la liste **B** (décors, type 1) |

Les sorties sont **symétriques** (156 liaisons, 0 asymétrique : l'opposé de l'emplacement `s` est `{2,3,0,1,5,4}[s]`, table `DGROUP:4ba0`, certain par les données et `1aba:0310`). Les six octets de l'en-tête de scène `+0x24..0x29` (`perm`) donnent la correspondance **emplacement -> côté géométrique** : `4b88[i] = perm[i]` (côté de l'emplacement `i`), `4b94[perm[i]] = i`. Côtés géométriques (certain, `179d:07b8`, `179d:0863`) : **0 = fond** (P < Pmin), **1 = droite** (X > Xmax), **2 = avant** (P > Pmax), **3 = gauche** (X < Xmin), **4 = haut** (Y trop petit), **5 = bas** (Y > Ymax). Identité dans 55 scènes ; permutations dans 105 (`2 3 0 1 4 5`), 201, 306, 311, 314.

### 5.2 Chargement d'une salle (`gm_load_scene`, `1cc3:000e`, certain)

Argument `AX` : **0** = chargement complet de la salle `4b80` ; **non nul** = seulement redessiner l'image de la scène d'identifiant `AX` (jetons `lir`, `scn`, appels d'écrans ; la fonction s'arrête après le décodage des couches).

Chargement complet :

1. Pilote `+0x62` (annule les sprites), `2f9b:040f`. Musique de la salle voulue : si `+0x08` ou `+0x06` est nul ou si la piste demandée ne joue pas déjà (`300b:0102` = 0), la musique en cours est arrêtée (`gm_sound_stop(7)`) et la nouvelle sera lancée en fin de chargement ; sinon elle continue.
2. `4b84 := 4b80`. `gm_destroy_scene_objects` détruit tous les décors (type 1, liste `4c06`). Pour l'ancienne et la nouvelle salle : `1833:01fc` (charge ou libère la ressource sprite de chaque objet), et pour l'**ancienne** salle `gm_reset_object_motion` (annule les trajets). `1cc3:0852` libère les tampons de la scène précédente, `1664:08e1` réinitialise le volet `TMP.SCR`.
3. Ouverture du fichier de scènes (`A1F` + centaine + lettre `'A' + (id % 100) / 5` + `.vga`), table de 5 entrées de 10 octets, lecture de l'en-tête de 0x30 octets (`graphics.md`) :
   - fenêtre de l'image : pilote `+0x1e = x`, `+0x20 = y` (décalage ajouté aux sprites des listes de scène), `+0x1a = largeur`, `+0x1c = hauteur` ; contrôles `x + largeur <= 320`, `y + hauteur <= 200` ;
   - **limites de déplacement** : `4ac8 = X min`, `4aca = X max`, `4ace = Y min`, `4ad0 = Y max`, `4ad4 = P min`, `4ad6 = P max` (mots +0x12..+0x1C de l'en-tête ; exemples : `0, 319, 0, 179, 8, 159`) ; les constantes `4acc = 319`, `4ad2 = 199`, `4ad8 = 255` (initialisées dans l'image) sont les étendues maximales hors salle et pour le tirage au hasard ;
   - permutation des côtés (`4b88`, `4b94`), nombre de plans `4ae0` (1..3, `4ac6 = 3` est le maximum) ;
   - **grille de marche** : les `ng` enregistrements de 16 octets (§ 7.1) remplissent les tableaux `DGROUP:0ef8` (type) et `DGROUP:22e8` (intervalle de hauteur), 81 x 21 cases par plan ;
   - `nz` enregistrements de 16 octets, copiés tels quels en `4ada` (compte `4ade`) : **zones** pour les objets de déplacement de classe 2 ou 4 (§ 7.2) ;
   - 40 mots en `DGROUP:4bac` : 20 paires (min, max) de X par rangée de profondeur (§ 7.4) ;
   - couches d'image : couche A (type 2 en pratique, le décor) vers l'écran, couche B (type 0, la **carte de profondeur**) vers le plan de priorité `0ee0` (`graphics.md`) ;
   - enregistrements de **10 octets** (compte `4b18`, tableau `4b14`) : points sensibles `{id de message u16, x0, x1, y0, y1}` en coordonnées relatives à la fenêtre de la scène ; les quatre mots valent `0xFFFF` pour les messages d'ambiance sans rectangle (428 rectangles sur 601 enregistrements) ; testés par `1564:0004` (§ 8.2, **probable** : le déclenchement passe par `1e58:000a`) ;
   - enregistrements de **20 octets** : un **décor** (type 1) par enregistrement (§ 5.3).
4. Si une musique est prévue et ne jouait pas déjà : `gm_sound_play(…, boucle = 7)`. Puis `147f:000a` (§ 5.5).

### 5.3 Décors de la scène (20 octets par objet de type 1)

Chaque enregistrement crée un objet par `gm_create_object` (conteneur = la salle, `Cod = 1` implicite) puis lui donne (certain, `1cc3:0745..07f5`) :

| Octets | Champ de l'objet |
|---|---|
| 0..1 | `Num` (id de ressource `DEC`) |
| 2..3 | non utilisés par le chargeur (égaux à l'id de salle ou de ressource dans les exemples ; hypothèse) |
| 4 | `Gst` |
| 5 | `Mob` |
| 6 | `Dep` |
| 7 | `Txt` |
| 8 | `Ego` |
| 9 | `Fig` (indice d'animation) |
| 10 | `Lum` (signé) |
| 11 | `Hor` (0 est remplacé par 1 : regarde à droite) |
| 12..13, 14..15, 16..17 | `X`, `Y`, `P` |
| 18 | `N` (plan) |
| 19 | `Sol` |

Puis `Xyp = 2`, une première `animStep(o, 7)`, `Rep = 1`, `Ind = rand() % Tot + 1` (**phase d'animation aléatoire**), une seconde `animStep(o, 0)`. Les décors ne sont **pas sauvegardés** : ils sont recréés à chaque chargement de salle.

### 5.4 Sorties et changement de salle

Quand un objet mobile touche le bord de la zone de déplacement (`179d`, § 7.2) le code d'erreur écrit dans `Err` (+0x3E) vaut `0x0B` (sortie existante), `0x0F` (barrage), `0x0C` (objet de **`Txt` 2** — champ +0x08, et non `Typ` — au bord d'une salle sans sortie : traité par le héros comme erreur fatale « personnage non localisable », message `E11` ; tout autre objet de la salle chargée reçoit `0x0E` = disparition, § 9.1 ; voir `movement.md` § 2.8) ; `Inf` (+0x3F) reçoit l'**emplacement** de sortie. Traitement (certain) :

1. La procédure d'objet (`246c:0240` pour `Ego` 0/1) appelle `186d:000c(o)` pour `Err = 0x0B`. Elle calcule la salle voisine `dest = conteneur.sorties[Inf]` ; si l'emplacement a un barrage (`+0x16`) et que `1414:0006(o)` répond « bloqué », `Err = 0x0F`.
2. **Héros** : `4b80 := dest`, `Err = 0x12`, `Ser += 10000` (marque de transit), retour 1. La boucle principale constate `4b84 != 4b80` et recharge (§ 4). Au rechargement, `186d:0128` recalcule `dest = ancienneSalle.sorties[Inf]`, remet `Ser %= 10000`, puis `19dc:0000(dest, héros)` déplace le héros dans la nouvelle salle ; en cas d'échec `4b80 := ancienne salle` (`Err = 0x12`) et la boucle recharge l'ancienne salle.
3. **Autre objet** : `19dc:0000(dest, o)` le déplace directement (listes chaînées mises à jour par `1a7b:0118`), même sans chargement de salle ; les objets en route vers une salle qui n'est pas chargée restent simulés (`Xyp = 1`).
4. **Placement d'arrivée** (`1aba:0310`, certain) : `d = o.Inf`, `opp = {2,3,0,1,5,4}[d]`. Si `perm[opp] != opp` l'objet est recentré (`X = 4acc/2 = 159`, `P = 4ad8/2 = 127`). Vitesses : `opp = 0 -> Prf = +1`, `1 -> Hor = -1`, `2 -> Prf = -1`, `3 -> Hor = +1` (l'objet **continue dans le sens où il est sorti**). Puis `placer(o, 10)` (`Sol = 0`). Si le placement réussit et que l'objet n'est ni le héros ni `Ctl != 0`, une **cible d'errance** est tirée à 12..24 pixels devant lui (10..20 sur Y pour les côtés 4 et 5) par `2151:0006` et un trajet est calculé.

Les **codes de barrage** (`+0x16..`) prennent les valeurs 1..6, 101..105, 201..209, 301..305 (27 salles en ont) ; `1414:0006` en fait une condition sur l'objet (`Num`, `Ego`, état d'autres objets…) : seuls quelques cas sont lus ici (le sens général « qui a le droit de passer » est confirmé). **Table complète des codes : `movement.md` § 5** ; le résultat de `1414:0006` est **7 = bloqué**, 0 = libre, et les codes 8 et 105 sont libres. C'est une liste de conditions à porter au cas par cas (§ 13).

### 5.5 Entrée dans une salle (`147f:000a` puis `147f:0352` à la première image)

`147f:000a` (fin de `gm_load_scene`) est un `switch` sur l'**identifiant de la salle** : il ajuste `4ae0` (nombre de plans actifs, niveau initial 3 ; **certain**, code porté et testé) : salle 5 (0x05) : stèle `Num 16` à `Ego 4` -> 2, sinon 3 ; salle 108 (0x6C) : dalle `Num 104` à `Ego 3` -> 2, sinon 3 ; salle 202 (0xCA) : 2 avant le chapitre 3 (`4b4e / 100`), sinon 3 ; salle 205 (0xCD) : sous-niveau >= 3 -> 1 ; salle 212 : `Fig` de `Num 215` : 2 si 0, sinon 1 ; salle 312 : `Num 318` : 2 si `Ego 0`, sinon 1 ; pour la salle 0x65 l'indicateur « extérieur » (`+0x04`), le décalage de lumière (`+0x02`, 0 ou -32) et marque la palette à recalculer, attribue des points d'entrée (`2255:00e8`, salles 0xD0 et 0x139), endort jusqu'à deux soldats `Ego 0` de la salle de garde (salle 0x131, `chance_one_in(2)` par place : `characters.md` § 7.3 ; `game/room-entry.ts`). `147f:0352` (après le premier affichage, `e5c`) est un `switch` sur l'identifiant de la salle chargée : introductions de niveau (salles 1, 101, 202, 305 : `21cc:000e`), **salle 110 (0x6E)** : musique `M108` / `M109` selon la place du héros et de Prytwen par rapport à la grille 103 (`147f:03a6..04e5`, `characters.md` § 11), **salle 304 (0x130)** : événement d'asphyxie du héros et torches allumées de ses poches éteintes avec `G373` (`147f:0470..04e5`). Le port les porte (`engine/room.ts` `onFirstDisplay` pour les introductions, `game/room-entry.ts` `onEnterScene` pour les deux autres, appelés par `ArmaethEngine.enterScene`). Ce sont des **cas particuliers de scénario** (certain, relus dans le désassemblage) ; ils ne font pas partie du noyau. Les effets d'entrée par salle de `147f` relèvent des mécanismes de passage (stèle, dalle, herse : `characters.md` § 10.2) et des introductions de niveau (`21cc:008e`, événement différé 2000 : `characters.md` § 11).

## 6. Objets

### 6.1 Enregistrement de 144 octets (0x90)

Disposition **établie par la fenêtre de débogage `gm_dump_object`** (`1265:0008`, ordre des arguments de `sprintf`), recoupée par l'usage. Elle **remplace** la table approximative de `re-index.md` (plusieurs offsets y sont décalés : `Hor`/`Ver`/`Prf` sont en +0x60/+0x61/+0x62, `Xyp` en +0x52, `Cod` en +0x5B).

| Offset | Nom | Taille | Rôle (confiance) |
|---|---|---|---|
| +0x00 | `Num` | u16 | identifiant de ressource sprite et de `DEF` ; **clé des tables de comportement** (certain) |
| +0x02 | `Ser` | u16 | numéro de série unique (`++4b4a` à la création ; 0 pour les décors) ; `+10000` pendant un transit de salle (certain) |
| +0x04 | `Typ` | u8 | 0 = `INT` (interface), 1 = `DEC` (décor), 2 = `OBJ` (personnage, objet) ; choisit le fichier sprite (indices 8, 4, 3) et la liste globale (certain) |
| +0x05 | `Gst` | u8 | 7 = l'objet possède une **procédure `Fct`** appelée à chaque mise à jour ; 0 = aucune (certain) |
| +0x06 | `Mob` | u8 | 0 = **statique** (dessiné dans le fond), 1 = **animé sur place**, 2 = **mobile** (déplacement `179d`) (certain) |
| +0x07 | `Dep` | u8 | classe de déplacement : 0 = marche sur le sol, 1 = libre / chute sur Y, 2 et 4 = lié aux zones, 3 = chute à cases (probable, § 7.2) |
| +0x08 | `Txt` | u8 | classe de description (0, 1, 2) ; à 0 l'objet est soumis au test de collision avec le plan de profondeur (§ 7.4) (probable) |
| +0x0A | `Lum` | s16 | **lumière émise** (16 ou 32 pour les torches) ; somme sur les listes de la salle (certain, § 7.5) |
| +0x0C | `Ftn` | u16 | 0 partout dans `CFG` ; réutilisé par le curseur : **`Num` de l'outil actif** (1 = défaut, 101 à 113, 198), clé de la table `DGROUP:0bc2` (`interface.md` § 1 et § 3.1) (certain) |
| +0x0E | — | u8 | du curseur : **variante** de l'outil actif (0 = bouton gauche, 1 = bouton droit) (certain, `interface.md` § 3.1) |
| +0x18 | `Val` | s16 | valeur : `< 10` petites valeurs, `>= 10` trésors, sommés par `14ee:0006` pour l'écran de fin (certain) |
| +0x1A | `Pds` | s16 | **poids** ; somme récursive du contenu par `20ac:0008` (le contenu d'un objet de `Num` 9 n'est pas compté) (certain) |
| +0x1C | `Chg` | s16 | **capacité** (charge maximale du contenu) (probable) |
| +0x1E | `Ram` | u8 | 7 = ramassable (38 objets de `CFG`) (probable) |
| +0x1F | `Ctn` | u8 | 7 = peut contenir d'autres objets (29 objets) (probable) |
| +0x20 | `Mc1` | u8 | du **curseur** : état du bouton gauche (certain pour le curseur) |
| +0x21 | `Mc2` | u8 | du curseur : bouton droit (certain pour le curseur) |
| +0x22, +0x23 | `Mc3`, `Mc4` | u8 | non lus ici |
| +0x2C | `Set` | u8 | « déjà initialisé » du fond rebondissant `1611:000c` ; 0 sinon (hypothèse) |
| +0x2D | `Ego` | u8 | **état de l'objet** (valeur propre à chaque `Num`) et **indice de sa description** (messages de classe `30 + Ego`, numéro `Num`, `parser.md` § 8.2) : portes, coffres, grilles, herses, torche, feu, nains, Prytwen, fioles… sont des automates à `Ego` + `Fig` (`objects.md` § 0 point 5, `characters.md` § 3.2). Pour le **héros seul** (`Num 1`), `246c:000a` aiguille en plus sur `Ego` 0..8 (§ 9.1) ; les autres personnages ont leur propre `Fct` qui lit `Ego` à sa façon. Du curseur : non nul pendant le refus animé. `jeton ego` l'écrit (certain) |
| +0x2E | `Fig` | u8 | **indice d'animation** dans la ressource sprite (enregistrement de 12 octets) (certain) |
| +0x2F | `Inv` | u8 | **caché / invisible** : non nul = l'objet n'est ni ciblable par un clic ni perçu par les PNJ (`219b:0000`) ; le héros invisible après l'élixir de la fiole `304` a `Inv = 7` (`219b:006c(héros, 7)`, fin par l'événement différé 1002, messages `V363`/`V364`) (certain : `objects.md` § 4.21, `characters.md` § 1.5 et § 9.1). Le pilote en fait en plus un décalage de couleur au blit (nommé `hidden` dans le code, option de composition `ghost`) : voir la réconciliation au § 6.4 (probable). Le miroir est bien +0x44 |
| +0x30 | `Anm` | u16 | non nul : la ressource sprite est la ressource `ANM` de cet identifiant (au lieu de la famille de `Typ`) (certain, `1735:000e`) |
| +0x32 | `Tim` | u16 | compteur général (animations ; du curseur : compteur d'images du refus animé, 21 images) (probable) |
| +0x34, +0x36, +0x38, +0x3A | `Rep`, `Nbr`, `Sys`, `Bag` | u16 | `Nbr` (+0x36) : nombre de pas restants d'une animation `ANM`, `Bag` (+0x3A) : `Ser` du partenaire d'animation (`characters.md` § 1.3) ; `Rep` (+0x34), `Sys` non lus ici. Le **curseur** range en +0x36 la `Ser` de l'**objet tenu** (0 = aucun) et en +0x38 la `Ser` de l'**icône** dont il copie l'image (certain, `interface.md` § 3.1) |
| +0x3C | `Col` | u16 | `Ser` de l'objet contre lequel on a buté (certain, `1a50:0006`) |
| +0x3E | `Err` | u8 | **résultat du dernier déplacement** (§ 7.2, § 9.1) (certain) |
| +0x3F | `Inf` | u8 | emplacement de sortie franchi (0..5, 6 = aléatoire) ou valeur de case (certain) |
| +0x40 | `Ctl` | u8 | non nul : pas de cible d'errance à l'arrivée (probable) |
| +0x41, +0x42 | `lb0`, `lb1` | u8 | `lb0` sauvegarde l'ancien `Fig` (`15f8:000e`) (probable) |
| +0x43 | — | u8 | non nul : ressource sprite déchargée (icône désactivée) (probable) |
| +0x44 | `Inv` (2e) | u8 | **miroir horizontal** du dessin (certain) |
| +0x45, +0x46, +0x47 | `dpX`, `dpY`, `dpP` | u8 | pas de déplacement par tic en X, Y, P ; recopiés depuis l'enregistrement d'animation (octets 2, 3 ; `dpP = 1`) (certain, `1833:01fc`) |
| +0x48 | `Dir` | u8 | direction d'animation courante (0 droite, 1 gauche, 2 vers l'avant/P+, 3 vers le fond/P-) (certain) |
| +0x49 | `Tot` | u8 | nombre de pas de la séquence courante (certain) |
| +0x4A | `Ind` | u8 | indice du pas courant (1..Tot) (certain) |
| +0x4B | `Rep` | u8 | durée restante du pas (en tics) (certain) |
| +0x4C, +0x4D | `Hau`, `Lar` | u8 | hauteur et largeur de l'image courante (certain) |
| +0x4E | `Des` | far | pointeur vers l'image courante (en-tête `[H][L]` puis colonnes) (certain) |
| +0x52 | `Xyp` | u8 | **état de présence** : 0 absent, 1 posé mais salle non chargée, 2 posé dans la salle chargée, 8 / 0x0B icône d'inventaire, 6 icône d'interface ; le dessin exige `Xyp != 0` (certain) |
| +0x53 | `N` | u8 | **plan** de marche (0..2) (certain) |
| +0x54, +0x56, +0x58 | `X`, `Y`, `P` | s16 | position : **X centre**, **Y pied** (bas du sprite), **P** priorité / profondeur (certain) |
| +0x5A | `Sol` | u8 | **type de case** sous les pieds (valeur de la grille) (certain) |
| +0x5B | `Cod` | u8 | nature du conteneur : 1 = dans une salle, 2 = dans un objet, 3 = objet d'interface (type 0) rattaché à la salle d'indice 0, 4 = valeur transitoire de création ; 0 = non rangé (certain) |
| +0x5C | `Num`(c) | far | **conteneur** : pointeur vers la salle ou l'objet (dans les fichiers : id de salle ou `Ser`) (certain) |
| +0x60, +0x61, +0x62 | `Hor`, `Ver`, `Prf` | s8 | **vitesse** (-1, 0, +1) selon X, Y, P (certain) |
| +0x63 | `Mod` | u8 | sous-état du suivi de trajet 0/1/2 (certain, `30d9:0184`) |
| +0x64, +0x65 | `Inv`, `Dir` | s8 | mémoire de direction du suivi de trajet (probable) ; à ne pas confondre avec `Inv` +0x2F (caché) |
| +0x66 | `Sal` | u16 | non lu ici |
| +0x68 | `Chm` | far | tableau du **trajet** (enregistrements de 4 octets `{rangée, plan, colonne min, colonne max}`) (certain) |
| +0x6C | `Nbc` | s16 | nombre de nœuds restants, -1 = pas de trajet (certain) |
| +0x6E | `Def` | s8 | trajet valide (certain) |
| +0x6F | `Nc` | u8 | **plan de la cible** (certain) |
| +0x70, +0x72, +0x74 | `Xc`, `Yc`, `Pc` | s16 | **cible** (certain) ; pour le curseur, +0x70/+0x72 : position brute de la souris à l'image précédente (`interface.md` § 3.1) |
| +0x76, +0x77 | `X1`, `X2` | u8 | colonnes min et max du nœud cible (certain) |
| +0x78, +0x7A | `Cib`, `Ser` | u16 | cible mobile : drapeau et `Ser` de l'objet suivi (certain) |
| +0x7C | `Pos` | far | tête de la liste du **contenu** (inventaire du héros, objets d'un coffre) (certain) |
| +0x80 | `Lis` | far | chaînage dans la liste de la salle ou du conteneur (certain) |
| +0x84 | `Nxt` | far | chaînage dans la liste globale de son type (certain) |
| +0x88 | `Anm` | far | ressource sprite chargée (certain) |
| +0x8C | `Fct` | far | procédure de comportement, résolue paresseusement par `1ec8:000a` (certain) |

Les octets +0x24..+0x2B ne sont ni affichés par le dump ni lus par le cœur. Sur disque les octets 0x00-0x7B sont copiés tels quels, les pointeurs lointains (+0x5C, +0x7C et suivants) étant remplacés : `gm_save_object` écrit en +0x5C `0` (type 0), l'id de salle (`Cod = 1`) ou la `Ser` du conteneur ; au chargement `Cod 1` retrouve la salle par id, `Cod 2` l'objet par `Ser`, `Cod 3`/`4` rangent l'objet dans la salle d'indice 0 (certain, `192e:0008`).

### 6.2 Listes et mise à jour

Trois **listes globales** (chaînées par `Nxt` +0x84, insertion **en tête** : l'ordre de parcours est l'inverse de l'ordre de création) : `4c0e` types 0, `4c06` types 1, `4c0a` types 2. En plus, chaque salle chaîne ses objets de type 2 (liste A, +0x22) et ses décors (liste B, +0x26), et chaque objet chaîne son contenu (`Pos` +0x7C) ; ces listes utilisent `Lis` +0x80, insertion en tête (`1a7b:0118`). Les objets de **type 0** (29 dans `CFG`, `Cod 1` et référence 0 sur disque, `Cod 3` et conteneur = salle d'indice 0 en mémoire) ne sont dans aucune liste de salle.

`majObjet(o)` (`1890:0006`, certain) :

```text
si o.Err == 0x12 :                       // en transit
     si o est le héros : retour 7
     resetMouvement(o) ; o.Err = 0
dansSalle = (o.conteneur == 4b84)
spécial = (o.Xyp == 8 || o.Xyp == 0x0B)
selon o.Typ :
   0 : animer = bouger = 7 ; idx = 7 ; code = 0x7a
   1 : animer = bouger = dansSalle ; idx = 3 ; code = 0x28
   2,3 : animer = dansSalle || spécial ; bouger = (o.Cod == 1) ; idx = 2 ; code = 0x27
si o.Mob == 1 : si animer : animStep(o, 0)
sinon si o.Mob == 2 : si bouger : déplacer(o)          // 179d:0004
si o.Gst == 7 :
     si o.Fct == null : o.Fct = chercherFct(o.Num, idx) ; si null : abort(code)
     retour o.Fct(o)                    // appel far, argument = o
sinon : retour 7
```

Remarque : les objets de **type 2 ne bougent que si `Cod == 1`** (dans une salle) ; ceux qui sont dans un conteneur ne font qu'animer. Seul `Mob == 2` déclenche `déplacer` ; `Mob == 1` fait seulement avancer l'animation (une fois par mise à jour).

### 6.3 Ressources sprite et animation

- `gm_load_sprite_resource` (`1735:000e`) : clé de cache `famille * 1000 + id` avec famille 0 `INT`, 1 `DEC`, 2 `OBJ` (ou 3 `ANM` si `Anm +0x30 != 0`) ; liste chaînée `43bb8` ; une ressource n'est libérée que quand plus aucun objet ne l'utilise (`1735:037a`). `1833:01fc` ne garde chargées que les ressources des objets de la **salle courante**, du héros et du **conteneur sélectionné** (et celles du type 0 hors `Cod 4`) ; sinon image fictive de 10 x 10.
- **Pas d'animation** (`animStep` = `1833:0006`, certain) : l'enregistrement de 12 octets numéro `Fig` donne `rec[1]` (non nul : l'image est **miroir en regardant à gauche**), `rec[2]` -> `dpX`, `rec[3]` -> `dpY`, `rec[4+2d]` : indice, dans le tableau de mots, de l'en-tête de la séquence de la direction `d` ; l'en-tête a le nombre de pas dans son octet bas ; chaque pas est un mot : **octet bas = numéro d'image**, **octet haut = bit 7 miroir (XOR avec le miroir de direction) + 7 bits de durée en tics**.

```text
animStep(o, force) :
   d = o.Hor != 0 ? (o.Hor < 0 ? 1 : 0)
     : o.Prf != 0 ? (o.Prf < 0 ? 3 : 2)
     : /* immobile */ si o.Ver == 0 : { si force == 0 retour ; d = o.Dir < 4 ? o.Dir : 2 ; force = 7 }
                      sinon          : { d = o.Dir ; si o.Dep == 4 && d != 3 : d = 3, force = 7 }
   miroirDir = (d == 1 && rec[1] != 0)
   si o.Dir == d && force == 0 :
        o.Rep -= 1 ; si o.Rep != 0 retour
        o.Ind += 1 ; si o.Ind > o.Tot : o.Ind = 1
   sinon : o.Dir = d ; o.Tot = octetBas(mots[début]) ; o.Ind = 1
   pas = mots[début + o.Ind]
   o.Mir = (pas.bit7) XOR miroirDir ; o.Rep = pas & 0x7F00 >> 8 ; image = pas & 0xFF
   o.Des = base + décalages[image] ; o.Hau = octet0 ; o.Lar = octet1
```

Exemple vérifié : le héros (`OBJ` 1, 12 animations) marche à 2 px/tic avec 8 images de 1 tic dans les directions 0/1 (une seule séquence, le miroir sert la gauche) et 6 images en profondeur (3 images puis les mêmes en miroir).

### 6.4 Dessin, priorité, miroir

Le dessin n'est pas dans `AM1.EXE` : il passe par l'entrée `+0x36` du pilote (`VGA.EXE 1000:0722`, lu en entier dans `re-index.md`). Rappel de ce qui compte pour le port :

- le sprite est dessiné avec **X au centre** (`x - Lar/2`) et **Y au bas** (haut = `Y - Hau + 1`) ; images rangées en **colonnes**, `0xFF` = transparent ; recadré à 320 x 200 ; **miroir horizontal seulement** (`Mir` > 0) ; si `flags & 7 != 0` le décalage de fenêtre `(x0, y0)` de la scène est ajouté ;
- test de **priorité** pixel à pixel : un pixel opaque n'est écrit que si la valeur du plan de priorité à cet endroit est **inférieure ou égale** à `P` de l'objet ; l'écriture met alors le plan à `P`. Le plan de priorité est initialisé par la **couche B** de la scène (multiples de 8 de 0 à 160 : un élément d'avant-plan de profondeur 120 masque un personnage de `P < 120`). Les icônes d'interface ont `P = 0xD0 = 208` et le curseur `P = 0xFA = 250`, donc au-dessus de tout ;
- `Inv` (+0x2F) non nul (= objet **caché / invisible**, § 6.1) : le pilote n'écrit pas le pixel du sprite mais `couleur du fond + Inv` (décalage d'index de palette, `re-index.md`, « Blit de sprite »). **Réconciliation** (probable) : l'octet est à la fois un masque logique (pas de clic, pas de perception par les PNJ) et, côté pilote, un effet de **transparence / miroitement** — un objet invisible, comme le héros après l'élixir (`Inv = 7`), reste dessiné sous la forme d'une silhouette qui teinte le décor au lieu d'être supprimé. Le rendu exact dépend de la rampe de palette autour de la couleur de fond et n'a pas été vu à l'écran (à vérifier en DOSBox) ;
- les objets **`Mob == 0`** sont dessinés dans le fond (page d'arrière-plan) par `redessinStatique` ; ceux **`Mob != 0`** sont redessinés à chaque image puis annulés par le pilote à la présentation suivante. Aucune bascule de page matérielle.

Ordre des passes (certain, `18a9:0100`..`0567` et `067c`), listes parcourues avec `Lis` sauf type 0 (`Nxt`) ; `flags = 7` pour les listes de salle, `0` pour les autres :

| Passe | Dynamique (chaque image) | Statique (`redessinStatique`) |
|---|---|---|
| 1re | contenu de l'objet sélectionné (`4c12 +0x7c`) | contenu de l'objet sélectionné |
| 2e | liste globale de type 0 | décors de la salle (liste B) |
| 3e | contenu du héros (inventaire) | objets de la salle (liste A) |
| 4e | décors de la salle (liste B) | contenu du héros |
| 5e | objets de la salle (liste A) | liste globale de type 0 |

Un objet n'est dessiné que si `Xyp != 0` (et `Mob != 0` pour le dynamique, `Mob == 0` pour le statique). À égalité de priorité le dernier dessiné gagne (le test est `<=`).

## 7. Mouvement, collisions, trajets

### 7.1 La grille de marche

Les `ng` enregistrements de 16 octets de la scène (mots) sont `{w0 = type | plan << 8, w1 = rangée, w2 = colonne début, w3 = hi début, w4 = lo début, w5 = colonne fin, w6 = hi fin, w7 = lo fin}`. Le chargeur (`1cc3:02b0..0440`, certain) remplit pour chaque case de la plage `[colonne début, colonne fin]` de la rangée :

- `type[plan][rangée][colonne]` = `w0 & 0xFF` ;
- `intervalle[plan][rangée][colonne]` = mot `(hi << 8) | lo` avec `hi` et `lo` **interpolés linéairement** le long de la plage (`hi = w3 + (w6 - w3) * i / n`, `lo = w4 + (w7 - w4) * i / n`, `n = w5 - w2 + 1` ; plage d'une case : moyenne `(w3 + w6) / 2`) ;
- cases non couvertes : type 0, intervalle `0xFFFF` ; chaque plan vaut 81 x 21 cases, `indice = (plan * 21 + rangée) * 81 + colonne`.

**Validation sur les données** : pour les 60 objets de `CFG` qui sont de type 2, dans une salle, de `Dep 0` et sur une case praticable, la fonction de hauteur ci-dessous retrouve exactement leur `Y` (**59 sur 60**, la dernière à un pixel près) et `Sol` est égal au type de la case (34 objets au type 2, les autres sur les types 35, 54..57, 60, 64, 68, 69, 83, 92, 110..114 ; ceux qui ont `Sol = 0` sont des objets jamais déplacés). Exemple : le héros de `CFG` en `X = 219`, `P = 113` (colonne 54, rangée 14) a `Y = 146`.

Conversion de coordonnées (certain) : **`colonne = X >> 2`, `rangée = P >> 3`** (cases de 4 x 8 pixels ; X jusqu'à 320 -> 81 colonnes, P jusqu'à 160 -> 21 rangées, les 21 niveaux de la carte de profondeur). Le **type** est la nature du terrain, repris dans `Sol` (+0x5A) de l'objet (valeurs 1, 2, 35, 52, 54..57, 64, 68, 69, 83, 92, 110..114 dans les données) : 0 = rien, **1 = obstacle plein**, `>= 2` = sol praticable (chaque valeur a un effet particulier dans `246c:0240`, par exemple l'eau, le feu, le vide). L'intervalle `[lo, hi]` est en coordonnées **Y** : pour un sol, `lo` est la **hauteur Y où se posent les pieds** et `hi` vaut 179 ; pour un obstacle plein, c'est l'étendue verticale du mur. Les **plans** (1 à 3 dans les 60 scènes) sont des étages superposés (ponts, escaliers) ; l'objet est sur le plan `N`.

**Hauteur du sol en un point** (`1c96:0000`, certain) : `h0 = lo(case)` ; si `X & 3 != 0`, on ajoute `((X & 3) * (lo(case suivante en X) - h0)) >> 2` en prenant la case voisine `+1` si elle est praticable (type >= 2), sinon `h0 - lo(case -1)` si celle-ci l'est, sinon 0 ; de même sur P avec les cases `+81` (rangée suivante) et `((P & 7) * delta) >> 3`. C'est l'interpolation bilinéaire qui donne la pente du terrain.

### 7.2 Déplacement d'un objet mobile (`179d:0004`, certain pour la structure, probable pour les détails de `Dep`)

Appelé à chaque mise à jour des objets `Mob == 2` dont `Cod == 1`. Résultat dans `Err` (+0x3E). **Version détaillée et corrigée : `movement.md` § 2** ; le pseudo-code ci-dessous en est la vue d'ensemble, avec les corrections signalées en ligne. Limites : si l'objet est dans la salle chargée, `[4ac8..4aca] x [4ace..4ad0] x [4ad4..4ad6]` ; sinon (ou type 0 en vol) la boîte maximale `[0..319] x [0..199] x [0..255]`.

```text
déplacer(o) :
   si o.Err != 0 : retour                       // un résultat non traité bloque le mouvement
   si o.Xyp == 1 && dansSalle : r = placer(o, ?) ; si r ∉ {0, 0x11} : retour
   sinon si o.Xyp == 2 && !dansSalle : o.Xyp = 1
   sauvegarde = copie(o) ; si dansSalle : animStep(o, ?)
   X' = X + Hor*dpX ; P' = P + (Prf != 0 ? Prf*1 : 0) ; Y' = Y + (Ver != 0 && Dep != 0 ? Ver*dpY : 0)
   selon Dep :
     2 ou 4 : hors salle : Err = 0x15 ; sinon zone de 16 octets {rangée = P'>>3, colonne ∈ [c0, c1], Y' ∈ [lo, hi]} -> o.Sol = zone.type, N' = 0 ; sinon Err = 5   // movement.md § 2.5
     1 : vol libre, X', P', Y' appliqués directement                                // movement.md § 2.4
     3 : chute à cases : X' et P' ignorés ; atterri (case praticable entre Y' - Hau et Y') : Err = 7 ; sinon placer(o, 6)   // movement.md § 2.6
     0      : si hors des limites de la salle : Y' = Y, mouvement appliqué tel quel (la sortie est jugée plus bas) ; la boîte maximale n'intervient que pour le test de sortie
            sinon si la case (X'>>2, P'>>3) change : pour chaque plan, du dernier au premier :
                 type = 0 : ignoré ; d = lo(case) - Y ;
                 d > 0 (sol en dessous) : retenir le plus petit d (candidat « en dessous ») ;
                 d <= 0 et type >= 2 : retenir le plus petit -d (candidat « au niveau / au dessus ») ;
                 hi(case) < Y : ignoré ; type 1 (obstacle) couvrant Y : Err = 1 sauf si Txt == 2 (continue) ;
               choix : « au niveau » s'il existe et que son écart <= dpY (ou qu'il n'y a pas de candidat en dessous),
               sinon « en dessous » ; aucun des deux : Err = 5
               Y' = hauteurSol(plan choisi, X', P') ; |Y' - Y| <= dpY sinon Err = 6 (sol trop haut) ou 5 (trop bas)
            sinon (même case) : Y' = hauteurSol(N, X', P') avec le même contrôle de marche
   appliquer (X', Y', P', N)
   Err = collisionObjets(o)                      // 1a50:0006
   si dansSalle : Err = collisionTerrain(o)      // 1c96:0102, § 7.4 ; si le type de case change : 13a8:000a(o) doit accepter
   si Err ∉ {0, 9, 0x11} : restaurer(sauvegarde) // le mouvement est annulé
   sinon bords (jugés sur la **nouvelle** position, movement.md § 2.8) : P' < Pmin -> côté 0 ; P' > Pmax -> 2 ; X' < Xmin -> 3 ; X' > Xmax -> 1 ; Y haut -> 4 ; Y bas -> 5
        un sprite qui ne fait que toucher le bord (centre encore dans la boîte) : Err = 0x0A, Inf = côté, le pas est fait
        côté atteint : emplacement = inv4b94[côté] ; Inf = emplacement
        si barrage(emplacement) et 1414(o) : Err = 0x0F
        sinon si sorties[emplacement] != 0 : Err = 0x0B
        sinon si o.Txt == 2 : Err = 0x0C   // Txt (+0x08), pas Typ
        sinon : Err = 0x0E (dansSalle) ou 1
```

Codes de `Err` rencontrés (certain sauf mention) : `0` ok, `0x11` ok « vient d'être placé », `1` obstacle plein (case de type 1) sur le trajet, `2` type de case refusé par `13a8:000a`, `5` aucune case praticable ou sol plus bas que `dpY`, `6` sol plus haut que `dpY` (marche trop haute), `8`/`9` contact avec un autre objet (9 si l'un des deux a `Txt != 0`), `0x0A` bord atteint pendant un déplacement (`Inf` = côté), `0x0B` sortie, `0x0C` bord sans sortie pour un objet de `Txt 2`, `0x0E` bord sans sortie pour tout autre objet de la salle chargée (disparition : le héros reçoit « vous venez de disparaître » puis est détruit par `246c:000a`, sans animation ; c'est bien la mort de `characters.md` § 6.1), `0x0F` barrage, `0x12` en transit, `0x13` arrivée, `0x14` placement impossible et `0x15` position hors limites / opération impossible hors salle (`Dep 2/4`) : erreur fatale `E11` pour le héros, `0x16` conflit de position (`Dep 3`), `0x17` échec de recherche de position (`1b11:000c`) ; `7` atterrissage d'un objet de `Dep 3` (`Inf` = type de case), `0x10` et `0x0D` ne sont jamais produits. Réaction de chaque personnage à chaque code : tableau de `characters.md` § 3.1 ; `5` = pas de sol praticable ou sol **plus bas** de plus de `dpY`, `6` = sol **plus haut** de plus de `dpY`.

### 7.3 Placer un objet : `gm_object_behavior_main` (`1b11:000c`) et `1aba:000e`

`placer(o, mode)` = `1aba:000e` (certain) : après avoir mis à jour la ressource sprite (`1833:01fc`) et remis `Err` à 0, selon `mode` :

| Mode | Effet |
|---|---|
| 0 | tout à zéro : `Xyp = N = X = Y = P = Sol = 0` (objet absent) |
| 1 | recherche de position (ci-dessous) sans contrainte |
| 2, 6, 8 | `Xyp = mode` sans autre vérification |
| 3 | recherche avec **tolérance de 10 sur X et de 4 sur P** |
| 4, 5 | recherche en exigeant le type de case `Sol` (passé en `p1`) ; si elle échoue et `mode == 5`, repli sur le mode 1 |
| 9 | tirage aléatoire `X = rand() % 4acc` ; `Y = rand() % (4ad2 - 10) + 10` pour les `Dep` 1 et 3, sinon `4ad2` ; `P = rand() % 4ad8` ; `N = Sol = 0` ; puis recherche |
| 10 | `Sol = 0` puis recherche avec `AX = o.Inf` (le **côté** d'arrivée, 0 à 5, 6 = libre) |
| 7 | `gm_abort(1)` |

Puis, si le résultat est `0` ou `0x11` : les drapeaux `4c18` (c'est le héros), `4c16` (c'est la sélection), `4c1a` (type 0) sont posés, et la scène statique est redessinée si l'objet est statique (`Mob == 0`) dans la salle ou si l'appelant passe `DX = 99` (objet qui devient statique).

`gm_object_behavior_main` (**5 053 octets, probable pour l'ensemble**, c'est la fonction la plus dense du moteur) est une **recherche de la position valide la plus proche** : elle copie l'objet en `DGROUP:7936`, calcule pour chaque plan les bornes `[X] [P] [Y]` restreintes par les tolérances et les signes d'orientation passés en paramètres, puis balaye les cases de la grille **en spirale** autour de `(X >> 2, P >> 3)` (rayon croissant 1, 2, 3, …), n'acceptant que les cases du type voulu et libres d'obstacle (pour les types hors `Typ 0` : collision d'un sprite mobile avec le plan de profondeur et avec les autres objets par `1a50:0006`), et retient le point de **distance euclidienne au carré minimale** (`aFlmul`, produits sur 32 bits) ; le résultat est écrit dans `X`, `Y`, `P`, `N`, `Sol`, `Xyp = 2` (ou `1` hors salle). Codes de retour : `0` trouvé sans changer de type de case, `0x11` trouvé mais `Sol` a changé, `0x14` rien trouvé, `0x15` position demandée hors limites, `0x17` conflit de bornes. **Algorithme complet, corrigé et validé : `movement.md` § 4** (probable pour l'ensemble, porté et testé). Points qui corrigent ce qui précède : les sept paramètres sont `(AX = côté, DX = signe X, BX = tolérance X, p1 = type, p2 = tolérance P, p3 = signe P, p4 = tolérance Y, p5 = signe Y)` ; les « modes `AX` 0 à 5 » sont des **côtés** qui figent une borne de la fenêtre de recherche (`movement.md` § 4.1) ; la métrique de classement est **X et P seulement** pour un marcheur, 3D pour un voleur, et le rayon 3D entre plans ; `cRam4a4db` = « marche en salle » (`Dep 0` et en salle), `cRam4a4da` = `Txt == 2` ; le balayage est une **spirale de bandes** dont la case `(0, -1)` est omise, et à égalité le dernier candidat parcouru gagne (`<=`).

### 7.4 Collision avec le terrain et avec le plan de profondeur

- `1c96:0102` (certain) : pour un objet dont `Txt != 2` : pour chaque plan, toutes les cases couvertes par la largeur du sprite à la rangée de `P` ; la case bloque si elle est définie (`!= 0xFFFF`) et si `lo <= Y` et `Y - (Hau - 1) <= hi` (recouvrement vertical) **et** (type 1 ou `hi < Y`) ; résultat 1 (et `Inf` = type), 2 pour les objets de `Dep` 1 ou 3, 0 sinon. Si rien ne bloque, `(P & 7) == 0` et `Txt == 0` : le **test de la carte de profondeur** `pilote[+0x2e]` (un pixel opaque du sprite tombe sur une valeur du plan de priorité égale à `P`) renvoie > 0 -> résultat 4. Il n'est fait que dans les bornes `[mot[2r], mot[2r+1]]` de la rangée `r = P >> 3` de la table de 20 paires `DGROUP:4bac` (étendue horizontale du sol de chaque rangée).
- `1a50:0006` (certain) : collision objet-objet. Deux objets de **même `P`** se recouvrant en X (largeurs `Lar`, centrées sur `X`) et en Y (hauteurs `Hau`, pied en `Y`) : `Col = Ser` de l'autre, `Err = 9` si l'un des deux a `Txt != 0`, sinon `8` ; l'autre objet reçoit `Err = 8 + (…)` s'il était libre ou qu'il est de `Gst 7`. **`Err 8` bloque le mouvement, `Err 9` non** (`movement.md` § 3.3 ; `Txt == 2` rend l'objet immatériel pour le terrain, `movement.md` § 1.2).

### 7.5 Lumière et palette (`197e:0008`, certain)

Niveau de lumière `L` (entier de -63 à 63) passé au pilote comme décalage identique sur R, V, B (`pilote[+0x4a](palette, L, L, L)`, appliqué aux 216 premières couleurs). Calcul :

```text
jour = 0 ; si salle.exterieur(+4) != 0 : jour = lerp(T[h], T[h+1], minutes/60)   // T = table de 25 mots DGROUP:0e68
  T = 15 15 15 15 15 22 29 36 43 50 57 63 63 63 63 63 63 56 49 42 35 28 21 15 15
lampes = somme des Lum (+0x0A) des objets de premier niveau de : liste B, liste A de la salle, contenu du héros (s'il y est)
si exterieur : si salle.+2 == 0 : si jour < 32 : lampes = min(lampes, 31 - jour) sinon lampes = min(lampes, 0)
               sinon : jour = max(0, jour + salle.+2) ; reste = 0
L = lampes + jour + (exterieur ? 0 : salle.+2) - 63 ; L = clamp(L, -63, 63)
si 4ae2 != 0 : L = 4ae2 sinon L = min(L, 4ae4)                       // surcharges des jetons lum / ral / rvb
si L == courant : paletteSale = 0
```

Hors salle de jeu `L = 0`. Soit : de nuit dehors, `15 - 63 = -48` ; en plein jour `0` ; à l'intérieur `-63` plus les lampes (une torche de 32 ramène à `-31`). **Trop sombre** (`L < -40`, `197e:0272`) : le héros ne peut pas agir (`1504:0002` affiche un message au lieu de marcher).

### 7.6 Trajets (`gm_compute_path` `3187:0000`, `305e:0002`, suivi `30d9:0006/0184`)

- `305e:0002` construit le **graphe de navigation** de la salle pour l'objet : parcours des rangées (jusqu'à 21) et des plans, **segments** de cases consécutives de même type praticables par l'objet (`13a8:000a` accepte le type) et dont les `lo` voisins vérifient `|Δlo| * dpX <= dpY * 4` (pente) ; nœud de 16 octets `{rangée, plan, col min, col max, coût u16, parent, 8 voisins}` (250 nœuds au plus) ; deux nœuds sont voisins s'ils se touchent sur la même rangée (`|Δlo| * dpX <= dpY * 4`) ou sur des rangées adjacentes avec recouvrement de colonnes et `d * dpP <= dpY * 8` (`d` = plus petit `|Δlo|` sur les colonnes communes). Détail et validations : `movement.md` § 6.1.
- `gm_compute_path` : trouve le nœud de départ (case sous l'objet) et le nœud d'arrivée (case sous la cible, ou le plus proche en distance pondérée), propage les coûts de proche en proche (coût d'un lien = **1 par changement de rangée**, 0 sinon, plafond 32 000 : le coût compte les changements de profondeur, pas la distance), retient le trajet qui minimise la **marche horizontale** cumulée et construit dans `Chm` (+0x68) la liste des nœuds du chemin (4 octets chacun, **de l'arrivée, indice 0, au premier saut**) ; algorithme complet : `movement.md` § 6.2 ; `Nbc` = nombre de nœuds, `Def = 1` si un chemin existe. Si la cible est un objet mobile (`Cib`/`Ser`), le trajet est recalculé quand il bouge de nœud.
- Suivi (`30d9:0184`) : l'objet avance nœud par nœud (`Nbc` décroît) en réglant `Hor`, `Prf`, `Ver` ∈ {-1, 0, +1} (`Mod` 0 : alignement en colonne, 1 : déplacement en rangée, 2 : réaligne) ; ce sont ces vitesses que `179d:0004` applique. Résultat : 0 en marche, 2 collision avec la cible, 3 cible absente, 4 pas de chemin, 5 arrivé, 6 sans trajet.
- Cible aléatoire d'errance : `2151:0006` tire `X`, `Y`, `P` cibles dans `[min - 20, max + 20)` de leur plage (`rand() % (max - min + 40) + min - 20`) et appelle `gm_compute_path` ; les marcheurs de `Dep 1` ont leur `Y` cible ramené à 30 si trop haut.

## 8. Contrôle du héros

### 8.1 Entrées

- **Souris** (`INT 33h` via `int86`) : `gm_mouse_get_state` (position et boutons ; en mode 0x0E la position X est divisée par 2). Le curseur est l'objet **de type 0, `Num` 1, `Gst` 7, `P` 250** dont la procédure est `1564:0004` (table `DGROUP:0b6e`, clé 1) : à chaque **image** il met à jour `X/Y` (`+0x54/+0x56`), `Mc1`, `Mc2` (boutons) et `Hor/Ver` (sens du déplacement de la souris). Plage de la souris : X `[4, 316]`, Y `[10, 194]` (`gm_load_world`).
- **Clavier** (`INT 16h`) : `1023:0016` classe la touche par la table `3588:0008` : classe 1 = caractère frappé (ligne de saisie, `1e22:0008`, uniquement hors script : `parser.md` ; `+`/`-` règlent `Ver` du héros), 2 = touches de fonction (F1 à F6 et F10 **agissent aussi hors script**, F8 saute le script ; F7/F9 : rien), 3 = Alt + lettre (réglages § 3 ; **actif aussi pendant un script**), 4 = curseur (Début, Fin, flèches, PgPrec, PgSuiv : **marche du héros**, `1023:019e` / `1023:02f4`, hors script ; Inser : rappel de la phrase). Toute touche reconnue (retour 7) force le tic de monde. Tableau complet : `interface.md` § 7.
- Le héros **se déplace aussi au clavier** (flèches et diagonales `Hor`/`Prf`, `+`/`-` pour `Ver`, mouvement continu jusqu'à ce qu'on rappuie ; héros présent, `4b50 ≠ 0`, aucun script) ; il marche à la souris vers le point cliqué **seulement avec l'outil bottes** (§ 8.2).

### 8.2 Actions de la souris (`1564:0004`, `1504:0002`)

Les clics ne sont traités que si `4b34 == 0` (pas de script). Un clic (bouton gauche ou droit) cherche l'**objet sous le curseur** en parcourant, dans cet ordre : liste globale type 0 (interface, test sur les rectangles `x ± Lar/2`, `Y - Hau..Y`), liste A de la salle, contenu du héros, contenu de l'objet sélectionné, liste B ; le premier recouvrement gagne. Chaque **outil actif** choisit les listes à parcourir et le comportement (tableau `DGROUP:0bc2`, 35 enregistrements de 16 octets : `interface.md` § 1, qui donne le sens des champs) ; le test est un **recouvrement de rectangles**, pas un test de point. Selon le `Num` de l'icône touchée : changement de page, choix d'outil, vitesse (`Alt+A/Z` équivalents), sauvegarde (`23a2:0474 -> gm_savegame_slot`), etc. (`interface.md` § 2.1 et § 3.3). Il n'y a **pas de défilement de l'inventaire** : au-delà des 12 premiers objets ils ne sont accessibles qu'au clavier (`interface.md` § 6).

Clic dans la scène (**uniquement avec l'outil bottes, 198** ; avec l'outil par défaut il ne se passe rien, le curseur joue le refus animé : `interface.md` § 5.6) :

- **Bouton gauche** (`Mc1`) : si la lumière le permet (§ 7.5), le héros s'arrête (`gm_reset_object_motion`), la sélection est annulée, puis le point `(X - x0, Y - y0)` (coordonnées relatives à la fenêtre de la scène) est testé dans les limites de la salle : le héros y est **placé provisoirement** (recherche de position avec tolérance X 4 et tolérance Y 1, P libre : `movement.md` § 4.6, la hauteur cliquée sélectionne la profondeur) pour trouver `P` et le plan ; s'il est valide, `Xc/Yc/Pc/Nc` = ce point, `Cib = 7`, `gm_compute_path` ; le héros est remis à sa position (`Err = 0`) et marche. Le trajet est recalculé par `30d9:0006` à chaque mise à jour.
- **Bouton droit** (`Mc2`, `1504:0274`) : le point est classé dans un des quatre secteurs diagonaux de la fenêtre (comparaison avec la diagonale `|Δx| * (h/2) / (w/2)` vs `Δy`) : 0 = haut, 1 = droite, 2 = bas, 3 = gauche ; si la salle a une sortie à cet emplacement (`4b94`) le héros marche jusqu'à elle (`228e:0000`).
- Clic sur un **objet** de la salle : `219b:0000` (l'objet est-il atteignable ?) puis `1553:0004` construit l'action (verbe courant, objet direct et indirect dans `DGROUP:4dba..4dc0`) et la fait exécuter par `2210:0008` (même chemin que la phrase tapée : `parser.md`).
- Clic sur un **point sensible** (`DGROUP:4b14`) : empile le message d'ambiance (`1e58:000a`, 10 au plus, affichés par `1e58:009e`).

### 8.3 Inventaire (objets portés)

Les objets portés sont le **contenu** du héros (liste `Pos` +0x7C, `Cod 2`). `1652:0006` les range à chaque redessin : les 12 premiers (`DGROUP:4cb0`) sont affichés avec `Xyp = 8`, `X = rang * 24 + 28`, `Y = 195`, `P = 208`, les suivants sont masqués (`Xyp = 0`). Idem pour le contenu de l'objet sélectionné précédent (masqué). **Poids** : `Pds` somme récursive (`20ac:0008`) ; les procédures des personnages comparent à `Chg` (nage, escalade : messages de fatigue et de noyade `G7007..G7009` quand `Chg < poids` dans l'eau, `246c:0240`).

## 9. Comportements, score, mort

### 9.1 Procédures d'objet (`Fct`) et répartiteur du héros

`1ec8:000a(AX = Num, DX = table)` cherche par dichotomie dans dix tables de DGROUP (compte puis enregistrements de 6 octets `{clé u16, offset u16, segment u16}` ; segment fichier + 0x1000 = segment Ghidra). Les tables que le **noyau** utilise : table 7 (type 0, `0b6e`) : clé 1 -> `1564:0004` (curseur), 2 -> `1537:000e` (désactive : `Gst = Mob = 0`), 5 -> `1611:000c` (fond rebondissant) ; table 3 (type 1, `09f2`) : 9 décors ; table 2 (type 2, `0730`) : 25 personnages (clé 1 = héros -> `246c:000a`, 101 -> `28b1`, 201..204 -> `2a44`, 301 -> `2a44`, 302 -> `2cdf`, 303 -> `2dd9`, 327 -> `2d52`, …). Les autres tables sont celles de la phrase (0 verbes, 1 et 5 objet direct / indirect, 4, 9 description) et des événements différés (8) : `parser.md`.

`246c:000a` (certain pour la structure) : pour `Gst = 7`, d'abord un `switch (Err)` sur 24 cas : `0x0C`, `0x14`, `0x15` -> message `E11` « personnage non localisable » et `gm_abort` ; `0x0E` -> **mort par disparition** : jingle `E4`, message `G18` (« vous venez de disparaître dans le néant »), le héros est détruit (`19a6:01a5`), retour 0 ; `0x13` -> arrêt (`2273:0190` : `Hor = Ver = Prf = 0`) puis `placer(5)`, `4b80 := conteneur` (retour 7) ; `0x16` -> `E11` fatal sauf pour `Ego 4` ; `0x17` -> `placer(5)` ; en cas d'échec : `E11` fatal sauf pour `Ego 4`. Puis `switch (Ego)` : **0 et 1** -> `246c:0240` (marcheur : réactions au type de sol `Sol` 0..0x44 : eau, feu, vide, nage, charge), **2** -> `25ea:0008`, **3** -> `26ab:000a`, **4** -> `25ea:03ca`, **5** -> `26ab:0134`, **6** -> `2594:0004`, **7** -> `2594:033a`, **8** -> `26ab:01fc`. Ce répartiteur **ne sert que le héros** (clé 1 de la table 2) : `Ego` 0..8 sont ses états (marche, nage, escalade, glissade, chute, KO, animation scénarisée, ronces, transport de Prytwen : `characters.md` § 4.2), et `246c:0240` est son gestionnaire de marche / nage, pas une IA de PNJ. Les autres personnages ont leur propre `Fct` (table 2, `characters.md` § 2) et se servent d'`Ego` comme état propre (`characters.md` § 3.2) ; la table `Err -> action` est au `characters.md` § 3.1.

### 9.2 Santé, combat, mort, fin

- Il n'y a **pas de points de vie ni de score de combat** dans le noyau. Les combats (par exemple contre un nain, messages `G201..G205`), les morts (feu `G3..G5`, vide `G6`, noyade `G7..G10`, chute `G11`, lave `G40`, etc.) et la victoire (`G371`, `G372` : « Roi de Dol Armaëth ») sont des **séquences scriptées** dans les procédures d'objets et de salles : elles affichent un message `G…` (`209c:0092`, seulement si le héros est dans la salle) et détruisent le héros (`19a6:01a5` met `4bfe = 0`). Principe : un combat est une animation `ANM` entre deux objets « partenaires » (`Bag`) dont la fin déclenche une table de résolution propre au personnage (`characters.md` § 1.3, § 6.2, § 7) ; la mort a quatre variantes (destruction sans reste, contenu laissé dans la salle, dépouille `Num 2`, disparition `Err 0x0E` : `characters.md` § 6). Ce qui suit la mort (écran de fin, reprise d'une sauvegarde) relève de `screens.md` (E13).
- La **sortie du jeu** passe par `gm_quit` (appelé par les jetons `xit`, la fin de `CM4`, un échec de rechargement dans `gm_savegame_slot`).
- **Écran final** (`14cf:000c`, `14ee:006c`) : compare la valeur `Val >= 10` totale des objets du monde (`4cb4`) à celle portée par le héros et son contenu (`4cb8`) et le drapeau `4b67`, pour choisir le texte (`screens.md`).

### 9.3 Score et événements différés

- **Score** (`2255:00e8`, certain) : `4b5a`. La table de **35 enregistrements de 8 octets** (section 2 du monde, `DGROUP:5218`) est `{id = chapitre * 100 + indice, points, son, répétitions}`. `attribuerPoints(chapitre, indice)` : cherche l'id ; si `points > 0` : `4b5a += points`, `points := -points` (marqué attribué), jingle si `son > 0` ; si `points <= 0` : rejoue le jingle tant que le 4e mot est non nul (le décrémente). Avec le troisième argument -1 : renvoie la **somme des valeurs absolues** = score maximal, **725** dans `CFG` (35 entrées). 30 sites l'appellent (modules de scénario). Les valeurs sont 5, 10, 20, 30, 40, 50.
- **File d'événements différés** (`23a2:0002` / `23a2:0250`, certain pour la structure) : table de **12 octets** (section 3 du monde ; capacité `523a`, compte `523c`, tableau `47fa6`) `{Typ u16, Num u16, Ser u16, événement u16, compteur u16, procédure u16}`. `23a2:0002(obj, événement, opération, valeur)` : opérations `-1` supprimer, `0` créer ou lire, `1` ajouter (plafond 0xFFFF), `2` retrancher (plancher 0), `3` fixer, `4` autre (non lu) ; elle crée l'entrée si absente (sauf pour -1, 2, 4). `23a2:0250` (à **chaque tic**, après la liste de type 2) : pour chaque entrée, `compteur -= 1` ; quand le compteur était 0, l'entrée est retirée et, si elle a une procédure, `1ec8:000a(procédure, table 8)(objet)` est appelée (clés 1, 4, 101, 103, 104, 201, 303, 327, 1001..1003, 2000, 2001 ; tableau des procédures et des événements de la famille 8 : `objects.md` § 8). Événements armés par les verbes : 15 (grille du cachot, compteur 2), 18 (dalle, 10 tics), `1001` (fin de la protection contre la lave, 400) et `1002` (fin de l'invisibilité, 2500) ; les introductions de niveau arment l'événement `100 + niveau` (60 tics, procédure 2000).
- `cle chapitre drapeau` (jeton, `137b:0006`) met `4b1e[chapitre]` et efface la `Fct` mémorisée (+0x8C) des objets de type 2 dont `Num / 100 == chapitre`, ce qui force une nouvelle résolution. Pour les tables 1, 2, 5 et 9, quand `4b1e[Num / 100] == 0` (chapitre non ouvert), `1ec8:000a` renvoie des valeurs de repli (`0x130`, `6`, `0x134`, `0x3ec` selon la table) au lieu de chercher : sens non élucidé (§ 13).

## 10. Sauvegarde et chargement

Tous les fichiers de monde ont le **même format** (`formats.md`, « État du monde ») ; l'écriture est `gm_save_world` (`1d4a:0002`), la lecture `gm_load_world` (`192e:0008`) :

1. **Écriture** : `4b60` = nombre d'objets de types 0 et 2 des listes globales (`4c0e` puis `4c0a`), `4b5c` = `Ser` du héros (0 s'il n'y en a pas), `4b5e` = id de la salle chargée (salle d'indice 0 si aucune) ; signature `0x786B`, `0x00CA` ; en-tête de 54 octets (`4b46`), table de score (35 x 8, `2255:0086`), file d'événements (`23a2:0354`), 60 salles de 42 octets (têtes de listes sans valeur), puis les objets : liste type 0 puis **liste A de chaque salle**, chacun suivi de son contenu récursivement (`gm_save_object`, pointeurs remplacés par id ou `Ser`). Les **décors (type 1) ne sont pas écrits**.
2. **Lecture** : signature (erreur 0x18 sinon) ; `4ae6 = 7` ; héros et sélection oubliés ; `2fe0:0002/0099/0026` (sons coupés) ; `067c(0)` ; détruit les objets (3 listes) et libère sprites, file, table de score ; `gm_snapshot_alloc` ; lit table de score, file, salles (`4bfc` = `4b62`), met à zéro les têtes de listes ; **appelle `gm_load_scene` sur la salle d'indice 0** (scène 0 = cadre d'interface 320 x 200 : probable que ce soit ainsi que le cadre est redessiné à chaque chargement de monde ; l'argument exact n'est pas lisible dans le décompilat) puis remet `4b80`/`4b84` à zéro ; crée les objets dans l'ordre du fichier (`gm_create_object` puis recopie des octets 0x00-0x43, 0x52-0x7B ; conteneur : `Cod 1` -> salle par id, `Cod 2` -> objet par `Ser`, `Cod 3` ou `4` -> salle d'indice 0, autre valeur : erreur 0x19 ; après la recopie les objets de **type 0 reçoivent `Cod = 3`** ; `4b4a` reçoit le plus grand `Ser` relu) ; héros = objet de `Ser 4b5c` ; **salle voulue** `4b80` = salle de `4b5e` (ou conteneur du héros si `4b5e = 0`, ou salle d'indice 1) ; `gm_mouse_reset` et plage ; `15f8:000e`, `1539:011c`, `1539:0084` (curseur).
3. **Quand** : (a) **chargement initial** par `rsv` en fin de `CM2` -> `gm_savegame_slot(-1)` lit `A1FCFG.SYS` (fichier d'indice 0) ; (b) **sauvegarde / restauration utilisateur** : `gm_savegame_slot(1 | 0)` (jeton `svg`, icônes `0xC9`..`0xCB` de l'interface, `23a2:0474`) vers `svg` + numéro à 3 chiffres (`0eda`) + extension, par l'invite de disque `gm_open_with_disk_prompt` -> `SVG001.STD` (extension `.STD` : hypothèse sur le nom) ; (c) **instantané `A1FTMP.SVG`** : `gm_snapshot_world` (`203f:00c8`, jeton `sau` = écrire, `res` = relire) : écrit puis relit aussitôt le monde (indices 16 et 17) ; utilisé par la boucle quand la zone d'annulation du pilote déborde (`4b64 += 0x800`) pour **réallouer** cette zone puis tout recharger (le monde est identique, les pointeurs sont reconstruits). Ni point de contrôle automatique ni sauvegarde à l'entrée de salle.
4. Les mots de l'en-tête (`DGROUP:4b46..4b7b`, 27 mots) : `0x786B 0x00CA` signature ; `4b4a` dernier `Ser` ; `4b4c` lettres significatives du dictionnaire (octet bas 8) ; `4b4d` ; `4b4e` chapitre*100 + niveau (3) ; `4b50` (7) autorise le basculement de course du héros (`1564`, icône `0xC7`) ; **`4b51` délai (6)** ; `4b52` compteur ; `4b53` pause ; **`4b54` heure (10)**, `4b55` minute ; `4b56` centièmes ; `4b58` (4) ; **`4b5a` score** ; `4b5c` `Ser` du héros ; `4b5e` salle ; `4b60` objets ; `4b62` salles ; `4b64` taille de la zone d'annulation (0 dans le fichier) ; `4b66` durée de pause des écrans (`1db5:0004`) ; `4b67` drapeau de fin ; `4b68..4b7b` drapeaux par niveau (`4b68 + niveau % 100`, `4b73 + 0..3`).

## 11. Hasard

Générateur de **Microsoft C 6.0** (certain, `3938:1102/1114`) : `srand(s)` : `seed32 = s` (mot bas, mot haut = 0) ; `rand()` : `seed32 = seed32 * 0x000343FD + 0x00269EC3` (32 bits), retourne `(seed32 >> 16) & 0x7FFF`. Graine de départ : mot bas de `time()` (date/heure DOS) ; **aucun** autre appel à `srand`. Donc non reproductible sans fixer la graine.

`gm_chance_one_in(n)` (`1e08:0000`) = `rand() % n == 0` (21 appelants). Emplois du hasard repérés (19 sites `rand`, 21 `chance_one_in`) :

| Où | Usage |
|---|---|
| `1cc3:0712` | phase d'animation initiale des décors : `Ind = rand() % Tot + 1` |
| `1aba:000e` mode 9 | position aléatoire d'un objet (`X`, `Y`, `P`) |
| `2151:0006` / `01b4` | cibles d'errance des personnages |
| `1611:000c`, `1611:0256` | fond rebondissant (position et sens initiaux) |
| `246c:034b` (`gm_chance_one_in`), `2774:0004`, `28b1:0000`, `2a44:000c`, `2d52:000e`, `2dd9:0006`, `26da:000e`, … | décisions des personnages (attaquer, bouger, parler) |
| `1414:0006` | barrages « au hasard » (cas 4, 5) |
| `147f:000a` (salle `0x131`) | endormissement aléatoire des soldats de la salle de garde (1 chance sur 2 par place : `characters.md` § 7.3) |

## 12. Particularités et défauts à reproduire

1. **Un tic force par touche** : toute touche classée (même une lettre tapée) met `e60 = 7` donc `e62 = 7` dans l'image ; marteler le clavier accélère le monde.
2. **Alt+A/Z** remettent `4b52 = 0` : le prochain tic est immédiat.
3. `4b32` (indicateur d'arrêt) n'est jamais écrit : la sortie ne passe que par `gm_quit`.
4. **Redémarrage de liste** : le parcours d'une liste reprend en tête si l'objet suivant a changé pendant la mise à jour de l'objet courant ; un objet peut donc être mis à jour deux fois dans un tic.
5. **Inversion à chaque cycle** : l'insertion en tête inverse l'ordre des listes à chaque sauvegarde + rechargement (l'écriture suit l'ordre de la liste, la création l'inverse).
6. **`Ser += 10000`** pendant un transit de salle ; remis à `% 10000` par `186d:0128` ; une sauvegarde faite entre-temps l'écrit tel quel.
7. **Décors non sauvegardés** : l'état d'animation des décors est donc perdu, phase aléatoire à chaque chargement.
8. **Première image d'une salle sans mise à jour** de type 2 ni horloge.
9. **Mode de `rand`** : modulo non corrigé (`rand() % n`), biais conservé.
10. **`4b4e % 100`, `/ 100`** : le niveau (chapitre * 100 + sous-niveau) est lu en deux endroits (`147f:000a`, `14cf`), valeur initiale 3.
11. **Tailles fixes** : 250 nœuds de trajet, 100 entrées de score, 10 messages d'ambiance, 12 icônes d'inventaire, 16 arguments de script.
12. **Gravité des objets lâchés** : les objets `Dep 1` portent `Ver = 1` dans `CFG` ; dès qu'ils deviennent mobiles (`Mob 2`) ils tombent de `dpY` par tic jusqu'à buter sur une case (`1c96:0102` renvoie 1 et le pas est annulé).
13. **Palette** : le niveau de lumière est recalculé toutes les 10 minutes de jeu et à chaque événement qui touche `4ae6` ; entre deux, il est constant.

## 13. Questions ouvertes

1. **`gm_object_behavior_main`** : ordre exact du balayage, départage à distance égale, sens des tolérances (`BX`, `param_2..5`) et du paramètre `AX` (modes 0..5 qui figent une des six bornes) ; sens de `cRam4a4db`/`4a4da` (filtre de type de case demandé, mode zone). **Résolue pour l'essentiel** : `movement.md` § 4 (restes : `movement.md` § 8, points 6, 7, 10).
2. **`Dep` 1, 3** (chute / vol / « chute à cases ») et **2, 4** (zones) : comportement exact de `179d:04da..0900` ; jamais exercé par les objets de `CFG` hors chute. **Résolue pour l'essentiel** (code lu, non exercé) : `movement.md` § 2.4 à § 2.6, § 8 point 5.
3. **Codes de barrage** (`+0x16`) : table complète des conditions de `1414:0006` (une trentaine de cas). **Résolue pour l'essentiel** : table complète au `movement.md` § 5 (restes : prédicat `G`, `movement.md` § 8 point 1) ; le résultat de `1414:0006` est **7 = bloqué**, 0 = libre ; les codes 8 et 105 sont libres.
4. **IA des personnages** (`Ego` 0..8, modules `246c`-`2dd9`) et table `Err -> action` : **résolues** par `characters.md` § 3 à § 8 (table `Err` au § 3.1) ; restes : `characters.md` § 12.
5. **`13a8:000a`** : quels types de `Sol` chaque objet accepte (par `Num` et `Ego`), et `Txt` (valeur 1) ; **`1a50:0006`** : sens complet de `Err 8/9` (**résolu** : `Err 8` bloque, `Err 9` non, `movement.md` § 3.3 ; `13a8:000a` : table partielle au `characters.md` § 5 et `movement.md` § 7, restes `movement.md` § 8 point 3).
6. **Octets 2..3 des enregistrements de 20 octets** de la scène (toujours ouverts), **premier mot de chaque salle** (+0x06/+0x08, musique : voir `audio.md`). Le 2e tableau (zones) est résolu : enregistrements `{type, 0xFF, rangée, c0, hi, lo, c1}` (`Y haut` avant `Y bas`, `movement.md` § 1.1 et § 9) et les mots 9 à 14 de l'en-tête de scène sont les limites de la salle (`graphics.md`).
7. **Champs inconnus** : `Ftn`, `Set`, `Bag`, `Sal`, `Mc3`, `Mc4`, +0x24..0x2B, +0x41/0x42 ; rôles de `4b4d`, `4b58`, `4b66`, `4b67`, `4b68..4b7b` ; opération 4 de `23a2:0002`.
8. **Cadre d'interface** : confirmer que `gm_load_world` redessine le cadre (scène 0) ; la zone `TMP.SCR` (`1664:0057` / `06b6`, 2 200 octets de code) restent à documenter dans `screens.md`.
9. **Valeurs réelles de cadence** : durée d'une image, tics par seconde au délai 6. **Résolue** : 70,0866 Hz, 7 images = 99,9 ms, 10,01 tics/s, héros à 20 px/s (`dosbox.md` § 3). Reste non mesurée la fréquence des tics BIOS (`wat`).
10. **Table des icônes** `DGROUP:0bc2` (35 x 16 octets) : sens de chaque champ (rôle du curseur sur chaque `Num`). **Résolue** : `interface.md` § 1.

### À valider en analyse dynamique (DOSBox + débogueur)

- fréquence d'images et de tics au délai initial 6 (attente de retour vertical, durée du traitement), vitesse de marche en pixels par seconde ;
- séquence exacte de `rand` consommée à l'entrée d'une salle (ordre des appels, pour reproduire une graine) ;
- résultat de `gm_object_behavior_main` sur des cas limites (point cliqué sur un obstacle, objet lâché sur une pente, deux objets au même point) ;
- ordre des mises à jour pendant le redémarrage de liste ;
- formule de lumière : niveaux observés à l'écran aux heures 0, 5, 12, 20 ;
- sorties : table de barrage `1414:0006` jouée case par case, et `Err` du héros pendant une traversée complète ;
- taille effective de la zone d'annulation et fréquence des instantanés `TMP.SVG` (au premier lancement, aucun ne devrait avoir lieu).

## Écarts avec les documents existants

- **`re-index.md`, « Enregistrement d'objet »** : table d'offsets remplacée par celle du § 6.1 (`Hor`/`Ver`/`Prf` = +0x60/+0x61/+0x62, `Xyp` +0x52, `N` +0x53, `Cod` +0x5B, `Err`/`Inf` +0x3E/+0x3F, `Col` +0x3C ; `Typ` 0/1/2 = `INT`/`DEC`/`OBJ` ne désigne pas des familles de salles mais de listes). `gm_main_loop` n'est plus « probable » : sa structure est certaine (§ 4).
- **`formats.md` / `graphics.md`, grille de marche** : les `ng` enregistrements de 16 octets sont la **grille 81 x 21 par plan** (type et intervalle de hauteur interpolé), les `nz` enregistrements de 16 octets suivants sont les **zones** des objets de `Dep` 2/4 ; la carte de profondeur (couche B) est le **plan de priorité** du pilote ; les 40 mots = 20 paires (X min, X max) par rangée ; les enregistrements de 10 octets = **points sensibles** (id de message + rectangle) ; ceux de 20 octets = **décors de type 1** (§ 5.3).
- **`formats.md`, table de 8 octets du monde (« zones »)** : c'est la **table de score** (§ 9.3), pas des zones géométriques. La table de 12 octets est la **file d'événements différés**.
- **`formats.md`, salle de 42 octets** : les mots 5..10 sont les sorties, 11..16 les barrages, 17..20 les têtes de listes (§ 5.1).
- **`re-index.md`, « Minuterie »** : la cadence est celle de l'écran (retour vertical du pilote) ; les tics de monde sont un diviseur configurable (§ 3).
- **Consolidation avec `objects.md`, `characters.md`, `movement.md`, `interface.md`** : les corrections que ces études demandent à ce document sont reportées en place (`Inv` = caché, `Ego` = état, champs du curseur, § 5.4, § 7.2 à § 7.6, § 8.1, § 8.2, § 9.1 à § 9.3, § 13). Une lecture reste à trancher en DOSBox : le rendu de `Inv` au blit (§ 6.4).
