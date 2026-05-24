import express from "express";
import { getLeadByPhone, upsertLead } from "./memory.js";

const app = express();
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE;
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
  return (
    /05\d[-\s]?\d{7}|9725\d{8}/.test(text) ||
    /\b\d{8,9}\b/.test(text) ||
    /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text)
  );
}

function extractUserDetails(text = "") {
  const details = {};

  const phoneMatch = text.match(/05\d[-\s]?\d{7}|9725\d{8}/);
  if (phoneMatch) details.contact_phone = phoneMatch[0];

  const idMatch = text.match(/\b\d{8,9}\b/);
  if (idMatch) details.id_number = idMatch[0];

  const dateMatch = text.match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/);
  if (dateMatch) details.birth_date = dateMatch[0];

  const namePatterns = [
    /קוראים לי\s+([א-תa-zA-Z׳״'\- ]{2,30})(?=\s+(?:ואני|ורוצה|רוצה|מעוניין|מעוניינת|צריך|צריכה|מבקש|מבקשת)|$|,|\.|!|\?)/i,
    /שמי\s+([א-תa-zA-Z׳״'\- ]{2,30})(?=\s+(?:ואני|ורוצה|רוצה|מעוניין|מעוניינת|צריך|צריכה|מבקש|מבקשת)|$|,|\.|!|\?)/i,
    /השם שלי\s+([א-תa-zA-Z׳״'\- ]{2,30})(?=\s+(?:ואני|ורוצה|רוצה|מעוניין|מעוניינת|צריך|צריכה|מבקש|מבקשת)|$|,|\.|!|\?)/i,
    /אני\s+([א-תa-zA-Z׳״'\- ]{2,20})(?=\s+(?:ואני|ורוצה|רוצה|מעוניין|מעוניינת|צריך|צריכה|מבקש|מבקשת)|$|,|\.|!|\?)/i,
    /меня зовут\s+([а-яА-Яa-zA-ZёЁ\- ]{2,30})(?=\s|$|,|\.|!|\?)/i,
  ];

  const blockedNames = [
    "רוצה",
    "רוצה לקבוע",
    "רוצה לקבוע תור",
    "צריך",
    "צריכה",
    "מעוניין",
    "מעוניינת",
    "מבקש",
    "מבקשת",
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const possibleName = match[1].trim();
      if (!blockedNames.includes(possibleName)) {
        details.name = possibleName;
        break;
      }
    }
  }

  return details;
}

function detectTreatment(text = "", existingLead = null) {
  const t = text.toLowerCase();

  if (t.includes("שיננית") || t.includes("ניקוי")) {
    return { treatment: "שיננית", status: "asked_about_hygienist" };
  }

  if (t.includes("הלבנה")) {
    return { treatment: "הלבנת שיניים", status: "asked_about_whitening" };
  }

  if (t.includes("יישור") || t.includes("גשר") || t.includes("אורתודונט")) {
    return { treatment: "יישור שיניים", status: "asked_about_ortho" };
  }

  if (t.includes("אסתטיקה") || t.includes("בוטוקס") || t.includes("חומצה")) {
    return { treatment: "אסתטיקה", status: "asked_about_aesthetic" };
  }

  if (t.includes("geneo") || t.includes("ג׳נאו") || t.includes("ג'נאו")) {
    return { treatment: "GeneO+", status: "asked_about_geneo" };
  }

  if (t.includes("רג׳ורן") || t.includes("רג'ורן") || t.includes("זרע סלמון")) {
    return { treatment: "רג׳ורן", status: "asked_about_rejuran" };
  }

  if (t.includes("תור") || t.includes("לקבוע") || t.includes("ייעוץ") || t.includes("פגישה")) {
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

function buildLeadSummary({ from, existingLead, extractedDetails, detected, text }) {
  const name = extractedDetails.name || existingLead?.name || "לא נמסר";
  const birthDate = extractedDetails.birth_date || existingLead?.birth_date || "לא נמסר";
  const idNumber = extractedDetails.id_number || existingLead?.id_number || "לא נמסר";
  const treatment = detected.treatment || existingLead?.treatment || "לא ידוע";
  const branch = existingLead?.branch || "לא נמסר";
  const status = detected.status || existingLead?.status || "new";

  return `שם: ${name}
טלפון וואטסאפ: ${from}
טיפול: ${treatment}
סניף מועדף: ${branch}
תאריך לידה: ${birthDate}
תעודת זהות: ${idNumber}
סטטוס: ${status}
הודעה אחרונה: ${text}`;
}

async function notifyAdmin(summary) {
  if (!ADMIN_PHONE) {
    console.log("ADMIN_PHONE is missing");
    return;
  }

  await sendWhatsAppMessage(
    ADMIN_PHONE,
    `📌 פנייה חדשה מהבוט

${summary}`
  );

  console.log("Admin notification sent");
}

const clinicKnowledge = `
שם המרפאה: מרפאת בלום
טלפון: 054-234-4742
אימייל: mail@blumplus.com
שפות: עברית ורוסית

רופאים:
ד״ר מייקל בלום – מומחה ליישור שיניים ואורתודונטיה
ד״ר מרינה בלום – מומחית לרפואה אסתטית

שעות פעילות:
ראשון עד חמישי 10:00–18:00
שישי ושבת סגור

כתובת:
יהושוע רבינוביץ 58 חולון
מרכז מסחרי דר גת קומה 1
חניה תת קרקעית ללא עלות

סניפים:
חולון, כרמי יוסף

שיננית:
מבוגר מעל גיל 18 – 280 ₪
ילדים עד גיל 18 – 210 ₪
חיילים בסדיר – 210 ₪

ייעוץ אצל ד״ר מייקל בלום:
250 ₪, מתקזז מעלות הטיפול אם ממשיכים

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
לא לקבוע תורים
לא לאשר יום או שעה לתור
לא לתת המלצה רפואית אישית
אם יש מצב דחוף להפנות לטלפון המרפאה
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

    if (text.trim() === "#עצור") {
      await upsertLead({
        phone: from,
        human_takeover: "true",
        status: "human_handling",
        last_message: text,
      });

      return res.sendStatus(200);
    }

    if (text.trim() === "#בוט") {
      await upsertLead({
        phone: from,
        human_takeover: "false",
        status: "bot_active",
        last_message: text,
      });

      return res.sendStatus(200);
    }

    const existingLead = await getLeadByPhone(from);

    if (existingLead?.human_takeover === "true") {
      console.log("Human takeover active");
      return res.sendStatus(200);
    }

    const detected = detectTreatment(text, existingLead);
    const extractedDetails = extractUserDetails(text);

    const leadSummary = buildLeadSummary({
      from,
      existingLead,
      extractedDetails,
      detected,
      text,
    });

    if (isHumanRequest(text)) {
      await upsertLead({
        phone: from,
        name: extractedDetails.name,
        birth_date: extractedDetails.birth_date,
        id_number: extractedDetails.id_number,
        treatment: detected.treatment,
        status: "waiting_for_human",
        human_takeover: "true",
        last_message: text,
        lead_summary: leadSummary,
        notified: "sent",
      });

      await notifyAdmin(leadSummary);

      await sendWhatsAppMessage(
        from,
        "בשמחה 😊 הפנייה הועברה לצוות המרפאה ונציג יחזור אליך בהקדם."
      );

      return res.sendStatus(200);
    }

    if (hasPersonalDetails(text) && existingLead?.status === "wants_appointment") {
      await upsertLead({
        phone: from,
        name: extractedDetails.name,
        birth_date: extractedDetails.birth_date,
        id_number: extractedDetails.id_number,
        treatment: detected.treatment || existingLead?.treatment || "",
        status: "details_collected",
        human_takeover: "true",
        last_message: text,
        lead_summary: leadSummary,
        notified: "sent",
      });

      await notifyAdmin(leadSummary);

      await sendWhatsAppMessage(
        from,
        "תודה 😊 הפרטים התקבלו והועברו למזכירות המרפאה. נציג יחזור אליכם בהקדם עם אפשרויות זמינות לתיאום."
      );

      return res.sendStatus(200);
    }

    await upsertLead({
      phone: from,
      name: extractedDetails.name,
      birth_date: extractedDetails.birth_date,
      id_number: extractedDetails.id_number,
      treatment: detected.treatment,
      status: detected.status,
      human_takeover: existingLead?.human_takeover || "false",
      last_message: text,
      lead_summary: leadSummary,
    });

    const memoryContext = `
מידע קודם:
שם: ${extractedDetails.name || existingLead?.name || "לא נמסר"}
טלפון: ${from}
טיפול שמור: ${detected.treatment || existingLead?.treatment || "לא ידוע"}
סטטוס: ${detected.status || existingLead?.status || "new"}
הודעה קודמת: ${existingLead?.last_message || "אין"}

סיכום לנציג:
${leadSummary}

היסטוריית שיחה:
${existingLead?.conversation_history || "אין"}

הודעה נוכחית:
${text}
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

הוראות:

אם יש טיפול שמור, תמשיך לפי אותו טיפול.
אל תשאל שוב שאלה שכבר קיבלת עליה תשובה.
אם המשתמש אמר את השם שלו, השתמש בשם שלו בתשובות.
אם המשתמש שואל על מה דיברנו, תענה לפי הזיכרון והיסטוריית השיחה.

אם המשתמש רוצה לקבוע תור:
אסור לך לקבוע תור בפועל.
אסור לך לאשר יום או שעה.
התפקיד שלך הוא רק לאסוף פרטים ולהעביר לנציג אנושי.

אם חסרים פרטים, בקש:
- שם מלא
- מספר טלפון
- תעודת זהות
- תאריך לידה

לאחר שהמשתמש מסר את כל הפרטים, ענה:
"תודה 😊 הפרטים התקבלו והועברו למזכירות המרפאה. נציג יחזור אליכם בהקדם עם אפשרויות זמינות לתיאום."

גם אם המשתמש כותב יום או שעה שנוחים לו:
אל תאשר תור.
רק תגיד שהמידע הועבר לנציג לצורך תיאום.

אם המשתמש מבקש נציג אנושי:
תגיד שהפנייה הועברה לצוות המרפאה ונציג יחזור אליו בהקדם.

אם מדובר בייעוץ אורתודונטי:
ציין שהייעוץ עולה 250 ₪ ומתקזז מעלות הטיפול במידה וממשיכים.

אם מדובר באסתטיקה:
ציין שהייעוץ ללא עלות ושאל איזה סניף נוח למטופל.

ענה תמיד באותה שפה של המשתמש.

סגנון התשובות:
- טבעי
- קצר
- אנושי
- מקצועי
- נעים ומרגיע

אל תכתוב "מחלקה".
אל תמציא מידע שלא קיים במאגר הידע.
אם אין לך מידע בטוח — תגיד שתבדוק מול צוות המרפאה.

מאגר מידע:
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
        text: { body },
      }),
    }
  );

  const waData = await waRes.json();
  console.log("WhatsApp send response:", JSON.stringify(waData, null, 2));
}

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
