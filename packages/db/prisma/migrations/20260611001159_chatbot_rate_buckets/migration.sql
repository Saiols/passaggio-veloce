-- CreateTable
CREATE TABLE "chatbot_rate_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_rate_buckets_pkey" PRIMARY KEY ("key")
);
