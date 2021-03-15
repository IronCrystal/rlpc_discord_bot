var spreadsheetHelper = require('./spreadsheet_helper.js');

const Discord = require('discord.js');
const bot = new Discord.Client();
var auth = require('./auth.json');

const playerDataFields = [
  'Username',
  'Platform',
  'Sheet MMR',
  'Team',
  'League',
  'Tracker MMR',
  'Contract Length (Seasons)',
  'Seasons Remaining Under Contract (Including this one)',
  'Notes',
  'Discord ID',
  'Tracker'
];

const teamDataFields = [
  'GM',
  'AGM',
  'Captain',
  // 'League',
  'Players'
];

spreadsheetHelper.updateSpreadsheetData(function(err) {
  if (err) console.error('Error loading spreadsheet data');
  else console.log('Loaded spreadsheet data');
})

bot.login(auth.token);

bot.on('ready', () => {
  console.info(`Logged in as ${bot.user.tag}!`);
});

bot.on('message', message => {
  if (message && (message.author === bot.user || message.author.bot || !message.guild)) return;

  else if (message && message.guild && message.guild.id) {
    if (message && message.content && message.content.startsWith('!rlpc')) {
     _sendPlayerOrTeamStats(message);
    }
  }
});

function _sendPlayerOrTeamStats(message) {
  let discordId = null;

  let playerName = message.content.replace('!rlpc', '').trim();

  if (playerName.startsWith('<@!')) {
    discordId = playerName.replace('<@!', '').replace('>', '');
  }

  if (discordId) {
    spreadsheetHelper.getDataForPlayerOrTeam({discordId}, function(err, playerData) {
      if (err && err === 'Player not found') {
        message.channel.send(`Player <@${discordId}> not found`);
      }
      else if (err) {
        message.channel.send('Internal Error retrieving player stats');
        console.error(err);
      }
      else _sendPlayerDataEmbed(message, playerData);
    });
  }
  else if (playerName) {
    spreadsheetHelper.getDataForPlayerOrTeam({playerName}, function(err, data, isPlayerData) {
      if (err && err === 'Player not found') {
        message.channel.send(`Player or team ${playerName} not found`);
      }
      else if (err) {
        message.channel.send('Internal Error retrieving player stats');
        console.error(err);
      }
      else if (isPlayerData) _sendPlayerDataEmbed(message, data);
      else _sendTeamDataEmbed(message, data);
    });
  }
  else {
    //lookup author
    discordId = message.author.id;
    spreadsheetHelper.getDataForPlayerOrTeam({discordId}, function(err, playerData) {
      if (err && err === 'Player not found') {
        message.channel.send(`Player <@${discordId}> not found`);
      }
      else if (err) {
        message.channel.send('Internal Error retrieving player stats');
        console.error(err);
      }
      else _sendPlayerDataEmbed(message, playerData);
    });
  }
}

function _sendPlayerDataEmbed(message, playerData) {

  let embedObj = {
    fields: []
  }

  _getDiscordUserAvatarUrl(playerData['Discord ID'], function(err, url) {
    if (err) {
      message.channel.send('Internal Error retrieving player stats');
      console.error(err);
    }
    else {
      embedObj.thumbnail = {url};
      embedObj.color = '0x0099ff';

      playerDataFields.forEach(function(key) {
        if (key && playerData[key]) {
          let obj = {
            name: key,
            value: playerData[key],
            inline: true
          };

          if (key === 'Tracker') obj.inline = false;
          embedObj.fields.push(obj);
        }
      });
      message.channel.send({ embed: embedObj });
    }
  });
}

function _sendTeamDataEmbed(message, teamData) {
  let embedObj = {
    fields: []
  };

  embedObj.thumbnail = {url: teamData.logo};
  embedObj.title = teamData.Team + ' | ' + teamData.League;
  embedObj.color = '0x0099ff';
  // embedObj.description = 'This is where a description goes';
  // embedObj.url = 'https://google.com';
  // embedObj.image = {
    // url: teamData.logo
  // };
  // embedObj.timestamp = new Date();
  // embedObj.footer = {
  //   text: 'This is where the footer goes',
  //   icon_url: teamData.logo
  // }
  // embedObj.footer = {
  //   text: teamData.League
  // }

  teamDataFields.forEach(function(key) {
    if (key && (teamData[key] || teamData[key] === 0)) {
      let obj = {
        name: key,
        value: teamData[key],
        inline: true
      };

      if (key === 'Players' && teamData[key].length) {
        obj.inline = true;
        embedObj.fields.push(obj);
      }
      else if (key !== 'Players') embedObj.fields.push(obj);
    }
  });

  let wlgd = teamData['Wins'] + ' / ' + teamData['Losses'] + ' / ' + teamData['GD'];
  embedObj.fields.push({
    name: 'Win/Loss/GD',
    value: wlgd,
    inline: true
  });
  
  message.channel.send({ embed: embedObj });
}

function _getDiscordUserAvatarUrl(discordId, callback) {
  let user = bot.users.fetch(discordId)
  .then(function(user) {
    let avatar = user.avatar;

    let extension = (user.avatar.startsWith('a_')) ? '.gif' : '.png';
    callback(null, `https://cdn.discordapp.com/avatars/${discordId}/${avatar}${extension}`);
  })
  .catch(function(err) {
    callback(err);
  });
}