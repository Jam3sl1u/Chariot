/**
 * Chariot MVP weekly assignment script. Bind this file to the Google Sheet.
 * It uses the active spreadsheet, so it needs no spreadsheet ID or credentials.
 */

var ASSIGNMENT_TABS = ['Churches', 'Members', 'Drivers', 'Zones', 'RideRequests', 'Assignments'];
var UNASSIGNED_CAPACITY = 'No available driver seats in this church.';
var ASSIGNMENT_BUTTON_TITLE = 'chariot-run-assignments-button';
var RESET_ASSIGNMENTS_BUTTON_TITLE = 'chariot-reset-assignments-button';
var CLEAN_WEEK_BUTTON_TITLE = 'chariot-clean-week-button'; // Legacy button title, removed during upgrade.
var ASSIGNMENT_BUTTON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAPoAAAAwCAMAAAAPQZfdAAAAElBMVEUac+g2hOvz+P6xz/dfne+NufSv4J/xAAABnklEQVRo3u2W7a7DIAiGRfD+b/nIRxW7tUuWZeZk7/PDkQ0oL0VdKQAAAAAAAAAAAAATot0VvEl1+EX9XCtdZpA3n93eDfyo9Fpvvag7tE9L58uU35Len0/yov72sjn/VXp8mP5W2SzO77nb0RziGIBhRFRlWSO71T3EluielOTA1s6RZpd0f+tZemWek9B/7pWy+zNHn4YhPhV1jVSrxhJCj6/NwaWPNDukj6oX6VwOscUtsYm3Vfr5NAyL0uKprpHxnS1E6mUx00EHfqbZJl3KSfphlfGDLXresVAyig91eYicQV26qHztQXJgb0uk2SHdWt/upEuaDDk6JXOCb6WTLW20eJU+0+yRXto4gcawZul87Ap7O9LitA/jWjotb12Ucpae8m2RXvzhecdm6WM/6ICwDbtvUgrpTyMX6TbrsjqMvU47pYuVnc/pJF2isqZ3kR/ZPI2HE/6pdJ0cPt2gOkwzzS7p8UdVi5MH6Udldkpf3+vtbuC9r8ndh2frvf4ZWpP9/872kK/IH8PGln9ROQAAAAAAAAAAAJ7wByfoCQ0NuemdAAAAAElFTkSuQmCC';
var RESET_ASSIGNMENTS_BUTTON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAPoAAAAwCAMAAAAPQZfdAAAAFVBMVEWzJh69RD378/Ppwb/eoZ7Tgn3JZF5YiWCRAAABzklEQVRo3u1XAW7DIAzEmPr/Tx7GxiZRk2lVRzXtTlrrOcfFBwbUUgAAAAAAAAAAAAAAAM4g+nQFP0A18Hc1t0eEXCtdqsmLdSz6m61fu5l22wypk9ul2ovW+VLyN603IpJa72d9Ka3pRL27jA9Zz6/uinXZiOfKeoYXu/2JL27QIhgP+uMmlcd/HPkeifjOmu8Jgunnazdal1lz1aC3NFtJM6M1sQ3oVF+jpC2B+BizPvJiUfWPVE2C6YfMLutRKWkR6kz/ijTJzNKQrVNHKmkRqHXS4smts45km+D5gFI1CaqfMluti1kh8toqP2jJLNZ9ucTOu0GLoFhT+wTN9ud1UBdL1SSwTYvL7LI+ptt3uk+DjO/Hkgnrkl0StAyurVN+pOrResrss17s3NINr9B5F61vyYR1PlyGRsvArNO99VQ9WV/0tlkvw8roQWHtAtv5mQnr5Ie7NYvTIii2lLnXn1pP1aP1lNkDnie8XTFc56bzI6jmUa/05pU1mxijJf98wj+1Pu62uBCMoINSZueq66vJCjjc04cMldPq39zrdw2fqkkY+pvv9fejteHnL1t4FbZJXv4d85cx2pb/o3MAAAAAAAAAAAAAAA74Ar9bCs7reG14AAAAAElFTkSuQmCC';

/**
 * Installs or replaces the clickable Run Assignments button in the Assignments tab.
 * Run this once manually after saving the script.
 */
