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
    if (prLabelName === 'status: low priority') {
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
        return;
    }

    // Fetch all current labels attached to the PR immediately without delay
    const data = await appOctokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        {
            owner: repoOwner,
            repo: repoName,
            pull_number: prNumber,
        }
    );

    const listOfLabels = data.data.labels
        .map((label) => label.name)
        .filter(Boolean);

    const denied = listOfLabels.includes('status: denied');
    const invalid = listOfLabels.includes('status: invalid');

    // Proceed only if either 'status: denied' or 'status: invalid' is present
    if (!denied && !invalid) {
        return;
    }

    // Collect all present reason messages
    const allMessages = [];
    for (const label of listOfLabels) {
        if (reasonLabels.includes(label)) {
            let initialReason = label.toString().replace(/reason:\s/i, '');
            let finalReason = initialReason.replace(/\s+/g, '-');
            let message = fs.readFileSync(
                path.join(
                    import.meta.dirname,
                    `../message/label/${finalReason}.md`
                ),
                'utf8'
            );
            allMessages.push(message);
        } else if (label === 'status: needs preview') {
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

    // If no reason labels exist yet, do nothing and wait for a reason label event to trigger this function
    if (allMessages.length === 0) {
        return;
    }

    const labelMessages = allMessages.join('\n\n');
    let body;

    if (denied) {
        body = `# Pull Request Denied\n\nThis pull request has been denied due to the following reason(s):\n\n${labelMessages}\n\nIf you believe this was a mistake, or if you need further clarification, please feel free to create an issue or reach out to our team in the [Discord server](https://discord.gg/is-a-dev-830872854677422150).\n> If you have any questions about the bot, please contact **iostpa** on [Discord](https://discord.com/users/716306888492318790) or [GitHub](https://github.com/iostpa).`;
    } else if (invalid) {
        body = `# Invalid Pull Request\n\nThis pull request is invalid due to the following reason(s):\n\n${labelMessages}\n\nIf you need any help, please create an issue or ask our team in the [Discord server](https://discord.gg/is-a-dev-830872854677422150).\n> If you have any questions about the bot, please contact **iostpa** on [Discord](https://discord.com/users/716306888492318790) or [GitHub](https://github.com/iostpa).`;
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
            console.log(`Deleted outdated bot comment ${comment.id} on #${prNumber}.`);
        }
    } catch (error) {
        console.error(`Failed to cleanup old comments on PR #${prNumber}:`, error);
    }

    // Now post the new updated reason message
    await appOctokit.rest.issues.createComment({
        owner: repoOwner,
        repo: repoName,
        issue_number: prNumber,
        body: body,
    });
    console.log(
        `Sent reason messages at #${prNumber} from https://github.com/${repoFullName}`
    );

    if (denied) {
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
}
