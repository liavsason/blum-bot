import { google } from "googleapis";

const credentials = JSON.parse(
  process.env.GOOGLE_SHEETS_CREDENTIALS
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || process.env.GOOGLE_SHEET_ID;

const SHEET_NAME = "גיליון1";
const RANGE = `${SHEET_NAME}!A:O`;

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

export async function getLeadByPhone(phone) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });

  const rows = response.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) {
      return {
        rowIndex: i + 1,
        phone: rows[i][0] || "",
        name: rows[i][1] || "",
        birth_date: rows[i][2] || "",
        id_number: rows[i][3] || "",
        treatment: rows[i][4] || "",
        branch: rows[i][5] || "",
        status: rows[i][6] || "",
        human_takeover: rows[i][7] || "false",
        last_message: rows[i][8] || "",
        conversation_history: rows[i][9] || "",
        lead_summary: rows[i][10] || "",
        notified: rows[i][11] || "",
        updated_at: rows[i][12] || "",
      };
    }
  }

  return null;
}

export async function upsertLead(data) {
  const existing = await getLeadByPhone(data.phone);

  const updatedHistory = `
${existing?.conversation_history || ""}
USER: ${data.last_message || ""}
`.trim();

  const values = [[
    data.phone || existing?.phone || "",
    data.name || existing?.name || "",
    data.birth_date || existing?.birth_date || "",
    data.id_number || existing?.id_number || "",
    data.treatment || existing?.treatment || "",
    data.branch || existing?.branch || "",
    data.status || existing?.status || "new",
    data.human_takeover || existing?.human_takeover || "false",
    data.last_message || existing?.last_message || "",
    updatedHistory,
    data.lead_summary || existing?.lead_summary || "",
    data.notified || existing?.notified || "",
    getIsraelDateTime(),
  ]];

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${existing.rowIndex}:M${existing.rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    console.log("Lead updated");
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  console.log("Lead created");
}
