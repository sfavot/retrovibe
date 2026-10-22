// Post-script : nomme les fonctions de la bibliothèque Borland C++ identifiées avec certitude.
//
// Il n'y a pas de signatures FLIRT pour Borland C++ 1991 en modèle large : l'identification s'est
// faite à la main (comportement de la décompilation, appels INT 21h, nombre d'appelants, chaînes).
// Chaque entrée porte la preuve de l'identification. Seule la table ci-dessous est à maintenir ;
// la taille attendue protège contre une dérive (si la fonction à cette adresse change de taille,
// on ne renomme pas et on le signale).
//
// Le code de la bibliothèque et du startup occupe le segment 1000 (1000:0000 à 1000:2d77) ; les
// fonctions de ce segment non listées ici sont du code Borland non identifié (type « rtl »).
// Sortie : libfuncs.tsv (adresse, nom, taille, nb d'appelants, confiance, preuve).
//@category Teleportaschtroumpf.RE

import java.io.File;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;

public class IdentifyLibs extends GhidraScript {
    // adresse, nom, taille attendue (octets), confiance, preuve
    private static final String[][] LIBS = {
        { "1000:016b", "lib__exit", "18", "certain", "INT 21h AH=4Ch (terminaison), appelée par le code de sortie du startup" },
        { "1000:017d", "lib___SaveVectors", "67", "certain", "INT 21h AH=35h sur les vecteurs 0, 4, 5, 6 puis 25h (sauvegarde/installation, Borland startup)" },
        { "1000:01c0", "lib___RestoreVectors", "45", "certain", "INT 21h AH=25h pour les vecteurs 0, 4, 5, 6 (restauration à la sortie)" },
        { "1000:03b6", "lib_N_SCOPY", "28", "certain", "copie de CX octets (rep movsw puis movsb), convention SCOPY@ de Borland" },
        { "1000:060f", "lib___IOerror", "57", "certain", "traduit un code d'erreur DOS en errno via une table (0x42c4), renvoie -1" },
        { "1000:0735", "lib_lseek", "41", "certain", "efface le bit 0x200 de _openfd[fd] puis INT 21h AH=42h" },
        { "1000:075e", "lib_N_LXMUL", "23", "certain", "multiplication 32 bits DX:AX x CX:BX (aide du compilateur LXMUL@)" },
        { "1000:07a7", "lib_rand", "38", "certain", "seed = seed * LXMUL + 1, renvoie les 15 bits de poids fort ; 62 appelants" },
        { "1000:07cd", "lib_dos_read", "47", "certain", "INT 21h AH=3Fh" },
        { "1000:09b0", "lib___vprinter_thunk", "26", "certain", "appelle 0a14, point d'entrée commun de sprintf / printf" },
        { "1000:0a14", "lib___vprinter", "1071", "certain", "moteur de printf : parse '%', drapeaux, largeur, précision, \"(null)\"" },
        { "1000:155c", "lib_dos_ioctl", "41", "certain", "INT 21h AH=44h" },
        { "1000:16b4", "lib_dos_setblock", "28", "certain", "INT 21h AH=4Ah" },
        { "1000:17ae", "lib_dos_chmod", "29", "certain", "INT 21h AH=43h" },
        { "1000:17f3", "lib_dos_close", "30", "certain", "INT 21h AH=3Eh" },
        { "1000:1b9a", "lib_memcpy", "36", "certain", "copie rep movsw/movsb, renvoie la destination, 22 appelants" },
        { "1000:1bbe", "lib___memset_fill", "36", "certain", "remplit avec un octet (aligne, rep stosw)" },
        { "1000:1be2", "lib_memset", "31", "certain", "enveloppe de 1bbe (dest, octet, taille), renvoie dest" },
        { "1000:1c01", "lib___memmove_impl", "82", "certain", "copie avec détection du recouvrement (sens de copie), via 0775" },
        { "1000:1c53", "lib_memmove", "33", "certain", "enveloppe de 1c01" },
        { "1000:1c74", "lib_dos_creat", "27", "certain", "INT 21h AH=3Ch" },
        { "1000:1c8f", "lib_dos_write", "18", "certain", "INT 21h AH=40h" },
        { "1000:1ca1", "lib_open", "367", "certain", "open(chemin, oflag, pmode) : drapeaux O_CREAT 0x100 / O_EXCL 0x400, appelle chmod, creat, open DOS, close, ioctl" },
        { "1000:1e10", "lib_dos_open", "79", "certain", "INT 21h AH=3Dh, remplit _openfd[fd]" },
        { "1000:1e96", "lib_fputc", "399", "certain", "écriture d'un caractère dans un FILE (tampon, drapeaux 8 = ligne, 0x100), appelle fflush/lseek/write" },
        { "1000:2473", "lib_sprintf", "34", "certain", "met *buf = 0 puis appelle le moteur printf avec la fonction de sortie 2433 ; 42 appels avec une chaîne de format" },
        { "1000:2495", "lib_vsprintf", "33", "certain", "même chose avec une va_list (4e paramètre)" },
        { "1000:24b6", "lib_strcat", "63", "certain", "strlen de la destination, strlen de la source, copie" },
        { "1000:24f5", "lib_strcmp", "48", "certain", "comparaison octet à octet, renvoie la différence" },
        { "1000:2525", "lib_strcpy", "41", "certain", "strlen de la source puis copie avec le NUL" },
        { "1000:254e", "lib_strlen", "31", "certain", "repne scasb ; renvoie 0 si le pointeur est NULL" },
        { "1000:256d", "lib_strncpy", "49", "certain", "copie au plus n octets puis complète par des zéros" },
        { "1000:2d04", "lib_dos_write2", "60", "certain", "INT 21h AH=40h (variante avec contrôle de la longueur)" },
        { "1000:1e5f", "lib_printf", "27", "probable", "appelle le moteur printf avec le FILE en 3646:4118 (stdout probable)" },
    };

    @Override
    protected void run() throws Exception {
        StringBuilder tsv = new StringBuilder("# adresse\tnom\ttaille\tappelants\tconfiance\tpreuve\n");
        int renamed = 0;
        for (String[] l : LIBS) {
            Function f = getFunctionAt(toAddr(l[0]));
            if (f == null) {
                println("[re] fonction absente à " + l[0] + " (" + l[1] + ")");
                continue;
            }
            long size = f.getBody().getNumAddresses();
            if (size != Long.parseLong(l[2])) {
                println("[re] taille inattendue à " + l[0] + " : " + size + " au lieu de " + l[2] + " ; non renommée (" + l[1] + ")");
                continue;
            }
            // « probable » : conservée dans le TSV, pas de renommage
            if (l[3].equals("certain")) {
                f.setName(l[1], SourceType.USER_DEFINED);
                renamed++;
            }
            tsv.append(l[0]).append('\t').append(l[1]).append('\t').append(size).append('\t')
               .append(f.getCallingFunctions(monitor).size()).append('\t').append(l[3]).append('\t').append(l[4]).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(), "libfuncs.tsv"), tsv.toString());
        println("[re] fonctions de bibliothèque nommées : " + renamed);
    }
}
