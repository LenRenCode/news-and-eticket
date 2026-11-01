-- ==============================================================================
-- SISTEM E-TIKET QRIS 2026 - SKEMA DATABASE POSTGRESQL & PESSIMISTIC LOCKING
-- ==============================================================================

-- 1. Inisialisasi Ekstensi UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUM Types
DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'NEEDS_REFUND';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'REFUNDED';

DO $$ BEGIN
    CREATE TYPE attendance_status AS ENUM ('AVAILABLE', 'SCANNED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------------------------
-- TABEL PENDUKUNG: kuota_tiket (Master Data & Kontrol Stok Kategori Tiket)
-- Digunakan untuk Pessimistic Locking (SELECT ... FOR UPDATE)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kuota_tiket (
    id SERIAL PRIMARY KEY,
    nama_event VARCHAR(150) NOT NULL DEFAULT 'Samarinda - Penajam',
    kategori VARCHAR(100) NOT NULL DEFAULT 'Bus demo',
    harga NUMERIC(12, 2) NOT NULL DEFAULT 150000.00,
    total_kuota INT NOT NULL DEFAULT 40,
    kuota_terjual INT NOT NULL DEFAULT 0,
    kuota_terpesan INT NOT NULL DEFAULT 0, -- Reservasi saat transaksi PENDING
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_kuota_valid CHECK (kuota_terjual + kuota_terpesan <= total_kuota),
    CONSTRAINT check_positif CHECK (total_kuota >= 0 AND kuota_terjual >= 0 AND kuota_terpesan >= 0)
);

-- Seed Data Kuota jika kosong
INSERT INTO kuota_tiket (id, nama_event, kategori, harga, total_kuota, kuota_terjual, kuota_terpesan)
VALUES (1, 'Samarinda → Penajam', 'Bus demo · 08:00', 150000.00, 40, 0, 0)
ON CONFLICT (id) DO NOTHING;

UPDATE kuota_tiket
SET nama_event = 'Samarinda → Penajam',
    kategori = 'Bus demo · 08:00',
    harga = 150000.00,
    total_kuota = 40
WHERE id = 1 AND nama_event = '2026 Grand Tech & Music Fest';

INSERT INTO kuota_tiket (id, nama_event, kategori, harga, total_kuota, kuota_terjual, kuota_terpesan)
VALUES
    (2, 'Samarinda → Penajam', 'Bus demo · 13:00', 150000.00, 40, 0, 0),
    (3, 'Samarinda → Penajam', 'Bus demo · 17:00', 150000.00, 40, 0, 0),
    (4, 'Penajam → Samarinda', 'Bus demo · 08:00', 150000.00, 40, 0, 0),
    (5, 'Penajam → Samarinda', 'Bus demo · 13:00', 150000.00, 40, 0, 0),
    (6, 'Penajam → Samarinda', 'Bus demo · 17:00', 150000.00, 40, 0, 0)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('kuota_tiket', 'id'), GREATEST((SELECT MAX(id) FROM kuota_tiket), 1));

