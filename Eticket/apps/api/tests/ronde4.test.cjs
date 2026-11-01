const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { Pool } = require("pg");
const XLSX = require("xlsx");

const root = path.resolve(__dirname, "../../../..");
const apiDir = path.join(root, "Eticket/apps/api");
const webDir = path.join(root, "Eticket/apps/web");
const apiEntry = path.join(apiDir, "dist/server.js");
const apiPort = 4000;
const webPort = 3001;
const newsPort = 3000;
const testSecret = "ronde-four-test-session-secret-012345";
const apiPassword = "round-four-api-test-password";
const paymentKey = "round-four-midtrans-test-key";
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "portal-r4-"));
const apiCwd = path.join(runtimeRoot, "runtime", "api");
const newsCwd = path.join(runtimeRoot, "runtime", "news");
const dataDir = path.join(runtimeRoot, "berita-data");
const children = [];

let pg;
let socketServer;
let pgPool;
let gatewayServer;
let gatewayPort;
let apiProcess;
let webProcess;
let newsProcess;
let publicAdminCookie;
let successfulTransactionId;
let actualLanIp;

function runNode(code, env = {}, unset = []) {
  const childEnv = { ...process.env, ...env };
  for (const key of unset) delete childEnv[key];
  return spawnSync(process.execPath, ["-e", code], {
    cwd: apiCwd,
    env: childEnv,
    encoding: "utf8",
    timeout: 15000,
  });
}

function launch(args, options) {
  const child = spawn(process.execPath, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      child.output = `${child.output}${chunk}`.slice(-4000);
    });
  }
  children.push(child);
  return child;
}

async function waitForHttp(url, child, expectedStatus = 200) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before readiness: ${child.output}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.status === expectedStatus) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${child.output}`);
}

function httpRequest({ host = "127.0.0.1", port, path: requestPath, method = "GET", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host, port, path: requestPath, method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    request.setTimeout(5000, () => request.destroy(new Error("Request timed out")));
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

async function postJson(route, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${newsPort}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  return response;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

function normalizedSchema(source) {
  return source.replace(
    /^CREATE EXTENSION IF NOT EXISTS "pgcrypto";\s*$/m,
    "-- gen_random_uuid() is built into PostgreSQL 18."
  );
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

before(async () => {
  await Promise.all([assertPortFree(newsPort), assertPortFree(webPort), assertPortFree(apiPort)]);
  fs.mkdirSync(apiCwd, { recursive: true });
  fs.mkdirSync(newsCwd, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  pg = new PGlite();
  await pg.waitReady;
  const schema = normalizedSchema(
    fs.readFileSync(path.join(root, "Eticket/packages/database/schema.sql"), "utf8")
  );
  await pg.exec(schema);

  const databasePort = await freePort();
  socketServer = new PGLiteSocketServer({
    db: pg,
    host: "127.0.0.1",
    port: databasePort,
    maxConnections: 24,
  });
  await socketServer.start();
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${databasePort}/postgres`;
  pgPool = new Pool({ connectionString: databaseUrl, max: 24 });

  gatewayServer = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const orderId = payload.transaction_details.order_id;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          order_id: orderId,
          transaction_id: `gateway-${orderId}`,
          gross_amount: String(payload.transaction_details.gross_amount),
          qr_string: "TEST-QR-PAYLOAD",
          actions: [],
          transaction_status: "pending",
        })
      );
    });
  });
  await new Promise((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  gatewayPort = gatewayServer.address().port;

  const apiEnv = {
    APP_MODE: "production",
    NODE_ENV: "production",
    API_PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    PAYMENT_API_KEY: paymentKey,
    PAYMENT_API_BASE_URL: `http://127.0.0.1:${gatewayPort}`,
    ADMIN_USERNAME: "runde4-admin",
    ADMIN_PASSWORD: apiPassword,
    ADMIN_SESSION_SECRET: testSecret,
    WEB_ORIGIN: "http://127.0.0.1:3000",
  };
  apiProcess = launch([apiEntry], { cwd: apiCwd, env: { ...process.env, ...apiEnv } });
  await waitForHttp(`http://127.0.0.1:${apiPort}/health`, apiProcess);

  const nextBin = path.join(webDir, "node_modules/next/dist/bin/next");
  webProcess = launch([nextBin, "start", "-H", "127.0.0.1", "-p", String(webPort)], {
    cwd: webDir,
    env: { ...process.env, ...apiEnv },
  });
  await waitForHttp(`http://127.0.0.1:${webPort}/tiket`, webProcess);

  const newsEnv = {
    ...apiEnv,
    PORT: String(newsPort),
    DATA_DIR: dataDir,
    SESSION_SECRET: "runde-four-test-news-session-secret",
    OWNER_USERNAME: "runde4-owner",
    OWNER_PASSWORD: "runde-four-news-owner-password",
    ADMIN_PATH: "admin",
    ETICKET_WEB_URL: `http://127.0.0.1:${webPort}`,
    ETICKET_API_URL: `http://127.0.0.1:${apiPort}`,
  };
  newsProcess = launch([path.join(root, "berita/server.js")], {
    cwd: newsCwd,
    env: { ...process.env, ...newsEnv },
  });
  await waitForHttp(`http://127.0.0.1:${newsPort}/`, newsProcess);

  const interfaces = Object.values(os.networkInterfaces()).flat();
  actualLanIp = interfaces.find(
    (item) => item && item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254.")
  )?.address;
});

