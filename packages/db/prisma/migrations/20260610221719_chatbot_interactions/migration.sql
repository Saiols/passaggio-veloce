-- CreateTable
CREATE TABLE "chatbot_interactions" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tier" TEXT NOT NULL,
    "answered" BOOLEAN NOT NULL,
    "escalated" BOOLEAN NOT NULL,
    "unansweredQuestion" TEXT,

    CONSTRAINT "chatbot_interactions_pkey" PRIMARY KEY ("id")
);