-- ------------------------------------------------------------------------------
-- TABEL UTAMA 1: pembeli (Guest Checkout - Tanpa Registrasi Akun)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pembeli (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL,
    no_whatsapp VARCHAR(25) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pembeli_email ON pembeli(email);
CREATE INDEX IF NOT EXISTS idx_pembeli_no_whatsapp ON pembeli(no_whatsapp);

-- ------------------------------------------------------------------------------
-- TABEL UTAMA 2: transaksi (Pencatatan Order, QRIS, & Status Pembayaran)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaksi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode_transaksi VARCHAR(50) UNIQUE NOT NULL,
    pembeli_id UUID NOT NULL REFERENCES pembeli(id) ON DELETE RESTRICT,
    kuota_id INT NOT NULL REFERENCES kuota_tiket(id) ON DELETE RESTRICT,
    jumlah_tiket INT NOT NULL CHECK (jumlah_tiket > 0),
    harga_satuan NUMERIC(12, 2) NOT NULL,
    total_bayar NUMERIC(12, 2) NOT NULL,
    status_pembayaran payment_status NOT NULL DEFAULT 'PENDING',
    gateway_order_id VARCHAR(100) UNIQUE,
    qris_payload TEXT,          -- Payload mentah QRIS (00020101021226...)
    qris_url TEXT,              -- URL gambar barcode jika disediakan gateway
    travel_date DATE NOT NULL DEFAULT CURRENT_DATE,
    refund_notes TEXT,
    refunded_at TIMESTAMPTZ,
    refunded_by VARCHAR(100),
    expired_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE transaksi
    ADD COLUMN IF NOT EXISTS travel_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE transaksi
    ADD COLUMN IF NOT EXISTS refund_notes TEXT;
ALTER TABLE transaksi
    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE transaksi
    ADD COLUMN IF NOT EXISTS refunded_by VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_transaksi_pembeli_id ON transaksi(pembeli_id);
CREATE INDEX IF NOT EXISTS idx_transaksi_status_created ON transaksi(status_pembayaran, created_at);
CREATE INDEX IF NOT EXISTS idx_transaksi_gateway_order ON transaksi(gateway_order_id);

-- ------------------------------------------------------------------------------
-- TABEL UTAMA 3: tiket (E-Tiket Individual dengan UUID v4 untuk Barcode/QR)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tiket (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- NILAI INI YANG DISCAN OLEH KAMERA
    transaksi_id UUID NOT NULL REFERENCES transaksi(id) ON DELETE CASCADE,
    kode_tiket VARCHAR(50) UNIQUE NOT NULL,        -- Format: TKT-2026-XXXXX
    status_kehadiran attendance_status NOT NULL DEFAULT 'AVAILABLE',
    waktu_scan TIMESTAMPTZ,
    scanned_by VARCHAR(100),                       -- Nama/ID Panitia Gate
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tiket_transaksi_id ON tiket(transaksi_id);
CREATE INDEX IF NOT EXISTS idx_tiket_status ON tiket(status_kehadiran);

-- ==============================================================================
-- LOGIKA PESSIMISTIC LOCKING: STORED PROCEDURES / TRANSACTIONS
-- ==============================================================================

-- 1. FUNGSI CHECKOUT DENGAN ROW LOCKING (FOR UPDATE)
-- Mencegah Race Condition saat ratusan pembeli klik checkout secara bersamaan
CREATE OR REPLACE FUNCTION sp_checkout_pembeli(
    p_nama VARCHAR(150),
    p_email VARCHAR(150),
    p_no_whatsapp VARCHAR(25),
    p_kuota_id INT,
    p_jumlah_tiket INT,
    p_expired_minutes INT DEFAULT 15
)
RETURNS TABLE (
    out_transaksi_id UUID,
    out_kode_transaksi VARCHAR(50),
    out_total_bayar NUMERIC(12, 2),
    out_expired_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
AS $$
DECLARE
    v_sisa_kuota INT;
    v_harga NUMERIC(12, 2);
    v_total NUMERIC(12, 2);
    v_pembeli_id UUID;
    v_transaksi_id UUID;
    v_kode_transaksi VARCHAR(50);
    v_expired_at TIMESTAMPTZ;
BEGIN
    -- [CRITICAL PESSIMISTIC LOCK]: Kunci baris kuota tiket secara eksklusif!
    -- Transaksi concurrent lain akan menunggu (WAIT) sampai transaksi ini COMMIT atau ROLLBACK.
    SELECT 
        (total_kuota - (kuota_terjual + kuota_terpesan)),
        harga
    INTO 
        v_sisa_kuota,
        v_harga
    FROM kuota_tiket
    WHERE id = p_kuota_id AND is_active = TRUE
    FOR UPDATE; -- <-- PESSIMISTIC ROW-LEVEL LOCKING

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Kategori tiket tidak ditemukan atau tidak aktif' USING ERRCODE = 'P0002';
    END IF;

    -- Validasi ketersediaan stok aktual
    IF v_sisa_kuota < p_jumlah_tiket THEN
        RAISE EXCEPTION 'Stok tiket tidak mencukupi! Sisa stok tersedia: %', v_sisa_kuota USING ERRCODE = 'P0001';
    END IF;

    -- Hitung total
    v_total := v_harga * p_jumlah_tiket;
    v_expired_at := CURRENT_TIMESTAMP + (p_expired_minutes || ' minutes')::INTERVAL;
    v_kode_transaksi := 'TRX-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0');

    -- Tahan kuota sementara (kuota_terpesan bertambah)
    UPDATE kuota_tiket
    SET kuota_terpesan = kuota_terpesan + p_jumlah_tiket,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_kuota_id;

    -- Simpan Data Pembeli (Guest)
    INSERT INTO pembeli (nama, email, no_whatsapp)
    VALUES (p_nama, p_email, p_no_whatsapp)
    RETURNING id INTO v_pembeli_id;

    -- Simpan Transaksi PENDING
    INSERT INTO transaksi (
        kode_transaksi,
        pembeli_id,
        kuota_id,
        jumlah_tiket,
        harga_satuan,
        total_bayar,
        status_pembayaran,
        expired_at
    ) VALUES (
        v_kode_transaksi,
        v_pembeli_id,
        p_kuota_id,
        p_jumlah_tiket,
        v_harga,
        v_total,
        'PENDING',
        v_expired_at
    ) RETURNING id INTO v_transaksi_id;

    -- Return hasil
    RETURN QUERY SELECT v_transaksi_id, v_kode_transaksi, v_total, v_expired_at;
END;
$$;

-- 2. FUNGSI PEMBAYARAN BERHASIL (WEBHOOK PAYMENT GATEWAY)
-- Mengonversi kuota_terpesan menjadi kuota_terjual dan membuat UUID Tiket Scannable
CREATE OR REPLACE FUNCTION sp_konfirmasi_pembayaran(
    p_transaksi_id UUID,
    p_gateway_order_id VARCHAR(100)
)
RETURNS INT -- Mengembalikan jumlah tiket yang diterbitkan
LANGUAGE plpgsql
AS $$
DECLARE
    v_status payment_status;
    v_kuota_id INT;
    v_jumlah_tiket INT;
    v_count INT := 0;
    i INT;
    v_kode_tiket VARCHAR(50);
BEGIN
    -- Kunci baris transaksi agar pemrosesan webhook idempoten
    SELECT status_pembayaran, kuota_id, jumlah_tiket
    INTO v_status, v_kuota_id, v_jumlah_tiket
    FROM transaksi
    WHERE id = p_transaksi_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaksi % tidak ditemukan', p_transaksi_id;
    END IF;

    -- Jika sudah diproses sebelumnya, abaikan (Idempoten)
    IF v_status = 'PAID' THEN
        RETURN 0;
    END IF;

    -- Kunci baris kuota tiket untuk update stok pasti
    PERFORM 1 FROM kuota_tiket WHERE id = v_kuota_id FOR UPDATE;

    -- Update kuota tiket: kurangi kuota_terpesan, tambahkan kuota_terjual
    UPDATE kuota_tiket
    SET kuota_terpesan = GREATEST(0, kuota_terpesan - v_jumlah_tiket),
        kuota_terjual = kuota_terjual + v_jumlah_tiket,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_kuota_id;

    -- Update status transaksi menjadi PAID
    UPDATE transaksi
    SET status_pembayaran = 'PAID',
        paid_at = CURRENT_TIMESTAMP,
        gateway_order_id = COALESCE(p_gateway_order_id, gateway_order_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_transaksi_id;

    -- Terbitkan N tiket fisik dengan UUID v4 unik
    FOR i IN 1..v_jumlah_tiket LOOP
        v_kode_tiket := 'TKT-2026-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT FROM 1 FOR 8));
        INSERT INTO tiket (id, transaksi_id, kode_tiket, status_kehadiran)
        VALUES (gen_random_uuid(), p_transaksi_id, v_kode_tiket, 'AVAILABLE');
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- 3. FUNGSI VALIDASI SCAN TIKET (ATOMIC CHECK-IN WITH FOR UPDATE)
-- Mencegah tiket yang sama di-scan 2x oleh kamera panitia berbeda secara paralel
CREATE OR REPLACE FUNCTION sp_scan_tiket_masuk(
    p_tiket_uuid UUID,
    p_scanned_by VARCHAR(100)
)
RETURNS TABLE (
    hasil_kode VARCHAR(20),       -- 'VALID', 'ALREADY_SCANNED', 'NOT_FOUND'
    pesan TEXT,
    kode_tiket VARCHAR(50),
    nama_pembeli VARCHAR(150),
    waktu_scan_sebelumnya TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status attendance_status;
    v_waktu_scan TIMESTAMPTZ;
    v_kode_tiket VARCHAR(50);
    v_nama_pembeli VARCHAR(150);
    v_transaksi_id UUID;
BEGIN
    -- Kunci baris tiket saat scan dibaca
    SELECT t.status_kehadiran, t.waktu_scan, t.kode_tiket, t.transaksi_id, p.nama
    INTO v_status, v_waktu_scan, v_kode_tiket, v_transaksi_id, v_nama_pembeli
    FROM tiket t
    JOIN transaksi tr ON t.transaksi_id = tr.id
    JOIN pembeli p ON tr.pembeli_id = p.id
    WHERE t.id = p_tiket_uuid
    FOR UPDATE OF t;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_FOUND'::VARCHAR(20), 'QR Code tiket tidak valid atau tidak terdaftar!'::TEXT, NULL::VARCHAR(50), NULL::VARCHAR(150), NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    -- Cek jika sudah pernah di-scan
    IF v_status = 'SCANNED' THEN
        RETURN QUERY SELECT 
            'ALREADY_SCANNED'::VARCHAR(20), 
            'PERINGATAN: Tiket sudah pernah digunakan sebelumnya!'::TEXT,
            v_kode_tiket,
            v_nama_pembeli,
            v_waktu_scan;
        RETURN;
    END IF;

    -- Tiket valid, ubah status menjadi SCANNED secara instan
    UPDATE tiket
    SET status_kehadiran = 'SCANNED',
        waktu_scan = CURRENT_TIMESTAMP,
        scanned_by = p_scanned_by,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_tiket_uuid;

    RETURN QUERY SELECT 
        'VALID'::VARCHAR(20),
        'Tiket valid! Akses masuk diberikan.'::TEXT,
        v_kode_tiket,
        v_nama_pembeli,
        CURRENT_TIMESTAMP;
END;
$$;

-- ------------------------------------------------------------------------------
-- TABEL TAMBAHAN 4: reservasi_kursi (Desain Pemetaan Kursi & Tanggal Perjalanan)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservasi_kursi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaksi_id UUID NOT NULL REFERENCES transaksi(id) ON DELETE CASCADE,
    kuota_id INT NOT NULL REFERENCES kuota_tiket(id) ON DELETE RESTRICT,
    travel_date DATE NOT NULL,
    seat_no VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED', 'EXPIRED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_seat_reservation UNIQUE (kuota_id, travel_date, seat_no)
);

CREATE INDEX IF NOT EXISTS idx_reservasi_kursi_lookup ON reservasi_kursi(kuota_id, travel_date, status);
