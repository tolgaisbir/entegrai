-- CreateEnum
CREATE TYPE "AiProviderType" AS ENUM ('openai', 'anthropic', 'azure_openai', 'google', 'other');

-- CreateEnum
CREATE TYPE "McpIntegrationType" AS ENUM ('http_api', 'database', 'internal_tool', 'file_share', 'smtp_mail');

-- CreateEnum
CREATE TYPE "AuthSource" AS ENUM ('local', 'ldap');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "MailSendStatus" AS ENUM ('sent', 'failed');

-- CreateEnum
CREATE TYPE "TemplateVisibility" AS ENUM ('private', 'shared');

-- CreateEnum
CREATE TYPE "TemplateStepType" AS ENUM ('mcp_call', 'ai_transform');

-- CreateEnum
CREATE TYPE "TemplateRunStatus" AS ENUM ('running', 'success', 'failed');

-- CreateEnum
CREATE TYPE "AiOutputFormat" AS ENUM ('text', 'json', 'html');

-- CreateEnum
CREATE TYPE "TemplateParamType" AS ENUM ('text', 'number', 'date', 'select');

-- CreateEnum
CREATE TYPE "BudgetScopeType" AS ENUM ('global', 'skill', 'user');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('daily', 'monthly');

-- CreateEnum
CREATE TYPE "AiUsageSource" AS ENUM ('chat', 'template_ai_transform');

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider_type" "AiProviderType" NOT NULL,
    "api_base_url" TEXT,
    "api_key_encrypted" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "default_params" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_integrations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "McpIntegrationType" NOT NULL,
    "connection_config" JSONB NOT NULL,
    "tool_schema" JSONB NOT NULL DEFAULT '{}',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "auth_source" "AuthSource" NOT NULL DEFAULT 'local',
    "password_hash" TEXT,
    "ldap_dn" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_skills" (
    "user_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,

    CONSTRAINT "user_skills_pkey" PRIMARY KEY ("user_id","skill_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_mcp_permissions" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "mcp_integration_id" TEXT NOT NULL,
    "allowed_operations" JSONB NOT NULL DEFAULT '[]',
    "get_filters" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "role_mcp_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_ai_providers" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "ai_provider_id" TEXT NOT NULL,

    CONSTRAINT "role_ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "ai_provider_id" TEXT NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_call_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "mail_send_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mcp_integration_id" TEXT NOT NULL,
    "to_addresses" TEXT[],
    "subject" TEXT NOT NULL,
    "status" "MailSendStatus" NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_user_id" TEXT NOT NULL,
    "visibility" "TemplateVisibility" NOT NULL DEFAULT 'private',
    "source_session_id" TEXT,
    "result_html_template" TEXT NOT NULL,
    "schedule_cron" TEXT,
    "is_schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_steps" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "step_key" TEXT NOT NULL,
    "step_type" "TemplateStepType" NOT NULL,
    "mcp_integration_id" TEXT,
    "operation" TEXT,
    "ai_prompt_template_id" TEXT,
    "input_mapping" JSONB NOT NULL DEFAULT '{}',
    "output_placeholder" TEXT,

    CONSTRAINT "template_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_parameters" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "param_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "TemplateParamType" NOT NULL,
    "default_value" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "template_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_runs" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "triggered_by_user_id" TEXT,
    "parameter_values" JSONB NOT NULL DEFAULT '{}',
    "status" "TemplateRunStatus" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "template_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_run_steps" (
    "id" TEXT NOT NULL,
    "template_run_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "raw_result" JSONB,
    "token_usage" JSONB,
    "error" TEXT,

    CONSTRAINT "template_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_run_results" (
    "id" TEXT NOT NULL,
    "template_run_id" TEXT NOT NULL,
    "rendered_html" TEXT NOT NULL,

    CONSTRAINT "template_run_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ai_provider_id" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "user_prompt_template" TEXT NOT NULL,
    "output_format" "AiOutputFormat" NOT NULL DEFAULT 'text',
    "output_schema" JSONB,
    "owner_user_id" TEXT NOT NULL,
    "visibility" "TemplateVisibility" NOT NULL DEFAULT 'private',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_policies" (
    "id" TEXT NOT NULL,
    "ai_provider_id" TEXT NOT NULL,
    "scope_type" "BudgetScopeType" NOT NULL,
    "scope_id" TEXT,
    "period" "BudgetPeriod" NOT NULL,
    "limit_usd" DECIMAL(12,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ai_provider_id" TEXT NOT NULL,
    "skill_id" TEXT,
    "source" "AiUsageSource" NOT NULL,
    "reference_id" TEXT,
    "tokens_prompt" INTEGER NOT NULL,
    "tokens_completion" INTEGER NOT NULL,
    "cost_usd" DECIMAL(12,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_monthly_rollup" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ai_provider_id" TEXT NOT NULL,
    "skill_id" TEXT,
    "year_month" TEXT NOT NULL,
    "total_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "total_tokens" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_monthly_rollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "role_mcp_permissions_role_id_mcp_integration_id_key" ON "role_mcp_permissions"("role_id", "mcp_integration_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_ai_providers_role_id_ai_provider_id_key" ON "role_ai_providers"("role_id", "ai_provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_steps_template_id_step_key_key" ON "template_steps"("template_id", "step_key");

-- CreateIndex
CREATE UNIQUE INDEX "template_parameters_template_id_param_key_key" ON "template_parameters"("template_id", "param_key");

-- CreateIndex
CREATE UNIQUE INDEX "template_run_results_template_run_id_key" ON "template_run_results"("template_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_policies_ai_provider_id_scope_type_scope_id_period_key" ON "budget_policies"("ai_provider_id", "scope_type", "scope_id", "period");

-- CreateIndex
CREATE INDEX "ai_usage_records_user_id_ai_provider_id_created_at_idx" ON "ai_usage_records"("user_id", "ai_provider_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_monthly_rollup_user_id_ai_provider_id_skill_id_yea_key" ON "ai_usage_monthly_rollup"("user_id", "ai_provider_id", "skill_id", "year_month");

-- AddForeignKey
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_mcp_permissions" ADD CONSTRAINT "role_mcp_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_mcp_permissions" ADD CONSTRAINT "role_mcp_permissions_mcp_integration_id_fkey" FOREIGN KEY ("mcp_integration_id") REFERENCES "mcp_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_ai_providers" ADD CONSTRAINT "role_ai_providers_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_ai_providers" ADD CONSTRAINT "role_ai_providers_ai_provider_id_fkey" FOREIGN KEY ("ai_provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_ai_provider_id_fkey" FOREIGN KEY ("ai_provider_id") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_send_logs" ADD CONSTRAINT "mail_send_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_send_logs" ADD CONSTRAINT "mail_send_logs_mcp_integration_id_fkey" FOREIGN KEY ("mcp_integration_id") REFERENCES "mcp_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_source_session_id_fkey" FOREIGN KEY ("source_session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_steps" ADD CONSTRAINT "template_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_steps" ADD CONSTRAINT "template_steps_mcp_integration_id_fkey" FOREIGN KEY ("mcp_integration_id") REFERENCES "mcp_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_steps" ADD CONSTRAINT "template_steps_ai_prompt_template_id_fkey" FOREIGN KEY ("ai_prompt_template_id") REFERENCES "ai_prompt_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_parameters" ADD CONSTRAINT "template_parameters_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_run_steps" ADD CONSTRAINT "template_run_steps_template_run_id_fkey" FOREIGN KEY ("template_run_id") REFERENCES "template_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_run_steps" ADD CONSTRAINT "template_run_steps_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "template_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_run_results" ADD CONSTRAINT "template_run_results_template_run_id_fkey" FOREIGN KEY ("template_run_id") REFERENCES "template_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_ai_provider_id_fkey" FOREIGN KEY ("ai_provider_id") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_ai_provider_id_fkey" FOREIGN KEY ("ai_provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_ai_provider_id_fkey" FOREIGN KEY ("ai_provider_id") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_monthly_rollup" ADD CONSTRAINT "ai_usage_monthly_rollup_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_monthly_rollup" ADD CONSTRAINT "ai_usage_monthly_rollup_ai_provider_id_fkey" FOREIGN KEY ("ai_provider_id") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_monthly_rollup" ADD CONSTRAINT "ai_usage_monthly_rollup_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
