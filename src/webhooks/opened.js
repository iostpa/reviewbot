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
    // Use .all() instead of .get() to fetch all of the user's active low-priority PRs
    let res = await db
        .prepare(`SELECT * FROM LIST WHERE username = ?;`)
        .all(prUsername);

    if (res && res.length > 0) {
        // Since all rows inherit the same time, we can just check the first one
        let firstRecord = res[0]; 
        let date = new Date();

        if (
            firstRecord.username === prUsername &&
            getNumberOfDays(firstRecord.time, date) <= numberOfDays
        ) {
            let lowPriority = `
# Low priority

You're attempting to create a new pull request to bypass the low priority label placed on your previous pull request, #${firstRecord.prnumber}. Unfortunately, we've noticed this attempt, and we're applying the label you were trying to escape on this pull request, too.

If you believe this was a mistake, or if you need further clarification, please feel free to reach out to our team in the [Discord server](https://discord.gg/is-a-dev-830872854677422150). 
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
                .prepare(`INSERT INTO LIST VALUES (?, ?, ?, ?, ?);`)
                .run(
                    prUsername,
                    `${prNumber}`,
                    firstRecord.time, // Inherit the original timer so it doesn't reset
                    repoOwner,
                    repoName
                );
            console.log(
                `Auto-added new PR number and sent low priority message to #${prNumber} on https://github.com/${repoFullName} because active penalty was found in the database.`
            );
        } else if (
            firstRecord.username === prUsername &&
            getNumberOfDays(firstRecord.time, date) >= numberOfDays
        ) {
            // The penalty is over! Loop through and remove labels from ALL old PRs
            for (let record of res) {
                await appOctokit.request(
                    'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
                    {
                        owner: record.repoowner,
                        repo: record.repo,
                        issue_number: record.prnumber,
                        name: 'status: low priority',
                    }
                );
            }
            
            // Now that labels are removed, it is safe to delete them from the database
            await db
                .prepare(`DELETE FROM LIST WHERE username = ?;`)
                .run(prUsername);
                
            console.log(
                `Penalty expired. Removed low priority labels from all previous PRs for ${prUsername} and cleared database.`
            );
        }
    }
}
