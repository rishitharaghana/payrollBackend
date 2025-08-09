
const mysql = require('mysql2');

const pool = mysql.createPool({
   
    host: '65.1.236.186',
    user: 'hrms',
    password: 'ZKTrkCzaOpgMFSR123!@#',
    database: 'hrms',
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,

});

pool.getConnection((err,connection)=>{
    if (err){
        console.error("Database connection");
    }
    else {
        console.log('connected to mysql database');
        connection.release();
    }
})

module.exports = pool;