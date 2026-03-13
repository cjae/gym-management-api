-- CreateEnum
CREATE TYPE "PushJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "PushJob" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "status" "PushJobStatus" NOT NULL DEFAULT 'PENDING',
    "cursor" TEXT,
    "batchSize" INTEGER NOT NULL DEFAULT 500,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushTicket" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "pushToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushJob_notificationId_key" ON "PushJob"("notificationId");

-- CreateIndex
CREATE INDEX "PushJob_status_createdAt_idx" ON "PushJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushTicket_ticketId_key" ON "PushTicket"("ticketId");

-- CreateIndex
CREATE INDEX "PushTicket_createdAt_idx" ON "PushTicket"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- AddForeignKey
ALTER TABLE "PushJob" ADD CONSTRAINT "PushJob_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
