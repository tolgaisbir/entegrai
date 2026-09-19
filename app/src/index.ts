import path from "node:path";
import dotenv from "dotenv";
import express, { type ErrorRequestHandler } from "express";

// npm workspace script'leri cwd'yi paket dizinine (app/) ayarlar; .env repo kökünde
// olduğundan burayı açıkça belirtiyoruz (bkz. PROGRESS.md "Nasıl çalıştırılır").
// (Bu dosya CommonJS'e derleniyor, __dirname global olarak zaten mevcut.)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { adminRouter } from "./routes/admin.js";
import { chatRouter } from "./routes/chat.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// bkz. DESIGN.md Bölüm 5 — Admin Panel Ekranları
app.use("/api/admin", adminRouter);

// bkz. DESIGN.md Bölüm 6 — Chat Bot Deneyimi
app.use("/api/chat", chatRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: "internal_error",
    message: err instanceof Error ? err.message : "Beklenmeyen bir hata oluştu",
  });
};
app.use(errorHandler);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});
