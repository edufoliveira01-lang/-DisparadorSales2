import fs from "node:fs";
import path from "node:path";
export class WhatsappSessionRecoveryError extends Error {}

/** Move only the closed Chromium profile; application data and conversations are untouched. */
export function backupWhatsappProfile(dataDirectory: string, profileIsActive: (directory: string) => boolean): string | null {
  const profile = path.join(dataDirectory, "wwebjs_auth", "session");
  const marker = path.join(dataDirectory, "whatsapp-session-ready.json");
  if (profileIsActive(profile)) throw new WhatsappSessionRecoveryError("O navegador ainda está encerrando. Aguarde alguns segundos antes de gerar um novo QR Code.");
  if (!fs.existsSync(profile) && !fs.existsSync(marker)) return null;
  const backups = path.join(dataDirectory, "whatsapp-session-backups");
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  const backup = fs.mkdtempSync(path.join(backups, "session-"));
  fs.chmodSync(backup, 0o700);
  const profileExists = fs.existsSync(profile);
  try {
    if (profileExists) fs.renameSync(profile, path.join(backup, "session"));
    if (fs.existsSync(marker)) fs.renameSync(marker, path.join(backup, "session-ready.json"));
  } catch (error) {
    // If moving the marker failed, restore the original profile before returning the error.
    if (profileExists && !fs.existsSync(profile) && fs.existsSync(path.join(backup, "session"))) fs.renameSync(path.join(backup, "session"), profile);
    throw error;
  }
  return backup;
}
