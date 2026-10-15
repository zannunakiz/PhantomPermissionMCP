-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "versionRowId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "operations" JSONB NOT NULL,
    "status" "SimulationStatus" NOT NULL DEFAULT 'COMPLETED',
    "summary" JSONB NOT NULL,
    "impacts" JSONB NOT NULL,
    "findings" JSONB NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Simulation_tenantId_idx" ON "Simulation"("tenantId");

-- CreateIndex
CREATE INDEX "Simulation_tenantId_createdAt_idx" ON "Simulation"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Simulation_modelId_version_idx" ON "Simulation"("modelId", "version");

-- CreateIndex
CREATE INDEX "Simulation_contentHash_idx" ON "Simulation"("contentHash");

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AccessModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
