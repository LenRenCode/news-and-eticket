import cors from "cors";
import express, { Request, Response } from "express";
import { TransactionService } from "./modules/transactions/transaction.service";
import { MidtransPaymentService } from "./modules/payments/midtrans.service";
import { ScannerService } from "./modules/checkin/scanner.service";
import { ReportService } from "./modules/reports/report.service";
import { isProductionMode } from "./modules/app-mode";
import { createRateLimiter } from "./modules/rate-limiter";
import {
  clearAdminSession,
  issueAdminSession,
  requireAdmin,
  requireSameOrigin,
  verifyAdminCredentials,
} from "./modules/admin-auth";

export const app = express();

// Trust proxy hanya loopback agar req.ip menggunakan IP asli dari reverse proxy (X-Forwarded-For)
app.set("trust proxy", "loopback");

const allowedOrigins = [
  new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000").origin,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS origin tidak diizinkan"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

app.use(express.json());

// Rate Limiter untuk API Tiket (Hanya untuk checkout & login admin)
const adminLoginLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 5,
  message: "Terlalu banyak percobaan login admin dari IP ini. Silakan tunggu 1 menit.",
});

const checkoutLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: "Terlalu banyak permintaan pemesanan tiket dari IP ini. Silakan tunggu sebentar.",
});

// -----------------------------------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------------------------------
app.get(["/health", "/api/health"], (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "eticket-api-2026",
  });
});

app.post("/api/admin/login", adminLoginLimiter, requireSameOrigin, (req: Request, res: Response) => {
  const validCredentials = verifyAdminCredentials(
    req.body?.username,
    req.body?.password
  );
  if (validCredentials === null) {
    res.status(503).json({
      success: false,
      error: "Konfigurasi ADMIN_USERNAME, ADMIN_PASSWORD, dan ADMIN_SESSION_SECRET belum lengkap",
    });
    return;
  }
  if (!validCredentials) {
    res.status(401).json({ success: false, error: "Username atau password salah" });
    return;
  }
  issueAdminSession(req, res);
});

app.post(
  "/api/admin/logout",
  requireSameOrigin,
  (req: Request, res: Response) => clearAdminSession(req, res)
);

app.get("/api/admin/session", requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, authenticated: true });
});

