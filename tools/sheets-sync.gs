// Hourly sync: PMOS & Foot 2026 registrations -> this sheet.
// Setup: Extensions > Apps Script > paste this > Project Settings > Script properties
// add EXPORT_TOKEN (same value as the Cloudflare secret) > run installHourlyTrigger once.

var API_URL = 'https://pmos.ideaclinics.com/api/export';

function syncRegistrations() {
  var token = PropertiesService.getScriptProperties().getProperty('EXPORT_TOKEN');
  var res = UrlFetchApp.fetch(API_URL, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Export failed: ' + res.getContentText());

  var data = JSON.parse(res.getContentText());
  var cols = data.columns;
  var values = [cols].concat(data.rows.map(function (r) {
    return cols.map(function (c) { return r[c] === null || r[c] === undefined ? '' : String(r[c]); });
  }));

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Registrations') || ss.insertSheet('Registrations');
  sh.clearContents();
  sh.getRange(1, 1, values.length, cols.length).setNumberFormat('@').setValues(values);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  sh.setFrozenRows(1);

  var sum = ss.getSheetByName('Summary') || ss.insertSheet('Summary', 0);
  sum.clear();
  sum.getRange('A1:B1').setValues([['Form', 'Registrations']]).setFontWeight('bold');
  var types = ['conference', 'webinar', 'foot_doctor', 'foot_public'];
  types.forEach(function (t, i) {
    sum.getRange(i + 2, 1).setValue(t);
    sum.getRange(i + 2, 2).setFormula('=COUNTIF(Registrations!C:C,A' + (i + 2) + ')');
  });
  sum.getRange(types.length + 2, 1).setValue('Total').setFontWeight('bold');
  sum.getRange(types.length + 2, 2).setFormula('=SUM(B2:B' + (types.length + 1) + ')').setFontWeight('bold');
  sum.getRange(types.length + 4, 1).setValue('Last synced');
  sum.getRange(types.length + 4, 2).setValue(new Date());
}

function installHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncRegistrations').timeBased().everyHours(1).create();
  syncRegistrations();
}
