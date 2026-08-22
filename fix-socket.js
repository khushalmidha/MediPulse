const fs = require('fs');
let content = fs.readFileSync('backend/socket.js', 'utf8');

// Add chat message relay and end handler
const candidateTarget = '        candidate,\n      });\n    });';
const candidateInjection = candidateTarget + '\n\n    socket.on("appointment:chat-message", (msg) => {\n      if (!msg || !msg.appointmentId) return;\n      socket.to(ppointment:\).emit("appointment:chat-message", msg);\n    });\n\n    socket.on("appointment:end", ({ appointmentId }) => {\n      if (!appointmentId) return;\n      socket.to(ppointment:\).emit("appointment:ended-by-peer", { appointmentId });\n    });';
content = content.replace(candidateTarget, candidateInjection);

// Fix role case sensitivity
content = content.replace(/presence.doctorJoined = \[\.\.\.presence\.sockets\.values\(\)\]\.includes\("doctor"\);/g, 'presence.doctorJoined = [...presence.sockets.values()].some(r => r === "doctor" || r === "DOCTOR");');

fs.writeFileSync('backend/socket.js', content);
console.log('Fixed socket.js');
