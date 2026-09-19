import { Prisma } from "@tegrai/db";

// Prisma, ON DELETE RESTRICT ihlallerini bazen PrismaClientKnownRequestError (P2003)
// olarak değil, `.code`'u olmayan bir PrismaClientUnknownRequestError olarak sarıyor
// (Neon/Postgres 23001 "restrict_violation" için gözlemlendi). Silme uçlarında ikisini
// birden yakalamak için kullanılır.
export function isForeignKeyRestrictError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return true;
  if (err instanceof Prisma.PrismaClientUnknownRequestError && /foreign key/i.test(err.message)) {
    return true;
  }
  return false;
}
