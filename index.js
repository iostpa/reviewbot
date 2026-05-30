import * as Sentry from '@sentry/bun';
import dotenv from 'dotenv';
import fs from 'fs';
import middie from '@fastify/middie';
import Fastify from 'fastify';
import { App } from 'octokit';
import { Octokit } from "@octokit/core";
import { createNodeMiddleware } from '@octokit/webhooks';
import { createAppAuth } from "@octokit/auth-app";
import { CronJob } from 'cron';
const mariadb = require('mariadb');

// Load environment variables from .env file
dotenv.config();

// Set configured values
const sentryDsn = process.env.SENTRY;
const appId = process.env.APP_ID;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;
const installationId = process.env.INSTALLATION_ID;
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const secret = process.env.WEBHOOK_SECRET;
const numberOfDays = 3;
const newPRs = fs.readFileSync('./message/opened.md', 'utf8');
const mergedPRs = fs.readFileSync('./message/merged.md', 'utf8');
const draftPRs = fs.readFileSync('./message/draft.md', 'utf8');
const lowPriorityMessage = fs.readFileSync('./message/label/lowpriority.md', 'utf8');
const ignoreLabels = ["maintainer"];
const reasonLabels = ["reason: abuse risk", "reason: commercial usage", "reason: impersonation", "reason: inaccessible website", "reason: incomplete pr", "reason: incomplete website", "reason: invalid file", "reason: invalid records", "reason: invalid social", "reason: merge conflict", "reason: not dev related", "reason: nsfw", "reason: other", "reason: unauthorized", "reason: incompatible records"];
const unremovableLabels = ["maintainer", "ci: bypass-owner-check", "no-stale", "r: william"];
const reviewerUsernames = ["DEV-DIBSTER", "dragsbruh", "iostpa", "notamitgamer", "omsenjalia", "orangci", "satr14washere", "Stef-00012", "STICKnoLOGIC", "wdhdev", "Yunexiz"];

Sentry.init({
    dsn: sentryDsn,
    // Tracing
    tracesSampleRate: 1.0, // Capture 100% of the transactions
    // Enable logs to be sent to Sentry
    enableLogs: true,
    integrations: [Sentry.bunRuntimeMetricsIntegration()],
});

// Database
// Following order of columns: username, prnumber, time, repoowner, repo
const pool = mariadb.createPool({
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT,
    database: process.env.SQL_DB_NAME,
    ssl: false,
    connectionLimit: 5
});

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
    appId,
    privateKey,
    webhooks: {
        secret
    }
});

// for cron
const installationOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
        appId,
        privateKey,
        installationId,
    },
});

// Get & log the authenticated app's name
const { data } = await app.octokit.request('/app');

// https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`);


function getNumberOfDays(start, end) {
    const date1 = new Date(start);
    const date2 = new Date(end);

    // One day in milliseconds
    const oneDay = 1000 * 60 * 60 * 24;

    // Calculating the time difference between two dates
    const diffInTime = date2.getTime() - date1.getTime();

    // Calculating the no. of days between two dates
    const diffInDays = Math.round(diffInTime / oneDay);

    return diffInDays;
};


// Check if a low priority pull request has been in the database for over 3 days
let job = new CronJob(
    '0 * * * *', // cronTime
    async function () {
        let date = new Date();
        let conn;
        try {
            conn = await pool.getConnection();
            let res = await conn.query(`SELECT * FROM LIST`);
            let resJson = JSON.stringify(res);
            if (resJson !== '[]') {
                let parsed = JSON.parse(resJson);
                for (let i in parsed) {
                    if (getNumberOfDays(parsed[i].time, date) >= numberOfDays) {
                        await conn.query(`DELETE FROM LIST WHERE time=(?)`, [parsed[i].time]);
                        await installationOctokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
                            owner: parsed[i].repoowner,
                            repo: parsed[i].repo,
                            issue_number: parsed[i].prnumber,
                            name: "status: low priority",
                        });
                        console.log(`Removed #${parsed[i].prnumber} from the database since it has existed for 3 or more days.`);
                    }
                }
            } else if (resJson === '[]') {
                return;
            }
        } catch (error) {
            Sentry.captureException(error);
            fastify.log.error(error);
            if (error.response) {
                console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
            } else {
                console.error(error);
            }
        } finally {
            if (conn) conn.end();
        }
    }, // onTick
    null, // onComplete
    true, // start
    'Europe/Bucharest' // timeZone
);

