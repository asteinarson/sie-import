// This way of importing comes from https://github.com/knex/knex/issues/3897 
// see comment by rijkvanzanten
import Knex from 'knex'

let _knex:Knex;
export function connect(connection:Record<string,string>){
    let conn = {
        client: 'pg',
        connection
    }
    _knex = Knex(conn as Knex.Config);
}

export async function getAll(table:string){
    return _knex(table);
}
