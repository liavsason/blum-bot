import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = "12345";

app.get("/", (req, res) => {
  res.status(200).send("Server is running");
});

app.get("/webhook", (req, res) => {
  console.log("GET /webhook called");
  console.log("Query:", req.query);

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed");
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("POST /webhook called");
    console.log(JSON.stringify(req.body, null, 2));

    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from;
    const msg = message?.text?.body;

    if (!from || !msg) {
      return res.sendStatus(200);
    }

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `
אתה העוזר הדיגיטלי של מרפאת בלום.
ענה בעברית, קצר, נעים ומקצועי.
אל תיתן אבחנה רפואית, אל תיתן טיפול אישי, ואל תיתן מחיר סופי.
אם זו שאלה רפואית אישית, הפנה לבדיקה במרפאה.
אם מבקשים נציג, כתוב שנציג מהמרפאה יחזור בהקדם.

שאלת המשתמש:
${msg}
        `,
      }),
    });

    const data = await aiResponse.json();

    const reply =
      data.output_text ||
      "שלום 🌷 כדי לתת מענה מדויק, מומלץ ליצור קשר ישירות עם המרפאה.";

    await fetch(`https://graph.facebook.com/v23.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      }),
    });

    return res.sendStatus(200);
  } catch (error) {
    console.error("POST /webhook error:", error);
    return res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
