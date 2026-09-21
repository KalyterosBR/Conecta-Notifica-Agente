-- Migration idempotente: pode ser reaplicada sobre um banco parcialmente criado.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "Direction" AS ENUM ('in', 'out');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "schools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'basico',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "provider_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'school',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_api_keys" (
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
CREATE TABLE IF NOT EXISTS "students" (
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
CREATE TABLE IF NOT EXISTS "guardians" (
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
CREATE TABLE IF NOT EXISTS "student_guardians" (
    "student_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "notify_entry" BOOLEAN NOT NULL DEFAULT true,
    "notify_exit" BOOLEAN NOT NULL DEFAULT true,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "access_events" (
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
CREATE TABLE IF NOT EXISTS "messages" (
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
CREATE TABLE IF NOT EXISTS "message_templates" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "event_type" "Direction" NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "school_settings" (
    "school_id" TEXT NOT NULL,
    "dedupe_minutes" INTEGER NOT NULL DEFAULT 3,
    "window_start" TEXT NOT NULL DEFAULT '06:00',
    "window_end" TEXT NOT NULL DEFAULT '19:30',
    "notify_weekends" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "school_settings_pkey" PRIMARY KEY ("school_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_api_keys_key_hash_key" ON "agent_api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "students_school_id_external_id_key" ON "students"("school_id", "external_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "access_events_school_id_occurred_at_idx" ON "access_events"("school_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "access_events_school_id_external_event_id_key" ON "access_events"("school_id", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "messages_access_event_id_guardian_id_key" ON "messages"("access_event_id", "guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "message_templates_school_id_event_type_key" ON "message_templates"("school_id", "event_type");

-- AddForeignKey
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_school_id_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_api_keys" DROP CONSTRAINT IF EXISTS "agent_api_keys_school_id_fkey";
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "students_school_id_fkey";
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" DROP CONSTRAINT IF EXISTS "guardians_school_id_fkey";
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" DROP CONSTRAINT IF EXISTS "student_guardians_student_id_fkey";
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" DROP CONSTRAINT IF EXISTS "student_guardians_guardian_id_fkey";
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" DROP CONSTRAINT IF EXISTS "access_events_school_id_fkey";
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" DROP CONSTRAINT IF EXISTS "access_events_student_id_fkey";
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_access_event_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_access_event_id_fkey" FOREIGN KEY ("access_event_id") REFERENCES "access_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_guardian_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" DROP CONSTRAINT IF EXISTS "message_templates_school_id_fkey";
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_settings" DROP CONSTRAINT IF EXISTS "school_settings_school_id_fkey";
ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