function buildAssignmentButton() {
  installButton_(ASSIGNMENT_BUTTON_TITLE, 'Run Assignments', 'runAssignmentsFromButton', 3, ASSIGNMENT_BUTTON_PNG);
}

/** Removes the Run Assignments image button without changing any sheet rows. */
function removeAssignmentButton() {
  removeButton_(ASSIGNMENT_BUTTON_TITLE);
}

/** The public image-button handler. */
function runAssignmentsFromButton() {
  runSaturdayAssignments();
  SpreadsheetApp.getActiveSpreadsheet().toast('Assignments updated.', 'Chariot', 5);
}

/** Installs or replaces the reset-assignments button in the Buttons tab. */
function buildResetAssignmentsButton() {
  removeButton_(CLEAN_WEEK_BUTTON_TITLE);
  installButton_(RESET_ASSIGNMENTS_BUTTON_TITLE, 'Reset Assignments', 'resetAssignmentsFromButton', 7, RESET_ASSIGNMENTS_BUTTON_PNG);
}

/** Removes the reset-assignments button without changing any sheet rows. */
function removeResetAssignmentsButton() {
  removeButton_(RESET_ASSIGNMENTS_BUTTON_TITLE);
}

/** Builds the Buttons tab and both controls in one action. */
function buildAllButtons() {
  buildAssignmentButton();
  buildResetAssignmentsButton();
}

/** The public reset button handler; asks before deleting current-week rows. */
function resetAssignmentsFromButton() {
  var response = SpreadsheetApp.getUi().alert(
    'Reset this week\'s assignments?',
    'This deletes only the current upcoming-Sunday Assignment rows. Ride requests and other weeks are kept.',
    SpreadsheetApp.getUi().ButtonSet.YES_NO
  );
  if (response !== SpreadsheetApp.getUi().Button.YES) return;
  resetCurrentWeekAssignments();
  SpreadsheetApp.getActiveSpreadsheet().toast('This week\'s assignments were reset.', 'Chariot', 5);
}

function buttonsSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName('Buttons') || spreadsheet.insertSheet('Buttons');
  sheet.getRange('A1').setValue('Chariot controls').setFontWeight('bold').setFontSize(14);
  sheet.getRange('A2').setValue('Use these buttons in the desktop browser.');
  sheet.setColumnWidth(1, 250);
  return sheet;
}

function installButton_(title, label, handler, row, png) {
  removeButton_(title);
  var button = buttonsSheet_().insertImage(Utilities.newBlob(Utilities.base64Decode(png), 'image/png', label + '.png'), 1, row);
  button.setWidth(220).setHeight(42).setAltTextTitle(title).setAltTextDescription(label).assignScript(handler);
}

function removeButton_(title) {
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sheet) {
    sheet.getImages().filter(function (image) { return image.getAltTextTitle() === title; }).forEach(function (image) { image.remove(); });
  });
}

/** Create the Saturday ~11:45 AM trigger in the Apps Script project timezone. */
function createSaturdayAssignmentTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === 'runSaturdayAssignments'; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });

  ScriptApp.newTrigger('runSaturdayAssignments')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(11)
    .nearMinute(45)
    .create();
}

/** Deletes all Assignment rows for each church's current upcoming service Sunday. */
function resetCurrentWeekAssignments() {
  resetAssignmentsAt_(new Date());
}

function resetAssignmentsAt_(now, churchIds) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readTables_(SpreadsheetApp.getActiveSpreadsheet());
    var deleted = [];
    var rowsToDelete = [];
    tables.Churches.rows.filter(function (church) { return church.churchId && (!churchIds || churchIds.indexOf(church.churchId) !== -1); }).forEach(function (church) {
      var weekDate = serviceSunday_(now, church.timezone);
      var rows = tables.Assignments.rows.filter(function (row) {
        return String(row.churchId) === church.churchId && sameWeek_(row.weekDate, weekDate);
      });
      rowsToDelete = rowsToDelete.concat(rows);
      deleted.push({ churchId: church.churchId, weekDate: weekDate, rows: rows.length });
    });
    // Sheet row numbers shift on delete, so delete every church's matching rows
    // together from bottom to top rather than church-by-church.
    rowsToDelete.sort(function (a, b) { return b.__sheetRow - a.__sheetRow; }).forEach(function (row) {
      tables.Assignments.sheet.deleteRow(row.__sheetRow);
    });
    console.log('Assignment rows reset: ' + JSON.stringify(deleted));
  } finally {
    lock.releaseLock();
  }
}

