// Post-script : nomme les fonctions du jeu (préfixe gm_) dont le rôle est établi ou probable.
// La table est dans keyfuncs.def.tsv (chemin passé par SWIV3D_KEYFUNCS_DEF) : adresse, nom, taille attendue,
// groupe, confiance, rôle, preuve. Garde-fou : la taille attendue doit correspondre.
// Sortie : keyfuncs.tsv (adresse, nom, taille, appelants, groupe, confiance, rôle, preuve), lu par make_index.py.
//@category SWIV3D.RE

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;

public class NameGameFuncs extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String def = ReCommon.env("SWIV3D_KEYFUNCS_DEF");
        if (def == null) throw new IllegalStateException("SWIV3D_KEYFUNCS_DEF non défini (voir run.sh)");
        List<String> lines = Files.readAllLines(new File(def).toPath(), StandardCharsets.UTF_8);
        StringBuilder tsv = new StringBuilder("# adresse\tnom\ttaille\tappelants\tgroupe\tconfiance\trole\tpreuve\n");
        int renamed = 0;
        for (String line : lines) {
            if (line.startsWith("#") || line.isBlank()) continue;
            String[] l = line.split("\t", 7);
            Function f = getFunctionAt(toAddr(l[0]));
            if (f == null) f = createFunction(toAddr(l[0]), null); // code non atteint par l'analyse automatique
            if (f == null) {
                println("[re] fonction absente à " + l[0] + " (" + l[1] + ")");
                continue;
            }
            long size = f.getBody().getNumAddresses();
            if (size != Long.parseLong(l[2])) {
                println("[re] taille inattendue à " + l[0] + " : " + size + " au lieu de " + l[2] + " ; non renommée (" + l[1] + ")");
                continue;
            }
            f.setName(l[1], SourceType.USER_DEFINED);
            renamed++;
            tsv.append(l[0]).append('\t').append(l[1]).append('\t').append(size).append('\t')
               .append(f.getCallingFunctions(monitor).size()).append('\t').append(l[3]).append('\t').append(l[4]).append('\t')
               .append(l[5]).append('\t').append(l[6]).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(), "keyfuncs.tsv"), tsv.toString());
        println("[re] fonctions du jeu nommées : " + renamed);
    }
}
