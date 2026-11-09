-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "extra_companies" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduled_interval" TEXT,
ADD COLUMN     "suspended_at" TIMESTAMP(3);
