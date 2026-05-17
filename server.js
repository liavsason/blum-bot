import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "12345";

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.status(403).send("Wrong verify token");
});

app.post("/webhook", (req, res) => {
  console.log("Webhook POST received");
  res.sendStatus(200);
});

app.use((req, res) => {
  res.status(404).send("Not found");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
