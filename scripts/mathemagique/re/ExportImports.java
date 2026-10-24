// Post-script : nomme et exporte les imports du programme courant.
//
// Le loader NE de Ghidra nomme déjà les imports de KERNEL, USER, GDI, MMSYSTEM, COMMDLG... (table interne
// d'ordinaux Windows ; le nom d'origine du fichier est « Ordinal_N »). Pour un module qui n'en fait pas
// partie (DLL Broderbund), le nom vient des tables de noms du NE exporteur, extraites par run.sh dans
// <RE_OUT>/exports/<MODULE>.tsv (« ordinal<TAB>nom ») : on renomme alors l'import.
//
// Sortie imports.tsv : module, ordinal, nom, source du nom (ghidra | dll | -), nb d'appelants, appelants.
//   source « - » : import resté sans nom (« Ordinal_N »).
// Les appelants sont les fonctions contenant une référence de Ghidra vers le thunk de l'import (appel, pointeur).
//@category Mathemagique.RE

import java.io.File;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.ExternalLocation;
import ghidra.program.model.symbol.ExternalLocationIterator;
import ghidra.program.model.symbol.ExternalManager;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.SourceType;

public class ExportImports extends GhidraScript {
    @Override
    protected void run() throws Exception {
        ExternalManager em = currentProgram.getExternalManager();
        File exportsDir = new File(System.getenv("RE_OUT") != null ? System.getenv("RE_OUT") : "archives/mathemagique/re", "exports");
        // Le loader place dans le bloc EXTERNAL un thunk par import ; les appels du code visent ce thunk.
        Map<String, Address> thunks = new HashMap<>(); // « MODULE::ordinal d'origine » -> entrée du thunk
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (!f.isThunk() || ReCommon.isCode(currentProgram, f.getEntryPoint())) continue;
            Function t = f.getThunkedFunction(true);
            if (t == null || t.getExternalLocation() == null) continue;
            ExternalLocation el = t.getExternalLocation();
            thunks.put(el.getLibraryName() + "::" + el.getOriginalImportedName(), f.getEntryPoint());
        }
        StringBuilder sb = new StringBuilder();
        sb.append("# module\tordinal\tnom\tsource_du_nom\tnb_appelants\tappelants\n");
        int total = 0, named = 0, fromDll = 0, calls = 0;
        for (String lib : em.getExternalLibraryNames()) {
            if (lib.equals("<EXTERNAL>") || lib.equals("Unknown")) continue;
            Map<Integer, String> dll = new HashMap<>();
            File ef = new File(exportsDir, lib.toUpperCase() + ".tsv");
            if (ef.exists()) {
                for (String line : Files.readAllLines(ef.toPath())) {
                    String[] c = line.split("\t");
                    if (c.length == 2) dll.put(Integer.parseInt(c[0]), c[1]);
                }
            }
            ExternalLocationIterator it = em.getExternalLocations(lib);
            while (it.hasNext()) {
                ExternalLocation l = it.next();
                String orig = l.getOriginalImportedName() == null ? l.getLabel() : l.getOriginalImportedName();
                String ord = orig.startsWith("Ordinal_") ? orig.substring(8) : "";
                String label = l.getLabel();
                String source;
                if (!label.startsWith("Ordinal_") && !label.equals(orig)) {
                    source = "ghidra"; // le loader a résolu l'ordinal
                } else if (!ord.isEmpty() && dll.containsKey(Integer.parseInt(ord))) {
                    label = dll.get(Integer.parseInt(ord));
                    l.setName(l.getParentNameSpace(), label, SourceType.USER_DEFINED);
                    source = "dll";
                    fromDll++;
                } else if (label.startsWith("Ordinal_")) {
                    source = "-";
                } else {
                    source = "ghidra"; // import par nom dans le fichier
                }
                TreeSet<String> callers = new TreeSet<>();
                int refs = 0;
                Address ta = thunks.get(lib + "::" + orig);
                if (ta != null) {
                    for (Reference r : currentProgram.getReferenceManager().getReferencesTo(ta)) {
                        refs++;
                        Function f = currentProgram.getFunctionManager().getFunctionContaining(r.getFromAddress());
                        callers.add(f != null ? ReCommon.addr(f.getEntryPoint()) : ReCommon.addr(r.getFromAddress()) + "(hors fonction)");
                    }
                }
                total++;
                if (!source.equals("-")) named++;
                calls += refs;
                sb.append(lib).append('\t').append(ord).append('\t').append(label).append('\t').append(source).append('\t')
                  .append(callers.size()).append('\t').append(String.join(",", callers)).append('\n');
            }
        }
        ReCommon.write(new File(ReCommon.outDir(currentProgram), "imports.tsv"), sb.toString());
        println("[re] imports : " + total + " ; nommés : " + named + " (dont via DLL : " + fromDll + ") ; références : " + calls);
    }
}