after(async () => {
  for (const child of [...children].reverse()) await stopChild(child);
  if (pgPool) await pgPool.end();
  if (gatewayServer?.listening) {
    await new Promise((resolve) => gatewayServer.close(resolve));
  }
  if (socketServer) await socketServer.stop();
  if (pg) await pg.close();
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

test("PGlite PostgreSQL schema initializes fresh, migrates old tables, and supports gen_random_uuid", async () => {
  const version = await pgPool.query("SELECT current_setting('server_version_num')::integer AS version");
  assert.ok(version.rows[0].version >= 130000);
  const uuid = await pgPool.query("SELECT gen_random_uuid()::text AS id");
  assert.match(uuid.rows[0].id, /^[0-9a-f-]{36}$/);

  const travelColumn = await pgPool.query(
    `SELECT data_type, column_default, is_nullable
     FROM information_schema.columns
     WHERE table_name = 'transaksi' AND column_name = 'travel_date'`
  );
  assert.deepEqual(travelColumn.rows[0], {
    data_type: "date",
    column_default: "CURRENT_DATE",
    is_nullable: "NO",
  });

  const schemaPath = path.join(root, "Eticket/packages/database/schema.sql");
  const rawSchema = fs.readFileSync(schemaPath, "utf8");
  const schema = normalizedSchema(rawSchema);
  const oldSchema = schema
    .replace("ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'NEEDS_REFUND';", "")
    .replace("ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'REFUNDED';", "")
    .replace("    travel_date DATE NOT NULL DEFAULT CURRENT_DATE,\n", "")
    .replace("    refund_notes TEXT,\n", "")
    .replace("    refunded_at TIMESTAMPTZ,\n", "")
    .replace("    refunded_by VARCHAR(100),\n", "")
    .replace(
      "ALTER TABLE transaksi\n    ADD COLUMN IF NOT EXISTS travel_date DATE NOT NULL DEFAULT CURRENT_DATE;\n",
      ""
    )
    .replace(
      "ALTER TABLE transaksi\n    ADD COLUMN IF NOT EXISTS refund_notes TEXT;\n",
      ""
    )
    .replace(
      "ALTER TABLE transaksi\n    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;\n",
      ""
    )
    .replace(
      "ALTER TABLE transaksi\n    ADD COLUMN IF NOT EXISTS refunded_by VARCHAR(100);\n",
      ""
    );
  const oldDb = new (await import("@electric-sql/pglite")).PGlite();
  try {
    await oldDb.waitReady;
    await oldDb.exec(oldSchema);
    const oldColumn = await oldDb.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'transaksi' AND column_name = 'travel_date'`
    );
    assert.equal(oldColumn.rows.length, 0);
    await oldDb.exec(schema);
    await oldDb.exec(schema);
    const migratedColumn = await oldDb.query(
      `SELECT data_type, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'transaksi' AND column_name = 'travel_date'`
    );
    assert.deepEqual(migratedColumn.rows[0], {
      data_type: "date",
      column_default: "CURRENT_DATE",
      is_nullable: "NO",
    });
    const migratedRefundColumn = await oldDb.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'transaksi' AND column_name = 'refund_notes'`
    );
    assert.deepEqual(migratedRefundColumn.rows[0], {
      data_type: "text",
      is_nullable: "YES",
    });
  } finally {
    await oldDb.close();
  }

  assert.match(rawSchema, /CREATE EXTENSION IF NOT EXISTS "pgcrypto"/);
  assert.match(schema, /ALTER TABLE transaksi\s+ADD COLUMN IF NOT EXISTS travel_date DATE NOT NULL DEFAULT CURRENT_DATE/);
  const prisma = fs.readFileSync(
    path.join(root, "Eticket/packages/database/prisma/schema.prisma"),
    "utf8"
  );
  assert.match(prisma, /@default\(dbgenerated\("CURRENT_DATE"\)\).*@db\.Date/);
  const memoryDb = fs.readFileSync(path.join(apiDir, "src/modules/memory-db.ts"), "utf8");
  assert.match(memoryDb, /travel_date: string/);
});

test("production defaults fail closed and production overrides demo", () => {
  const modeModule = path.join(apiDir, "dist/modules/app-mode.js");
  const noMode = runNode(
    `process.stdout.write(String(require(${JSON.stringify(modeModule)}).isProductionMode()))`,
    {},
    ["APP_MODE", "NODE_ENV"]
  );
  assert.equal(noMode.status, 0, noMode.stderr);
  assert.equal(noMode.stdout, "true");

  const conflict = runNode(
    `process.stdout.write(String(require(${JSON.stringify(modeModule)}).isProductionMode()))`,
    { APP_MODE: "demo", NODE_ENV: "production" }
  );
  assert.equal(conflict.status, 0, conflict.stderr);
  assert.equal(conflict.stdout, "true");

  const explicitDemo = runNode(
    `process.stdout.write(String(require(${JSON.stringify(modeModule)}).isProductionMode()))`,
    { APP_MODE: "demo", NODE_ENV: "development" }
  );
  assert.equal(explicitDemo.status, 0, explicitDemo.stderr);
  assert.equal(explicitDemo.stdout, "false");

  const plainServer = spawnSync(process.execPath, [apiEntry], {
    cwd: apiCwd,
    env: { PATH: process.env.PATH, HOME: runtimeRoot },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.notEqual(plainServer.status, 0);
  assert.match(plainServer.stderr, /Fatal startup error/);
  assert.match(plainServer.stderr, /PostgreSQL|DATABASE_URL/);
});

test("health and page routes are reachable through the single public port", async () => {
  const news = await fetch(`http://127.0.0.1:${newsPort}/`);
  assert.equal(news.status, 200);

  const ticketHome = await fetch(`http://127.0.0.1:${newsPort}/tiket`);
  assert.equal(ticketHome.status, 200);

  const healthResponse = await fetch(`http://127.0.0.1:${newsPort}/tiket-api/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.status, "ok");
  assert.equal(Object.hasOwn(health, "mode"), false);

  if (actualLanIp) {
    const publicFromLan = await httpRequest({ host: actualLanIp, port: newsPort, path: "/" });
    assert.equal(publicFromLan.status, 200);
    for (const port of [webPort, apiPort]) {
      await assert.rejects(
        httpRequest({ host: actualLanIp, port, path: "/", method: "GET" }),
        (error) => ["ECONNREFUSED", "EHOSTUNREACH"].includes(error.code)
      );
    }
  }
});

test("news initializes one owner from explicit credentials and requires a password change", () => {
  const Database = require(path.join(root, "berita/node_modules/better-sqlite3"));
  const database = new Database(path.join(dataDir, "berita.db"), { readonly: true });
  try {
    const result = database
      .prepare(
        "SELECT COUNT(*) AS users, COALESCE(SUM(must_change_password), 0) AS must_change FROM users"
      )
      .get();
    assert.equal(result.users, 1);
    assert.equal(result.must_change, 1);
  } finally {
    database.close();
  }
});

test("login-issued HMAC cookie works and malformed or modified sessions fail closed", async () => {
  const login = await postJson("/tiket-api/admin/login", {
    username: "runde4-admin",
    password: apiPassword,
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.getSetCookie().find((value) =>
    value.startsWith("eticket_admin_session=")
  );
  assert.ok(setCookie);
  publicAdminCookie = setCookie.split(";", 1)[0];

  const dashboard = await fetch(`http://127.0.0.1:${newsPort}/tiket/admin`, {
    headers: { Cookie: publicAdminCookie },
    redirect: "manual",
  });
  assert.equal(dashboard.status, 200);

  const nonce = crypto.randomBytes(32).toString("hex");
  const signToken = (expires, tokenNonce) => {
    const payload = `${expires}.${tokenNonce}`;
    const signature = crypto.createHmac("sha256", testSecret).update(payload).digest("hex");
    return `${payload}.${signature}`;
  };
  const validUntil = Date.now() + 60 * 60 * 1000;
  const expired = signToken(Date.now() - 1000, nonce);
  const changedNonce = `${nonce[0] === "a" ? "b" : "a"}${nonce.slice(1)}`;
  const validToken = signToken(validUntil, nonce);
  const tokenParts = validToken.split(".");
  tokenParts[2] = `${tokenParts[2].slice(0, -1)}${tokenParts[2].endsWith("a") ? "b" : "a"}`;
  const alteredSignature = tokenParts.join(".");
  const invalidCookies = [
    "eticket_admin_session=broken",
    `eticket_admin_session=${expired}`,
    `eticket_admin_session=${validUntil}.${changedNonce}.${signToken(validUntil, nonce).split(".")[2]}`,
    `eticket_admin_session=${alteredSignature}`,
    "eticket_admin_session=1.not-hex.not-a-signature",
  ];

  for (const cookie of invalidCookies) {
    const response = await fetch(`http://127.0.0.1:${newsPort}/tiket/admin`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.equal(response.status, 307, webProcess.output);
    assert.equal(response.headers.get("location"), "/tiket/admin/login");
  }
});

test("admin route variants, Next data paths, and hostile forwarded headers cannot bypass middleware", async () => {
  const buildId = fs.readFileSync(path.join(webDir, ".next/BUILD_ID"), "utf8").trim();
  const protectedPaths = [
    "/tiket/admin",
    "/tiket/admin/",
    "/tiket/ADMIN",
    "/tiket/%61dmin",
    "/tiket/admin//x",
    "/tiket/admin/login/../",
    `/tiket/_next/data/${buildId}/admin.json`,
    "/tiket/admin/scanner",
  ];

  for (const route of protectedPaths) {
    let response = await httpRequest({
      port: newsPort,
      path: route,
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" },
    });
    for (let redirects = 0; response.status === 308 && redirects < 5; redirects += 1) {
      assert.match(response.headers.location, /^\/tiket\/admin(?:\/.*)?$/);
      response = await httpRequest({
        port: newsPort,
        path: response.headers.location,
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" },
      });
    }
    if (route.includes("/_next/data/")) {
      assert.equal(response.headers["x-nextjs-redirect"], "/tiket/admin/login");
      assert.equal(response.body.length, 0);
      continue;
    }
    const expectedStatus = response.status === 404 ? 404 : 307;
    assert.equal(
      response.status,
      expectedStatus,
      `${route} should redirect before rendering; Next output: ${webProcess.output}`
    );
    if (response.status === 307) {
      assert.equal(
        response.headers.location,
        "/tiket/admin/login",
        `${route} redirect headers: ${JSON.stringify(response.headers)}`
      );
    }
  }

  const loginPage = await fetch(`http://127.0.0.1:${newsPort}/tiket/admin/login`);
  assert.equal(loginPage.status, 200);
  const noSession = await fetch(`http://127.0.0.1:${newsPort}/tiket/admin`, {
    redirect: "manual",
  });
  assert.equal(noSession.headers.get("location"), "/tiket/admin/login");

  const emptySecretPort = await freePort();
  const nextBin = path.join(webDir, "node_modules/next/dist/bin/next");
  const noSecretWeb = launch(
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(emptySecretPort)],
    {
      cwd: webDir,
      env: {
        ...process.env,
        NODE_ENV: "production",
        ADMIN_SESSION_SECRET: "",
      },
    }
  );
  try {
    await waitForHttp(`http://127.0.0.1:${emptySecretPort}/tiket/admin/login`, noSecretWeb);
    const noSecretNonce = crypto.randomBytes(32).toString("hex");
    const noSecretExpires = Date.now() + 60 * 60 * 1000;
    const noSecretPayload = `${noSecretExpires}.${noSecretNonce}`;
    const noSecretSignature = crypto
      .createHmac("sha256", testSecret)
      .update(noSecretPayload)
      .digest("hex");
    const signedCookie = `eticket_admin_session=${noSecretPayload}.${noSecretSignature}`;
    const response = await fetch(`http://127.0.0.1:${emptySecretPort}/tiket/admin`, {
      headers: { Cookie: signedCookie },
      redirect: "manual",
    });
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.pathname, "/tiket/admin/login");
    assert.notEqual(location.hostname, "evil.example");
  } finally {
    await stopChild(noSecretWeb);
  }
});

test("production rejects simulated QRIS, memory fallback, and invalid webhooks", async () => {
  const paymentModule = path.join(apiDir, "dist/modules/payments/midtrans.service.js");
  const qrisCheck = runNode(
    `require(${JSON.stringify(paymentModule)}).MidtransPaymentService.createQrisCharge("test", 1, {nama:"test",email:"test@example.test",phone:"0"}).then(()=>process.exit(2),()=>{console.log("qris_simulation_rejected=true");process.exit(0)})`,
    { APP_MODE: "demo", NODE_ENV: "production", PAYMENT_API_KEY: "" }
  );
  assert.equal(qrisCheck.status, 0, qrisCheck.stderr);
  assert.match(qrisCheck.stdout, /qris_simulation_rejected=true/);

  const dbModule = path.join(apiDir, "dist/modules/db.js");
  const fallbackCheck = runNode(
    `const db=require(${JSON.stringify(dbModule)}); Promise.allSettled([db.pool.query("SELECT 1"),db.withTransaction(async()=>1)]).then(results=>{console.log(JSON.stringify(results.map(item=>item.status)));process.exit(results.every(item=>item.status==="rejected")?0:2)})`,
    {
      APP_MODE: "production",
      NODE_ENV: "production",
      DATABASE_URL: "postgres://test:test@127.0.0.1:59999/test",
    }
  );
  assert.equal(fallbackCheck.status, 0, fallbackCheck.stderr);
  assert.equal(fallbackCheck.stdout.trim(), '["rejected","rejected"]');

  for (const body of [
    { order_id: "missing-signature", status_code: "200", gross_amount: "1" },
    {
      order_id: "wrong-signature",
      status_code: "200",
      gross_amount: "1",
      signature_key: "0".repeat(128),
    },
  ]) {
    const response = await postJson("/tiket-api/payments/webhook", body);
    assert.equal(response.status, 401);
  }
});

test("ten concurrent PGlite-backed checkouts cannot oversell one remaining seat", async () => {
  await pgPool.query(
    `UPDATE kuota_tiket
     SET total_kuota = 1, kuota_terjual = 0, kuota_terpesan = 0
     WHERE id = 1`
  );
  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      postJson("/tiket-api/checkout", {
        nama: `Test Buyer ${index}`,
        email: `buyer-${index}@example.test`,
        noWhatsapp: `000000${index}`,
        jumlahTiket: 1,
        kuotaId: 1,
      })
    )
  );
  const successful = responses.filter((response) => response.status === 201);
  assert.equal(successful.length, 1);
  assert.equal(responses.filter((response) => response.status === 409).length, 9);
  const payload = await successful[0].json();
  successfulTransactionId = payload.data.transaksiId;

  const quota = await pgPool.query(
    "SELECT total_kuota, kuota_terjual, kuota_terpesan FROM kuota_tiket WHERE id = 1"
  );
  assert.ok(
    quota.rows[0].kuota_terjual + quota.rows[0].kuota_terpesan <= quota.rows[0].total_kuota
  );
  assert.equal(quota.rows[0].kuota_terpesan, 1);
});

