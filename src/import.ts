import { connect, getAll, checkTable, loadById, deleteById, upsert, ColumnVal } from "./acct-db.js"
import { getConfig, init, setConfig } from "./acct-base.js"
import { Dict } from "./utils.js"

let connection = {
  host: 'localhost',
  user: 'directus',
  password: 'psql1234',
  database: 'dir_acct'
}
connect(connection);

if (! await init()) process.exit(1)
let ps: Promise<any>[] = []

// Options controlling the import
let options = {
  dry: true,
  overwrite: false,
  serie: null as string|null, 
  parts: {} as Dict<any>,
  import_info: {} as Dict<any>,
  organization_info: {} as Dict<any>,
  accounting_info: {} as Dict<any>,
};


function giveUp(msg: string, ec: number = -1) {
  console.log(msg);
  process.exit(ec);
}

function mergeSieComment(cols: string[]) {
  let comment = cols.join(" ");
  if (comment[0] == '"') comment = comment.slice(1, -1);
  return comment;
}

interface RowParser {
  word: string;
  words?: string[];
  info?: Dict<string>;
  parent: RowParser;
  count: number;
  errors: number;
  changed: number;
  is_done: boolean;
  openRow(cols: string[]): void;
  closeRow(): void;
  prepare(): void;
  done(): void;
}

class BaseParser implements RowParser {
  word = "";
  count = 0;
  errors = 0;
  changed = 0;
  is_done = false;

  constructor(public parent: RowParser, public options: Dict<any>) { }

  openRow(cols: string[]): void { }
  closeRow(): void { }
  prepare(): void { }
  done(): void {
    this.is_done = true;
  }
}

class VerParser extends BaseParser {
  word = "#VER";
  rows: Dict<any>[] = [];
  v: Dict<any> = {};
  //series: Dict<number> = {}
  //series_used: Dict<boolean> = {};
  dec_adjust: number = 0.0;
  new_vers: number[] = [];

  constructor(public parent: RowParser, public options: Dict<any>) {
    super(parent, options);
  }

  async prepare() {
    //this.series = {};
    //let series = getSeries();
    //for (let k in series) {
    //    let s = series[k];
    //    this.series[s.name] = -1;
    //}
  }

  openRow(cols: string[]) {
    this.v = { serie: cols[1], n: cols[2], date: cols[3], comment: mergeSieComment(cols.slice(4)) };
    this.rows = [];
    this.dec_adjust = 0.0;
    //this.series_used[this.v.serie] = true;
    this.count++;
  }

  async closeRow() {
    try {
      // Prepare commit verification to DB
      // ! We should check if we have a serie in options we should use instead! 
      let ver_nr = this.v.serie + this.v.n;
      let has_ver = await getAll("verification", ["number", ver_nr]);

      // Check that the accounts of the ver rows exists
      for (let row of this.rows) {
        let r = await AccountParser.checkAddAccount(Number(row.account), "<generated>");
        if (!r.id) this.errors++;
      }

      // Check if verification exists
      if (has_ver) {
        // Delete if overwrite flag
        if (!this.options.overwrite) {
          console.log("Skipping (verification exists): " + ver_nr);
          return;
        }
        if (has_ver && !options.dry) {
          await deleteById("verification", ver_nr, "number")
        }

      }
      // If w e get here, we either create or recreate the verification. Both count as a change.
      this.changed++;

      // Create the new verification
      let values = {
        number: ver_nr,
        description: this.v.comment,
        date_created: this.v.date,
      }
      let new_v_id = -1
      if( !options.dry ){
        let new_ids = await upsert( "verification", values );
        if (!new_ids || !new_ids.length ) {
          console.log("Failed creating new verification: " + ver_nr);
          this.errors++;
          return;
        }
        new_v_id = new_ids[0]
        this.new_vers.push(new_v_id);
      }

      // Do the rows

      // Create new ones
      let rows:Dict<ColumnVal>[] = []
      for (let ix in this.rows) {
        let row = this.rows[ix];
        let v_row = {
          line: ix,
          credit: row.credit,
          debit: row.debit,
          verification_id: new_v_id,
          account_id: AccountParser.accounts[row.account],
        };
        rows.push(v_row);
      }
      if( !options.dry ){
        let r = await upsert( "verification_row", rows )
        if( !r || r.length!=rows.length ){
          console.log( "Failed creating verification rows: ", r )
          this.errors++
        }
      }
    } catch (e) {
      console.log("VerParser:closeRow - " + e);
    }
  }
  async done() {
    // For new verifications, update the series, concerning next number
    /*for (let prefix of Object.keys(this.series_used)) {
      try {
        let variables = { org_id: this.options.org_id, prefix };
        let r = await aclient.query({ query: VER_SEQ_MAX2, variables });
        if (!r.data.ver_seq_max2.length) continue;
        let rr = r.data.ver_seq_max2[0];
        // v1 is the highest number used in the table
        // v2 is the current highest value in the series
        if (rr.v1 > rr.v2) {
          await setSerieNext(prefix, rr.v1);
        }
      } catch (e) {
        console.log("VerParser:done - " + e);
      }
    }*/
    super.done();
  }
}


await Promise.all(ps)
process.exit(0)

