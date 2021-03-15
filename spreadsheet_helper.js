var request = require('request');
var queryString = require('query-string');
var csvParser = require('csv-parser');
var _ = require('lodash');
var fs = require('fs');
var vasync = require('vasync');

const SPREADSHEET_ID = '1AJoBYkYGMIrpe8HkkJcB25DbLP2Z-eV7P6Tk9R6265I';
const PLAYER_SHEET_ID = '330867349';

const rosterSpreadsheets = [
  {league: 'Major', gid: '904626655', spreadsheetId: '1AJoBYkYGMIrpe8HkkJcB25DbLP2Z-eV7P6Tk9R6265I'},
  {league: 'AAA', gid: '924415090', spreadsheetId: '1AJoBYkYGMIrpe8HkkJcB25DbLP2Z-eV7P6Tk9R6265I'},
  {league: 'AA', gid: '1373839815', spreadsheetId: '1AJoBYkYGMIrpe8HkkJcB25DbLP2Z-eV7P6Tk9R6265I'},
  {league: 'A', gid: '511388180', spreadsheetId: '1AJoBYkYGMIrpe8HkkJcB25DbLP2Z-eV7P6Tk9R6265I'},
  {league: 'Independent', gid: '587751309', spreadsheetId: '1bWvgo_YluMbpQPheldQQZdASKGHRPIUVfYL2r2KSdaE'},
  {league: 'Maverick', gid: '511388180', spreadsheetId: '1bWvgo_YluMbpQPheldQQZdASKGHRPIUVfYL2r2KSdaE'}
];

const TEAM_LOGO_GID = '161785171';

var rosters = {};
var teamLogoUrls = {};

let allPlayerDataGroupedByDiscordId = {};
let allPlayerDataGroupedByPlayerName = {};

let timeLastUpdatedData = 0;

module.exports.getDataForPlayerOrTeam = _getDataForPlayerOrTeam;

function _getDataForPlayerOrTeam(options, callback) {
  console.log('Calling _getDataForPlayer', options);
  if (!options.discordId && !options.playerName) return callback(new Error('Must include discordId or playerName'));

  if (Date.now() - timeLastUpdatedData > 3600000) {
    console.log('Getting all spreadsheet data', )
    _updateSpreadsheetData(function(err) {
      if (err) callback(err);
      else _getPlayerOrTeamData(options, callback);
    });
  }
  else {
    console.log('Data is cached');
    _getPlayerOrTeamData(options, callback);
  }
}

function _getPlayerOrTeamData(options, callback) {
  console.log('Get player data', options);
  if (options.discordId) {
    if (allPlayerDataGroupedByDiscordId && allPlayerDataGroupedByDiscordId[options.discordId] && allPlayerDataGroupedByDiscordId[options.discordId][0]) callback(null, allPlayerDataGroupedByDiscordId[options.discordId][0], true);
    else callback('Player not found');
  }
  else if (options.playerName) {
    if (allPlayerDataGroupedByPlayerName && allPlayerDataGroupedByPlayerName[options.playerName.toLowerCase()]) callback(null, allPlayerDataGroupedByPlayerName[options.playerName.toLowerCase()], true);
    else if (rosters && rosters[options.playerName.toLowerCase()]) callback(null, rosters[options.playerName.toLowerCase()], false);
    else callback('Player not found');
  }
  else callback(new Error('Player or discord id not provided'));
}

module.exports.updateSpreadsheetData = _updateSpreadsheetData;

function _updateSpreadsheetData(callback) {
  vasync.pipeline({
    arg: {},
    funcs: [
      function _loadPlayerData(arg, done) {
        _getAllPlayerData(function(err, playerData) {
          if (err) done(err);
          else {
            allPlayerDataGroupedByDiscordId = _.groupBy(playerData, 'Discord ID');
            allPlayerDataGroupedByPlayerName = {};
            playerData.forEach(function(row) {
              if (row && row.Username) {
                allPlayerDataGroupedByPlayerName[row.Username.toLowerCase()] = row;
              }
            });
            done();
          }
        });
      },
      function _loadRosterData(arg, done) {
        loadRosterData(done);
      }
    ]
  }, function(err) {
    if (err) callback(err);
    else {
      timeLastUpdatedData = Date.now();
      callback();
    }
  });
}

