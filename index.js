// @flow

const Client = require('github');

require('dotenv').config();

var owner = process.env.REPO_OWNER;
var repo = process.env.REPO_NAME;

var authorizedUsers = [
  'tcr',
  'frijol',
  'rwaldron',
  'hipsterbrown',
];

var github = new Client({
    debug: false,
    Promise: Promise
});

// oauth 
github.authenticate({
    type: "oauth",
    token: process.env.GITHUB_TOKEN
});


function issueTemplate(lastprid: string, date: string, prid: string, names: Array<string>) {
  let moderator = names.shift();
  let notetaker = names.shift();
  let persons = names.length ? names.join(', ') : '(none)'
  return `
**Moderator:** ${moderator}  
**Notetaker:** ${notetaker}  
**Attending:** ${persons}  

<details>
<summary>Links for moderators</summary>

* [Edit link for meeting notes.](https://github.com/tessel/project/edit/sc-agenda-${prid}/meetings/${date}.md)
* [Meeting notes once they've been posted.](https://github.com/tessel/project/blob/master/meetings/${date}.md)
* Previous agenda: #${lastprid}
</details>

## Agenda

* [ ] Last week's action items
* [ ] Working Group Updates
`;
}


let notesTemplate = `
# Meeting DATE

**Moderator:** NAME  
**Notetaker:** NAME  
**Attending:** NAMES  

## Agenda

* ...

## Notes

* ...

## Action items

* ...
`;

function createBranch(name) {
  return github.gitdata.getReference({
    owner,
    repo,
    ref: 'heads/master',
  })
  .then(res => {
    let sha = res.data.object.sha;

    return github.gitdata.createReference({
      owner,
      repo,
      ref: `refs/heads/${name}`,
      sha: sha
    })
    .catch(res => {
      return github.gitdata.updateReference({
        owner,
        repo,
        ref: `heads/${name}`,
        sha: sha,
        force: true,
      })
    })
  })
}


function createIssue(lastprid: string, date: string, names: Array<string>) {
  let humandate = moment(chrono.parseDate(date)).format('ddd, MMM Do, YYYY');

  console.log('creating issue');
  github.issues.create({
    owner,
    repo,
    title: `SC Meeting for ${humandate}`,
    body: '(placeholder)',
  })
  .then(res => {
    let prid = res.data.number;
    let out = issueTemplate(lastprid, date, prid, names);
    console.log('updating issue');
    return updateIssue(date, String(prid), out);
  })
  .catch(err => {
    console.error(err);
  })
}

function updateIssue(date: string, prid: string, body: string) {
  let humandate = moment(chrono.parseDate(date)).format('ddd, MMM Do, YYYY');

  console.log('-- editing issue');
  github.issues.edit({
    owner,
    repo,
    number: Number(prid),
    title: `SC Meeting for ${humandate}`,
    body,
  })
  .then(res => {
    console.log('-- creating branch');
    return createBranch(`sc-agenda-${prid}`)
    .then(res => {
      console.log(res)
      return res;
    })
  })
  .then(res => {
    console.log('-- creating file');
    return github.repos.createFile({
      owner,
      repo,
      path: `meetings/${date}.md`,
      message: `Created ${date}.md`,
      content: new Buffer(notesTemplate).toString('base64'),
      branch: `sc-agenda-${prid}`,
    })
    .then(res => {
      console.log(res)
      return res;
    })
  })
  .then(_ => {
    console.log('-- creating pr');
    return github.pullRequests.create({
      owner,
      repo,
      title: `Created ${date}.md`,
      base: 'master',
      head: `sc-agenda-${prid}`,
      body: `Closes #${prid}.`,
    })
  })
  .then(res => {
    console.log(res)
  })
  .catch(err => {
    console.error(err);
  })
}

var chrono = require('chrono-node')
var moment = require('moment');
var bodyParser = require('body-parser');
const express = require('express')

const app = express()

