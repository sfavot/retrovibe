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
//
// Mode NE (Win16, voir ReCommon) : chaînes de tous les blocs de données Data<n>, adresses « sélecteur:offset »,
// pas de tables de pointeurs ; un type supplémentaire :
//   ref   référence posée par Ghidra (analyse) vers la chaîne.
//@category RE

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
import ghidra.program.model.symbol.Reference;

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
        if (ReCommon.isNe(currentProgram)) {
            runNe();
            return;
        }
        int dgSeg = ReCommon.dgroupSegment(currentProgram);
        long dgLin = ReCommon.dgroupLinear(currentProgram);
        byte[] dg = ReCommon.dgroupBytes(currentProgram);
        // le BSS (hors fichier) ne contient pas de chaînes ; on borne les offsets valides à toute la plage de 64 Ko
        // (mode plat 32 bits : toute la zone de données ; la « DGROUP » est son étendue, voir ReCommon)
        boolean flat = ReCommon.isFlat(currentProgram);
        int dgSize = flat ? dg.length : 0x10000;
        long small = ReCommon.smallImm(currentProgram);
        String rtl = ReCommon.rtlPrefix();

        TreeMap<Integer, ReCommon.Str> strs = ReCommon.findStrings(dg, ReCommon.isFlat(currentProgram));
        println("[re] chaînes trouvées dans DGROUP : " + strs.size());

        // --- tables de pointeurs de chaînes -------------------------------------------------------
        List<Table> tables = findTables(dg, dgSeg, strs, flat ? dgLin : -1);
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
            boolean nearDs = !flat && nearDs(ins);
            for (Map.Entry<Long, String> e : ReCommon.dgroupOperands(currentProgram, ins, dgLin, dgSize).entrySet()) {
                long v = e.getKey();
                if (v < small && !nearDs && e.getValue().equals("imm")) continue;
                if (strs.containsKey((int) v)) {
                    add(refs, (int) v, fa + "/" + e.getValue(), kinds, e.getValue());
                }
                for (Table t : tables) {
                    if (rtl != null && fa.startsWith(rtl)) break; // code de bibliothèque : ses constantes ne désignent pas des tables de fichiers
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
            sb.append(ReCommon.strAddr(currentProgram, s.off)).append('\t').append(s.raw.length).append('\t')
              .append(ReCommon.esc(s.text())).append('\t')
              .append(r == null ? "" : String.join(";", r)).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(), "strings.tsv"), sb.toString());
        println("[re] chaînes référencées : " + referenced + " / " + strs.size() + " ; références par type : " + kinds);
    }

    /** Mode NE : chaînes de tous les blocs de données, références Ghidra (ref) et heuristiques (imm, mem). */
    private void runNe() throws Exception {
        MemoryBlock dg = ReCommon.neDgroup(currentProgram);
        StringBuilder sb = new StringBuilder();
        sb.append("# adresse\tlongueur\tchaine\treferences (fonction/type ; types : ref = Ghidra, imm/mem = heuristiques)\n");
        if (dg == null) {
            ReCommon.write(new File(ReCommon.outDir(), "strings.tsv"), sb.toString());
            println("[re] aucun segment de données");
            return;
        }
        // chaînes de tous les blocs de données, clé = adresse
        TreeMap<Address, ReCommon.Str> all = new TreeMap<>();
        TreeMap<Integer, ReCommon.Str> inDg = new TreeMap<>();
        for (MemoryBlock b : ReCommon.neDataBlocks(currentProgram)) {
            for (ReCommon.Str s : ReCommon.neFindStrings(ReCommon.bytes(b)).values()) {
                all.put(b.getStart().add(s.off), s);
                if (b == dg) inDg.put(s.off, s);
            }
        }
        println("[re] chaînes trouvées : " + all.size() + " (segment automatique " + dg.getName() + " " + ReCommon.addr(currentProgram, dg.getStart()) + ")");

        Map<Address, Set<String>> refs = new LinkedHashMap<>();
        Map<String, Integer> kinds = new TreeMap<>();
        for (Instruction ins : currentProgram.getListing().getInstructions(true)) {
            Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
            if (f == null) continue;
            String fa = ReCommon.addr(currentProgram, f.getEntryPoint());
            for (Reference r : ins.getReferencesFrom()) {
                Address t = r.getToAddress();
                Map.Entry<Address, ReCommon.Str> e = all.floorEntry(t);
                if (e != null && e.getKey().getAddressSpace().equals(t.getAddressSpace())
                        && t.subtract(e.getKey()) == 0) addNe(refs, e.getKey(), fa + "/ref", kinds, "ref");
            }
            for (Map.Entry<Integer, String> e : ReCommon.neStringOperands(ins, dg, inDg).entrySet()) {
                addNe(refs, dg.getStart().add(e.getKey()), fa + "/" + e.getValue(), kinds, e.getValue());
            }
        }

        int referenced = 0;
        for (Map.Entry<Address, ReCommon.Str> e : all.entrySet()) {
            Set<String> r = refs.get(e.getKey());
            if (r != null && !r.isEmpty()) referenced++;
            sb.append(ReCommon.addr(currentProgram, e.getKey())).append('\t').append(e.getValue().raw.length).append('\t')
              .append(ReCommon.esc(e.getValue().text())).append('\t')
              .append(r == null ? "" : String.join(";", r)).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(), "strings.tsv"), sb.toString());
        println("[re] chaînes référencées : " + referenced + " / " + all.size() + " ; références par type : " + kinds);
    }

    private void addNe(Map<Address, Set<String>> refs, Address str, String ref, Map<String, Integer> kinds, String kind) {
        if (refs.computeIfAbsent(str, k -> new LinkedHashSet<>()).add(ref)) kinds.merge(kind, 1, Integer::sum);
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
    /** Mode plat (flatBase >= 0) : seulement des pointeurs absolus de 32 bits (stride 4) vers des chaînes. */
    private List<Table> findTables(byte[] dg, int dgSeg, TreeMap<Integer, ReCommon.Str> strs, long flatBase) {
        List<Table> out = new ArrayList<>();
        boolean[] used = new boolean[dg.length];
        for (int stride : (flatBase >= 0 ? new int[] { 4 } : new int[] { 4, 2 })) {
            for (int p = 0; p + stride <= dg.length; p++) {
                if (used[p]) continue;
                Table t = new Table(p, stride);
                int q = p;
                while (q + stride <= dg.length) {
                    int w = (dg[q] & 0xff) | ((dg[q + 1] & 0xff) << 8);
                    boolean ok;
                    if (flatBase >= 0) {
                        long abs = (w & 0xffffL) | ((long) ((dg[q + 2] & 0xff) | ((dg[q + 3] & 0xff) << 8)) << 16);
                        w = (int) (abs - flatBase);
                        ok = abs >= flatBase && strs.containsKey(w);
                    } else {
                        ok = strs.containsKey(w);
                    }
                    if (ok && stride == 4 && flatBase < 0) {
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
