import type { VmContext } from "../host";
import type { SoundSource } from "./backend";

/** Source de sons lue dans la machine virtuelle (toujours son état courant). */
export function vmSoundSource(vm: Pick<VmContext, "getFile" | "resources">): SoundSource {
  return {
    getFile: (name) => vm.getFile(name),
    getResource: (id) => vm.resources?.getResource(id)?.data ?? null,
  };
}
