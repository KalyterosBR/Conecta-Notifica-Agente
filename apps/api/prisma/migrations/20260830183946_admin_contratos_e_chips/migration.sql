-- CreateEnum
CREATE TYPE "StatusCobranca" AS ENUM ('em_dia', 'pendente', 'atrasado', 'isento');

-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "billing_status" "StatusCobranca" NOT NULL DEFAULT 'em_dia',
ADD COLUMN     "billing_synced_at" TIMESTAMP(3),
ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blocked_at" TIMESTAMP(3),
ADD COLUMN     "blocked_reason" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "conta_azul_id" TEXT,
ADD COLUMN     "invoice_issued" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_invoice_at" TIMESTAMP(3),
ADD COLUMN     "max_instances" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "max_students" INTEGER,
ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_instances" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_id" TEXT,
    "base_url" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "phone" TEXT,
    "profile_name" TEXT,
    "label" TEXT,
    "connected_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_instances_school_id_status_idx" ON "whatsapp_instances"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_instances_school_id_name_key" ON "whatsapp_instances"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "schools_cnpj_key" ON "schools"("cnpj");

-- AddForeignKey
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Traz para whatsapp_instances a instância que já vivia em
-- schools.provider_config, para nenhuma escola perder o número conectado.
INSERT INTO "whatsapp_instances" ("id", "school_id", "name", "base_url", "token", "status", "phone", "profile_name", "created_at")
SELECT
  gen_random_uuid()::text,
  s."id",
  COALESCE(s."provider_config"->'uazapi'->>'instance_name', 'instancia-1'),
  s."provider_config"->'uazapi'->>'base_url',
  s."provider_config"->'uazapi'->>'token',
  CASE WHEN s."provider_config"->'uazapi'->>'numero' IS NOT NULL THEN 'connected' ELSE 'disconnected' END,
  s."provider_config"->'uazapi'->>'numero',
  s."provider_config"->'uazapi'->>'perfil',
  now()
FROM "schools" s
WHERE s."provider_config"->'uazapi'->>'token' IS NOT NULL
  AND s."provider_config"->'uazapi'->>'base_url' IS NOT NULL;
