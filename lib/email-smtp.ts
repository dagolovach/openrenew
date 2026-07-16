import nodemailer from "nodemailer";

export function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function alertRecipients(): string[] {
  return (process.env.ALERT_RECIPIENTS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transporter.sendMail({ from: process.env.SMTP_FROM, ...opts });
}
