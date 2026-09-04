import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: '2406:da18:1f7e:b101:b3e:b1c5:cfeb:9a1d',
  port: 5432,
  user: 'postgres',
  password: 'Minhduc2009!',
  database: 'postgres'
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to production DB.");
    const res = await client.query("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'vam084_participant_for_stage';");
    if (res.rows.length > 0) {
      console.log(res.rows[0].pg_get_functiondef);
    } else {
      console.log("Function not found.");
    }
  } catch (err) {
    console.error("Connection error:", err);
  } finally {
    await client.end();
  }
}

run();
