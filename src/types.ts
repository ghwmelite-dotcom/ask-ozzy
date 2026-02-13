import { Hono } from "hono";

export type Env = {
  AI: Ai;
  DB: D1Database;
  SESSIONS: KVNamespace;
  VECTORIZE: VectorizeIndex;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  PAYSTACK_SECRET: string;
  BOOTSTRAP_SECRET?: string;
};

export type Variables = {
  userId: string;
  deptFilter?: string;
};

export type AppType = { Bindings: Env; Variables: Variables };