/** Runs the weekly assignment pass; it is also the manual test entry point. */
function runSaturdayAssignments() {
  runAssignmentsAt_(new Date());
}

function runAssignmentsAt_(now, churchIds) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readTables_(SpreadsheetApp.getActiveSpreadsheet());
    var plans = [];
    tables.Churches.rows.filter(function (church) { return church.churchId && (!churchIds || churchIds.indexOf(church.churchId) !== -1); }).forEach(function (church) {
      var weekDate = serviceSunday_(now, church.timezone);
      var changes = assignChurch_(church.churchId, weekDate, tables);
      reconcileChurchWeekAssignments_(tables.Assignments, church.churchId, weekDate, changes);
      plans.push({ churchId: church.churchId, weekDate: weekDate, added: changes.inserts.length, updated: changes.updates.length });
    });
    console.log('Assignment pass complete: ' + JSON.stringify(plans));
  } finally {
    lock.releaseLock();
  }
}

/** Pure planner ported from src/assignment.ts; it defensively ignores other churches. */
function assignByZone_(input) {
  var churchId = input.churchId;
  var priority = {};
  input.zones.filter(function (zone) { return zone.churchId === churchId; }).forEach(function (zone) {
    priority[zone.zoneName] = Number(zone.zonePriorityOrder);
  });
  function zoneOrder(zone) {
    return Object.prototype.hasOwnProperty.call(priority, zone) ? priority[zone] : Infinity;
  }
  var eligibleDrivers = input.drivers
    .filter(function (driver) {
      return driver.churchId === churchId && isTrue_(driver.isAvailableThisWeek) && Number(driver.seatsAvailable) > 0;
    })
    .map(function (driver) {
      return { driverId: driver.driverId, homeZone: driver.homeZone, remaining: Math.floor(Number(driver.seatsAvailable)), riderCount: 0 };
    })
    .sort(function (a, b) { return zoneOrder(a.homeZone) - zoneOrder(b.homeZone) || a.driverId.localeCompare(b.driverId); });
  var eligibleRiders = input.riders
    .filter(function (rider) { return rider.churchId === churchId && rider.status === 'PENDING'; })
    .slice()
    .sort(function (a, b) { return zoneOrder(a.zone) - zoneOrder(b.zone) || a.requestId.localeCompare(b.requestId); });

  return eligibleRiders.map(function (rider) {
    var seatsUsed = isTrue_(rider.hasPlusOne) ? 2 : 1;
    var driver = eligibleDrivers.find(function (candidate) { return candidate.remaining >= seatsUsed; });
    if (!driver) {
      return { churchId: churchId, driverId: '', memberId: rider.memberId, requestId: rider.requestId,
        seatPosition: '', seatsUsed: seatsUsed, unassignedReason: UNASSIGNED_CAPACITY };
    }
    driver.remaining -= seatsUsed;
    driver.riderCount += 1;
    return { churchId: churchId, driverId: driver.driverId, memberId: rider.memberId, requestId: rider.requestId,
      seatPosition: driver.riderCount, seatsUsed: seatsUsed };
  });
}

