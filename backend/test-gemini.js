import { GoogleGenerativeAI } from '@google/generative-ai';
import process from 'node:process';
// Explicit opt-in; never load deployment .env from a test utility.
if (process.env.ALLOW_PROVIDER_TEST !== 'true' || !process.env.TEST_GEMINI_API_KEY) {
  throw new Error('Provider test requires ALLOW_PROVIDER_TEST=true and an explicit TEST_GEMINI_API_KEY');
}

const genAI = new GoogleGenerativeAI(process.env.TEST_GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction: 'Ask exactly 3 questions one by one.',
});

async function run() {
  const contents = [
    { role: 'user', parts: [{ text: 'Start' }] },
    { role: 'model', parts: [{ text: 'Question 1: Name?' }] },
    { role: 'user', parts: [{ text: 'John' }] }
  ];
  const res = await model.generateContent({ contents });
  console.log(res.response.text());
}
run();
