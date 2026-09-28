/** Current-week reporting controls. Requires the shared helpers in Code.gs. */
var GROUPS_BUTTON_TITLE = 'chariot-weekly-groups-button';
var MANIFEST_BUTTON_TITLE = 'chariot-ride-manifest-button';
var GROUPS_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAPoAAAAwCAMAAAAPQZfdAAAAD1BMVEVnUKT18/mom8uklsiKeLl3hj+kAAABnklEQVRo3u2WWW7DMAxExeX+Z665yrIDtA5QxA7mfShsFQkarhkDAAAAAAAAAAAA4KsgYl9pW8XX8ze0DDnuKRn6aRHvwS6XXBZflc4UyHgiHultseBHBvxdunrElV567AHYuz16KZIrimXYf9mW7c8qD86joZllxGb4wV2VacS54zf5Jr/3zP+RLqZuU6Hthcz+MLZNV2XflCyPeXReY44QquJPN3Lu5E330m5v2R5duuzJR4Mr/FIp4Ce1s8SvoLxsZAbNqIdHw7XC92kM7Alpr7SHdlhnfCOeKZ1dpbySLiPExbok/O6m+8S8C1AjKatnaxuje7it6gmSR8sHIV17OsYpzZFRta9ZDjcS38WZvV6NMqJCawJKpv88uUo/R52yCGJnuEc/LXiV3h8abZojTG2katkNgFHDTailL7U+raz1tUfeAY4cnB+RlG3s+l2kPe2PzrIw6bPD19adO/zIYa35KKaDkeXALX339mgJNf3HmHPdXSnrXJ93PxK9/JP9sb/xT8Iv1+oXSb965kukAwAAAAAAAAAA4Dd+ADHZBMcXprvXAAAAAElFTkSuQmCC';
var MANIFEST_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAPoAAAAwCAMAAAAPQZfdAAAAElBMVEUAbI9OmbHx9/mmy9hWnrWGucpMz/30AAABiElEQVRo3u2W2XLDIAxF0cL//3K1IOwEmr50xnR6z4NNBPLoSgLSGgAAAAAAAAAAAP4L9IjrU3AiFGNNY2dZl7lJ7U37z5irMPfNXNenRX6UzvyjdF8hn6R33kqXbT4OIKPV16D30mm+9sji9Rek5yuqbrWTlN5vOs1oK2hIl9H/9mM0uY04J93Lm8dnfEpGw5xHRk6jppqRhjDhW41tmdnUnmaRWuJPCaWZhHqmRSItJ0ufWj3+Kr9kNrSijqqajLCKtJwZKZLKmuQ3fM6XN+p0dMNXmSLsiLhlhfPkm9JDd8s+IJWUruNgyGa4e3k646sHS+/zkHuR3kdSqKSbcUjXuhNW6ZeXVkqPlu4Ba1urTk4t8ykz50CzoSMxU/q7F/XIz9nS23Wv1xGVe53qvspjIOYpmrqv0udep8iBtMzP4dKJ66zyu22e8NffsyG9yi+dv5E+vTgG46Z4WuUH6R4fXfe6znu9z2V0Fdq3sabDIn161b0eg6dVAgAAAAAAAAAAAADwS3wBQxYGvZ1PpJAAAAAASUVORK5CYII=';

function buildWeeklyGroupsButton() { installButton_(GROUPS_BUTTON_TITLE, 'Weekly Groups', 'renderWeeklyGroupsFromButton', 11, GROUPS_PNG); }
function removeWeeklyGroupsButton() { removeButton_(GROUPS_BUTTON_TITLE); }
function buildRideManifestButton() { installButton_(MANIFEST_BUTTON_TITLE, 'Ride Manifest', 'renderRideManifestFromButton', 15, MANIFEST_PNG); }
function removeRideManifestButton() { removeButton_(MANIFEST_BUTTON_TITLE); }
function buildReportButtons() { buildWeeklyGroupsButton(); buildRideManifestButton(); }
function renderWeeklyGroupsFromButton() { renderWeeklyGroups(); SpreadsheetApp.getActiveSpreadsheet().toast('Weekly groups refreshed.', 'Chariot', 5); }
function renderRideManifestFromButton() { renderRideManifest(); SpreadsheetApp.getActiveSpreadsheet().toast('Ride manifest refreshed.', 'Chariot', 5); }

