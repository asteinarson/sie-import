import { connect, getAll, checkTable } from "./acct-db.js"
import { getConfig, init, setConfig } from "./acct-base.js"

let connection = {
  host: 'localhost',
  user: 'directus',
  password: 'psql1234',
  database: 'dir_acct'
}
connect(connection);

if (! await init()) process.exit(1)

let ps:Promise<any>[] = []

console.log(getConfig("currency_code", "usd"))
ps.push( setConfig("currency_code", "sek") )
console.log(getConfig("currency_code", "usd"))

//let vers = await getAll("verification", [["description","abc"],["id","3"]] );

await Promise.all(ps)
process.exit(0)

