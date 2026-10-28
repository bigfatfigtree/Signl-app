// SIGNL API entrypoint (Netlify Function). All logic lives in lib/.
const { route } = require("./lib/router");
const { BUILD_ID } = require("./lib/build");

exports.handler = async (event) => {
  try {
    const out = await route(event);
    // Build stamp (see lib/build.js): every API response names
    // the server build so a stale client can detect a deploy it
    // outlived and reload itself once. /c/* page responses pass
    // through here too; the header is harmless on HTML.
    if (out && typeof out === "object") {
      out.headers = Object.assign({}, out.headers, { "x-signl-build": BUILD_ID });
    }
    return out;
  } catch (e) {
    console.error("SIGNL API error:", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "x-signl-build": BUILD_ID },
      body: JSON.stringify({ error: "Something went wrong on our side. Please try again." }),
    };
  }
};
