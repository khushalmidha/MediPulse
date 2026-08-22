const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/AppointmentVideoCall.jsx', 'utf8');

// Fix getUserMedia constraints
content = content.replace(/\{ audio: true, video: true \}/g, '{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: true }');
content = content.replace(/\{ audio: true, video: false \}/g, '{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }');

// Add onCallEnd() to onCallEnded
const endedTarget = 'if (peerConnectionRef.current) { peerConnectionRef.current.close(); peerConnectionRef.current = null; }';
const endedInject = endedTarget + '\n      onCallEnd();';
content = content.replace(endedTarget, endedInject);

fs.writeFileSync('frontend/src/components/AppointmentVideoCall.jsx', content);
console.log('Fixed AppointmentVideoCall.jsx');
