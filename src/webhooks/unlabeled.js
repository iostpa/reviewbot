import { db } from '../index.js';

export async function unlabeled(
    appOctokit,
    labelName,
    username,
    prNumber,
    repoOwner,
    repoName,
    repoFullName
) {
    if (labelName === 'status: low priority') {
        let res = await db
            .prepare(`SELECT * FROM LIST WHERE username = ?;`)
            .get(username);
        if (res !== undefined) {
            await db
                .prepare(`DELETE FROM LIST WHERE username = ?;`)
                .run(username);
            console.log(
                `Removed #${prNumber} from https://github.com/${repoFullName} from the low priority database.`
            );
        }
    }

    if (labelName === 'status: denied' || labelName === 'status: invalid') {
        // 1. Reopen the PR if it was closed (only denied closes the PR)
        if (labelName === 'status: denied') {
            try {
                await appOctokit.request(
                    'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
                    {
                        owner: repoOwner,
                        repo: repoName,
                        pull_number: prNumber,
                        state: 'open',
                    }
                );
                console.log(`Reopened #${prNumber} on ${repoFullName} because ${labelName} was removed.`);
            } catch (error) {
                console.error(`Failed to reopen PR #${prNumber}:`, error);
            }
        }

        // 2. Fetch comments and delete the bot's explanation comment
        try {
            const comments = await appOctokit.rest.issues.listComments({
                owner: repoOwner,
                repo: repoName,
                issue_number: prNumber,
            });

            // Find comments made by the bot containing the rejection headers
            const botComments = comments.data.filter(
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
                console.log(`Deleted bot comment ${comment.id} on #${prNumber}.`);
            }
        } catch (error) {
            console.error(`Failed to delete bot comment on PR #${prNumber}:`, error);
        }
    }
}