// https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
app.webhooks.on('pull_request.opened', async ({ octokit, payload }) => {
    console.log(`Received a open pull request event for #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
    let conn;
    try {
        const labels = await octokit.rest.issues.listLabelsOnIssue({
            owner: payload.repository.owner.login,
            repo: payload.repository.name, 
            issue_number: payload.pull_request.number
        });
        const allLabels = labels.data.map((label) => label.name);
        if (ignoreLabels.some((label) => allLabels.includes(label))) {
            console.log(`#${payload.pull_request.number} from https://github.com/${payload.repository.full_name} is by a maintainer, skipping pull request.`);
            return;
        } 
        if (payload.pull_request.draft === true) {
            await octokit.rest.issues.createComment({
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                issue_number: payload.pull_request.number,
                body: draftPRs
            });
            console.log(`Sent a draft message to #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
        } else {
            await octokit.rest.issues.createComment({
                owner:payload.repository.owner.login,
                repo: payload.repository.name,
                issue_number: payload.pull_request.number,
                body: newPRs
            });
            console.log(`Sent a opened message to #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
        };
        // low priority check
        conn = await pool.getConnection();
        let res = await conn.query(`SELECT * FROM LIST WHERE username=(?)`, [payload.pull_request.user.login]);
        let resJson = JSON.stringify(res);
        if (resJson !== "[]") {
            let parsed = JSON.parse(resJson);
            let date = new Date();
            if (parsed[0].username === payload.pull_request.user.login && getNumberOfDays(parsed[0].time, date) <= numberOfDays) {
                let lowPriority = `
# Low priority

You're attempting to create a new pull request to bypass the low priority label placed on your previous pull request, #${parsed[0].prnumber}. Unfortunately, we've noticed this attempt, and we're applying the label you were trying to escape on this pull request, too.

If you think this is a mistake then please contact [iostpa](https://github.com/iostpa).   
        `;
                await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: payload.pull_request.number,
                    labels: [
                        'status: low priority'
                    ]
                });
                await octokit.rest.issues.createComment({
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: payload.pull_request.number,
                    body: lowPriority
                });
                await conn.query(`UPDATE LIST SET prnumber=(?) WHERE prnumber=(?)`, [payload.pull_request.number, parsed[0].prnumber]);
                await conn.query(`UPDATE LIST SET time=(?) WHERE prnumber=(?)`, [payload.pull_request.created_at, parsed[0].prnumber]);
                console.log(`Auto-added, replaced with new PR number and sent low priority message to #${payload.pull_request.number} on https://github.com/${payload.repository.full_name} because it was found in the database.`);
            } else if (parsed[0].username === payload.pull_request.user.login && getNumberOfDays(parsed[0].time, date) >= numberOfDays) {
                await octokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: payload.pull_request.number,
                    name: "status: low priority",
                });
                res = await conn.query("DELETE FROM LIST WHERE username=(?)", [parsed[0].username]);
                console.log(`Removed #${payload.pull_request.number} from https://github.com/${payload.repository.full_name} from the low priority database as well as the label.`);
            }
        } else if (resJson === '[]') {
            return;
        }
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
        } else {
            console.error(error);
        }
    } finally {
        if (conn) conn.end();
    }
});

