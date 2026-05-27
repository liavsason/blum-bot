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
    t.includes("админ") ||
    t.includes("человек") ||
    t.includes("живой человек") ||
    t.includes("связаться") ||
    t.includes("перезвон") ||
    t.includes("позвон")
  );
}

function isRussian(text = "") {
  return /[а-яА-ЯёЁ]/.test(text);
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
    /меня зовут\s+([а-яА-Яa-zA-ZёЁ\- ]{2,30})(?=\s|$|,|\.|!|\?)/i,
    /мое имя\s+([а-яА-Яa-zA-ZёЁ\- ]{2,30})(?=\s|$|,|\.|!|\?)/i,
    /моё имя\s+([а-яА-Яa-zA-ZёЁ\- ]{2,30})(?=\s|$|,|\.|!|\?)/i,
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
    "хочу",
    "записаться",
    "прием",
    "приём",
    "консультация",
    "чистка",
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

function getIsraelDateTime() {
  return new Date().toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPriority(status) {
  if (
    status === "waiting_for_human" ||
    status === "details_collected"
  ) {
    return "🔴 חם";
  }

  if (status === "wants_appointment") {
    return "🟡 בינוני";
  }

  return "🟢 רגיל";
}

function canNotifyAgain(lastNotifiedAt) {
  if (!lastNotifiedAt) return true;

  let lastTime = new Date(lastNotifiedAt).getTime();

  if (Number.isNaN(lastTime)) {
    const match = String(lastNotifiedAt).match(
      /(\d{1,2})[./](\d{1,2})[./](\d{4}).*?(\d{1,2}):(\d{2})/
    );

    if (match) {
      const [, day, month, year, hour, minute] = match;

      lastTime = new Date(
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00+03:00`
      ).getTime();
    }
  }

  if (Number.isNaN(lastTime)) return true;

  const fiveMinutes = 5 * 60 * 1000;

  return Date.now() - lastTime >= fiveMinutes;
}

function detectBranch(text = "", existingLead = null) {
  const t = text.toLowerCase();

  if (
    t.includes("חולון") ||
    t.includes("холон")
  ) {
    return "חולון";
  }

  if (
    t.includes("כרמי יוסף") ||
    t.includes("כרמי") ||
    t.includes("кармей йосеф") ||
    t.includes("карми йосеф") ||
    t.includes("кармей") ||
    t.includes("карми")
  ) {
    return "כרמי יוסף";
  }

  return existingLead?.branch || "";
}

function detectTreatment(text = "", existingLead = null) {
  const t = text.toLowerCase();

  if (
    t.includes("שיננית") ||
    t.includes("ניקוי") ||
    t.includes("чистка") ||
    t.includes("гигиена") ||
    t.includes("гигиенист") ||
    t.includes("профгигиена") ||
    t.includes("снятие камня") ||
    t.includes("чистка зубов")
  ) {
    return {
      treatment: "שיננית",
      status: "asked_about_hygienist",
    };
  }

  if (
    t.includes("הלבנה") ||
    t.includes("הלבנת") ||
    t.includes("הלבנת שיניים") ||
    t.includes("להלבין") ||
    t.includes("whitening") ||
    t.includes("отбел") ||
    t.includes("отбеливание") ||
    t.includes("отбелить") ||
    t.includes("осветлить") ||
    t.includes("белые зубы")
  ) {
    return {
      treatment: "הלבנת שיניים",
      status: "asked_about_whitening",
    };
  }

  if (
    t.includes("יישור") ||
    t.includes("גשר") ||
    t.includes("אורתודונט") ||
    t.includes("брекет") ||
    t.includes("ортодонт") ||
    t.includes("элайнер") ||
    t.includes("исправление прикуса") ||
    t.includes("выравнивание зубов")
  ) {
    return {
      treatment: "יישור שיניים",
      status: "asked_about_ortho",
    };
  }

  if (
    t.includes("אסתטיקה") ||
    t.includes("בוטוקס") ||
    t.includes("חומצה") ||
    t.includes("ботокс") ||
    t.includes("эстет") ||
    t.includes("губы") ||
    t.includes("филлер") ||
    t.includes("гиалурон") ||
    t.includes("кислота") ||
    t.includes("морщин")
  ) {
    return {
      treatment: "אסתטיקה",
      status: "asked_about_aesthetic",
    };
  }

  if (
    t.includes("geneo") ||
    t.includes("ג׳נאו") ||
    t.includes("ג'נאו") ||
    t.includes("дженео")
  ) {
    return {
      treatment: "GeneO+",
      status: "asked_about_geneo",
    };
  }

  if (
    t.includes("רג׳ורן") ||
    t.includes("רג'ורן") ||
    t.includes("זרע סלמון") ||
    t.includes("rejuran") ||
    t.includes("реджуран")
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
    t.includes("פגישה") ||
    t.includes("запис") ||
    t.includes("записаться") ||
    t.includes("консультац") ||
    t.includes("встреча") ||
    t.includes("прием") ||
    t.includes("приём") ||
    t.includes("стоматолог") ||
    t.includes("врач")
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

function buildLeadSummary({
  from,
  existingLead,
  extractedDetails,
  detected,
  detectedBranch,
  text,
}) {
  const name =
    extractedDetails.name ||
    existingLead?.name ||
    "לא נמסר";

  const birthDate =
    extractedDetails.birth_date ||
    existingLead?.birth_date ||
    "לא נמסר";

  const idNumber =
    extractedDetails.id_number ||
    existingLead?.id_number ||
    "לא נמסר";

  const treatment =
    detected.treatment ||
    existingLead?.treatment ||
    "לא ידוע";

  const branch =
    detectedBranch ||
    existingLead?.branch ||
    "לא נמסר";

  const status =
    detected.status ||
    existingLead?.status ||
    "new";

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
  try {
    if (!ADMIN_PHONE) {
      console.log("ADMIN_PHONE missing");
      return false;
    }

    console.log("Sending admin notification to:", ADMIN_PHONE);

    const result = await sendWhatsAppMessage(
      ADMIN_PHONE,
      `📌 פנייה חדשה מהבוט

${summary}`
    );

    console.log(
      "Admin notification result:",
      JSON.stringify(result, null, 2)
    );

    if (
      result?.error ||
      !result?.messages ||
      !result?.messages?.[0]?.id
    ) {
      console.log("Admin notification failed");
      return false;
    }

    console.log("Admin notification sent successfully");
    return true;
  } catch (err) {
    console.log("notifyAdmin crash:", err);
    return false;
  }
}

const clinicKnowledge = `
שם המרפאה: מרפאת בלום
שפות: עברית ורוסית

סניפים:
חולון
כרמי יוסף

По-русски:
Холон
Кармей Йосеф

שיננית:
מבוגר מעל גיל 18 – 280 ₪
ילדים עד גיל 18 – 210 ₪
חיילים בסדיר – 210 ₪

ייעוץ אורתודונטי:
250 ₪
מתקזז מעלות הטיפול אם ממשיכים

ייעוץ אסתטיקה:
ללא עלות

GeneO+:
טיפול בודד – 650 ₪
4 טיפולים – 2400 ₪
6 טיפולים – 3250 ₪

רג׳ורן:
3 טיפולים – 5400 ₪

הלבנת שיניים:
1800 ₪
נדרש לבצע שיננית לפני

אסור לקבוע תורים.
`;

app.get("/", (req, res) => {
  res.send("OK");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === VERIFY_TOKEN
  ) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const value =
      req.body.entry?.[0]?.changes?.[0]?.value;

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
        priority: getPriority("human_handling"),
      });

      return res.sendStatus(200);
    }

    if (text.trim() === "#בוט") {
      await upsertLead({
        phone: from,
        human_takeover: "false",
        status: "bot_active",
        last_message: text,
        priority: getPriority("bot_active"),
      });

      return res.sendStatus(200);
    }

    const existingLead =
      await getLeadByPhone(from);

    if (
      existingLead?.human_takeover === "true"
    ) {
      const shouldNotifyHumanTakeover =
        canNotifyAgain(existingLead?.last_notified_at);

      let adminNotified = false;

      const takeoverDetected =
        detectTreatment(text, existingLead);

      const takeoverExtractedDetails =
        extractUserDetails(text);

      const takeoverDetectedBranch =
        detectBranch(text, existingLead);

      const humanTakeoverSummary = `שם: ${takeoverExtractedDetails.name || existingLead?.name || "לא נמסר"}
טלפון וואטסאפ: ${from}
טיפול: ${takeoverDetected.treatment || existingLead?.treatment || "לא ידוע"}
סניף מועדף: ${takeoverDetectedBranch || existingLead?.branch || "לא נמסר"}
תאריך לידה: ${takeoverExtractedDetails.birth_date || existingLead?.birth_date || "לא נמסר"}
תעודת זהות: ${takeoverExtractedDetails.id_number || existingLead?.id_number || "לא נמסר"}
סטטוס: ${takeoverDetected.status || existingLead?.status || "human_handling"}
הודעה אחרונה: ${text}`;

      if (shouldNotifyHumanTakeover) {
        adminNotified =
          await notifyAdmin(humanTakeoverSummary);
      }

      await upsertLead({
        phone: from,
        name: takeoverExtractedDetails.name,
        birth_date: takeoverExtractedDetails.birth_date,
        id_number: takeoverExtractedDetails.id_number,
        treatment: takeoverDetected.treatment,
        branch: takeoverDetectedBranch,
        status: takeoverDetected.status || existingLead?.status || "human_handling",
        human_takeover: "true",
        last_message: text,
        lead_summary: humanTakeoverSummary,
        notified: shouldNotifyHumanTakeover
          ? adminNotified
            ? "✅ sent"
            : "❌ failed"
          : existingLead?.notified || "",
        last_notified_at: adminNotified
          ? getIsraelDateTime()
          : existingLead?.last_notified_at || "",
        priority: getPriority(
          takeoverDetected.status || existingLead?.status || "human_handling"
        ),
      });

      return res.sendStatus(200);
    }

    const detected =
      detectTreatment(text, existingLead);

    const extractedDetails =
      extractUserDetails(text);

    const detectedBranch =
      detectBranch(text, existingLead);

    const leadSummary = buildLeadSummary({
      from,
      existingLead,
      extractedDetails,
      detected,
      detectedBranch,
      text,
    });

    if (isHumanRequest(text)) {
      const shouldNotifyHumanRequest =
        canNotifyAgain(existingLead?.last_notified_at);

      let adminNotified = false;

      if (shouldNotifyHumanRequest) {
        adminNotified =
          await notifyAdmin(leadSummary);
      }

      await upsertLead({
        phone: from,
        name: extractedDetails.name,
        birth_date: extractedDetails.birth_date,
        id_number: extractedDetails.id_number,
        treatment: detected.treatment,
        branch: detectedBranch,
        status: "waiting_for_human",
        human_takeover: "true",
        last_message: text,
        lead_summary: leadSummary,
        notified: shouldNotifyHumanRequest
          ? adminNotified
            ? "✅ sent"
            : "❌ failed"
          : existingLead?.notified || "",
        last_notified_at: adminNotified
          ? getIsraelDateTime()
          : existingLead?.last_notified_at || "",
        priority: getPriority("waiting_for_human"),
      });

      const botReply = isRussian(text)
        ? "Конечно 😊 Я передаю обращение команде клиники, и представитель свяжется с вами в ближайшее время."
        : "בשמחה 😊 הפנייה הועברה לצוות המרפאה ונציג יחזור אליך בהקדם.";

      await sendWhatsAppMessage(
        from,
        botReply
      );

      await upsertLead({
        phone: from,
        last_bot_reply: botReply,
      });

      return res.sendStatus(200);
    }

    if (
      hasPersonalDetails(text) &&
      existingLead?.status ===
        "wants_appointment"
    ) {
      const shouldNotifyDetailsCollected =
        canNotifyAgain(existingLead?.last_notified_at);

      let adminNotified = false;

      if (shouldNotifyDetailsCollected) {
        adminNotified =
          await notifyAdmin(leadSummary);
      }

      await upsertLead({
        phone: from,
        name: extractedDetails.name,
        birth_date: extractedDetails.birth_date,
        id_number: extractedDetails.id_number,
        treatment:
          detected.treatment ||
          existingLead?.treatment ||
          "",
        branch: detectedBranch,
        status: "details_collected",
        human_takeover: "true",
        last_message: text,
        lead_summary: leadSummary,
        notified: shouldNotifyDetailsCollected
          ? adminNotified
            ? "✅ sent"
            : "❌ failed"
          : existingLead?.notified || "",
        last_notified_at: adminNotified
          ? getIsraelDateTime()
          : existingLead?.last_notified_at || "",
        priority: getPriority("details_collected"),
      });

      const botReply = isRussian(text)
        ? "Спасибо 😊 Данные получены и переданы администратору клиники. Представитель свяжется с вами в ближайшее время и предложит доступные варианты для записи."
        : "תודה 😊 הפרטים התקבלו והועברו למזכירות המרפאה. נציג יחזור אליכם בהקדם עם אפשרויות זמינות לתיאום.";

      await sendWhatsAppMessage(
        from,
        botReply
      );

      await upsertLead({
        phone: from,
        last_bot_reply: botReply,
      });

      return res.sendStatus(200);
    }

    const shouldNotify =
      detected.status ===
        "wants_appointment" &&
      canNotifyAgain(
        existingLead?.last_notified_at
      );

    let adminNotified = false;

    if (shouldNotify) {
      adminNotified =
        await notifyAdmin(leadSummary);
    }

    await upsertLead({
      phone: from,
      name: extractedDetails.name,
      birth_date: extractedDetails.birth_date,
      id_number: extractedDetails.id_number,
      treatment: detected.treatment,
      branch: detectedBranch,
      status: detected.status,
      human_takeover:
        existingLead?.human_takeover ||
        "false",
      last_message: text,
      lead_summary: leadSummary,
      notified: shouldNotify
        ? adminNotified
          ? "✅ sent"
          : "❌ failed"
        : existingLead?.notified || "",
      last_notified_at: adminNotified
        ? getIsraelDateTime()
        : existingLead?.last_notified_at || "",
      priority: getPriority(
        detected.status
      ),
    });

    const memoryContext = `
שם: ${
  extractedDetails.name ||
  existingLead?.name ||
  "לא נמסר"
}

טלפון וואטסאפ: ${from}

תאריך לידה: ${
  extractedDetails.birth_date ||
  existingLead?.birth_date ||
  "לא נמסר"
}

תעודת זהות: ${
  extractedDetails.id_number ||
  existingLead?.id_number ||
  "לא נמסר"
}

טיפול:
${
  detected.treatment ||
  existingLead?.treatment ||
  "לא ידוע"
}

סניף:
${
  detectedBranch ||
  existingLead?.branch ||
  "לא נמסר"
}

סטטוס:
${
  detected.status ||
  existingLead?.status ||
  "new"
}

היסטוריית שיחה:
${existingLead?.conversation_history || "אין"}

הודעה נוכחית:
${text}
`;
    const aiRes = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: `
אתה העוזר של מרפאת בלום.

${memoryContext}

שפת המשתמש:
${isRussian(text) ? "רוסית" : "עברית"}

הוראות:

אם יש טיפול שמור:
תמשיך לפי אותו טיפול.

אם המשתמש אמר את השם שלו:
תשתמש בשם.

אם המשתמש שואל על מה דיברנו:
תענה לפי הזיכרון.

לפני שאתה מבקש פרטים:
בדוק אם הם כבר קיימים בזיכרון.

אל תבקש שוב:
- תעודת זהות אם כבר קיימת
- תאריך לידה אם כבר קיים
- שם אם כבר קיים

אם חסר רק פרט אחד:
בקש רק את הפרט החסר.

אסור לקבוע תורים.
אסור לאשר יום או שעה.

התפקיד שלך:
רק לאסוף פרטים ולהעביר לנציג אנושי.

אם חסרים פרטים:
בקש:
- שם מלא
- תאריך לידה
- תעודת זהות

אם כל הפרטים כבר קיימים
והמשתמש רוצה לקבוע תור או לדבר עם נציג:
תגיד שנציג יחזור אליו בהקדם.

אם מדובר באורתודונטיה:
תגיד שהייעוץ עולה 250 ₪ ומתקזז.

אם מדובר באסתטיקה:
תגיד שהייעוץ ללא עלות
ושאל איזה סניף נוח.

אם המשתמש רוצה נציג:
תגיד שנציג יחזור בהקדם.

ענה באותה שפה של המשתמש.

אם שפת המשתמש היא רוסית:
ענה ברוסית טבעית וברורה.

אם שפת המשתמש היא עברית:
ענה בעברית טבעית וברורה.

אל תענה בעברית למשתמש שכתב ברוסית.

סגנון:
טבעי
קצר
אנושי
מקצועי

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
      aiData.output?.[0]?.content?.[0]
        ?.text ||
      aiData.output_text ||
      "שלום 😊 איך אפשר לעזור?";

    await sendWhatsAppMessage(
      from,
      reply
    );

    await upsertLead({
      phone: from,
      last_bot_reply: reply,
    });

    return res.sendStatus(200);
  } catch (error) {
    console.error("ERROR:", error);
    return res.sendStatus(200);
  }
});

async function sendWhatsAppMessage(
  to,
  body
) {
  try {
    const waRes = await fetch(
      `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body },
        }),
      }
    );

    const waData = await waRes.json();

    console.log(
      "WhatsApp send response:",
      JSON.stringify(waData, null, 2)
    );

    if (!waRes.ok) {
      return {
        error: waData.error || {
          message: "Unknown WhatsApp error",
        },
      };
    }

    return waData;
  } catch (err) {
    console.log(
      "sendWhatsAppMessage crash:",
      err
    );

    return {
      error: {
        message: err.message,
      },
    };
  }
}

const PORT =
  process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(
    `Server listening on ${PORT}`
  );
});
