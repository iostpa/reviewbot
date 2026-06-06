import * as Sentry from '@sentry/bun';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import middie from '@fastify/middie';
import Fastify from 'fastify';
import { App } from 'octokit';
import { createNodeMiddleware } from '@octokit/webhooks';
import { CronJob } from 'cron';
import { getNumberOfDays } from './tools/numberofdays';
import { unlabeled } from './webhooks/unlabeled';
import { opened } from './webhooks/opened';
import { closed } from './webhooks/closed';
import { labeled } from './webhooks/labeled';
const mariadb = require('mariadb');

// Load environment variables from .env file
dotenv.config();

// Set configured values
const sentryDsn = process.env.SENTRY;
const appId = process.env.APP_ID;
const installationId = process.env.INSTALLATION_ID;
const privateKey = fs.readFileSync(
    path.resolve(process.env.PRIVATE_KEY_PATH),
    'utf8'
);
const secret = process.env.WEBHOOK_SECRET;
export const numberOfDays = 3;

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
export const pool = mariadb.createPool({
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT,
    database: process.env.SQL_DB_NAME,
    ssl: false,
    connectionLimit: 5,
});

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
    appId,
    privateKey,
    webhooks: {
        secret,
    },
});

const appOctokit = await app.getInstallationOctokit(installationId);

/*
saving this for incase

const installationOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
        appId,
        privateKey,
        installationId,
    },
});
*/

// Get & log the authenticated app's name
const { data } = await app.octokit.request('/app');

// https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`);

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
                        await conn.query(`DELETE FROM LIST WHERE time=(?)`, [
                            parsed[i].time,
                        ]);
                        await appOctokit.request(
                            'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
                            {
                                owner: parsed[i].repoowner,
                                repo: parsed[i].repo,
                                issue_number: parsed[i].prnumber,
                                name: 'status: low priority',
                            }
                        );
                        console.log(
                            `Removed #${parsed[i].prnumber} from the database since it has existed for 3 or more days.`
                        );
                    }
                }
            } else if (resJson === '[]') {
                return;
            }
        } catch (error) {
            Sentry.captureException(error);
            fastify.log.error(error);
            if (error.response) {
                console.error(
                    `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
                );
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

app.webhooks.on('pull_request.opened', async ({ payload }) => {
    try {
        await opened(
            appOctokit,
            payload.repository.owner.login,
            payload.repository.name,
            payload.repository.full_name,
            payload.pull_request.number,
            payload.pull_request.user.login,
            payload.pull_request.draft
        );
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(
                `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
            );
        } else {
            console.error(error);
        }
    }
});

// https://github.com/octokit/webhooks.js/?tab=readme-ov-file#webhook-events
app.webhooks.on('pull_request.closed', async ({ payload }) => {
    console.log(
        `Received a closed pull request event for #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`
    );
    try {
        await closed(
            appOctokit,
            payload.pull_request.merged,
            payload.repository.owner.login,
            payload.repository.name,
            payload.repository.full_name,
            payload.pull_request.number,
            payload.pull_request.user.login,
            payload.sender.login
        );
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(
                `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
            );
        } else {
            console.error(error);
        }
    }
});

// Label system
app.webhooks.on('pull_request.labeled', async ({ payload }) => {
    try {
        await labeled(
            appOctokit,
            payload.label.name,
            payload.repository.owner.login,
            payload.repository.name,
            payload.repository.full_name,
            payload.pull_request.number,
            payload.pull_request.updated_at,
            payload.pull_request.user.login
        );
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(
                `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
            );
        } else {
            console.error(error);
        }
    }
});

app.webhooks.on('pull_request.unlabeled', async ({ payload }) => {
    try {
        await unlabeled(
            payload.label.name,
            payload.pull_request.user.login,
            payload.pull_request.number,
            payload.repository.full_name
        );
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(
                `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
            );
        } else {
            console.error(error);
        }
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
    logger: false,
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
