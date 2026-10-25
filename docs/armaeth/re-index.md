# AM1.EXE : index de rétro-ingénierie

Décompilation de `original/armaeth/AM1.EXE` (le moteur d'*Armaeth*, Grandslam Video 1994 ; MZ DOS 16 bits real mode, Microsoft C 6.0 en modèle large avec émulateur 8087, 254 892 octets, lancé par `am1 * a1f`) avec Ghidra en mode headless. Ce document est le point d'entrée des tâches qui lisent les données (formats) ou étudient le moteur : il dit quelles fonctions chargent chaque famille de fichiers, où est la décompression des images, comment le moteur parle à ses pilotes, et comment lire le corpus.

Les blocs entre `<!-- GEN:... -->` sont réécrits par `run.sh`. Le reste est écrit à la main. Les formats de données sont décrits dans `docs/armaeth/formats.md` (écrit en parallèle, jamais modifié ici) : la section « Écarts avec formats.md » liste ce que la lecture du code confirme, précise ou contredit.

Confiance : **certain** = comportement lu dans le code et, quand c'est précisé, recoupé par un calcul sur les fichiers de données ; **probable** = rôle déduit des appelants, des chaînes et des arguments ; **hypothèse** = lecture plausible non vérifiée.

## Régénérer

```bash
bash scripts/armaeth/re/run.sh
```

- Prérequis : `brew install ghidra` (aucun autre outil ; le décompileur natif est compilé au premier lancement par `scripts/re/run-lib.sh`, voir `docs/teleportaschtroumpf/re-index.md`).
- Durée : une quarantaine de secondes. Le script est idempotent et ne demande rien.
- Les sorties sont dans `archives/armaeth/re/` (ignoré par git) :

| Fichier | Contenu |
|---|---|
| `decomp/<seg>_<off>_<nom>.c` | une décompilation C par fonction ; en-tête : taille, appelants, appelés, chaînes référencées |
| `functions.tsv` | adresse, nom, type (`func`, `lib`, `rtl`, `fragment`), taille, nb d'instructions, appelants, appelés, état de la décompilation, fichier |
| `strings.tsv` | adresse DGROUP, longueur, chaîne, fonctions référentes (`seg:off/type`) |
| `libfuncs.tsv` | fonctions de bibliothèque C nommées, avec la preuve |
| `keyfuncs.tsv` | fonctions du jeu nommées (préfixes `gm_` et `snd_`), avec groupe, confiance, rôle, preuve |
| `disasm.txt` | listing désassemblé complet, avec noms de fonctions cibles et chaînes en commentaire |
| `project/` | projet Ghidra (`armaeth`), ouvrable dans l'interface (`ghidraRun`) |
| `run.log` | journal complet de Ghidra |

Scripts (`scripts/armaeth/re/`) : `run.sh`, `SetDS.java` (avant l'analyse), `SeedFunctions.java` (copie adaptée de celle de `SMURF.EXE`), `IdentifyLibs.java` et `NameGameFuncs.java` (renomment à partir des tables `libs.def.tsv` et `keyfuncs.def.tsv`, source de vérité des noms et des preuves), `make_index.py` (met à jour ce document), `vga-keyfuncs.def.tsv` et `vga-libs.def.tsv` (mêmes tables pour `VGA.EXE`, dont les sorties sont dans `archives/armaeth/re/vga/`, voir « Pilote vidéo `VGA.EXE` »). Les exports (`ExportStrings`, `ExportDecompiled`, `ExportDisasm`, `ReCommon`) sont communs à tous les jeux et vivent dans `scripts/re/`.

Les adresses sont des `segment:offset` en chargement Ghidra (segment de base `1000`, soit le segment du fichier + `0x1000`). Pour retrouver l'adresse dans le fichier : `offset_fichier = 0x4000 + (segment - 0x1000) * 16 + offset` ; pour une donnée de DGROUP : `offset_fichier = 224 624 + offset_DGROUP`.

## Statistiques

<!-- GEN:stats -->
- Outils : ghidra 12.2 ; JDK : openjdk version "25.0.5" 2026-10-20.
- Durée de la dernière régénération : 37 s.
- Fonctions : 1124 (code Ghidra), 200394 octets (96.2 % des 208240 octets de code avant DGROUP).
- Types : fragment 134, func 783, lib 47, rtl 160.
- Décompilation : 1034 ok (92.0 %), 51 partielle (code illisible pour Ghidra par endroits), 39 en erreur.
- Fonctions de bibliothèque nommées avec certitude : 45 (+ 27 probable, non renommée). 160 fonctions du segment `3938` restent du code C Microsoft non identifié (type `rtl`).
- Chaînes dans DGROUP : 116 ; référencées par au moins une fonction : 67. Références heuristiques par type : imm 61, table 11.
- Décompilation en erreur (utiliser `disasm.txt`) : `117d:0001`, `1250:0007`, `137b:0005`, `139a:00bf`, `1ec8:0009`, `1ec8:0113`, `228e:0229`, `246c:0009`, `246c:034b`, `2500:0523`, `2774:0003`, `2a44:0075`, `2bd6:0001`, `2cdf:0699`, `2dd9:03cf`, `2dd9:073b`, `30d9:0983`, `36b6:0002`, `3dff:0a75`, `3dff:0c51`, `3dff:0c71`, `3dff:0c85`, `3dff:0ca2`, `3dff:0cb3`, `3dff:0cc6`, `3dff:0e98`, `3dff:0ed1`, `3dff:1036`, `40f7:0790`, `40f7:0919`, `40f7:0969`, `40f7:096a`, `40f7:0978`, `40f7:0b95`, `40f7:0bb1`, `40f7:0bb2`, `40f7:10f8`, `40f7:1148`, `40f7:1149`.
- Décompilation partielle : `3dff:0f26`, `406e:020b`, `3938:1622`, `40f7:0cf8`, `36d4:0219`, `3dff:21b8`, `40f7:12d1`, `40f7:0e6a`, `3938:4474`, `3dff:0b82`, `3938:094e`, `36d4:01d0`, `3dff:0e74`, `36d4:043c`, `3dff:2189`, `3dff:09ca`, `3dff:087f`, `3938:44e1`, `3dff:2162`, `11dc:0399`, `3938:15da`, `3dff:211c`, `3dff:2140`, `36d4:0362`, `3dff:0a55`, `3dff:26d2`, `3938:49ca`, `3dff:26ba`, `406e:078f`, `36d4:0203`, `36d4:0cfb`, `40f7:011a`, `3dff:0b3f`, `3938:4307`, `406e:0623`, `406e:0605`, `36d4:09f6`, `406e:01fc`, `406e:0666`, `1cc3:0597`, `1cc3:061b`, `3938:42e6`, `406e:0600`, `406e:064d`, `3dff:0a35`, `406e:0651`, `3938:4028`, `3dff:0bd0`, `406e:086b`, `3938:094d`, `3dff:04ca`.
- Image : 254892 octets, en-tête 16384 octets, DGROUP = segment `42d7`.
<!-- /GEN:stats -->

## Modèle mémoire, segments, DGROUP

- **En-tête MZ** : 16 384 octets (`e_cparhdr = 0x400`), **4 027 relocalisations**, image de 238 508 octets, **aucun overlay** (la taille du fichier est exactement en-tête + image), `minalloc = maxalloc = 0xEE` paragraphes. Point d'entrée `CS:IP = 2938:001a` dans le fichier (`3938:001a` sous Ghidra) ; `SS:SP = 3aa8:0800` à l'entrée (le startup les remplace).
- **Compilateur** : Microsoft C 6.00 (1990), **modèle large** (code et données lointains, un segment de code par module). Preuves : chaîne « MS Run-Time Library - Copyright (c) 1990, Microsoft Corp » en `DGROUP:0008`, messages `R6000`..`R6009`, `_C_FILE_INFO=`, génération aléatoire `x * 0x343FD + 0x269EC3`, `_makepath`, `_dos_*`, appels `INT 34h-3Dh` de l'émulateur 8087 (module `3dff`).
- **DGROUP** : segment `42d7` sous Ghidra (`32d7` dans le fichier). Le startup (`3938:001a`) fait `MOV DI, seg DGROUP`, place SS dans DGROUP (la pile est en haut de DGROUP), efface le BSS depuis `DGROUP:763c` (le fichier contient 30 268 = `0x763C` octets de données initialisées). `run.sh` lit ce segment directement dans le startup (motif `bf <seg> 8b 36 02 00 2b f7`) et le passe aux scripts par `RE_DGROUP`, parce que la détection du startup Borland de `ReCommon.java` ne marche pas avec Microsoft C.
- **Idiome de données** : le code charge `ES` avec une variable de DGROUP (`MOV ES,[0x739c]`, `MOV ES,[0x6cd0]`, etc.) avant presque chaque accès à une globale. Ces mots (relocalisés) valent tous `seg DGROUP`. C'est un artefact du compilateur : les références aux données sont `ES:[offset DGROUP]`, ce que `SetDS.java` (DS = DGROUP partout) et le décompilat rendent par `uRam0004xxxx` (adresse linéaire = `0x42d70 + offset`).
- **Code** : de `1000:0000` à `42d6` environ 208 Ko répartis en 244 segments non vides (un par module source). Le segment `3938` contient le startup et la bibliothèque C ; `RE_RTL_SEG=3938` classe ses fonctions non identifiées en type `rtl`. Le décompileur ne produit qu'un résultat partiel ou en erreur sur une petite part des fonctions (voir statistiques ; le listing `disasm.txt` fait foi).

### Carte des modules

<!-- GEN:modules -->
| Segments | Segments non vides | Fonctions | Octets | Décompil. ok | Rôle |
|---|---:|---:|---:|---:|---|
| `1000`-`1004` | 1 | 1 | 89 | 100 % | main (1000:0000) |
| `1005` | 1 | 1 | 481 | 100 % | initialisation du moteur |
| `105e`-`1264` | 16 | 43 | 8184 | 93 % | gestionnaires des 11 groupes de jetons de commande (105e, 10f2, 10fb, 111f, 117d, 11dc, 1218, 123d, 1250), DEF (10b3), recherche d'objet (1118) |
| `1265` | 1 | 2 | 1490 | 100 % | affichage de tous les champs d'un objet (dump de débogage) |
| `12c2` | 1 | 2 | 1964 | 100 % | tracé de lignes (écriture directe en A000) |
| `1346` | 1 | 1 | 826 | 100 % | scripts CM1-CM4 (XOR 0xBB) |
| `1564` | 1 | 1 | 2345 | 100 % | contrôle du héros à la souris / déplacement |
| `16f5`-`1735` | 2 | 8 | 2510 | 100 % | ANI et ressources sprite |
| `18a9` | 1 | 2 | 2111 | 100 % | boucle principale |
| `192e` | 1 | 1 | 1272 | 100 % | chargement du monde (CFG / STD / SVG) |
| `19a6`-`1a7a` | 5 | 10 | 3378 | 100 % | création et listes d'objets |
| `1cc3` | 1 | 5 | 2110 | 60 % | chargement de salle |
| `1d4a` | 1 | 2 | 773 | 100 % | sauvegarde du monde |
| `1d83`-`1dd4` | 4 | 8 | 2096 | 100 % | erreurs, analyse de la commande tapée, dictionnaire |
| `1e08`-`1e68` | 6 | 18 | 3059 | 100 % | hasard, listes, chemins et ouverture des fichiers de données |
| `1ee6` | 1 | 5 | 1066 | 100 % | sortie |
| `1f94` | 1 | 1 | 1582 | 100 % | décodeur d'images de fond |
| `1ff8`-`2013` | 3 | 9 | 1127 | 100 % | allocation, messages (TMS / MSG) |
| `2052`-`2065` | 2 | 5 | 371 | 100 % | emplacements de sauvegarde, MSGINT |
| `2255` | 1 | 6 | 487 | 100 % | tables du monde |
| `2f33`-`3024` | 8 | 28 | 4750 | 100 % | son (MIX et pilote) |
| `3187` | 1 | 3 | 3355 | 100 % | recherche de chemin |
| `325a`-`327a` | 2 | 6 | 2152 | 100 % | police GPH, affichage de texte |
| `348a`-`34ba` | 2 | 9 | 777 | 100 % | erreurs critiques DOS (INT 24h), erreurs fatales, disque |
| `34bb` | 1 | 2 | 765 | 100 % | décompresseurs de ligne d'image |
| `34eb`-`356b` | 4 | 11 | 2169 | 100 % | arguments, ouverture avec invite de disque, messages matériels |
| `3574`-`35f9` | 13 | 26 | 2126 | 100 % | BIOS : écran INT 10h, clavier INT 16h, minuterie INT 1Ah, souris INT 33h (35c0-35e8) |
| `35fa`-`3937` | 26 | 130 | 12623 | 93 % | curseur logiciel et état vidéo (35fa-36d4 : appels INT 33h/10h, accès EGA/VGA direct 3CEh), clavier INT 16h (3928), palette EGA (3855) |
| `3938`-`3dfe` | 1 | 209 | 18398 | 95 % | startup + bibliothèque C Microsoft 6.0 (modèle large) |
| `3dff`-`406d` | 1 | 114 | 9263 | 76 % | émulateur 8087 (INT 34h-3Dh) |
| `406e`-`40f6` | 1 | 22 | 1603 | 54 % | données du pilote musical embarqué (DS = 406e) |
| `40f7`-`42d6` | 1 | 59 | 5602 | 74 % | pilote musical embarqué (OPL2, MIDI, haut-parleur ; ISR IRQ0) |
| autres | 132 | 374 | 99490 | 95 % | non classé : comportements d'objets et de salles (2363-2f32, 3187-3340...), objets, graphique et pilotes divers |
<!-- /GEN:modules -->

Les « groupes de jetons » sont décrits plus bas. Les modules `2363-2f32` et `3187-3340` (non classés ci-dessus) contiennent la logique des salles et des personnages : ils appellent presque tous `200c:0004` (affichage d'un message par identifiant, 138 appelants) et manipulent les champs de l'enregistrement d'objet.

### Bibliothèque C Microsoft

Il n'existe pas de signatures FLIRT pour Microsoft C 6 modèle large : les fonctions ci-dessous ont été identifiées à la main (comportement du décompilat, appels `INT 21h`, nombre d'appelants, chaînes). La table source est `scripts/armaeth/re/libs.def.tsv` ; la taille attendue de chaque fonction y est contrôlée (une dérive empêche le renommage). Seules les fonctions **certain** sont renommées dans Ghidra (préfixe `lib_`) ; les **probable** ne sont que proposées ici.

<!-- GEN:libfuncs -->
| Adresse | Nom | Octets | Appelants | Confiance | Preuve |
|---|---|---:|---:|---|---|
| `3938:001a` | `lib__astart` | 203 | 0 | certain | Point d'entrée MZ : INT 21h AH=30h (version DOS >= 2), SS=DGROUP, INT 21h AH=4Ah, efface le BSS (rep stosw depuis DGROUP:763c), appelle main (1000:0000) |
| `3938:011a` | `lib__cinit` | 197 | 1 | probable | INT 21h AX=3500h/2500h (vecteur 0), cherche « _C_FILE_INFO= » dans l'environnement |
| `3938:01df` | `lib_exit` | 7 | 6 | probable | Appelée avec le code de sortie par 1ee6:0008 (0) et 34b4:0000 (1) |
| `3938:01f8` | `lib__exit` | 106 | 0 | certain | INT 21h AH=4Ch après restauration des vecteurs |
| `3938:0262` | `lib__restore_vectors` | 45 | 1 | probable | INT 21h AX=2500h, appelée par _exit |
| `3938:02a2` | `lib_fclose` | 198 | 20 | certain | Teste les drapeaux FILE (0x83, 0x40), vide le tampon, ferme le handle (22c6) et supprime le fichier temporaire (remove) |
| `3938:0368` | `lib__fsopen` | 51 | 1 | probable | Alloue un FILE (getstream) et appelle _openfile |
| `3938:039c` | `lib_fopen` | 27 | 2 | certain | Appelée par le fopen du jeu (348a:01ae) avec nom et mode ; enchaîne 0368 puis 1ae8 |
| `3938:03b8` | `lib_fread` | 161 | 17 | certain | fread(buf far, taille, nombre, FILE far) : 17 appelants, tous des chargeurs de données |
| `3938:052a` | `lib_fwrite` | 161 | 6 | certain | fwrite(buf, taille, nombre, FILE) : utilisée par puts et les sauvegardes |
| `3938:06ce` | `lib_free` | 19 | 2 | certain | Libère un bloc du tas (realloc avec taille 0 l'appelle ; gm_free l'appelle pour les petits blocs) |
| `3938:06e1` | `lib_malloc` | 125 | 3 | certain | Alloue dans le tas (realloc avec pointeur NULL l'appelle ; gm_alloc l'appelle quand la taille tient sur 16 bits) |
| `3938:075e` | `lib_strcat` | 70 | 6 | certain | strlen de la destination puis copie |
| `3938:07a4` | `lib_strcpy` | 54 | 14 | certain | Copie avec le NUL, renvoie la destination |
| `3938:07da` | `lib_strcmp` | 41 | 1 | certain | Compare strlen(s2)+1 octets |
| `3938:0804` | `lib_strlen` | 23 | 15 | certain | repne scasb |
| `3938:081c` | `lib_strncpy` | 42 | 4 | certain | Copie au plus n octets puis complète par des zéros |
| `3938:0846` | `lib_strncmp` | 59 | 2 | certain | Compare au plus n octets ou jusqu'au NUL |
| `3938:0882` | `lib_atoi_thunk` | 3 | 4 | probable | Saute vers 277e (atoi) ; utilisée pour lire les compteurs des fichiers MSG* et les nombres des commandes |
| `3938:08ae` | `lib_toupper` | 22 | 3 | certain | Soustrait 0x20 si le bit 2 de _ctype (DGROUP:6781, index = caractère) est positionné |
| `3938:08c4` | `lib_int86` | 137 | 15 | certain | Construit « CD nn CB » sur la pile (INT nn ; RETF), charge/sauve AX BX CX DX SI DI et le drapeau C dans une structure REGS ; 15 appelants (souris INT 33h, vidéo INT 10h, clavier INT 16h, driver VGA INT 16h) |
| `3938:0982` | `lib_fgets` | 121 | 1 | probable | Lit une ligne dans un tampon (utilisée par 351f:0002 pour MSGINT/MSGHRD) |
| `3938:09fc` | `lib_fseek` | 128 | 4 | certain | origine 0..2, SEEK_CUR via ftell (2800), puis lseek DOS (22e6) |
| `3938:0a7e` | `lib_puts` | 135 | 4 | certain | strlen, fwrite sur stdout (DGROUP:68de), ajoute « \n » |
| `3938:0b08` | `lib_sprintf` | 106 | 1 | certain | Appelée seulement par 1265:0008 avec un tampon et des formats « Num %4d ... » ; moteur _output (1d8e) |
| `3938:0b74` | `lib_realloc` | 134 | 1 | certain | ptr NULL -> malloc, taille 0 -> free, sinon agrandit sur place ou alloue/copie/libère |
| `3938:0bfa` | `lib_hfree` | 12 | 1 | probable | INT 21h AH=49h ; appelée par gm_free (1ff8:006a) pour les blocs de plus de 64 Ko |
| `3938:0c06` | `lib_halloc` | 178 | 1 | probable | 3 paramètres (nombre long, taille) ; INT 21h AH=48h ; appelée par gm_alloc quand DX != 0 |
| `3938:0cb8` | `lib_int86x` | 154 | 6 | certain | Même stub « INT nn ; RETF » qu'int86, plus une structure de registres de segment (4e paramètre) |
| `3938:0d60` | `lib_time` | 85 | 1 | probable | INT 21h AH=2Ah et 2Ch ; appelée par main avant srand |
| `3938:0db6` | `lib_strchr` | 45 | 1 | certain | Cherche un caractère, renvoie NULL sinon |
| `3938:0de4` | `lib_stricmp` | 69 | 1 | certain | Compare en repliant les majuscules |
| `3938:0e2a` | `lib_strlwr` | 36 | 2 | certain | Minuscules |
| `3938:0e4e` | `lib_strupr` | 36 | 1 | certain | Majuscules |
| `3938:0e72` | `lib_strtok` | 169 | 2 | certain | Appelée en boucle avec (chaîne, délimiteurs) puis (NULL, délimiteurs) |
| `3938:0f1c` | `lib_strstr` | 103 | 1 | probable | Recherche d'une sous-chaîne (analyseur de jetons 109a:0002) |
| `3938:0f84` | `lib_memmove` | 202 | 2 | certain | Copie avec détection du recouvrement et passage de segment (pointeurs huge) |
| `3938:104e` | `lib_memcpy` | 94 | 5 | certain | Copie rep movsw avec retenue de segment (+0x1000 par 64 Ko) ; utilisée par les décompresseurs |
| `3938:10ac` | `lib_memset` | 72 | 10 | certain | Remplit avec un octet (aligne puis rep stosw) |
| `3938:10f4` | `lib_abs` | 13 | 2 | certain | (x ^ s) - s |
| `3938:1102` | `lib_srand` | 17 | 1 | certain | Écrit la graine DGROUP:6886 ; appelée par main avec time() |
| `3938:1114` | `lib_rand` | 40 | 19 | certain | graine * 0x000343FD + 0x00269EC3, renvoie (graine >> 16) & 0x7FFF (LCG de Microsoft C) ; 19 appelants |
| `3938:113c` | `lib__rotl` | 13 | 1 | certain | Rotation 16 bits |
| `3938:114a` | `lib__makepath` | 236 | 1 | certain | Assemble lecteur « : », répertoire (ajoute « \ »), nom, extension (ajoute « . ») |
| `3938:1278` | `lib_getcwd` | 24 | 2 | probable | Enveloppe de _getdcwd(0, ...) |
| `3938:1290` | `lib__getdcwd` | 259 | 1 | certain | Construit « X:\ » puis INT 21h AH=47h |
| `3938:13a1` | `lib__dos_findfirst` | 51 | 1 | probable | INT 21h AH=2Fh/1Ah (DTA) puis recherche |
| `3938:13d4` | `lib__dos_getdrive` | 20 | 1 | probable | INT 21h AH=19h |
| `3938:13e8` | `lib__harderr` | 35 | 1 | certain | Installe le vecteur INT 24h (AL=24h, AH=25h) vers 3938:140b ; le gestionnaire du jeu est 348a:022c |
| `3938:1437` | `lib__hardretn` | 8 | 1 | probable | Retour du gestionnaire INT 24h |
| `3938:1440` | `lib__hardresume` | 69 | 1 | probable | Reprise du gestionnaire INT 24h |
| `3938:1486` | `lib__dos_setdrive` | 23 | 1 | probable | INT 21h AH=0Eh |
| `3938:149e` | `lib__aFldiv` | 154 | 3 | certain | Division 32 bits signée (aide du compilateur) |
| `3938:1538` | `lib__aFlmul` | 50 | 9 | certain | Multiplication 32 bits (aide du compilateur) |
| `3938:189b` | `lib__nmsg_write` | 54 | 5 | probable | INT 21h AH=40h ; messages « R6000 - stack overflow », « run-time error » |
| `3938:19c4` | `lib__flsbuf` | 235 | 4 | certain | Vide/remplit le tampon d'un FILE (appelée par puts quand le compteur devient négatif) |
| `3938:1ae8` | `lib__openfile` | 244 | 1 | certain | Analyse le mode (r=0, w=0x301, a=0x109, + t b) et ouvre via 3772/378c |
| `3938:1d8e` | `lib__output` | 1044 | 1 | certain | Moteur de printf (1044 octets) appelé uniquement par sprintf |
| `3938:2278` | `lib__getstream` | 78 | 1 | probable | Cherche un FILE libre |
| `3938:22c6` | `lib__close` | 32 | 1 | certain | INT 21h AH=3Eh |
| `3938:22e6` | `lib__lseek` | 122 | 3 | certain | INT 21h AX=4200h/4201h/4202h |
| `3938:2360` | `lib__read` | 254 | 2 | certain | INT 21h AH=3Fh |
| `3938:245e` | `lib__write` | 192 | 3 | probable | INT 21h AH=40h avec traduction LF -> CRLF (251e) |
| `3938:26c9` | `lib__dos_setblock` | 80 | 1 | probable | INT 21h AH=4Ah |
| `3938:273a` | `lib__dos_allocmem` | 67 | 1 | probable | INT 21h AH=48h |
| `3938:277e` | `lib_atoi` | 86 | 0 | probable | Conversion décimale (saute les blancs via _ctype bit 8) |
| `3938:2800` | `lib_ftell` | 406 | 1 | probable | Position courante (appelée par fseek SEEK_CUR) |
| `3938:2a88` | `lib_intdosx` | 97 | 1 | probable | Appelle INT 21h avec registres d'une structure (AH fourni par l'appelant) |
| `3938:2c76` | `lib_remove` | 15 | 1 | certain | INT 21h AH=41h |
| `3938:378c` | `lib__open` | 417 | 0 | probable | INT 21h AH=3Dh/3Ch/3Eh/43h/42h/44h... (open avec drapeaux O_*, table des handles DGROUP:6751) |
| `3dff:01f8` | `lib__emu_init_vectors` | 72 | 1 | probable | INT 21h AX=3534h/2534h : installe l'émulateur 8087 (INT 34h-3Dh) ; message « floating-point support not loaded » |
| `3dff:0f26` | `lib__emu_core` | 2545 | 0 | probable | Cœur de l'émulateur 8087 (2545 octets, appelé par les INT 34h-3Dh) |
<!-- /GEN:libfuncs -->

Éléments de bibliothèque repérés dans DGROUP : `_ctype` en `DGROUP:6781` (bits Microsoft : 1 majuscule, 2 minuscule, 4 chiffre, 8 blanc), table `_osfile` en `6751`, stdout en `68de`, graine de `rand` en `6886`, table de conversion des codes d'erreur DOS en `errno`. Le décompilat des fonctions `lib_*` est exact pour les chaînes et les copies mais rend mal les pointeurs lointains (segment et offset séparés).

## Interfaces avec le système

### Pilotes résidents lancés avant le jeu

`ARMAETH.BAT` lance `vga`, `sc0` puis `am1 * a1f`. Le moteur ne parle ni au BIOS vidéo pour dessiner, ni à une carte son : il passe par deux couches.

- **Pilote vidéo (`VGA.EXE`, résident, 16 Ko)** : `gm_find_vga_driver` (`3922:000c`) appelle `INT 16h` avec `AX = 1D5F`, `CX = 00CB` ; le pilote répond en `CX:DX` par un pointeur lointain vers sa table (stocké à `DGROUP:0eb8`, copié en `0eac`). L'octet 0 de la table vaut **2 pour le VGA** (1 pour l'EGA ; le moteur refuse toute autre valeur et choisit « ega » ou « vga » comme extension de fichier). Champs repérés : `+0x02` mode, `+0x0c..0x10` couleurs de texte, `+0x12` largeur (320), `+0x14` hauteur (200), `+0x1a..0x20` fenêtre de dessin. **Tous les blits (et le texte, les rectangles, la palette) passent par les entrées de cette table** (appels `CALLF [BX+n]`) : la routine de dessin n'est pas dans `AM1.EXE` (voir la section « Pilote vidéo `VGA.EXE` »).
- **Son** : `SC0.EXE` et `SC1.EXE` (configuration, `sc0` lance `sc1.exe`) n'ont pas d'interface avec `AM1.EXE`. Le moteur embarque son propre pilote musical (`40f7` code, `406e` données, voir « Son »).

