import "dotenv/config";
import { app } from "./app";
import { startQuotaSweeper } from "./modules/transactions/transaction.service";
import { checkPostgres } from "./modules/db";

const port = Number(process.env.API_PORT ?? 4000);

(async () => {
  await checkPostgres();
  app.listen(port, "127.0.0.1", () => {
    console.log(`E-Tiket API listening on http://127.0.0.1:${port}`);
    startQuotaSweeper();
  });
})().catch((err) => {
  console.error("Fatal startup error:", err.message);
  process.exit(1);
});
