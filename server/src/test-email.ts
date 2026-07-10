import "dotenv/config";
import nodemailer from "nodemailer";

async function test() {
  console.log("--- Iniciando Teste de SMTP ---");
  console.log("Host:", process.env.SMTP_HOST);
  console.log("Porta:", process.env.SMTP_PORT);
  console.log("Usuário:", process.env.SMTP_USER);
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    console.log("Tentando conectar...");
    await transporter.verify();
    console.log("✅ SUCESSO: Conexão com o servidor de e-mail estabelecida!");
    
    console.log("Tentando enviar e-mail de teste...");
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER, // Envia para si mesmo
      subject: "Teste de Conexão - DisparaZap",
      text: "Se você recebeu isso, seu SMTP está funcionando perfeitamente!"
    });
    console.log("✅ SUCESSO: E-mail de teste enviado!");
  } catch (error: any) {
    console.error("❌ ERRO NO SMTP:");
    console.error("Código:", error.code);
    console.error("Comando:", error.command);
    console.error("Resposta do Servidor:", error.response);
    console.error("Mensagem Completa:", error.message);
    
    if (error.code === 'ETIMEDOUT') {
      console.log("\nDICA: A Linode costuma bloquear portas de e-mail (587, 465). Você pode precisar abrir um ticket no suporte deles pedindo para liberar o tráfego SMTP.");
    }
  }
}

test();
