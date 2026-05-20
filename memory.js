import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = "Sheet1";

export async function getLeadByPhone(phone) {

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:J`,
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
      };
    }
  }

  return null;
}

export async function upsertLead(data) {

  const existing = await getLeadByPhone(data.phone);

  if (existing) {

    const updatedHistory = `
${existing.conversation_history || ""}
USER: ${data.last_message || ""}
`.trim();

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${existing.rowIndex}:J${existing.rowIndex}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          data.phone || existing.phone,
          data.name || existing.name,
          data.birth_date || existing.birth_date,
          data.id_number || existing.id_number,
          data.treatment || existing.treatment,
          data.branch || existing.branch,
          data.status || existing.status,
          data.human_takeover || existing.human_takeover,
          data.last_message || existing.last_message,
          updatedHistory
        ]],
      },
    });

    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:J`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        data.phone || "",
        data.name || "",
        data.birth_date || "",
        data.id_number || "",
        data.treatment || "",
        data.branch || "",
        data.status || "",
        data.human_takeover || "false",
        data.last_message || "",
        `USER: ${data.last_message || ""}`
      ]],
    },
  });
}