// Label system
app.webhooks.on('pull_request.labeled', async ({ octokit, payload }) => {
    let denied, invalid, lowpriority;
    if (payload.label.name === "status: denied") {
        denied = true;
    } else if (payload.label.name === "status: invalid") {
        invalid = true;
    } else if (payload.label.name === "status: low priority") {
        lowpriority = true;
    }

    if (denied === true || invalid === true) {
        try {
            const listOfLabels = [];
            // timeout so that it creates a little time window for the maintainer to add the rest of the labels
            await new Promise(resolve => setTimeout(resolve, 5000));
            const data = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                pull_number: payload.pull_request.number
            });
            const labelData = data.data.labels;
            for (let i in labelData) {
                if (labelData[i].name) {
                    listOfLabels.push(labelData[i].name);
                }
            }

            // start adding the messages
            const allMessages = [];
            for (let i in listOfLabels) {
                if (reasonLabels.includes(listOfLabels[i])) {
                    let initialReason = listOfLabels[i].toString().replace(/reason:\s/i, '');
                    let finalReason = initialReason.replace(/\s+/g, '-');
                    let message = fs.readFileSync(`./message/label/${finalReason}.md`, 'utf8');
                    allMessages.push(message);
                } else if (listOfLabels[i] === "status: needs preview") {
                    let message = fs.readFileSync(`./message/label/needs-preview.md`, 'utf8');
                    allMessages.push(message);
                };
            }

            const labelMessages = allMessages.join('\n\n');
            let body;
            if (!labelMessages.length) {
                body = fs.readFileSync('./message/invalidnolabel.md', 'utf8');
            } else {
                body = `
# Invalid Pull Request

This pull request is invalid due to the following reason(s):

---
${labelMessages}

---

If you need any help, please create an issue or ask our team in the [Discord server](https://discord.gg/is-a-dev-830872854677422150)

`;
            };
            await octokit.rest.issues.createComment({
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                issue_number: payload.pull_request.number,
                body: body
            });
            console.log(`Sent reason messages at #${payload.pull_request.number} from https://github.com/${payload.repository.full_name}`);
            if (denied === true) {
                await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    pull_number: payload.pull_request.number,
                    state: 'closed',
                });
                console.log(`Closed pull request at #${payload.pull_request.number} from https://github.com/${payload.repository.full_name}`);
            };
        } catch (error) {
            Sentry.captureException(error);
            fastify.log.error(error);
            if (error.response) {
                console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
            } else {
                console.error(error);
            }
        };
    } else if (lowpriority === true) {
        let conn;
        try {
            conn = await pool.getConnection();
            let res = await conn.query(`SELECT * FROM LIST WHERE username=(?)`, [payload.pull_request.user.login]);
            let resJson = JSON.stringify(res);
            if (resJson === "[]") {
                await octokit.rest.issues.createComment({
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: payload.pull_request.number,
                    body: lowPriorityMessage
                });
                console.log(`Sent low priority message to #${payload.pull_request.number} from https://github.com/${payload.repository.full_name}`);
                await conn.query("INSERT INTO LIST VALUES (?, ?, ?, ?, ?)", [payload.pull_request.user.login, payload.pull_request.number, payload.pull_request.created_at, payload.repository.owner.login, payload.repository.name]);
                console.log(`Logged #${payload.pull_request.number} from https://github.com/${payload.repository.full_name} to the low priority database.`);
            }
        } catch (error) {
            Sentry.captureException(error);
            fastify.log.error(error);
            if (error.response) {
                console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
            } else {
                console.error(error);
            }
        } finally {
            if (conn) conn.end();
        };
    }
});

