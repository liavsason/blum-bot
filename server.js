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

function getLanguage(text = "") {
  return isRussian(text) ? "רוסית" : "עברית";
}

function isUrgentRequest(text = "") {
  const t = text.toLowerCase();

  return (
    t.includes("דחוף") ||
    t.includes("כואב") ||
    t.includes("כאבים") ||
    t.includes("בעיה") ||
    t.includes("נשבר") ||
    t.includes("נפל") ||
    t.includes("срочно") ||
    t.includes("боль") ||
    t.includes("болит") ||
    t.includes("проблем") ||
    t.includes("слом") ||
    t.includes("отвал")
  );
}

function detectPreferredTime(text = "", existingLead = null) {
  const t = text.toLowerCase();

  if (
    t.includes("ערב") ||
    t.includes("בערב") ||
    t.includes("вечер") ||
    t.includes("вечером")
  ) {
    return "ערב";
  }

  if (
    t.includes("צהריים") ||
    t.includes("בצהריים") ||
    t.includes("צהרים") ||
    t.includes("день") ||
    t.includes("днем") ||
    t.includes("днём") ||
    t.includes("после обеда")
  ) {
    return "צהריים";
  }

  return existingLead?.preferred_time || "";
}

function detectCategory(text = "", existingLead = null) {
  const t = text.toLowerCase();

  if (
    t.trim() === "1" ||
    t.includes("תיאום תור") ||
    t.includes("לקבוע תור") ||
    t.includes("לקבוע") ||
    t.includes("תור") ||
    t.includes("запис") ||
    t.includes("записаться") ||
    t.includes("прием") ||
    t.includes("приём")
  ) {
    return "תיאום תור";
  }

  if (
    t.trim() === "2" ||
    t.includes("שאלה על טיפול") ||
    t.includes("טיפול") ||
    t.includes("лечение") ||
    t.includes("процедур") ||
    t.includes("услуг")
  ) {
    return "שאלה על טיפול";
  }

  if (
    t.trim() === "3" ||
    t.includes("שאלה על מחיר") ||
    t.includes("מחיר") ||
    t.includes("כמה עולה") ||
    t.includes("עלות") ||
    t.includes("цена") ||
    t.includes("стоимость") ||
    t.includes("сколько стоит")
  ) {
    return "שאלה על מחיר";
  }

  if (
    t.trim() === "4" ||
    t.includes("שאלה על שעות") ||
    t.includes("שעות") ||
    t.includes("פתוחים") ||
    t.includes("מתי אתם") ||
    t.includes("часы") ||
    t.includes("время работы") ||
    t.includes("когда работаете")
  ) {
    return "שאלה על שעות";
  }

  if (
    t.trim() === "5" ||
    t.includes("אחר") ||
    t.includes("משהו אחר") ||
    t.includes("другое") ||
    t.includes("другой вопрос")
  ) {
    return "אחר";
  }

  return existingLead?.category || "";
}

function shouldSendGreeting(text = "", existingLead = null) {
  const t = text.toLowerCase().trim();

  if (existingLead?.last_message) return false;

  return (
    t === "היי" ||
    t === "הי" ||
    t === "שלום" ||
    t === "בוקר טוב" ||
    t === "ערב טוב" ||
    t === "привет" ||
    t === "здравствуйте" ||
    t === "добрый день" ||
    t === "доброе утро" ||
    t === "добрый вечер" ||
    t === "hello" ||
    t === "hi"
  );
}

function getGreetingMessage(text = "") {
  if (isRussian(text)) {
    return `Здравствуйте! 😊 Я Ирена из клиники доктора Майка Блума — специалиста по ортодонтии, и доктора Марины Блум — эстетическая медицина лица.

Сейчас я недоступна, но с радостью помогу! По какому вопросу вы обращаетесь?

1️⃣ Запись на приём
2️⃣ Вопрос по процедуре
3️⃣ Вопрос по цене
4️⃣ Вопрос по часам работы
5️⃣ Другое`;
  }

  return `היי! 😊 אני אירנה מקליניקה של ד״ר מייק בלום — מומחה לאורתודונטיה, וד״ר מרינה בלום — רפואה אסתטית של הפנים.

כרגע אני לא זמינה, אבל אשמח לעזור! באיזה נושא פנית?

1️⃣ תיאום תור
2️⃣ שאלה על טיפול
3️⃣ שאלה על מחיר
4️⃣ שאלה על שעות
5️⃣ אחר`;
}

