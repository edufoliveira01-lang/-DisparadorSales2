import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router, raw } from "express";
import { dataDir } from "../db";
import { auditAccess } from "../services/accessService";

export const brandingRouter = Router();
const directory = path.join(dataDir, "login-branding");
const types = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
type Extension = keyof typeof types;

function currentImage(): { path: string; type: string; modified: number } | null {
  for (const [extension, type] of Object.entries(types)) {
    const file = path.join(directory, `login.${extension}`);
    if (fs.existsSync(file)) return { path: file, type, modified: fs.statSync(file).mtimeMs };
  }
  return null;
}

function imageType(data: Buffer): Extension | null {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (data.length > 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function loginBranding(_req: import("express").Request, res: import("express").Response) {
  const image = currentImage();
  res.set("Cache-Control", "no-store").json({ customized: Boolean(image), imageUrl: image ? `/api/auth/login-image?v=${Math.floor(image.modified)}` : null });
}

export function loginImage(_req: import("express").Request, res: import("express").Response) {
  const image = currentImage();
  if (!image) return res.status(404).end();
  res.set({ "Cache-Control": "no-store", "Content-Type": image.type, "X-Content-Type-Options": "nosniff" });
  res.sendFile(image.path);
}

brandingRouter.use((req, res, next) => req.accessUser?.role === "administrador" ? next() : res.status(403).json({ error: "Somente o administrador pode alterar a imagem do login." }));
brandingRouter.get("/", loginBranding);
brandingRouter.put("/image", raw({ type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"], limit: "5mb" }), (req, res) => {
  const data = req.body as Buffer;
  if (!Buffer.isBuffer(data) || data.length < 16 || data.length > 5 * 1024 * 1024) return res.status(400).json({ error: "Escolha uma imagem de até 5 MB." });
  const extension = imageType(data);
  if (!extension) return res.status(400).json({ error: "Envie uma imagem PNG, JPG ou WebP válida." });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tmp = path.join(directory, `.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    for (const ext of Object.keys(types)) {
      const file = path.join(directory, `login.${ext}`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.renameSync(tmp, path.join(directory, `login.${extension}`));
    auditAccess("imagem_login_alterada", req.accessUser!.id, null, { formato: extension, tamanho: data.length });
    loginBranding(req, res);
  } catch (error) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    console.error("[Imagem de login] Falha ao salvar:", error);
    res.status(500).json({ error: "Não foi possível salvar a imagem." });
  }
});
brandingRouter.delete("/image", (req, res) => {
  for (const extension of Object.keys(types)) {
    const file = path.join(directory, `login.${extension}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  auditAccess("imagem_login_removida", req.accessUser!.id, null);
  loginBranding(req, res);
});
