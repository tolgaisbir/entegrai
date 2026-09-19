-- DropIndex
DROP INDEX "ai_usage_monthly_rollup_user_id_ai_provider_id_skill_id_yea_key";

-- CreateIndex
CREATE INDEX "ai_usage_monthly_rollup_user_id_ai_provider_id_year_month_idx" ON "ai_usage_monthly_rollup"("user_id", "ai_provider_id", "year_month");

-- Postgres'te NULL, unique kısıtlamada birbirinden farklı sayıldığından normal bir
-- @@unique, skill_id NULL olan satırlar için yeterli değildi (DESIGN.md 12.3 notu).
-- Aşağıdaki iki partial unique index, skill_id NULL ve NOT NULL durumlarını ayrı ayrı
-- doğru şekilde tekilleştirir. Prisma şema dili partial index tanımlayamadığından bu
-- ikisi schema.prisma'da temsil edilmiyor; upsert'ler app/src/lib/budget.ts'te
-- `$executeRaw` ile "ON CONFLICT (...) WHERE skill_id IS NULL/IS NOT NULL" kullanır.
CREATE UNIQUE INDEX "ai_usage_monthly_rollup_null_skill_uq"
  ON "ai_usage_monthly_rollup" ("user_id", "ai_provider_id", "year_month")
  WHERE "skill_id" IS NULL;

CREATE UNIQUE INDEX "ai_usage_monthly_rollup_with_skill_uq"
  ON "ai_usage_monthly_rollup" ("user_id", "ai_provider_id", "skill_id", "year_month")
  WHERE "skill_id" IS NOT NULL;
