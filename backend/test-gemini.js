import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
