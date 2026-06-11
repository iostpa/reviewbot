import { pool, numberOfDays } from '../index.js';
import { getNumberOfDays } from '../tools/numberofdays.js';
import fs from 'fs';
import path from 'path';

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
    let conn;
    try {
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
        conn = await pool.getConnection();
        let res = await conn.query(`SELECT * FROM LIST WHERE username=(?)`, [
            prUsername,
        ]);
        let resJson = JSON.stringify(res);
        if (resJson !== '[]') {
            let parsed = JSON.parse(resJson);
            let date = new Date();
            if (
                parsed[0].username === prUsername &&
                getNumberOfDays(parsed[0].time, date) <= numberOfDays
            ) {
                let lowPriority = `
# Low priority

You're attempting to create a new pull request to bypass the low priority label placed on your previous pull request, #${parsed[0].prnumber}. Unfortunately, we've noticed this attempt, and we're applying the label you were trying to escape on this pull request, too.

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
                await conn.query(
                    `UPDATE LIST SET prnumber=(?) WHERE prnumber=(?)`,
                    [prNumber, parsed[0].prnumber]
                );
                await conn.query(
                    `UPDATE LIST SET time=(?) WHERE prnumber=(?)`,
                    [prCreatedAt, parsed[0].prnumber]
                );
                console.log(
                    `Auto-added, replaced with new PR number and sent low priority message to #${prNumber} on https://github.com/${repoFullName} because it was found in the database.`
                );
            } else if (
                parsed[0].username === prUsername &&
                getNumberOfDays(parsed[0].time, date) >= numberOfDays
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
                res = await conn.query('DELETE FROM LIST WHERE username=(?)', [
                    parsed[0].username,
                ]);
                console.log(
                    `Removed #${prNumber} from https://github.com/${repoFullName} from the low priority database as well as the label.`
                );
            }
        } else if (resJson === '[]') {
            return;
        }
    } finally {
        if (conn) conn.end();
    }
}
