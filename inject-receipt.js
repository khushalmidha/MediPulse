const fs = require('fs');
let content = fs.readFileSync('backend/controller/appointment.js', 'utf8');

const targetLine = '    appointment.soapNote = soapNote;';
const injection = \    appointment.soapNote = soapNote;

    try {
      if (!appointment.receiptText) {
        const receiptText = await generateReceiptText(appointment, roughNotes || "");
        appointment.receiptText = receiptText;
        appointment.receiptGeneratedAt = new Date();
      }
    } catch (receiptError) {
      console.error("Auto Receipt generation failed:", receiptError.message);
    }\;

content = content.replace(targetLine, injection);
fs.writeFileSync('backend/controller/appointment.js', content);
console.log('Injected receipt generation into finishAppointment');
