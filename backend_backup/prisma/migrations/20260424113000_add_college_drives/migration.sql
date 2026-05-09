-- CreateEnum
CREATE TYPE "college_drive_status" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "drive_candidate_status" AS ENUM ('ADDED', 'SCREENED', 'SHORTLISTED', 'INTERVIEWED', 'OFFERED', 'JOINED', 'REJECTED');

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN "college_id" UUID;
ALTER TABLE "candidates" ADD COLUMN "college_drive_id" UUID;

-- CreateTable
CREATE TABLE "colleges" (
  "id" UUID NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "location" VARCHAR(180),
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "colleges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_drives" (
  "id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "college_id" UUID NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE,
  "status" "college_drive_status" NOT NULL DEFAULT 'PLANNED',
  "notes" TEXT,
  "owner_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "college_drives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_drive_recruiters" (
  "id" UUID NOT NULL,
  "drive_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "college_drive_recruiters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_drive_candidates" (
  "id" UUID NOT NULL,
  "drive_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "status" "drive_candidate_status" NOT NULL DEFAULT 'ADDED',
  "note" TEXT,
  "added_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "college_drive_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colleges_name_location_key" ON "colleges"("name", "location");
CREATE INDEX "colleges_name_idx" ON "colleges"("name");
CREATE INDEX "college_drives_college_id_date_from_idx" ON "college_drives"("college_id", "date_from" DESC);
CREATE INDEX "college_drives_status_idx" ON "college_drives"("status");
CREATE UNIQUE INDEX "college_drive_recruiters_drive_id_user_id_key" ON "college_drive_recruiters"("drive_id", "user_id");
CREATE INDEX "college_drive_recruiters_user_id_idx" ON "college_drive_recruiters"("user_id");
CREATE UNIQUE INDEX "college_drive_candidates_drive_id_candidate_id_key" ON "college_drive_candidates"("drive_id", "candidate_id");
CREATE INDEX "college_drive_candidates_status_idx" ON "college_drive_candidates"("status");
CREATE INDEX "candidates_college_id_idx" ON "candidates"("college_id");
CREATE INDEX "candidates_college_drive_id_idx" ON "candidates"("college_drive_id");

-- AddForeignKey
ALTER TABLE "colleges" ADD CONSTRAINT "colleges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "college_drives" ADD CONSTRAINT "college_drives_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "college_drives" ADD CONSTRAINT "college_drives_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "college_drive_recruiters" ADD CONSTRAINT "college_drive_recruiters_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "college_drives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "college_drive_recruiters" ADD CONSTRAINT "college_drive_recruiters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "college_drive_candidates" ADD CONSTRAINT "college_drive_candidates_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "college_drives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "college_drive_candidates" ADD CONSTRAINT "college_drive_candidates_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "college_drive_candidates" ADD CONSTRAINT "college_drive_candidates_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_college_drive_id_fkey" FOREIGN KEY ("college_drive_id") REFERENCES "college_drives"("id") ON DELETE SET NULL ON UPDATE CASCADE;
