const assert = require("assert");

async function check(url, fetchImplementation) {
  let lastError = null;
  for (let attempt = 0; attempt < 1; attempt++) {
    try {
      const response = await fetchImplementation(url);
      return { reachable: true, status: response.status };
    } catch (error) {
      lastError = error;
    }
  }
  return { reachable: false, error: lastError?.message || "unreachable" };
}

(async () => {
  const limited = await check("https://example.test/health", async () => new Response("", { status: 429 }));
  assert.deepStrictEqual(limited, { reachable: true, status: 429 });

  const unavailable = await check("https://example.test/health", async () => {
    throw new Error("network failure");
  });
  assert.strictEqual(unavailable.reachable, false);
  assert.strictEqual(unavailable.error, "network failure");

  console.log("✓ KIA health preflight test passed");
})();
