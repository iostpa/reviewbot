import * as Sentry from '@sentry/node'
import dotenv from 'dotenv'
import fs from 'fs'
import http from 'http'
import { App } from 'octokit'
import { createNodeMiddleware } from '@octokit/webhooks'

// Load environment variables from .env file
dotenv.config()

// Set configured values
const sentryDsn = process.env.SENTRY
const appId = process.env.APP_ID
const privateKeyPath = process.env.PRIVATE_KEY_PATH
const privateKey = fs.readFileSync(privateKeyPath, 'utf8')
const secret = process.env.WEBHOOK_SECRET
const newPRs = fs.readFileSync('./message/opened.md', 'utf8')
const mergedPRs = fs.readFileSync('./message/merged.md', 'utf8')
const draftPRs = fs.readFileSync('./message/draft.md', 'utf8')

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret
  }
})

// Get & log the authenticated app's name
const { data } = await app.octokit.request('/app')

Sentry.init({
  dsn: sentryDsn,
  // Tracing
  tracesSampleRate: 1.0 // Capture 100% of the transactions
})

// https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`)

// https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
app.webhooks.on('pull_request.opened', async ({ octokit, payload }) => {
  console.log(`Received a pull request event for #${payload.pull_request.number}`)
  try {
    if (payload.pull_request.draft === true) {
      await octokit.rest.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
        body: draftPRs
      })
    } else {
      await octokit.rest.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
        body: newPRs
      })
    };
  } catch (error) {
    Sentry.captureException(error)
    if (error.response) {
      console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`)
    } else {
      console.error(error)
    }
  }
})

// https://github.com/octokit/webhooks.js/?tab=readme-ov-file#webhook-events
app.webhooks.on('pull_request.closed', async ({ octokit, payload }) => {
  console.log(`Received a pull request event for #${payload.pull_request.number}`)
  try {
    if (payload.pull_request.merged === true) {
      await octokit.rest.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
        body: mergedPRs
      })
    } else { return };
  } catch (error) {
    Sentry.captureException(error)
    if (error.response) {
      console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`)
    } else {
      console.error(error)
    }
  }
})

// Handle errors
app.webhooks.onError((error) => {
  if (error.name === 'AggregateError') {
    // Log Secret verification errors
    Sentry.captureException(error)
    console.log(`Error processing request: ${error.event}`)
  } else {
    Sentry.captureException(error)
    console.log(error)
  }
})

// Launch a web server to listen for GitHub webhooks
const port = process.env.PORT || 3000
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost'
const path = '/api/webhook'
const localWebhookUrl = `http://${host}:${port}${path}`

// https://github.com/octokit/webhooks.js/#createnodemiddleware
const middleware = createNodeMiddleware(app.webhooks, { path })

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`)
  console.log('Press Ctrl + C to quit.')
})
