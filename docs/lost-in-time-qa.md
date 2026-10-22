# QA Lost in Time (passe 2, jouée avec walkthrough Sierra Help)

**Progression atteinte** : navire complet (cale, pont, porte du marin, cinématique), arrivée au manoir (chapitre 2) : portail (batterie, pipette/acide, pomme, cheval, mot, cadenas), jardin, entrée du manoir (bûche, portrait), caveau (portrait posé, plaque 1812-1840 résolue avec 28, monte-charge arrivé, bouton « hors d'usage » comme prévu), façade nord du phare (vinaigre, fléchette sur le tonneau, tonneau en main, soupirail découvert). Arrêt volontaire là : environ un tiers du jeu, pas de blocage rencontré.

## Méthode et limites de l'environnement
- Le volet navigateur est souvent masqué ou recouvert : `requestAnimationFrame` tombe alors à ~1,5 fps, même quand `document.visibilityState` vaut « visible ». Le moteur est cadencé par rAF, donc le jeu devient ~100 fois trop lent (clics ignorés, curseur et libellés en retard, textes qui semblent bloqués). Pour jouer à vitesse normale, j'ai remplacé `window.requestAnimationFrame` par un `setTimeout(16)` dans la page (aucun fichier modifié). Les « bugs » de latence vus au début de la session venaient de cet état et ne sont pas des bugs du jeu.
- Clics injectés par `PointerEvent` (déplacement, pause 150 ms, appui 80 ms, relâchement) ; clic de 30 ms accepté à pleine vitesse.
- Son activé (piste CD « EXT_3 » en lecture, 348 pistes chargées) ; je n'ai pas pu écouter, seulement vérifier l'état. Console propre : aucun avertissement watchdog `TOT@` ni erreur.

## Bugs / constats

### 1. Titre de la carte : « Prunelière » sans le « è » (mineur, à confirmer)
- Scène : carte du domaine (icône carte de la barre du haut), titre « Manoir de la Prunel_i_re ».
- Attendu : « Manoir de la Prunelière » avec l'accent. Constaté : le « è » n'est pas dessiné (trou entre « i » et « re »).
- Hypothèse : glyphe accentué absent de la grosse police de la carte (ou du jeu de caractères CP850 → police). À comparer à l'original.
- **Statut : corrigé.** Cause : la planche de caractères de la carte (police en sprite) est indexée par octet CP850 non signé (« è » = 0x8a, case 73, présente dans la planche) ; le port lisait un octet signé, d'où un index négatif et un trou. Correction dans `engine/graphics/draw.ts`, test `test/lost-in-time/sprite-font.test.ts`. Vérifié dans le navigateur : « Prunelière » s'affiche.

### 2. Moteur quasi à l'arrêt quand le volet est masqué (mineur)
- Étapes : jouer, masquer/recouvrir le volet. Constaté : boucle de jeu cadencée par rAF → ~1,5 fps, saisies perdues au retour. Attendu : au minimum une pause explicite. Voir « Méthode ».
- **Statut : corrigé.** L'interface met le jeu en pause quand l'onglet est masqué (`document.hidden`) : horloge de jeu gelée (`ui/clock.ts`, `ui/browser-host.ts`), piste CD et contexte Web Audio suspendus puis repris au même point (`html-cd.ts`, `web-audio.ts`, `ui/app.ts`). Les volets « visibles » mais très ralentis par le navigateur ne sont pas concernés. Tests : `test/lost-in-time/pause.test.ts` ; vérifié en simulant `visibilitychange` (horloge, CD et position de plage gelés puis repris).

### 3. Premier caractère des libellés rogné à gauche (cosmétique)
- Texte du bas (« Utiliser … sur … », « Est-ce qu'il fait partie de l'héritage? ») : la première lettre touche/dépasse le bord gauche du canvas (« U » vu comme « J », « E » coupé). À vérifier contre l'original (marge d'une colonne ?).
- **Statut : corrigé (n'a rien à voir avec le jeu).** Le texte est bien dessiné à x = 0 ; c'est l'anneau de focus du canvas (3 px, décalé vers l'intérieur) qui recouvrait la première colonne. Il entoure désormais l'écran (`ui/style.css`). Test : `test/lost-in-time/pause.test.ts` (style) ; vérifié dans le navigateur (« Utiliser TONNEAU sur », « Un poteau »).

