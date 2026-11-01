const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "/tiket-api";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const cleanEndpoint = endpoint.startsWith("/api/")
    ? endpoint.slice(4)
    : endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;
  const url = `${API_BASE_URL}${cleanEndpoint}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include",
    ...options,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      data.error || data.pesan || `HTTP error ${res.status}`,
      res.status
    );
  }

  return data;
}

export const api = {
  loginAdmin: (username: string, password: string) =>
    fetchApi("/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logoutAdmin: () =>
    fetchApi("/admin/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getAdminSession: () => fetchApi("/admin/session"),
  getMonthlyForecast: () => fetchApi("/admin/forecast"),
  getQuota: (kuotaId = 1) => fetchApi(`/quota?kuotaId=${kuotaId}`),
  checkout: (payload: {
    nama: string;
    email: string;
    noWhatsapp: string;
    jumlahTiket: number;
    kuotaId?: number;
  }) =>
    fetchApi("/checkout", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getTransaction: (id: string) => fetchApi(`/transactions/${id}`),
  getTicket: (uuid: string) => fetchApi(`/tickets/${uuid}`),
  simulateSuccess: (id: string) =>
    fetchApi(`/payments/simulate-success/${id}`, { method: "POST" }),
  scanTicket: (ticketUuid: string, scannedBy?: string) =>
    fetchApi("/scan", {
      method: "POST",
      body: JSON.stringify({ ticketUuid, scannedBy }),
    }),
  refundTransaction: (id: string, notes?: string, operator?: string) =>
    fetchApi(`/admin/transactions/${id}/refund`, {
      method: "POST",
      body: JSON.stringify({ notes, operator }),
    }),
  getExportExcelUrl: () => `${API_BASE_URL}/reports/export-excel`,
};