test("checkout and sweeper racing on database-expired reservations release exactly once", async () => {
  await pgPool.query(
    `UPDATE transaksi
     SET expired_at = NOW() - INTERVAL '1 minute'
     WHERE id = $1 AND status_pembayaran = 'PENDING'`,
    [successfulTransactionId]
  );
  const expiredAt = await pgPool.query(
    `SELECT expired_at <= NOW() AS expired_by_database_clock
     FROM transaksi WHERE id = $1`,
    [successfulTransactionId]
  );
  assert.equal(expiredAt.rows[0].expired_by_database_clock, true);

  const serviceModule = path.join(apiDir, "dist/modules/transactions/transaction.service.js");
  const sweeperCode = `require(${JSON.stringify(serviceModule)}).TransactionService.releaseExpiredReservations().then(count=>{console.log(JSON.stringify({released:count}));process.exit(0)},error=>{console.error(error.message);process.exit(1)})`;
  const sweeperCwd = path.join(runtimeRoot, "runtime", "sweeper");
  fs.mkdirSync(sweeperCwd, { recursive: true });
  const sweeper = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", sweeperCode], {
      cwd: sweeperCwd,
      env: {
        ...process.env,
        APP_MODE: "production",
        NODE_ENV: "production",
        DATABASE_URL: pgPool.options.connectionString,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(output));
      else resolve(JSON.parse(output.trim().split(/\r?\n/).at(-1)));
    });
  });
  const checkout = postJson("/tiket-api/checkout", {
    nama: "Race Buyer",
    email: "race@example.test",
    noWhatsapp: "00000001",
    jumlahTiket: 1,
    kuotaId: 1,
  });
  const [sweeperResult, checkoutResponse] = await Promise.all([sweeper, checkout]);
  assert.ok([0, 1].includes(sweeperResult.released));
  assert.equal(checkoutResponse.status, 201);

  const state = await pgPool.query(
    `SELECT
       (SELECT status_pembayaran FROM transaksi WHERE id = $1) AS previous_status,
       total_kuota, kuota_terjual, kuota_terpesan
     FROM kuota_tiket WHERE id = 1`,
    [successfulTransactionId]
  );
  assert.equal(state.rows[0].previous_status, "EXPIRED");
  assert.equal(state.rows[0].kuota_terpesan, 1);
  assert.ok(state.rows[0].kuota_terjual + state.rows[0].kuota_terpesan <= state.rows[0].total_kuota);

  const serviceSource = fs.readFileSync(
    path.join(apiDir, "src/modules/transactions/transaction.service.ts"),
    "utf8"
  );
  assert.equal((serviceSource.match(/RETURNING jumlah_tiket/g) || []).length, 2);
  assert.match(serviceSource, /UPDATE transaksi[\s\S]*?status_pembayaran = 'PENDING'[\s\S]*?RETURNING jumlah_tiket/);
});