function assignChurch_(churchId, weekDate, tables) {
  var membersById = {};
  tables.Members.rows.filter(function (member) { return member.churchId === churchId; }).forEach(function (member) {
    membersById[member.memberId] = member;
  });
  var riders = tables.RideRequests.rows
    .filter(function (request) { return request.churchId === churchId && String(request.weekDate) === weekDate; })
    .map(function (request) {
      var member = membersById[request.memberId];
      if (!member) throw new Error('RideRequest ' + request.requestId + ' has no member in church ' + churchId + '.');
      return { requestId: request.requestId, memberId: request.memberId, churchId: request.churchId,
        zone: member.zone, status: request.status, hasPlusOne: request.hasPlusOne };
    });
  var requestsByMember = {};
  riders.forEach(function (rider) { requestsByMember[rider.memberId] = rider; });
  var existing = tables.Assignments.rows.filter(function (row) {
    return String(row.churchId) === churchId && sameWeek_(row.weekDate, weekDate);
  });
  var updates = [];
  var activeAssignments = [];
  existing.forEach(function (row) {
    var rider = requestsByMember[row.memberId];
    if (rider && rider.status === 'CANCELLED') {
      if (assignmentStatus_(row) !== 'CANCELLED') updates.push({ __sheetRow: row.__sheetRow, assignmentStatus: 'CANCELLED' });
    } else if (assignmentStatus_(row) === 'ASSIGNED') {
      activeAssignments.push(row);
      if (!row.assignmentStatus) updates.push({ __sheetRow: row.__sheetRow, assignmentStatus: 'ASSIGNED' });
    } else if (!row.assignmentStatus) {
      updates.push({ __sheetRow: row.__sheetRow, assignmentStatus: 'UNASSIGNED' });
    }
  });

  var seatsUsedByDriver = {};
  var riderCountByDriver = {};
  activeAssignments.forEach(function (row) {
    var rider = requestsByMember[row.memberId];
    var seatsUsed = rider && isTrue_(rider.hasPlusOne) ? 2 : 1;
    seatsUsedByDriver[row.driverId] = (seatsUsedByDriver[row.driverId] || 0) + seatsUsed;
    riderCountByDriver[row.driverId] = Math.max(riderCountByDriver[row.driverId] || 0, Number(row.seatPosition) || 0);
  });
  var activeMembers = {};
  activeAssignments.forEach(function (row) { activeMembers[row.memberId] = true; });
  var candidates = riders.filter(function (rider) { return rider.status === 'PENDING' && !activeMembers[rider.memberId]; });
  var reducedDrivers = tables.Drivers.rows.filter(function (driver) { return driver.churchId === churchId; }).map(function (driver) {
    return Object.assign({}, driver, { seatsAvailable: Math.max(0, Number(driver.seatsAvailable) - (seatsUsedByDriver[driver.driverId] || 0)) });
  });
  var planned = assignByZone_({
    churchId: churchId,
    riders: candidates,
    drivers: reducedDrivers,
    zones: tables.Zones.rows.filter(function (zone) { return zone.churchId === churchId; }),
  }).map(function (assignment) {
    if (assignment.driverId) assignment.seatPosition += riderCountByDriver[assignment.driverId] || 0;
    return assignment;
  });
  var reusableUnassigned = {};
  existing.forEach(function (row) {
    if (assignmentStatus_(row) === 'UNASSIGNED') reusableUnassigned[row.memberId] = row;
  });
  var inserts = [];
  planned.forEach(function (assignment) {
    var values = { driverId: assignment.driverId, memberId: assignment.memberId, seatPosition: assignment.seatPosition,
      notified: false, unassignedReason: assignment.unassignedReason || '', assignmentStatus: assignment.driverId ? 'ASSIGNED' : 'UNASSIGNED' };
    var prior = reusableUnassigned[assignment.memberId];
    if (prior) updates.push(Object.assign({ __sheetRow: prior.__sheetRow }, values));
    else inserts.push(Object.assign({ weekDate: weekDate, churchId: churchId }, values));
  });
  return { updates: updates, inserts: inserts };
}

function readTables_(spreadsheet) {
  var tables = {};
  ASSIGNMENT_TABS.forEach(function (name) { tables[name] = readTable_(spreadsheet.getSheetByName(name), name); });
  return tables;
}

function readTable_(sheet, name) {
  if (!sheet) throw new Error('Missing required sheet tab: ' + name + '.');
  var values = sheet.getDataRange().getValues();
  var headers = values.shift().map(String);
  if (!headers.length || new Set(headers).size !== headers.length || headers.indexOf('churchId') === -1) throw new Error('Invalid headers in ' + name + '.');
  return { sheet: sheet, headers: headers, rows: values.map(function (cells, index) {
    var row = { __sheetRow: index + 2 };
    headers.forEach(function (header, column) { row[header] = cells[column]; });
    return row;
  }).filter(function (row) {
    return headers.some(function (header) { return row[header] !== ''; });
  }) };
}

