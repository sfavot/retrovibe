// Post-script : points d'entrée des 15 mini-jeux, lus dans le dispatch de la case « jeu ».
//
// Constat (voir docs/asterix/engine.md et re-index.md) : la fonction 20fa:135a cherche la position du
// joueur courant (0..53) dans une table de 15 mots en CS:20fa:146d, suivie de 15 offsets de blocs :
//   MOV CX,0xf ; MOV BX,0x146d ; CMP [BX],position ; ... ; JMP word ptr CS:[BX + 0x1e]
// Chaque bloc pousse un indice d'annonce, appelle 20fa:130f (voix K60TE), pousse éventuellement un
// argument, puis appelle (CALLF) la fonction principale du mini-jeu ; deux blocs passent par un saut
// vers un appel partagé. Ce script lit la table, suit chaque bloc et écrit module_entries.tsv :
// case (1..54), bloc, indice d'annonce, fonction appelée, argument, taille de la fonction, nombre de
// fonctions et octets du segment de la fonction.
// Les constantes (dispatch, table, annonce) sont celles du constat ; si le dispatch n'est pas trouvé
// le script le signale et n'écrit rien.
//@category Asterix.RE

import java.io.File;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.SegmentedAddressSpace;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;

public class ExportModuleEntries extends GhidraScript {
    private static final String DISPATCHER = "20fa:135a";
    private static final String ANNOUNCE = "20fa:130f";
    private static final int TABLE_OFFSET = 0x146d;
    private static final int COUNT = 15;

    private int word(Address a) throws Exception {
        return (currentProgram.getMemory().getByte(a) & 0xff) | ((currentProgram.getMemory().getByte(a.add(1)) & 0xff) << 8);
    }

    @Override
    protected void run() throws Exception {
        Function disp = getFunctionAt(toAddr(DISPATCHER));
        if (disp == null) {
            println("[re] dispatch " + DISPATCHER + " introuvable : module_entries.tsv non écrit");
            return;
        }
        Address announce = toAddr(ANNOUNCE);
        SegmentedAddressSpace sp = ReCommon.space(currentProgram);
        int seg = ReCommon.segmentOf(currentProgram, disp.getEntryPoint());
        StringBuilder tsv = new StringBuilder("# case\tbloc\tannonce\tfonction_appelee\targument\ttaille\tfonctions_du_segment\toctets_du_segment\n");
        int n = 0;
        for (int k = 0; k < COUNT; k++) {
            int position = word(sp.getAddress(seg, TABLE_OFFSET + 2 * k));
            Address blk = sp.getAddress(seg, word(sp.getAddress(seg, TABLE_OFFSET + 2 * (COUNT + k))));
            Function callee = null;
            long lastPush = -1, annonce = -1, arg = -1;
            Instruction ins = getInstructionAt(blk);
            for (int i = 0; i < 16 && ins != null && callee == null; i++) {
                String m = ins.getMnemonicString();
                Instruction next = ins.getNext();
                if (m.equals("PUSH")) {
                    Object[] ops = ins.getOpObjects(0);
                    // « PUSH CS » précède l'appel proche de l'annonce : seuls les PUSH immédiats comptent
                    if (ops.length == 1 && ops[0] instanceof Scalar) lastPush = ((Scalar) ops[0]).getUnsignedValue();
                } else if (m.startsWith("CALL")) {
                    for (Reference r : ins.getReferencesFrom()) {
                        if (!r.getReferenceType().isCall()) continue;
                        if (r.getToAddress().equals(announce)) {
                            annonce = lastPush;
                        } else {
                            callee = getFunctionAt(r.getToAddress());
                            arg = lastPush;
                        }
                    }
                    lastPush = -1;
                } else if (m.equals("JMP")) {
                    Address[] flows = ins.getFlows();
                    next = flows.length == 1 ? getInstructionAt(flows[0]) : null;
                }
                ins = next;
            }
            int segFuncs = 0;
            long segBytes = 0;
            if (callee != null) {
                int cseg = ReCommon.segmentOf(currentProgram, callee.getEntryPoint());
                FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
                while (it.hasNext()) {
                    Function f = it.next();
                    if (ReCommon.segmentOf(currentProgram, f.getEntryPoint()) == cseg) {
                        segFuncs++;
                        segBytes += f.getBody().getNumAddresses();
                    }
                }
                n++;
            }
            tsv.append(position + 1).append('\t').append(ReCommon.addr(currentProgram, blk)).append('\t')
               .append(annonce).append('\t')
               .append(callee == null ? "-" : ReCommon.addr(currentProgram, callee.getEntryPoint())).append('\t')
               .append(arg < 0 ? "-" : Long.toString(arg)).append('\t')
               .append(callee == null ? 0 : callee.getBody().getNumAddresses()).append('\t')
               .append(segFuncs).append('\t').append(segBytes).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(), "module_entries.tsv"), tsv.toString());
        println("[re] points d'entrée de mini-jeux lus : " + n + " / " + COUNT);
    }
}
