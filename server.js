import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = "12345";

// אימות webhook מול Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// קבלת הודעות מ-WhatsApp
app.post("/webhook", async (req, res) => {
  try {
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

חוקים:
- ענה בעברית בלבד.
- ענה קצר, ברור, נעים ומקצועי.
- אל תיתן אבחנה רפואית.
- אל תיתן המלצה לטיפול אישי.
- אל תיתן מחיר סופי.
- אם השאלה רפואית אישית, הפנה לבדיקה במרפאה.
- אם מבקשים נציג, כתוב שנציג מהמרפאה יחזור בהקדם.

שאלת המשתמש:
${msg}
        `,
      }),
    });

    const data = await aiResponse.json();
    const reply =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
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
    console.error("Webhook error:", error);
    return res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
