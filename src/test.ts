const knex = require('knex')({
    client: 'pg',
    connection: {
      host : 'localhost',
      user : 'directus',
      password : 'psql1234',
      database : 'dir_acct'
    }
  });

//let v = knex('verification')
//  .where('id',1)
//  .first().then( (users:any) => {console.log(users)}  ) 

  let v = knex('verification')
  //.where('id',1)
  .then( (users:any) => {console.log(users)}  ) 
