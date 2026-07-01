import fs from 'fs';
import path from 'path';

import { db, numberOfDays } from '../index.js';
import { getNumberOfDays } from '../tools/numberofdays.js';

const ignoreLabels = ['maintainer'];
const newPRs = fs.readFileSync(
    path.join(import.meta.dirname, '../message/opened.md'),
    'utf8'
);
const draftPRs = fs.readFileSync(
    path.join(import.meta.dirname, '../message/draft.md'),
    'utf8'
);

// https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
export async function opened(
    appOctokit,
    repoOwner,
    repoName,
    repoFullName,
    prNumber,
    prCreatedAt,
    prUsername,
    prDraft
) {
    console.log(
        `Received a open pull request event for #${prNumber} on https://github.com/${repoFullName}`
    );
    const labels = await appOctokit.rest.issues.listLabelsOnIssue({
        owner: repoOwner,
        repo: repoName,
        issue_number: prNumber,
    });
    const allLabels = labels.data.map((label) => label.name);
    if (ignoreLabels.some((label) => allLabels.includes(label))) {
        console.log(
            `#${prNumber} from https://github.com/${repoFullName} is by a maintainer, skipping pull request.`
        );
        return;
    }
    if (prDraft === true) {
        await appOctokit.rest.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: prNumber,
            body: draftPRs,
        });
        console.log(
            `Sent a draft message to #${prNumber} on https://github.com/${repoFullName}`
        );
    } else {
        await appOctokit.rest.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: prNumber,
            body: newPRs,
        });
        console.log(
            `Sent a opened message to #${prNumber} on https://github.com/${repoFullName}`
        );
    }
    // low priority check
    let res = await db
        .prepare(`SELECT * FROM LIST WHERE username = ?;`)
        .get(prUsername);
    if (res !== undefined) {
        let resJson = JSON.stringify(res);
        let parsed = JSON.parse(resJson);
        let date = new Date();
        if (
            parsed.username === prUsername &&
            getNumberOfDays(parsed.time, date) <= numberOfDays
        ) {
            let lowPriority = `
# Low priority

You're attempting to create a new pull request to bypass the low priority label placed on your previous pull request, #${parsed.prnumber}. Unfortunately, we've noticed this attempt, and we're applying the label you were trying to escape on this pull request, too.

If you think this is a mistake then please contact [iostpa](https://github.com/iostpa).   
        `;
            await appOctokit.request(
                'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
                {
                    owner: repoOwner,
                    repo: repoName,
                    issue_number: prNumber,
                    labels: ['status: low priority'],
                }
            );
            await appOctokit.rest.issues.createComment({
                owner: repoOwner,
                repo: repoName,
                issue_number: prNumber,
                body: lowPriority,
            });
            await db
                .prepare(`UPDATE LIST SET prnumber = ? WHERE prnumber = ?;`)
                .run(`${prNumber}`, `${parsed.prnumber}`);
            await db
                .prepare(`UPDATE LIST SET time = ? WHERE prnumber = ?;`)
                .run(prCreatedAt, `${prNumber}`);
            console.log(
                `Auto-added, replaced with new PR number and sent low priority message to #${prNumber} on https://github.com/${repoFullName} because it was found in the database.`
            );
        } else if (
            parsed.username === prUsername &&
            getNumberOfDays(parsed.time, date) >= numberOfDays
        ) {
            await appOctokit.request(
                'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
                {
                    owner: repoOwner,
                    repo: repoName,
                    issue_number: prNumber,
                    name: 'status: low priority',
                }
            );
            await db
                .prepare(`DELETE FROM LIST WHERE username = ?;`)
                .run(parsed.username);
            console.log(
                `Removed #${prNumber} from https://github.com/${repoFullName} from the low priority database as well as the label.`
            );
        }
    } else if (res === undefined) {
        return;
    }
}
