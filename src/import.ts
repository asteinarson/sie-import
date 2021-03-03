
let start_time = process.hrtime();

import { connect, getAll, checkTable, loadById, deleteById, upsert, ColumnVal, update } from "./acct-db.js"
import { getConfig, init, setConfig } from "./acct-base.js"
import { Dict, isEmpty, isEmptyObject } from "./utils.js"

function giveUp(msg: string, ec: number = -1) {
  console.log(msg);
  process.exit(ec);
}

let connection = {
  host: 'localhost',
  user: 'directus',
  password: 'psql1234',
  database: 'dir_acct'
}
await connect(connection);
if (! await init()) giveUp("Failed init")

function mergeSieComment(cols: string[]) {
  let comment = cols.join(" ");
  if (comment[0] == '"') comment = comment.slice(1, -1);
  return comment;
}

interface RowParser {
  word: string;
  words?: string[];
  info?: Dict<string>;
  parent?: RowParser;
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
  words: string[] = null;
  count = 0;
  errors = 0;
  changed = 0;
  is_done = false;

  constructor(public parent?: RowParser) { }

  openRow(cols: string[]): void { }
  closeRow(): void { }
  async prepare(): Promise<void> { }
  async done() {
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

  constructor(public parent?: RowParser) {
    super(parent);
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
      let old_ver_id = await getAll("verification", ["number", ver_nr]);

      // Check if verification exists
      if (old_ver_id.length > 0) {
        // Delete if overwrite flag
        if (!options.overwrite) {
          console.log("Skipping (verification exists): " + ver_nr);
          return;
        }
        if (!options.dry) {
          await Promise.all(
            [deleteById("verification", ver_nr, "number"),
            deleteById("verification_row", old_ver_id[0].id, "verification_id" )
            ])
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
      if (!options.dry) {
        let new_ids = await upsert("verification", values);
        if (!new_ids || !new_ids.length) {
          console.log("Failed creating new verification: " + ver_nr);
          this.errors++;
          return;
        }
        new_v_id = new_ids[0]
        this.new_vers.push(new_v_id);
      }

      // Do the rows

      // Create new ones
      for (let row of this.rows) {
        row.verification_id = new_v_id
        // row.line = ... - use <id> instead
      }
      if (!options.dry) {
        let r = await upsert("verification_row", this.rows)
        if (!r || r.length != this.rows.length) {
          console.log("Failed creating verification rows: ", r)
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

class AccountParser extends BaseParser {
  word = "#KONTO";
  static accounts: Dict<number> = {};
  constructor(public parent?: VerParser) {
    super(parent);
  }

  async prepare() {
    let r = await getAll("account")
    for (let v of r) {
      AccountParser.accounts[v.number] = v.id;
    }
  }

  static async checkAddAccount(
    number: string,
    description: string
  ): Promise<{ id: number; new: boolean }> {
    // Have it already?
    let id = AccountParser.accounts[number];
    if (id && !options.overwrite) return { id, new: false };
    try {
      if (!id) {
        if (!options.dry) {
          // Create it
          let r: Dict<any> = await upsert("account", { number, description, status: "published" }, "number", "id")
          let new_id = r[0]
          AccountParser.accounts[number] = new_id
          return { id: new_id, new: true };
        }
        else id = 1000000 // dry - for now
      }
      return { id, new: false };
    } catch (e) {
      console.log("AccountParser.addAccount - " + e);
      return { id: 0, new: false };
    }
  }

  static async enableAccounts(used_accounts: Record<number, boolean>) {
    let q = update("account", { status: "published" })
    q = q.whereIn("id", Object.keys(used_accounts))
    let r = await q;
  }

  async openRow(cols: string[]) {
    try {
      let number = cols[1];
      let description = mergeSieComment(cols.slice(2));
      // If we don't have it, create?
      let r = await AccountParser.checkAddAccount(number, description);
      if (r.id) {
        if (r.new) {
          this.changed++;
        }
        this.count++;
      } else this.errors++;
    } catch (e) {
      console.log("AccountParser.openRow - " + e);
      this.errors++;
    }
  }
  closeRow() { }
}


class VerRowParser extends BaseParser {
  word = "#TRANS";
  rows: any[] = [];
  used_accounts: Record<number, boolean> = {};

  constructor(public parent: VerParser) {
    super(parent);
  }

  async prepare() { }

  async openRow(cols: string[]) {
    // Adjust for non decimal amounts
    // TODO: Check settings if we keep fractions or not
    // TODO: This is also a setting per country/currency.
    let val = Number(cols[3]) + this.parent.dec_adjust;
    let a = Math.round(val);
    this.parent.dec_adjust = val - a;
    let number = cols[1]
    let r = await AccountParser.checkAddAccount(number, "<generated>");
    if (!r.id) this.errors++;

    let row = {
      account_id: r.id,
      debit: a > 0 ? a : 0,
      credit: a < 0 ? -a : 0,
    };
    this.parent.rows.push(row);
    if (r.new) this.used_accounts[r.id] = true;
    this.count++;
  }
  closeRow() { }

  async done() {
    // Enable all used accounts in import
    if (Object.keys(this.used_accounts).length > 0)
      await AccountParser.enableAccounts(this.used_accounts);
  }
}

class ImportInfoParser extends BaseParser {
  word = "#IMPORT_INFO";
  words = ["#SIETYP", "#GEN"];
  public info: Dict<any> = {};

  constructor(public parent?: RowParser) {
    super(parent);
  }

  openRow(cols: string[]) {
    if (cols.length > 1) {
      this.changed = -1;
      switch (cols[0]) {
        case "#SIETYP":
          this.info.SIETYP = cols[1];
          this.count++;
          break;
        case "#GEN":
          this.info.generated_at = cols[1];
          this.info.generated_by = mergeSieComment(cols.slice(2));
          this.count++;
          break;
      }
    }
  }
}

class OrganizationInfoParser extends BaseParser {
  word = "#ORGANIZATION_INFO";
  words = ["#ORGNR", "#FNAMN"];
  public info: Dict<any> = {};

  constructor(public parent?: RowParser) {
    super(parent);
  }

  openRow(cols: string[]) {
    if (cols.length > 1) {
      this.changed = -1;
      switch (cols[0]) {
        case "#ORGNR":
          this.info.organization_number = cols[1];
          this.info.country_name = "Sweden";
          this.count++;
          break;
        case "#FNAMN":
          this.info.name = mergeSieComment(cols.slice(1));
          this.count++;
          break;
      }
    }
  }
}

class AccountingInfoParser extends BaseParser {
  word = "#ACCOUNTING_INFO";
  words = ["#RAR", "#KPTYP", "#VALUTA"];
  public info: Dict<any> = {};

  constructor(public parent?: RowParser) {
    super(parent);
  }

  openRow(cols: string[]) {
    if (cols.length > 1) {
      this.changed = -1;
      switch (cols[0]) {
        case "#RAR":
          this.info.year_count = cols[1];
          this.info.year_begin = cols[2];
          this.info.year_end = cols[3];
          this.count++;
          break;
        case "#KPTYP":
          this.info.account_plan = cols[1];
          this.count++;
          break;
        case "#VALUTA":
          this.info.currency = cols[1];
          this.count++;
          break;
      }
    }
  }
}

//
// Begin of import processing  
// 

//const fs = require("fs");
import fs from "fs"
import { promisify } from "util";

import * as readline from "readline";
let existsSync = promisify(fs.exists);

// Options controlling the import
let options = {
  dry: false,
  overwrite: false,
  serie: null as string | null,
  parts: {} as Dict<any>,
  import_info: {} as Dict<any>,
  organization_info: {} as Dict<any>,
  accounting_info: {} as Dict<any>,
};


let av = process.argv;
let ix;
for (ix = 2; ix < av.length - 1; ix++) {
  let opt: string = av[ix];
  switch (opt) {
    case "-O":
      options.overwrite = true;
      break;
    case "-D":
      options.dry = true;
      break;
    //case "-R":
    // Remap verification numbers to this
    //    options.remap_ver_nr = av[++ix];

    case "-p":
      for (let p of av[++ix].split(",")) {
        if (p[0] !== "#") p = "#" + p;
        p = p.toUpperCase();
        options.parts[p] = true;
        if (p == "#VER") {
          // We could find a better way enabling "child parsers" from
          // "parent parsers".
          options.parts["#TRANS"] = true;
        }
      }
      break;
  }
}
let file = av[ix];

async function runImports() {
  let to_dos: Promise<any>[] = []

  // Check args
  if (!(await existsSync(file))) giveUp("File does not exist: " + file);

  // Register parsers
  let parsers: Dict<BaseParser> = {};
  let vp = new VerParser();
  let p_arr: BaseParser[] = [
    vp,
    new VerRowParser(vp),
    new AccountParser(),
    new ImportInfoParser(),
    new OrganizationInfoParser(),
    new AccountingInfoParser(),
  ];
  let prepares: Promise<any>[] = []
  for (let p of p_arr) {
    parsers[p.word] = p;
    if (p.words) {
      // Parsers that accept multiple leading words
      for (let w of p.words) {
        parsers[w] = p;
      }
    }
    prepares.push(p.prepare());
  }
  await Promise.all(prepares);

  let parser: RowParser = null;
  let parents: RowParser[] = [];
  let skipped: Dict<boolean> = {};

  let re_open = new RegExp("^\\{\\s*$");
  let re_close = new RegExp("^\\}\\s*$");

  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });

  let do_all = isEmptyObject(options.parts);

  for await (const line of rl) {
    let word = line.slice(0, line.indexOf(" "));
    let cols = line.split(" ");
    if (re_open.test(line)) {
      parents.push(parser);
    } else if (re_close.test(line)) {
      let p = parents.pop();
      if (p) await p.closeRow();
    } else {
      let p_name = parsers[word] ? parsers[word].word : "";
      parser = do_all || options.parts[p_name] ? parsers[word] : undefined;
      if (parser) {
        await parser.openRow(cols);
      } else {
        if (word && !skipped[word]) {
          console.log("Skipping:" + word + ":");
          skipped[word] = true;
        }
      }
    }
  }

  console.log("Import summary:");
  for (let p of Object.values(parsers)) {
    if (!p.is_done) {
      to_dos.push(p.done())
      if (do_all || options.parts[p.word]) {
        let change_cnt = p.changed >= 0 ? p.changed : "<unknown>";
        console.log(`${p.word} - ${p.count} processed - ${change_cnt} changed - ${p.errors} issues`);
      }
    }
  }

  // See if we have collected organization and import data
  parser = parsers["#IMPORT_INFO"]
  if (!isEmpty(parser.info)) {
    // We could make an import table and keep these
    //await setImportValues(parsers["#IMPORT_INFO"].info, options.exists_overwrite);
  }
  parser = parsers["#ORGANIZATION_INFO"]
  if (!isEmpty(parser.info)) {
    let org_nr = parser.info.organization_number
    if (org_nr) to_dos.push(setConfig("organization_number", org_nr))
    let comp_name = parser.info.name
    if (comp_name) to_dos.push(setConfig("company_name", org_nr))
  }

  parser = parsers["#ACCOUNTING_INFO"]
  if (!isEmpty(parser.info)) {
    // This info would need to go on the import ? 
    let cc = parser.info.currency
    if (cc) to_dos.push(setConfig("currency_code", cc.toUpperCase()))
  }
  return Promise.all(to_dos)
}

// Run it
await runImports()

let dur = process.hrtime(start_time);
console.log(`Duration: ${(dur[0] + dur[1] / 1000000000.0).toFixed(3)} seconds`);

process.exit(0)

