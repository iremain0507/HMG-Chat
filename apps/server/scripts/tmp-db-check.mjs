import pg from "pg";

const url =
  process.env.DATABASE_URL ?? "postgres://wchat:localdev@localhost:5432/wchat_dev";
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  console.log("DB UP");
  await client.end();
} catch (e) {
  console.log("DB DOWN:", e.message);
  process.exit(0);
}
