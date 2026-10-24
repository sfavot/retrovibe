// Post-script : listing désassemblé complet (disasm.txt), utile quand la décompilation 16 bits est mauvaise.
//
// Format d'une ligne : « sel:off  octets  instruction  ; commentaire ». Les adresses de saut et d'appel
// sont recopiées avec le nom de la fonction cible (ou « MODULE::NOM » pour un import) ; les constantes
// égales à l'offset d'une chaîne du segment de données sont suivies de la chaîne (heuristique, même
// règle que strings.tsv).
//@category Mathemagique.RE

import java.io.File;
import java.util.Map;
import java.util.TreeMap;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.ExternalReference;
import ghidra.program.model.symbol.Reference;

public class ExportDisasm extends GhidraScript {
    @Override
    protected void run() throws Exception {
        MemoryBlock dg = ReCommon.dgroup(currentProgram);
        TreeMap<Integer, ReCommon.Str> strs = dg == null ? new TreeMap<>() : ReCommon.findStrings(ReCommon.bytes(dg));
        StringBuilder sb = new StringBuilder();
        sb.append("; Désassemblage de ").append(currentProgram.getName()).append(" (Ghidra). Adresses sélecteur:off ; DS = ")
          .append(String.format("%04x", ReCommon.dgroupSelector(currentProgram))).append('\n');
        Function cur = null;
        boolean inOrphans = false;
        int count = 0;
        for (Instruction ins : currentProgram.getListing().getInstructions(true)) {
            Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
            if (f != cur || (f == null) != inOrphans) {
                cur = f;
                inOrphans = f == null;
                sb.append('\n');
                if (f != null) {
                    sb.append("; ===== ").append(ReCommon.addr(f.getEntryPoint())).append(' ').append(f.getName())
                      .append(" (").append(f.getBody().getNumAddresses()).append(" octets) =====\n");
                } else {
                    sb.append("; ===== instructions hors fonction =====\n");
                }
            }
            StringBuilder b = new StringBuilder();
            for (byte x : ins.getBytes()) b.append(String.format("%02x ", x & 0xff));
            while (b.length() < 18) b.append(' ');
            String text = ins.toString();
            StringBuilder cmt = new StringBuilder();
            for (Reference r : ins.getReferencesFrom()) {
                Address t = r.getToAddress();
                if (r.isExternalReference()) {
                    ExternalReference er = (ExternalReference) r;
                    cmt.append("-> ").append(er.getLibraryName()).append("::").append(er.getLabel()).append(' ');
                } else if (r.getReferenceType().isFlow() && !r.getReferenceType().isIndirect()) {
                    Function tf = currentProgram.getFunctionManager().getFunctionAt(t);
                    cmt.append("-> ").append(ReCommon.addr(t));
                    if (tf != null && ReCommon.thunkLabel(tf) != null) cmt.append(' ').append(ReCommon.thunkLabel(tf));
                    else if (tf != null && !tf.getName().startsWith("FUN_")) cmt.append(' ').append(tf.getName());
                    cmt.append(' ');
                }
            }
            if (dg != null) {
                boolean nearDs = ReCommon.nearDs(ins);
                for (Map.Entry<Long, String> e : ReCommon.dataOperands(ins, dg).entrySet()) {
                    int v = (int) (long) e.getKey();
                    ReCommon.Str s = strs.get(v);
                    if (s == null) continue;
                    if (v < 0x200 && e.getValue().equals("imm") && !nearDs) continue;
                    String t = ReCommon.esc(s.text());
                    cmt.append("\"").append(t.length() > 70 ? t.substring(0, 70) + "..." : t).append("\" ");
                }
            }
            sb.append(ReCommon.addr(ins.getAddress())).append("  ").append(b).append(' ').append(text);
            if (cmt.length() > 0) {
                int pad = 44 - text.length();
                for (int i = 0; i < Math.max(pad, 1); i++) sb.append(' ');
                sb.append("; ").append(cmt.toString().trim());
            }
            sb.append('\n');
            count++;
        }
        ReCommon.write(new File(ReCommon.outDir(currentProgram), "disasm.txt"), sb.toString());
        println("[re] instructions exportées : " + count);
    }
}
