import { Client } from "pg";
const maint = new Client({
  connectionString: "postgres://wchat:localdev@localhost:5432/postgres",
});
await maint.connect();
await maint.query(
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'wchat_dev' AND pid <> pg_backend_pid()",
);
await maint.query("DROP DATABASE IF EXISTS wchat_dev");
await maint.query("CREATE DATABASE wchat_dev OWNER wchat");
await maint.end();
console.log("reset done");
