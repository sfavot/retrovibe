// Post-script : exporte les chaînes du segment de données et les fonctions qui les référencent.
//
// Win16 passe les chaînes par « PUSH DS ; PUSH offset » : Ghidra ne voit pas toujours ces références.
// On parcourt donc toutes les instructions et on associe chaque constante 16 bits égale à l'offset
// d'une chaîne du segment de données automatique à la fonction qui la contient.
//
// Sortie strings.tsv (colonnes séparées par des tabulations) :
//   adresse  longueur  chaîne  références
// Références : « segment:offset_fonction/type », séparées par « ; ». Types :
//   ref  référence posée par Ghidra (analyse) vers la chaîne ;
//   imm  constante immédiate (PUSH/MOV/LEA) égale à l'offset de la chaîne ;
//   mem  opérande mémoire absolu sur la chaîne.
// Les types imm et mem sont heuristiques. Seuls les blocs de données (Data<n>) sont lus.
//@category Mathemagique.RE

import java.io.File;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
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
    @Override
    protected void run() throws Exception {
        MemoryBlock dg = ReCommon.dgroup(currentProgram);
        StringBuilder sb = new StringBuilder();
        sb.append("# adresse\tlongueur\tchaine\treferences (fonction/type ; types : ref = Ghidra, imm/mem = heuristiques)\n");
        if (dg == null) {
            ReCommon.write(new File(ReCommon.outDir(currentProgram), "strings.tsv"), sb.toString());
            println("[re] aucun segment de données");
            return;
        }
        // chaînes de tous les blocs de données, clé = adresse linéaire
        TreeMap<Address, ReCommon.Str> all = new TreeMap<>();
        TreeMap<Integer, ReCommon.Str> inDg = new TreeMap<>();
        for (MemoryBlock b : ReCommon.dataBlocks(currentProgram)) {
            for (ReCommon.Str s : ReCommon.findStrings(ReCommon.bytes(b)).values()) {
                all.put(b.getStart().add(s.off), s);
                if (b == dg) inDg.put(s.off, s);
            }
        }
        println("[re] chaînes trouvées : " + all.size() + " (segment automatique " + dg.getName() + " " + ReCommon.addr(dg.getStart()) + ")");

        Map<Address, Set<String>> refs = new LinkedHashMap<>();
        Map<String, Integer> kinds = new TreeMap<>();
        for (Instruction ins : currentProgram.getListing().getInstructions(true)) {
            Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
            if (f == null) continue;
            String fa = ReCommon.addr(f.getEntryPoint());
            for (Reference r : ins.getReferencesFrom()) {
                Address t = r.getToAddress();
                java.util.Map.Entry<Address, ReCommon.Str> e = all.floorEntry(t);
                if (e != null && e.getKey().getAddressSpace().equals(t.getAddressSpace())
                        && t.subtract(e.getKey()) == 0) add(refs, e.getKey(), fa + "/ref", kinds, "ref");
            }
            boolean nearDs = ReCommon.nearDs(ins);
            for (Map.Entry<Long, String> e : ReCommon.dataOperands(ins, dg).entrySet()) {
                int v = (int) (long) e.getKey();
                if (v < 0x200 && !nearDs && e.getValue().equals("imm")) continue;
                if (inDg.containsKey(v)) add(refs, dg.getStart().add(v), fa + "/" + e.getValue(), kinds, e.getValue());
            }
        }

        int referenced = 0;
        for (Map.Entry<Address, ReCommon.Str> e : all.entrySet()) {
            Set<String> r = refs.get(e.getKey());
            if (r != null && !r.isEmpty()) referenced++;
            sb.append(ReCommon.addr(e.getKey())).append('\t').append(e.getValue().raw.length).append('\t')
              .append(ReCommon.esc(e.getValue().text())).append('\t')
              .append(r == null ? "" : String.join(";", r)).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(currentProgram), "strings.tsv"), sb.toString());
        println("[re] chaînes référencées : " + referenced + " / " + all.size() + " ; références par type : " + kinds);
    }

    private void add(Map<Address, Set<String>> refs, Address str, String ref, Map<String, Integer> kinds, String kind) {
        if (refs.computeIfAbsent(str, k -> new LinkedHashSet<>()).add(ref)) kinds.merge(kind, 1, Integer::sum);
    }
}
