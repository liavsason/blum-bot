import { google } from "googleapis";

const credentials = JSON.parse(
  process.env.GOOGLE_SHEETS_CREDENTIALS
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets"
  ],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

export async function saveLead(data) {

  try {

    await sheets.spreadsheets.values.append({

      spreadsheetId: SHEET_ID,

      range: "Sheet1!A:J",

      valueInputOption: "USER_ENTERED",

      requestBody: {
        values: [[
          data.phone || "",
          data.name || "",
          data.birth_date || "",
          data.id_number || "",
          data.treatment || "",
          data.branch || "",
          data.status || "",
          data.human_takeover || "",
          data.last_message || "",
          new Date().toISOString()
        ]]
      }

    });

    console.log("Lead saved to Google Sheets");

  } catch (error) {

    console.log(
      "Google Sheets Error:",
      error.message
    );

  }

}