test("status, payment, ticket, scan, checkout, and Excel export regressions work through port 3000", async () => {
  assert.ok(successfulTransactionId);
  const statusResponse = await fetch(
    `http://127.0.0.1:${newsPort}/tiket-api/transactions/${successfulTransactionId}`
  );
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.data.transaksiId, successfulTransactionId);

  const paymentPage = await fetch(
    `http://127.0.0.1:${newsPort}/tiket/payment/${successfulTransactionId}`
  );
  assert.equal(paymentPage.status, 200);
  const ticketPage = await fetch(
    `http://127.0.0.1:${newsPort}/tiket/ticket/${crypto.randomUUID()}`
  );
  assert.equal(ticketPage.status, 200);

  const simulatedPayment = await postJson(
    `/tiket-api/payments/simulate-success/${successfulTransactionId}`,
    {},
    { Cookie: publicAdminCookie }
  );
  assert.equal(simulatedPayment.status, 404);

  const scan = await postJson(
    "/tiket-api/scan",
    { ticketUuid: crypto.randomUUID(), scannedBy: "Test" },
    { Cookie: publicAdminCookie }
  );
  assert.equal(scan.status, 404);

  const exportResponse = await fetch(
    `http://127.0.0.1:${newsPort}/tiket-api/reports/export-excel`,
    { headers: { Cookie: publicAdminCookie } }
  );
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type"), /spreadsheetml/);
});

