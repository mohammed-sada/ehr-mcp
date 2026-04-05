import pg from "pg";

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "mimiciv"
});

async function testQueries() {
  try {
    // Test 1: Check if patients table exists and has data
    console.log("=== Testing patients table ===");
    const patients = await pool.query(
      "SELECT COUNT(*) as count FROM hosp.patients"
    );
    console.log("Total patients:", patients.rows[0]?.count);

    // Test 2: Check specific patients
    console.log("\n=== Checking specific patients ===");
    const p10000032 = await pool.query(
      "SELECT * FROM hosp.patients WHERE subject_id = $1",
      [10000032]
    );
    console.log("Patient 10000032:", p10000032.rows[0]);

    const p10000031 = await pool.query(
      "SELECT * FROM hosp.patients WHERE subject_id = $1",
      [10000031]
    );
    console.log("Patient 10000031:", p10000031.rows[0] || "NOT FOUND");

    const p10002428 = await pool.query(
      "SELECT * FROM hosp.patients WHERE subject_id = $1",
      [10002428]
    );
    console.log("Patient 10002428:", p10002428.rows[0]);

    // Test 4: Check diagnoses for patient 10002428
    console.log("\n=== Diagnoses for patient 10002428 ===");
    const diag = await pool.query(
      `SELECT
        di.subject_id,
        di.hadm_id,
        di.icd_code,
        di.icd_version,
        did.long_title
      FROM hosp.diagnoses_icd di
      LEFT JOIN hosp.d_icd_diagnoses did
        ON did.icd_code = di.icd_code
       AND did.icd_version = di.icd_version
      WHERE di.subject_id = $1
      ORDER BY di.hadm_id NULLS LAST, di.seq_num NULLS LAST
      LIMIT 5`,
      [10002428]
    );
    console.log("Found diagnoses:", diag.rows.length);
    console.log("First diagnosis:", diag.rows[0]);

    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
}

testQueries();
