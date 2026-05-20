import { google } from "googleapis";

const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const RANGE = "גיליון1!A:J";

export async function getLeadByPhone(phone) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values || [];
    const headers = rows[0];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      if (row[0] === phone) {
        return {
          rowNumber: i + 1,
          phone: row[0] || "",
          name: row[1] || "",
          birth_date: row[2] || "",
          id_number: row[3] || "",
          treatment: row[4] || "",
          branch: row[5] || "",
          status: row[6] || "",
          human_takeover: row[7] || "false",
          last_message: row[8] || "",
          updated_at: row[9] || "",
        };
      }
    }

    return null;
  } catch (error) {
    console.log("Google Sheets getLeadByPhone Error:", error.message);
    return null;
  }
}

export async function upsertLead(data) {
  try {
    const existingLead = await getLeadByPhone(data.phone);

    const values = [[
      data.phone || "",
      data.name || existingLead?.name || "",
      data.birth_date || existingLead?.birth_date || "",
      data.id_number || existingLead?.id_number || "",
      data.treatment || existingLead?.treatment || "",
      data.branch || existingLead?.branch || "",
      data.status || existingLead?.status || "new",
      data.human_takeover || existingLead?.human_takeover || "false",
      data.last_message || existingLead?.last_message || "",
      new Date().toISOString(),
    ]];

    if (existingLead) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `גיליון1!A${existingLead.rowNumber}:J${existingLead.rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });

      console.log("Lead updated in Google Sheets");
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: RANGE,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });

      console.log("Lead created in Google Sheets");
    }
  } catch (error) {
    console.log("Google Sheets upsertLead Error:", error.message);
  }
}
