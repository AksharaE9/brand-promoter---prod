-- DropForeignKey
ALTER TABLE "interviews" DROP CONSTRAINT "interviews_interviewer_id_fkey";

-- AlterTable
ALTER TABLE "interviews" ADD COLUMN     "round" VARCHAR(50),
ALTER COLUMN "interviewer_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "_InterviewInterviewer" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_InterviewInterviewer_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_InterviewInterviewer_B_index" ON "_InterviewInterviewer"("B");

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InterviewInterviewer" ADD CONSTRAINT "_InterviewInterviewer_A_fkey" FOREIGN KEY ("A") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InterviewInterviewer" ADD CONSTRAINT "_InterviewInterviewer_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
