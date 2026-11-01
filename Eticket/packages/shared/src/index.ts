export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

export type AttendanceStatus = "AVAILABLE" | "SCANNED";

export interface KuotaInfo {
  id: number;
  namaEvent: string;
  kategori: string;
  harga: number;
  totalKuota: number;
  kuotaTerjual: number;
  kuotaTerpesan: number;
  sisaKuota: number;
}

export interface GuestCheckoutRequest {
  nama: string;
  email: string;
  noWhatsapp: string;
  jumlahTiket: number;
  kuotaId?: number;
}

export interface CheckoutResponse {
  transaksiId: string;
  kodeTransaksi: string;
  totalBayar: number;
  jumlahTiket: number;
  expiredAt: string;
  qrisPayload?: string;
  qrisUrl?: string;
}

export interface TransactionStatusResponse {
  transaksiId: string;
  kodeTransaksi: string;
  statusPembayaran: PaymentStatus;
  totalBayar: number;
  jumlahTiket: number;
  namaPembeli: string;
  email: string;
  noWhatsapp: string;
  expiredAt: string;
  paidAt?: string | null;
  qrisPayload?: string | null;
  tickets: Array<{
    id: string; // UUID v4 used for QR Code
    kodeTiket: string;
    statusKehadiran: AttendanceStatus;
    waktuScan?: string | null;
  }>;
}

export interface ScanTicketRequest {
  ticketUuid: string;
  scannedBy?: string;
}

export interface ScanTicketResponse {
  status: "VALID" | "ALREADY_SCANNED" | "NOT_FOUND";
  pesan: string;
  data?: {
    ticketId: string;
    kodeTiket: string;
    namaPembeli: string;
    waktuScan?: string;
    namaEvent?: string;
  };
}

export interface ExportReportData {
  kodeTransaksi: string;
  namaPembeli: string;
  email: string;
  noWhatsapp: string;
  jumlahTiket: number;
  totalBayar: number;
  statusPembayaran: PaymentStatus;
  kodeTiket: string;
  ticketUuid: string;
  statusKehadiran: AttendanceStatus;
  waktuScan?: string;
  waktuTransaksi: string;
}