test("late successful webhooks are marked NEEDS_REFUND and remain visible in admin export", async () => {
  const buyer = await pgPool.query(
    `INSERT INTO pembeli (nama, email, no_whatsapp)
     VALUES ('Synthetic Late Buyer', 'late@example.test', '00000000')
     RETURNING id`
  );
  const orderId = `TRX-LATE-${crypto.randomUUID()}`;
  const transaction = await pgPool.query(
    `INSERT INTO transaksi (
       kode_transaksi, pembeli_id, kuota_id, jumlah_tiket, harga_satuan,
       total_bayar, status_pembayaran, gateway_order_id, expired_at
     ) VALUES ($1, $2, 1, 1, 150000, 150000, 'EXPIRED', $3, NOW() - INTERVAL '1 hour')
     RETURNING id`,
    [orderId, buyer.rows[0].id, orderId]
  );
  const statusCode = "200";
  const grossAmount = "150000.00";
  const signature = crypto
    .createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${paymentKey}`)
    .digest("hex");
  const notification = {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    signature_key: signature,
    transaction_status: "settlement",
    transaction_id: "late-gateway-payment",
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await postJson("/tiket-api/payments/webhook", notification);
    assert.equal(
      response.status,
      200,
      `Late webhook failed: ${(await response.clone().text()).slice(0, 500)}; API output: ${apiProcess.output}`
    );
  }
  const state = await pgPool.query(
    `SELECT t.status_pembayaran,
            (SELECT COUNT(*)::integer FROM tiket WHERE transaksi_id = t.id) AS ticket_count
     FROM transaksi t WHERE t.id = $1`,
    [transaction.rows[0].id]
  );
  assert.equal(state.rows[0].status_pembayaran, "NEEDS_REFUND");
  assert.equal(state.rows[0].ticket_count, 0);

  const exportResponse = await fetch(
    `http://127.0.0.1:${newsPort}/tiket-api/reports/export-excel`,
    { headers: { Cookie: publicAdminCookie } }
  );
  assert.equal(exportResponse.status, 200);
  const workbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: "buffer" });
  const rows = workbook.SheetNames.flatMap((name) =>
    XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "" })
  );
  assert.ok(rows.some((row) => row["Status Pembayaran"] === "NEEDS_REFUND"));
});

