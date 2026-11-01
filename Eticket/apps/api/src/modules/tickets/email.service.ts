import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

interface EmailTicketPayload {
  to: string;
  recipientName: string;
  kodeTransaksi: string;
  tickets: Array<{
    id: string; // UUID v4
    kodeTiket: string;
  }>;
  totalBayar: number;
  eventName?: string;
  webOrigin?: string;
}

export class EmailService {
  private static transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.mailtrap.io",
    port: Number(process.env.SMTP_PORT) || 2525,
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
  });

  static async sendETickets(payload: EmailTicketPayload): Promise<boolean> {
    const webOrigin =
      payload.webOrigin ||
      process.env.WEB_ORIGIN ||
      "http://localhost:3000";
    const eventName = payload.eventName || "Perjalanan Bus Samarinda - Penajam";
    const formattedTotal = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
    }).format(payload.totalBayar);

    const ticketListHtml = payload.tickets
      .map(
        (t, idx) => `
        <div style="border: 2px dashed #6366f1; border-radius: 12px; padding: 16px; margin-bottom: 16px; background-color: #f8fafc;">
          <div style="font-size: 14px; font-weight: 600; color: #4338ca;">TIKET #${idx + 1} - ${t.kodeTiket}</div>
          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">UUID: <code>${t.id}</code></div>
          <div style="margin-top: 12px;">
            <a href="${webOrigin}/tiket/ticket/${t.id}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: bold;">
              Buka Barcode E-Tiket
            </a>
          </div>
        </div>
      `
      )
      .join("");

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; margin: 0; padding: 20px; color: #1e293b; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
          .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
          .content { padding: 32px 24px; }
          .footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 24px;">🎟️ E-Tiket Resmi Anda</h1>
            <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">${eventName}</p>
          </div>
          <div class="content">
            <p>Halo <strong>${payload.recipientName}</strong>,</p>
            <p>Pembayaran Anda untuk transaksi <strong>${payload.kodeTransaksi}</strong> telah berhasil diverifikasi. Berikut adalah e-tiket digital Anda:</p>
            
            <div style="margin: 24px 0;">
              ${ticketListHtml}
            </div>

            <p style="font-size: 14px; color: #475569;">
              <strong>Total Pembayaran:</strong> ${formattedTotal}<br>
              <strong>Petunjuk naik bus:</strong> Tunjukkan barcode/QR code kepada petugas sebelum keberangkatan.
            </p>
          </div>
          <div class="footer">
            E-Tiket Bus · Demo Rute Samarinda - Penajam
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      if (!process.env.SMTP_USER) {
        console.log(
          `[EmailService] Mode simulasi: E-Tiket berhasil dikirim ke ${payload.to} untuk ${payload.tickets.length} tiket.`
        );
        return true;
      }

      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || '"E-Tiket System" <no-reply@eticket.id>',
        to: payload.to,
        subject: `[E-TIKET] Tiket Masuk Resmi Anda - ${payload.kodeTransaksi}`,
        html: htmlContent,
      });

      console.log(`[EmailService] Berhasil mengirim e-tiket ke ${payload.to}`);
      return true;
    } catch (error) {
      console.error("[EmailService] Gagal mengirim email:", error);
      return false;
    }
  }
}
