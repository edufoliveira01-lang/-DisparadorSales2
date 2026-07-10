import nodemailer from "nodemailer";

export async function sendRecoveryEmail(to: string, token: string) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const recoveryUrl = `${process.env.APP_URL || 'http://localhost:3333'}/login?token=${token}`;

  const mailOptions = {
    from: `"DisparaZap" <${process.env.SMTP_USER}>`,
    to,
    subject: "Recuperação de Senha - DisparaZap",
    text: `Você solicitou a recuperação de senha. Use o link abaixo para definir uma nova senha:\n\n${recoveryUrl}\n\nEste link expira em 1 hora.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Recuperação de Senha</h2>
        <p>Você solicitou a recuperação de senha para o <b>DisparaZap</b>.</p>
        <p>Clique no botão abaixo para definir uma nova senha:</p>
        <div style="margin: 30px 0;">
          <a href="${recoveryUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Definir Nova Senha</a>
        </div>
        <p style="color: #666; font-size: 12px;">Se você não solicitou esta alteração, ignore este e-mail.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 10px;">Link direto: ${recoveryUrl}</p>
      </div>
    `,
  };

  try {
    if (process.env.SMTP_HOST) {
      await transporter.sendMail(mailOptions);
      console.log(`[Email] Link de recuperação enviado para ${to}`);
    } else {
      console.log("\n" + "=".repeat(50));
      console.log("AVISO: SMTP não configurado no .env");
      console.log(`Link de recuperação para ${to}:`);
      console.log(recoveryUrl);
      console.log("=".repeat(50) + "\n");
    }
  } catch (error) {
    console.error("[Email] Erro ao enviar e-mail:", error);
    throw error;
  }
}
