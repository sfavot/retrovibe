// Post-script : nomme les fonctions de la bibliothèque C Microsoft (C 6.0, modèle large) identifiées.
//
// Pas de signatures FLIRT pour Microsoft C 6 en modèle large : l'identification s'est faite à la main
// (comportement de la décompilation, appels INT 21h, nombre d'appelants, chaînes). La table est dans
// libs.def.tsv (à côté de ce script, chemin passé par ARMAETH_LIBS_DEF) : adresse, nom, taille attendue,
// confiance, preuve. La taille attendue protège contre une dérive : si la fonction à cette adresse change
// de taille, on ne renomme pas et on le signale.
//
// Le startup et la bibliothèque occupent le segment 3938 (3938:0000 à 3938:4c3f) ; l'émulateur 8087 est
// en 3dff. Les fonctions du segment 3938 non listées restent du code non identifié (type « rtl »).
// Sortie : libfuncs.tsv (adresse, nom, taille, nb d'appelants, confiance, preuve).
//@category Armaeth.RE

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;

public class IdentifyLibs extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String def = ReCommon.env("ARMAETH_LIBS_DEF");
        if (def == null) throw new IllegalStateException("ARMAETH_LIBS_DEF non défini (voir run.sh)");
        List<String> lines = Files.readAllLines(new File(def).toPath(), StandardCharsets.UTF_8);
        StringBuilder tsv = new StringBuilder("# adresse\tnom\ttaille\tappelants\tconfiance\tpreuve\n");
        int renamed = 0, probable = 0;
        for (String line : lines) {
            if (line.startsWith("#") || line.isBlank()) continue;
            String[] l = line.split("\t", 5);
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
            // « probable » : conservée dans le TSV, pas de renommage (le nom proposé reste dans libfuncs.tsv)
            if (l[3].equals("certain")) {
                f.setName(l[1], SourceType.USER_DEFINED);
                renamed++;
            } else {
                probable++;
            }
            tsv.append(l[0]).append('\t').append(l[1]).append('\t').append(size).append('\t')
               .append(f.getCallingFunctions(monitor).size()).append('\t').append(l[3]).append('\t').append(l[4]).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(), "libfuncs.tsv"), tsv.toString());
        println("[re] fonctions de bibliothèque nommées : " + renamed + " (+ " + probable + " probables non renommées)");
    }
}