function getCategoryReply(category, text = "") {
  const russian = isRussian(text);

  if (category === "תיאום תור") {
    return russian
      ? "С радостью! Я проверю ближайшую доступность и вернусь к вам как можно скорее 😊 Вам удобнее вечером или днём?"
      : "בשמחה! אבדוק את הזמינות הקרובה ואחזור אליך בהקדם 😊\nנוח לך בערב או בצהריים?";
  }

  if (category === "שאלה על טיפול") {
    return russian
      ? "На медицинские вопросы врач отвечает лично на консультации 🙏 Хотите, чтобы мы записали вас на консультацию? Вам удобнее вечером или днём?"
      : "שאלות רפואיות עונה הרופא/ה באופן אישי בתור 🙏\nרוצה שנתאם לך ייעוץ? נוח לך בערב או בצהריים?";
  }

  if (category === "שאלה על מחיר") {
    return russian
      ? "Точная цена определяется после личного осмотра у врача. Консультация стоит 340 ₪ — если вы решите продолжить лечение, эта сумма вычитается из стоимости лечения 😊 Вам удобнее вечером или днём?"
      : "המחיר המדויק נקבע לאחר בדיקה אישית עם הרופא.\nתור ייעוץ עולה 340 ש״ח — ואם תחליט/י להמשיך לטיפול, הסכום מקוזז מעלות הטיפול 😊\nנוח לך בערב או בצהריים?";
  }

  if (category === "שאלה על שעות") {
    return russian
      ? "Часы работы клиники:\n🗓️ Вс, Вт, Чт — 13:00–18:30\n🗓️ Ср — 10:00–18:30\n🗓️ Пн и Пт — поочерёдно\n\nХотите, чтобы мы записали вас? Вам удобнее вечером или днём? 😊"
      : "שעות הקליניקה שלנו:\n🗓️ א׳ ג׳ ה׳ — 13:00–18:30\n🗓️ ד׳ — 10:00–18:30\n🗓️ ב׳ ו-ו׳ — לסירוגין\n\nרוצה שנתאם תור? נוח לך בערב או בצהריים? 😊";
  }

  return russian
    ? "Спасибо! Ирена свяжется с вами в ближайшее время 🙏"
    : "תודה! אירנה תחזור אליך בהקדם 🙏";
}

