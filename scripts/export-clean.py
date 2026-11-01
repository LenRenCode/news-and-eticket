#!/usr/bin/env python3
import os
import sys
import zipfile
from datetime import datetime

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_NAME = f"portalberita-jualticket-clean.zip"
OUTPUT_PATH = os.path.join(ROOT_DIR, OUTPUT_NAME)

FORBIDDEN_DIR_NAMES = {
    "node_modules",
    ".next",
    "dist",
    ".git",
    "backup",
}

def should_exclude(rel_path):
    parts = rel_path.split(os.sep)
    # 1. Skip forbidden directories
    for part in parts:
        if part in FORBIDDEN_DIR_NAMES:
            return True

    # Skip root data/ scratch directory
    if parts[0] == "data":
        return True

    # 2. Skip existing zip archives
    if rel_path.endswith(".zip"):
        return True

    # 3. Skip .env files except .env.example
    filename = parts[-1]
    if filename.startswith(".env") and not filename.endswith(".env.example"):
        return True

    # 4. Skip sessions.db and SQLite database files in data/
    if "sessions.db" in filename or filename.endswith(".db") or filename.endswith(".db-wal") or filename.endswith(".db-shm"):
        return True

    # 5. Skip uploaded files in uploads/
    if "uploads" in parts and filename != ".gitkeep":
        return True

    # 6. Skip temp/log files
    if filename.endswith(".log") or filename == ".DS_Store" or filename.endswith(".tsbuildinfo"):
        return True

    return False

def main():
    print(f"[Export Clean] Memulai pembuatan arsip bersih dari: {ROOT_DIR}")
    files_added = []

    with zipfile.ZipFile(OUTPUT_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        # Tambahkan direktori berita/data/ kosong dengan .gitkeep
        zf.writestr("berita/data/.gitkeep", "")
        files_added.append("berita/data/.gitkeep")

        for root, dirs, files in os.walk(ROOT_DIR):
            # Prune directories in-place for performance
            dirs[:] = [d for d in dirs if d not in FORBIDDEN_DIR_NAMES]

            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, ROOT_DIR)

                if should_exclude(rel_path):
                    continue

                zf.write(full_path, rel_path)
                files_added.append(rel_path)

    print(f"\n[Export Clean] Sukses! Arsip tersimpan di: {OUTPUT_PATH}")
    print(f"[Export Clean] Total berkas ditambahkan: {len(files_added)}")
    print(f"[Export Clean] Ukuran arsip: {os.path.getsize(OUTPUT_PATH) / 1024:.2f} KB\n")

    # Verifikasi isi arsip
    print("=== VERIFIKASI ISI ARSIP BERSIH ===")
    has_violation = False
    with zipfile.ZipFile(OUTPUT_PATH, "r") as zf:
        names = zf.namelist()
        for name in names:
            if should_exclude(name) and name != "berita/data/.gitkeep":
                print(f"❌ PELANGGARAN: Ditemukan berkas terlarang di dalam arsip: {name}")
                has_violation = True

    if not has_violation:
        print("✅ VERIFIKASI LULUS: Arsip bersih 100% bebas dari node_modules, .next, dist, .env*, database, dan uploads.")
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
