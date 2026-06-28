import { db } from '../index.js';

export async function unlabeled(labelName, username, prNumber, repoFullName) {
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
}
