import * as Sentry from '@sentry/bun';
import dotenv from 'dotenv';
import fs from 'fs';
import middie from '@fastify/middie';
import Fastify from 'fastify';
import { App } from 'octokit';
import { createNodeMiddleware } from '@octokit/webhooks';

// Load environment variables from .env file
dotenv.config();

// Set configured values
const sentryDsn = process.env.SENTRY;
const appId = process.env.APP_ID;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const secret = process.env.WEBHOOK_SECRET;
const newPRs = fs.readFileSync('./message/opened.md', 'utf8');
const mergedPRs = fs.readFileSync('./message/merged.md', 'utf8');
const draftPRs = fs.readFileSync('./message/draft.md', 'utf8');
const lowPriorityMessage = fs.readFileSync('./message/label/lowpriority.md', 'utf8');
const ignoreLabels = ["maintainer"];
const statusLabels = ["status: low priority", "status: needs preview", "status: denied", "status: invalid"];
const reasonLabels = ["reason: abuse risk", "reason: commercial usage", "reason: impersonation", "reason: inaccessible website", "reason: incomplete pr", "reason: incomplete website", "reason: invalid file", "reason: invalid records", "reason: invalid social", "reason: merge conflict", "reason: not dev related", "reason: nsfw", "reason: other", "reason: unauthorized"];

Sentry.init({
    dsn: sentryDsn,
    // Tracing
    tracesSampleRate: 1.0, // Capture 100% of the transactions
    // Enable logs to be sent to Sentry
    enableLogs: true,
    integrations: [Sentry.bunRuntimeMetricsIntegration()],
});

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
    appId,
    privateKey,
    webhooks: {
        secret
    }
});

// Get & log the authenticated app's name
const { data } = await app.octokit.request('/app');

// https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`);

// https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
app.webhooks.on('pull_request.opened', async ({ octokit, payload }) => {
    console.log(`Received a open pull request event for #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
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
        ;
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
        } else {
            console.error(error);
        }
    }
});

// Label system
app.webhooks.on('pull_request.labeled', async ({ octokit, payload }) => {
    let preview, denied, invalid, lowpriority;
    if (payload.label.name === statusLabels[1]){
        preview = true;
    } else if (payload.label.name === statusLabels[2]) {
        denied = true;
    } else if (payload.label.name === statusLabels[3]) {
        invalid = true;
    } else if (payload.label.name === statusLabels[0]) {
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
                }   
            }

            if (preview === true && !listOfLabels.includes("reason: inaccessible website")) {
                let message = fs.readFileSync(`./message/label/inaccessible-website.md`, 'utf8');
                allMessages.push(message);
            };

            const labelMessages = allMessages.join('\n\n');
            const body = `
# Invalid Pull Request

This pull request is invalid due to the following reason(s):

---
${labelMessages}

---

If you need any help, please create an issue or ask our team in the [Discord server](https://discord.gg/is-a-dev-830872854677422150)

`;
            await octokit.rest.issues.createComment({
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                issue_number: payload.pull_request.number,
                body: body
            });
            console.log(`Sent reason messages at #${payload.pull_request.number} from ${payload.repository.name}`);
            if (denied === true) {
                await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    pull_number: payload.pull_request.number,
                    state: 'closed',
                });
                console.log(`Closed pull request at #${payload.pull_request.number} from ${payload.repository.name}`);
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
        try {
            await octokit.rest.issues.createComment({
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                issue_number: payload.pull_request.number,
                body: lowPriorityMessage
            });
            console.log(`Sent low priority message to ${payload.pull_request.number} from ${payload.repository.name}`);
        } catch (error) {
            Sentry.captureException(error);
            fastify.log.error(error);
            if (error.response) {
                console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
            } else {
                console.error(error);
            }
        };
    }
});

// https://github.com/octokit/webhooks.js/?tab=readme-ov-file#webhook-events
app.webhooks.on('pull_request.closed', async ({ octokit, payload }) => {
    console.log(`Received a closed pull request event for #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
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
            ;
            console.log(`Sent a merged message to #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
        } else { return; };
    } catch (error) {
        Sentry.captureException(error);
        fastify.log.error(error);
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
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
