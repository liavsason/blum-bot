import express from "express";
import { getLeadByPhone, upsertLead } from "./memory.js";

const app = express();
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "12345";

function isHumanRequest(text = "") {
  const t = text.toLowerCase();

  return (
    t.includes("נציג") ||
    t.includes("מזכירה") ||
    t.includes("בן אדם") ||
    t.includes("לדבר עם מישהו") ||
    t.includes("שיחזרו אליי") ||
    t.includes("שיחזרו אלי") ||
    t.includes("оператор") ||
    t.includes("администратор") ||
    t.includes("человек")
  );
}

function hasPersonalDetails(text = "") {
  const hasPhone = /05\d[-\s]?\d{7}|9725\d{8}/.test(text);
  const hasId = /\b\d{8,9}\b/.test(text);
  const hasDate = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text);

  return hasPhone || hasId || hasDate;
}

function detectTreatment(text = "", existingLead = null) {
  const t = text.toLowerCase();

  if (t.includes("שיננית") || t.includes("ניקוי")) {
    return {
      treatment: "שיננית",
      status: "asked_about_hygienist",
    };
  }

  if (t.includes("הלבנה")) {
    return {
      treatment: "הלבנת שיניים",
      status: "asked_about_whitening",
    };
  }

  if (
    t.includes("יישור") ||
    t.includes("גשר") ||
    t.includes("אורתודונט")
  ) {
    return {
      treatment: "יישור שיניים",
      status: "asked_about_ortho",
    };
  }

  if (
    t.includes("אסתטיקה") ||
    t.includes("בוטוקס") ||
    t.includes("חומצה")
  ) {
    return {
      treatment: "אסתטיקה",
      status: "asked_about_aesthetic",
    };
  }

  if (
    t.includes("geneo") ||
    t.includes("ג׳נאו") ||
    t.includes("ג'נאו")
  ) {
    return {
      treatment: "GeneO+",
      status: "asked_about_geneo",
    };
  }

  if (
    t.includes("רג׳ורן") ||
    t.includes("רג'ורן") ||
    t.includes("זרע סלמון")
  ) {
    return {
      treatment: "רג׳ורן",
      status: "asked_about_rejuran",
    };
  }

  if (
    t.includes("תור") ||
    t.includes("לקבוע") ||
    t.includes("ייעוץ") ||
    t.includes("פגישה")
  ) {
    return {
      treatment: existingLead?.treatment || "",
      status: "wants_appointment",
    };
  }

  return {
    treatment: existingLead?.treatment || "",
    status: existingLead?.status || "new",
  };
}

const clinicKnowledge = `
שם המרפאה: מרפאת בלום

טלפון: 054-234-4742
אימייל: mail@blumplus.com

שפות:
עברית ורוסית

רופאים:
ד״ר מייקל בלום – מומחה ליישור שיניים ואורתודונטיה
ד״ר מרינה בלום – מומחית לרפואה אסתטית

שעות פעילות:
ראשון עד חמישי 10:00–18:00
שישי ושבת סגור

כתובת:
יהושוע רבינוביץ 58 חולון
מרכז מסחרי דר גת קומה 1

סניפים:
חולון
מודיעין
כרמי יוסף

שיננית:
מבוגר מעל גיל 18 – 280 ₪
ילדים עד גיל 18 – 210 ₪
חיילים בסדיר – 210 ₪

ייעוץ אצל ד״ר מייקל בלום:
250 ₪
מתקזז מעלות הטיפול אם ממשיכים

ייעוץ אסתטיקה אצל ד״ר מרינה בלום:
ללא עלות

GeneO+:
טיפול בודד – 650 ₪
4 טיפולים – 2,400 ₪
6 טיפולים – 3,250 ₪

רג׳ורן:
3 טיפולים – 5,400 ₪

הלבנת שיניים:
1,800 ₪
נדרש לבצע שיננית לפני

חוקים:
לא לאבחן רפואית
לא להבטיח תוצאות
לא לתת המלצה רפואית אישית
`;

