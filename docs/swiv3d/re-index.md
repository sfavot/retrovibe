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
- Outils : ghidra 12.2 ; JDK : openjdk version "25.0.5" 2026-10-20.
- Durée de la dernière régénération : 38 s.
- Image : 572416 octets.
- Fonctions : 564, 324368 octets (types : func 517, import 47).
- Décompilation : 515 ok (91.3 %), 49 partielle, 0 en erreur.
- Chaînes de la zone de données : 111 ; référencées par au moins une fonction : 67.
- Décompilation partielle : `00476fd7`, `00472c7b`, `00477238`, `0047723e`, `00477244`, `0047724a`, `00477250`, `00477256`, `0047725c`, `00477262`, `00477268`, `0047726e`, `00477274`, `0047727a`, `00477280`, `00477286`, `0047728c`, `00477292`, `00477298`, `0047729e`, `004772a4`, `004772c2`, `004772c8`, `004772ce`, `004772d4`, `004772e0`, `004772e6`, `004772ec`, `004772f2`, `004772f8`, `004772fe`, `00477304`, `0047730a`, `00477310`, `00477316`, `0047731c`, `00477322`, `00477328`, `00477382`, `00477388`, `0047738e`, `00477394`, `0047739a`, `004773a0`, `004773a6`, `004773ac`, `004773b2`, `004773b8`, `004773be`.
<!-- /GEN:stats -->

## Fonctions nommées

Table `scripts/swiv3d/re/keyfuncs.def.tsv`, appliquée par `NameGameFuncs.java` (les fichiers `decomp/` portent ces noms, préfixe `gm_`). « certain » = établi par le code ; « probable » = déduit du rôle d'appelants/appelés ; « hypothèse » = à vérifier.

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
| `00417ffc` | `gm_menu_gamma` | 1109 | 1 | Réglage gamma (groupe 6) | Groupe 6 | probable |
| `00419058` | `gm_screen_pause` | 337 | 1 | Écran de pause (groupe 4) | Groupe 4 | probable |
| `004194b0` | `gm_screen_level_complete` | 1904 | 1 | Fin de niveau / scores (groupe 7) | Groupe 7 | probable |
| `0041a560` | `gm_menu_music` | 868 | 1 | Menu préférence musicale (groupe 9) : fixe 00484634 et lance la piste | Groupe 9 ; appelle 004115bc | certain |
| `0041a8c4` | `gm_menu_volume` | 1912 | 1 | Menu volumes (groupe 8) | Groupe 8 | probable |
| `0041b03c` | `gm_menu_setup` | 2778 | 2 | Menu Setup (groupe 2) | Chargements du groupe 2 | probable |
| `0041bb40` | `gm_menu_pickups` | 2793 | 1 | Menu des bonus / triche (groupe 100) | 40 lectures du groupe 100 | probable |
| `0041d714` | `gm_menu_main` | 1741 | 1 | Menu principal (groupe de chaînes 1) | Chargements du groupe 1 | probable |
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
| `0042718c` | `gm_render_terrain` | 10909 | 1 | Parcourt les cellules voisines (grille 7x7 de 64x64) et projette terrain/objets | Lit 005b1fc4 ; grille 0x3f | hypothèse |
| `0042b31c` | `gm_render_view` | 14496 | 1 | Rendu d'une vue (terrain, objets, sprites) | 14 Ko ; appelle gm_render_terrain, gm_terrain_height | probable |
| `0042ec80` | `gm_draw_hud` | 2506 | 1 | Affiche le HUD d'un joueur (score « %07d », « %s %2d ») | Chaînes 004803f8, 00480400 | certain |
| `0042f64c` | `gm_frame` | 1174 | 4 | Une image : met à jour les sons, rend chaque vue active (0042b31c), HUD, entrées de debug, fait avancer le jeu | Boucle sur 4 vues de 0x1a dwords à 00480e74 | probable |
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
