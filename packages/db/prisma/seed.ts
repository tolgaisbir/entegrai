import path from "node:path";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// `npm run seed` doğrudan tsx ile çalışır (prisma CLI'nin otomatik .env yüklemesinden
// geçmez), bu yüzden packages/db/.env'i burada açıkça yüklüyoruz.
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// DESIGN.md 4.3 / 8 — ilk kurulumda `is_admin` sistem role'ü ve bu role'e sahip
// bir varsayılan admin kullanıcısı oluşturulur (ilk girişte şifre değişikliği zorunlu).

const ADMIN_ROLE_NAME = "is_admin";
const ADMIN_EMAIL = "admin@company.local";
const BCRYPT_ROUNDS = 12;

const prisma = new PrismaClient();

async function main() {
  const role = await prisma.role.upsert({
    where: { name: ADMIN_ROLE_NAME },
    update: {},
    create: {
      name: ADMIN_ROLE_NAME,
      description: "Admin paneline tam erişim (sistem role'ü)",
      isSystem: true,
    },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existingAdmin) {
    console.log(`Admin kullanıcısı zaten mevcut: ${ADMIN_EMAIL} (id=${existingAdmin.id})`);
    return;
  }

  const tempPassword = randomBytes(9).toString("base64url");
  const admin = await prisma.user.create({
    data: {
      fullName: "Varsayılan Admin",
      email: ADMIN_EMAIL,
      authSource: "local",
      passwordHash: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS),
      isActive: true,
      mustChangePassword: true,
      roles: { create: { roleId: role.id } },
    },
  });

  console.log("Varsayılan admin kullanıcısı oluşturuldu:");
  console.log(`  email: ${ADMIN_EMAIL}`);
  console.log(`  geçici şifre: ${tempPassword}`);
  console.log(`  id: ${admin.id}`);
  console.log("İlk girişte POST /api/auth/change-password ile şifre değiştirilmesi zorunludur.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
