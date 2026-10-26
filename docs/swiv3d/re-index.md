# SWIV 3D — index de la rétro-ingénierie (`SWIV_WIN.EXE`)

Corpus Ghidra de `SWIV_WIN.EXE` (PE32 Windows 95, 1997, version rendu logiciel / MMX, compilateur Watcom : convention d'appel par registres EAX, EDX, EBX, ECX). Il sert à documenter les formats de `GLOBAL.BD`, `*.SLV` et `SOUNDS.BD`. Les versions `SWIV_WFX.EXE` (3Dfx) et `SWIV_WDX.EXE` (D3D) n'ont pas été analysées.

Régénération : `bash scripts/swiv3d/re/run.sh` (≈ 40 s). Sorties (non versionnées) dans `archives/swiv3d/re/` : `functions.tsv`, `strings.tsv`, `imports.tsv`, `keyfuncs.tsv`, `decomp/*.c` (une décompilation par fonction), `disasm.txt`, `run.log`. Les blocs entre `<!-- GEN:x -->` ci-dessous sont regénérés ; le reste est écrit à la main.

Points d'attention pour la lecture du corpus :

- Le `PeLoader` de Ghidra ne résout pas les imports de ce PE (sections à taille virtuelle nulle). `NamePeImports.java` lit le répertoire d'imports, nomme les cases de l'IAT (`mciSendStringA`, `_SmackOpen`…) et les stubs `JMP [IAT]` (`imp_*`, type `import`).
- Adresses linéaires 32 bits, base `00400000`. Code `00410000-00477400` (section `BEGTEXT`), données `00480000-00485000` (`DGROUP`), BSS `00490000+`, IAT `005c0000+`. Le code de bibliothèque Watcom (`00470000+`) n'est pas nommé.
- Les « chaînes référencées » sont heuristiques (constantes égales à l'adresse d'une chaîne). Les chaînes ne sont qu'une centaine : tout le texte du jeu est dans `GLOBAL.BD`.
- La décompilation Watcom est bruitée (paramètres `extraout_ECX`…). Pour les arguments en registres, lire `disasm.txt`.

## Statistiques

<!-- GEN:stats -->
- Outils : ghidra 12.2 ; JDK : ?.
- Durée de la dernière régénération : ? s.
- Image : 572416 octets.
- Fonctions : 655, 376105 octets (types : func 608, import 47).
- Décompilation : 606 ok (92.5 %), 49 partielle, 0 en erreur.
- Chaînes de la zone de données : 111 ; référencées par au moins une fonction : 67.
- Décompilation partielle : `00476fd7`, `00472c7b`, `00477238`, `0047723e`, `00477244`, `0047724a`, `00477250`, `00477256`, `0047725c`, `00477262`, `00477268`, `0047726e`, `00477274`, `0047727a`, `00477280`, `00477286`, `0047728c`, `00477292`, `00477298`, `0047729e`, `004772a4`, `004772c2`, `004772c8`, `004772ce`, `004772d4`, `004772e0`, `004772e6`, `004772ec`, `004772f2`, `004772f8`, `004772fe`, `00477304`, `0047730a`, `00477310`, `00477316`, `0047731c`, `00477322`, `00477328`, `00477382`, `00477388`, `0047738e`, `00477394`, `0047739a`, `004773a0`, `004773a6`, `004773ac`, `004773b2`, `004773b8`, `004773be`.
<!-- /GEN:stats -->

## Fonctions nommées

Table `scripts/swiv3d/re/keyfuncs.def.tsv`, appliquée par `NameGameFuncs.java` (les fichiers `decomp/` portent ces noms, préfixe `gm_`). « certain » = établi par le code ; « probable » = déduit du rôle d'appelants/appelés ; « hypothèse » = à vérifier.

Les groupes « Étude … » viennent des cinq études détaillées (tables « Fonctions à nommer » fusionnées dans la table) ; « non précisé » = confiance non indiquée par l'étude. Un nom à `-` octets attendus dans la table désigne du code que Ghidra n'avait pas reconnu comme fonction (pilotes, comportements : appels indirects) et que `NameGameFuncs.java` désassemble et crée.

**Études détaillées.** Cinq études s'appuient sur ce corpus : [`player.md`](player.md) (joueur, pilotage, physique des véhicules, commandes, réseau), [`objects.md`](objects.md) (objets, comportements `+0x68`, déplacements, IA), [`rules.md`](rules.md) (règles de jeu : dégâts, bonus, armes, objectifs, victoire), [`render.md`](render.md) (rendu : terrain, triangles, sprites, mode X) et [`screens.md`](screens.md) (menus et écrans, configuration, palettes, Smacker).

<!-- GEN:keyfuncs -->
#### Démarrage, fenêtre et entrées

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00410010` | `gm_clear_keys` | 87 | 32 | Remet à zéro la table des 256 états de touches (00490010) | Boucle 0x100 × dword | certain |
| `00410068` | `gm_enter_fullscreen` | 408 | 3 | Passe en plein écran (_FullScreen32 de DLL32.DLL, ClipCursor, SetWindowPos) | Imports _FullScreen32@4, ClipCursor, SetWindowPos | probable |
| `00410200` | `gm_leave_fullscreen` | 159 | 2 | Quitte le plein écran (_FullScreen32, ShowCursor) | Symétrique de 00410068 | probable |
| `004102a0` | `gm_wndproc` | 1227 | 0 | Procédure de fenêtre ; sur la notification MCI (wParam 1) relance la piste CD courante | Aucun appelant ; DefWindowProcA ; appelle 004115bc avec table de pistes 005bba10[0x484634] | probable |
| `00410770` | `gm_delay_ms` | 51 | 2 | Attente active de EAX millisecondes (GetTickCount) | Corps trivial | certain |
| `004107a4` | `gm_create_window` | 388 | 1 | RegisterClass + CreateWindowEx de la fenêtre du jeu | Imports RegisterClassA, CreateWindowExA, LoadIconA « SWIV_ICON1 » | certain |
| `00410928` | `gm_winmain` | 587 | 0 | WinMain : crée la fenêtre « swiv_win », charge swiv.cfg, GLOBAL.BD, SOUNDS.BD, lance gm_main_game, libère tout | Aucun appelant ; appelle 004107a4, 0046e740, 0046fa58, 004134d8, 00421614, 0046fd8c ; message « Could not create main application window... » | certain |
| `00410bcc` | `gm_poll_events` | 1297 | 3 | Pompe de messages + lecture souris/manette (joyGetPosEx), appelée dans les boucles d'attente | Imports PeekMessageA, GetMessageA, joyGetPosEx, timeGetTime | probable |
| `00411128` | `gm_load_logo_resource` | 87 | 1 | Charge la ressource Windows « MYLOGO » | FindResourceA/LoadResource, chaîne MYLOGO | probable |
| `0041139c` | `gm_paint_logo` | 454 | 1 | WM_PAINT : affiche le logo (StretchDIBits) | Imports BeginPaint, StretchDIBits | probable |

#### Audio CD (MCI) et mixeur

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00411570` | `gm_cd_open` | 73 | 1 | MCI « open cdaudio » + « set cdaudio time format tmsf » | Chaînes 004800a8/b8 | certain |
| `004115bc` | `gm_cd_play_track` | 205 | 4 | Joue la piste EAX (« play cdaudio from %d to %d notify », ou « from %d notify » si dernière piste) ; le drapeau 0x40 de GLOBAL id 2 force la piste 2 | Chaînes MCI ; compare à « number of tracks » | certain |
| `0041168c` | `gm_cd_stop` | 48 | 2 | MCI « stop cdaudio » | Chaîne 00480138 | certain |
| `004116bc` | `gm_cd_close` | 44 | 1 | MCI « close cdaudio » | Chaîne 00480148 | certain |
| `004121dc` | `gm_mixer_set_volume` | 210 | 1 | Applique un volume au mélangeur | mixerSetControlDetails ; appelée par le menu volume 0041a8c4 | probable |
| `004122b0` | `gm_mixer_init` | 913 | 1 | Ouvre le mélangeur Windows (winmm mixer*) pour régler le volume | Imports mixerOpen, mixerGetLineInfoA... | certain |
| `00412644` | `gm_mixer_close` | 43 | 1 | Ferme le mélangeur | mixerClose | certain |

#### SOUNDS.BD et DirectSound

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00412b60` | `gm_sound_find_wav` | 106 | 1 | Retourne le WAV de SOUNDS.BD dont l'id est EAX | Balayage du répertoire (id, 12 octets) | certain |
| `00412bcc` | `gm_dsound_init` | 116 | 1 | DirectSoundCreate + SetCooperativeLevel | Import DirectSoundCreate | certain |
| `00412c84` | `gm_sounds_build_buffers` | 447 | 1 | Pour chaque entrée du répertoire : id/100 = numéro de son, id%100 = nombre d'instances (tampons dupliqués) ; chaîne de structures de 0x18 octets | Division par 100 et modulo 100 de l'id ; appelle 0041364c | certain |
| `00412e44` | `gm_sound_play` | 128 | 14 | Joue le son n° EDX (= id/100) émis par l'objet EAX ; prend une instance libre | Appelée par ~15 fonctions de jeu (ex. gm_frame avec 6000/0x1771) | certain |
| `00412ec4` | `gm_sound_loop_start` | 128 | 1 | Démarre un son en boucle (état 0x0b) | Écrit l'état 0xb dans la structure du son | probable |
| `00412f44` | `gm_sound_loop_stop` | 155 | 2 | Arrête un son en boucle (état 0x0c) | Vtable +0x48 (Stop) | probable |
| `00412fe0` | `gm_sound_stop_all` | 118 | 2 | Arrête tous les sons actifs | Parcours de la liste active | certain |
| `00413058` | `gm_sounds_update_3d` | 971 | 1 | Met à jour pan et volume (SetPan +0x40, SetVolume +0x3c) des sons actifs d'après la position relative à la caméra | Calcul distance/pente puis vtable DirectSound | certain |
| `004134d8` | `gm_sounds_load` | 252 | 1 | Lit tout SOUNDS.BD en mémoire, localise le répertoire final, initialise DirectSound et construit les tampons | Chaînes « I cant open SOUNDS.bd », « Error starting direct sound » ; appelle 00412bcc, 00412c84 | certain |
| `004135d4` | `gm_sounds_release` | 76 | 1 | Libère le tampon SOUNDS.BD | Appelle free 00470381 | probable |
| `0041364c` | `gm_dsound_create_buffer` | 255 | 1 | Crée un tampon DirectSound à partir d'un WAV (format PCM puis données) | CreateSoundBuffer (vtable +0x0c), appelle 00413ecc et 00413e1c | certain |
| `00413e1c` | `gm_dsound_fill_buffer` | 174 | 1 | Verrouille le tampon, copie les données PCM | Lock (+0x2c), Unlock (+0x4c) | certain |
| `00413ecc` | `gm_wav_parse` | 416 | 1 | Analyse un RIFF WAVE : trouve les sous-blocs « fmt » (0x20746d66) et « data » (0x61746164) | Constantes RIFF 0x46464952, WAVE 0x45564157 | certain |

#### Texte et sprites

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `0041508b` | `gm_blit_rle_glyph_a` | 155 | 1 | Sprite RLE à 4 plans (mode X, ports 3c4h) : table d'offsets, opcodes 0x80+ (saut), 0xff (fin de plan), n<<4\|teinte (fondu par table de 64 Ko 005bc180) | Désassemblage : OUT 3C4h, LODSB, test 0x80/0xff | certain |
| `004229c8` | `gm_draw_text` | 519 | 5 | Dessine une chaîne (alignement 0 centré, 1 gauche, 2 droite ; largeur max 0x118) avec la police 507 et les largeurs 508 | Utilise 005bc14c, 005bc164 | certain |
| `00422bdc` | `gm_draw_string_a` | 308 | 1 | Variante de dessin de chaîne (glyphes RLE via 0041508b) | Appelle 0041508b | probable |
| `00422d10` | `gm_draw_string_b` | 308 | 1 | Variante de dessin de chaîne (glyphes via 00415126) | Même structure | probable |
| `00422e44` | `gm_text_width` | 102 | 1 | Largeur en pixels d'une chaîne (somme des largeurs du bloc 508) | Boucle sur les octets | certain |

#### Menus et écrans

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00417ffc` | `gm_menu_gamma` | 1109 | 1 | Réglage gamma (groupe 6) : 4 niveaux, fiche `+0x30`, `gm_modex_enter` ; porté (`flow.ts`) | screens.md §4.6 | certain |
| `00419058` | `gm_screen_pause` | 337 | 1 | Écran de pause (groupe 4) | Groupe 4 | probable |
| `004194b0` | `gm_screen_level_complete` | 1904 | 1 | Fin de niveau / scores (groupe 7) : `gm_clear_keys` en entrée, garde des touches tant que `DAT_005b03e8 < 0x6e` (compteur du niveau, qui court derrière) | Groupe 7 ; screens.md §9 | certain |
| `0041a560` | `gm_menu_music` | 868 | 1 | Menu préférence musicale (groupe 9) : fixe 00484634 et lance la piste | Groupe 9 ; appelle 004115bc | certain |
| `0041a8c4` | `gm_menu_volume` | 1912 | 1 | Menu volumes (groupe 8) | Groupe 8 | probable |
| `0041b03c` | `gm_menu_setup` | 2778 | 2 | Menu Setup (groupe 2) ; appelé aussi par `gm_frame` sur F1 en jeu (paramètre 1 : sauve et restaure `DAT_00480e80`) | Chargements du groupe 2 ; screens.md §4.3 | certain |
| `0041bb40` | `gm_menu_pickups` | 2793 | 1 | Menu Tricher (groupe 100, F12 en mission de test) : 3 pages, `gm_pickup_apply` / `gm_player_set_form` ; porté | screens.md §4.9 | certain |
| `0041d714` | `gm_menu_main` | 1741 | 1 | Menu principal (groupe de chaînes 1) ; « Quitter » isolé entre espaceur 2, trait, espaceur 2 | Chargements du groupe 1 ; screens.md §3 | certain |
| `0041dde4` | `gm_menu_retry` | 2093 | 1 | Choix de mission à rejouer (groupe 11) | Groupe 11 | probable |
| `0041f4d0` | `gm_menu_screengrab` | 935 | 1 | Menu capture d'écran (groupe 12) | Groupe 12 ; appelle 0041ee30 | probable |
| `0041f8e8` | `gm_menu_abort` | 822 | 2 | Confirmation d'abandon (groupe 13) | Groupe 13 | probable |
| `0041ff94` | `gm_menu_multiplayer` | 733 | 1 | Menu multijoueur (groupe 5) | Groupe 5 | probable |
| `00421100` | `gm_start_level` | 1249 | 1 | Lance un niveau (solo ou réseau « netlevNN ») | Chaînes netlev01-12, %s.slv ; appelle 004545a8 | probable |
| `00421614` | `gm_main_game` | 4854 | 1 | Boucle principale des menus et du jeu : démos, intros (intro1/intro2/iplay), niveaux | Chaînes « demo.slv », « %s.slv », intro1, intro2, iplay | certain |

#### Rendu, terrain et boucle de jeu

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00424a24` | `gm_terrain_crater` | 510 | 1 | Abaisse la hauteur autour d'un point (cratère) | Soustractions sur 005b1fc4 | probable |
| `004256c0` | `gm_terrain_height` | 384 | 6 | Hauteur du terrain (carte 512x512 du bloc 100) à (x, z) avec interpolation bilinéaire ; cellule = >>14, fraction = >>6 & 0xff | Masque 0x1ff, *0x200, 005b1fc4 | certain |
| `00425840` | `gm_terrain_map2_sample` | 372 | 0 | Même interpolation sur la carte du bloc 102 | Même code sur 005b1fa8 | probable |
| `0042718c` | `gm_render_objects` | 10909 | 1 | collecte des objets des compartiments 7×7, transformation, Gouraud, mise en file des faces et sprites | Lit 005b1fc4 ; grille 0x3f ; renommée (anciennement gm_render_terrain), render.md §13 | certain |
| `0042b31c` | `gm_render_view` | 14496 | 1 | Rendu d'une vue (terrain, objets, sprites) | 14 Ko ; appelle gm_render_terrain, gm_terrain_height | probable |
| `0042ec80` | `gm_draw_hud` | 2506 | 1 | Affiche le HUD d'un joueur (score « %07d », « %s %2d ») | Chaînes 004803f8, 00480400 | certain |
| `0042f64c` | `gm_frame` | 1174 | 4 | Une image : met à jour les sons, rend chaque vue active (0042b31c), HUD (drapeau 2) ; avec le drapeau 1 et `DAT_005b0414 == 0` : F1 (Setup), Pause, F12 (Tricher), touches de debug | Boucle sur 4 vues de 0x1a dwords à 00480e74 ; screens.md §4.3 | probable |
| `004362b8` | `gm_draw_overlay_sw` | 2372 | 1 | Superposition logicielle (HUD/radar) avec les sprites 510-512 | Lit 005bc178/70/74 | probable |

#### Niveaux .SLV et objets

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `004265ec` | `gm_object_init` | 533 | 3 | Initialise un objet (type, x, y, z en <<8) ; le type 3 creuse un cratère | Écrit +0x1c/+0x20/+0x24 ; appelle 00424a24 | certain |
| `0043e958` | `gm_level_spawn_objects` | 11436 | 1 | Initialise les pools d'objets puis crée les objets décrits par le bloc 105 (enregistrements de 16 octets, type en tête, fin = -1) | Boucle sur 005b1fc8 pas 0x10 jusqu'à 0xffffffff | certain |
| `00453ac4` | `gm_slv_alloc` | 213 | 1 | Alloue le tampon de 2 000 000 octets qui contiendra le .SLV et pose les pointeurs de fin | Constantes 2000000, 0x1e8484 | certain |
| `00453bbc` | `gm_slv_find` | 90 | 1 | Retourne le début du bloc d'id EAX du .SLV | Balayage (offset, taille, id) | certain |
| `00453c18` | `gm_slv_load_tilesets` | 670 | 1 | Parcourt les blocs 12xxx : copie 0x8000 octets alignés et découpe l'atlas 256x256 en 4x4 tuiles de 64x64 | id/1000 == 12, offsets 0x8100, (k&3)*0x40+(k>>2)*0x4000 | certain |
| `00453ed4` | `gm_slv_setup_tiles` | 1308 | 1 | Prépare les textures (blocs 12xxx, 110, 500, 11003) du .SLV | Appelle 0046f0c0, 0046ff9c ; utilise 005b1f9c, 005b1f74, 005b1f98 | probable |
| `004543f0` | `gm_slv_index_models` | 307 | 1 | Indexe les blocs 10xxx (modèles 3D) dans 005b09b0[id%1000] et relocalise leurs champs +0x18/+0x1c | id/1000 == 10 | certain |
| `00454524` | `gm_slv_reloc_list` | 131 | 1 | Relocalise une liste chaînée de la carte | Ajoute la base aux pointeurs | probable |
| `004545a8` | `gm_slv_load` | 1797 | 2 | Ouvre le .SLV, le lit en entier (refus à 2 000 000 octets), indexe les blocs 100-110, 500, 501, 11003, 11004 et lance l'initialisation | Appelée avec « %s.slv » / « demo.slv » ; boucles sur les ids 100, 102, 103, 105-110 | certain |

#### Smacker et fichiers .scr

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00437d68` | `gm_draw_label` | 177 | 1 | Dessine un texte de .scr (style b/g) | Choisit 00422bdc ou 00422d10 | probable |
| `00437e1c` | `gm_draw_scr_overlay` | 143 | 2 | Affiche les lignes .scr valides pour l'image courante (première <= n <= dernière) | Compare à champs +0xc/+0x10 | certain |
| `0046ec40` | `gm_load_scr` | 373 | 1 | Lit le .scr de la vidéo : fscanf « %d %d %d %d %d %d %s %s » | Chaîne 00480460 | certain |
| `0046edb8` | `gm_play_smacker` | 766 | 1 | Joue un .SMK (SmackOpen, boucle SmackWait/DoFrame/NextFrame) ; pour BR_TERn charge le .scr | Chaînes « .smk », « BR_TER » ; imports Smack* | certain |

#### Configuration (swiv.cfg)

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `0046e740` | `gm_cfg_load` | 419 | 1 | Lit swiv.cfg (swivdemo.cfg si drapeau 1) : 300 enregistrements de 128 octets | Chaînes swiv.cfg ; boucle 300 × 0x80 | certain |
| `0046e8e4` | `gm_cfg_save` | 173 | 2 | Écrit swiv.cfg | fwrite 0x80 octets | certain |
| `0046ea44` | `gm_profile_record` | 277 | 12 | Retourne (ou alloue) l'enregistrement de la table 005b20a0 pour la clé de 3 entiers (EAX, EDX, EBX) | 300 emplacements de 32 dwords | probable |

#### GLOBAL.BD (chargement, chaînes)

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `0046f1e8` | `gm_set_language` | 159 | 1 | Applique la langue : table de recodage des caractères 128-255 (005bba28) selon le chiffre de la chaîne partagée (2,0) | Boucle 0x80..0xff, (chiffre<<7)+c | probable |
| `0046f288` | `gm_global_load_block` | 282 | 1 | Charge en mémoire (malloc) le bloc d'id EAX de GLOBAL.BD ; retourne le pointeur | Recherche id dans les entrées de 12 octets (offset, taille, id) ; fseek/malloc/fread | certain |
| `0046f3a4` | `gm_global_read_block` | 259 | 2 | Lit le bloc d'id EAX dans un tampon existant (005bc134, 0x21700 octets) | Même recherche, sans malloc | certain |
| `0046f4a8` | `gm_screen_grab` | 900 | 1 | Sauve l'écran en BMP/TGA dans c:\swivgrab\ | Chaînes c:\swivgrab\%s.bmp / .tga | probable |
| `0046f834` | `gm_global_reloc_strings` | 93 | 1 | Relocalise le bloc 100 : ajoute la base aux pointeurs des tables de chaînes | Boucle sur entrées (clé, ptr) jusqu'à -1 | certain |
| `0046f894` | `gm_global_reloc_objtable` | 94 | 1 | Relocalise le bloc 200 : 0x400 enregistrements de 28 octets, champs +4, +0xc, +0x14 | Boucle 0x400, pas 0x1c | certain |
| `0046f8f4` | `gm_get_string` | 187 | 31 | Chaîne du groupe EAX, n° EDX dans la langue courante (clé = langue<<16 + groupe) | Messages « Unknown Block » / « Unknown String » | certain |
| `0046f9b0` | `gm_get_string_shared` | 165 | 2 | Idem pour les groupes communs (clé 0x630000 + groupe) | Constante 0x630000 | certain |
| `0046fa58` | `gm_global_init` | 819 | 1 | Ouvre GLOBAL.BD, lit le répertoire final, charge et relocalise les blocs (2, 100, 200, 5xx, 600, 700, 800, 1001-1005) | Chaîne « I cant open GLOBAL.bd » ; appels 0046f288 avec les ids | certain |
| `0046fd8c` | `gm_global_free` | 242 | 1 | Libère les blocs de GLOBAL.BD | Appelle free sur les globales | probable |

#### Étude du joueur

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00410b74` | `gm_joy_read_axes` | 85 | 1 | lit 'joyGetPosEx' pour la calibration | player.md §7 | non précisé |
| `00411eb8` | `gm_net_receive` | 605 | 1 | reçoit les messages DirectPlay (joueurs distants) | player.md §7 | non précisé |
| `004157d0` | `gm_menu_anim_tick` | 228 | 1 | décompte animé des scores des menus (drapeau 2 de 'gm_poll_events') | player.md §7 | non précisé |
| `004234ec` | `gm_effects_tick` | 233 | 1 | tick des messages 3D '005876dc' (25 ms, drapeau 4 de 'gm_poll_events') : vie, rotation, 'pos += vel' ; inverse la liste | rules.md §8.1 | certain |
| `00438678` | `gm_pilot_none` | 26 | 0 | fonction pilote vide (formes '0x2a', '0x63') | player.md §7 | non précisé |
| `00438694` | `gm_pilot_wheels` | 176 | 0 | pilote coupé des formes 1 et 2 (amarrage au sol '004482dc', Super Ressort '0045e128') : braquage vers la cible par pas de 8, roues en modes 3, 3, 4, 4 | player.md §3.6 | certain |
| `00438744` | `gm_pilot_start_1002` | 1285 | 0 | départ scripté du type 1002 (forme '0x2b') : vol, tir spécial, crash, explosions puis forme 4 ; pas une séquence de mort ; absent des niveaux livrés, non porté | player.md §3.12 | certain |
| `00438c68` | `gm_pilot_wheels_2` | 157 | 0 | variante motoneige de 'gm_pilot_wheels' (modes 1, 1, 2), installée par '004495f8' (types 7012/7013, absents des niveaux livrés, non porté) | player.md §3.6 | certain |
| `00439088` | `gm_pilot_heli` | 1511 | 0 | pilote de l'hélicoptère, forme 0 ; `+0x94 = cap` et tirs avant l'intégration des angles | player.md §3.2 | certain |
| `00439670` | `gm_pilot_heli_net` | 1369 | 0 | même, joueur réseau (entrées '+0xe4..') | player.md §7 | non précisé |
| `00439bcc` | `gm_pilot_heli_3` | 1447 | 0 | pilote forme 3 | player.md §7 | non précisé |
| `0043a174` | `gm_pilot_vehicle_1` | 1514 | 0 | pilote forme 1 (roues) ; `+0x94 = cap` après le tir | player.md §7 | non précisé |
| `0043a760` | `gm_pilot_vehicle_2` | 1284 | 0 | pilote forme 2 | player.md §7 | non précisé |
| `0043ac64` | `gm_pilot_vehicle_4` | 1094 | 0 | pilote forme 4 | player.md §7 | non précisé |
| `0043b0ac` | `gm_pilot_vehicle_5` | 1094 | 0 | pilote forme 5 | player.md §7 | non précisé |
| `0043c234` | `gm_game_tick` | 1918 | 2 | un tick de logique (25 ms) : objets, fonctions pilote, mort, jauge de PV | player.md §7 | non précisé |
| `0043ca60` | `gm_player_load_keys` | 83 | 1 | recopie 11 touches du profil dans le joueur (aussi à la sortie du Setup ouvert par F1) | player.md §7 ; autres noms proposés : rules.md : gm_player_copy_controls | non précisé |
| `0043daa0` | `gm_net_send_input_client` | 245 | 1 | émission réseau (hypothèse) | player.md §7 | hypothèse |
| `0043db98` | `gm_net_send_state_host` | 628 | 1 | émission réseau (hypothèse) | player.md §7 | hypothèse |
| `0043e5c4` | `gm_player_join_local` | 530 | 2 | place un joueur sur un point de départ | player.md §7 | non précisé |
| `0043e7d8` | `gm_player_join_net` | 383 | 2 | idem, joueur réseau | player.md §7 | non précisé |
| `004418b0` | `gm_wheel_attach` | 578 | 1 | pose une roue enfant à son emplacement (table '00484324') dans le repère du joueur, relevée à sol + 2 000 sous sol + 4 000 | player.md §3.6 | certain |
| `004446a0` | `gm_wheel_update` | 1088 | 4 | place, oriente et fait tourner une roue enfant du joueur (5 modes : avant, arrière, motoneige, ski ; modèle '0x3d6' dans l'eau) | player.md §3.6 | certain |
| `00444af8` | `gm_heli_physics` | 1017 | 0 | physique de l'hélicoptère (altitude assistée, poussée par tangage/roulis, choc) | player.md §7 ; autres noms proposés : objects.md : gm_aircraft_fly ; rules.md : gm_vehicle_hover_physics | non précisé |
| `00445228` | `gm_vehicle_physics_1` | 1096 | 0 | physique du véhicule forme 1 | player.md §7 ; autres noms proposés : objects.md : gm_upd_player_00445228 | non précisé |
| `00445670` | `gm_vehicle_physics_2` | 1042 | 0 | physique du véhicule forme 2 | player.md §7 ; autres noms proposés : objects.md : gm_upd_player_00445670 | non précisé |
| `00445a84` | `gm_vehicle_physics_4` | 1214 | 0 | physique du véhicule forme 4 | player.md §7 ; autres noms proposés : objects.md : gm_upd_player_00445a84 | non précisé |
| `00445f44` | `gm_vehicle_physics_5` | 1146 | 0 | physique du véhicule forme 5 | player.md §7 ; autres noms proposés : objects.md : gm_upd_player_00445f44 | non précisé |
| `004582dc` | `gm_weapon_select` | 689 | 8 | choix de l'arme : -1 suivante, -2 précédente, 0..9 directe (2 banques) | player.md §7 | non précisé |
| `00458590` | `gm_fire_special` | 51 | 8 | déclenche le tir spécial | player.md §7 ; autres noms proposés : rules.md : gm_special_fire | non précisé |
| `0046b6fc` | `gm_fire_primary` | 6827 | 7 | tir principal (armes, R3) | player.md §7 ; autres noms proposés : rules.md : gm_primary_fire | non précisé |

#### Étude du rendu

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `0041406c` | `gm_fb_clear_sky` | 260 | 1 | efface les lignes au-dessus de l'horizon (MMX) | render.md §13 | certain |
| `004141d0` | `gm_terrain_strip_scalar` | 808 | 1 | bande de terrain texturée, entiers | render.md §13 | certain |
| `004144f8` | `gm_emms` | 3 | 1 | 'EMMS; RET' | render.md §13 | certain |
| `004144fb` | `gm_terrain_strip_mmx` | 740 | 1 | bande de terrain texturée, MMX | render.md §13 | certain |
| `004147df` | `gm_terrain_strip_flat` | 506 | 1 | bande de terrain à couleur plate (table 106) | render.md §13 | certain |
| `004153db` | `gm_vec2_normalize_256` | 85 | 2 | idem en (x, z) | render.md §13 | probable |
| `00422eac` | `gm_queue_reset` | 121 | 1 | file à zéro (2995 entrées) | render.md §13 | certain |
| `004232ac` | `gm_deformers_apply` | 573 | 3 | déformations du terrain (onde de la bombe, mur d'eau de la méga-bombe, anneau de la caméra 7800) sur un sommet de terrain, de modèle ou de sprite ; réserve de 5 nœuds `0056f2d8` | render.md §10 | certain |
| `00423620` | `gm_queue_insert` | 682 | 2 | insertion triée dans la file des primitives, rejet hors écran | render.md §13 | certain |
| `00423974` | `gm_text3d_emit_glyph` | 2783 | 1 | enfile les triangles d'une lettre 3D du bloc 200 | render.md §13 | probable |
| `0042469c` | `gm_gamma_build` | 223 | 1 | table de gamma 4×64 'pow' | render.md §13 | certain |
| `0042477c` | `gm_render_init_tables` | 631 | 1 | réciproques, racines, cercle du rotor ('0052cae8'), pointeurs de colonnes | render.md §13 | certain |
| `004259b4` | `gm_ground_flash_add` | 716 | 1 | éclair d'explosion dans la carte 64×64 '005624c8' | render.md §13 | certain |
| `00425c94` | `gm_terrain_height_water` | 1101 | 4 | hauteur bilinéaire 8.8 avec vagues | render.md §13 ; autres noms proposés : objects.md : gm_terrain_height_waves | certain |
| `004268fc` | `gm_terrain_project_flat` | 789 | 2 | projection d'un sommet sans éclairage, drapeau visible, horizon | render.md §13 | certain |
| `00426c14` | `gm_terrain_project_lit` | 1361 | 1 | projection + éclairage + vagues d'un sommet | render.md §13 | certain |
| `00429c30` | `gm_terrain_clip_row` | 491 | 1 | borne une rangée à ses sommets visibles | render.md §13 | certain |
| `00429e1c` | `gm_terrain_build_rows` | 497 | 1 | construit les rangées proches (pas 1) et lointaines (pas 2) | render.md §13 | certain |
| `0042b05c` | `gm_terrain_pick_row_dir` | 670 | 1 | direction de rangée parmi 8 d'après la droite de la caméra | render.md §13 | certain |
| `0042faf0` | `gm_vec3_normalize_f` | 103 | 1 | normalise un vecteur flottant | render.md §13 | certain |
| `0042fba8` | `gm_vec3_cross_f` | 119 | 1 | produit vectoriel flottant | render.md §13 | certain |
| `0042fc70` | `gm_ground_flash_fade` | 57 | 1 | décroissance de 0x1e par pas | render.md §13 | certain |
| `0042fcac` | `gm_detect_mmx` | 80 | 1 | CPUID bit 23 → '00484620'/'00484624' | render.md §13 | certain |
| `0042fd24` | `gm_screen_load_planes` | 102 | 2 | copie un écran 320×400 planaire (bloc 100x) dans le tampon | render.md §13 | certain |
| `0042fd8c` | `gm_fb_clear_all` | 38 | 2 | efface le tampon (sans MMX) | render.md §13 | certain |
| `0042fddc` | `gm_palette_set` | 102 | 4 | efface l'écran, charge le DAC avec gamma, mémorise la palette | render.md §13 ; autres noms proposés : screens.md : gm_screen_set_palette | certain |
| `0042fe44` | `gm_modex_enter` | 128 | 3 | CRTC/séquenceur mode X, efface, palette | render.md §13 ; autres noms proposés : screens.md : gm_gamma_apply | certain |
| `0042fec4` | `gm_modex_enter_black` | 120 | 1 | idem avec palette noire | render.md §13 | certain |
| `0042ff5c` | `gm_present_flip` | 250 | 6 | copie du tampon vers la VRAM et bascule de page | render.md §13 ; autres noms proposés : screens.md : gm_screen_flip | certain |
| `00430058` | `gm_draw_line` | 806 | 1 | trait coloré d'un objet à un autre | render.md §13 | certain |
| `00430380` | `gm_tri_gouraud` | 3008 | 1 | triangle texturé, lumière interpolée | render.md §13 | certain |
| `00430f40` | `gm_tri_flat` | 2667 | 2 | triangle texturé, lumière unie | render.md §13 | certain |
| `00432264` | `gm_tri_shadow_black` | 1871 | 1 | polygone noir (ombre, détail faible) | render.md §13 | certain |
| `004329b4` | `gm_tri_keyed` | 2656 | 1 | triangle à texel 0 transparent, non éclairé | render.md §13 | certain |
| `00433414` | `gm_tri_rotor` | 2894 | 1 | disque de rotor : masque 500 × table 500 | render.md §13 | certain |
| `00433f64` | `gm_tri_shadow` | 2631 | 1 | ombre : silhouette 110 × table 500 | render.md §13 | certain |
| `004349ac` | `gm_tri_blend504` | 2631 | 1 | triangle mélangé, image 504 × table 109 | render.md §13 | certain |
| `004353f4` | `gm_sprite_505` | 659 | 1 | sprite 21×35 d'explosion/impact | render.md §13 | certain |
| `00435688` | `gm_sprite_504` | 829 | 1 | animation d'explosion 64×64 mise à l'échelle | render.md §13 | certain |
| `004359c8` | `gm_draw_flat_tri` | 1714 | 1 | triangle de couleur unie (texte 3D) | render.md §13 | certain |
| `00437b64` | `gm_water_animate` | 210 | 1 | tuile d'eau gauchie par des sinus | render.md §13 | certain |
| `00470cb8` | `gm_pow` | 16 | 1 | puissance | render.md §13 | certain |
| `00470cc8` | `gm_ftol_trunc` | 29 | 5 | flottant → entier par troncature ('__CHP') | render.md §13 | certain |
| `00470ce6` | `gm_sqrt` | 48 | 2 | racine carrée | render.md §13 | certain |

#### Étude des écrans

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00414c7e` | `gm_blit_rle_glyph` | 148 | 3 | Glyphe RLE standard (utilisé par 'gm_draw_text') | screens.md §12 | certain |
| `00415126` | `gm_blit_rle_glyph_b` | 157 | 1 | Glyphe RLE, teinte divisée par deux (style 'g') | screens.md §12 | certain |
| `004158e8` | `gm_menu_add` | 226 | 31 | Ajoute une ou plusieurs lignes de menu depuis une chaîne ('\ ' = saut de ligne) | screens.md §12 | certain |
| `00415a20` | `gm_menu_run` | 3551 | 29 | Moteur de menu : tracé (bandeaux de mélange + texte), navigation, curseurs ; renvoie l'id ou -1. `gm_clear_keys` à chaque appel ; `gm_poll_events(7)` avec le drapeau 4, `(4)` avec 8, sinon `(6)` (monde figé) ; `gm_frame(2)` avec 0x10, sinon `(0)` | screens.md §4.1 | certain |
| `00416834` | `gm_menu_select` | 123 | 16 | Place la sélection initiale sur l'id donné | screens.md §12 | certain |
| `004168b0` | `gm_menu_capture_key` | 670 | 1 | « Appuyez sur la touche pour… » : capture d'une touche (refuse les noms `#…` hors mode test) ; porté | screens.md §4.4 ; autres noms proposés : player.md : gm_menu_ctrl_misc | certain |
| `00416b50` | `gm_menu_calibrate` | 1632 | 1 | Calibrage manette / Gravis (chaînes `3/330..343`) ; non porté (Gamepad API) | screens.md §4.4 ; autres noms proposés : player.md : gm_menu_joy_calibrate | probable |
| `004171b4` | `gm_menu_controller_type` | 1965 | 1 | Choix du type de contrôleur (groupe 3, ids 100/101, 11-16), touches et axes par défaut du type ; porté (types 1-3) | screens.md §4.4 ; autres noms proposés : player.md : gm_menu_ctrl_type | certain |
| `0041797c` | `gm_menu_axis_bindings` | 1629 | 1 | Liaison des axes (groupe 3, 1000-1013), « Attacher au centre » ; porté | screens.md §4.4 ; autres noms proposés : player.md : gm_menu_ctrl_axes | certain |
| `00418454` | `gm_menu_controller` | 2809 | 2 | Menu « Configuration du contrôleur » : type, liens d'axes, 11 touches ; porté | screens.md §4.4 ; autres noms proposés : player.md : gm_menu_ctrl_bindings | certain |
| `00418f54` | `gm_controller_check` | 229 | 1 | Rouvre le menu contrôleur si le type de contrôleur est absent ou non configuré | screens.md §12 | certain |
| `004191ac` | `gm_menu_language` | 772 | 1 | Choix de la langue (liste de la table commune 0) | screens.md §12 | certain |
| `00419c20` | `gm_screen_net_stats` | 693 | 1 | Statistiques réseau de fin de partie (groupe 5, 500/501) | screens.md §12 | probable |
| `0041c640` | `gm_screen_new_pilot` | 1589 | 1 | Saisie du nom d'un nouveau pilote (15 car., code 'SWIV!AndLetDie') | screens.md §12 | certain |
| `0041cc78` | `gm_screen_delete_pilot` | 819 | 1 | Suppression d'un pilote (sans confirmation) | screens.md §12 | certain |
| `0041cfac` | `gm_screen_select_pilot` | 1894 | 1 | Écran de sélection du pilote | screens.md §12 | certain |
| `0041e614` | `gm_menu_test_mission` | 2074 | 1 | Menu de mission de test (groupe 11, ids 20/21, pages Retour / Suivant) ; porté | screens.md §4.9 | certain |
| `0041ee30` | `gm_menu_grab_name` | 1694 | 1 | Saisie du nom de fichier de capture (groupe 12) | screens.md §12 | probable |
| `0041fc20` | `gm_menu_exit` | 831 | 1 | Confirmation de sortie (groupe 13, phrases 30..33 en rotation) | screens.md §12 | certain |
| `004235d8` | `gm_title_release` | 70 | 26 | Déclenche la sortie des titres 3D (vie ≥ 1000 : − 0x3d4) | screens.md §4.1 | certain |
| `004360b0` | `gm_fill_blend` | 519 | 1 | Remplit un rectangle de la page avec une ligne de la table de mélange ('x0, y0, x1, y1, ligne') | screens.md §12 | certain |
| `00437eac` | `gm_smk_present` | 191 | 1 | Présente une image Smacker : attente verticale, copie, tracé du '.SCR', bascule | screens.md §12 | certain |
| `0046e994` | `gm_cfg_save_exit` | 26 | 1 | Appelle 'gm_cfg_save' à la sortie | screens.md §12 | certain |
| `0046e9b0` | `gm_state_copy` | 80 | 1 | Copie les 28 dwords d'état d'une fiche à une autre | screens.md §12 | certain |
| `0046ea00` | `gm_state_clear` | 67 | 1 | Met à zéro les 28 dwords d'état d'une mission | screens.md §12 | certain |
| `0046eb5c` | `gm_profile_data` | 57 | 1 | 'gm_profile_record' + 12 (adresse des données) | screens.md §12 | certain |
| `0046eb98` | `gm_profile_delete` | 160 | 1 | Libère les cases de fiche dont la clé correspond (joker '-1' par champ) | screens.md §12 | certain |
| `0046feec` | `gm_gfx_hook_a` | 26 | 7 | Fonction vide (accroche 3Dfx/D3D, codes 3000-3008) | screens.md §12 | certain |
| `0046ff08` | `gm_gfx_hook_b` | 26 | 2 | Idem | screens.md §12 | certain |
| `0046ff24` | `gm_gfx_hook_c` | 21 | 1 | Idem | screens.md §12 | certain |
| `0046ff3c` | `gm_gfx_hook_flip` | 21 | 3 | Idem (bascule des versions accélérées) | screens.md §12 | certain |

#### Étude des objets

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00415374` | `gm_vec_normalize256` | 103 | 6 | normalise un vecteur 3D à la longueur 256 (tables '0055a4c8', '005836ac') | objects.md §12 ; autres noms proposés : player.md : gm_normalize_delta ; render.md : gm_vec3_normalize_256 | certain |
| `00424db4` | `gm_crater_site_ok` | 399 | 1 | test d'emplacement avant cratère | objects.md §12 | hypothèse |
| `00424f44` | `gm_terrain_explosion_crater` | 1916 | 1 | cratère d'explosion (bloc 700) | objects.md §12 | certain |
| `004261a0` | `gm_object_clone` | 259 | 17 | alloue et clone un enfant de EBX (§4.2) | objects.md §12 ; autres noms proposés : rules.md : gm_object_spawn_from | certain |
| `004262a4` | `gm_node_claim_ground` | 278 | 0 | nœud 107 libre le plus proche, compteur '+0x20' | objects.md §12 | certain |
| `004263bc` | `gm_node_claim_boat` | 278 | 0 | idem compteur '+0x18' | objects.md §12 | certain |
| `004264d4` | `gm_node_claim_air` | 278 | 0 | idem compteur '+0x1c' | objects.md §12 | certain |
| `00426814` | `gm_object_spawn` | 123 | 3 | alloue un objet et appelle 'gm_object_init' | objects.md §12 ; autres noms proposés : rules.md : gm_object_spawn_at | certain |
| `00426890` | `gm_object_spawn_raw` | 105 | 1 | idem sans test du mode réseau | objects.md §12 | probable |
| `0042a010` | `gm_model_radius2` | 71 | 2 | rayon² d'un modèle (100 si sprite ou 0) | objects.md §12 ; autres noms proposés : player.md : gm_type_radius2 ; rules.md : gm_object_collide_radius | certain |
| `0042a084` | `gm_objects_update` | 2236 | 1 | boucle de mise à jour des objets (§2) : anneaux autour des joueurs, mouvement, appel '+0x68', collisions | objects.md §12 ; autres noms proposés : rules.md : gm_world_update_collide ; render.md : gm_game_step_solo | certain |
| `0042a940` | `gm_objects_update_net` | 1339 | 1 | variante réseau (les 4 096 cellules, pas d'anneaux) | objects.md §12 ; autres noms proposés : rules.md : gm_world_update_collide_net ; render.md : gm_game_step_net | certain |
| `0042ae7c` | `gm_grid_query` | 265 | 1 | objets des '(2r+1)²' cellules dont la classe vérifie 'masque == valeur', chaînés par '+0x60' | objects.md §12 ; autres noms proposés : rules.md : gm_find_objects_near_obj | certain |
| `0042af88` | `gm_grid_query_cells` | 212 | 4 | variante sans la liste de la cellule de l'objet | objects.md §12 ; autres noms proposés : rules.md : gm_find_objects_near_pos | probable |
| `0042ebc4` | `gm_score_add` | 94 | 0 | ajoute des points au joueur qui a donné le coup fatal | objects.md §12 | certain |
| `0043c164` | `gm_find_nearest_player` | 208 | 1 | joueur le plus proche (non ignoré) dans '+0x58' | objects.md §12 ; autres noms proposés : rules.md : gm_nearest_player | certain |
| `0043cab4` | `gm_player_init_state` | 605 | 3 | initialise la structure joueur de 0x228 octets | objects.md §12 ; autres noms proposés : rules.md : gm_player_load_profile | probable |
| `0043cda4` | `gm_objective_register` | 198 | 1 | inscrit un objet dans un groupe d'objectifs 0-9 | objects.md §12 | certain |
| `0043ce6c` | `gm_objective_unregister` | 454 | 1 | désinscrit à la mort, déclenche messages/fin de niveau | objects.md §12 ; autres noms proposés : rules.md : gm_objective_target_killed | certain |
| `0043de0c` | `gm_player_set_form` | 1961 | 5 | change la forme du joueur (990/991, classe, update) | objects.md §12 ; autres noms proposés : rules.md : gm_player_set_vehicle | certain |
| `00441630` | `gm_upd_fx_00441630` | 26 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `0044167c` | `gm_turret_aim_fire` | 542 | 0 | vise parmi 5 options et tire | objects.md §12 | certain |
| `00441af4` | `gm_turn_toward_target` | 265 | 1 | virages vers la cible | objects.md §12 | probable |
| `00441c00` | `gm_child_limit_angles` | 320 | 0 | borne tangage/roulis d'un enfant | objects.md §12 | probable |
| `00441d40` | `gm_child_copy_tilt` | 187 | 4 | tangage/roulis d'un enfant selon le parent | objects.md §12 | probable |
| `00441dfc` | `gm_aim_toward_target` | 662 | 1 | virages vers la cible | objects.md §12 | probable |
| `004420a4` | `gm_aircraft_turn_to_point` | 720 | 0 | virage avion avec roulis | objects.md §12 | probable |
| `00442398` | `gm_aircraft_turn_to_point2` | 514 | 0 | variante | objects.md §12 | probable |
| `004425c0` | `gm_node_distance_ground` | 253 | 2 | distance de graphe approchée | objects.md §12 | certain |
| `004426c0` | `gm_node_chase_ground` | 413 | 0 | nœud voisin libre le plus proche de la cible | objects.md §12 | certain |
| `00442860` | `gm_node_patrol_ground` | 198 | 0 | nœud voisin libre suivant | objects.md §12 | certain |
| `00442928` | `gm_node_distance_air` | 253 | 2 | distance de graphe approchée | objects.md §12 | certain |
| `00442a28` | `gm_node_chase_air` | 413 | 0 | nœud voisin libre le plus proche de la cible | objects.md §12 | certain |
| `00442bc8` | `gm_node_patrol_air` | 198 | 0 | nœud voisin libre suivant | objects.md §12 | certain |
| `00442dac` | `gm_node_distance_boat` | 253 | 2 | distance de graphe approchée | objects.md §12 | certain |
| `00442eac` | `gm_node_chase_boat` | 413 | 0 | nœud voisin libre le plus proche de la cible | objects.md §12 | certain |
| `0044304c` | `gm_node_patrol_boat` | 198 | 0 | nœud voisin libre suivant | objects.md §12 | certain |
| `00443114` | `gm_steer_to_point` | 366 | 0 | choix entre 5 virages vers un point | objects.md §12 | certain |
| `00443284` | `gm_steer_to_node` | 310 | 0 | cap vers le nœud courant, 'D²' | objects.md §12 | certain |
| `00443510` | `gm_vehicle_suspension` | 1064 | 0 | 4 coins, ressorts, poussée | objects.md §12 ; autres noms proposés : player.md : gm_vehicle_contact | certain |
| `00443938` | `gm_acquire_target` | 312 | 0 | ciblage périodique par grille (§8.1) | objects.md §12 ; autres noms proposés : rules.md : gm_buddy_scan_targets | certain |
| `00443a70` | `gm_upd_fx_00443a70` | 79 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `00443ac0` | `gm_object_explode` | 383 | 1 | explosion par classe de rayon (modèles 900-902, son 1000) | objects.md §12 | certain |
| `00443c40` | `gm_upd_fx_00443c40` | 70 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `00443c88` | `gm_projectile_burst` | 107 | 0 | petite explosion de projectile (sprite 11000) | objects.md §12 ; autres noms proposés : rules.md : gm_spawn_explosion_00443c88 | certain |
| `00443cf4` | `gm_upd_fx_00443cf4` | 70 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `00443db8` | `gm_upd_fx_00443db8` | 70 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `00443e7c` | `gm_upd_fx_00443e7c` | 84 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `00443ed0` | `gm_spawn_smoke_rise` | 165 | 1 | bouffée de fumée montante (sprite 11004 frame 46) | objects.md §12 ; autres noms proposés : rules.md : gm_spawn_explosion_00443ed0 | certain |
| `00443f78` | `gm_upd_fx_00443f78` | 107 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `00444050` | `gm_upd_fx_00444050` | 51 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `00444084` | `gm_smoke_trail` | 130 | 2 | traînée de fumée de missile (sprite 11001) | objects.md §12 ; autres noms proposés : rules.md : gm_missile_trail_puff | certain |
| `00444108` | `gm_upd_fx_00444108` | 33 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `0044412c` | `gm_upd_fx_0044412c` | 223 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `0044420c` | `gm_upd_fx_0044420c` | 224 | 0 | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte | objects.md §12 | certain |
| `004442ec` | `gm_object_debris` | 948 | 2 | épave et éclats du bloc 11004 | objects.md §12 ; autres noms proposés : rules.md : gm_spawn_debris | certain |
| `00444ef4` | `gm_hover_follow_terrain` | 208 | 0 | 'vy' pour suivre le relief à une hauteur donnée | objects.md §12 | certain |
| `004450a8` | `gm_upd_player_004450a8` | 26 | 0 | comportement vide : roues du joueur ('0043de0c', tout est fait par le pilote via '004446a0') et un objet du réseau ('004126ec') | objects.md §12 | probable |
| `004450c4` | `gm_upd_wheel` | 339 | 0 | roue de 5002 : vitesse du corps, rotation selon la vitesse, posée par '004580f0' dans le repère complet du corps | objects.md §12 | certain |
| `004463c0` | `gm_pickup_update` | 1290 | 0 | comportement d'un bonus : flotte, attiré, appliqué | objects.md §12 ; autres noms proposés : rules.md : gm_pickup_behavior | certain |
| `004468cc` | `gm_upd_pickup_after_all` | 149 | 0 | attend '005af3a4 == 1' puis crée le bonus (7001) | objects.md §12 | certain |
| `00446964` | `gm_upd_pickup_after_group9` | 149 | 0 | attend '005b03e4 == 9' (7002) | objects.md §12 | certain |
| `004469fc` | `gm_upd_pickup_placed` | 61 | 0 | bonus posé (compteur '+0x198') | objects.md §12 | certain |
| `00446a3c` | `gm_upd_pickup_dropped` | 61 | 0 | bonus largué (compteur '+0x194') | objects.md §12 | certain |
| `00446a7c` | `gm_upd_camera` | 675 | 0 | caméra de scénario (7800-7801), compagnon de '1002' | objects.md §12 | probable |
| `00446d24` | `gm_upd_destructible` | 362 | 0 | cible statique (§6.1) | objects.md §12 | certain |
| `00446e90` | `gm_upd_companion` | 106 | 0 | caméra de scénario (7800-7801), compagnon de '1002' | objects.md §12 | probable |
| `00446efc` | `gm_upd_dock_flying` | 381 | 0 | mouvements d'amarrage du joueur sur une plate-forme (lus ; P) | objects.md §12 | non précisé |
| `00447080` | `gm_upd_dock_ground` | 1839 | 0 | mouvements d'amarrage du joueur sur une plate-forme (lus ; P) | objects.md §12 | non précisé |
| `004477b0` | `gm_upd_pad_004477b0` | 820 | 0 | variantes de plates-formes (7012-7013 et au-delà), **non lues** | objects.md §12 | hypothèse |
| `00447afc` | `gm_upd_pad_00447afc` | 1839 | 0 | variantes de plates-formes (7012-7013 et au-delà), **non lues** | objects.md §12 | hypothèse |
| `0044822c` | `gm_upd_pad_helper` | 173 | 0 | objet auxiliaire du pad | objects.md §12 | certain |
| `004482dc` | `gm_upd_transform_pad` | 1157 | 0 | plate-forme de transformation (§6.11) | objects.md §12 | certain |
| `0044878c` | `gm_upd_pad_0044878c` | 2360 | 0 | variantes de plates-formes (7012-7013 et au-delà), **non lues** | objects.md §12 | hypothèse |
| `004490cc` | `gm_upd_pad_004490cc` | 795 | 0 | variantes de plates-formes (7012-7013 et au-delà), **non lues** | objects.md §12 | hypothèse |
| `004493e8` | `gm_upd_pad_004493e8` | 504 | 0 | variantes de plates-formes (7012-7013 et au-delà), **non lues** | objects.md §12 | hypothèse |
| `004495f8` | `gm_upd_pad_004495f8` | 1157 | 0 | variantes de plates-formes (7012-7013 et au-delà), **non lues** | objects.md §12 | hypothèse |
| `00449c10` | `gm_upd_falling_wreck` | 232 | 0 | épave d'avion qui tombe | objects.md §12 | certain |
| `0044ac88` | `gm_upd_turret` | 1243 | 0 | tourelle de 3000 | objects.md §12 | certain |
| `0044b848` | `gm_upd_beam_gun` | 393 | 0 | canon à faisceau (3001) | objects.md §12 | certain |
| `0044bca8` | `gm_upd_ground_vehicle` | 783 | 0 | char / véhicule à roues | objects.md §12 | certain |
| `0044cf1c` | `gm_upd_boat` | 763 | 0 | navire | objects.md §12 | certain |
| `0044d470` | `gm_upd_vehicle_turret` | 427 | 0 | tourelle de véhicule | objects.md §12 | certain |
| `0044d804` | `gm_upd_vehicle_factory` | 305 | 0 | fabrique de chars (6000) | objects.md §12 | certain |
| `0044d938` | `gm_upd_attack_plane` | 509 | 0 | avions des pistes | objects.md §12 | certain |
| `0044db38` | `gm_upd_attack_plane2` | 865 | 0 | avions des pistes | objects.md §12 | certain |
| `0044de9c` | `gm_upd_antenna` | 250 | 0 | antenne/radar décoratif | objects.md §12 | certain |
| `0044df98` | `gm_upd_airstrip_0044df98` | 349 | 0 | pistes d'avions 6100/6101/6110 | objects.md §12 | certain |
| `0044e0f8` | `gm_upd_airstrip_0044e0f8` | 478 | 0 | pistes d'avions 6100/6101/6110 | objects.md §12 | certain |
| `0044e2d8` | `gm_upd_airstrip_0044e2d8` | 349 | 0 | pistes d'avions 6100/6101/6110 | objects.md §12 | certain |
| `0044e438` | `gm_upd_kamikaze_heli` | 798 | 0 | 4001 | objects.md §12 | certain |
| `0044e758` | `gm_upd_node_plane` | 688 | 0 | 4002 | objects.md §12 | certain |
| `004516f4` | `gm_upd_fighter` | 664 | 0 | 6300 et ses chasseurs | objects.md §12 | certain |
| `0045199c` | `gm_upd_fighter_spawner` | 369 | 0 | 6300 et ses chasseurs | objects.md §12 | certain |
| `00454ce0` | `gm_missile_steer` | 1072 | 0 | poussée et guidage de missile | objects.md §12 | certain |
| `00455190` | `gm_upd_missile_coast` | 93 | 0 | missiles et fusées | objects.md §12 | certain |
| `00455278` | `gm_upd_missile_b` | 135 | 0 | missiles et fusées | objects.md §12 | certain |
| `00456814` | `gm_set_local_velocity` | 339 | 7 | vitesse d'un projectile en repère du tireur | objects.md §12 | certain |
| `00456f78` | `gm_upd_missile_a` | 135 | 0 | missiles et fusées | objects.md §12 | certain |
| `00457d4c` | `gm_upd_rocket` | 775 | 0 | missiles et fusées | objects.md §12 | certain |
| `004580f0` | `gm_attach_offset` | 489 | 6 | place un enfant à un décalage rotatif du parent | objects.md §12 ; autres noms proposés : rules.md : gm_attach_to_player | certain |
| `004585c4` | `gm_pickup_apply` | 2497 | 2 | applique le bonus (voir 'rules.md') | objects.md §12 | certain |
| `00458f88` | `gm_pickup_can_take` | 2456 | 1 | le joueur peut-il prendre ce bonus (plafond) ? | objects.md §12 ; autres noms proposés : rules.md : gm_pickup_can_collect | certain |
| `0046d1f8` | `gm_enemy_fire` | 5427 | 7 | programmes d'armes ennemis (§8.2) | objects.md §12 ; autres noms proposés : rules.md : gm_enemy_fire_pattern | certain |

#### Étude des règles

| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |
|---|---|---:|---:|---|---|---|
| `00419ed8` | `gm_screen_game_over` | 1669 | 1 | écran de fin « Game over » (mêmes entrées et garde que `gm_screen_level_complete`) | screens.md §9 | non précisé |
| `00422f28` | `gm_message_pool_init` | 100 | 2 | initialise les 50 messages flottants | rules.md §9 | non précisé |
| `00422f8c` | `gm_message_spawn` | 702 | 28 | message flottant 3D (EAX table, EDX id, EBX teinte, ECX type) ; type 11 = titre de menu | rules.md §8, screens.md §4.1 | certain |
| `00424454` | `gm_message_draw` | 527 | 1 | dessin des messages flottants (police vectorielle) | rules.md §9 ; autres noms proposés : render.md : gm_text3d_draw_all | non précisé |
| `00437af0` | `gm_draw_energy_gauge` | 113 | 1 | jauge d'énergie (bloc 503) | rules.md §9 | non précisé |
| `00437c38` | `gm_draw_crosshair` | 301 | 1 | une moitié du viseur (bloc 506) | rules.md §9 | non précisé |
| `00438198` | `gm_player_pick_target` | 571 | 1 | choisit la cible '+0x58' (produit scalaire + biais objectifs) | rules.md §9 ; autres noms proposés : player.md : gm_player_retarget | non précisé |
| `00438d08` | `gm_pilot_victory_00438d08` | 224 | 0 | pilote de fin de niveau, forme 0 : tangage 0x4b0 par tick, file droit devant (porté : 'heliVictoryPilot') | player.md §3.11 | certain |
| `00438de8` | `gm_pilot_victory_00438de8` | 224 | 0 | pilote de fin de niveau, forme 3 (identique à '00438d08') | player.md §3.11 | certain |
| `00438ec8` | `gm_pilot_victory_00438ec8` | 238 | 0 | pilote de fin de niveau, forme 1 : cap −4, poussée +0x82, roues arrière −13 par tick, braquage par pas de 8, roues 3, 3, 4, 4 (porté : 'vehicleVictoryPilot') | player.md §3.11 | certain |
| `00438fb8` | `gm_pilot_victory_00438fb8` | 206 | 0 | pilote de fin de niveau, forme 2 : comme '00438ec8', un seul coup de −13 ('+0x1b0'), roues 1, 1, 2 | player.md §3.11 | certain |
| `0043b4f4` | `gm_player_die` | 2927 | 1 | mort : classe 0x40, explosion, débris, roues et lanceurs en éclats, compagnons détachés (vivants), physique '0043863c', message « Game over ! », 'DAT_005b0414 = 2' | player.md §3.11, rules.md §2.5 | certain |
| `0043c07c` | `gm_player_victory_mode` | 214 | 1 | au tick 25 de la victoire : pilote de fin des formes 0 à 3 (âge 0, classe 0x40), '+0x184 = 0' pour toutes | player.md §3.11, rules.md §6.3 | certain |
| `0043cd14` | `gm_player_save_profile` | 141 | 1 | reporte munitions, énergie, véhicule, score, puissance dans le profil | rules.md §9 ; autres noms proposés : screens.md : gm_player_state_store | non précisé |
| `0043d034` | `gm_objective_head_first` | 222 | 2 | remet en tête de liste les cibles du même objectif (radar) | rules.md §9 | non précisé |
| `00443d3c` | `gm_spawn_explosion_00443d3c` | 121 | 2 | explosions et poussières (types 11000 à 11002) | rules.md §9 | non précisé |
| `00443e00` | `gm_spawn_explosion_00443e00` | 121 | 0 | explosions et poussières (types 11000 à 11002) | rules.md §9 | non précisé |
| `00443fe4` | `gm_spawn_explosion_00443fe4` | 107 | 2 | explosions et poussières (types 11000 à 11002) | rules.md §9 | non précisé |
| `00449aa8` | `gm_vehicle_tick_00449aa8` | 39 | 0 | fonction de tick des véhicules (physique, collisions sol / eau) | rules.md §9 | probable |
| `00449ad0` | `gm_vehicle_tick_00449ad0` | 39 | 0 | fonction de tick des véhicules (physique, collisions sol / eau) | rules.md §9 | probable |
| `0044a1a0` | `gm_upd_bullet_tracking` | 302 | 0 | balle du canon : suivi | rules.md §9 | probable |
| `0044a2d0` | `gm_upd_bullet` | 163 | 0 | balle du canon | rules.md §9 | probable |
| `0044a374` | `gm_upd_bullet_right` | 188 | 0 | balle du canon (droite) | rules.md §9 | probable |
| `0044a430` | `gm_upd_bullet_heavy` | 198 | 0 | balle du canon (lourde) | rules.md §9 | probable |
| `0044a4f8` | `gm_upd_bullet_homing` | 990 | 0 | balle du canon (à tête chercheuse) | rules.md §9 | probable |
| `00455124` | `gm_upd_missile_attached` | 105 | 0 | missile accroché au lanceur (copie cap, tangage, roulis du porteur) | rules.md §9 | probable |
| `004551f0` | `gm_upd_missile_straight` | 135 | 0 | vol de l'arme 0 (virage 2) | rules.md §9 | probable |
| `00455300` | `gm_upd_missile_class10` | 111 | 0 | vol à vitesse de classe 10 (7 000, virage 2) | rules.md §9 | probable |
| `00455370` | `gm_upd_bomb_fly` | 874 | 0 | bombe : phase de vol, explose si une déformation du terrain est libre (onde, type 0) | rules.md §9, render.md §10 | probable |
| `004556dc` | `gm_upd_bomb_shockwave` | 954 | 0 | méga-bombe : vol puis onde de choc de 60 ticks, prend une déformation du terrain (dôme, type 1) | rules.md §9, render.md §10 | probable |
| `00455a98` | `gm_upd_cruise_missile` | 1440 | 0 | missile de croisière | rules.md §9 | probable |
| `00456038` | `gm_upd_shield` | 172 | 0 | bouclier | rules.md §9 | probable |
| `004560e4` | `gm_upd_buddy_lock` | 1377 | 0 | compagnon : verrouillage | rules.md §9 | probable |
| `00456658` | `gm_upd_buddy_super` | 442 | 0 | compagnon : super | rules.md §9 | probable |
| `00456abc` | `gm_upd_buddy_autofire` | 1189 | 0 | compagnon : tir auto | rules.md §9 | probable |
| `00457074` | `gm_upd_mortar` | 778 | 0 | mortier ; n'éclate que si une déformation du terrain est libre | rules.md §9, render.md §10 | probable |
| `0045754c` | `gm_upd_super_nova` | 566 | 0 | Super Nova | rules.md §9 | probable |
| `00457784` | `gm_upd_napalm` | 280 | 0 | napalm | rules.md §9 | probable |
| `00457abc` | `gm_upd_nucleator` | 269 | 0 | Nucléator | rules.md §9 | probable |
| `00457bcc` | `gm_upd_super_napalm` | 381 | 0 | super napalm | rules.md §9 | probable |
| `00458064` | `gm_upd_pod_dropped` | 138 | 0 | nacelle larguée | rules.md §9 | probable |
| `004599b8` | `gm_player_aim_update` | 710 | 1 | tangage de visée '+0x90' (auto-aim vertical) | rules.md §9 | non précisé |
| `00459c80` | `gm_player_weapon_update` | 688 | 1 | consommation des munitions, resélection, dispatch par véhicule | rules.md §9 | non précisé |
| `00459f30` | `gm_special_weapon_ship0` | 16787 | 1 | armes spéciales de l'hélicoptère (véhicule 0) | rules.md §9 | non précisé |
| `0045e128` | `gm_special_weapon_ship1_2` | 18513 | 1 | armes spéciales des véhicules 1 et 2 | rules.md §9 | non précisé |
| `004629e4` | `gm_special_weapon_ship4_5` | 18513 | 1 | armes spéciales des véhicules 4 et 5 | rules.md §9 | non précisé |
| `004672a0` | `gm_special_weapon_ship3` | 16813 | 1 | armes spéciales du véhicule 3 (et 43) | rules.md §9 | non précisé |
| `0046b4b4` | `gm_primary_bullet_spawn` | 560 | 1 | crée un projectile du canon | rules.md §9 | non précisé |
<!-- /GEN:keyfuncs -->

## Imports

<!-- GEN:imports -->
| DLL | Imports (nombre de fonctions appelantes) |
|---|---|
| dll32.dll | `_FullScreen32@4` (2) |
| dplayx.dll | `ord1` (1), `ord2` (1) |
| dsound.dll | `DirectSoundCreate` (1) |
| gdi32.dll | `CreatePalette` (1), `DeleteObject` (1), `RealizePalette` (1), `SelectPalette` (1), `StretchDIBits` (1) |
| kernel32.dll | `FindResourceA` (1), `FreeResource` (1), `GetModuleFileNameA` (1), `GetTickCount` (1), `LoadResource` (1), `LocalAlloc` (0), `LocalFree` (0), `LockResource` (1), `CloseHandle` (1), `CreateEventA` (1), `CreateFileA` (1), `CreateMutexA` (1), `CreateThread` (1), `DeleteFileA` (1), `ExitProcess` (1), `ExitThread` (1), `GetCommandLineA` (1), `GetConsoleMode` (1), `GetCurrentProcessId` (1), `GetCurrentThreadId` (1), `GetCurrentThread` (1), `GetEnvironmentStrings` (1), `GetFileType` (1), `GetLastError` (1), `GetModuleFileNameA` (1), `GetModuleHandleA` (1), `GetProcAddress` (0), `GetStdHandle` (1), `GetVersion` (1), `LoadLibraryA` (0), `ReadConsoleInputA` (1), `ReadFile` (1), `ReleaseMutex` (1), `SetConsoleCtrlHandler` (1), `SetConsoleMode` (1), `SetEvent` (1), `SetFilePointer` (1), `SetStdHandle` (0), `TlsAlloc` (1), `TlsFree` (1), `TlsGetValue` (1), `TlsSetValue` (1), `VirtualAlloc` (1), `VirtualFree` (1), `WaitForSingleObject` (1), `WriteConsoleA` (1), `WriteFile` (1) |
| smackw32.dll | `_SmackClose` (1), `_SmackDoFrame` (1), `_SmackNextFrame` (1), `_SmackOpen` (1), `_SmackSoundUseDirectSound` (1), `_SmackToBuffer` (1), `_SmackVolumePan` (1), `_SmackWait` (1) |
| user32.dll | `AdjustWindowRect` (1), `BeginPaint` (1), `ClientToScreen` (2), `ClipCursor` (2), `CreateWindowExA` (1), `DefWindowProcA` (1), `DestroyWindow` (1), `DispatchMessageA` (1), `EndPaint` (1), `FindWindowA` (1), `GetClientRect` (1), `GetCursorPos` (1), `GetMessageA` (1), `GetSystemMetrics` (3), `GetWindowRect` (1), `InvalidateRect` (1), `LoadCursorA` (1), `LoadIconA` (1), `LoadImageA` (1), `MessageBoxA` (1), `PeekMessageA` (1), `PostMessageA` (2), `RegisterClassA` (1), `RegisterClassExA` (1), `RegisterWindowMessageA` (1), `ReleaseCapture` (1), `SendMessageA` (1), `SetCapture` (1), `SetCursorPos` (3), `SetFocus` (2), `SetForegroundWindow` (1), `SetWindowPos` (1), `ShowCursor` (1), `ShowWindow` (1), `SystemParametersInfoA` (3), `DispatchMessageA` (1), `GetActiveWindow` (0), `GetMessageA` (1), `PeekMessageA` (1), `TranslateMessage` (1), `wsprintfA` (0) |
| winmm | `joyGetPosEx` (0), `mixerClose` (0), `mixerGetControlDetailsA` (0), `mixerGetDevCapsA` (0), `mixerGetID` (0), `mixerGetLineControlsA` (0), `mixerGetLineInfoA` (0), `mixerGetNumDevs` (0), `mixerOpen` (0), `mixerSetControlDetails` (0) |
| winmm.dll | `joyGetDevCapsA` (1), `joyGetNumDevs` (1), `joyGetPosEx` (3), `mciSendStringA` (4), `mixerClose` (1), `mixerGetControlDetailsA` (1), `mixerGetDevCapsA` (1), `mixerGetLineControlsA` (1), `mixerGetLineInfoA` (1), `mixerGetNumDevs` (1), `mixerOpen` (1), `mixerSetControlDetails` (1), `timeGetTime` (1) |
<!-- /GEN:imports -->

## Chaînes référencées

<!-- GEN:strings -->
| Adresse | Chaîne | Fonctions |
|---|---|---|
| `00480004` | `SWIV_ICON1` | `004107a4` |
| `00480010` | `swiv_win` | `004107a4` `00410928` |
| `0048001c` | `SWIV 3D` | `004107a4` |
| `00480024` | `MSWHEEL_ROLLMSG` | `00410928` |
| `0048004c` | `swiv.cfg` | `00410928` |
| `00480058` | `Could not create main application window...` | `00410928` |
| `00480084` | `SWIV.  Full on Error Action` | `00410928` |
| `004800a0` | `MYLOGO` | `00411128` |
| `004800a8` | `open cdaudio` | `00411570` |
| `004800b8` | `set cdaudio time format tmsf` | `00411570` |
| `004800d8` | `status cdaudio number of tracks` | `004115bc` |
| `004800f8` | `play cdaudio from %d notify` | `004115bc` |
| `00480114` | `play cdaudio from %d to %d notify` | `004115bc` |
| `00480138` | `stop cdaudio` | `0041168c` |
| `00480148` | `close cdaudio` | `004116bc` |
| `00480198` | `cant add player` | `004119e0` |
| `004801a8` | `cant create player` | `004119e0` |
| `004801bc` | `generic` | `004119e0` |
| `004801c4` | `invalid object` | `004119e0` |
| `004801d4` | `no connection` | `004119e0` |
| `004801e4` | `err: %X` | `004119e0` |
| `004801fc` | `I cant open SOUNDS.bd` | `004134d8` |
| `00480214` | `Error starting direct sound` | `004134d8` |
| `00480234` | `SWIV!AndLetDie` | `0041c640` |
| `00480250` | `(%d,%d:%d) t1=%3d,t2=%3d,t3=%3d` | `0041f878` |
| `00480270` | `netlev01` | `00421100` |
| `0048027c` | `%s.slv` | `00421100` `00421614` |
| `00480284` | `netlev02` | `00421100` |
| `00480290` | `netlev03` | `00421100` |
| `0048029c` | `netlev04` | `00421100` |
| `004802a8` | `netlev05` | `00421100` |
| `004802b4` | `netlev06` | `00421100` |
| `004802c0` | `netlev07` | `00421100` |
| `004802cc` | `netlev08` | `00421100` |
| `004802d8` | `netlev09` | `00421100` |
| `004802e4` | `netlev10` | `00421100` |
| `004802f0` | `netlev11` | `00421100` |
| `004802fc` | `netlev12` | `00421100` |
| `00480308` | `iplay` | `00421614` |
| `00480328` | `demo.slv` | `00421614` |
| `00480334` | `Cant find DEMO.SLV` | `00421614` |
| `00480348` | `intro1` | `00421614` |
| `00480350` | `intro2` | `00421614` |
| `004803f8` | `%07d` | `0042ec80` |
| `00480400` | `%s %2d` | `0042ec80` |
| `00480414` | `swiv.cfg` | `0046e740` |
| `00480420` | `swivdemo.cfg` | `0046e740` |
| `00480434` | `C:\swiv.cfg` | `0046e740` |
| `00480440` | `C:\swivdemo.cfg` | `0046e740` |
| `00480454` | `.scr` | `0046ec40` |
| `0048047c` | `.smk` | `0046edb8` |
| `00480484` | `BR_TER` | `0046edb8` |
| `0048049c` | `I cant open Global File system!!` | `0046f288` |
| `004804c0` | `I cant open Global File system!!` | `0046f3a4` |
| `004804e4` | `c:\swivgrab\%s.bmp` | `0046f4a8` |
| `004804fc` | `c:\swivgrab\%s.tga` | `0046f4a8` |
| `00480510` | `Unknown String` | `0046f8f4` `0046f9b0` |
| `00480520` | `Unknown Block` | `0046f8f4` `0046f9b0` |
| `00480530` | `I cant open GLOBAL.bd` | `0046fa58` |
| `00480808` | `conin$` | `00475a0b` |
| `0048080f` | `conout$` | `00475a0b` |
| `00480a3a` | `╞∙╞@Θ4╟ll` | `0047689e` |
| `00484920` | `ε9·■B.å@ε9·■B.å└` | `00472af8` |
<!-- /GEN:strings -->

## Conteneur commun `.BD` / `.SLV` (confirmé)

`GLOBAL.BD`, `SOUNDS.BD` et les `.SLV` ont le même conteneur : ressources bout à bout depuis l'offset 0, puis en fin de fichier `count` entrées de 12 octets u32 LE. Les `count-1` premières sont `(offset, taille, id)` ; la dernière est `(count, valeur inconnue, 0)`. Le code ne lit jamais `count` pour borner la recherche : il balaie les entrées jusqu'à `id == id_cherché` ou `id == 0` (la dernière entrée sert de sentinelle).

- Localisation du répertoire : `GLOBAL.BD` (`gm_global_init` `0046fa58`) fait `fseek(-12, SEEK_END)`, lit `count`, `fseek(-count*12)` et lit les `count` entrées (`005bc184`). `SOUNDS.BD` (`gm_sounds_load` `004134d8`) et les `.SLV` (`gm_slv_load` `004545a8`) lisent le fichier en entier et calculent `fin + taille - count*12` (le `.SLV` est refusé s'il fait 2 000 000 octets ; tampon alloué par `gm_slv_alloc`, 2 000 000 octets).
- Recherche par id : `gm_global_load_block` (`0046f288`, malloc + lecture), `gm_global_read_block` (`0046f3a4`, dans un tampon existant), `gm_slv_find` (`00453bbc`), `gm_sound_find_wav` (`00412b60`).
- Constat : `gm_slv_load` demande l'id 200 au `.SLV` (copie de `0x300` octets vers `005bbe28`), absent des fichiers livrés. La recherche retombe sur la sentinelle et lit à partir de l'offset `count` : copie sans effet utile (hypothèse : bloc présent dans la version complète, livraison « CUTDOWN »).

## GLOBAL.BD

Ordre de chargement dans `gm_global_init` (`0046fa58`). Tampon cible = variable globale (Ghidra `DAT_`).

| Id | Taille | Variable | Utilisation établie par le code |
|---|---:|---|---|
| 1 | 203 | — | Texte d'en-tête (« Global.bd … Generated at … CUTDOWN USENGLISH INTERPLAY IPLOGOISANIM »), jamais lu par le code |
| 2 | 4 | `0048462c` | Drapeaux (u32) : fichier = `0xb2`. `0x01` : démo (`swivdemo.cfg`, charge 1005) ; `0x20` : charge 1004 et des écrans supplémentaires ; `0x40` : force la piste CD 2 ; `0x80` : saute le chargement de 1000 (absent) et active la séquence d'intro de `gm_main_game` ; `0x02` testé dans `gm_main_game` |
| 100 | 79 298 | `005bc140` | Chaînes localisées (voir ci-dessous) |
| 200 | 126 012 | `005bc130` | 1024 enregistrements de 28 octets relocalisés (`gm_global_reloc_objtable`, champs +4, +0xc, +0x14 ajoutés à la base). Valeur par défaut `(45, -1, 0, -1, 0, 0x7000, 23)` ; 158 enregistrements renseignés ; données au-delà de `0x7000`. Rôle exact inconnu (table de classes d'objets/sprites : hypothèse) |
| 501 / 503 | 24 410 / 71 280 | `005bc16c` / `005bc138` | Sprites RLE (table d'offsets en tête). Lus par `gm_draw_hud` (`0042ec80`) et `00437af0` (versions rendu logiciel) |
| 502 | 1 848 | `005bc18c` | Chargé, aucune autre lecture trouvée |
| 504 | 229 376 | `005bc144` | Lu par `004349ac`, `00435688`, `0046f0c0` (textures/sprites logiciels : hypothèse) |
| 505 | 70 560 | `005bc15c` | Lu par `004353f4` |
| 506 | 37 120 | `005bc12c` | Lu par `00437c38` |
| 507 | 50 237 | `005bc14c` | **Police** : table de 384 offsets u32 (`0x600, 0x610…`) puis glyphes RLE ; glyphe affiché par `gm_blit_rle_glyph_a` (`0041508b`) via `gm_draw_text` |
| 508 | 1 536 | `005bc164` | **Largeurs** des glyphes (384 dwords, valeur typique 6) ; indexé par la table de recodage `005bba28[caractère]` |
| 509 | 512 | `005bc150` | 256 u16 copiés vers `005bb810` par `0046f0c0` (palette 16 bits : hypothèse) |
| 510 / 511 / 512 | 117 150 / 16 505 / 123 636 | `005bc178` / `70` / `74` | Sprites RLE à table d'offsets (32, 128, 128 entrées) ; lus par `gm_draw_overlay_sw` (`004362b8`) |
| 600 | 3 024 | `005bc168` | Script des missions (voir ci-dessous) |
| 700 | 3 072 | `005bc154` | Lu par `00424f44` (collision, `taille*0x400 + ((z>>12&3)*4+(x>>12&3))*0x40`) |
| 800 | 65 536 | `005bc148` | Table 256×256 de mélange (`DAT_005bc180` pointe dessus pendant la lecture de `.smk`), utilisée comme LUT par les blitters |
| 450 / 451 / 452 / 500 | 35 297 / 98 304 / 128 392 / 28 672 | `005bc128` / `16c` / `138` / `160` | Chargés **à la place** de 501/503/505… quand `DAT_0048464c != 0` (builds accélérés 3Dfx/D3D). Non utilisés par `SWIV_WIN.EXE` |
| 1001-1005 | 136 960 chacun | `005bc134` | Un seul tampon de `0x21700` octets, rempli par `gm_global_read_block` selon les drapeaux (id `0x3e8`+n), puis traité par `0042fddc`/`0042fd24`/`0042ff5c` (mise en place de palette/LUT : hypothèse). Structure interne non analysée |

### Bloc 100 : chaînes (confirmé, vérifié sur le fichier)

- Répertoire en tête : 163 enregistrements de 8 octets `(id u16, groupe u16, offset u32)` (offset relatif au début du bloc), terminés par `(0xffff, 0xffff, …)`. Les offsets sont croissants.
- Groupes `99` : tables partagées. `(id 0)` : noms des langues (index 0-7 : English, Francais, Deutsch, Espanol, Italiano, Polski, Cestina, Portugu\x88s ; 8 = `#`) ; `(id 1)` = « 0 » ; `(id 2)` = « 00000110 » (un chiffre par langue, utilisé par `gm_set_language`).
- Groupes `0`-`7` : une langue chacune, 20 tables (ids 0-13, 20, 22, 100, 200, 1000, 1001).
- Une table = suite de paires `(id_chaîne u32, offset u32)` terminée par `0xffffffff`, offsets relatifs au bloc ; les textes sont des chaînes C terminées par NUL (page de code DOS 437/850), `|` = saut de ligne. Clé de recherche du code : `(langue << 16) + table`, `0x630000 + table` pour le groupe partagé (`gm_get_string` `0046f8f4`, `gm_get_string_shared` `0046f9b0`) ; l'ensemble est relocalisé au chargement (`gm_global_reloc_strings`).
- Tables : 0 pilote, 1 menu principal, 2 setup, 3 contrôleurs (42 chaînes), 4 pause, 5 multijoueur, 6 gamma, 7 fin de niveau, 8 volume, 9 musique (SWIV / Classical / Miscellaneous), 10 scores, 11 rejouer une mission, 12 capture d'écran, 13 abandon, 20 objectifs (`Objective 9`…`1`, `Completed`), 22 repères de carte (`Start`, `Final Objective`, `North`, `Objective Guide`), 100 noms de bonus/armes (40), 200 noms de missions (0-3 : Rookie, Seek & Destroy, Estuary Assault, Breakout! ; 100-111 : Deathmatch 1-12), 1000 `#n` (256), 1001 dispositions de clavier (saisie de texte).
- Les fonctions de menu et leur groupe : voir les noms `gm_menu_*` (groupe lu avant chaque `gm_get_string`).
- Recodage des caractères (`gm_set_language`) : table `005bba28[256]` ; 0-127 identité, 128-255 = `(chiffre_langue << 7) + c`, d'où des polices à jeux de glyphes de 128 caractères par page.

### Bloc 600 : script des missions (partiellement établi)

Suite d'éléments de 16 octets `(étiquette i32, a, b, c)`. Étiquettes vues : `200 n` (début de mission n), `100 …` (paramètres), `101 …`, `300` + texte de 12 octets = nom du `.SLV` (`TERRAN00`…`TERRAN06`, `TERRANBS`, `ARCTIC01…`, `LUNAR01`, `MARS0n`), `400 (u16,u16) n` (valeurs de mission), `500` + texte = vidéo/écran (`BR_TER0`, `END_TER`…), `600 x y z`. Fin : `200 999 / -2 999 / -1 999`. Sémantique des `100`/`400`/`600` : hypothèse. Seules `TERRAN00-03` sont livrées (« cutdown »).

## SOUNDS.BD

Confirmé par le code et le fichier : 26 ressources RIFF WAVE PCM. L'id d'entrée encode **numéro de son = id / 100** et **nombre d'instances = id % 100** (`gm_sounds_build_buffers` `00412c84`) : par exemple `100004` = son 1000 avec 4 tampons DirectSound. `gm_sound_play` (`00412e44`) prend le numéro de son (id/100, ex. 6000/6001 pour les cris/ambiances du joueur) et une instance libre ; `gm_sounds_update_3d` (`00413058`) règle pan/volume d'après la position relative à la caméra. `gm_wav_parse` (`00413ecc`) ne lit que `fmt ` et `data` ; la table est dans l'ordre du fichier. Familles d'ids : 1000xx, 2000xx-2005xx, 3000xx-3002xx, 4000xx-4020xx, 5000xx-5002xx, 6000xx-6004xx.

## Fichiers .SLV (niveaux)

Chargement : `gm_slv_load` (`004545a8`) via `"%s.slv"` (nom pris dans le script de mission, bloc 600 id 300) ou `demo.slv`. Ids vus dans TERRAN00 (170 entrées) et DEMO (mêmes ids, tailles différentes pour 105 et 107) :

| Id | Taille | Rôle établi (code) / hypothèse |
|---|---:|---|
| 100 | 262 144 | Carte de hauteur 512×512 octets (`005b1fc4`). Établi : `gm_terrain_height` (`004256c0`) indexe `(z>>14 & 0x1ff)*0x200 + (x>>14 & 0x1ff)` (monde torique, cellule = 2^14 unités, fraction sur 8 bits) avec interpolation bilinéaire ; `gm_terrain_crater` (`00424a24`) abaisse la hauteur de 4 cellules |
| 102 | 262 144 | Seconde carte 512×512, mêmes accès interpolés (`00425840`, `00424f44` collision) : carte de type/ombrage ou plafond (hypothèse) |
| 103 | 262 144 | Carte 512×512, lue par `0042f64c` et `00453ed4` : textures/tuiles du terrain (hypothèse) |
| 104 | 1 048 | Début `0x93,0x93,0x93,1,1,0,…` puis séquences de dwords croissantes ; non lu par le code d'après les xrefs : en-tête de niveau (hypothèse) |
| 105 | 37 248 | **Placement des objets** : enregistrements de 16 octets `(type, x, z, paramètre)`, fin `type = -1` ; lu par `gm_level_spawn_objects` (`0043e958`). Types : 1000-1002 démarrages des joueurs, <1000 décors/bonus (0, 100, 400, 500-565, 602-604), 2000/2002/2003 ennemis (114/165/225 dans TERRAN00), 3000, 4001, 5000, 7000. Seuils de classes dans le code : 0x3ea, 0x7d1, 0xc1c, 0x157c |
| 106 | 16 384 | `005b1fa4`, lu par `004147df` (appelée par `gm_render_view`) |
| 107 | 3 132 | Liste de 28 octets/élément (`1, 24, -1, -1, x, z, 0, 1, 1, 0 …`) : points de route/chemins (hypothèse) ; lu par les fonctions de comportement `004262a4…00443284` |
| 108 | 65 536 | Table 256×256 (`005bc180`) lue par les blitters RLE (fondu : `pixel = LUT[(teinte+banque)<<8 | pixel]`) |
| 109 | 32 768 | `005bc13c` ; commence par `00 01 02…` (table de palette/ombrage ; lue par `004349ac`, `004353f4`, `00435688`, `00437c38`) |
| 110 | 65 536 | `005b1f9c` ; 32 valeurs distinctes (lu par `00433f64` et `00453ed4`) |
| 500 | 12 288 | `005b1f74` ; commence par `00 01 02…` (3×? tables de 256) ; lu par `00433414`, `00433f64` |
| 501 | (DEMO) | `005b1f94`, lu par `00415259` |
| 10100-10770 | 130-3 900 | **Modèles 3D** (catégorie `id/1000 == 10`), indexés `005b09b0[id % 1000]` par `gm_slv_index_models` (`004543f0`). Format partiel : 8 dwords d'en-tête `(nb_sommets, ?, ?, offset…)`, puis sommets de 16 octets `(x, y, z, 0)` i32 à partir de `+0x20`, puis polygones à `+0x18` (offset relocalisé) : indices de sommets, couleur (`0x3f`…), coordonnées i16. Champs `+0x18` et `+0x1c` relocalisés par le code |
| 10800-10858, 10900-10902, 10980-10991 | — | Mêmes modèles (familles : 107xx décors/ennemis, 108xx, 109xx, 101xx-106xx véhicules/ennemis) |
| 11003 | 8 960 | `005b1f98` ; les `0x300` premiers octets puis une table d'octets `005bc158` indexée par un champ d'objet (+0x4c) (`0043607c`, `004359c8`) : attributs par type (hypothèse) |
| 11004 | 3 540 | `005b1f70`, lu par `004442ec` (liste d'événements/chemins : hypothèse) |
| 12000 | 165 248 | Jeu de tuiles principal : bloc de 256 octets, `0x8000` octets copiés à une adresse alignée, atlas 256×256 (`+0x8100`) découpé en 4×4 tuiles de 64×64 (tuile k : `+(k&3)*0x40 + (k>>2)*0x4000`, pas de ligne 256), `0x300` octets de palette en fin (hypothèse pour la palette), plus `0x180` octets pour 12000. Établi par `gm_slv_load_tilesets` (`00453c18`) |
| 12001-12004 | 99 328 | Même structure, 0x18400 octets (0x100 + 0x8000 + 0x10000 + 0x300) |

## Audio CD (MCI)

Établi : `gm_cd_open` (`00411570`) envoie `open cdaudio` puis `set cdaudio time format tmsf` ; `gm_cd_play_track` (`004115bc`, piste dans EAX) envoie `status cdaudio number of tracks` puis `play cdaudio from N to N+1 notify`, ou `from N notify` si N est la dernière piste ; `gm_wndproc` rejoue la même piste à la fin (notification MCI, boucle). La piste vient de la table `005bba10[6]` indexée par `DAT_00484634` (choix de musique, menu `gm_menu_music` : SWIV / Classical / Miscellaneous ; `piVar1[9]` du profil `005b20a0`). Valeurs par défaut posées par `gm_main_game` : `{2, 9, 3, 2, 2, 2}` ; elles sont relues d'un enregistrement de six u16 à `+4` (`004223f3`). Le drapeau `0x40` de GLOBAL id 2 force la piste 2. `gm_cd_stop` est appelée au changement d'écran (intros, menu). Les fichiers `MUSIC/TRACK02-10.MP3` de la distribution correspondent aux pistes 2-10 (le CD d'origine est remplacé par des MP3 : hypothèse sur le lien exact). Correspondance piste ↔ moment du jeu : non établie, seule la table et le choix utilisateur le sont.

## Smacker et fichiers .scr

Établi : `gm_play_smacker` (`0046edb8`) construit le chemin (préfixe pris dans le profil) + nom + `.smk`, appelle `_SmackOpen`, refuse une vidéo de plus de 320×400, puis boucle `_SmackWait` / `_SmackDoFrame` / `_SmackNextFrame` en dessinant les surcharges (`gm_draw_scr_overlay` `00437e1c`) ; n'importe quelle touche/clic interrompt. Pour un nom commençant par `BR_TER`, `gm_load_scr` (`0046ec40`) lit `<nom>.scr` avec `fscanf("%d %d %d %d %d %d %s %s\n")`. Champs, dans l'ordre du fichier :

1. n° de table de chaînes de GLOBAL.BD (200 = nom de la mission, 22 = repères, 20 = objectifs) ;
2. n° de chaîne (ignoré pour la table 200 : remplacé par l'index de la mission courante `00480c4c`) ;
3. première image où le texte est affiché ; 4. dernière image (bornes incluses, comparées au n° d'image Smacker) ;
5. x ; 6. y du texte (pixels de la vidéo) ;
7. `b` = style gras (appel `00422bdc`), autre (`g`) = style normal (`00422d10`) ;
8. alignement : `l` = gauche (1), `c` = centré (0), autre (`r`) = droite (2) (même convention que `gm_draw_text`).

Exemple `BR_TER0.SCR` : `22 2 270 367 24 9 b l` = chaîne « North » (table 22, n° 2), images 270 à 367, en (24, 9), gras, aligné à gauche. Confirmé par le code ; le sens de `g`/`b` (« couleur » vs « police ») est déduit de l'appel choisi.

## Rendu, entrées, boucle de jeu (noms et adresses)

- Fenêtre : `gm_winmain` `00410928`, `gm_create_window` `004107a4`, `gm_wndproc` `004102a0`, `gm_poll_events` `00410bcc` (touches dans `00490010[256]`, manette via `joyGetPosEx`). Plein écran via `DLL32.DLL` `_FullScreen32` (VGA/DISPDIB) ; le rendu logiciel écrit directement en mode X (`out 3c4h/3c8h/3c9h`, `A0000`).
- Boucle : `gm_main_game` `00421614` (menus, intros, démo) → `gm_start_level` `00421100` → `gm_slv_load` → boucle de jeu qui appelle `gm_frame` `0042f64c` (4 vues de 0x1a dwords à `00480e74`, écran partagé) → `gm_render_view` `0042b31c` (14 Ko) → `gm_render_terrain` (hypothèse) `0042718c`. HUD : `gm_draw_hud` `0042ec80`, `gm_draw_overlay_sw` `004362b8` (variante 3Dfx `00436c28`).
- Objets : pool de 3000 objets de 0x70 octets à `004daa58` (liste libre `005876d4`), init `gm_object_init` `004265ec` (x, y, z en virgule fixe <<8 aux offsets `+0x1c/+0x20/+0x24`, type à `+0x4c`), modèles `005b09b0[type]`. Entités et comportements : fonctions `00442xxx`-`0046xxxx` non nommées.
- Réseau : DirectPlay (`DPLAYX.DLL` ord 1/2), session « SWIV!AndLetDie » (`0041c640`), niveaux `netlev01`-`netlev12`.

## Pistes pour les formats

- Écrire un lecteur de conteneur commun (déjà fait : `src/games/swiv3d/data/bd.ts`) ; GLOBAL.BD : 28 ressources, SLV : 169, SOUNDS.BD : 26.
- Chaînes (GLOBAL 100) : format entièrement décrit ci-dessus, directement implémentable (8 langues × 20 tables).
- Polices (507/508) et sprites (501, 503, 510-512) : format RLE à 4 plans de `0041508b` (table d'offsets u32 relative au début du bloc ; par plan : opcodes `0x80|n` saut de n pixels, `0x80` + u16 saut long, `0xff` fin de plan, sinon `longueur<<4 | teinte`, longueur 0 = changement de banque de teinte). Rendu en LUT 64 Ko (SLV 108 / GLOBAL 800). À confirmer en décodant un glyphe.
- Terrain : SLV 100 (hauteur) + 102/103 (cartes 512×512), tuiles 12xxx en atlas 256×256 (4×4 tuiles de 64×64), conversion 8 bits vers palette à trouver dans les 0x300 octets de fin des blocs 12xxx.
- Objets : SLV 105 (type, x, z, paramètre) ; modèles : SLV 10xxx (sommets i32 ×4, polygones à `+0x18`). Les ids de types d'objets 1000/2000/3000/… renvoient aux modèles 10xxx par `005b09b0` : la table de correspondance se trouve dans le code (`0043e958`), à extraire.
- Sons : `SOUNDS.BD` ouvrable tel quel (WAV complets) ; id/100 = numéro de son utilisé par `gm_sound_play`, id%100 = nombre d'instances.
- Vidéos : `.smk` standard (Smacker), `.scr` décrit ci-dessus.
- Questions ouvertes : GLOBAL 200 et 1001-1005, SLV 104/106/107/11003/11004 (hypothèses seulement), liste complète des types d'objets, lien piste CD ↔ niveau, drapeaux de GLOBAL id 2.