### 4. Boîtes de dialogue Sauver/Charger collées ou rognées à droite (cosmétique)
- Boîte « NOM DE LA SAUVEGARDE : … » / « TAPER LE NOM… » : bord droit au ras ou au-delà du canvas selon la longueur du nom ; traits parasites (petits « ι ι ι ») à droite de la boîte après saisie dans le champ de nom.
- **Statut : non élucidé, non corrigé.** Le cadre est positionné par le script (x 16..318 pour la boîte de saisie) et rien dans le moteur ne le décale. Les traits jaunes viennent d'un sprite temporaire de 272x31 (sprite 30) recopié par le script, qui contient ces traits dans ses colonnes de droite ; ils n'apparaissent qu'après certaines suites de saisie (retour arrière jusqu'à vider le champ puis frappe). Sans original pour comparer, pas de correction faite ; piste : tracer qui remplit le sprite 30 (copie d'écran avant la boîte ?).

### 5. Libellé de survol périmé après un chargement (cosmétique)
- Après CHARGER « JARDIN », le libellé « Un puits » reste affiché alors que le curseur est dans la zone noire du bas.
- **Statut : non reproduit.** Après chargement de JARDIN, le libellé affiché correspond à une zone réellement sous le curseur et disparaît dès qu'on le déplace dans la zone noire. La logique de survol (`checkHotspotChanged`, `clear` qui remet la clé courante à 0) est identique à ScummVM : pas de « leave » à la recharge, comme dans l'original.

### 6. Saisie du nom de sauvegarde : lettres manquantes à partir de 10 caractères (mineur, à confirmer)
- Taper « CALE TORCHON » (12 car.) affiche « CALE TORCN » ; « HOHOAB » et « TORCHON » seuls passent. Probablement limite de 10 caractères d'origine avec un comportement de dépassement étrange ; à comparer à l'original.
- **Statut : conforme à l'original.** La largeur du champ donne 10 caractères (`width / largeur de police`, `Hotspots::updateInput`) ; au maximum, chaque frappe écrase le dernier caractère (`CALE TORCHON` donne `CALE TORCN`). Le code du port reproduit le comportement de ScummVM ligne à ligne.

### 7. Scènes très sombres (cosmétique, à confirmer)
- Cale arrière / porte du marin / mur des boulets : image rougeâtre et très sombre, détails à peine visibles. Peut être voulu (cale non éclairée) ; à comparer à l'original.
- **Statut : non reproduit / à comparer visuellement.** Aucun défaut de palette trouvé : la palette affichée est égale à la palette voulue (0 écart) et la conversion 6 bits vers 8 bits est celle de ScummVM (à ≤ 3/255 près, plus claire). L'obscurité vient donc des données de la scène.

### 8. Zones de navigation recouvertes par des hotspots de scène (mineur, comportement d'origine probable)
- Cale (cuisine, canon à gauche) : cliquer sur le bord gauche/droit à hauteur du canon ou du bac déclenche l'objet au lieu de la navigation (les flèches 0-39 / 279-318 sont derrière). Contournement : cliquer plus haut/bas. Comportement conforme à l'ordre des zones ScummVM, signalé pour mémoire.
- **Statut : conforme à l'original.** `checkMouse` retient la première zone sous la souris dans l'ordre du tableau, comme `Hotspots::checkMouse` de ScummVM ; l'ordre est celui des `addHotspot` du script.

## Vérifié OK
- Titre/crédits (~22 s), transition ondulée de réveil, monologues, hover (libellés), zooms animés, curseur objet (« Utiliser X sur Y »), « Non, ça ne donne rien… », inventaire (clic droit, 10 objets, combinaison via mallette de la barre), barre d'icônes du haut (Sauver/Charger/Quitter/Version).
- Vidéos et voix/sous-titres : trou dans la cloison (prisonnier Yoruba), marin à la porte, ouverture du cadenas, pomme au cheval, fouille du tracteur, lecture du mot (fond vidéo + texte vert).
- Énigmes : tabouret/clou/tenailles, lampe, éponge humide, huile + pompe, tire-bouchon, taquets, savon/copeaux/glissière, acide sur cadenas, portrait + plaque 1812-1840 = 28, fléchette sur le tonneau.
- Sauvegarde/chargement : 5 emplacements créés (TORCHON, ENTREPONT1, PORTAIL, JARDIN, CAVEAU), rechargement de PORTAIL (« INVENTAIRE VIDE ») et JARDIN (fléchette, paquet, pipette, batterie) : état et inventaire restitués. L'enregistrement par-dessus un emplacement existant (nom prérempli) fonctionne.
- Musique CD en lecture (piste EXT_3), son activé.

## Non testé
Fin du chapitre 2 (barre de fer, résine, cheminée, dalle, trappe), chapitres 3 et 4 (phare, crypte, jeux chronométrés), minuteries, jokers (aide), « Quitter », fin du jeu, perf sur machine lente, écoute réelle de l'audio (synchro voix/lèvres, silences), clavier au-delà du champ de nom, mobile/tactile.

## Autre point

- **Préférence « Son » modifiée sans action (non confirmé)** : cause plausible trouvée et corrigée : plusieurs onglets du jeu gardaient chacun leur valeur en mémoire et réécrivaient l'ancienne au prochain clic. Les onglets suivent maintenant l'évènement `storage` (`AudioPrefs.reload`, `ui/app.ts`). Test : `test/lost-in-time/pause.test.ts`. Rien d'autre dans le code ne réécrit la préférence (la migration de l'ancienne clé « Musique » ne s'exécute qu'une fois).
