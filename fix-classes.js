const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/SmartBooking.jsx', 'utf8');
content = content.replace(/className=\{([^}]+?)\s*\\\}/g, 'className=""');
fs.writeFileSync('frontend/src/pages/SmartBooking.jsx', content);
console.log('Fixed classNames');
