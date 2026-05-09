/*
  Warnings:

  - You are about to drop the column `interviewer_id` on the `interviews` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "interviews" DROP CONSTRAINT "interviews_interviewer_id_fkey";

-- DropIndex
DROP INDEX "interviews_interviewer_id_scheduled_start_idx";

-- AlterTable
ALTER TABLE "interviews" DROP COLUMN "interviewer_id";
