import { pool } from '../index';

export async function unlabeled(labelName, username, prNumber, repoFullName) {
    let conn;
    try {
        if (labelName === 'status: low priority') {
            conn = await pool.getConnection();
            let res = await conn.query(
                `SELECT * FROM LIST WHERE username=(?)`,
                [username]
            );
            let resJson = JSON.stringify(res);
            if (resJson !== '[]') {
                res = await conn.query('DELETE FROM LIST WHERE username=(?)', [
                    username,
                ]);
                console.log(
                    `Removed #${prNumber} from https://github.com/${repoFullName} from the low priority database.`
                );
            } else {
                return;
            }
        }
    } finally {
        if (conn) conn.end();
    }
}