function renderWeeklyGroups() {
  var report = reportData_(); var output = [['Weekly Ride Groups'], ['Generated', new Date()]];
  report.churches.forEach(function (church) {
    var rows = report.rows.filter(function (row) { return row.churchId === church.churchId; });
    output.push([], [church.churchName + ' (' + church.churchId + ') — ' + church.weekDate]);
    var assigned = rows.filter(function (row) { return reportStatus_(row) === 'ASSIGNED'; });
    var drivers = {};
    assigned.forEach(function (row) { (drivers[row.driverId] || (drivers[row.driverId] = [])).push(row); });
    Object.keys(drivers).sort().forEach(function (driverId) {
      var driver = report.drivers[driverId] || {}; var riders = drivers[driverId].sort(function (a, b) { return Number(a.seatPosition) - Number(b.seatPosition); });
      output.push(['Driver: ' + (driver.name || driverId), 'Driving to: ' + church.churchName, 'Seats: ' + riders.length + '/' + (driver.seatsAvailable || '?'), driver.discordId || '']);
      riders.forEach(function (row) { var member = report.members[row.memberId] || {}; output.push(['  ' + row.seatPosition + '. ' + (member.name || row.memberId), member.zone || '', member.phone || '', member.preferences || '']); });
    });
    rows.filter(function (row) { return reportStatus_(row) !== 'ASSIGNED'; }).forEach(function (row) { var member = report.members[row.memberId] || {}; output.push([reportStatus_(row) + ': ' + (member.name || row.memberId), member.zone || '', row.unassignedReason || '']); });
  });
  writeReport_(reportTabName_('Weekly Groups', report.churches), output, 4);
}

function renderRideManifest() {
  var report = reportData_(); var headers = ['Week', 'Church', 'Church ID', 'Status', 'Driver', 'Driver ID', 'Driver Discord', 'Seats', 'Seat Position', 'Rider', 'Member ID', 'Rider Discord', 'Phone', 'Zone', 'Preferences', 'Unassigned Reason']; var output = [['Weekly Ride Manifest'], ['Generated', new Date()]];
  report.churches.forEach(function (church) {
    output.push([], [church.churchName + ' (' + church.churchId + ') — ' + church.weekDate], headers);
    report.rows.filter(function (row) { return row.churchId === church.churchId; }).sort(function (a, b) { return a.driverId.localeCompare(b.driverId) || Number(a.seatPosition) - Number(b.seatPosition); }).forEach(function (row) {
      var driver = report.drivers[row.driverId] || {}; var member = report.members[row.memberId] || {};
      output.push([church.weekDate, church.churchName || '', row.churchId, reportStatus_(row), driver.name || '', row.driverId || '', driver.discordId || '', driver.seatsAvailable || '', row.seatPosition || '', member.name || '', row.memberId, member.discordId || '', member.phone || '', member.zone || '', member.preferences || '', row.unassignedReason || '']);
    });
  });
  writeReport_(reportTabName_('Weekly Ride Manifest', report.churches), output, headers.length);
}

function reportData_() {
  var tables = readTables_(SpreadsheetApp.getActiveSpreadsheet()); var churchById = {}; var churches = [];
  tables.Churches.rows.filter(function (church) { return church.churchId; }).forEach(function (church) { church.weekDate = serviceSunday_(new Date(), church.timezone); churchById[church.churchId] = church; churches.push(church); });
  var members = {}; tables.Members.rows.forEach(function (member) { members[member.memberId] = member; });
  var drivers = {}; tables.Drivers.rows.forEach(function (driver) { drivers[driver.driverId] = driver; });
  var rows = tables.Assignments.rows.filter(function (row) { var church = churchById[row.churchId]; return church && sameWeek_(row.weekDate, church.weekDate); });
  return { churches: churches, churchById: churchById, members: members, drivers: drivers, rows: rows };
}
function reportStatus_(row) { return row.assignmentStatus || (row.driverId ? 'ASSIGNED' : 'UNASSIGNED'); }
function reportTabName_(prefix, churches) { var weeks = churches.map(function (church) { return church.weekDate; }).filter(function (week, index, values) { return values.indexOf(week) === index; }).sort(); return prefix + ' ' + (weeks.length === 1 ? weeks[0] : 'Multiple Weeks'); }
function writeReport_(name, values, columns) { var ss = SpreadsheetApp.getActiveSpreadsheet(); var sheet = ss.getSheetByName(name) || ss.insertSheet(name); var padded = values.map(function (row) { var copy = row.slice(); while (copy.length < columns) copy.push(''); return copy; }); sheet.clearContents(); sheet.getRange(1, 1, padded.length, columns).setValues(padded); sheet.setFrozenRows(1); sheet.autoResizeColumns(1, columns); }
