const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/SmartBooking.jsx', 'utf8');
content = content.replace(/to=\{\/appointment\/book\/\\\}/g, 'to={/appointment/book/}');
fs.writeFileSync('frontend/src/pages/SmartBooking.jsx', content);
console.log('Fixed link');