function _getAllPlayerData(callback) {
  let getRequestParams = {
    method: 'GET',
    url: _getGoogleDocDownloadUrl(SPREADSHEET_ID, PLAYER_SHEET_ID)
  };

  let results = [];

  request(getRequestParams)
  .on('response', function(response) {
    if (response.statusCode !== 200) console.error('STATUS CODE', response.statusCode);
  })
  .pipe(csvParser())
  .on('data', function (data) {
    results.push(data);
  })
  .on('error', function(err) {
    callback(err);
  })
  .on('end', function() {
    callback(null, results);
  });
}

function _getGoogleDocDownloadUrl(docId, sheetId) {
  //?format=csv
  //&id=1AJoBYkYGMIrpe8HkkJcB25DbLP2Z-eV7P6Tk9R6265I
  //&gid=330867349
  let baseUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?`;

  let queryParams = {
    format: 'csv',
    id: docId,
    gid: sheetId
  };

  return baseUrl + queryString.stringify(queryParams);
}

module.exports.loadRosterData = loadRosterData;

function loadRosterData(callback) {
  vasync.forEachPipeline({
    inputs: rosterSpreadsheets,
    func: _processLeagueRosters
  }, function(err) {
    if (err) callback(err);
    else _loadTeamLogos(callback);
  });
}

function _processLeagueRosters(rosterObj, done) {
  let {league, gid, spreadsheetId} = rosterObj;

  let getRequestParams = {
    method: 'GET',
    url: _getGoogleDocDownloadUrl(spreadsheetId, gid)
  };

  request(getRequestParams, function(err, response, body) {
    if (err) done(err);
    else {
      _processRoster(body, league);
      done();
    }
  });
};

function _processRoster(file, league) {
  let lineSplits = file.split('\n');

  let currentTeam = [];
  let currentCaptain = '';
  let currentGM = '';
  let currentAGM = '';
  let currentWins = 0;
  let currentLosses = 0;
  let currentGD = 0;

  lineSplits.forEach(function(row) {
    let columnSplits = row.split(',');
    let playerName = columnSplits[14];
    let isCaptain = !!(columnSplits[13]);
    let teamName = columnSplits[6];
    let WLGDStatName = columnSplits[7];
    let WLGDStatValue = columnSplits[8];
    let GM = columnSplits[23];
    if (GM.startsWith('GM: ')) currentGM = GM.substring(3).trim();
    if (GM.startsWith('AGM: ')) currentAGM = GM.substring(4).trim();
    if (isCaptain) currentCaptain = playerName;
    if (WLGDStatName === 'W') currentWins = parseInt(WLGDStatValue);
    if (WLGDStatName === 'L') currentLosses = parseInt(WLGDStatValue);
    if (WLGDStatName === 'GD') currentGD = parseInt(WLGDStatValue);
    if (playerName && playerName !== '#REF!' && playerName !== 'Players' && !isCaptain) {
      currentTeam.push(playerName);
    }
    if (teamName && teamName !== 'Team' && teamName !== '#N/A') {
      let key = teamName.toLowerCase();
      rosters[key] = {
        Team: teamName,
        League: league,
        Players: currentTeam,
        GM: currentGM,
        AGM: currentAGM,
        Captain: currentCaptain,
        Wins: currentWins,
        Losses: currentLosses,
        GD: currentGD
      };
      currentTeam = [];
      currentCaptain = '';
      currentGM = '';
      currentAGM = '';
      currentWins = 0;
      currentLosses = 0;
      currentGD = 0;
    }
  });
}

module.exports.loadTeamLogos = _loadTeamLogos;

function _loadTeamLogos(callback) {
  let getRequestParams = {
    method: 'GET',
    url: _getGoogleDocDownloadUrl(SPREADSHEET_ID, TEAM_LOGO_GID)
  };

  request(getRequestParams)
  .on('response', function(response) {
    if (response.statusCode !== 200) console.error('Non-200 response code', response.statusCode);
  })
  .pipe(csvParser())
  .on('data', function(row) {
    let teamName = row.Team.toLowerCase();
    let logo = row.Logo;
    if (teamName && logo) {
      if (!rosters[teamName]) rosters[teamName] = {};
      rosters[teamName].logo = logo;
    }
  })
  .on('error', function(err) {
    console.error(err);
    callback(err);
  })
  .on('end', function() {
    callback();
  });
}