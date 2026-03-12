import { Hono } from "hono";

export type Env = {
  AI: Ai;
  DB: D1Database;
  SESSIONS: KVNamespace;
  VECTORIZE: VectorizeIndex;
  KNOWLEDGE_R2: R2Bucket;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  PAYSTACK_SECRET: string;
  BOOTSTRAP_SECRET?: string;
  GNEWS_API_KEY: string;
};

export type Variables = {
  userId: string;
  deptFilter?: string;
  orgId?: string;
  isSuperAdmin?: boolean;
};

export type AppType = { Bindings: Env; Variables: Variables };