// -----------------------------------------------------------------------------
// 1. INFO KUOTA & EVENT
// -----------------------------------------------------------------------------
app.get("/api/quota", async (req: Request, res: Response) => {
  try {
    const rawQuotaId = req.query.kuotaId ?? "1";
    const kuotaId = Number(rawQuotaId);
    if (!Number.isSafeInteger(kuotaId) || kuotaId < 1) {
      res.status(400).json({ success: false, error: "kuotaId tidak valid" });
      return;
    }
    const quota = await TransactionService.getQuotaInfo(kuotaId);
    res.json({ success: true, data: quota });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 2. GUEST CHECKOUT (PESSIMISTIC LOCKING)
// -----------------------------------------------------------------------------
app.post("/api/checkout", checkoutLimiter, async (req: Request, res: Response) => {
  try {
    const { nama, email, noWhatsapp, jumlahTiket } = req.body;
    const kuotaId = Number(req.body?.kuotaId ?? 1);
    if (!Number.isSafeInteger(kuotaId) || kuotaId < 1) {
      res.status(400).json({ success: false, error: "kuotaId tidak valid" });
      return;
    }
    const result = await TransactionService.checkoutGuest({
      nama,
      email,
      noWhatsapp,
      jumlahTiket: Number(jumlahTiket),
      kuotaId,
    });

    res.status(201).json({
      success: true,
      message: "Checkout berhasil dibuat. Menunggu pembayaran QRIS.",
      data: result,
    });
  } catch (error: any) {
    console.error("[Checkout Error]", error);
    const isConflict = error.message?.includes("tidak mencukupi");
    res.status(isConflict ? 409 : 400).json({
      success: false,
      error: error.message || "Gagal memproses checkout",
    });
  }
});

// -----------------------------------------------------------------------------
// 3. STATUS TRANSAKSI & DETAIL TIKET
// -----------------------------------------------------------------------------
app.get("/api/transactions/:id", async (req: Request, res: Response) => {
  try {
    const trx = await TransactionService.getTransactionStatus(String(req.params.id));
    res.json({ success: true, data: trx });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
});

app.get("/api/tickets/:uuid", async (req: Request, res: Response) => {
  try {
    const ticket = await TransactionService.getTicketById(String(req.params.uuid));
    res.json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 4. MIDTRANS QRIS WEBHOOK CALLBACK
// -----------------------------------------------------------------------------
app.post("/api/payments/webhook", async (req: Request, res: Response) => {
  try {
    const notification = req.body;
    console.log("[Midtrans Webhook Received]:", notification);

    const orderId = notification.order_id;
    const statusCode = notification.status_code;
    const grossAmount = notification.gross_amount;
    const signatureKey = notification.signature_key;
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    // Verifikasi Keaslian Signature
    const isValid = MidtransPaymentService.verifySignature(
      orderId,
      statusCode,
      grossAmount,
      signatureKey
    );

    if (!isValid) {
      console.warn("[Webhook Warning] Tanda tangan signature Midtrans tidak valid!");
      return res.status(401).json({ message: "Invalid signature" });
    }

    // Status QRIS Midtrans sukses: 'settlement' atau ('capture' dan fraud 'accept')
    const isSuccess =
      transactionStatus === "settlement" ||
      (transactionStatus === "capture" && fraudStatus === "accept");

    if (isSuccess) {
      try {
        await TransactionService.confirmPaymentAndIssueTickets(
          orderId,
          notification.transaction_id,
          grossAmount
        );
        console.log(`[Webhook Success] Pembayaran untuk ${orderId} terverifikasi lunas.`);
      } catch (err: any) {
        console.error(`[Webhook Rejection] ${err.message}`);
        if (err.message && err.message.includes("tidak ditemukan")) {
          return res.status(404).json({ status: "Error", message: err.message });
        }
        if (err.message && err.message.includes("Gross amount mismatch")) {
          return res.status(400).json({ status: "Error", message: err.message });
        }
        throw err;
      }
    }

    res.status(200).json({ status: "OK" });
  } catch (error: any) {
    console.error("[Webhook Error]:", error);
    res.status(500).json({ status: "Error", message: error.message });
  }
});

// Endpoint Pembantu Testing: Simulasi Pembayaran QRIS Berhasil (Hanya Mode Demo)
app.post(
  "/api/payments/simulate-success/:id",
  requireSameOrigin,
  requireAdmin,
  async (req: Request, res: Response) => {
    if (isProductionMode()) {
      res.sendStatus(404);
      return;
    }
    try {
      const result = await TransactionService.confirmPaymentAndIssueTickets(
        String(req.params.id),
        `SIM-${Date.now()}`
      );
      res.json({
        success: true,
        message: "Simulasi pembayaran QRIS berhasil. Tiket telah diterbitkan!",
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// -----------------------------------------------------------------------------
// 5. VALIDASI SCAN CHECK-IN (QR SCANNER)
// -----------------------------------------------------------------------------
app.post("/api/scan", requireSameOrigin, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { ticketUuid, scannedBy } = req.body;

    if (!ticketUuid) {
      return res.status(400).json({
        success: false,
        error: "ticketUuid wajib disertakan dalam request body",
      });
    }

    const result = await ScannerService.validateAndCheckIn(
      ticketUuid,
      scannedBy || "Kru Bus"
    );

    const httpStatus =
      result.status === "VALID"
        ? 200
        : result.status === "ALREADY_SCANNED"
        ? 409
        : 404;

    res.status(httpStatus).json({
      success: result.status === "VALID",
      ...result,
    });
  } catch (error: any) {
    console.error("[Scan Error]", error);
    res.status(500).json({
      success: false,
      status: "ERROR",
      pesan: error.message || "Gagal memproses validasi tiket",
    });
  }
});

// -----------------------------------------------------------------------------
// 6. EXPORT EXCEL BACKUP UNTUK PANITIA
// -----------------------------------------------------------------------------
app.get(
  "/api/admin/forecast",
  requireAdmin,
  async (_req: Request, res: Response) => {
    try {
      const forecast = await ReportService.getMonthlyForecast();
      res.json({ success: true, data: forecast });
    } catch (error: any) {
      console.error("[Forecast Error]", error);
      res.status(500).json({
        success: false,
        error: error.message || "Gagal menghitung prediksi bulanan",
      });
    }
  }
);

app.get("/api/reports/export-excel", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const excelBuffer = await ReportService.generateExcelBackup();
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `Laporan_Tiket_Bus_${timestamp}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(excelBuffer);
  } catch (error: any) {
    console.error("[Export Error]", error);
    res.status(500).json({
      success: false,
      error: error.message || "Gagal membuat file export Excel",
    });
  }
});

// -----------------------------------------------------------------------------
// 7. AKSI ADMIN: REFUND TRANSAKSI (NEEDS_REFUND -> REFUNDED)
// -----------------------------------------------------------------------------
app.post(
  "/api/admin/transactions/:id/refund",
  requireSameOrigin,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { notes, operator } = req.body || {};
      const result = await TransactionService.markAsRefunded(
        String(id),
        notes,
        operator || "Admin"
      );
      res.json(result);
    } catch (error: any) {
      console.error("[Admin Refund Error]", error);
      const isNotFound = error.message?.includes("tidak ditemukan");
      res.status(isNotFound ? 404 : 400).json({
        success: false,
        error: error.message || "Gagal memproses refund transaksi",
      });
    }
  }
);
