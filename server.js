import express from "express";
import { getLeadByPhone, upsertLead } from "./memory.js";

const app = express();
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "12345";

function detectTreatment(text = "", existingLead = null) {
  const t = text.toLowerCase();

  if (t.includes("שיננית") || t.includes("ניקוי") || t.includes("hygienist")) {
    return { treatment: "שיננית", status: "asked_about_hygienist" };
  }

  if (t.includes("הלבנה") || t.includes("הלבנת")) {
    return { treatment: "הלבנת שיניים", status: "asked_about_whitening" };
  }

  if (t.includes("גשר") || t.includes("יישור") || t.includes("אורתודונט")) {
    return { treatment: "יישור שיניים", status: "asked_about_ortho" };
  }

  if (t.includes("geneo") || t.includes("ג׳נאו") || t.includes("ג'נאו")) {
    return { treatment: "GeneO+", status: "asked_about_geneo" };
  }

  if (t.includes("רג׳ורן") || t.includes("רג'ורן") || t.includes("זרע סלמון")) {
    return { treatment: "רג׳ורן", status: "asked_about_rejuran" };
  }

  if (t.includes("אסתטיקה") || t.includes("בוטוקס") || t.includes("חומצה")) {
    return { treatment: "אסתטיקה", status: "asked_about_aesthetic" };
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

שפות: עברית ורוסית

רופאים:
ד״ר מייקל בלום – מומחה ליישור שיניים ואורתודונטיה
ד״ר מרינה בלום – מומחית לרפואה אסתטית ואסתטיקת הפנים

שעות פעילות:
ראשון עד חמישי: 10:00–18:00
שישי ושבת: סגור

כתובת:
יהושוע רבינוביץ 58, חולון
מרכז מסחרי דר גת, קומה 1 במעלית
חניה תת קרקעית ללא עלות למטופלי המרפאה
Waze: https://waze.com/ul/hsv8wp2cnw

סניפים:
חולון, מודיעין, מושב כרמי יוסף

שיננית:
מבוגר מעל גיל 18 – 280 ₪
ילד עד גיל 18 – 210 ₪
חיילים בשירות סדיר – 210 ₪

ייעוץ אורתודונטי:
ייעוץ אצל ד״ר מייקל בלום
עלות ייעוץ: 250 ₪
העלות מתקזזת מעלות הטיפול אם מתחילים טיפול

ייעוץ אסתטיקה:
ייעוץ ללא עלות אצל ד״ר מרינה בלום
אפשר להגיע לחולון, מודיעין או כרמי יוסף

הלבנת שיניים:
הלבנה ביתית עם פלטות שקופות אישיות
משך הטיפול כשבועיים
לפני התחלת התהליך יש לבצע שיננית
עלות: 1,800 ₪

GeneO+:
טיפול בודד: 650 ₪
6 טיפולים: 3,250 ₪
4 טיפולים: 2,400 ₪ + מסכת חומצה היאלורונית במתנה

רג׳ורן / זרע סלמון:
סדרה של 3 טיפולים בהפרש של כ־4 שבועות
עלות סדרה: 5,400 ₪

חוקים:
לא לאבחן מצב רפואי
לא להבטיח תוצאות
לא לתת המלצה רפואית אישית
לא לקבוע טיפול בפועל
אם יש כאב, נפיחות, דימום, שבר או מצב דחוף — להפנות לטלפון 054-234-4742
אם חסר מידע — לומר שנציג מהמרפאה יחזור
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

    const existingLead = await getLeadByPhone(from);

    if (existingLead?.human_takeover === "true") {
      console.log("Human takeover active, bot will not reply");
      return res.sendStatus(200);
    }

    const detected = detectTreatment(text, existingLead);

    await upsertLead({
      phone: from,
      treatment: detected.treatment,
      status: detected.status,
      last_message: text,
      human_takeover: existingLead?.human_takeover || "false",
    });

    const memoryContext = `
מידע קודם על המטופל:
טלפון: ${from}
טיפול שמור: ${detected.treatment || existingLead?.treatment || "לא ידוע"}
סטטוס שיחה: ${detected.status || existingLead?.status || "new"}
הודעה קודמת: ${existingLead?.last_message || "אין"}
הודעה נוכחית: ${text}
`;

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

${memoryContext}

חשוב מאוד:
אם יש טיפול שמור, תתייחס אליו כהקשר המרכזי של השיחה.
אם המטופל שואל "על איזה טיפול דיברנו" או "אתה זוכר" — תענה לפי הטיפול השמור.
אם המטופל כבר דיבר על שיננית ואז מבקש תור — אל תשאל שוב באיזה טיפול מדובר, אלא תמשיך לגבי שיננית.
אם המטופל רוצה לקבוע תור לשיננית — בקש שם מלא ומספר טלפון, ואמור שנציג יחזור לתיאום.
אם המטופל רוצה ייעוץ אורתודונטי — קודם הסבר שהייעוץ אצל ד״ר מייקל בלום עולה 250 ₪ ומתקזז מהטיפול.
אם המטופל רוצה אסתטיקה — הסבר שהייעוץ אצל ד״ר מרינה בלום ללא עלות ושאל איזה סניף נוח לו.

ענה לפי שפת המשתמש:
עברית בעברית.
רוסית ברוסית.

סגנון:
טבעי, קצר, מקצועי ונעים.
אל תכתוב "מחלקה".
אל תמציא מידע.
אל תאבחן.
אל תבטיח תוצאות.

מאגר הידע:
${clinicKnowledge}

הודעת המשתמש:
${text}
        `,
      }),
    });

    const aiData = await aiRes.json();

    const reply =
      aiData.output?.[0]?.content?.[0]?.text ||
      aiData.output_text ||
      "שלום 🌷 כדי לתת מענה מדויק, מומלץ ליצור קשר ישירות עם מרפאת בלום בטלפון 054-234-4742.";

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
          to: from,
          text: {
            body: reply,
          },
        }),
      }
    );

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
