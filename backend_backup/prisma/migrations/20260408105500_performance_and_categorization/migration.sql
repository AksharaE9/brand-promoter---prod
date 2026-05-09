-- AlterTable
ALTER TABLE "candidates" ADD COLUMN "category" VARCHAR(50) DEFAULT 'Company';

-- CreateIndex
CREATE INDEX "applications_shortlisted_idx" ON "applications"("shortlisted");

-- CreateIndex
CREATE INDEX "candidates_category_idx" ON "candidates"("category");

-- CreateIndex
CREATE INDEX "interviews_scheduled_start_idx" ON "interviews"("scheduled_start");

-- DropIndex
ALTER TABLE "interview_feedback" DROP CONSTRAINT "interview_feedback_interview_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "interview_feedback_interview_id_submitted_by_key" ON "interview_feedback"("interview_id", "submitted_by");
