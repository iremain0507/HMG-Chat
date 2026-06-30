import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool);
export const pgPool = pool;
