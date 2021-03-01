import {connect,getAll,checkTable} from "./acct-db.js"

let connection = {
  host : 'localhost',
  user : 'directus',
  password : 'psql1234',
  database : 'dir_acct'
}
connect( connection );

console.log("outside async wrapper...")

let r = await checkTable("verification", ["id","description","number"]);
if( Array.isArray(r) ){
  console.log( "checkTable, failed: ", r )
  process.exit(0);
}

//let vers = await getAll("verification", [["description","abc"],["id","3"]] );



process.exit(0);

