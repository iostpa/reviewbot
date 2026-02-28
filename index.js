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
const success = fs.readFileSync('./message/success.md', 'utf8');

Sentry.init({
    dsn: sentryDsn,
    // Tracing
    tracesSampleRate: 1.0, // Capture 100% of the transactions
    // Enable logs to be sent to Sentry
    enableLogs: true,
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
        if (payload.pull_request.draft === true) {
            await octokit.rest.issues.createComment({
                owner:payload.repository.owner.login,
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
    } catch (error) {
        Sentry.captureException(error);
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
        } else {
            console.error(error);
        }
    }
});

// https://github.com/octokit/webhooks.js/?tab=readme-ov-file#webhook-events
app.webhooks.on('pull_request.closed', async ({ octokit, payload }) => {
    console.log(`Received a closed pull request event for #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
    try {
        if (payload.pull_request.merged === true) {
            await octokit.rest.issues.createComment({
                owner:payload.repository.owner.login,
                repo: payload.repository.name,
                issue_number: payload.pull_request.number,
                body: mergedPRs
            });
            console.log(`Sent a merged message to #${payload.pull_request.number} on https://github.com/${payload.repository.full_name}`);
        } else { return; };
    } catch (error) {
        Sentry.captureException(error);
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
        } else {
            console.error(error);
        }
    }
});

// Check if the workflow ran succesfully
app.webhooks.on('workflow_run.completed', async ({ octokit, payload }) => {
    try {
        if (payload.workflow_run.event === "pull_request") {
            const pr = payload.workflow_run.pull_requests[0];
            if (payload.workflow_run.conclusion === "success") {
                console.log(`Workflow passed in #${pr.number} on https://github.com/${payload.repository.full_name}, sending success message!`); 
                await octokit.rest.issues.createComment({
                    owner:payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: pr.number,
                    body: success
                });
                console.log(`Succesfully sent the success message for #${pr.number} on https://github.com/${payload.repository.full_name}`);
            } else { return; };
        } else { return; };
    } catch (error) {
        Sentry.captureException(error);
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`);
        } else {
            console.error(error);
        }
    }
});

// Check if the workflow failed
app.webhooks.on('workflow_job.completed', async ({ octokit, payload }) => {
    try {
        if (payload.workflow_job.conclusion === "failure") {
            const actions = await octokit.request(`GET ${payload.workflow_job.run_url}`);
            if (actions.data.event === "pull_request") {
                const pr = actions.data.pull_requests[0];
                console.log(`Workflow failed in #${pr.number} on https://github.com/${payload.repository.full_name}, sending failed message!`);
                const logs = await octokit.request(`GET /repos/${payload.repository.owner.login}/${payload.repository.name}/actions/jobs/${payload.workflow_job.id}/logs`);
                const logsText = logs.data;
                const removeTime = logsText.split('\n').map(line => line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+/, ''));
                const start1 = removeTime.findIndex(line => line.includes("##[group]Run npx ava tests/*.test.js --timeout=1m"));
                const start2 = removeTime.findIndex((line, i) => i > start1 && line.includes("##[endgroup]"));
                const end = removeTime.findIndex(line => line.includes("##[error]Process completed with exit code 1."));
                const finalLogs = removeTime.slice(start2 + 2, end);
                // did this to make my life easier
                const failed = `
# Checks failed!

The checks for the pull request has failed, please check the following logs below this message. If you don't know why it failed, wait for a maintainer to review the pull request, ask in a GitHub issue or ask in the Discord server.

<details>
<summary><h3>Error logs</h3></summary>

~~~
${finalLogs.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
~~~

</details>
`;
                await octokit.rest.issues.createComment({
                    owner:payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: pr.number,
                    body: failed
                });
                console.log(`Succesfully sent the failed message for #${pr.number} on https://github.com/${payload.repository.full_name}`);
            } else { 
                return;
            }
        } else {
            return;
        }
    } catch (error) {
        Sentry.captureException(error);
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
const path = '/api/webhook';
const localWebhookUrl = `http://${host}:${port}${path}`;

// https://github.com/octokit/webhooks.js/#createnodemiddleware
const middleware = createNodeMiddleware(app.webhooks, { path });

const fastify = Fastify({
    logger: false
});
await fastify.register(middie);
fastify.use(middleware);

fastify.listen({ port }, () => {
    console.log(`Server is listening for events at: ${localWebhookUrl}`);
    console.log('Press Ctrl + C to quit.');
});

/*
Standard node http server (use "import http from 'http' if you want to use this instead of Fastify")
http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`)
  console.log('Press Ctrl + C to quit.')
})
*/