app.get("/", (req, res) => {
  res.send("OK");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body || "";

    // עצירת בוט
    if (text.trim() === "#עצור") {

      await upsertLead({
        phone: from,
        human_takeover: "true",
        status: "human_handling",
        last_message: text,
      });

      console.log("Bot stopped for:", from);

      return res.sendStatus(200);
    }

    // החזרת בוט
    if (text.trim() === "#בוט") {

      await upsertLead({
        phone: from,
        human_takeover: "false",
        status: "bot_active",
        last_message: text,
      });

      console.log("Bot resumed for:", from);

      return res.sendStatus(200);
    }

    const existingLead = await getLeadByPhone(from);

    // אם נציג אנושי השתלט
    if (existingLead?.human_takeover === "true") {
      console.log("Human takeover active");

      return res.sendStatus(200);
    }

    const detected = detectTreatment(text, existingLead);

    // בקשה לנציג
    if (isHumanRequest(text)) {

      await upsertLead({
        phone: from,
        treatment: detected.treatment,
        status: "waiting_for_human",
        human_takeover: "true",
        last_message: text,
      });

      await sendWhatsAppMessage(
        from,
        "בשמחה 😊 הפנייה הועברה לצוות המרפאה ונציג יחזור אליך בהקדם."
      );

      return res.sendStatus(200);
    }

    // אם נשלחו פרטים לקביעת תור
    if (
      hasPersonalDetails(text) &&
      existingLead?.status === "wants_appointment"
    ) {

      await upsertLead({
        phone: from,
        treatment:
          detected.treatment || existingLead?.treatment || "",
        status: "waiting_for_human",
        human_takeover: "true",
        last_message: text,
      });

      await sendWhatsAppMessage(
        from,
        "תודה 😊 הפרטים התקבלו והועברו למזכירות המרפאה. נחזור אליכם בהקדם עם אפשרויות לתיאום."
      );

      return res.sendStatus(200);
    }

    // שמירת זיכרון
    await upsertLead({
      phone: from,
      treatment: detected.treatment,
      status: detected.status,
      human_takeover:
        existingLead?.human_takeover || "false",
      last_message: text,
    });

    const memoryContext = `
מידע קודם:

טלפון:
${from}

טיפול שמור:
${detected.treatment || existingLead?.treatment || "לא ידוע"}

סטטוס:
${detected.status || existingLead?.status || "new"}

הודעה קודמת:
${existingLead?.last_message || "אין"}

הודעה נוכחית:
${text}
`;

    const aiRes = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: `
אתה העוזר הדיגיטלי של מרפאת בלום.

${memoryContext}

הוראות חשובות:

אם יש טיפול שמור בזיכרון:
תמשיך את השיחה לפי אותו טיפול.
אל תשאל שוב "באיזה טיפול מדובר".

אם המטופל שואל:
"על מה דיברנו?"
או
"אתה זוכר?"
תענה לפי הזיכרון.

אם מדובר בשיננית:
אפשר להציע קביעת תור.

אם המטופל רוצה לקבוע תור לשיננית:
בקש:
שם מלא
ומספר טלפון.

אם מדובר בייעוץ אורתודונטי:
תגיד:
ייעוץ אצל ד״ר מייקל בלום עולה 250 ₪
ומתקזז מהטיפול.

אם מדובר באסתטיקה:
תגיד שהייעוץ ללא עלות
ושאל איזה סניף נוח.

אם המטופל מבקש נציג:
תגיד שהפנייה מועברת למזכירות.

ענה באותה שפה של המשתמש:
עברית בעברית
רוסית ברוסית

סגנון:
טבעי
קצר
אנושי
מקצועי

אל תכתוב:
"מחלקה"

אל תמציא מידע.

מאגר מידע:
${clinicKnowledge}

הודעת המשתמש:
${text}
          `,
        }),
      }
    );

    const aiData = await aiRes.json();

    const reply =
      aiData.output?.[0]?.content?.[0]?.text ||
      aiData.output_text ||
      "שלום 😊 איך אפשר לעזור?";

    await sendWhatsAppMessage(from, reply);

    return res.sendStatus(200);

  } catch (error) {
    console.error("ERROR:", error);

    return res.sendStatus(200);
  }
});

async function sendWhatsAppMessage(to, body) {

  const waRes = await fetch(
    `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: {
          body,
        },
      }),
    }
  );

  const waData = await waRes.json();

  console.log(
    "WhatsApp send response:",
    JSON.stringify(waData, null, 2)
  );
}

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