function reconcileChurchWeekAssignments_(table, churchId, weekDate, changes) {
  requireHeaders_(table.headers, ['weekDate', 'churchId', 'driverId', 'memberId', 'seatPosition', 'notified', 'unassignedReason', 'assignmentStatus'], 'Assignments');
  changes.updates.forEach(function (update) {
    Object.keys(update).filter(function (header) { return header !== '__sheetRow'; }).forEach(function (header) {
      table.sheet.getRange(update.__sheetRow, table.headers.indexOf(header) + 1).setValue(update[header]);
    });
  });
  if (!changes.inserts.length) return;
  var values = changes.inserts.map(function (assignment) {
    return table.headers.map(function (header) {
      if (header === 'weekDate') return "'" + assignment.weekDate; // Preserve YYYY-MM-DD as plain text.
      return Object.prototype.hasOwnProperty.call(assignment, header) ? assignment[header] : '';
    });
  });
  table.sheet.getRange(table.sheet.getLastRow() + 1, 1, values.length, table.headers.length).setValues(values);
}

function assignmentStatus_(row) {
  if (row.assignmentStatus) return String(row.assignmentStatus);
  return row.driverId ? 'ASSIGNED' : 'UNASSIGNED';
}

function requireHeaders_(headers, required, tab) {
  required.forEach(function (header) {
    if (headers.indexOf(header) === -1) throw new Error('Missing ' + tab + '.' + header + ' header. Run npm run setup:sheets first.');
  });
}


function isTrue_(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function sameWeek_(value, weekDate) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd') === weekDate;
  return String(value) === weekDate;
}

function serviceSunday_(now, timezone) {
  if (!timezone) throw new Error('Church timezone is required for assignment week calculation.');
  var localDate = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  var localWeekday = Number(Utilities.formatDate(now, timezone, 'u')); // Monday = 1, Sunday = 7
  var localNoonUtc = new Date(localDate + 'T12:00:00Z');
  localNoonUtc.setUTCDate(localNoonUtc.getUTCDate() + (7 - localWeekday));
  return Utilities.formatDate(localNoonUtc, 'UTC', 'yyyy-MM-dd');
}

/**
 * Self-cleaning end-to-end test. Seeds temporary E2E-* churches, invokes the
 * real assignment/reset functions, asserts outcomes, and removes all test rows.
 */
function runAssignmentE2eTests() {
  var now = new Date('2026-09-26T18:00:00Z'); // Saturday 11 AM in Los Angeles
  var suffix = String(new Date().getTime());
  var ids = ['E2E-A-' + suffix, 'E2E-B-' + suffix, 'E2E-C-' + suffix];
  var week = serviceSunday_(now, 'America/Los_Angeles');
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var tables = readTables_(spreadsheet);
    seedE2e_(tables, ids, week);
    runAssignmentsAt_(now, ids);
    var rows = e2eAssignments_(spreadsheet, ids, week);
    assertE2e_(rows.length === 5, 'first run creates one row per rider');
    assertE2e_(e2eRow_(rows, 'a-1').driverId === 'a-driver', 'first A rider is seated');
    assertE2e_(e2eRow_(rows, 'a-2').driverId === 'a-driver', '+1 rider is seated');
    assertE2e_(e2eRow_(rows, 'a-3').driverId === '', 'capacity overflow is unassigned');
    assertE2e_(e2eRow_(rows, 'b-1').driverId === 'b-driver', 'Church B remains isolated');
    assertE2e_(e2eRow_(rows, 'c-1').driverId === '', 'no-driver church is unassigned');

    addE2eRider_(spreadsheet, ids[0], 'a-4', week, false);
    runAssignmentsAt_(now, ids);
    rows = e2eAssignments_(spreadsheet, ids, week);
    assertE2e_(rows.length === 6, 'rerun has no duplicate seated riders');
    assertE2e_(e2eRow_(rows, 'a-1').driverId === 'a-driver' && e2eRow_(rows, 'a-2').driverId === 'a-driver', 'rerun preserves seating');

    setE2eRequest_(spreadsheet, ids[0], 'a-1', 'CANCELLED');
    runAssignmentsAt_(now, ids);
    rows = e2eAssignments_(spreadsheet, ids, week);
    assertE2e_(e2eRow_(rows, 'a-1').assignmentStatus === 'CANCELLED', 'cancelled assignment remains history');
    assertE2e_(e2eRow_(rows, 'a-3').driverId === 'a-driver', 'cancellation frees a seat');

    resetAssignmentsAt_(now, ids);
    assertE2e_(e2eAssignments_(spreadsheet, ids, week).length === 0, 'reset clears all churches, not only the first');
    runAssignmentsAt_(now, ids);
    assertE2e_(e2eAssignments_(spreadsheet, ids, week).length === 5, 'fresh plan works after reset');
    console.log('E2E PASS: capacity, +1, isolation, reruns, cancellation, and reset.');
  } finally {
    deleteE2e_(spreadsheet, ids);
  }
}

