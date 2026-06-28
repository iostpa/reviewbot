import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync('./data/reviewbot.db')

/*db.exec(`
  CREATE TABLE TEST (
    username TEXT NOT NULL,
    prnumber TEXT NOT NULL,
    time TEXT NOT NULL,
    repoowner TEXT NOT NULL,
    repo TEXT NOT NULL
  );
`);*/

// db.exec(`INSERT INTO LIST VALUES ('test', 'test', 'test', 'test', 'test')`);

let res = await db
    .prepare(`SELECT * FROM LIST WHERE username = ?;`)
    .get('iostpa');
let resJson = JSON.stringify(res);
let parsed = JSON.parse(resJson);

console.log(parsed);