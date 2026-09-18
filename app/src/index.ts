import "dotenv/config";
import express from "express";
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

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});
