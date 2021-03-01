// This way of importing comes from https://github.com/knex/knex/issues/3897 
// see comment by rijkvanzanten
import Knex from 'knex'

let _knex: Knex;
export function connect(connection: Record<string, string>) {
    let conn = {
        client: 'pg',
        connection
    }
    _knex = Knex(conn as Knex.Config);
}

export async function checkTable_PromiseAll(table: string, columns?: string[]) {
    let r = await _knex.schema.hasTable(table);
    let e: string[] = []
    if (!r) { e.push(`Table ${table} does not exist`) }
    else {
        if (columns) {
            await Promise.all(columns.map(async c => {
                try {
                    r = await _knex.schema.hasColumn(table, c);
                    if (!r) {
                        e.push(`Column ${c} does not exist`)
                    }
                } catch (e) {
                    console.log("catch: ", e);
                }
            }))
        }
    }
    console.log("returning from checkTable")
    return e.length > 0 ? e : true
}

export async function checkTable(table: string, columns?: string[]) {
    let r = await _knex.schema.hasTable(table);
    let e: string[] = []
    if (!r) { e.push(`Table ${table} does not exist`) }
    else {
        if (columns) {
            for (let ix = 0; ix < columns.length; ix++) {
                let c = columns[ix];
                try {
                    r = await _knex.schema.hasColumn(table, c);
                    if (!r) {
                        e.push(`Column ${c} does not exist`)
                    }
                } catch (e) {
                    console.log("catch: ", e);
                }
            }
        }
    }
    console.log("returning from checkTable")
    return e.length > 0 ? e : true
}

type WhereArgVal = string | number | boolean;
type WhereArgs = [string, WhereArgVal] | [string, string, WhereArgVal];
export type ColumnVal = WhereArgVal

function isStringArr(s: any): s is WhereArgs {
    if (!Array.isArray(s)) return false;
    if (s.length == 0) return false;
    if (typeof s[0] == "string") return true;
    return false;
}

function addWhere(r: Knex.QueryBuilder, a: WhereArgs) {
    if (a.length == 2) {
        return r.where(a[0], a[1])
    }
    else if (a.length == 3) {
        return r.where(a[0], a[1], a[2])
    }
    else {
        console.log("addWhere - length of <wheres> is not 2 or 3: " + (a as any).length);
        return r;
    }
}

export async function getAll(table: string, wheres: WhereArgs | WhereArgs[] = []) {
    //return _knex(table).where( "description", "abc").where("id",2)
    let r = _knex(table);

    if (isStringArr(wheres)) {
        return addWhere(r, wheres);
    } else {
        wheres.forEach((a) => {
            r = addWhere(r, a);
        })
        return r;
    }
}

export async function loadById(table: string, id:number, id_field?:string ) {
    return _knex(table).where( id_field?id_field:"id", id)
}

export async function upsert( table:string, values:Record<string,ColumnVal>, conflict_keys:string|string[]=[] ){
    let r = _knex(table).insert(values)
    if( conflict_keys.length>0 ){
        // This is roundabout, but the way TS currently accepts it 
        if( typeof conflict_keys=="string" ){
            r = r.onConflict(conflict_keys).merge()
        }
        else {
            r = r.onConflict(conflict_keys).merge()
        }
    }
    return r
}

