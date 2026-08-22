import fs from 'fs';
import path from 'path';

import { db } from '../index.js';

const reasonLabels = [
    'reason: abuse risk',
    'reason: ai generated pr',
    'reason: commercial usage',
    'reason: impersonation',
    'reason: inaccessible website',
    'reason: incomplete pr',
    'reason: incomplete website',
    'reason: invalid file',
    'reason: invalid records',
    'reason: invalid social',
    'reason: merge conflict',
    'reason: not dev related',
    'reason: nsfw',
    'reason: other',
    'reason: unauthorized',
    'reason: incompatible records',
    'reason: tos non-compliant',
];
const lowPriorityMessage = fs.readFileSync(
    path.join(import.meta.dirname, '../message/label/lowpriority.md'),
    'utf8'
);

export async function labeled(
    appOctokit,
    prLabelName,
    repoOwner,
    repoName,
    repoFullName,
    prNumber,
    prUpdatedAt,
    prUsername
) {
    let denied, invalid, lowpriority;
    if (prLabelName === 'status: denied') {
        denied = true;
    } else if (prLabelName === 'status: invalid') {
        invalid = true;
    } else if (prLabelName === 'status: low priority') {
        lowpriority = true;
    }

    if (denied || invalid) {
        const listOfLabels = [];
        // timeout so that it creates a little time window for the reviewer to add the rest of the labels
        await new Promise((resolve) => setTimeout(resolve, 20000));
        const data = await appOctokit.request(
            'GET /repos/{owner}/{repo}/pulls/{pull_number}',
            {
                owner: repoOwner,
                repo: repoName,
                pull_number: prNumber,
            }
        );
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
                let initialReason = listOfLabels[i]
                    .toString()
                    .replace(/reason:\s/i, '');
                let finalReason = initialReason.replace(/\s+/g, '-');
                let message = fs.readFileSync(
                    path.join(
                        import.meta.dirname,
                        `../message/label/${finalReason}.md`
                    ),
                    'utf8'
                );
                allMessages.push(message);
            } else if (listOfLabels[i] === 'status: needs preview') {
                let message = fs.readFileSync(
                    path.join(
                        import.meta.dirname,
                        `../message/label/needs-preview.md`
                    ),
                    'utf8'
                );
                allMessages.push(message);
            }
        }

        // Delete any existing denial/invalid comments previously posted by the bot
        try {
            const existingComments = await appOctokit.rest.issues.listComments({
                owner: repoOwner,
                repo: repoName,
                issue_number: prNumber,
            });

            const botComments = existingComments.data.filter(
                (comment) =>
                    comment.body.includes('# Pull Request Denied') ||
                    comment.body.includes('# Invalid Pull Request')
            );

            for (const comment of botComments) {
                await appOctokit.rest.issues.deleteComment({
                    owner: repoOwner,
                    repo: repoName,
                    comment_id: comment.id,
                });
                console.log(
                    `Deleted outdated bot comment ${comment.id} on #${prNumber}.`
                );
            }
        } catch (error) {
            console.error(
                `Failed to cleanup old comments on PR #${prNumber}:`,
                error
            );
        }

        const labelMessages = allMessages.join('\n\n');
        let body;
        if (!labelMessages.length) {
            if (denied) {
                body = fs.readFileSync(
                    path.join(
                        import.meta.dirname,
                        `../message/deniednolabel.md`
                    ),
                    'utf8'
                );
            } else if (invalid) {
                body = fs.readFileSync(
                    path.join(
                        import.meta.dirname,
                        `../message/invalidnolabel.md`
                    ),
                    'utf8'
                );
            }
        } else if (denied) {
            body = `
# Pull Request Denied

This pull request has been denied due to the following reason(s):

---
${labelMessages}

---

If you believe this was a mistake, or if you need further clarification, please feel free to create an issue or reach out to our team in the [Discord server](https://discord.gg/is-a-dev-830872854677422150).

`;
        } else if (invalid) {
            body = `
# Invalid Pull Request

This pull request is invalid due to the following reason(s):

---
${labelMessages}

---

If you need any help, please create an issue or ask our team in the [Discord server](https://discord.gg/is-a-dev-830872854677422150)

`;
        }
        await appOctokit.rest.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: prNumber,
            body: body,
        });
        console.log(
            `Sent reason messages at #${prNumber} from https://github.com/${repoFullName}`
        );
        if (denied === true) {
            await appOctokit.request(
                'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
                {
                    owner: repoOwner,
                    repo: repoName,
                    pull_number: prNumber,
                    state: 'closed',
                }
            );
            console.log(
                `Closed pull request at #${prNumber} from https://github.com/${repoFullName}`
            );
        }
    } else if (lowpriority === true) {
        let res = await db
            .prepare(`SELECT * FROM LIST WHERE username = ?;`)
            .get(prUsername);
        let resString = JSON.stringify(res);
        if (resString === undefined) {
            await appOctokit.rest.issues.createComment({
                owner: repoOwner,
                repo: repoName,
                issue_number: prNumber,
                body: lowPriorityMessage,
            });
            console.log(
                `Sent low priority message to #${prNumber} from https://github.com/${repoFullName}`
            );
            await db
                .prepare(`INSERT INTO LIST VALUES (?, ?, ?, ?, ?);`)
                .run(
                    prUsername,
                    `${prNumber}`,
                    prUpdatedAt,
                    repoOwner,
                    repoName
                );
            console.log(
                `Logged #${prNumber} from https://github.com/${repoFullName} to the low priority database.`
            );
        }
    }
}
