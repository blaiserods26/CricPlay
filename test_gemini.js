const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: 'mock_key' });
console.log('Instantiated successfully');
try {
  ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: 'Hello',
  }).catch(e => console.error('Caught:', e.message));
} catch(e) {
  console.error('Sync Error:', e.message);
}
