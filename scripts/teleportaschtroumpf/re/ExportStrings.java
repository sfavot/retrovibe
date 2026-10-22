// Post-script : exporte les chaînes de DGROUP et les fonctions qui les référencent.
//
// En real mode 16 bits, Ghidra rate la plupart des références aux chaînes : le code les passe par
// DS + offset immédiat (« PUSH DS ; PUSH 0x1234 »). On parcourt donc toutes les instructions et on
// associe chaque constante 16 bits égale à l'offset d'une chaîne à la fonction qui la contient.
//
// Sortie strings.tsv (colonnes séparées par des tabulations) :
//   adresse  longueur  chaîne  références
// Références : « segment:offset_fonction/type », séparées par « ; ». Types :
//   imm   constante immédiate (PUSH/MOV/LEA) égale à l'offset de la chaîne ;
//   mem   opérande mémoire absolu sur la chaîne ;
//   table la chaîne est dans une table de pointeurs de DGROUP et la fonction référence cette table.
// Toutes ces références sont heuristiques (aucune n'est issue de l'analyse de Ghidra).
//@category Teleportaschtroumpf.RE

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;

public class ExportStrings extends GhidraScript {

    /** Suite de pointeurs de chaînes dans DGROUP (stride 2 : pointeur proche ; stride 4 : pointeur lointain). */
    private static final class Table {
        final int start, stride;
        final List<Integer> cells = new ArrayList<>();  // offsets des cellules
        final List<Integer> strs = new ArrayList<>();   // offset de la chaîne pointée par chaque cellule
        Table(int start, int stride) { this.start = start; this.stride = stride; }
        int end() { return start + cells.size() * stride; }
    }

    @Override
    protected void run() throws Exception {
        int dgSeg = ReCommon.dgroupSegment(currentProgram);
        long dgLin = ReCommon.dgroupLinear(currentProgram);
        byte[] dg = ReCommon.dgroupBytes(currentProgram);
        // le BSS (hors fichier) ne contient pas de chaînes ; on borne les offsets valides à toute la plage de 64 Ko
        int dgSize = 0x10000;

        TreeMap<Integer, ReCommon.Str> strs = ReCommon.findStrings(dg);
        println("[re] chaînes trouvées dans DGROUP : " + strs.size());

        // --- tables de pointeurs de chaînes -------------------------------------------------------
        List<Table> tables = findTables(dg, dgSeg, strs);
        println("[re] tables de pointeurs de chaînes : " + tables.size());

        // --- parcours des instructions -----------------------------------------------------------
        Map<Integer, Set<String>> refs = new LinkedHashMap<>(); // offset chaîne -> "fonction/type"
        Map<String, Integer> kinds = new TreeMap<>();
        for (Instruction ins : currentProgram.getListing().getInstructions(true)) {
            Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
            if (f == null) continue;
            String fa = ReCommon.addr(currentProgram, f.getEntryPoint());
            // Les petits offsets (< 0x200) ressemblent trop à des constantes ordinaires : on les accepte
            // seulement à côté d'un « PUSH DS » / « ... ,DS » (passage d'un pointeur lointain DGROUP:off).
            boolean nearDs = nearDs(ins);
            for (Map.Entry<Long, String> e : ReCommon.dgroupOperands(currentProgram, ins, dgLin, dgSize).entrySet()) {
                long v = e.getKey();
                if (v < 0x200 && !nearDs && e.getValue().equals("imm")) continue;
                if (strs.containsKey((int) v)) {
                    add(refs, (int) v, fa + "/" + e.getValue(), kinds, e.getValue());
                }
                for (Table t : tables) {
                    if (fa.startsWith("1000:")) break; // code Borland : ses constantes ne désignent pas des tables de fichiers
                    if (v < t.start || v >= t.end()) continue;
                    if (v == t.start) {
                        // base du tableau : toutes les chaînes (accès indexé)
                        for (int s : t.strs) add(refs, s, fa + "/table", kinds, "table");
                    } else if ((v - t.start) % t.stride == 0) {
                        add(refs, t.strs.get((int) ((v - t.start) / t.stride)), fa + "/table", kinds, "table");
                    }
                }
            }
        }

        // --- écriture ------------------------------------------------------------------------------
        StringBuilder sb = new StringBuilder();
        sb.append("# adresse\tlongueur\tchaine\treferences (fonction/type ; types : imm, mem, table = heuristiques)\n");
        int referenced = 0;
        for (ReCommon.Str s : strs.values()) {
            Set<String> r = refs.get(s.off);
            if (r != null && !r.isEmpty()) referenced++;
            sb.append(String.format("%04x:%04x", dgSeg, s.off)).append('\t').append(s.raw.length).append('\t')
              .append(ReCommon.esc(s.text())).append('\t')
              .append(r == null ? "" : String.join(";", r)).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(), "strings.tsv"), sb.toString());
        println("[re] chaînes référencées : " + referenced + " / " + strs.size() + " ; références par type : " + kinds);
    }

    private boolean nearDs(Instruction ins) {
        Instruction p = ins.getPrevious();
        Instruction n = ins.getNext();
        for (Instruction x : new Instruction[] { p, n, p == null ? null : p.getPrevious(), n == null ? null : n.getNext() }) {
            if (x == null) continue;
            String t = x.toString();
            if (t.equals("PUSH DS") || t.endsWith(",DS")) return true;
        }
        return false;
    }

    private void add(Map<Integer, Set<String>> refs, int str, String ref, Map<String, Integer> kinds, String kind) {
        if (refs.computeIfAbsent(str, k -> new LinkedHashSet<>()).add(ref)) kinds.merge(kind, 1, Integer::sum);
    }

    /** Suites d'au moins 2 pointeurs vers des chaînes (stride 2), ou pointeurs lointains (stride 4, segment = DGROUP). */
    private List<Table> findTables(byte[] dg, int dgSeg, TreeMap<Integer, ReCommon.Str> strs) {
        List<Table> out = new ArrayList<>();
        boolean[] used = new boolean[dg.length];
        for (int stride : new int[] { 4, 2 }) {
            for (int p = 0; p + stride <= dg.length; p++) {
                if (used[p]) continue;
                Table t = new Table(p, stride);
                int q = p;
                while (q + stride <= dg.length) {
                    int w = (dg[q] & 0xff) | ((dg[q + 1] & 0xff) << 8);
                    boolean ok = strs.containsKey(w);
                    if (ok && stride == 4) {
                        int seg = (dg[q + 2] & 0xff) | ((dg[q + 3] & 0xff) << 8);
                        ok = seg == dgSeg;
                    }
                    if (!ok) break;
                    t.cells.add(q);
                    t.strs.add(w);
                    q += stride;
                }
                if (t.cells.size() >= 2) {
                    out.add(t);
                    for (int k = p; k < q; k++) used[k] = true;
                    p = q - 1;
                }
            }
        }
        return out;
    }
}
