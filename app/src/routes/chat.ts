import { Router } from "express";

export const chatRouter = Router();

// DESIGN.md Bölüm 6 — Chat Bot Deneyimi (skill seçimi, sol frame chat history) — TODO
// DESIGN.md Bölüm 10 — Şablon (Template) tetikleme/izleme uç noktaları — TODO
// DESIGN.md Bölüm 12.6 — Kullanıcının kendi kullanım/kalan bütçe görünürlüğü — TODO

chatRouter.get("/", (_req, res) => {
  res.json({ message: "chat api placeholder" });
});
