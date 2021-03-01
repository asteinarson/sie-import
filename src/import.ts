import { connect, getAll, checkTable } from "./acct-db.js"
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

  constructor(public parent: RowParser, public options: Dict<any>) {}

  openRow(cols: string[]): void {}
  closeRow(): void {}
  prepare(): void {}
  done(): void {
      this.is_done = true;
  }
}

class VerParser extends BaseParser {
  word = "#VER";
  rows: Dict<any>[] = [];
  v?: Dict<any>;
  series: Dict<number> = {}
  series_used: Dict<boolean> = {};
  dec_adjust: number = 0.0;
  new_vers: number[] = [];

  constructor(public parent: RowParser, public options: Dict<any>) {
      super(parent, options);
  }

  async prepare() {
      this.series = {};
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
      this.series_used[this.v.serie] = true;
      this.count++;
  }

  async closeRow() {
      try {
          // Commit verification to DB
          if (!this.series[this.v.serie]) {
              let r = await createSerie(this.v.serie);
              if (!r) {
                  this.errors++;
                  console.log("Failed creating series: " + this.v.serie);
              }
          }

          // Check that the accounts of the ver rows exists
          for (let row of this.rows) {
              let r = await AccountParser.checkAddAccount(Number(row.account), "<generated>");
              if (!r.id) this.errors++;
          }

          // Check if verification exists
          let ver_nr = this.v.serie + this.v.n;
          if (await verificationExists(ver_nr)) {
              // Delete if overwrite flag
              if (!this.options.exists_overwrite) {
                  console.log("Skipping (exists): " + ver_nr);
                  return;
              }
              await aclient.mutate({
                  mutation: DELETE_VERIFICATION,
                  variables: { ver_nr, u_id: this.options.user_id },
              });
          }
          // If w e get here, we either create or recreate the verification. Both count as a change.
          this.changed++;

          // Create the new verification
          let rr = await aclient.mutate({
              mutation: INSERT_VERIFICATION,
              variables: {
                  c_at: this.v.date,
                  d: this.v.comment,
                  v_nr: ver_nr,
                  u_id: this.options.user_id,
              },
          });
          let new_v_id = rr.data.insert_verification.returning[0].id;
          if (!new_v_id) {
              console.log("Failed creating new verification: " + ver_nr);
              this.errors++;
              return;
          }
          this.new_vers.push(new_v_id);

          // Do the rows

          // Create new ones
          let variables = { objects: [] as any[] };
          for (let ix in this.rows) {
              let row = this.rows[ix];
              let v_row = {
                  line: ix,
                  credit: row.credit,
                  debit: row.debit,
                  verification_id: new_v_id,
                  account_id: AccountParser.accounts[row.account],
              };
              variables.objects.push(v_row);
          }
          rr = await aclient.mutate({
              mutation: INSERT_VERIFICATION_ROWS,
              variables,
          });
          let cnt = rr.data.insert_verification_row.affected_rows;
          if (cnt != variables.objects.length) {
              this.errors++;
              console.log("Row insertion count mismatch: " + cnt);
          }
      } catch (e) {
          console.log("VerParser:closeRow - " + e);
      }
  }
  async done() {
      // For new verifications, update the series, concerning next number
      for (let prefix of Object.keys(this.series_used)) {
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
      }
      super.done();
  }
}


await Promise.all(ps)
process.exit(0)

