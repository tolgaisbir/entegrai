import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export * from "./crypto.js";
export * from "./mcpConnectionConfig.js";

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
