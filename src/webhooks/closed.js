import { db } from '../index.js';
import fs from 'fs';
import path from 'path';

const ignoreLabels = ['maintainer'];
const mergedPRs = fs.readFileSync(
    path.join(import.meta.dirname, '../message/merged.md'),
    'utf8'
);
const unremovableLabels = [
    'maintainer',
    'ci: bypass-owner-check',
    'no-stale',
    'r: william',
];
const reviewerUsernames = [
    'DEV-DIBSTER',
    'dragsbruh',
    'iostpa',
    'notamitgamer',
    'omsenjalia',
    'orangci',
    'satr14washere',
    'Stef-00012',
    'STICKnoLOGIC',
    'wdhdev',
    'Yunexiz',
];

export async function closed(
    appOctokit,
    prMerged,
    repoOwner,
    repoName,
    repoFullName,
    prNumber,
    prUsername,
    prSender
) {
    if (prMerged === true) {
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

        for (let i in listOfLabels) {
            if (!unremovableLabels.includes(listOfLabels[i])) {
                await appOctokit.request(
                    'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
                    {
                        owner: repoOwner,
                        repo: repoName,
                        issue_number: prNumber,
                        name: listOfLabels[i],
                    }
                );
            }
        }
    } else {
        let res = await db
            .prepare(`SELECT * FROM LIST WHERE username = ?;`)
            .get(prUsername);
        if (res !== undefined) {
            let resJson = JSON.stringify(res);
            let parsed = JSON.parse(resJson);
            if (reviewerUsernames.includes(prSender)) {
                await db
                    .prepare(`DELETE FROM LIST WHERE username = ?;`)
                    .run(parsed.username);
                await appOctokit.request(
                    'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
                    {
                        owner: repoOwner,
                        repo: repoName,
                        issue_number: prNumber,
                        name: 'status: low priority',
                    }
                );
                console.log(
                    `Removed #${prNumber} from https://github.com/${repoFullName} from the low priority database as well as the label.`
                );
            }
        }
    }
}
