import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const OPENAI_KEY = "PUT_OPENAI_KEY_HERE";
const WHATSAPP_TOKEN = "PUT_META_TOKEN_HERE";
const PHONE_ID = "PUT_PHONE_ID_HERE";

app.post("/webhook", async (req, res) => {
  const msg =
    req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;

  if (!msg) return res.sendStatus(200);

  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: `
אתה עוזר של מרפאת בלום.
ענה קצר, מקצועי ונעים.
אל תיתן ייעוץ רפואי.

שאלה: ${msg}
`,
    }),
  });

  const data = await ai.json();
  const reply = data.output[0].content[0].text;

  await fetch(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: req.body.entry[0].changes[0].value.messages[0].from,
        text: { body: reply },
      }),
    }
  );

  res.sendStatus(200);
});

app.listen(3000);
