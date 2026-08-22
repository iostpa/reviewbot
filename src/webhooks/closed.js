import fs from 'fs';
import path from 'path';

const ignoreLabels = ['maintainer'];
const mergedPRs = fs.readFileSync(
    path.join(import.meta.dirname, '../message/merged.md'),
    'utf8'
);
const removableLabelPrefixes = ['status:', 'reason:'];

export async function closed(
    appOctokit,
    prMerged,
    repoOwner,
    repoName,
    repoFullName,
    prNumber,
    prUsername
) {
    if (prMerged === true) {
        const rawTrustedUsers = await fetch(
            'https://raw.githubusercontent.com/is-a-dev/register/refs/heads/main/util/trusted.json'
        );
        const trustedUsers = await rawTrustedUsers.json();
        for (let i in trustedUsers) {
            if (prUsername === trustedUsers[i].username) {
                console.log(
                    `#${prNumber} from https://github.com/${repoFullName} is by a trusted user, skipping pull request.`
                );
                return;
            }
        }
        const labels = await appOctokit.rest.issues.listLabelsOnIssue({
            owner: repoOwner,
            repo: repoName,
            issue_number: prNumber,
        });
        const allLabels = labels.data.map((label) => label.name);
        if (ignoreLabels.some((label) => allLabels.includes(label))) {
            return;
        }
        await appOctokit.rest.issues.createComment({
            owner: repoOwner,
            repo: repoName,
            issue_number: prNumber,
            body: mergedPRs,
        });
        console.log(
            `Sent a merged message to #${prNumber} on https://github.com/${repoFullName}`
        );

        // remove almost all labels if there are any
        const listOfLabels = [];
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

        for (const label of listOfLabels) {
            if (
                removableLabelPrefixes.some((prefix) =>
                    label.startsWith(prefix)
                )
            ) {
                await appOctokit.request(
                    'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
                    {
                        owner: repoOwner,
                        repo: repoName,
                        issue_number: prNumber,
                        name: label,
                    }
                );
            }
        }
    }
}
