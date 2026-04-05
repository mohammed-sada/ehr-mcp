import * as http from "node:http";

function httpGet(urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: 3333, path: urlPath, method: "GET",
        headers: { "Accept": "application/json, text/event-stream" } },
      (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function testEndpoint(endpoint: string) {
  console.log(`\n=== Testing ${endpoint} ===`);
  try {
    const result = await httpGet(endpoint);
    console.log(`Status: ${result.status}`);
    if (result.status !== 200) {
      console.log("Error response:", result.body.slice(0, 300));
    } else {
      // Try to extract the actual data
      const lines = result.body.split("\n");
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith("data:")) {
          try {
            const jsonStr = t.slice(5).trim();
            const parsed = JSON.parse(jsonStr);
            const content = parsed.result?.content?.[0]?.text;
            if (content) {
              try {
                const data = JSON.parse(content);
                console.log("Data:", JSON.stringify(data, null, 2).slice(0, 200));
              } catch {
                console.log("Content (plain):", content.slice(0, 100));
              }
            }
          } catch (e) {
            console.error("Parse error:", String(e).slice(0, 100));
          }
        }
      }
    }
  } catch (err) {
    console.error("Network error:", String(err));
  }
}

async function main() {
  console.log("Testing endpoints...");
  console.log("(Make sure the server is running on port 3333)\n");
  
  // Working case
  await testEndpoint("/patient-info?subject_id=10000032");
  
  // Non-existent patient
  await testEndpoint("/patient-info?subject_id=10000031");
  
  // Patient with diagnoses
  await testEndpoint("/diagnoses?subject_id=10002428");
  
  // Non-existent patient diagnoses  
  await testEndpoint("/diagnoses?subject_id=10000031");
  
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
