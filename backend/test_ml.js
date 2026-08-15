const mongoose = require('mongoose');
require('dotenv').config();
const axios = require('axios');
mongoose.connect(process.env.DATABASE_URL).then(async () => {
  const User = require('./model/user.js').default;
  const user = await User.findOne();
  
  const state = {
    messages: [
      { role: 'agent', text: 'What is your concern?' },
      { role: 'patient', text: 'I have severe headache and nausea for 2 days.' }
    ],
    brief: {
      chiefComplaint: 'Headache',
      symptomDuration: '2 days',
      severity: 'Severe',
      relevantHistory: 'None',
      urgencyLevel: 'ROUTINE',
      agentSummary: 'Patient has severe headache.',
      generatedAt: new Date(),
      conversationTurns: 2
    },
    turnCount: 2
  };
  
  const transcript = state.messages.map(m => `${m.role}: ${m.text}`).join('\n');
  const mlServiceUrl = process.env.DISEASE_PREDICTION_SERVICE_URL || 'http://localhost:8003/predict';
  console.log('Posting to', mlServiceUrl, 'with text:', transcript);
  
  try {
    const mlResponse = await axios.post(mlServiceUrl, { text: transcript });
    console.log('ML Response:', mlResponse.data);
  } catch (err) {
    console.error('ML Error:', err.message, err.response?.data);
  }
  process.exit();
});
