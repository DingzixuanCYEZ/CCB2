// src/services/geminiService.ts

import { GoogleGenerativeAI } from "@google/generative-ai";

// 这里建议你在实际部署时从环境变量读取 API_KEY
const API_KEY = localStorage.getItem('recallflow_gemini_api_key') || "";

export const generatePhraseDeck = async (topic: string) => {
  if (!API_KEY) {
    throw new Error("请先在设置中配置 Gemini API Key");
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

  const prompt = `
    你是一个专业的语言学助手。请围绕主题：“${topic}” 生成 10 个高质量的词汇或词组。
    要求以严格的 JSON 数组格式返回，不要包含其他解释文本。
    格式要求：[
      {
        "chinese": "中文释义",
        "english": "英文原文",
        "note": "相关的记忆笔记或例句（如果有多行，请用 \\n 表示换行）"
      }
    ]
  `;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // 尝试提取 JSON 部分
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("API 返回格式不正确");
    }

    const phrases = JSON.parse(jsonMatch[0]);
    return phrases;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};