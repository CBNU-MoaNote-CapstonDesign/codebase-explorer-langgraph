import express from "express";
import fs from "fs";

import bodyParser from "body-parser";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const apiPrefix = "/api";
const app = express();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(".")); // index.html, script.js, project_ast.json 제공

// project_ast.json 로드
const projectData = fs.readFileSync("project_ast.json", "utf8");

// 대화 히스토리 (간단히 메모리 저장)
let conversationHistory = [
  {
    role: "system",
    content: "You are a copilot programmer that answers based on the following project AST:\n\n" + projectData,
  },
];

// API 라우트
app.post(apiPrefix + "/chat", async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage) return res.status(400).json({ error: "message is required" });

  try {
    // 사용자 메시지 기록
    conversationHistory.push({ role: "user", content: userMessage });

    // OpenAI API 호출
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversationHistory,
    });

    const assistantMessage = response.choices[0].message.content;

    // 응답 기록
    conversationHistory.push({ role: "assistant", content: assistantMessage });

    res.json({ reply: assistantMessage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OpenAI API 호출 실패" });
  }
});

// 대화 초기화 엔드포인트
app.post(apiPrefix + "/reset", (req, res) => {
  conversationHistory = [
    {
      role: "system",
      content: "You are a copilot programmer that answers based on the following project AST:\n\n" + projectData,
    },
  ];
  res.json({ message: "대화 기록이 초기화되었습니다." });
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});