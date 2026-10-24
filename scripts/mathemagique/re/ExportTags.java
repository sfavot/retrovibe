// Post-script : fonctions qui référencent un type de ressource Mohawk ou un fichier .DAT.
//
// Les archives Mohawk (*.DAT, MPC/PVG.MHK) désignent leurs ressources par un type de 4 caractères
// ('SCR ', 'SHAP'...). Le code les manipule comme constantes 32 bits, dans un sens ou dans l'autre
// (« 'SCR ' » d'un compilateur C = 0x53435220 ; relue en mémoire little-endian = 0x20524353), et en 16 bits
// elles passent par deux moitiés : « PUSH hi ; PUSH lo » ou deux MOV voisins.
//
// Sortie tags.tsv : fonction, nom, nature, valeur, détail.
//   tag   le type apparaît comme constante 32 bits (une instruction) ou comme deux moitiés de 16 bits
//         dans une fenêtre de 8 instructions (détail : ordre « be »/« le », adresses des instructions) ;
//   data  le type apparaît en clair dans un segment de données, à une adresse référencée par la fonction
//         (détail : adresse de la donnée) ;
//   dat   la fonction référence une chaîne contenant « .dat » ou « .mhk » (détail : adresse de la chaîne ;
//         heuristique de strings.tsv).
// Les moitiés de 16 bits sont des heuristiques : une constante banale peut coïncider (rare).
//@category Mathemagique.RE

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;

public class ExportTags extends GhidraScript {
    // \0 écrit « \0 » dans la sortie
    private static final String[] TAGS = {
        "SCR ", "\0SND", "SHAP", "SHPL", "SNDL", "STRL", "PUZZ", "PTRN", "PLST", "TARG", "UNIT", "CURS", "SYSX", "RSFL",
        "tBMP", "tPAL", "tWAV",
    };

    private static String show(String t) { return t.replace("\0", "\\0"); }

    private static long be(String t) {
        return ((t.charAt(0) & 0xffL) << 24) | ((t.charAt(1) & 0xffL) << 16) | ((t.charAt(2) & 0xffL) << 8) | (t.charAt(3) & 0xffL);
    }

    private static long le(String t) {
        return ((t.charAt(3) & 0xffL) << 24) | ((t.charAt(2) & 0xffL) << 16) | ((t.charAt(1) & 0xffL) << 8) | (t.charAt(0) & 0xffL);
    }

    /** Constantes immédiates d'une instruction (valeurs non signées). */
    private static List<Long> scalars(Instruction ins) {
        List<Long> l = new ArrayList<>();
        for (int op = 0; op < ins.getNumOperands(); op++)
            for (Object o : ins.getOpObjects(op))
                if (o instanceof Scalar) l.add(((Scalar) o).getUnsignedValue());
        return l;
    }

    @Override
    protected void run() throws Exception {
        // lignes triées par fonction
        TreeMap<String, List<String>> rows = new TreeMap<>();
        Map<String, String> names = new TreeMap<>();
        Set<String> seen = new LinkedHashSet<>();

        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (!ReCommon.isCode(currentProgram, f.getEntryPoint())) continue;
            String fa = ReCommon.addr(f.getEntryPoint());
            names.put(fa, f.getName());
            List<Instruction> ins = new ArrayList<>();
            for (Instruction i : currentProgram.getListing().getInstructions(f.getBody(), true)) ins.add(i);
            List<List<Long>> sc = new ArrayList<>();
            for (Instruction i : ins) sc.add(scalars(i));
            for (String t : TAGS) {
                for (int order = 0; order < 2; order++) {
                    long v = order == 0 ? be(t) : le(t);
                    String ord = order == 0 ? "be" : "le";
                    long hi = v >>> 16, lo = v & 0xffff;
                    for (int k = 0; k < ins.size(); k++) {
                        if (sc.get(k).contains(v)) {
                            add(rows, seen, fa, "tag", show(t), ord + " 32 bits @" + ReCommon.addr(ins.get(k).getAddress()));
                            continue;
                        }
                        // deux moitiés : hi puis lo (ou lo puis hi) dans les 8 instructions suivantes
                        for (int pass = 0; pass < 2; pass++) {
                            long first = pass == 0 ? hi : lo, second = pass == 0 ? lo : hi;
                            if (!sc.get(k).contains(first)) continue;
                            for (int j = k + 1; j < Math.min(ins.size(), k + 8); j++) {
                                if (sc.get(j).contains(second)) {
                                    add(rows, seen, fa, "tag", show(t), ord + " 16+16 bits @" + ReCommon.addr(ins.get(k).getAddress())
                                        + "," + ReCommon.addr(ins.get(j).getAddress()));
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        // tags en clair dans les segments de données, référencés par une fonction
        for (MemoryBlock b : ReCommon.dataBlocks(currentProgram)) {
            byte[] d = ReCommon.bytes(b);
            for (String t : TAGS) {
                byte[] pat = t.getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
                for (int i = 0; i + 4 <= d.length; i++) {
                    boolean m = true;
                    for (int k = 0; k < 4 && m; k++) m = d[i + k] == pat[k];
                    if (!m) continue;
                    Address da = b.getStart().add(i);
                    for (Reference r : currentProgram.getReferenceManager().getReferencesTo(da)) {
                        Function f = currentProgram.getFunctionManager().getFunctionContaining(r.getFromAddress());
                        if (f != null) add(rows, seen, ReCommon.addr(f.getEntryPoint()), "data", show(t), "@" + ReCommon.addr(da));
                    }
                }
            }
        }

        // noms de fichiers DAT : relus depuis strings.tsv (écrit par ExportStrings, qui précède ce script)
        File sf = new File(ReCommon.outDir(currentProgram), "strings.tsv");
        if (sf.exists()) {
            for (String line : java.nio.file.Files.readAllLines(sf.toPath())) {
                if (line.startsWith("#")) continue;
                String[] c = line.split("\t", -1);
                if (c.length < 4) continue;
                String low = c[2].toLowerCase();
                if (!(low.contains(".dat") || low.contains(".mhk"))) continue;
                for (String ref : c[3].split(";")) {
                    if (ref.isEmpty()) continue;
                    String fa = ref.substring(0, ref.indexOf('/'));
                    add(rows, seen, fa, "dat", c[2], c[0]);
                }
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("# fonction\tnom\tnature (tag | data | dat)\tvaleur\tdetail\n");
        int n = 0;
        for (Map.Entry<String, List<String>> e : rows.entrySet())
            for (String r : e.getValue()) {
                sb.append(e.getKey()).append('\t').append(names.getOrDefault(e.getKey(), "?")).append('\t').append(r).append('\n');
                n++;
            }
        ReCommon.write(new File(ReCommon.outDir(currentProgram), "tags.tsv"), sb.toString());
        println("[re] références de tags / .dat : " + n + " dans " + rows.size() + " fonctions");
    }

    private void add(TreeMap<String, List<String>> rows, Set<String> seen, String fa, String kind, String value, String detail) {
        String row = kind + "\t" + ReCommon.esc(value) + "\t" + detail;
        if (!seen.add(fa + "|" + row)) return;
        rows.computeIfAbsent(fa, k -> new ArrayList<>()).add(row);
    }
}
