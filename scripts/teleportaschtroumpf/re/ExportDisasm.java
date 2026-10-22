// Post-script : listing désassemblé complet (disasm.txt), utile quand la décompilation 16 bits est mauvaise.
//
// Format d'une ligne : « seg:off  octets  instruction  ; commentaire ». Les adresses de saut et d'appel
// sont recopiées normalisées (segment du bloc de code, comme dans les noms de fichiers de decomp/) avec le
// nom de la fonction cible ; les constantes égales à l'offset d'une chaîne de DGROUP sont suivies de la
// chaîne (heuristique, même règle que strings.tsv).
//@category Teleportaschtroumpf.RE

import java.io.File;
import java.util.Map;
import java.util.TreeMap;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.Reference;

public class ExportDisasm extends GhidraScript {
    @Override
    protected void run() throws Exception {
        long dgLin = ReCommon.dgroupLinear(currentProgram);
        TreeMap<Integer, ReCommon.Str> strs = ReCommon.findStrings(ReCommon.dgroupBytes(currentProgram));
        StringBuilder sb = new StringBuilder();
        sb.append("; Désassemblage de SMURF.EXE (Ghidra). Adresses seg:off ; DGROUP = ")
          .append(String.format("%04x", ReCommon.dgroupSegment(currentProgram))).append('\n');
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
                    sb.append("; ===== ").append(ReCommon.addr(currentProgram, f.getEntryPoint())).append(' ').append(f.getName())
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
                if (r.getReferenceType().isFlow() && !r.getReferenceType().isIndirect()) {
                    Address t = r.getToAddress();
                    Function tf = currentProgram.getFunctionManager().getFunctionAt(t);
                    cmt.append("-> ").append(ReCommon.addr(currentProgram, t));
                    if (tf != null && !tf.getName().startsWith("FUN_")) cmt.append(' ').append(tf.getName());
                    cmt.append(' ');
                }
            }
            boolean nearDs = false;
            Instruction p = ins.getPrevious(), n = ins.getNext();
            for (Instruction x : new Instruction[] { p, n }) {
                if (x != null && (x.toString().equals("PUSH DS") || x.toString().endsWith(",DS"))) nearDs = true;
            }
            for (Map.Entry<Long, String> e : ReCommon.dgroupOperands(currentProgram, ins, dgLin, 0x10000).entrySet()) {
                int v = (int) (long) e.getKey();
                ReCommon.Str s = strs.get(v);
                if (s == null) continue;
                if (v < 0x200 && e.getValue().equals("imm") && !nearDs) continue;
                String t = ReCommon.esc(s.text());
                cmt.append("\"").append(t.length() > 70 ? t.substring(0, 70) + "..." : t).append("\" ");
            }
            sb.append(ReCommon.addr(currentProgram, ins.getAddress())).append("  ").append(b).append(' ').append(text);
            if (cmt.length() > 0) {
                int pad = 44 - text.length();
                for (int i = 0; i < Math.max(pad, 1); i++) sb.append(' ');
                sb.append("; ").append(cmt.toString().trim());
            }
            sb.append('\n');
            count++;
        }
        ReCommon.write(new File(ReCommon.outDir(), "disasm.txt"), sb.toString());
        println("[re] instructions exportées : " + count);
    }
}