app.use(bodyParser.json())

app.use(function (req, res, next) {
  if (req.query.secret != process.env.SCBOT_SECRET) {
    res.status(401);
    res.send('Unauthorized');
    return;
  }
  return next();
});

app.get('/', function (req, res) {
  res.send('scbot hello');
});

app.post('/', function (req, res) {
  let json = req.body;
  if (json.action == 'created' && ('comment' in json)) {
    let issue = json.issue.number;
    let body = json.comment.body;
    let user = json.comment.user.login;
    if (authorizedUsers.indexOf(user) != -1) {
      handleCommand(body, issue);
    }
  }
  res.json("cool")
})

app.listen(process.env.PORT, function () {
  console.log(`Example app listening on port ${process.env.PORT}!`)
})

function handleCommand(text: string, issue: string) {
  if (!text || (text.indexOf('#scbot') == -1) || (text.indexOf('```') != -1)) {
    return;
  }
  text = text.replace(/#scbot/, '');
  let keyword = (text.match(/\S+/) || ['null'])[0];
  text = text.replace(/\S+/, '');

  if (keyword == 'update') {
    let res = chrono.parseDate(text.match(/^\s+$/) ? 'today' : text);
    let fulldate = moment(res).format('YYYY-MM-DD');

    let humandate = moment(chrono.parseDate(fulldate)).format('ddd, MMM Do, YYYY');

    github.issues.get({
      owner,
      repo,
      number: Number(issue),
    })
    .then(res => {
      let content = res.data.body;

      let newContent = content.replace(/\d\d\d\d\-\d\d\-\d\d/g, fulldate);

      updateIssue(fulldate, issue, newContent);
    })
    .then(res => {
      console.log('success in `update` to', fulldate);
    })
    .catch(err => {
      console.log(err);
    })
  }
  else if (keyword == 'add') {
    text = text.replace(/^\s*|\s*$/g, '');

    github.issues.get({
      owner,
      repo,
      number: Number(issue),
    })
    .then(res => {
      let content = res.data.body;

      let newContent = content.replace(/\s*$/, '') + '\n* [ ] ' + text + '\n';

      github.issues.edit({
        owner,
        repo,
        number: Number(issue),
        body: newContent,
      })
      .then(res => {
        console.log('success in `add` of', text);
      })
      .catch(err => {
        console.log(err);
      })
    });
  }
  else if (keyword == 'schedule') {
    let names = text.match(/@\S+/g,);
    text = text.replace(/@\S+/g, '');

    let res = chrono.parseDate(text.match(/^\s+$/) ? 'today' : text);
    let fulldate = moment(res).format('YYYY-MM-DD');

    console.log('executing `schedule`:', keyword, names, fulldate);

    createIssue(String(issue), fulldate, names);
  }
  else if (keyword == 'help') {
    //TODO
    github.issues.createComment({
      owner,
      repo,
      number: Number(issue),
      body: `
\`\`\`
#scbot help:

    schedule <date> <@moderator> <@notetaker> <@participants...>
        schedule next meeting
    update [<date>]
        updates date of current issue to <date> or today
    add [<contents of bullet>]
        add an item to the current agenda
    help
        posts this help
\`\`\`
      `,
    })
    .then(res => {
      console.log('success in `help`');
    })
    .catch(err => {
      console.log(err);
    });
  } else {
    github.issues.createComment({
      owner,
      repo,
      number: Number(issue),
      body: `
\`\`\`
Unknown command ${keyword.substr(0, 32)}.

#scbot help:

    schedule <date> <@moderator> <@notetaker> <@participants...>
        schedule next meeting
    update [<date>]
        updates date of current issue to <date> or today
    add [<contents of bullet>]
        add an item to the current agenda
    help
        posts this help
\`\`\`
      `,
    })
    .then(res => {
      console.log('success in `help`');
    })
    .catch(err => {
      console.log(err);
    });
  }
}
