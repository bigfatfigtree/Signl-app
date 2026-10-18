// SIGNL API entrypoint (Netlify Function). All logic lives in lib/.
const { route } = require("./lib/router");

exports.handler = async (event) => {
  try {
    return await route(event);
  } catch (e) {
    console.error("SIGNL API error:", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Something went wrong on our side. Please try again." }),
    };
  }
};
