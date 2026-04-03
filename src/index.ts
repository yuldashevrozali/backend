import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { verifyTelegramInitData } from './middleware/telegramAuth.js';
import { updateTheta, calculateScore, getGrade } from './services/rasch.js';
import dotenv from 'dotenv';

dotenv.config();
export const prisma = new PrismaClient();
const app = express();

// ✅ CORS — barcha origin'larga ruxsat
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-tg-auth', 'Authorization'],
}));

// ✅ OPTIONS preflight request'larni qabul qilish
app.options('*', cors());

app.use(express.json());

// ✅ Ro'yxatdan o'tish
app.post('/api/auth/register', verifyTelegramInitData, async (req, res) => {
  try {
    const { name, surname, phone, region, district } = req.body;
    const userId = (req as any).telegramData.user.id.toString();

    const user = await prisma.user.upsert({
      where: { id: userId },
      update: { name, surname, phone, region, district },
      create: { id: userId, name, surname, phone, region, district },
    });
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Foydalanuvchi ma'lumotlarini olish
app.get('/api/me', verifyTelegramInitData, async (req, res) => {
  try {
    const userId = (req as any).telegramData.user.id.toString();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User topilmadi' });
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Testlar ro'yxati
app.get('/api/tests', async (req, res) => {
  try {
    const tests = await prisma.test.findMany();
    res.json(tests);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Tekshiruv boshlash
app.post('/api/tests/:testId/start', verifyTelegramInitData, async (req, res) => {
  const userId = (req as any).telegramData.user.id.toString();
  const testId = req.params.testId;

  const attempt = await prisma.attempt.create({
    data: { userId, testId, theta: 0, answers: {} }
  });

  const question = await prisma.question.findFirst({
    where: { testId },
    orderBy: { difficulty: 'asc' },
  });

  res.json({ attemptId: attempt.id, question });
});

// ✅ Javob yuborish & Theta yangilash
app.post('/api/tests/:testId/answer', verifyTelegramInitData, async (req, res) => {
  const userId = (req as any).telegramData.user.id.toString();
  const { attemptId, questionId, selectedOption } = req.body;

  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question) return res.status(404).json({ error: 'Savol topilmadi' });

  const isCorrect = question.correctOption === selectedOption;
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId } });
  
  if (!attempt) return res.status(404).json({ error: 'Attempt topilmadi' });

  const newTheta = updateTheta(attempt.theta, isCorrect, question.difficulty);
  const updatedAnswers = { ...(attempt.answers as object), [questionId]: isCorrect };

  await prisma.attempt.update({
    where: { id: attemptId },
    data: { theta: newTheta, answers: updatedAnswers }
  });

  const questionCount = Object.keys(updatedAnswers).length;
  const isFinished = questionCount >= 20 || Math.abs(newTheta - attempt.theta) < 0.02;

  let nextQuestion = null;
  if (!isFinished) {
    const answeredIds = Object.keys(updatedAnswers);
    nextQuestion = await prisma.question.findFirst({
      where: { testId: attempt.testId, NOT: { id: { in: answeredIds } } },
      orderBy: { difficulty: 'asc' }
    });
  }

  res.json({ 
    isCorrect, 
    newTheta, 
    isFinished, 
    nextQuestion,
    answersCount: questionCount 
  });
});

// ✅ Testni tugatish
app.post('/api/tests/:testId/finish', verifyTelegramInitData, async (req, res) => {
  const { attemptId } = req.body;
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId } });
  if (!attempt) return res.status(404).json({ error: 'Attempt topilmadi' });

  const score = calculateScore(attempt.theta);
  const grade = getGrade(score);

  await prisma.attempt.update({ where: { id: attemptId }, data: { score, grade } });
  await prisma.test.update({ where: { id: attempt.testId }, data: { attemptCount: { increment: 1 } } });

  res.json({ score, grade, theta: attempt.theta });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
