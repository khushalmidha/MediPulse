const fs = require('fs');
let content = fs.readFileSync('backend/controller/triage.js', 'utf8');
const searchString = 'systemInstruction: \"You are an AI diagnostic routing agent for a hospital booking system. \\nAnalyze the provided symptoms and return a JSON object with:';
const startIndex = content.indexOf('systemInstruction: \"You are an AI');
if (startIndex !== -1) {
  const endIndex = content.indexOf('});', startIndex);
  const replacement = 'systemInstruction: \You are an AI diagnostic routing agent for a hospital booking system. Analyze the provided symptoms and return a JSON object with: - "predictedDisease": best guess of the medical condition (string). - "specialty": the precise medical department needed (e.g. Cardiology, Dermatology, General Medicine, Orthopedics, Neurology, Pediatrics, etc.). - "severity": "LOW", "MEDIUM", "HIGH", or "EMERGENCY". - "esi_level": number from 1 (most severe) to 5 (least severe). Always format your response as valid JSON without markdown formatting.\\n    });';
  content = content.substring(0, startIndex) + replacement + content.substring(endIndex + 3);
  fs.writeFileSync('backend/controller/triage.js', content);
  console.log('Fixed syntax error');
} else {
  console.log('Could not find search string');
}