### Interruptions, ports

| Élément | Où | Usage |
|---|---|---|
| `INT 16h` | `3928:0026`, `3580:0004`, `3922:000c` | clavier (AH=0/1) ; `AX=1D5F` : interface du pilote `VGA.EXE` |
| `INT 33h` | `35c8:000c`, `35cd:0006`, `35c0:000a`, `35e8:0008`, `35db:0002`, `3692:000c`, `369c:0002`, `36ad:000e` | souris : AX = 0 (reset), 3 (position + boutons), 7/8 (plages), 4 (position), 2/1 (cacher/montrer), 0Bh (déplacement) ; appelées via `lib_int86` (aucune instruction `INT 33h` dans le code) |
| `INT 10h` | `36b3:000a`, `35a7:003a`, `3855:0000`, `357b:000c/001f/003b`, `3678:000a`, `36d4:0cd5` | BIOS vidéo : AH=0 (mode), 5 (page), 1 (curseur), 0Fh (état), AX=1000h/1001h/1002h (registres de palette EGA), AX=1130h (police) |
| `INT 1Ah` | `35a4:0008` | `gm_delay_ticks` : attente active en tics BIOS (AH=0) |
| `INT 21h` | bibliothèque C | fichiers (3Ch/3Dh/3Eh/3Fh/40h/42h/43h/44h/41h), mémoire (48h/49h/4Ah), vecteurs (25h/35h), lecteur/répertoire (0Eh, 19h, 47h), DTA (1Ah, 2Fh), date/heure (2Ah/2Ch), version (30h), sortie (4Ch) |
| `INT 24h` | `3938:13e8`, gestionnaire `348a:022c` | erreurs critiques DOS, messages de `MSGHRD` |
| `INT 34h-3Dh` | `3dff` | émulateur 8087 |
| `INT 08h` (IRQ0) | `40f7:0214` | ISR du pilote musical à 50 Hz ; PIT : `OUT 43h,34h` puis `OUT 40h` avec le diviseur `0x5D37` |
| Ports `388h/389h`, `330h/331h`, `61h`, `42h/43h`, `21h`, `20h` | module `40f7` | OPL2 (AdLib), MIDI MPU-401, haut-parleur PC, PIT, masque PIC et EOI |
| Ports `3CEh`, `3D4h` | `12c2`, `36d4` (3CEh) ; `23fa` (3D4h) | registres graphiques EGA/VGA (tracé direct en `A000`, modes planaires) ; registres CRTC (hypothèse : curseur/décalage d'écran) |

Aucun accès direct aux registres de palette DAC (`3C8h/3C9h`) ni au retour de balayage (`3DAh`) dans `AM1.EXE` : la palette passe par le pilote et le BIOS.

## Fichiers de données : qui les ouvre, qui les lit

Chaîne d'ouverture : `gm_open_data_file(indice)` (`1e68:024c`) → `gm_build_path_and_open` (`1e68:03e0`) → `gm_open_with_disk_prompt` (`353c:0006`, invite de disque via `MSGHRD`) → `gm_fopen` (`348a:01ae`) → `lib_fopen` (`3938:039c`). Le nom est assemblé à partir du préfixe de langue (`a1f`, 3 lettres, argument 2), d'un nom de 3 lettres tiré de la table `DGROUP:4ed6` (entrées de 4 octets « CFG. »…), et d'une extension tirée de `DGROUP:4f27` (vide = « .vga » ou « .ega » selon le pilote). Les indices :

| Indice | Nom (table `4ed6`) | Extension (table `4f27`) | Fichier réel (version française) |
|---:|---|---|---|
| 0 | CFG | SYS | `A1FCFG.SYS` |
| 1 | DIC | SYS | `A1FDIC.SYS` |
| 2 | CM3 | SYS | `A1FCM3.SYS` |
| 3 | OBJ | (vga) | `A1FOBJ.VGA` |
| 4 | DEC | (vga) | `A1FDEC.VGA` |
| 5 | ANM | (vga) | `A1FANM.VGA` |
| 6 | ANI | SYS | `A1FANI.SYS` |
| 7 | CM1 | SYS | `A1FCM1.SYS` |
| 8 | INT | (vga) | `A1FINT.VGA` |
| 9 | CM2 | SYS | `A1FCM2.SYS` |
| 10 | MIX | SYS | `A1FMIX.SYS` |
| 11 | TMS | SYS | `A1FTMS.SYS` |
| 12 | MSG | SYS | `A1FMSG.SYS` |
| 13, 14 | TMP | SCR | `A1FTMP.SCR` (lecture/écriture, rôle de chaque indice : hypothèse) |
| 15 | DEF | SYS | `A1FDEF.SYS` |
| 16, 17 | TMP | SVG | `A1FTMP.SVG` (16 écrit, 17 relu par `203f:00c8`) |
| 18 | GPH | SYS | `A1FGPH.SYS` |
| 19 | CM4 | SYS | `A1FCM4.SYS` |

Avec l'argument `*` (version CD), l'indicateur `DGROUP:0ebc` vaut 7 et les noms sont cherchés dans le répertoire courant (à plat) ; sinon le chemin vient de la ligne de commande (`!` ou une spécification de lecteur) ou de `A1FINS.SYS` : `gm_build_path_and_open` utilise le lecteur (octet 1, « C ») et `\ARMAETH` (`+0x10`) quand l'octet 0 est nul (cas du fichier fourni), sinon des invites « DISK-n » (disques à insérer). Les sous-répertoires « \sys » et « \vrs\ » (`DGROUP:4f7e`, `4f83`) n'existent probablement que dans cette variante installée (hypothèse). Les fichiers de scènes (`A1F00A.VGA`…) n'ont pas d'indice : `gm_open_scene_file` (`1e68:0322`) calcule « A1F » + chiffre des centaines + lettre `'A' + (id % 100) / 5` + `.vga` (donc cinq scènes par fichier).

| Famille | Fonction qui la lit | Ce qu'elle lit (vérifié) |
|---|---|---|
| Installation (`A1FINS.SYS`) | `gm_init_paths` `1e68:0008` | 236 octets en `DGROUP:4f9a` : octet 0 = type d'installation (nul dans le fichier fourni), octet 1 = lecteur (« C »), **`\ARMAETH` à `+0x10`** (confirme formats.md) |
| Monde (`CFG`, `SVG001.STD`, `TMP.SVG`) | `gm_load_world` `192e:0008` (écriture : `gm_save_world` `1d4a:0002`) ; initial via `gm_savegame_slot` `2052:000c` | voir « Format du monde » ci-dessous |
| `DEF` | `gm_def_lookup` `10b3:0006` | 4 mots (30, 20, 92, 47 = nombres de ressources INT, DEC, OBJ, ANM) puis enregistrements de **28 octets** ; recherche par (famille, identifiant) ; contrôle : 8 + 28 × 189 = 5 300 |
| Sprites (`OBJ`, `DEC`, `ANM`, `INT`) | `gm_load_sprite_resource` `1735:000e` | `u16 n` puis n entrées `{id u16, offset u32, taille u32}` ; la ressource (famille Typ 0 → INT, 1 → DEC, 2 → OBJ, animé → ANM) est lue en blocs de 0x800 ; en-tête de 32 octets : `u16 id, n1, n2, n3, longueur des pixels, 0`, puis 20 octets de pointeurs mémoire (inutiles dans le fichier), table de `n1` offsets de 4 octets à `+0x20`, `n2` enregistrements de 12 octets (animation), `n3` mots ; la longueur des pixels est vérifiée (`INT` id 1 : 0x20 + 24 + 36 + 22 + 607 = 721) |
| `ANI` | `gm_load_ani` `16f5:000e` | `u16 n1, u16 n2`, `n1` enregistrements de 12 octets, `n2` mots ; contrôle : 4 + 12 × 47 + 2 × 147 = 862 |
| Scènes (`A1F00A.VGA`…) | `gm_load_scene` `1cc3:000e` | table de 5 emplacements de 10 octets `{id, offset, taille}` (offsets absolus), puis dans la ressource : en-tête de **0x30 octets**, enregistrements de 16 octets (grille de marche 81 × 21 cases par plan), 40 mots, **images de fond** (décodeur `1f94:0008`, voir « Pixels des scènes »), puis des enregistrements de 10 octets (points sensibles à message) et de 20 octets (décors de type 1) ; voir `engine.md` § 5.2 et § 5.3 |
| Textes (`TMS` + `MSG`) | `gm_load_tms` `2013:0000`, `gm_get_message` `2013:00ec` | index : `u16 n`, `u16 longueur max`, `n` entrées de 6 octets `{clé u16, offset u32}` ; texte lu entre deux offsets consécutifs puis **NOT** de chaque octet ; clé = `classe*1000 + numéro`, classe = lettre − 0x40 (A = 1) ou valeur + 0x1E |
| Dictionnaire (`DIC`) | `gm_load_dic` `1dd4:002a` | `u16 n`, `n` enregistrements de 18 octets `{code u16, mot 16 octets}` ; mots inversés (NOT) en bloc ; recherche : `gm_dic_lookup` `1dd4:0156` |
| Messages clairs (`MSGINT`, `MSGHRD`) | `gm_load_text_table` `351f:0002` | texte : 1re ligne = nombre de chaînes, puis une chaîne par ligne ; `MSGINT` via `2065:000a`, `MSGHRD` via `356b:000e` (messages d'erreurs matérielles et de disque, INT 24h). **`MSGUTL` n'est référencé nulle part dans `AM1.EXE`** |
| Scripts d'intro et conseils (`CM1`-`CM4`) | `gm_cm_script_step` `1346:0004` | suite d'enregistrements `{5 mots, n mots, L octets XOR 0xBB}` : mot 3 = n (≤ 16), mot 4 = L (≤ 0x7FF), mot 1 = type d'enregistrement (valeurs 1, 4, 5, 7, 10 observées, sens non établi) ; chaque fichier se découpe exactement à sa taille (72, 2 137, 80, 1 079) |
| Sons (`MIX`) | `gm_load_mix` `3024:0002` (données : `gm_sound_play` `2f33:000e`) | 4 mots (68, 55, 4 666, 2 122), 68 enregistrements de 8 octets, 55 de 42 octets ; les deux derniers mots dimensionnent deux tampons de données |
| Police (`GPH`) | `gm_load_gph` `325a:0002` | `u16` largeur de cellule (5), `u16` hauteur (7), `u16` taille des données (718), **256 mots d'offsets**, puis les octets de glyphes ; contrôle : 6 + 512 + 718 = 1 236 |
| Sauvegardes temporaires | `gm_write_tmp_scr`/`gm_read_tmp_scr` `1664`, `gm_snapshot_world` `203f:00c8` | `TMP.SCR` (indices 13/14) et `TMP.SVG` (16/17) ; `TMP.SCR` : hypothèse (état de salle) |
| Aide (`A1FSOS.SYS`) | non lu par `AM1.EXE` | fichier de `SOS.EXE` (voir « Autres exécutables ») |

### Format du monde (`A1FCFG.SYS`, `SVG001.STD`, `A1FTMP.SVG`)

Confirmé par la lecture (`192e:0008`) **et par le calcul sur `A1FCFG.SYS`** (total exact : 21 868 octets) :

1. **En-tête de 0x36 = 54 octets**, mots : `0x786B`, `0x00CA` (signature), dernier numéro de série d'objet (213), 1 800, chapitre × 100 + niveau (`4b4e`, 3), …, score (`4b5a`, mot 10), …, **numéro de série (Ser) de l'objet héros** (`DGROUP:4b5c` = 158), **identifiant de la salle courante** (1), **nombre d'objets (132)**, **nombre de salles (60)**.
2. `u16 n` (1..100, erreur 0xC7 sinon) puis **n enregistrements de 8 octets** (n = 35) : **table de score** `{id, points, son, répétitions}`, `DGROUP:5218` (corrigé d'après `engine.md` § 9.3 : ce ne sont pas des zones ; somme des valeurs absolues = 725).
3. `u16 a, u16 b` puis `b` enregistrements de 12 octets (`a = b = 0` dans `CFG`) : **file d'événements différés**, `DGROUP:523a` (`engine.md` § 9.3).
4. **60 enregistrements de 42 octets (salles)** à partir de l'offset 0x154 (dans formats.md : « 59 à 0x17E » ; l'enregistrement de la salle 0 les précède) jusqu'à 0xB2C = 2 860 ; les mots `+0x22`/`+0x24` et `+0x26`/`+0x28` de chaque salle (têtes de deux listes d'objets) sont remis à zéro puis recalculés pendant la lecture des objets.
5. **132 enregistrements d'objet de 144 octets (0x90)** jusqu'à la fin ; 2 860 + 132 × 144 = 21 868. L'octet à `+0x5B` (Cod) dit où l'objet se trouve : 1 = dans une salle (le pointeur en `+0x5C` désigne la salle), 2 = dans un autre objet, 3 = objet d'interface rattaché à la salle d'indice 0, 4 = valeur transitoire de création (`engine.md` § 6.1).

`gm_save_world` écrit le même format. `A1FTMP.SVG` (22 444 octets) est un autre instantané du même format.

### Enregistrement d'objet (144 octets)

> Table complète et à jour : `engine.md` § 6.1 (source : `gm_dump_object`). Ce tableau reste valable pour les noms mais `+0x66 Sal` est un mot (non lu) et les tailles `Rep` (+0x4B, octet) et `Dir` (+0x48) y sont celles de `engine.md`.

Déduit de la fenêtre de débogage `gm_dump_object` (`1265:0008`, chaînes « Num Ser Adr Typ Gst Mob… » en `DGROUP:00F2..03AF`) et des gestionnaires de jetons. Offsets en octets ; certains libellés se répètent dans le dump (variantes suffixées) ; la taille des champs vient du cast du décompilat (octet ou mot), donc approximative.

| Offset | Libellé | Remarque |
|---|---|---|
| +0x00 | Num | identifiant (u16) |
| +0x02 | Ser | numéro de série (u16, `++DGROUP:4b4a` à la création) |
| +0x04, +0x05, +0x06, +0x07, +0x08 | Typ, Gst, Mob, Dep, Txt | octets ; `Typ` choisit le fichier sprite (0 INT, 1 DEC, 2 OBJ) ; jetons `ego/fig/txt/dep/mob/gst` écrivent +0x2D, +0x2E, +0x08, +0x07, +0x06, +0x05 |
| +0x0A, +0x0C | Lum, Ftn | mots |
| +0x18, +0x1A, +0x1C | Val, Pds, Chg | mots |
| +0x1E, +0x1F | Ram, Ctn | octets |
| +0x20..+0x23 | Mc1..Mc4 | octets (liés aux scripts CM) |
| +0x2C, +0x2D, +0x2E, +0x2F | Set, Ego (**état** de l'objet, `engine.md` § 6.1), Fig, Inv (**caché / invisible**) | octets |
| +0x30 | Anm | mot : identifiant de ressource d'animation (`ANM`) |
| +0x32, +0x34, +0x36, +0x38, +0x3A, +0x3C | Tim, Rep, Nbr, Sys, Bag, Col | mots (`tim` écrit +0x32/+0x34) |
| +0x3E, +0x3F, +0x40, +0x41, +0x42 | Err, Inf, Ctl, lb0, lb1 | |
| +0x44..+0x4D | Inv (2e : **miroir**), dpX +0x45, dpY +0x46, dpP +0x47, Dir +0x48, Tot +0x49, Ind +0x4A, Rep +0x4B, Hau +0x4C, Lar +0x4D | `dpx`/`dpy` écrivent +0x45/+0x46 |
| +0x4E | Des | pointeur lointain |
| +0x52..+0x5A | Xyp, N +0x53, X +0x54, Y +0x56, P +0x58, Sol +0x5A | position |
| +0x5B, +0x5C | Cod, Num (pointeur lointain) | pointeur vers un identifiant |
| +0x60..+0x66 | Hor, Ver, Prf, Mod, Inv, Dir, Sal | octets signés |
| +0x68, +0x6C, +0x6E | Chm (pointeur lointain), Nbc, Def | chemin |
| +0x6F, +0x70, +0x72, +0x74, +0x76, +0x77, +0x78, +0x7A | Nc, Xc, Yc, Pc, X1, X2, Cib, Ser | cible et déplacement |
| +0x7C, +0x80, +0x84 | Pos, Lis, Nxt | pointeurs lointains : `Lis` (+0x80) chaîne les objets d'une salle (tête dans la salle à +0x22), `Nxt` (+0x84) la liste globale (tête `DGROUP:4c0e`) |
| +0x88 | Anm | pointeur lointain vers la ressource sprite chargée |
| +0x8C | Fct | pointeur lointain vers la **procédure de comportement** de l'objet (`1218:000a`, jeton `fct`) |

### Pixels des scènes (décompression) : **trouvée**

C'est le premier point ouvert de formats.md. La décompression est dans `AM1.EXE`, et **vérifiée par décodage sur les fichiers** (voir plus bas).

`gm_decode_scene_image` (`1f94:0008`, appelée deux fois par `gm_load_scene` : couche de fond puis couche de premier plan) lit :

1. **un octet de type** : 0 = codec A, 1 = codec A suivi d'une recoloration par la table de 256 octets `DGROUP:5312`, 2 = codec B (recoloration `DGROUP:5412`) ;
2. pour chaque ligne : un entier `n` (somme d'octets tant qu'ils valent 0xFF, plafonné à 100 ; **vaut 1 sur presque toutes les lignes**), un entier `m` (même codage, longueur compressée, < 0x400), puis `m` octets compressés ;
3. la ligne décodée doit faire exactement la largeur (320 octets, sinon erreur 10).

`n > 1` n'est pas élucidé : sur `A1F00A.VGA` (scène 2, couche de type 2), la ligne 125 a `n = 2` et ne se décode qu'en 214 octets sur 320 (une ligne noire visible dans l'image). À étudier avant le port.

**Codec A** (`34bb:0008`, 311 octets) : le flux est une suite de paquets `00 k <k octets littéraux>` ou `c v` (`c` ≠ 0 : répéter `v` `c` fois) jusqu'à épuisement des `m` octets. **Codec B** (`34bb:0142`, 454 octets) : même enveloppe, mais le paquet non nul est `c base <⌈c/2⌉ octets>` : chaque octet donne deux pixels `base + (b >> 4)` puis `base + (b & 15)` (le dernier est ignoré si `c` est impair). Le résultat est écrit ligne par ligne dans le tampon d'écran 320 × 200 (`DGROUP:0ee0`), avec un masque : un pixel de fond n'est remplacé que si la valeur déjà présente est < 200.

Vérification (script jetable, hors dépôt) : `A1F00A.VGA` scène 0 (id 0) : 200 lignes de 320 octets de type 0 qui se terminent exactement à la fin de la ressource (23 181 octets) ; l'image est le cadre de l'interface. Scène 2 : une couche de type 2 (décor complet : cabane, arbre, lac) à l'offset 2 528, une couche de type 0 (premier plan masqué) à 49 335, 180 lignes chacune, et la couche de type 0 se termine 400 octets avant la fin (tables de 10 et 20 octets). Les scènes du chapitre 0 (sauf 3 et 7) se décodent ainsi ; **non vérifié pour les chapitres 1 à 3** (un balayage de 100 lignes et plus à 320 octets n'y trouve rien : hauteur, largeur ou `n` différents), et **le type 1 n'a pas été rencontré**.

**Palette** : table de 774 octets en `DGROUP:5512` = **offset 246 402 du fichier** (confirme l'hypothèse de formats.md), 256 entrées VGA de 3 octets sur 6 bits (valeurs 0..63) plus 6 octets ; `gm_init_video` la passe au pilote (entrée `+0x4a`) et trois octets de `DGROUP:5818..581a` à l'entrée `+0x72`. Avec cette palette (valeurs × 4), l'image de la scène 0 est correcte.

## Pilote vidéo `VGA.EXE`

`VGA.EXE` (16 717 octets, MZ, un seul segment de code, startup Microsoft C petit modèle mais **cœur écrit en assembleur** : les routines de dessin sont des `RETF` lointains qui adressent leurs variables par `CS:`) est analysé par le même `run.sh` que `AM1.EXE` ; sorties dans `archives/armaeth/re/vga/` (mêmes fichiers : `decomp/`, `functions.tsv`, `strings.tsv`, `libfuncs.tsv`, `keyfuncs.tsv`, `disasm.txt`, `project/` = projet Ghidra `armaeth-vga`). Tables de noms : `scripts/armaeth/re/vga-keyfuncs.def.tsv` et `vga-libs.def.tsv`. Les adresses sont celles de Ghidra (`1000:off` = décalage dans l'image, qui se charge à `CS:0000`) ; `offset_fichier = 0x200 + off` (en-tête de 512 octets).

<!-- GEN:vgastats -->
- Durée de la dernière régénération du pilote : 7 s.
- Fonctions : 91 (fragment 5, func 85, lib 1), 11008 octets ; 36 nommées (`vga_*`), décompilation : erreur 2, ok 84, partielle 5.
- Image : 16717 octets ; un seul segment de code (`1000` en chargement Ghidra), DGROUP = segment `12f5`.
<!-- /GEN:vgastats -->

### Installation résidente (TSR) et interruptions

`vga_main` (`1000:0000`) : (1) `vga_detect_adapter` exige un VGA couleur (sinon retour 1 sans rien dire) ; (2) `vga_probe_b000` passe en mode 13h, ouvre `B000` en RAM vidéo (registre graphique 6 du VGA) et vérifie 64 000 octets : si cela marche, **le tampon d'arrière-plan est `B000:0000`**, sinon il est alloué (0xFA20 octets) ; (3) `vga_init_state` fixe le type 2 (VGA) et le mode 13h ; (4) `vga_is_installed` refuse une seconde installation ; (5) `vga_tsr_install` (`1000:1914`) redirige les vecteurs puis `INT 21h AH=31h` (garde tout le bloc mémoire du programme, pile privée de `0x3c0` octets comprise).

- **`INT 16h`** (`vga_int16_handler`, `1000:1a31`) : si `AX = 1D5F`, sous-fonction par `CX` ; sinon chaîne vers l'ancien vecteur. Ce n'est **pas** un canal d'appel des routines : il ne sert qu'à trouver le pilote.

| `AX` | `CX` | Effet | Retour |
|---|---|---|---|
| `1D5F` | `00CA` | `BL` → drapeau de chaînage de l'`INT 61h` (CS:14B6) | `AX = 0` |
| `1D5F` | `00CB` | **adresse du pilote** | `AX = 0`, `BX = 0`, `CX` = `0150`, `DX` = segment du pilote (bloc ci-dessous) |
| `1D5F` | `00CC` | désinstallation (restaure les vecteurs 16h/61h, libère les blocs si le pilote est le dernier à les avoir pris) | `AX = 0`, ou `FFFE` si un autre résident s'est interposé |
| `1D5F` | autre | test de présence | `AX = 5345h` (« ES ») |

- **`INT 61h`** (`vga_int61_handler`, `1000:1b07`) : coquille d'un canal d'appel générique (pile privée, `INT 1Bh/23h/24h` neutralisés, `CALLF [CS:1498]`) dont la routine (`1000:00DA`) est vide. `AM1.EXE` n'émet aucun `INT 61h` : **toutes les fonctions passent par la table**. Hypothèse sur l'origine : squelette d'un pilote commun à plusieurs jeux.
- `INT 23h` et `INT 24h` sont aussi redirigés (le second renvoie « échec »). Pas d'`INT 10h` pendant le jeu : le pilote écrit directement dans `A000`, le DAC (`3C8h/3C9h`) et le contrôleur d'attributs (`3C0h`).

### Structures du pilote

**Bloc de liaison** (`CS:0150`, 24 octets, nul dans le fichier) : `+0x00` pointeur lointain vers la table (écrit par `vga_init_block` en `+0x14`, qui met `046E:CS`), `+0x14` pointeur lointain vers `vga_init_block`. `AM1.EXE` conserve ce bloc en `DGROUP:0eb8`, lit `[+0]` pour obtenir la table (`DGROUP:0eac`) et le restaure après l'avoir effacé (`gm_script_group0`, `gm_script_group10` : `CALLF [BX+0x14]`). **Non élucidé** : rien dans `VGA.EXE` n'appelle `vga_init_block` avant le premier jeu de commandes ; l'ordre d'initialisation ne se lit donc que côté moteur (hypothèse : un script `CM` au démarrage, appelé par `gm_cm_script_step(0)` avant la lecture du pointeur).

**Table** (`CS:046E`, `byte 0 = 2` pour le VGA), champs repérés : `+0x02` mode (13h), `+0x04` nombre de couleurs (256, écrit en `CS:0472`), `+0x0c/+0x0e/+0x10` couleurs de texte, `+0x12` largeur 320, `+0x14` hauteur 200, `+0x16/+0x18` colonnes et lignes de texte (40 x 25), `+0x1a/+0x1c` fenêtre de dessin (320 x 200), `+0x1e/+0x20` décalage de défilement ajouté aux positions des sprites dont l'argument `flags & 7` est non nul (hypothèse). **Pages** : `CS:04E4..04EA` = segments des pages 0 à 3 (0 et 1 = `A000`, 2 et 3 = tampon d'arrière-plan `CS:04EC`) ; chaque ligne d'une page occupe 20 paragraphes (`CS:04F8`) : le code adresse les lignes en changeant de **segment** et les colonnes par l'offset. Un second plan de même taille (plan de priorité, `CS:0504`) est fourni par le moteur.

**Entrées** : 19 pointeurs lointains en `+0x2a..+0x72` (pas de 4 octets, `+0x76` nul). Convention : appel lointain à la C (`cdecl`, arguments sur la pile à partir de `BP+6`, l'appelant nettoie), registres sauvegardés, `AX` = code de retour. `AM1.EXE` les appelle en ligne (`LES BX,[0eac]` puis `CALLF ES:[BX+n]`) ; il n'a **pas d'enveloppe commune** : la seule enveloppe est `gm_find_vga_driver` (`3922:000c`, `INT 16h`).

| Entrée | Adresse | Nom | Arguments (ordre de la pile : premier = `BP+6`) | Rôle | Appelants dans AM1 | Confiance |
|---|---|---|---|---|---|---|
| `+0x2a` | `1000:10ee` | `vga_present` | aucun | recopie dans `A000` les rectangles modifiés (ou tout l'écran si `CS:0530` non nul) | `gm_draw_line`, `gm_script_group10` | probable |
| `+0x2e` | `1000:0e1a` (+ `0edc`) | `vga_sprite_hit` | objet (far), drapeaux | recouvrement pixel à pixel d'un sprite avec le plan de priorité ; `AX` = 0 / 7 / `FFFF` | `1b11:128e`, `1c96:02b9` (déplacements) | probable |
| `+0x32` | `1000:06b6` | `vga_copy_rect` | page source, page destination, x, y, lignes, largeur (octets) | copie un rectangle de même position d'une page à une autre | `gm_draw_line`, `gm_dump_object`, `gm_write_tmp_scr`, `gm_read_tmp_scr`, `FUN_1140_000a`, `FUN_1e22_017b`, `FUN_327a_05e2` | certain |
| `+0x36` | `1000:0722` | `vga_draw_sprite` | objet (far), drapeaux (word) | **blit de sprite** (voir plus bas) | `gm_main_loop`, `FUN_18a9_067c` | certain |
| `+0x3a` | `1000:0aa7` | `vga_wait_vsync_present` | aucun | attend le retour vertical, présente (`10ee`), annule les sprites dynamiques (`0ac9`) | `gm_main_loop` | certain |
| `+0x3e` | `1000:09f2` | `vga_write_rect` | source (far), page, x, y, largeur, hauteur | mémoire vers page | `gm_decode_scene_image`, `gm_read_tmp_scr` | certain |
| `+0x42` | `1000:0a50` | `vga_read_rect` | destination (far), page, x, y, largeur, hauteur | page vers mémoire | `gm_decode_scene_image`, `gm_write_tmp_scr` | certain |
| `+0x46` | `1000:0c24` | `vga_set_mode` | mode (13h) | initialise la table et les pages, efface `A000` et le tampon | `gm_init_video` | certain |
| `+0x4a` | `1000:0ccd` | `vga_set_palette` | palette 256 x 3 (far, 6 bits), dR, dG, dB (bornés à -63..63) | charge le DAC ; le décalage agit sur les 216 premières couleurs ; bordure = index 0xDD | `gm_init_video`, `gm_main_loop` (fondus), `gm_script_group1`, `FUN_1611_0164` | certain |
| `+0x4e` | `1000:062d` | `vga_set_depth_buffer` | tampon (far), pointeur de sortie (far), hauteur, largeur | déclare le plan de priorité 320 x 200 (aligné au paragraphe) | `gm_init_engine` | certain |
| `+0x52` | `1000:067c` | `vga_set_undo_pool` | tampon (far), pointeur de sortie (far), taille | déclare la zone des fonds sauvegardés, puis `0b63` | `gm_snapshot_alloc` | certain |
| `+0x56` | `1000:0ac8` | `vga_nop` | - | ne fait rien (`RETF`) | `gm_main_loop` | certain |
| `+0x5a` | `1000:0b12` | `vga_undo_all` | aucun | annule tous les sprites (listes dynamique et fixe) et force la recopie complète | `gm_script_group10`, `gm_read_tmp_scr`, `FUN_18a9_067c` | certain |
| `+0x5e` | `1000:0fae` | `vga_wait_retrace` | aucun | attend un retour vertical complet | (aucun appel repéré) | certain |
| `+0x62` | `1000:0fa8` | `vga_undo_all_thunk` | aucun | alias de `+0x5a` | `gm_load_scene` | certain |
| `+0x66` | `1000:0b63` | `vga_layout_undo_pool` | aucun | redécoupe la zone de sauvegarde (code 7 si trop petite) | `gm_draw_line`, `FUN_133e_0006`, `gm_script_group10`, `gm_main_loop`, `gm_snapshot_alloc` | probable |
| `+0x6a` | `1000:1206` | `vga_draw_rect` | x, y, largeur, hauteur, couleur du cadre, remplissage (octet bas ; octet haut non nul = creux) | rectangle direct dans `A000` | 16 appels (`FUN_1140_*`, `gm_draw_line`, `gm_write_tmp_scr`, `FUN_1e14_0000`, `FUN_1e22_*`, `FUN_1f29_0454`) | certain |
| `+0x6e` | `1000:12a0` | `vga_draw_text` | x, y, chaîne (far), table code-glyphe (far), données de glyphes (far), pas, couleur 1, couleur 2 | texte en police à bits, direct dans `A000`, ombre à droite | `FUN_1e14_0000` | probable |
| `+0x72` | `1000:0dbd` | `vga_set_text_colors` | r, g, b (octets) | couleurs de texte de la table | `gm_script_group4`, `gm_init_video` | certain |

Remarque : l'ancienne lecture « `+0x32` = texte/glyphe » et « `+0x6a/+0x6e` = blit » était fausse : le texte est `+0x6e`, `+0x32` copie des rectangles, `+0x6a` trace des cadres, et le blit de sprite est **`+0x36`**.

#### Blit de sprite (`+0x36`, `1000:0722`) : lu dans le code (certain)

- **Entrée** : pointeur lointain vers l'enregistrement d'objet de 144 octets (voir plus haut) et un mot de drapeaux. Champs lus : `+0x4c` hauteur `H`, `+0x4d` largeur `W`, `+0x4e` pointeur vers la trame (`[H][W]` puis `W x H` pixels **en colonnes**, les deux premiers octets sont sautés), `+0x54` x (**centre** du sprite : `x - W/2`), `+0x56` y (**bas** du sprite : le haut est `y - H + 1`), `+0x58` priorité, `+0x44` miroir (> 0 : horizontal), `+0x2f` octet « caché » (`Inv`), `+0x06` type de liste. Si `flags & 7` est non nul, le décalage `CS:048C/048E` est ajouté à x/y.
- **Transparence** : l'octet `0xFF` n'est jamais écrit.
- **Rognage** : à la fenêtre `0..320 x 0..200` (`CS:04FC/04FE`) ; les colonnes et lignes hors fenêtre sont sautées côté gauche, droit, haut et bas (compteurs `CS:055A..0560`) ; sprite entièrement dehors : retour `AX = 3`, rien n'est dessiné.
- **Miroir** : lu horizontalement (colonne de départ `W - 1 - rognage_gauche`, puis colonnes en sens inverse). **Pas de miroir vertical.**
- **Priorité (z-buffer)** : un second plan 320 x 200 mémorise la priorité du pixel ; un pixel opaque n'est écrit que si la priorité mémorisée est **inférieure ou égale** à celle de l'objet (`CMP ES:[DI],CL ; JA` saute), et l'écriture met à jour le plan de priorité. Si l'octet `+0x2f` est non nul, la couleur écrite est `couleur_du_fond + (+0x2f)` (décalage d'index de palette) au lieu du pixel du sprite. **Réconciliation** (probable, `engine.md` § 6.4) : `+0x2f` est l'indicateur « caché / invisible » du moteur (le héros invisible a `+0x2f = 7`) ; le pilote le rend en effet de transparence / miroitement du décor, l'objet n'est pas supprimé du dessin.
- **Double tampon logiciel** : le sprite est dessiné dans le **tampon d'arrière-plan** (page 2/3), jamais dans `A000`. Avant de dessiner, le rectangle de fond (et du plan de priorité) est sauvegardé dans deux piles d'annulation (`vga_save_rect`, enregistrements de 10 octets ; codes de retour 1 = pile pleine, 2 = zone pleine). Les objets dont l'octet `+6` est non nul sont comptés dans la liste dynamique (`CS:052C`, annulée à chaque image par `vga_restore_dynamic`), les autres dans la liste fixe (`CS:052E`, annulée par `+0x5a`). `vga_present` (`+0x2a`) recopie ensuite **uniquement les rectangles touchés** dans `A000`, pendant le retour vertical (`+0x3a`). Il n'y a pas de bascule de page matérielle (pas de décalage de l'adresse de départ CRTC).
- **Retours** : 0 réussi ; 1 pile d'enregistrements pleine, 2 zone de pixels pleine (le pilote annule alors tout avant de rendre la main ; `gm_main_loop` traite 1 en rejouant l'image, 2 en positionnant `DGROUP:0e4c` à 7) ; 3 sprite hors fenêtre (`gm_main_loop` l'envoie à `gm_abort(2)` : il n'appelle le blit que pour des objets visibles) ; autre : `gm_abort(3)`.

**Confiance** : certain pour les sous-fonctions marquées ainsi (code lu en entier, effets sur les ports ou les registres vérifiés) ; probable pour `+0x2a`, `+0x2e`, `+0x66`, `+0x6e` (rôle et arguments déduits du code mais jamais recoupés avec une image produite) ; hypothèse pour le rôle de `+0x1e/+0x20` et le champ `+0x2f` (nommé « Inv » dans la fenêtre de débogage d'`AM1.EXE`, utilisé ici comme teinte).

<!-- GEN:vgafuncs -->
#### Installation résidente (TSR)

| Adresse | Nom | Octets | Rôle | Preuve | Confiance |
|---|---|---:|---|---|---|
| `1000:0000` | `vga_main` | 216 | main(argc) : exige un VGA couleur, teste B000 comme RAM vidéo, alloue sinon 0xFA20 octets, initialise le mode 13h, refuse une double installation, puis se rend résident (INT 61h + INT 16h) | Appelée par le startup (1000:1dae) ; appelle 1359, 0570, 21d8 (alloc), 05dc, 143c, 1914 avec 0x61, 0x1d5f, 0x150 ; erreurs « * SYS 00n * » via 00e2 | certain |
| `1000:00e2` | `vga_fatal_error` | 109 | Affiche « \r\n* SYS 00n * » (n = code, 3 chiffres) caractère par caractère puis quitte (1f73) | Chaîne DGROUP:0046 ; codes 1 (mémoire), 4 (installation impossible) passés par main | certain |
| `1000:0570` | `vga_probe_b000` | 108 | Mode 13h, ouvre B000 en RAM vidéo (GC reg 6 &= F3), écrit 0x7D00 mots, efface A000, relit à rebours ; renvoie dans CS:04EE le nombre de mots non vérifiés (0 = B000:0 utilisable comme tampon d'arrière-plan) | Séquence OUT 3CEh/3CFh, boucle STOSW/LODSW dans le code ; main teste le résultat pour choisir B000:0000 ou l'allocation | certain |
| `1000:05dc` | `vga_init_state` | 81 | Initialise l'état du pilote : segment du tampon d'arrière-plan (CS:04EC, aligné au paragraphe), type 2 (VGA) en CS:046E, 256 couleurs en CS:0472, puis appelle le réglage de mode 13h | Écritures CS:046E=2, CS:0472=0x100, CS:0470=0x13 ; appel de 0c24 | certain |
| `1000:1359` | `vga_detect_adapter` | 163 | Détecte l'adaptateur (INT 10h AX=1A00h, AH=12h BL=10h, INT 11h) ; renvoie un masque dont les bits 0x11 = VGA couleur ; main refuse sinon | INT 10h/1Ah, 12h/10h, port 3BAh, INT 11h ; test AND 0x11 == 0x11 dans main | probable |
| `1000:143c` | `vga_is_installed` | 55 | Appelle INT 16h avec AX=1D5F et CX non reconnu ; renvoie 1 si le résultat est la signature 0x5345 (« ES ») : pilote déjà résident | Compare à DGROUP:0E40 = 0x5345 = valeur renvoyée par le gestionnaire pour tout CX inconnu | certain |
| `1000:1914` | `vga_tsr_install` | 285 | Installe le résident : mémorise les paramètres (n° d'interruption 61h, routine 00DA, signature AX=1D5F, valeur de retour, bloc 0150), sauve puis redirige INT 16h (1A31), INT 61h (1B07) et INT 23h, copie les vecteurs 34h-3Dh, puis INT 21h AH=31h (garde le programme entier) | INT 21h AX=3516/3523/2516/2523/25xx ; AX=3100h avec DX = taille du bloc MCB ; arguments empilés par main | certain |

#### Gestionnaires d'interruption

| Adresse | Nom | Octets | Rôle | Preuve | Confiance |
|---|---|---:|---|---|---|
| `1000:1a31` | `vga_int16_handler` | 214 | Gestionnaire INT 16h : si AX = 1D5F, sous-fonction selon CX (CAh = drapeau de chaînage, CBh = renvoie le bloc en CX:DX, CCh = désinstallation, autre = AX 5345h) ; sinon chaîne vers l'ancien INT 16h | CMP CX,0xCA/0xCB/0xCC ; JMPF CS:[1484] pour le chaînage ; CX:DX = CS:[149C]:[149E] = 0150:CS | certain |
| `1000:1b07` | `vga_int61_handler` | 395 | Gestionnaire INT 61h : bascule sur une pile privée, neutralise INT 1Bh/23h/24h, appelle la routine 00DA (coquille vide : charge DS puis RETF), restaure et IRET ; aucune des routines du pilote n'est exposée par ce canal | Séquence PUSHF/CMP [14B5]/CALLF [1498] avec 1498 = 1000:00DA ; AM1 n'émet aucun INT 61h | probable |
| `1000:1d8e` | `vga_int24_handler` | 32 | Gestionnaire INT 24h (erreur critique) installé pendant INT 61h : note l'erreur et renvoie AL = 3 (échec) ou 0 selon la version de DOS | IRET avec AL = 3 si [14B4] = 1 (DOS >= 3) | probable |

#### Table du pilote (appelée par AM1 via CALLF [table+n])

| Adresse | Nom | Octets | Rôle | Preuve | Confiance |
|---|---|---:|---|---|---|
| `1000:062d` | `vga_set_depth_buffer` | 79 | Entrée +0x4e : enregistre le plan de priorité (tampon lointain aligné au paragraphe, renvoyé par pointeur), sa hauteur, sa largeur et le pas de ligne en paragraphes (largeur / 16) | AM1 passe (tampon alloué 0xFA20, pointeur de sortie, 200, 320) ; écrit CS:0504, 04FC, 04FE, 0500 | certain |
| `1000:067c` | `vga_set_undo_pool` | 58 | Entrée +0x52 : enregistre la zone mémoire (tampon lointain aligné, taille) où les rectangles de fond sont sauvegardés, puis découpe la zone (0b63) | Écrit CS:0506/0508 ; appel de 0b63 ; appelée par gm_snapshot_alloc | certain |
| `1000:06b6` | `vga_copy_rect` | 108 | Entrée +0x32 : copie un rectangle de même position d'une page vers une autre (page source, page destination, x, y, lignes, largeur en octets) ; chaque ligne est dans son propre segment | Arguments lus en BP+6..10 ; MOVSW par ligne avec avance de CS:[04F8] paragraphes ; table de segments de pages CS:04E4 | certain |
| `1000:0722` | `vga_draw_sprite` | 720 | Entrée +0x36 : dessine le sprite d'un enregistrement d'objet dans le tampon d'arrière-plan avec rognage, transparence 0xFF, miroir, test de priorité et teinte ; sauve le fond dans les piles d'annulation | Lit +0x44 (miroir), +0x4C/+0x4D (hauteur/largeur), +0x4E (données), +0x54/+0x56 (position), +0x58 (priorité), +0x2F (teinte) de l'objet ; CMP AL,0xFF ; JA sur le plan de priorité | certain |
| `1000:09f2` | `vga_write_rect` | 94 | Entrée +0x3e : écrit dans une page un rectangle lu en mémoire ordinaire (source lointaine, page, x, y, largeur, hauteur ; lignes consécutives en mots) | Arguments BP+6..0x12 ; MOVSW ES:DI,SI par ligne vers le segment de la page | certain |
| `1000:0a50` | `vga_read_rect` | 87 | Entrée +0x42 : lit un rectangle d'une page vers la mémoire ordinaire (destination lointaine, page, x, y, largeur, hauteur) | Même structure que 09f2 avec les rôles DS/ES inversés | certain |
| `1000:0aa7` | `vga_wait_vsync_present` | 33 | Entrée +0x3a : attend le début du retour vertical (port 3DAh bit 3), recopie les rectangles modifiés à l'écran (10ee) puis restaure les fonds de la liste dynamique (0ac9) | IN AL,DX / AND 8 / JZ ; appels 10ee puis 0ac9 | certain |
| `1000:0ac8` | `vga_nop` | 1 | Entrée +0x56 : RETF seul (aucun effet) | Un seul octet CBh | certain |
| `1000:0b12` | `vga_undo_all` | 81 | Entrée +0x5a : restaure les fonds sauvegardés des deux listes (dynamique 0ac9 et fixe), remet les compteurs à zéro et réarme la recopie complète de l'écran (CS:0530 = 7) | Appels 0ac9, 1074 sur la pile fixe, 0b63 ; CS:052E = 0, CS:0530 = 7 | certain |
| `1000:0b63` | `vga_layout_undo_pool` | 193 | Entrée +0x66 : répartit la zone de sauvegarde en six régions (piles de rectangles et de pixels pour le tampon d'arrière-plan, le plan de priorité et la liste de l'image précédente) selon les compteurs de sprites ; renvoie 7 si la zone est trop petite | Écritures CS:050A..0526 ; arithmétique x10 octets par enregistrement ; MOV AX,7 si dépassement | probable |
| `1000:0c24` | `vga_set_mode` | 169 | Entrée +0x46 : (ré)initialise la table (mode 13h, 320x200, 40x25 caractères), pages 0 et 1 = A000, pages 2 et 3 = tampon d'arrière-plan, pas de 20 paragraphes par ligne, et efface A000 et le tampon | Écritures CS:0470=13h, 0480=140h, 0482=C8h, 0484=28h, 0486=19h, 04E4..04EA, 04F8=14h ; STOSW x 7D00 deux fois | certain |
| `1000:0ccd` | `vga_set_palette` | 240 | Entrée +0x4a : prend une palette VGA de 256 entrées (6 bits, pointeur lointain) et trois décalages R, G, B bornés à -63..63 appliqués aux 216 premières entrées (les 40 dernières sont copiées telles quelles), fixe la couleur de bordure à l'index 0xDD, envoie le tout au DAC (3C8h/3C9h) | Bornage 0..3Fh, 0xD8 entrées triplées puis 0x3C mots ; OUT 3C0h index 11h valeur DDh ; 768 OUT 3C9h | certain |
| `1000:0dbd` | `vga_set_text_colors` | 30 | Entrée +0x72 : enregistre trois couleurs de texte dans la table (+0x0c, +0x0e, +0x10) | Écrit CS:047A, 047C, 047E | certain |
| `1000:0e0b` | `vga_init_block` | 15 | Entrée +0x14 du bloc 0150 : écrit dans CS:0150 le pointeur lointain vers la table (CS:046E) | MOV CS:[0150],046E ; MOV CS:[0152],CS ; pointeur lointain en CS:0164 (relogé) | probable |
| `1000:0e1a` | `vga_sprite_hit` | 194 | Entrée +0x2e : teste le recouvrement d'un sprite avec le plan de priorité (rogne comme le blit ; 0 = pas de recouvrement, 7 = un pixel opaque tombe sur la valeur de priorité de l'objet, FFFFh = entièrement hors fenêtre). Suite en 0edc | Mêmes calculs de rognage que 0722 ; CMP AH,ES:[DI] avec ES = plan de priorité ; sauts vers 0edc | probable |
| `1000:0edc` | `vga_sprite_hit_scan` | 204 | Corps de l'entrée +0x2e : balaie les colonnes du sprite (sens selon le miroir) et compare les pixels non transparents au plan de priorité | Corps atteint par saut depuis 0e1a (non appelé), même sens de lecture que le blit | probable |
| `1000:0fa8` | `vga_undo_all_thunk` | 6 | Entrée +0x62 : saute à 0b12 (même effet que +0x5a) | CALL 0b12 ; RETF | certain |
| `1000:0fae` | `vga_wait_retrace` | 16 | Entrée +0x5e : attend un retour vertical complet (fin du courant puis début du suivant, port 3DAh bit 3) | Deux boucles IN AL,DX / AND 8 | certain |
| `1000:10ee` | `vga_present` | 279 | Entrée +0x2a : recopie dans A000 les rectangles modifiés (pile de sauvegarde) depuis le tampon d'arrière-plan ; recopie tout l'écran (0x7D00 mots) si l'indicateur CS:0530 est non nul | Boucle MOVSW par rectangles de 10 octets ; REP MOVSW CX=7D00 depuis [04E8] vers [04E4] ; appelée par 0aa7 | probable |
| `1000:1206` | `vga_draw_rect` | 154 | Entrée +0x6a : trace directement dans A000 un rectangle (x, y, largeur, hauteur, couleur du cadre, couleur de remplissage dans l'octet bas de l'argument ; octet haut non nul = pas de remplissage) | STOSB par ligne dans ES = A000 + y x 20 ; 16 appelants dans AM1 | certain |
| `1000:12a0` | `vga_draw_text` | 185 | Entrée +0x6e : écrit directement dans A000 une chaîne avec une police en bits (tables lointaines : code vers glyphe, données des glyphes), avance par caractère, deux couleurs (le pixel est écrit en mot : la seconde couleur forme une ombre à droite) | Lecture de la chaîne, table de mots, bits LSB d'abord, MOV ES:[DI],DX ; AM1 : 1e14:0075 | probable |

#### Support interne (tampons, VGA)

| Adresse | Nom | Octets | Rôle | Preuve | Confiance |
|---|---|---:|---|---|---|
| `1000:0ac9` | `vga_restore_dynamic` | 73 | Restaure les fonds de la liste dynamique (objets dont l'octet +6 est non nul) dans le tampon et le plan de priorité, puis remet son compteur CS:052C à 0 | Deux appels 1074 (pages 04E8 et 0504) ; CS:052C = 0 | probable |
| `1000:0ddb` | `vga_open_b000` | 24 | Ouvre B000 en RAM vidéo (GC reg 6 &= F3) sauf si le test de B000 a échoué (CS:04EE non nul) | OUT 3CEh,06 ; IN/AND F3/OUT | certain |
| `1000:0df3` | `vga_close_b000` | 24 | Referme B000 (GC reg 6 \|= 04) sauf si le test a échoué | OUT 3CEh,06 ; IN/OR 04/OUT | certain |
| `1000:0fbe` | `vga_save_rect` | 182 | Sauve dans la pile d'annulation un rectangle de fond (segment, offset, pas, hauteur, largeur) et ses pixels ; renvoie 1 si la pile d'enregistrements est pleine, 2 si la zone de pixels est pleine | Enregistrement de 5 mots, MOVSW ligne par ligne ; MOV AX,1 / MOV AX,2 | probable |
| `1000:1074` | `vga_restore_rects` | 114 | Dépile n rectangles sauvegardés et les recopie à leur place dans la page (décalage de segment donné) | Lecture d'enregistrements de 10 octets à rebours, MOVSW par ligne | probable |
<!-- /GEN:vgafuncs -->

## Langage de commandes (jetons de 3 lettres) et dispatcher

Le moteur embarque un interpréteur de **commandes textuelles à jetons de 3 lettres**, accessible depuis la ligne de saisie en tapant `/jeton arguments` (`gm_parse_command` renvoie à `gm_script_tokenize` quand la ligne commence par `/`). `gm_script_tokenize` (`109a:0002`) isole les trois premières lettres, les cherche dans les 11 groupes de jetons de `DGROUP:05ee` (nombre de groupes en `05ec`), récupère jusqu'à 16 entiers (`DGROUP:763c`) et appelle `gm_script_dispatch` (`124c:0002`), qui saute à `[DGROUP:00C6 + 4 × groupe]`.

| Groupe | Jetons | Gestionnaire |
|---:|---|---|
| 0 | fin rem nop sys cnt dgs xit sec mse | `139a:0006` |
| 1 | heu lum trf ral lmr wat rvb | `1250:0008` |
| 2 | rlf rel vue | `10f2:0008` |
| 3 | inf loc dec img pos dic exp | `10fb:0006` |
| 4 | aut aff dsp cmd exe sub sal ecr msg peo ttl tta | `105e:0004` |
| 5 | cga pal mon buz adl rol mus brt fbt msl mst | `111f:0006` |
| 6 | scn niv sol aes pds ref aev | `123d:000a` |
| 7 | adi add ado dli dld dlo zpi zpd zpo cpi cpd cpo cti ctd cto nxi nxd nxo lbi lbd lbo rgi rgd rgo | `117d:0002` |
| 8 | ego fig txt dep tim fct dir dpx dpy por hor mob gst inv | `1218:000a` |
| 9 | xpy trj sor att raz get let mov chr sl1 sl2 sl3 | `11dc:000c` |
| 10 | cle dsk isr sem nil rsv svg skp sau res pil lir mod | `137b:0006` |

Les chaînes `« Syntaxe : svg nv1 nv2 »` et `« Niveaux invalides »` (`DGROUP:064e`, `0664`) appartiennent au jeton `svg` (groupe 10, calcule `nv1 * 100 + nv2` en `DGROUP:4b4e` et réécrit la sauvegarde). Les groupes 3 (`inf`), 4 (affichage de messages et de fenêtres), 7 (listes d'objets : créer/ajouter/supprimer), 8 (champs d'objet) et 9 (position, trajectoire, déplacement) sont les plus nets ; les sémantiques fines des jetons restent à établir fonction par fonction.

Parallèlement, le texte tapé par la joueuse suit le chemin : normalisation des accents par la table du message 10 de `MSGINT`, minuscules, découpage, recherche de chaque mot dans le dictionnaire (`gm_dic_lookup`, sur `DGROUP:4b4c` lettres significatives, tolérance du pluriel `s`/`x`), classement par `code / 1000` (1 = préposition, 13 / 22 / 24 : verbes et formes spéciales, 26 : voir `1d89:0002`), puis `gm_execute_command` (`22fc:0002`) qui exécute verbe + objets.

## Son

- `gm_load_mix` (`3024:0002`) charge l'en-tête de `A1FMIX.SYS` ; `gm_sound_play` (`2f33:000e`) et `gm_sound_select_track` (`2f9b:000e`, clé `classe*1000 + numéro + 0x218`) choisissent une piste parmi seize par entrée ; `snd_start_track` (`40f7:156b`) la démarre.
- **Le pilote musical est dans `AM1.EXE`** (module `40f7` pour le code, `406e` pour les données, avec son propre `DS`) : `snd_start_isr` (`40f7:0214`) masque IRQ0, remplace le vecteur `INT 08h` (écriture directe dans la table des vecteurs) par l'ISR du type de carte choisi (octet `406e:0076` : 1 = AdLib/OPL2 `40f7:0cf8`, 2 = MIDI `40f7:12d1`, 0 = haut-parleur `40f7:0e6b`) et reprogramme le PIT à 50 Hz ; `snd_stop_isr` (`40f7:02e2`) rétablit. Les jetons `cga pal mon buz adl rol mus` (groupe 5) correspondent aux choix de matériel.
- Les données de `A1FMIX.SYS` sont lues à la demande (tampons de 4 666 + 10 et 2 122 + 10 octets) ; le format des séquences n'est pas étudié ici (voir formats.md, « Rôle exact : inconnu »).

## Minuterie

Pas de minuterie logicielle dans le moteur lui-même : les temporisations utilisent `gm_delay_ticks` (`35a4:0008`, compteur BIOS `INT 1Ah`) ; la seule ISR installée est celle du pilote musical (50 Hz). Le champ `Tim` des objets est un compteur de tours de boucle (`18a9:0008`).

## Fonctions clés

Source : `scripts/armaeth/re/keyfuncs.def.tsv` (les tailles attendues sont contrôlées par `NameGameFuncs.java`). Les noms sont des propositions ; le préfixe `gm_` désigne le moteur, `snd_` le pilote musical embarqué.

<!-- GEN:keyfuncs -->
#### Démarrage et boucle principale

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `1000:0000` | `gm_main` | 89 | 1 | main(argc, argv) : enchaîne installation INT 24h, MSGINT, chemins, arguments, init, srand(time), boucle, sortie | Appelée par le startup MSC (3938:001a) ; appelle 348a:000a, 2065:000a, 1e68:0008, 34eb:000c, 1005:000a, time/srand, 18a9:0008, 1ee6:0008 | certain |
| `1005:000a` | `gm_init_engine` | 481 | 1 | Initialisation du moteur : trouve le driver vidéo résident, alloue le tampon d'écran 320x200, charge GPH, MIX, TMS, DIC, ANI | Appelle 3922:000c, 1d7b:0000, 325a:0002, 3024:0002, 2013:0000, 1dd4:002a, 16f5:000e ; alloue 0xFA20 octets ; compare DGROUP:0eac[0] à 2 | certain |
| `18a9:0008` | `gm_main_loop` | 1641 | 1 | Boucle principale d'une salle : met à jour les objets, anime, lit les entrées, change de salle | Appelée uniquement par main ; parcourt les listes d'objets (+0x22/+0x80), appelle 1cc3:000e (chargement de salle), 1aba:000e, 1793:0006, 23a2:0250 ; saut vers le début quand la salle courante change | probable |
| `1d83:000c` | `gm_error_exit` | 84 | 3 | Affiche un message d'erreur (console ou via le driver) puis quitte | Appelle puts + 3580:0067 si le driver vidéo est absent, sinon 200c:0014 | probable |
| `1e68:0008` | `gm_init_paths` | 578 | 1 | Construit les répertoires de données (« \sys », « \vrs\ ») et lit A1FINS.SYS (236 octets) | Chaînes 4f7e, 4f83, 4f89 « ins », 4f94 « .sys » ; fread(…, 0xEC, 1) vers DGROUP:4f9a ; l'octet 0 (nul dans le fichier fourni) choisit chemin d'installation ou invites « DISK-n » | certain |
| `1ee6:0008` | `gm_quit` | 79 | 7 | Sortie normale : mode texte, arrêt du son, message éventuel, exit | INT 10h mode 3 via 35a7:003a, 3024:0357 (arrêt du son), puts, lib_exit(0) | certain |
| `1ee6:0058` | `gm_abort` | 28 | 107 | Sortie sur erreur interne sans message (plus de 100 appelants : chargeurs, allocations, contrôles de bornes) | Appelle 3024:0357, 34b4:0064, lib_exit(0) | probable |
| `2065:000a` | `gm_load_msgint` | 24 | 1 | Charge le fichier texte MSGINT en tableau de chaînes | Appelle 351f:0002 avec la chaîne « msgint » (DGROUP:5202) | certain |
| `2065:003c` | `gm_fatal_error` | 22 | 14 | Erreur fatale avec message tiré de MSGINT (utilisée après chaque allocation/lecture ratée) | Appelle 2065:0022 (texte MSGINT) puis 1d83:000c | probable |
| `348a:000a` | `gm_install_hw_error_handler` | 22 | 1 | Installe le gestionnaire d'erreurs critiques DOS (INT 24h) et charge MSGHRD | Appelle lib__harderr (13e8) avec 348a:022c puis 356b:000e | certain |
| `34b4:0064` | `gm_fatal_err_code` | 10 | 1 | Affiche « * Err nnn * » et quitte avec le code 1 | Chaîne DGROUP:584a ; 34b4:0000 remplit les 3 chiffres | probable |
| `34b4:006e` | `gm_fatal_sys_code` | 10 | 2 | Affiche « * SYS nnn * » et quitte | Chaîne DGROUP:5858 | probable |
| `34eb:000c` | `gm_parse_argv` | 538 | 1 | Analyse la ligne de commande « am1 * a1f » : lecteur (« * » ou « ! »), préfixe de langue, type vidéo ega/vga | Chaînes « \vrs\ », « ega », « vga », « \n* Err 000 * » ; compare le premier octet à 0x2A et 0x21 | probable |
| `351f:0002` | `gm_load_text_table` | 338 | 2 | Charge un fichier texte clair (MSGINT, MSGHRD) : 1re ligne = nombre de chaînes, puis une chaîne par ligne | Appelle fgets (0982), atoi, malloc, strncpy ; stocke un tableau de pointeurs lointains | certain |
| `356b:000e` | `gm_load_msghrd` | 31 | 1 | Charge le fichier texte MSGHRD (erreurs matérielles/disque) | Appelle 351f:0002 avec la chaîne « msghrd » (DGROUP:590e) | certain |

#### Fichiers et chargement des données

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `10b3:0006` | `gm_def_lookup` | 330 | 1 | Lit A1FDEF.SYS : 4 mots (nombres de ressources INT, DEC, OBJ, ANM = 30, 20, 92, 47) puis enregistrements de 28 octets ; renvoie l'enregistrement dont l'identifiant correspond | fread(…, 4 éléments) puis fread(DGROUP:7660, 0x1C, 1) en boucle ; contrôle numérique : 8 + 28 x 189 = 5300 = taille du fichier ; erreurs 201..204 | certain |
| `1346:0004` | `gm_cm_script_step` | 826 | 9 | Lit un enregistrement de CM1/CM3/CM2/CM4 : en-tête de 10 octets (5 mots), n mots (n <= 16), puis L octets de texte XOR 0xBB (L <= 0x7FF) ; automate à 10 états (0..9) qui enchaîne les enregistrements | fread(10, 1), fread(2, n), fread(1, L), boucle ^= 0xBB ; la chaîne d'enregistrements retombe exactement sur la taille de CM1 (72), CM2 (2137), CM3 (80), CM4 (1079) | certain |
| `16f5:000e` | `gm_load_ani` | 222 | 1 | Lit A1FANI.SYS : u16 n1, u16 n2, n1 enregistrements de 12 octets, n2 mots | Deux fread de 2 octets puis n1*12 et n2*2 octets ; contrôle : 4 + 12*47 + 2*147 = 862 | certain |
| `1735:000e` | `gm_load_sprite_resource` | 870 | 1 | Charge une ressource sprite d'un objet : famille Typ 0/1/2 -> INT/DEC/OBJ (indices 8/4/3), animé -> ANM (indice 5) ; table {id u16, offset u32, taille u32} | Clé de cache type*1000+id ; fseek, lecture par blocs de 0x800 ; construit 4 pointeurs (+0x0C..) : table +0x20, n1*4, n2*12, n3*2 ; liste chaînée à DGROUP:3bb8 | certain |
| `1cc3:000e` | `gm_load_scene` | 2031 | 3 | Charge une salle : table de 5 emplacements de 10 octets, en-tête de 0x30 octets, zones, tables 16 octets, 40 mots, images de fond, enregistrements de 10 et 20 octets | Appelle 1e68:0322, fread(10, 5) puis fseek à l'offset de l'emplacement, fread(0x30, 1), grille 81 x 21 x N (0x6A5 cases par plan), fread(0x10, n), fread(2, 0x28), 1f94:0008 pour les images, fread(10, n10), fread(0x14, n20) | certain |
| `1dd4:002a` | `gm_load_dic` | 298 | 1 | Lit A1FDIC.SYS : u16 n puis n enregistrements de 18 octets {code u16, mot 16 octets} ; les mots sont inversés (NOT) après lecture | fread(2) puis boucle fread(18), strncpy ; boucle ~mot sur n*16/2 mots ; tableaux DGROUP:7b68/7b6c | certain |
| `1e68:024c` | `gm_open_data_file` | 211 | 16 | Ouvre un fichier de données par indice 0..19 (CFG DIC CM3 OBJ DEC ANM ANI CM1 INT CM2 MIX TMS MSG TMP TMP DEF TMP TMP GPH CM4) | Noms 4 octets à DGROUP:4ed6 (pointeur 5086), extensions à 4f27 (pointeur 508a), « ega »/« vga » quand l'extension est vide, drapeau d'écriture pour 13 et 16 ; 16 appelants | certain |
| `1e68:0322` | `gm_open_scene_file` | 188 | 1 | Ouvre le fichier de scènes pour un identifiant : « A1F » + chiffre des centaines + lettre ‘A’+((id%100)/5) + .vga | Calcul id%100, /5 ; octets 50c3 ‘0’, 50c4 ‘0’+centaines, 50c5 ‘A’+lettre ; appelée par 1cc3:000e | certain |
| `1e68:03e0` | `gm_build_path_and_open` | 549 | 2 | Assemble le chemin complet (lecteur, répertoire d'installation, \vrs\ ou \sys, nom, extension) et ouvre le fichier (« rb »/« wb ») | Chaînes « DISK-? », « wb », « rb », « x: » ; appelle 353c:0006 | certain |
| `1f94:0008` | `gm_decode_scene_image` | 1582 | 1 | Décodeur d'image de fond : octet de type (0, 1 ou 2), puis par ligne deux longueurs (octets additionnés tant qu'ils valent 0xFF), les octets compressés, décompression par 34bb:0008 (types 0/1) ou 34bb:0142 (type 2), table de recoloration optionnelle de 256 octets | Pointeur de fonction local_8 = 0x34bb:0x0008 ou 0x0142 ; tables DGROUP:5312 (type 1) et 5412 (type 2) ; contrôle longueur décodée == largeur ; copie ligne par ligne avec masque (valeurs < 200) | certain |
| `2013:0000` | `gm_load_tms` | 236 | 2 | Lit l'index A1FTMS.SYS : u16 n, u16 longueur maximale, n entrées de 6 octets {clé u16, offset u32} | Alloue n*6 + max + 0x10 ; relit n*6 octets ; DGROUP:7f50..7f5a | certain |
| `2013:00ec` | `gm_get_message` | 452 | 10 | Renvoie le texte du message (classe, numéro) : clé = classe*1000+numéro, recherche dichotomique dans l'index TMS, fseek dans A1FMSG.SYS, lecture puis NOT de chaque octet | Classe = toupper(lettre)-0x40 (A=1) ou valeur+0x1E si < 0x41 ; message de repli 0x2D ; le texte se termine à l'offset de l'entrée suivante | certain |
| `3024:0002` | `gm_load_mix` | 517 | 1 | Lit l'en-tête de A1FMIX.SYS : 4 mots (68, 55, 4666, 2122), puis 68 enregistrements de 8 octets et 55 de 42 octets ; alloue deux tampons de 4666+10 et 2122+10 octets | Quatre fread(2) puis fread(8, n1) et fread(0x2A, n2) ; DGROUP:5294..52bc | certain |
| `325a:0002` | `gm_load_gph` | 426 | 1 | Lit A1FGPH.SYS : u16 largeur de cellule (5), u16 hauteur (7), u16 taille des données (0x2CE), 256 mots d'offsets puis les octets de glyphes | Trois fread(2), puis fread(2, 0x100) et fread(1, taille) ; contrôle : 6 + 512 + 718 = 1236 | certain |
| `348a:01ae` | `gm_fopen` | 125 | 1 | Enveloppe de fopen utilisée par l'ouverture des fichiers de données | Appelle lib_fopen (039c) | probable |
| `34bb:0008` | `gm_unpack_rle` | 311 | 0 | Décompresseur de ligne A : paquets « 00 n <n octets littéraux> » ou « n v » (n copies de v) | Désassemblage : octet nul -> compteur puis copie littérale ; sinon compteur et valeur ; erreur si la sortie dépasse la taille max (0x400) | certain |
| `34bb:0142` | `gm_unpack_nibble` | 454 | 0 | Décompresseur de ligne B : « 00 n <n littéraux> » ou « n base » suivis de ceil(n/2) octets donnant deux pixels base+(b>>4), base+(b&15) | Désassemblage : octet nul -> littéraux ; sinon n puis base puis boucle (n+1)/2 avec >>4 et &0xF ajoutés à base | certain |
| `353c:0006` | `gm_open_with_disk_prompt` | 750 | 4 | Ouvre un fichier sur un lecteur donné, redemande le disque en cas d'absence (messages MSGHRD) et renvoie un FILE | Appelle lib__makepath (114a), 348a:0090 (existence), 348a:01ae (fopen), 356b:0054/007c (messages) | probable |

#### Graphique

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `1265:0554` | `gm_dump_line` | 136 | 1 | Affiche une ligne de la fenêtre de débogage d'objet | Appelée après chaque sprintf par 1265:0008 | probable |
| `12c2:000c` | `gm_draw_line` | 1481 | 1 | Tracé de ligne (pas de Bresenham) avec écriture directe en A000 (coordonnées bornées à 320 x 200) | Écart absolu dx/dy, bornes 0x140/0xC8, pointeur 0xA000:0000 ; appelée par le gestionnaire du groupe 2 (10f2:0008) ; accès aux registres 3CE | probable |
| `12c2:05e0` | `gm_draw_hline_vram` | 483 | 1 | Variante de tracé direct en A000 (segment 12c2) | Pointeur 0xA000:0000, mêmes bornes | hypothèse |
| `1d7b:0000` | `gm_init_video` | 140 | 2 | Applique le mode vidéo du driver (champ +2), la palette (DGROUP:4b04) et les couleurs de texte | Appelle 35ad:0008 puis les entrées +0x46, +0x4a, +0x72 du driver | probable |
| `1ff8:0004` | `gm_alloc` | 100 | 25 | Allocation lointaine (taille long) : malloc si < 64 Ko sinon halloc ; erreur fatale si échec | Appelle lib_malloc (06e1) ou lib_halloc (0c06) ; 25 appelants | certain |
| `1ff8:006a` | `gm_free` | 85 | 25 | Libère un pointeur et le met à zéro ; erreur fatale si le pointeur d'entrée est nul | Appelle lib_free (06ce) ou lib_hfree (0bfa) | certain |
| `1ff8:00c0` | `gm_realloc` | 131 | 3 | Redimensionne un bloc | Appelle lib_realloc (0b74) | probable |
| `327a:0044` | `gm_draw_text` | 1430 | 11 | Affiche une chaîne avec la police GPH dans un rectangle (11 paramètres : couleurs, position, texte far) | Appelée par 200c:0014/327a:0004, 105e:0004 ; utilise la largeur/hauteur de cellule de la police (DGROUP:4dde/4de0) | probable |
| `35a7:003a` | `gm_bios_mode_page_cursor` | 45 | 3 | INT 10h : AH=0 (mode), AH=5 (page), AH=1 (curseur) ; 0xFFFF = ne pas changer | Appelée avec (3, 0, 0x0809) pour revenir en mode texte | certain |
| `35ad:0008` | `gm_set_video_mode` | 242 | 1 | Choisit/valide le mode vidéo (liste de modes BIOS), appelle INT 10h AH=0 ou le pointeur de mode DGROUP:8d78 | Appelle 36b3:000a (int86 0x10) ; mémorise le mode à DGROUP:591c | probable |
| `3678:000a` | `gm_get_video_state` | 418 | 2 | INT 10h AH=0Fh (mode courant) puis recopie l'état dans une structure | Constante 0xF dans AH | probable |
| `36b3:000a` | `gm_bios_set_mode` | 39 | 2 | INT 10h AH=0 (changement de mode vidéo) | int86(0x10) avec AX=mode | certain |
| `3855:0000` | `gm_set_ega_palette_reg` | 100 | 1 | INT 10h AX=1000h : registre de palette EGA 0..15, valeur 0..63 | Bornes 0..0xF et 0..0x3F ; table DGROUP:5fa8 | certain |
| `3922:000c` | `gm_find_vga_driver` | 98 | 1 | Trouve le driver résident (VGA.EXE) : INT 16h avec AX=1D5F, CX=00CB ; renvoie dans CX:DX un pointeur far vers sa table (stockée à DGROUP:0eb8 puis 0eac) | int86(0x16) avec AX=0x1D5F ; retour si AX==0 ou BX==0 ; table [0] = 2 attendu (1 = EGA, 2 = VGA) | certain |

#### Texte et commandes

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `109a:0002` | `gm_script_tokenize` | 400 | 1 | Reconnaît un mot de commande à 3 lettres dans les 11 groupes de jetons (DGROUP:05ee), récupère jusqu'à 16 arguments entiers (DGROUP:763c) et appelle le dispatcher | Appelle lib_strstr (0f1c), lib_strtok (0e72), 124c:0002 ; compteur de groupes à DGROUP:05ec = 11 | certain |
| `124c:0002` | `gm_script_dispatch` | 69 | 2 | Appelle le gestionnaire du groupe de jetons (0..10) : table de pointeurs far à DGROUP:00c6 | Test 0 <= groupe <= 10 puis appel indirect [groupe*4 + 0xC6] | certain |
| `1d89:0002` | `gm_parse_command` | 699 | 2 | Analyse la ligne tapée : normalise les accents (table du message 10 de MSGINT), minuscules, strtok, recherche chaque mot dans le dictionnaire, classe verbes/prépositions/noms par code/1000 ; une ligne commençant par « / » va à l'interpréteur de commandes de débogage | Appelle lib_strlwr, lib_strtok, lib_strchr, 1dd4:0156, 109a:0002, 22fc:0002 ; classes 1, 13, 22, 24, 26 | certain |
| `1dd4:0156` | `gm_dic_lookup` | 485 | 1 | Recherche dichotomique d'un mot dans le dictionnaire sur les n premières lettres (DGROUP:4b4c, 4..16), tolère un « s » ou « x » final, renvoie jusqu'à 60 codes | Appelle lib_strncmp ; tableaux 7b68 (codes) et 7b6c (mots de 16 octets) | certain |
| `200c:0004` | `gm_show_message_id` | 16 | 76 | Affiche le message dont l'identifiant est passé (ignore les identifiants <= 0) | 138 appelants ; appelle 2013:00ec puis 200c:0014 | certain |
| `200c:0014` | `gm_show_text` | 32 | 9 | Affiche un texte far (fenêtre de texte du jeu) | Appelle 327a:0004 ; ignore le pointeur nul | certain |
| `22fc:0002` | `gm_execute_command` | 1619 | 1 | Résout verbe + objets et exécute la commande (1619 octets) | Lit DGROUP:4cba/4cbc/4cbe/4cc0 remplis par gm_parse_command ; appelle 206a:0002, 2363:0154, 200c:0004 | probable |
| `327a:0004` | `gm_print_text_default` | 64 | 1 | Affiche un texte avec les couleurs courantes du driver (+0x0C..+0x10) | Appelle 327a:0044 avec 7, 0x15, 0 | probable |

#### Entrées

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `1db5:003e` | `gm_wait_click_or_key` | 361 | 1 | Attend un clic souris ou Entrée/Échap (0x0D/0x1B) | Appelle 35cd:0006, 3588:0118 ; teste 0x0D et 0x1B | probable |
| `3580:0004` | `gm_wait_key` | 79 | 2 | INT 16h AH=1 (test) / AH=0 (lecture), avec attente optionnelle | Deux int 0x16 consécutifs | certain |
| `35c0:000a` | `gm_mouse_set_hrange` | 129 | 1 | INT 33h AX=7 (plage horizontale) | Double les valeurs si la largeur virtuelle est < 640 | certain |
| `35c8:000c` | `gm_mouse_reset` | 72 | 1 | INT 33h AX=0 (initialisation souris) ; renvoie 0 si le vecteur 33h est nul | Lit le vecteur à 0000:00CC ; int86(0x33) | certain |
| `35cd:0006` | `gm_mouse_get_state` | 219 | 4 | INT 33h AX=3 (position et boutons) ; coordonnées divisées par 2 dans les modes 320 de large | Renvoie x, y, bouton gauche et droit (bits 0 et 1) | certain |
| `35db:0002` | `gm_mouse_set_pos` | 212 | 2 | INT 33h AX=4 (positionnement du curseur) | int86(0x33) avec AX=4 | certain |
| `35e8:0008` | `gm_mouse_set_vrange` | 103 | 1 | INT 33h AX=8 (plage verticale) | int86(0x33) avec AX=8 | certain |
| `35ef:0000` | `gm_mouse_driver_setup` | 189 | 1 | Initialise des pointeurs de fonctions du module 35fa-3928 (curseur logiciel / états vidéo : segment A000, 36d4) | Écrit 0xA000 à DGROUP:594a et des adresses de 36d4/35fa | hypothèse |
| `3692:000c` | `gm_mouse_hide` | 148 | 1 | INT 33h AX=2 (cache le curseur) | int86(0x33) avec AX=2 | certain |
| `369c:0002` | `gm_mouse_show` | 282 | 1 | INT 33h AX=1 (affiche le curseur) | int86(0x33) avec AX=1 | certain |
| `36ad:000e` | `gm_mouse_motion` | 55 | 1 | INT 33h AX=0Bh (compteurs de déplacement) | int86(0x33) avec AX=0xB | certain |
| `3928:0026` | `gm_read_key` | 125 | 3 | INT 16h AH=0/1 : lit une touche (octet de code ASCII, ou 0 + code de balayage mis en tampon DGROUP:6706/6707) | int86(0x16) ; tampons 6706/6707 | certain |

#### Son

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `2f33:000e` | `gm_sound_play` | 993 | 15 | Joue un son/une musique par (classe, numéro, mode) : cherche dans la table MIX et lit les données dans A1FMIX.SYS | Appelle 1e68:024c (MIX), 2f9b:026c, 300b:00c5 ; appelants : salles (1cc3), commandes de son (111f) | probable |
| `2f33:03f2` | `gm_sound_stop` | 238 | 4 | Arrête la piste courante (pilote 40f7:05a9) | Appelle 40f7:05a9 | probable |
| `2f9b:000e` | `gm_sound_select_track` | 606 | 18 | Sélectionne une piste dans une entrée MIX (16 identifiants possibles par entrée) : clé classe*1000+numéro+0x218, puis démarre via 40f7:156b | Boucle sur 16 mots ; appelle 40f7:156b | probable |
| `3024:0207` | `gm_sound_init` | 117 | 2 | Initialise le sous-système son (appelle le pilote 40f7) | Appelée par 3024:0002 en premier | probable |
| `3024:0357` | `gm_sound_shutdown` | 43 | 2 | Arrête le son (appelée à toute sortie) | Appelée par 1ee6:0008 et 1ee6:0058 | probable |
| `40f7:156b` | `snd_start_track` | 99 | 3 | Démarre une piste (numéro, répétition, drapeaux) dans le pilote | Appelée par 2f9b:000e | probable |

#### Minuterie

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `35a4:0008` | `gm_delay_ticks` | 41 | 3 | Attente active de n tics BIOS (INT 1Ah AH=0 : compteur de tics) | Deux int 0x1A ; appelée par 105e:0004 (0x19), 1250:0008, 1db5:0004 | certain |
| `40f7:0214` | `snd_start_isr` | 157 | 2 | Démarre le pilote musical : masque IRQ0 (OUT 21h), remplace le vecteur 08h (IVT 0000:0020) par l'ISR du type de carte, reprogramme le PIT (OUT 43h=34h, diviseur 0x5D37 = 50 Hz) | Suivant l'octet 406e:0076 : 1 -> 40f7:0cf8 (AdLib), 2 -> 40f7:12d1 (MIDI), sinon 40f7:0e6b (haut-parleur) | certain |
| `40f7:02e2` | `snd_stop_isr` | 81 | 3 | Rétablit le vecteur 08h et le PIT | Restaure CS:[0e66]/[0e68] ; appelée à l'arrêt | probable |
| `40f7:0cf8` | `snd_isr_opl` | 369 | 0 | ISR 50 Hz du séquenceur FM (ports 0x388/0x389), EOI à la fin (OUT 20h) | Écritures sur 0x388 ; OUT 0x20 | probable |
| `40f7:12d1` | `snd_isr_midi` | 198 | 0 | ISR du séquenceur MIDI (port 0x331/0x330) | Écritures sur 0x331 | hypothèse |

#### Logique de jeu

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `105e:0004` | `gm_script_group4` | 925 | 0 | Gestionnaire du groupe 4 : aut aff dsp cmd exe sub sal ecr msg peo ttl tta (12 jetons) ; texte, messages, fenêtre | Entrée 4 ; appelle 200c:0014, 327a:0044, 1d89:0002 | certain |
| `10f2:0008` | `gm_script_group2` | 141 | 0 | Gestionnaire du groupe 2 : rlf rel vue (3 jetons) | Entrée 2 | probable |
| `10fb:0006` | `gm_script_group3` | 432 | 0 | Gestionnaire du groupe 3 : inf loc dec img pos dic exp (7 jetons) ; « inf » appelle gm_dump_object | Entrée 3 ; case 0 -> 1265:0008 | certain |
| `1118:0008` | `gm_resolve_object_ref` | 109 | 5 | Transforme un argument de commande en pointeur d'objet (courant, héros ou recherche par identifiant) | Utilisée par tous les gestionnaires de jetons avec un type 0..5 | probable |
| `111f:0006` | `gm_script_group5` | 497 | 0 | Gestionnaire du groupe 5 : cga pal mon buz adl rol mus brt fbt msl mst (11 jetons) ; matériel vidéo et son | Entrée 5 ; appelle 357b:001f (palette INT 10h) | probable |
| `117d:0002` | `gm_script_group7` | 1463 | 0 | Gestionnaire du groupe 7 : 24 jetons adi add ado dli dld dlo zpi zpd zpo cpi cpd cpo cti ctd cto nxi nxd nxo lbi lbd lbo rgi rgd rgo (listes chaînées d'objets : ajout/suppression selon trois listes) | Entrée 7 ; manipule les champs +0x22/+0x26/+0x80/+0x84 (listes) et appelle 19a6:000a | certain |
| `11dc:000c` | `gm_script_group9` | 909 | 0 | Gestionnaire du groupe 9 : xpy trj sor att raz get let mov chr sl1 sl2 sl3 (12 jetons) ; position, trajectoire, déplacement | Entrée 9 ; écrit +0x54..0x5A et +0x6F..0x7A | certain |
| `1218:000a` | `gm_script_group8` | 550 | 0 | Gestionnaire du groupe 8 : ego fig txt dep tim fct dir dpx dpy por hor mob gst inv (14 jetons) ; affecte les champs d'un objet | Entrée 8 ; écrit +0x2D (ego), +0x2E (fig), +0x08 (txt), +0x07 (dep), +0x32/0x34 (tim), +0x8C/0x8E (fct), +0x45/0x46, +0x06 (mob), +0x05 (gst) | certain |
| `123d:000a` | `gm_script_group6` | 211 | 0 | Gestionnaire du groupe 6 : scn niv sol aes pds ref aev (7 jetons) ; niveaux (4b4e), scène, sol | Entrée 6 | certain |
| `1250:0008` | `gm_script_group1` | 316 | 0 | Gestionnaire du groupe 1 : heu lum trf ral lmr wat rvb (7 jetons) | Entrée 1 de la table DGROUP:00C6 ; affecte l'heure (4b54/4b55), luminosité (4b51), attentes (35a4:0008) | certain |
| `1265:0008` | `gm_dump_object` | 1354 | 1 | Affiche tous les champs d'un objet (fenêtre de débogage) ; fournit l'agencement de l'enregistrement de 144 octets | sprintf avec les chaînes « Num Ser Adr … » (DGROUP:00F2..03AF) | certain |
| `137b:0006` | `gm_script_group10` | 460 | 0 | Gestionnaire du groupe 10 : cle dsk isr sem nil rsv svg skp sau res pil lir mod (13 jetons) ; « svg nv1 nv2 » : syntaxe vérifiée (chaînes 064e et 0664) | Entrée 10 ; case svg écrit DGROUP:4b4e = nv1*100+nv2, appelle 10dc:015e/0164 ; sau/res -> 2052:000c, 192e:0008, 1d4a:0002 | certain |
| `139a:0006` | `gm_script_group0` | 206 | 0 | Gestionnaire du groupe 0 : fin rem nop sys cnt dgs xit sec mse (9 jetons) | Entrée 0 de la table DGROUP:00C6 | probable |
| `19a6:000a` | `gm_create_object` | 411 | 11 | Crée un objet : alloue 144 octets, copie le modèle DGROUP:4c1c (72 mots), numéro de série = ++DGROUP:4b4a, remplit les champs | Appelée par 1cc3:000e (pose des objets d'une salle), 192e:0008 (chargement), 117d:0002 ; 24 paramètres | certain |
| `19a6:02b6` | `gm_destroy_scene_objects` | 170 | 3 | Libère les objets de la salle | Appelée trois fois par 192e:0008 avant rechargement | probable |
| `1b11:000c` | `gm_object_behavior_main` | 5053 | 6 | Plus grosse fonction du moteur (5053 octets) : comportement/IA d'objets mobiles utilisant rand et multiplication 32 bits | Appelle 1aba:000e, 25ea, 1504:0002, 179d:0004, lib__aFlmul, lib_memset | hypothèse |
| `1e08:0000` | `gm_chance_one_in` | 20 | 21 | Vrai une fois sur n : rand() % n == 0 | Appelle lib_rand ; 20 appelants | certain |
| `1e0e:0000` | `gm_find_scene` | 94 | 9 | Cherche une salle par identifiant dans le tableau d'enregistrements de 42 octets (DGROUP:4b7c, 4bfc éléments) | Boucle avec pas de 0x15 mots | certain |
| `30d9:0114` | `gm_reset_object_motion` | 112 | 22 | Annule le déplacement en cours d'un objet (+0x68, +0x6C, +0x6E.. +0x7A) | Remet des champs à zéro / 0xFFFF | probable |
| `3187:0000` | `gm_compute_path` | 1217 | 10 | Recherche de chemin d'un objet sur la grille de la salle (coordonnées +0x45..0x47, liste +0x78, constante 0x3FFF3FFF) | Appelée par 11dc:000c (mov) ; lit les champs de déplacement de l'objet | hypothèse |

#### Sauvegardes et état du monde

| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `1664:0057` | `gm_write_tmp_scr` | 1631 | 1 | Écrit TMP.SCR (indice 13) : état de salle temporaire | 1e68:024c(0xd) puis fwrite | hypothèse |
| `1664:06b6` | `gm_read_tmp_scr` | 555 | 3 | Lit TMP.SCR (indices 13/14) | 1e68:024c(0xe) et (0xd) | hypothèse |
| `192e:0008` | `gm_load_world` | 1272 | 4 | Charge un état du monde (CFG.SYS, STD, TMP.SVG) : en-tête 0x36, table 8 octets, table 12 octets, 60 salles de 42 octets, objets de 144 octets | Magic 0x786B / 0x00CA ; fread(0x36,1), 2255:0002, 23a2:03c2, fread(0x2A, n), fread(0x90, 1) en boucle ; contrôle numérique sur A1FCFG.SYS : 54 + 2 + 35*8 + 4 + 60*42 + 132*144 = 21868 | certain |
| `1d4a:0002` | `gm_save_world` | 533 | 4 | Écrit l'état du monde dans le même format (en-tête 0x36 avec magic, tables, salles, objets) | fwrite(0x36,1) puis 2255:0086, 23a2:0354, fwrite(0x2A, n), 1d4a:021e par objet | certain |
| `1d4a:021e` | `gm_save_object` | 240 | 2 | Écrit un objet (144 octets) en sauvegarde | Appelée par 1d4a:0002 pour chaque liste | probable |
| `203f:0004` | `gm_snapshot_alloc` | 166 | 2 | Alloue le tampon d'instantané (0x2000 en EGA, 0x5000 en VGA) et l'enregistre auprès du driver | Appelle l'entrée +0x52 du driver | hypothèse |
| `203f:00c8` | `gm_snapshot_world` | 114 | 1 | Écrit puis relit l'état dans TMP.SVG (instantané mémoire) pour un retour en arrière | Appelle 1e68:024c, 1d4a:0002, 192e:0008, lib_fclose | hypothèse |
| `2052:000c` | `gm_savegame_slot` | 299 | 4 | Sauvegarde/restaure une partie : nom « svg » + 3 chiffres (numéro DGROUP:0eda), mode ‘w’ (0x77) ou ‘r’ (0x72) | Chaîne DGROUP:51f4 « svg   » ; appelle 353c:0006, 1d4a:0002 (écriture) ou 192e:0008 (lecture) | certain |
| `2255:0002` | `gm_load_zone_table` | 131 | 1 | Lit u16 n (1..100) puis n enregistrements de 8 octets (35 dans CFG : ids 0-5, 100-108, 200-205, 300-313) | Erreur 0xC7 si n hors bornes ; tableau DGROUP:5218 | certain |
| `23a2:03c2` | `gm_load_table12` | 177 | 1 | Lit u16 a, u16 b puis b enregistrements de 12 octets (a = capacité ; a = b = 0 dans CFG) | fread(2,1) x2 puis fread(12, b) ; DGROUP:523a/523c | probable |
<!-- /GEN:keyfuncs -->

## Autres exécutables du CD (chaînes seulement)

- `SOS.EXE` (51 Ko) : programme Microsoft C avec émulateur 8087 et touches `QWERTYUIOP…` ; `AIDE.BAT`/`HELP.BAT` le lancent avec `* a1f` et il lit `A1FSOS.SYS` : **c'est le programme d'aide (menus hiérarchiques), pas un chargeur de pilote HMI** (contrairement à l'énoncé de la tâche).
- `SC0.EXE` (50 Ko) et `SC1.EXE` (8 Ko) : configuration (`sc0` contient la chaîne `sc1.exe` et le message `* MSG *`) ; programmes C Microsoft, pas d'interface avec `AM1.EXE` repérée.
- `VGA.EXE` (16 Ko) : pilote résident vidéo (C Microsoft, message `* SYS 000 *` comme `AM1.EXE`) ; analysé dans la section « Pilote vidéo `VGA.EXE` ».
- `ARMINS.EXE` (6 Ko), `HDINST.EXE` (24 Ko) : aucune chaîne lisible (code compressé ou chiffré) ; installation sur disque dur depuis `ARMAETH.RNC`.
- `CDPATCH.EXE` (2 Ko) : « CDPATCH Copyright (c) 1994 Rob Northen Computing, UK » (protection/adaptation du CD).

## Renommages proposés (`objects.md` § 12, tables seulement)

Propositions de noms, **non appliquées à Ghidra** (`keyfuncs.def.tsv` n'est pas modifié) :

| Adresse | Nom actuel / rôle | Nom proposé |
|---|---|---|
| `1a37:0002`, `1a37:003a`, `1a37:007f` | changement d'état | `set_object_state` (`Ego`, `Fig`… puis `placer`) |
| `1a6b:0006` | remplacement d'objet | `replace_object` |
| `22fc:065b` | met le pointeur de verbe à 0 | `disable_verb_handler` |
| `20ac:0060` | test de poids | `can_carry` |
| `2363:000c`, `2363:0154`, `2363:01ea` | réaction « trop loin » | `arm_reaction`, `walk_to_target`, `replay_command` |
| `2255:00e8` | attribution de points | `award_score` |
| `2255:0002` | `gm_load_zone_table` (nom actuel) | table de **score**, non de zones (`engine.md` § 9.3) : `gm_load_score_table` |

## Écarts avec formats.md

Lu le 24 octobre 2026 (fichier écrit en parallèle ; toute précision ci-dessous est à reporter dans formats.md).

- **Confirmé par le code** : formats de `TMS`/`MSG` (clé, index de 6 octets, NOT), de `DIC` (18 octets, mots NOT, code en clair), de `DEF` (4 compteurs puis 28 octets, 5 300 octets), de `MIX` (4 mots, 68 × 8, 55 × 42), des sprites (variante A, en-tête `id, n1, n2, n3, longueur`), de `A1FINS.SYS` (`\ARMAETH` à `+0x10`), palette en `246 402`.
- **Précisé** : `A1FANI.SYS` = `u16 47, u16 147`, 47 × 12 octets puis 147 mots (862 octets) ; `A1FGPH.SYS` = **3 mots d'en-tête (5, 7, 718), 256 mots d'offsets, 718 octets de glyphes** (formats.md : table à `0x48`, glyphes à `0x208`) ; les cellules font 5 × 7 ; `CM1..CM4` = suite d'enregistrements `{5 mots, n mots, L octets}` dont les textes sont XOR `0xBB` (CM2 : 33 enregistrements, CM4 : 8).
- **Contredit / corrigé** : `A1FCFG.SYS` contient **60 enregistrements de salle de 42 octets à partir de `0x154`** (formats.md : 59 à `0x17E`) puis **132 objets de 144 octets** (formats.md : « autres tables, non étudiées ») : 54 + 2 + 35 × 8 + 4 + 60 × 42 + 132 × 144 = 21 868. Les pointeurs `seg:off` à segment `0x6172` sont des pointeurs mémoire sans valeur dans le fichier.
- **Trouvé** : la décompression des scènes est dans `AM1.EXE` (codecs A et B ci-dessus) ; la palette est confirmée ; les « tables de 16 octets » des scènes sont les enregistrements de la grille de marche (81 × 21 cases par plan, valeur + interpolation) et d'une liste de rectangles ; les « enregistrements de 20 octets de la queue » sont des objets posés dans la salle (créés par `gm_create_object`) ; les 10 octets d'avant sont une autre liste.
- **Autre point** : `SOS.EXE` n'est pas un pilote son (voir plus haut). `MSGUTL` n'est pas chargé par `AM1.EXE`. Le pilote musical est dans `AM1.EXE` (formats.md l'attribuait à `sos`/`vga`/`sc0`).

## Par où commencer

- **Lecteurs de données** (tâche suivante) : `decomp/1cc3_000e_gm_load_scene.c` et `1f94_0008_gm_decode_scene_image.c` (scènes), le désassemblage de `34bb:0008` et `34bb:0142` dans `disasm.txt` (codecs, plus fiable que le décompilat), `1735_000e_gm_load_sprite_resource.c`, `192e_0008_gm_load_world.c` et `1d4a_0002_gm_save_world.c` (monde), `1346_0004_gm_cm_script_step.c` (CM), `3024_0002_gm_load_mix.c`, `2f33_000e` et `2f9b_000e` (MIX), `1265_0008_gm_dump_object.c` (champs d'objet).
- **Étude du moteur** : `18a9_0008_gm_main_loop.c`, `109a_0002_gm_script_tokenize.c` et `124c_0002_gm_script_dispatch.c` avec les gestionnaires `105e`, `10fb`, `117d`, `11dc`, `1218`, `137b`, `1d89_0002_gm_parse_command.c`, `22fc_0002_gm_execute_command.c`, `19a6_000a_gm_create_object.c`, `1ff8` (allocation), puis les modules `2363-2f32` (logique de salles).
- **Dessin des sprites** : `VGA.EXE` (section « Pilote vidéo `VGA.EXE` », corpus dans `archives/armaeth/re/vga/`) ; commencer par `vga_draw_sprite` (`vga/decomp/1000_0722_vga_draw_sprite.c`, mais le désassemblage `vga/disasm.txt` est plus fiable).
