-- CreateTable
CREATE TABLE "AccessModel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "operationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessModel_tenantId_idx" ON "AccessModel"("tenantId");

-- CreateIndex
CREATE INDEX "AccessModel_tenantId_updatedAt_idx" ON "AccessModel"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessModel_tenantId_name_key" ON "AccessModel"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ModelVersion_tenantId_idx" ON "ModelVersion"("tenantId");

-- CreateIndex
CREATE INDEX "ModelVersion_modelId_version_idx" ON "ModelVersion"("modelId", "version");

-- CreateIndex
CREATE INDEX "ModelVersion_contentHash_idx" ON "ModelVersion"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_modelId_version_key" ON "ModelVersion"("modelId", "version");

-- AddForeignKey
ALTER TABLE "AccessModel" ADD CONSTRAINT "AccessModel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AccessModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
