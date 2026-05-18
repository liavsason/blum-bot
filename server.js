require("dotenv").config();

const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();

app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// VERIFY WEBHOOK
app.get("/webhook", (req, res) => {
  const verify_token = "blum_verify_token";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === verify_token) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// RECEIVE WHATSAPP MESSAGES
app.post("/webhook", async (req, res) => {
  console.log("Webhook POST received");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || message.type !== "text") {
      console.log("No real text message found");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text.body;

    console.log("from:", from);
    console.log("text:", text);

    // SEND MESSAGE TO OPENAI
    const openaiResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: text,
    });

    const reply =
      openaiResponse.output[0].content[0].text;

    console.log("AI reply:", reply);

    // SEND RESPONSE TO WHATSAPP
    const whatsappResponse = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: reply,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      "WhatsApp send response:",
      whatsappResponse.data
    );

    return res.sendStatus(200);
  } catch (error) {
    console.error(
      "Error:",
      error.response?.data || error.message
    );

    return res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
