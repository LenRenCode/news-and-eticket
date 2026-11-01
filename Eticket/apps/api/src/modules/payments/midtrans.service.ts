import crypto from "crypto";
import dotenv from "dotenv";
import { isProductionMode } from "../app-mode";

dotenv.config({ path: "../../.env" });

const MIDTRANS_SERVER_KEY = process.env.PAYMENT_API_KEY || "";
const MIDTRANS_BASE_URL =
  process.env.PAYMENT_API_BASE_URL || "https://api.sandbox.midtrans.com";

export interface QrisChargeResult {
  orderId: string;
  transactionId?: string;
  qrPayload: string;
  qrUrl?: string;
  grossAmount: number;
  status: string;
}

export class MidtransPaymentService {
  /**
   * Request QRIS Dinamis ke Midtrans Core API
   */
  static async createQrisCharge(
    orderId: string,
    grossAmount: number,
    buyer: { nama: string; email: string; phone: string }
  ): Promise<QrisChargeResult> {
    // Jika API Key belum diatur atau masih dummy di .env, gunakan mode simulasi QRIS
    const isPlaceholderKey =
      !MIDTRANS_SERVER_KEY ||
      MIDTRANS_SERVER_KEY.includes("YOUR_") ||
      MIDTRANS_SERVER_KEY.includes("demo-key");

    if (isPlaceholderKey) {
      if (isProductionMode()) {
        throw new Error("PAYMENT_API_KEY wajib diisi untuk mode production.");
      }
      console.warn(
        "[Midtrans] PAYMENT_API_KEY kosong/dummy. Menggunakan mode Simulasi QRIS."
      );
      return {
        orderId,
        qrPayload: `00020101021226590016ID.CO.QRIS.WWW01189360091438000000000215ID1020261014000303UMI51440014ID.LINKAJA.WWW0215202610149999995204581453033605406${grossAmount}.005802ID5913ETICKET FEST6007JAKARTA61051219062070703A016304E67F`,
        qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=SIMULATED_QRIS_${orderId}`,
        grossAmount,
        status: "pending",
      };
    }

    const authHeader = `Basic ${Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString(
      "base64"
    )}`;

    const response = await fetch(`${MIDTRANS_BASE_URL}/v2/charge`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        payment_type: "qris",
        transaction_details: {
          order_id: orderId,
          gross_amount: Math.round(grossAmount),
        },
        customer_details: {
          first_name: buyer.nama,
          email: buyer.email,
          phone: buyer.phone,
        },
        qris: {
          acquirer: "gopay",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gagal membuat tagihan QRIS Midtrans: ${errorText}`);
    }

    const data = await response.json();

    const qrPayload = data.qr_string || "";
    const qrAction = Array.isArray(data.actions)
      ? data.actions.find(
          (act: { name: string; url: string }) => act.name === "generate-qr-code"
        )
      : null;

    return {
      orderId: data.order_id,
      transactionId: data.transaction_id,
      qrPayload,
      qrUrl: qrAction ? qrAction.url : undefined,
      grossAmount: Number(data.gross_amount),
      status: data.transaction_status || "pending",
    };
  }

  /**
   * Verifikasi Keaslian Tanda Tangan Webhook dari Midtrans
   * Format: SHA512(order_id + status_code + gross_amount + ServerKey)
   */
  static verifySignature(
    orderId: string,
    statusCode: string,
    grossAmount: string,
    signatureKey: string
  ): boolean {
    const isPlaceholderKey =
      !MIDTRANS_SERVER_KEY ||
      MIDTRANS_SERVER_KEY.includes("YOUR_") ||
      MIDTRANS_SERVER_KEY.includes("demo-key");
    if (isProductionMode() && isPlaceholderKey) return false;
    if (!MIDTRANS_SERVER_KEY) return true;
    if (
      typeof signatureKey !== "string" ||
      !/^[a-f0-9]{128}$/i.test(signatureKey)
    ) {
      return false;
    }

    const rawString = `${orderId}${statusCode}${grossAmount}${MIDTRANS_SERVER_KEY}`;
    const computedSignature = crypto
      .createHash("sha512")
      .update(rawString)
      .digest("hex");

    return computedSignature.toLowerCase() === signatureKey.toLowerCase();
  }
}