test("Midtrans webhook contract: duplicate callback is idempotent, order_id or gross_amount mismatch is rejected", async () => {
  const buyer = await pgPool.query(
    `INSERT INTO pembeli (nama, email, no_whatsapp)
     VALUES ('Webhook Contract Buyer', 'midtrans-test@example.test', '08123456789')
     RETURNING id`
  );
  const orderId = `TRX-MIDTRANS-${crypto.randomUUID()}`;
  const transaction = await pgPool.query(
    `INSERT INTO transaksi (
       kode_transaksi, pembeli_id, kuota_id, jumlah_tiket, harga_satuan,
       total_bayar, status_pembayaran, gateway_order_id, expired_at
     ) VALUES ($1, $2, 1, 1, 150000, 150000, 'PENDING', $3, NOW() + INTERVAL '1 hour')
     RETURNING id`,
    [orderId, buyer.rows[0].id, orderId]
  );

  const statusCode = "200";
  const validGrossAmount = "150000.00";
  const validSignature = crypto
    .createHash("sha512")
    .update(`${orderId}${statusCode}${validGrossAmount}${paymentKey}`)
    .digest("hex");

  // 1. Mismatched gross_amount should be rejected with 400
  const wrongGross = "99000.00";
  const wrongGrossSignature = crypto
    .createHash("sha512")
    .update(`${orderId}${statusCode}${wrongGross}${paymentKey}`)
    .digest("hex");
  const mismatchResponse = await postJson("/tiket-api/payments/webhook", {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: wrongGross,
    signature_key: wrongGrossSignature,
    transaction_status: "settlement",
    transaction_id: "mismatch-gateway-id",
  });
  assert.equal(mismatchResponse.status, 400, "Gross amount mismatch must be rejected with 400");

  // 2. Mismatched / Unknown order_id should be rejected with 404
  const unknownOrderId = `TRX-NONEXISTENT-${crypto.randomUUID()}`;
  const unknownOrderSig = crypto
    .createHash("sha512")
    .update(`${unknownOrderId}${statusCode}${validGrossAmount}${paymentKey}`)
    .digest("hex");
  const notFoundResponse = await postJson("/tiket-api/payments/webhook", {
    order_id: unknownOrderId,
    status_code: statusCode,
    gross_amount: validGrossAmount,
    signature_key: unknownOrderSig,
    transaction_status: "settlement",
    transaction_id: "unknown-gateway-id",
  });
  assert.equal(notFoundResponse.status, 404, "Unknown order_id must be rejected with 404");

  // 3. Valid settlement callback -> accepted (200), marks PAID, issues exactly 1 ticket
  const validNotification = {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: validGrossAmount,
    signature_key: validSignature,
    transaction_status: "settlement",
    transaction_id: "valid-settlement-id",
  };
  const firstResponse = await postJson("/tiket-api/payments/webhook", validNotification);
  assert.equal(firstResponse.status, 200);

  const firstCheck = await pgPool.query(
    `SELECT t.status_pembayaran,
            (SELECT COUNT(*)::integer FROM tiket WHERE transaksi_id = t.id) AS ticket_count
     FROM transaksi t WHERE t.id = $1`,
    [transaction.rows[0].id]
  );
  assert.equal(firstCheck.rows[0].status_pembayaran, "PAID");
  assert.equal(firstCheck.rows[0].ticket_count, 1);

  // 4. Duplicate settlement callback -> idempotent (200), NO duplicate tickets issued
  const duplicateResponse = await postJson("/tiket-api/payments/webhook", validNotification);
  assert.equal(duplicateResponse.status, 200);

  const duplicateCheck = await pgPool.query(
    `SELECT t.status_pembayaran,
            (SELECT COUNT(*)::integer FROM tiket WHERE transaksi_id = t.id) AS ticket_count
     FROM transaksi t WHERE t.id = $1`,
    [transaction.rows[0].id]
  );
  assert.equal(duplicateCheck.rows[0].status_pembayaran, "PAID");
  assert.equal(duplicateCheck.rows[0].ticket_count, 1, "Duplicate callback must not issue duplicate tickets");
});