// https://github.com/octokit/webhooks.js/?tab=readme-ov-file#webhook-events
app.webhooks.on('pull_request.closed', async ({ octokit, payload }) => {
    console.log(`Received a closed pull request event for #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
    let conn;
    try {
        if (payload.pull_request.merged === true) {
            const labels = await octokit.rest.issues.listLabelsOnIssue({
                owner: payload.repository.owner.login,
                repo: payload.repository.name, 
                issue_number: payload.pull_request.number
            });
            const allLabels = labels.data.map((label) => label.name);
            if (ignoreLabels.some((label) => allLabels.includes(label))) {
                return;
            } 
            await octokit.rest.issues.createComment({
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                issue_number: payload.pull_request.number,
                body: mergedPRs
            });
            console.log(`Sent a merged message to #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
            
            // remove almost all labels if there are any
            const listOfLabels = [];
            const data = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                pull_number: payload.pull_request.number
            });

            const labelData = data.data.labels;
            for (let i in labelData) {
                if (labelData[i].name) {
                    listOfLabels.push(labelData[i].name);
                }
            }       

            for (let i in listOfLabels) {
                if (!listOfLabels.includes(unremovableLabels)) {
                    await octokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
                        owner: payload.repository.owner.login,
                        repo: payload.repository.name,
                        issue_number: payload.pull_request.number,
                        name: listOfLabels[i],
                    });
                } else if (listOfLabels[i] == "status: low priority") {
                    return;
                } else if (unremovableLabels.includes(listOfLabels[i])) {
                    return;
                }
            }
            console.log(`Removed all labels from #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
        } else {
            conn = await pool.getConnection();
            let res = await conn.query(`SELECT * FROM LIST WHERE username=(?)`, [payload.pull_request.user.login]);
            let resJson = JSON.stringify(res);
            if (resJson !== "[]") {
                let parsed = JSON.parse(resJson);
                if (reviewerUsernames.includes(payload.sender.login)) {
                    res = await conn.query("DELETE FROM LIST WHERE username=(?)", [parsed[0].username]);
                    await octokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
                        owner: payload.repository.owner.login,
                        repo: payload.repository.name,
                        issue_number: payload.pull_request.number,
                        name: "status: low priority",
                    });
                    console.log(`Removed #${payload.pull_request.number} from https://github.com/${payload.repository.full_name} from the low priority database as well as the label.`);
                }
            }
        };
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
        } else {
            console.error(error);
        }
    } finally {
        if (conn) conn.end();
    }
});

app.webhooks.on('pull_request.unlabeled', async ({ payload }) => {
    let conn;
    try {
        if (payload.label.name === "status: low priority") {
            conn = await pool.getConnection();
            let res = await conn.query(`SELECT * FROM LIST WHERE username=(?)`, [payload.pull_request.user.login]);
            let resJson = JSON.stringify(res);
            if (resJson !== "[]") {
                res = await conn.query("DELETE FROM LIST WHERE username=(?)", [payload.pull_request.user.login]);
                console.log(`Removed #${payload.pull_request.number} from https://github.com/${payload.repository.full_name} from the low priority database.`);
            } else {
                return;
            }
        }
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
        } else {
            console.error(error);
        }
    } finally {
        if (conn) conn.end();
    }
});

// Handle errors
app.webhooks.onError((error) => {
    Sentry.captureException(error);
    fastify.log.error(error);
    if (error.name === 'AggregateError') {
    // Log Secret verification errors
        console.log(`Error processing request: ${error.event}`);
    } else {
        console.log(error);
    }
});

// Launch a web server to listen for GitHub webhooks
const port = process.env.PORT || 3000;
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
const webhookPath = '/api/webhook';
const localWebhookUrl = `http://${host}:${port}${webhookPath}`;

// https://github.com/octokit/webhooks.js/#createnodemiddleware
const middleware = createNodeMiddleware(app.webhooks, { path: webhookPath });

const fastify = Fastify({
    logger: false
});
await fastify.register(middie);
fastify.use(middleware);

await fastify.listen({ port, host });

console.log(`Server is listening for events at: ${localWebhookUrl}`);
console.log('Press Ctrl + C to quit.');

/*
Standard node http server (use "import http from 'http' if you want to use this instead of Fastify")
http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`)
  console.log('Press Ctrl + C to quit.')
})
*/