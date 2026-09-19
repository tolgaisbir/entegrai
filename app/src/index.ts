import path from "node:path";
import dotenv from "dotenv";
import express, { type ErrorRequestHandler } from "express";

// npm workspace script'leri cwd'yi paket dizinine (app/) ayarlar; .env repo kökünde
// olduğundan burayı açıkça belirtiyoruz (bkz. PROGRESS.md "Nasıl çalıştırılır").
// (Bu dosya CommonJS'e derleniyor, __dirname global olarak zaten mevcut.)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { adminRouter } from "./routes/admin.js";
import { chatRouter } from "./routes/chat.js";
import { authRouter } from "./routes/auth.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// bkz. DESIGN.md Bölüm 8 — Auth mekanizması
app.use("/api/auth", authRouter);

// bkz. DESIGN.md Bölüm 5 — Admin Panel Ekranları
app.use("/api/admin", adminRouter);

// bkz. DESIGN.md Bölüm 6 — Chat Bot Deneyimi
app.use("/api/chat", chatRouter);

// DESIGN.md Bölüm 7 — admin panel + chat bot, aynı Express uygulaması içinde ayrı
// route'lar olarak sunulur. Prod build'i web/dist'ten statik servis edilir; dev'de
// frontend ayrı bir Vite sunucusunda (npm run dev:web) /api'yi buraya proxy'ler,
// bu yüzden web/dist yoksa (henüz build alınmamışsa) sessizce atlanır.
const webDist = path.resolve(__dirname, "../../web/dist");
app.use(express.static(webDist));
app.get(/^(?!\/api|\/health).*/, (_req, res, next) => {
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

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