function getUrgentReply(text = "") {
  return isRussian(text)
    ? "Я вижу, что это срочный вопрос 🙏 Ирена свяжется с вами как можно скорее!"
    : "אני רואה שמדובר במשהו דחוף 🙏 אירנה תחזור אליך בהקדם האפשרי!";
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

function getPriority(status, urgent = false) {
  if (urgent) {
    return "🔴 דחוף";
  }

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
  category = "",
  preferredTime = "",
  urgent = false,
  language = "",
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

  return `📌 פנייה חדשה מהבוט

שם: ${name}
טלפון וואטסאפ: ${from}
שפה: ${language || "לא ידוע"}
סוג פנייה: ${category || "לא סווג"}
העדפת זמן: ${preferredTime || "לא נמסר"}
דחוף: ${urgent ? "כן" : "לא"}
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
      summary
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

שעות הקליניקה:
א׳ ג׳ ה׳ — 13:00–18:30
ד׳ — 10:00–18:30
ב׳ ו-ו׳ — לסירוגין

שיננית:
מבוגר מעל גיל 18 – 280 ₪
ילדים עד גיל 18 – 210 ₪
חיילים בסדיר – 210 ₪

ייעוץ:
340 ₪
אם ממשיכים לטיפול, הסכום מתקזז מעלות הטיפול

ייעוץ אורתודונטי:
340 ₪
מתקזז מעלות הטיפול אם ממשיכים

ייעוץ אסתטיקה:
340 ₪
מתקזז מעלות הטיפול אם ממשיכים

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
אסור לאשר יום או שעה.
הבוט רק אוסף מידע ומעביר לאירנה / לנציג.
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
    const language = getLanguage(text);
    const urgent = isUrgentRequest(text);

    if (text.trim() === "#עצור") {
      await upsertLead({
        phone: from,
        human_takeover: "true",
        status: "human_handling",
        last_message: text,
        priority: getPriority("human_handling", urgent),
      });

      return res.sendStatus(200);
    }

    if (text.trim() === "#בוט") {
      await upsertLead({
        phone: from,
        human_takeover: "false",
        status: "bot_active",
        last_message: text,
        priority: getPriority("bot_active", urgent),
      });

      return res.sendStatus(200);
    }

    const existingLead =
      await getLeadByPhone(from);

    const detected =
      detectTreatment(text, existingLead);

    const extractedDetails =
      extractUserDetails(text);

    const detectedBranch =
      detectBranch(text, existingLead);

    const category =
      detectCategory(text, existingLead);

    const preferredTime =
      detectPreferredTime(text, existingLead);

    const leadSummary = buildLeadSummary({
      from,
      existingLead,
      extractedDetails,
      detected,
      detectedBranch,
      text,
      category,
      preferredTime,
      urgent,
      language,
    });

    if (shouldSendGreeting(text, existingLead)) {
      const botReply = getGreetingMessage(text);

      await upsertLead({
        phone: from,
        name: extractedDetails.name,
        birth_date: extractedDetails.birth_date,
        id_number: extractedDetails.id_number,
        treatment: detected.treatment,
        branch: detectedBranch,
        status: "new",
        human_takeover: "false",
        last_message: text,
        lead_summary: leadSummary,
        priority: getPriority("new", urgent),
        last_bot_reply: botReply,
      });

      await sendWhatsAppMessage(
        from,
        botReply
      );

      return res.sendStatus(200);
    }

    if (urgent) {
      const shouldNotifyUrgent =
        canNotifyAgain(existingLead?.last_notified_at);

      let adminNotified = false;

      if (shouldNotifyUrgent) {
        adminNotified =
          await notifyAdmin(leadSummary);
      }

      const botReply = getUrgentReply(text);

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
        notified: shouldNotifyUrgent
          ? adminNotified
            ? "✅ sent"
            : "❌ failed"
          : existingLead?.notified || "",
        last_notified_at: adminNotified
          ? getIsraelDateTime()
          : existingLead?.last_notified_at || "",
        priority: getPriority("waiting_for_human", true),
        last_bot_reply: botReply,
      });

      await sendWhatsAppMessage(
        from,
        botReply
      );

      return res.sendStatus(200);
    }

    if (
      existingLead?.human_takeover === "true"
    ) {
      const shouldNotifyHumanTakeover =
        canNotifyAgain(existingLead?.last_notified_at);

      let adminNotified = false;

      if (shouldNotifyHumanTakeover) {
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
        status: detected.status || existingLead?.status || "human_handling",
        human_takeover: "true",
        last_message: text,
        lead_summary: leadSummary,
        notified: shouldNotifyHumanTakeover
          ? adminNotified
            ? "✅ sent"
            : "❌ failed"
          : existingLead?.notified || "",
        last_notified_at: adminNotified
          ? getIsraelDateTime()
          : existingLead?.last_notified_at || "",
        priority: getPriority(
          detected.status || existingLead?.status || "human_handling",
          urgent
        ),
      });

      return res.sendStatus(200);
    }

    if (category) {
      const shouldNotifyCategory =
        canNotifyAgain(existingLead?.last_notified_at);

      let adminNotified = false;

      if (shouldNotifyCategory) {
        adminNotified =
          await notifyAdmin(leadSummary);
      }

      const botReply = getCategoryReply(category, text);

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
        notified: shouldNotifyCategory
          ? adminNotified
            ? "✅ sent"
            : "❌ failed"
          : existingLead?.notified || "",
        last_notified_at: adminNotified
          ? getIsraelDateTime()
          : existingLead?.last_notified_at || "",
        priority: getPriority("waiting_for_human", urgent),
        last_bot_reply: botReply,
      });

      await sendWhatsAppMessage(
        from,
        botReply
      );

      return res.sendStatus(200);
    }

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
        priority: getPriority("waiting_for_human", urgent),
      });

      const botReply = isRussian(text)
        ? "Конечно 😊 Я передаю обращение Ирене, и она свяжется с вами в ближайшее время."
        : "בשמחה 😊 אני מעבירה את הפנייה לאירנה, והיא תחזור אליך בהקדם.";

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
        detected.status,
        urgent
      ),
    });

    const memoryContext = `
שם: ${
  extractedDetails.name ||
  existingLead?.name ||
  "לא נמסר"
}

טלפון וואטסאפ: ${from}

שפת משתמש: ${language}

סוג פנייה:
${category || "לא סווג"}

העדפת זמן:
${preferredTime || "לא נמסר"}

דחוף:
${urgent ? "כן" : "לא"}

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
אתה אירנה מקליניקה של ד״ר מייק בלום וד״ר מרינה בלום.

${memoryContext}

שפת המשתמש:
${isRussian(text) ? "רוסית" : "עברית"}

הוראות:

הודעת פתיחה אם המשתמש רק אומר שלום:
היי! 😊 אני אירנה מקליניקה של ד״ר מייק בלום — מומחה לאורתודונטיה, וד״ר מרינה בלום — רפואה אסתטית של הפנים.

כרגע אני לא זמינה, אבל אשמח לעזור! באיזה נושא פנית?

1️⃣ תיאום תור
2️⃣ שאלה על טיפול
3️⃣ שאלה על מחיר
4️⃣ שאלה על שעות
5️⃣ אחר

אם המשתמש בוחר 1 או רוצה תיאום תור:
תגיד שאבדוק את הזמינות הקרובה ואחזור אליו בהקדם.
שאל אם נוח לו בערב או בצהריים.
אל תאשר יום או שעה.

אם המשתמש בוחר 2 או שואל על טיפול:
תגיד ששאלות רפואיות הרופא/ה עונה באופן אישי בתור.
שאל אם רוצה שנתאם ייעוץ ואם נוח בערב או בצהריים.

אם המשתמש בוחר 3 או שואל מחיר:
תגיד שהמחיר המדויק נקבע לאחר בדיקה אישית עם הרופא.
תגיד שתור ייעוץ עולה 340 ש״ח ואם ממשיכים לטיפול הסכום מקוזז מעלות הטיפול.
שאל אם נוח בערב או בצהריים.

אם המשתמש בוחר 4 או שואל שעות:
שעות הקליניקה:
א׳ ג׳ ה׳ — 13:00–18:30
ד׳ — 10:00–18:30
ב׳ ו-ו׳ — לסירוגין
שאל אם רוצה שנתאם תור ואם נוח בערב או בצהריים.

אם המשתמש בוחר 5 או משהו אחר:
תגיד תודה ושאירנה תחזור אליו בהקדם.

אם המשתמש כותב דחוף / כואב / בעיה:
תגיד שאתה רואה שמדובר במשהו דחוף ושאירנה תחזור בהקדם האפשרי.

אסור לקבוע תורים.
אסור לאשר יום או שעה.
התפקיד שלך הוא לאסוף מידע ולהעביר לאירנה.

אם יש טיפול שמור:
תמשיך לפי אותו טיפול.

אם המשתמש אמר את השם שלו:
תשתמש בשם.

אם המשתמש שואל על מה דיברנו:
תענה לפי הזיכרון.

ענה באותה שפה של המשתמש.

אם שפת המשתמש היא רוסית:
ענה ברוסית טבעית וברורה.
העבר את אותם מסרים בדיוק ברוסית.

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
