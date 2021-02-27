import {connect,getAll} from "./acct-db"

let connection = {
  host : 'localhost',
  user : 'directus',
  password : 'psql1234',
  database : 'dir_acct'
}
connect( connection );

(async () => {
    console.log("in async wrapper...")
    //let vers = await getAll("verification", [["description","abc"],["id","3"]] );
    let vers = await getAll("verification", ["description","abc"] );
    console.log(vers);
    process.exit(0);
})()
