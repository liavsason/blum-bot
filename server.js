import express from "express";

const app = express();
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "12345";

app.get("/", (req, res) => {
  res.send("OK");
});

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

app.post("/webhook", async (req, res) => {
  console.log("Webhook POST received");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") {
      console.log("No real text message found");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("from:", from);
    console.log("text:", text);

    const aiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `
אתה העוזר הדיגיטלי של מרפאת בלום.

ענה בעברית בלבד.
ענה קצר, טבעי, מקצועי ונעים.
אל תקבע תורים.
אל תיתן אבחנה רפואית.
אל תיתן המלצה רפואית אישית.
אל תיתן מחיר סופי.
אם שואלים על מחיר, תגיד שמחיר מדויק ניתן לאחר בדיקה או ייעוץ.
אם שואלים שאלה רפואית אישית, הפנה לבדיקה במרפאה.
אם מבקשים נציג או מזכירה, תגיד שנציג מהמרפאה יחזור בהקדם.

שאלת המטופל:
${text}
        `,
      }),
    });

    const aiData = await aiRes.json();
    console.log("OpenAI response:", JSON.stringify(aiData, null, 2));

    const reply =
      aiData.output_text ||
      "שלום 🌷 כדי לתת מענה מדויק, מומלץ ליצור קשר ישירות עם מרפאת בלום.";

    const waRes = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: reply,
        },
      }),
    });

    const waData = await waRes.json();
    console.log("WhatsApp send response:", JSON.stringify(waData, null, 2));

    return res.sendStatus(200);
  } catch (error) {
    console.error("ERROR:", error);
    return res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
