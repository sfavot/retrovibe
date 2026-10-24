import type { CertificatePort } from "../scenes/certificate";

/** Délai avant de libérer l'URL d'objet : le navigateur doit avoir démarré le téléchargement. */
const REVOKE_DELAY_MS = 10_000;

/** Remet le certificat au joueur : Blob → URL d'objet → lien `<a download>` cliqué. */
export function createCertificateDownload(): CertificatePort {
  return {
    download(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    },
  };
}
