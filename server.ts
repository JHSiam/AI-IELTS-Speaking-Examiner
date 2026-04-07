import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Groq } from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// API routes
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    const systemPrompt = `
      You are an official IELTS Speaking Examiner. Your job is to conduct a full IELTS Speaking Test.
      Follow the rules strictly:
      1. Maintain a polite, neutral, and professional tone.
      2. Ask ONE question at a time.
      3. Wait for the user's response before continuing.
      4. Do NOT give feedback or corrections during the test.
      5. Keep responses concise and examiner-like.
      6. Use natural spoken English.
      
      The test has 3 parts:
      Part 1: Intro & Interview (4-5 mins). Ask 6-8 questions about familiar topics.
      Part 2: Long Turn (3-4 mins total). Give a cue card with a topic and 3-4 bullet points.
      Part 3: Discussion (4-5 mins). Ask 5-7 deeper, abstract questions related to Part 2.
      
      You must manage the transitions between parts.
      When you give the cue card in Part 2, explicitly say: "I will now give you a cue card. You have one minute to prepare. Your time starts now."
      When the test is completely finished, say: "That is the end of the Speaking Test. Thank you."
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      model: "llama-3.3-70b-versatile",
    });

    res.json({ content: chatCompletion.choices[0].message.content });
  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message || "Failed to get examiner response" });
  }
});

app.post("/api/evaluate", async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: "Transcript is required" });
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    const prompt = `
      You are an official IELTS Speaking Examiner. 
      Evaluate the following IELTS Speaking Test transcript and provide a detailed band score evaluation.
      
      Transcript:
      ${transcript}
      
      Follow these criteria:
      1. Fluency & Coherence
      2. Lexical Resource
      3. Grammatical Range & Accuracy
      4. Pronunciation (assume based on text quality)
      
      For each criterion:
      - Give a band score (0-9)
      - Give short justification
      
      Then provide:
      - Overall Band Score (0-9)
      - 3 specific improvement tips
      
      Format the output as a JSON object with the following structure:
      {
        "criteria": [
          { "name": "Fluency & Coherence", "score": number, "justification": "string" },
          { "name": "Lexical Resource", "score": number, "justification": "string" },
          { "name": "Grammatical Range & Accuracy", "score": number, "justification": "string" },
          { "name": "Pronunciation", "score": number, "justification": "string" }
        ],
        "overallScore": number,
        "improvementTips": ["string", "string", "string"]
      }
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(chatCompletion.choices[0].message.content || "{}");
    res.json(result);
  } catch (error: any) {
    console.error("Evaluation error:", error);
    res.status(500).json({ error: error.message || "Failed to evaluate transcript" });
  }
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// Only listen if this file is run directly
if (import.meta.url === `file://${process.argv[1]}` || process.env.NODE_ENV !== "production") {
  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
