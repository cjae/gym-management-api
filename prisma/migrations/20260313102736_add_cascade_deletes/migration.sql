-- DropForeignKey
ALTER TABLE "NotificationRead" DROP CONSTRAINT "NotificationRead_notificationId_fkey";

-- DropForeignKey
ALTER TABLE "PushJob" DROP CONSTRAINT "PushJob_notificationId_fkey";

-- AddForeignKey
ALTER TABLE "PushJob" ADD CONSTRAINT "PushJob_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