test("Admin mark NEEDS_REFUND transaction as REFUNDED with audit trace (idempotent, admin-protected)", async () => {
  const buyer = await pgPool.query(
    `INSERT INTO pembeli (nama, email, no_whatsapp)
     VALUES ('Refund Test Buyer', 'refund@example.test', '081299998888')
     RETURNING id`
  );
  const orderId = `TRX-REFUND-${crypto.randomUUID()}`;
  const transaction = await pgPool.query(
    `INSERT INTO transaksi (
       kode_transaksi, pembeli_id, kuota_id, jumlah_tiket, harga_satuan,
       total_bayar, status_pembayaran, gateway_order_id, expired_at
     ) VALUES ($1, $2, 1, 1, 150000, 150000, 'NEEDS_REFUND', $3, NOW() - INTERVAL '2 hours')
     RETURNING id`,
    [orderId, buyer.rows[0].id, orderId]
  );

  const refundUrl = `http://127.0.0.1:${newsPort}/tiket-api/admin/transactions/${transaction.rows[0].id}/refund`;

  // 1. Unauthorized attempt without session cookie should be rejected
  const unauthResponse = await fetch(refundUrl, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "http://127.0.0.1:3000" },
    body: JSON.stringify({ notes: "Unauthorized refund" }),
    redirect: "manual",
  });
  assert.ok(
    unauthResponse.status === 401 || unauthResponse.status === 307,
    `Unauthorized refund must fail closed (got ${unauthResponse.status})`
  );

  // 2. Authorized refund action
  const refundResponse = await fetch(refundUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "http://127.0.0.1:3000",
      Cookie: publicAdminCookie,
    },
    body: JSON.stringify({
      notes: "Dana telah dikembalikan via transfer manual BCA",
      operator: "Operator Tiket Samarinda",
    }),
  });
  assert.equal(refundResponse.status, 200);
  const refundJson = await refundResponse.json();
  assert.equal(refundJson.success, true);
  assert.equal(refundJson.status, "REFUNDED");
  assert.equal(refundJson.alreadyRefunded, false);
  assert.equal(refundJson.notes, "Dana telah dikembalikan via transfer manual BCA");
  assert.equal(refundJson.refundedBy, "Operator Tiket Samarinda");
  assert.ok(refundJson.refundedAt);

  // 3. Database verification
  const dbState = await pgPool.query(
    `SELECT status_pembayaran, refund_notes, refunded_by, refunded_at
     FROM transaksi WHERE id = $1`,
    [transaction.rows[0].id]
  );
  assert.equal(dbState.rows[0].status_pembayaran, "REFUNDED");
  assert.equal(dbState.rows[0].refund_notes, "Dana telah dikembalikan via transfer manual BCA");
  assert.equal(dbState.rows[0].refunded_by, "Operator Tiket Samarinda");
  assert.ok(dbState.rows[0].refunded_at);

  // 4. Idempotency check: repeated call returns 200 with alreadyRefunded: true
  const repeatedResponse = await fetch(refundUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "http://127.0.0.1:3000",
      Cookie: publicAdminCookie,
    },
    body: JSON.stringify({ notes: "Catatan lain" }),
  });
  assert.equal(repeatedResponse.status, 200);
  const repeatedJson = await repeatedResponse.json();
  assert.equal(repeatedJson.alreadyRefunded, true);
  assert.equal(repeatedJson.status, "REFUNDED");

  // 5. Excel export verification: row shows REFUNDED and operator notes
  const exportResponse = await fetch(
    `http://127.0.0.1:${newsPort}/tiket-api/reports/export-excel`,
    { headers: { Cookie: publicAdminCookie } }
  );
  assert.equal(exportResponse.status, 200);
  const workbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: "buffer" });
  const rows = workbook.SheetNames.flatMap((name) =>
    XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "" })
  );
  const refundedRow = rows.find((r) => r["Kode Transaksi"] === orderId);
  assert.ok(refundedRow, "Refunded transaction must be in Excel export");
  assert.equal(refundedRow["Status Pembayaran"], "REFUNDED");
  assert.equal(refundedRow["Catatan Refund"], "Dana telah dikembalikan via transfer manual BCA");
  assert.equal(refundedRow["Operator Refund"], "Operator Tiket Samarinda");
});

test("PostgreSQL native multi-connection concurrency and migration (skipped if TEST_POSTGRES_URL unavailable)", async (t) => {
  const nativeUrl = process.env.TEST_POSTGRES_URL;
  if (!nativeUrl) {
    t.skip("PostgreSQL native instance tidak tersedia di environment ini (set TEST_POSTGRES_URL untuk menjalankan uji konkurensi native)");
    return;
  }

  // Dedicated pool for testing native PostgreSQL with 25 connections
  const nativePool = new Pool({ connectionString: nativeUrl, max: 25 });
  try {
    const ping = await nativePool.query("SELECT version()");
    assert.ok(ping.rows.length > 0);

    // 1. Terapkan schema.sql dari nol dan uji migrasi
    const schemaPath = path.join(root, "Eticket/packages/database/schema.sql");
    const fullSchema = fs.readFileSync(schemaPath, "utf8");
    await nativePool.query(fullSchema);

    // 2. 20 checkout paralel pada sisa kuota 1 -> hanya 1 sukses
    const testQuota = await nativePool.query(
      `INSERT INTO kuota_tiket (nama_event, kategori, harga, total_kuota, kuota_terjual, kuota_terpesan)
       VALUES ('Native Test Route', 'Native Demo', 100000, 10, 9, 0)
       RETURNING id`
    );
    const quotaId = testQuota.rows[0].id;

    const checkouts = Array.from({ length: 20 }, (_, i) =>
      nativePool
        .query(
          `SELECT sp_checkout_pembeli(
             $1, $2, $3, 1, $4, CURRENT_DATE
           ) AS result`,
          [`Buyer ${i}`, `buyer${i}@native.test`, `08123000${i}`, quotaId]
        )
        .then(() => "SUCCESS")
        .catch((err) => err.message)
    );

    const results = await Promise.all(checkouts);
    const successes = results.filter((r) => r === "SUCCESS");
    const failures = results.filter((r) => r.includes("penuh") || r.includes("Kuota"));
    assert.equal(successes.length, 1, "Hanya 1 checkout yang boleh sukses dari 20 checkout bersamaan pada sisa kuota 1");
    assert.equal(failures.length, 19, "19 checkout lainnya harus ditolak karena kuota habis");

    // 3. Verifikasi konsistensi stok kuota
    const finalQuota = await nativePool.query(
      "SELECT kuota_terjual, kuota_terpesan, total_kuota FROM kuota_tiket WHERE id = $1",
      [quotaId]
    );
    assert.equal(finalQuota.rows[0].kuota_terpesan, 1);
    assert.equal(finalQuota.rows[0].kuota_terjual, 9);
  } finally {
    await nativePool.end();
  }
});

