-- CreateIndex
CREATE INDEX "ShopItemVariant_shopItemId_idx" ON "ShopItemVariant"("shopItemId");

-- CreateIndex
CREATE INDEX "ShopOrder_memberId_idx" ON "ShopOrder"("memberId");

-- CreateIndex
CREATE INDEX "ShopOrder_status_idx" ON "ShopOrder"("status");

-- CreateIndex
CREATE INDEX "ShopOrderItem_shopOrderId_idx" ON "ShopOrderItem"("shopOrderId");

-- CreateIndex
CREATE INDEX "ShopOrderItem_shopItemId_idx" ON "ShopOrderItem"("shopItemId");