function seedE2e_(tables, ids, week) {
  var a = ids[0], b = ids[1], c = ids[2];
  [a, b, c].forEach(function (id) { appendE2e_(tables.Churches, { churchId: id, churchName: id, timezone: 'America/Los_Angeles', discordGuildId: 'e2e', weeklyPostChannelId: 'e2e', driverAskChannelId: 'e2e' }); });
  [a, b, c].forEach(function (id) { appendE2e_(tables.Zones, { churchId: id, zoneId: id + '-zone', zoneName: 'Near', zonePriorityOrder: 1 }); });
  ['a-1', 'a-2', 'a-3'].forEach(function (id) { addE2eRider_(tables, a, id, week, id === 'a-2'); });
  addE2eRider_(tables, b, 'b-1', week, false); addE2eRider_(tables, c, 'c-1', week, false);
  appendE2e_(tables.Drivers, { churchId: a, driverId: 'a-driver', name: 'A', homeZone: 'Near', seatsAvailable: 3, isAvailableThisWeek: true, isActive: true });
  appendE2e_(tables.Drivers, { churchId: b, driverId: 'b-driver', name: 'B', homeZone: 'Near', seatsAvailable: 10, isAvailableThisWeek: true, isActive: true });
}
function addE2eRider_(source, churchId, memberId, week, plusOne) {
  var tables = source.getSheetByName ? readTables_(source) : source;
  appendE2e_(tables.Members, { churchId: churchId, memberId: memberId, name: memberId, discordId: memberId, zone: 'Near', createdAt: '' });
  appendE2e_(tables.RideRequests, { churchId: churchId, requestId: 'request-' + memberId, weekDate: "'" + week, memberId: memberId, status: 'PENDING', hasPlusOne: plusOne });
}
function appendE2e_(table, row) { table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, table.headers.length).setValues([table.headers.map(function (header) { return row[header] === undefined ? '' : row[header]; })]); }
function e2eAssignments_(spreadsheet, ids, week) { return readTable_(spreadsheet.getSheetByName('Assignments'), 'Assignments').rows.filter(function (row) { return ids.indexOf(String(row.churchId)) !== -1 && sameWeek_(row.weekDate, week); }); }
function e2eRow_(rows, memberId) { var row = rows.filter(function (candidate) { return candidate.memberId === memberId; })[0]; assertE2e_(!!row, 'missing row for ' + memberId); return row; }
function setE2eRequest_(spreadsheet, churchId, memberId, status) { var table = readTable_(spreadsheet.getSheetByName('RideRequests'), 'RideRequests'); var row = table.rows.filter(function (candidate) { return candidate.churchId === churchId && candidate.memberId === memberId; })[0]; assertE2e_(!!row, 'missing request'); table.sheet.getRange(row.__sheetRow, table.headers.indexOf('status') + 1).setValue(status); }
function deleteE2e_(spreadsheet, ids) { ASSIGNMENT_TABS.forEach(function (tab) { var table = readTable_(spreadsheet.getSheetByName(tab), tab); table.rows.filter(function (row) { return ids.indexOf(String(row.churchId)) !== -1; }).sort(function (a, b) { return b.__sheetRow - a.__sheetRow; }).forEach(function (row) { table.sheet.deleteRow(row.__sheetRow); }); }); }
function assertE2e_(condition, message) { if (!condition) throw new Error('E2E failed: ' + message); }
