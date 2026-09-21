-- ============================================================
-- Conecta Notifica — schema da aplicação
-- Rode conectado NO BANCO conecta_notifica, como conecta_app:
--   psql -h SEU_HOST -U conecta_app -d conecta_notifica -f 02-schema.sql
--
-- Gerado a partir de prisma/schema.prisma (migration 20260825205734_init).
-- O bloco final registra a migration para o Prisma, então um futuro
-- `prisma migrate deploy` reconhece este banco como já migrado em vez
-- de tentar recriar tudo.
-- ============================================================

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "schools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'basico',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "provider_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'school',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_api_keys" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'agente',
    "last_seen_at" TIMESTAMP(3),
    "last_status" JSONB,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class_name" TEXT,
    "card" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "relation" TEXT,
    "opt_in_at" TIMESTAMP(3),
    "opt_out_at" TIMESTAMP(3),

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "student_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "notify_entry" BOOLEAN NOT NULL DEFAULT true,
    "notify_exit" BOOLEAN NOT NULL DEFAULT true,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "access_events" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "card" TEXT,
    "device_id" TEXT,
    "location_id" TEXT,

    CONSTRAINT "access_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "access_event_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "event_type" "Direction" NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_settings" (
    "school_id" TEXT NOT NULL,
    "dedupe_minutes" INTEGER NOT NULL DEFAULT 3,
    "window_start" TEXT NOT NULL DEFAULT '06:00',
    "window_end" TEXT NOT NULL DEFAULT '19:30',
    "notify_weekends" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "school_settings_pkey" PRIMARY KEY ("school_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agent_api_keys_key_hash_key" ON "agent_api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_external_id_key" ON "students"("school_id", "external_id");

-- CreateIndex
CREATE INDEX "access_events_school_id_occurred_at_idx" ON "access_events"("school_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_events_school_id_external_event_id_key" ON "access_events"("school_id", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_access_event_id_guardian_id_key" ON "messages"("access_event_id", "guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_school_id_event_type_key" ON "message_templates"("school_id", "event_type");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_access_event_id_fkey" FOREIGN KEY ("access_event_id") REFERENCES "access_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Registro da migration para o Prisma (não mexer nos valores)
-- ============================================================
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations"
    (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
VALUES (
    gen_random_uuid()::text,
    '875cadc90e36bed0cc8a89aa3160332247ba053a974ad66fb0a1c41eaba9a521',
    now(),
    '20260825205734_init',
    now(),
    1
)
ON CONFLICT DO NOTHING;
