const crypto = require('crypto');
console.log(crypto.createHash('sha256').update('A97852900').digest('hex'));