test("forwarded IP spoofing cannot evade ticket limits and news login stays unthrottled", async () => {
  if (!actualLanIp) {
    assert.fail("LAN IPv4 address is required for the forwarded-IP integration check");
  }
  const preflight = await httpRequest({
    host: actualLanIp,
    port: newsPort,
    path: "/tiket-api/admin/login",
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:3000",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);

  const head = await httpRequest({
    host: actualLanIp,
    port: newsPort,
    path: "/tiket-api/admin/login",
    method: "HEAD",
  });
  assert.notEqual(head.status, 429);

  const paths = [
    "/tiket-api/admin/login",
    "/tiket-api/admin/login/",
    "/tiket-api/ADMIN/LOGIN",
    "/tiket-api/api/admin/login",
    "/tiket-api/api/ADMIN/LOGIN/",
  ];
  for (const [index, route] of paths.entries()) {
    const response = await httpRequest({
      host: actualLanIp,
      port: newsPort,
      path: route,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${index + 1}`,
      },
      body: JSON.stringify({ username: "wrong", password: "wrong" }),
    });
    assert.equal(response.status, 401, `${route} must count against the same source IP`);
  }
  const limitedLogin = await httpRequest({
    host: actualLanIp,
    port: newsPort,
    path: "/tiket-api/admin/login",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.200",
    },
    body: JSON.stringify({ username: "wrong", password: "wrong" }),
  });
  assert.equal(limitedLogin.status, 429);

  for (let index = 0; index < 21; index += 1) {
    const response = await httpRequest({
      host: actualLanIp,
      port: newsPort,
      path: "/tiket-api/checkout",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `192.0.2.${index + 1}`,
      },
      body: "{}",
    });
    assert.equal(response.status === 429, index === 20);
  }

  for (let index = 0; index < 10; index += 1) {
    const response = await httpRequest({
      host: actualLanIp,
      port: newsPort,
      path: "/admin/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=wrong&password=wrong",
    });
    assert.notEqual(response.status, 429);
  }
});

test("clean exporter output passes an independent ZIP content check", () => {
  const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "portal-r4-export-"));
  try {
    fs.mkdirSync(path.join(exportRoot, "scripts"), { recursive: true });
    const write = (relativePath, contents = "") => {
      const file = path.join(exportRoot, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    };

    fs.copyFileSync(
      path.join(root, "scripts/export-clean.py"),
      path.join(exportRoot, "scripts/export-clean.py")
    );
    write(".env.example", "SESSION_SECRET=\n");
    write("Eticket/.env.example");
    write("berita/.env.example");
    write(".env", "not-for-export");
    write(".env.production", "not-for-export");
    write("app.db");
    write("berita/data/sessions.db");
    write("node_modules/pkg/index.js");
    write(".next/BUILD_ID");
    write("dist/server.js");
    write(".git/config");
    write("backup/archive.db");
    write("uploads/private-image.png");
    write("uploads/.gitkeep");
    write("README.md", "public source");

    const exported = spawnSync(
      "python3",
      [path.join(exportRoot, "scripts/export-clean.py")],
      { cwd: exportRoot, encoding: "utf8", timeout: 10000 }
    );
    assert.equal(exported.status, 0, exported.stderr);

    const archivePath = path.join(exportRoot, "portalberita-jualticket-clean.zip");
    const inspection = spawnSync(
      "python3",
      [
        "-c",
        [
          "import sys, zipfile",
          "from pathlib import PurePosixPath",
          "with zipfile.ZipFile(sys.argv[1]) as archive:",
          "    names = sorted(archive.namelist())",
          "    assert '.env.example' in names",
          "    assert 'Eticket/.env.example' in names",
          "    assert 'berita/.env.example' in names",
          "    assert 'README.md' in names",
          "    assert [n for n in names if n.startswith('berita/data/')] == ['berita/data/.gitkeep']",
          "    for name in names:",
          "        parts = PurePosixPath(name).parts",
          "        assert not any(part in {'node_modules', '.next', 'dist', '.git', 'backup'} for part in parts), name",
          "        assert not any(part.startswith('.env') and part != '.env.example' for part in parts), name",
          "        assert not name.endswith(('.db', '.db-wal', '.db-shm', '.zip')), name",
          "        assert not ('uploads' in parts and parts[-1] != '.gitkeep'), name",
          "    print(f'independent ZIP check passed: {len(names)} entries')",
        ].join("\n"),
        archivePath,
      ],
      { encoding: "utf8", timeout: 10000 }
    );
    assert.equal(inspection.status, 0, inspection.stderr);
    assert.match(inspection.stdout, /independent ZIP check passed:/);
  } finally {
    fs.rmSync(exportRoot, { recursive: true, force: true });
  }
});

test("environment templates ship no default admin or payment credentials", () => {
  const expectedEmpty = {
    ".env.example": [
      "SESSION_SECRET",
      "OWNER_USERNAME",
      "OWNER_PASSWORD",
      "DATABASE_URL",
      "ADMIN_USERNAME",
      "ADMIN_PASSWORD",
      "ADMIN_SESSION_SECRET",
      "PAYMENT_API_KEY",
      "PAYMENT_WEBHOOK_SECRET",
    ],
    "Eticket/.env.example": [
      "DATABASE_URL",
      "ADMIN_USERNAME",
      "ADMIN_PASSWORD",
      "ADMIN_SESSION_SECRET",
      "PAYMENT_API_KEY",
      "PAYMENT_WEBHOOK_SECRET",
    ],
    "berita/.env.example": [
      "SESSION_SECRET",
      "OWNER_USERNAME",
      "OWNER_PASSWORD",
    ],
  };
  for (const [relativePath, keys] of Object.entries(expectedEmpty)) {
    const assignments = new Map(
      fs
        .readFileSync(path.join(root, relativePath), "utf8")
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/))
        .filter(Boolean)
        .map(([, key, value]) => [key, value])
    );
    for (const key of keys) {
      assert.equal(assignments.get(key), "", `${relativePath}:${key} must be empty`);
    }
  }
  const databaseSource = fs.readFileSync(
    path.join(root, "Eticket/apps/api/src/modules/db.ts"),
    "utf8"
  );
  assert.doesNotMatch(databaseSource, /process\.env\.DATABASE_URL\s*\|\|/);
});
