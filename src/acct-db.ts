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

type WhereArgVal = string|number|boolean;
type WhereArgs = [string,WhereArgVal] | [string,string,WhereArgVal];

function isStringArr(s: any): s is WhereArgs {
    if(!Array.isArray(s)) return false;
    if( s.length==0 ) return true;
    if( typeof s[0]=="string" ) return true;
    return false;
}

function addWhere(r:Knex.QueryBuilder,a:WhereArgs){
    if( a.length==2 ){
        return r.where(a[0],a[1])
    }
    else if( a.length==3 ){
        return r.where(a[0],a[1],a[2])
    }
    else {
        console.log( "addWhere - length of <wheres> is not 2 or 3: "+(a as any).length );
        return r;
    }
}

export async function getAll(table:string, wheres:WhereArgs | WhereArgs[] = []){
    //return _knex(table).where( "description", "abc").where("id",2)
    let r = _knex(table);

    if( isStringArr(wheres) ){
        return addWhere(r,wheres);
    } else {
        wheres.forEach( (a) => {
            r = addWhere(r,a);
        })
        return r;
    }
}
