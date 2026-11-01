import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function loadEnvFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {
    // Abaikan kegagalan baca file env
  }
}

loadEnvFile(path.resolve(__dirname, "../../.env"));
loadEnvFile(path.resolve(__dirname, "../../../.env"));

const nextConfig: NextConfig = {
  basePath: "/tiket",
  outputFileTracingRoot: path.resolve(__dirname, "../../.."),
};

export default nextConfig;
