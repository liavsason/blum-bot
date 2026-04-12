import express from "express";

const app = express();

// חשוב! middleware בסיסי
app.use((req, res, next) => {
  console.log("Incoming request:", req.method, req.url);
  next();
});

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// תופס כל דבר שלא קיים
app.all("*", (req, res) => {
  res.status(200).send("OK fallback");
});

const PORT = process.env.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on ${PORT}`);
});
